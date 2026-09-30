import type {
  Diagnostic,
  DocumentExporter,
  Expression,
  EventDocument,
  Event,
  EventNode,
  EventSheetInclude,
  EventSheetNode,
  ExportResult,
  JsonObject,
  JsonValue,
  SourceLocation,
  VariableNode,
} from '@project/schema'
import { strToU8, zipSync } from 'fflate'
import type { ConstructProjectFileContent, ConstructProjectFiles } from './import.js'
import { hasStoredProjectFileContent, restoreProjectFileContent } from './project-files.js'
import { parseConstructExpression, parseConstructLiteral } from './expression-parser.js'
import { constructEngine } from './registry.js'
import type { ConstructParameterType } from './types.js'

export interface ConstructExportAnalysis {
  supported: boolean
  lossless: boolean
  potentiallyLossy: boolean
  diagnostics: Diagnostic[]
}

interface SidAllocator {
  used: Set<string>
}

/** Review whether this document can be written without dropping information. */
export function analyzeConstructExport(document: EventDocument): ConstructExportAnalysis {
  const diagnostics: Diagnostic[] = []
  let supported = document.engine.id === 'construct'
  let lossless = document.engine.id === 'construct'
  if (document.engine.id !== 'construct') {
    diagnostics.push(exportDiagnostic(
      'construct.export.wrong-engine',
      'Cannot export a ' + document.engine.id + ' document as Construct.',
      'error',
    ))
  }
  if (document.variables.length > 0) {
    supported = false
    lossless = false
    for (const variable of document.variables) {
      diagnostics.push(exportDiagnostic(
        'construct.export.unsupported-variables',
        'Construct variable declaration "' + variable.id + '" is not yet mapped to the project format and may be lost on export.',
        'warning',
        variable.id,
      ))
    }
  }

  const projectMetadata = document.metadata?.construct
  const projectMetadataRecord = isRecord(projectMetadata) ? projectMetadata : undefined
  const project = isRecord(projectMetadataRecord?.project) ? projectMetadataRecord.project : undefined
  const preservedFiles = isRecord(projectMetadataRecord?.files) ? projectMetadataRecord.files : undefined
  const projectPath = typeof projectMetadataRecord?.sourceId === 'string' ? projectMetadataRecord.sourceId : 'project.c3proj'
  const normalizedProjectPath = normalizeProjectOutputPath(projectPath)
  const projectPrefix = normalizedProjectPath?.includes('/')
    ? normalizedProjectPath.slice(0, normalizedProjectPath.lastIndexOf('/') + 1)
    : ''
  const projectManifestOutputPath = project ? normalizedProjectPath ?? 'project.c3proj' : undefined
  if (project && normalizedProjectPath === undefined) {
    supported = false
    lossless = false
    diagnostics.push(exportDiagnostic(
      'construct.export.invalid-project-file-path',
      'Construct project manifest path "' + projectPath + '" is unsafe; export will use project.c3proj instead.',
      'warning',
    ))
  }
  if (preservedFiles) {
    const normalizedPaths = new Set<string>()
    for (const path of Object.keys(preservedFiles)) {
      const normalizedPath = normalizeProjectOutputPath(path)
      if (!normalizedPath) {
        supported = false
        lossless = false
        diagnostics.push(exportDiagnostic(
          'construct.export.invalid-project-file-path',
          'Preserved Construct project file path "' + path + '" is unsafe and will be omitted.',
          'warning',
        ))
      } else if (normalizedPaths.has(normalizedPath)) {
        supported = false
        lossless = false
        diagnostics.push(exportDiagnostic(
          'construct.export.duplicate-project-file-path',
          'Multiple preserved Construct project paths normalize to "' + normalizedPath + '"; the first file will be retained.',
          'warning',
        ))
      } else {
        normalizedPaths.add(normalizedPath)
      }
    }
  }
  if (project) {
    const missingResources = Object.entries(project)
      .filter(([key]) => key !== 'eventSheets')
      .flatMap(([key, index]) => isRecord(index) ? indexedResourcePaths(key, index) : [])
      .filter((path) => !hasStoredProjectFileContent(preservedFiles?.[projectPrefix + path]))
    if (missingResources.length) {
      lossless = false
      diagnostics.push(exportDiagnostic(
        'construct.export.project-files-not-imported',
        'The project references resources whose file contents were not included in the import source: '
          + missingResources.join(', ') + '.',
        'warning',
      ))
    }
  }

  const seenSids = new Set<string>()
  const claimedProjectPaths = new Set<string>()
  const recordSid = (node: SidBearingNode): void => inspectSid(node, seenSids, (sid, nodeId) => {
    lossless = false
    diagnostics.push(exportDiagnostic(
      'construct.export.duplicate-sid',
      'Construct SID "' + sid + '" occurs more than once and will be reassigned in the exported sheet.',
      'warning',
      nodeId,
    ))
  })
  for (const [index, sheet] of document.sheets.entries()) {
    recordSid(sheet)
    const outputPath = projectSheetOutputPath(sheet, index, projectPrefix)
    const sourcePath = sheet.sourceLocation?.sourceId
    const pathConflict = findProjectSheetPathConflict(
      outputPath,
      sourcePath,
      claimedProjectPaths,
      preservedFiles,
      projectManifestOutputPath,
    )
    if (pathConflict) {
      supported = false
      lossless = false
      diagnostics.push(exportDiagnostic(
        'construct.export.project-output-path-collision',
        pathConflict.message,
        'warning',
        sheet.id,
      ))
    }
    if ('type' in sheet) {
      supported = false
      const raw = opaqueRaw(sheet)
      if (raw === undefined) {
        lossless = false
        diagnostics.push(lossyDiagnostic(sheet.id, 'sheet'))
      } else {
        diagnostics.push(opaqueDiagnostic(sheet.id, 'sheet'))
      }
      continue
    }
    if (sheet.variables?.length) {
      for (const variable of sheet.variables ?? []) {
        recordSid(variable)
        if ('type' in variable) {
          supported = false
          const raw = opaqueRaw(variable)
          if (raw === undefined) {
            lossless = false
            diagnostics.push(lossyDiagnostic(variable.id, 'variable'))
          } else {
            diagnostics.push(opaqueDiagnostic(variable.id, 'variable'))
          }
        } else if (variable.scope !== 'global') {
          supported = false
          lossless = false
          diagnostics.push(exportDiagnostic(
            'construct.export.unsupported-variable-scope',
            'Construct event sheet variables must be global when serialized at the sheet root.',
            'warning',
            variable.id,
          ))
        }
      }
    }
    for (const include of sheet.includes ?? []) recordSid(include)
    for (const event of sheet.events) inspectEvent(event)
  }

  return {
    supported,
    lossless,
    potentiallyLossy: !lossless,
    diagnostics: attachSourceLocations(
      diagnostics,
      sourceLocationsForDocument(document),
      fallbackSourceLocationForDocument(document),
    ),
  }

  function inspectEvent(event: EventNode): void {
    recordSid(event)
    if (event.type !== 'event') {
      supported = false
      if (opaqueRaw(event) === undefined) {
        lossless = false
        diagnostics.push(lossyDiagnostic(event.id, 'event'))
      } else {
        diagnostics.push(opaqueDiagnostic(event.id, 'event'))
      }
      return
    }
    for (const variable of event.variables ?? []) recordSid(variable)
    for (const ace of [...event.conditions, ...event.actions]) {
      recordSid(ace)
      if (ace.type === 'comment') continue
      if (ace.type !== 'condition' && ace.type !== 'action') {
        supported = false
        if (opaqueRaw(ace) === undefined) {
          lossless = false
          diagnostics.push(lossyDiagnostic(ace.id, ace.nodeType))
        } else {
          diagnostics.push(opaqueDiagnostic(ace.id, ace.nodeType))
        }
        continue
      }
      if (ace.operation.lastIndexOf('.') < 1 || ace.operation.endsWith('.')) {
        supported = false
        lossless = false
        diagnostics.push(exportDiagnostic(
          'construct.export.invalid-operation',
          'Construct ' + ace.type + ' "' + ace.id + '" has an invalid operation identifier.',
          'warning',
          ace.id,
        ))
      }
      const separator = ace.operation.lastIndexOf('.')
      const objectClass = separator > 0 ? ace.operation.slice(0, separator) : ''
      const aceId = separator > 0 ? ace.operation.slice(separator + 1) : ''
      const definition = ace.type === 'condition'
        ? constructEngine.registry.getCondition(objectClass, aceId)
        : constructEngine.registry.getAction(objectClass, aceId)
      if (!definition) {
        supported = false
        if (rawObject(ace)) diagnostics.push(opaqueDiagnostic(ace.id, ace.type))
        else {
          lossless = false
          diagnostics.push(lossyDiagnostic(ace.id, ace.type))
        }
      }
      for (const expression of ace.parameters) {
        if (isOpaqueExpression(expression)) {
          supported = false
          diagnostics.push(exportDiagnostic(
            'construct.export.opaque-expression',
            'Expression parameter on Construct ' + ace.type + ' "' + ace.id + '" is preserved as source text.',
            'warning',
            ace.id,
          ))
        }
      }
    }
    for (const child of event.subEvents ?? []) inspectEvent(child)
  }
}

