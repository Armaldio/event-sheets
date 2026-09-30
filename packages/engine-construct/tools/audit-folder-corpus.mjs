#!/usr/bin/env node
/* global Buffer, console, process */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep, resolve } from 'node:path'
import { zipSync, unzipSync } from 'fflate'
import {
  exportConstructArchive,
  exportConstructProject,
  importConstructArchive,
  importConstructProject,
} from '../dist/index.js'

const corpusPath = process.argv[2]
const projectFilesPath = process.argv[3]
if (!corpusPath) {
  console.error('Usage: node packages/engine-construct/tools/audit-folder-corpus.mjs <projectfolders-directory> [projectfiles-directory]')
  process.exitCode = 2
} else {
  const root = resolve(corpusPath)
  const projectDirectories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))

  if (projectDirectories.length === 0) {
    throw new Error(`No project folders found under ${root}`)
  }

  const diagnosticCounts = new Map()
  const aceCounts = new Map()
  const eventTypeCounts = new Map()
  const projects = []

  for (const projectDirectory of projectDirectories) {
    const projectPath = join(root, projectDirectory.name)
    const sourceFiles = Object.create(null)
    readProjectFiles(projectPath, projectPath, sourceFiles)

    const imported = importConstructProject(sourceFiles)
    const exported = exportConstructProject(imported.document)
    const archivedImport = await importConstructArchive(zipSync(sourceFiles))
    const archivedExport = exportConstructArchive(archivedImport.document)
    const archiveFiles = unzipSync(archivedExport.output)
    for (const diagnostic of imported.diagnostics) {
      increment(diagnosticCounts, diagnostic.code)
      if (typeof diagnostic.details?.aceId === 'string') {
        increment(aceCounts, `${diagnostic.details.objectClass}.${diagnostic.details.aceId}`)
      }
      if (typeof diagnostic.details?.eventType === 'string') {
        increment(eventTypeCounts, diagnostic.details.eventType)
      }
    }

    const originalPaths = Object.keys(sourceFiles).sort()
    const outputPaths = Object.keys(exported.output).sort()
    let jsonValueChanges = 0
    let opaqueByteChanges = 0
    for (const path of originalPaths) {
      if (!(path in exported.output)) continue
      const original = toBuffer(sourceFiles[path])
      const output = toBuffer(exported.output[path])
      if (isJsonPath(path)) {
        if (!equalJsonValues(original, output)) jsonValueChanges += 1
      } else if (!original.equals(output)) {
        opaqueByteChanges += 1
      }
    }
    projects.push({
      name: projectDirectory.name,
      fileCount: originalPaths.length,
      importStatus: imported.status,
      exportStatus: exported.status,
      pathChanges: JSON.stringify(originalPaths) !== JSON.stringify(outputPaths),
      jsonValueChanges,
      opaqueByteChanges,
      archiveImportStatus: archivedImport.status,
      archiveExportStatus: archivedExport.status,
      archivePathChanges: JSON.stringify(originalPaths) !== JSON.stringify(Object.keys(archiveFiles).sort()),
      archiveJsonValueChanges: countContentDifferences(sourceFiles, archiveFiles, true),
      archiveOpaqueByteChanges: countContentDifferences(sourceFiles, archiveFiles, false),
    })
  }

  const projectFileArchiveAudit = projectFilesPath
    ? await auditProjectFileArchives(resolve(projectFilesPath))
    : undefined

  console.log(JSON.stringify({
    projectCount: projects.length,
    completeImports: projects.filter(({ importStatus }) => importStatus === 'complete').length,
    completeExports: projects.filter(({ exportStatus }) => exportStatus === 'complete').length,
    archiveCompleteImports: projects.filter(({ archiveImportStatus }) => archiveImportStatus === 'complete').length,
    archiveCompleteExports: projects.filter(({ archiveExportStatus }) => archiveExportStatus === 'complete').length,
    projectsWithPathChanges: projects.filter(({ pathChanges }) => pathChanges).map(({ name }) => name),
    projectsWithJsonValueChanges: projects.filter(({ jsonValueChanges }) => jsonValueChanges > 0)
      .map(({ name, jsonValueChanges }) => ({ name, jsonValueChanges })),
    projectsWithOpaqueByteChanges: projects.filter(({ opaqueByteChanges }) => opaqueByteChanges > 0)
      .map(({ name, opaqueByteChanges }) => ({ name, opaqueByteChanges })),
    archiveProjectsWithPathChanges: projects.filter(({ archivePathChanges }) => archivePathChanges)
      .map(({ name }) => name),
    archiveProjectsWithJsonValueChanges: projects.filter(({ archiveJsonValueChanges }) => archiveJsonValueChanges > 0)
      .map(({ name, archiveJsonValueChanges }) => ({ name, archiveJsonValueChanges })),
    archiveProjectsWithOpaqueByteChanges: projects.filter(({ archiveOpaqueByteChanges }) => archiveOpaqueByteChanges > 0)
      .map(({ name, archiveOpaqueByteChanges }) => ({ name, archiveOpaqueByteChanges })),
    diagnosticCounts: sortedCounts(diagnosticCounts),
    topUnregisteredAces: sortedCounts(aceCounts).slice(0, 15),
    unknownEventTypes: sortedCounts(eventTypeCounts),
    projectFileArchiveAudit,
    projects,
  }, null, 2))
}

