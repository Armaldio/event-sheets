import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { EventDocument } from '@project/schema'
import { EventSheetEditor } from '../src/index.js'

const document: EventDocument = {
  schemaVersion: 1,
  id: 'editing-document',
  engine: { id: 'construct' },
  sheets: [{
    id: 'editing-sheet',
    name: 'Main',
    events: [
      {
        type: 'event', id: 'event-root', label: 'Root',
        conditions: [{ type: 'condition', id: 'condition-one', operation: 'System.Compare', parameters: [{ type: 'literal', value: 1 }] }],
        actions: [{ type: 'action', id: 'action-one', operation: 'System.Set', parameters: [{ type: 'literal', value: 'ready' }] }],
      },
      { type: 'event', id: 'event-other', label: 'Other', conditions: [], actions: [] },
    ],
  }],
  variables: [],
}

function latestDocument(wrapper: ReturnType<typeof mount>): EventDocument {
  const updates = wrapper.emitted('update:document')
  return (updates?.at(-1)?.[0] as EventDocument | undefined) ?? document
}

function sheetEvents(input: EventDocument = document) {
  const sheet = input.sheets.find((node) => 'name' in node)
  if (!sheet || !('name' in sheet)) throw new Error('Expected editable sheet')
  return sheet.events
}

describe('EventSheetEditor editing mode', () => {
  it('emits the selected event ID and emits undefined when selection clears', async () => {
    const wrapper = mount(EventSheetEditor, { props: { document, readonly: false } })

    await wrapper.get('[data-node-id="event-root"] .event-select').trigger('click')
    await wrapper.get('.event-sheet-editor').trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('selection-change')).toEqual([['event-root'], [undefined]])
  })

  it('routes event and ACE add, remove, operation, parameter, and reorder changes through commands', async () => {
    const wrapper = mount(EventSheetEditor, { props: { document, readonly: false } })
    const root = wrapper.get('[data-node-id="event-root"]')

    await root.get('button[aria-label="Add condition"]').trigger('click')
    await root.get('button[aria-label="Add action"]').trigger('click')

    let current = latestDocument(wrapper)
    let rootEvent = sheetEvents(current).find((node) => node.type === 'event' && node.id === 'event-root')
    if (!rootEvent || rootEvent.type !== 'event') throw new Error('Missing root event')
    const addedCondition = rootEvent.conditions.at(-1)
    const addedAction = rootEvent.actions.at(-1)
    expect(addedCondition?.type).toBe('condition')
    expect(addedAction?.type).toBe('action')
    if (addedCondition?.type !== 'condition' || addedAction?.type !== 'action') throw new Error('Expected editable ACE nodes')

    const conditionLine = wrapper.get(`[data-node-id="${addedCondition.id}"]`)
    await conditionLine.get('button[aria-label="Move condition up"]').trigger('click')
    await wrapper.get(`[data-node-id="condition-one"] .operation-input`).setValue('System.CompareValues')
    await wrapper.get(`[data-node-id="condition-one"] .operation-input`).trigger('change')
    await wrapper.get(`[data-node-id="condition-one"] .parameter-input`).setValue('Player.X + score')
    await wrapper.get(`[data-node-id="condition-one"] .parameter-input`).trigger('change')

    current = latestDocument(wrapper)
    rootEvent = sheetEvents(current).find((node) => node.type === 'event' && node.id === 'event-root')
    if (!rootEvent || rootEvent.type !== 'event') throw new Error('Missing updated root event')
    expect(rootEvent.conditions.map((node) => node.id)).toEqual([addedCondition.id, 'condition-one'])
    expect(rootEvent.conditions[1]).toMatchObject({
      operation: 'System.CompareValues',
      parameters: [{
        type: 'binary', operator: '+',
        left: { type: 'property', property: 'X' },
        right: { type: 'identifier', name: 'score' },
      }],
    })

    const actionLine = wrapper.get(`[data-node-id="${addedAction.id}"]`)
    await actionLine.get('.operation-input').setValue('System.Log')
    await actionLine.get('.operation-input').trigger('change')
    await actionLine.get('.add-parameter').trigger('click')
    await wrapper.get(`[data-node-id="${addedAction.id}"] .parameter-input`).setValue('"done"')
    await wrapper.get(`[data-node-id="${addedAction.id}"] .parameter-input`).trigger('change')
    await wrapper.get(`[data-node-id="${addedAction.id}"] button[aria-label="Remove action"]`).trigger('click')
    await wrapper.get(`[data-node-id="${addedCondition.id}"] button[aria-label="Remove condition"]`).trigger('click')

    current = latestDocument(wrapper)
    rootEvent = sheetEvents(current).find((node) => node.type === 'event' && node.id === 'event-root')
    if (!rootEvent || rootEvent.type !== 'event') throw new Error('Missing final root event')
    expect(rootEvent.conditions.map((node) => node.id)).toEqual(['condition-one'])
    expect(rootEvent.actions.map((node) => node.id)).toEqual(['action-one'])
    expect(wrapper.emitted('update:document')?.length).toBeGreaterThan(5)
  })

  it('selects, adds, removes, reorders, nests, drag-drops, and undoes events', async () => {
    const wrapper = mount(EventSheetEditor, { props: { document, readonly: false } })
    await wrapper.findAll('.editor-toolbar button')[0]?.trigger('click')
    let current = latestDocument(wrapper)
    expect(sheetEvents(current)).toHaveLength(3)
    const newEvent = sheetEvents(current).at(-1)
    if (!newEvent || newEvent.type !== 'event') throw new Error('Expected added event')
    await wrapper.get(`[data-node-id="${newEvent.id}"] button[aria-label="Remove New event"]`).trigger('click')
    expect(sheetEvents(latestDocument(wrapper))).toHaveLength(2)

    await wrapper.get('[data-node-id="event-other"] .event-select').trigger('click')
    await wrapper.get('[data-node-id="event-root"] button[aria-label="Nest selected event under Root"]').trigger('click')
    current = latestDocument(wrapper)
    expect(sheetEvents(current).map((node) => node.id)).toEqual(['event-root'])
    const root = sheetEvents(current)[0]
    expect(root?.type === 'event' ? root.subEvents?.map((node) => node.id) : []).toEqual(['event-other'])

    const transfer = {
      effectAllowed: 'none',
      value: '',
      setData(_type: string, value: string) { this.value = value },
      getData() { return this.value },
    }
    await wrapper.get('[data-node-id="event-other"]').trigger('dragstart', { dataTransfer: transfer })
    expect(transfer.value).toBe('event-other')
    await wrapper.get('.sheet-content').trigger('drop', { dataTransfer: transfer, clientY: 1 })
    expect(sheetEvents(latestDocument(wrapper)).map((node) => node.id)).toEqual(['event-root', 'event-other'])

    await wrapper.get('[data-node-id="event-root"] button[aria-label="Move Root down"]').trigger('click')
    expect(sheetEvents(latestDocument(wrapper)).map((node) => node.id)).toEqual(['event-other', 'event-root'])
    await wrapper.get('.editor-toolbar button[aria-label="Undo"]').trigger('click')
    expect(sheetEvents(latestDocument(wrapper)).map((node) => node.id)).toEqual(['event-root', 'event-other'])
    await wrapper.get('.editor-toolbar button[aria-label="Redo"]').trigger('click')
    expect(sheetEvents(latestDocument(wrapper)).map((node) => node.id)).toEqual(['event-other', 'event-root'])
    expect(wrapper.attributes('data-mode')).toBe('editing')
  })

  it('supports editor keyboard commands and leaves text-input undo to the browser', async () => {
    const wrapper = mount(EventSheetEditor, { props: { document, readonly: false } })
    const editor = wrapper.get('.event-sheet-editor')

    await wrapper.get('[data-node-id="event-other"] .event-select').trigger('click')
    await editor.trigger('keydown', { key: 'ArrowUp', altKey: true })
    expect(sheetEvents(latestDocument(wrapper)).map(({ id }) => id)).toEqual(['event-other', 'event-root'])

    await editor.trigger('keydown', { key: 'z', ctrlKey: true })
    expect(sheetEvents(latestDocument(wrapper)).map(({ id }) => id)).toEqual(['event-root', 'event-other'])
    await editor.trigger('keydown', { key: 'z', ctrlKey: true, shiftKey: true })
    expect(sheetEvents(latestDocument(wrapper)).map(({ id }) => id)).toEqual(['event-other', 'event-root'])

    const operationInput = wrapper.get('[data-node-id="condition-one"] .operation-input')
    await operationInput.setValue('System.Changed')
    await operationInput.trigger('keydown', { key: 'z', ctrlKey: true })
    expect((operationInput.element as HTMLInputElement).value).toBe('System.Changed')

    await editor.trigger('keydown', { key: 'Escape' })
    expect(wrapper.get('[data-node-id="event-other"]').attributes('data-selected')).toBe('false')
    await wrapper.get('[data-node-id="event-other"] .event-select').trigger('click')
    await editor.trigger('keydown', { key: 'Delete' })
    expect(sheetEvents(latestDocument(wrapper)).map(({ id }) => id)).toEqual(['event-root'])
  })

  it('focuses and highlights the node referenced by a diagnostic', async () => {
    const wrapper = mount(EventSheetEditor, {
      props: {
        document,
        readonly: false,
        diagnostics: [{
          code: 'construct.invalid-condition',
          severity: 'error',
          message: 'Condition could not be resolved.',
          nodeId: 'condition-one',
        }],
      },
      attachTo: globalThis.document.body,
    })

    await wrapper.get('button[aria-label="Focus node condition-one"]').trigger('click')

    expect(wrapper.get('[data-node-id="event-root"]').attributes('data-selected')).toBe('true')
    expect(wrapper.get('[data-node-id="condition-one"]').attributes('data-diagnostic-target')).toBe('true')
    expect(globalThis.document.activeElement).toBe(wrapper.get('[data-node-id="condition-one"]').element)
    wrapper.unmount()
  })

  it('preserves selection across snapshots while the event remains and clears it when removed', async () => {
    const wrapper = mount(EventSheetEditor, { props: { document, readonly: false } })
    await wrapper.get('[data-node-id="event-other"] .event-select').trigger('click')

    const updatedDocument: EventDocument = {
      ...document,
      sheets: document.sheets.map((node) => 'name' in node
        ? {
            ...node,
            name: 'Updated Main',
            events: node.events.map((event) => event.type === 'event'
              ? { ...event, label: `Updated ${event.label ?? ''}` }
              : event),
          }
        : node),
    }
    await wrapper.setProps({ document: updatedDocument })

    expect(wrapper.get('[data-node-id="event-other"]').attributes('data-selected')).toBe('true')

    const documentWithoutSelection: EventDocument = {
      ...updatedDocument,
      sheets: updatedDocument.sheets.map((node) => 'name' in node
        ? { ...node, events: node.events.filter((event) => event.id !== 'event-other') }
        : node),
    }
    await wrapper.setProps({ document: documentWithoutSelection })

    expect(wrapper.get('[data-node-id="event-root"]').attributes('data-selected')).toBe('false')
  })
})
