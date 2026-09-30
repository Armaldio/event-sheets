import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { validateEventDocument, type SourceLocation } from '@project/schema'
import {
  constructCompatibilityFeatures,
  constructImporter,
  createConstructParser,
  exportConstructSheet,
  importConstruct,
  importConstructProject,
  parseConstruct,
  parseConstructStream,
} from '@project/engine-construct'

const sheetSource = readFileSync(new URL('./fixtures/minimal-event-sheet.json', import.meta.url), 'utf8')

function expectSourceRange(source: string, location: SourceLocation | undefined, marker: string, sourceId = 'source-map.c3ev'): void {
  if (location?.offsetStart === undefined || location.offsetEnd === undefined) {
    throw new Error(`Expected source offsets for ${marker}`)
  }
  const range = source.slice(location.offsetStart, location.offsetEnd)
  const startBefore = source.slice(0, location.offsetStart)
  const endBefore = source.slice(0, location.offsetEnd)
  const startLine = startBefore.split('\n')
  const endLine = endBefore.split('\n')

  expect(location.sourceId).toBe(sourceId)
  expect(range.startsWith('{')).toBe(true)
  expect(range.endsWith('}')).toBe(true)
  expect(range).toContain(marker)
  expect(location.lineStart).toBe(startLine.length)
  expect(location.columnStart).toBe((startLine.at(-1)?.length ?? 0) + 1)
  expect(location.lineEnd).toBe(endLine.length)
  expect(location.columnEnd).toBe((endLine.at(-1)?.length ?? 0) + 1)
}

