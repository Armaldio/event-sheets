import {
  CURRENT_SCHEMA_VERSION,
  isJsonObject,
  validateEventDocument,
  type Diagnostic,
  type DocumentImporter,
  type EventDocument,
  type EventSheetNode,
  type IncompleteNode,
  type JsonObject,
  type ParseResult,
  type SourceLocation,
} from '@project/schema'
import { unzipSync } from 'fflate'
import { parseConstruct, type ParseConstructOptions } from './parser.js'
import {
  decodeProjectText,
  storeProjectFileContent,
  type ConstructProjectFileContent,
} from './project-files.js'
export type { ConstructProjectFileContent } from './project-files.js'

/** Text or binary files from an extracted Construct project folder. */
export type ConstructProjectFiles = Readonly<Record<string, ConstructProjectFileContent>>
export type ConstructImportSource = string | ConstructProjectFiles

export interface ConstructArchiveImportOptions extends ParseConstructOptions {
  /** Maximum compressed archive input size. Defaults to 128 MiB. */
  maxArchiveBytes?: number
  /** Maximum total extracted file size. Defaults to 128 MiB. */
  maxExpandedBytes?: number
  /** Maximum number of archive entries. Defaults to 10000. */
  maxEntries?: number
}

/** Import either one event sheet JSON file or all event sheets indexed by project.c3proj. */
export function importConstruct(source: ConstructImportSource, options: ParseConstructOptions = {}): ParseResult {
  if (typeof source !== 'string') return importConstructProject(source, options)
  return validateResult(parseConstruct(source, options))
}

/** Import the event sheets listed by project.c3proj from a folder-project file map. */
export function importConstructProject(files: ConstructProjectFiles, options: ParseConstructOptions = {}): ParseResult {
  const diagnostics: Diagnostic[] = []
  const indexedFiles = indexProjectFiles(files, diagnostics)
  const projectPaths = [...indexedFiles.keys()].filter((path) => path.slice(path.lastIndexOf('/') + 1) === 'project.c3proj')
  if (projectPaths.length === 0) {
    return appendImportDiagnostics(incompleteProject(
      options.sourceId ?? 'project.c3proj',
      '',
      'construct.missing-project-file',
      'Construct project folder does not contain project.c3proj.',
    ), diagnostics)
  }
  if (projectPaths.length > 1) {
    return appendImportDiagnostics(incompleteProject(
      options.sourceId ?? 'project.c3proj',
      '',
      'construct.ambiguous-project-file',
      'Construct project file map contains more than one project.c3proj.',
    ), diagnostics)
  }
  const projectPath = projectPaths[0]
  if (!projectPath) throw new RangeError('Expected a Construct project file path.')

  const projectSource = decodeProjectText(indexedFiles.get(projectPath)) ?? ''
  const projectSourceId = projectPath.slice(projectPath.lastIndexOf('/') + 1)
  let project: unknown
  try {
    project = JSON.parse(projectSource) as unknown
  } catch {
    return appendImportDiagnostics(
      incompleteProject(projectSourceId, projectSource, 'construct.invalid-project-json', 'Construct project.c3proj is not valid JSON.'),
      diagnostics,
    )
  }
  if (!isJsonObject(project)) {
    return appendImportDiagnostics(
      incompleteProject(projectSourceId, projectSource, 'construct.invalid-project', 'Expected a Construct project manifest object.'),
      diagnostics,
    )
  }

  const objectClassPluginIds = collectObjectClassPluginIds(indexedFiles)
  Object.assign(objectClassPluginIds, options.objectClassPluginIds)

  const sheetPaths = listEventSheetPaths(project.eventSheets, diagnostics, projectSourceId)
  const sheetNodes: EventSheetNode[] = []
  let partial = diagnostics.some(({ severity }) => severity === 'error')

  for (const relativePath of sheetPaths) {
    const storedPath = projectPath.includes('/')
      ? `${projectPath.slice(0, projectPath.lastIndexOf('/') + 1)}${relativePath}`
      : relativePath
    const source = decodeProjectText(indexedFiles.get(storedPath))
    const sheetName = fileBaseName(relativePath)
    if (source === undefined) {
      const nodeId = `construct:missing-sheet:${relativePath.replaceAll('/', ':')}`
      diagnostics.push({
        code: 'construct.missing-event-sheet',
        severity: 'error',
        message: `Construct project references event sheet "${relativePath}", but the file was not provided.`,
        nodeId,
        sourceLocation: { sourceId: projectSourceId },
        details: { path: relativePath },
      })
      sheetNodes.push({
        type: 'incomplete',
        nodeType: 'sheet',
        id: nodeId,
        sourceLocation: { sourceId: relativePath },
        expected: ['event sheet file'],
      })
      partial = true
      continue
    }

    const result = parseConstruct(source, {
      ...options,
      objectClassPluginIds,
      sourceId: relativePath,
      fallbackSheetName: sheetName,
    })
    sheetNodes.push(...result.document.sheets)
    diagnostics.push(...result.diagnostics)
    if (result.status === 'partial') partial = true
  }

  const availableSheets = sheetNodes.filter((sheet): sheet is Exclude<EventSheetNode, { type: string }> => !('type' in sheet))
  for (const sheet of availableSheets) {
    if (!sheet.includes) continue
    sheet.includes = sheet.includes.map((include) => {
      const matches = availableSheets.filter((candidate) => candidate.name === include.sheetName)
      if (matches.length === 1 && matches[0]) {
        return { ...include, targetSheetId: matches[0].id }
      }
      diagnostics.push({
        code: matches.length === 0 ? 'construct.unresolved-event-sheet-include' : 'construct.ambiguous-event-sheet-include',
        severity: 'warning',
        message: matches.length === 0
          ? `Included event sheet "${include.sheetName}" was not found in the imported project.`
          : `Included event sheet name "${include.sheetName}" matches more than one imported sheet.`,
        nodeId: include.id,
        ...(include.sourceLocation === undefined ? {} : { sourceLocation: include.sourceLocation }),
        details: { sheetName: include.sheetName },
      })
      partial = true
      return include
    })
  }

  const projectName = typeof project.name === 'string' && project.name.trim() ? project.name : 'project'
  const projectId = typeof project.uniqueId === 'string' && project.uniqueId.trim() ? project.uniqueId : projectName
  const document: EventDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: `construct-project:${projectId}`,
    engine: { id: 'construct' },
    metadata: {
      construct: {
        format: 'project-folder',
        sourceId: projectPath,
      project: project as JsonObject,
      files: Object.fromEntries([...indexedFiles.entries()].map(([path, contents]) => [
        path,
        storeProjectFileContent(contents),
      ])),
      },
    },
    sheets: sheetNodes,
    variables: [],
  }

  const validated = validateEventDocument(document)
  if (!validated.valid) {
    diagnostics.push(...validated.diagnostics)
    partial = true
  }
  return { document, diagnostics, status: partial ? 'partial' : 'complete' }
}