/** Serialize a Construct event sheet, keeping the original record when available. */
export function exportConstructSheet(sheet: EventSheetNode): ExportResult<string> {
  const result = serializeConstructSheet(sheet, { used: new Set() })
  return {
    ...result,
    diagnostics: attachSourceLocations(result.diagnostics, sourceLocationsForSheet(sheet)),
  }
}

function serializeConstructSheet(
  sheet: EventSheetNode,
  sidAllocator: SidAllocator,
  sheetNameById?: ReadonlyMap<string, string>,
): ExportResult<string> {
  const diagnostics: Diagnostic[] = []
  if ('type' in sheet) {
    const raw = opaqueRaw(sheet)
    if (raw !== undefined) {
      rememberRawSid(raw, sidAllocator)
      return { output: JSON.stringify(raw, null, 2), diagnostics: [opaqueDiagnostic(sheet.id, 'sheet')], status: 'complete' }
    }
    diagnostics.push(lossyDiagnostic(sheet.id, 'sheet'))
    return { output: JSON.stringify({ name: 'Event sheet', events: [] }, null, 2), diagnostics, status: 'partial' }
  }

  const original = rawObject(sheet)
  const output: Record<string, unknown> = original ? { ...original } : {}
  output.sid = allocateSid(sheet.id, original?.sid, sidAllocator, diagnostics)
  if (!original || sheet.name !== importedSheetName(sheet, original)) output.name = sheet.name
  output.events = exportSheetContent(sheet, diagnostics, sidAllocator, sheetNameById)
  return {
    output: JSON.stringify(output, null, 2),
    diagnostics,
    status: diagnostics.some(({ code }) => code === 'construct.export.lossy-node'
      || code === 'construct.export.duplicate-sid'
      || code === 'construct.export.invalid-operation') ? 'partial' : 'complete',
  }
}

