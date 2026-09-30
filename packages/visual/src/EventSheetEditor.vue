<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, toRaw, watch } from 'vue'
import type { Action, Condition, Diagnostic, Event, EventDocument, EventNode, EventSheetNode, Expression, VariableNode } from '@project/schema'
import { CommandHistory, type EditorCommand } from './commands.js'
import EventBlock from './EventBlock.vue'

const props = withDefaults(defineProps<{
  document: EventDocument
  diagnostics?: readonly Diagnostic[]
  sheetId?: string
  readonly?: boolean
}>(), {
  diagnostics: () => [],
  sheetId: '',
  readonly: true,
})

const emit = defineEmits<{
  'update:document': [document: EventDocument]
  'selection-change': [eventId: string | undefined]
}>()

const documentState = shallowRef(toRaw(props.document))
const history = shallowRef(new CommandHistory(documentState.value))
const selectedEventId = shallowRef('')
const commandError = shallowRef('')
const canUndo = shallowRef(false)
const canRedo = shallowRef(false)
const diagnosticTargetId = shallowRef('')
const editorRoot = ref<HTMLElement>()

watch(() => props.document, (incoming) => {
  const next = toRaw(incoming)
  if (next === documentState.value) return
  documentState.value = next
  history.value = new CommandHistory(next)
  canUndo.value = false
  canRedo.value = false
  commandError.value = ''
  if (selectedEventId.value && !findEvent(next, selectedEventId.value)) setSelectedEventId(undefined)
})

const selectedSheet = computed(() =>
  documentState.value.sheets.find((sheet) => sheet.id === props.sheetId) ?? documentState.value.sheets[0],
)
const sheet = computed(() => {
  const selected = selectedSheet.value
  return selected && !isRecoverySheet(selected) ? selected : undefined
})
const sheetRecovery = computed(() => {
  const selected = selectedSheet.value
  return selected && isRecoverySheet(selected) ? selected : undefined
})
const counts = computed(() => countNodes(sheet.value?.events ?? []))
const variables = computed(() => [
  ...documentState.value.variables,
  ...(sheet.value?.variables ?? []),
])

function publishHistory(): void {
  documentState.value = history.value.document
  canUndo.value = history.value.canUndo
  canRedo.value = history.value.canRedo
  emit('update:document', documentState.value)
  commandError.value = ''
  if (selectedEventId.value && !findEvent(documentState.value, selectedEventId.value)) setSelectedEventId(undefined)
}

function setSelectedEventId(eventId: string | undefined): void {
  const next = eventId ?? ''
  if (next === selectedEventId.value) return
  selectedEventId.value = next
  emit('selection-change', next || undefined)
}

function runCommand(command: EditorCommand): void {
  if (props.readonly) return
  try {
    history.value.execute(command)
    publishHistory()
  } catch (error) {
    commandError.value = error instanceof Error ? error.message : String(error)
  }
}

function undo(): void {
  if (props.readonly || !history.value.canUndo) return
  history.value.undo()
  publishHistory()
}

function redo(): void {
  if (props.readonly || !history.value.canRedo) return
  history.value.redo()
  publishHistory()
}

function onEditorKeydown(event: KeyboardEvent): void {
  if (props.readonly || isTextInput(event.target)) return

  const key = event.key.toLowerCase()
  const commandKey = event.ctrlKey || event.metaKey
  if (commandKey && key === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if (commandKey && key === 'y') {
    event.preventDefault()
    redo()
    return
  }
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    if (moveSelectedEvent(event.key === 'ArrowUp' ? -1 : 1)) event.preventDefault()
    return
  }
  if (!commandKey && !event.altKey && event.key === 'Delete' && selectedEventId.value) {
    event.preventDefault()
    runCommand({ type: 'remove-event', eventId: selectedEventId.value })
    return
  }
  if (event.key === 'Escape' && selectedEventId.value) {
    event.preventDefault()
    setSelectedEventId(undefined)
  }
}

