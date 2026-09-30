<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import {
  compileConstruct,
  createConstructEngine,
  createConstructParser,
  createConstructRuntime,
  defineConstructExtension,
  exportConstructSheet,
  parseConstruct,
} from '@project/engine-construct'
import type { ExecutionTrace } from '@project/engine-construct'
import { diffEventDocuments } from '@project/schema'
import type { Diagnostic, EventDocument, EventDocumentDiff, EventNode, HostAdapter, JsonValue, ParseResult, StreamParser } from '@project/schema'
import { EventSheetEditor } from '@project/visual'
import '@project/visual/style.css'

const sourceId = 'levels/01/main.c3ev'
const playgroundEngine = createConstructEngine({
  extensions: [defineConstructExtension({
    id: 'playground.player',
    objectClass: 'Player',
    actions: [{
      id: 'set-x', category: 'position', name: 'Set X', scriptName: 'SetX',
      parameters: [{ id: 'value', type: 'number' }],
    }],
  })],
})
const sampleSource = JSON.stringify({
  sid: 'main-sheet',
  name: 'Checkpoint logic',
  events: [{
    eventType: 'variable',
    sid: 'variable-score',
    name: 'score',
    type: 'number',
    initialValue: '0',
    comment: '',
    isStatic: false,
    isConstant: false,
  }, {
    eventType: 'block',
    sid: 'event-checkpoint',
    name: 'Player reaches the marker',
    conditions: [{
      id: 'compare-two-values',
      objectClass: 'System',
      sid: 'condition-player-x',
      parameters: { 'first-value': 'Player.X', comparison: 0, 'second-value': 180 },
    }],
    actions: [
      {
        sid: 'action-score',
        id: 'set-eventvar-value',
        objectClass: 'System',
        parameters: { variable: 'score', value: 'score + 1' },
      },
      {
        sid: 'action-player-x',
        id: 'set-x',
        objectClass: 'Player',
        parameters: { value: 'Player.X + 10' },
      },
      {
        id: 'flash-once',
        objectClass: 'WorkshopFX',
        sid: 'action-flash',
        parameters: { color: 'amber', duration: 0.3 },
      },
    ],
    children: [],
  }],
}, null, 2)
const imported = parseConstruct(sampleSource, { sourceId, registry: playgroundEngine.registry })

interface PlaygroundInstance {
  id: string
  objectType: string
  properties: Record<string, JsonValue>
}

interface PlaygroundActionCall {
  objectClass: string
  actionId: string
  targetIds: string[]
  parameters: JsonValue[]
}

const document: EventDocument = imported.document
const displayedDocument = shallowRef(document)
const sourceText = shallowRef(sampleSource)
const displayedDiagnostics = shallowRef<readonly Diagnostic[]>(imported.diagnostics)
const selectedEventId = shallowRef<string>()
const streamState = shallowRef<'idle' | 'streaming' | 'complete'>('idle')
const streamCursor = shallowRef(0)
const chunkSize = 64
const chunkCount = computed(() => Math.ceil(sourceText.value.length / chunkSize))
let parser: StreamParser | undefined
const structuralDiff = shallowRef<EventDocumentDiff>({ operations: [], isEmpty: true })
const structuralDiffEntries = computed(() => structuralDiff.value.operations.map(({ kind, nodeType, nodeId }) => ({
  kind, nodeType, nodeId,
})))
const previewTrace = shallowRef<ExecutionTrace>()
const previewVariables = shallowRef<Array<[string, JsonValue]>>([])
const previewCompileDiagnostics = shallowRef<Diagnostic[]>([])
const previewActionCalls = shallowRef<PlaygroundActionCall[]>([])

const previewDiagnostics = computed(() => [
  ...displayedDiagnostics.value,
  ...previewCompileDiagnostics.value,
  ...(previewTrace.value?.diagnostics ?? []),
])
const unknownAces = computed(() => collectUnknownAces(displayedDocument.value))
const rawDocument = computed(() => JSON.stringify(displayedDocument.value, null, 2))
const importedMetadata = computed(() => pretty(collectImportedMetadata(displayedDocument.value)))

