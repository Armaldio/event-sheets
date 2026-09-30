import { describe, expect, it } from 'vitest'
import type { EventDocument } from '@project/schema'
import { proposeRepair } from '../src/repair.js'

const document: EventDocument = {
  schemaVersion: 1,
  id: 'repair-document',
  engine: { id: 'construct' },
  sheets: [{
    id: 'repair-sheet',
    name: 'Main',
    events: [{
      type: 'event',
      id: 'repair-event',
      conditions: [],
      actions: [{
        type: 'action',
        id: 'repair-action',
        operation: 'System.set-eventvar-value',
        parameters: [{ type: 'literal', value: 'score' }, { type: 'literal', value: 1 }],
      }],
    }],
  }],
  variables: [],
}

describe('repair proposals', () => {
  it('returns a validated command preview and stable-ID diff without changing the input', async () => {
    const diagnostic = {
      code: 'construct.unknown-action',
      severity: 'warning' as const,
      message: 'Unknown action.',
      nodeId: 'repair-action',
    }
    let receivedDiagnostics: readonly typeof diagnostic[] = []
    const proposal = await proposeRepair(document, [diagnostic], async (context) => {
      receivedDiagnostics = context.diagnostics as readonly typeof diagnostic[]
      return [{
        type: 'update-action-parameters',
        eventId: 'repair-event',
        actionId: 'repair-action',
        parameters: [{ type: 'literal', value: 'score' }, { type: 'literal', value: 2 }],
      }]
    })

    expect(receivedDiagnostics).toEqual([diagnostic])
    expect(document.sheets[0]).toMatchObject({ events: [{ actions: [{ parameters: [{ value: 'score' }, { value: 1 }] }] }] })
    expect(proposal.ok).toBe(true)
    if (!proposal.ok) return
    expect(proposal.document.sheets[0]).toMatchObject({ events: [{ actions: [{ parameters: [{ value: 'score' }, { value: 2 }] }] }] })
    expect(proposal.diff.operations).toContainEqual(expect.objectContaining({ kind: 'update', nodeType: 'action', nodeId: 'repair-action' }))
  })

  it('rejects commands that cannot be applied to the current document', async () => {
    const proposal = await proposeRepair(document, [], async () => [{
      type: 'remove-action', eventId: 'missing-event', actionId: 'missing-action',
    }])

    expect(proposal).toMatchObject({ ok: false, diagnostics: [{ code: 'visual.repair.command-rejected', severity: 'error' }] })
  })
})
