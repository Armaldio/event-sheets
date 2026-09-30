import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, unzipSync, zipSync, Zip, ZipPassThrough } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { HostAdapter, JsonValue, VariableDeclaration } from '@project/schema'
import {
  compileConstruct,
  constructCompatibilityFeatures,
  createConstructEngine,
  createConstructRuntime,
  exportConstructProject,
  exportConstructArchive,
  exportConstructSheet,
  compareConstructTraces,
  formatConstructCompatibilityReport,
  importConstruct,
  importConstructArchive,
  importConstructProject,
  type ExecutionTrace,
} from '@project/engine-construct'

interface CompatibilityFixture {
  id: string
  featureId: string
  coveredFeatureIds?: string[]
  status: string
  input: Record<string, unknown>
  hostInstances: CompatibilityInstance[]
  schemaVariables?: VariableDeclaration[]
  expectedBehavior: string
  expectedSelections: Array<{ action: string; instanceIds: string[] }>
  expectedActions: string[]
  expectedOutput: Record<string, unknown>
  trigger?: { operation: string; parameters?: JsonValue[] }
}

interface CompatibilityInstance {
  type: string
  properties: Record<string, JsonValue>
}

interface ConstructRuntimeCapture {
  source: {
    archiveSha256: string
    captureMethod: string
    constructRelease: string
    scenario: {
      globalVariables: Record<string, JsonValue>
      buttonBefore: { x: number; y: number; layout: string }
      buttonAfter: { x: number; y: number; layout: string }
    }
    ambientCalls?: { method: string; count: number; result: boolean; note: string }
    evidenceLimitations: string[]
  }
  aceCalls: Array<{
    owner: string
    section: 'Cnds' | 'Acts'
    name: string
    engineOperation: string
    args: JsonValue[]
    result?: boolean
  }>
  runtimeTraceProjection: ExecutionTrace
}

function loadFixture(name: string): CompatibilityFixture {
  const path = new URL('./fixtures/compatibility/' + name, import.meta.url)
  return JSON.parse(readFileSync(path, 'utf8')) as CompatibilityFixture
}

function loadConstructRuntimeCapture(name: string): ConstructRuntimeCapture {
  const path = new URL('./fixtures/compatibility/' + name, import.meta.url)
  return JSON.parse(readFileSync(path, 'utf8')) as ConstructRuntimeCapture
}

function loadProjectFiles(root: string): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else files[relative(root, path).split(sep).join('/')] = new Uint8Array(readFileSync(path))
    }
  }
  visit(root)
  return files
}

function expectProjectFilesPreserved(
  source: Record<string, Uint8Array>,
  output: Record<string, string | Uint8Array>,
): void {
  const normalizePaths = <T>(files: Record<string, T>): Map<string, T> => {
    const normalized = new Map<string, T>()
    for (const [path, content] of Object.entries(files)) {
      const normalizedPath = path.replaceAll('\\', '/')
      if (normalized.has(normalizedPath)) throw new Error('Project paths collide after normalization: ' + normalizedPath)
      normalized.set(normalizedPath, content)
    }
    return normalized
  }
  const normalizedSource = normalizePaths(source)
  const normalizedOutput = normalizePaths(output)
  expect([...normalizedOutput.keys()].sort()).toEqual([...normalizedSource.keys()].sort())
  for (const [path, sourceContent] of normalizedSource) {
    const outputContent = normalizedOutput.get(path)
    if (outputContent === undefined) throw new Error('Missing exported project file: ' + path)
    const outputBytes = typeof outputContent === 'string' ? new TextEncoder().encode(outputContent) : outputContent
    if (path === 'project.c3proj' || (path.startsWith('eventSheets/') && path.endsWith('.json'))) {
      expect(JSON.parse(new TextDecoder().decode(outputBytes))).toEqual(
        JSON.parse(new TextDecoder().decode(sourceContent)),
      )
    } else {
      expect(outputBytes).toEqual(sourceContent)
    }
  }
}

function stripZipDataDescriptorSignatures(archive: Uint8Array): Uint8Array {
  const input = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  let endOffset = archive.byteLength - 22
  while (endOffset >= 0 && input.getUint32(endOffset, true) !== 0x06054b50) endOffset -= 1
  if (endOffset < 0) throw new Error('Expected a ZIP end-of-central-directory record')

  const entryCount = input.getUint16(endOffset + 10, true)
  const centralOffset = input.getUint32(endOffset + 16, true)
  const centralEntries: Array<{ recordOffset: number; localOffset: number }> = []
  const descriptorOffsets: number[] = []
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (input.getUint32(cursor, true) !== 0x02014b50) throw new Error('Expected a ZIP central-directory entry')
    const compressedSize = input.getUint32(cursor + 20, true)
    const filenameLength = input.getUint16(cursor + 28, true)
    const extraLength = input.getUint16(cursor + 30, true)
    const commentLength = input.getUint16(cursor + 32, true)
    const localOffset = input.getUint32(cursor + 42, true)
    centralEntries.push({ recordOffset: cursor, localOffset })

    const localNameLength = input.getUint16(localOffset + 26, true)
    const localExtraLength = input.getUint16(localOffset + 28, true)
    const descriptorOffset = localOffset + 30 + localNameLength + localExtraLength + compressedSize
    if (input.getUint32(descriptorOffset, true) !== 0x08074b50) {
      throw new Error('Expected a signed ZIP data descriptor')
    }
    descriptorOffsets.push(descriptorOffset)
    cursor += 46 + filenameLength + extraLength + commentLength
  }

  const removed = [...descriptorOffsets].sort((left, right) => left - right)
  const output = new Uint8Array(archive.byteLength - (removed.length * 4))
  let sourceOffset = 0
  let outputOffset = 0
  for (const descriptorOffset of removed) {
    const length = descriptorOffset - sourceOffset
    output.set(archive.subarray(sourceOffset, descriptorOffset), outputOffset)
    outputOffset += length
    sourceOffset = descriptorOffset + 4
  }
  output.set(archive.subarray(sourceOffset, centralOffset), outputOffset)
  const newCentralOffset = centralOffset - (removed.length * 4)
  output.set(archive.subarray(centralOffset, endOffset), newCentralOffset)
  const centralRecordShift = newCentralOffset - centralOffset
  const outputView = new DataView(output.buffer)
  for (const { recordOffset, localOffset } of centralEntries) {
    const priorDescriptors = removed.filter((offset) => offset < localOffset).length
    outputView.setUint32(recordOffset + centralRecordShift + 42, localOffset - (priorDescriptors * 4), true)
  }
  const newEndOffset = endOffset - (removed.length * 4)
  output.set(archive.subarray(endOffset), newEndOffset)
  outputView.setUint32(newEndOffset + 16, newCentralOffset, true)
  return output
}

function makeHost(
  instances: CompatibilityInstance[],
  actionCalls: Array<{ action: string; instanceIds: string[] }> = [],
): HostAdapter<null, CompatibilityInstance> {
  return {
    engineId: 'construct',
    getContext: () => null,
    getInstances: (objectType) => instances.filter((instance) => instance.type === objectType),
    getObjectType: (instance) => instance.type,
    getProperty: (instance, property) => instance.properties[property] ?? null,
    setProperty: (instance, property, value) => { instance.properties[property] = value },
    callAction: (_objectClass, _actionId, targets, parameters) => {
      const action = parameters[0]
      actionCalls.push({
        action: typeof action === 'string' ? action : '',
        instanceIds: targets.map((instance) => String(instance.properties.id)),
      })
    },
    createInstance: (objectType) => ({ type: objectType, properties: {} }),
    destroyInstance: () => undefined,
    queryObjects: (objectType) => instances.filter((instance) => instance.type === objectType),
  }
}

function createSampleProjectEngine() {
  return createConstructEngine({ extensions: [
    {
      id: 'fixture.nav-button', objectClass: 'NavButton', conditions: [{
        id: 'on-clicked', category: 'general', name: 'On clicked', scriptName: 'OnClicked', isTrigger: true,
      }],
    },
    {
      id: 'fixture.sprite2', objectClass: 'Sprite2', actions: [{
        id: 'stop', category: 'general', name: 'Stop', scriptName: 'Stop',
      }],
    },
    {
      id: 'fixture.text-family', objectClass: 'TextFamily', actions: [{
        id: 'start-timer', category: 'general', name: 'Start timer', scriptName: 'StartTimer', parameters: [
          { id: 'duration', type: 'number' },
          { id: 'type', type: 'string' },
          { id: 'tag', type: 'any' },
        ],
      }],
    },
    {
      id: 'fixture.text', objectClass: 'Text', actions: [{
        id: 'stop-timer', category: 'general', name: 'Stop timer', scriptName: 'StopTimer',
        parameters: [{ id: 'tag', type: 'any' }],
      }],
    },
  ] })
}

