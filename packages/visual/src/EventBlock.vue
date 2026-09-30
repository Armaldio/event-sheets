<script setup lang="ts">
import { computed } from 'vue'
import type { EventNode, Expression } from '@project/schema'
import AceLine from './AceLine.vue'

defineOptions({ name: 'EventBlock' })

const props = withDefaults(defineProps<{
  node: EventNode
  depth?: number
  siblings: readonly EventNode[]
  parentEventId?: string | undefined
  sheetId: string
  editable?: boolean
  selectedEventId?: string
  diagnosticTargetId?: string
}>(), { depth: 0, parentEventId: undefined, editable: false, selectedEventId: '', diagnosticTargetId: '' })

const emit = defineEmits<{
  select: [eventId: string]
  removeEvent: [eventId: string]
  addChild: [parentEventId: string]
  moveEvent: [payload: { eventId: string; targetSheetId: string; targetParentEventId?: string | undefined; index: number }]
  dropEvent: [payload: { eventId: string; targetSheetId: string; targetParentEventId?: string | undefined; index: number }]
  nestSelected: [targetEventId: string]
  addAce: [payload: { eventId: string; kind: 'condition' | 'action' }]
  removeAce: [payload: { eventId: string; aceId: string; kind: 'condition' | 'action' }]
  moveAce: [payload: { eventId: string; aceId: string; kind: 'condition' | 'action'; toIndex: number }]
  updateOperation: [payload: { eventId: string; aceId: string; kind: 'condition' | 'action'; operation: string }]
  updateParameters: [payload: { eventId: string; aceId: string; kind: 'condition' | 'action'; parameters: Expression[] }]
}>()

const event = computed(() => props.node.type === 'event' ? props.node : undefined)
const functionSignature = computed(() => {
  if (event.value?.eventKind !== 'function') return ''
  const parameters = event.value.functionParameters?.map(({ name, dataType }) => `${name}: ${dataType}`).join(', ') ?? ''
  const signature = `${parameters || 'no parameters'} → ${event.value.functionReturnType ?? 'None'}`
  return event.value.functionCopyPicked === true ? `${signature} · copies picked` : signature
})
const localVariables = computed(() => event.value?.variables?.map((variable) => {
  if ('type' in variable) return `${variable.id}: unavailable`
  return `${variable.name}: ${variable.dataType}`
}) ?? [])
const recoveryTitle = computed(() => {
  if (props.node.type === 'event') return ''
  if (props.node.type === 'unknown') return eventName(props.node.raw)
  if (props.node.type === 'invalid') return props.node.diagnostic.message
  return props.node.expected?.length ? `Waiting for ${props.node.expected.join(', ')}` : 'Event is incomplete'
})
const siblingIndex = computed(() => props.siblings.findIndex((item) => item.id === props.node.id))

function dropOnEvent(dragEvent: DragEvent): void {
  dragEvent.preventDefault()
  const draggedId = dragEvent.dataTransfer?.getData('text/event-sheet-event-id')
  if (!props.editable || !draggedId || draggedId === props.node.id) return
  const bounds = (dragEvent.currentTarget as HTMLElement).getBoundingClientRect()
  const after = dragEvent.clientY > bounds.top + bounds.height / 2
  emit('dropEvent', {
    eventId: draggedId,
    targetSheetId: props.sheetId,
    targetParentEventId: props.parentEventId,
    index: siblingIndex.value + (after ? 1 : 0),
  })
}

function startDrag(dragEvent: DragEvent): void {
  if (!props.editable || !dragEvent.dataTransfer) return
  dragEvent.dataTransfer.effectAllowed = 'move'
  dragEvent.dataTransfer.setData('text/event-sheet-event-id', props.node.id)
}

function moveAce(kind: 'condition' | 'action', aceId: string, direction: -1 | 1): void {
  const rows = kind === 'condition' ? event.value?.conditions : event.value?.actions
  if (!rows || !event.value) return
  const index = rows.findIndex((row) => row.id === aceId)
  emit('moveAce', { eventId: event.value.id, aceId, kind, toIndex: index + direction })
}

function updateAceOperation(aceId: string, kind: 'condition' | 'action', operation: string): void {
  if (event.value) emit('updateOperation', { eventId: event.value.id, aceId, kind, operation })
}