/** Import a ZIP-based .c3p archive without extracting files to disk. */
export function importConstructArchive(
  archive: Uint8Array,
  options: ConstructArchiveImportOptions = {},
): ParseResult {
  const sourceId = options.sourceId ?? 'project.c3p'
  const maxArchiveBytes = positiveLimit(options.maxArchiveBytes, 128 * 1024 * 1024)
  const maxExpandedBytes = positiveLimit(options.maxExpandedBytes, 128 * 1024 * 1024)
  const maxEntries = positiveLimit(options.maxEntries, 10_000)

  if (!(archive instanceof Uint8Array)) {
    return incompleteProject(sourceId, '', 'construct.invalid-project-archive', 'Construct project archive input must be a Uint8Array.')
  }
  if (archive.byteLength > maxArchiveBytes) {
    return incompleteProject(sourceId, '', 'construct.project-archive-size-limit', 'Construct project archive exceeds the configured compressed size limit.')
  }

  try {
    const files = extractProjectArchive(archive, maxExpandedBytes, maxEntries)
    const imported = importConstructProject(files, options)
    const metadata = imported.document.metadata ?? {}
    const construct = isJsonObject(metadata.construct) ? metadata.construct : {}
    imported.document.metadata = { ...metadata, construct: { ...construct, format: 'project-archive' } }
    return imported
  } catch (error) {
    const isLimit = error instanceof ProjectArchiveLimitError
    return incompleteProject(
      sourceId,
      '',
      isLimit ? 'construct.project-archive-size-limit' : 'construct.invalid-project-archive',
      isLimit
        ? 'Construct project archive exceeds the configured expanded size or entry-count limit.'
        : 'Construct project archive is invalid or uses an unsupported ZIP feature.',
    )
  }
}

/** Importer contract for integrations that select an engine importer dynamically. */
export const constructImporter: DocumentImporter<ConstructImportSource, ParseConstructOptions> = Object.freeze({
  engineId: 'construct',
  import: importConstruct,
})

