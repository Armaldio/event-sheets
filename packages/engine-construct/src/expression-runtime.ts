import type { Expression, HostAdapter, JsonValue } from '@project/schema'
import type { ConstructSelectionContext } from './runtime.js'

export type ConstructEvaluationResult =
  | { supported: true; value: JsonValue }
  | { supported: false; reason: string }

export interface ConstructEvaluationContext<TInstance = unknown, TContext = unknown> {
  adapter: HostAdapter<TContext, TInstance>
  selection: ConstructSelectionContext<TInstance>
  variables: ReadonlyMap<string, JsonValue>
  candidate?: { objectType: string; instance: TInstance }
  loopIndices?: readonly { name: string; index: number }[]
  functionParameters?: readonly JsonValue[]
  functionReturnValue?: JsonValue
  callFunction?: (name: string, parameters: readonly JsonValue[]) => ConstructEvaluationResult
}

/** Evaluate the common expression subset used by the initial Construct runtime. */
export function evaluateConstructExpression<TInstance, TContext>(
  expression: Expression,
  context: ConstructEvaluationContext<TInstance, TContext>,
): ConstructEvaluationResult {
  switch (expression.type) {
    case 'literal':
      return { supported: true, value: expression.value }
    case 'identifier':
    case 'variable': {
      if (expression.name.toLowerCase() === 'newline') {
        return { supported: true, value: '\n' }
      }
      if (expression.name.toLowerCase() === 'pi') {
        return { supported: true, value: Math.PI }
      }
      if (expression.name.toLowerCase() === 'loopindex') {
        return { supported: true, value: context.loopIndices?.at(-1)?.index ?? 0 }
      }
      if (context.variables.has(expression.name)) {
        return { supported: true, value: context.variables.get(expression.name) ?? null }
      }
      const hostValue = context.adapter.evaluateExpression?.(expression.name, [], context.adapter.getContext())
      return hostValue === undefined
        ? { supported: false, reason: 'Variable or host expression "' + expression.name + '" is not defined.' }
        : { supported: true, value: hostValue }
    }
    case 'property':
      return evaluateProperty(expression, context)
    case 'unary': {
      const argument = evaluateConstructExpression(expression.argument, context)
      if (!argument.supported) return argument
      if (expression.operator === '!' || expression.operator === 'not') {
        return { supported: true, value: !isConstructTruthy(argument.value) }
      }
      const number = toNumber(argument.value)
      if (number === undefined) return unsupported('Unary ' + expression.operator + ' requires a number.')
      if (expression.operator === '-') return jsonNumber(-number)
      if (expression.operator === '+') return jsonNumber(number)
      return unsupported('Unary operator "' + expression.operator + '" is not supported.')
    }
    case 'binary':
      return evaluateBinary(expression.operator, expression.left, expression.right, context)
    case 'conditional': {
      const test = evaluateConstructExpression(expression.test, context)
      if (!test.supported) return test
      return evaluateConstructExpression(isConstructTruthy(test.value) ? expression.whenTrue : expression.whenFalse, context)
    }
    case 'array': {
      const elements: JsonValue[] = []
      for (const element of expression.elements) {
        const result = evaluateConstructExpression(element, context)
        if (!result.supported) return result
        elements.push(result.value)
      }
      return { supported: true, value: elements }
    }
    case 'call':
      return evaluateCall(expression.callee, expression.arguments, context)
    case 'unknown':
    case 'incomplete':
    case 'invalid':
      return unsupported('Expression source could not be evaluated: ' + expression.sourceText)
  }
}

export function isConstructTruthy(value: JsonValue): boolean {
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
  if (typeof value === 'string') return value.length > 0
  if (typeof value === 'boolean') return value
  return value !== null
}

export function compareConstructValues(left: JsonValue, right: JsonValue, comparison: number): boolean | undefined {
  if (!Number.isInteger(comparison) || comparison < 0 || comparison > 5) return undefined
  const order = compareOrder(left, right)
  switch (comparison) {
    case 0: return sameValue(left, right)
    case 1: return !sameValue(left, right)
    case 2: return order !== undefined && order < 0
    case 3: return order !== undefined && order <= 0
    case 4: return order !== undefined && order > 0
    case 5: return order !== undefined && order >= 0
  }
}

