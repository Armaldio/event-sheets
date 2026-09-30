import { describe, expect, it } from 'vitest'
import { diffEventDocuments, type EventDocument } from '@project/schema'

const baseDocument: EventDocument = {
  schemaVersion: 1,
  id: 'diff-document',
  engine: { id: 'construct' },
  sheets: [{
    id: 'diff-sheet',
    name: 'Main',
    events: [
      {
        type: 'event', id: 'event-a', conditions: [{
          type: 'condition', id: 'condition-old', operation: 'System.every-tick', parameters: [],
        }], actions: [{
          type: 'action', id: 'action-set', operation: 'System.set-eventvar-value',
          parameters: [{ type: 'literal', value: 'score' }, { type: 'literal', value: 1 }],
        }],
      },
      { type: 'event', id: 'event-b', conditions: [], actions: [] },
    ],
    variables: [{ id: 'variable-score', name: 'score', dataType: 'number', scope: 'global', initialValue: { type: 'literal', value: 0 } }],
    includes: [{ id: 'include-shared', sheetName: 'Shared', targetSheetId: 'shared-sheet' }],
  }],
  variables: [],
}

describe('event document structural diff', () => {
  it('ignores source-location-only changes between snapshots', () => {
    const after = structuredClone(baseDocument)
    after.sheets[0]!.sourceLocation = { sourceId: 'stream.json', offsetStart: 40, offsetEnd: 500 }
    after.sheets[0]!.events[0]!.sourceLocation = { sourceId: 'stream.json', offsetStart: 80, offsetEnd: 300 }

    expect(diffEventDocuments(baseDocument, after)).toEqual({ operations: [], isEmpty: true })
  })

  it('reports additions, removals, edits, and moves by stable node ID', () => {
    const after = structuredClone(baseDocument)
    const sheet = after.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected the main sheet')
    const [eventA, eventB] = sheet.events
    if (!eventA || eventA.type !== 'event' || !eventB || eventB.type !== 'event') {
      throw new Error('Expected two event nodes')
    }
    eventA.conditions = []
    eventA.actions[0] = {
      ...eventA.actions[0] as Extract<typeof eventA.actions[number], { type: 'action' }>,
      parameters: [{ type: 'literal', value: 'score' }, { type: 'literal', value: 2 }],
    }
    eventA.sourceLocation = { sourceId: 'stream.json', offsetStart: 30, offsetEnd: 250 }
    sheet.includes![0] = { ...sheet.includes![0]!, targetSheetId: 'shared-sheet-v2' }
    sheet.events = [
      eventB,
      eventA,
      { type: 'event', id: 'event-new', conditions: [], actions: [] },
    ]

    const diff = diffEventDocuments(baseDocument, after)

    expect(diff.isEmpty).toBe(false)
    expect(diff.operations).toContainEqual(expect.objectContaining({
      kind: 'remove', nodeType: 'condition', nodeId: 'condition-old',
    }))
    expect(diff.operations).toContainEqual(expect.objectContaining({
      kind: 'update', nodeType: 'action', nodeId: 'action-set',
      after: expect.objectContaining({ parameters: [
        { type: 'literal', value: 'score' }, { type: 'literal', value: 2 },
      ] }),
    }))
    expect(diff.operations).toContainEqual(expect.objectContaining({
      kind: 'move', nodeType: 'event', nodeId: 'event-a',
      from: expect.objectContaining({ index: 0 }), to: expect.objectContaining({ index: 1 }),
    }))
    expect(diff.operations).toContainEqual(expect.objectContaining({
      kind: 'move', nodeType: 'event', nodeId: 'event-b',
      from: expect.objectContaining({ index: 1 }), to: expect.objectContaining({ index: 0 }),
    }))
    expect(diff.operations).toContainEqual(expect.objectContaining({
      kind: 'add', nodeType: 'event', nodeId: 'event-new',
    }))
    expect(diff.operations).toContainEqual(expect.objectContaining({
      kind: 'update', nodeType: 'include', nodeId: 'include-shared',
    }))
  })
})