/** Serialize a folder-project file map from an imported Construct document. */
export function exportConstructProject(document: EventDocument): ExportResult<ConstructProjectFiles> {
  const analysis = analyzeConstructExport(document)
  if (document.engine.id !== 'construct') {
    return { output: {}, diagnostics: analysis.diagnostics, status: 'partial' }
  }
  const diagnostics = [...analysis.diagnostics]
  const files: Record<string, ConstructProjectFileContent> = Object.create(null) as Record<string, ConstructProjectFileContent>
  const sidAllocator: SidAllocator = { used: new Set() }
  const sheetNameById = new Map(document.sheets.flatMap((sheet) => !('type' in sheet) ? [[sheet.id, sheet.name] as const] : []))
  const constructMetadata = document.metadata?.construct
  const constructRecord = isRecord(constructMetadata) ? constructMetadata : undefined
  const project = constructRecord?.project
  const projectOutput = isRecord(project) ? JSON.parse(JSON.stringify(project)) as Record<string, unknown> : undefined
  const projectPath = typeof constructRecord?.sourceId === 'string' ? constructRecord.sourceId : 'project.c3proj'
  const normalizedProjectPath = normalizeProjectOutputPath(projectPath)
  const projectPrefix = normalizedProjectPath?.includes('/')
    ? normalizedProjectPath.slice(0, normalizedProjectPath.lastIndexOf('/') + 1)
    : ''
  const projectManifestOutputPath = projectOutput ? normalizedProjectPath ?? 'project.c3proj' : undefined
  const preservedFiles = constructRecord?.files
  if (isRecord(preservedFiles)) {
    const preservedPaths = new Set<string>()
    for (const [path, contents] of Object.entries(preservedFiles)) {
      const normalizedPath = normalizeProjectOutputPath(path)
      if (!normalizedPath || preservedPaths.has(normalizedPath)) continue
      preservedPaths.add(normalizedPath)
      const restored = restoreProjectFileContent(contents)
      if (restored !== undefined) files[normalizedPath] = restored
    }
  }
  if (!projectOutput) {
    diagnostics.push(exportDiagnostic(
      'construct.export.missing-project-manifest',
      'No imported Construct project manifest is available; exported files contain event sheets only.',
      'warning',
    ))
  }

  const claimedProjectPaths = new Set<string>()
  for (const [index, sheet] of document.sheets.entries()) {
    const sourcePath = sheet.sourceLocation?.sourceId
    const filePath = projectSheetOutputPath(sheet, index, projectPrefix)
    const pathConflict = findProjectSheetPathConflict(
      filePath,
      sourcePath,
      claimedProjectPaths,
      isRecord(preservedFiles) ? preservedFiles : undefined,
      projectManifestOutputPath,
    )
    if (pathConflict) continue

    const exported = serializeConstructSheet(sheet, sidAllocator, sheetNameById)
    files[filePath] = exported.output
    diagnostics.push(...exported.diagnostics)
    if (projectOutput) {
      const projectRelativePath = projectPrefix && filePath.startsWith(projectPrefix)
        ? filePath.slice(projectPrefix.length)
        : filePath
      if (ensureEventSheetIndexed(projectOutput, projectRelativePath)) {
        diagnostics.push(exportDiagnostic(
          'construct.export.event-sheet-index-updated',
          'Added event sheet "' + projectRelativePath + '" to the project manifest index.',
          'info',
        ))
      }
    }
  }
  if (projectOutput && projectManifestOutputPath) {
    files[projectManifestOutputPath] = JSON.stringify(projectOutput, null, 2)
  }

  const potentiallyLossy = analysis.potentiallyLossy
    || diagnostics.some(({ code }) => code === 'construct.export.lossy-node')
    || (!isRecord(project) && document.sheets.some((sheet) => !('type' in sheet)))
  return {
    output: files,
    diagnostics: attachSourceLocations(
      deduplicateDiagnostics(diagnostics),
      sourceLocationsForDocument(document),
      fallbackSourceLocationForDocument(document),
    ),
    status: potentiallyLossy ? 'partial' : 'complete',
  }
}

/** Export a Construct project as a ZIP archive suitable for a .c3p file. */
export function exportConstructArchive(document: EventDocument): ExportResult<Uint8Array> {
  const project = exportConstructProject(document)
  const unsafePath = Object.keys(project.output).find((path) => !isSafeArchivePath(path))
  if (unsafePath !== undefined) {
    return {
      output: new Uint8Array(),
      diagnostics: [...project.diagnostics, exportDiagnostic(
        'construct.export.invalid-archive-path',
        'Cannot package unsafe project path "' + unsafePath + '" in a ZIP archive.',
        'error',
      )],
      status: 'partial',
    }
  }
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
  for (const [path, contents] of Object.entries(project.output)) {
    files[path] = typeof contents === 'string' ? strToU8(contents) : contents
  }
  return { ...project, output: zipSync(files, { level: 0 }) }
}

