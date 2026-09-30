import {
  isJsonObject,
  validateEventDocument,
  type ActionNode,
  type ConditionNode,
  type Diagnostic,
  type EventDocument,
  type EventNode,
  type EventSheetInclude,
  type EventSheetNode,
  type FunctionDefinition,
  type FunctionNode,
  type ParseStatus,
  type VariableNode,
} from '@project/schema'
import { constructEngine, type ConstructRegistry } from './registry.js'
import type { ActionDefinition, ConditionDefinition } from './types.js'

export interface CompileConstructOptions {
  registry?: ConstructRegistry
}

export interface CompiledCondition {
  source: ConditionNode
  definition?: ConditionDefinition
}

export interface CompiledAction {
  source: ActionNode
  definition?: ActionDefinition
}

export interface CompiledEvent {
  source: EventNode
  conditions: CompiledCondition[]
  actions: CompiledAction[]
  children: CompiledEvent[]
}

export interface CompiledSheet {
  source: EventSheetNode
  events: CompiledEvent[]
  variables?: VariableNode[]
}

export interface CompiledFunction {
  source: FunctionDefinition
  body: CompiledEvent[]
  copyPicked?: boolean
}

/** Construct-owned execution input produced from the public, engine-neutral IR. */
export interface CompiledConstructDocument {
  engineId: string
  documentId: string
  sheets: CompiledSheet[]
  functions: CompiledFunction[]
  variables: VariableNode[]
  status: ParseStatus
  diagnostics: Diagnostic[]
}

export interface CompileConstructResult {
  compiled: CompiledConstructDocument
  diagnostics: Diagnostic[]
  status: ParseStatus
}