function moveSelectedEvent(direction: -1 | 1): boolean {
  const eventId = selectedEventId.value
  const location = eventId ? findEventLocation(documentState.value, eventId) : undefined
  if (!eventId || !location) return false

  const parent = location.parentEventId ? findEvent(documentState.value, location.parentEventId) : undefined
  const targetSheet = documentState.value.sheets.find((candidate) => candidate.id === location.sheetId)
  const siblings = location.parentEventId
    ? parent?.subEvents ?? []
    : targetSheet && 'name' in targetSheet ? targetSheet.events : []
  const index = location.index + direction
  if (index < 0 || index >= siblings.length) return false
  runCommand({
    type: 'move-event',
    eventId,
    targetSheetId: location.sheetId,
    targetParentEventId: location.parentEventId,
    index,
  })
  return true
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

function createId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}

function addEvent(parentEventId?: string): void {
  const targetSheet = sheet.value
  if (!targetSheet) return
  const event: Event = { type: 'event', id: createId('event'), label: 'New event', conditions: [], actions: [] }
  runCommand({ type: 'add-event', sheetId: targetSheet.id, event, parentEventId })
  setSelectedEventId(event.id)
}

function addAce(eventId: string, kind: 'condition' | 'action'): void {
  if (kind === 'condition') {
    const condition: Condition = { type: 'condition', id: createId('condition'), operation: 'custom.condition', parameters: [] }
    runCommand({ type: 'add-condition', eventId, condition })
  } else {
    const action: Action = { type: 'action', id: createId('action'), operation: 'custom.action', parameters: [] }
    runCommand({ type: 'add-action', eventId, action })
  }
}

function removeAce(eventId: string, aceId: string, kind: 'condition' | 'action'): void {
  if (kind === 'condition') runCommand({ type: 'remove-condition', eventId, conditionId: aceId })
  else runCommand({ type: 'remove-action', eventId, actionId: aceId })
}

function moveAce(eventId: string, aceId: string, kind: 'condition' | 'action', toIndex: number): void {
  if (kind === 'condition') runCommand({ type: 'move-condition', eventId, conditionId: aceId, toIndex })
  else runCommand({ type: 'move-action', eventId, actionId: aceId, toIndex })
}

function updateOperation(eventId: string, aceId: string, kind: 'condition' | 'action', operation: string): void {
  if (kind === 'condition') runCommand({ type: 'update-condition-operation', eventId, conditionId: aceId, operation })
  else runCommand({ type: 'update-action-operation', eventId, actionId: aceId, operation })
}

function updateParameters(eventId: string, aceId: string, kind: 'condition' | 'action', parameters: Expression[]): void {
  if (kind === 'condition') runCommand({ type: 'update-condition-parameters', eventId, conditionId: aceId, parameters })
  else runCommand({ type: 'update-action-parameters', eventId, actionId: aceId, parameters })
}

function dropEvent(command: Extract<EditorCommand, { type: 'move-event' }>): void {
  const source = findEventLocation(documentState.value, command.eventId)
  if (source && source.sheetId === command.targetSheetId && source.parentEventId === command.targetParentEventId && source.index < (command.index ?? 0)) {
    runCommand({ ...command, index: (command.index ?? 0) - 1 })
  } else {
    runCommand(command)
  }
}

function nestSelected(targetEventId: string): void {
  if (!selectedEventId.value || selectedEventId.value === targetEventId || !sheet.value) return
  runCommand({
    type: 'move-event',
    eventId: selectedEventId.value,
    targetSheetId: sheet.value.id,
    targetParentEventId: targetEventId,
  })
}

function dropOnSheet(dragEvent: DragEvent): void {
  dragEvent.preventDefault()
  if (!sheet.value) return
  const eventId = dragEvent.dataTransfer?.getData('text/event-sheet-event-id')
  if (!eventId) return
  dropEvent({ type: 'move-event', eventId, targetSheetId: sheet.value.id, index: sheet.value.events.length })
}

