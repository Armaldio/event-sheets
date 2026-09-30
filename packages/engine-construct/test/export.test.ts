import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  analyzeConstructExport,
  constructCompatibilityFeatures,
  exportConstructProject,
  exportConstructSheet,
  importConstruct,
  importConstructProject,
} from '@project/engine-construct'

const sheetSource = readFileSync(new URL('./fixtures/minimal-event-sheet.json', import.meta.url), 'utf8')
const projectSource = readFileSync(new URL('./fixtures/minimal-project/project.c3proj', import.meta.url), 'utf8')
const commonSheetSource = readFileSync(new URL('./fixtures/minimal-project/eventSheets/Shared/Common.json', import.meta.url), 'utf8')

describe('Construct exporter', () => {
  it('round-trips an untouched event sheet without changing its Construct data', () => {
    const imported = importConstruct(sheetSource)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')

    const exported = exportConstructSheet(sheet)

    expect(exported.status).toBe('complete')
    expect(JSON.parse(exported.output)).toEqual(JSON.parse(sheetSource))
  })

  it('imports comment events, exports text edits, and preserves their raw fields', () => {
    const source = JSON.stringify({
      sid: 'comment-sheet',
      name: 'Comments',
      events: [
        { eventType: 'comment', sid: 'comment-event', text: 'Original note', editorColor: 'yellow' },
        { eventType: 'comment', text: 'No original SID' },
      ],
    })
    const imported = importConstruct(source)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')
    const comment = sheet.events[0]
    if (!comment || comment.type !== 'event') throw new Error('Expected an imported comment event')

    expect(imported.status).toBe('complete')
    expect(comment).toMatchObject({ eventKind: 'comment', comment: 'Original note', conditions: [], actions: [] })
    comment.comment = 'Edited note'

    const exported = exportConstructSheet(sheet)
    const output = JSON.parse(exported.output) as { events: Array<Record<string, unknown>> }

    expect(exported.status).toBe('complete')
    expect(output.events).toEqual([
      { eventType: 'comment', sid: 'comment-event', text: 'Edited note', editorColor: 'yellow' },
      { eventType: 'comment', text: 'No original SID' },
    ])
  })

  it('imports and exports action comments without inventing ACE fields', () => {
    const source = JSON.stringify({
      sid: 'action-comment-sheet',
      events: [{ eventType: 'block', sid: 'action-comment-event', conditions: [], actions: [
        { type: 'comment', text: 'Original action note', editorColor: 'green' },
      ] }],
    })
    const imported = importConstruct(source)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected an imported event')
    const comment = event.actions[0]
    if (!comment || comment.type !== 'comment') throw new Error('Expected an imported action comment')

    expect(imported.status).toBe('complete')
    comment.text = 'Edited action note'

    const exported = exportConstructSheet(sheet)
    const analysis = analyzeConstructExport(imported.document)
    const output = JSON.parse(exported.output) as { events: Array<{ actions: unknown[] }> }

    expect(exported.status).toBe('complete')
    expect(analysis).toMatchObject({ supported: true, lossless: true })
    expect(output.events[0]?.actions).toEqual([
      { type: 'comment', text: 'Edited action note', editorColor: 'green' },
    ])
  })

  it('preserves omitted parameter objects on parameterless ACEs', () => {
    const source = JSON.stringify({
      sid: 'parameterless-sheet',
      name: 'Parameterless',
      events: [{
        eventType: 'block',
        sid: 'parameterless-event',
        conditions: [{ id: 'on-start-of-layout', objectClass: 'System', sid: 'start-trigger' }],
        actions: [{ id: 'stop-loop', objectClass: 'System', sid: 'stop-loop-action' }],
      }],
    })
    const imported = importConstruct(source)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')

    const exported = exportConstructSheet(sheet)

    expect(exported.status).toBe('complete')
    expect(JSON.parse(exported.output)).toEqual(JSON.parse(source))
  })

  it('round-trips editable root-level variables in their original event-sheet order', () => {
    const source = JSON.stringify({
      sid: 'variable-order-sheet',
      name: 'Variables',
      events: [
        { eventType: 'variable', sid: 'score', name: 'score', type: 'number', initialValue: '2', isStatic: false, isConstant: false },
        { eventType: 'block', sid: 'middle-event', conditions: [], actions: [] },
        { eventType: 'variable', sid: 'enabled', name: 'enabled', type: 'boolean', initialValue: 'true', isStatic: true, isConstant: false },
      ],
    }, null, 2)
    const imported = importConstruct(source)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet || !sheet.variables) throw new Error('Expected imported sheet variables')
    sheet.variables[0] = {
      ...sheet.variables[0] as Extract<typeof sheet.variables[number], { name: string }>,
      name: 'points',
      initialValue: { type: 'literal', value: 4 },
    }

    const analysis = analyzeConstructExport(imported.document)
    const exported = exportConstructSheet(sheet)
    const output = JSON.parse(exported.output) as { events: Array<Record<string, unknown>> }
    const reparsed = importConstruct(exported.output).document.sheets[0]

    expect(analysis).toMatchObject({ supported: true, lossless: true, potentiallyLossy: false })
    expect(exported.status).toBe('complete')
    expect(output.events.map(({ eventType, sid }) => [eventType, sid])).toEqual([
      ['variable', 'score'], ['block', 'middle-event'], ['variable', 'enabled'],
    ])
    expect(output.events[0]).toMatchObject({ name: 'points', initialValue: '4', isStatic: false })
    expect(output.events[2]).toMatchObject({ name: 'enabled', initialValue: 'true', isStatic: true })
    if (!reparsed || 'type' in reparsed) throw new Error('Expected exported sheet to parse again')
    expect(reparsed.variables).toMatchObject([
      { name: 'points', scope: 'global' },
      { name: 'enabled', scope: 'global' },
    ])
  })

  it('keeps original fields that the current schema does not understand', () => {
    const source = JSON.stringify({
      sid: 'opaque-fields-sheet',
      name: 7,
      events: [{
        eventType: 'block', sid: 'opaque-fields-event', conditions: [], actions: [],
        name: { futureLabel: true }, isEnabled: 'future-mode',
      }],
    })
    const imported = importConstruct(source)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')

    const output = JSON.parse(exportConstructSheet(sheet).output) as Record<string, unknown>
    const event = (output.events as Array<Record<string, unknown>>)[0]

    expect(output.name).toBe(7)
    expect(event).toMatchObject({ name: { futureLabel: true }, isEnabled: 'future-mode' })
  })

  it('exports edits to supported nodes while keeping opaque fields from the source', () => {
    const source = JSON.stringify({
      sid: 'edited-sheet',
      name: 'Before',
      editorExtra: { color: 'blue' },
      events: [{
        eventType: 'block', sid: 'edited-event', conditions: [{
          id: 'compare-two-values', objectClass: 'System', sid: 'edited-condition',
          parameters: { 'first-value': 'score', comparison: 0, 'second-value': 0 },
        }], actions: [{
          id: 'set-eventvar-value', objectClass: 'System', sid: 'edited-action',
          parameters: { variable: 'score', value: 'score + 1', futureParameter: 'preserve-me' },
          pluginExtra: true,
        }],
      }],
    })
    const imported = importConstruct(source)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')
    sheet.name = 'After'
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected an imported event')
    event.label = 'Changed event'
    event.enabled = false
    const condition = event.conditions[0]
    if (!condition || condition.type !== 'condition') throw new Error('Expected an imported condition')
    condition.inverted = true
    event.actions[0] = {
      ...event.actions[0] as Extract<typeof event.actions[number], { type: 'action' }>,
      parameters: [
        { type: 'literal', value: 'score' },
        { type: 'binary', operator: '+', left: { type: 'identifier', name: 'score' }, right: { type: 'literal', value: 2 } },
      ],
    }

    const exported = exportConstructSheet(sheet)
    const output = JSON.parse(exported.output) as Record<string, unknown>
    const outputEvent = (output.events as Array<Record<string, unknown>>)[0]
    const action = (outputEvent.actions as Array<Record<string, unknown>>)[0]
    const conditionOutput = (outputEvent.conditions as Array<Record<string, unknown>>)[0]

    expect(exported.status).toBe('complete')
    expect(output).toMatchObject({ name: 'After', editorExtra: { color: 'blue' } })
    expect(action.parameters).toMatchObject({ variable: 'score', value: 'score + 2', futureParameter: 'preserve-me' })
    expect(action.pluginExtra).toBe(true)
    expect(outputEvent).toMatchObject({ name: 'Changed event', isEnabled: false })
    expect(conditionOutput.isInverted).toBe(true)

    const reparsed = importConstruct(exported.output)
    const roundTrippedSheet = reparsed.document.sheets[0]
    if (!roundTrippedSheet || 'type' in roundTrippedSheet) throw new Error('Expected the edited sheet to re-import')
    const roundTrippedEvent = roundTrippedSheet.events[0]
    if (!roundTrippedEvent || roundTrippedEvent.type !== 'event') throw new Error('Expected the edited event to re-import')
    expect(roundTrippedEvent).toMatchObject({ label: 'Changed event', enabled: false })
    expect(roundTrippedEvent.conditions[0]).toMatchObject({ inverted: true })
    expect(roundTrippedEvent.actions[0]).toMatchObject({
      type: 'action',
      parameters: [
        { type: 'literal', value: 'score' },
        { type: 'binary', operator: '+', left: { type: 'identifier', name: 'score' }, right: { type: 'literal', value: 2 } },
      ],
    })
  })

  it('exports a newly added supported action with its expression parameters', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'new-sheet', name: 'New sheet',
      events: [{ eventType: 'block', sid: 'new-event', conditions: [], actions: [] }],
    }))
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected an imported event')
    event.actions.push({
      type: 'action',
      id: 'new-action',
      operation: 'System.set-eventvar-value',
      parameterIds: ['variable', 'value'],
      parameters: [
        { type: 'literal', value: 'score' },
        { type: 'binary', operator: '+', left: { type: 'identifier', name: 'score' }, right: { type: 'literal', value: 3 } },
      ],
    })

    const exported = exportConstructSheet(sheet)
    const output = JSON.parse(exported.output) as Record<string, unknown>
    const outputEvent = (output.events as Array<Record<string, unknown>>)[0]
    const action = (outputEvent.actions as Array<Record<string, unknown>>)[0]

    expect(action).toMatchObject({
      id: 'set-eventvar-value', objectClass: 'System', sid: 'new-action',
      parameters: { variable: 'score', value: 'score + 3' },
    })
    expect(exported.status).toBe('complete')
  })

  it('preserves comment event text and unknown source fields', () => {
    const source = JSON.stringify({
      sid: 'opaque-sheet',
      events: [{ eventType: 'comment', sid: 'comment-1', text: 'keep this', addonData: [1, 2, 3] }],
    })
    const imported = importConstruct(source)
    const analysis = analyzeConstructExport(imported.document)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')

    const exported = exportConstructSheet(sheet)

    expect(analysis).toMatchObject({ supported: true, potentiallyLossy: false })
    expect(analysis.lossless).toBe(true)
    expect(JSON.parse(exported.output)).toMatchObject({ events: [{ eventType: 'comment', text: 'keep this', addonData: [1, 2, 3] }] })
  })

  it('round-trips an unrecognized future event record without interpreting it', () => {
    const source = JSON.stringify({
      sid: 'future-sheet',
      events: [{
        eventType: 'future-flow-control', sid: 'future-node', version: 3,
        settings: { mode: 'parallel', retry: 2 }, children: [{ customPayload: ['keep', 7] }],
      }],
    })
    const imported = importConstruct(source)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')

    const exported = exportConstructSheet(sheet)

    expect(sheet.events[0]).toMatchObject({
      type: 'unknown', nodeType: 'event', id: 'construct:future-node',
      raw: expect.objectContaining({ eventType: 'future-flow-control', version: 3 }),
    })
    expect(JSON.parse(exported.output)).toEqual(JSON.parse(source))
    expect(exported.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.export.opaque-preserved' }))
  })

  it('preserves unknown ACE records without claiming their behavior is supported', () => {
    const source = JSON.stringify({
      sid: 'plugin-sheet',
      events: [{ eventType: 'block', sid: 'plugin-event', conditions: [], actions: [{
        id: 'future-action', objectClass: 'FuturePlugin', sid: 'plugin-action',
        parameters: { input: 'Keep this value' }, futureFlag: { enabled: true },
      }] }],
    })
    const imported = importConstruct(source)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')

    const analysis = analyzeConstructExport(imported.document)
    const output = JSON.parse(exportConstructSheet(sheet).output) as Record<string, unknown>
    const event = (output.events as Array<Record<string, unknown>>)[0]

    expect(analysis).toMatchObject({ supported: false, lossless: true, potentiallyLossy: false })
    expect((event.actions as Array<unknown>)[0]).toEqual({
      id: 'future-action', objectClass: 'FuturePlugin', sid: 'plugin-action',
      parameters: { input: 'Keep this value' }, futureFlag: { enabled: true },
    })
  })

  it('exports project files at their imported paths and retains the project manifest', () => {
    const imported = importConstructProject({
      'project.c3proj': projectSource,
      'eventSheets/Main.json': sheetSource,
      'eventSheets/Shared/Common.json': commonSheetSource,
    })

    const exported = exportConstructProject(imported.document)

    expect(exported.status).toBe('complete')
    expect(JSON.parse(exported.output['project.c3proj'] ?? '')).toEqual(JSON.parse(projectSource))
    expect(JSON.parse(exported.output['eventSheets/Main.json'] ?? '')).toEqual(JSON.parse(sheetSource))
    expect(JSON.parse(exported.output['eventSheets/Shared/Common.json'] ?? '')).toEqual(JSON.parse(commonSheetSource))
  })

  it('places a standalone imported sheet under the project event-sheets index', () => {
    const imported = importConstruct(sheetSource, { sourceId: 'main.c3ev' })

    const exported = exportConstructProject(imported.document)

    expect(exported.output['eventSheets/Main.json']).toBeDefined()
    expect(exported.output['main.c3ev']).toBeUndefined()
    expect(exported.status).toBe('partial')
    expect(exported.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.export.missing-project-manifest',
    }))
  })

  it('adds a newly authored sheet to the project manifest index', () => {
    const imported = importConstructProject({
      'project.c3proj': projectSource,
      'eventSheets/Main.json': sheetSource,
      'eventSheets/Shared/Common.json': commonSheetSource,
    })
    imported.document.sheets.push({ id: 'bonus-sheet', name: 'Bonus', events: [] })

    const exported = exportConstructProject(imported.document)
    const manifest = JSON.parse(exported.output['project.c3proj'] ?? '') as Record<string, unknown>

    expect(exported.status).toBe('complete')
    expect(exported.output['eventSheets/Bonus.json']).toBeDefined()
    expect(manifest.eventSheets).toMatchObject({ items: ['Main', 'Bonus'] })
  })

  it('preserves an opaque project file when a new sheet would collide with its path', () => {
    const preservedResource = JSON.stringify({ futureResource: true, payload: [1, 2, 3] })
    const imported = importConstructProject({
      'project.c3proj': projectSource,
      'eventSheets/Main.json': sheetSource,
      'eventSheets/Shared/Common.json': commonSheetSource,
      'eventSheets/Bonus.json': preservedResource,
    })
    imported.document.sheets.push({ id: 'bonus-sheet', name: 'Bonus', events: [] })

    const analysis = analyzeConstructExport(imported.document)
    const exported = exportConstructProject(imported.document)
    const manifest = JSON.parse(exported.output['project.c3proj'] ?? '') as Record<string, unknown>

    expect(analysis).toMatchObject({ supported: false, lossless: false, potentiallyLossy: true })
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.export.project-output-path-collision', severity: 'warning',
    }))
    expect(exported.output['eventSheets/Bonus.json']).toBe(preservedResource)
    expect(manifest.eventSheets).toMatchObject({ items: ['Main'] })
    expect(exported.status).toBe('partial')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'project-output-path-conflicts', status: 'TESTED',
    }))
  })

  it('reports duplicate, unsafe, and relocated sheet output path conflicts', () => {
    const duplicateImport = importConstructProject({
      'project.c3proj': projectSource,
      'eventSheets/Main.json': sheetSource,
      'eventSheets/Shared/Common.json': commonSheetSource,
    })
    const mainSheet = duplicateImport.document.sheets[0]
    if (!mainSheet || 'type' in mainSheet) throw new Error('Expected an imported main sheet')
    duplicateImport.document.sheets.push({ ...mainSheet, id: 'duplicate-main-sheet', name: 'Duplicate Main' })

    const duplicateAnalysis = analyzeConstructExport(duplicateImport.document)
    const duplicateExport = exportConstructProject(duplicateImport.document)
    expect(duplicateAnalysis.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.export.project-output-path-collision', severity: 'warning',
    }))
    expect(duplicateExport.output['eventSheets/Main.json']).toBeDefined()
    expect(duplicateExport.status).toBe('partial')

    const unsafeImport = importConstructProject({
      'project.c3proj': projectSource,
      'eventSheets/Main.json': sheetSource,
      'eventSheets/Shared/Common.json': commonSheetSource,
    })
    const unsafeSheet = unsafeImport.document.sheets[0]
    if (!unsafeSheet || 'type' in unsafeSheet) throw new Error('Expected an imported main sheet')
    unsafeSheet.sourceLocation = { sourceId: '../escape.json' }

    const unsafeAnalysis = analyzeConstructExport(unsafeImport.document)
    const unsafeExport = exportConstructProject(unsafeImport.document)
    expect(unsafeAnalysis.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.export.project-output-path-collision', severity: 'warning',
    }))
    expect(unsafeExport.output['../escape.json']).toBeUndefined()
    expect(unsafeExport.status).toBe('partial')

    const relocatedImport = importConstructProject({
      'project.c3proj': projectSource,
      'eventSheets/Main.json': sheetSource,
      'eventSheets/Shared/Common.json': commonSheetSource,
    })
    const relocatedSheet = relocatedImport.document.sheets[0]
    if (!relocatedSheet || 'type' in relocatedSheet) throw new Error('Expected an imported main sheet')
    relocatedSheet.sourceLocation = { sourceId: 'main.c3ev' }

    const relocatedAnalysis = analyzeConstructExport(relocatedImport.document)
    const relocatedExport = exportConstructProject(relocatedImport.document)
    expect(relocatedAnalysis.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.export.project-output-path-collision', severity: 'warning',
    }))
    expect(relocatedExport.output['eventSheets/Main.json']).toBe(sheetSource)
    expect(relocatedExport.status).toBe('partial')
  })

  it('filters unsafe preserved paths and uses a safe manifest fallback', () => {
    const imported = importConstructProject({
      'project.c3proj': projectSource,
      'eventSheets/Main.json': sheetSource,
      'eventSheets/Shared/Common.json': commonSheetSource,
    })
    const construct = imported.document.metadata?.construct
    if (!construct || typeof construct !== 'object' || Array.isArray(construct)) throw new Error('Expected Construct metadata')
    const files = construct.files
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Expected preserved project files')
    construct.sourceId = '../outside/project.c3proj'
    files['../escape.bin'] = 'must not be exported'
    files['assets//manifest.bin'] = 'first file'
    files['assets/manifest.bin'] = 'second file'

    const analysis = analyzeConstructExport(imported.document)
    const exported = exportConstructProject(imported.document)

    expect(analysis).toMatchObject({ supported: false, lossless: false, potentiallyLossy: true })
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.export.invalid-project-file-path', severity: 'warning',
    }))
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.export.duplicate-project-file-path', severity: 'warning',
    }))
    expect(exported.output['../escape.bin']).toBeUndefined()
    expect(exported.output['assets/manifest.bin']).toBe('first file')
    expect(JSON.parse(exported.output['project.c3proj'] ?? '')).toMatchObject({ name: 'Fixture Project' })
    expect(exported.status).toBe('partial')
  })

  it('reports project resources that were not present in the import file map', () => {
    const projectWithLayout = JSON.stringify({
      ...JSON.parse(projectSource) as Record<string, unknown>,
      eventSheets: { items: ['Main'], subfolders: [] },
      layouts: { items: ['Game'], subfolders: [] },
    })
    const imported = importConstructProject({
      'project.c3proj': projectWithLayout,
      'eventSheets/Main.json': sheetSource,
      'eventSheets/Shared/Common.json': commonSheetSource,
    })

    const exported = exportConstructProject(imported.document)
    const analysis = analyzeConstructExport(imported.document)

    expect(analysis).toMatchObject({ supported: true, lossless: false, potentiallyLossy: true })
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.export.project-files-not-imported',
      severity: 'warning',
      sourceLocation: { sourceId: 'project.c3proj' },
    }))
    expect(exported.status).toBe('partial')
  })

  it('preserves non-event-sheet project files supplied by the importer', () => {
    const projectWithLayout = JSON.stringify({
      ...JSON.parse(projectSource) as Record<string, unknown>,
      eventSheets: { items: ['Main'], subfolders: [] },
      layouts: { items: ['Game'], subfolders: [] },
    })
    const layoutSource = JSON.stringify({ sid: 'layout-1', name: 'Game', layers: [] })
    const imported = importConstructProject({
      'project.c3proj': projectWithLayout,
      'eventSheets/Main.json': sheetSource,
      'layouts/Game.json': layoutSource,
    })

    const exported = exportConstructProject(imported.document)
    const analysis = analyzeConstructExport(imported.document)

    expect(analysis).toMatchObject({ supported: true, lossless: true, potentiallyLossy: false })
    expect(exported.output['layouts/Game.json']).toBe(layoutSource)
  })

  it('recognizes unknown expressions as preserved but unsupported source', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'expression-sheet',
      events: [{ eventType: 'block', sid: 'expression-event', conditions: [], actions: [{
        id: 'set-eventvar-value', objectClass: 'System', sid: 'expression-action',
        parameters: { variable: 'score', value: 'score +' },
      }] }],
    }))

    const analysis = analyzeConstructExport(imported.document)

    expect(analysis).toMatchObject({ supported: false, lossless: true, potentiallyLossy: false })
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.export.opaque-expression' }))
  })

  it('maps export diagnostics back to the original Construct node range', () => {
    const unknownAction = {
      id: 'future-action', objectClass: 'FuturePlugin', sid: 'future-action-sid',
      parameters: { value: 'Keep this' },
    }
    const source = JSON.stringify({
      sid: 'source-map-sheet',
      events: [{ eventType: 'block', sid: 'source-map-event', conditions: [], actions: [unknownAction] }],
    }, null, 2)
    const imported = importConstruct(source, { sourceId: 'eventSheets/Main.json' })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')

    const analysisDiagnostic = analyzeConstructExport(imported.document).diagnostics
      .find(({ code }) => code === 'construct.export.opaque-preserved')

    expect(analysisDiagnostic).toBeDefined()
    expect(analysisDiagnostic?.sourceLocation).toMatchObject({ sourceId: 'eventSheets/Main.json' })
    const analysisLocation = analysisDiagnostic?.sourceLocation
    expect(analysisLocation?.offsetStart).toBeTypeOf('number')
    expect(analysisLocation?.offsetEnd).toBeTypeOf('number')
    expect(JSON.parse(source.slice(analysisLocation?.offsetStart, analysisLocation?.offsetEnd))).toEqual(unknownAction)

    const exportDiagnostic = exportConstructSheet(sheet).diagnostics
      .find(({ code }) => code === 'construct.export.opaque-preserved')
    expect(exportDiagnostic?.sourceLocation).toEqual(analysisDiagnostic?.sourceLocation)

    const importedProject = importConstructProject({
      'project.c3proj': projectSource,
      'eventSheets/Main.json': source,
      'eventSheets/Shared/Common.json': commonSheetSource,
    })
    const projectDiagnostic = exportConstructProject(importedProject.document).diagnostics
      .find(({ code }) => code === 'construct.export.opaque-preserved')
    expect(projectDiagnostic?.sourceLocation).toEqual(analysisDiagnostic?.sourceLocation)
  })

  it('reports and repairs duplicate Construct SIDs on supported output nodes', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'duplicate-sheet',
      events: [
        { eventType: 'block', sid: 'duplicate-event', conditions: [], actions: [] },
        { eventType: 'block', sid: 'duplicate-event', conditions: [], actions: [] },
      ],
    }))
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')

    const analysis = analyzeConstructExport(imported.document)
    const exported = exportConstructSheet(sheet)
    const output = JSON.parse(exported.output) as Record<string, unknown>
    const events = output.events as Array<Record<string, unknown>>

    expect(analysis).toMatchObject({ lossless: false, potentiallyLossy: true })
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.export.duplicate-sid' }))
    expect(events[0]?.sid).not.toBe(events[1]?.sid)
    expect(exported.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.export.duplicate-sid' }))
  })

  it('reports when a sheet cannot be reconstructed from source or schema fields', () => {
    const imported = importConstruct('{"sid":"bad","events":[null]}')
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')
    sheet.events[0] = { type: 'incomplete', nodeType: 'event', id: 'missing-source' }

    const analysis = analyzeConstructExport(imported.document)

    expect(analysis).toMatchObject({ supported: false, lossless: false, potentiallyLossy: true })
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({ code: 'construct.export.lossy-node', severity: 'warning' }))
  })

  it('reports schema variables that the Construct exporter does not serialize yet', () => {
    const imported = importConstruct(sheetSource)
    imported.document.variables.push({
      id: 'score', name: 'score', dataType: 'number', scope: 'global',
      initialValue: { type: 'literal', value: 0 },
      sourceLocation: { sourceId: 'main.c3ev', offsetStart: 20, offsetEnd: 45 },
    })

    const analysis = analyzeConstructExport(imported.document)

    expect(analysis).toMatchObject({ supported: false, lossless: false, potentiallyLossy: true })
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.export.unsupported-variables',
      nodeId: 'score',
      sourceLocation: { sourceId: 'main.c3ev', offsetStart: 20, offsetEnd: 45 },
    }))
  })

  it('exports OR-block and Else event flags', () => {
    const imported = importConstruct(JSON.stringify({
      sid: 'event-flow-flags',
      events: [
        { eventType: 'block', sid: 'or-event', isOrBlock: true, conditions: [], actions: [] },
        { eventType: 'block', sid: 'else-event', isElse: true, conditions: [], actions: [] },
      ],
    }))

    const exported = exportConstructSheet(imported.document.sheets[0])
    const sheet = JSON.parse(exported.output) as { events: Array<Record<string, unknown>> }

    expect(sheet.events[0]).toMatchObject({ isOrBlock: true })
    expect(sheet.events[1]).toMatchObject({ isElse: true })
  })
})
