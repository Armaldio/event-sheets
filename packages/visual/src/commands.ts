import type {
  Action,
  ActionNode,
  Condition,
  ConditionNode,
  Event,
  EventDocument,
  EventNode,
  EventSheet,
  EventSheetNode,
  Expression,
} from '@project/schema'

export type EditorCommand =
  | { type: 'add-event'; sheetId: string; event: Event; parentEventId?: string | undefined; index?: number }
  | { type: 'remove-event'; eventId: string }
  | { type: 'move-event'; eventId: string; targetSheetId: string; targetParentEventId?: string | undefined; beforeEventId?: string; index?: number }
  | { type: 'add-condition'; eventId: string; condition: Condition; index?: number }
  | { type: 'remove-condition'; eventId: string; conditionId: string }
  | { type: 'update-condition-operation'; eventId: string; conditionId: string; operation: string }
  | { type: 'update-condition-parameters'; eventId: string; conditionId: string; parameters: Expression[] }
  | { type: 'move-condition'; eventId: string; conditionId: string; toIndex: number }
  | { type: 'add-action'; eventId: string; action: Action; index?: number }
  | { type: 'remove-action'; eventId: string; actionId: string }
  | { type: 'update-action-operation'; eventId: string; actionId: string; operation: string }
  | { type: 'update-action-parameters'; eventId: string; actionId: string; parameters: Expression[] }
  | { type: 'move-action'; eventId: string; actionId: string; toIndex: number }

/** Apply one immutable editor command to a plain EventDocument. */
export function applyEditorCommand(document: EventDocument, command: EditorCommand): EventDocument {
  switch (command.type) {
    case 'add-event':
      assertFreshNodeIds(document, command.event)
      return insertEvent(document, command.sheetId, command.parentEventId, command.event, command.index)
    case 'remove-event':
      return removeEvent(document, command.eventId).document
    case 'move-event':
      return moveEvent(document, command)
    case 'add-condition':
      assertFreshNodeIds(document, command.condition)
      return updateEvent(document, command.eventId, (event) => ({
        ...event,
        conditions: insertAt(event.conditions, command.condition, command.index),
      }))
    case 'remove-condition':
      return updateEvent(document, command.eventId, (event) => ({
        ...event,
        conditions: removeById(event.conditions, command.conditionId, 'condition'),
      }))
    case 'update-condition-parameters':
      return updateEvent(document, command.eventId, (event) => ({
        ...event,
        conditions: updateParameters(event.conditions, command.conditionId, command.parameters, 'condition'),
      }))
    case 'update-condition-operation':
      return updateEvent(document, command.eventId, (event) => ({
        ...event,
        conditions: updateOperation(event.conditions, command.conditionId, command.operation, 'condition'),
      }))
    case 'move-condition':
      return updateEvent(document, command.eventId, (event) => ({
        ...event,
        conditions: moveWithin(event.conditions, command.conditionId, command.toIndex, 'condition'),
      }))
    case 'add-action':
      assertFreshNodeIds(document, command.action)
      return updateEvent(document, command.eventId, (event) => ({
        ...event,
        actions: insertAt(event.actions, command.action, command.index),
      }))
    case 'remove-action':
      return updateEvent(document, command.eventId, (event) => ({
        ...event,
        actions: removeById(event.actions, command.actionId, 'action'),
      }))
    case 'update-action-parameters':
      return updateEvent(document, command.eventId, (event) => ({
        ...event,
        actions: updateParameters(event.actions, command.actionId, command.parameters, 'action'),
      }))
    case 'update-action-operation':
      return updateEvent(document, command.eventId, (event) => ({
        ...event,
        actions: updateOperation(event.actions, command.actionId, command.operation, 'action'),
      }))
    case 'move-action':
      return updateEvent(document, command.eventId, (event) => ({
        ...event,
        actions: moveWithin(event.actions, command.actionId, command.toIndex, 'action'),
      }))
  }
}

/** Small undo/redo stack for immutable document commands. */
export class CommandHistory {
  private readonly past: EventDocument[] = []
  private readonly future: EventDocument[] = []

  constructor(private current: EventDocument) {}

