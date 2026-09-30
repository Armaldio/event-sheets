import { describe, expect, it } from 'vitest'
import type { Action, Condition, Event, EventDocument } from '@project/schema'
import { applyEditorCommand, CommandHistory } from '../src/commands.js'

const conditionA: Condition = {
  type: 'condition',
  id: 'condition-a',
  operation: 'System.Compare',
  parameters: [{ type: 'literal', value: 1 }],
}
const conditionB: Condition = {
  type: 'condition',
  id: 'condition-b',
  operation: 'System.Compare',
  parameters: [{ type: 'literal', value: 2 }],
}
const actionA: Action = {
  type: 'action',
  id: 'action-a',
  operation: 'System.Set',
  parameters: [{ type: 'literal', value: 'first' }],
}
const actionB: Action = {
  type: 'action',
  id: 'action-b',
  operation: 'System.Set',
  parameters: [{ type: 'literal', value: 'second' }],
}
const eventA: Event = {
  type: 'event',
  id: 'event-a',
  label: 'First',
  conditions: [conditionA, conditionB],
  actions: [actionA, actionB],
  subEvents: [{ type: 'event', id: 'event-child', conditions: [], actions: [] }],
}
const eventB: Event = { type: 'event', id: 'event-b', conditions: [], actions: [] }
const document: EventDocument = {
  schemaVersion: 1,
  id: 'document-1',
  engine: { id: 'construct' },
  sheets: [{ id: 'sheet-1', name: 'Main', events: [eventA, eventB] }],
  variables: [],
}

function mainSheet(input: EventDocument = document) {
  const sheet = input.sheets[0]
  if (!sheet || 'type' in sheet) throw new Error('Expected an event sheet')
  return sheet
}

function eventById(input: EventDocument, eventId: string): Event {
  const visit = (events: Event['subEvents']): Event | undefined => {
    for (const node of events ?? []) {
      if (node.type !== 'event') continue
      if (node.id === eventId) return node
      const nested = visit(node.subEvents)
      if (nested) return nested
    }
    return undefined
  }
  const event = visit(mainSheet(input).events)
  if (!event) throw new Error(`Missing event ${eventId}`)
  return event
}