async function auditProjectFileArchives(root) {
  const archivePaths = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.c3p'))
    .map((entry) => join(root, entry.name))
    .sort((left, right) => left.localeCompare(right))
  if (archivePaths.length === 0) throw new Error(`No .c3p archives found under ${root}`)

  const diagnosticCounts = new Map()
  const projects = []
  for (const archivePath of archivePaths) {
    const name = archivePath.slice(archivePath.lastIndexOf(sep) + 1)
    const sourceArchive = readFileSync(archivePath)
    const sourceArchiveEntries = unzipSync(sourceArchive)
    const sourceFiles = normalizeArchiveFiles(sourceArchiveEntries)
    const imported = await importConstructArchive(sourceArchive)
    const exported = exportConstructArchive(imported.document)
    const outputFiles = normalizeArchiveFiles(unzipSync(exported.output))
    for (const diagnostic of imported.diagnostics) increment(diagnosticCounts, diagnostic.code)

    const sourcePaths = Object.keys(sourceFiles).sort()
    const outputPaths = Object.keys(outputFiles).sort()
    projects.push({
      name,
      fileCount: sourcePaths.length,
      sourcePathCanonicalizations: Object.keys(sourceArchiveEntries)
        .filter((path) => path.replaceAll('\\', '/') !== path).length,
      importStatus: imported.status,
      exportStatus: exported.status,
      pathChanges: JSON.stringify(sourcePaths) !== JSON.stringify(outputPaths),
      jsonValueChanges: countContentDifferences(sourceFiles, outputFiles, true),
      opaqueByteChanges: countContentDifferences(sourceFiles, outputFiles, false),
    })
  }

  return {
    projectCount: projects.length,
    completeImports: projects.filter(({ importStatus }) => importStatus === 'complete').length,
    completeExports: projects.filter(({ exportStatus }) => exportStatus === 'complete').length,
    projectsWithPathChanges: projects.filter(({ pathChanges }) => pathChanges).map(({ name }) => name),
    projectsWithJsonValueChanges: projects.filter(({ jsonValueChanges }) => jsonValueChanges > 0)
      .map(({ name, jsonValueChanges }) => ({ name, jsonValueChanges })),
    projectsWithOpaqueByteChanges: projects.filter(({ opaqueByteChanges }) => opaqueByteChanges > 0)
      .map(({ name, opaqueByteChanges }) => ({ name, opaqueByteChanges })),
    projectsWithPathCanonicalizations: projects.filter(({ sourcePathCanonicalizations }) => sourcePathCanonicalizations > 0)
      .map(({ name, sourcePathCanonicalizations }) => ({ name, sourcePathCanonicalizations })),
    diagnosticCounts: sortedCounts(diagnosticCounts),
    projects,
  }
}

function readProjectFiles(root, directory, output) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      readProjectFiles(root, path, output)
    } else if (entry.isFile()) {
      output[relative(root, path).split(sep).join('/')] = readFileSync(path)
    }
  }
}

function normalizeArchiveFiles(files) {
  const normalizedFiles = Object.create(null)
  for (const [path, contents] of Object.entries(files)) {
    const normalized = path.replaceAll('\\', '/')
    if (Object.hasOwn(normalizedFiles, normalized)) {
      throw new Error(`Archive paths collide after normalization: ${normalized}`)
    }
    normalizedFiles[normalized] = contents
  }
  return normalizedFiles
}

function increment(counts, name) {
  counts.set(name, (counts.get(name) ?? 0) + 1)
}

function sortedCounts(counts) {
  return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => ({ name, count }))
}

function isJsonPath(path) {
  return path.toLowerCase().endsWith('.json') || path.toLowerCase().endsWith('.c3proj')
}

function equalJsonValues(left, right) {
  try {
    return JSON.stringify(canonicalize(JSON.parse(left.toString('utf8'))))
      === JSON.stringify(canonicalize(JSON.parse(right.toString('utf8'))))
  } catch {
    return left.equals(right)
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function toBuffer(content) {
  return typeof content === 'string' ? Buffer.from(content) : Buffer.from(content)
}

function countContentDifferences(sourceFiles, outputFiles, jsonOnly) {
  let count = 0
  for (const [path, source] of Object.entries(sourceFiles)) {
    if (!(path in outputFiles) || isJsonPath(path) !== jsonOnly) continue
    const before = toBuffer(source)
    const after = toBuffer(outputFiles[path])
    if (jsonOnly ? !equalJsonValues(before, after) : !before.equals(after)) count += 1
  }
  return count
}