function isSafeArchivePath(path: string): boolean {
  return path.length > 0
    && !path.includes('\0')
    && !path.startsWith('/')
    && !/^[A-Za-z]:/.test(path)
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

/** Exporter contract used by integrations that select exporters dynamically. */
export const constructExporter: DocumentExporter<ConstructProjectFiles> = Object.freeze({
  engineId: 'construct',
  export: exportConstructProject,
})

function opaqueRaw(node: { metadata?: JsonObject; type?: string; sourceText?: string; raw?: JsonValue }): JsonValue | undefined {
  if (node.type === 'unknown' || node.type === 'invalid') return node.raw
  const metadata = node.metadata?.construct
  if (isRecord(metadata) && isJsonValue(metadata.raw)) return metadata.raw
  if (typeof node.sourceText === 'string') {
    const parsed = parseJson(node.sourceText)
    if (isJsonValue(parsed)) return parsed
  }
  return undefined
}

function rawObject(node: { metadata?: JsonObject; type?: string; sourceText?: string; raw?: JsonValue }): Record<string, unknown> | undefined {
  const raw = opaqueRaw(node)
  return isRecord(raw) ? raw : undefined
}

function exportEvent(node: EventNode, diagnostics: Diagnostic[], sidAllocator: SidAllocator): unknown {
  if (node.type !== 'event') {
    const raw = opaqueRaw(node)
    if (raw !== undefined) {
      rememberRawSid(raw, sidAllocator)
      diagnostics.push(opaqueDiagnostic(node.id, node.nodeType))
      return raw
    }
    diagnostics.push(lossyDiagnostic(node.id, node.nodeType))
    return null
  }

  const raw = rawObject(node)
  const output: Record<string, unknown> = raw ? { ...raw } : {}
  const isComment = node.eventKind === 'comment' || raw?.eventType === 'comment'
  if (isComment) {
    output.eventType = 'comment'
    if (!raw || Object.hasOwn(raw, 'sid')) {
      output.sid = allocateSid(node.id, raw?.sid, sidAllocator, diagnostics)
    }
    if (node.comment !== undefined) output.text = node.comment
    return output
  }
  const isGroup = node.eventKind === 'group' || raw?.eventType === 'group'
  const functionBlockFormat = raw?.eventType === 'function-block'
  const customActionFormat = raw?.eventType === 'custom-ace-block'
  const isFunction = node.eventKind === 'function' || raw?.eventType === 'function' || functionBlockFormat || customActionFormat
  output.eventType = isGroup ? 'group'
    : customActionFormat ? 'custom-ace-block'
      : isFunction ? functionBlockFormat ? 'function-block' : 'function'
        : 'block'
  output.sid = allocateSid(node.id, raw?.sid, sidAllocator, diagnostics)
  if (isGroup) {
    if (node.enabled !== undefined) output.disabled = !node.enabled
    if (node.initiallyEnabled !== undefined) output.isActiveOnStart = node.initiallyEnabled
    if (node.label !== undefined) output.title = node.label
  } else {
    output.conditions = node.conditions.map((condition) => exportAce(condition, diagnostics, sidAllocator))
    output.actions = node.actions.map((action) => exportAce(action, diagnostics, sidAllocator))
    if (node.enabled !== undefined) output.isEnabled = node.enabled
    if (node.label !== undefined && !customActionFormat) {
      output[isFunction && functionBlockFormat ? 'functionName' : 'name'] = node.label
    }
    if (isFunction && node.functionParameters !== undefined) {
      output[functionBlockFormat || customActionFormat ? 'functionParameters' : 'parameters'] = node.functionParameters.map((parameter) => {
        const parameterRaw = rawObject(parameter)
        return {
          ...(parameterRaw ?? {}),
          sid: allocateSid(parameter.id, parameterRaw?.sid, sidAllocator, diagnostics),
          name: parameter.name,
          type: parameter.dataType,
        }
      })
    }
    if (isFunction && node.functionReturnType !== undefined) {
      output[functionBlockFormat || customActionFormat ? 'functionReturnType' : 'returnType'] = node.functionReturnType
    }
    if (isFunction && node.functionCopyPicked !== undefined) {
      output[functionBlockFormat || customActionFormat ? 'functionCopyPicked' : 'copyPicked'] = node.functionCopyPicked
    }
  }
  if (node.variables !== undefined || node.subEvents !== undefined) {
    const children: Array<{ offset: number | undefined; order: number; render: () => unknown }> = []
    let order = 0
    for (const variable of node.variables ?? []) {
      children.push({
        offset: variable.sourceLocation?.offsetStart,
        order: order++,
        render: () => exportVariable(variable, diagnostics, sidAllocator),
      })
    }
    for (const child of node.subEvents ?? []) {
      children.push({
        offset: child.sourceLocation?.offsetStart,
        order: order++,
        render: () => exportEvent(child, diagnostics, sidAllocator),
      })
    }
    children.sort((left, right) =>
      (left.offset ?? Number.POSITIVE_INFINITY) - (right.offset ?? Number.POSITIVE_INFINITY)
      || left.order - right.order)
    output.children = children.map(({ render }) => render())
  }
  if (node.isOrBlock !== undefined) output.isOrBlock = node.isOrBlock
  if (node.isElse !== undefined) output.isElse = node.isElse
  return output
}

function exportSheetContent(
  sheet: Extract<EventSheetNode, { events: EventNode[] }>,
  diagnostics: Diagnostic[],
  sidAllocator: SidAllocator,
  sheetNameById?: ReadonlyMap<string, string>,
): unknown[] {
  const entries: Array<{ offset: number | undefined; order: number; render: () => unknown }> = []
  let order = 0
  for (const include of sheet.includes ?? []) {
    entries.push({
      offset: include.sourceLocation?.offsetStart,
      order: order++,
      render: () => exportInclude(include, diagnostics, sidAllocator, sheetNameById),
    })
  }
  for (const variable of sheet.variables ?? []) {
    entries.push({
      offset: variable.sourceLocation?.offsetStart,
      order: order++,
      render: () => exportVariable(variable, diagnostics, sidAllocator),
    })
  }
  for (const event of sheet.events) {
    entries.push({
      offset: event.sourceLocation?.offsetStart,
      order: order++,
      render: () => exportEvent(event, diagnostics, sidAllocator),
    })
  }
  entries.sort((left, right) => {
    const leftOffset = left.offset ?? Number.POSITIVE_INFINITY
    const rightOffset = right.offset ?? Number.POSITIVE_INFINITY
    return leftOffset - rightOffset || left.order - right.order
  })
  return entries.map(({ render }) => render())
}

function exportInclude(
  include: EventSheetInclude,
  diagnostics: Diagnostic[],
  sidAllocator: SidAllocator,
  sheetNameById?: ReadonlyMap<string, string>,
): unknown {
  const original = rawObject(include)
  const output: Record<string, unknown> = original ? { ...original } : {}
  output.eventType = 'include'
  output.includeSheet = include.targetSheetId
    ? sheetNameById?.get(include.targetSheetId) ?? include.sheetName
    : include.sheetName
  if (!original || isConstructSid(original.sid)) {
    output.sid = allocateSid(include.id, original?.sid, sidAllocator, diagnostics)
  } else {
    delete output.sid
  }
  return output
}

function exportVariable(node: VariableNode, diagnostics: Diagnostic[], sidAllocator: SidAllocator): unknown {
  if ('type' in node) {
    const raw = opaqueRaw(node)
    if (raw !== undefined) {
      rememberRawSid(raw, sidAllocator)
      diagnostics.push(opaqueDiagnostic(node.id, 'variable'))
      return raw
    }
    diagnostics.push(lossyDiagnostic(node.id, 'variable'))
    return null
  }

  const original = rawObject(node)
  const output: Record<string, unknown> = original ? { ...original } : {}
  output.eventType = 'variable'
  output.sid = allocateSid(node.id, original?.sid, sidAllocator, diagnostics)
  output.name = node.name
  output.type = node.dataType
  if (node.initialValue === undefined) {
    delete output.initialValue
  } else {
    output.initialValue = exportVariableInitialValue(node, original?.initialValue)
  }
  return output
}

function exportVariableInitialValue(
  variable: Extract<VariableNode, { name: string }>,
  originalValue: unknown,
): JsonValue {
  const expression = variable.initialValue
  if (!expression) return isJsonValue(originalValue) ? originalValue : null
  if (isJsonValue(originalValue) && expressionMatchesRaw(expression, originalValue)) return originalValue
  if (variable.dataType === 'string' && expression.type === 'literal') return String(expression.value ?? '')
  if (variable.dataType === 'boolean' && expression.type === 'literal' && typeof expression.value === 'boolean') {
    return String(expression.value)
  }
  if (variable.dataType === 'number') {
    return expression.type === 'literal' ? String(expression.value ?? 0) : exportParameter(expression, 'number')
  }
  if (expression.type === 'literal') return expression.value
  return expression.sourceText ?? formatExpression(expression)
}

function exportAce(
  node: Event['conditions'][number] | Event['actions'][number],
  diagnostics: Diagnostic[],
  sidAllocator: SidAllocator,
): unknown {
  if (node.type === 'comment') {
    const output: Record<string, unknown> = rawObject(node) ? { ...rawObject(node) } : {}
    output.type = 'comment'
    output.text = node.text
    return output
  }
  if (node.type !== 'condition' && node.type !== 'action') {
    const raw = opaqueRaw(node)
    if (raw !== undefined) {
      rememberRawSid(raw, sidAllocator)
      diagnostics.push(opaqueDiagnostic(node.id, node.nodeType))
      return raw
    }
    diagnostics.push(lossyDiagnostic(node.id, node.nodeType))
    return null
  }

  const raw = rawObject(node)
  const output: Record<string, unknown> = raw ? { ...raw } : {}
  const functionCallFormat = node.type === 'action'
    && typeof raw?.callFunction === 'string'
    && node.operation.startsWith('Functions.')
  const functionName = node.operation.startsWith('Functions.')
    ? node.operation.slice('Functions.'.length)
    : ''
  const customActionCallFormat = node.type === 'action'
    && typeof raw?.customAction === 'string'
    && functionName.includes('::')
  if (functionCallFormat) {
    output.callFunction = functionName
    output.sid = allocateSid(node.id, raw?.sid, sidAllocator, diagnostics)
    if (node.parameters.length > 0 || Array.isArray(raw?.parameters)) {
      output.parameters = node.parameters.map((expression) => exportParameter(expression, 'any'))
    } else {
      delete output.parameters
    }
    return output
  }
  if (customActionCallFormat) {
    const separator = functionName.lastIndexOf('::')
    const owner = functionName.slice(0, separator)
    output.customAction = functionName.slice(separator + 2)
    if (typeof raw?.customActionObjectClass === 'string' || owner !== raw?.objectClass) {
      output.customActionObjectClass = owner
    } else {
      delete output.customActionObjectClass
    }
    output.sid = allocateSid(node.id, raw?.sid, sidAllocator, diagnostics)
    if (node.parameters.length > 0 || Array.isArray(raw?.parameters)) {
      output.parameters = node.parameters.map((expression) => exportParameter(expression, 'any'))
    } else {
      delete output.parameters
    }
    return output
  }
  if (typeof output.callFunction === 'string') delete output.callFunction
  if (typeof output.customAction === 'string') delete output.customAction
  const separator = node.operation.lastIndexOf('.')
  if (separator < 1 || separator === node.operation.length - 1) {
    diagnostics.push(exportDiagnostic(
      'construct.export.invalid-operation',
      'Construct ' + node.type + ' "' + node.id + '" has an operation that cannot be mapped to an object class and ACE ID.',
      'warning',
      node.id,
    ))
  } else {
    output.objectClass = node.operation.slice(0, separator)
    output.id = node.operation.slice(separator + 1)
  }
  output.sid = allocateSid(node.id, raw?.sid, sidAllocator, diagnostics)
  const objectClass = typeof output.objectClass === 'string' ? output.objectClass : ''
  const aceId = typeof output.id === 'string' ? output.id : ''
  const definition = node.type === 'condition'
    ? constructEngine.registry.getCondition(objectClass, aceId)
    : constructEngine.registry.getAction(objectClass, aceId)
  if (!raw && !definition) diagnostics.push(lossyDiagnostic(node.id, node.type))
  const definitionParameters = definition?.parameters ?? []
  const parameterIds = node.parameterIds ?? definitionParameters.map(({ id }) => id)
  const rawParameters = isRecord(output.parameters) ? { ...output.parameters } : {}
  const rawParameterKeys = Object.keys(rawParameters)
  for (let index = 0; index < node.parameters.length; index += 1) {
    const expression = node.parameters[index]
    const parameterId = parameterIds[index] ?? definitionParameters[index]?.id ?? Object.keys(rawParameters)[index] ?? String(index)
    const sourceParameterId = Object.hasOwn(rawParameters, parameterId) ? parameterId : rawParameterKeys[index]
    const outputParameterId = sourceParameterId ?? parameterId
    const parameter = definitionParameters.find(({ id }) => id === parameterId)
    if (!expression) continue
    if (sourceParameterId !== undefined && expressionMatchesRaw(expression, rawParameters[sourceParameterId])) continue
    if (!definition && !raw) {
      diagnostics.push(exportDiagnostic(
        'construct.export.unknown-parameter-type',
        'Construct ' + node.type + ' "' + node.id + '" has no registered definition for parameter "' + parameterId + '".',
        'warning',
        node.id,
      ))
    }
    if (expression.type === 'incomplete' && !expression.sourceText && !Object.hasOwn(rawParameters, outputParameterId)) continue
    if (isOpaqueExpression(expression)) {
      diagnostics.push(exportDiagnostic(
        'construct.export.opaque-expression',
        'Expression parameter "' + parameterId + '" on Construct ' + node.type + ' "' + node.id + '" is preserved as source text.',
        'warning',
        node.id,
      ))
    }
    rawParameters[outputParameterId] = exportParameter(expression, parameter?.type ?? 'any')
  }
  const hasExportableParameter = node.parameters.some((expression, index) => {
    const parameterId = parameterIds[index] ?? definitionParameters[index]?.id ?? Object.keys(rawParameters)[index] ?? String(index)
    const parameter = definitionParameters.find(({ id }) => id === parameterId)
    return !(parameter?.optional === true
      && expression.type === 'incomplete'
      && !expression.sourceText
      && !Object.hasOwn(rawParameters, parameterId))
  })
  if (hasExportableParameter || Object.keys(rawParameters).length > 0) output.parameters = rawParameters
  if (node.type === 'condition') {
    if (node.inverted !== undefined) output.isInverted = node.inverted
  }
  return output
}

function exportParameter(expression: Expression, parameterType: ConstructParameterType): JsonValue {
  if (parameterType !== 'any' && parameterType !== 'number') {
    if (expression.type === 'literal') return expression.value
    return expression.sourceText ?? formatExpression(expression)
  }
  if (expression.sourceText !== undefined) {
    const parsedSource = parseConstructExpression(expression.sourceText, expression.sourceText)
    if (sameExpression(parsedSource, expression)) return expression.sourceText
  }
  if (expression.type === 'literal' && typeof expression.value !== 'string') return expression.value
  if (expression.type === 'unknown' || expression.type === 'incomplete' || expression.type === 'invalid') {
    return expression.sourceText
  }
  return formatExpression(expression)
}

function formatExpression(expression: Expression, parentPrecedence = 0): string {
  switch (expression.type) {
    case 'literal':
      return typeof expression.value === 'string' ? JSON.stringify(expression.value) : String(expression.value)
    case 'identifier':
    case 'variable':
      return expression.name
    case 'property': {
      const object = formatExpression(expression.object, 8)
      return expression.computed
        ? object + '[' + JSON.stringify(expression.property) + ']'
        : object + '.' + expression.property
    }
    case 'call':
      return expression.callee + '(' + expression.arguments.map((argument) => formatExpression(argument)).join(', ') + ')'
    case 'array':
      return '[' + expression.elements.map((element) => formatExpression(element)).join(', ') + ']'
    case 'unary': {
      const argument = formatExpression(expression.argument, 6)
      const value = expression.operator + (expression.operator === 'not' ? ' ' : '') + argument
      return parentPrecedence > 6 ? '(' + value + ')' : value
    }
    case 'binary': {
      const precedence = binaryPrecedence(expression.operator)
      const left = formatExpression(expression.left, precedence)
      const right = formatExpression(expression.right, precedence + 1)
      const value = left + ' ' + expression.operator + ' ' + right
      return precedence < parentPrecedence ? '(' + value + ')' : value
    }
    case 'conditional': {
      const value = formatExpression(expression.test, 1) + ' ? '
        + formatExpression(expression.whenTrue) + ' : ' + formatExpression(expression.whenFalse)
      return parentPrecedence > 0 ? '(' + value + ')' : value
    }
    case 'unknown':
    case 'incomplete':
    case 'invalid':
      return expression.sourceText
  }
}

function binaryPrecedence(operator: string): number {
  if (operator === '||' || operator === '|') return 1
  if (operator === '&&' || operator === '&') return 2
  if (['==', '!=', '<', '<=', '>', '>='].includes(operator)) return 3
  if (['+', '-'].includes(operator)) return 4
  if (['*', '/', '%'].includes(operator)) return 5
  return 6
}

function sameExpression(left: Expression, right: Expression): boolean {
  return JSON.stringify(normalizeExpression(left)) === JSON.stringify(normalizeExpression(right))
}

function expressionMatchesRaw(expression: Expression, raw: unknown): boolean {
  if (isJsonValue(raw)) {
    if (sameExpression(parseConstructLiteral(raw), expression)) return true
    const sourceText = typeof raw === 'string' ? raw : JSON.stringify(raw)
    return sameExpression(parseConstructExpression(raw, sourceText), expression)
  }
  return false
}

function normalizeExpression(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeExpression)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'sourceText' && key !== 'id' && key !== 'sourceLocation')
    .map(([key, entry]) => [key, normalizeExpression(entry)]))
}