function updateAceParameters(aceId: string, kind: 'condition' | 'action', parameters: Expression[]): void {
  if (event.value) emit('updateParameters', { eventId: event.value.id, aceId, kind, parameters })
}

function eventName(raw: unknown): string {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>
    if (typeof record.eventType === 'string') return `Unknown ${record.eventType} event`
  }
  return 'Unknown event'
}
</script>

<template>
  <article
    :class="{
      'event-block': event !== undefined,
      'event-recovery': event === undefined,
      'event-block--function': event?.eventKind === 'function',
      'event-block--comment': event?.eventKind === 'comment',
    }"
    :data-node-id="node.id"
    :data-selected="event !== undefined && selectedEventId === event.id"
    :data-state="event ? undefined : node.type"
    :data-diagnostic-target="diagnosticTargetId === node.id"
    tabindex="-1"
    :style="event ? { '--event-depth': Math.min(depth, 4) } : undefined"
    :draggable="editable"
    @dragstart.stop="startDrag"
    @dragover.prevent
    @drop.stop="dropOnEvent"
  >
    <template v-if="event">
      <header class="event-heading">
        <span class="event-mark">{{ event.eventKind === 'function' ? 'FUNCTION' : event.eventKind === 'group' ? 'GROUP' : event.eventKind === 'comment' ? 'COMMENT' : 'EVENT' }}</span>
        <button v-if="editable" class="event-select" type="button" :aria-pressed="selectedEventId === event.id" @click="emit('select', event.id)">
          {{ event.eventKind === 'comment' ? event.comment : event.label || 'Event' }}
        </button>
        <h2 v-else>
          {{ event.eventKind === 'comment' ? event.comment : event.label || 'Event' }}
        </h2>
        <span v-if="functionSignature" class="function-signature">{{ functionSignature }}</span>
        <span v-if="event.eventKind !== 'comment'" class="event-count">{{ event.conditions.length }} conditions · {{ event.actions.length }} actions</span>
        <span v-if="event.enabled === false" class="event-disabled">Disabled</span>
        <div v-if="editable" class="event-controls" :aria-label="`Edit ${event.label || 'event'}`">
          <button type="button" :disabled="siblingIndex <= 0" :aria-label="`Move ${event.label || 'event'} up`" @click="emit('moveEvent', { eventId: event.id, targetSheetId: sheetId, targetParentEventId: parentEventId, index: siblingIndex - 1 })">
            ↑
          </button>
          <button type="button" :disabled="siblingIndex < 0 || siblingIndex >= siblings.length - 1" :aria-label="`Move ${event.label || 'event'} down`" @click="emit('moveEvent', { eventId: event.id, targetSheetId: sheetId, targetParentEventId: parentEventId, index: siblingIndex + 1 })">
            ↓
          </button>
          <button v-if="event.eventKind !== 'comment'" type="button" :aria-label="`Add sub-event to ${event.label || 'event'}`" @click="emit('addChild', event.id)">
            + child
          </button>
          <button v-if="event.eventKind !== 'comment' && selectedEventId && selectedEventId !== event.id" type="button" :aria-label="`Nest selected event under ${event.label || 'event'}`" @click="emit('nestSelected', event.id)">
            Nest selected here
          </button>
          <button type="button" :aria-label="`Remove ${event.label || 'event'}`" @click="emit('removeEvent', event.id)">
            Remove
          </button>
        </div>
      </header>

      <div v-if="localVariables.length" class="event-local-variables" aria-label="Local variables">
        <span class="event-local-variables__label">LOCAL</span>
        <code v-for="(variable, index) in localVariables" :key="`${variable}-${index}`">{{ variable }}</code>
      </div>

      <div v-if="event.eventKind !== 'comment'" class="event-lanes">
        <section class="event-lane event-lane--conditions" aria-label="Conditions">
          <h3>Conditions</h3>
          <ol v-if="event.conditions.length" class="ace-list">
            <li v-for="(condition, index) in event.conditions" :key="condition.id">
              <AceLine
                :node="condition"
                kind="condition"
                :editable="editable"
                :diagnostic-target-id="diagnosticTargetId"
                :can-move-up="index > 0"
                :can-move-down="index < event.conditions.length - 1"
                @remove="emit('removeAce', { eventId: event.id, aceId: condition.id, kind: 'condition' })"
                @move-up="moveAce('condition', condition.id, -1)"
                @move-down="moveAce('condition', condition.id, 1)"
                @update-operation="(operation) => updateAceOperation(condition.id, 'condition', operation)"
                @update-parameters="(parameters) => updateAceParameters(condition.id, 'condition', parameters)"
              />
            </li>
          </ol>
          <p v-else class="lane-empty">
            Runs without a condition check.
          </p>
          <button v-if="editable" type="button" class="add-ace" aria-label="Add condition" @click="emit('addAce', { eventId: event.id, kind: 'condition' })">
            + Add condition
          </button>
        </section>

        <section class="event-lane event-lane--actions" aria-label="Actions">
          <h3>Actions</h3>
          <ol v-if="event.actions.length" class="ace-list">
            <li v-for="(action, index) in event.actions" :key="action.id">
              <AceLine
                :node="action"
                kind="action"
                :editable="editable"
                :diagnostic-target-id="diagnosticTargetId"
                :can-move-up="index > 0"
                :can-move-down="index < event.actions.length - 1"
                @remove="emit('removeAce', { eventId: event.id, aceId: action.id, kind: 'action' })"
                @move-up="moveAce('action', action.id, -1)"
                @move-down="moveAce('action', action.id, 1)"
                @update-operation="(operation) => updateAceOperation(action.id, 'action', operation)"
                @update-parameters="(parameters) => updateAceParameters(action.id, 'action', parameters)"
              />
            </li>
          </ol>
          <p v-else class="lane-empty">
            No actions in this event.
          </p>
          <button v-if="editable" type="button" class="add-ace" aria-label="Add action" @click="emit('addAce', { eventId: event.id, kind: 'action' })">
            + Add action
          </button>
        </section>
      </div>

      <div v-if="event.subEvents?.length" class="event-children" aria-label="Sub-events">
        <EventBlock
          v-for="child in event.subEvents"
          :key="child.id"
          :node="child"
          :depth="depth + 1"
          :siblings="event.subEvents"
          :parent-event-id="event.id"
          :sheet-id="sheetId"
          :editable="editable"
          :selected-event-id="selectedEventId"
          :diagnostic-target-id="diagnosticTargetId"
          @select="emit('select', $event)"
          @remove-event="emit('removeEvent', $event)"
          @add-child="emit('addChild', $event)"
          @move-event="emit('moveEvent', $event)"
          @drop-event="emit('dropEvent', $event)"
          @nest-selected="emit('nestSelected', $event)"
          @add-ace="emit('addAce', $event)"
          @remove-ace="emit('removeAce', $event)"
          @move-ace="emit('moveAce', $event)"
          @update-operation="emit('updateOperation', $event)"
          @update-parameters="emit('updateParameters', $event)"
        />
      </div>
    </template>
    <template v-else>
      <span class="recovery-mark">{{ node.type }}</span>
      <div>
        <h2>{{ recoveryTitle }}</h2>
        <p v-if="node.type === 'incomplete' && node.sourceText">
          {{ node.sourceText }}
        </p>
        <code v-else-if="node.type === 'unknown'">{{ JSON.stringify(node.raw) }}</code>
        <span v-else-if="node.type === 'incomplete' && node.expected?.length" class="expected-fields">Expected: {{ node.expected.join(', ') }}</span>
        <button v-if="editable" type="button" class="recovery-remove" aria-label="Remove event" @click="emit('removeEvent', node.id)">
          Remove event
        </button>
      </div>
    </template>
  </article>