watch(displayedDocument, clearPreview)

function recordStructuralDiff(before: EventDocument, after: EventDocument): void {
  structuralDiff.value = diffEventDocuments(before, after)
}

function showResult(result: ParseResult): void {
  recordStructuralDiff(displayedDocument.value, result.document)
  displayedDocument.value = result.document
  displayedDiagnostics.value = result.diagnostics
}

function parseSourceInput(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLTextAreaElement)) return
  sourceText.value = target.value
  showResult(parseConstruct(sourceText.value, { sourceId, registry: playgroundEngine.registry }))
}

function syncSourceFromVisual(nextDocument: EventDocument): void {
  recordStructuralDiff(displayedDocument.value, nextDocument)
  displayedDocument.value = nextDocument
  const sheet = nextDocument.sheets[0]
  if (!sheet || 'type' in sheet) return
  sourceText.value = exportConstructSheet(sheet).output
}

function startStream(): void {
  parser = createConstructParser({ sourceId, registry: playgroundEngine.registry })
  streamCursor.value = 0
  streamState.value = 'streaming'
  showResult(parser.snapshot())
  pushNextChunk()
}

function pushNextChunk(): void {
  if (!parser || streamCursor.value >= sourceText.value.length) return
  const end = Math.min(streamCursor.value + chunkSize, sourceText.value.length)
  parser.push(sourceText.value.slice(streamCursor.value, end))
  streamCursor.value = end
  const result = streamCursor.value === sourceText.value.length ? parser.finish() : parser.snapshot()
  showResult(result)
  if (streamCursor.value === sourceText.value.length) streamState.value = 'complete'
}

function resetStream(): void {
  parser = undefined
  streamCursor.value = 0
  streamState.value = 'idle'
  sourceText.value = sampleSource
  displayedDocument.value = document
  displayedDiagnostics.value = imported.diagnostics
  structuralDiff.value = { operations: [], isEmpty: true }
}

function clearPreview(): void {
  previewTrace.value = undefined
  previewVariables.value = []
  previewCompileDiagnostics.value = []
  previewActionCalls.value = []
}

function runPreview(): void {
  const compiled = compileConstruct(displayedDocument.value, { registry: playgroundEngine.registry })
  previewCompileDiagnostics.value = compiled.diagnostics
  previewActionCalls.value = []

  const instances: PlaygroundInstance[] = [{ id: 'player-1', objectType: 'Player', properties: { X: 180 } }]
  const adapter: HostAdapter<void, PlaygroundInstance> = {
    engineId: 'construct',
    getContext: () => undefined,
    getInstances: (objectType) => instances.filter((instance) => instance.objectType === objectType),
    getObjectType: (instance) => instance.objectType,
    getProperty: (instance, property) => instance.properties[property] ?? null,
    setProperty: (instance, property, value) => { instance.properties[property] = value },
    callAction: (objectClass, actionId, targets, parameters) => {
      previewActionCalls.value.push({
        objectClass,
        actionId,
        targetIds: targets.map(({ id }) => id),
        parameters: [...parameters],
      })
      if (objectClass === 'Player' && actionId === 'set-x' && typeof parameters[0] === 'number') {
        for (const instance of targets) instance.properties.X = parameters[0]
      }
    },
    createInstance: (objectType, properties = {}) => {
      const instance = { id: `created-${instances.length + 1}`, objectType, properties: { ...properties } }
      instances.push(instance)
      return instance
    },
    destroyInstance: (instance) => {
      const index = instances.indexOf(instance)
      if (index >= 0) instances.splice(index, 1)
    },
    queryObjects: (objectType, predicate) => {
      const matches = instances.filter((instance) => instance.objectType === objectType)
      return predicate ? matches.filter(predicate) : matches
    },
  }
  const runtime = createConstructRuntime(adapter)
  const sheetId = displayedDocument.value.sheets[0]?.id
  previewTrace.value = sheetId
    ? runtime.run(compiled.compiled, sheetId)
    : undefined
  previewVariables.value = [...runtime.variables.entries()]
}

