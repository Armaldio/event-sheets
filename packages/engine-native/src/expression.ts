import type { Expression, JsonValue } from '@project/schema'

export type NativeExpressionResult =
  | { supported: true; value: JsonValue }
  | { supported: false; reason: string }

/** Evaluate Native expressions with strict, engine-owned value semantics. */
export function evaluateNativeExpression(
  expression: Expression,
  variables: ReadonlyMap<string, JsonValue>,
): NativeExpressionResult {
  switch (expression.type) {
    case 'literal':
      return { supported: true, value: expression.value }
    case 'identifier':
    case 'variable':
      return variables.has(expression.name)
        ? { supported: true, value: variables.get(expression.name) ?? null }
        : unsupported('Variable "' + expression.name + '" is not defined.')
    case 'property': {
      const object = evaluateNativeExpression(expression.object, variables)
      if (!object.supported) return object
      return isRecord(object.value) && Object.hasOwn(object.value, expression.property)
        ? { supported: true, value: object.value[expression.property] ?? null }
        : unsupported('Property "' + expression.property + '" is not available.')
    }
    case 'unary': {
      const argument = evaluateNativeExpression(expression.argument, variables)
      if (!argument.supported) return argument
      if (expression.operator === '!') return { supported: true, value: !truthy(argument.value) }
      if (expression.operator === '+' || expression.operator === '-') {
        if (typeof argument.value !== 'number') return unsupported('Unary ' + expression.operator + ' requires a number.')
        return finiteNumber(expression.operator === '-' ? -argument.value : argument.value)
      }
      return unsupported('Unary operator "' + expression.operator + '" is not supported.')
    }
    case 'binary':
      return evaluateBinary(expression.operator, expression.left, expression.right, variables)
    case 'conditional': {
      const test = evaluateNativeExpression(expression.test, variables)
      if (!test.supported) return test
      return evaluateNativeExpression(truthy(test.value) ? expression.whenTrue : expression.whenFalse, variables)
    }
    case 'array': {
      const values: JsonValue[] = []
      for (const element of expression.elements) {
        const value = evaluateNativeExpression(element, variables)
        if (!value.supported) return value
        values.push(value.value)
      }
      return { supported: true, value: values }
    }
    case 'call':
      return unsupported('Native does not register expression function "' + expression.callee + '".')
    case 'invalid':
    case 'incomplete':
    case 'unknown':
      return unsupported('Expression source could not be evaluated: ' + expression.sourceText)
  }
}

export function compareNativeValues(left: JsonValue, operator: string, right: JsonValue): boolean | undefined {
  if (operator === '==' || operator === '!=') {
    const equal = sameValue(left, right)
    return operator === '==' ? equal : !equal
  }
  let order: number | undefined
  if (typeof left === 'number' && typeof right === 'number') {
    order = left < right ? -1 : left > right ? 1 : 0
  } else if (typeof left === 'string' && typeof right === 'string') {
    order = left < right ? -1 : left > right ? 1 : 0
  } else {
    return undefined
  }
  switch (operator) {
    case '<': return order < 0
    case '<=': return order <= 0
    case '>': return order > 0
    case '>=': return order >= 0
    default: return undefined
  }
}

function evaluateBinary(
  operator: string,
  leftExpression: Expression,
  rightExpression: Expression,
  variables: ReadonlyMap<string, JsonValue>,
): NativeExpressionResult {
  const left = evaluateNativeExpression(leftExpression, variables)
  if (!left.supported) return left
  if (operator === '&&' && !truthy(left.value)) return { supported: true, value: false }
  if (operator === '||' && truthy(left.value)) return { supported: true, value: true }
  const right = evaluateNativeExpression(rightExpression, variables)
  if (!right.supported) return right
  if (operator === '&&' || operator === '||') return { supported: true, value: truthy(right.value) }
  if (['==', '!=', '<', '<=', '>', '>='].includes(operator)) {
    const compared = compareNativeValues(left.value, operator, right.value)
    return compared === undefined
      ? unsupported('Values cannot be compared with "' + operator + '".')
      : { supported: true, value: compared }
  }
  if (operator === '+' && typeof left.value === 'string' && typeof right.value === 'string') {
    return { supported: true, value: left.value + right.value }
  }
  if (typeof left.value !== 'number' || typeof right.value !== 'number') {
    return unsupported('Operator "' + operator + '" requires numbers, or two strings for +.')
  }
  switch (operator) {
    case '+': return finiteNumber(left.value + right.value)
    case '-': return finiteNumber(left.value - right.value)
    case '*': return finiteNumber(left.value * right.value)
    case '/': return right.value === 0 ? unsupported('Division by zero is not supported.') : finiteNumber(left.value / right.value)
    case '%': return right.value === 0 ? unsupported('Modulo by zero is not supported.') : finiteNumber(left.value % right.value)
    default: return unsupported('Binary operator "' + operator + '" is not supported.')
  }
}

function truthy(value: JsonValue): boolean {
  if (value === null || value === false || value === 0 || value === '') return false
  return true
}

function sameValue(left: JsonValue, right: JsonValue): boolean {
  if (typeof left !== typeof right) return false
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    return JSON.stringify(left) === JSON.stringify(right)
  }
  return left === right
}

function finiteNumber(value: number): NativeExpressionResult {
  return Number.isFinite(value)
    ? { supported: true, value }
    : unsupported('Expression result must be finite.')
}

function unsupported(reason: string): NativeExpressionResult {
  return { supported: false, reason }
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
