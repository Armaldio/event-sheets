import { describe, expect, it } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  deserializeDocument,
  migrateDocument,
  serializeDocument,
  validateEngineExtensionManifest,
  validateEventDocument,
  type EventDocument,
} from '@project/schema'

const document = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: 'document-1',
  engine: { id: 'construct', compatibilityVersion: '3' },
  sheets: [
    {
      id: 'sheet-1',
      name: 'Main',
      events: [
        {
          type: 'event',
          id: 'event-1',
          conditions: [
            {
              type: 'condition',
              id: 'condition-1',
              operation: 'Player.CompareX',
              parameters: [
                { type: 'binary', operator: '>', left: { type: 'property', object: { type: 'identifier', name: 'Player' }, property: 'X' }, right: { type: 'literal', value: 50 } },
              ],
            },
          ],
          actions: [
            { type: 'incomplete', nodeType: 'action', id: 'action-1', sourceText: 'Player.Set' },
          ],
        },
      ],
    },
  ],
  variables: [],
} satisfies EventDocument

describe('schema serialization', () => {
  it('round-trips a document with structural and recovery nodes', () => {
    const result = deserializeDocument(serializeDocument(document))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.document).toEqual(document)
    }
  })

  it('preserves unknown nodes and their raw data', () => {
    const withUnknown: EventDocument = structuredClone(document)
    withUnknown.sheets[0]?.events[0]?.conditions.push({
      type: 'unknown',
      nodeType: 'condition',
      id: 'condition-unknown',
      raw: { plugin: 'future-plugin', ace: 'NewCondition', arguments: [1, 'x'] },
    })

    const result = deserializeDocument(serializeDocument(withUnknown))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.document.sheets[0]?.events[0]?.conditions[1]).toEqual(withUnknown.sheets[0]?.events[0]?.conditions[1])
    }
  })

  it('round-trips node metadata and Construct parameter IDs', () => {
    const annotated: EventDocument = structuredClone(document)
    annotated.metadata = { importedBy: 'fixture-parser' }
    const sheet = annotated.sheets[0]
    if (!sheet || 'type' in sheet) throw new Error('Expected a sheet')
    sheet.metadata = { sourceResource: 'main.c3ev' }
    const event = sheet.events[0]
    if (!event || event.type !== 'event') throw new Error('Expected an event')
    event.metadata = { construct: { raw: { sid: 'event-1' } } }
    const condition = event.conditions[0]
    if (!condition || condition.type !== 'condition') throw new Error('Expected a condition')
    condition.parameterIds = ['value']

    const result = deserializeDocument(serializeDocument(annotated))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.document).toEqual(annotated)
  })

  it('accepts recovery nodes for incomplete top-level structures', () => {
    const partial: EventDocument = {
      ...document,
      sheets: [{ type: 'incomplete', nodeType: 'sheet', id: 'sheet-incomplete' }],
      variables: [{ type: 'unknown', nodeType: 'variable', id: 'variable-unknown', raw: { name: 'Score' } }],
      functions: [{
        type: 'invalid',
        nodeType: 'function',
        id: 'function-invalid',
        raw: { name: 7 },
        diagnostic: { code: 'schema.invalid-function', severity: 'error', message: 'Function name must be text.' },
      }],
    }

    expect(validateEventDocument(partial).valid).toBe(true)
    const result = deserializeDocument(serializeDocument(partial))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.document).toEqual(partial)
  })

  it('returns a diagnostic for malformed JSON instead of throwing', () => {
    const result = deserializeDocument('{"schemaVersion":')

    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('schema.json-parse-error')
  })

  it('rejects duplicate structural IDs', () => {
    const invalid = {
      ...document,
      sheets: [{
        ...document.sheets[0],
        events: [{
          ...document.sheets[0].events[0],
          actions: [{ type: 'action', id: 'condition-1', operation: 'Player.Destroy', parameters: [] }],
        }],
      }],
    }

    const result = validateEventDocument(invalid)

    expect(result.valid).toBe(false)
    expect(result.diagnostics.some(({ code }) => code === 'schema.duplicate-node-id')).toBe(true)
  })

  it('treats variable expression IDs as references rather than new nodes', () => {
    const withReference: EventDocument = {
      ...document,
      variables: [{ id: 'variable-1', name: 'Score', dataType: 'number', scope: 'global' }],
      sheets: [{
        ...document.sheets[0]!,
        events: [{
          ...document.sheets[0]!.events[0]!,
          conditions: [{
            type: 'condition',
            id: 'condition-reference',
            operation: 'System.Evaluate',
            parameters: [{ type: 'variable', name: 'Score', variableId: 'variable-1' }],
          }],
        }],
      }],
    }

    expect(validateEventDocument(withReference).valid).toBe(true)
  })

  it('treats diagnostic node IDs as references rather than new nodes', () => {
    const withDiagnosticReference: EventDocument = {
      ...document,
      sheets: [{
        ...document.sheets[0]!,
        events: [{
          ...document.sheets[0]!.events[0]!,
          actions: [{
            type: 'invalid',
            nodeType: 'action',
            id: 'action-invalid',
            raw: { id: 'bad-action' },
            diagnostic: {
              code: 'construct.invalid-action',
              severity: 'error',
              message: 'Invalid action.',
              nodeId: 'action-invalid',
            },
          }],
        }],
      }],
    }

    expect(validateEventDocument(withDiagnosticReference).valid).toBe(true)
  })

  it('rejects circular non-JSON data without throwing', () => {
    const circular: Record<string, unknown> = { ...document }
    circular.metadata = circular

    expect(() => validateEventDocument(circular)).not.toThrow()
    expect(validateEventDocument(circular).valid).toBe(false)
  })

  it('validates engine extension manifests at the data boundary', () => {
    const result = validateEngineExtensionManifest({
      id: 'example.extension',
      version: '1.0.0',
      definitions: [{
        id: 'example.action',
        kind: 'action',
        displayName: 'Set score',
        parameters: [{ id: 'value', valueType: 'expression', required: true }],
      }],
    })

    expect(result.valid).toBe(true)
  })

  it('rejects invalid extension definitions', () => {
    const result = validateEngineExtensionManifest({
      id: 'example.extension',
      version: '1.0.0',
      definitions: [{ id: '', kind: 'trigger', displayName: '', parameters: [] }],
    })

    expect(result.valid).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })
})

describe('schema migrations', () => {
  it('applies each required migration without mutating the input', () => {
    const previous = { ...document, schemaVersion: 0 }
    const result = migrateDocument(previous, [
      { fromVersion: 0, toVersion: 1, migrate: (input) => ({ ...input, migrated: true }) },
    ])

    expect(result.ok).toBe(true)
    expect(previous).not.toHaveProperty('migrated')
    if (result.ok) {
      expect(result.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(result.document.migrated).toBe(true)
    }
  })

  it('reports a missing migration', () => {
    const result = migrateDocument({ ...document, schemaVersion: 0 })

    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe('schema.migration-unavailable')
  })
})