function isOpaqueExpression(expression: Expression): boolean {
  return expression.type === 'unknown' || expression.type === 'incomplete' || expression.type === 'invalid'
}

type SidBearingNode = { id: string; metadata?: JsonObject; type?: string; sourceText?: string; raw?: JsonValue }

function inspectSid(
  node: SidBearingNode,
  seen: Set<string>,
  onDuplicate: (sid: string, nodeId: string) => void,
): void {
  const raw = rawObject(node)
  const sid = raw?.sid
  if (!isConstructSid(sid)) return
  const key = String(sid)
  if (!seen.has(key)) {
    seen.add(key)
    return
  }
  onDuplicate(key, node.id)
}

function allocateSid(id: string, originalSid: unknown, allocator: SidAllocator, diagnostics: Diagnostic[]): string | number {
  const original = isConstructSid(originalSid)
  const base = original ? String(originalSid) : sidFromNodeId(id)
  if (!allocator.used.has(base)) {
    allocator.used.add(base)
    return original ? originalSid : base
  }
  let candidate = sidFromNodeId(id)
  let suffix = 2
  while (allocator.used.has(candidate)) candidate = sidFromNodeId(id) + ':' + suffix++
  allocator.used.add(candidate)
  diagnostics.push(exportDiagnostic(
    'construct.export.duplicate-sid',
    'Construct SID "' + base + '" was duplicated; exported node "' + id + '" received SID "' + candidate + '".',
    'warning',
    id,
  ))
  return candidate
}

