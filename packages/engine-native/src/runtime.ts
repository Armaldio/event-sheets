import type {
  ActionNode,
  ConditionNode,
  Diagnostic,
  EventDocument,
  EventNode,
  JsonObject,
  JsonValue,
  VariableDeclaration,
  VariableNode,
} from '@project/schema'
import { evaluateNativeExpression } from './expression.js'
import type { NativeRegistry } from './registry.js'
import { createNativeRegistry } from './registry.js'
import { validateNativeDocument } from './validation.js'

export type NativeTraceKind = 'event' | 'condition' | 'action'
export type NativeTraceStatus = 'passed' | 'failed' | 'executed' | 'skipped' | 'unsupported'

export interface NativeTraceEntry {
  sequence: number
  kind: NativeTraceKind
  nodeId: string
  status: NativeTraceStatus
  parentNodeId?: string
  details?: JsonObject
}

export interface NativeExecutionTrace {
  documentId: string
  sheetId: string
  status: 'complete' | 'partial'
  entries: NativeTraceEntry[]
  variables: Record<string, JsonValue>
  diagnostics: Diagnostic[]
}

/** Execute one sheet with a new, isolated variable store for every call. */
export function runNativeDocument(
  document: EventDocument,
  sheetId: string,
  registry: NativeRegistry = createNativeRegistry(),
): NativeExecutionTrace {
  const diagnostics = validateNativeDocument(document, registry).diagnostics
  const variables = new Map<string, JsonValue>()
  const entries: NativeTraceEntry[] = []
  const sheet = document.sheets.find((candidate) => candidate.id === sheetId)
  let sequence = 0

  const addEntry = (
    kind: NativeTraceKind,
    nodeId: string,
    status: NativeTraceStatus,
    parentNodeId?: string,
    details?: JsonObject,
  ): void => {
    entries.push({
      sequence: sequence++,
      kind,
      nodeId,
      status,
      ...(parentNodeId === undefined ? {} : { parentNodeId }),
      ...(details === undefined ? {} : { details }),
    })
  }

  if (!sheet) {
    diagnostics.push(runtimeDiagnostic(
      'native.runtime.missing-sheet',
      'Document "' + document.id + '" has no sheet "' + sheetId + '".',
      sheetId,
    ))
  } else if ('type' in sheet) {
    diagnostics.push(runtimeDiagnostic(
      'native.runtime.recovery-sheet',
      'Native cannot execute a recovery event sheet.',
      sheet.id,
    ))
  } else if (document.engine.id !== 'native') {
    // Validation already reports the wrong engine; do not execute it here.
  } else {
    initializeVariables(document.variables, diagnostics)
    initializeVariables(sheet.variables ?? [], diagnostics)
    runSiblings(sheet.events)
  }

  return {
    documentId: document.id,
    sheetId,
    status: diagnostics.some(({ severity }) => severity !== 'info') ? 'partial' : 'complete',
    entries,
    variables: Object.fromEntries(variables),
    diagnostics,
  }

  function initializeVariables(declarations: readonly VariableNode[], output: Diagnostic[]): void {
    for (const variable of declarations) {
      if ('type' in variable) {
        output.push(runtimeDiagnostic(
          'native.runtime.recovery-variable',
          'Native cannot initialize a recovery variable.',
          variable.id,
        ))
        continue
      }
      initializeVariable(variable, output)
    }
  }

  function initializeVariable(variable: VariableDeclaration, output: Diagnostic[]): void {
    if (variable.scope === 'instance') return
    if (variable.initialValue === undefined) {
      variables.set(variable.name, defaultValue(variable.dataType))
      return
    }
    const initial = evaluateNativeExpression(variable.initialValue, variables)
    if (initial.supported) variables.set(variable.name, initial.value)
    else {
      output.push(runtimeDiagnostic(
        'native.runtime.invalid-variable-initial-value',
        initial.reason,
        variable.id,
      ))
      variables.set(variable.name, defaultValue(variable.dataType))
    }
  }

  function runSiblings(siblings: readonly EventNode[], parentNodeId?: string): void {
    for (const event of siblings) runEvent(event, parentNodeId)
  }

  function runEvent(event: EventNode, parentNodeId?: string): void {
    if (event.type !== 'event') {
      addEntry('event', event.id, 'unsupported', parentNodeId)
      return
    }
    if (event.enabled === false) {
      addEntry('event', event.id, 'skipped', parentNodeId, { reason: 'disabled' })
      skipContents(event)
      return
    }
    if (event.isElse === true) {
      addEntry('event', event.id, 'unsupported', parentNodeId)
      diagnostics.push(runtimeDiagnostic(
        'native.runtime.unsupported-else',
        'Native has no implicit Else behavior; express the branch with explicit conditions.',
        event.id,
      ))
      skipContents(event)
      return
    }

    const entryIndex = entries.length
    addEntry('event', event.id, 'failed', parentNodeId)
    let eventPassed = event.isOrBlock === true ? false : true
    let eventUnsupported = false

    for (const [index, condition] of event.conditions.entries()) {
      if (event.isOrBlock === true && eventPassed) {
        skipCondition(condition, event.id)
        continue
      }
      if (event.isOrBlock !== true && !eventPassed) {
        skipCondition(condition, event.id)
        continue
      }
      const result = runCondition(condition, event.id)
      if (result === 'unsupported') {
        eventUnsupported = true
        eventPassed = false
        for (const remaining of event.conditions.slice(index + 1)) skipCondition(remaining, event.id)
        break
      }
      if (event.isOrBlock === true) eventPassed ||= result === 'passed'
      else eventPassed = result === 'passed'
    }

    if (event.isOrBlock === true && event.conditions.length === 0) {
      diagnostics.push(runtimeDiagnostic('native.runtime.empty-or-block', 'A Native OR block requires at least one condition.', event.id))
      eventUnsupported = true
    }
    if (!eventPassed) {
      const eventEntry = entries[entryIndex]
      if (eventEntry) eventEntry.status = eventUnsupported ? 'unsupported' : 'failed'
      skipActionsAndChildren(event)
      return
    }

    const eventEntry = entries[entryIndex]
    if (eventEntry) eventEntry.status = 'passed'
    for (const action of event.actions) runAction(action, event.id)
    runSiblings(event.subEvents ?? [], event.id)
  }

  function runCondition(condition: ConditionNode, parentNodeId: string): 'passed' | 'failed' | 'unsupported' {
    if (condition.type !== 'condition') {
      addEntry('condition', condition.id, 'unsupported', parentNodeId)
      diagnostics.push(runtimeDiagnostic('native.runtime.recovery-condition', 'Native cannot execute a recovery condition.', condition.id))
      return 'unsupported'
    }
    const definition = registry.getCondition(condition.operation)
    if (!definition) {
      addEntry('condition', condition.id, 'unsupported', parentNodeId, { operation: condition.operation })
      diagnostics.push(runtimeDiagnostic(
        'native.runtime.unknown-condition',
        'No Native condition handler is registered for "' + condition.operation + '".',
        condition.id,
      ))
      return 'unsupported'
    }
    if (condition.parameters.length !== definition.parameterCount) {
      addEntry('condition', condition.id, 'unsupported', parentNodeId, { operation: condition.operation })
      diagnostics.push(runtimeDiagnostic(
        'native.runtime.condition-parameter-count',
        'Native condition "' + condition.operation + '" has the wrong number of parameters.',
        condition.id,
      ))
      return 'unsupported'
    }
    try {
      const passed = definition.evaluate(condition.parameters, {
        variables,
        evaluateExpression: (expression) => evaluateNativeExpression(expression, variables),
      })
      const result = condition.inverted === true ? !passed : passed
      addEntry('condition', condition.id, result ? 'passed' : 'failed', parentNodeId, {
        operation: condition.operation,
        result,
      })
      return result ? 'passed' : 'failed'
    } catch (error) {
      addEntry('condition', condition.id, 'unsupported', parentNodeId, { operation: condition.operation })
      diagnostics.push(runtimeDiagnostic(
        'native.runtime.condition-failed',
        error instanceof Error ? error.message : 'Native condition handler failed.',
        condition.id,
      ))
      return 'unsupported'
    }
  }

  function runAction(action: ActionNode, parentNodeId: string): void {
    if (action.type !== 'action') {
      addEntry('action', action.id, 'unsupported', parentNodeId)
      diagnostics.push(runtimeDiagnostic('native.runtime.recovery-action', 'Native cannot execute a recovery action.', action.id))
      return
    }
    const definition = registry.getAction(action.operation)
    if (!definition) {
      addEntry('action', action.id, 'unsupported', parentNodeId, { operation: action.operation })
      diagnostics.push(runtimeDiagnostic(
        'native.runtime.unknown-action',
        'No Native action handler is registered for "' + action.operation + '".',
        action.id,
      ))
      return
    }
    if (action.parameters.length !== definition.parameterCount) {
      addEntry('action', action.id, 'unsupported', parentNodeId, { operation: action.operation })
      diagnostics.push(runtimeDiagnostic(
        'native.runtime.action-parameter-count',
        'Native action "' + action.operation + '" has the wrong number of parameters.',
        action.id,
      ))
      return
    }
    try {
      definition.execute(action.parameters, {
        variables,
        evaluateExpression: (expression) => evaluateNativeExpression(expression, variables),
      })
      addEntry('action', action.id, 'executed', parentNodeId, { operation: action.operation })
    } catch (error) {
      addEntry('action', action.id, 'unsupported', parentNodeId, { operation: action.operation })
      diagnostics.push(runtimeDiagnostic(
        'native.runtime.action-failed',
        error instanceof Error ? error.message : 'Native action handler failed.',
        action.id,
      ))
    }
  }

  function skipCondition(condition: ConditionNode, parentNodeId: string): void {
    addEntry('condition', condition.id, 'skipped', parentNodeId)
  }

  function skipActionsAndChildren(event: Extract<EventNode, { type: 'event' }>): void {
    for (const action of event.actions) addEntry('action', action.id, 'skipped', event.id)
    for (const child of event.subEvents ?? []) skipEvent(child, event.id)
  }

  function skipEvent(event: EventNode, parentNodeId: string): void {
    addEntry('event', event.id, 'skipped', parentNodeId)
    if (event.type !== 'event') return
    for (const condition of event.conditions) skipCondition(condition, event.id)
    for (const action of event.actions) addEntry('action', action.id, 'skipped', event.id)
    for (const child of event.subEvents ?? []) skipEvent(child, event.id)
  }

  function skipContents(event: Extract<EventNode, { type: 'event' }>): void {
    for (const condition of event.conditions) skipCondition(condition, event.id)
    for (const action of event.actions) addEntry('action', action.id, 'skipped', event.id)
    for (const child of event.subEvents ?? []) skipEvent(child, event.id)
  }
}

function defaultValue(dataType: string): JsonValue {
  const type = dataType.toLowerCase()
  if (type === 'string' || type === 'text') return ''
  if (type === 'boolean' || type === 'bool') return false
  if (type === 'number' || type === 'integer' || type === 'float') return 0
  return null
}

function runtimeDiagnostic(code: string, message: string, nodeId?: string): Diagnostic {
  return {
    code,
    severity: code === 'native.runtime.missing-sheet' ? 'error' : 'warning',
    message,
    ...(nodeId === undefined ? {} : { nodeId }),
  }
}