function evaluateProperty<TInstance, TContext>(
  expression: Extract<Expression, { type: 'property' }>,
  context: ConstructEvaluationContext<TInstance, TContext>,
): ConstructEvaluationResult {
  const property = expression.property
  if (expression.object.type === 'identifier' && expression.object.name.toLowerCase() === 'function') {
    if (property.toLowerCase() === 'paramcount') {
      return { supported: true, value: context.functionParameters?.length ?? 0 }
    }
    if (property.toLowerCase() === 'returnvalue') {
      return { supported: true, value: context.functionReturnValue ?? 0 }
    }
  }
  const objectType = expression.object.type === 'identifier'
    ? expression.object.name
    : expression.object.type === 'call'
      ? expression.object.callee
      : undefined
  if (objectType) {
    const candidate = context.candidate
    if (candidate && matchesObjectType(candidate.instance, objectType, context)) {
      return { supported: true, value: context.adapter.getProperty(candidate.instance, property) }
    }
    const selected = context.selection.selectionsByObjectType.get(objectType)
      ?? context.selection.familySelections.get(objectType)
    const instances = selected === undefined
      ? context.adapter.queryObjects(objectType)
      : [...selected]
    const index = expression.object.type === 'call'
      ? evaluateConstructExpression(expression.object.arguments[0] ?? { type: 'literal', value: 0 }, context)
      : undefined
    if (index && !index.supported) return index
    const numericIndex = index?.supported ? toNumber(index.value) ?? 0 : 0
    const resolvedIndex = numericIndex < 0 ? instances.length + Math.trunc(numericIndex) : Math.trunc(numericIndex)
    const instance = instances[resolvedIndex]
    if (instance === undefined) {
      return unsupported('No picked ' + objectType + ' instance is available for .' + property + '.')
    }
    return { supported: true, value: context.adapter.getProperty(instance, property) }
  }

  const object = evaluateConstructExpression(expression.object, context)
  if (!object.supported) return object
  if (Array.isArray(object.value)) {
    const index = Number(property)
    return Number.isInteger(index) && object.value[index] !== undefined
      ? { supported: true, value: object.value[index] }
      : unsupported('Array expression index "' + property + '" is out of range.')
  }
  if (isRecord(object.value) && Object.hasOwn(object.value, property)) {
    return { supported: true, value: object.value[property] ?? null }
  }
  return unsupported('Property "' + property + '" is not available on this expression.')
}

function evaluateBinary<TInstance, TContext>(
  operator: string,
  leftExpression: Expression,
  rightExpression: Expression,
  context: ConstructEvaluationContext<TInstance, TContext>,
): ConstructEvaluationResult {
  const left = evaluateConstructExpression(leftExpression, context)
  if (!left.supported) return left
  if (operator === '&') {
    const right = evaluateConstructExpression(rightExpression, context)
    if (!right.supported) return right
    if (typeof left.value === 'string' || typeof right.value === 'string') {
      return { supported: true, value: String(left.value) + String(right.value) }
    }
    return { supported: true, value: isConstructTruthy(left.value) && isConstructTruthy(right.value) ? 1 : 0 }
  }
  if (operator === '&&') {
    if (!isConstructTruthy(left.value)) return { supported: true, value: 0 }
    const right = evaluateConstructExpression(rightExpression, context)
    if (!right.supported) return right
    return { supported: true, value: isConstructTruthy(right.value) ? 1 : 0 }
  }
  if (operator === '||' || operator === '|') {
    if (isConstructTruthy(left.value)) return { supported: true, value: 1 }
    const right = evaluateConstructExpression(rightExpression, context)
    if (!right.supported) return right
    return { supported: true, value: isConstructTruthy(right.value) ? 1 : 0 }
  }
  const right = evaluateConstructExpression(rightExpression, context)
  if (!right.supported) return right
  if (['==', '!=', '<', '<=', '>', '>='].includes(operator)) {
    const result = compareOperator(left.value, right.value, operator)
    return result === undefined ? unsupported('Values cannot be compared with "' + operator + '".') : { supported: true, value: result ? 1 : 0 }
  }
  const leftNumber = toNumber(left.value)
  const rightNumber = toNumber(right.value)
  if (leftNumber === undefined || rightNumber === undefined) {
    return unsupported('Arithmetic operator "' + operator + '" requires numeric values.')
  }
  switch (operator) {
    case '+': return jsonNumber(leftNumber + rightNumber)
    case '-': return jsonNumber(leftNumber - rightNumber)
    case '*': return jsonNumber(leftNumber * rightNumber)
    case '/': return rightNumber === 0 ? unsupported('Division by zero is not a finite Construct value.') : jsonNumber(leftNumber / rightNumber)
    case '%': return rightNumber === 0 ? unsupported('Modulo by zero is not a finite Construct value.') : jsonNumber(leftNumber % rightNumber)
    case '^': return jsonNumber(leftNumber ** rightNumber)
    default: return unsupported('Binary operator "' + operator + '" is not supported.')
  }
}

