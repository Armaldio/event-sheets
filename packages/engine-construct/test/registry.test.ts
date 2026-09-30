import { describe, expect, it } from 'vitest'
import {
  compileConstruct,
  constructEngine,
  createConstructEngine,
  defineConstructExtension,
} from '@project/engine-construct'
import type { EventDocument } from '@project/schema'

describe('Construct ACE registry', () => {
  it('provides built-in System condition and action definitions', () => {
    expect(constructEngine.registry.getCondition('System', 'compare-two-values')).toMatchObject({
      name: 'Compare two values',
      parameters: [
        { id: 'first-value', type: 'any' },
        { id: 'comparison', type: 'cmp' },
        { id: 'second-value', type: 'any' },
      ],
    })
    expect(constructEngine.registry.getAction('System', 'set-eventvar-value')).toMatchObject({
      name: 'Set value',
      parameters: [{ id: 'variable', type: 'eventvar' }, { id: 'value', type: 'any' }],
    })
    expect(constructEngine.registry.getCondition('System', 'compare-eventvar')).toMatchObject({
      parameters: [
        { id: 'variable', type: 'eventvar' },
        { id: 'comparison', type: 'cmp' },
        { id: 'value', type: 'any' },
      ],
      isInvertible: true,
    })
    expect(constructEngine.registry.getCondition('System', 'compare-boolean-eventvar')).toMatchObject({
      parameters: [{ id: 'variable', type: 'eventvarbool' }],
    })
    expect(constructEngine.registry.getCondition('System', 'on-start-of-layout')).toMatchObject({ isTrigger: true })
    expect(constructEngine.registry.getCondition('Keyboard', 'key-is-down')).toMatchObject({
      parameters: [{ id: 'key', type: 'keyb' }],
      isInvertible: true,
    })
    expect(constructEngine.registry.getCondition('Keyboard', 'on-key-pressed')).toMatchObject({
      parameters: [{ id: 'key', type: 'keyb' }],
      isTrigger: true,
    })
    expect(constructEngine.registry.getCondition('Gamepad', 'is-button-down')).toMatchObject({
      parameters: [{ id: 'gamepad', type: 'number' }, { id: 'button', type: 'combo' }],
      isInvertible: true,
    })
    expect(constructEngine.registry.getCondition('Gamepad', 'compare-axis')).toMatchObject({
      parameters: [
        { id: 'gamepad', type: 'number' },
        { id: 'axis', type: 'combo' },
        { id: 'comparison', type: 'cmp' },
        { id: 'value', type: 'number' },
      ],
      isInvertible: true,
    })
    expect(constructEngine.registry.getCondition('Gamepad', 'on-button-pressed')).toMatchObject({
      parameters: [{ id: 'gamepad', type: 'number' }, { id: 'button', type: 'combo' }],
      isFakeTrigger: true,
    })
    expect(constructEngine.registry.getCondition('Browser', 'is-fullscreen')).toMatchObject({ isInvertible: true })
    expect(constructEngine.registry.getAction('Browser', 'log')).toMatchObject({
      parameters: [{ id: 'type', type: 'combo' }, { id: 'message', type: 'any' }],
      isStatic: true,
    })
    expect(constructEngine.registry.getAction('Browser', 'request-fullscreen')).toMatchObject({
      parameters: [{ id: 'mode', type: 'combo' }, { id: 'navigation-ui', type: 'combo' }],
    })
    expect(constructEngine.registry.getAction('WebSocket', 'send-text')).toMatchObject({
      parameters: [{ id: 'data', type: 'any' }],
      isStatic: true,
    })
    expect(constructEngine.registry.getAction('UI_Text', 'set-text', { pluginId: 'Text' })).toMatchObject({
      pluginId: 'Text', parameters: [{ id: 'text', type: 'any' }],
    })
    expect(constructEngine.registry.getAction('UI_TextSF', 'set-text', { pluginId: 'Spritefont2' })).toMatchObject({
      pluginId: 'Spritefont2', parameters: [{ id: 'text', type: 'any' }],
    })
    expect(constructEngine.registry.getAction('UI_TextInput', 'set-text', { pluginId: 'TextBox' })).toMatchObject({
      pluginId: 'TextBox', parameters: [{ id: 'text', type: 'any' }],
    })
    expect(constructEngine.registry.getAction('UI_TextInput', 'append-text', { pluginId: 'TextBox' })).toMatchObject({
      parameters: [{ id: 'text', type: 'any' }],
    })
    expect(constructEngine.registry.getAction('UI_TextInput', 'scroll-to-bottom', { pluginId: 'TextBox' }))
      .not.toHaveProperty('parameters')
    expect(constructEngine.registry.getCondition('UI_TextInput', 'on-text-changed', { pluginId: 'TextBox' }))
      .toMatchObject({ isTrigger: true })
    expect(constructEngine.registry.getAction('System', 'reset-global-variables')).toMatchObject({
      parameters: [{ id: 'reset-static', type: 'boolean', optional: true }],
    })
    expect(constructEngine.registry.getCondition('Player', 'compare-instance-variable')).toMatchObject({
      parameters: [
        { id: 'instance-variable', type: 'instancevar' },
        { id: 'comparison', type: 'cmp' },
        { id: 'value', type: 'any' },
      ],
      isInvertible: true,
    })
    expect(constructEngine.registry.getAction('Player', 'set-instvar-value')).toMatchObject({
      parameters: [{ id: 'instance-variable', type: 'instancevar' }, { id: 'value', type: 'any' }],
    })
    expect(constructEngine.registry.getCondition('System', 'layer-is-visible')).toMatchObject({
      parameters: [{ id: 'layer', type: 'layer' }],
      isInvertible: true,
    })
    expect(constructEngine.registry.getCondition('System', 'every-x-seconds')).toMatchObject({
      parameters: [{ id: 'interval-seconds', type: 'number' }],
    })
    expect(constructEngine.registry.getAction('System', 'set-layer-visible')).toMatchObject({
      parameters: [
        { id: 'layer', type: 'layer' },
        { id: 'visibility', type: 'combo', items: ['invisible', 'visible'] },
      ],
    })
    expect(constructEngine.registry.getAction('System', 'set-layer-interactive')).toMatchObject({
      parameters: [{ id: 'layer', type: 'layer' }, { id: 'interactive', type: 'boolean' }],
    })
    expect(constructEngine.registry.getAction('System', 'set-time-scale')).toMatchObject({
      parameters: [{ id: 'time-scale', type: 'number' }],
    })
    expect(constructEngine.registry.getAction('System', 'go-to-layout-by-name')).toMatchObject({
      parameters: [{ id: 'layout', type: 'string' }],
    })
    expect(constructEngine.registry.getAction('System', 'set-layout-vanishing-point')).toMatchObject({
      parameters: [{ id: 'vanishing-point-x', type: 'number' }, { id: 'vanishing-point-y', type: 'number' }],
    })
    expect(constructEngine.registry.getAction('System', 'wait-for-previous-actions')).toMatchObject({ isAsync: true })
    expect(constructEngine.registry.getAction('System', 'set-group-active')).toMatchObject({
      parameters: [{ id: 'group-name', type: 'string' }, { id: 'state', type: 'combo' }],
    })
    expect(constructEngine.registry.getAction('System', 'create-object')).toMatchObject({
      parameters: [
        { id: 'object-to-create', type: 'object' },
        { id: 'layer', type: 'layer' },
        { id: 'x', type: 'number' },
        { id: 'y', type: 'number' },
      ],
    })
    expect(constructEngine.registry.getAction('Functions', 'set-return-value')).toMatchObject({
      name: 'Set return value',
      parameters: [{ id: 'value', type: 'any' }],
    })
  })

  it('registers user-defined conditions, actions, and expressions', () => {
    const extension = defineConstructExtension({
      id: 'example.custom',
      objectClass: 'ExampleCustom',
      conditions: [{ id: 'is-ready', category: 'General', name: 'Is ready', scriptName: 'IsReady' }],
      actions: [{ id: 'set-ready', category: 'General', name: 'Set ready', scriptName: 'SetReady' }],
      expressions: [{ id: 'ready-count', category: 'General', name: 'Ready count', expressionName: 'ReadyCount', returnType: 'number' }],
    })
    const engine = createConstructEngine({ extensions: [extension] })

    expect(engine.registry.getCondition('ExampleCustom', 'is-ready')?.name).toBe('Is ready')
    expect(engine.registry.getAction('ExampleCustom', 'set-ready')?.scriptName).toBe('SetReady')
    expect(engine.registry.getExpression('ExampleCustom', 'ready-count')?.returnType).toBe('number')
  })

  it('registers behavior-scoped ACE definitions separately from object-class ACEs', () => {
    const extension = defineConstructExtension({
      id: 'example.behavior.tween',
      behaviorType: 'ExampleTween',
      conditions: [{
        id: 'is-playing', category: 'playback', name: 'Is playing', scriptName: 'IsPlaying',
        parameters: [{ id: 'tags', type: 'string' }], isInvertible: true,
      }],
    })
    const engine = createConstructEngine({ extensions: [extension] })
    const definition = engine.registry.getCondition('Sprite', 'is-playing', 'ExampleTween')

    expect(definition).toMatchObject({
      behaviorType: 'ExampleTween',
      id: 'is-playing',
      parameters: [{ id: 'tags', type: 'string' }],
      isInvertible: true,
    })
    expect(definition).not.toHaveProperty('objectClass')
    expect(engine.registry.getCondition('Sprite', 'is-playing')).toBeUndefined()
  })

  it('registers user-defined plugin-scoped ACE definitions', () => {
    const engine = createConstructEngine({ extensions: [{
      id: 'example.plugin.editor',
      pluginId: 'ExampleTextPlugin',
      actions: [{
        id: 'set-message', category: 'text', name: 'Set message', scriptName: 'SetMessage',
        parameters: [{ id: 'message', type: 'string' }],
      }],
    }] })

    expect(engine.registry.getAction('NamedInstance', 'set-message', { pluginId: 'ExampleTextPlugin' })).toMatchObject({
      pluginId: 'ExampleTextPlugin', id: 'set-message', parameters: [{ id: 'message', type: 'string' }],
    })
    expect(engine.registry.getAction('NamedInstance', 'set-message')).toBeUndefined()
  })

  it('allows another extension to add non-colliding ACEs to a plugin', () => {
    const engine = createConstructEngine({ extensions: [{
      id: 'example.text.append-action',
      pluginId: 'Text',
      actions: [{
        id: 'append-text', category: 'text', name: 'Append text', scriptName: 'AppendText',
        parameters: [{ id: 'text', type: 'any' }],
      }],
    }] })

    expect(engine.registry.getAction('NamedText', 'set-text', { pluginId: 'Text' })).toMatchObject({ id: 'set-text' })
    expect(engine.registry.getAction('NamedText', 'append-text', { pluginId: 'Text' })).toMatchObject({
      pluginId: 'Text', id: 'append-text',
    })
  })

  it('prefers an object-class ACE over a plugin-scoped ACE with the same ID', () => {
    const engine = createConstructEngine({ extensions: [{
      id: 'example.text-override',
      objectClass: 'UI_Text',
      actions: [{ id: 'set-text', category: 'text', name: 'Set text override', scriptName: 'SetTextOverride' }],
    }] })

    expect(engine.registry.getAction('UI_Text', 'set-text', { pluginId: 'Text' })).toMatchObject({
      objectClass: 'UI_Text', scriptName: 'SetTextOverride',
    })
  })

  it('falls back to a registered object-class ACE when its behavior has no matching definition', () => {
    const engine = createConstructEngine({ extensions: [{
      id: 'example.sprite-actions',
      objectClass: 'Sprite',
      actions: [{ id: 'stop', category: 'general', name: 'Stop', scriptName: 'Stop' }],
    }] })

    expect(engine.registry.getAction('Sprite', 'stop', 'UnregisteredBehavior')).toMatchObject({
      objectClass: 'Sprite', id: 'stop',
    })
  })

  it('rejects an extension that reuses a registered object class', () => {
    const engine = createConstructEngine()
    const before = engine.registry.listActions().length

    expect(() => engine.registry.registerExtension({
      id: 'invalid.system',
      objectClass: 'System',
      actions: [{ id: 'new-action', category: 'General', name: 'New action', scriptName: 'NewAction' }],
    })).toThrow(/object class/i)

    expect(engine.registry.listActions()).toHaveLength(before)
  })

  it('rejects duplicate ACE IDs before adding any of the extension definitions', () => {
    const engine = createConstructEngine()
    const before = engine.registry.listActions().length
    const duplicate = {
      id: 'duplicate-action',
      category: 'General',
      name: 'Duplicate action',
      scriptName: 'DuplicateAction',
    }

    expect(() => engine.registry.registerExtension({
      id: 'example.duplicate',
      objectClass: 'ExampleDuplicate',
      actions: [duplicate, duplicate],
    })).toThrow(/Duplicate Construct action ID/)

    expect(engine.registry.listActions()).toHaveLength(before)
  })

  it('keeps unknown ACE lookups explicit', () => {
    expect(constructEngine.registry.getCondition('SomePlugin', 'future-condition')).toBeUndefined()
  })

  it('runs registered ACE validators during compilation and maps their diagnostics to the ACE', () => {
    const engine = createConstructEngine({
      extensions: [defineConstructExtension({
        id: 'example.validation',
        objectClass: 'ValidationExample',
        conditions: [{
          id: 'is-positive',
          category: 'General',
          name: 'Is positive',
          scriptName: 'IsPositive',
          validate: ([value]) => value?.type === 'literal' && typeof value.value === 'number' && value.value < 0
            ? [{ code: 'example.negative-value', severity: 'warning', message: 'Expected a positive value.' }]
            : [],
        }],
        actions: [{
          id: 'set-value',
          category: 'General',
          name: 'Set value',
          scriptName: 'SetValue',
          validate: ([value]) => value?.type === 'literal' && typeof value.value === 'number' && value.value < 0
            ? [{ code: 'example.negative-action-value', severity: 'warning', message: 'Action value must not be negative.' }]
            : [],
        }],
      })],
    })
    const document: EventDocument = {
      schemaVersion: 1,
      id: 'validation-document',
      engine: { id: 'construct' },
      sheets: [{
        id: 'validation-sheet',
        name: 'Validation',
        events: [{
          type: 'event',
          id: 'validation-event',
          conditions: [{
            type: 'condition',
            id: 'negative-condition',
            operation: 'ValidationExample.is-positive',
            parameters: [{ type: 'literal', value: -1 }],
            sourceLocation: { sourceId: 'main.c3ev', offsetStart: 12, offsetEnd: 28 },
          }],
          actions: [{
            type: 'action',
            id: 'negative-action',
            operation: 'ValidationExample.set-value',
            parameters: [{ type: 'literal', value: -2 }],
            sourceLocation: { sourceId: 'main.c3ev', offsetStart: 30, offsetEnd: 46 },
          }],
        }],
      }],
      variables: [],
    }

    const result = compileConstruct(document, { registry: engine.registry })

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'example.negative-value',
      nodeId: 'negative-condition',
      sourceLocation: { sourceId: 'main.c3ev', offsetStart: 12, offsetEnd: 28 },
    }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'example.negative-action-value',
      nodeId: 'negative-action',
      sourceLocation: { sourceId: 'main.c3ev', offsetStart: 30, offsetEnd: 46 },
    }))
  })
})
