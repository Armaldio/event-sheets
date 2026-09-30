import { CURRENT_SCHEMA_VERSION, type Diagnostic, type JsonObject, type JsonValue } from './types.js'

export interface SchemaMigration {
  fromVersion: number
  toVersion: number
  migrate(document: Readonly<JsonObject>): JsonObject
}

export type MigrationResult =
  | { ok: true; document: JsonObject }
  | { ok: false; diagnostics: Diagnostic[] }

export function migrateDocument(
  input: unknown,
  migrations: readonly SchemaMigration[] = [],
): MigrationResult {
  if (!isJsonObject(input)) {
    return failure('schema.invalid-document', 'Expected a JSON object document.')
  }

  const version = input.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return failure('schema.invalid-version', 'Document schemaVersion must be a non-negative integer.')
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return failure(
      'schema.newer-version',
      `Document schema version ${version} is newer than supported version ${CURRENT_SCHEMA_VERSION}.`,
    )
  }

  let currentVersion = version
  let document = cloneJsonObject(input)

  while (currentVersion < CURRENT_SCHEMA_VERSION) {
    const migration = migrations.find(({ fromVersion, toVersion }) =>
      fromVersion === currentVersion && toVersion === currentVersion + 1,
    )
    if (!migration) {
      return failure(
        'schema.migration-unavailable',
        `No migration is registered from schema version ${currentVersion} to ${currentVersion + 1}.`,
      )
    }

    try {
      const migrated = migration.migrate(cloneJsonObject(document))
      if (!isJsonObject(migrated)) {
        return failure(
          'schema.migration-invalid-result',
          `Migration from schema version ${currentVersion} did not return a JSON object.`,
        )
      }
      document = cloneJsonObject(migrated)
      document.schemaVersion = migration.toVersion
      currentVersion = migration.toVersion
    } catch {
      return failure(
        'schema.migration-failed',
        `Migration from schema version ${currentVersion} failed.`,
      )
    }
  }

  return { ok: true, document }
}

export function isJsonObject(value: unknown): value is JsonObject {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return (prototype === Object.prototype || prototype === null) && isJsonValue(value)
  } catch {
    return false
  }
}

function isJsonValue(value: unknown, ancestors = new WeakSet<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false

  ancestors.add(value)
  const valid = Array.isArray(value)
    ? arrayIsJsonValue(value, ancestors)
    : isPlainRecord(value) && Object.values(value).every((entry) => isJsonValue(entry, ancestors))
  ancestors.delete(value)
  return valid
}

function arrayIsJsonValue(value: unknown[], ancestors: WeakSet<object>): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !isJsonValue(value[index], ancestors)) return false
  }
  return true
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

function failure(code: string, message: string): MigrationResult {
  return {
    ok: false,
    diagnostics: [{ code, severity: 'error', message }],
  }
}
