import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { EventDocument } from '@project/schema'
import { EventSheetEditor } from '../src/index.js'

const document: EventDocument = {
  schemaVersion: 1,
  id: 'document-1',
  engine: { id: 'construct' },
  sheets: [{
    id: 'sheet-1',
    name: 'Main',
    sourceLocation: { sourceId: 'main.c3ev' },
    variables: [{ id: 'variable-1', name: 'score', dataType: 'number', scope: 'global' }],
    events: [{
      type: 'event',
      id: 'event-1',
      variables: [{ id: 'local-counter', name: 'counter', dataType: 'number', scope: 'local' }],
      label: 'When the player moves',
      conditions: [{
        type: 'condition',
        id: 'condition-1',
        operation: 'System.compare-two-values',
        parameters: [{
          type: 'binary',
          operator: '>',
          left: { type: 'property', object: { type: 'identifier', name: 'Player' }, property: 'X' },
          right: { type: 'literal', value: 50 },
        }],
      }, {
        type: 'unknown',
        nodeType: 'condition',
        id: 'condition-unknown',
        raw: { objectClass: 'FuturePlugin', id: 'new-condition', parameters: { value: 1 } },
      }],
      actions: [
        { type: 'unknown', nodeType: 'action', id: 'action-unknown', raw: { objectClass: 'FuturePlugin', id: 'new-action', parameters: { value: 1 } } },
        {
          type: 'invalid', nodeType: 'action', id: 'action-invalid', raw: { id: 'set-score' },
          diagnostic: { code: 'construct.invalid-action', severity: 'error', message: 'The action data is invalid.' },
        },
        { type: 'incomplete', nodeType: 'action', id: 'action-incomplete', expected: ['value'], sourceText: 'score +' },
      ],
      subEvents: [{ type: 'incomplete', nodeType: 'event', id: 'event-incomplete', expected: ['actions'] }],
    }],
  }],
  variables: [],
}

describe('EventSheetEditor', () => {
  it('renders event logic, recovery nodes, variables, and diagnostics', () => {
    const wrapper = mount(EventSheetEditor, {
      props: {
        document,
        diagnostics: [{
          code: 'construct.unknown-action',
          severity: 'warning',
          message: 'No registered action for FuturePlugin.new-action.',
          nodeId: 'action-unknown',
        }],
      },
    })

    expect(wrapper.get('h1').text()).toBe('Main')
    expect(wrapper.text()).toContain('main.c3ev')
    expect(wrapper.text()).toContain('Player.X > 50')
    expect(wrapper.text()).toContain('FuturePlugin.new-condition')
    expect(wrapper.text()).toContain('FuturePlugin.new-action')
    expect(wrapper.text()).toContain('The action data is invalid.')
    expect(wrapper.text()).toContain('Waiting for actions')
    expect(wrapper.text()).toContain('score')
    expect(wrapper.text()).toContain('LOCAL')
    expect(wrapper.text()).toContain('counter: number')
    expect(wrapper.text()).toContain('No registered action for FuturePlugin.new-action.')
    expect(wrapper.attributes('data-mode')).toBe('readonly')
  })

  it('renders an empty state for documents without sheets', () => {
    const wrapper = mount(EventSheetEditor, {
      props: { document: { ...document, sheets: [] } },
    })

    expect(wrapper.text()).toContain('This document does not contain an event sheet yet.')
  })

  it('identifies function blocks and shows their parameter and return signature', () => {
    const functionDocument: EventDocument = {
      ...document,
      id: 'function-document',
      sheets: [{
        id: 'function-sheet',
        name: 'Functions',
        events: [{
          type: 'event',
          id: 'function-1',
          eventKind: 'function',
          label: 'Double',
          functionParameters: [{ id: 'parameter-1', name: 'value', dataType: 'number' }],
          functionReturnType: 'number',
          functionCopyPicked: true,
          conditions: [],
          actions: [],
        }],
      }],
    }
    const wrapper = mount(EventSheetEditor, { props: { document: functionDocument } })
    const functionBlock = wrapper.get('[data-node-id="function-1"]')

    expect(functionBlock.get('.event-mark').text()).toBe('FUNCTION')
    expect(functionBlock.get('h2').text()).toBe('Double')
    expect(functionBlock.get('.function-signature').text()).toBe('value: number → number · copies picked')
  })
})
