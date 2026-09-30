import { describe, expect, it } from 'vitest'
import type { AceInvocationScope, HostAdapter } from '@project/schema'
import {
  compileConstruct,
  constructCompatibilityFeatures,
  createConstructEngine,
  createConstructRuntime,
  exportConstructProject,
  exportConstructSheet,
  importConstruct,
  importConstructProject,
} from '@project/engine-construct'

interface Instance {
  type: string
  properties: Record<string, string | number | boolean | null>
}

function makeHost(instances: Instance[]): HostAdapter<{ layout: string }, Instance> {
  return {
    engineId: 'construct',
    getContext: () => ({ layout: 'main' }),
    getInstances: (objectType) => instances.filter((instance) => instance.type === objectType),
    getObjectType: (instance) => instance.type,
    getProperty: (instance, property) => instance.properties[property] ?? null,
    setProperty: (instance, property, value) => { instance.properties[property] = value },
    callAction: () => undefined,
    createInstance: (objectType) => ({ type: objectType, properties: {} }),
    destroyInstance: () => undefined,
    queryObjects: (objectType, predicate) => instances
      .filter((instance) => instance.type === objectType && (predicate?.(instance) ?? true)),
  }
}

describe('Construct runtime basics', () => {
  it('applies Construct ampersand concatenation and numeric AND semantics', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'string-concatenation-sheet',
      events: [{
        eventType: 'block', sid: 'string-concatenation-event', conditions: [],
        actions: [
          {
            id: 'set-eventvar-value', objectClass: 'System', sid: 'empty-left-concatenation',
            parameters: { variable: 'fromEmpty', value: '"" & "world"' },
          },
          {
            id: 'set-eventvar-value', objectClass: 'System', sid: 'zero-right-concatenation',
            parameters: { variable: 'fromZero', value: '"score: " & 0' },
          },
          {
            id: 'set-eventvar-value', objectClass: 'System', sid: 'numeric-and-false',
            parameters: { variable: 'numericFalse', value: '0 & 1' },
          },
          {
            id: 'set-eventvar-value', objectClass: 'System', sid: 'numeric-and-true',
            parameters: { variable: 'numericTrue', value: '2 & 3' },
          },
        ],
      }],
    }))
    imported.document.variables.push(
      { id: 'fromEmpty', name: 'fromEmpty', dataType: 'string', scope: 'global', initialValue: { type: 'literal', value: '' } },
      { id: 'fromZero', name: 'fromZero', dataType: 'string', scope: 'global', initialValue: { type: 'literal', value: '' } },
      { id: 'numericFalse', name: 'numericFalse', dataType: 'number', scope: 'global', initialValue: { type: 'literal', value: 0 } },
      { id: 'numericTrue', name: 'numericTrue', dataType: 'number', scope: 'global', initialValue: { type: 'literal', value: 0 } },
    )
    const runtime = createConstructRuntime(makeHost([]))

    runtime.run(compileConstruct(imported.document).compiled, 'construct:string-concatenation-sheet')

    expect(runtime.variables.get('fromEmpty')).toBe('world')
    expect(runtime.variables.get('fromZero')).toBe('score: 0')
    expect(runtime.variables.get('numericFalse')).toBe(0)
    expect(runtime.variables.get('numericTrue')).toBe(1)
  })

  it('evaluates the newline expression and StringSub placeholders', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'string-builtins-sheet',
      events: [{ eventType: 'block', sid: 'string-builtins-event', conditions: [], actions: [{
        id: 'set-eventvar-value', objectClass: 'System', sid: 'string-builtins-action',
        parameters: {
          variable: 'message',
          value: '"He said ""hi""" & newline & StringSub("Hi {0}, score {1}", "Sam", 100)',
        },
      }] }],
    }))
    imported.document.variables.push({
      id: 'message', name: 'message', dataType: 'string', scope: 'global',
      initialValue: { type: 'literal', value: '' },
    })
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:string-builtins-sheet')

    expect(runtime.variables.get('message')).toBe('He said "hi"\nHi Sam, score 100')
    expect(trace.status).toBe('complete')
  })

  it('evaluates documented math, text search, and substring expressions', () => {
    const values = [
      { name: 'angle', expression: 'angle(0, 0, 0, 1)', expected: 90 },
      { name: 'wrappedAngle', expression: 'angle(0, 0, 0, -1)', expected: 270 },
      { name: 'angleDifference', expression: 'anglediff(350, 10)', expected: 20 },
      { name: 'distance', expression: 'distance(0, 0, 3, 4)', expected: 5 },
      { name: 'distance3d', expression: 'distance3d(0, 0, 0, 1, 2, 2)', expected: 3 },
      { name: 'lerp', expression: 'lerp(10, 20, .25)', expected: 12.5 },
      { name: 'sineDegrees', expression: 'sin(90)', expected: 1 },
      { name: 'roundedDecimals', expression: 'roundToDp(1.666, 2)', expected: 1.67 },
      { name: 'clamped', expression: 'clamp(12, 0, 10)', expected: 10 },
      { name: 'negativeSign', expression: 'sign(-5)', expected: -1 },
      { name: 'textLength', expression: 'len("Construct")', expected: 9 },
      { name: 'findText', expression: 'find("Construct", "STR")', expected: 3 },
      { name: 'midText', expression: 'mid("Construct", 3, 4)', expected: 'stru' },
      { name: 'rightText', expression: 'right("Construct", 3)', expected: 'uct' },
    ] as const
    const imported = importConstruct(JSON.stringify({
      sid: 'documented-expressions-sheet',
      events: [{ eventType: 'block', sid: 'documented-expressions-event', conditions: [], actions: values.map(({ name, expression }) => ({
        id: 'set-eventvar-value', objectClass: 'System', sid: 'set-' + name,
        parameters: { variable: name, value: expression },
      })) }],
    }))
    imported.document.variables.push(...values.map(({ name, expected }) => ({
      id: name, name, dataType: typeof expected === 'string' ? 'string' as const : 'number' as const,
      scope: 'global' as const,
      initialValue: { type: 'literal' as const, value: typeof expected === 'string' ? '' : 0 },
    })))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:documented-expressions-sheet')

    for (const { name, expected } of values) expect(runtime.variables.get(name)).toBe(expected)
    expect(trace.status).toBe('complete')
  })

  it('evaluates digit-prefixed object references and scientific numeric literals', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'digit-prefixed-expression-sheet',
      events: [{ eventType: 'block', sid: 'digit-prefixed-expression-event', conditions: [], actions: [{
        id: 'set-eventvar-value', objectClass: 'System', sid: 'digit-prefixed-expression-action',
        parameters: { variable: 'result', value: '3DCamera.CameraXRotation + 3e2' },
      }] }],
    }))
    imported.document.variables.push({
      id: 'result', name: 'result', dataType: 'number', scope: 'global',
      initialValue: { type: 'literal', value: 0 },
    })
    const camera: Instance = { type: '3DCamera', properties: { CameraXRotation: 14 } }
    const runtime = createConstructRuntime(makeHost([camera]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:digit-prefixed-expression-sheet')

    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-expression')).toEqual([])
    expect(runtime.variables.get('result')).toBe(314)
    expect(trace.status).toBe('complete')
  })

  it('evaluates documented angle, interpolation, bit, logarithm, and constant expressions', () => {
    const values = [
      { name: 'angleLerp', expression: 'anglelerp(350, 10, .5)', expected: 0 },
      { name: 'angleRotate', expression: 'anglerotate(350, 10, 5)', expected: 355 },
      { name: 'cosineInterpolation', expression: 'cosp(0, 10, .5)', expected: 5 },
      { name: 'quadraticInterpolation', expression: 'qarp(0, 10, 20, .5)', expected: 10 },
      { name: 'cubicInterpolation', expression: 'cubic(0, 10, 20, 30, .5)', expected: 15 },
      { name: 'unlerp', expression: 'unlerp(10, 20, 15)', expected: .5 },
      { name: 'naturalLog', expression: 'ln(exp(1))', expected: 1 },
      { name: 'commonLog', expression: 'log10(100)', expected: 2 },
      { name: 'leastBit', expression: 'getbit(7, 0)', expected: 1 },
      { name: 'setBit', expression: 'setbit(4, 0, 1)', expected: 5 },
      { name: 'toggleBit', expression: 'togglebit(7, 1)', expected: 5 },
      { name: 'piConstant', expression: 'pi', expected: Math.PI },
    ] as const
    const imported = importConstruct(JSON.stringify({
      sid: 'advanced-math-sheet',
      events: [{ eventType: 'block', sid: 'advanced-math-event', conditions: [], actions: values.map(({ name, expression }) => ({
        id: 'set-eventvar-value', objectClass: 'System', sid: 'set-' + name,
        parameters: { variable: name, value: expression },
      })) }],
    }))
    imported.document.variables.push(...values.map(({ name }) => ({
      id: name, name, dataType: 'number' as const, scope: 'global' as const,
      initialValue: { type: 'literal' as const, value: 0 },
    })))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:advanced-math-sheet')

    for (const { name, expected } of values) expect(runtime.variables.get(name)).toBeCloseTo(expected)
    expect(trace.status).toBe('complete')
  })

  it('delegates host-backed System expressions, including identifier expressions', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'host-system-expressions-sheet',
      events: [{ eventType: 'block', sid: 'host-system-expressions-event', conditions: [], actions: [
        { id: 'set-eventvar-value', objectClass: 'System', sid: 'set-dt', parameters: { variable: 'deltaTime', value: 'dt' } },
        { id: 'set-eventvar-value', objectClass: 'System', sid: 'set-object-count', parameters: { variable: 'objectCount', value: 'ObjectCount' } },
        { id: 'set-eventvar-value', objectClass: 'System', sid: 'set-viewport-width', parameters: { variable: 'viewportWidth', value: 'ViewportWidth("Main")' } },
      ] }],
    }))
    imported.document.variables.push(...[
      { name: 'deltaTime', value: 0 },
      { name: 'objectCount', value: 0 },
      { name: 'viewportWidth', value: 0 },
    ].map(({ name, value }) => ({
      id: name, name, dataType: 'number' as const, scope: 'global' as const,
      initialValue: { type: 'literal' as const, value },
    })))
    const host = makeHost([])
    const expressionCalls: Array<{ callee: string; parameters: readonly unknown[] }> = []
    host.evaluateExpression = (callee, parameters) => {
      expressionCalls.push({ callee, parameters })
      if (callee.toLowerCase() === 'dt') return 1 / 60
      if (callee.toLowerCase() === 'objectcount') return 2
      if (callee.toLowerCase() === 'viewportwidth' && parameters[0] === 'Main') return 640
      return undefined
    }
    const runtime = createConstructRuntime(host)

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:host-system-expressions-sheet')

    expect(expressionCalls).toEqual([
      { callee: 'dt', parameters: [] },
      { callee: 'ObjectCount', parameters: [] },
      { callee: 'ViewportWidth', parameters: ['Main'] },
    ])
    expect(Object.fromEntries(runtime.variables)).toEqual({ deltaTime: 1 / 60, objectCount: 2, viewportWidth: 640 })
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'host-backed-system-expressions', status: 'TESTED',
    }))
  })

  it('returns documented random values within the requested ranges', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'random-expressions-sheet',
      events: [{ eventType: 'block', sid: 'random-expressions-event', conditions: [], actions: [
        {
          id: 'set-eventvar-value', objectClass: 'System', sid: 'random-one-bound',
          parameters: { variable: 'randomOneBound', value: 'random(5)' },
        },
        {
          id: 'set-eventvar-value', objectClass: 'System', sid: 'random-two-bounds',
          parameters: { variable: 'randomTwoBounds', value: 'random(-2, 2)' },
        },
        {
          id: 'set-eventvar-value', objectClass: 'System', sid: 'random-choose',
          parameters: { variable: 'randomChoice', value: 'choose(2, 4, 6, 8)' },
        },
      ] }],
    }))
    imported.document.variables.push(
      { id: 'randomOneBound', name: 'randomOneBound', dataType: 'number', scope: 'global', initialValue: { type: 'literal', value: 0 } },
      { id: 'randomTwoBounds', name: 'randomTwoBounds', dataType: 'number', scope: 'global', initialValue: { type: 'literal', value: 0 } },
      { id: 'randomChoice', name: 'randomChoice', dataType: 'number', scope: 'global', initialValue: { type: 'literal', value: 0 } },
    )
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:random-expressions-sheet')

    const randomOneBound = runtime.variables.get('randomOneBound') as number
    const randomTwoBounds = runtime.variables.get('randomTwoBounds') as number
    expect(randomOneBound).toBeGreaterThanOrEqual(0)
    expect(randomOneBound).toBeLessThan(5)
    expect(randomTwoBounds).toBeGreaterThanOrEqual(-2)
    expect(randomTwoBounds).toBeLessThan(2)
    expect([2, 4, 6, 8]).toContain(runtime.variables.get('randomChoice'))
    expect(trace.status).toBe('complete')
  })

  it('evaluates documented text helpers and clamps chooseindex to an available value', () => {
    const values = [
      { name: 'token', expression: 'tokenat("apples|oranges|bananas", 1, "|")', expected: 'oranges' },
      { name: 'tokenCount', expression: 'tokencount("apples|oranges|bananas", "|")', expected: 3 },
      { name: 'replaced', expression: 'replace("a,b,a", "a", "x")', expected: 'x,b,x' },
      { name: 'lower', expression: 'lowercase("Construct")', expected: 'construct' },
      { name: 'upper', expression: 'uppercase("Construct")', expected: 'CONSTRUCT' },
      { name: 'trimmed', expression: 'trim("  Construct  ")', expected: 'Construct' },
      { name: 'padded', expression: 'zeropad(45, 5)', expected: '00045' },
      { name: 'chosen', expression: 'chooseindex(9, "foo", "bar", "baz")', expected: 'baz' },
    ] as const
    const imported = importConstruct(JSON.stringify({
      sid: 'text-helpers-sheet',
      events: [{ eventType: 'block', sid: 'text-helpers-event', conditions: [], actions: values.map(({ name, expression }) => ({
        id: 'set-eventvar-value', objectClass: 'System', sid: 'set-' + name,
        parameters: { variable: name, value: expression },
      })) }],
    }))
    imported.document.variables.push(...values.map(({ name, expected }) => ({
      id: name, name, dataType: typeof expected === 'string' ? 'string' as const : 'number' as const,
      scope: 'global' as const,
      initialValue: { type: 'literal' as const, value: typeof expected === 'string' ? '' : 0 },
    })))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:text-helpers-sheet')

    for (const { name, expected } of values) expect(runtime.variables.get(name)).toBe(expected)
    expect(trace.status).toBe('complete')
  })

  it('compares expression values and executes Set event variable', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'variables-sheet',
      events: [{ eventType: 'block', sid: 'variables-event', conditions: [{
        id: 'compare-two-values', objectClass: 'System', sid: 'variables-condition',
        parameters: { 'first-value': 'score', comparison: 4, 'second-value': 1 },
      }], actions: [{
        id: 'set-eventvar-value', objectClass: 'System', sid: 'variables-action',
        parameters: { variable: 'score', value: 'score + 3' },
      }] }],
    }))
    imported.document.variables.push({
      id: 'score', name: 'score', dataType: 'number', scope: 'global',
      initialValue: { type: 'literal', value: 2 },
    })
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:variables-sheet')

    expect(runtime.variables.get('score')).toBe(5)
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:variables-condition', status: 'passed',
      details: expect.objectContaining({ result: true }),
    }))
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'action', nodeId: 'construct:variables-action', status: 'executed',
    }))
    expect(trace.status).toBe('complete')
  })

  it('supports recursive function calls with an independent parameter scope per call', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'recursive-function-sheet',
      events: [
        {
          eventType: 'function', sid: 'factorial-function', name: 'Factorial',
          parameters: [{ sid: 'factorial-n', name: 'n', type: 'number' }],
          returnType: 'number', conditions: [], actions: [],
          children: [
            {
              eventType: 'block', sid: 'factorial-base',
              conditions: [{
                id: 'compare-two-values', objectClass: 'System', sid: 'factorial-base-condition',
                parameters: { 'first-value': 'n', comparison: 3, 'second-value': 1 },
              }],
              actions: [{
                id: 'set-return-value', objectClass: 'Functions', sid: 'factorial-base-return',
                parameters: { value: 1 },
              }],
            },
            {
              eventType: 'block', sid: 'factorial-recursive', isElse: true,
              conditions: [],
              actions: [{
                id: 'set-return-value', objectClass: 'Functions', sid: 'factorial-recursive-return',
                parameters: { value: 'n * Functions.Factorial(n - 1)' },
              }],
            },
          ],
        },
        {
          eventType: 'block', sid: 'factorial-caller', conditions: [], actions: [{
            id: 'set-eventvar-value', objectClass: 'System', sid: 'factorial-result',
            parameters: { variable: 'factorial', value: 'Functions.Factorial(5)' },
          }],
        },
      ],
    }))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:recursive-function-sheet')

    expect(runtime.variables.get('factorial')).toBe(120)
    expect(trace.entries.filter(({ nodeId, status }) => nodeId === 'construct:factorial-recursive-return' && status === 'executed'))
      .toHaveLength(4)
    expect(trace.status).toBe('complete')
  })

  it('resets picking in a function call and restores the caller selection on return', () => {
    const engine = createConstructEngine({ extensions: [{
      id: 'compatibility.player-record',
      objectClass: 'Player',
      actions: [{ id: 'record', category: 'general', name: 'Record', scriptName: 'Record' }],
    }] })
    const imported = importConstruct(JSON.stringify({
      sid: 'function-picking-sheet',
      events: [
        {
          eventType: 'function', sid: 'pick-second-function', name: 'PickSecond',
          returnType: 'number', conditions: [],
          actions: [{
            id: 'set-return-value', objectClass: 'Functions', sid: 'pick-second-return',
            parameters: { value: 1 },
          }],
          children: [{
            eventType: 'block', sid: 'pick-second-child',
            conditions: [{
              id: 'pick-by-comparison', objectClass: 'System', sid: 'pick-second-condition',
              parameters: { object: 'Player', 'first-value': 'Player.X', comparison: 0, 'second-value': 2 },
            }],
              actions: [{ id: 'record', objectClass: 'Player', sid: 'record-second', parameters: {} }],
          }],
        },
        {
          eventType: 'function', sid: 'pick-second-copied-function', name: 'PickSecondCopied',
          returnType: 'number', copyPicked: true, conditions: [],
          actions: [{
            id: 'set-return-value', objectClass: 'Functions', sid: 'pick-second-copied-return',
            parameters: { value: 1 },
          }],
          children: [{
            eventType: 'block', sid: 'pick-second-copied-child',
            conditions: [{
              id: 'pick-by-comparison', objectClass: 'System', sid: 'pick-second-copied-condition',
              parameters: { object: 'Player', 'first-value': 'Player.X', comparison: 0, 'second-value': 2 },
            }],
            actions: [{ id: 'record', objectClass: 'Player', sid: 'record-second-copied', parameters: {} }],
          }],
        },
        {
          eventType: 'block', sid: 'pick-first-caller',
          conditions: [{
            id: 'pick-by-comparison', objectClass: 'System', sid: 'pick-first-condition',
            parameters: { object: 'Player', 'first-value': 'Player.X', comparison: 0, 'second-value': 1 },
          }],
          actions: [
            {
              id: 'set-eventvar-value', objectClass: 'System', sid: 'call-pick-second',
              parameters: { variable: 'functionResult', value: 'Functions.PickSecond()' },
            },
            { id: 'record', objectClass: 'Player', sid: 'record-first', parameters: {} },
          ],
        },
        {
          eventType: 'block', sid: 'pick-first-copied-caller',
          conditions: [{
            id: 'pick-by-comparison', objectClass: 'System', sid: 'pick-first-copied-condition',
            parameters: { object: 'Player', 'first-value': 'Player.X', comparison: 0, 'second-value': 1 },
          }],
          actions: [
            {
              id: 'set-eventvar-value', objectClass: 'System', sid: 'call-pick-second-copied',
              parameters: { variable: 'functionResultCopied', value: 'Functions.PickSecondCopied()' },
            },
            { id: 'record', objectClass: 'Player', sid: 'record-first-copied', parameters: {} },
          ],
        },
      ],
    }), { registry: engine.registry })
    const instances: Instance[] = [
      { type: 'Player', properties: { id: 'first', X: 1 } },
      { type: 'Player', properties: { id: 'second', X: 2 } },
    ]
    const recorded: string[] = []
    const host: HostAdapter<{ layout: string }, Instance> = {
      ...makeHost(instances),
      callAction: (_objectClass, actionId, targets) => {
        if (actionId === 'record') recorded.push(...targets.map((instance) => String(instance.properties.id)))
      },
    }
    const runtime = createConstructRuntime(host)

    const trace = runtime.run(compileConstruct(imported.document, { registry: engine.registry }).compiled, 'construct:function-picking-sheet')

    expect(recorded).toEqual(['second', 'first', 'first'])
    expect(runtime.variables.get('functionResult')).toBe(1)
    expect(runtime.variables.get('functionResultCopied')).toBe(1)
    expect(trace.status).toBe('complete')
  })

  it('compares, adds, subtracts, resets, and toggles registered System event variables', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'system-variable-sheet',
      events: [
        { eventType: 'variable', sid: 'score-variable', name: 'score', type: 'number', initialValue: '2' },
        { eventType: 'variable', sid: 'enabled-variable', name: 'enabled', type: 'boolean', initialValue: 'true' },
        { eventType: 'block', sid: 'compare-number', conditions: [{
          id: 'compare-eventvar', objectClass: 'System', sid: 'score-greater-than-one',
          parameters: { variable: 'score', comparison: 4, value: '1' },
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'number-result',
          parameters: { variable: 'numberPassed', value: '1' },
        }] },
        { eventType: 'block', sid: 'compare-boolean', conditions: [{
          id: 'compare-boolean-eventvar', objectClass: 'System', sid: 'enabled-is-true',
          parameters: { variable: 'enabled' },
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'boolean-result',
          parameters: { variable: 'booleanPassed', value: '1' },
        }] },
        { eventType: 'block', sid: 'number-actions', conditions: [], actions: [
          { id: 'add-to-eventvar', objectClass: 'System', sid: 'add-score', parameters: { variable: 'score', value: '3' } },
          { id: 'subtract-from-eventvar', objectClass: 'System', sid: 'subtract-score', parameters: { variable: 'score', value: '1' } },
          { id: 'reset-eventvar', objectClass: 'System', sid: 'reset-score', parameters: { variable: 'score' } },
        ] },
        { eventType: 'block', sid: 'set-boolean', conditions: [], actions: [{
          id: 'set-boolean-eventvar', objectClass: 'System', sid: 'disable-variable',
          parameters: { variable: 'enabled', value: 'false' },
        }] },
        { eventType: 'block', sid: 'toggle-boolean', conditions: [], actions: [{
          id: 'toggle-boolean-eventvar', objectClass: 'System', sid: 'toggle-variable',
          parameters: { variable: 'enabled' },
        }] },
      ],
    }))
    const runtime = createConstructRuntime(makeHost([]))
    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:system-variable-sheet')

    expect(runtime.variables.get('numberPassed')).toBe(1)
    expect(runtime.variables.get('booleanPassed')).toBe(1)
    expect(runtime.variables.get('score')).toBe(2)
    expect(runtime.variables.get('enabled')).toBe(true)
    expect(trace.entries.filter(({ kind, status }) => kind === 'action' && status === 'unsupported')).toEqual([])
  })

  it('dispatches the registered System On start of layout trigger', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'layout-start-sheet',
      events: [
        { eventType: 'variable', sid: 'started-variable', name: 'started', type: 'boolean', initialValue: 'false' },
        { eventType: 'block', sid: 'layout-start-event', conditions: [{
          id: 'on-start-of-layout', objectClass: 'System', sid: 'layout-start-condition',
        }], actions: [{
          id: 'set-boolean-eventvar', objectClass: 'System', sid: 'set-started',
          parameters: { variable: 'started', value: 'true' },
        }] },
      ],
    }))
    const compiled = compileConstruct(imported.document).compiled
    const runtime = createConstructRuntime(makeHost([]))
    runtime.run(compiled, 'construct:layout-start-sheet')
    const trace = runtime.dispatchTrigger(compiled, 'construct:layout-start-sheet', {
      operation: 'System.on-start-of-layout',
    })

    expect(runtime.variables.get('started')).toBe(true)
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:layout-start-condition', status: 'passed',
    }))
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'action', nodeId: 'construct:set-started', status: 'executed',
    }))
  })

  it('reports registered asynchronous System actions as unsupported by the synchronous runtime', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'async-system-action-sheet',
      events: [{ eventType: 'block', sid: 'async-system-action-event', conditions: [], actions: [{
        id: 'wait-for-previous-actions', objectClass: 'System', sid: 'wait-actions',
      }] }],
    }))
    const trace = createConstructRuntime(makeHost([]))
      .run(compileConstruct(imported.document).compiled, 'construct:async-system-action-sheet')

    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'action', nodeId: 'construct:wait-actions', status: 'unsupported',
    }))
    expect(trace.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.runtime.unsupported-action', nodeId: 'construct:wait-actions',
    }))
  })

  it('imports System Wait seconds and reports its asynchronous runtime limit', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'system-wait-sheet',
      events: [{ eventType: 'block', sid: 'system-wait-event', conditions: [], actions: [{
        id: 'wait', objectClass: 'System', sid: 'system-wait-action',
        parameters: { seconds: '0.25' },
      }] }],
    }))
    const host = makeHost([])
    const actionCalls: string[] = []
    host.callAction = (_objectClass, actionId) => { actionCalls.push(actionId) }
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:system-wait-sheet',
    )
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported System Wait sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected an imported System Wait event')

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(event.actions[0]).toMatchObject({
      type: 'action',
      operation: 'System.wait',
      parameters: [{ type: 'literal', value: 0.25 }],
    })
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'action', nodeId: 'construct:system-wait-action', status: 'unsupported',
    }))
    expect(trace.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.runtime.unsupported-action',
      nodeId: 'construct:system-wait-action',
      message: expect.stringContaining('Asynchronous Construct actions are not awaited'),
    }))
    expect(actionCalls).toEqual([])
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'system-wait-action-import', status: 'TESTED',
    }))
  })

  it('imports AJAX project-file requests and identifies their asynchronous runtime limit', () => {
    const imported = importConstruct({
      'project.c3proj': JSON.stringify({
        name: 'AJAX project-file request',
        uniqueId: 'ajax-project-file-request',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'ajax-project-file-request-sheet',
        events: [{
          eventType: 'block',
          sid: 'ajax-project-file-request-event',
          conditions: [],
          actions: [{
            id: 'request-project-file',
            objectClass: 'AJAX',
            sid: 'ajax-project-file-request-action',
            parameters: { tag: '""', file: 'rules.json' },
          }],
        }],
      }),
      'objectTypes/AJAX.json': JSON.stringify({ name: 'AJAX', 'plugin-id': 'AJAX' }),
    })
    const trace = createConstructRuntime(makeHost([])).run(
      compileConstruct(imported.document).compiled,
      'construct:ajax-project-file-request-sheet',
    )
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported AJAX project-file sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected an imported AJAX project-file event')

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(event.actions[0]).toMatchObject({
      type: 'action',
      operation: 'AJAX.request-project-file',
      parameters: [
        { type: 'literal', value: '' },
        { type: 'literal', value: 'rules.json' },
      ],
    })
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'action',
      nodeId: 'construct:ajax-project-file-request-action',
      details: { operation: 'AJAX.request-project-file' },
      status: 'unsupported',
    }))
    expect(trace.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.runtime.unsupported-action',
      nodeId: 'construct:ajax-project-file-request-action',
      message: expect.stringContaining('Asynchronous Construct actions are not awaited'),
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'ajax-request-project-file-subset',
      status: 'TESTED',
    }))
  })

  it('preserves variable values across ticks until the runtime is reset', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'persistent-variables-sheet',
      events: [{ eventType: 'block', sid: 'persistent-variables-event', conditions: [], actions: [{
        id: 'set-eventvar-value', objectClass: 'System', sid: 'increment-score',
        parameters: { variable: 'score', value: 'score + 1' },
      }] }],
    }))
    imported.document.variables.push({
      id: 'persistent-score', name: 'score', dataType: 'number', scope: 'global',
      initialValue: { type: 'literal', value: 2 },
    })
    const runtime = createConstructRuntime(makeHost([]))
    const compiled = compileConstruct(imported.document).compiled

    runtime.run(compiled, 'construct:persistent-variables-sheet')
    runtime.run(compiled, 'construct:persistent-variables-sheet')
    expect(runtime.variables.get('score')).toBe(4)

    runtime.reset()
    runtime.run(compiled, 'construct:persistent-variables-sheet')
    expect(runtime.variables.get('score')).toBe(3)
  })

  it('passes Every tick and executes its actions', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'every-tick-sheet',
      events: [{ eventType: 'block', sid: 'every-tick-event', conditions: [{
        id: 'every-tick', objectClass: 'System', sid: 'every-tick-condition', parameters: {},
      }], actions: [{
        id: 'set-eventvar-value', objectClass: 'System', sid: 'every-tick-action',
        parameters: { variable: 'ran', value: 1 },
      }] }],
    }))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:every-tick-sheet')

    expect(runtime.variables.get('ran')).toBe(1)
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:every-tick-condition', status: 'passed',
    }))
  })

  it('inverts scalar conditions and selects instances that fail a pick comparison', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'inverted-sheet',
      events: [
        { eventType: 'block', sid: 'inverted-scalar-event', conditions: [{
          id: 'compare-two-values', objectClass: 'System', sid: 'inverted-scalar-condition', isInverted: true,
          parameters: { 'first-value': 1, comparison: 0, 'second-value': 2 },
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'inverted-scalar-action',
          parameters: { variable: 'scalarPassed', value: 1 },
        }] },
        { eventType: 'block', sid: 'inverted-pick-event', conditions: [{
          id: 'pick-by-comparison', objectClass: 'System', sid: 'inverted-pick-condition', isInverted: true,
          parameters: { object: 'Player', 'first-value': 'Player.X', comparison: 4, 'second-value': 10 },
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'inverted-pick-action',
          parameters: { variable: 'selectedX', value: 'Player.X' },
        }] },
        { eventType: 'block', sid: 'inverted-pick-all-event', conditions: [{
          id: 'pick-all', objectClass: 'System', sid: 'inverted-pick-all-condition', isInverted: true,
          parameters: { object: 'Player' },
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'inverted-pick-all-action',
          parameters: { variable: 'pickAllInvertedRan', value: 1 },
        }] },
      ],
    }))
    const runtime = createConstructRuntime(makeHost([
      { type: 'Player', properties: { X: 5 } },
      { type: 'Player', properties: { X: 15 } },
    ]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:inverted-sheet')

    expect(runtime.variables.get('scalarPassed')).toBe(1)
    expect(runtime.variables.get('selectedX')).toBe(5)
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:inverted-scalar-condition', status: 'passed',
    }))
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:inverted-pick-condition', status: 'passed',
      details: expect.objectContaining({ selectedCount: 1 }),
    }))
    expect(runtime.variables.has('pickAllInvertedRan')).toBe(false)
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:inverted-pick-all-condition', status: 'failed',
      details: expect.objectContaining({ selectedCount: 0 }),
    }))
  })

  it('keeps inverted conditions unsupported when their registered ACE is not invertible', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'non-invertible-sheet',
      events: [{ eventType: 'block', sid: 'non-invertible-event', conditions: [{
        id: 'trigger-once-while-true', objectClass: 'System', sid: 'non-invertible-condition', isInverted: true,
      }], actions: [] }],
    }))

    const trace = createConstructRuntime(makeHost([]))
      .run(compileConstruct(imported.document).compiled, 'construct:non-invertible-sheet')

    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:non-invertible-condition', status: 'unsupported',
    }))
    expect(trace.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.runtime.unsupported-inverted-condition' }))
  })

  it('runs an OR block when any condition passes', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'or-sheet',
      events: [
        { eventType: 'block', sid: 'or-event', isOrBlock: true, conditions: [
          { id: 'compare-two-values', objectClass: 'System', sid: 'or-true', parameters: { 'first-value': 1, comparison: 0, 'second-value': 1 } },
          { id: 'compare-two-values', objectClass: 'System', sid: 'or-false', parameters: { 'first-value': 1, comparison: 0, 'second-value': 2 } },
        ], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'or-action',
          parameters: { variable: 'orPassed', value: 1 },
        }] },
        { eventType: 'block', sid: 'or-fail-event', isOrBlock: true, conditions: [
          { id: 'compare-two-values', objectClass: 'System', sid: 'or-fail-one', parameters: { 'first-value': 1, comparison: 0, 'second-value': 2 } },
          { id: 'compare-two-values', objectClass: 'System', sid: 'or-fail-two', parameters: { 'first-value': 2, comparison: 0, 'second-value': 3 } },
        ], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'or-fail-action',
          parameters: { variable: 'orFailed', value: 1 },
        }] },
      ],
    }))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:or-sheet')

    expect(runtime.variables.get('orPassed')).toBe(1)
    expect(runtime.variables.has('orFailed')).toBe(false)
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:or-event', status: 'passed' }))
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:or-fail-event', status: 'failed' }))
  })

  it('unions object picks from each passing OR branch', () => {
    const engine = createConstructEngine({ extensions: [{
      id: 'or-picking.player',
      objectClass: 'Player',
      actions: [{ id: 'record', category: 'general', name: 'Record', scriptName: 'Record' }],
    }] })
    const imported = importConstruct(JSON.stringify({
      sid: 'or-picks-sheet',
      events: [{ eventType: 'block', sid: 'or-picks-event', isOrBlock: true, conditions: [
        { id: 'pick-by-comparison', objectClass: 'System', sid: 'or-low', parameters: { object: 'Player', 'first-value': 'Player.X', comparison: 2, 'second-value': 10 } },
        { id: 'pick-by-comparison', objectClass: 'System', sid: 'or-high', parameters: { object: 'Player', 'first-value': 'Player.X', comparison: 4, 'second-value': 20 } },
      ], actions: [{ id: 'record', objectClass: 'Player', sid: 'record-picks', parameters: {} }] }],
    }), { registry: engine.registry })
    const players = [5, 15, 25].map((X) => ({ type: 'Player', properties: { X } }))
    const calls: number[] = []
    const host = makeHost(players)
    host.callAction = (_objectClass, _actionId, instances) => {
      for (const instance of instances) calls.push(Number(instance.properties.X))
    }

    const trace = createConstructRuntime(host)
      .run(compileConstruct(imported.document, { registry: engine.registry }).compiled, 'construct:or-picks-sheet')

    expect(calls).toEqual([5, 25])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'event', nodeId: 'construct:or-picks-event', status: 'passed',
    }))
  })

  it('runs Else only when the immediately preceding sibling did not run', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'else-sheet',
      events: [
        { eventType: 'block', sid: 'false-event', conditions: [{
          id: 'compare-two-values', objectClass: 'System', sid: 'false-condition',
          parameters: { 'first-value': 1, comparison: 0, 'second-value': 2 },
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'first-action',
          parameters: { variable: 'branch', value: '"first"' },
        }] },
        { eventType: 'block', sid: 'else-after-false', conditions: [{
          id: 'else', objectClass: 'System', sid: 'else-condition', parameters: {},
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'else-action',
          parameters: { variable: 'branch', value: '"else"' },
        }] },
        { eventType: 'block', sid: 'true-event', conditions: [], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'true-action',
          parameters: { variable: 'branch', value: '"normal"' },
        }] },
        { eventType: 'block', sid: 'else-after-true', isElse: true, conditions: [], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'blocked-else-action',
          parameters: { variable: 'mustNotRun', value: 1 },
        }] },
      ],
    }))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:else-sheet')

    expect(runtime.variables.get('branch')).toBe('normal')
    expect(runtime.variables.has('mustNotRun')).toBe(false)
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:else-after-false', status: 'passed' }))
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:else-after-true', status: 'failed' }))
  })

  it('restores the parent selection for an Else sub-event', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'else-selection-sheet',
      events: [{
        eventType: 'block', sid: 'parent-pick', conditions: [{
          id: 'pick-by-comparison', objectClass: 'System', sid: 'parent-condition',
          parameters: { object: 'Player', 'first-value': 'Player.X', comparison: 4, 'second-value': 10 },
        }], actions: [], children: [
          { eventType: 'block', sid: 'empty-pick', conditions: [{
            id: 'pick-by-comparison', objectClass: 'System', sid: 'empty-condition',
            parameters: { object: 'Player', 'first-value': 'Player.X', comparison: 4, 'second-value': 100 },
          }], actions: [] },
          { eventType: 'block', sid: 'else-child', isElse: true, conditions: [], actions: [{
            id: 'set-eventvar-value', objectClass: 'System', sid: 'else-read-parent-pick',
            parameters: { variable: 'parentPick', value: 'Player.X' },
          }] },
        ],
      }],
    }))
    const runtime = createConstructRuntime(makeHost([
      { type: 'Player', properties: { X: 5 } },
      { type: 'Player', properties: { X: 15 } },
    ]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:else-selection-sheet')

    expect(runtime.variables.get('parentPick')).toBe(15)
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:else-child', status: 'passed' }))
  })

  it('runs trigger events only when their registered operation and parameters are dispatched', () => {
    const engine = createConstructEngine({ extensions: [{
      id: 'trigger-test.signal',
      objectClass: 'SignalBus',
      conditions: [{
        id: 'on-message', category: 'general', name: 'On message', scriptName: 'OnMessage', isTrigger: true,
        parameters: [{ id: 'tag', type: 'string' }],
      }],
    }] })
    const imported = importConstruct(JSON.stringify({
      sid: 'trigger-sheet',
      events: [
        { eventType: 'block', sid: 'ready-event', conditions: [{
          id: 'on-message', objectClass: 'SignalBus', sid: 'ready-condition', parameters: { tag: 'ready' },
        }], actions: [{ id: 'set-eventvar-value', objectClass: 'System', sid: 'ready-action', parameters: { variable: 'ready', value: 1 } }] },
        { eventType: 'block', sid: 'other-event', conditions: [{
          id: 'on-message', objectClass: 'SignalBus', sid: 'other-condition', parameters: { tag: 'other' },
        }], actions: [{ id: 'set-eventvar-value', objectClass: 'System', sid: 'other-action', parameters: { variable: 'other', value: 1 } }] },
      ],
    }), { registry: engine.registry })
    const runtime = createConstructRuntime(makeHost([]))
    const compiled = compileConstruct(imported.document, { registry: engine.registry }).compiled

    runtime.run(compiled, 'construct:trigger-sheet')
    expect(runtime.variables.has('ready')).toBe(false)
    const trace = runtime.dispatchTrigger(compiled, 'construct:trigger-sheet', {
      operation: 'SignalBus.on-message', parameters: ['ready'],
    })

    expect(runtime.variables.get('ready')).toBe(1)
    expect(runtime.variables.has('other')).toBe(false)
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:ready-event', status: 'passed' }))
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:other-event', status: 'skipped' }))
  })

  it('delegates Keyboard key state and dispatches matching key-pressed triggers', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'keyboard-conditions-sheet',
      events: [
        { eventType: 'block', sid: 'key-down-event', conditions: [{
          id: 'key-is-down', objectClass: 'Keyboard', sid: 'key-down-condition', parameters: { key: 65 },
        }], actions: [] },
        { eventType: 'block', sid: 'key-pressed-event', conditions: [{
          id: 'on-key-pressed', objectClass: 'Keyboard', sid: 'key-pressed-condition', parameters: { key: 65 },
        }], actions: [] },
        { eventType: 'block', sid: 'other-key-pressed-event', conditions: [{
          id: 'on-key-pressed', objectClass: 'Keyboard', sid: 'other-key-pressed-condition', parameters: { key: 66 },
        }], actions: [] },
      ],
    }))
    const host = makeHost([])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return operation === 'Keyboard.key-is-down' && parameters[0] === 65
    }
    const runtime = createConstructRuntime(host)
    const compiled = compileConstruct(imported.document).compiled

    const frameTrace = runtime.run(compiled, 'construct:keyboard-conditions-sheet')
    expect(conditionCalls).toEqual([{ operation: 'Keyboard.key-is-down', parameters: [65] }])
    expect(frameTrace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:key-down-event', status: 'passed' }))
    expect(frameTrace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:key-pressed-event', status: 'skipped' }))

    const pressTrace = runtime.dispatchTrigger(compiled, 'construct:keyboard-conditions-sheet', {
      operation: 'Keyboard.on-key-pressed', parameters: [65],
    })
    expect(pressTrace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:key-pressed-event', status: 'passed' }))
    expect(pressTrace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:other-key-pressed-event', status: 'skipped' }))
    expect(conditionCalls).toHaveLength(1)
  })

  it('delegates Mouse state checks and dispatches matching click and movement triggers', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'mouse-conditions-sheet',
      events: [
        { eventType: 'block', sid: 'mouse-button-event', conditions: [{
          id: 'mouse-button-is-down', objectClass: 'Mouse', sid: 'mouse-button-condition',
          parameters: { 'mouse-button': 'right' },
        }], actions: [] },
        { eventType: 'block', sid: 'pointer-lock-event', conditions: [{
          id: 'has-pointer-lock', objectClass: 'Mouse', sid: 'pointer-lock-condition', isInverted: true,
        }], actions: [] },
        { eventType: 'block', sid: 'left-click-event', conditions: [{
          id: 'on-click', objectClass: 'Mouse', sid: 'left-click-condition',
          parameters: { 'mouse-button': 'left', 'click-type': 'clicked' },
        }], actions: [{
          id: 'request-pointer-lock', objectClass: 'Mouse', sid: 'request-pointer-lock-action',
          parameters: { 'unadjusted-movement': false },
        }] },
        { eventType: 'block', sid: 'right-click-event', conditions: [{
          id: 'on-click', objectClass: 'Mouse', sid: 'right-click-condition',
          parameters: { 'mouse-button': 'right', 'click-type': 'clicked' },
        }], actions: [] },
        { eventType: 'block', sid: 'movement-event', conditions: [{
          id: 'on-movement', objectClass: 'Mouse', sid: 'movement-condition',
        }], actions: [] },
      ],
    }))
    const host = makeHost([])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly unknown[]; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return operation === 'Mouse.mouse-button-is-down'
    }
    host.callAction = (objectClass, actionId, instances, parameters) => {
      actionCalls.push({ objectClass, actionId, instances, parameters })
    }
    const runtime = createConstructRuntime(host)
    const compiled = compileConstruct(imported.document).compiled

    const frameTrace = runtime.run(compiled, 'construct:mouse-conditions-sheet')
    expect(conditionCalls).toEqual([
      { operation: 'Mouse.mouse-button-is-down', parameters: ['right'] },
      { operation: 'Mouse.has-pointer-lock', parameters: [] },
    ])
    expect(frameTrace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:mouse-button-event', status: 'passed' }))
    expect(frameTrace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:pointer-lock-event', status: 'passed' }))

    const clickTrace = runtime.dispatchTrigger(compiled, 'construct:mouse-conditions-sheet', {
      operation: 'Mouse.on-click', parameters: ['left', 'clicked'],
    })
    expect(clickTrace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:left-click-event', status: 'passed' }))
    expect(clickTrace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:right-click-event', status: 'skipped' }))
    expect(conditionCalls).toHaveLength(2)
    expect(actionCalls).toEqual([{
      objectClass: 'Mouse', actionId: 'request-pointer-lock', instances: [], parameters: [false],
    }])

    const movementTrace = runtime.dispatchTrigger(compiled, 'construct:mouse-conditions-sheet', {
      operation: 'Mouse.on-movement',
    })
    expect(movementTrace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:movement-event', status: 'passed' }))
    expect(imported.status).toBe('complete')
  })

  it('delegates Mouse Cursor is over object checks and applies inversion', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'mouse-cursor-over-object-sheet',
      events: [
        { eventType: 'block', sid: 'cursor-over-player-event', conditions: [{
          id: 'cursor-is-over-object', objectClass: 'Mouse', sid: 'cursor-over-player',
          parameters: { object: 'Player' },
        }], actions: [] },
        { eventType: 'block', sid: 'cursor-not-over-enemy-event', conditions: [{
          id: 'cursor-is-over-object', objectClass: 'Mouse', sid: 'cursor-not-over-enemy',
          parameters: { object: 'Enemy' }, isInverted: true,
        }], actions: [] },
      ],
    }))
    const host = makeHost([])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return parameters[0] === 'Player'
    }
    const runtime = createConstructRuntime(host)
    const compiled = compileConstruct(imported.document).compiled

    const frameTrace = runtime.run(compiled, 'construct:mouse-cursor-over-object-sheet')

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics).toEqual([])
    expect(conditionCalls).toEqual([
      { operation: 'Mouse.cursor-is-over-object', parameters: ['Player'] },
      { operation: 'Mouse.cursor-is-over-object', parameters: ['Enemy'] },
    ])
    expect(frameTrace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:cursor-over-player-event', status: 'passed' }))
    expect(frameTrace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:cursor-not-over-enemy-event', status: 'passed' }))
  })

  it('delegates Touch Has Nth touch with its zero-based touch index', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'touch-index-sheet',
      events: [{ eventType: 'block', sid: 'second-touch-event', conditions: [{
        id: 'has-nth-touch', objectClass: 'Touch', sid: 'second-touch-condition',
        parameters: { 'touch-number': '1' },
      }], actions: [] }],
    }))
    const host = makeHost([])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return operation === 'Touch.has-nth-touch' && parameters[0] === 1
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:touch-index-sheet',
    )

    expect(conditionCalls).toEqual([{ operation: 'Touch.has-nth-touch', parameters: [1] }])
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:second-touch-event', status: 'passed' }))
    expect(imported.status).toBe('complete')
  })

  it('imports, exports, and delegates Touch Is touching object', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'touching-object-sheet',
      events: [{
        eventType: 'block', sid: 'touching-object-event',
        conditions: [{
          id: 'is-touching-object', objectClass: 'Touch', sid: 'touching-object-condition',
          isInverted: true,
          parameters: { object: 'UI_TouchHelper' },
        }],
        actions: [],
      }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a Touch condition sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'touching-object-event', conditions: [{
        id: 'is-touching-object', objectClass: 'Touch', sid: 'touching-object-condition',
        isInverted: true,
        parameters: { object: 'UI_TouchHelper' },
      }],
      actions: [],
    }])
    const host = makeHost([])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return false
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:touching-object-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([{
      operation: 'Touch.is-touching-object', parameters: ['UI_TouchHelper'],
    }])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'event', nodeId: 'construct:touching-object-event', status: 'passed',
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'touch-is-touching-object-condition', status: 'TESTED',
    }))
  })

  it('imports, exports, and dispatches Touch nth-touch triggers by index', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'touch-triggers-sheet',
      events: [{
        eventType: 'block', sid: 'touch-start-event', conditions: [{
          id: 'on-nth-touch-start', objectClass: 'Touch', sid: 'touch-start-condition',
          parameters: { 'touch-number': '0' },
        }], actions: [],
      }, {
        eventType: 'block', sid: 'touch-end-event', conditions: [{
          id: 'on-nth-touch-end', objectClass: 'Touch', sid: 'touch-end-condition',
          parameters: { 'touch-number': '0' },
        }], actions: [],
      }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a Touch trigger sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([
      {
        eventType: 'block', sid: 'touch-start-event', conditions: [{
          id: 'on-nth-touch-start', objectClass: 'Touch', sid: 'touch-start-condition',
          parameters: { 'touch-number': '0' },
        }], actions: [],
      },
      {
        eventType: 'block', sid: 'touch-end-event', conditions: [{
          id: 'on-nth-touch-end', objectClass: 'Touch', sid: 'touch-end-condition',
          parameters: { 'touch-number': '0' },
        }], actions: [],
      },
    ])
    const compiled = compileConstruct(imported.document, { registry: engine.registry }).compiled
    const runtime = createConstructRuntime(makeHost([]))
    const endTrace = runtime.dispatchTrigger(compiled, 'construct:touch-triggers-sheet', {
      operation: 'Touch.on-nth-touch-end', parameters: [0],
    })
    const otherIndexTrace = runtime.dispatchTrigger(compiled, 'construct:touch-triggers-sheet', {
      operation: 'Touch.on-nth-touch-start', parameters: [1],
    })

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(endTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'event', nodeId: 'construct:touch-end-event', status: 'passed',
    }))
    expect(endTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'event', nodeId: 'construct:touch-start-event', status: 'skipped',
    }))
    expect(otherIndexTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'event', nodeId: 'construct:touch-start-event', status: 'skipped',
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'touch-nth-touch-triggers', status: 'TESTED',
    }))
  })

  it('delegates System layer checks and layer/time actions to the host', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'system-layer-time-sheet',
      events: [{
        eventType: 'block', sid: 'system-layer-time-event',
        conditions: [
          { id: 'layer-is-visible', objectClass: 'System', sid: 'visible-condition', parameters: { layer: 'HUD' } },
          { id: 'layer-is-interactive', objectClass: 'System', sid: 'interactive-condition', parameters: { layer: 'HUD' } },
        ],
        actions: [
          { id: 'set-layer-visible', objectClass: 'System', sid: 'visible-action', parameters: { layer: 'HUD', visibility: 'invisible' } },
          { id: 'set-layer-interactive', objectClass: 'System', sid: 'interactive-action', parameters: { layer: 'HUD', interactive: false } },
          { id: 'set-time-scale', objectClass: 'System', sid: 'time-scale-action', parameters: { 'time-scale': '0.5' } },
        ],
      }],
    }))
    const host = makeHost([])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    const actionCalls: Array<{ objectClass: string; actionId: string; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return operation === 'System.layer-is-visible' || operation === 'System.layer-is-interactive'
    }
    host.callAction = (objectClass, actionId, _instances, parameters) => {
      actionCalls.push({ objectClass, actionId, parameters })
    }
    const runtime = createConstructRuntime(host)
    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:system-layer-time-sheet')

    expect(conditionCalls).toEqual([
      { operation: 'System.layer-is-visible', parameters: ['HUD'] },
      { operation: 'System.layer-is-interactive', parameters: ['HUD'] },
    ])
    expect(actionCalls).toEqual([
      { objectClass: 'System', actionId: 'set-layer-visible', parameters: ['HUD', 'invisible'] },
      { objectClass: 'System', actionId: 'set-layer-interactive', parameters: ['HUD', false] },
      { objectClass: 'System', actionId: 'set-time-scale', parameters: [0.5] },
    ])
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:system-layer-time-event', status: 'passed' }))
    expect(trace.entries.filter((entry) => entry.kind === 'action').map(({ status }) => status))
      .toEqual(['executed', 'executed', 'executed'])
  })

  it('imports, exports, and delegates System Pick overlapping point with picked instances', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'pick-overlapping-point-sheet',
      events: [{
        eventType: 'block', sid: 'pick-overlapping-point-event',
        conditions: [{
          id: 'pick-overlapping-point', objectClass: 'System', sid: 'pick-overlapping-point-condition',
          parameters: { object: 'Player', x: '10 + 2', y: '20' },
        }],
        actions: [{
          id: 'set-angle', objectClass: 'Player', sid: 'set-picked-angle',
          parameters: { angle: '90' },
        }],
      }, {
        eventType: 'block', sid: 'pick-non-overlapping-point-event',
        conditions: [{
          id: 'pick-overlapping-point', objectClass: 'System', sid: 'pick-non-overlapping-point-condition',
          isInverted: true,
          parameters: { object: 'Player', x: '10 + 2', y: '20' },
        }],
        actions: [{
          id: 'set-angle', objectClass: 'Player', sid: 'set-non-overlapping-angle',
          parameters: { angle: '180' },
        }],
      }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an overlapping point sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'pick-overlapping-point-event', conditions: [{
        id: 'pick-overlapping-point', objectClass: 'System', sid: 'pick-overlapping-point-condition',
        parameters: { object: 'Player', x: '10 + 2', y: '20' },
      }],
      actions: [{
        id: 'set-angle', objectClass: 'Player', sid: 'set-picked-angle',
        parameters: { angle: '90' },
      }],
      }, {
        eventType: 'block', sid: 'pick-non-overlapping-point-event',
        conditions: [{
          id: 'pick-overlapping-point', objectClass: 'System', sid: 'pick-non-overlapping-point-condition',
          isInverted: true,
          parameters: { object: 'Player', x: '10 + 2', y: '20' },
        }],
        actions: [{
          id: 'set-angle', objectClass: 'Player', sid: 'set-non-overlapping-angle',
          parameters: { angle: '180' },
        }],
      }])
    const inside: Instance = { type: 'Player', properties: { id: 'inside' } }
    const outside: Instance = { type: 'Player', properties: { id: 'outside' } }
    const host = makeHost([inside, outside])
    const pointCalls: Array<{ objectType: string; x: number; y: number; candidates: readonly Instance[] }> = []
    const actionCalls: Array<{ instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.pickOverlappingPoint = (objectType, x, y, candidates) => {
      pointCalls.push({ objectType, x, y, candidates })
      return [inside]
    }
    host.callAction = (_objectClass, _actionId, instances, parameters) => {
      actionCalls.push({ instances, parameters })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:pick-overlapping-point-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(pointCalls).toEqual([
      { objectType: 'Player', x: 12, y: 20, candidates: [inside, outside] },
      { objectType: 'Player', x: 12, y: 20, candidates: [inside, outside] },
    ])
    expect(actionCalls).toEqual([
      { instances: [inside], parameters: [90] },
      { instances: [outside], parameters: [180] },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'system-pick-overlapping-point-condition', status: 'TESTED',
    }))
  })

  it('imports and delegates common Pick by unique ID with picked instances', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'pick-by-unique-id-sheet',
      events: [{ eventType: 'block', sid: 'pick-by-unique-id-event', conditions: [{
        id: 'pick-by-unique-id', objectClass: '3DBox', sid: 'pick-by-unique-id-condition',
        parameters: { 'unique-id': '42' },
      }], actions: [{
        id: 'set-angle', objectClass: '3DBox', sid: 'angle-picked-by-uid',
        parameters: { angle: '90' },
      }] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a UID picking sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'pick-by-unique-id-event', conditions: [{
        id: 'pick-by-unique-id', objectClass: '3DBox', sid: 'pick-by-unique-id-condition',
        parameters: { 'unique-id': '42' },
      }], actions: [{
        id: 'set-angle', objectClass: '3DBox', sid: 'angle-picked-by-uid',
        parameters: { angle: '90' },
      }],
    }])
    const matched: Instance = { type: '3DBox', properties: { uid: 42 } }
    const other: Instance = { type: '3DBox', properties: { uid: 43 } }
    const host = {
      ...makeHost([matched, other]),
      pickInstanceByUniqueId: (objectType: string, uniqueId: number, candidates: readonly Instance[]) => {
        expect(objectType).toBe('3DBox')
        expect(uniqueId).toBe(42)
        expect(candidates).toEqual([matched, other])
        return matched
      },
    }
    const actionCalls: Array<{ instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (_objectClass, _actionId, instances, parameters) => {
      actionCalls.push({ instances, parameters })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:pick-by-unique-id-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(actionCalls).toEqual([{ instances: [matched], parameters: [90] }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-pick-by-unique-id-condition', status: 'TESTED',
    }))
  })

  it('delegates System interval and layout controls to the host', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'system-layout-controls-sheet',
      events: [{ eventType: 'block', sid: 'system-layout-controls-event', conditions: [{
        id: 'every-x-seconds', objectClass: 'System', sid: 'interval-condition',
        parameters: { 'interval-seconds': '0.5' },
      }], actions: [
        { id: 'restart-layout', objectClass: 'System', sid: 'restart-layout-action' },
        { id: 'set-layout-vanishing-point', objectClass: 'System', sid: 'vanishing-point-action', parameters: {
          'vanishing-point-x': 'round(25.4)', 'vanishing-point-y': '75',
        } },
      ] }],
    }))
    const host = makeHost([])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    const actionCalls: Array<{ objectClass: string; actionId: string; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return true
    }
    host.callAction = (objectClass, actionId, instances, parameters) => {
      expect(instances).toEqual([])
      actionCalls.push({ objectClass, actionId, parameters })
    }
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:system-layout-controls-sheet',
    )

    expect(conditionCalls).toEqual([{ operation: 'System.every-x-seconds', parameters: [0.5] }])
    expect(actionCalls).toEqual([
      { objectClass: 'System', actionId: 'restart-layout', parameters: [] },
      { objectClass: 'System', actionId: 'set-layout-vanishing-point', parameters: [25, 75] },
    ])
    expect(trace.entries.filter((entry) => entry.kind === 'action').map(({ status }) => status))
      .toEqual(['executed', 'executed'])
    expect(imported.status).toBe('complete')
  })

  it('delegates Gamepad button, axis, and fake-trigger conditions to the host each tick', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'gamepad-conditions-sheet',
      events: [
        { eventType: 'block', sid: 'gamepad-state-event', conditions: [
          { id: 'is-button-down', objectClass: 'Gamepad', sid: 'button-down-condition', parameters: { gamepad: '0', button: 'd-pad-up' } },
          { id: 'compare-axis', objectClass: 'Gamepad', sid: 'axis-condition', parameters: {
            gamepad: '0', axis: 'left-analog-x-axis', comparison: 1, value: '0',
          } },
        ], actions: [] },
        { eventType: 'block', sid: 'gamepad-button-pressed-event', conditions: [{
          id: 'on-button-pressed', objectClass: 'Gamepad', sid: 'button-pressed-condition',
          parameters: { gamepad: '0', button: 'button-a' },
        }], actions: [] },
      ],
    }))
    const host = makeHost([])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    let pressPulseAvailable = true
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      if (operation === 'Gamepad.on-button-pressed') {
        const pressed = pressPulseAvailable
        pressPulseAvailable = false
        return pressed
      }
      return true
    }
    const runtime = createConstructRuntime(host)
    const compiled = compileConstruct(imported.document).compiled

    const firstTick = runtime.run(compiled, 'construct:gamepad-conditions-sheet')
    const secondTick = runtime.run(compiled, 'construct:gamepad-conditions-sheet')

    expect(conditionCalls).toEqual([
      { operation: 'Gamepad.is-button-down', parameters: [0, 'd-pad-up'] },
      { operation: 'Gamepad.compare-axis', parameters: [0, 'left-analog-x-axis', 1, 0] },
      { operation: 'Gamepad.on-button-pressed', parameters: [0, 'button-a'] },
      { operation: 'Gamepad.is-button-down', parameters: [0, 'd-pad-up'] },
      { operation: 'Gamepad.compare-axis', parameters: [0, 'left-analog-x-axis', 1, 0] },
      { operation: 'Gamepad.on-button-pressed', parameters: [0, 'button-a'] },
    ])
    expect(firstTick.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:gamepad-state-event', status: 'passed' }))
    expect(firstTick.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:gamepad-button-pressed-event', status: 'passed' }))
    expect(secondTick.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:gamepad-button-pressed-event', status: 'failed' }))
  })

  it('delegates Browser fullscreen conditions and actions to the host with Construct parameters', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'browser-actions-sheet',
      events: [{
        eventType: 'block', sid: 'browser-actions-event',
        conditions: [{ id: 'is-fullscreen', objectClass: 'Browser', sid: 'fullscreen-condition' }],
        actions: [
          { id: 'alert', objectClass: 'Browser', sid: 'alert-action', parameters: { message: '"Mismatch: " & 3' } },
          { id: 'log', objectClass: 'Browser', sid: 'log-action', parameters: { type: 'warning', message: '"hello"' } },
          { id: 'cancel-fullscreen', objectClass: 'Browser', sid: 'cancel-fullscreen-action' },
          { id: 'request-fullscreen', objectClass: 'Browser', sid: 'request-fullscreen-action', parameters: {
            mode: 'stretch-letterbox-scale', 'navigation-ui': 'hide',
          } },
          { id: 'open-url-in-new-window', objectClass: 'Browser', sid: 'open-url-action', parameters: {
            url: '"https://example.test"', tag: '"NewWindow"',
          } },
          { id: 'reload', objectClass: 'Browser', sid: 'reload-action' },
        ],
      }],
    }))
    const host = makeHost([])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    const actionCalls: Array<{ objectClass: string; actionId: string; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return operation === 'Browser.is-fullscreen'
    }
    host.callAction = (objectClass, actionId, _instances, parameters) => {
      actionCalls.push({ objectClass, actionId, parameters })
    }
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:browser-actions-sheet',
    )

    expect(conditionCalls).toEqual([{ operation: 'Browser.is-fullscreen', parameters: [] }])
    expect(actionCalls).toEqual([
      { objectClass: 'Browser', actionId: 'alert', parameters: ['Mismatch: 3'] },
      { objectClass: 'Browser', actionId: 'log', parameters: ['warning', 'hello'] },
      { objectClass: 'Browser', actionId: 'cancel-fullscreen', parameters: [] },
      { objectClass: 'Browser', actionId: 'request-fullscreen', parameters: ['stretch-letterbox-scale', 'hide'] },
      { objectClass: 'Browser', actionId: 'open-url-in-new-window', parameters: ['https://example.test', 'NewWindow'] },
      { objectClass: 'Browser', actionId: 'reload', parameters: [] },
    ])
    expect(trace.entries.filter((entry) => entry.kind === 'action').map(({ status }) => status))
      .toEqual(['executed', 'executed', 'executed', 'executed', 'executed', 'executed'])
    expect(imported.status).toBe('complete')
  })

  it('delegates WebSocket text messages to the host as a static action', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'websocket-send-text-sheet',
      events: [{ eventType: 'block', sid: 'websocket-send-text-event', conditions: [], actions: [{
        id: 'send-text', objectClass: 'WebSocket', sid: 'send-text-action',
        parameters: { data: '"Hello " & "server"' },
      }] }],
    }))
    const host = makeHost([])
    const actionCalls: Array<{ objectClass: string; actionId: string; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, actionId, instances, parameters) => {
      expect(instances).toEqual([])
      actionCalls.push({ objectClass, actionId, parameters })
    }
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:websocket-send-text-sheet',
    )

    expect(actionCalls).toEqual([{ objectClass: 'WebSocket', actionId: 'send-text', parameters: ['Hello server'] }])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'action', nodeId: 'construct:send-text-action', status: 'executed',
    }))
    expect(imported.status).toBe('complete')
  })

  it('imports and executes the WebSocket connection ACE subset', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'WebSocket connection sample',
        uniqueId: 'websocket-connection-sample',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'websocket-connection-sheet',
        events: [{ eventType: 'block', sid: 'connect-when-open', conditions: [{
          id: 'is-open', objectClass: 'WebSocket', sid: 'is-open-condition',
        }], actions: [{
          id: 'connect', objectClass: 'WebSocket', sid: 'connect-action',
          parameters: { url: '"wss://example.test/socket"', 'protocol-optional': '""' },
        }] }, {
          eventType: 'block', sid: 'websocket-opened-event', conditions: [{
            id: 'on-opened', objectClass: 'WebSocket', sid: 'websocket-opened-condition',
          }], actions: [],
        }, {
          eventType: 'block', sid: 'websocket-message-event', conditions: [{
            id: 'on-message', objectClass: 'WebSocket', sid: 'websocket-message-condition',
          }], actions: [],
        }],
      }),
      'objectTypes/Utilities/WebSocket.json': JSON.stringify({
        name: 'WebSocket', 'plugin-id': 'C2WebSocket',
      }),
    })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a WebSocket project sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([
      {
        eventType: 'block', sid: 'connect-when-open', conditions: [{
          id: 'is-open', objectClass: 'WebSocket', sid: 'is-open-condition',
        }], actions: [{
          id: 'connect', objectClass: 'WebSocket', sid: 'connect-action',
          parameters: { url: '"wss://example.test/socket"', 'protocol-optional': '""' },
        }],
      }, {
        eventType: 'block', sid: 'websocket-opened-event', conditions: [{
          id: 'on-opened', objectClass: 'WebSocket', sid: 'websocket-opened-condition',
        }], actions: [],
      }, {
        eventType: 'block', sid: 'websocket-message-event', conditions: [{
          id: 'on-message', objectClass: 'WebSocket', sid: 'websocket-message-condition',
        }], actions: [],
      },
    ])
    const host = makeHost([])
    const conditionCalls: string[] = []
    const actionCalls: Array<{ objectClass: string; actionId: string; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation) => {
      conditionCalls.push(operation)
      return true
    }
    host.callAction = (objectClass, actionId, _instances, parameters) => {
      actionCalls.push({ objectClass, actionId, parameters })
    }
    const runtime = createConstructRuntime(host)
    const compiled = compileConstruct(imported.document).compiled
    const runTrace = runtime.run(compiled, 'construct:websocket-connection-sheet')
    const openedTrace = runtime.dispatchTrigger(compiled, 'construct:websocket-connection-sheet', {
      operation: 'WebSocket.on-opened',
    })
    const messageTrace = runtime.dispatchTrigger(compiled, 'construct:websocket-connection-sheet', {
      operation: 'WebSocket.on-message',
    })

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action' || code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual(['WebSocket.is-open'])
    expect(actionCalls).toEqual([{
      objectClass: 'WebSocket', actionId: 'connect', parameters: ['wss://example.test/socket', ''],
    }])
    expect(runTrace.status).toBe('complete')
    expect(openedTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:websocket-opened-condition', status: 'passed',
    }))
    expect(messageTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:websocket-message-condition', status: 'passed',
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'websocket-connection-ace-subset', status: 'TESTED',
    }))
  })

  it('imports and executes additional WebSocket connection state, close, and event ACEs', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'websocket-additional-aces-sheet',
      events: [{ eventType: 'block', sid: 'websocket-state-event', conditions: [
        { id: 'is-connecting', objectClass: 'WebSocket', sid: 'websocket-is-connecting' },
        { id: 'is-supported', objectClass: 'WebSocket', sid: 'websocket-is-supported' },
      ], actions: [{ id: 'close', objectClass: 'WebSocket', sid: 'websocket-close' }] }, ...[
        'on-closed', 'on-error', 'on-binary-message',
      ].map((id) => ({
        eventType: 'block', sid: `websocket-${id}-event`,
        conditions: [{
          id, objectClass: 'WebSocket', sid: `websocket-${id}`,
          ...(id === 'on-binary-message' ? { parameters: { 'receive-to': 'BinaryData' } } : {}),
        }], actions: [],
      }))],
    }))
    const host = makeHost([])
    const conditionCalls: string[] = []
    const actionCalls: string[] = []
    host.evaluateCondition = (operation) => {
      conditionCalls.push(operation)
      return true
    }
    host.callAction = (_objectClass, actionId) => actionCalls.push(actionId)
    const runtime = createConstructRuntime(host)
    const compiled = compileConstruct(imported.document).compiled
    const runTrace = runtime.run(compiled, 'construct:websocket-additional-aces-sheet')
    const triggers = ['on-closed', 'on-error', 'on-binary-message'].map((id) => runtime.dispatchTrigger(
      compiled,
      'construct:websocket-additional-aces-sheet',
      { operation: `WebSocket.${id}` },
    ))

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action' || code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual(['WebSocket.is-connecting', 'WebSocket.is-supported'])
    expect(actionCalls).toEqual(['close'])
    expect(runTrace.status).toBe('complete')
    expect(triggers.every(({ status }) => status === 'complete')).toBe(true)
  })

  it('preserves the Mouse wheel direction selector on host-dispatched triggers', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'mouse-wheel-sheet',
      events: [{ eventType: 'block', sid: 'mouse-wheel-event', conditions: [{
        id: 'on-mouse-wheel', objectClass: 'Mouse', sid: 'mouse-wheel-trigger',
        parameters: { direction: 'any' },
      }], actions: [] }],
    }))
    const compiled = compileConstruct(imported.document).compiled
    const trace = createConstructRuntime(makeHost([])).dispatchTrigger(
      compiled,
      'construct:mouse-wheel-sheet',
      { operation: 'Mouse.on-mouse-wheel', parameters: ['any'] },
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:mouse-wheel-trigger', status: 'passed',
    }))
  })

  it('resolves Sliderbar On changing through plugin metadata', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Sliderbar sample', uniqueId: 'sliderbar-sample', eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'sliderbar-sheet', events: [{ eventType: 'block', sid: 'sliderbar-event', conditions: [{
          id: 'on-changing', objectClass: 'UI_Slider_Octaves', sid: 'sliderbar-changing',
        }], actions: [] }],
      }),
      'objectTypes/UI/UI_Slider_Octaves.json': JSON.stringify({
        name: 'UI_Slider_Octaves', 'plugin-id': 'sliderbar',
      }),
    })
    const compiled = compileConstruct(imported.document).compiled
    const trace = createConstructRuntime(makeHost([])).dispatchTrigger(
      compiled,
      'construct:sliderbar-sheet',
      { operation: 'UI_Slider_Octaves.on-changing' },
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:sliderbar-changing', status: 'passed',
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'sliderbar-on-changing-trigger', status: 'TESTED',
    }))
  })

  it('dispatches Platform On landed and Timer On timer behavior triggers', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'behavior-triggers-sheet',
      events: [{ eventType: 'block', sid: 'landed-event', conditions: [{
        id: 'on-landed', objectClass: 'Player', behaviorType: 'Platform', sid: 'player-landed',
      }], actions: [] }, {
        eventType: 'block', sid: 'timer-event', conditions: [{
          id: 'on-timer', objectClass: 'Player', behaviorType: 'Timer', sid: 'player-on-timer',
          parameters: { tag: 'coyote' },
        }], actions: [],
      }],
    }))
    const compiled = compileConstruct(imported.document).compiled
    const runtime = createConstructRuntime(makeHost([]))
    const landedTrace = runtime.dispatchTrigger(compiled, 'construct:behavior-triggers-sheet', {
      operation: 'Player.on-landed', behaviorType: 'Platform',
    })
    const timerTrace = runtime.dispatchTrigger(compiled, 'construct:behavior-triggers-sheet', {
      operation: 'Player.on-timer', behaviorType: 'Timer', parameters: ['coyote'],
    })

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(landedTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:player-landed', status: 'passed',
    }))
    expect(timerTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:player-on-timer', status: 'passed',
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'platform-landed-and-timer-triggers', status: 'TESTED',
    }))
  })

  it('delegates Text Has tag at position with evaluated parameters', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Text tag hit test', uniqueId: 'text-tag-hit-test', eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'text-tag-sheet', events: [{ eventType: 'block', sid: 'text-tag-event', conditions: [{
          id: 'has-tag-at-position', objectClass: 'Text', sid: 'text-tag-condition',
          parameters: { tag: '"projecturl"', x: '10 + 2', y: '20 + 3' },
        }], actions: [] }],
      }),
      'objectTypes/Text.json': JSON.stringify({ name: 'Text', 'plugin-id': 'Text' }),
    })
    const textObject: Instance = { type: 'Text', properties: {} }
    const host = makeHost([textObject])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return true
    }
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:text-tag-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([{ operation: 'Text.has-tag-at-position', parameters: ['projecturl', 12, 23] }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'text-has-tag-at-position-condition', status: 'TESTED',
    }))
  })

  it('picks instances by the truthiness of a per-instance expression', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'pick-by-evaluate-sheet',
      events: [{ eventType: 'block', sid: 'pick-by-evaluate-event', conditions: [{
        id: 'pick-by-evaluate', objectClass: 'System', sid: 'pick-by-evaluate-condition',
        parameters: { object: 'Player', expression: 'Player.X % 2' },
      }], actions: [{
        id: 'set-x', objectClass: 'Player', sid: 'set-picked-x', parameters: { value: '99' },
      }] }],
    }))
    const players: Instance[] = [
      { type: 'Player', properties: { X: 1 } },
      { type: 'Player', properties: { X: 2 } },
    ]
    const host = makeHost(players)
    const actionCalls: Array<{ instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (_objectClass, _actionId, instances, parameters) => actionCalls.push({ instances, parameters })
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:pick-by-evaluate-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(actionCalls).toEqual([{ instances: [players[0]], parameters: [99] }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'system-pick-by-evaluate-condition', status: 'TESTED',
    }))
  })

  it('delegates JSON compare-value and is-boolean-set checks with evaluated arguments', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Raycast JSON sample', uniqueId: 'raycast-json-sample', eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'raycast-json-sheet', events: [{ eventType: 'block', sid: 'raycast-json-event', conditions: [
          {
            id: 'compare-value', objectClass: 'RaycastJSON', sid: 'raycast-json-compare',
            parameters: { path: '"hasHit"', cmp: 0, value: '1 + 0' },
          },
          {
            id: 'is-boolean-set', objectClass: 'RaycastJSON', sid: 'raycast-json-boolean',
            parameters: { path: '"hasHit"' },
          },
        ], actions: [] }],
      }),
      'objectTypes/Data/RaycastJSON.json': JSON.stringify({
        name: 'RaycastJSON', 'plugin-id': 'Json', isGlobal: true,
      }),
    })
    const host = makeHost([])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return true
    }
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:raycast-json-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([
      { operation: 'RaycastJSON.compare-value', parameters: ['hasHit', 0, 1] },
      { operation: 'RaycastJSON.is-boolean-set', parameters: ['hasHit'] },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'json-value-condition-subset', status: 'TESTED',
    }))
  })

  it('delegates AdvancedRandom seed and octave actions through plugin metadata', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'AdvancedRandom sample', uniqueId: 'advanced-random-sample', eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'advanced-random-sheet', events: [{ eventType: 'block', sid: 'advanced-random-event', conditions: [], actions: [
          {
            id: 'seed', objectClass: 'AdvancedRandom', sid: 'advanced-random-seed',
            parameters: { seed: '100 + 23' },
          },
          {
            id: 'octaves', objectClass: 'AdvancedRandom', sid: 'advanced-random-octaves',
            parameters: { count: '2 + 3' },
          },
        ] }],
      }),
      'objectTypes/Utilities/AdvancedRandom.json': JSON.stringify({
        name: 'AdvancedRandom', 'plugin-id': 'AdvancedRandom',
      }),
    })
    const host = makeHost([{ type: 'AdvancedRandom', properties: {} }])
    const actionCalls: Array<{ objectClass: string; actionId: string; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, actionId, _instances, parameters) => actionCalls.push({ objectClass, actionId, parameters })
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:advanced-random-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'AdvancedRandom', actionId: 'seed', parameters: [123] },
      { objectClass: 'AdvancedRandom', actionId: 'octaves', parameters: [5] },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'advanced-random-seed-octaves-actions', status: 'TESTED',
    }))
  })

  it('resolves Tilemap size and tile-range actions through plugin metadata', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Tilemap range sample', uniqueId: 'tilemap-range-sample', eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'tilemap-range-sheet', events: [{ eventType: 'block', sid: 'tilemap-range-event', conditions: [], actions: [
          {
            id: 'set-size', objectClass: 'Terrain', sid: 'terrain-set-size',
            parameters: { width: '8 * 16', height: '8 * 8' },
          },
          {
            id: 'erase-tile-range', objectClass: 'Tilemap', sid: 'tilemap-erase-range',
            parameters: { 'tile-x': '0', 'tile-y': '1', width: '4', height: '5' },
          },
          {
            id: 'set-tile-range', objectClass: 'Terrain', sid: 'terrain-set-range',
            parameters: { 'tile-x': '2', 'tile-y': '3', width: '1', height: '6', tile: '0', state: 'normal' },
          },
        ] }],
      }),
      'objectTypes/Terrain.json': JSON.stringify({ name: 'Terrain', 'plugin-id': 'Tilemap' }),
      'objectTypes/Tilemap.json': JSON.stringify({ name: 'Tilemap', 'plugin-id': 'Tilemap' }),
    })
    const terrain: Instance = { type: 'Terrain', properties: {} }
    const tilemap: Instance = { type: 'Tilemap', properties: {} }
    const host = makeHost([terrain, tilemap])
    const actionCalls: Array<{ objectClass: string; actionId: string; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, actionId, _instances, parameters) => actionCalls.push({ objectClass, actionId, parameters })
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:tilemap-range-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'Terrain', actionId: 'set-size', parameters: [128, 64] },
      { objectClass: 'Tilemap', actionId: 'erase-tile-range', parameters: [0, 1, 4, 5] },
      { objectClass: 'Terrain', actionId: 'set-tile-range', parameters: [2, 3, 1, 6, 0, 'normal'] },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'tilemap-size-and-range-actions', status: 'TESTED',
    }))
  })

  it('dispatches generic enabled and collision-filter actions plus 8 Direction Stop', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'common-state-actions-sheet',
      events: [{ eventType: 'block', sid: 'common-state-actions-event', conditions: [], actions: [
        {
          id: 'set-solid-collision-filter', objectClass: 'Player', sid: 'solid-filter-action',
          parameters: { mode: 'inclusive', tags: 'SOLID_Player' },
        },
        {
          id: 'set-enabled', objectClass: 'Obstacles', sid: 'obstacles-set-enabled',
          parameters: { state: 'disabled' },
        },
        {
          id: 'stop', objectClass: 'Players', behaviorType: '8Direction', sid: 'players-stop',
        },
      ] }],
    }))
    const player: Instance = { type: 'Player', properties: {} }
    const obstacle: Instance = { type: 'Obstacles', properties: {} }
    const players: Instance = { type: 'Players', properties: {} }
    const host = makeHost([player, obstacle, players])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:common-state-actions-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'Player', actionId: 'set-solid-collision-filter', instances: [player], parameters: ['inclusive', 'SOLID_Player'], scope: undefined },
      { objectClass: 'Obstacles', actionId: 'set-enabled', instances: [obstacle], parameters: ['disabled'], scope: undefined },
      { objectClass: 'Players', actionId: 'stop', instances: [players], parameters: [], scope: { behaviorType: '8Direction' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-state-and-collision-action-subset', status: 'TESTED',
    }))
  })

  it('delegates Physics world gravity, stepping mode, and collision toggling', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'physics-configuration-sheet',
      events: [{ eventType: 'block', sid: 'physics-configuration-event', conditions: [], actions: [
        {
          id: 'set-world-gravity', objectClass: 'Players', behaviorType: 'Physics', sid: 'physics-gravity',
          parameters: { gravity: '0' },
        },
        {
          id: 'set-stepping-mode', objectClass: 'Players', behaviorType: 'Physics', sid: 'physics-stepping',
          parameters: { mode: 'fixed' },
        },
        {
          id: 'enabledisable-collisions', objectClass: 'Players', behaviorType: 'Physics', sid: 'physics-collisions',
          parameters: { object: 'Enemy', state: 'disable' },
        },
      ] }],
    }))
    const players: Instance = { type: 'Players', properties: {} }
    const host = makeHost([players])
    const actionCalls: Array<{ actionId: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (_objectClass, actionId, _instances, parameters, scope) => actionCalls.push({ actionId, parameters, scope })
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:physics-configuration-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { actionId: 'set-world-gravity', parameters: [0], scope: { behaviorType: 'Physics' } },
      { actionId: 'set-stepping-mode', parameters: ['fixed'], scope: { behaviorType: 'Physics' } },
      { actionId: 'enabledisable-collisions', parameters: ['Enemy', 'disable'], scope: { behaviorType: 'Physics' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'physics-world-configuration-action-subset', status: 'TESTED',
    }))
  })

  it('dispatches Sprite animation speed, Bullet motion angle, and layer-effect actions', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Animation and layer effect sample', uniqueId: 'animation-layer-effect-sample',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'animation-layer-effect-sheet', events: [{ eventType: 'block', sid: 'animation-layer-effect-event', conditions: [], actions: [
          {
            id: 'set-animation-speed', objectClass: 'fPlayer', sid: 'animation-speed',
            parameters: { speed: '6 * 2' },
          },
          {
            id: 'set-angle-of-motion', objectClass: 'Terrain', behaviorType: 'Bullet', sid: 'motion-angle',
            parameters: { angle: '90 + 45' },
          },
          {
            id: 'set-layer-effect-enabled', objectClass: 'System', sid: 'layer-effect',
            parameters: { layer: 'LAYER_Main3D', mode: 'enable', effect: 'EFFECTS_Fog' },
          },
        ] }],
      }),
      'objectTypes/Player.json': JSON.stringify({ name: 'fPlayer', 'plugin-id': 'Sprite' }),
      'objectTypes/Terrain.json': JSON.stringify({ name: 'Terrain', 'plugin-id': 'Tilemap' }),
    })
    const player: Instance = { type: 'fPlayer', properties: {} }
    const terrain: Instance = { type: 'Terrain', properties: {} }
    const host = makeHost([player, terrain])
    const actionCalls: Array<{ objectClass: string; actionId: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, _instances, parameters, scope) => actionCalls.push({ objectClass, actionId, parameters, scope })
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:animation-layer-effect-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'fPlayer', actionId: 'set-animation-speed', parameters: [12], scope: { pluginId: 'Sprite' } },
      { objectClass: 'Terrain', actionId: 'set-angle-of-motion', parameters: [135], scope: { behaviorType: 'Bullet' } },
      { objectClass: 'System', actionId: 'set-layer-effect-enabled', parameters: ['LAYER_Main3D', 'enable', 'EFFECTS_Fog'], scope: undefined },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'sprite-speed-bullet-angle-layer-effect-actions', status: 'TESTED',
    }))
  })

  it('delegates Cannon3DPhysics Raycast with evaluated ray and filter parameters', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'cannon3d-raycast-sheet',
      events: [{ eventType: 'block', sid: 'cannon3d-raycast-event', conditions: [], actions: [{
        id: 'Raycast', objectClass: 'PlayerCamera', behaviorType: 'Cannon3DPhysics', sid: 'player-camera-raycast',
        parameters: {
          tag: '"player"', fromX: '1 + 2', fromY: '3', fromZ: '4',
          toX: '5', toY: '6', toZ: '7', collisionFilterGroup: '-1', collisionFilterMask: '8',
          skipBackfaces: true, mode: 'closest',
        },
      }] }],
    }))
    const playerCamera: Instance = { type: 'PlayerCamera', properties: {} }
    const host = makeHost([playerCamera])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:cannon3d-raycast-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([{
      objectClass: 'PlayerCamera', actionId: 'Raycast', instances: [playerCamera],
      parameters: ['player', 3, 3, 4, 5, 6, 7, -1, 8, true, 'closest'],
      scope: { behaviorType: 'Cannon3DPhysics' },
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'cannon3d-physics-raycast-action', status: 'TESTED',
    }))
  })

  it('delegates common Set position and Keyboard Lock keyboard actions', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'position-and-keyboard-actions-sheet',
      events: [{ eventType: 'block', sid: 'position-and-keyboard-actions-event', conditions: [], actions: [
        {
          id: 'set-position', objectClass: 'TouchCursor', sid: 'touch-cursor-position',
          parameters: { x: '10 + 2', y: '20 + 3' },
        },
        {
          id: 'lock-keyboard', objectClass: 'Keyboard', sid: 'keyboard-lock',
          parameters: { keys: '"KeyW,KeyA"' },
        },
      ] }],
    }))
    const touchCursor: Instance = { type: 'TouchCursor', properties: {} }
    const host = makeHost([touchCursor])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, actionId, instances, parameters) => actionCalls.push({ objectClass, actionId, instances, parameters })
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:position-and-keyboard-actions-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'TouchCursor', actionId: 'set-position', instances: [touchCursor], parameters: [12, 23] },
      { objectClass: 'Keyboard', actionId: 'lock-keyboard', instances: [], parameters: ['KeyW,KeyA'] },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'position-and-keyboard-lock-actions', status: 'TESTED',
    }))
  })

  it('resets global variables and optionally static event variables', () => {
    const runReset = (sheetId: string, resetStatic: boolean) => {
      const imported = importConstruct(JSON.stringify({
        sid: sheetId,
        events: [{ eventType: 'block', sid: 'reset-event', conditions: [], actions: [
          { id: 'set-eventvar-value', objectClass: 'System', sid: 'set-score', parameters: { variable: 'score', value: '9' } },
          { id: 'set-eventvar-value', objectClass: 'System', sid: 'set-static', parameters: { variable: 'staticValue', value: '8' } },
          { id: 'reset-global-variables', objectClass: 'System', sid: 'reset-globals', ...(resetStatic ? { parameters: { 'reset-static': 'true' } } : {}) },
          { id: 'set-eventvar-value', objectClass: 'System', sid: 'observe-static', parameters: { variable: 'observed', value: 'staticValue' } },
        ] }],
      }))
      const event = imported.document.sheets[0]?.events[0]
      if (!event || event.type !== 'event') throw new Error('Expected a parsed event for the reset test.')
      event.variables = [{
        id: 'static-value-variable',
        name: 'staticValue',
        dataType: 'number',
        scope: 'local',
        initialValue: { type: 'literal', value: 5 },
        metadata: { construct: { raw: { isStatic: true } } },
      }]
      imported.document.variables.push(
        { id: 'score-variable', name: 'score', dataType: 'number', scope: 'global', initialValue: { type: 'literal', value: 2 } },
        { id: 'observed-variable', name: 'observed', dataType: 'number', scope: 'global', initialValue: { type: 'literal', value: 0 } },
      )
      const runtime = createConstructRuntime(makeHost([]))
      const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:' + sheetId)
      return { imported, runtime, trace }
    }

    const globalsOnly = runReset('reset-globals-only-sheet', false)
    expect(globalsOnly.runtime.variables.get('score')).toBe(2)
    expect(globalsOnly.runtime.variables.get('observed')).toBe(8)
    expect(globalsOnly.trace.entries.filter((entry) => entry.kind === 'action' && entry.status === 'unsupported')).toEqual([])
    expect(globalsOnly.imported.status).toBe('complete')

    const withStatic = runReset('reset-static-sheet', true)
    expect(withStatic.runtime.variables.get('score')).toBe(2)
    expect(withStatic.runtime.variables.get('observed')).toBe(5)
    expect(withStatic.trace.entries.filter((entry) => entry.kind === 'action' && entry.status === 'unsupported')).toEqual([])
    expect(withStatic.imported.status).toBe('complete')
  })

  it('filters instances by a common variable comparison and sets only the picked instances', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'common-instance-variable-sheet',
      events: [
        { eventType: 'block', sid: 'high-score-event', conditions: [{
          id: 'compare-instance-variable', objectClass: 'Player', sid: 'high-score-condition',
          parameters: { 'instance-variable': 'score', comparison: 5, value: '10' },
        }], actions: [{
          id: 'set-instvar-value', objectClass: 'Player', sid: 'set-high-score-action',
          parameters: { 'instance-variable': 'score', value: '20' },
        }] },
        { eventType: 'block', sid: 'low-score-event', conditions: [{
          id: 'compare-instance-variable', objectClass: 'Player', sid: 'low-score-condition', isInverted: true,
          parameters: { 'instance-variable': 'score', comparison: 5, value: '10' },
        }], actions: [{
          id: 'set-instvar-value', objectClass: 'Player', sid: 'set-low-score-action',
          parameters: { 'instance-variable': 'score', value: '0' },
        }] },
      ],
    }))
    const players: Instance[] = [
      { type: 'Player', properties: { score: 5 } },
      { type: 'Player', properties: { score: 15 } },
    ]
    const runtime = createConstructRuntime(makeHost(players))
    const compiled = compileConstruct(imported.document).compiled

    const trace = runtime.run(compiled, 'construct:common-instance-variable-sheet')

    expect(players.map(({ properties }) => properties.score)).toEqual([0, 20])
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:high-score-event', status: 'passed' }))
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'event', nodeId: 'construct:low-score-event', status: 'passed' }))
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'action', nodeId: 'construct:set-high-score-action', status: 'executed' }))
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'action', nodeId: 'construct:set-low-score-action', status: 'executed' }))
    expect(imported.status).toBe('complete')
  })

  it('applies host-supplied object picks during trigger dispatch', () => {
    const engine = createConstructEngine({ extensions: [{
      id: 'trigger-player.created',
      objectClass: 'Player',
      conditions: [{ id: 'on-created', category: 'general', name: 'On created', scriptName: 'OnCreated', isTrigger: true }],
      actions: [{ id: 'record', category: 'general', name: 'Record', scriptName: 'Record' }],
    }] })
    const imported = importConstruct(JSON.stringify({
      sid: 'created-trigger-sheet',
      events: [{ eventType: 'block', sid: 'created-event', conditions: [{
        id: 'on-created', objectClass: 'Player', sid: 'created-condition', parameters: {},
      }], actions: [{ id: 'record', objectClass: 'Player', sid: 'created-action', parameters: {} }] }],
    }), { registry: engine.registry })
    const players = [
      { type: 'Player', properties: { id: 'player-a' } },
      { type: 'Player', properties: { id: 'player-b' } },
    ]
    const createdPlayer = players[1]
    if (!createdPlayer) throw new Error('Expected a player instance for the trigger')
    const actionTargets: string[] = []
    const host = makeHost(players)
    host.callAction = (_objectClass, _actionId, instances) => {
      for (const instance of instances) actionTargets.push(String(instance.properties.id))
    }

    const trace = createConstructRuntime(host).dispatchTrigger(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:created-trigger-sheet',
      { operation: 'Player.on-created', selectionsByObjectType: { Player: [createdPlayer] } },
    )

    expect(actionTargets).toEqual(['player-b'])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'action', nodeId: 'construct:created-action', status: 'executed',
    }))
  })

  it('dispatches common On created and Tween On tweens finished triggers', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'object-and-tween-triggers-sheet',
      events: [{ eventType: 'block', sid: 'object-created-event', conditions: [{
        id: 'on-created', objectClass: '3DShape', sid: 'object-created-condition', parameters: {},
      }], actions: [] }, {
        eventType: 'block', sid: 'tweens-finished-event', conditions: [{
          id: 'on-tweens-finished', objectClass: '3DShape', behaviorType: 'Tween',
          sid: 'tweens-finished-condition', parameters: { tags: 'TWEEN_Color' },
        }], actions: [],
      }, {
        eventType: 'block', sid: 'any-tweens-finished-event', conditions: [{
          id: 'on-any-tweens-finished', objectClass: 'FocusHelperProjectile', behaviorType: 'Tween',
          sid: 'any-tweens-finished-condition', parameters: {},
        }], actions: [],
      }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an object trigger sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([
      { eventType: 'block', sid: 'object-created-event', conditions: [{
        id: 'on-created', objectClass: '3DShape', sid: 'object-created-condition', parameters: {},
      }], actions: [] },
      { eventType: 'block', sid: 'tweens-finished-event', conditions: [{
        id: 'on-tweens-finished', objectClass: '3DShape', behaviorType: 'Tween',
        sid: 'tweens-finished-condition', parameters: { tags: 'TWEEN_Color' },
      }], actions: [] },
      { eventType: 'block', sid: 'any-tweens-finished-event', conditions: [{
        id: 'on-any-tweens-finished', objectClass: 'FocusHelperProjectile', behaviorType: 'Tween',
        sid: 'any-tweens-finished-condition', parameters: {},
      }], actions: [] },
    ])
    const shape: Instance = { type: '3DShape', properties: {} }
    const projectile: Instance = { type: 'FocusHelperProjectile', properties: {} }
    const runtime = createConstructRuntime(makeHost([shape, projectile]))
    const compiled = compileConstruct(imported.document, { registry: engine.registry }).compiled
    const createdTrace = runtime.dispatchTrigger(compiled, 'construct:object-and-tween-triggers-sheet', {
      operation: '3DShape.on-created', selectionsByObjectType: { '3DShape': [shape] },
    })
    const tweenTrace = runtime.dispatchTrigger(compiled, 'construct:object-and-tween-triggers-sheet', {
      operation: '3DShape.on-tweens-finished', parameters: ['TWEEN_Color'],
      selectionsByObjectType: { '3DShape': [shape] },
    })
    const anyTweenTrace = runtime.dispatchTrigger(compiled, 'construct:object-and-tween-triggers-sheet', {
      operation: 'FocusHelperProjectile.on-any-tweens-finished',
      selectionsByObjectType: { FocusHelperProjectile: [projectile] },
    })

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(createdTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:object-created-condition', status: 'passed',
    }))
    expect(tweenTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:tweens-finished-condition', status: 'passed',
    }))
    expect(anyTweenTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:any-tweens-finished-condition', status: 'passed',
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'object-on-created-trigger', status: 'TESTED',
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'tween-on-tweens-finished-trigger', status: 'TESTED',
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'tween-on-any-tweens-finished-trigger', status: 'TESTED',
    }))
  })

  it('runs Trigger once while true on the first true tick and rearms after false', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'trigger-once-sheet',
      events: [{ eventType: 'block', sid: 'trigger-once-event', conditions: [
        { id: 'compare-two-values', objectClass: 'System', sid: 'state-condition', parameters: { 'first-value': 'state', comparison: 0, 'second-value': 1 } },
        { id: 'trigger-once-while-true', objectClass: 'System', sid: 'trigger-once-condition', parameters: {} },
      ], actions: [{
        id: 'set-eventvar-value', objectClass: 'System', sid: 'trigger-once-action',
        parameters: { variable: 'count', value: 'count + 1' },
      }] }],
    }))
    imported.document.variables.push(
      { id: 'state', name: 'state', dataType: 'number', scope: 'global', initialValue: { type: 'literal', value: 1 } },
      { id: 'count', name: 'count', dataType: 'number', scope: 'global', initialValue: { type: 'literal', value: 0 } },
    )
    const runtime = createConstructRuntime(makeHost([]))
    const compiled = compileConstruct(imported.document).compiled

    runtime.run(compiled, 'construct:trigger-once-sheet')
    runtime.run(compiled, 'construct:trigger-once-sheet')
    expect(runtime.variables.get('count')).toBe(1)

    runtime.variables.set('state', 0)
    runtime.run(compiled, 'construct:trigger-once-sheet')
    runtime.variables.set('state', 1)
    runtime.run(compiled, 'construct:trigger-once-sheet')
    expect(runtime.variables.get('count')).toBe(2)

    runtime.reset()
    runtime.run(compiled, 'construct:trigger-once-sheet')
    expect(runtime.variables.get('count')).toBe(1)
  })

  it('runs For Each once per picked instance and exposes LoopIndex', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'for-each-sheet',
      events: [{ eventType: 'block', sid: 'for-each-event', conditions: [
        { id: 'pick-by-comparison', objectClass: 'System', sid: 'prior-pick', parameters: { object: 'Player', 'first-value': 'Player.X', comparison: 4, 'second-value': 0 } },
        { id: 'for-each', objectClass: 'System', sid: 'for-each-condition', parameters: { object: 'Player' } },
      ], actions: [
        { id: 'set-eventvar-value', objectClass: 'System', sid: 'each-x', parameters: { variable: 'lastX', value: 'Player.X' } },
        { id: 'set-eventvar-value', objectClass: 'System', sid: 'each-index', parameters: { variable: 'lastIndex', value: 'LoopIndex' } },
      ] }],
    }))
    const runtime = createConstructRuntime(makeHost([
      { type: 'Player', properties: { X: 5 } },
      { type: 'Player', properties: { X: 15 } },
    ]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:for-each-sheet')

    expect(runtime.variables.get('lastX')).toBe(15)
    expect(runtime.variables.get('lastIndex')).toBe(1)
    expect(trace.entries.filter(({ kind, nodeId, status }) => kind === 'action' && nodeId === 'construct:each-x' && status === 'executed')).toHaveLength(2)
  })

  it('repeats the event body the requested number of times', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'repeat-sheet',
      events: [{ eventType: 'block', sid: 'repeat-event', conditions: [{
        id: 'repeat', objectClass: 'System', sid: 'repeat-condition', parameters: { count: 3 },
      }], actions: [{
        id: 'set-eventvar-value', objectClass: 'System', sid: 'repeat-action',
        parameters: { variable: 'lastIndex', value: 'LoopIndex' },
      }] }],
    }))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:repeat-sheet')

    expect(runtime.variables.get('lastIndex')).toBe(2)
    expect(trace.entries.filter(({ kind, nodeId, status }) => kind === 'action' && nodeId === 'construct:repeat-action' && status === 'executed')).toHaveLength(3)
  })

  it('skips empty For ranges and reports fractional bounds as unsupported', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'for-range-sheet',
      events: [
        { eventType: 'block', sid: 'empty-range-event', conditions: [{
          id: 'for', objectClass: 'System', sid: 'empty-range-condition',
          parameters: { name: 'empty', 'start-index': '3', 'end-index': '2' },
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'empty-range-action',
          parameters: { variable: 'ran', value: '1' },
        }] },
        { eventType: 'block', sid: 'fractional-range-event', conditions: [{
          id: 'for', objectClass: 'System', sid: 'fractional-range-condition',
          parameters: { name: 'fractional', 'start-index': '0.5', 'end-index': '2' },
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'fractional-range-action',
          parameters: { variable: 'ran', value: '2' },
        }] },
        { eventType: 'block', sid: 'oversized-range-event', conditions: [{
          id: 'for', objectClass: 'System', sid: 'oversized-range-condition',
          parameters: { name: 'oversized', 'start-index': '0', 'end-index': '10000' },
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'oversized-range-action',
          parameters: { variable: 'ran', value: '3' },
        }] },
      ],
    }))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:for-range-sheet')

    expect(runtime.variables.has('ran')).toBe(false)
    expect(trace.entries.find(({ kind, nodeId }) => kind === 'event' && nodeId === 'construct:empty-range-event')?.status)
      .toBe('failed')
    expect(trace.entries.find(({ kind, nodeId }) => kind === 'event' && nodeId === 'construct:fractional-range-event')?.status)
      .toBe('unsupported')
    expect(trace.entries.find(({ kind, nodeId }) => kind === 'event' && nodeId === 'construct:oversized-range-event')?.status)
      .toBe('unsupported')
    expect(trace.diagnostics.some(({ code, nodeId }) =>
      code === 'construct.runtime.invalid-for-range' && nodeId === 'construct:fractional-range-condition'))
      .toBe(true)
    expect(trace.diagnostics.some(({ code, nodeId }) =>
      code === 'construct.runtime.invalid-for-range' && nodeId === 'construct:oversized-range-condition'))
      .toBe(true)
  })

  it('treats comment events as runtime no-ops', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'comment-runtime-sheet',
      events: [
        { eventType: 'comment', sid: 'runtime-comment', text: 'Documentation only' },
        { eventType: 'block', sid: 'runtime-event', conditions: [], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'runtime-action',
          parameters: { variable: 'ran', value: '1' },
        }] },
      ],
    }))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:comment-runtime-sheet')

    expect(runtime.variables.get('ran')).toBe(1)
    expect(trace.entries.find(({ kind, nodeId }) => kind === 'event' && nodeId === 'construct:runtime-comment'))
      .toMatchObject({ status: 'skipped', details: { reason: 'comment' } })
  })

  it('skips action comments while continuing the event action list', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'action-comment-runtime-sheet',
      events: [{ eventType: 'block', sid: 'action-comment-runtime-event', conditions: [], actions: [
        { type: 'comment', text: 'Documentation only' },
        {
          id: 'set-eventvar-value', objectClass: 'System', sid: 'after-comment-action',
          parameters: { variable: 'ran', value: '1' },
        },
      ] }],
    }))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:action-comment-runtime-sheet')

    expect(runtime.variables.get('ran')).toBe(1)
    expect(trace.entries.find(({ kind, status }) => kind === 'action' && status === 'skipped'))
      .toMatchObject({ details: { reason: 'comment' } })
    expect(trace.status).toBe('complete')
  })

  it('does not let comment events change the previous event state used by Else', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'comment-else-sheet',
      events: [
        { eventType: 'block', sid: 'before-comment-event', conditions: [{
          id: 'every-tick', objectClass: 'System', sid: 'before-comment-condition',
        }], actions: [] },
        { eventType: 'comment', sid: 'between-event-and-else', text: 'A note between the events' },
        { eventType: 'block', sid: 'after-comment-else', conditions: [{
          id: 'else', objectClass: 'System', sid: 'after-comment-else-condition',
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'else-action',
          parameters: { variable: 'elseRan', value: '1' },
        }] },
      ],
    }))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:comment-else-sheet')

    expect(runtime.variables.has('elseRan')).toBe(false)
    expect(trace.entries.find(({ kind, nodeId }) => kind === 'event' && nodeId === 'construct:after-comment-else')?.status)
      .toBe('failed')
    expect(trace.status).toBe('complete')
  })

  it('evaluates Construct logical, string-building, and exponent operators', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'operators-sheet',
      events: [{ eventType: 'block', sid: 'operators-event', conditions: [{
        id: 'compare-two-values', objectClass: 'System', sid: 'operators-condition',
        parameters: { 'first-value': 'score = 2 | score = 3', comparison: 0, 'second-value': 1 },
      }], actions: [
        {
          id: 'set-eventvar-value', objectClass: 'System', sid: 'concat-action',
          parameters: { variable: 'label', value: '"score=" & score' },
        },
        {
          id: 'set-eventvar-value', objectClass: 'System', sid: 'power-action',
          parameters: { variable: 'power', value: '2 ^ 3' },
        },
      ] }],
    }))
    imported.document.variables.push({
      id: 'score', name: 'score', dataType: 'number', scope: 'global',
      initialValue: { type: 'literal', value: 2 },
    })
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:operators-sheet')

    expect(runtime.variables.get('label')).toBe('score=2')
    expect(runtime.variables.get('power')).toBe(8)
    expect(trace.entries.find(({ kind }) => kind === 'condition')).toMatchObject({ status: 'passed' })
    expect(trace.status).toBe('complete')
  })

  it.each([
    [0, 2, 2, true],
    [1, 2, 2, false],
    [2, 1, 2, true],
    [3, 2, 2, true],
    [4, 2, 1, true],
    [5, 2, 2, true],
  ])('uses Construct comparison option %i', (comparison, left, right, expected) => {
    const imported = importConstruct(JSON.stringify({
      sid: 'cmp-' + comparison,
      events: [{ eventType: 'block', sid: 'cmp-event', conditions: [{
        id: 'compare-two-values', objectClass: 'System', sid: 'cmp-condition',
        parameters: { 'first-value': left, comparison, 'second-value': right },
      }], actions: [] }],
  }))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:cmp-' + comparison)

    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', status: expected ? 'passed' : 'failed',
      details: expect.objectContaining({ result: expected }),
    }))
  })

  it('picks matching instances, passes selections to children, and resets sibling selections', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'selection-sheet',
      events: [
        {
          eventType: 'block', sid: 'pick-event', conditions: [{
            id: 'pick-by-comparison', objectClass: 'System', sid: 'pick-condition',
            parameters: { object: 'Player', 'first-value': 'Player.X', comparison: 4, 'second-value': 10 },
          }], actions: [],
          children: [
            { eventType: 'block', sid: 'child-event', conditions: [], actions: [{
              id: 'set-eventvar-value', objectClass: 'System', sid: 'child-action',
              parameters: { variable: 'childX', value: 'Player.X' },
            }] },
            { eventType: 'block', sid: 'pick-all-child', conditions: [{
              id: 'pick-all', objectClass: 'System', sid: 'pick-all-condition', parameters: { object: 'Player' },
            }], actions: [{
              id: 'set-eventvar-value', objectClass: 'System', sid: 'pick-all-action',
              parameters: { variable: 'afterPickAll', value: 'Player.X' },
            }] },
          ],
        },
        { eventType: 'block', sid: 'sibling-event', conditions: [], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'sibling-action',
          parameters: { variable: 'siblingX', value: 'Player.X' },
        }] },
      ],
    }))
    const runtime = createConstructRuntime(makeHost([
      { type: 'Player', properties: { X: 5 } },
      { type: 'Player', properties: { X: 15 } },
    ]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:selection-sheet')

    expect(runtime.variables.get('childX')).toBe(15)
    expect(runtime.variables.get('afterPickAll')).toBe(5)
    expect(runtime.variables.get('siblingX')).toBe(5)
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:pick-condition', status: 'passed',
      details: expect.objectContaining({ result: true, selectedCount: 1 }),
    }))
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'event', nodeId: 'construct:child-event', parentNodeId: 'construct:pick-event', status: 'passed',
    }))
  })

  it('skips actions and child events when a condition fails', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'skip-sheet',
      events: [{ eventType: 'block', sid: 'skip-event', conditions: [{
        id: 'compare-two-values', objectClass: 'System', sid: 'skip-condition',
        parameters: { 'first-value': 1, comparison: 0, 'second-value': 2 },
      }], actions: [{
        id: 'set-eventvar-value', objectClass: 'System', sid: 'skipped-action',
        parameters: { variable: 'shouldNotExist', value: 1 },
      }], children: [{ eventType: 'block', sid: 'skipped-child', conditions: [], actions: [] }] }],
    }))
    const runtime = createConstructRuntime(makeHost([]))

    const trace = runtime.run(compileConstruct(imported.document).compiled, 'construct:skip-sheet')

    expect(runtime.variables.has('shouldNotExist')).toBe(false)
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'action', status: 'skipped', nodeId: 'construct:skipped-action' }))
    expect(trace.entries).toContainEqual(expect.objectContaining({ kind: 'event', status: 'skipped', nodeId: 'construct:skipped-child' }))
  })

  it('evaluates host action arguments in the selected instance context', () => {
    const engine = createConstructEngine({ extensions: [{
      id: 'example.player',
      objectClass: 'Player',
      actions: [{
        id: 'set-health', category: 'general', name: 'Set health', scriptName: 'SetHealth',
        parameters: [{ id: 'value', type: 'number' }],
      }],
    }] })
    const imported = importConstruct(JSON.stringify({
      sid: 'host-action-sheet',
      events: [{ eventType: 'block', sid: 'host-action-event', conditions: [{
        id: 'pick-by-comparison', objectClass: 'System', sid: 'host-pick',
        parameters: { object: 'Player', 'first-value': 'Player.X', comparison: 4, 'second-value': 10 },
      }], actions: [{
        id: 'set-health', objectClass: 'Player', sid: 'host-action',
        parameters: { value: 'Player.X + 1' },
      }] }],
    }), { registry: engine.registry })
    const players = [
      { type: 'Player', properties: { X: 5 } },
      { type: 'Player', properties: { X: 15 } },
    ]
    const host = makeHost(players)
    const calls: Array<{ instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (_objectClass, _actionId, instances, parameters) => calls.push({ instances, parameters })
    const runtime = createConstructRuntime(host)

    const trace = runtime.run(compileConstruct(imported.document, { registry: engine.registry }).compiled, 'construct:host-action-sheet')

    expect(calls).toEqual([{ instances: [players[1]], parameters: [16] }])
    expect(trace.entries.find(({ kind, nodeId }) => kind === 'action' && nodeId === 'construct:host-action'))
      .toMatchObject({ status: 'executed', details: { selectedCount: 1 } })
  })

  it('delegates Tilemap Set tile with evaluated coordinates and tile ID', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'tilemap-set-tile-sheet',
      events: [{ eventType: 'block', sid: 'tilemap-set-tile-event', conditions: [], actions: [{
        id: 'set-tile', objectClass: 'Tilemap', sid: 'tilemap-set-tile-action',
        parameters: { 'tile-x': '1 + 2', 'tile-y': '4', tile: '2 * 3', state: 'normal' },
      }] }],
    }), { registry: engine.registry })
    const tilemap: Instance = { type: 'Tilemap', properties: {} }
    const host = makeHost([tilemap])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, actionId, instances, parameters) => {
      actionCalls.push({ objectClass, actionId, instances, parameters })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:tilemap-set-tile-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([{
      objectClass: 'Tilemap', actionId: 'set-tile', instances: [tilemap], parameters: [3, 4, 6, 'normal'],
    }])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'action', nodeId: 'construct:tilemap-set-tile-action', status: 'executed',
      details: { operation: 'Tilemap.set-tile', selectedCount: 1 },
    }))
    expect(trace.status).toBe('complete')
  })

  it('filters picked instances by common clockwise between-angles ranges', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'between-angles-sheet',
      events: [{ eventType: 'block', sid: 'between-angles-event', conditions: [{
        id: 'is-between-angles', objectClass: 'Players', sid: 'between-angles-condition',
        parameters: { 'first-angle': '300', 'second-angle': '60' },
      }], actions: [{
        id: 'set-x', objectClass: 'Players', sid: 'between-angles-action', parameters: { x: '25' },
      }] }],
    }), { registry: engine.registry })
    const players: Instance[] = [
      { type: 'Players', properties: { angle: 350 } },
      { type: 'Players', properties: { angle: 30 } },
      { type: 'Players', properties: { angle: 180 } },
    ]
    const host = makeHost(players)
    const actionCalls: Array<{ instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (_objectClass, _actionId, instances, parameters) => actionCalls.push({ instances, parameters })

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:between-angles-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(actionCalls).toEqual([
      { instances: [players[0]], parameters: [25] },
      { instances: [players[1]], parameters: [25] },
    ])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:between-angles-condition', status: 'passed',
      details: expect.objectContaining({ selectedCount: 2 }),
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-is-between-angles-condition', status: 'TESTED',
    }))
  })

  it('imports and dispatches common Set angle with an evaluated angle', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'set-angle-sheet',
      events: [{ eventType: 'block', sid: 'set-angle-event', conditions: [], actions: [{
        id: 'set-angle', objectClass: 'Player', sid: 'set-angle-action', parameters: { angle: '340 + 20' },
      }] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported Set angle sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'set-angle-event', conditions: [], actions: [{
        id: 'set-angle', objectClass: 'Player', sid: 'set-angle-action', parameters: { angle: '340 + 20' },
      }],
    }])
    const players: Instance[] = [
      { type: 'Player', properties: {} },
      { type: 'Player', properties: {} },
    ]
    const host = makeHost(players)
    const actionCalls: Array<{ instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (_objectClass, _actionId, instances, parameters) => actionCalls.push({ instances, parameters })

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:set-angle-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { instances: [players[0]], parameters: [360] },
      { instances: [players[1]], parameters: [360] },
    ])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'action', nodeId: 'construct:set-angle-action', status: 'executed',
      details: expect.objectContaining({ selectedCount: 2 }),
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-set-angle-action', status: 'TESTED',
    }))
  })

  it('imports and dispatches common Set angle toward position with evaluated coordinates', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'set-angle-toward-position-sheet',
      events: [{ eventType: 'block', sid: 'set-angle-toward-position-event', conditions: [], actions: [{
        id: 'set-angle-toward-position', objectClass: 'Player', sid: 'set-angle-toward-position-action',
        parameters: { x: '50 + 10', y: '100 - 25' },
      }] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a Set angle toward position sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events[0].actions).toEqual([{
      id: 'set-angle-toward-position', objectClass: 'Player', sid: 'set-angle-toward-position-action',
      parameters: { x: '50 + 10', y: '100 - 25' },
    }])
    const player: Instance = { type: 'Player', properties: {} }
    const host = makeHost([player])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, actionId, instances, parameters) => {
      actionCalls.push({ objectClass, actionId, instances, parameters })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:set-angle-toward-position-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([{
      objectClass: 'Player', actionId: 'set-angle-toward-position', instances: [player], parameters: [60, 75],
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-set-angle-toward-position-action', status: 'TESTED',
    }))
  })

  it('imports, exports, and dispatches common Set boolean instance variable', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'set-boolean-instvar-sheet',
      events: [{ eventType: 'block', sid: 'set-boolean-instvar-event', conditions: [], actions: [
        {
          id: 'set-boolean-instvar', objectClass: 'Player', sid: 'set-player-boolean',
          parameters: { 'instance-variable': 'isOnGround', value: 'true' },
        },
        {
          id: 'set-boolean-instvar', objectClass: 'Raycasting', sid: 'set-raycasting-boolean',
          parameters: { 'instance-variable': 'isFocused', value: 'false' },
        },
      ] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported boolean variable sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'set-boolean-instvar-event', conditions: [], actions: [
        {
          id: 'set-boolean-instvar', objectClass: 'Player', sid: 'set-player-boolean',
          parameters: { 'instance-variable': 'isOnGround', value: 'true' },
        },
        {
          id: 'set-boolean-instvar', objectClass: 'Raycasting', sid: 'set-raycasting-boolean',
          parameters: { 'instance-variable': 'isFocused', value: 'false' },
        },
      ],
    }])
    const player: Instance = { type: 'Player', properties: {} }
    const raycasting: Instance = { type: 'Raycasting', properties: {} }
    const host = makeHost([player, raycasting])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, actionId, instances, parameters) => {
      actionCalls.push({ objectClass, actionId, instances, parameters })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:set-boolean-instvar-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'Player', actionId: 'set-boolean-instvar', instances: [player], parameters: ['isOnGround', true] },
      { objectClass: 'Raycasting', actionId: 'set-boolean-instvar', instances: [raycasting], parameters: ['isFocused', false] },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-set-boolean-instance-variable-action', status: 'TESTED',
    }))
  })

  it('imports, exports, and delegates System Set collision cell size', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'collision-cell-size-sheet',
      events: [{ eventType: 'block', sid: 'collision-cell-size-event', conditions: [], actions: [{
        id: 'set-collision-cell-size', objectClass: 'System', sid: 'collision-cell-size-action',
        parameters: { width: '32 * 2', height: '16 * 4' },
      }] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported collision cell size sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'collision-cell-size-event', conditions: [], actions: [{
        id: 'set-collision-cell-size', objectClass: 'System', sid: 'collision-cell-size-action',
        parameters: { width: '32 * 2', height: '16 * 4' },
      }],
    }])
    const host = makeHost([])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, actionId, instances, parameters) => {
      actionCalls.push({ objectClass, actionId, instances, parameters })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:collision-cell-size-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([{
      objectClass: 'System', actionId: 'set-collision-cell-size', instances: [], parameters: [64, 64],
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'system-set-collision-cell-size-action', status: 'TESTED',
    }))
  })

  it('imports, exports, and delegates System Set layer scale', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'layer-scale-sheet',
      events: [{ eventType: 'block', sid: 'layer-scale-event', conditions: [], actions: [{
        id: 'set-layer-scale', objectClass: 'System', sid: 'layer-scale-action',
        parameters: { layer: 'LAYER_Tilemap', scale: 'LayerScale("Tilemap") + 0.1' },
      }] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported layer scale sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'layer-scale-event', conditions: [], actions: [{
        id: 'set-layer-scale', objectClass: 'System', sid: 'layer-scale-action',
        parameters: { layer: 'LAYER_Tilemap', scale: 'LayerScale("Tilemap") + 0.1' },
      }],
    }])
    const host = makeHost([])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.evaluateExpression = (callee, parameters) =>
      callee === 'LayerScale' && parameters[0] === 'Tilemap' ? 0.75 : undefined
    host.callAction = (objectClass, actionId, instances, parameters) => {
      actionCalls.push({ objectClass, actionId, instances, parameters })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:layer-scale-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([{
      objectClass: 'System', actionId: 'set-layer-scale', instances: [], parameters: ['LAYER_Tilemap', 0.85],
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'system-set-layer-scale-action', status: 'TESTED',
    }))
  })

  it('imports and delegates common Compare Y with an evaluated coordinate', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'compare-y-sheet',
      events: [{ eventType: 'block', sid: 'compare-y-event', conditions: [{
        id: 'compare-y', objectClass: 'fEnemy', sid: 'compare-y-condition',
        parameters: { comparison: 4, 'y-co-ordinate': 'LayoutHeight' },
      }], actions: [] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a Compare Y sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'compare-y-event', conditions: [{
        id: 'compare-y', objectClass: 'fEnemy', sid: 'compare-y-condition',
        parameters: { comparison: 4, 'y-co-ordinate': 'LayoutHeight' },
      }], actions: [],
    }])
    const host = makeHost([])
    const expressionCalls: string[] = []
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    host.evaluateExpression = (callee) => {
      expressionCalls.push(callee)
      return callee === 'LayoutHeight' ? 720 : undefined
    }
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return true
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:compare-y-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(expressionCalls).toEqual(['LayoutHeight'])
    expect(conditionCalls).toEqual([{ operation: 'fEnemy.compare-y', parameters: [4, 720] }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-compare-y-condition', status: 'TESTED',
    }))
  })

  it('delegates common Z elevation conditions and actions to the host', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'common-z-elevation-sheet',
      events: [{ eventType: 'block', sid: 'common-z-elevation-event', conditions: [{
        id: 'compare-z-elevation', objectClass: '3DProjectile', sid: 'compare-projectile-z',
        parameters: { which: 'z-elevation', comparison: 3, 'z-elevation': '10 + 5' },
      }], actions: [{
        id: 'set-z-elevation', objectClass: '3DProjectile', sid: 'set-projectile-z',
        parameters: { z: '20 + 5' },
      }] }],
    }), { registry: engine.registry })
    const projectile: Instance = { type: '3DProjectile', properties: {} }
    const host = makeHost([projectile])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return true
    }
    host.callAction = (objectClass, actionId, instances, parameters) => {
      actionCalls.push({ objectClass, actionId, instances, parameters })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:common-z-elevation-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action' || code === 'construct.unknown-condition'))
      .toEqual([])
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported Z elevation sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'common-z-elevation-event', conditions: [{
        id: 'compare-z-elevation', objectClass: '3DProjectile', sid: 'compare-projectile-z',
        parameters: { which: 'z-elevation', comparison: 3, 'z-elevation': '10 + 5' },
      }], actions: [{
        id: 'set-z-elevation', objectClass: '3DProjectile', sid: 'set-projectile-z',
        parameters: { z: '20 + 5' },
      }],
    }])
    expect(conditionCalls).toEqual([{
      operation: '3DProjectile.compare-z-elevation', parameters: ['z-elevation', 3, 15],
    }])
    expect(actionCalls).toEqual([{
      objectClass: '3DProjectile', actionId: 'set-z-elevation', instances: [projectile], parameters: [25],
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-z-elevation-aces', status: 'TESTED',
    }))
  })

  it('delegates common Set visible values for different object classes', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'common-set-visible-sheet',
      events: [{ eventType: 'block', sid: 'common-set-visible-event', conditions: [], actions: [
        {
          id: 'set-visible', objectClass: 'UI_TextInput', sid: 'set-visible-input',
          parameters: { visibility: 'visible' },
        },
        {
          id: 'set-visible', objectClass: '3DProjectile', sid: 'set-visible-projectile',
          parameters: { visibility: 'toggle' },
        },
        {
          id: 'set-visible', objectClass: 'TouchCursor', sid: 'set-visible-touch-cursor',
          parameters: { visibility: 'invisible' },
        },
      ] }],
    }), { registry: engine.registry })
    const textInput: Instance = { type: 'UI_TextInput', properties: {} }
    const projectile: Instance = { type: '3DProjectile', properties: {} }
    const touchCursor: Instance = { type: 'TouchCursor', properties: {} }
    const host = makeHost([textInput, projectile, touchCursor])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, actionId, instances, parameters) => {
      actionCalls.push({ objectClass, actionId, instances, parameters })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:common-set-visible-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'UI_TextInput', actionId: 'set-visible', instances: [textInput], parameters: ['visible'] },
      { objectClass: '3DProjectile', actionId: 'set-visible', instances: [projectile], parameters: ['toggle'] },
      { objectClass: 'TouchCursor', actionId: 'set-visible', instances: [touchCursor], parameters: ['invisible'] },
    ])
    expect(trace.entries.filter(({ kind, nodeId }) => kind === 'action' && nodeId.startsWith('construct:set-visible-')))
      .toHaveLength(3)
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-set-visible-action', status: 'TESTED',
    }))
  })

  it('filters common boolean instance-variable conditions across object classes', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'common-boolean-instance-variable-sheet',
      events: [
        { eventType: 'block', sid: 'player-boolean-event', conditions: [{
          id: 'is-boolean-instance-variable-set', objectClass: 'Player', sid: 'player-boolean-condition',
          parameters: { 'instance-variable': 'grounded' },
        }], actions: [{
          id: 'set-instvar-value', objectClass: 'Player', sid: 'mark-grounded-player',
          parameters: { 'instance-variable': 'picked', value: '1' },
        }] },
        { eventType: 'block', sid: 'sprite-inverted-boolean-event', conditions: [{
          id: 'is-boolean-instance-variable-set', objectClass: 'Sprite', sid: 'sprite-boolean-condition',
          parameters: { 'instance-variable': 'grounded' }, isInverted: true,
        }], actions: [{
          id: 'set-instvar-value', objectClass: 'Sprite', sid: 'mark-ungrounded-sprite',
          parameters: { 'instance-variable': 'picked', value: '1' },
        }] },
      ],
    }), { registry: engine.registry })
    const instances: Instance[] = [
      { type: 'Player', properties: { grounded: true, picked: 0 } },
      { type: 'Player', properties: { grounded: false, picked: 0 } },
      { type: 'Sprite', properties: { grounded: true, picked: 0 } },
      { type: 'Sprite', properties: { grounded: false, picked: 0 } },
    ]
    const host = makeHost(instances)
    const evaluatedConditions: string[] = []
    host.evaluateCondition = (operation) => {
      evaluatedConditions.push(operation)
      return false
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:common-boolean-instance-variable-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(instances.map(({ properties }) => properties.picked)).toEqual([1, 0, 0, 1])
    expect(evaluatedConditions).toEqual([])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:player-boolean-condition', status: 'passed',
      details: { operation: 'Player.is-boolean-instance-variable-set', result: true, selectedCount: 1 },
    }))
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:sprite-boolean-condition', status: 'passed',
      details: { operation: 'Sprite.is-boolean-instance-variable-set', result: true, selectedCount: 1 },
    }))
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-boolean-instance-variable-condition', status: 'TESTED',
    }))
  })

  it('picks direct children or all hierarchy descendants by object type', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'pick-children-sheet',
      events: [...['own', 'all'].map((which) => ({
        eventType: 'block', sid: 'pick-' + which, conditions: [
          {
            id: 'compare-instance-variable', objectClass: 'Parent', sid: 'pick-' + which + '-parent',
            parameters: { 'instance-variable': 'id', comparison: 0, value: '"p1"' },
          },
          {
            id: 'pick-children', objectClass: 'Parent', sid: 'pick-' + which + '-children',
            parameters: { child: 'Child', which },
          },
        ], actions: [{
          id: 'set-instvar-value', objectClass: 'Child', sid: 'mark-' + which,
          parameters: { 'instance-variable': 'picked', value: '1' },
        }],
      })), {
        eventType: 'block', sid: 'pick-intersection', conditions: [
          {
            id: 'compare-instance-variable', objectClass: 'Parent', sid: 'pick-intersection-parent',
            parameters: { 'instance-variable': 'id', comparison: 0, value: '"p1"' },
          },
          {
            id: 'compare-instance-variable', objectClass: 'Child', sid: 'pick-intersection-child',
            parameters: { 'instance-variable': 'id', comparison: 0, value: '"direct-2"' },
          },
          {
            id: 'pick-children', objectClass: 'Parent', sid: 'pick-intersection-children',
            parameters: { child: 'Child', which: 'all' },
          },
        ], actions: [{
          id: 'set-instvar-value', objectClass: 'Child', sid: 'mark-intersection',
          parameters: { 'instance-variable': 'filtered', value: '1' },
        }],
      }],
    }), { registry: engine.registry })
    const instances: Instance[] = [
      { type: 'Parent', properties: { id: 'p1' } },
      { type: 'Child', properties: { id: 'direct-1', parentId: 'p1', picked: 0, filtered: 0 } },
      { type: 'Child', properties: { id: 'direct-2', parentId: 'p1', picked: 0, filtered: 0 } },
      { type: 'Child', properties: { id: 'nested', parentId: 'direct-1', picked: 0, filtered: 0 } },
      { type: 'Parent', properties: { id: 'p2' } },
      { type: 'Child', properties: { id: 'other-parent', parentId: 'p2', picked: 0, filtered: 0 } },
    ]
    const host = makeHost(instances)
    host.getHierarchyChildren = (parent) => instances.filter(
      (instance) => instance.properties.parentId === parent.properties.id,
    )

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:pick-children-sheet',
    )

    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(instances.slice(1, 4).map(({ properties }) => properties.picked)).toEqual([1, 1, 1])
    expect(instances[5]?.properties.picked).toBe(0)
    expect(instances.slice(1, 4).map(({ properties }) => properties.filtered)).toEqual([0, 1, 0])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:pick-own-children', status: 'passed',
      details: { operation: 'Parent.pick-children', result: true, selectedCount: 2 },
    }))
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:pick-all-children', status: 'passed',
      details: { operation: 'Parent.pick-children', result: true, selectedCount: 3 },
    }))
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-pick-children-condition', status: 'TESTED',
    }))
    const exported = JSON.parse(exportConstructSheet(imported.document.sheets[0]!).output) as {
      events: Array<{ conditions: Array<{ id: string; parameters?: Record<string, string> }> }>
    }
    expect(exported.events.flatMap((event) => event.conditions
      .filter((condition) => condition.id === 'pick-children')
      .map((condition) => condition.parameters))).toEqual([
      { child: 'Child', which: 'own' },
      { child: 'Child', which: 'all' },
      { child: 'Child', which: 'all' },
    ])
  })

  it('reports Pick children as unsupported when the host has no hierarchy query', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'pick-children-without-host-hierarchy-sheet',
      events: [{
        eventType: 'block', sid: 'pick-children-without-host-hierarchy-event', conditions: [{
          id: 'pick-children', objectClass: 'Parent', sid: 'pick-children-without-host-hierarchy-condition',
          parameters: { child: 'Child', which: 'own' },
        }], actions: [{
          id: 'set-instvar-value', objectClass: 'Child', sid: 'pick-children-without-host-hierarchy-action',
          parameters: { 'instance-variable': 'picked', value: '1' },
        }],
      }],
    }), { registry: engine.registry })
    const instances: Instance[] = [
      { type: 'Parent', properties: {} },
      { type: 'Child', properties: { picked: 0 } },
    ]

    const trace = createConstructRuntime(makeHost(instances)).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:pick-children-without-host-hierarchy-sheet',
    )

    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition',
      nodeId: 'construct:pick-children-without-host-hierarchy-condition',
      status: 'unsupported',
    }))
    expect(trace.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.runtime.unsupported-condition',
      nodeId: 'construct:pick-children-without-host-hierarchy-condition',
    }))
    expect(instances[1]?.properties.picked).toBe(0)
  })

  it('resolves Set text by project plugin ID across object classes', () => {
    const imported = importConstruct({
      'project.c3proj': JSON.stringify({
        name: 'Plugin scoped text',
        uniqueId: 'plugin-scoped-text',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'plugin-scoped-text-sheet',
        events: [{ eventType: 'block', sid: 'plugin-scoped-text-event', conditions: [], actions: [
          {
            id: 'set-text', objectClass: 'UI_Text', sid: 'set-text-object',
            parameters: { text: '"Score: " & 12' },
          },
          {
            id: 'set-text', objectClass: 'UI_TextSF', sid: 'set-text-spritefont',
            parameters: { text: '"Lives: " & 3' },
          },
          {
            id: 'set-text', objectClass: 'UI_TextInput', sid: 'set-text-input',
            parameters: { text: '"Input: " & 9' },
          },
        ] }],
      }),
      'objectTypes/UI_Text.json': JSON.stringify({ name: 'UI_Text', 'plugin-id': 'Text' }),
      'objectTypes/UI_TextSF.json': JSON.stringify({ name: 'UI_TextSF', 'plugin-id': 'Spritefont2' }),
      'objectTypes/UI_TextInput.json': JSON.stringify({ name: 'UI_TextInput', 'plugin-id': 'TextBox' }),
    })
    const text: Instance = { type: 'UI_Text', properties: {} }
    const spritefont: Instance = { type: 'UI_TextSF', properties: {} }
    const textInput: Instance = { type: 'UI_TextInput', properties: {} }
    const host = makeHost([text, spritefont, textInput])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:plugin-scoped-text-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'UI_Text', actionId: 'set-text', instances: [text], parameters: ['Score: 12'], scope: { pluginId: 'Text' } },
      { objectClass: 'UI_TextSF', actionId: 'set-text', instances: [spritefont], parameters: ['Lives: 3'], scope: { pluginId: 'Spritefont2' } },
      { objectClass: 'UI_TextInput', actionId: 'set-text', instances: [textInput], parameters: ['Input: 9'], scope: { pluginId: 'TextBox' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'plugin-scoped-set-text-actions', status: 'TESTED',
    }))
  })

  it('resolves Particles Set rate by plugin ID with evaluated rates', () => {
    const imported = importConstruct({
      'project.c3proj': JSON.stringify({
        name: 'Particles plugin action',
        uniqueId: 'particles-set-rate',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'particles-set-rate-sheet',
        events: [{ eventType: 'block', sid: 'particles-set-rate-event', conditions: [], actions: [
          {
            id: 'set-rate', objectClass: 'PlayerParticles', sid: 'set-particles-rate',
            parameters: { rate: '50 * 2' },
          },
          {
            id: 'set-rate', objectClass: 'PlayerParticles', sid: 'stop-particles-rate',
            parameters: { rate: '0' },
          },
        ] }],
      }),
      'objectTypes/PlayerParticles.json': JSON.stringify({
        name: 'PlayerParticles', 'plugin-id': 'Particles',
      }),
    })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported Particles action sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'particles-set-rate-event', conditions: [], actions: [
        { id: 'set-rate', objectClass: 'PlayerParticles', sid: 'set-particles-rate', parameters: { rate: '50 * 2' } },
        { id: 'set-rate', objectClass: 'PlayerParticles', sid: 'stop-particles-rate', parameters: { rate: '0' } },
      ],
    }])
    const particles: Instance = { type: 'PlayerParticles', properties: {} }
    const host = makeHost([particles])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:particles-set-rate-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'PlayerParticles', actionId: 'set-rate', instances: [particles], parameters: [100], scope: { pluginId: 'Particles' } },
      { objectClass: 'PlayerParticles', actionId: 'set-rate', instances: [particles], parameters: [0], scope: { pluginId: 'Particles' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'particles-set-rate-action', status: 'TESTED',
    }))
  })

  it('resolves TextBox append, scroll, and text-changed ACEs from plugin metadata', () => {
    const imported = importConstruct({
      'project.c3proj': JSON.stringify({
        name: 'TextBox plugin ACEs',
        uniqueId: 'textbox-plugin-aces',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'textbox-plugin-sheet',
        events: [
          { eventType: 'block', sid: 'textbox-actions-event', conditions: [], actions: [
            {
              id: 'append-text', objectClass: 'UI_TextInput', sid: 'textbox-append-action',
              parameters: { text: '" logs"' },
            },
            { id: 'scroll-to-bottom', objectClass: 'UI_TextInput', sid: 'textbox-scroll-action' },
          ] },
          { eventType: 'block', sid: 'textbox-trigger-event', conditions: [{
            id: 'on-text-changed', objectClass: 'UI_TextInput', sid: 'textbox-changed-condition',
          }], actions: [{
            id: 'set-text', objectClass: 'UI_TextInput', sid: 'textbox-changed-action',
            parameters: { text: '"updated"' },
          }] },
        ],
      }),
      'objectTypes/UI_TextInput.json': JSON.stringify({ name: 'UI_TextInput', 'plugin-id': 'TextBox' }),
    })
    const textInput: Instance = { type: 'UI_TextInput', properties: {} }
    const host = makeHost([textInput])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }
    const runtime = createConstructRuntime(host)
    const compiled = compileConstruct(imported.document).compiled

    const runTrace = runtime.run(compiled, 'construct:textbox-plugin-sheet')
    const triggerTrace = runtime.dispatchTrigger(compiled, 'construct:textbox-plugin-sheet', {
      operation: 'UI_TextInput.on-text-changed',
    })

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action' || code === 'construct.unknown-condition'))
      .toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'UI_TextInput', actionId: 'append-text', instances: [textInput], parameters: [' logs'], scope: { pluginId: 'TextBox' } },
      { objectClass: 'UI_TextInput', actionId: 'scroll-to-bottom', instances: [textInput], parameters: [], scope: { pluginId: 'TextBox' } },
      { objectClass: 'UI_TextInput', actionId: 'set-text', instances: [textInput], parameters: ['updated'], scope: { pluginId: 'TextBox' } },
    ])
    expect(runTrace.status).toBe('complete')
    expect(triggerTrace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'text-box-input-action-trigger-subset', status: 'TESTED',
    }))
  })

  it('dispatches common On collision with both externally picked objects', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'collision-trigger-sheet',
      events: [{ eventType: 'block', sid: 'collision-trigger-event', conditions: [{
        id: 'on-collision-with-another-object', objectClass: 'Enemy', sid: 'collision-trigger-condition',
        parameters: { object: 'fEnemy' },
      }], actions: [
        { id: 'set-x', objectClass: 'Enemy', sid: 'collision-enemy-action', parameters: { x: '10' } },
        { id: 'set-y', objectClass: 'fEnemy', sid: 'collision-target-action', parameters: { y: '20' } },
      ] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported collision trigger sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'collision-trigger-event', conditions: [{
        id: 'on-collision-with-another-object', objectClass: 'Enemy', sid: 'collision-trigger-condition',
        parameters: { object: 'fEnemy' },
      }], actions: [
        { id: 'set-x', objectClass: 'Enemy', sid: 'collision-enemy-action', parameters: { x: '10' } },
        { id: 'set-y', objectClass: 'fEnemy', sid: 'collision-target-action', parameters: { y: '20' } },
      ],
    }])
    const enemy: Instance = { type: 'Enemy', properties: {} }
    const otherEnemy: Instance = { type: 'fEnemy', properties: {} }
    const host = makeHost([enemy, otherEnemy])
    const actionCalls: Array<{ objectClass: string; instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, _actionId, instances, parameters) => actionCalls.push({ objectClass, instances, parameters })

    const trace = createConstructRuntime(host).dispatchTrigger(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:collision-trigger-sheet',
      {
        operation: 'Enemy.on-collision-with-another-object',
        parameters: ['fEnemy'],
        selectionsByObjectType: { Enemy: [enemy], fEnemy: [otherEnemy] },
      },
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'Enemy', instances: [enemy], parameters: [10] },
      { objectClass: 'fEnemy', instances: [otherEnemy], parameters: [20] },
    ])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:collision-trigger-condition', status: 'passed',
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-on-collision-with-another-object-trigger', status: 'TESTED',
    }))
  })

  it('dispatches Mouse On object clicked with mouse parameters and picked object', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'mouse-object-clicked-sheet',
      events: [
        { eventType: 'block', sid: 'mouse-left-click-event', conditions: [{
          id: 'on-object-clicked', objectClass: 'Mouse', sid: 'mouse-left-click-condition',
          parameters: { 'mouse-button': 'left', 'click-type': 'clicked', 'object-clicked': 'Swatch' },
        }], actions: [{
          id: 'set-x', objectClass: 'Swatch', sid: 'mouse-left-click-action', parameters: { x: '10' },
        }] },
        { eventType: 'block', sid: 'mouse-right-click-event', conditions: [{
          id: 'on-object-clicked', objectClass: 'Mouse', sid: 'mouse-right-click-condition',
          parameters: { 'mouse-button': 'right', 'click-type': 'clicked', 'object-clicked': 'Swatch' },
        }], actions: [{
          id: 'set-x', objectClass: 'Swatch', sid: 'mouse-right-click-action', parameters: { x: '20' },
        }] },
        { eventType: 'block', sid: 'mouse-double-click-event', conditions: [{
          id: 'on-object-clicked', objectClass: 'Mouse', sid: 'mouse-double-click-condition',
          parameters: { 'mouse-button': 'left', 'click-type': 'double-clicked', 'object-clicked': 'Swatch' },
        }], actions: [{
          id: 'set-x', objectClass: 'Swatch', sid: 'mouse-double-click-action', parameters: { x: '30' },
        }] },
      ],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported Mouse trigger sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([
      { eventType: 'block', sid: 'mouse-left-click-event', conditions: [{
        id: 'on-object-clicked', objectClass: 'Mouse', sid: 'mouse-left-click-condition',
        parameters: { 'mouse-button': 'left', 'click-type': 'clicked', 'object-clicked': 'Swatch' },
      }], actions: [{
        id: 'set-x', objectClass: 'Swatch', sid: 'mouse-left-click-action', parameters: { x: '10' },
      }] },
      { eventType: 'block', sid: 'mouse-right-click-event', conditions: [{
        id: 'on-object-clicked', objectClass: 'Mouse', sid: 'mouse-right-click-condition',
        parameters: { 'mouse-button': 'right', 'click-type': 'clicked', 'object-clicked': 'Swatch' },
      }], actions: [{
        id: 'set-x', objectClass: 'Swatch', sid: 'mouse-right-click-action', parameters: { x: '20' },
      }] },
      { eventType: 'block', sid: 'mouse-double-click-event', conditions: [{
        id: 'on-object-clicked', objectClass: 'Mouse', sid: 'mouse-double-click-condition',
        parameters: { 'mouse-button': 'left', 'click-type': 'double-clicked', 'object-clicked': 'Swatch' },
      }], actions: [{
        id: 'set-x', objectClass: 'Swatch', sid: 'mouse-double-click-action', parameters: { x: '30' },
      }] },
    ])
    const swatch: Instance = { type: 'Swatch', properties: {} }
    const host = makeHost([swatch])
    const actionCalls: Array<{ instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (_objectClass, _actionId, instances, parameters) => actionCalls.push({ instances, parameters })
    const runtime = createConstructRuntime(host)
    const compiled = compileConstruct(imported.document, { registry: engine.registry }).compiled
    const dispatch = (button: 'left' | 'right', clickType: 'clicked' | 'double-clicked' = 'clicked') => runtime.dispatchTrigger(
      compiled,
      'construct:mouse-object-clicked-sheet',
      {
        operation: 'Mouse.on-object-clicked',
        parameters: [button, clickType, 'Swatch'],
        selectionsByObjectType: { Swatch: [swatch] },
      },
    )
    const leftTrace = dispatch('left')
    const rightTrace = dispatch('right')
    const doubleTrace = dispatch('left', 'double-clicked')

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(actionCalls).toEqual([
      { instances: [swatch], parameters: [10] },
      { instances: [swatch], parameters: [20] },
      { instances: [swatch], parameters: [30] },
    ])
    expect(leftTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:mouse-left-click-condition', status: 'passed',
    }))
    expect(rightTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:mouse-right-click-condition', status: 'passed',
    }))
    expect(doubleTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:mouse-double-click-condition', status: 'passed',
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'mouse-on-object-clicked-trigger', status: 'TESTED',
    }))
  })

  it('dispatches the parameterless Button On clicked trigger through plugin metadata', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Button click trigger',
        uniqueId: 'button-click-trigger',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'button-click-sheet',
        events: [{ eventType: 'block', sid: 'button-click-event', conditions: [{
          id: 'on-clicked', objectClass: 'UI_Button', sid: 'button-click-condition',
        }], actions: [] }],
      }),
      'objectTypes/UI/UI_Button.json': JSON.stringify({ name: 'UI_Button', 'plugin-id': 'Button' }),
    })
    const button: Instance = { type: 'UI_Button', properties: {} }
    const trace = createConstructRuntime(makeHost([button])).dispatchTrigger(
      compileConstruct(imported.document).compiled,
      'construct:button-click-sheet',
      { operation: 'UI_Button.on-clicked' },
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:button-click-condition', status: 'passed',
    }))
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'button-on-clicked-trigger', status: 'TESTED',
    }))
  })

  it('dispatches List On selection changed through plugin metadata', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'List selection trigger',
        uniqueId: 'list-selection-trigger',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'list-selection-sheet',
        events: [{ eventType: 'block', sid: 'list-selection-event', conditions: [{
          id: 'on-selection-changed', objectClass: 'UI_List_AutoUpdate', sid: 'list-selection-condition',
        }], actions: [] }],
      }),
      'objectTypes/UI/UI_List_AutoUpdate.json': JSON.stringify({ name: 'UI_List_AutoUpdate', 'plugin-id': 'List' }),
    })
    const list: Instance = { type: 'UI_List_AutoUpdate', properties: {} }
    const trace = createConstructRuntime(makeHost([list])).dispatchTrigger(
      compileConstruct(imported.document).compiled,
      'construct:list-selection-sheet',
      { operation: 'UI_List_AutoUpdate.on-selection-changed' },
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:list-selection-condition', status: 'passed',
    }))
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'list-selection-changed-trigger', status: 'TESTED',
    }))
  })

  it('imports and delegates DrawingCanvas actions for object and family plugin metadata', () => {
    const engine = createConstructEngine()
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'DrawingCanvas action sample',
        uniqueId: 'drawingcanvas-action-sample',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'drawingcanvas-actions-sheet',
        events: [{ eventType: 'block', sid: 'drawingcanvas-actions-event', conditions: [], actions: [
          { id: 'clear-canvas', objectClass: 'DrawingCanvas', sid: 'clear-canvas-action', parameters: { color: '"rgba(0, 0, 0, 0)"' } },
          { id: 'fill-rect', objectClass: 'DrawingCanvas', sid: 'fill-rect-action', parameters: {
            left: '0', top: '1', right: '4', bottom: '5', color: '123',
          } },
          { id: 'set-position', objectClass: 'DrawingCanvas', sid: 'set-position-action', parameters: { x: '10', y: '20' } },
          { id: 'set-size', objectClass: 'DrawingCanvas', sid: 'set-size-action', parameters: { width: '100', height: '80' } },
          { id: 'paste-object', objectClass: 'Canvases', sid: 'paste-object-action', parameters: {
            object: 'Drawables', effects: 'with-effects',
          } },
        ] }],
      }),
      'objectTypes/DrawingCanvas.json': JSON.stringify({ name: 'DrawingCanvas', 'plugin-id': 'DrawingCanvas' }),
      'families/Canvases.json': JSON.stringify({ name: 'Canvases', 'plugin-id': 'DrawingCanvas', members: ['DrawingCanvas'] }),
    })
    const drawingCanvas: Instance = { type: 'DrawingCanvas', properties: {} }
    const familyCanvas: Instance = { type: 'Canvases', properties: {} }
    const host = makeHost([drawingCanvas, familyCanvas])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:drawingcanvas-actions-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'DrawingCanvas', actionId: 'clear-canvas', instances: [drawingCanvas], parameters: ['rgba(0, 0, 0, 0)'], scope: { pluginId: 'DrawingCanvas' } },
      { objectClass: 'DrawingCanvas', actionId: 'fill-rect', instances: [drawingCanvas], parameters: [0, 1, 4, 5, 123], scope: { pluginId: 'DrawingCanvas' } },
      { objectClass: 'DrawingCanvas', actionId: 'set-position', instances: [drawingCanvas], parameters: [10, 20], scope: { pluginId: 'DrawingCanvas' } },
      { objectClass: 'DrawingCanvas', actionId: 'set-size', instances: [drawingCanvas], parameters: [100, 80], scope: { pluginId: 'DrawingCanvas' } },
      { objectClass: 'Canvases', actionId: 'paste-object', instances: [familyCanvas], parameters: ['Drawables', 'with-effects'], scope: { pluginId: 'DrawingCanvas' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'drawingcanvas-action-subset', status: 'TESTED',
    }))
  })

  it('resolves the JSON Has key condition from plugin metadata', () => {
    const imported = importConstruct({
      'project.c3proj': JSON.stringify({
        name: 'JSON plugin condition',
        uniqueId: 'json-plugin-condition',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'json-plugin-sheet',
        events: [
          { eventType: 'block', sid: 'json-has-key-event', conditions: [{
            id: 'has-key', objectClass: 'jOverrides', sid: 'json-has-key-condition',
            parameters: { path: 'settings.enabled' },
          }], actions: [] },
          { eventType: 'block', sid: 'json-missing-key-event', conditions: [{
            id: 'has-key', objectClass: 'jOverrides', sid: 'json-missing-key-condition', isInverted: true,
            parameters: { path: 'settings.missing' },
          }], actions: [] },
        ],
      }),
      'objectTypes/jOverrides.json': JSON.stringify({ name: 'jOverrides', 'plugin-id': 'Json' }),
    })
    const jsonObject: Instance = { type: 'jOverrides', properties: {} }
    const host = makeHost([jsonObject])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.evaluateCondition = (operation, parameters, _context, scope) => {
      conditionCalls.push({ operation, parameters, scope })
      return parameters[0] === 'settings.enabled'
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:json-plugin-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([
      { operation: 'jOverrides.has-key', parameters: ['settings.enabled'], scope: { pluginId: 'Json' } },
      { operation: 'jOverrides.has-key', parameters: ['settings.missing'], scope: { pluginId: 'Json' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'json-has-key-condition', status: 'TESTED',
    }))
  })

  it('resolves the JSON Parse action through plugin metadata and delegates its string', () => {
    const jsonText = '{"enabled":true}'
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'JSON Parse action',
        uniqueId: 'json-parse-action',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'json-parse-sheet',
        events: [{ eventType: 'block', sid: 'json-parse-event', conditions: [], actions: [{
          id: 'parse', objectClass: 'jRules', sid: 'json-parse-action',
          parameters: { data: jsonText },
        }] }],
      }),
      'objectTypes/jRules.json': JSON.stringify({ name: 'jRules', 'plugin-id': 'Json' }),
    })
    const jsonObject: Instance = { type: 'jRules', properties: {} }
    const host = makeHost([jsonObject])
    const actionCalls: Array<{
      objectClass: string
      actionId: string
      instances: readonly Instance[]
      parameters: readonly unknown[]
      scope: AceInvocationScope | undefined
    }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }
    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:json-parse-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([{
      objectClass: 'jRules', actionId: 'parse', instances: [jsonObject],
      parameters: [jsonText], scope: { pluginId: 'Json' },
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'json-parse-action-dispatch', status: 'TESTED',
    }))
  })

  it('resolves Camera3D actions from plugin metadata with evaluated coordinates', () => {
    const imported = importConstruct({
      'project.c3proj': JSON.stringify({
        name: 'Camera3D plugin actions',
        uniqueId: 'camera3d-plugin-actions',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'camera3d-plugin-sheet',
        events: [{ eventType: 'block', sid: 'camera3d-actions-event', conditions: [], actions: [
          {
            id: 'rotate-camera', objectClass: 'Camera', sid: 'camera3d-rotate',
            parameters: {
              'rotate-x': '45 + 5', 'rotate-y': '90 - 10',
              'min-polar-angle': '10', 'max-polar-angle': '170',
            },
          },
          {
            id: 'set-field-of-view', objectClass: 'Camera', sid: 'camera3d-set-fov',
            parameters: { fov: '60 + 5' },
          },
          {
            id: 'look-parallel-to-layout', objectClass: 'Camera', sid: 'camera3d-look-parallel',
            parameters: { 'cam-x': '1 + 2', 'cam-y': '4', 'cam-z': '5', 'look-angle': '90' },
          },
          {
            id: 'set-position', objectClass: 'Camera', sid: 'camera3d-set-position',
            parameters: { x: '10', y: '20', z: '30', which: 'camera' },
          },
        ] }],
      }),
      'objectTypes/Camera.json': JSON.stringify({ name: 'Camera', 'plugin-id': 'Camera3D' }),
    })
    const camera: Instance = { type: 'Camera', properties: {} }
    const host = makeHost([camera])
    const actionCalls: Array<{ objectClass: string; actionId: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, _instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:camera3d-plugin-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'Camera', actionId: 'rotate-camera', parameters: [50, 80, 10, 170], scope: { pluginId: 'Camera3D' } },
      { objectClass: 'Camera', actionId: 'set-field-of-view', parameters: [65], scope: { pluginId: 'Camera3D' } },
      { objectClass: 'Camera', actionId: 'look-parallel-to-layout', parameters: [3, 4, 5, 90], scope: { pluginId: 'Camera3D' } },
      { objectClass: 'Camera', actionId: 'set-position', parameters: [10, 20, 30, 'camera'], scope: { pluginId: 'Camera3D' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'camera3d-plugin-actions', status: 'TESTED',
    }))
  })

  it('resolves Audio tag checks and Play by name from plugin metadata', () => {
    const imported = importConstruct({
      'project.c3proj': JSON.stringify({
        name: 'Audio plugin ACEs',
        uniqueId: 'audio-plugin-aces',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'audio-plugin-sheet',
        events: [
          { eventType: 'block', sid: 'audio-playing-event', conditions: [{
            id: 'is-tag-playing', objectClass: 'Sound', sid: 'audio-playing-condition',
            parameters: { tag: 'effects' },
          }], actions: [] },
          { eventType: 'block', sid: 'audio-not-playing-event', conditions: [{
            id: 'is-tag-playing', objectClass: 'Sound', sid: 'audio-not-playing-condition', isInverted: true,
            parameters: { tag: 'missing' },
          }], actions: [] },
          { eventType: 'block', sid: 'audio-play-by-name-event', conditions: [], actions: [{
            id: 'play-by-name', objectClass: 'Sound', sid: 'audio-play-by-name',
            parameters: {
              folder: 'sounds', 'audio-file-name': 'jump', loop: 'not-looping',
              volume: '-6', 'stereo-pan': '25', 'tag-optional': 'effects jump',
            },
          }] },
        ],
      }),
      'objectTypes/Sound.json': JSON.stringify({ name: 'Sound', 'plugin-id': 'Audio' }),
    })
    const audio: Instance = { type: 'Sound', properties: {} }
    const host = makeHost([audio])
    const conditionCalls: Array<{ parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.evaluateCondition = (_operation, parameters, _context, scope) => {
      conditionCalls.push({ parameters, scope })
      return parameters[0] === 'effects'
    }
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:audio-plugin-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action' || code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([
      { parameters: ['effects'], scope: { pluginId: 'Audio' } },
      { parameters: ['missing'], scope: { pluginId: 'Audio' } },
    ])
    expect(actionCalls).toEqual([{
      objectClass: 'Sound', actionId: 'play-by-name', instances: [audio],
      parameters: ['sounds', 'jump', 'not-looping', -6, 25, 'effects jump'],
      scope: { pluginId: 'Audio' },
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'audio-plugin-tag-and-play-actions', status: 'TESTED',
    }))
  })

  it('resolves the List Compare selected item text condition through plugin metadata', () => {
    const imported = importConstruct({
      'project.c3proj': JSON.stringify({
        name: 'List selected item text condition',
        uniqueId: 'list-selected-item-text-condition',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'list-selected-item-text-sheet',
        events: [
          { eventType: 'block', sid: 'list-case-insensitive-event', conditions: [{
            id: 'compare-selected-item-text', objectClass: 'List', sid: 'list-case-insensitive',
            parameters: { 'text-to-compare': '"only input"', 'case-sensitivity': 'ignore-case' },
          }], actions: [] },
          { eventType: 'block', sid: 'list-case-sensitive-event', conditions: [{
            id: 'compare-selected-item-text', objectClass: 'List', sid: 'list-case-sensitive', isInverted: true,
            parameters: { 'text-to-compare': '"only output"', 'case-sensitivity': 'case-sensitive' },
          }], actions: [] },
        ],
      }),
      'objectTypes/UI/List.json': JSON.stringify({ name: 'List', 'plugin-id': 'List' }),
    })
    const list: Instance = { type: 'List', properties: {} }
    const host = makeHost([list])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.evaluateCondition = (operation, parameters, _context, scope) => {
      conditionCalls.push({ operation, parameters, scope })
      return parameters[1] === 'ignore-case'
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:list-selected-item-text-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([
      { operation: 'List.compare-selected-item-text', parameters: ['only input', 'ignore-case'], scope: { pluginId: 'List' } },
      { operation: 'List.compare-selected-item-text', parameters: ['only output', 'case-sensitive'], scope: { pluginId: 'List' } },
    ])
    expect(trace.entries.filter(({ kind }) => kind === 'condition').map(({ status }) => status)).toEqual(['passed', 'passed'])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'list-compare-selected-item-text-condition', status: 'TESTED',
    }))
  })

  it('resolves Sprite animation ACEs through family plugin metadata', () => {
    const imported = importConstruct({
      'project.c3proj': JSON.stringify({
        name: 'Sprite family animation ACEs',
        uniqueId: 'sprite-family-animation-aces',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'sprite-family-sheet',
        events: [
          { eventType: 'block', sid: 'sprite-animation-check-event', conditions: [{
            id: 'is-animation-playing', objectClass: 'fPlayer', sid: 'sprite-animation-check',
            parameters: { animation: 'ANIM_Walking' },
          }], actions: [] },
          { eventType: 'block', sid: 'sprite-animation-inverted-event', conditions: [{
            id: 'is-animation-playing', objectClass: 'fPlayer', sid: 'sprite-animation-inverted-check', isInverted: true,
            parameters: { animation: 'ANIM_Idle' },
          }], actions: [] },
          { eventType: 'block', sid: 'sprite-set-animation-event', conditions: [], actions: [{
            id: 'set-animation', objectClass: 'fPlayer', sid: 'sprite-set-animation',
            parameters: { animation: 'ANIM_Jumping', from: 'beginning' },
          }] },
        ],
      }),
      'families/fPlayer.json': JSON.stringify({
        name: 'fPlayer', 'plugin-id': 'Sprite', members: ['Player'],
      }),
    })
    const familyInstance: Instance = { type: 'fPlayer', properties: {} }
    const host = makeHost([familyInstance])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.evaluateCondition = (operation, parameters, _context, scope) => {
      conditionCalls.push({ operation, parameters, scope })
      return operation === 'fPlayer.is-animation-playing' && parameters[0] === 'ANIM_Walking'
    }
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:sprite-family-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action' || code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([
      { operation: 'fPlayer.is-animation-playing', parameters: ['ANIM_Walking'], scope: { pluginId: 'Sprite' } },
      { operation: 'fPlayer.is-animation-playing', parameters: ['ANIM_Idle'], scope: { pluginId: 'Sprite' } },
    ])
    expect(actionCalls).toEqual([{
      objectClass: 'fPlayer', actionId: 'set-animation', instances: [familyInstance],
      parameters: ['ANIM_Jumping', 'beginning'], scope: { pluginId: 'Sprite' },
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'sprite-animation-family-aces', status: 'TESTED',
    }))
  })

  it('resolves Sprite mirror ACEs through family and object plugin metadata', () => {
    const imported = importConstruct({
      'project.c3proj': JSON.stringify({
        name: 'Sprite mirror ACEs',
        uniqueId: 'sprite-mirror-aces',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'sprite-mirror-sheet',
        events: [
          { eventType: 'block', sid: 'sprite-bb-mirrored-event', conditions: [{
            id: 'is-mirrored', objectClass: 'bbPlayer', sid: 'sprite-bb-mirrored',
          }], actions: [{
            id: 'set-mirrored', objectClass: 'fPlayer', sid: 'sprite-family-set-normal',
            parameters: { state: 'not-mirrored' },
          }] },
          { eventType: 'block', sid: 'sprite-family-mirrored-event', conditions: [{
            id: 'is-mirrored', objectClass: 'fPlayer', sid: 'sprite-family-mirrored', isInverted: true,
          }], actions: [{
            id: 'set-mirrored', objectClass: 'bbPlayer', sid: 'sprite-bb-set-mirrored',
            parameters: { state: 'mirrored' },
          }] },
        ],
      }),
      'objectTypes/bbPlayer.json': JSON.stringify({ name: 'bbPlayer', 'plugin-id': 'Sprite' }),
      'families/fPlayer.json': JSON.stringify({ name: 'fPlayer', 'plugin-id': 'Sprite', members: ['Player'] }),
    })
    const familyInstance: Instance = { type: 'fPlayer', properties: {} }
    const spriteInstance: Instance = { type: 'bbPlayer', properties: {} }
    const host = makeHost([familyInstance, spriteInstance])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.evaluateCondition = (operation, parameters, _context, scope) => {
      conditionCalls.push({ operation, parameters, scope })
      return operation === 'bbPlayer.is-mirrored'
    }
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:sprite-mirror-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action' || code === 'construct.unknown-condition')).toEqual([])
    expect(JSON.parse(exportConstructSheet(imported.document.sheets[0]!).output).events).toEqual([
      {
        eventType: 'block', sid: 'sprite-bb-mirrored-event', conditions: [{
          id: 'is-mirrored', objectClass: 'bbPlayer', sid: 'sprite-bb-mirrored',
        }], actions: [{
          id: 'set-mirrored', objectClass: 'fPlayer', sid: 'sprite-family-set-normal',
          parameters: { state: 'not-mirrored' },
        }],
      },
      {
        eventType: 'block', sid: 'sprite-family-mirrored-event', conditions: [{
          id: 'is-mirrored', objectClass: 'fPlayer', sid: 'sprite-family-mirrored', isInverted: true,
        }], actions: [{
          id: 'set-mirrored', objectClass: 'bbPlayer', sid: 'sprite-bb-set-mirrored',
          parameters: { state: 'mirrored' },
        }],
      },
    ])
    expect(conditionCalls).toEqual([
      { operation: 'bbPlayer.is-mirrored', parameters: [], scope: { pluginId: 'Sprite' } },
      { operation: 'fPlayer.is-mirrored', parameters: [], scope: { pluginId: 'Sprite' } },
    ])
    expect(actionCalls).toEqual([
      {
        objectClass: 'fPlayer', actionId: 'set-mirrored', instances: [familyInstance],
        parameters: ['not-mirrored'], scope: { pluginId: 'Sprite' },
      },
      {
        objectClass: 'bbPlayer', actionId: 'set-mirrored', instances: [spriteInstance],
        parameters: ['mirrored'], scope: { pluginId: 'Sprite' },
      },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'sprite-mirror-aces', status: 'TESTED',
    }))
  })

  it('imports and delegates Sprite Spawn another object while preserving an omitted template name', () => {
    const actions = [
      {
        id: 'spawn-another-object', objectClass: 'Player', sid: 'spawn-helper-projectile',
        parameters: {
          object: 'FocusHelperProjectile', layer: 'LAYER_Main3D', 'image-point': '0',
          'create-hierarchy': false,
        },
      },
      {
        id: 'spawn-another-object', objectClass: 'Player', sid: 'spawn-text-template',
        parameters: {
          object: 'UI_TextSF', layer: 'LAYER_UI', 'image-point': 'IP_Blurb',
          'create-hierarchy': false, 'template-name': 'TEMPLATE_Blurb',
        },
      },
    ]
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Sprite spawn action',
        uniqueId: 'sprite-spawn-action',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'sprite-spawn-sheet',
        events: [{ eventType: 'block', sid: 'sprite-spawn-event', conditions: [], actions }],
      }),
      'objectTypes/Player.json': JSON.stringify({ name: 'Player', 'plugin-id': 'Sprite' }),
    })
    const player: Instance = { type: 'Player', properties: {} }
    const host = makeHost([player])
    const actionCalls: Array<{
      objectClass: string
      actionId: string
      instances: readonly Instance[]
      parameters: readonly unknown[]
      scope: AceInvocationScope | undefined
    }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:sprite-spawn-sheet',
    )
    const exported = exportConstructProject(imported.document)
    const exportedSheet = JSON.parse(String(exported.output['eventSheets/Main.json'])) as {
      events: Array<{ actions: unknown[] }>
    }

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      {
        objectClass: 'Player', actionId: 'spawn-another-object', instances: [player],
        parameters: ['FocusHelperProjectile', 'LAYER_Main3D', '0', false, ''],
        scope: { pluginId: 'Sprite' },
      },
      {
        objectClass: 'Player', actionId: 'spawn-another-object', instances: [player],
        parameters: ['UI_TextSF', 'LAYER_UI', 'IP_Blurb', false, 'TEMPLATE_Blurb'],
        scope: { pluginId: 'Sprite' },
      },
    ])
    expect(trace.status).toBe('complete')
    expect(exported.status).toBe('complete')
    expect(exportedSheet.events[0]?.actions).toEqual(actions)
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'sprite-spawn-another-object-action', status: 'TESTED',
    }))
  })

  it('destroys picked instances and their linked container members', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'common-destroy-sheet',
      events: [{
        eventType: 'block', sid: 'destroy-picked-event', conditions: [{
          id: 'compare-instance-variable', objectClass: 'Swatch', sid: 'pick-one-swatch',
          parameters: { 'instance-variable': 'id', comparison: 0, value: '"a"' },
        }], actions: [{ id: 'destroy', objectClass: 'Swatch', sid: 'destroy-picked-swatch' }],
      }],
    }), { registry: engine.registry })
    const swatchA: Instance = { type: 'Swatch', properties: { id: 'a' } }
    const labelA: Instance = { type: 'Label', properties: { id: 'label-a' } }
    const swatchB: Instance = { type: 'Swatch', properties: { id: 'b' } }
    const labelB: Instance = { type: 'Label', properties: { id: 'label-b' } }
    const members = new Map<Instance, readonly Instance[]>([
      [swatchA, [swatchA, labelA]], [labelA, [swatchA, labelA]],
      [swatchB, [swatchB, labelB]], [labelB, [swatchB, labelB]],
    ])
    const host = makeHost([swatchA, labelA, swatchB, labelB])
    host.getContainerMembers = (instance) => members.get(instance) ?? [instance]
    const destroyed: string[] = []
    host.destroyInstance = (instance) => { destroyed.push(String(instance.properties.id)) }
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected the common Destroy sheet')

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      sheet.id,
    )

    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(destroyed).toEqual(['a', 'label-a'])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'action', nodeId: 'construct:destroy-picked-swatch', status: 'executed',
      details: { operation: 'Swatch.destroy', selectedCount: 1, destroyedCount: 2 },
    }))
    expect(trace.status).toBe('complete')
    expect(JSON.parse(exportConstructSheet(sheet).output).events[0].actions).toEqual([
      { id: 'destroy', objectClass: 'Swatch', sid: 'destroy-picked-swatch' },
    ])
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-destroy-action', status: 'TESTED',
    }))
  })

  it('imports and delegates Clipboard Copy text through plugin metadata', () => {
    const engine = createConstructEngine()
    const actions = [
      {
        id: 'copy-text', objectClass: 'Clipboard', sid: 'copy-text-constant',
        parameters: { text: '"Score: " & 42' },
      },
      {
        id: 'copy-text', objectClass: 'Clipboard', sid: 'copy-text-function',
        parameters: { text: 'str(Swatch.ColorValue)' },
      },
    ]
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Clipboard Copy text',
        uniqueId: 'clipboard-copy-text',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'clipboard-copy-text-sheet',
        events: [{ eventType: 'block', sid: 'clipboard-copy-text-event', conditions: [], actions }],
      }),
      'objectTypes/Clipboard.json': JSON.stringify({
        name: 'Clipboard',
        'plugin-id': 'Clipboard',
        'singleglobal-inst': { type: 'Clipboard', properties: {}, uid: 19 },
      }),
      'objectTypes/Swatch.json': JSON.stringify({ name: 'Swatch', 'plugin-id': 'Sprite' }),
    })
    const clipboard: Instance = { type: 'Clipboard', properties: {} }
    const swatch: Instance = { type: 'Swatch', properties: { ColorValue: 16711680 } }
    const host = makeHost([clipboard, swatch])
    const actionCalls: Array<{
      objectClass: string
      actionId: string
      instances: readonly Instance[]
      parameters: readonly unknown[]
      scope: AceInvocationScope | undefined
    }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }
    const compiled = compileConstruct(imported.document, { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected the Clipboard Copy text sheet')
    const trace = createConstructRuntime(host).run(compiled.compiled, sheet.id)
    const exported = exportConstructProject(imported.document)

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(compiled.status).toBe('complete')
    expect(trace.status).toBe('complete')
    expect(actionCalls).toEqual([
      { objectClass: 'Clipboard', actionId: 'copy-text', instances: [clipboard], parameters: ['Score: 42'], scope: { pluginId: 'Clipboard' } },
      { objectClass: 'Clipboard', actionId: 'copy-text', instances: [clipboard], parameters: ['16711680'], scope: { pluginId: 'Clipboard' } },
    ])
    expect(exported.status).toBe('complete')
    expect(JSON.parse(String(exported.output['eventSheets/Main.json'])).events[0].actions).toEqual(actions)
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'clipboard-copy-text-action', status: 'TESTED',
    }))
  })

  it('imports and delegates Set default color through Shape3D, Sprite, and Tilemap plugin metadata', () => {
    const actions = [
      { id: 'set-default-color', objectClass: 'Projectile3D', sid: 'shape-color', parameters: { color: '123' } },
      { id: 'set-default-color', objectClass: 'Billboard', sid: 'sprite-color', parameters: { color: '456' } },
      { id: 'set-default-color', objectClass: 'Terrain', sid: 'tilemap-color', parameters: { color: '789' } },
      { id: 'set-default-color', objectClass: 'Raycasting', sid: 'shape-family-color', parameters: { color: '321' } },
      { id: 'set-default-color', objectClass: 'fPlayer', sid: 'sprite-family-color', parameters: { color: '654' } },
    ]
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Plugin default colors',
        uniqueId: 'plugin-default-colors',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'plugin-default-colors-sheet',
        events: [{ eventType: 'block', sid: 'plugin-default-colors-event', conditions: [], actions }],
      }),
      'objectTypes/Projectile3D.json': JSON.stringify({ name: 'Projectile3D', 'plugin-id': 'Shape3D' }),
      'objectTypes/Billboard.json': JSON.stringify({ name: 'Billboard', 'plugin-id': 'Sprite' }),
      'objectTypes/Terrain.json': JSON.stringify({ name: 'Terrain', 'plugin-id': 'Tilemap' }),
      'families/Raycasting.json': JSON.stringify({ name: 'Raycasting', 'plugin-id': 'Shape3D', members: ['Projectile3D'] }),
      'families/fPlayer.json': JSON.stringify({ name: 'fPlayer', 'plugin-id': 'Sprite', members: ['Billboard'] }),
    })
    const instances: Instance[] = [
      { type: 'Projectile3D', properties: { id: 'projectile' } },
      { type: 'Billboard', properties: { id: 'billboard' } },
      { type: 'Terrain', properties: { id: 'terrain' } },
      { type: 'Raycasting', properties: { id: 'shape-family' } },
      { type: 'fPlayer', properties: { id: 'sprite-family' } },
    ]
    const host = makeHost(instances)
    const actionCalls: Array<{
      objectClass: string
      actionId: string
      instances: readonly Instance[]
      parameters: readonly unknown[]
      scope: AceInvocationScope | undefined
    }> = []
    host.callAction = (objectClass, actionId, targets, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances: targets, parameters, scope })
    }
    const runtime = createConstructRuntime(host)
    const compiled = compileConstruct(imported.document)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected the plugin default-color sheet')
    const trace = runtime.run(compiled.compiled, sheet.id)
    const exported = exportConstructProject(imported.document)

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(compiled.status).toBe('complete')
    expect(trace.status).toBe('complete')
    expect(actionCalls).toEqual([
      { objectClass: 'Projectile3D', actionId: 'set-default-color', instances: [instances[0]], parameters: [123], scope: { pluginId: 'Shape3D' } },
      { objectClass: 'Billboard', actionId: 'set-default-color', instances: [instances[1]], parameters: [456], scope: { pluginId: 'Sprite' } },
      { objectClass: 'Terrain', actionId: 'set-default-color', instances: [instances[2]], parameters: [789], scope: { pluginId: 'Tilemap' } },
      { objectClass: 'Raycasting', actionId: 'set-default-color', instances: [instances[3]], parameters: [321], scope: { pluginId: 'Shape3D' } },
      { objectClass: 'fPlayer', actionId: 'set-default-color', instances: [instances[4]], parameters: [654], scope: { pluginId: 'Sprite' } },
    ])
    expect(exported.status).toBe('complete')
    expect(JSON.parse(String(exported.output['eventSheets/Main.json'])).events[0].actions).toEqual(actions)
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'plugin-scoped-default-color-action', status: 'TESTED',
    }))
  })

  it('delegates the common Is overlapping another object condition', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'overlapping-another-object-sheet',
      events: [{ eventType: 'block', sid: 'overlapping-another-object-event', conditions: [{
        id: 'is-overlapping-another-object', objectClass: '3DBox', sid: 'overlapping-another-object-condition',
        parameters: { object: '3DProjectile' },
      }], actions: [] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an overlapping object sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'overlapping-another-object-event', conditions: [{
        id: 'is-overlapping-another-object', objectClass: '3DBox', sid: 'overlapping-another-object-condition',
        parameters: { object: '3DProjectile' },
      }], actions: [],
    }])
    const host = makeHost([])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return true
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:overlapping-another-object-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([{
      operation: '3DBox.is-overlapping-another-object', parameters: ['3DProjectile'],
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-overlapping-another-object-condition', status: 'TESTED',
    }))
  })

  it('delegates the common Is overlapping at offset condition with evaluated offsets', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'overlapping-at-offset-sheet',
      events: [
        { eventType: 'block', sid: 'overlap-right-event', conditions: [{
          id: 'is-overlapping-at-offset', objectClass: 'Enemy', sid: 'overlap-right-condition',
          parameters: { object: 'Wall', 'offset-x': '2 + 1', 'offset-y': '0' },
        }], actions: [] },
        { eventType: 'block', sid: 'overlap-left-event', conditions: [{
          id: 'is-overlapping-at-offset', objectClass: 'Enemy', sid: 'overlap-left-condition', isInverted: true,
          parameters: { object: 'Wall', 'offset-x': '-3', 'offset-y': '0' },
        }], actions: [] },
      ],
    }))
    const enemy: Instance = { type: 'Enemy', properties: {} }
    const host = makeHost([enemy])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters })
      return parameters[1] === 3
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:overlapping-at-offset-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([
      { operation: 'Enemy.is-overlapping-at-offset', parameters: ['Wall', 3, 0] },
      { operation: 'Enemy.is-overlapping-at-offset', parameters: ['Wall', -3, 0] },
    ])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:overlap-right-condition', status: 'passed',
    }))
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:overlap-left-condition', status: 'passed',
    }))
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-overlapping-at-offset-condition', status: 'TESTED',
    }))
  })

  it('resolves behavior-scoped Tween conditions for different object classes', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'tween-is-playing-sheet',
      events: [
        { eventType: 'block', sid: 'tween-playing-event', conditions: [{
          id: 'is-playing', objectClass: 'Player', behaviorType: 'Tween', sid: 'tween-playing-condition',
          parameters: { tags: 'TWEEN_Run' },
        }], actions: [] },
        { eventType: 'block', sid: 'tween-not-playing-event', conditions: [{
          id: 'is-playing', objectClass: 'Sprite', behaviorType: 'Tween', sid: 'tween-not-playing-condition',
          parameters: { tags: 'TWEEN_Run' }, isInverted: true,
        }], actions: [] },
      ],
    }), { registry: engine.registry })
    const host = makeHost([{ type: 'Player', properties: {} }, { type: 'Sprite', properties: {} }])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.evaluateCondition = (operation, parameters, _context, scope) => {
      conditionCalls.push({ operation, parameters, scope })
      return true
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:tween-is-playing-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([
      { operation: 'Player.is-playing', parameters: ['TWEEN_Run'], scope: { behaviorType: 'Tween' } },
      { operation: 'Sprite.is-playing', parameters: ['TWEEN_Run'], scope: { behaviorType: 'Tween' } },
    ])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:tween-playing-condition', status: 'passed',
    }))
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:tween-not-playing-condition', status: 'failed',
    }))
    expect(trace.status).toBe('complete')
  })

  it('dispatches Bullet On step with the externally picked projectile', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'bullet-on-step-sheet',
      events: [
        { eventType: 'block', sid: 'bullet-on-step-event', conditions: [{
          id: 'on-step', objectClass: '3DProjectile', behaviorType: 'Bullet', sid: 'bullet-on-step-condition',
        }], actions: [{
          id: 'set-x', objectClass: '3DProjectile', sid: 'bullet-on-step-action', parameters: { x: '100' },
        }] },
        { eventType: 'block', sid: 'helper-on-step-event', conditions: [{
          id: 'on-step', objectClass: 'FocusHelperProjectile', behaviorType: 'Bullet', sid: 'helper-on-step-condition',
        }], actions: [{
          id: 'set-x', objectClass: 'FocusHelperProjectile', sid: 'helper-on-step-action', parameters: { x: '200' },
        }] },
      ],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported Bullet On step sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([
      { eventType: 'block', sid: 'bullet-on-step-event', conditions: [{
        id: 'on-step', objectClass: '3DProjectile', behaviorType: 'Bullet', sid: 'bullet-on-step-condition',
      }], actions: [{
        id: 'set-x', objectClass: '3DProjectile', sid: 'bullet-on-step-action', parameters: { x: '100' },
      }] },
      { eventType: 'block', sid: 'helper-on-step-event', conditions: [{
        id: 'on-step', objectClass: 'FocusHelperProjectile', behaviorType: 'Bullet', sid: 'helper-on-step-condition',
      }], actions: [{
        id: 'set-x', objectClass: 'FocusHelperProjectile', sid: 'helper-on-step-action', parameters: { x: '200' },
      }] },
    ])
    const projectile: Instance = { type: '3DProjectile', properties: {} }
    const helperProjectile: Instance = { type: 'FocusHelperProjectile', properties: {} }
    const host = makeHost([projectile, helperProjectile])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, actionId, instances, parameters) => {
      actionCalls.push({ objectClass, actionId, instances, parameters })
    }

    const runtime = createConstructRuntime(host)
    const compiled = compileConstruct(imported.document, { registry: engine.registry }).compiled
    const trace = runtime.dispatchTrigger(compiled, 'construct:bullet-on-step-sheet', {
      operation: '3DProjectile.on-step',
      selectionsByObjectType: { '3DProjectile': [projectile] },
    })
    const helperTrace = runtime.dispatchTrigger(compiled, 'construct:bullet-on-step-sheet', {
      operation: 'FocusHelperProjectile.on-step',
      selectionsByObjectType: { FocusHelperProjectile: [helperProjectile] },
    })

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: '3DProjectile', actionId: 'set-x', instances: [projectile], parameters: [100] },
      { objectClass: 'FocusHelperProjectile', actionId: 'set-x', instances: [helperProjectile], parameters: [200] },
    ])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:bullet-on-step-condition', status: 'passed',
    }))
    expect(helperTrace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:helper-on-step-condition', status: 'passed',
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'bullet-on-step-trigger', status: 'TESTED',
    }))
  })

  it('resolves Bullet Set speed with behavior scope and an evaluated value', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'bullet-set-speed-sheet',
      events: [{ eventType: 'block', sid: 'bullet-set-speed-event', conditions: [], actions: [
        {
          id: 'set-speed', objectClass: '3DProjectile', behaviorType: 'Bullet', sid: 'bullet-set-speed-action',
          parameters: { speed: '20 + 5' },
        },
        {
          id: 'set-speed', objectClass: 'FocusHelperProjectile', behaviorType: 'Bullet', sid: 'helper-set-speed-action',
          parameters: { speed: '30 + 5' },
        },
      ] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported Bullet Set speed sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'bullet-set-speed-event', conditions: [], actions: [
        {
          id: 'set-speed', objectClass: '3DProjectile', behaviorType: 'Bullet', sid: 'bullet-set-speed-action',
          parameters: { speed: '20 + 5' },
        },
        {
          id: 'set-speed', objectClass: 'FocusHelperProjectile', behaviorType: 'Bullet', sid: 'helper-set-speed-action',
          parameters: { speed: '30 + 5' },
        },
      ],
    }])
    const projectile: Instance = { type: '3DProjectile', properties: {} }
    const helperProjectile: Instance = { type: 'FocusHelperProjectile', properties: {} }
    const host = makeHost([projectile, helperProjectile])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:bullet-set-speed-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      {
        objectClass: '3DProjectile', actionId: 'set-speed', instances: [projectile], parameters: [25],
        scope: { behaviorType: 'Bullet' },
      },
      {
        objectClass: 'FocusHelperProjectile', actionId: 'set-speed', instances: [helperProjectile], parameters: [35],
        scope: { behaviorType: 'Bullet' },
      },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'bullet-set-speed-action', status: 'TESTED',
    }))
  })

  it('resolves behavior-specific Set enabled actions for Tween and Bullet', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'behavior-set-enabled-sheet',
      events: [{
        eventType: 'block', sid: 'behavior-set-enabled-event', conditions: [], actions: [
          {
            id: 'set-enabled', objectClass: '3DProjectile', behaviorType: 'Tween', sid: 'tween-set-enabled',
            parameters: { mode: 'disabled' },
          },
          {
            id: 'set-enabled', objectClass: '3DProjectile', behaviorType: 'Bullet', sid: 'bullet-set-enabled',
            parameters: { state: 'enabled' },
          },
        ],
      }],
    }))
    const projectile: Instance = { type: '3DProjectile', properties: {} }
    const host = makeHost([projectile])
    const actionCalls: Array<{ objectClass: string; actionId: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, _instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:behavior-set-enabled-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: '3DProjectile', actionId: 'set-enabled', parameters: ['disabled'], scope: { behaviorType: 'Tween' } },
      { objectClass: '3DProjectile', actionId: 'set-enabled', parameters: ['enabled'], scope: { behaviorType: 'Bullet' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'behavior-set-enabled-actions', status: 'TESTED',
    }))
  })

  it('resolves Timer Is timer running conditions for Player classes', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'timer-running-sheet',
      events: [
        { eventType: 'block', sid: 'timer-running-fplayer-event', conditions: [{
          id: 'is-timer-running', objectClass: 'fPlayer', behaviorType: 'Timer', sid: 'fplayer-timer-running',
          parameters: { tag: 'TIMER_CoyoteTime' },
        }], actions: [] },
        { eventType: 'block', sid: 'timer-running-player-event', conditions: [{
          id: 'is-timer-running', objectClass: 'Player', behaviorType: 'Timer', sid: 'player-timer-running',
          parameters: { tag: 'TIMER_JumpBuffering' }, isInverted: true,
        }], actions: [] },
      ],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported Timer condition sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([
      { eventType: 'block', sid: 'timer-running-fplayer-event', conditions: [{
        id: 'is-timer-running', objectClass: 'fPlayer', behaviorType: 'Timer', sid: 'fplayer-timer-running',
        parameters: { tag: 'TIMER_CoyoteTime' },
      }], actions: [] },
      { eventType: 'block', sid: 'timer-running-player-event', conditions: [{
        id: 'is-timer-running', objectClass: 'Player', behaviorType: 'Timer', sid: 'player-timer-running',
        parameters: { tag: 'TIMER_JumpBuffering' }, isInverted: true,
      }], actions: [] },
    ])
    const host = makeHost([
      { type: 'fPlayer', properties: {} },
      { type: 'Player', properties: {} },
    ])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.evaluateCondition = (operation, parameters, _context, scope) => {
      conditionCalls.push({ operation, parameters, scope })
      return true
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:timer-running-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([
      { operation: 'fPlayer.is-timer-running', parameters: ['TIMER_CoyoteTime'], scope: { behaviorType: 'Timer' } },
      { operation: 'Player.is-timer-running', parameters: ['TIMER_JumpBuffering'], scope: { behaviorType: 'Timer' } },
    ])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:player-timer-running', status: 'failed',
    }))
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'timer-is-timer-running-condition', status: 'TESTED',
    }))
  })

  it('resolves Timer start and stop actions with behavior scope', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'timer-actions-sheet',
      events: [{ eventType: 'block', sid: 'timer-actions-event', conditions: [], actions: [
        {
          id: 'start-timer', objectClass: 'Player', behaviorType: 'Timer', sid: 'start-once-timer',
          parameters: { duration: '2 * 0.5', type: 'once', tag: 'invulnerable' },
        },
        {
          id: 'start-timer', objectClass: 'Enemy', behaviorType: 'Timer', sid: 'start-regular-timer',
          parameters: { duration: '3 + 1', type: 'regular', tag: 'attack' },
        },
        {
          id: 'stop-timer', objectClass: 'Player', behaviorType: 'Timer', sid: 'stop-timer',
          parameters: { tag: '"invulnerable"' },
        },
      ] }],
    }))
    const player: Instance = { type: 'Player', properties: {} }
    const enemy: Instance = { type: 'Enemy', properties: {} }
    const host = makeHost([player, enemy])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:timer-actions-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'Player', actionId: 'start-timer', instances: [player], parameters: [1, 'once', 'invulnerable'], scope: { behaviorType: 'Timer' } },
      { objectClass: 'Enemy', actionId: 'start-timer', instances: [enemy], parameters: [4, 'regular', 'attack'], scope: { behaviorType: 'Timer' } },
      { objectClass: 'Player', actionId: 'stop-timer', instances: [player], parameters: ['invulnerable'], scope: { behaviorType: 'Timer' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'timer-start-stop-actions', status: 'TESTED',
    }))
  })

  it('resolves Tween Stop tweens and Stop all tweens across object types', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'tween-stop-actions-sheet',
      events: [{ eventType: 'block', sid: 'tween-stop-actions-event', conditions: [], actions: [
        {
          id: 'stop-tweens', objectClass: 'Sprite', behaviorType: 'Tween', sid: 'tween-stop-by-tags',
          parameters: { tags: 'flash UI' },
        },
        {
          id: 'stop-all-tweens', objectClass: '3DProjectile', behaviorType: 'Tween', sid: 'tween-stop-all',
        },
      ] }],
    }))
    const sprite: Instance = { type: 'Sprite', properties: {} }
    const projectile: Instance = { type: '3DProjectile', properties: {} }
    const host = makeHost([sprite, projectile])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:tween-stop-actions-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'Sprite', actionId: 'stop-tweens', instances: [sprite], parameters: ['flash UI'], scope: { behaviorType: 'Tween' } },
      { objectClass: '3DProjectile', actionId: 'stop-all-tweens', instances: [projectile], parameters: [], scope: { behaviorType: 'Tween' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'tween-stop-actions', status: 'TESTED',
    }))
  })

  it('resolves Tween one-property and value actions with evaluated parameters', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'tween-start-actions-sheet',
      events: [{ eventType: 'block', sid: 'tween-start-actions-event', conditions: [], actions: [
        {
          id: 'tween-one-property', objectClass: 'Camera', behaviorType: 'Tween', sid: 'tween-one-property-action',
          parameters: {
            tags: 'camera tween', property: 'x', 'end-value': '50 + 10', time: '2 * 0.5', ease: 'easeoutsine',
            'destroy-on-complete': 'no', loop: 'yes', 'ping-pong': 'yes', 'repeat-count': '3',
          },
        },
        {
          id: 'tween-value', objectClass: 'Sprite', behaviorType: 'Tween', sid: 'tween-value-action',
          parameters: {
            tags: 'fade', 'start-value': '10 + 5', 'end-value': '20 * 2', time: '1.5', ease: 'default',
            'destroy-on-complete': 'no', loop: 'no', 'ping-pong': 'no', 'repeat-count': '1',
          },
        },
      ] }],
    }))
    const camera: Instance = { type: 'Camera', properties: {} }
    const sprite: Instance = { type: 'Sprite', properties: {} }
    const host = makeHost([camera, sprite])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:tween-start-actions-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      {
        objectClass: 'Camera', actionId: 'tween-one-property', instances: [camera],
        parameters: ['camera tween', 'x', 60, 1, 'easeoutsine', 'no', 'yes', 'yes', 3],
        scope: { behaviorType: 'Tween' },
      },
      {
        objectClass: 'Sprite', actionId: 'tween-value', instances: [sprite],
        parameters: ['fade', 15, 40, 1.5, 'default', 'no', 'no', 'no', 1],
        scope: { behaviorType: 'Tween' },
      },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'tween-start-actions', status: 'TESTED',
    }))
  })

  it('resolves the Tween two-property action with evaluated parameters', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'tween-two-properties-sheet',
      events: [{ eventType: 'block', sid: 'tween-two-properties-event', conditions: [], actions: [{
        id: 'tween-two-properties', objectClass: '3DProjectile', behaviorType: 'Tween', sid: 'tween-two-properties-action',
        parameters: {
          tags: 'TWEEN_Position', property: 'position', 'end-x': 'hitX', 'end-y': 'hitY',
          time: 'hitDistance / projectileSpeed', ease: 'default', 'destroy-on-complete': 'no',
          loop: 'no', 'ping-pong': 'no', 'repeat-count': '1',
        },
      }] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a Tween action sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events[0].actions).toEqual([{
      id: 'tween-two-properties', objectClass: '3DProjectile', behaviorType: 'Tween', sid: 'tween-two-properties-action',
      parameters: {
        tags: 'TWEEN_Position', property: 'position', 'end-x': 'hitX', 'end-y': 'hitY',
        time: 'hitDistance / projectileSpeed', ease: 'default', 'destroy-on-complete': 'no',
        loop: 'no', 'ping-pong': 'no', 'repeat-count': '1',
      },
    }])
    const projectile: Instance = { type: '3DProjectile', properties: {} }
    const host = makeHost([projectile])
    host.evaluateExpression = (callee) => ({ hitX: 50, hitY: 75, hitDistance: 100, projectileSpeed: 20 }[callee])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:tween-two-properties-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([{
      objectClass: '3DProjectile', actionId: 'tween-two-properties', instances: [projectile],
      parameters: ['TWEEN_Position', 'position', 50, 75, 5, 'default', 'no', 'no', 'no', 1],
      scope: { behaviorType: 'Tween' },
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'tween-two-properties-action', status: 'TESTED',
    }))
  })

  it('imports and delegates MoveTo Move to object with its behavior scope', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'move-to-object-sheet',
      events: [{ eventType: 'block', sid: 'move-to-object-event', conditions: [], actions: [{
        id: 'move-to-object', objectClass: 'Camera', behaviorType: 'MoveTo', sid: 'move-to-object-action',
        parameters: { object: 'Player', 'image-point': '0', mode: 'direct' },
      }] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a MoveTo action sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events[0].actions).toEqual([{
      id: 'move-to-object', objectClass: 'Camera', behaviorType: 'MoveTo', sid: 'move-to-object-action',
      parameters: { object: 'Player', 'image-point': '0', mode: 'direct' },
    }])
    const camera: Instance = { type: 'Camera', properties: {} }
    const host = makeHost([camera])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:move-to-object-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([{
      objectClass: 'Camera', actionId: 'move-to-object', instances: [camera],
      parameters: ['Player', 0, 'direct'], scope: { behaviorType: 'MoveTo' },
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'moveto-move-to-object-action', status: 'TESTED',
    }))
  })

  it('imports and delegates Physics velocity and force actions with behavior scope', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'physics-actions-sheet',
      events: [{ eventType: 'block', sid: 'physics-actions-event', conditions: [], actions: [
        {
          id: 'set-velocity', objectClass: 'Enemies', behaviorType: 'Physics', sid: 'set-velocity-action',
          parameters: { 'x-component': '0', 'y-component': '0' },
        },
        {
          id: 'apply-force-at-angle', objectClass: 'Enemies', behaviorType: 'Physics', sid: 'apply-force-action',
          parameters: { force: '20 * 0.1', angle: '30 + 60', 'image-point': '0' },
        },
      ] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a Physics action sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events[0].actions).toEqual([
      {
        id: 'set-velocity', objectClass: 'Enemies', behaviorType: 'Physics', sid: 'set-velocity-action',
        parameters: { 'x-component': '0', 'y-component': '0' },
      },
      {
        id: 'apply-force-at-angle', objectClass: 'Enemies', behaviorType: 'Physics', sid: 'apply-force-action',
        parameters: { force: '20 * 0.1', angle: '30 + 60', 'image-point': '0' },
      },
    ])
    const enemy: Instance = { type: 'Enemies', properties: {} }
    const host = makeHost([enemy])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:physics-actions-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'Enemies', actionId: 'set-velocity', instances: [enemy], parameters: [0, 0], scope: { behaviorType: 'Physics' } },
      { objectClass: 'Enemies', actionId: 'apply-force-at-angle', instances: [enemy], parameters: [2, 90, 0], scope: { behaviorType: 'Physics' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'physics-behavior-action-subset', status: 'TESTED',
    }))
  })

  it('resolves the Platform Is on floor condition with inversion', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'platform-is-on-floor-sheet',
      events: [
        { eventType: 'block', sid: 'platform-is-on-floor-event', conditions: [{
          id: 'is-on-floor', objectClass: 'fPlayer', behaviorType: 'Platform', sid: 'platform-is-on-floor',
        }], actions: [] },
        { eventType: 'block', sid: 'platform-is-not-on-floor-event', conditions: [{
          id: 'is-on-floor', objectClass: 'fPlayer', behaviorType: 'Platform', sid: 'platform-is-not-on-floor', isInverted: true,
        }], actions: [] },
      ],
    }))
    const player: Instance = { type: 'fPlayer', properties: {} }
    const host = makeHost([player])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.evaluateCondition = (operation, parameters, _context, scope) => {
      conditionCalls.push({ operation, parameters, scope })
      return true
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:platform-is-on-floor-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([
      { operation: 'fPlayer.is-on-floor', parameters: [], scope: { behaviorType: 'Platform' } },
      { operation: 'fPlayer.is-on-floor', parameters: [], scope: { behaviorType: 'Platform' } },
    ])
    expect(trace.entries.filter(({ kind }) => kind === 'condition').map(({ status }) => status)).toEqual(['passed', 'failed'])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'platform-is-on-floor-condition', status: 'TESTED',
    }))
  })

  it('delegates Platform movement checks and Set enabled plus Car Is moving', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'movement-behavior-ace-sheet',
      events: [
        ...['is-falling', 'is-jumping', 'is-moving'].map((id) => ({
          eventType: 'block', sid: `platform-${id}-event`, conditions: [{
            id, objectClass: 'fPlayer', behaviorType: 'Platform', sid: `platform-${id}-condition`,
          }], actions: [],
        })),
        { eventType: 'block', sid: 'car-is-moving-event', conditions: [{
          id: 'is-moving', objectClass: 'Player', behaviorType: 'Car', sid: 'car-is-moving-condition',
        }], actions: [] },
        { eventType: 'block', sid: 'platform-set-enabled-event', conditions: [], actions: [{
          id: 'set-enabled', objectClass: 'fPlayer', behaviorType: 'Platform', sid: 'platform-set-enabled-action',
          parameters: { state: 'disabled' },
        }] },
      ],
    }), { registry: engine.registry })
    const player: Instance = { type: 'fPlayer', properties: {} }
    const car: Instance = { type: 'Player', properties: {} }
    const host = makeHost([player, car])
    const conditionCalls: Array<{ operation: string; scope: AceInvocationScope | undefined }> = []
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.evaluateCondition = (operation, _parameters, _context, scope) => {
      conditionCalls.push({ operation, scope })
      return true
    }
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:movement-behavior-ace-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action' || code === 'construct.unknown-condition')).toEqual([])
    expect(conditionCalls).toEqual([
      { operation: 'fPlayer.is-falling', scope: { behaviorType: 'Platform' } },
      { operation: 'fPlayer.is-jumping', scope: { behaviorType: 'Platform' } },
      { operation: 'fPlayer.is-moving', scope: { behaviorType: 'Platform' } },
      { operation: 'Player.is-moving', scope: { behaviorType: 'Car' } },
    ])
    expect(actionCalls).toEqual([{
      objectClass: 'fPlayer', actionId: 'set-enabled', instances: [player], parameters: ['disabled'],
      scope: { behaviorType: 'Platform' },
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'movement-behavior-ace-subset', status: 'TESTED',
    }))
  })

  it('delegates 8 Direction vector X and max speed plus common Subtract from instance variable', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'movement-and-subtract-actions-sheet',
      events: [{ eventType: 'block', sid: 'movement-and-subtract-actions-event', conditions: [], actions: [
        {
          id: 'set-vector-x', objectClass: 'Players', behaviorType: '8Direction', sid: 'set-vector-x-action',
          parameters: { 'vector-x': '5 * 2' },
        },
        {
          id: 'set-max-speed', objectClass: 'Player', behaviorType: '8Direction', sid: 'set-max-speed-action',
          parameters: { 'max-speed': '300 + 200' },
        },
        {
          id: 'subtract-from-instvar', objectClass: 'Player', sid: 'subtract-from-instvar-action',
          parameters: { 'instance-variable': 'health', value: '10 - 2' },
        },
      ] }],
    }), { registry: engine.registry })
    const player: Instance = { type: 'Player', properties: {} }
    const players: Instance = { type: 'Players', properties: {} }
    const host = makeHost([player, players])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:movement-and-subtract-actions-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'Players', actionId: 'set-vector-x', instances: [players], parameters: [10], scope: { behaviorType: '8Direction' } },
      { objectClass: 'Player', actionId: 'set-max-speed', instances: [player], parameters: [500], scope: { behaviorType: '8Direction' } },
      { objectClass: 'Player', actionId: 'subtract-from-instvar', instances: [player], parameters: ['health', 8], scope: undefined },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'movement-and-instance-variable-action-subset', status: 'TESTED',
    }))
  })

  it('resolves Set vector Y for 8 Direction and Platform behaviors', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'set-vector-y-sheet',
      events: [{ eventType: 'block', sid: 'set-vector-y-event', conditions: [], actions: [
        {
          id: 'set-vector-y', objectClass: 'Player', behaviorType: '8Direction', sid: 'player-vector-y',
          parameters: { 'vector-y': '2 * 3' },
        },
        {
          id: 'set-vector-y', objectClass: 'fPlayer', behaviorType: '8Direction', sid: 'fplayer-vector-y',
          parameters: { 'vector-y': '5 * 2' },
        },
        {
          id: 'set-vector-y', objectClass: 'fPlayer', behaviorType: 'Platform', sid: 'platform-vector-y',
          parameters: { 'vector-y': '-5 * 2' },
        },
      ] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported Set vector Y sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'set-vector-y-event', conditions: [], actions: [
        {
          id: 'set-vector-y', objectClass: 'Player', behaviorType: '8Direction', sid: 'player-vector-y',
          parameters: { 'vector-y': '2 * 3' },
        },
        {
          id: 'set-vector-y', objectClass: 'fPlayer', behaviorType: '8Direction', sid: 'fplayer-vector-y',
          parameters: { 'vector-y': '5 * 2' },
        },
        {
          id: 'set-vector-y', objectClass: 'fPlayer', behaviorType: 'Platform', sid: 'platform-vector-y',
          parameters: { 'vector-y': '-5 * 2' },
        },
      ],
    }])
    const player: Instance = { type: 'Player', properties: {} }
    const firstPersonPlayer: Instance = { type: 'fPlayer', properties: {} }
    const host = makeHost([player, firstPersonPlayer])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:set-vector-y-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'Player', actionId: 'set-vector-y', instances: [player], parameters: [6], scope: { behaviorType: '8Direction' } },
      { objectClass: 'fPlayer', actionId: 'set-vector-y', instances: [firstPersonPlayer], parameters: [10], scope: { behaviorType: '8Direction' } },
      { objectClass: 'fPlayer', actionId: 'set-vector-y', instances: [firstPersonPlayer], parameters: [-10], scope: { behaviorType: 'Platform' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'eight-direction-set-vector-y-action', status: 'TESTED',
    }))
  })

  it('resolves Solid Set tags with evaluated strings and behavior scope', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'solid-set-tags-sheet',
      events: [{ eventType: 'block', sid: 'solid-set-tags-event', conditions: [], actions: [
        {
          id: 'set-tags', objectClass: 'Obstacles', behaviorType: 'Solid', sid: 'solid-clear-tags',
          parameters: { tags: '""' },
        },
        {
          id: 'set-tags', objectClass: 'Obstacles', behaviorType: 'Solid', sid: 'solid-set-player-tag',
          parameters: { tags: 'SOLID_Player' },
        },
      ] }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported Solid Set tags sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'solid-set-tags-event', conditions: [], actions: [
        {
          id: 'set-tags', objectClass: 'Obstacles', behaviorType: 'Solid', sid: 'solid-clear-tags',
          parameters: { tags: '""' },
        },
        {
          id: 'set-tags', objectClass: 'Obstacles', behaviorType: 'Solid', sid: 'solid-set-player-tag',
          parameters: { tags: 'SOLID_Player' },
        },
      ],
    }])
    const obstacles: Instance = { type: 'Obstacles', properties: {} }
    const host = makeHost([obstacles])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (objectClass, actionId, instances, parameters, scope) => {
      actionCalls.push({ objectClass, actionId, instances, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:solid-set-tags-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { objectClass: 'Obstacles', actionId: 'set-tags', instances: [obstacles], parameters: [''], scope: { behaviorType: 'Solid' } },
      { objectClass: 'Obstacles', actionId: 'set-tags', instances: [obstacles], parameters: ['SOLID_Player'], scope: { behaviorType: 'Solid' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'solid-set-tags-action', status: 'TESTED',
    }))
  })

  it('resolves behavior-specific Simulate control actions for 8 Direction and Platform', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'simulate-control-sheet',
      events: [{ eventType: 'block', sid: 'simulate-control-event', conditions: [], actions: [
        {
          id: 'simulate-control', objectClass: 'Mover', behaviorType: '8Direction', sid: 'simulate-8direction',
          parameters: { control: 'up' },
        },
        {
          id: 'simulate-control', objectClass: 'Mover', behaviorType: 'Platform', sid: 'simulate-platform',
          parameters: { control: 'jump' },
        },
      ] }],
    }))
    const mover: Instance = { type: 'Mover', properties: {} }
    const host = makeHost([mover])
    const actionCalls: Array<{ actionId: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (_objectClass, actionId, _instances, parameters, scope) => {
      actionCalls.push({ actionId, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:simulate-control-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([
      { actionId: 'simulate-control', parameters: ['up'], scope: { behaviorType: '8Direction' } },
      { actionId: 'simulate-control', parameters: ['jump'], scope: { behaviorType: 'Platform' } },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'behavior-simulate-control-actions', status: 'TESTED',
    }))
  })

  it('resolves Car Simulate control actions with behavior scope', () => {
    const engine = createConstructEngine()
    const controls = ['accelerate', 'brake', 'left', 'right'] as const
    const imported = importConstruct(JSON.stringify({
      sid: 'car-simulate-control-sheet',
      events: [{ eventType: 'block', sid: 'car-simulate-control-event', conditions: [], actions: controls.map((control) => ({
        id: 'simulate-control', objectClass: 'Player', behaviorType: 'Car', sid: 'car-' + control,
        parameters: { control },
      })) }],
    }), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported Car Simulate control sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'car-simulate-control-event', conditions: [], actions: controls.map((control) => ({
        id: 'simulate-control', objectClass: 'Player', behaviorType: 'Car', sid: 'car-' + control,
        parameters: { control },
      })),
    }])
    const player: Instance = { type: 'Player', properties: {} }
    const host = makeHost([player])
    const actionCalls: Array<{ actionId: string; parameters: readonly unknown[]; scope: AceInvocationScope | undefined }> = []
    host.callAction = (_objectClass, actionId, _instances, parameters, scope) => {
      actionCalls.push({ actionId, parameters, scope })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:car-simulate-control-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual(controls.map((control) => ({
      actionId: 'simulate-control', parameters: [control], scope: { behaviorType: 'Car' },
    })))
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'car-simulate-control-action', status: 'TESTED',
    }))
  })

  it('delegates the common Move at angle action with angle and distance expressions', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'move-at-angle-sheet',
      events: [{ eventType: 'block', sid: 'move-at-angle-event', conditions: [], actions: [{
        id: 'move-at-angle', objectClass: 'Camera', sid: 'move-at-angle-action',
        parameters: { angle: '45 + 90', distance: '8 * 0.25' },
      }] }],
    }))
    const camera: Instance = { type: 'Camera', properties: {} }
    const host = makeHost([camera])
    const actionCalls: Array<{ objectClass: string; actionId: string; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, actionId, _instances, parameters) => {
      actionCalls.push({ objectClass, actionId, parameters })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document).compiled,
      'construct:move-at-angle-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    expect(actionCalls).toEqual([{
      objectClass: 'Camera', actionId: 'move-at-angle', parameters: [135, 2],
    }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-move-at-angle-action', status: 'TESTED',
    }))
  })

  it('delegates common Set X and Set Y actions with evaluated coordinates', () => {
    const engine = createConstructEngine()
    const imported = importConstruct(JSON.stringify({
      sid: 'set-x-y-sheet',
      events: [{ eventType: 'block', sid: 'set-x-y-event', conditions: [], actions: [
        {
          id: 'set-x', objectClass: 'Camera', sid: 'set-x-action',
          parameters: { x: '10 + 5' },
        },
        {
          id: 'set-y', objectClass: 'Camera', sid: 'set-y-action',
          parameters: { y: '20 - 2' },
        },
      ] }],
    }), { registry: engine.registry })
    const camera: Instance = { type: 'Camera', properties: {} }
    const host = makeHost([camera])
    const actionCalls: Array<{ objectClass: string; actionId: string; instances: readonly Instance[]; parameters: readonly unknown[] }> = []
    host.callAction = (objectClass, actionId, instances, parameters) => {
      actionCalls.push({ objectClass, actionId, instances, parameters })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:set-x-y-sheet',
    )

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics.filter(({ code }) => code === 'construct.unknown-action')).toEqual([])
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported position sheet')
    expect(JSON.parse(exportConstructSheet(sheet).output).events).toEqual([{
      eventType: 'block', sid: 'set-x-y-event', conditions: [], actions: [
        { id: 'set-x', objectClass: 'Camera', sid: 'set-x-action', parameters: { x: '10 + 5' } },
        { id: 'set-y', objectClass: 'Camera', sid: 'set-y-action', parameters: { y: '20 - 2' } },
      ],
    }])
    expect(actionCalls).toEqual([
      { objectClass: 'Camera', actionId: 'set-x', instances: [camera], parameters: [15] },
      { objectClass: 'Camera', actionId: 'set-y', instances: [camera], parameters: [18] },
    ])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'common-set-x-y-actions', status: 'TESTED',
    }))
  })

  it('delegates registered custom conditions and expressions to the host adapter', () => {
    const engine = createConstructEngine({ extensions: [{
      id: 'example.runtime-handlers',
      objectClass: 'RuntimeExample',
      conditions: [{
        id: 'is-ready', category: 'general', name: 'Is ready', scriptName: 'IsReady',
        parameters: [{ id: 'value', type: 'number' }], isInvertible: true,
      }],
      actions: [{
        id: 'record-value', category: 'general', name: 'Record value', scriptName: 'RecordValue',
        parameters: [{ id: 'value', type: 'number' }],
      }],
      expressions: [{
        id: 'bonus', category: 'general', name: 'Bonus', expressionName: 'Bonus', returnType: 'number',
      }],
    }] })
    const imported = importConstruct(JSON.stringify({
      sid: 'extension-runtime-sheet',
      events: [{ eventType: 'block', sid: 'extension-runtime-event', conditions: [{
        id: 'is-ready', objectClass: 'RuntimeExample', sid: 'extension-condition',
        parameters: { value: 'Bonus(1)' },
      }], actions: [{
        id: 'record-value', objectClass: 'RuntimeExample', sid: 'extension-action',
        parameters: { value: 'Bonus(1)' },
      }] }],
    }), { registry: engine.registry })
    const host = makeHost([{ type: 'RuntimeExample', properties: {} }])
    const conditionCalls: Array<{ operation: string; parameters: readonly unknown[]; layout: string }> = []
    const actionCalls: Array<{ actionId: string; parameters: readonly unknown[] }> = []
    host.evaluateExpression = (callee, parameters, context) =>
      callee === 'Bonus' && typeof parameters[0] === 'number' ? parameters[0] + context.layout.length : undefined
    host.evaluateCondition = (operation, parameters, context) => {
      conditionCalls.push({ operation, parameters, layout: context.layout })
      return operation === 'RuntimeExample.is-ready' && parameters[0] === 5
    }
    host.callAction = (_objectClass, actionId, _instances, parameters) => {
      actionCalls.push({ actionId, parameters })
    }

    const trace = createConstructRuntime(host).run(
      compileConstruct(imported.document, { registry: engine.registry }).compiled,
      'construct:extension-runtime-sheet',
    )

    expect(conditionCalls).toEqual([{
      operation: 'RuntimeExample.is-ready', parameters: [5], layout: 'main',
    }])
    expect(actionCalls).toEqual([{ actionId: 'record-value', parameters: [5] }])
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:extension-condition', status: 'passed',
    }))
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'action', nodeId: 'construct:extension-action', status: 'executed',
    }))
    expect(trace.diagnostics).toEqual([])
  })
})