function validateResult(result: ParseResult): ParseResult {
  const validation = validateEventDocument(result.document)
  if (validation.valid) return result
  return {
    ...result,
    diagnostics: [...result.diagnostics, ...validation.diagnostics],
    status: 'partial',
  }
}

function collectObjectClassPluginIds(files: ReadonlyMap<string, ConstructProjectFileContent>): Record<string, string> {
  const pluginIds = Object.create(null) as Record<string, string>
  for (const [path, content] of files) {
    const isObjectType = path.startsWith('objectTypes/') || path.includes('/objectTypes/')
    const isFamily = path.startsWith('families/') || path.includes('/families/')
    if (!(isObjectType || isFamily) || !path.endsWith('.json')) continue
    const source = decodeProjectText(content)
    if (source === undefined) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(source) as unknown
    } catch {
      continue
    }
    if (!isJsonObject(parsed)
      || typeof parsed.name !== 'string'
      || typeof parsed['plugin-id'] !== 'string') continue
    pluginIds[parsed.name] = parsed['plugin-id']
  }
  return pluginIds
}

function indexProjectFiles(
  files: ConstructProjectFiles,
  diagnostics: Diagnostic[],
): Map<string, ConstructProjectFileContent> {
  const indexed = new Map<string, ConstructProjectFileContent>()
  for (const [path, contents] of Object.entries(files)) {
    const normalized = normalizeProjectPath(path)
    if (!normalized) {
      diagnostics.push({
        code: 'construct.invalid-project-file-path',
        severity: 'error',
        message: `Construct project file path "${path}" is invalid and was omitted.`,
        details: { path },
      })
      continue
    }
    if (typeof contents !== 'string' && !(contents instanceof Uint8Array)) {
      diagnostics.push({
        code: 'construct.invalid-project-file-content',
        severity: 'error',
        message: `Construct project file "${path}" must contain text or binary data.`,
        details: { path },
      })
      continue
    }
    if (indexed.has(normalized)) {
      diagnostics.push({
        code: 'construct.duplicate-project-file-path',
        severity: 'error',
        message: `Multiple Construct project file paths normalize to "${normalized}"; the first entry was retained.`,
        details: { path, normalizedPath: normalized },
      })
      continue
    }
    indexed.set(normalized, contents)
  }
  return indexed
}

function appendImportDiagnostics(result: ParseResult, diagnostics: readonly Diagnostic[]): ParseResult {
  return diagnostics.length === 0 ? result : {
    ...result,
    diagnostics: [...result.diagnostics, ...diagnostics],
    status: 'partial',
  }
}