function collectUnknownAces(document: EventDocument): Array<{ id: string; operation: string }> {
  const found: Array<{ id: string; operation: string }> = []
  for (const sheet of document.sheets) {
    if (!('events' in sheet)) continue
    for (const event of sheet.events) collectEvent(event)
  }
  return found

  function collectEvent(event: EventNode): void {
    if (event.type !== 'event') return
    for (const ace of [...event.conditions, ...event.actions]) {
      if (ace.type === 'unknown') {
        const raw = ace.raw
        const operation = raw !== null && !Array.isArray(raw) && typeof raw === 'object'
          ? [raw.objectClass, raw.id].filter((part): part is string => typeof part === 'string').join('.')
          : ace.nodeType
        found.push({ id: ace.id, operation })
      }
    }
    for (const child of event.subEvents ?? []) collectEvent(child)
  }
}

function collectImportedMetadata(document: EventDocument): Array<{ id: string; metadata: unknown }> {
  const entries: Array<{ id: string; metadata: unknown }> = []
  if (document.metadata) entries.push({ id: document.id, metadata: document.metadata })
  for (const sheet of document.sheets) {
    collectNode(sheet)
    if ('events' in sheet) for (const event of sheet.events) collectEvent(event)
  }
  return entries

  function collectEvent(event: EventNode): void {
    collectNode(event)
    if (event.type !== 'event') return
    for (const ace of [...event.conditions, ...event.actions]) collectNode(ace)
    for (const child of event.subEvents ?? []) collectEvent(child)
  }

  function collectNode(node: { id: string; metadata?: Record<string, unknown> }): void {
    if (node.metadata) entries.push({ id: node.id, metadata: node.metadata })
  }
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
}
</script>

