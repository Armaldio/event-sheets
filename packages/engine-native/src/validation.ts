import {
  validateEventDocument,
  type ActionNode,
  type ConditionNode,
  type Diagnostic,
  type EventDocument,
  type EventNode,
  type EventSheetNode,
  type VariableNode,
} from '@project/schema'
import type { NativeRegistry } from './registry.js'
import { createNativeRegistry } from './registry.js'

export interface NativeValidationResult {
  valid: boolean
  diagnostics: Diagnostic[]
}

/** Validate the schema and operation set without applying runtime side effects. */
export function validateNativeDocument(
  document: EventDocument,
  registry: NativeRegistry = createNativeRegistry(),
): NativeValidationResult {
  const schemaResult = validateEventDocument(document)
  const diagnostics = [...schemaResult.diagnostics]
  if (document.engine.id !== 'native') {
    diagnostics.push(validationDiagnostic(
      'native.validation.wrong-engine',
      'The Native engine can only validate documents whose engine ID is "native".',
    ))
  }
  if (document.functions && document.functions.length > 0) {
    diagnostics.push(validationDiagnostic(
      'native.validation.unsupported-functions',
      'Native function definitions are not executed by the initial runtime.',
      undefined,
      'warning',
    ))
  }
  for (const variable of document.variables) validateVariable(variable)
  for (const sheet of document.sheets) validateSheet(sheet)
  const valid = !diagnostics.some(({ severity }) => severity === 'error')
  return { valid, diagnostics }

  function validateSheet(sheet: EventSheetNode): void {
    if ('type' in sheet) {
      diagnostics.push(validationDiagnostic(
        'native.validation.recovery-sheet',
        'Native cannot execute a recovery event sheet.',
        sheet.id,
        'warning',
      ))
      return
    }
    for (const variable of sheet.variables ?? []) validateVariable(variable)
    for (const event of sheet.events) validateEvent(event)
  }

  function validateVariable(variable: VariableNode): void {
    if ('type' in variable) return
    if (variable.scope === 'instance') {
      diagnostics.push(validationDiagnostic(
        'native.validation.unsupported-instance-variable',
        'Native instance-scoped variables require object state, which this runtime does not provide.',
        variable.id,
        'warning',
      ))
    }
  }

  function validateEvent(event: EventNode): void {
    if (event.type !== 'event') {
      diagnostics.push(validationDiagnostic(
        'native.validation.recovery-event',
        'Native cannot execute a recovery event.',
        event.id,
        'warning',
      ))
      return
    }
    if (event.isElse === true) {
      diagnostics.push(validationDiagnostic(
        'native.validation.unsupported-else',
        'Native has no implicit Else behavior; express the branch with explicit conditions.',
        event.id,
        'warning',
      ))
    }
    if (event.isOrBlock === true && event.conditions.length === 0) {
      diagnostics.push(validationDiagnostic(
        'native.validation.empty-or-block',
        'A Native OR block requires at least one condition.',
        event.id,
      ))
    }
    for (const condition of event.conditions) validateCondition(condition)
    for (const action of event.actions) validateAction(action)
    for (const child of event.subEvents ?? []) validateEvent(child)
  }

  function validateCondition(condition: ConditionNode): void {
    if (condition.type !== 'condition') {
      diagnostics.push(validationDiagnostic(
        'native.validation.recovery-condition',
        'Native cannot execute a recovery condition.',
        condition.id,
        'warning',
      ))
      return
    }
    const definition = registry.getCondition(condition.operation)
    if (!definition) {
      diagnostics.push(validationDiagnostic(
        'native.validation.unknown-condition',
        'No Native condition handler is registered for "' + condition.operation + '".',
        condition.id,
      ))
    } else if (condition.parameters.length !== definition.parameterCount) {
      diagnostics.push(validationDiagnostic(
        'native.validation.condition-parameter-count',
        'Native condition "' + condition.operation + '" expects ' + definition.parameterCount + ' parameters.',
        condition.id,
      ))
    }
  }

  function validateAction(action: ActionNode): void {
    if (action.type !== 'action') {
      diagnostics.push(validationDiagnostic(
        'native.validation.recovery-action',
        'Native cannot execute a recovery action.',
        action.id,
        'warning',
      ))
      return
    }
    const definition = registry.getAction(action.operation)
    if (!definition) {
      diagnostics.push(validationDiagnostic(
        'native.validation.unknown-action',
        'No Native action handler is registered for "' + action.operation + '".',
        action.id,
      ))
    } else if (action.parameters.length !== definition.parameterCount) {
      diagnostics.push(validationDiagnostic(
        'native.validation.action-parameter-count',
        'Native action "' + action.operation + '" expects ' + definition.parameterCount + ' parameters.',
        action.id,
      ))
    }
  }
}

function validationDiagnostic(
  code: string,
  message: string,
  nodeId?: string,
  severity: Diagnostic['severity'] = 'error',
): Diagnostic {
  return {
    code,
    severity,
    message,
    ...(nodeId === undefined ? {} : { nodeId }),
  }
}