  get document(): EventDocument {
    return this.current
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  execute(command: EditorCommand): EventDocument {
    const next = applyEditorCommand(this.current, command)
    if (next !== this.current) {
      this.past.push(this.current)
      this.current = next
      this.future.length = 0
    }
    return this.current
  }

  undo(): EventDocument {
    const previous = this.past.pop()
    if (previous) {
      this.future.push(this.current)
      this.current = previous
    }
    return this.current
  }

  redo(): EventDocument {
    const next = this.future.pop()
    if (next) {
      this.past.push(this.current)
      this.current = next
    }
    return this.current
  }
}

function updateEvent(
  document: EventDocument,
  eventId: string,
  update: (event: Event) => Event,
): EventDocument {
  let found = false
  const sheets = document.sheets.map((sheet) => {
    if (isRecoverySheet(sheet)) return sheet
    const events = updateEvents(sheet.events, eventId, update, () => { found = true })
    return events === sheet.events ? sheet : { ...sheet, events }
  })
  if (!found) throw new RangeError(`No editable event exists with ID "${eventId}".`)
  return { ...document, sheets }
}

function updateEvents(
  events: EventNode[],
  eventId: string,
  update: (event: Event) => Event,
  onFound: () => void,
): EventNode[] {
  let changed = false
  const next = events.map((node) => {
    if (node.type !== 'event') return node
    let result = node
    if (node.id === eventId) {
      onFound()
      result = update(node)
    }
    if (node.subEvents) {
      const subEvents = updateEvents(node.subEvents, eventId, update, onFound)
      if (subEvents !== node.subEvents) result = { ...result, subEvents }
    }
    if (result !== node) changed = true
    return result
  })
  return changed ? next : events
}

function insertEvent(
  document: EventDocument,
  sheetId: string,
  parentEventId: string | undefined,
  event: EventNode,
  index: number | undefined,
  beforeEventId?: string,
): EventDocument {
  if (parentEventId) {
    const parentSheet = findEvent(document, parentEventId).sheet
    if (parentSheet.id !== sheetId) throw new RangeError(`Parent event "${parentEventId}" is not in sheet "${sheetId}".`)
    return updateEvent(document, parentEventId, (parent) => ({
      ...parent,
      subEvents: beforeEventId
        ? insertBefore(parent.subEvents ?? [], event, beforeEventId)
        : insertAt(parent.subEvents ?? [], event, index),
    }))
  }
  let found = false
  const sheets = document.sheets.map((sheet) => {
    if (isRecoverySheet(sheet) || sheet.id !== sheetId) return sheet
    found = true
    return {
      ...sheet,
      events: beforeEventId
        ? insertBefore(sheet.events, event, beforeEventId)
        : insertAt(sheet.events, event, index),
    }
  })
  if (!found) throw new RangeError(`No editable sheet exists with ID "${sheetId}".`)
  return { ...document, sheets }
}

function removeEvent(document: EventDocument, eventId: string): { document: EventDocument; event: EventNode } {
  let removed: EventNode | undefined
  const sheets = document.sheets.map((sheet) => {
    if (isRecoverySheet(sheet) || removed) return sheet
    const result = removeEventFromList(sheet.events, eventId)
    if (result) {
      removed = result.removed
      return { ...sheet, events: result.events }
    }
    return sheet
  })
  if (!removed) throw new RangeError(`No editable event exists with ID "${eventId}".`)
  return { document: { ...document, sheets }, event: removed }
}

function removeEventFromList(events: EventNode[], eventId: string): { events: EventNode[]; removed: EventNode } | undefined {
  const index = events.findIndex((node) => node.id === eventId)
  if (index >= 0) {
    const removed = events[index]
    if (!removed) return undefined
    return { events: events.filter((_, itemIndex) => itemIndex !== index), removed }
  }
  for (let index = 0; index < events.length; index += 1) {
    const node = events[index]
    if (!node || node.type !== 'event' || !node.subEvents) continue
    const nested = removeEventFromList(node.subEvents, eventId)
    if (!nested) continue
    const next = events.slice()
    next[index] = { ...node, subEvents: nested.events }
    return { events: next, removed: nested.removed }
  }
  return undefined
}

function moveEvent(document: EventDocument, command: Extract<EditorCommand, { type: 'move-event' }>): EventDocument {
  const located = findEventNode(document, command.eventId)
  if (command.targetParentEventId && located.event.type === 'event' && containsEvent(located.event, command.targetParentEventId)) {
    throw new RangeError('An event cannot be moved inside itself or one of its descendants.')
  }
  if (command.beforeEventId === command.eventId && command.targetSheetId === located.sheet.id && command.targetParentEventId === located.parentEventId) return document
  const withoutEvent = removeEvent(document, command.eventId).document
  return insertEvent(withoutEvent, command.targetSheetId, command.targetParentEventId, located.event, command.index, command.beforeEventId)
}

function findEventNode(document: EventDocument, eventId: string): { event: EventNode; sheet: EventSheet; parentEventId?: string } {
  function visit(events: EventNode[], sheet: EventSheet, parentEventId?: string): ReturnType<typeof findEventNode> | undefined {
    for (const node of events) {
      if (node.id === eventId) return { event: node, sheet, ...(parentEventId ? { parentEventId } : {}) }
      if (node.type === 'event' && node.subEvents) {
        const nested = visit(node.subEvents, sheet, node.id)
        if (nested) return nested
      }
    }
    return undefined
  }
  for (const sheet of document.sheets) {
    if (isRecoverySheet(sheet)) continue
    const event = visit(sheet.events, sheet)
    if (event) return event
  }
  throw new RangeError(`No editable event exists with ID "${eventId}".`)
}

function findEvent(document: EventDocument, eventId: string): { event: Event; sheet: EventSheet } {
  for (const sheet of document.sheets) {
    if (isRecoverySheet(sheet)) continue
    const event = findEventInList(sheet.events, eventId)
    if (event) return { event, sheet }
  }
  throw new RangeError(`No editable event exists with ID "${eventId}".`)
}

function findEventInList(events: EventNode[], eventId: string): Event | undefined {
  for (const node of events) {
    if (node.type !== 'event') continue
    if (node.id === eventId) return node
    const nested = node.subEvents ? findEventInList(node.subEvents, eventId) : undefined
    if (nested) return nested
  }
  return undefined
}

function containsEvent(event: Event, eventId: string): boolean {
  return event.id === eventId || Boolean(event.subEvents?.some((node) => node.type === 'event' && containsEvent(node, eventId)))
}

function removeById<T extends ConditionNode | ActionNode>(nodes: T[], nodeId: string, kind: 'condition' | 'action'): T[] {
  const index = nodes.findIndex((node) => node.id === nodeId)
  if (index < 0) throw new RangeError(`No ${kind} exists with ID "${nodeId}".`)
  return nodes.filter((_, itemIndex) => itemIndex !== index)
}

function updateParameters<T extends ConditionNode | ActionNode>(
  nodes: T[],
  nodeId: string,
  parameters: Expression[],
  kind: 'condition' | 'action',
): T[] {
  let found = false
  const updated = nodes.map((node) => {
    if (node.id !== nodeId) return node
    if (node.type !== kind) throw new TypeError(`Cannot edit parameters of a ${node.type} ${kind}.`)
    found = true
    return { ...node, parameters }
  })
  if (!found) throw new RangeError(`No ${kind} exists with ID "${nodeId}".`)
  return updated
}

function updateOperation<T extends ConditionNode | ActionNode>(
  nodes: T[],
  nodeId: string,
  operation: string,
  kind: 'condition' | 'action',
): T[] {
  let found = false
  const updated = nodes.map((node) => {
    if (node.id !== nodeId) return node
    if (node.type !== kind) throw new TypeError(`Cannot edit operation of a ${node.type} ${kind}.`)
    found = true
    return { ...node, operation }
  })
  if (!found) throw new RangeError(`No ${kind} exists with ID "${nodeId}".`)
  return updated
}

function moveWithin<T extends ConditionNode | ActionNode>(
  nodes: T[],
  nodeId: string,
  toIndex: number,
  kind: 'condition' | 'action',
): T[] {
  const fromIndex = nodes.findIndex((node) => node.id === nodeId)
  if (fromIndex < 0) throw new RangeError(`No ${kind} exists with ID "${nodeId}".`)
  const next = nodes.slice()
  const [node] = next.splice(fromIndex, 1)
  if (!node) return nodes
  next.splice(clampIndex(toIndex, next.length), 0, node)
  return next
}

function insertAt<T>(nodes: T[], node: T, index: number | undefined): T[] {
  const next = nodes.slice()
  next.splice(index === undefined ? next.length : clampIndex(index, next.length), 0, node)
  return next
}

function insertBefore<T extends { id: string }>(nodes: T[], node: T, beforeId: string): T[] {
  const index = nodes.findIndex((item) => item.id === beforeId)
  if (index < 0) throw new RangeError(`No sibling node exists with ID "${beforeId}".`)
  const next = nodes.slice()
  next.splice(index, 0, node)
  return next
}

function clampIndex(index: number, length: number): number {
  if (!Number.isInteger(index)) throw new TypeError('Command index must be an integer.')
  return Math.max(0, Math.min(length, index))
}

function assertFreshNodeIds(document: EventDocument, addedNode: unknown): void {
  const ids = collectNodeIds([addedNode])
  const seen = new Set<string>([document.id, ...collectNodeIds([
    document.sheets,
    document.variables,
    document.functions ?? [],
  ])])
  for (const nodeId of ids) {
    if (seen.has(nodeId)) throw new TypeError(`Node ID "${nodeId}" already exists in the document.`)
    seen.add(nodeId)
  }
}

function collectNodeIds(nodes: readonly unknown[]): string[] {
  const ids: string[] = []
  for (const value of nodes) {
    if (value === null || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      ids.push(...collectNodeIds(value))
      continue
    }
    const node = value as Record<string, unknown>
    if (typeof node.id === 'string') ids.push(node.id)
    for (const key of ['events', 'conditions', 'actions', 'subEvents', 'parameters', 'body', 'elements', 'arguments']) {
      if (Array.isArray(node[key])) ids.push(...collectNodeIds(node[key] as unknown[]))
    }
    for (const key of ['object', 'left', 'right', 'argument', 'test', 'whenTrue', 'whenFalse']) {
      const child = node[key]
      if (child !== null && typeof child === 'object') ids.push(...collectNodeIds([child]))
    }
  }
  return ids
}

function isRecoverySheet(node: EventSheetNode): node is Exclude<EventSheetNode, { name: string }> {
  return 'type' in node
}