function rememberRawSid(raw: JsonValue, allocator: SidAllocator): void {
  if (isRecord(raw) && isConstructSid(raw.sid)) allocator.used.add(String(raw.sid))
}

function isConstructSid(value: unknown): value is string | number {
  return (typeof value === 'string' && value.trim().length > 0)
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
}

function sidFromNodeId(id: string): string {
  const sid = id.startsWith('construct:') ? id.slice('construct:'.length) : id
  return sid || 'node'
}

function importedSheetName(
  sheet: { sourceLocation?: { sourceId?: string }; metadata?: JsonObject },
  raw: Record<string, unknown>,
): string {
  if (typeof raw.name === 'string' && raw.name.trim()) return raw.name
  const metadata = sheet.metadata?.construct
  if (isRecord(metadata) && typeof metadata.fallbackSheetName === 'string') return metadata.fallbackSheetName
  const sourceId = sheet.sourceLocation?.sourceId?.replaceAll('\\', '/')
  if (sourceId) {
    const fileName = sourceId.slice(sourceId.lastIndexOf('/') + 1)
    const extension = fileName.lastIndexOf('.')
    if (extension > 0) return fileName.slice(0, extension)
  }
  return 'Event sheet'
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source) as unknown
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function exportDiagnostic(code: string, message: string, severity: Diagnostic['severity'], nodeId?: string): Diagnostic {
  return { code, message, severity, ...(nodeId === undefined ? {} : { nodeId }) }
}