function extractProjectArchive(
  archive: Uint8Array,
  maxExpandedBytes: number,
  maxEntries: number,
): ConstructProjectFiles {
  let entryCount = 0
  let fileCount = 0
  let declaredBytes = 0
  const normalizedPaths = new Set<string>()
  const pathByArchiveName = new Map<string, string>()
  const extracted = unzipSync(archive, {
    filter: (file) => {
      entryCount += 1
      if (entryCount > maxEntries) throw new ProjectArchiveLimitError()
      if (file.name.endsWith('/')) return false
      const normalized = normalizeProjectPath(file.name)
      if (!normalized || normalized === '__proto__' || normalized.includes('\0') || normalizedPaths.has(normalized)) {
        throw new Error('Archive contains an invalid or duplicate file path.')
      }
      if (!Number.isSafeInteger(file.size) || file.size < 0
        || !Number.isSafeInteger(file.originalSize) || file.originalSize < 0) {
        throw new Error('Archive contains an invalid file size.')
      }
      if (file.compression === 0 && file.size !== file.originalSize) {
        throw new Error('Stored archive entry has inconsistent compressed and expanded sizes.')
      }
      declaredBytes += file.originalSize
      if (file.originalSize > maxExpandedBytes || declaredBytes > maxExpandedBytes) {
        throw new ProjectArchiveLimitError()
      }
      normalizedPaths.add(normalized)
      pathByArchiveName.set(file.name, normalized)
      fileCount += 1
      return true
    },
  })
  if (fileCount === 0) throw new Error('Archive contained no files.')
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
  for (const [archivePath, contents] of Object.entries(extracted)) {
    const normalized = pathByArchiveName.get(archivePath)
    if (!normalized) throw new Error('Archive extraction returned an unvalidated path.')
    files[normalized] = contents
  }
  return files
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

class ProjectArchiveLimitError extends Error {}

function listEventSheetPaths(value: unknown, diagnostics: Diagnostic[], sourceId: string): string[] {
  const paths: string[] = []
  const seen = new Set<string>()

  function visit(folder: unknown, prefix: string): void {
    if (!isRecord(folder)) {
      diagnostics.push(projectDiagnostic('construct.invalid-event-sheet-index', 'Expected a Construct event sheet index object.', sourceId))
      return
    }
    if (folder.items !== undefined) {
      if (!Array.isArray(folder.items)) {
        diagnostics.push(projectDiagnostic('construct.invalid-event-sheet-index', 'Construct event sheet items must be an array.', sourceId))
      } else {
        for (const item of folder.items) {
          const name = typeof item === 'string'
            ? item
            : isRecord(item) && typeof item.name === 'string'
              ? item.name
              : undefined
          if (!name) {
            diagnostics.push(projectDiagnostic('construct.invalid-event-sheet-index', 'Construct event sheet entries must be names or objects with a name.', sourceId))
            continue
          }
          const normalizedName = normalizeProjectPath(name)
          if (!normalizedName) {
            diagnostics.push(projectDiagnostic('construct.invalid-event-sheet-path', `Invalid Construct event sheet path "${name}".`, sourceId))
            continue
          }
          const path = withJsonExtension(joinPath(prefix, normalizedName))
          if (seen.has(path)) {
            diagnostics.push(projectDiagnostic('construct.duplicate-event-sheet', `Construct project lists event sheet "${path}" more than once.`, sourceId))
            continue
          }
          seen.add(path)
          paths.push(path)
        }
      }
    }
    if (folder.subfolders !== undefined) {
      if (!Array.isArray(folder.subfolders)) {
        diagnostics.push(projectDiagnostic('construct.invalid-event-sheet-index', 'Construct event sheet subfolders must be an array.', sourceId))
      } else {
        for (const [index, child] of folder.subfolders.entries()) {
          const name = isRecord(child) && typeof child.name === 'string' ? child.name : undefined
          const normalizedName = name ? normalizeProjectPath(name) : undefined
          if (!child || !normalizedName || normalizedName.includes('/')) {
            diagnostics.push(projectDiagnostic('construct.invalid-event-sheet-folder', `Construct event sheet folder ${index + 1} has no valid name.`, sourceId))
            continue
          }
          visit(child, joinPath(prefix, normalizedName))
        }
      }
    }
  }

  if (value === undefined) {
    diagnostics.push(projectDiagnostic('construct.missing-event-sheet-index', 'Construct project manifest is missing its eventSheets index.', sourceId))
  } else {
    visit(value, 'eventSheets')
  }
  return paths
}

function incompleteProject(sourceId: string, sourceText: string, code: string, message: string): ParseResult {
  const safeSourceId = sourceId.replaceAll('\\', '/').replaceAll('/', ':')
  const sourceLocation: SourceLocation = { sourceId }
  const sheet: IncompleteNode<'sheet'> = {
    type: 'incomplete',
    nodeType: 'sheet',
    id: `construct:incomplete-project:${safeSourceId}`,
    sourceLocation,
    sourceText,
    expected: ['valid project.c3proj and indexed event sheet files'],
  }
  const document: EventDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: `construct-project:incomplete:${safeSourceId}`,
    engine: { id: 'construct' },
    metadata: { construct: { format: 'project-folder' } },
    sheets: [sheet],
    variables: [],
  }
  return {
    document,
    diagnostics: [{
      code,
      severity: 'error',
      message,
      sourceLocation,
      details: { sourceLength: sourceText.length },
    }],
    status: 'partial',
  }
}

function projectDiagnostic(code: string, message: string, sourceId: string): Diagnostic {
  return { code, severity: 'error', message, sourceLocation: { sourceId } }
}

function normalizeProjectPath(path: string): string | undefined {
  const portablePath = path.replaceAll('\\', '/')
  if (portablePath.includes('\0') || portablePath.startsWith('/') || /^[A-Za-z]:/.test(portablePath)) return undefined
  const parts = portablePath.split('/').filter((part) => part && part !== '.')
  if (parts.some((part) => part === '..')) return undefined
  return parts.join('/') || undefined
}

function withJsonExtension(path: string): string {
  return path.toLowerCase().endsWith('.json') ? path : `${path}.json`
}

function joinPath(prefix: string, path: string): string {
  return [prefix, path].filter(Boolean).join('/')
}

function fileBaseName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.toLowerCase().endsWith('.json') ? name.slice(0, -5) : name
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
