<script setup lang="ts">
import { computed } from 'vue'
import type { ActionNode, ConditionNode, Expression } from '@project/schema'
import { parseEditorExpression } from './expression-editor.js'

const props = defineProps<{
  node: ConditionNode | ActionNode
  kind: 'condition' | 'action'
  editable?: boolean
  canMoveUp?: boolean
  canMoveDown?: boolean
  diagnosticTargetId?: string
}>()

const emit = defineEmits<{
  remove: []
  moveUp: []
  moveDown: []
  updateOperation: [operation: string]
  updateParameters: [parameters: Expression[]]
}>()

const title = computed(() => {
  if (props.node.type === 'condition' || props.node.type === 'action') {
    return humanizeOperation(props.node.operation)
  }
  if (props.node.type === 'comment') return props.node.text
  if (props.node.type === 'unknown') return rawAceName(props.node.raw)
  if (props.node.type === 'invalid') return props.node.diagnostic.message
  return props.node.expected?.length ? `Waiting for ${props.node.expected.join(', ')}` : `Incomplete ${props.kind}`
})
const parameters = computed(() => {
  const node = props.node
  if (node.type !== 'condition' && node.type !== 'action') return []
  return node.parameters.map((expression, index) => ({
    id: node.parameterIds?.[index],
    expression,
    index,
  }))
})
const inverted = computed(() => props.node.type === 'condition' && props.node.inverted === true)
const recoveryLabel = computed(() =>
  props.node.type === 'condition' || props.node.type === 'action'
    ? ''
    : `${props.node.type === 'comment' ? 'Comment' : capitalize(props.node.type)} ${props.kind}`,
)

function expressionLabel(expression: Expression): string {
  if (expression.sourceText !== undefined) return expression.sourceText || '…'
  switch (expression.type) {
    case 'literal': return typeof expression.value === 'string' ? JSON.stringify(expression.value) : String(expression.value)
    case 'identifier': return expression.name
    case 'variable': return expression.name
    case 'property': return `${expressionLabel(expression.object)}${expression.computed ? `[${expression.property}]` : `.${expression.property}`}`
    case 'unary': return `${expression.operator}${expression.operator === 'not' ? ' ' : ''}${expressionLabel(expression.argument)}`
    case 'binary': return `${expressionLabel(expression.left)} ${expression.operator} ${expressionLabel(expression.right)}`
    case 'call': return `${expression.callee}(${expression.arguments.map(expressionLabel).join(', ')})`
    case 'conditional': return `${expressionLabel(expression.test)} ? ${expressionLabel(expression.whenTrue)} : ${expressionLabel(expression.whenFalse)}`
    case 'array': return `[${expression.elements.map(expressionLabel).join(', ')}]`
    case 'invalid': return expression.sourceText || 'Invalid expression'
    case 'incomplete': return expression.sourceText || 'Incomplete expression'
    case 'unknown': return expression.sourceText || 'Unknown expression'
  }
}

function updateParameter(index: number, value: string): void {
  const node = props.node
  if (node.type !== 'condition' && node.type !== 'action') return
  const parameters = node.parameters.slice()
  parameters[index] = parseEditorExpression(value)
  emit('updateParameters', parameters)
}

function addParameter(): void {
  const node = props.node
  if (node.type === 'condition' || node.type === 'action') {
    emit('updateParameters', [...node.parameters, { type: 'literal', value: '' }])
  }
}

function humanizeOperation(operation: string): string {
  const shortName = operation.split('.').at(-1) ?? operation
  return shortName.replaceAll('-', ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
}

function rawAceName(raw: unknown): string {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>
    if (typeof record.objectClass === 'string' && typeof record.id === 'string') return `${record.objectClass}.${record.id}`
    if (typeof record.id === 'string') return record.id
  }
  return `Unknown ${props.kind}`
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}
</script>