<template>
  <main class="playground-shell">
    <header class="workbench-header">
      <a class="brand" href="#main" aria-label="Event Sheets playground">
        <span class="brand-mark">ES</span>
        <span class="brand-name">Event Sheets</span>
      </a>
      <div class="workbench-context">
        <span>CONSTRUCT / EDIT</span>
        <span class="context-divider" aria-hidden="true"></span>
        <span>SCHEMA V1</span>
      </div>
    </header>

    <section id="main" class="viewer-stage" aria-label="Playground example">
      <div class="split-workspace">
        <div class="visual-pane" aria-label="Visual event sheet">
          <EventSheetEditor
            :document="displayedDocument"
            :diagnostics="displayedDiagnostics"
            :readonly="false"
            @update:document="syncSourceFromVisual"
            @selection-change="selectedEventId = $event"
          />
        </div>
        <section class="source-pane" aria-labelledby="source-pane-title">
          <div class="source-pane-heading">
            <div>
              <p class="stream-kicker">
                SOURCE / SYNCED
              </p>
              <h2 id="source-pane-title">
                Construct JSON
              </h2>
            </div>
            <span>EDITABLE</span>
          </div>
          <label class="source-editor" for="source-input">Event sheet source</label>
          <textarea
            id="source-input"
            data-test="source-input"
            class="source-editor-input"
            :value="sourceText"
            :disabled="streamState === 'streaming'"
            spellcheck="false"
            @input="parseSourceInput"
          ></textarea>
          <p class="source-pane-note">
            Text edits reparse into the visual sheet. Editor commands update this source.
          </p>
        </section>
      </div>
    </section>

    <section class="stream-panel" aria-labelledby="stream-title">
      <div class="stream-copy">
        <p class="stream-kicker">
          INPUT / STREAM SIMULATION
        </p>
        <h2 id="stream-title">
          Watch an event sheet arrive
        </h2>
        <p>Each step feeds another piece of the Construct JSON into the tolerant parser.</p>
      </div>
      <div class="stream-actions">
        <div class="stream-buttons">
          <button data-test="start-stream" type="button" @click="startStream">
            Start stream
          </button>
          <button
            data-test="next-chunk"
            type="button"
            :disabled="streamState !== 'streaming'"
            @click="pushNextChunk"
          >
            Next chunk
          </button>
          <button data-test="reset-stream" type="button" @click="resetStream">
            Reset
          </button>
        </div>
        <div class="stream-status" :data-state="streamState" role="status" aria-live="polite">
          <span>{{ streamState === 'idle' ? 'Example loaded' : streamState === 'complete' ? 'Stream complete' : 'Receiving source' }}</span>
          <span>{{ streamCursor }} / {{ sourceText.length }} characters · {{ streamCursor ? Math.ceil(streamCursor / chunkSize) : 0 }} / {{ chunkCount }} chunks</span>
        </div>
        <progress aria-label="Example source received" :max="sourceText.length" :value="streamCursor"></progress>
      </div>
    </section>

    <section class="debug-workbench" aria-labelledby="debug-title">
      <header class="debug-heading">
        <div>
          <p class="stream-kicker">
            INSPECT / TRACE
          </p>
          <h2 id="debug-title">
            Developer tools
          </h2>
        </div>
        <button class="debug-run" data-test="run-preview" type="button" @click="runPreview">
          Run preview
        </button>
      </header>

      <div class="debug-state-grid">
        <section aria-label="Current selection state">
          <h3>Current selection</h3>
          <code>{{ selectedEventId ?? 'No event selected' }}</code>
        </section>
        <section aria-label="Runtime variables">
          <h3>Variables</h3>
          <pre data-test="runtime-variables">{{ pretty(previewVariables) }}</pre>
        </section>
        <section aria-label="Action targets">
          <h3>Action targets</h3>
          <pre data-test="action-targets">{{ pretty(previewActionCalls) }}</pre>
        </section>
      </div>

      <details class="debug-section" open>
        <summary>Execution order and condition results</summary>
        <ol v-if="previewTrace?.entries.length" class="trace-list" data-test="execution-trace">
          <li v-for="entry in previewTrace.entries" :key="entry.sequence" :data-state="entry.status">
            <code>{{ entry.sequence }}</code>
            <strong>{{ entry.kind }}</strong>
            <code>{{ entry.nodeId }}</code>
            <span>{{ entry.status }}</span>
            <pre v-if="entry.details">{{ pretty(entry.details) }}</pre>
          </li>
        </ol>
        <p v-else class="debug-empty">
          Run the preview to see execution order, condition outcomes, and actions.
        </p>
      </details>

      <div class="debug-disclosures">
        <details class="debug-section">
          <summary>Diagnostics ({{ previewDiagnostics.length }})</summary>
          <ul v-if="previewDiagnostics.length" data-test="debug-diagnostics">
            <li v-for="(item, index) in previewDiagnostics" :key="`${item.code}-${item.nodeId ?? index}-${index}`">
              <code>{{ item.severity }} · {{ item.code }}</code>
              <span>{{ item.message }}</span>
              <small v-if="item.sourceLocation">{{ item.sourceLocation.sourceId }}:{{ item.sourceLocation.lineStart }}</small>
            </li>
          </ul>
          <p v-else class="debug-empty">
            No diagnostics.
          </p>
        </details>
        <details class="debug-section">
          <summary>Unknown ACEs ({{ unknownAces.length }})</summary>
          <ul v-if="unknownAces.length" data-test="unknown-aces">
            <li v-for="ace in unknownAces" :key="ace.id">
              <code>{{ ace.operation }}</code> <small>{{ ace.id }}</small>
            </li>
          </ul>
          <p v-else class="debug-empty">
            No unknown ACEs.
          </p>
        </details>
        <details class="debug-section">
          <summary>Raw imported metadata</summary>
          <pre>{{ importedMetadata }}</pre>
        </details>
        <details class="debug-section">
          <summary>Raw EventDocument</summary>
          <pre data-test="raw-document">{{ rawDocument }}</pre>
        </details>
        <details class="debug-section">
          <summary>Structural changes ({{ structuralDiffEntries.length }})</summary>
          <ul v-if="structuralDiffEntries.length" data-test="structural-diff">
            <li v-for="(change, index) in structuralDiffEntries" :key="`${change.kind}-${change.nodeId}-${index}`">
              <code>{{ change.kind }} · {{ change.nodeType }}</code>
              <small>{{ change.nodeId }}</small>
            </li>
          </ul>
          <p v-else class="debug-empty">
            No structural changes since the last source or editor update.
          </p>
        </details>
      </div>
    </section>

    <footer class="workbench-footer">
      <span>Construct SIDs anchor the displayed nodes.</span>
      <span>Unregistered ACEs remain visible with diagnostics.</span>
    </footer>
  </main>
