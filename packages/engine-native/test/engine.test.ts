import { describe, expect, it } from 'vitest'
import type { EventDocument, EventNode, Expression } from '@project/schema'
import { createNativeEngine, createNativeRegistry } from '@project/engine-native'

const literal = (value: string | number | boolean) => ({ type: 'literal' as const, value })
let nextConditionId = 0
const compare = (left: Expression, operator: string, right: Expression) => ({
  type: 'condition' as const,
  id: 'condition:compare-' + nextConditionId++,
  operation: 'Native.compare',
  parameters: [left, literal(operator), right],
})

function document(events: EventNode[]): EventDocument {
  return {
    schemaVersion: 1,
    id: 'native:test',
    engine: { id: 'native' },
    variables: [{
      id: 'variable:score',
      name: 'score',
      dataType: 'number',
      scope: 'global',
      initialValue: literal(0),
    }],
    sheets: [{ id: 'sheet:main', name: 'Main', events }],
  }
}

describe('native engine', () => {
  it('validates operations against the native registry and rejects another engine', () => {
    const engine = createNativeEngine()
    const valid = document([{ type: 'event', id: 'event:known', conditions: [{
      type: 'condition', id: 'condition:always', operation: 'Native.always', parameters: [],
    }], actions: [] }])
    const wrongParameterCount = document([{ type: 'event', id: 'event:wrong-count', conditions: [{
      type: 'condition', id: 'condition:wrong-count', operation: 'Native.always', parameters: [literal(1)],
    }], actions: [] }])
    const invalid = document([{ type: 'event', id: 'event:unknown', conditions: [{
      type: 'condition', id: 'condition:unknown', operation: 'Construct.PickAll', parameters: [],
    }], actions: [] }])

    expect(engine.validate(valid).valid).toBe(true)
    expect(engine.validate(invalid)).toMatchObject({
      valid: false,
      diagnostics: [expect.objectContaining({ code: 'native.validation.unknown-condition' })],
    })
    expect(engine.validate(wrongParameterCount).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'native.validation.condition-parameter-count' }))
    const constructDocument = { ...valid, engine: { id: 'construct' } }
    expect(engine.validate(constructDocument).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'native.validation.wrong-engine' }))
    expect(engine.run(constructDocument, 'sheet:main').entries).toEqual([])
  })

  it('runs clear AND/OR, inversion, child, and variable semantics with fresh state per run', () => {
    const engine = createNativeEngine()
    const addTwo: Expression = { type: 'binary', operator: '+', left: literal(1), right: literal(1) }
    const input = document([
      {
        type: 'event', id: 'event:parent',
        conditions: [compare({ type: 'variable', name: 'score' }, '==', literal(0))],
        actions: [{
          type: 'action', id: 'action:add', operation: 'Native.increment-variable',
          parameters: [literal('score'), addTwo],
        }],
        subEvents: [{
          type: 'event', id: 'event:child',
          conditions: [compare({ type: 'variable', name: 'score' }, '==', addTwo)],
          actions: [{
            type: 'action', id: 'action:child', operation: 'Native.set-variable',
            parameters: [literal('childRan'), literal(true)],
          }],
        }],
      },
      {
        type: 'event', id: 'event:or', isOrBlock: true,
        conditions: [
          compare(literal(1), '==', literal(2)),
          compare({ type: 'variable', name: 'score' }, '==', literal(2)),
          { type: 'condition', id: 'condition:short-circuit', operation: 'Native.always', parameters: [], inverted: true },
        ],
        actions: [{
          type: 'action', id: 'action:or', operation: 'Native.set-variable',
          parameters: [literal('orRan'), literal(true)],
        }],
      },
      {
        type: 'event', id: 'event:inverted',
        conditions: [{
          ...compare({ type: 'variable', name: 'score' }, '==', literal(2)),
          inverted: true,
        }],
        actions: [{
          type: 'action', id: 'action:inverted', operation: 'Native.set-variable',
          parameters: [literal('invertedRan'), literal(true)],
        }],
      },
      {
        type: 'event', id: 'event:blocked-parent',
        conditions: [compare(literal(1), '==', literal(2))],
        actions: [{
          type: 'action', id: 'action:blocked-parent', operation: 'Native.set-variable',
          parameters: [literal('blockedRan'), literal(true)],
        }],
        subEvents: [{
          type: 'event', id: 'event:blocked-child', conditions: [], actions: [{
            type: 'action', id: 'action:blocked-child', operation: 'Native.set-variable',
            parameters: [literal('blockedChildRan'), literal(true)],
          }],
        }],
      },
    ])

    const first = engine.run(input, 'sheet:main')
    const second = engine.run(input, 'sheet:main')

    expect(first.variables).toEqual({ score: 2, childRan: true, orRan: true })
    expect(second.variables).toEqual(first.variables)
    expect(first.entries).toContainEqual(expect.objectContaining({ nodeId: 'event:inverted', status: 'failed' }))
    expect(first.entries.some(({ nodeId, status }) => nodeId === 'action:inverted' && status === 'executed')).toBe(false)
    expect(first.entries).toContainEqual(expect.objectContaining({ nodeId: 'condition:short-circuit', status: 'skipped' }))
    expect(first.entries).toContainEqual(expect.objectContaining({ nodeId: 'event:blocked-child', status: 'skipped' }))
    expect(first.status).toBe('complete')
  })

  it('allows explicit native condition handlers without importing Construct registry behavior', () => {
    const registry = createNativeRegistry()
    registry.registerCondition({
      operation: 'Native.is-five',
      parameterCount: 1,
      evaluate: (parameters, context) => {
        const value = context.evaluateExpression(parameters[0]!)
        return value.supported && value.value === 5
      },
    })
    registry.registerAction({
      operation: 'Native.set-extension-flag',
      parameterCount: 0,
      execute: (_parameters, context) => context.variables.set('extensionRan', true),
    })
    const engine = createNativeEngine(registry)
    const input = document([{
      type: 'event', id: 'event:custom',
      conditions: [{
        type: 'condition', id: 'condition:five', operation: 'Native.is-five', parameters: [literal(5)],
      }],
      actions: [{
        type: 'action', id: 'action:custom', operation: 'Native.set-variable',
        parameters: [literal('customRan'), literal(true)],
      }, {
        type: 'action', id: 'action:extension', operation: 'Native.set-extension-flag',
        parameters: [],
      }],
    }])

    expect(engine.run(input, 'sheet:main').variables).toMatchObject({ customRan: true, extensionRan: true })
  })
})
