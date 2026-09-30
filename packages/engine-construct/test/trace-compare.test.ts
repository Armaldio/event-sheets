import { describe, expect, it } from 'vitest'
import { compareConstructTraces, type ExecutionTrace } from '@project/engine-construct'

const trace: ExecutionTrace = {
  documentId: 'comparison-document',
  sheetId: 'comparison-sheet',
  status: 'complete',
  entries: [
    { sequence: 1, kind: 'event', nodeId: 'construct:event-1', status: 'passed' },
    {
      sequence: 2, kind: 'action', nodeId: 'construct:action-1', status: 'executed',
      parentNodeId: 'construct:event-1', details: { targets: ['player-1'], count: 1 },
    },
  ],
  diagnostics: [],
}

describe('Construct trace comparison', () => {
  it('compares ordered entries while ignoring JSON object key order', () => {
    const captured = {
      ...trace,
      entries: [
        trace.entries[0],
        { ...trace.entries[1], details: { count: 1, targets: ['player-1'] } },
      ],
    }

    expect(compareConstructTraces(trace, captured)).toEqual({ matches: true, differences: [] })
  })

  it('returns exact trace paths for behavior differences', () => {
    const captured: ExecutionTrace = {
      ...trace,
      entries: [trace.entries[0]!, { ...trace.entries[1]!, status: 'skipped' }],
    }

    expect(compareConstructTraces(trace, captured)).toMatchObject({
      matches: false,
      differences: [{ path: 'entries[1].status', expected: 'skipped', actual: 'executed' }],
    })
  })
})
