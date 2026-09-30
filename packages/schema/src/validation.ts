import { CURRENT_SCHEMA_VERSION, type Diagnostic, type EventDocument, type JsonValue } from './types.js'

export type ValidationResult =
  | { valid: true; document: EventDocument; diagnostics: Diagnostic[] }
  | { valid: false; diagnostics: Diagnostic[] }

export function validateEventDocument(input: unknown): ValidationResult {
  const diagnostics: Diagnostic[] = []
  const ids = new Set<string>()
  const active = new WeakSet<object>()

  try {
    if (!isRecord(input)) {
      return invalid([{ code: 'schema.invalid-document', severity: 'error', message: 'Expected an event document object.' }])
    }

    if (input.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      issue('schema.unsupported-version', `Expected schema version ${CURRENT_SCHEMA_VERSION}.`, 'schemaVersion')
    }
    validateId(input.id, 'id')
    validateEngine(input.engine)
    validateOptionalJsonObject(input.metadata, 'metadata')
    validateOptionalJsonObject(input.extensions, 'extensions')
    validateStructuralArray(input.sheets, 'sheets', validateSheetNode)
    validateStructuralArray(input.variables, 'variables', validateVariableNode)
    if (input.functions !== undefined) {
      validateStructuralArray(input.functions, 'functions', validateFunctionNode)
    }

    return diagnostics.length === 0
      ? { valid: true, document: input as unknown as EventDocument, diagnostics }
      : invalid(diagnostics)
  } catch {
    issue('schema.invalid-input', 'Document contains data that could not be safely inspected.', '$')
    return invalid(diagnostics)
  }

  function issue(code: string, message: string, path: string, nodeId?: string): void {
    diagnostics.push({
      code,
      severity: 'error',
      message,
      details: { path },
      ...(nodeId === undefined ? {} : { nodeId }),
    })
  }

  function validateEngine(value: unknown): void {
    if (!isRecord(value)) {
      issue('schema.invalid-engine', 'Expected an engine descriptor.', 'engine')
      return
    }
    validateRequiredString(value.id, 'engine.id')
    if (value.compatibilityVersion !== undefined) {
      validateString(value.compatibilityVersion, 'engine.compatibilityVersion')
    }
  }

  function validateStructuralArray(
    value: unknown,
    path: string,
    visit: (entry: unknown, entryPath: string) => void,
  ): void {
    if (!Array.isArray(value)) {
      issue('schema.expected-array', `Expected an array at ${path}.`, path)
      return
    }
    if (enter(value, path)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          issue('schema.invalid-array', 'Sparse arrays are not valid document data.', `${path}[${index}]`)
        } else {
          visit(value[index], `${path}[${index}]`)
        }
      }
      active.delete(value)
    }
  }

  function validateSheet(value: unknown, path: string): void {
    if (!withRecord(value, path, (record) => {
      validateId(record.id, `${path}.id`)
      validateRequiredString(record.name, `${path}.name`)
      validateStructuralArray(record.events, `${path}.events`, validateEventNode)
      if (record.variables !== undefined) {
        validateStructuralArray(record.variables, `${path}.variables`, validateVariableNode)
      }
      if (record.includes !== undefined) {
        validateStructuralArray(record.includes, `${path}.includes`, (include, includePath) => {
          withRecord(include, includePath, (entry) => {
            validateId(entry.id, `${includePath}.id`)
            validateRequiredString(entry.sheetName, `${includePath}.sheetName`)
            if (entry.targetSheetId !== undefined) validateReferenceId(entry.targetSheetId, `${includePath}.targetSheetId`)
            validateSourceLocation(entry.sourceLocation, `${includePath}.sourceLocation`)
            validateOptionalJsonObject(entry.metadata, `${includePath}.metadata`)
          })
        })
      }
      validateSourceLocation(record.sourceLocation, `${path}.sourceLocation`)
      validateOptionalJsonObject(record.metadata, `${path}.metadata`)
    })) return
  }

  function validateSheetNode(value: unknown, path: string): void {
    if (isRecord(value) && isRecoveryType(value.type)) {
      validateRecoveryNode(value, 'sheet', path)
      return
    }
    validateSheet(value, path)
  }

  function validateEventNode(value: unknown, path: string): void {
    if (!isRecord(value)) {
      issue('schema.invalid-node', 'Expected an event or recovery node.', path)
      return
    }
    if (value.type !== 'event') {
      validateRecoveryNode(value, 'event', path)
      return
    }
    withRecord(value, path, (record) => {
      validateId(record.id, `${path}.id`)
      validateSourceLocation(record.sourceLocation, `${path}.sourceLocation`)
      validateOptionalJsonObject(record.metadata, `${path}.metadata`)
      if (record.eventKind !== undefined && record.eventKind !== 'block'
        && record.eventKind !== 'group' && record.eventKind !== 'function' && record.eventKind !== 'comment') {
        issue('schema.invalid-field', 'Expected block, group, function, or comment.', `${path}.eventKind`, optionalNodeId(record.id))
      }
      if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
        issue('schema.invalid-field', 'Expected a boolean.', `${path}.enabled`, optionalNodeId(record.id))
      }
      if (record.initiallyEnabled !== undefined && typeof record.initiallyEnabled !== 'boolean') {
        issue('schema.invalid-field', 'Expected a boolean.', `${path}.initiallyEnabled`, optionalNodeId(record.id))
      }
      if (record.label !== undefined) validateString(record.label, `${path}.label`)
      if (record.functionParameters !== undefined) {
        validateStructuralArray(record.functionParameters, `${path}.functionParameters`, validateFunctionParameter)
      }
      if (record.functionReturnType !== undefined) validateString(record.functionReturnType, `${path}.functionReturnType`)
      if (record.functionCopyPicked !== undefined && typeof record.functionCopyPicked !== 'boolean') {
        issue('schema.invalid-field', 'Expected a boolean.', `${path}.functionCopyPicked`, optionalNodeId(record.id))
      }
      if (record.eventKind === 'comment') validateRequiredString(record.comment, `${path}.comment`)
      else if (record.comment !== undefined) validateString(record.comment, `${path}.comment`)
      if (record.isOrBlock !== undefined && typeof record.isOrBlock !== 'boolean') {
        issue('schema.invalid-field', 'Expected a boolean.', `${path}.isOrBlock`, optionalNodeId(record.id))
      }
      if (record.isElse !== undefined && typeof record.isElse !== 'boolean') {
        issue('schema.invalid-field', 'Expected a boolean.', `${path}.isElse`, optionalNodeId(record.id))
      }
      validateStructuralArray(record.conditions, `${path}.conditions`, validateConditionNode)
      validateStructuralArray(record.actions, `${path}.actions`, validateActionNode)
      if (record.variables !== undefined) {
        validateStructuralArray(record.variables, `${path}.variables`, validateVariableNode)
      }
      if (record.subEvents !== undefined) {
        validateStructuralArray(record.subEvents, `${path}.subEvents`, validateEventNode)
      }
    })
  }

  function validateConditionNode(value: unknown, path: string): void {
    validateOperationNode(value, 'condition', path, (record) => {
      if (record.inverted !== undefined && typeof record.inverted !== 'boolean') {
        issue('schema.invalid-field', 'Expected a boolean.', `${path}.inverted`, optionalNodeId(record.id))
      }
    })
  }

  function validateActionNode(value: unknown, path: string): void {
    if (isRecord(value) && value.type === 'comment') {
      withRecord(value, path, (record) => {
        validateId(record.id, `${path}.id`)
        validateSourceLocation(record.sourceLocation, `${path}.sourceLocation`)
        validateOptionalJsonObject(record.metadata, `${path}.metadata`)
        validateRequiredString(record.text, `${path}.text`)
      })
      return
    }
    validateOperationNode(value, 'action', path)
  }

  function validateOperationNode(
    value: unknown,
    nodeType: 'condition' | 'action',
    path: string,
    extra?: (record: Record<string, unknown>) => void,
  ): void {
    if (!isRecord(value)) {
      issue('schema.invalid-node', `Expected a ${nodeType} or recovery node.`, path)
      return
    }
    if (value.type !== nodeType) {
      validateRecoveryNode(value, nodeType, path)
      return
    }
    withRecord(value, path, (record) => {
      validateId(record.id, `${path}.id`)
      validateSourceLocation(record.sourceLocation, `${path}.sourceLocation`)
      validateRequiredString(record.operation, `${path}.operation`)
      validateStructuralArray(record.parameters, `${path}.parameters`, validateExpression)
      if (record.parameterIds !== undefined) validateStringArray(record.parameterIds, `${path}.parameterIds`)
      validateOptionalJsonObject(record.metadata, `${path}.metadata`)
      extra?.(record)
    })
  }

  function validateRecoveryNode(
    record: Record<string, unknown>,
    expectedNodeType: 'sheet' | 'event' | 'condition' | 'action' | 'variable' | 'function',
    path: string,
  ): void {
    withRecord(record, path, (node) => {
      validateId(node.id, `${path}.id`)
      validateSourceLocation(node.sourceLocation, `${path}.sourceLocation`)
      validateOptionalJsonObject(node.metadata, `${path}.metadata`)
      if (node.nodeType !== expectedNodeType) {
        issue('schema.invalid-recovery-node', `Expected nodeType "${expectedNodeType}".`, `${path}.nodeType`, optionalNodeId(node.id))
      }
      if (node.type === 'unknown' || node.type === 'invalid') {
        if (!isJsonValue(node.raw)) {
          issue('schema.invalid-recovery-node', 'Recovery node raw data must be JSON-compatible.', `${path}.raw`, optionalNodeId(node.id))
        }
      }
      if (node.type === 'invalid') validateDiagnostic(node.diagnostic, `${path}.diagnostic`)
      if (node.type === 'incomplete') {
        if (node.sourceText !== undefined) validateString(node.sourceText, `${path}.sourceText`)
        if (node.expected !== undefined) validateStringArray(node.expected, `${path}.expected`)
      }
      if (node.type !== 'unknown' && node.type !== 'invalid' && node.type !== 'incomplete') {
        issue('schema.invalid-node-type', 'Expected a known or recovery node type.', `${path}.type`, optionalNodeId(node.id))
      }
    })
  }

  function validateExpression(value: unknown, path: string): void {
    if (!isRecord(value)) {
      issue('schema.invalid-expression', 'Expected an expression object.', path)
      return
    }
    withRecord(value, path, (expression) => {
      if (expression.id !== undefined) validateId(expression.id, `${path}.id`)
      validateSourceLocation(expression.sourceLocation, `${path}.sourceLocation`)
      if (expression.sourceText !== undefined) validateString(expression.sourceText, `${path}.sourceText`)
      switch (expression.type) {
        case 'literal':
          if (!isJsonPrimitive(expression.value)) issue('schema.invalid-expression', 'Literal value must be a JSON primitive.', `${path}.value`)
          break
        case 'identifier':
          validateRequiredString(expression.name, `${path}.name`)
          break
        case 'variable':
          validateRequiredString(expression.name, `${path}.name`)
          if (expression.variableId !== undefined) validateReferenceId(expression.variableId, `${path}.variableId`)
          break
        case 'property':
          validateRequiredString(expression.property, `${path}.property`)
          if (expression.computed !== undefined && typeof expression.computed !== 'boolean') {
            issue('schema.invalid-expression', 'Expected a boolean.', `${path}.computed`)
          }
          validateExpression(expression.object, `${path}.object`)
          break
        case 'unary':
          validateRequiredString(expression.operator, `${path}.operator`)
          validateExpression(expression.argument, `${path}.argument`)
          break
        case 'binary':
          validateRequiredString(expression.operator, `${path}.operator`)
          validateExpression(expression.left, `${path}.left`)
          validateExpression(expression.right, `${path}.right`)
          break
        case 'call':
          validateRequiredString(expression.callee, `${path}.callee`)
          validateStructuralArray(expression.arguments, `${path}.arguments`, validateExpression)
          break
        case 'conditional':
          validateExpression(expression.test, `${path}.test`)
          validateExpression(expression.whenTrue, `${path}.whenTrue`)
          validateExpression(expression.whenFalse, `${path}.whenFalse`)
          break
        case 'array':
          validateStructuralArray(expression.elements, `${path}.elements`, validateExpression)
          break
        case 'invalid':
          validateRequiredString(expression.sourceText, `${path}.sourceText`)
          validateRequiredString(expression.message, `${path}.message`)
          break
        case 'incomplete':
        case 'unknown':
          validateString(expression.sourceText, `${path}.sourceText`)
          if (expression.expected !== undefined) validateStringArray(expression.expected, `${path}.expected`)
          if (expression.syntax !== undefined) validateString(expression.syntax, `${path}.syntax`)
          break
        default:
          issue('schema.unknown-expression-type', 'Unknown expression type.', `${path}.type`)
      }
    })
  }

  function validateVariableNode(value: unknown, path: string): void {
    if (isRecord(value) && isRecoveryType(value.type)) {
      validateRecoveryNode(value, 'variable', path)
      return
    }
    validateVariable(value, path)
  }

  function validateVariable(value: unknown, path: string): void {
    withRecord(value, path, (variable) => {
      validateId(variable.id, `${path}.id`)
      validateSourceLocation(variable.sourceLocation, `${path}.sourceLocation`)
      validateOptionalJsonObject(variable.metadata, `${path}.metadata`)
      validateRequiredString(variable.name, `${path}.name`)
      validateRequiredString(variable.dataType, `${path}.dataType`)
      if (variable.scope !== 'global' && variable.scope !== 'local' && variable.scope !== 'instance') {
        issue('schema.invalid-variable-scope', 'Expected global, local, or instance scope.', `${path}.scope`, optionalNodeId(variable.id))
      }
      if (variable.initialValue !== undefined) validateExpression(variable.initialValue, `${path}.initialValue`)
    })
  }

  function validateFunctionNode(value: unknown, path: string): void {
    if (isRecord(value) && isRecoveryType(value.type)) {
      validateRecoveryNode(value, 'function', path)
      return
    }
    validateFunction(value, path)
  }

  function validateFunction(value: unknown, path: string): void {
    withRecord(value, path, (definition) => {
      validateId(definition.id, `${path}.id`)
      validateSourceLocation(definition.sourceLocation, `${path}.sourceLocation`)
      validateOptionalJsonObject(definition.metadata, `${path}.metadata`)
      validateRequiredString(definition.name, `${path}.name`)
      if (definition.returnType !== undefined) validateString(definition.returnType, `${path}.returnType`)
      validateStructuralArray(definition.parameters, `${path}.parameters`, validateFunctionParameter)
      validateStructuralArray(definition.body, `${path}.body`, validateEventNode)
    })
  }

  function validateFunctionParameter(parameter: unknown, path: string): void {
    withRecord(parameter, path, (entry) => {
      validateId(entry.id, `${path}.id`)
      validateSourceLocation(entry.sourceLocation, `${path}.sourceLocation`)
      validateOptionalJsonObject(entry.metadata, `${path}.metadata`)
      validateRequiredString(entry.name, `${path}.name`)
      validateRequiredString(entry.dataType, `${path}.dataType`)
    })
  }

  function validateDiagnostic(value: unknown, path: string): void {
    withRecord(value, path, (diagnostic) => {
      validateRequiredString(diagnostic.code, `${path}.code`)
      validateRequiredString(diagnostic.message, `${path}.message`)
      if (diagnostic.severity !== 'info' && diagnostic.severity !== 'warning' && diagnostic.severity !== 'error') {
        issue('schema.invalid-diagnostic', 'Expected info, warning, or error severity.', `${path}.severity`)
      }
      if (diagnostic.nodeId !== undefined) validateReferenceId(diagnostic.nodeId, `${path}.nodeId`)
      validateSourceLocation(diagnostic.sourceLocation, `${path}.sourceLocation`)
      if (diagnostic.details !== undefined && !isJsonValue(diagnostic.details)) {
        issue('schema.invalid-diagnostic', 'Diagnostic details must be JSON-compatible.', `${path}.details`)
      }
    })
  }

  function validateSourceLocation(value: unknown, path: string): void {
    if (value === undefined) return
    withRecord(value, path, (location) => {
      if (location.sourceId !== undefined) validateString(location.sourceId, `${path}.sourceId`)
      for (const key of ['offsetStart', 'offsetEnd', 'lineStart', 'lineEnd', 'columnStart', 'columnEnd']) {
        const coordinate = location[key]
        if (coordinate !== undefined && (!Number.isInteger(coordinate) || typeof coordinate !== 'number' || coordinate < 0)) {
          issue('schema.invalid-source-location', 'Source coordinates must be non-negative integers.', `${path}.${key}`)
        }
      }
    })
  }

  function validateOptionalJsonObject(value: unknown, path: string): void {
    if (value === undefined) return
    if (!isRecord(value) || !isJsonValue(value)) {
      issue('schema.invalid-json-object', 'Expected a JSON-compatible object.', path)
    }
  }

  function validateStringArray(value: unknown, path: string): void {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      issue('schema.invalid-field', 'Expected an array of strings.', path)
    }
  }

  function validateRequiredString(value: unknown, path: string): void {
    if (typeof value !== 'string' || value.trim() === '') {
      issue('schema.invalid-field', 'Expected a non-empty string.', path)
    }
  }

  function validateString(value: unknown, path: string): void {
    if (typeof value !== 'string') issue('schema.invalid-field', 'Expected a string.', path)
  }

  function validateId(value: unknown, path: string): void {
    if (typeof value !== 'string' || value.trim() === '') {
      issue('schema.invalid-node-id', 'Expected a non-empty node ID.', path)
      return
    }
    if (ids.has(value)) issue('schema.duplicate-node-id', `Node ID "${value}" is used more than once.`, path, value)
    ids.add(value)
  }

  function validateReferenceId(value: unknown, path: string): void {
    if (typeof value !== 'string' || value.trim() === '') {
      issue('schema.invalid-reference-id', 'Expected a non-empty referenced node ID.', path)
    }
  }

  function withRecord(
    value: unknown,
    path: string,
    visit: (record: Record<string, unknown>) => void,
  ): boolean {
    if (!isRecord(value)) {
      issue('schema.expected-object', `Expected an object at ${path}.`, path)
      return false
    }
    if (!enter(value, path)) return false
    visit(value)
    active.delete(value)
    return true
  }

  function enter(value: object, path: string): boolean {
    if (active.has(value)) {
      issue('schema.circular-reference', 'Circular references are not valid in a serialized document.', path)
      return false
    }
    active.add(value)
    return true
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  }

  function isRecoveryType(value: unknown): value is 'unknown' | 'invalid' | 'incomplete' {
    return value === 'unknown' || value === 'invalid' || value === 'incomplete'
  }

  function isJsonValue(value: unknown, ancestors = new WeakSet<object>()): value is JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value !== 'object' || ancestors.has(value)) return false
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) return false
    ancestors.add(value)
    const valid = Array.isArray(value)
      ? arrayIsJsonValue(value, ancestors)
      : Object.values(value).every((entry) => isJsonValue(entry, ancestors))
    ancestors.delete(value)
    return valid
  }

  function arrayIsJsonValue(value: unknown[], ancestors: WeakSet<object>): boolean {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || !isJsonValue(value[index], ancestors)) return false
    }
    return true
  }

  function isJsonPrimitive(value: unknown): boolean {
    return value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
  }

  function optionalNodeId(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined
  }
}

function invalid(diagnostics: Diagnostic[]): ValidationResult {
  return { valid: false, diagnostics }
}