function findEvent(document: EventDocument, eventId: string): Event | undefined {
  return findEventLocation(document, eventId)?.event
}

function hasRenderedNode(nodeId: string): boolean {
  return findDiagnosticTarget(sheet.value?.events ?? [], nodeId) !== undefined
}

async function focusDiagnosticNode(nodeId: string): Promise<void> {
  const target = findDiagnosticTarget(sheet.value?.events ?? [], nodeId)
  if (!target) return
  setSelectedEventId(target.eventId)
  diagnosticTargetId.value = nodeId
  await nextTick()
  const elements = editorRoot.value?.querySelectorAll<HTMLElement>('[data-node-id]') ?? []
  const element = [...elements].find((candidate) => candidate.dataset.nodeId === nodeId)
  element?.scrollIntoView?.({ block: 'center' })
  element?.focus()
}

function findDiagnosticTarget(
  nodes: readonly EventNode[],
  nodeId: string,
  parentEventId?: string,
): { eventId?: string } | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return { ...(node.type === 'event' ? { eventId: node.id } : parentEventId ? { eventId: parentEventId } : {}) }
    }
    if (node.type !== 'event') continue
    if (node.conditions.some((condition) => condition.id === nodeId)
      || node.actions.some((action) => action.id === nodeId)) return { eventId: node.id }
    const nested = node.subEvents ? findDiagnosticTarget(node.subEvents, nodeId, node.id) : undefined
    if (nested) return nested
  }
  return undefined
}

function findEventLocation(document: EventDocument, eventId: string): { event: Event; sheetId: string; parentEventId?: string; index: number } | undefined {
  function visit(nodes: readonly EventNode[], sheetId: string, parentEventId?: string): ReturnType<typeof findEventLocation> {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]
      if (!node || node.type !== 'event') continue
      if (node.id === eventId) return { event: node, sheetId, ...(parentEventId ? { parentEventId } : {}), index }
      const nested = node.subEvents ? visit(node.subEvents, sheetId, node.id) : undefined
      if (nested) return nested
    }
    return undefined
  }
  for (const candidate of document.sheets) {
    if ('name' in candidate) {
      const located = visit(candidate.events, candidate.id)
      if (located) return located
    }
  }
  return undefined
}

function isRecoverySheet(node: EventSheetNode): node is Exclude<EventSheetNode, { name: string }> {
  return 'type' in node
}

function countNodes(nodes: readonly EventNode[]): { events: number; conditions: number; actions: number } {
  const result = { events: 0, conditions: 0, actions: 0 }
  for (const node of nodes) {
    result.events += 1
    if (node.type !== 'event') continue
    result.conditions += node.conditions.length
    result.actions += node.actions.length
    if (node.subEvents) {
      const nested = countNodes(node.subEvents)
      result.events += nested.events
      result.conditions += nested.conditions
      result.actions += nested.actions
    }
  }
  return result
}

function variableName(variable: VariableNode): string {
  if (!('type' in variable)) return variable.name
  if (variable.type === 'incomplete') return variable.sourceText || 'Incomplete variable'
  if (variable.type === 'invalid') return variable.diagnostic.message
  return 'Unknown variable'
}

function variableType(variable: VariableNode): string {
  return 'type' in variable ? capitalize(variable.type) : variable.dataType
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}
</script>