<template>
  <div
    class="ace-line"
    :class="`ace-line--${kind}`"
    :data-node-id="node.id"
    :data-state="node.type"
    :data-diagnostic-target="diagnosticTargetId === node.id"
    :aria-label="`${capitalize(kind)}: ${title}`"
    tabindex="-1"
  >
    <span class="ace-kind">{{ kind === 'condition' ? 'WHEN' : 'DO' }}</span>
    <div class="ace-body">
      <div class="ace-heading">
        <input
          v-if="editable && (node.type === 'condition' || node.type === 'action')"
          class="operation-input"
          :aria-label="`${kind} operation`"
          :value="node.operation"
          @change="emit('updateOperation', ($event.target as HTMLInputElement).value)"
        >
        <strong v-else>{{ title }}</strong>
        <span v-if="inverted" class="ace-flag">Inverted</span>
        <span v-if="recoveryLabel" class="ace-state">{{ recoveryLabel }}</span>
        <div v-if="editable" class="ace-controls">
          <button type="button" :disabled="!canMoveUp" :aria-label="`Move ${kind} up`" @click="emit('moveUp')">
            ↑
          </button>
          <button type="button" :disabled="!canMoveDown" :aria-label="`Move ${kind} down`" @click="emit('moveDown')">
            ↓
          </button>
          <button type="button" :aria-label="`Remove ${kind}`" @click="emit('remove')">
            Remove
          </button>
        </div>
      </div>
      <ol v-if="(node.type === 'condition' || node.type === 'action') && parameters.length" class="ace-parameters">
        <li v-for="parameter in parameters" :key="parameter.id ?? parameter.index">
          <span v-if="parameter.id" class="parameter-name">{{ parameter.id }}</span>
          <input
            v-if="editable"
            class="parameter-input"
            :aria-label="`${kind} parameter ${parameter.index + 1}`"
            placeholder="Expression or &quot;quoted text&quot;"
            :value="expressionLabel(parameter.expression)"
            @change="updateParameter(parameter.index, ($event.target as HTMLInputElement).value)"
          >
          <code v-else>{{ expressionLabel(parameter.expression) }}</code>
          <span v-if="parameter.expression.type === 'incomplete' || parameter.expression.type === 'invalid' || parameter.expression.type === 'unknown'" class="expression-state">
            {{ parameter.expression.type }}
          </span>
        </li>
      </ol>
      <button v-if="editable && (node.type === 'condition' || node.type === 'action')" type="button" class="add-parameter" @click="addParameter">
        + parameter
      </button>
      <p v-else-if="node.type === 'incomplete' && node.sourceText" class="ace-source">
        {{ node.sourceText }}
      </p>
      <code v-else-if="node.type === 'unknown'" class="ace-raw">{{ JSON.stringify(node.raw) }}</code>
    </div>
  </div>
</template>

<style scoped>
.ace-line {
  display: grid;
  grid-template-columns: 3.5rem minmax(0, 1fr);
  align-items: start;
  min-width: 0;
  border-left: 3px solid var(--event-sheet-condition);
  background: var(--event-sheet-paper);
}

.ace-line--action {
  border-left-color: var(--event-sheet-action);
}

.ace-line[data-state="unknown"],
.ace-line[data-state="incomplete"] {
  background: #f4f1e7;
}

.ace-line[data-state="invalid"] {
  background: #f5e9e5;
}

.ace-line[data-diagnostic-target="true"] {
  outline: 2px solid var(--event-sheet-warning);
  outline-offset: 1px;
}

.ace-kind {
  padding: 0.75rem 0.25rem 0.75rem 0.75rem;
  color: var(--event-sheet-muted);
  font-family: var(--event-sheet-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.ace-body {
  min-width: 0;
  padding: 0.55rem 0.75rem 0.65rem 0.25rem;
}

.ace-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.4rem 0.65rem;
}

.ace-heading strong {
  overflow-wrap: anywhere;
  font-weight: 650;
}

.operation-input,
.parameter-input {
  min-width: 0;
  max-width: 100%;
  padding: 0.2rem 0.3rem;
  border: 1px solid var(--event-sheet-rule);
  background: var(--event-sheet-paper);
  color: var(--event-sheet-ink);
  font: inherit;
}

.operation-input { flex: 1 1 9rem; font-weight: 650; }
.parameter-input { width: min(100%, 18rem); font-family: var(--event-sheet-mono); font-size: 0.75rem; }
.ace-controls { display: flex; flex-wrap: wrap; gap: 0.2rem; margin-left: auto; }
.ace-controls button, .add-parameter { border: 1px solid var(--event-sheet-rule); background: var(--event-sheet-paper); color: var(--event-sheet-ink); font: inherit; font-size: 0.7rem; cursor: pointer; }
.ace-controls button { padding: 0.2rem 0.35rem; }
.ace-controls button:disabled { opacity: 0.45; cursor: default; }
.add-parameter { margin-top: 0.35rem; padding: 0.2rem 0.35rem; }

.ace-state,
.ace-flag,
.expression-state {
  color: var(--event-sheet-warning);
  font-family: var(--event-sheet-mono);
  font-size: 0.7rem;
  text-transform: uppercase;
}

.ace-line[data-state="invalid"] .ace-state,
.expression-state {
  color: var(--event-sheet-invalid);
}

.ace-parameters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0;
  margin: 0.4rem 0 0;
  list-style: none;
}

.ace-parameters li {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
  min-width: 0;
}

.parameter-name {
  color: var(--event-sheet-muted);
  font-family: var(--event-sheet-mono);
  font-size: 0.7rem;
}

code {
  max-width: 100%;
  padding: 0.1rem 0.35rem;
  color: var(--event-sheet-ink);
  background: var(--event-sheet-code);
  font-family: var(--event-sheet-mono);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.ace-raw,
.ace-source {
  display: block;
  margin: 0.45rem 0 0;
  color: var(--event-sheet-muted);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

@media (max-width: 30rem) {
  .ace-line {
    grid-template-columns: 2.8rem minmax(0, 1fr);
  }
}
</style>