</template>

<style scoped>
.playground-shell {
  min-height: 100vh;
  color: var(--event-sheet-ink);
  background: #dfe6e1;
}

.workbench-header {
  display: flex;
  min-height: 3.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem clamp(1rem, 4vw, 3rem);
  border-bottom: 1px solid #bdc9c3;
  background: #f7f8f5;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  color: inherit;
  text-decoration: none;
}

.brand-mark {
  display: grid;
  width: 1.8rem;
  aspect-ratio: 1;
  place-items: center;
  border: 1px solid var(--event-sheet-condition);
  color: var(--event-sheet-condition);
  font-family: var(--event-sheet-mono);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: -0.05em;
}

.brand-name {
  font-family: var(--event-sheet-display);
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.workbench-context {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--event-sheet-muted);
  font-family: var(--event-sheet-mono);
  font-size: 0.65rem;
  letter-spacing: 0.05em;
}

.context-divider {
  width: 1px;
  height: 0.85rem;
  background: var(--event-sheet-rule);
}

.viewer-stage {
  padding: clamp(1.25rem, 4vw, 3.25rem) 1rem;
}

.split-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(20rem, 0.9fr);
  align-items: start;
  gap: 1rem;
  max-width: 86rem;
  margin: 0 auto;
}

.source-pane {
  min-width: 0;
  padding: 1rem;
  border: 1px solid #bdc9c3;
  background: #f7f8f5;
}

.source-pane-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.source-pane-heading h2 {
  margin: 0;
  font-family: var(--event-sheet-serif);
  font-size: 1.2rem;
  font-weight: 500;
}

.source-pane-heading > span,
.source-pane-note {
  color: var(--event-sheet-muted);
  font-family: var(--event-sheet-mono);
  font-size: 0.64rem;
}

.source-pane-note { margin: 0.65rem 0 0; line-height: 1.5; }

.stream-panel {
  display: grid;
  grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.25fr);
  gap: 1.5rem;
  max-width: 72rem;
  padding: 1rem 1.25rem;
  margin: 0 auto 1.5rem;
  border: 1px solid #bdc9c3;
  background: #f7f8f5;
}

.stream-kicker {
  margin: 0 0 0.25rem;
  color: var(--event-sheet-condition);
  font-family: var(--event-sheet-mono);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.stream-copy h2 {
  margin: 0;
  font-family: var(--event-sheet-display);
  font-size: 1rem;
  font-weight: 650;
}

.stream-copy > p:last-child {
  margin: 0.25rem 0 0;
  color: var(--event-sheet-muted);
  font-size: 0.78rem;
}

.stream-actions {
  display: grid;
  align-content: center;
  gap: 0.55rem;
}

.stream-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.stream-buttons button {
  min-height: 2rem;
  padding: 0.35rem 0.65rem;
  border: 1px solid #8fa19b;
  border-radius: 0;
  color: var(--event-sheet-ink);
  background: transparent;
  cursor: pointer;
  font-size: 0.75rem;
}

.stream-buttons button:first-child {
  border-color: var(--event-sheet-condition);
  color: #fff;
  background: var(--event-sheet-condition);
}

.stream-buttons button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.stream-buttons button:focus-visible {
  outline: 2px solid var(--event-sheet-action);
  outline-offset: 2px;
}

.stream-status {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  color: var(--event-sheet-muted);
  font-family: var(--event-sheet-mono);
  font-size: 0.65rem;
}

.stream-status[data-state="streaming"] > span:first-child {
  color: var(--event-sheet-condition);
}

.stream-actions progress {
  width: 100%;
  height: 0.3rem;
  accent-color: var(--event-sheet-condition);
}

.debug-workbench {
  display: grid;
  max-width: 72rem;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  margin: 0 auto 1.5rem;
  border: 1px solid #bdc9c3;
  background: #f7f8f5;
}

.debug-heading,
.debug-state-grid {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 0.75rem;
}

.debug-heading h2,
.debug-state-grid h3 {
  margin: 0;
  font-family: var(--event-sheet-display);
}

.debug-heading h2 { font-size: 1rem; }
.debug-state-grid h3 { margin-bottom: 0.4rem; font-size: 0.75rem; }

.debug-run {
  min-height: 2rem;
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--event-sheet-condition);
  color: #fff;
  background: var(--event-sheet-condition);
  cursor: pointer;
  font-size: 0.75rem;
}