describe('Construct event sheet parser', () => {
  it('maps a minimal sheet and parses known ACE parameters into expressions', () => {
    const result = parseConstruct(sheetSource, { sourceId: 'main.c3ev' })
    const sheet = result.document.sheets[0]

    expect(result.status).toBe('complete')
    expect(result.diagnostics).toEqual([])
    expect(validateEventDocument(result.document).valid).toBe(true)
    expect(sheet).toMatchObject({ id: 'construct:sheet-1', name: 'Main' })
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected a mapped event')
    expect(event.id).toBe('construct:event-1')
    expect(event.sourceLocation?.sourceId).toBe('main.c3ev')
    expect(event.conditions[0]).toMatchObject({
      type: 'condition',
      operation: 'System.compare-two-values',
      parameterIds: ['first-value', 'comparison', 'second-value'],
      parameters: [
        { type: 'property', property: 'X', object: { type: 'identifier', name: 'Player' } },
        { type: 'literal', value: 0 },
        { type: 'literal', value: 10 },
      ],
    })
    expect(event.actions[0]).toMatchObject({
      type: 'action',
      operation: 'System.set-eventvar-value',
      parameters: [
        { type: 'literal', value: 'score' },
        { type: 'binary', operator: '+', left: { type: 'identifier', name: 'score' }, right: { type: 'literal', value: 1 } },
      ],
    })
  })

  it('parses namespaced Construct function expressions as calls', () => {
    const result = parseConstruct(JSON.stringify({
      sid: 'function-expression-sheet',
      events: [{ eventType: 'block', sid: 'function-expression-event', conditions: [], actions: [{
        id: 'set-eventvar-value', objectClass: 'System', sid: 'function-expression-action',
        parameters: { variable: 'result', value: 'Functions.Double(2)' },
      }] }],
    }))
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected a mapped event')

    expect(event.actions[0]).toMatchObject({
      type: 'action',
      parameters: [
        { type: 'literal', value: 'result' },
        {
          type: 'call',
          callee: 'Functions.Double',
          arguments: [{ type: 'literal', value: 2 }],
        },
      ],
    })
  })

  it('parses Construct object names that start with digits and keeps exponent literals numeric', () => {
    const result = parseConstruct(JSON.stringify({
      sid: 'digit-prefixed-identifier-sheet',
      events: [{ eventType: 'block', sid: 'digit-prefixed-identifier-event', conditions: [], actions: [{
        id: 'set-eventvar-value', objectClass: 'System', sid: 'digit-prefixed-identifier-action',
        parameters: { variable: 'result', value: '3DCamera.CameraXRotation + 8Direction.Speed + 3e2' },
      }] }],
    }))
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected a mapped event')

    expect(result.diagnostics.filter(({ code }) => code === 'construct.unknown-expression')).toEqual([])
    expect(event.actions[0]?.parameters[1]).toMatchObject({
      type: 'binary', operator: '+',
      left: {
        type: 'binary', operator: '+',
        left: {
          type: 'property', property: 'CameraXRotation',
          object: { type: 'identifier', name: '3DCamera' },
        },
        right: {
          type: 'property', property: 'Speed',
          object: { type: 'identifier', name: '8Direction' },
        },
      },
      right: { type: 'literal', value: 300 },
    })
  })

  it('parses Construct doubled quotes inside string expressions', () => {
    const result = parseConstruct(JSON.stringify({
      sid: 'quoted-string-sheet',
      events: [{ eventType: 'block', sid: 'quoted-string-event', conditions: [], actions: [{
        id: 'set-eventvar-value', objectClass: 'System', sid: 'quoted-string-action',
        parameters: { variable: 'message', value: '"He said ""hi""" & newline' },
      }] }],
    }))
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected a mapped event')

    expect(event.actions[0]).toMatchObject({
      type: 'action',
      parameters: [
        { type: 'literal', value: 'message' },
        {
          type: 'binary', operator: '&',
          left: { type: 'literal', value: 'He said "hi"' },
          right: { type: 'identifier', name: 'newline' },
        },
      ],
    })
  })

  it('imports named Construct function blocks, parameters, and return types', () => {
    const result = parseConstruct(JSON.stringify({
      sid: 'function-block-sheet',
      events: [{
        eventType: 'function',
        sid: 'calculate-function',
        name: 'Calculate',
        parameters: [{ sid: 'calculate-input', name: 'input', type: 'number', description: 'Input' }],
        returnType: 'number',
        copyPicked: true,
        conditions: [],
        actions: [],
      }],
    }))
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected a mapped function event')

    expect(result.status).toBe('complete')
    expect(validateEventDocument(result.document).valid).toBe(true)
    expect(event).toMatchObject({
      eventKind: 'function',
      label: 'Calculate',
      functionParameters: [{ name: 'input', dataType: 'number' }],
      functionReturnType: 'number',
      functionCopyPicked: true,
    })
  })

  it('maps root-level Construct variables as global declarations with source ranges', () => {
    const source = JSON.stringify({
      sid: 'variable-sheet',
      name: 'Variables',
      events: [
        {
          eventType: 'variable', sid: 'score-variable', name: 'score', type: 'number',
          initialValue: '2 + 3', comment: 'Points', isStatic: false, isConstant: false,
        },
        { eventType: 'block', sid: 'after-variable', conditions: [], actions: [] },
      ],
    }, null, 2)
    const result = parseConstruct(source, { sourceId: 'variables.c3ev' })
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')

    expect(result.status).toBe('complete')
    expect(validateEventDocument(result.document).valid).toBe(true)
    expect(sheet.variables).toHaveLength(1)
    expect(sheet.variables?.[0]).toMatchObject({
      id: 'construct:score-variable', name: 'score', dataType: 'number', scope: 'global',
      initialValue: { type: 'binary', operator: '+', left: { type: 'literal', value: 2 }, right: { type: 'literal', value: 3 } },
      sourceLocation: { sourceId: 'variables.c3ev' },
      metadata: { construct: { raw: { isStatic: false, isConstant: false } } },
    })
    expectSourceRange(source, sheet.variables?.[0]?.sourceLocation, 'score-variable', 'variables.c3ev')
    expect(sheet.events).toHaveLength(1)
  })

  it('maps Construct node source locations back to their exact JSON ranges', () => {
    const eventInput = {
      eventType: 'block',
      sid: 'event-source',
      conditions: [{
        id: 'compare-two-values',
        objectClass: 'System',
        sid: 'condition-source',
        parameters: { first: 'Player.X', comparison: 0, second: 10 },
      }],
      actions: [{
        id: 'set-eventvar-value',
        objectClass: 'System',
        sid: 'action-source',
        parameters: { variable: 'score', value: 'score + 1' },
      }, {
        id: 'future-action',
        objectClass: 'FuturePlugin',
        sid: 'unknown-action-source',
        parameters: { value: 7 },
      }],
    }
    const source = JSON.stringify({ sid: 'sheet-source', name: 'Source map', events: [eventInput] }, null, 2)
    const result = parseConstruct(source, { sourceId: 'source-map.c3ev' })
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected a mapped event')

    expectSourceRange(source, sheet.sourceLocation, 'sheet-source')
    expectSourceRange(source, event.sourceLocation, 'event-source')
    expectSourceRange(source, event.conditions[0]?.sourceLocation, 'condition-source')
    expectSourceRange(source, event.actions[0]?.sourceLocation, 'action-source')
    const action = event.actions[0]
    if (!action || action.type !== 'action') throw new Error('Expected a mapped action')
    const valueExpression = action.parameters[1]
    const expressionLocation = valueExpression?.sourceLocation
    if (expressionLocation?.offsetStart === undefined || expressionLocation.offsetEnd === undefined) {
      throw new Error('Expected a source range for the action expression')
    }
    expect(source.slice(expressionLocation.offsetStart, expressionLocation.offsetEnd)).toBe('"score + 1"')
    const unknownDiagnostic = result.diagnostics.find(({ code }) => code === 'construct.unknown-action')
    expectSourceRange(source, unknownDiagnostic?.sourceLocation, 'unknown-action-source')
  })

  it('preserves and diagnoses an unknown ACE', () => {
    const source = JSON.stringify({
      sid: 's',
      events: [{
        eventType: 'block', sid: 'e',
        conditions: [{ id: 'future-condition', objectClass: 'FuturePlugin', sid: 'condition-a', parameters: { value: 2 } }],
        actions: [{ id: 'future-action', objectClass: 'FuturePlugin', sid: 'a', parameters: { value: 7 } }],
      }],
    })
    const result = parseConstruct(source)
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected a mapped event')

    expect(event.conditions[0]).toMatchObject({
      type: 'unknown',
      nodeType: 'condition',
      raw: { id: 'future-condition', objectClass: 'FuturePlugin', parameters: { value: 2 } },
    })
    expect(event.actions[0]).toMatchObject({
      type: 'unknown',
      nodeType: 'action',
      raw: { id: 'future-action', objectClass: 'FuturePlugin', parameters: { value: 7 } },
    })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.unknown-condition',
      severity: 'warning',
    }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.unknown-action',
      severity: 'warning',
    }))
  })

  it('preserves script actions as opaque nodes without claiming execution support', () => {
    const scriptAction = {
      type: 'script',
      language: 'javascript',
      script: ['runtime.globalVars.score = 1;', 'runtime.goToLayout("Next");'],
    }
    const compactScriptAction = {
      type: 'script',
      script: 'runtime.goToLayout("Next");',
    }
    const source = JSON.stringify({
      sid: 'script-sheet',
      events: [{ eventType: 'block', sid: 'script-event', conditions: [], actions: [scriptAction, compactScriptAction] }],
    })
    const result = parseConstruct(source)
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected a mapped event')

    expect(event.actions).toMatchObject([
      { type: 'unknown', nodeType: 'action', raw: scriptAction },
      { type: 'unknown', nodeType: 'action', raw: compactScriptAction },
    ])
    expect(result.diagnostics.filter(({ code }) => code === 'construct.unsupported-script-action')).toHaveLength(2)
    expect(result.diagnostics.filter(({ code }) => code === 'construct.unsupported-script-action')
      .every(({ severity }) => severity === 'warning')).toBe(true)
    expect(result.diagnostics.some(({ code }) => code === 'construct.incomplete-action')).toBe(false)
    expect(JSON.parse(exportConstructSheet(sheet).output).events[0].actions).toEqual([scriptAction, compactScriptAction])
  })

  it('keeps script actions without source marked incomplete', () => {
    const result = parseConstruct(JSON.stringify({
      sid: 'incomplete-script-sheet',
      events: [{ eventType: 'block', sid: 'incomplete-script-event', conditions: [], actions: [{ type: 'script' }] }],
    }))
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected a mapped event')

    expect(event.actions[0]).toMatchObject({ type: 'incomplete', nodeType: 'action', expected: ['script'] })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.incomplete-script-action',
      severity: 'warning',
    }))
  })

  it('uses numeric Construct SIDs as stable public string IDs', () => {
    const result = parseConstruct(JSON.stringify({
      sid: 123456789012345,
      name: 'Numeric IDs',
      events: [{ eventType: 'block', sid: 234567890123456, conditions: [], actions: [] }],
    }))
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')

    expect(sheet.id).toBe('construct:123456789012345')
    expect(sheet.events[0]?.id).toBe('construct:234567890123456')
  })

  it('keeps a valid action when a neighboring condition is malformed', () => {
    const result = parseConstruct(JSON.stringify({
      sid: 'sheet-invalid-child',
      events: [{
        eventType: 'block', sid: 'event-invalid-child', conditions: [null],
        actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'action-kept',
          parameters: { variable: 'score', value: 1 },
        }],
      }],
    }))
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected a mapped event')

    expect(result.status).toBe('partial')
    expect(event.conditions[0]).toMatchObject({ type: 'invalid', nodeType: 'condition' })
    expect(event.actions[0]).toMatchObject({ type: 'action', id: 'construct:action-kept' })
  })

  it('returns a partial document for invalid JSON instead of throwing', () => {
    const result = parseConstruct('{"sid":')

    expect(result.status).toBe('partial')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.invalid-json' }))
    expect(validateEventDocument(result.document).valid).toBe(true)
  })

  it.each(['', 'E', 'Event', 'Event {', 'Event {\n Condition', 'Event {\n Condition Player.X >'])('keeps partial source %j displayable with diagnostics', (source) => {
    expect(() => parseConstruct(source)).not.toThrow()
    const result = parseConstruct(source)

    expect(result.status).toBe('partial')
    expect(validateEventDocument(result.document).valid).toBe(true)
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it('returns a recoverable incomplete node for truncated JSON', () => {
    const result = parseConstruct('{"sid":"sheet-2","events":[{"eventType":"block","sid":"event-2","conditions":[]')

    expect(result.status).toBe('partial')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.incomplete-input' }))
    expect(result.document.sheets[0]).toMatchObject({ name: 'Event sheet' })
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a recovered sheet')
    expect(sheet.events[0]).toMatchObject({ type: 'incomplete', nodeType: 'event' })
  })

  it('represents an incomplete expression without dropping its event', () => {
    const result = parseConstruct(JSON.stringify({
      sid: 'sheet-expression',
      events: [{
        eventType: 'block', sid: 'event-expression', conditions: [],
        actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'action-expression',
          parameters: { variable: 'score', value: 'score +' },
        }],
      }],
    }))
    const sheet = result.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a mapped sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected a mapped event')

    expect(result.status).toBe('partial')
    expect(event.actions[0]).toMatchObject({
      type: 'action',
      parameters: [{ type: 'literal', value: 'score' }, { type: 'incomplete', sourceText: 'score +' }],
    })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.incomplete-expression' }))
  })

  it('keeps stable Construct SIDs when the input is streamed in chunks', () => {
    const parser = createConstructParser()
    const splitAt = sheetSource.indexOf('\n    }')
    parser.push(sheetSource.slice(0, splitAt))
    const first = parser.snapshot()
    parser.push(sheetSource.slice(splitAt))
    const second = parser.snapshot()
    const final = parser.finish()

    expect(first.document.sheets[0]?.id).toBe(second.document.sheets[0]?.id)
    expect(second.document.sheets[0]?.id).toBe(final.document.sheets[0]?.id)
    const firstSheet = first.document.sheets[0]
    const secondSheet = second.document.sheets[0]
    if (!firstSheet || 'type' in firstSheet || !secondSheet || 'type' in secondSheet) {
      throw new Error('Expected streamed snapshots to contain a sheet')
    }
    const firstEvent = firstSheet.events[0]
    const secondEvent = secondSheet.events[0]
    if (!firstEvent || firstEvent.type !== 'event' || !secondEvent || secondEvent.type !== 'event') {
      throw new Error('Expected streamed snapshots to contain an event')
    }
    expect(firstEvent.id).toBe(secondEvent.id)
    expect(firstEvent.conditions[0]?.id).toBe(secondEvent.conditions[0]?.id)
    expect(firstEvent.actions[0]?.id).toBe(secondEvent.actions[0]?.id)
    expect(final.status).toBe('complete')
  })

  it('turns generated text streams into stable-ID snapshots with structural diffs', async () => {
    async function* generatedChunks(): AsyncGenerator<string> {
      yield '{"sid":"generated-sheet","events":['
      yield '{"eventType":"block","sid":"generated-event","conditions":[],"actions":[]}]} '
    }
    const snapshots = []
    for await (const snapshot of parseConstructStream(generatedChunks(), { sourceId: 'generated.c3ev' })) {
      snapshots.push(snapshot)
    }

    expect(snapshots).toHaveLength(3)
    expect(snapshots[0]).toMatchObject({ index: 0, complete: false, status: 'partial' })
    expect(snapshots[1]?.diff.operations).toContainEqual(expect.objectContaining({
      kind: 'add', nodeType: 'event', nodeId: 'construct:generated-event',
    }))
    expect(snapshots[2]).toMatchObject({ index: 2, complete: true, status: 'complete' })
    expect(snapshots[2]?.diff.isEmpty).toBe(true)
  })

  it('recovers event, action, and expression nodes as later chunks complete them', () => {
    const parser = createConstructParser({ sourceId: 'streamed.c3ev' })
    parser.push('{"sid":"streamed-sheet","events":[{"eventType":"block","sid":"streamed-event"')
    const halfEvent = parser.snapshot()
    const firstSheet = halfEvent.document.sheets[0]
    if (!firstSheet || 'type' in firstSheet) throw new Error('Expected a partial sheet snapshot')
    expect(firstSheet.events[0]).toMatchObject({ type: 'incomplete', nodeType: 'event', id: 'construct:streamed-event' })
    expect(validateEventDocument(halfEvent.document).valid).toBe(true)

    parser.push(',')
    const temporarilyMalformed = parser.snapshot()
    const retainedSheet = temporarilyMalformed.document.sheets[0]
    if (!retainedSheet || 'type' in retainedSheet) throw new Error('Expected the last valid partial sheet')
    expect(retainedSheet.events[0]).toMatchObject({ type: 'incomplete', id: 'construct:streamed-event' })
    expect(temporarilyMalformed.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.invalid-json' }))

    parser.push('"conditions":[],"actions":[{"sid":"streamed-action"')
    const halfAction = parser.snapshot()
    const secondSheet = halfAction.document.sheets[0]
    if (!secondSheet || 'type' in secondSheet) throw new Error('Expected a partial sheet snapshot')
    const secondEvent = secondSheet.events[0]
    if (!secondEvent || secondEvent.type !== 'event') throw new Error('Expected the event to recover')
    expect(secondEvent).toMatchObject({ id: 'construct:streamed-event' })
    expect(secondEvent.actions[0]).toMatchObject({ type: 'incomplete', nodeType: 'action', id: 'construct:streamed-action' })
    expect(validateEventDocument(halfAction.document).valid).toBe(true)

    parser.push(',"id":"set-eventvar-value","objectClass":"System","parameters":{"variable":"score","value":"score +')
    const halfExpression = parser.snapshot()
    const thirdSheet = halfExpression.document.sheets[0]
    if (!thirdSheet || 'type' in thirdSheet) throw new Error('Expected a partial sheet snapshot')
    const thirdEvent = thirdSheet.events[0]
    if (!thirdEvent || thirdEvent.type !== 'event') throw new Error('Expected the event to remain available')
    expect(thirdEvent.actions[0]).toMatchObject({
      type: 'action',
      id: 'construct:streamed-action',
      parameters: [{ type: 'literal', value: 'score' }, { type: 'incomplete', sourceText: 'score +' }],
    })

    parser.push(' 1"}}]}]}')
    const complete = parser.finish()
    const finalSheet = complete.document.sheets[0]
    if (!finalSheet || 'type' in finalSheet) throw new Error('Expected a completed sheet')
    const finalEvent = finalSheet.events[0]
    if (!finalEvent || finalEvent.type !== 'event') throw new Error('Expected the completed event')
    expect(complete.status).toBe('complete')
    expect(finalEvent.id).toBe('construct:streamed-event')
    expect(finalEvent.actions[0]).toMatchObject({
      type: 'action',
      id: 'construct:streamed-action',
      parameters: [{ type: 'literal', value: 'score' }, { type: 'binary', operator: '+' }],
    })
  })

  it('retains the last parseable snapshot when a later stream chunk is malformed', () => {
    const parser = createConstructParser()
    parser.push(sheetSource)
    const good = parser.snapshot()
    parser.push(' trailing garbage')
    const broken = parser.snapshot()

    expect(broken.document.sheets[0]?.id).toBe(good.document.sheets[0]?.id)
    expect(broken.status).toBe('partial')
    expect(broken.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.invalid-json' }))
  })

  it('retains the last recovered partial tree when a later chunk cannot be parsed', () => {
    const parser = createConstructParser()
    const splitAt = sheetSource.indexOf('\n    }')
    parser.push(sheetSource.slice(0, splitAt))
    const recovered = parser.snapshot()
    parser.push(' :')
    const malformed = parser.snapshot()
    const recoveredSheet = recovered.document.sheets[0]
    const malformedSheet = malformed.document.sheets[0]
    if (!recoveredSheet || 'type' in recoveredSheet || !malformedSheet || 'type' in malformedSheet) {
      throw new Error('Expected the recovered sheet to remain displayable')
    }

    expect(recoveredSheet.events[0]).toMatchObject({ type: 'event', id: 'construct:event-1' })
    expect(malformedSheet.id).toBe(recoveredSheet.id)
    expect(malformedSheet.events[0]).toMatchObject({ type: 'event', id: 'construct:event-1' })
    expect(malformed.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.invalid-json' }))
  })
})

describe('Construct project import', () => {
  const projectSource = readFileSync(new URL('./fixtures/minimal-project/project.c3proj', import.meta.url), 'utf8')
  const commonSheetSource = readFileSync(new URL('./fixtures/minimal-project/eventSheets/Shared/Common.json', import.meta.url), 'utf8')

  it('imports every indexed event sheet and preserves the complete project manifest', () => {
    const result = importConstructProject({
      'project.c3proj': projectSource,
      'eventSheets/Main.json': sheetSource,
      'eventSheets/Shared/Common.json': commonSheetSource,
    })

    expect(result.status).toBe('complete')
    expect(validateEventDocument(result.document).valid).toBe(true)
    expect(result.document.id).toBe('construct-project:fixture-project-1')
    expect(result.document.metadata?.construct).toMatchObject({
      format: 'project-folder',
      project: { name: 'Fixture Project', usedAddons: [] },
    })
    expect(result.document.sheets.map((sheet) => 'name' in sheet ? sheet.name : sheet.type)).toEqual(['Main', 'Common logic'])
    const main = result.document.sheets[0]
    if (!main || 'type' in main) throw new Error('Expected the main event sheet')
    expect(main.sourceLocation?.sourceId).toBe('eventSheets/Main.json')
    const shared = result.document.sheets[1]
    if (!shared || 'type' in shared) throw new Error('Expected the shared event sheet')
    expect(shared.id).toBe('construct:555123456789012')
    expect(shared.events[0]).toMatchObject({
      type: 'event',
      eventKind: 'comment',
      comment: 'Preserved unsupported project content.',
      id: 'construct:555123456789013',
    })
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'construct.unknown-event' }))
  })

  it('namespaces path-fallback IDs by event-sheet source path', () => {
    const result = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Fallback IDs',
        uniqueId: 'fallback-ids',
        eventSheets: { items: ['First', 'Second'], subfolders: [] },
      }),
      'eventSheets/First.json': JSON.stringify({ events: [{ eventType: 'comment', text: 'First note' }] }),
      'eventSheets/Second.json': JSON.stringify({ events: [{ eventType: 'comment', text: 'Second note' }] }),
    })
    const first = result.document.sheets[0]
    const second = result.document.sheets[1]
    if (!first || 'type' in first || !second || 'type' in second) throw new Error('Expected both imported sheets')

    expect(result.status).toBe('complete')
    expect(first.events[0]?.id).toBe('construct:eventSheets/First.json:events[0]')
    expect(second.events[0]?.id).toBe('construct:eventSheets/Second.json:events[0]')
    expect(first.events[0]?.id).not.toBe(second.events[0]?.id)
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'schema.duplicate-node-id' }))
  })

  it('retains sheets that are present and reports indexed files that are missing', () => {
    const result = importConstructProject({
      'project.c3proj': projectSource,
      'eventSheets/Main.json': sheetSource,
    })

    expect(result.status).toBe('partial')
    expect(result.document.sheets[0]).toMatchObject({ name: 'Main' })
    expect(result.document.sheets[1]).toMatchObject({
      type: 'incomplete', nodeType: 'sheet', id: 'construct:missing-sheet:eventSheets:Shared:Common.json',
    })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.missing-event-sheet' }))
    expect(validateEventDocument(result.document).valid).toBe(true)
  })

  it('reports invalid and colliding folder-project file paths instead of dropping them silently', () => {
    const result = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Path diagnostics', uniqueId: 'path-diagnostics',
        eventSheets: { items: ['Main'], subfolders: [] },
      }),
      'eventSheets/Main.json': sheetSource,
      'eventSheets//Main.json': JSON.stringify({ sid: 'duplicate', name: 'Duplicate', events: [] }),
      '../escape.bin': 'must not be retained',
      '/absolute.bin': 'must not be retained',
      'C:\\absolute.bin': 'must not be retained',
    })

    expect(result.status).toBe('partial')
    expect(result.document.sheets).toHaveLength(1)
    expect(result.document.sheets[0]).toMatchObject({ name: 'Main' })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.duplicate-project-file-path' }))
    expect(result.diagnostics.filter(({ code }) => code === 'construct.invalid-project-file-path')).toHaveLength(3)
    expect(result.document.metadata?.construct).toMatchObject({
      files: { 'eventSheets/Main.json': sheetSource },
    })
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'project-file-map-paths', status: 'TESTED',
    }))
  })

  it('provides the public importer contract for event-sheet text and project file maps', () => {
    expect(constructImporter.engineId).toBe('construct')
    expect(importConstruct(sheetSource).document.sheets[0]).toMatchObject({ name: 'Main' })
    expect(importConstruct({ 'project.c3proj': projectSource, 'eventSheets/Main.json': sheetSource }).document.sheets).toHaveLength(2)
  })

  it('returns a recoverable result for a malformed project manifest', () => {
    const result = importConstructProject({ 'project.c3proj': '{broken' })

    expect(result.status).toBe('partial')
    expect(result.document.sheets[0]).toMatchObject({ type: 'incomplete', nodeType: 'sheet' })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.invalid-project-json' }))
    expect(validateEventDocument(result.document).valid).toBe(true)
  })
})