function evaluateCall<TInstance, TContext>(
  callee: string,
  arguments_: Expression[],
  context: ConstructEvaluationContext<TInstance, TContext>,
): ConstructEvaluationResult {
  const args: JsonValue[] = []
  for (const argument of arguments_) {
    const result = evaluateConstructExpression(argument, context)
    if (!result.supported) return result
    args.push(result.value)
  }
  const name = callee.toLowerCase()
  const value = args[0]
  const number = value === undefined ? undefined : toNumber(value)
  if (name === 'function.call') {
    if (typeof value !== 'string') return unsupported('Function.Call requires a function name as its first argument.')
    return context.callFunction?.(value, args.slice(1))
      ?? unsupported('Function.Call cannot run outside an active Construct runtime.')
  }
  if (name.startsWith('functions.')) {
    const functionName = callee.slice('Functions.'.length)
    return context.callFunction?.(functionName, args)
      ?? unsupported('Function expressions cannot run outside an active Construct runtime.')
  }
  if (name === 'function.param') {
    if (number === undefined || !Number.isInteger(number) || number < 0) {
      return unsupported('Function.Param requires a non-negative integer index.')
    }
    const parameter = context.functionParameters?.[number]
    return parameter === undefined
      ? unsupported('Function.Param index ' + number + ' is not available in the active function call.')
      : { supported: true, value: parameter }
  }
  if (name === 'function.paramcount') {
    return { supported: true, value: context.functionParameters?.length ?? 0 }
  }
  if (name === 'function.returnvalue') {
    return { supported: true, value: context.functionReturnValue ?? 0 }
  }
  switch (name) {
    case 'stringsub': {
      const template = args[0]
      if (typeof template !== 'string') return unsupported('StringSub requires a string template as its first argument.')
      return {
        supported: true,
        value: template.replace(/\{(\d+)\}/g, (placeholder, indexText: string) => {
          const replacement = args[Number(indexText) + 1]
          return replacement === undefined ? placeholder : String(replacement)
        }),
      }
    }
    case 'loopindex': {
      const loopName = value === undefined ? undefined : String(value)
      const loops = context.loopIndices ?? []
      let loop = loops.at(-1)
      if (loopName !== undefined) {
        loop = undefined
        for (const entry of loops) {
          if (entry.name === loopName) loop = entry
        }
      }
      return { supported: true, value: loop?.index ?? 0 }
    }
    case 'str': return { supported: true, value: value === undefined ? '' : String(value) }
    case 'int': {
      if (value === undefined) return { supported: true, value: 0 }
      const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : number
      return jsonNumber(parsed === undefined || Number.isNaN(parsed) ? 0 : Math.trunc(parsed))
    }
    case 'float': {
      if (value === undefined) return { supported: true, value: 0 }
      const parsed = typeof value === 'string' ? Number.parseFloat(value) : number
      return jsonNumber(parsed === undefined || Number.isNaN(parsed) ? 0 : parsed)
    }
    case 'angle': {
      const values = numericArguments(args)
      if (!values || values.length !== 4) return unsupported('angle() requires four numeric arguments.')
      return jsonNumber(normalizeDegrees(Math.atan2(values[3]! - values[1]!, values[2]! - values[0]!) * 180 / Math.PI))
    }
    case 'anglediff': {
      const values = numericArguments(args)
      if (!values || values.length !== 2) return unsupported('anglediff() requires two numeric arguments.')
      const difference = Math.abs(normalizeDegrees(values[0]!) - normalizeDegrees(values[1]!))
      return jsonNumber(Math.min(difference, 360 - difference))
    }
    case 'anglelerp':
    case 'anglerotate': {
      const values = numericArguments(args)
      if (!values || values.length !== 3) return unsupported(name + '() requires three numeric arguments.')
      const start = normalizeDegrees(values[0]!)
      const end = normalizeDegrees(values[1]!)
      let difference = end - start
      if (difference > 180) difference -= 360
      if (difference < -180) difference += 360
      if (name === 'anglelerp') return jsonNumber(normalizeDegrees(start + difference * values[2]!))
      const step = Math.abs(values[2]!)
      return jsonNumber(normalizeDegrees(Math.abs(difference) <= step ? end : start + Math.sign(difference) * step))
    }
    case 'distance': {
      const values = numericArguments(args)
      if (!values || values.length !== 4) return unsupported('distance() requires four numeric arguments.')
      return jsonNumber(Math.hypot(values[2]! - values[0]!, values[3]! - values[1]!))
    }
    case 'distance3d': {
      const values = numericArguments(args)
      if (!values || values.length !== 6) return unsupported('distance3d() requires six numeric arguments.')
      return jsonNumber(Math.hypot(values[3]! - values[0]!, values[4]! - values[1]!, values[5]! - values[2]!))
    }
    case 'lerp': {
      const values = numericArguments(args)
      if (!values || values.length !== 3) return unsupported('lerp() requires three numeric arguments.')
      return jsonNumber(values[0]! + values[2]! * (values[1]! - values[0]!))
    }
    case 'unlerp': {
      const values = numericArguments(args)
      if (!values || values.length !== 3 || values[1] === values[0]) {
        return unsupported('unlerp() requires three numeric arguments with different endpoints.')
      }
      return jsonNumber((values[2]! - values[0]!) / (values[1]! - values[0]!))
    }
    case 'cosp':
    case 'qarp': {
      const values = numericArguments(args)
      if (!values || values.length !== (name === 'cosp' ? 3 : 4)) {
        return unsupported(name + '() received an invalid number of numeric arguments.')
      }
      const [a, b, c] = values
      if (name === 'cosp') {
        return jsonNumber((a! + b! + (a! - b!) * Math.cos(c! * Math.PI)) / 2)
      }
      return jsonNumber(qarpNumber(a!, b!, c!, values[3]!))
    }
    case 'cubic': {
      const values = numericArguments(args)
      if (!values || values.length !== 5) return unsupported('cubic() requires five numeric arguments.')
      const [a, b, c, d, x] = values
      const first = qarpNumber(a!, b!, c!, x!)
      const second = qarpNumber(b!, c!, d!, x!)
      return jsonNumber(lerpNumber(first, second, x!))
    }
    case 'sin':
    case 'cos':
    case 'tan': {
      if (number === undefined) return unsupported(name + '() requires a numeric argument.')
      return jsonNumber(Math[name](number * Math.PI / 180))
    }
    case 'asin':
    case 'acos':
    case 'atan': {
      if (number === undefined) return unsupported(name + '() requires a numeric argument.')
      return jsonNumber(Math[name](number) * 180 / Math.PI)
    }
    case 'roundtodp': {
      const values = numericArguments(args)
      if (!values || values.length !== 2) return unsupported('roundToDp() requires a numeric value and decimal-place count.')
      const factor = 10 ** values[1]!
      return jsonNumber(Math.round(values[0]! * factor) / factor)
    }
    case 'sign': return number === undefined ? unsupported('sign() requires a numeric argument.') : jsonNumber(Math.sign(number))
    case 'exp': return number === undefined ? unsupported('exp() requires a numeric argument.') : jsonNumber(Math.exp(number))
    case 'ln': return number === undefined || number <= 0 ? unsupported('ln() requires a positive numeric argument.') : jsonNumber(Math.log(number))
    case 'log10': return number === undefined || number <= 0 ? unsupported('log10() requires a positive numeric argument.') : jsonNumber(Math.log10(number))
    case 'getbit':
    case 'togglebit':
    case 'setbit': {
      const values = numericArguments(args)
      const expectedCount = name === 'setbit' ? 3 : 2
      if (!values || values.length !== expectedCount) return unsupported(name + '() received invalid numeric arguments.')
      const bit = Math.trunc(values[1]!)
      if (!Number.isInteger(values[1]) || bit < 0 || bit > 31) return unsupported(name + '() requires a bit index from 0 to 31.')
      const input = Math.trunc(values[0]!) | 0
      if (name === 'getbit') return { supported: true, value: (input >>> bit) & 1 }
      if (name === 'togglebit') return { supported: true, value: input ^ (1 << bit) }
      if (!Number.isInteger(values[2]) || (values[2] !== 0 && values[2] !== 1)) {
        return unsupported('setbit() requires the bit value to be zero or one.')
      }
      const mask = 1 << bit
      return { supported: true, value: values[2] === 1 ? input | mask : input & ~mask }
    }
    case 'clamp': {
      const values = numericArguments(args)
      if (!values || values.length !== 3) return unsupported('clamp() requires three numeric arguments.')
      return jsonNumber(Math.min(Math.max(values[0]!, values[1]!), values[2]!))
    }
    case 'len': return { supported: true, value: String(value ?? '').length }
    case 'find':
    case 'findcase': {
      if (args.length !== 2) return unsupported(name + '() requires two text arguments.')
      const source = String(args[0] ?? '')
      const search = String(args[1] ?? '')
      return { supported: true, value: name === 'find'
        ? source.toLowerCase().indexOf(search.toLowerCase())
        : source.indexOf(search) }
    }
    case 'left':
    case 'right': {
      const countValue = args.length === 2 ? toNumber(args[1]!) : undefined
      if (countValue === undefined) return unsupported(name + '() requires text and a numeric count.')
      const source = String(value ?? '')
      const count = Math.max(0, Math.trunc(countValue))
      return { supported: true, value: name === 'left' ? source.slice(0, count) : count === 0 ? '' : source.slice(-count) }
    }
    case 'mid': {
      const values = numericArguments(args.slice(1))
      if (typeof value !== 'string' || !values || values.length !== 2) {
        return unsupported('mid() requires text, a numeric index, and a numeric count.')
      }
      const start = Math.max(0, Math.trunc(values[0]!))
      const count = Math.trunc(values[1]!)
      return { supported: true, value: sourceSlice(value, start, count) }
    }
    case 'lowercase':
    case 'uppercase':
    case 'trim': {
      const source = String(value ?? '')
      return { supported: true, value: name === 'lowercase'
        ? source.toLowerCase()
        : name === 'uppercase' ? source.toUpperCase() : source.trim() }
    }
    case 'tokenat': {
      const index = args.length === 3 ? toNumber(args[1]!) : undefined
      if (index === undefined) return unsupported('tokenat() requires text, a numeric index, and a separator.')
      const tokens = String(value ?? '').split(String(args[2] ?? ''))
      return { supported: true, value: tokens[Math.trunc(index)] ?? '' }
    }
    case 'tokencount': {
      if (args.length !== 2) return unsupported('tokencount() requires text and a separator.')
      return { supported: true, value: String(value ?? '').split(String(args[1] ?? '')).length }
    }
    case 'replace': {
      if (args.length !== 3) return unsupported('replace() requires source, search text, and replacement text.')
      const source = String(value ?? '')
      const search = String(args[1] ?? '')
      return { supported: true, value: search.length === 0
        ? source
        : source.split(search).join(String(args[2] ?? '')) }
    }
    case 'chooseindex': {
      if (args.length < 2) return unsupported('chooseindex() requires an index and at least one value.')
      const index = value === undefined ? undefined : toNumber(value)
      if (index === undefined) return unsupported('chooseindex() requires a numeric index.')
      const choices = args.slice(1)
      const choiceIndex = Math.min(Math.max(Math.trunc(index), 0), choices.length - 1)
      return { supported: true, value: choices[choiceIndex]! }
    }
    case 'choose': {
      if (args.length < 2) return unsupported('choose() requires at least two values.')
      return { supported: true, value: args[Math.floor(Math.random() * args.length)]! }
    }
    case 'random': {
      const values = numericArguments(args)
      if (!values || (values.length !== 1 && values.length !== 2)) {
        return unsupported('random() requires one or two numeric arguments.')
      }
      const minimum = values.length === 1 ? 0 : values[0]!
      const maximum = values.length === 1 ? values[0]! : values[1]!
      return jsonNumber(minimum + Math.random() * (maximum - minimum))
    }
    case 'zeropad': {
      const digits = args.length === 2 ? toNumber(args[1]!) : undefined
      if (number === undefined || digits === undefined) return unsupported('zeropad() requires a number and a numeric digit count.')
      const numericText = String(number)
      const width = Math.max(0, Math.trunc(digits))
      const negative = numericText.startsWith('-')
      const unsignedText = negative ? numericText.slice(1) : numericText
      const padded = unsignedText.padStart(Math.max(0, width - Number(negative)), '0')
      return { supported: true, value: (negative ? '-' : '') + padded }
    }
    case 'abs': return number === undefined ? unsupported('abs() requires a numeric argument.') : jsonNumber(Math.abs(number))
    case 'ceil': return number === undefined ? unsupported('ceil() requires a numeric argument.') : jsonNumber(Math.ceil(number))
    case 'floor': return number === undefined ? unsupported('floor() requires a numeric argument.') : jsonNumber(Math.floor(number))
    case 'round': return number === undefined ? unsupported('round() requires a numeric argument.') : jsonNumber(Math.round(number))
    case 'sqrt': return number === undefined || number < 0 ? unsupported('sqrt() requires a non-negative numeric argument.') : jsonNumber(Math.sqrt(number))
    case 'min':
    case 'max': {
      const numbers = numericArguments(args)
      if (!numbers || numbers.length < 2) return unsupported(name + '() requires at least two numeric arguments.')
      return jsonNumber(name === 'min' ? Math.min(...numbers) : Math.max(...numbers))
    }
    default: {
      const result = context.adapter.evaluateExpression?.(callee, args, context.adapter.getContext())
      return result === undefined
        ? unsupported('Function "' + callee + '" is not supported by the Construct expression evaluator.')
        : { supported: true, value: result }
    }
  }
}

