import { describe, expect, it } from 'vitest'
import type { HostAdapter } from '@project/schema'
import { compileConstruct, createConstructRuntime, createSelectionContext } from '@project/engine-construct'
import { importConstruct } from '@project/engine-construct'

interface Instance {
  type: string
  properties: Record<string, string | number | boolean | null>
}

const host: HostAdapter<{ layout: string }, Instance> = {
  engineId: 'construct',
  getContext: () => ({ layout: 'main' }),
  getInstances: () => [],
  getObjectType: (instance) => instance.type,
  getProperty: (instance, property) => instance.properties[property] ?? null,
  setProperty: (instance, property, value) => { instance.properties[property] = value },
  callAction: () => undefined,
  createInstance: (objectType) => ({ type: objectType, properties: {} }),
  destroyInstance: () => undefined,
  queryObjects: (objectType) => objectType ? [] : [],
}

describe('Construct execution foundation', () => {
  it('compiles a validated Construct document to registered operations', () => {
    const document = importConstruct(JSON.stringify({
      sid: 'compile-sheet', name: 'Compile',
      events: [{ eventType: 'block', sid: 'compile-event', conditions: [{
        id: 'every-tick', objectClass: 'System', sid: 'compile-condition',
      }], actions: [] }],
    })).document

    const result = compileConstruct(document)

    expect(result.status).toBe('complete')
    expect(result.diagnostics).toEqual([])
    expect(result.compiled.sheets[0]?.events[0]?.conditions[0]?.definition).toMatchObject({
      objectClass: 'System', id: 'every-tick',
    })
  })

  it('compiles comment events without treating them as executable blocks', () => {
    const document = importConstruct(JSON.stringify({
      sid: 'unsupported-sheet',
      events: [{ eventType: 'comment', sid: 'unsupported-comment', text: 'keep me' }],
    })).document

    const result = compileConstruct(document)

    expect(result.status).toBe('complete')
    expect(result.compiled.sheets[0]?.events[0]?.source).toMatchObject({
      type: 'event', eventKind: 'comment', comment: 'keep me',
    })
    expect(result.diagnostics).toEqual([])
  })

  it('creates independent explicit selection contexts with parent links', () => {
    const parent = createSelectionContext<Instance>()
    const child = createSelectionContext(parent)
    const player = { type: 'Player', properties: {} }
    parent.selectionsByObjectType.set('Player', new Set([player]))
    child.createdInstances.add(player)
    child.containerRelationships.set(player, new Set())

    expect(child.parentContext).toBe(parent)
    expect(child.selectionsByObjectType.has('Player')).toBe(false)
    expect(parent.selectionsByObjectType.get('Player')?.has(player)).toBe(true)
    expect(child.createdInstances.has(player)).toBe(true)
  })

  it('returns a structured trace while executing supported conditions and actions', () => {
    const document = importConstruct(JSON.stringify({
      sid: 'trace-sheet', name: 'Trace',
      events: [{
        eventType: 'block', sid: 'trace-event', conditions: [{
          id: 'every-tick', objectClass: 'System', sid: 'trace-condition',
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'trace-action',
          parameters: { variable: 'score', value: 4 },
        }],
        children: [{ eventType: 'block', sid: 'trace-child', conditions: [], actions: [] }],
      }],
    })).document
    const compiled = compileConstruct(document).compiled
    const runtime = createConstructRuntime(host)

    const trace = runtime.run(compiled, 'construct:trace-sheet')

    expect(trace).toMatchObject({ documentId: document.id, sheetId: 'construct:trace-sheet' })
    expect(trace.entries).toEqual([
      expect.objectContaining({ kind: 'sheet', status: 'selected', nodeId: 'construct:trace-sheet' }),
      expect.objectContaining({ kind: 'event', status: 'passed', nodeId: 'construct:trace-event' }),
      expect.objectContaining({ kind: 'condition', status: 'passed', nodeId: 'construct:trace-condition' }),
      expect.objectContaining({ kind: 'action', status: 'executed', nodeId: 'construct:trace-action' }),
      expect.objectContaining({ kind: 'event', status: 'passed', nodeId: 'construct:trace-child', parentNodeId: 'construct:trace-event' }),
    ])
    expect(runtime.variables.get('score')).toBe(4)
    expect(runtime.selection.selectionsByObjectType.size).toBe(0)
    runtime.selection.selectionsByObjectType.set('Player', new Set())
    runtime.reset()
    expect(runtime.selection.selectionsByObjectType.size).toBe(0)
  })
})
