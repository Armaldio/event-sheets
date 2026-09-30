import type { Expression, JsonValue } from '@project/schema'
import { compareNativeValues, type NativeExpressionResult } from './expression.js'

export interface NativeConditionContext {
  readonly variables: ReadonlyMap<string, JsonValue>
  evaluateExpression(expression: Expression): NativeExpressionResult
}

export interface NativeActionContext {
  readonly variables: Map<string, JsonValue>
  evaluateExpression(expression: Expression): NativeExpressionResult
}

export interface NativeConditionDefinition {
  readonly operation: string
  readonly parameterCount: number
  evaluate(parameters: readonly Expression[], context: NativeConditionContext): boolean
}

export interface NativeActionDefinition {
  readonly operation: string
  readonly parameterCount: number
  execute(parameters: readonly Expression[], context: NativeActionContext): void
}

export class NativeRegistry {
  private readonly conditions = new Map<string, NativeConditionDefinition>()
  private readonly actions = new Map<string, NativeActionDefinition>()

  registerCondition(definition: NativeConditionDefinition): void {
    validateDefinition(definition.operation, definition.parameterCount)
    if (this.conditions.has(definition.operation)) {
      throw new TypeError('Native condition "' + definition.operation + '" is already registered.')
    }
    this.conditions.set(definition.operation, { ...definition })
  }

  registerAction(definition: NativeActionDefinition): void {
    validateDefinition(definition.operation, definition.parameterCount)
    if (this.actions.has(definition.operation)) {
      throw new TypeError('Native action "' + definition.operation + '" is already registered.')
    }
    this.actions.set(definition.operation, { ...definition })
  }

  getCondition(operation: string): NativeConditionDefinition | undefined {
    return this.conditions.get(operation)
  }

  getAction(operation: string): NativeActionDefinition | undefined {
    return this.actions.get(operation)
  }

  listConditions(): NativeConditionDefinition[] {
    return [...this.conditions.values()]
  }

  listActions(): NativeActionDefinition[] {
    return [...this.actions.values()]
  }
}

export function createNativeRegistry(): NativeRegistry {
  const registry = new NativeRegistry()
  registry.registerCondition({
    operation: 'Native.always',
    parameterCount: 0,
    evaluate: () => true,
  })
  registry.registerCondition({
    operation: 'Native.compare',
    parameterCount: 3,
    evaluate: (parameters, context) => {
      const left = evaluateParameter(parameters[0], context.evaluateExpression)
      const operator = evaluateParameter(parameters[1], context.evaluateExpression)
      const right = evaluateParameter(parameters[2], context.evaluateExpression)
      if (typeof operator !== 'string') throw new TypeError('Native.compare requires a string operator.')
      const result = compareNativeValues(left, operator, right)
      if (result === undefined) throw new TypeError('Native.compare does not support the supplied values or operator.')
      return result
    },
  })
  registry.registerAction({
    operation: 'Native.set-variable',
    parameterCount: 2,
    execute: (parameters, context) => {
      const name = evaluateParameter(parameters[0], context.evaluateExpression)
      const value = evaluateParameter(parameters[1], context.evaluateExpression)
      if (typeof name !== 'string' || name.trim() === '') throw new TypeError('Native.set-variable requires a non-empty variable name.')
      context.variables.set(name, value)
    },
  })
  registry.registerAction({
    operation: 'Native.increment-variable',
    parameterCount: 2,
    execute: (parameters, context) => {
      const name = evaluateParameter(parameters[0], context.evaluateExpression)
      const increment = evaluateParameter(parameters[1], context.evaluateExpression)
      const current = typeof name === 'string' ? context.variables.get(name) : undefined
      if (typeof name !== 'string' || typeof current !== 'number' || typeof increment !== 'number') {
        throw new TypeError('Native.increment-variable requires an initialized numeric variable and numeric increment.')
      }
      const value = current + increment
      if (!Number.isFinite(value)) throw new TypeError('Native.increment-variable result must be finite.')
      context.variables.set(name, value)
    },
  })
  return registry
}

function evaluateParameter(
  expression: Expression | undefined,
  evaluateExpression: (expression: Expression) => NativeExpressionResult,
): JsonValue {
  if (expression === undefined) throw new TypeError('Native operation parameter is missing.')
  const result = evaluateExpression(expression)
  if (!result.supported) throw new TypeError(result.reason)
  return result.value
}

function validateDefinition(operation: string, parameterCount: number): void {
  if (operation.trim() === '') throw new TypeError('Native operation ID must not be empty.')
  if (!Number.isSafeInteger(parameterCount) || parameterCount < 0) {
    throw new TypeError('Native operation parameterCount must be a non-negative integer.')
  }
}

export type NativeConditionHandler = NativeConditionDefinition['evaluate']
export type NativeActionHandler = NativeActionDefinition['execute']