describe('editor commands', () => {
  it('adds an event immutably at a requested position', () => {
    const added: Event = { type: 'event', id: 'event-added', conditions: [], actions: [] }
    const next = applyEditorCommand(document, { type: 'add-event', sheetId: 'sheet-1', event: added, index: 1 })

    expect(mainSheet(next).events.map(({ id }) => id)).toEqual(['event-a', 'event-added', 'event-b'])
    expect(mainSheet().events.map(({ id }) => id)).toEqual(['event-a', 'event-b'])
  })

  it('removes nested events without changing siblings', () => {
    const next = applyEditorCommand(document, { type: 'remove-event', eventId: 'event-child' })

    expect(eventById(next, 'event-a').subEvents).toEqual([])
    expect(mainSheet(next).events.map(({ id }) => id)).toEqual(['event-a', 'event-b'])
  })

  it('removes incomplete event nodes while preserving the remaining sheet', () => {
    const withRecovery: EventDocument = {
      ...document,
      sheets: [{
        ...mainSheet(),
        events: [...mainSheet().events, { type: 'incomplete', nodeType: 'event', id: 'event-partial', expected: ['actions'] }],
      }],
    }
    const next = applyEditorCommand(withRecovery, { type: 'remove-event', eventId: 'event-partial' })
    expect(mainSheet(next).events.map(({ id }) => id)).toEqual(['event-a', 'event-b'])
  })

  it('moves events between nesting levels and rejects cycles', () => {
    const nested = applyEditorCommand(document, {
      type: 'move-event', eventId: 'event-b', targetSheetId: 'sheet-1', targetParentEventId: 'event-a',
    })
    expect(mainSheet(nested).events.map(({ id }) => id)).toEqual(['event-a'])
    expect(eventById(nested, 'event-a').subEvents?.map(({ id }) => id)).toEqual(['event-child', 'event-b'])

    expect(() => applyEditorCommand(nested, {
      type: 'move-event', eventId: 'event-a', targetSheetId: 'sheet-1', targetParentEventId: 'event-b',
    })).toThrow(/descendant/)

    const reordered = applyEditorCommand(nested, {
      type: 'move-event', eventId: 'event-b', targetSheetId: 'sheet-1', beforeEventId: 'event-a',
    })
    expect(mainSheet(reordered).events.map(({ id }) => id)).toEqual(['event-b', 'event-a'])
  })

  it('validates IDs across an inserted subtree and keeps nested moves inside their target sheet', () => {
    const duplicateChild: Event = {
      type: 'event', id: 'event-new', conditions: [], actions: [],
      subEvents: [{ type: 'event', id: 'event-a', conditions: [], actions: [] }],
    }
    expect(() => applyEditorCommand(document, {
      type: 'add-event', sheetId: 'sheet-1', event: duplicateChild,
    })).toThrow(/already exists/)

    const otherSheetDocument: EventDocument = {
      ...document,
      sheets: [...document.sheets, { id: 'sheet-2', name: 'Other', events: [{ type: 'event', id: 'event-other', conditions: [], actions: [] }] }],
    }
    expect(() => applyEditorCommand(otherSheetDocument, {
      type: 'move-event', eventId: 'event-b', targetSheetId: 'sheet-1', targetParentEventId: 'event-other',
    })).toThrow(/not in sheet/)
    expect(mainSheet(otherSheetDocument).events.map(({ id }) => id)).toEqual(['event-a', 'event-b'])
  })

  it('adds, edits, reorders, and removes conditions and actions', () => {
    const addedCondition: Condition = { ...conditionA, id: 'condition-c' }
    const addedAction: Action = { ...actionA, id: 'action-c' }
    const withRows = applyEditorCommand(document, { type: 'add-condition', eventId: 'event-a', condition: addedCondition })
    const withRowsAndAction = applyEditorCommand(withRows, { type: 'add-action', eventId: 'event-a', action: addedAction })
    const edited = applyEditorCommand(withRowsAndAction, {
      type: 'update-condition-parameters',
      eventId: 'event-a',
      conditionId: 'condition-a',
      parameters: [{ type: 'literal', value: 99 }],
    })
    const renamed = applyEditorCommand(edited, {
      type: 'update-condition-operation', eventId: 'event-a', conditionId: 'condition-a', operation: 'System.CompareNow',
    })
    const renamedAction = applyEditorCommand(renamed, {
      type: 'update-action-operation', eventId: 'event-a', actionId: 'action-a', operation: 'System.SetNow',
    })
    const reordered = applyEditorCommand(renamedAction, { type: 'move-condition', eventId: 'event-a', conditionId: 'condition-c', toIndex: 0 })
    const reorderedActions = applyEditorCommand(reordered, { type: 'move-action', eventId: 'event-a', actionId: 'action-c', toIndex: 0 })
    const withoutRows = applyEditorCommand(reorderedActions, { type: 'remove-condition', eventId: 'event-a', conditionId: 'condition-b' })
    const final = applyEditorCommand(withoutRows, { type: 'remove-action', eventId: 'event-a', actionId: 'action-b' })
    const event = eventById(final, 'event-a')

    expect(event.conditions.map(({ id }) => id)).toEqual(['condition-c', 'condition-a'])
    expect(event.conditions[1]).toMatchObject({ parameters: [{ type: 'literal', value: 99 }] })
    expect(event.conditions[1]).toMatchObject({ operation: 'System.CompareNow' })
    expect(event.actions.map(({ id }) => id)).toEqual(['action-c', 'action-a'])
    expect(event.actions[1]).toMatchObject({ operation: 'System.SetNow' })
  })

  it('tracks undo and redo and clears the redo branch after a new command', () => {
    const history = new CommandHistory(document)
    const added: Event = { type: 'event', id: 'event-added', conditions: [], actions: [] }
    history.execute({ type: 'add-event', sheetId: 'sheet-1', event: added })
    expect(history.canUndo).toBe(true)
    expect(history.canRedo).toBe(false)
    history.undo()
    expect(mainSheet(history.document).events).toHaveLength(2)
    history.redo()
    expect(mainSheet(history.document).events).toHaveLength(3)
    history.undo()
    history.execute({ type: 'remove-event', eventId: 'event-b' })
    expect(history.canRedo).toBe(false)
  })

  it('rejects duplicate IDs and leaves command history unchanged on failure', () => {
    const history = new CommandHistory(document)
    expect(() => history.execute({ type: 'remove-event', eventId: 'missing' })).toThrow(/No editable event/)
    expect(history.canUndo).toBe(false)
    expect(() => applyEditorCommand(document, { type: 'add-event', sheetId: 'sheet-1', event: eventB })).toThrow(/already exists/)
    expect(mainSheet(history.document).events).toHaveLength(2)
  })
})
