import { describe, expect, it } from 'vitest'
import { analyzeConstructTrace, parseConstruct, type ExecutionTrace } from '@project/engine-construct'

describe('Construct trace analysis context', () => {
  it('maps trace entries and diagnostics to stable node IDs and source ranges', async () => {
    const source = JSON.stringify({
      sid: 'analysis-sheet',
      name: 'Main',
      events: [{
        eventType: 'block', sid: 'analysis-event', name: 'Update score', conditions: [],
        actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'analysis-action',
          parameters: { variable: 'score', value: 'score + 1' },
        }],
      }],
    }, null, 2)
    const document = parseConstruct(source, { sourceId: 'main.c3ev' }).document
    const actionLocation = document.sheets[0]
    if (!actionLocation || 'type' in actionLocation || actionLocation.events[0]?.type !== 'event') {
      throw new Error('Expected a parsed event sheet')
    }
    const action = actionLocation.events[0].actions[0]
    if (!action || action.type !== 'action') throw new Error('Expected a parsed action')
    const trace: ExecutionTrace = {
      documentId: document.id,
      sheetId: actionLocation.id,
      status: 'complete',
      entries: [
        { sequence: 1, kind: 'event', nodeId: 'construct:analysis-event', status: 'passed' },
        { sequence: 2, kind: 'action', nodeId: action.id, status: 'executed' },
      ],
      diagnostics: [{
        code: 'construct.runtime.example', severity: 'warning', message: 'Example diagnostic.', nodeId: action.id,
      }],
    }

    const result = await analyzeConstructTrace(document, trace, async (context) =>
      context.entries.map(({ node }) => node?.operation ?? node?.label ?? node?.nodeType),
    )

    expect(result.analysis).toEqual(['Update score', 'System.set-eventvar-value'])
    expect(result.context.entries[1]?.node?.sourceLocation).toMatchObject({ sourceId: 'main.c3ev' })
    expect(result.context.diagnostics[0]?.sourceLocation).toEqual(action.sourceLocation)
  })
})