</template>

<style scoped>
.event-block {
  position: relative;
  min-width: 0;
  margin-left: calc(var(--event-depth) * 1.25rem);
  border: 1px solid var(--event-sheet-rule);
  background: var(--event-sheet-paper);
}

.event-block::before {
  position: absolute;
  top: 1.25rem;
  left: -0.7rem;
  width: 0.65rem;
  border-top: 1px solid var(--event-sheet-condition);
  content: '';
}

.event-block[data-selected="true"] {
  outline: 2px solid var(--event-sheet-action);
  outline-offset: 2px;
}

.event-block--function { border-color: var(--event-sheet-action); }
.event-block--function .event-mark { color: var(--event-sheet-action); }
.event-block--comment { border-style: dashed; }
.event-block--comment .event-mark { color: var(--event-sheet-muted); }

.event-block[data-diagnostic-target="true"],
.event-recovery[data-diagnostic-target="true"] {
  outline: 2px solid var(--event-sheet-warning);
  outline-offset: 2px;
}

.event-heading {
  display: flex;
  min-height: 3.1rem;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem 0.8rem;
  padding: 0.55rem 0.85rem;
  border-bottom: 1px solid var(--event-sheet-rule);
}

.event-mark,
.event-count,
.event-disabled,
.function-signature {
  color: var(--event-sheet-muted);
  font-family: var(--event-sheet-mono);
  font-size: 0.68rem;
}