/** Validate the document and resolve known ACE operations before runtime use. */
export function compileConstruct(
  document: EventDocument,
  options: CompileConstructOptions = {},
): CompileConstructResult {
  const registry = options.registry ?? constructEngine.registry
  const diagnostics = [...validateEventDocument(document).diagnostics]
  if (document.engine.id !== 'construct') {
    diagnostics.push({
      code: 'construct.compile.wrong-engine',
      severity: 'error',
      message: 'Cannot compile a ' + document.engine.id + ' document with the Construct compiler.',
    })
  }

  const sheetsById = new Map(document.sheets.map((sheet) => [sheet.id, sheet]))
  const functionReturnTypes = collectFunctionReturnTypes(document)
  const sheets = document.sheets.map(compileSheet)
  const documentVariables = [
    ...document.variables,
    ...document.sheets.flatMap((sheet) => 'variables' in sheet
      ? sheet.variables?.filter((variable) => 'scope' in variable && variable.scope === 'global') ?? []
      : []),
  ]
  const functions = (document.functions ?? []).flatMap((fn) => compileFunction(fn))
  for (const sheet of document.sheets) {
    if ('type' in sheet) continue
    for (const event of sheet.events) collectEventFunctions(event)
  }
  const status: ParseStatus = diagnostics.some(({ severity }) => severity === 'warning' || severity === 'error')
    ? 'partial'
    : 'complete'
  const compiled: CompiledConstructDocument = {
    engineId: document.engine.id,
    documentId: document.id,
    sheets,
    functions,
    variables: documentVariables,
    status,
    diagnostics,
  }
  return { compiled, diagnostics, status }

  function compileSheet(source: EventSheetNode): CompiledSheet {
    if ('type' in source) {
      diagnostics.push(unsupportedNodeDiagnostic('sheet', source.id))
      return { source, events: [] }
    }
    const visitedSheets = new Set([source.id])
    const activeSheets = new Set([source.id])
    return {
      source,
      events: compileSheetEvents(source, visitedSheets, activeSheets),
      ...(source.variables === undefined
        ? {}
        : { variables: source.variables.filter((variable) => !('scope' in variable && variable.scope === 'global')) }),
    }
  }

  function compileFunction(source: FunctionNode): CompiledFunction[] {
    if ('type' in source) {
      diagnostics.push(unsupportedNodeDiagnostic('function', source.id))
      return []
    }
    return [{ source, body: source.body.map(compileEvent) }]
  }

  function collectEventFunctions(source: EventNode): void {
    if (source.type !== 'event') return
    if (source.eventKind === 'function') {
      if (!source.label) {
        diagnostics.push({
          code: 'construct.compile.function-name-required',
          severity: 'warning',
          message: 'Construct function blocks need a name before they can be called.',
          nodeId: source.id,
        })
      } else {
        const bodyEvent = { ...source, eventKind: 'block' as const }
        const definition: FunctionDefinition = {
          id: source.id,
          name: source.label,
          parameters: source.functionParameters ?? [],
          body: [bodyEvent],
          ...(source.functionReturnType === undefined ? {} : { returnType: source.functionReturnType }),
          ...(source.sourceLocation === undefined ? {} : { sourceLocation: source.sourceLocation }),
          ...(source.metadata === undefined ? {} : { metadata: source.metadata }),
        }
        functions.push({
          source: definition,
          body: [compileEvent(bodyEvent)],
          ...(source.functionCopyPicked === undefined ? {} : { copyPicked: source.functionCopyPicked }),
        })
      }
    }
    for (const child of source.subEvents ?? []) collectEventFunctions(child)
  }

  function compileSheetEvents(
    source: Extract<EventSheetNode, { events: EventNode[] }>,
    visitedSheets: Set<string>,
    activeSheets: Set<string>,
  ): CompiledEvent[] {
    const entries: Array<{ offset: number | undefined; order: number; event?: EventNode; include?: EventSheetInclude }> = []
    let order = 0
    for (const include of source.includes ?? []) {
      entries.push({ offset: include.sourceLocation?.offsetStart, order: order++, include })
    }
    for (const event of source.events) {
      entries.push({ offset: event.sourceLocation?.offsetStart, order: order++, event })
    }
    entries.sort((left, right) =>
      (left.offset ?? Number.POSITIVE_INFINITY) - (right.offset ?? Number.POSITIVE_INFINITY)
      || left.order - right.order)

    return entries.flatMap((entry) => {
      if (entry.event) return [compileEvent(entry.event)]
      return entry.include ? compileIncludedSheet(entry.include, visitedSheets, activeSheets) : []
    })
  }

  function compileIncludedSheet(
    include: EventSheetInclude,
    visitedSheets: Set<string>,
    activeSheets: Set<string>,
  ): CompiledEvent[] {
    const target = include.targetSheetId ? sheetsById.get(include.targetSheetId) : undefined
    if (!target || 'type' in target) {
      diagnostics.push({
        code: 'construct.compile.unresolved-include',
        severity: 'warning',
        message: 'Included event sheet "' + include.sheetName + '" has no available target sheet.',
        nodeId: include.id,
        ...(include.sourceLocation === undefined ? {} : { sourceLocation: include.sourceLocation }),
      })
      return []
    }
    if (activeSheets.has(target.id)) {
      diagnostics.push({
        code: 'construct.compile.include-cycle',
        severity: 'warning',
        message: 'Circular include of event sheet "' + target.name + '" was skipped.',
        nodeId: include.id,
        ...(include.sourceLocation === undefined ? {} : { sourceLocation: include.sourceLocation }),
      })
      return []
    }
    if (visitedSheets.has(target.id)) return []

    visitedSheets.add(target.id)
    activeSheets.add(target.id)
    const events = compileSheetEvents(target, visitedSheets, activeSheets)
    activeSheets.delete(target.id)
    return events
  }

  function compileEvent(source: EventNode): CompiledEvent {
    if (source.type !== 'event') {
      diagnostics.push(unsupportedNodeDiagnostic('event', source.id))
      return { source, conditions: [], actions: [], children: [] }
    }
    const conditions = source.conditions.map(compileCondition)
    for (const [index, condition] of conditions.entries()) {
      if (condition.source.type === 'condition'
        && condition.source.operation === 'System.trigger-once-while-true'
        && index !== conditions.length - 1) {
        diagnostics.push({
          code: 'construct.compile.trigger-once-not-last',
          severity: 'warning',
          message: 'Trigger once while true should be the last condition in its event.',
          nodeId: condition.source.id,
        })
      }
      if (condition.definition?.isLooping === true && source.isOrBlock === true) {
        diagnostics.push({
          code: 'construct.compile.loop-condition-position',
          severity: 'warning',
          message: 'Looping conditions cannot be used in OR events.',
          nodeId: condition.source.id,
        })
      }
    }
    return {
      source,
      conditions,
      actions: source.actions.map(compileAction),
      children: (source.subEvents ?? []).map(compileEvent),
    }
  }

  function compileCondition(source: ConditionNode): CompiledCondition {
    if (source.type !== 'condition') {
      diagnostics.push(unsupportedNodeDiagnostic('condition', source.id))
      return { source }
    }
    const definition = definitionFor(
      source.operation,
      'condition',
      source.id,
      sourceBehaviorType(source.metadata),
      sourcePluginId(source.metadata),
    )
    if (definition) validateAce(source, definition)
    return { source, ...(definition === undefined ? {} : { definition }) }
  }

  function compileAction(source: ActionNode): CompiledAction {
    if (source.type === 'comment') return { source }
    if (source.type !== 'action') {
      diagnostics.push(unsupportedNodeDiagnostic('action', source.id))
      return { source }
    }
    if (source.operation.startsWith('Functions.')) {
      const functionName = source.operation.slice('Functions.'.length)
      if (!registry.getAction('Functions', functionName)) {
        const returnType = functionReturnTypes.get(functionName.toLowerCase())
        if (functionReturnTypes.has(functionName.toLowerCase())
          && (returnType === undefined || returnType.toLowerCase() === 'none')) {
          return {
            source,
            definition: {
              id: functionName,
              objectClass: 'Functions',
              category: 'functions',
              name: functionName,
              scriptName: functionName,
            },
          }
        }
        if (functionReturnTypes.has(functionName.toLowerCase())) {
          diagnostics.push({
            code: 'construct.compile.returning-function-used-as-action',
            severity: 'warning',
            message: 'Functions with a return value must be called as expressions, not actions.',
            nodeId: source.id,
          })
          return { source }
        }
      }
    }
    const definition = definitionFor(
      source.operation,
      'action',
      source.id,
      sourceBehaviorType(source.metadata),
      sourcePluginId(source.metadata),
    )
    if (definition) validateAce(source, definition)
    return { source, ...(definition === undefined ? {} : { definition }) }
  }

  function collectFunctionReturnTypes(source: EventDocument): Map<string, string | undefined> {
    const returnTypes = new Map<string, string | undefined>()
    for (const fn of source.functions ?? []) {
      if (!('type' in fn)) returnTypes.set(fn.name.toLowerCase(), fn.returnType)
    }
    for (const sheet of source.sheets) {
      if ('type' in sheet) continue
      for (const event of sheet.events) visit(event)
    }
    return returnTypes

    function visit(event: EventNode): void {
      if (event.type !== 'event') return
      if (event.eventKind === 'function' && event.label) {
        returnTypes.set(event.label.toLowerCase(), event.functionReturnType)
      }
      for (const child of event.subEvents ?? []) visit(child)
    }
  }

  function validateAce(
    source: Extract<ConditionNode | ActionNode, { type: 'condition' | 'action' }>,
    definition: ConditionDefinition | ActionDefinition,
  ): void {
    if (!definition.validate) return
    try {
      for (const item of definition.validate(source.parameters)) {
        const sourceLocation = item.sourceLocation ?? source.sourceLocation
        diagnostics.push({
          ...item,
          nodeId: item.nodeId ?? source.id,
          ...(sourceLocation === undefined ? {} : { sourceLocation }),
        })
      }
    } catch (error) {
      diagnostics.push({
        code: 'construct.compile.validator-error',
        severity: 'error',
        message: 'Validator for "' + source.operation + '" failed: '
          + (error instanceof Error ? error.message : 'unknown error.'),
        nodeId: source.id,
        ...(source.sourceLocation === undefined ? {} : { sourceLocation: source.sourceLocation }),
      })
    }
  }

  function definitionFor(
    operation: string,
    kind: 'condition' | 'action',
    nodeId: string,
    behaviorType?: string,
    pluginId?: string,
  ): ConditionDefinition | ActionDefinition | undefined {
    const separator = operation.lastIndexOf('.')
    const objectClass = separator > 0 ? operation.slice(0, separator) : ''
    const aceId = separator > 0 ? operation.slice(separator + 1) : ''
    const lookupOptions = {
      ...(behaviorType === undefined ? {} : { behaviorType }),
      ...(pluginId === undefined ? {} : { pluginId }),
    }
    const definition = kind === 'condition'
      ? registry.getCondition(objectClass, aceId, lookupOptions)
      : registry.getAction(objectClass, aceId, lookupOptions)
    if (definition) return definition
    diagnostics.push({
      code: 'construct.compile.unsupported-' + kind,
      severity: 'warning',
      message: 'No registered Construct ' + kind + ' definition exists for "' + operation + '".',
      nodeId,
      details: { operation },
    })
    return undefined
  }
}

function sourceBehaviorType(metadata: EventDocument['metadata']): string | undefined {
  if (!metadata || !isJsonObject(metadata.construct) || !isJsonObject(metadata.construct.raw)) return undefined
  return typeof metadata.construct.raw.behaviorType === 'string'
    ? metadata.construct.raw.behaviorType
    : undefined
}

function sourcePluginId(metadata: EventDocument['metadata']): string | undefined {
  if (!metadata || !isJsonObject(metadata.construct)) return undefined
  return typeof metadata.construct.pluginId === 'string' ? metadata.construct.pluginId : undefined
}

function unsupportedNodeDiagnostic(nodeType: string, nodeId: string): Diagnostic {
  return {
    code: 'construct.compile.unsupported-' + nodeType,
    severity: 'warning',
    message: 'Construct ' + nodeType + ' "' + nodeId + '" is preserved in the compiled tree but cannot be executed yet.',
    nodeId,
  }
}