describe('Construct compatibility fixtures', () => {
  it('round-trips an editor-exported project folder and archive without JSON changes', async () => {
    const root = fileURLToPath(new URL('./fixtures/editor-projects/construct3-sample-v0.4.0/project/', import.meta.url))
    const sourceFiles = loadProjectFiles(root)
    const importedFolder = importConstructProject(sourceFiles)
    const exportedFolder = exportConstructProject(importedFolder.document)

    expect(Object.keys(sourceFiles).length).toBeGreaterThan(100)
    expect(importedFolder.status).toBe('complete')
    expect(importedFolder.document.sheets.map((sheet) => sheet.name)).toEqual(['Event sheet 1', 'Event sheet 2'])
    expect(importedFolder.diagnostics.map(({ code }) => code)).toContain('construct.unknown-action')
    expect(exportedFolder.status).toBe('complete')
    expectProjectFilesPreserved(sourceFiles, exportedFolder.output)

    const importedArchive = await importConstructArchive(zipSync(sourceFiles))
    const exportedArchive = exportConstructArchive(importedArchive.document)
    const archiveFiles = unzipSync(exportedArchive.output)

    expect(importedArchive.status).toBe('complete')
    expect(exportedArchive.status).toBe('complete')
    expectProjectFilesPreserved(sourceFiles, archiveFiles)
  }, 15_000)

  it('exports a known-node edit from the full project without changing unrelated files', () => {
    const root = fileURLToPath(new URL('./fixtures/editor-projects/construct3-sample-v0.4.0/project/', import.meta.url))
    const sourceFiles = loadProjectFiles(root)
    const imported = importConstructProject(sourceFiles)
    const sheet = imported.document.sheets.find((node) => !('type' in node) && node.name === 'Event sheet 1')
    if (!sheet || 'type' in sheet) throw new Error('Expected the sample main event sheet')

    const editGoToLayout = (events: typeof sheet.events): boolean => {
      for (const event of events) {
        if (event.type !== 'event') continue
        const actionIndex = event.actions.findIndex((node) =>
          node.type === 'action' && node.operation.endsWith('.go-to-layout'),
        )
        if (actionIndex !== -1) {
          const action = event.actions[actionIndex]
          if (!action || action.type !== 'action') throw new Error('Expected the Construct layout action')
          event.actions[actionIndex] = {
            ...action,
            parameters: [{ type: 'literal', value: 'Templates Layout' }, ...action.parameters.slice(1)],
          }
          return true
        }
        if (editGoToLayout(event.subEvents ?? [])) return true
      }
      return false
    }
    expect(editGoToLayout(sheet.events)).toBe(true)

    const exported = exportConstructProject(imported.document)
    const editedPath = 'eventSheets/Event sheet 1.json'
    const expectedSheet = JSON.parse(new TextDecoder().decode(sourceFiles[editedPath] ?? new Uint8Array())) as {
      events: Array<Record<string, unknown>>
    }
    const updateSourceAction = (events: Array<Record<string, unknown>>): boolean => {
      for (const event of events) {
        const actions = event.actions
        if (Array.isArray(actions)) {
          const action = actions.find((node) =>
            node !== null && typeof node === 'object' && 'id' in node && node.id === 'go-to-layout',
          ) as { parameters?: Record<string, unknown> } | undefined
          if (action?.parameters) {
            action.parameters.layout = 'Templates Layout'
            return true
          }
        }
        if (Array.isArray(event.children) && updateSourceAction(event.children as Array<Record<string, unknown>>)) return true
      }
      return false
    }
    expect(updateSourceAction(expectedSheet.events)).toBe(true)

    expect(exported.status).toBe('complete')
    expect(Object.keys(exported.output).sort()).toEqual(Object.keys(sourceFiles).sort())
    for (const [path, sourceContent] of Object.entries(sourceFiles)) {
      if (path === editedPath) continue
      const outputContent = exported.output[path]
      if (outputContent === undefined) throw new Error('Missing exported project file: ' + path)
      const outputBytes = typeof outputContent === 'string' ? new TextEncoder().encode(outputContent) : outputContent
      if (path === 'project.c3proj' || (path.startsWith('eventSheets/') && path.endsWith('.json'))) {
        expect(JSON.parse(new TextDecoder().decode(outputBytes))).toEqual(
          JSON.parse(new TextDecoder().decode(sourceContent)),
        )
      } else {
        expect(outputBytes).toEqual(sourceContent)
      }
    }
    expect(JSON.parse(exported.output[editedPath] as string)).toEqual(expectedSheet)

    const reparsed = importConstructProject(exported.output)
    const reparsedSheet = reparsed.document.sheets.find((node) => !('type' in node) && node.name === 'Event sheet 1')
    if (!reparsedSheet || 'type' in reparsedSheet) throw new Error('Expected the edited sheet to re-import')
    expect(reparsed.status).toBe('complete')
    const hasEditedLayoutAction = (events: typeof reparsedSheet.events): boolean => events.some((event) =>
      event.type === 'event'
        && (event.actions.some((action) =>
          action.type === 'action'
            && action.operation.endsWith('.go-to-layout')
            && action.parameters[0]?.type === 'literal'
            && action.parameters[0].value === 'Templates Layout',
        ) || hasEditedLayoutAction(event.subEvents ?? [])),
    )
    expect(hasEditedLayoutAction(reparsedSheet.events)).toBe(true)
  }, 15_000)

  it('round-trips a Construct r495.2 editor-saved sample archive', async () => {
    const archivePath = new URL(
      './fixtures/editor-projects/construct3-sample-v0.4.0/construct3-sample-r495.2-editor-saved.c3p',
      import.meta.url,
    )
    const sourceArchive = new Uint8Array(readFileSync(archivePath))
    const sourceFiles = unzipSync(sourceArchive)
    const imported = await importConstructArchive(sourceArchive)
    const exported = exportConstructArchive(imported.document)
    const exportedFiles = unzipSync(exported.output)

    expect(imported.status).toBe('complete')
    expect(imported.document.sheets.map((sheet) => sheet.name)).toEqual(['Event sheet 1', 'Event sheet 2'])
    const unknownAces = imported.diagnostics.filter(({ code }) => code === 'construct.unknown-condition' || code === 'construct.unknown-action')
    expect(unknownAces).toHaveLength(1)
    expect(unknownAces[0]?.code).toBe('construct.unknown-action')
    expect(imported.document.metadata?.construct).toMatchObject({ format: 'project-archive' })
    expect(exported.status).toBe('complete')
    expectProjectFilesPreserved(sourceFiles, exportedFiles)
  })

  it('compares editor-project execution with observed Construct r495.2 ACE calls', async () => {
    const engine = createSampleProjectEngine()
    const archivePath = new URL(
      './fixtures/editor-projects/construct3-sample-v0.4.0/construct3-sample-r495.2-trigger-score1.c3p',
      import.meta.url,
    )
    const archiveBytes = new Uint8Array(readFileSync(archivePath))
    const imported = await importConstructArchive(archiveBytes, { registry: engine.registry })
    const compiled = compileConstruct(imported.document, { registry: engine.registry })
    const instances: CompatibilityInstance[] = [
      { type: 'Sprite2', properties: { id: 'sprite-1' } },
      { type: 'Text', properties: { id: 'text-1' } },
    ]
    const actionCalls: Array<{
      operation: string
      instanceIds: string[]
      parameters: JsonValue[]
    }> = []
    const host = makeHost(instances)
    const queryObjects = host.queryObjects.bind(host)
    host.queryObjects = (objectType, predicate) => {
      const candidates = objectType === 'TextFamily'
        ? instances.filter((instance) => instance.type === 'Text')
        : queryObjects(objectType)
      return candidates.filter((instance) => predicate?.(instance) ?? true)
    }
    host.callAction = (objectClass, actionId, targets, parameters) => {
      actionCalls.push({
        operation: objectClass + '.' + actionId,
        instanceIds: targets.map((instance) => String(instance.properties.id)),
        parameters: [...parameters],
      })
    }
    const runtime = createConstructRuntime(host)
    const sheet = imported.document.sheets[0]
    if (!sheet) throw new Error('Expected the editor project main event sheet')

    runtime.run(compiled.compiled, sheet.id)
    expect(runtime.variables.get('score')).toBe(1)
    const trace = runtime.dispatchTrigger(compiled.compiled, sheet.id, { operation: 'NavButton.on-clicked' })
    const capture = loadConstructRuntimeCapture('construct-r495.2-trigger-trace.json')

    expect(imported.diagnostics).toEqual([])
    expect(compiled.status).toBe('complete')
    expect(trace.status).toBe('complete')
    expect(capture.source.constructRelease).toBe('r495.2')
    expect(createHash('sha256').update(archiveBytes).digest('hex')).toBe(capture.source.archiveSha256)
    expect(capture.source.scenario).toMatchObject({
      globalVariables: { score: 1 },
      buttonBefore: { layout: 'Main Layout' },
      buttonAfter: { layout: 'Second Layout' },
    })
    expect(capture.aceCalls.map(({ owner, section, name }) => `${owner}.${section}.${name}`)).toEqual([
      'Button.Cnds.OnClicked',
      'System.Cnds.Compare',
      'System.Cnds.CompareVar',
      'System.Acts.AddVar',
      'MyCompany_MyBehavior.Acts.Stop',
      'Timer.Acts.StartTimer',
      'System.Acts.GoToLayout',
    ])
    const capturedConditions = capture.aceCalls.filter(({ section }) => section === 'Cnds')
    const capturedActions = capture.aceCalls.filter(({ section }) => section === 'Acts')
    expect(capturedConditions.map(({ args }) => args)).toEqual([
      [],
      [1, 4, 0],
      [{ name: 'temp', sid: 100000000000021, value: 0 }, 0, 0],
    ])
    const traceConditions = trace.entries.filter(({ kind }) => kind === 'condition')
    const traceActions = trace.entries.filter(({ kind }) => kind === 'action')
    expect(traceConditions.map(({ details }) => details?.operation)).toEqual(
      capturedConditions.map(({ engineOperation }) => engineOperation),
    )
    expect(traceConditions.map(({ details }) => details?.result)).toEqual(
      capturedConditions.map(({ result }) => result),
    )
    expect(traceActions.map(({ details }) => details?.operation)).toEqual(
      capturedActions.map(({ engineOperation }) => engineOperation),
    )
    expect(capturedActions.map(({ args }) => args)).toEqual([
      [{ name: 'temp', sid: 100000000000021, value: 0 }, 1],
      [],
      [1, 0, 'test'],
      ['Second Layout'],
    ])
    expect(compareConstructTraces(trace, capture.runtimeTraceProjection)).toEqual({ matches: true, differences: [] })
    expect(trace.entries.filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId)).toEqual([
      'construct:503974656149130',
      'construct:444777231675422',
      'construct:781413955177885',
      'construct:631897527420293',
    ])
    expect(actionCalls).toEqual([
      { operation: 'Sprite2.stop', instanceIds: ['sprite-1'], parameters: [] },
      { operation: 'TextFamily.start-timer', instanceIds: ['text-1'], parameters: [1, 'once', 'test'] },
      { operation: 'System.go-to-layout', instanceIds: [], parameters: ['Second Layout'] },
    ])
  })

  it('compares Mouse Cursor is over object with an observed Construct r495.2 call', async () => {
    const engine = createSampleProjectEngine()
    const archivePath = new URL(
      './fixtures/editor-projects/construct3-sample-v0.4.0/construct3-sample-r495.2-mouse-cursor-score1.c3p',
      import.meta.url,
    )
    const archiveBytes = new Uint8Array(readFileSync(archivePath))
    const imported = await importConstructArchive(archiveBytes, { registry: engine.registry })
    const compiled = compileConstruct(imported.document, { registry: engine.registry })
    const instances: CompatibilityInstance[] = [
      { type: 'Sprite2', properties: { id: 'sprite-1' } },
      { type: 'Text', properties: { id: 'text-1' } },
    ]
    const host = makeHost(instances)
    const queryObjects = host.queryObjects.bind(host)
    host.queryObjects = (objectType, predicate) => {
      const candidates = objectType === 'TextFamily'
        ? instances.filter((instance) => instance.type === 'Text')
        : queryObjects(objectType)
      return candidates.filter((instance) => predicate?.(instance) ?? true)
    }
    const conditionCalls: Array<{ operation: string; parameters: readonly JsonValue[] }> = []
    host.evaluateCondition = (operation, parameters) => {
      conditionCalls.push({ operation, parameters: [...parameters] })
      return operation === 'Mouse.cursor-is-over-object' && parameters[0] === 'NavButton'
    }
    const actionCalls: Array<{
      operation: string
      instanceIds: string[]
      parameters: JsonValue[]
    }> = []
    host.callAction = (objectClass, actionId, targets, parameters) => {
      actionCalls.push({
        operation: objectClass + '.' + actionId,
        instanceIds: targets.map((instance) => String(instance.properties.id)),
        parameters: [...parameters],
      })
    }
    const runtime = createConstructRuntime(host)
    const sheet = imported.document.sheets[0]
    if (!sheet) throw new Error('Expected the editor project main event sheet')

    runtime.run(compiled.compiled, sheet.id)
    expect(runtime.variables.get('score')).toBe(1)
    const trace = runtime.dispatchTrigger(compiled.compiled, sheet.id, { operation: 'NavButton.on-clicked' })
    const capture = loadConstructRuntimeCapture('construct-r495.2-mouse-cursor-trace.json')

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics).toEqual([])
    expect(compiled.status).toBe('complete')
    expect(trace.status).toBe('complete')
    expect(capture.source.constructRelease).toBe('r495.2')
    expect(createHash('sha256').update(archiveBytes).digest('hex')).toBe(capture.source.archiveSha256)
    expect(capture.source.scenario).toMatchObject({
      globalVariables: { score: 1 },
      buttonBefore: { layout: 'Main Layout', x: 325, y: 203 },
      buttonAfter: { layout: 'Second Layout', x: 104, y: 59 },
    })
    expect(capture.aceCalls.map(({ owner, section, name }) => `${owner}.${section}.${name}`)).toEqual([
      'Button.Cnds.OnClicked',
      'Mouse.Cnds.IsOverObject',
      'System.Cnds.Compare',
      'System.Cnds.CompareVar',
      'System.Acts.AddVar',
      'MyCompany_MyBehavior.Acts.Stop',
      'Timer.Acts.StartTimer',
      'System.Acts.GoToLayout',
    ])
    const capturedConditions = capture.aceCalls.filter(({ section }) => section === 'Cnds')
    const capturedActions = capture.aceCalls.filter(({ section }) => section === 'Acts')
    expect(capturedConditions.map(({ args, result }) => ({ args, result }))).toEqual([
      { args: [], result: true },
      { args: [{ name: 'NavButton' }], result: true },
      { args: [1, 4, 0], result: true },
      { args: [{ name: 'temp', sid: 100000000000021, value: 0 }, 0, 0], result: true },
    ])
    const traceConditions = trace.entries.filter(({ kind }) => kind === 'condition')
    const traceActions = trace.entries.filter(({ kind }) => kind === 'action')
    expect(conditionCalls).toEqual([{
      operation: 'Mouse.cursor-is-over-object',
      parameters: ['NavButton'],
    }])
    expect(traceConditions.map(({ details }) => details?.operation)).toEqual(
      capturedConditions.map(({ engineOperation }) => engineOperation),
    )
    expect(traceConditions.map(({ details }) => details?.result)).toEqual(
      capturedConditions.map(({ result }) => result),
    )
    expect(traceActions.map(({ details }) => details?.operation)).toEqual(
      capturedActions.map(({ engineOperation }) => engineOperation),
    )
    expect(capturedActions.map(({ args }) => args)).toEqual([
      [{ name: 'temp', sid: 100000000000021, value: 0 }, 1],
      [],
      [1, 0, 'test'],
      [{ name: 'Second Layout' }],
    ])
    expect(compareConstructTraces(trace, capture.runtimeTraceProjection)).toEqual({ matches: true, differences: [] })
    expect(actionCalls).toEqual([
      { operation: 'Sprite2.stop', instanceIds: ['sprite-1'], parameters: [] },
      { operation: 'TextFamily.start-timer', instanceIds: ['text-1'], parameters: [1, 'once', 'test'] },
      { operation: 'System.go-to-layout', instanceIds: [], parameters: ['Second Layout'] },
    ])
  })

  it('compares Construct short-circuit behavior when the first value condition fails', async () => {
    const engine = createSampleProjectEngine()
    const archivePath = new URL(
      './fixtures/editor-projects/construct3-sample-v0.4.0/construct3-sample-r495.2-trigger-score0.c3p',
      import.meta.url,
    )
    const archiveBytes = new Uint8Array(readFileSync(archivePath))
    const imported = await importConstructArchive(archiveBytes, { registry: engine.registry })
    const compiled = compileConstruct(imported.document, { registry: engine.registry })
    const instances: CompatibilityInstance[] = [
      { type: 'Sprite2', properties: { id: 'sprite-1' } },
      { type: 'Text', properties: { id: 'text-1' } },
    ]
    const actionCalls: Array<{ action: string; instanceIds: string[] }> = []
    const host = makeHost(instances, actionCalls)
    const queryObjects = host.queryObjects.bind(host)
    host.queryObjects = (objectType, predicate) => {
      const candidates = objectType === 'TextFamily'
        ? instances.filter((instance) => instance.type === 'Text')
        : queryObjects(objectType)
      return candidates.filter((instance) => predicate?.(instance) ?? true)
    }
    const runtime = createConstructRuntime(host)
    const sheet = imported.document.sheets[0]
    if (!sheet) throw new Error('Expected the editor project main event sheet')

    runtime.run(compiled.compiled, sheet.id)
    expect(runtime.variables.get('score')).toBe(0)
    const trace = runtime.dispatchTrigger(compiled.compiled, sheet.id, { operation: 'NavButton.on-clicked' })
    const capture = loadConstructRuntimeCapture('construct-r495.2-trigger-score-zero-trace.json')
    const capturedConditions = capture.aceCalls.filter(({ section }) => section === 'Cnds')
    const evaluatedTraceConditions = trace.entries.filter(({ kind, details }) => kind === 'condition' && details !== undefined)

    expect(imported.status).toBe('complete')
    expect(imported.diagnostics).toEqual([])
    expect(compiled.status).toBe('complete')
    expect(trace.status).toBe('complete')
    expect(createHash('sha256').update(archiveBytes).digest('hex')).toBe(capture.source.archiveSha256)
    expect(capture.source.constructRelease).toBe('r495.2')
    expect(capture.source.scenario).toMatchObject({
      globalVariables: { score: 0 },
      buttonBefore: { layout: 'Main Layout', x: 325, y: 203 },
      buttonAfter: { layout: 'Main Layout', x: 325, y: 203 },
    })
    expect(capture.source.ambientCalls).toMatchObject({
      method: 'System.Cnds.IsGroupActive', count: 98, result: true,
    })
    expect(capture.aceCalls.map(({ owner, section, name }) => `${owner}.${section}.${name}`)).toEqual([
      'Button.Cnds.OnClicked',
      'System.Cnds.Compare',
    ])
    expect(capturedConditions.map(({ args, result }) => ({ args, result }))).toEqual([
      { args: [], result: true },
      { args: [0, 4, 0], result: false },
    ])
    expect(evaluatedTraceConditions.map(({ details }) => details?.operation)).toEqual(
      capturedConditions.map(({ engineOperation }) => engineOperation),
    )
    expect(evaluatedTraceConditions.map(({ details }) => details?.result)).toEqual(
      capturedConditions.map(({ result }) => result),
    )
    expect(trace.entries.filter(({ kind }) => kind === 'condition').map(({ status }) => status))
      .toEqual(['passed', 'failed', 'skipped'])
    expect(trace.entries.filter(({ kind }) => kind === 'action').map(({ status }) => status))
      .toEqual(['skipped', 'skipped', 'skipped', 'skipped'])
    expect(actionCalls).toEqual([])
    expect(compareConstructTraces(trace, capture.runtimeTraceProjection)).toEqual({ matches: true, differences: [] })
  })

  it('round-trips Construct Create object parameter names and optional fields', () => {
    const source = JSON.stringify({
      sid: 'create-object-parameters-sheet',
      name: 'Create object parameters',
      events: [{
        eventType: 'block',
        sid: 'create-object-parameters-event',
        conditions: [],
        actions: [{
          id: 'create-object',
          objectClass: 'System',
          sid: 'create-object-parameters-action',
          parameters: {
            'object-to-create': 'Swatch',
            layer: '0',
            x: '10',
            y: '20',
            'create-hierarchy': true,
            'template-name': '""',
          },
        }],
      }],
    })
    const imported = importConstruct(source)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')

    const exported = exportConstructSheet(sheet)

    expect(imported.status).toBe('complete')
    expect(exported.status).toBe('complete')
    expect(JSON.parse(exported.output)).toEqual(JSON.parse(source))
  })

  it('imports and exports ZIP project archives while preserving binary entries', async () => {
    const image = new Uint8Array([137, 80, 78, 71, 0, 255, 42])
    const archive = zipSync({
      'project.c3proj': strToU8(JSON.stringify({
        name: 'Archived project', uniqueId: 'archived-project',
        eventSheets: { items: ['Main'], subfolders: [] },
      })),
      'eventSheets/Main.json': strToU8(JSON.stringify({ sid: 'archived-main', name: 'Main', events: [] })),
      'images/player.png': image,
    })

    const imported = await importConstructArchive(archive)
    const exported = exportConstructArchive(imported.document)
    const files = unzipSync(exported.output)
    const exportedProject = JSON.parse(new TextDecoder().decode(files['project.c3proj'])) as { name: string }

    expect(imported.status).toBe('complete')
    expect(imported.document.metadata?.construct).toMatchObject({ format: 'project-archive' })
    expect(exported.status).toBe('complete')
    expect(exportedProject.name).toBe('Archived project')
    expect(files['images/player.png']).toEqual(image)
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'c3p-archive-import', status: 'TESTED',
    }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'c3p-archive-export', status: 'TESTED',
    }))
  })

  it('imports stored files with unsigned ZIP data descriptors exactly', async () => {
    const image = new Uint8Array([137, 80, 78, 71, 0, 255, 42])
    const chunks: Uint8Array[] = []
    const zip = new Zip((error, chunk) => {
      if (error) throw error
      chunks.push(chunk.slice())
    })
    const entries = {
      'project.c3proj': strToU8(JSON.stringify({
        name: 'Streaming archive', uniqueId: 'streaming-archive',
        eventSheets: { items: ['Main'], subfolders: [] },
      })),
      'eventSheets/Main.json': strToU8(JSON.stringify({ sid: 'streaming-main', name: 'Main', events: [] })),
      'images/player.png': image,
    }
    for (const [name, contents] of Object.entries(entries)) {
      const entry = new ZipPassThrough(name)
      zip.add(entry)
      entry.push(contents, true)
    }
    zip.end()
    const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    const signedArchive = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      signedArchive.set(chunk, offset)
      offset += chunk.byteLength
    }
    const archive = stripZipDataDescriptorSignatures(signedArchive)

    expect(new DataView(archive.buffer, archive.byteOffset).getUint16(6, true) & 0x08).not.toBe(0)
    expect(unzipSync(archive)['images/player.png']).toEqual(image)
    const imported = await importConstructArchive(archive)
    const exported = exportConstructArchive(imported.document)
    const files = unzipSync(exported.output)

    expect(imported.status).toBe('complete')
    expect(exported.status).toBe('complete')
    expect(files['images/player.png']).toEqual(image)
  })

  it('round-trips current Construct function-block records', () => {
    // Serialized shape observed in the pinned Construct 3 project-folder corpus:
    // https://github.com/fodi/construct-3-projects/tree/4cd387425b1a6c20bf7607190be7b237a4a52f4a/projectfolders/BlankTemplate/eventSheets/Functions
    const source = JSON.stringify({
      sid: 'function-block-record-sheet',
      name: 'Functions',
      events: [{
        eventType: 'function-block',
        sid: 'function-block-record',
        functionName: 'Calculate',
        functionDescription: 'Calculate a result',
        functionCategory: 'Math',
        functionReturnType: 'number',
        functionCopyPicked: true,
        functionIsAsync: false,
        functionParameters: [{
          sid: 'function-block-parameter',
          name: 'input',
          type: 'number',
          initialValue: '0',
          comment: 'Input value',
        }],
        conditions: [],
        actions: [],
        children: [{ eventType: 'block', sid: 'function-block-child', conditions: [], actions: [] }],
      }],
    })
    const imported = importConstruct(source)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported function sheet')
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected an imported function block')

    expect(imported.status).toBe('complete')
    expect(event).toMatchObject({
      eventKind: 'function',
      label: 'Calculate',
      functionParameters: [{ name: 'input', dataType: 'number' }],
      functionReturnType: 'number',
      functionCopyPicked: true,
    })
    expect(JSON.parse(exportConstructSheet(sheet).output)).toEqual(JSON.parse(source))

    event.label = 'CalculateNew'
    const edited = JSON.parse(exportConstructSheet(sheet).output) as {
      events: Array<Record<string, unknown>>
    }
    expect(edited.events[0]).toMatchObject({ eventType: 'function-block', functionName: 'CalculateNew' })
    expect(edited.events[0]?.name).toBeUndefined()
    expect(edited.events[0]?.parameters).toBeUndefined()
  })

  it('preserves asynchronous function-blocks as unsupported source', () => {
    const source = JSON.stringify({
      sid: 'async-function-block-sheet',
      events: [{
        eventType: 'function-block',
        sid: 'async-function-block',
        functionName: 'LoadAsync',
        functionIsAsync: true,
        functionParameters: [],
        functionReturnType: 'none',
        conditions: [],
        actions: [],
      }],
    })
    const imported = importConstruct(source)
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported function sheet')

    expect(sheet.events[0]).toMatchObject({ type: 'unknown', nodeType: 'event' })
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.unsupported-async-function',
      severity: 'warning',
    }))
    expect(JSON.parse(exportConstructSheet(sheet).output)).toEqual(JSON.parse(source))
  })

  it('filters unsafe preserved paths before packaging project archives', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({ name: 'Path guard', eventSheets: { items: [], subfolders: [] } }),
    })
    const metadata = imported.document.metadata?.construct
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Expected Construct metadata')
    const files = metadata.files
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Expected preserved project files')
    files['../escape.txt'] = 'outside project root'

    const exported = exportConstructArchive(imported.document)

    expect(exported.output.byteLength).toBeGreaterThan(0)
    expect(unzipSync(exported.output)['../escape.txt']).toBeUndefined()
    expect(exported.status).toBe('partial')
    expect(exported.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.export.invalid-project-file-path', severity: 'warning',
    }))
  })

  it('rejects malformed and oversized ZIP archives without throwing', async () => {
    const malformed = await importConstructArchive(new Uint8Array([1, 2, 3]))
    const archive = zipSync({
      'large.bin': new Uint8Array(32_000).fill(1),
      'extra.bin': new Uint8Array(0),
    })
    const oversized = await importConstructArchive(archive, { maxExpandedBytes: 1024 })
    const compressedLimit = importConstructArchive(archive, { maxArchiveBytes: archive.byteLength - 1 })
    const entryLimit = importConstructArchive(archive, { maxEntries: 1 })

    expect(malformed.status).toBe('partial')
    expect(malformed.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.invalid-project-archive', severity: 'error',
    }))
    expect(oversized.status).toBe('partial')
    expect(oversized.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.project-archive-size-limit', severity: 'error',
    }))
    expect(compressedLimit.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.project-archive-size-limit', severity: 'error',
    }))
    expect(entryLimit.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.project-archive-size-limit', severity: 'error',
    }))
  })

  it('compares the supported comparison options with the documented order', () => {
    const fixture = loadFixture('comparison-options.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const trace = createConstructRuntime(makeHost(fixture.hostInstances))
      .run(compileConstruct(document).compiled, 'construct:compat-comparisons')
    const conditionResults = trace.entries
      .filter(({ kind }) => kind === 'condition')
      .map(({ status }) => status === 'passed')

    expect(conditionResults).toEqual(fixture.expectedOutput.conditionResults)
    expect(trace.entries.filter(({ kind, status }) => kind === 'action' && status === 'executed')).toEqual([])
    expect(fixture.expectedSelections).toEqual([])
    expect(fixture.status).toBe('TESTED')
  })

  it('compares picked targets and child/sibling selection behavior with the manual baseline', () => {
    const fixture = loadFixture('selection-inheritance.json')
    const engine = createConstructEngine({ extensions: [{
      id: 'compatibility.player',
      objectClass: 'Player',
      actions: [{
        id: 'record', category: 'general', name: 'Record', scriptName: 'Record',
        parameters: [{ id: 'action', type: 'string' }],
      }],
    }] })
    const document = importConstruct(JSON.stringify(fixture.input), { registry: engine.registry }).document
    const actionCalls: Array<{ action: string; instanceIds: string[] }> = []
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances, actionCalls))
    const trace = runtime.run(compileConstruct(document, { registry: engine.registry }).compiled, 'construct:compat-selection')
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(actionCalls).toEqual(fixture.expectedSelections)
    expect(executedActions).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'condition', nodeId: 'construct:child-pick-condition', status: 'failed',
      details: expect.objectContaining({ selectedCount: 0 }),
    }))
    expect(trace.status).toBe('complete')
  })

  it('imports and executes named function blocks with modern and legacy call expressions', () => {
    const fixture = loadFixture('functions-return-values.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(document).compiled, 'construct:compat-functions')
    const action = trace.entries.find(({ kind, nodeId }) => kind === 'action' && nodeId === 'construct:read-function-result')
    const importedSheet = document.sheets.find((sheet) => !('type' in sheet))
    const exported = importedSheet ? exportConstructSheet(importedSheet) : undefined

    expect(action?.status).toBe('executed')
    expect(runtime.variables.get('result')).toBe(fixture.expectedOutput.result)
    expect(runtime.variables.get('legacyResult')).toBe(fixture.expectedOutput.legacyResult)
    expect(runtime.variables.get('lastResult')).toBe(fixture.expectedOutput.lastResult)
    expect(runtime.variables.get('defaultResult')).toBe(fixture.expectedOutput.defaultResult)
    expect(runtime.variables.get('greeting')).toBe(fixture.expectedOutput.greeting)
    expect(trace.entries).toContainEqual(expect.objectContaining({
      kind: 'action', nodeId: 'construct:double-return-action', status: 'executed',
    }))
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
    expect(fixture.status).toBe('TESTED')
    expect(exported?.status).toBe('complete')
    expect(JSON.parse(exported?.output ?? 'null')).toEqual(fixture.input)
  })

  it('imports and executes None-returning functions through dynamic Functions actions', () => {
    const fixture = loadFixture('functions-actions.json')
    const imported = importConstruct(JSON.stringify(fixture.input))
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported sheet')
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(imported.document).compiled, sheet.id)
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))
    const exported = exportConstructSheet(sheet)

    expect(executedActions).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
    expect(exported.status).toBe('complete')
    expect(JSON.parse(exported.output)).toEqual(fixture.input)
  })

  it('imports, exports, and executes Construct custom action blocks with owner picking', () => {
    const engine = createConstructEngine({ extensions: [{
      id: 'compatibility.player-record',
      objectClass: 'Player',
      actions: [{
        id: 'record', category: 'general', name: 'Record', scriptName: 'Record',
        parameters: [{ id: 'action', type: 'any' }],
      }],
    }] })
    const input = {
      sid: 'custom-action-sheet',
      events: [
        {
          eventType: 'custom-ace-block', aceType: 'action', aceName: 'report', objectClass: 'Player',
          functionReturnType: 'none', functionCopyPicked: false, functionIsAsync: false,
          functionParameters: [{ sid: 'message-param', name: 'message', type: 'any', initialValue: '' }],
          conditions: [],
          actions: [{
            id: 'record', objectClass: 'Player', sid: 'record-custom-owner',
            parameters: { action: 'message' },
          }],
          sid: 'report-custom-action',
          children: [{
            eventType: 'block', sid: 'custom-action-pick-all',
            conditions: [{
              id: 'pick-all', objectClass: 'System', sid: 'pick-all-in-custom-action',
              parameters: { object: 'Player' },
            }],
            actions: [{
              id: 'record', objectClass: 'Player', sid: 'record-custom-pick-all',
              parameters: { action: '"all"' },
            }],
          }],
        },
        {
          eventType: 'block', sid: 'custom-action-caller',
          conditions: [{
            id: 'pick-by-comparison', objectClass: 'System', sid: 'pick-player-five',
            parameters: { object: 'Player', expression: 'Player.X', comparison: 2, value: 10 },
          }],
          actions: [
            { customAction: 'report', objectClass: 'Player', sid: 'call-custom-action', parameters: ['"from-call"'] },
            { id: 'record', objectClass: 'Player', sid: 'record-caller-selection', parameters: { action: '"parent"' } },
          ],
        },
      ],
    }
    const imported = importConstruct(JSON.stringify(input), { registry: engine.registry })
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported sheet')
    const actionCalls: Array<{ action: string; instanceIds: string[] }> = []
    const runtime = createConstructRuntime(makeHost([
      { type: 'Player', properties: { id: 'player-5', X: 5 } },
      { type: 'Player', properties: { id: 'player-15', X: 15 } },
    ], actionCalls))
    const trace = runtime.run(compileConstruct(imported.document, { registry: engine.registry }).compiled, sheet.id)
    const exported = exportConstructSheet(sheet)

    expect(imported.status).toBe('complete')
    expect(trace.diagnostics).toEqual([])
    expect(actionCalls).toEqual([
      { action: 'from-call', instanceIds: ['player-5'] },
      { action: 'all', instanceIds: ['player-5'] },
      { action: 'all', instanceIds: ['player-15'] },
      { action: 'parent', instanceIds: ['player-5'] },
    ])
    expect(exported.status).toBe('complete')
    expect(JSON.parse(exported.output)).toEqual(input)

    const caller = sheet.events[1]
    const pickCondition = caller?.type === 'event' ? caller.conditions[0] : undefined
    if (!caller || caller.type !== 'event' || pickCondition?.type !== 'condition') {
      throw new Error('Expected the custom action caller pick condition')
    }
    caller.conditions[0] = {
      ...pickCondition,
      parameters: pickCondition.parameters.map((parameter, index) => index === 1
        ? { type: 'literal', value: 7 }
        : parameter),
    }
    const editedExport = exportConstructSheet(sheet)
    const editedInput = JSON.parse(editedExport.output) as typeof input
    expect(editedInput.events[1]?.eventType === 'block'
      ? editedInput.events[1].conditions[0]?.parameters
      : undefined).toEqual({ object: 'Player', expression: 7, comparison: 2, value: 10 })
  })

  it('evaluates Construct System Is between values with inclusive bounds and inversion', () => {
    const input = {
      sid: 'is-between-values-sheet',
      events: [
        { eventType: 'block', sid: 'between-lower-inclusive', conditions: [{
          id: 'is-between-values', objectClass: 'System', sid: 'between-lower-condition',
          parameters: { value: '5', 'lower-bound': '5', 'upper-bound': '10' },
        }], actions: [] },
        { eventType: 'block', sid: 'between-upper-inclusive', conditions: [{
          id: 'is-between-values', objectClass: 'System', sid: 'between-upper-condition',
          parameters: { value: '10', 'lower-bound': '5', 'upper-bound': '10' },
        }], actions: [] },
        { eventType: 'block', sid: 'between-interior', conditions: [{
          id: 'is-between-values', objectClass: 'System', sid: 'between-interior-condition',
          parameters: { value: '7', 'lower-bound': '5', 'upper-bound': '10' },
        }], actions: [] },
        { eventType: 'block', sid: 'between-below-range', conditions: [{
          id: 'is-between-values', objectClass: 'System', sid: 'between-below-condition',
          parameters: { value: '4', 'lower-bound': '5', 'upper-bound': '10' },
        }], actions: [] },
        { eventType: 'block', sid: 'between-above-range', conditions: [{
          id: 'is-between-values', objectClass: 'System', sid: 'between-above-condition',
          parameters: { value: '11', 'lower-bound': '5', 'upper-bound': '10' },
        }], actions: [] },
        { eventType: 'block', sid: 'between-inverted-interior', conditions: [{
          id: 'is-between-values', objectClass: 'System', sid: 'between-inverted-interior-condition',
          isInverted: true,
          parameters: { value: '7', 'lower-bound': '5', 'upper-bound': '10' },
        }], actions: [] },
        { eventType: 'block', sid: 'between-inverted-outside', conditions: [{
          id: 'is-between-values', objectClass: 'System', sid: 'between-inverted-outside-condition',
          isInverted: true,
          parameters: { value: '11', 'lower-bound': '5', 'upper-bound': '10' },
        }], actions: [] },
      ],
    }
    const imported = importConstruct(JSON.stringify(input))
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')
    const runtime = createConstructRuntime(makeHost([]))
    const trace = runtime.run(compileConstruct(imported.document).compiled, sheet.id)
    const conditionResults = trace.entries
      .filter(({ kind }) => kind === 'condition')
      .map(({ status }) => status)

    expect(imported.status).toBe('complete')
    expect(conditionResults).toEqual(['passed', 'passed', 'passed', 'failed', 'failed', 'failed', 'passed'])
    expect(trace.status).toBe('complete')
    expect(JSON.parse(exportConstructSheet(sheet).output)).toEqual(input)
  })

  it('creates objects through the host adapter and picks them for sub-events', () => {
    const engine = createConstructEngine({ extensions: [{
      id: 'compatibility.created-player',
      objectClass: 'Player',
      actions: [{
        id: 'record-created', category: 'general', name: 'Record created', scriptName: 'RecordCreated',
        parameters: [{ id: 'message', type: 'string' }],
      }],
    }] })
    const document = importConstruct(JSON.stringify({
      sid: 'compat-create-object',
      events: [{
        eventType: 'block', sid: 'create-object-event', conditions: [],
        actions: [{
          id: 'create-object', objectClass: 'System', sid: 'create-player',
          parameters: { 'object-to-create': 'Player', layer: 'Game', x: 24, y: 36 },
        }],
        children: [{
          eventType: 'block', sid: 'created-object-child', conditions: [],
          actions: [{
            id: 'record-created', objectClass: 'Player', sid: 'record-created-player',
            parameters: { message: 'created' },
          }],
        }],
      }],
    }), { registry: engine.registry }).document
    const actionCalls: Array<{ action: string; instanceIds: string[] }> = []
    const host = makeHost([], actionCalls)
    host.createInstance = (objectType, properties) => ({
      type: objectType,
      properties: { ...properties, id: 'created-player' },
    })
    const runtime = createConstructRuntime(host)
    const compiled = compileConstruct(document, { registry: engine.registry }).compiled
    const trace = runtime.run(compiled, 'construct:compat-create-object')
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(executedActions).toEqual(['create-player', 'record-created-player'])
    expect(actionCalls).toEqual([{ action: 'created', instanceIds: ['created-player'] }])
    expect(trace.status).toBe('complete')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({ id: 'families', status: 'TESTED' }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({ id: 'containers', status: 'TESTED' }))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'object-creation-and-created-picks', status: 'TESTED',
    }))
  })

  it('picks family members and runs family actions through host family queries', () => {
    const fixture = loadFixture('families.json')
    const engine = createConstructEngine({ extensions: [{
      id: 'compatibility.enemy-family',
      objectClass: 'Enemies',
      actions: [{
        id: 'record', category: 'general', name: 'Record', scriptName: 'Record',
        parameters: [{ id: 'action', type: 'string' }],
      }],
    }] })
    const document = importConstruct(JSON.stringify(fixture.input), { registry: engine.registry }).document
    const actionCalls: Array<{ action: string; instanceIds: string[] }> = []
    const host = makeHost(fixture.hostInstances, actionCalls)
    const queryObjects = host.queryObjects.bind(host)
    host.queryObjects = (objectType, predicate) => objectType === 'Enemies'
      ? [...host.getInstances('Goblin'), ...host.getInstances('Orc')].filter((instance) => predicate?.(instance) ?? true)
      : queryObjects(objectType, predicate)
    const runtime = createConstructRuntime(host)
    const trace = runtime.run(compileConstruct(document, { registry: engine.registry }).compiled, 'construct:compat-families')
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(actionCalls).toEqual(fixture.expectedSelections)
    expect(executedActions).toEqual(fixture.expectedActions)
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
  })

  it('picks linked container members returned by the host after object creation', () => {
    const fixture = loadFixture('containers.json')
    const engine = createConstructEngine({ extensions: [{
      id: 'compatibility.container-inventory',
      objectClass: 'Inventory',
      actions: [{
        id: 'record', category: 'general', name: 'Record', scriptName: 'Record',
        parameters: [{ id: 'action', type: 'string' }],
      }],
    }] })
    const document = importConstruct(JSON.stringify(fixture.input), { registry: engine.registry }).document
    const hostInstances: CompatibilityInstance[] = []
    const actionCalls: Array<{ action: string; instanceIds: string[] }> = []
    const host = makeHost(hostInstances, actionCalls)
    const membersByInstance = new Map<CompatibilityInstance, readonly CompatibilityInstance[]>()
    host.createInstance = () => {
      const player = { type: 'Player', properties: { id: 'player-created' } }
      const inventory = { type: 'Inventory', properties: { id: 'inventory-created' } }
      const members = [player, inventory]
      membersByInstance.set(player, members)
      membersByInstance.set(inventory, members)
      hostInstances.push(...members)
      return player
    }
    host.getContainerMembers = (instance) => membersByInstance.get(instance) ?? [instance]
    const runtime = createConstructRuntime(host)
    const trace = runtime.run(compileConstruct(document, { registry: engine.registry }).compiled, 'construct:compat-containers')
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(actionCalls).toEqual(fixture.expectedSelections)
    expect(executedActions).toEqual(fixture.expectedActions)
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
  })

  it('compares OR block behavior with the manual baseline', () => {
    const fixture = loadFixture('or-block.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(document).compiled, 'construct:compat-or-block')

    expect(trace.entries.filter(({ kind }) => kind === 'event').map(({ status }) => status))
      .toEqual(fixture.expectedOutput.eventStatuses)
    expect(trace.entries.filter(({ kind }) => kind === 'condition').map(({ status }) => status === 'passed'))
      .toEqual(fixture.expectedOutput.conditionResults)
    expect(trace.entries.filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
  })

  it('reports looping conditions in OR blocks as unsupported', () => {
    const fixture = loadFixture('or-block-loop.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(document).compiled, 'construct:compat-or-block-loop')

    expect(trace.entries.filter(({ kind }) => kind === 'event').map(({ status }) => status))
      .toEqual(fixture.expectedOutput.eventStatuses)
    expect(trace.entries.filter(({ kind, status }) => kind === 'action' && status === 'executed')).toEqual([])
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
  })

  it('compares Else chains with the manual baseline', () => {
    const fixture = loadFixture('else-chain.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(document).compiled, 'construct:compat-else-chain')

    expect(trace.entries.filter(({ kind }) => kind === 'event').map(({ status }) => status))
      .toEqual(fixture.expectedOutput.eventStatuses)
    expect(trace.entries.filter(({ kind }) => kind === 'condition').map(({ status }) => status === 'passed'))
      .toEqual(fixture.expectedOutput.conditionResults)
    expect(trace.entries.filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
  })

  it('compares trigger dispatch and parent-event gating with the manual baseline', () => {
    const fixture = loadFixture('trigger-dispatch.json')
    const engine = createConstructEngine({ extensions: [{
      id: 'compatibility.signal',
      objectClass: 'SignalBus',
      conditions: [{
        id: 'on-message', category: 'general', name: 'On message', scriptName: 'OnMessage', isTrigger: true,
        parameters: [{ id: 'tag', type: 'string' }],
      }],
    }] })
    const document = importConstruct(JSON.stringify(fixture.input), { registry: engine.registry }).document
    document.variables.push(...(fixture.schemaVariables ?? []))
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const compiled = compileConstruct(document, { registry: engine.registry }).compiled
    const trigger = fixture.trigger
    if (!trigger) throw new Error('Trigger fixture is missing its dispatch data')
    const trace = runtime.dispatchTrigger(compiled, 'construct:compat-trigger-dispatch', trigger)

    expect(trace.entries.filter(({ kind }) => kind === 'event').map(({ status }) => status))
      .toEqual(fixture.expectedOutput.eventStatuses)
    expect(trace.entries.filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
  })

  it('compares Trigger once behavior with the manual baseline', () => {
    const fixture = loadFixture('trigger-once.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    document.variables.push(...(fixture.schemaVariables ?? []))
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const compiled = compileConstruct(document).compiled
    const traces = [
      runtime.run(compiled, 'construct:compat-trigger-once'),
      runtime.run(compiled, 'construct:compat-trigger-once'),
    ]
    expect(runtime.variables.get('count')).toBe(fixture.expectedOutput.countAfterTwoTrueTicks)

    runtime.variables.set('state', 0)
    traces.push(runtime.run(compiled, 'construct:compat-trigger-once'))
    runtime.variables.set('state', 1)
    traces.push(runtime.run(compiled, 'construct:compat-trigger-once'))

    const executedActions = traces.flatMap((trace) => trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', '')))
    expect(runtime.variables.get('count')).toBe(fixture.expectedOutput.countAfterFalseThenTrue)
    expect(executedActions).toEqual(fixture.expectedActions)
  })

  it('compares For Each selections and LoopIndex with the manual baseline', () => {
    const fixture = loadFixture('for-each.json')
    const engine = createConstructEngine({ extensions: [{
      id: 'compatibility.for-each-player',
      objectClass: 'Player',
      actions: [{
        id: 'record', category: 'general', name: 'Record', scriptName: 'Record',
        parameters: [{ id: 'action', type: 'string' }],
      }],
    }] })
    const document = importConstruct(JSON.stringify(fixture.input), { registry: engine.registry }).document
    const actionCalls: Array<{ action: string; instanceIds: string[] }> = []
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances, actionCalls))
    const trace = runtime.run(compileConstruct(document, { registry: engine.registry }).compiled, 'construct:compat-for-each')
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(actionCalls).toEqual(fixture.expectedSelections)
    expect(executedActions).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
  })

  it('compares Repeat iteration count and LoopIndex with the manual baseline', () => {
    const fixture = loadFixture('repeat.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(document).compiled, 'construct:compat-repeat')
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(executedActions).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
  })

  it('compares named inclusive For ranges and nested LoopIndex values with the manual baseline', () => {
    const fixture = loadFixture('for-loop.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(document).compiled, 'construct:compat-for-loop')
    const event = trace.entries.find(({ kind }) => kind === 'event')
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(event?.details?.loopCount).toBe(fixture.expectedOutput.loopCount)
    expect(executedActions).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
  })

  it('stops the active loop after the current event actions and children finish', () => {
    const fixture = loadFixture('stop-loop.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(document).compiled, 'construct:compat-stop-loop')
    const event = trace.entries.find(({ kind }) => kind === 'event')
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(event?.details?.loopCount).toBe(fixture.expectedOutput.loopCount)
    expect(executedActions).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
  })

  it('sorts For Each Ordered instances by the requested expression', () => {
    const fixture = loadFixture('for-each-ordered.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(document).compiled, 'construct:compat-ordered-for-each')
    const event = trace.entries.find(({ kind }) => kind === 'event')
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(event?.details?.loopCount).toBe(fixture.expectedOutput.loopCount)
    expect(executedActions).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
  })

  it('retests conditions after Repeat for each iteration', () => {
    const fixture = loadFixture('loop-condition-order.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(document).compiled, 'construct:compat-loop-condition-order')
    const event = trace.entries.find(({ kind }) => kind === 'event')
    const executedActions = trace.entries.filter(({ nodeId, kind, status }) =>
      kind === 'action' && nodeId === 'construct:should-skip' && status === 'executed')

    expect(event?.status).toBe(fixture.expectedOutput.eventStatus)
    expect(event?.details?.loopCount).toBe(fixture.expectedOutput.loopCount)
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
    expect(executedActions).toHaveLength(fixture.expectedOutput.loopCount as number)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
  })

  it('executes While until its trailing condition fails', () => {
    const whileFixture = loadFixture('while-loop.json')
    const whileDocument = importConstruct(JSON.stringify(whileFixture.input)).document
    const whileRuntime = createConstructRuntime(makeHost(whileFixture.hostInstances))
    const whileTrace = whileRuntime.run(compileConstruct(whileDocument).compiled, 'construct:compat-while-loop')
    const whileActions = whileTrace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(whileTrace.entries.find(({ kind }) => kind === 'event')?.details?.loopCount)
      .toBe(whileFixture.expectedOutput.loopCount)
    expect(whileActions).toEqual(whileFixture.expectedActions)
    expect(Object.fromEntries(whileRuntime.variables)).toEqual(whileFixture.expectedOutput.variables)
    expect(whileTrace.status).toBe(whileFixture.expectedOutput.runtimeStatus)
  })

  it('nests multiple loop conditions and reevaluates trailing conditions per iteration', () => {
    const fixture = loadFixture('multiple-loops.json')
    const engine = createConstructEngine({ extensions: [{
      id: 'compatibility.multiple-loops-player',
      objectClass: 'Player',
      actions: [{
        id: 'record', category: 'general', name: 'Record', scriptName: 'Record',
        parameters: [{ id: 'action', type: 'string' }],
      }],
    }] })
    const document = importConstruct(JSON.stringify(fixture.input), { registry: engine.registry }).document
    const actionCalls: Array<{ action: string; instanceIds: string[] }> = []
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances, actionCalls))
    const trace = runtime.run(compileConstruct(document, { registry: engine.registry }).compiled, 'construct:compat-multiple-loops')

    expect(trace.entries.filter(({ kind }) => kind === 'event').map(({ status }) => status))
      .toEqual(fixture.expectedOutput.eventStatuses)
    expect(trace.entries.find(({ kind }) => kind === 'event')?.details?.loopCount)
      .toBe(fixture.expectedOutput.loopCount)
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
    expect(trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))).toEqual(fixture.expectedActions)
    expect(actionCalls).toEqual(fixture.expectedSelections)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
  })

  it('stops every active loop after the current nested event body finishes', () => {
    const fixture = loadFixture('multiple-loops-stop.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(document).compiled, 'construct:compat-multiple-loops-stop')
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(trace.entries.filter(({ kind }) => kind === 'event').map(({ status }) => status))
      .toEqual(fixture.expectedOutput.eventStatuses)
    expect(trace.entries.find(({ kind, nodeId }) => kind === 'event' && nodeId.endsWith('multiple-loop-stop-event'))?.details?.loopCount)
      .toBe(fixture.expectedOutput.loopCount)
    expect(executedActions).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
  })

  it('bounds total work across nested loops', () => {
    const fixture = loadFixture('multiple-loops-limit.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(document).compiled, 'construct:compat-multiple-loops-limit')
    const event = trace.entries.find(({ kind }) => kind === 'event')

    expect(event?.status).toBe(fixture.expectedOutput.eventStatus)
    expect(event?.details?.loopCount).toBe(fixture.expectedOutput.loopCount)
    expect(runtime.variables.get('lastIndex')).toBe(fixture.expectedOutput.lastIndex)
    expect(trace.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.runtime.loop-iteration-limit', severity: 'warning',
    }))
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
  })

  it('resets non-static local variables per run and retains static locals', () => {
    const fixture = loadFixture('local-variable-lifecycle.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    document.variables.push(...(fixture.schemaVariables ?? []))
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const compiled = compileConstruct(document).compiled
    const firstTick = runtime.run(compiled, 'construct:compat-local-variable')
    const secondTick = runtime.run(compiled, 'construct:compat-local-variable')

    expect(firstTick.entries.some(({ nodeId, status }) => nodeId === 'construct:increment-local' && status === 'executed')).toBe(true)
    expect(secondTick.entries.some(({ nodeId, status }) => nodeId === 'construct:increment-local' && status === 'executed')).toBe(true)
    expect(secondTick.entries.some(({ nodeId, status }) => nodeId === 'construct:increment-static-local' && status === 'executed')).toBe(true)
    expect(runtime.variables.get('ticks')).toBe(fixture.expectedOutput.ticksAfterTwoRuns)
    expect(runtime.variables.get('staticTicks')).toBe(fixture.expectedOutput.staticTicksAfterTwoRuns)
    expect(fixture.status).toBe('TESTED')
  })

  it('imports, exports, and executes nested local variables in event scope', () => {
    const fixture = loadFixture('local-variable-import.json')
    const imported = importConstruct(JSON.stringify(fixture.input))
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported sheet')
    const group = sheet.events[0]
    if (!group || group.type !== 'event') throw new Error('Expected the event group')
    const runtime = createConstructRuntime(makeHost([]))
    const compiled = compileConstruct(imported.document).compiled
    const firstTrace = runtime.run(compiled, sheet.id)
    const secondTrace = runtime.run(compiled, sheet.id)
    const exported = exportConstructSheet(sheet)
    const groupVariable = group.variables?.[0]
    const executedActions = [...firstTrace.entries, ...secondTrace.entries]
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(groupVariable).toMatchObject({ name: 'counter', dataType: 'number', scope: 'local' })
    expect(executedActions).toEqual([...fixture.expectedActions, ...fixture.expectedActions])
    expect(runtime.variables.get('observedCounter')).toBe(fixture.expectedOutput.observedCounter)
    expect(runtime.variables.get('observedStaticCounter')).toBe(fixture.expectedOutput.observedStaticCounter)
    expect(runtime.variables.has('counter')).toBe(false)
    expect(runtime.variables.has('staticCounter')).toBe(false)
    expect(JSON.parse(exported.output)).toEqual(fixture.input)
    expect(firstTrace.status).toBe(fixture.expectedOutput.runtimeStatus)
    expect(secondTrace.status).toBe(fixture.expectedOutput.runtimeStatus)
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'nested-local-variable-import', status: 'TESTED',
    }))
  })

  it('imports, initializes, and exports root-level global Construct variables', () => {
    const fixture = loadFixture('variable-import.json')
    const imported = importConstruct(JSON.stringify(fixture.input))
    const document = imported.document
    const sheet = document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')
    const variables = sheet.variables ?? []
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    runtime.run(compileConstruct(document).compiled, sheet.id)

    expect(variables).toHaveLength(fixture.expectedOutput.importedVariableCount)
    expect(variables[0]).toMatchObject({ name: 'score', dataType: 'number', scope: 'global' })
    expect(runtime.variables.get('score')).toBe(fixture.expectedOutput.initialValue)
    expect(fixture.status).toBe('TESTED')
  })

  it('initializes project globals when execution starts on another event sheet', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Global variables',
        uniqueId: 'global-variable-project',
        eventSheets: { items: ['Definitions', 'Gameplay'], subfolders: [] },
      }),
      'eventSheets/Definitions.json': JSON.stringify({
        sid: 'definitions-sheet',
        name: 'Definitions',
        events: [{
          eventType: 'variable', sid: 'shared-score', name: 'score', type: 'number', initialValue: '7',
          isStatic: false, isConstant: false,
        }],
      }),
      'eventSheets/Gameplay.json': JSON.stringify({
        sid: 'gameplay-sheet',
        name: 'Gameplay',
        events: [{
          eventType: 'block', sid: 'read-score', conditions: [], actions: [{
            id: 'set-eventvar-value', objectClass: 'System', sid: 'copy-score',
            parameters: { variable: 'observed', value: 'score' },
          }],
        }],
      }),
    })
    const gameplay = imported.document.sheets.find((sheet) => !('type' in sheet) && sheet.name === 'Gameplay')
    if (!gameplay || 'type' in gameplay) throw new Error('Expected the Gameplay sheet')
    const runtime = createConstructRuntime(makeHost([]))
    const trace = runtime.run(compileConstruct(imported.document).compiled, gameplay.id)

    expect(trace.status).toBe('complete')
    expect(runtime.variables.get('score')).toBe(7)
    expect(runtime.variables.get('observed')).toBe(7)
  })

  it('resolves include events to sheet IDs and exports them in source order', () => {
    const mainSheetSource = JSON.stringify({
      sid: 'main-with-include',
      name: 'Main',
      events: [
        { eventType: 'include', includeSheet: 'Shared' },
        { eventType: 'block', sid: 'main-event', conditions: [], actions: [] },
      ],
    })
    const sharedSheetSource = JSON.stringify({ sid: 'shared-sheet', name: 'Shared', events: [] })
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Includes', uniqueId: 'include-project',
        eventSheets: { items: ['Main', 'Shared'], subfolders: [] },
      }),
      'eventSheets/Main.json': mainSheetSource,
      'eventSheets/Shared.json': sharedSheetSource,
    })
    const main = imported.document.sheets.find((sheet) => !('type' in sheet) && sheet.name === 'Main')
    const shared = imported.document.sheets.find((sheet) => !('type' in sheet) && sheet.name === 'Shared')
    if (!main || 'type' in main || !shared || 'type' in shared) throw new Error('Expected Main and Shared sheets')
    const exported = exportConstructProject(imported.document)
    const exportedMain = JSON.parse(exported.output['eventSheets/Main.json'] ?? '') as { events: unknown[] }

    expect(imported.status).toBe('complete')
    expect(main.includes).toMatchObject([{ sheetName: 'Shared', targetSheetId: shared.id }])
    expect(exported.status).toBe('complete')
    expect(exportedMain).toEqual(JSON.parse(mainSheetSource))
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'included-event-sheets', status: 'TESTED',
    }))
  })

  it('executes included events in source order', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Includes', uniqueId: 'include-execution-project',
        eventSheets: { items: ['Main', 'Shared'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'main-include-execution', name: 'Main', events: [{ eventType: 'include', includeSheet: 'Shared' }],
      }),
      'eventSheets/Shared.json': JSON.stringify({
        sid: 'shared-include-execution', name: 'Shared', events: [{
          eventType: 'block', sid: 'shared-action-event', conditions: [], actions: [{
            id: 'set-eventvar-value', objectClass: 'System', sid: 'shared-action',
            parameters: { variable: 'included', value: '1' },
          }],
        }],
      }),
    })
    const main = imported.document.sheets.find((sheet) => !('type' in sheet) && sheet.name === 'Main')
    if (!main || 'type' in main) throw new Error('Expected Main sheet')
    const runtime = createConstructRuntime(makeHost([]))
    const trace = runtime.run(compileConstruct(imported.document).compiled, main.id)
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(trace.status).toBe('complete')
    expect(executedActions).toEqual(['shared-action'])
    expect(runtime.variables.get('included')).toBe(1)
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'included-event-sheet-execution', status: 'TESTED',
    }))
  })

  it('expands include events at their source positions and guards cycles', () => {
    const imported = importConstructProject({
      'project.c3proj': JSON.stringify({
        name: 'Include order', uniqueId: 'include-order-project',
        eventSheets: { items: ['Main', 'Shared'], subfolders: [] },
      }),
      'eventSheets/Main.json': JSON.stringify({
        sid: 'include-order-main', name: 'Main', events: [
          { eventType: 'block', sid: 'before-include', conditions: [], actions: [] },
          { eventType: 'include', includeSheet: 'Shared' },
          { eventType: 'block', sid: 'after-include', conditions: [], actions: [] },
        ],
      }),
      'eventSheets/Shared.json': JSON.stringify({
        sid: 'include-order-shared', name: 'Shared', events: [
          { eventType: 'block', sid: 'inside-include', conditions: [], actions: [] },
          { eventType: 'include', includeSheet: 'Main' },
        ],
      }),
    })
    const main = imported.document.sheets.find((sheet) => !('type' in sheet) && sheet.name === 'Main')
    if (!main || 'type' in main) throw new Error('Expected Main sheet')
    const compilation = compileConstruct(imported.document)
    const trace = createConstructRuntime(makeHost([])).run(compilation.compiled, main.id)

    expect(trace.entries.filter(({ kind }) => kind === 'event').map(({ nodeId }) => nodeId)).toEqual([
      'construct:before-include',
      'construct:inside-include',
      'construct:after-include',
    ])
    expect(compilation.diagnostics).toContainEqual(expect.objectContaining({
      code: 'construct.compile.include-cycle',
    }))
    expect(trace.status).toBe('partial')
  })

  it('imports, executes, and round-trips enabled and disabled event groups', () => {
    const fixture = loadFixture('event-groups.json')
    const imported = importConstruct(JSON.stringify(fixture.input))
    const sheet = imported.document.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected an imported event sheet')
    const groups = sheet.events.filter((event) => event.type === 'event' && event.eventKind === 'group')
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(imported.document).compiled, sheet.id)
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))
    const exported = exportConstructSheet(sheet)

    expect(groups).toMatchObject([
      { eventKind: 'group', label: 'Enabled group', enabled: true },
      { eventKind: 'group', label: 'Disabled group', enabled: false },
      { eventKind: 'group', label: 'Inactive on start group', enabled: true, initiallyEnabled: false },
      { eventKind: 'group', label: 'Activation target', initiallyEnabled: false },
    ])
    expect(executedActions).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
    expect(trace.status).toBe('complete')
    expect(JSON.parse(exported.output)).toEqual(fixture.input)
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({ id: 'event-groups', status: 'TESTED' }))
  })

  it('executes registered System event-variable conditions and actions from a fixture', () => {
    const fixture = loadFixture('system-event-variable-aces.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const runtime = createConstructRuntime(makeHost(fixture.hostInstances))
    const trace = runtime.run(compileConstruct(document).compiled, 'construct:system-variable-compat-sheet')
    const executedActions = trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))

    expect(executedActions).toEqual(fixture.expectedActions)
    expect(Object.fromEntries(runtime.variables)).toEqual(fixture.expectedOutput.variables)
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
    expect(fixture.status).toBe('TESTED')
  })

  it('runs inverted Pick all when the object has no instances', () => {
    const fixture = loadFixture('inverted-condition.json')
    const document = importConstruct(JSON.stringify(fixture.input)).document
    const trace = createConstructRuntime(makeHost(fixture.hostInstances))
      .run(compileConstruct(document).compiled, 'construct:compat-inverted-condition')
    const event = trace.entries.find(({ kind }) => kind === 'event')
    const condition = trace.entries.find(({ kind }) => kind === 'condition')

    expect(event?.status).toBe(fixture.expectedOutput.eventStatus)
    expect(condition?.status).toBe(fixture.expectedOutput.conditionStatus)
    expect(trace.status).toBe(fixture.expectedOutput.runtimeStatus)
    expect(trace.entries
      .filter(({ kind, status }) => kind === 'action' && status === 'executed')
      .map(({ nodeId }) => nodeId.replace('construct:', ''))).toEqual(fixture.expectedActions)
    expect(fixture.status).toBe('TESTED')
    expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
      id: 'inverted-pick-all', status: 'TESTED',
    }))
  })

  it('maps every fixture and report entry to a declared compatibility status', () => {
    const fixtures = [
      loadFixture('comparison-options.json'),
      loadFixture('selection-inheritance.json'),
      loadFixture('functions-return-values.json'),
      loadFixture('functions-actions.json'),
      loadFixture('or-block.json'),
      loadFixture('or-block-loop.json'),
      loadFixture('else-chain.json'),
      loadFixture('trigger-dispatch.json'),
      loadFixture('trigger-once.json'),
      loadFixture('for-each.json'),
      loadFixture('for-each-ordered.json'),
      loadFixture('families.json'),
      loadFixture('containers.json'),
      loadFixture('repeat.json'),
      loadFixture('for-loop.json'),
      loadFixture('stop-loop.json'),
      loadFixture('loop-condition-order.json'),
      loadFixture('while-loop.json'),
      loadFixture('multiple-loops.json'),
      loadFixture('multiple-loops-stop.json'),
      loadFixture('multiple-loops-limit.json'),
      loadFixture('local-variable-lifecycle.json'),
      loadFixture('local-variable-import.json'),
      loadFixture('variable-import.json'),
      loadFixture('system-event-variable-aces.json'),
      loadFixture('inverted-condition.json'),
      loadFixture('event-groups.json'),
    ]
    for (const fixture of fixtures) {
      for (const featureId of [fixture.featureId, ...(fixture.coveredFeatureIds ?? [])]) {
        expect(constructCompatibilityFeatures).toContainEqual(expect.objectContaining({
          id: featureId,
          status: fixture.status,
        }))
      }
    }
    for (const feature of constructCompatibilityFeatures.filter(({ status }) => status === 'UNTESTED')) {
      expect(feature.evidence.length).toBeGreaterThan(0)
      expect(feature.summary.length).toBeGreaterThan(0)
    }

    const report = formatConstructCompatibilityReport()
    expect(report).toContain('## TESTED')
    expect(report).toContain('## UNTESTED')
    expect(report).toContain('## KNOWN_DIVERGENCE')
    expect(report).toContain('## UNSUPPORTED')
    expect(report).not.toMatch(/\b\d+%/)
    expect(report).toContain('Import diagnostics include 10 preserved but unsupported script actions and no unknown actions, unknown conditions, or unknown expressions.')
    expect(report).toContain('common `set-z-elevation` for 11')
    expect(report).toContain('common `set-x`/`set-y` for four')
    expect(report).toContain('`set-default-color` across the Shape3D, Sprite, and Tilemap plugins for 20')
    expect(report).toContain('Digit-prefixed Construct expression identifiers')
    expect(report).toContain('common `compare-z-elevation` for seven')
    expect(report).toContain('Platform `is-on-floor` for four, Mouse `cursor-is-over-object` for two, and plugin-scoped List `compare-selected-item-text` for three and `on-selection-changed` for two')
    expect(report).toContain('Button `on-clicked` for eight')
    const currentExportEditorAudit = JSON.parse(readFileSync(new URL('./fixtures/compatibility/construct-r495.2-current-export-editor-open.json', import.meta.url), 'utf8'))
    expect(currentExportEditorAudit.scope).toMatchObject({
      projects: 15,
      sourceImportsComplete: 15,
      outputReimportsComplete: 15,
      editorOpened: 14,
      editorBlocked: 1,
      projectsPreviewed: 0,
      projectScriptsExecuted: 0,
      pageErrors: 0,
    })
    expect(currentExportEditorAudit.results.find((result: { archive: string }) => result.archive === 'FirstPersonShooter2.c3p')?.blocker).toContain('Behavior Rapier 3D Physics')
    expect(report).toContain('Current importer/exporter corpus outputs opened in Construct')
    expect(readFileSync(new URL('../COMPATIBILITY.md', import.meta.url), 'utf8')).toBe(report)
  })
})