.function-signature { color: var(--event-sheet-muted); }

.event-mark {
  color: var(--event-sheet-condition);
  font-weight: 700;
  letter-spacing: 0.08em;
}

.event-heading h2,
.event-select {
  margin: 0;
  color: var(--event-sheet-ink);
  font-family: var(--event-sheet-display);
  font-size: 1rem;
  font-weight: 650;
}

.event-select {
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.event-count { margin-left: auto; }
.event-disabled { padding: 0.1rem 0.35rem; border: 1px solid var(--event-sheet-rule); }
.event-controls { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-left: auto; }
.event-local-variables { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; padding: 0.4rem 0.85rem; border-bottom: 1px solid var(--event-sheet-rule); }
.event-local-variables__label { color: var(--event-sheet-muted); font-family: var(--event-sheet-mono); font-size: 0.64rem; font-weight: 700; letter-spacing: 0.08em; }
.event-local-variables code { padding: 0.08rem 0.3rem; border: 1px solid var(--event-sheet-rule); color: var(--event-sheet-ink); font-family: var(--event-sheet-mono); font-size: 0.7rem; }

.event-controls button,
.add-ace {
  padding: 0.25rem 0.45rem;
  border: 1px solid var(--event-sheet-rule);
  background: var(--event-sheet-paper);
  color: var(--event-sheet-ink);
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
}

.event-controls button:disabled { opacity: 0.45; cursor: default; }
.add-ace { margin-top: 0.55rem; }
.event-lanes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.event-lane { min-width: 0; padding: 0.65rem 0.75rem 0.75rem; }
.event-lane + .event-lane { border-left: 1px solid var(--event-sheet-rule); }

.event-lane h3 {
  margin: 0 0 0.45rem;
  color: var(--event-sheet-muted);
  font-family: var(--event-sheet-mono);
  font-size: 0.66rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ace-list { display: grid; gap: 0.35rem; padding: 0; margin: 0; list-style: none; }
.lane-empty { margin: 0; color: var(--event-sheet-muted); font-size: 0.8rem; }
.event-children { display: grid; gap: 0.65rem; margin: 0 0.75rem 0.75rem 1.25rem; padding-left: 0.75rem; border-left: 1px solid var(--event-sheet-condition); }
.event-recovery { display: grid; grid-template-columns: 5.5rem minmax(0, 1fr); gap: 0.75rem; padding: 0.85rem; border: 1px dashed var(--event-sheet-warning); background: #f4f1e7; }
.event-recovery[data-state="invalid"] { border-color: var(--event-sheet-invalid); background: #f5e9e5; }
.recovery-mark, .expected-fields { color: var(--event-sheet-warning); font-family: var(--event-sheet-mono); font-size: 0.72rem; text-transform: uppercase; }
.event-recovery[data-state="invalid"] .recovery-mark { color: var(--event-sheet-invalid); }
.event-recovery p, .event-recovery code { display: block; margin: 0.35rem 0 0; color: var(--event-sheet-muted); font-size: 0.75rem; overflow-wrap: anywhere; }
.recovery-remove { margin-top: 0.5rem; padding: 0.25rem 0.4rem; border: 1px solid var(--event-sheet-rule); background: var(--event-sheet-paper); color: var(--event-sheet-ink); font: inherit; font-size: 0.7rem; cursor: pointer; }

@media (max-width: 42rem) {
  .event-lanes { grid-template-columns: minmax(0, 1fr); }
  .event-lane + .event-lane { border-top: 1px solid var(--event-sheet-rule); border-left: 0; }
  .event-count { width: 100%; margin-left: 0; }
  .event-children { margin-left: 0.65rem; }
}
</style>
