import { migrateDocument, type SchemaMigration } from './migrations.js'
import { validateEventDocument, type ValidationResult } from './validation.js'
import type { Diagnostic, EventDocument } from './types.js'

export type DeserializationResult =
  | { ok: true; document: EventDocument; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] }

export function serializeDocument(document: EventDocument): string {
  const validation = validateEventDocument(document)
  if (!validation.valid) {
    const codes = validation.diagnostics.map(({ code }) => code).join(', ')
    throw new TypeError(`Cannot serialize an invalid EventDocument (${codes}).`)
  }
  return JSON.stringify(validation.document)
}

export function deserializeDocument(
  serialized: string,
  options: { migrations?: readonly SchemaMigration[] } = {},
): DeserializationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized) as unknown
  } catch {
    return {
      ok: false,
      diagnostics: [{
        code: 'schema.json-parse-error',
        severity: 'error',
        message: 'Input is not valid JSON.',
      }],
    }
  }

  const migrated = migrateDocument(parsed, options.migrations)
  if (!migrated.ok) return { ok: false, diagnostics: migrated.diagnostics }

  const validation: ValidationResult = validateEventDocument(migrated.document)
  if (!validation.valid) return { ok: false, diagnostics: validation.diagnostics }
  return { ok: true, document: validation.document, diagnostics: [] }
}