.debug-state-grid > section {
  flex: 1 1 0;
  min-width: 0;
  padding: 0.65rem;
  border: 1px solid #d1dad5;
}

.debug-state-grid code,
.debug-workbench pre,
.trace-list code,
.debug-section li code {
  font-family: var(--event-sheet-mono);
  font-size: 0.65rem;
}

.debug-workbench pre {
  max-height: 16rem;
  overflow: auto;
  margin: 0.45rem 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.debug-section {
  border-top: 1px solid #d1dad5;
  padding-top: 0.65rem;
}

.debug-section summary {
  color: var(--event-sheet-ink);
  cursor: pointer;
  font-family: var(--event-sheet-display);
  font-size: 0.78rem;
  font-weight: 650;
}

.trace-list,
.debug-section ul {
  display: grid;
  gap: 0.4rem;
  padding: 0;
  margin: 0.6rem 0 0;
  list-style: none;
}

.trace-list li,
.debug-section li {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 0.35rem 0.6rem;
  padding: 0.45rem;
  border-left: 2px solid #a8b5af;
  background: #eff2ee;
  font-size: 0.68rem;
}

.trace-list li[data-state="passed"],
.trace-list li[data-state="executed"] { border-color: var(--event-sheet-condition); }
.trace-list li[data-state="failed"],
.trace-list li[data-state="unsupported"] { border-color: var(--event-sheet-action); }
.trace-list pre { grid-column: 1 / -1; }

.debug-section li small { color: var(--event-sheet-muted); }
.debug-empty { margin: 0.6rem 0 0; color: var(--event-sheet-muted); font-size: 0.72rem; }

.source-editor {
  display: block;
  margin: 0.6rem 0 0.35rem;
  color: var(--event-sheet-muted);
  font-size: 0.7rem;
}

.source-editor-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 34rem;
  padding: 0.65rem;
  border: 1px solid #bdc9c3;
  border-radius: 0;
  color: var(--event-sheet-ink);
  background: #eff2ee;
  font-family: var(--event-sheet-mono);
  font-size: 0.68rem;
  line-height: 1.5;
  resize: vertical;
}

.source-editor-input:focus-visible {
  outline: 2px solid var(--event-sheet-condition);
  outline-offset: 2px;
}

.debug-disclosures { display: grid; gap: 0.65rem; }

.workbench-footer {
  display: flex;
  max-width: 76rem;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  padding: 0.9rem 1rem 1.4rem;
  margin: 0 auto;
  border-top: 1px solid #bdc9c3;
  color: #58676a;
  font-family: var(--event-sheet-mono);
  font-size: 0.68rem;
}

@media (max-width: 36rem) {
  .workbench-context {
    gap: 0.45rem;
    font-size: 0.58rem;
  }

  .workbench-footer {
    flex-direction: column;
  }

  .stream-panel {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.85rem;
    margin-inline: 1rem;
  }

  .debug-workbench { margin-inline: 1rem; }
  .debug-heading,
  .debug-state-grid { flex-direction: column; }
  .debug-state-grid > section { width: 100%; }
}

@media (max-width: 58rem) {
  .split-workspace { grid-template-columns: minmax(0, 1fr); }
  .source-editor-input { min-height: 22rem; }
}
</style>