<template>
  <section ref="editorRoot" class="event-sheet-editor" aria-label="Event sheet editor" :data-mode="readonly ? 'readonly' : 'editing'" @keydown="onEditorKeydown">
    <header class="sheet-intro">
      <p class="sheet-kicker">
        {{ documentState.engine.id }} <span>/</span> event sheet
      </p>
      <div class="sheet-title-row">
        <h1>{{ sheet?.name ?? (sheetRecovery ? 'Recovering sheet' : 'Event sheets') }}</h1>
        <span class="sheet-mode">{{ readonly ? 'READ ONLY' : 'EDITING' }}</span>
      </div>
      <p class="sheet-source">
        Source
        <code>{{ sheet?.sourceLocation?.sourceId ?? 'event document' }}</code>
      </p>
      <dl class="sheet-counts" aria-label="Sheet contents">
        <div><dt>Events</dt><dd>{{ counts.events }}</dd></div>
        <div><dt>Conditions</dt><dd>{{ counts.conditions }}</dd></div>
        <div><dt>Actions</dt><dd>{{ counts.actions }}</dd></div>
      </dl>
    </header>

    <div v-if="!readonly && sheet" class="editor-toolbar" aria-label="Editor commands">
      <button type="button" @click="addEvent()">
        + Add event
      </button>
      <button type="button" aria-label="Undo" aria-keyshortcuts="Control+Z Meta+Z" :disabled="!canUndo" @click="undo">
        Undo
      </button>
      <button type="button" aria-label="Redo" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" :disabled="!canRedo" @click="redo">
        Redo
      </button>
      <span v-if="selectedEventId" class="selection-label">Selected: {{ selectedEventId }}</span>
      <span class="keyboard-help">Ctrl/⌘+Z undo · Shift redo · Alt+↑/↓ move · Delete remove · Esc deselect</span>
    </div>
    <p v-if="commandError" class="command-error" role="alert">
      {{ commandError }}
    </p>

    <section class="sheet-content" aria-label="Event logic" @dragover.prevent="!readonly" @drop="!readonly && dropOnSheet($event)">
      <div v-if="sheetRecovery" class="sheet-recovery" :data-state="sheetRecovery.type">
        <span>{{ sheetRecovery.type }} sheet</span>
        <p v-if="sheetRecovery.type === 'incomplete' && sheetRecovery.expected?.length">
          Waiting for {{ sheetRecovery.expected.join(', ') }}.
        </p>
        <p v-else-if="sheetRecovery.type === 'invalid'">
          {{ sheetRecovery.diagnostic.message }}
        </p>
        <code v-else-if="sheetRecovery.type === 'unknown'">{{ JSON.stringify(sheetRecovery.raw) }}</code>
      </div>
      <ol v-else-if="sheet?.events.length" class="event-list" aria-label="Events">
        <li v-for="event in sheet.events" :key="event.id">
          <EventBlock
            :node="event"
            :siblings="sheet.events"
            :sheet-id="sheet.id"
            :editable="!readonly"
            :selected-event-id="selectedEventId"
            :diagnostic-target-id="diagnosticTargetId"
            @select="setSelectedEventId($event)"
            @remove-event="runCommand({ type: 'remove-event', eventId: $event })"
            @add-child="addEvent($event)"
            @move-event="runCommand({ type: 'move-event', ...$event })"
            @drop-event="dropEvent({ type: 'move-event', ...$event })"
            @nest-selected="nestSelected"
            @add-ace="addAce($event.eventId, $event.kind)"
            @remove-ace="removeAce($event.eventId, $event.aceId, $event.kind)"
            @move-ace="moveAce($event.eventId, $event.aceId, $event.kind, $event.toIndex)"
            @update-operation="updateOperation($event.eventId, $event.aceId, $event.kind, $event.operation)"
            @update-parameters="updateParameters($event.eventId, $event.aceId, $event.kind, $event.parameters)"
          />
        </li>
      </ol>
      <p v-else-if="sheet" class="empty-events" role="status">
        No events on this sheet. <button v-if="!readonly" type="button" @click="addEvent()">
          Add the first event
        </button>
      </p>
      <p v-else class="empty-events" role="status">
        This document does not contain an event sheet yet.
      </p>
    </section>

    <section class="supporting-sections" aria-label="Document details">
      <section class="detail-section" aria-label="Variables">
        <div class="detail-heading">
          <h2>Variables</h2>
          <span>{{ variables.length }}</span>
        </div>
        <ul v-if="variables.length" class="variable-list">
          <li v-for="variable in variables" :key="variable.id">
            <code>{{ variableName(variable) }}</code>
            <span>{{ variableType(variable) }}</span>
          </li>
        </ul>
        <p v-else class="quiet-state">
          No declared variables.
        </p>
      </section>

      <section class="detail-section diagnostics" aria-label="Diagnostics">
        <div class="detail-heading">
          <h2>Diagnostics</h2>
          <span>{{ diagnostics.length }}</span>
        </div>
        <ul v-if="diagnostics.length" class="diagnostic-list">
          <li v-for="(item, index) in diagnostics" :key="`${item.code}-${item.nodeId ?? item.sourceLocation?.offsetStart ?? 'global'}-${index}`" :data-severity="item.severity">
            <span class="diagnostic-severity">{{ item.severity }}</span>
            <div>
              <button
                v-if="item.nodeId && hasRenderedNode(item.nodeId)"
                type="button"
                class="diagnostic-target"
                :aria-label="`Focus node ${item.nodeId}`"
                @click="focusDiagnosticNode(item.nodeId)"
              >
                {{ item.message }}
              </button>
              <strong v-else>{{ item.message }}</strong>
              <code>{{ item.code }}</code>
            </div>
          </li>
        </ul>
        <p v-else class="quiet-state" role="status">
          No diagnostics for this document.
        </p>
      </section>
    </section>
  </section>