function compareOperator(left: JsonValue, right: JsonValue, operator: string): boolean | undefined {
  if (operator === '==' || operator === '!=') {
    const same = sameValue(left, right)
    return operator === '==' ? same : !same
  }
  const order = compareOrder(left, right)
  if (order === undefined) return undefined
  switch (operator) {
    case '<': return order < 0
    case '<=': return order <= 0
    case '>': return order > 0
    case '>=': return order >= 0
    default: return undefined
  }
}

function compareOrder(left: JsonValue, right: JsonValue): number | undefined {
  if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : left > right ? 1 : 0
  const leftNumber = toNumber(left)
  const rightNumber = toNumber(right)
  if (leftNumber === undefined || rightNumber === undefined) return undefined
  return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0
}

function sameValue(left: JsonValue, right: JsonValue): boolean {
  if (typeof left !== typeof right) return false
  if (typeof left === 'object' || typeof right === 'object') return JSON.stringify(left) === JSON.stringify(right)
  return left === right
}

function toNumber(value: JsonValue): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value)
    return Number.isFinite(number) ? number : undefined
  }
  if (value === null) return 0
  return undefined
}

function numericArguments(arguments_: readonly JsonValue[]): number[] | undefined {
  const numbers = arguments_.map(toNumber)
  return numbers.some((number) => number === undefined) ? undefined : numbers as number[]
}

function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

function lerpNumber(start: number, end: number, amount: number): number {
  return start + amount * (end - start)
}

function qarpNumber(a: number, b: number, c: number, amount: number): number {
  return lerpNumber(lerpNumber(a, b, amount), lerpNumber(b, c, amount), amount)
}

function sourceSlice(source: string, start: number, count: number): string {
  return count === -1 ? source.slice(start) : source.slice(start, start + Math.max(0, count))
}

function jsonNumber(value: number): ConstructEvaluationResult {
  return Number.isFinite(value)
    ? { supported: true, value }
    : unsupported('Expression result is not a finite number.')
}

function unsupported(reason: string): ConstructEvaluationResult {
  return { supported: false, reason }
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function matchesObjectType<TInstance, TContext>(
  instance: TInstance,
  objectType: string,
  context: ConstructEvaluationContext<TInstance, TContext>,
): boolean {
  return objectType.toLowerCase() === 'self'
    || context.adapter.getObjectType(instance).toLowerCase() === objectType.toLowerCase()
}