function sourceLocationsForDocument(document: EventDocument): ReadonlyMap<string, SourceLocation> {
  const locations = new Map<string, SourceLocation>()
  for (const sheet of document.sheets) {
    collectSourceLocations(sheet, locations)
    if ('events' in sheet) {
      for (const event of sheet.events) collectEventSourceLocations(event, locations)
      for (const variable of sheet.variables ?? []) collectSourceLocations(variable, locations)
      for (const include of sheet.includes ?? []) collectSourceLocations(include, locations)
    }
  }
  for (const variable of document.variables) collectSourceLocations(variable, locations)
  for (const fn of document.functions ?? []) {
    collectSourceLocations(fn, locations)
    if ('parameters' in fn) for (const parameter of fn.parameters) collectSourceLocations(parameter, locations)
    if ('body' in fn) for (const event of fn.body) collectEventSourceLocations(event, locations)
  }
  return locations
}

function fallbackSourceLocationForDocument(document: EventDocument): SourceLocation | undefined {
  const constructMetadata = document.metadata?.construct
  const sourceId = isRecord(constructMetadata) && typeof constructMetadata.sourceId === 'string'
    ? constructMetadata.sourceId
    : document.sheets.find((sheet) => sheet.sourceLocation?.sourceId)?.sourceLocation?.sourceId
  return sourceId ? { sourceId } : undefined
}

function sourceLocationsForSheet(sheet: EventSheetNode): ReadonlyMap<string, SourceLocation> {
  const locations = new Map<string, SourceLocation>()
  collectSourceLocations(sheet, locations)
  if ('events' in sheet) {
    for (const event of sheet.events) collectEventSourceLocations(event, locations)
    for (const variable of sheet.variables ?? []) collectSourceLocations(variable, locations)
    for (const include of sheet.includes ?? []) collectSourceLocations(include, locations)
  }
  return locations
}

function collectEventSourceLocations(event: EventNode, locations: Map<string, SourceLocation>): void {
  collectSourceLocations(event, locations)
  if (event.type !== 'event') return
  for (const variable of event.variables ?? []) collectSourceLocations(variable, locations)
  for (const ace of [...event.conditions, ...event.actions]) collectSourceLocations(ace, locations)
  for (const child of event.subEvents ?? []) collectEventSourceLocations(child, locations)
}

function collectSourceLocations(
  node: { id: string; sourceLocation?: SourceLocation },
  locations: Map<string, SourceLocation>,
): void {
  if (node.sourceLocation) locations.set(node.id, node.sourceLocation)
}

function attachSourceLocations(
  diagnostics: Diagnostic[],
  locations: ReadonlyMap<string, SourceLocation>,
  fallback?: SourceLocation,
): Diagnostic[] {
  return diagnostics.map((item) => {
    if (item.sourceLocation) return item
    const sourceLocation = item.nodeId ? locations.get(item.nodeId) : undefined
    if (sourceLocation) return { ...item, sourceLocation }
    return fallback ? { ...item, sourceLocation: fallback } : item
  })
}

function lossyDiagnostic(nodeId: string, nodeType: string): Diagnostic {
  return exportDiagnostic(
    'construct.export.lossy-node',
    'Construct ' + nodeType + ' "' + nodeId + '" has no preserved source representation and cannot be exported without guessing.',
    'warning',
    nodeId,
  )
}