</template>

<style scoped>
.event-sheet-editor {
  width: min(100%, 72rem);
  margin: 0 auto;
  padding: clamp(1rem, 3vw, 2rem);
  background: var(--event-sheet-canvas);
}

.sheet-intro {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 0.25rem 2rem;
  padding: 0 0 1.25rem;
  border-bottom: 1px solid var(--event-sheet-ink);
}

.sheet-kicker,
.sheet-source,
.sheet-mode,
.sheet-counts dt,
.sheet-counts dd,
.detail-heading > span {
  margin: 0;
  color: var(--event-sheet-muted);
  font-family: var(--event-sheet-mono);
  font-size: 0.72rem;
}

.sheet-kicker {
  grid-column: 1 / -1;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.sheet-kicker span {
  padding: 0 0.35rem;
  color: var(--event-sheet-action);
}

.sheet-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.65rem 1rem;
}

.sheet-title-row h1 {
  margin: 0;
  color: var(--event-sheet-ink);
  font-family: var(--event-sheet-display);
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  font-weight: 650;
  letter-spacing: -0.045em;
  line-height: 1.1;
}

.sheet-mode {
  padding: 0.2rem 0.4rem;
  border: 1px solid var(--event-sheet-rule);
  color: var(--event-sheet-condition);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.sheet-source {
  grid-column: 1;
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
}

.sheet-source code,
.variable-list code,
.diagnostic-list code {
  color: var(--event-sheet-ink);
  font-family: var(--event-sheet-mono);
  font-size: 0.72rem;
  overflow-wrap: anywhere;
}

.sheet-counts {
  display: flex;
  gap: clamp(0.65rem, 2vw, 1.4rem);
  padding: 0;
  margin: 0;
}

.sheet-counts div {
  display: grid;
  grid-template-columns: auto auto;
  gap: 0.5rem;
  align-items: baseline;
}

.sheet-counts dd {
  color: var(--event-sheet-ink);
  font-size: 0.9rem;
  font-weight: 700;
}

.sheet-content {
  padding: 1.25rem 0;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--event-sheet-rule);
}

.editor-toolbar button,
.empty-events button {
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--event-sheet-ink);
  background: var(--event-sheet-paper);
  color: var(--event-sheet-ink);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.editor-toolbar button:disabled { opacity: 0.45; cursor: default; }
