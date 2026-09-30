import type {
  EventDocument,
  EventNode,
  EventSheetNode,
  FunctionNode,
  JsonValue,
} from './types.js'

export type DiffNodeType = 'document' | 'sheet' | 'event' | 'condition' | 'action' | 'variable' | 'function' | 'parameter' | 'include'

export interface DiffPosition {
  path: string
  parentId?: string
  index?: number
}

export type EventDocumentDiffOperation =
  | { kind: 'add'; nodeType: DiffNodeType; nodeId: string; to: DiffPosition; after: JsonValue }
  | { kind: 'remove'; nodeType: DiffNodeType; nodeId: string; from: DiffPosition; before: JsonValue }
  | { kind: 'update'; nodeType: DiffNodeType; nodeId: string; at: DiffPosition; before: JsonValue; after: JsonValue }
  | { kind: 'move'; nodeType: DiffNodeType; nodeId: string; from: DiffPosition; to: DiffPosition }

export interface EventDocumentDiff {
  operations: EventDocumentDiffOperation[]
  isEmpty: boolean
}

interface DiffNode {
  key: string
  nodeType: DiffNodeType
  nodeId: string
  position: DiffPosition
  value: JsonValue
}

/** Compare stable structural IDs between snapshots without reporting source-offset churn. */
export function diffEventDocuments(before: EventDocument, after: EventDocument): EventDocumentDiff {
  const beforeNodes = indexNodes(before)
  const afterNodes = indexNodes(after)
  const beforeByKey = new Map(beforeNodes.map((node) => [node.key, node]))
  const afterByKey = new Map(afterNodes.map((node) => [node.key, node]))
  const operations: EventDocumentDiffOperation[] = []

  for (const prior of beforeNodes) {
    const next = afterByKey.get(prior.key)
    if (!next) {
      operations.push({
        kind: 'remove', nodeType: prior.nodeType, nodeId: prior.nodeId,
        from: prior.position, before: prior.value,
      })
      continue
    }
    if (!samePosition(prior.position, next.position)) {
      operations.push({
        kind: 'move', nodeType: prior.nodeType, nodeId: prior.nodeId,
        from: prior.position, to: next.position,
      })
    }
    if (stableStringify(prior.value) !== stableStringify(next.value)) {
      operations.push({
        kind: 'update', nodeType: next.nodeType, nodeId: next.nodeId,
        at: next.position, before: prior.value, after: next.value,
      })
    }
  }

  for (const next of afterNodes) {
    if (beforeByKey.has(next.key)) continue
    operations.push({
      kind: 'add', nodeType: next.nodeType, nodeId: next.nodeId,
      to: next.position, after: next.value,
    })
  }

  return { operations, isEmpty: operations.length === 0 }
}

function indexNodes(document: EventDocument): DiffNode[] {
  const result: DiffNode[] = []
  const occurrences = new Map<string, number>()

  function add(
    node: { id: string },
    nodeType: DiffNodeType,
    path: string,
    parentId: string | undefined,
    index: number | undefined,
    omitKeys: readonly string[] = [],
  ): void {
    const occurrence = (occurrences.get(node.id) ?? 0) + 1
    occurrences.set(node.id, occurrence)
    const key = occurrence === 1 ? node.id : node.id + '#duplicate-' + occurrence
    result.push({
      key,
      nodeType,
      nodeId: node.id,
      position: {
        path,
        ...(parentId === undefined ? {} : { parentId }),
        ...(index === undefined ? {} : { index }),
      },
      value: snapshot(node, omitKeys),
    })
  }

  function collectSheet(sheet: EventSheetNode, index: number): void {
    const path = `$.sheets[${index}]`
    add(sheet, 'sheet', path, document.id, index, ['events', 'variables', 'includes'])
    if ('type' in sheet) return
    sheet.variables?.forEach((variable, variableIndex) => {
      add(variable, 'variable', `${path}.variables[${variableIndex}]`, sheet.id, variableIndex)
    })
    sheet.includes?.forEach((include, includeIndex) => {
      add(include, 'include', `${path}.includes[${includeIndex}]`, sheet.id, includeIndex)
    })
    sheet.events.forEach((event, eventIndex) => collectEvent(event, `${path}.events[${eventIndex}]`, sheet.id, eventIndex))
  }

  function collectEvent(event: EventNode, path: string, parentId: string, index: number): void {
    add(event, 'event', path, parentId, index, ['conditions', 'actions', 'subEvents'])
    if (event.type !== 'event') return
    event.conditions.forEach((condition, conditionIndex) => {
      add(condition, 'condition', `${path}.conditions[${conditionIndex}]`, event.id, conditionIndex)
    })
    event.actions.forEach((action, actionIndex) => {
      add(action, 'action', `${path}.actions[${actionIndex}]`, event.id, actionIndex)
    })
    event.subEvents?.forEach((child, childIndex) => {
      collectEvent(child, `${path}.subEvents[${childIndex}]`, event.id, childIndex)
    })
  }

  function collectFunction(fn: FunctionNode, index: number): void {
    const path = `$.functions[${index}]`
    add(fn, 'function', path, document.id, index, ['parameters', 'body'])
    if ('type' in fn) return
    fn.parameters.forEach((parameter, parameterIndex) => {
      add(parameter, 'parameter', `${path}.parameters[${parameterIndex}]`, fn.id, parameterIndex)
    })
    fn.body.forEach((event, eventIndex) => collectEvent(event, `${path}.body[${eventIndex}]`, fn.id, eventIndex))
  }

  add(document, 'document', '$', undefined, undefined, ['sheets', 'variables', 'functions'])
  document.sheets.forEach(collectSheet)
  document.variables.forEach((variable, index) => {
    add(variable, 'variable', `$.variables[${index}]`, document.id, index)
  })
  document.functions?.forEach(collectFunction)
  return result
}

function snapshot(node: unknown, omitKeys: readonly string[]): JsonValue {
  const omitted = new Set(omitKeys)
  return normalize(node, omitted) as JsonValue
}

function normalize(value: unknown, omitKeys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalize(entry, new Set()))
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(value)
    .filter((key) => key !== 'sourceLocation' && !omitKeys.has(key) && record[key] !== undefined)
    .sort()
    .map((key) => [key, normalize(record[key], new Set())]))
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value)
}

function samePosition(left: DiffPosition, right: DiffPosition): boolean {
  return left.path === right.path && left.parentId === right.parentId && left.index === right.index
}