function opaqueDiagnostic(nodeId: string, nodeType: string): Diagnostic {
  return exportDiagnostic(
    'construct.export.opaque-preserved',
    'Construct ' + nodeType + ' "' + nodeId + '" is preserved as opaque source because its behavior is not modeled.',
    'warning',
    nodeId,
  )
}

function projectSheetOutputPath(sheet: EventSheetNode, index: number, projectPrefix: string): string {
  const sourcePath = sheet.sourceLocation?.sourceId
  const sheetName = 'type' in sheet ? 'Sheet ' + (index + 1) : sheet.name
  const normalizedSourcePath = sourcePath ? normalizeProjectOutputPath(sourcePath) : undefined
  if (sourcePath && normalizedSourcePath === undefined) return sourcePath.replaceAll('\\', '/')
  const projectRelativePath = normalizedSourcePath?.startsWith(projectPrefix)
    ? normalizedSourcePath.slice(projectPrefix.length)
    : normalizedSourcePath
  const isIndexedEventSheet = projectRelativePath?.startsWith('eventSheets/')
    && projectRelativePath.toLowerCase().endsWith('.json')
  const eventSheetPath = isIndexedEventSheet && normalizedSourcePath
    ? normalizedSourcePath
    : projectPrefix + 'eventSheets/' + safeFileName(sheetName) + '.json'
  return eventSheetPath.startsWith(projectPrefix) ? eventSheetPath : projectPrefix + eventSheetPath
}

function normalizeProjectOutputPath(path: string): string | undefined {
  const portablePath = path.replaceAll('\\', '/')
  if (portablePath.includes('\0') || portablePath.startsWith('/') || /^[A-Za-z]:/.test(portablePath)) return undefined
  const parts = portablePath.split('/').filter((part) => part && part !== '.')
  if (parts.some((part) => part === '..')) return undefined
  return parts.join('/') || undefined
}

function findProjectSheetPathConflict(
  path: string,
  sourcePath: string | undefined,
  claimedPaths: Set<string>,
  preservedFiles: Record<string, JsonValue> | undefined,
  projectManifestPath: string | undefined,
): { message: string } | undefined {
  if (!isSafeArchivePath(path)) {
    claimedPaths.add(path)
    return { message: 'Construct sheet output path "' + path + '" is unsafe and cannot be exported.' }
  }
  if (projectManifestPath === path) {
    claimedPaths.add(path)
    return { message: 'Construct sheet output path "' + path + '" conflicts with the project manifest.' }
  }
  if (claimedPaths.has(path)) {
    return { message: 'Multiple Construct event sheets resolve to output path "' + path + '".' }
  }
  claimedPaths.add(path)
  const normalizedSourcePath = sourcePath ? normalizeProjectOutputPath(sourcePath) : undefined
  const preservesThisSheet = normalizedSourcePath !== undefined
    && (path === normalizedSourcePath || path.endsWith('/' + normalizedSourcePath))
  const preservedPathCollides = preservedFiles
    && Object.keys(preservedFiles).some((preservedPath) => normalizeProjectOutputPath(preservedPath) === path)
  if (!preservesThisSheet && preservedPathCollides) {
    return { message: 'New Construct sheet output path "' + path + '" conflicts with a preserved project file.' }
  }
  return undefined
}

function safeFileName(name: string): string {
  return Array.from(name, (character) => (character.codePointAt(0) ?? 0) < 32 ? '_' : character)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim() || 'Event sheet'
}

function indexedResourcePaths(root: string, value: Record<string, unknown>, prefix = ''): string[] {
  const output: string[] = []
  const items = Array.isArray(value.items) ? value.items : []
  for (const item of items) {
    const name = typeof item === 'string' ? item : isRecord(item) && typeof item.name === 'string' ? item.name : undefined
    if (name) {
      const path = [root, prefix, name].filter(Boolean).join('/')
      output.push(path.endsWith('.json') ? path : path + '.json')
    }
  }
  const folders = Array.isArray(value.subfolders) ? value.subfolders : []
  for (const folder of folders) {
    if (!isRecord(folder) || typeof folder.name !== 'string') continue
    output.push(...indexedResourcePaths(root, folder, [prefix, folder.name].filter(Boolean).join('/')))
  }
  return output
}

function ensureEventSheetIndexed(project: Record<string, unknown>, path: string): boolean {
  if (!path.startsWith('eventSheets/')) return false
  const parts = path.slice('eventSheets/'.length).split('/').filter(Boolean)
  if (!parts.length) return false
  const last = parts[parts.length - 1]
  if (!last) return false
  parts[parts.length - 1] = last.replace(/\.json$/i, '')

  if (!isRecord(project.eventSheets)) {
    project.eventSheets = { items: [], subfolders: [] }
  }
  let changed = false
  let folder = project.eventSheets as Record<string, unknown>
  for (const segment of parts.slice(0, -1)) {
    if (!Array.isArray(folder.subfolders)) {
      folder.subfolders = []
      changed = true
    }
    const subfolders = folder.subfolders as unknown[]
    let child = subfolders.find((candidate): candidate is Record<string, unknown> =>
      isRecord(candidate) && candidate.name === segment)
    if (child === undefined) {
      child = { name: segment, items: [], subfolders: [] }
      subfolders.push(child)
      changed = true
    }
    folder = child
  }
  if (!Array.isArray(folder.items)) {
    folder.items = []
    changed = true
  }
  const items = folder.items as unknown[]
  if (!items.some((item) => item === parts.at(-1) || (isRecord(item) && item.name === parts.at(-1)))) {
    items.push(parts.at(-1))
    changed = true
  }
  return changed
}

function deduplicateDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter((item) => {
    const key = item.code + '|' + (item.nodeId ?? '') + '|' + item.message
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