.selection-label { color: var(--event-sheet-muted); font-family: var(--event-sheet-mono); font-size: 0.7rem; }
.keyboard-help { color: var(--event-sheet-muted); font-family: var(--event-sheet-mono); font-size: 0.65rem; }
.command-error { margin: 0.5rem 0; color: var(--event-sheet-invalid); font-size: 0.8rem; }

.event-list {
  display: grid;
  gap: 0.75rem;
  padding: 0 0 0 0.75rem;
  margin: 0;
  border-left: 1px solid var(--event-sheet-condition);
  list-style: none;
}

.empty-events,
.quiet-state {
  margin: 0;
  color: var(--event-sheet-muted);
  font-size: 0.85rem;
}

.sheet-recovery {
  padding: 0.85rem;
  border: 1px dashed var(--event-sheet-warning);
  background: var(--event-sheet-paper);
  color: var(--event-sheet-warning);
  font-family: var(--event-sheet-mono);
  font-size: 0.8rem;
  text-transform: uppercase;
}

.sheet-recovery[data-state="invalid"] {
  border-color: var(--event-sheet-invalid);
  color: var(--event-sheet-invalid);
}

.sheet-recovery p,
.sheet-recovery code {
  display: block;
  margin: 0.35rem 0 0;
  color: var(--event-sheet-muted);
  font-family: var(--event-sheet-body);
  font-size: 0.8rem;
  text-transform: none;
}

.supporting-sections {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  border-top: 1px solid var(--event-sheet-rule);
}

.detail-section {
  min-width: 0;
  padding: 0.9rem 1rem 0.75rem 0;
}

.detail-section + .detail-section {
  padding-right: 0;
  padding-left: 1rem;
  border-left: 1px solid var(--event-sheet-rule);
}

.detail-heading {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  margin-bottom: 0.55rem;
}

.detail-heading h2 {
  margin: 0;
  color: var(--event-sheet-ink);
  font-family: var(--event-sheet-display);
  font-size: 0.95rem;
  font-weight: 650;
}

.variable-list,
.diagnostic-list {
  display: grid;
  gap: 0.4rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.variable-list li {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 0;
  border-top: 1px solid var(--event-sheet-rule);
}

.variable-list li > span {
  color: var(--event-sheet-muted);
  font-family: var(--event-sheet-mono);
  font-size: 0.7rem;
}

.diagnostic-list li {
  display: grid;
  grid-template-columns: 4.2rem minmax(0, 1fr);
  gap: 0.5rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--event-sheet-rule);
}

.diagnostic-severity {
  color: var(--event-sheet-warning);
  font-family: var(--event-sheet-mono);
  font-size: 0.7rem;
  text-transform: uppercase;
}

.diagnostic-list [data-severity="error"] .diagnostic-severity {
  color: var(--event-sheet-invalid);
}

.diagnostic-list strong {
  display: block;
  font-size: 0.8rem;
  font-weight: 550;
  overflow-wrap: anywhere;
}

.diagnostic-target {
  display: block;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  text-decoration: underline dotted;
  cursor: pointer;
}

.diagnostic-target:focus-visible {
  outline: 2px solid var(--event-sheet-action);
  outline-offset: 2px;
}

.diagnostic-list code {
  display: block;
  margin-top: 0.15rem;
  color: var(--event-sheet-muted);
  font-size: 0.65rem;
}

@media (max-width: 42rem) {
  .sheet-intro {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.55rem;
  }

  .sheet-source,
  .sheet-counts {
    grid-column: 1;
  }

  .sheet-counts {
    justify-content: flex-start;
    padding-top: 0.45rem;
  }

  .supporting-sections {
    grid-template-columns: minmax(0, 1fr);
  }

  .detail-section + .detail-section {
    padding-left: 0;
    border-top: 1px solid var(--event-sheet-rule);
    border-left: 0;
  }
}
</style>

<style src="./style.css"></style>
