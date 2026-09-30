import { isJsonObject } from './migrations.js'
import type { Diagnostic, EngineExtensionManifest } from './types.js'

export type ExtensionManifestValidationResult =
  | { valid: true; manifest: EngineExtensionManifest; diagnostics: Diagnostic[] }
  | { valid: false; diagnostics: Diagnostic[] }

export function validateEngineExtensionManifest(input: unknown): ExtensionManifestValidationResult {
  const diagnostics: Diagnostic[] = []
  try {
    if (!isJsonObject(input)) {
      return failure([{ code: 'schema.invalid-extension-manifest', severity: 'error', message: 'Expected a JSON object extension manifest.' }])
    }

    requireString(input.id, 'id')
    requireString(input.version, 'version')
    if (input.metadata !== undefined && !isJsonObject(input.metadata)) {
      issue('metadata', 'Expected a JSON-compatible metadata object.')
    }
    if (!Array.isArray(input.definitions)) {
      issue('definitions', 'Expected an array of extension definitions.')
    } else {
      const definitionIds = new Set<string>()
      input.definitions.forEach((definition, index) => {
        const path = `definitions[${index}]`
        if (!isPlainRecord(definition)) {
          issue(path, 'Expected an extension definition object.')
          return
        }
        requireString(definition.id, `${path}.id`)
        requireString(definition.displayName, `${path}.displayName`)
        if (typeof definition.id === 'string') {
          if (definitionIds.has(definition.id)) issue(`${path}.id`, `Duplicate definition ID "${definition.id}".`)
          definitionIds.add(definition.id)
        }
        if (definition.kind !== 'condition' && definition.kind !== 'action' && definition.kind !== 'expression') {
          issue(`${path}.kind`, 'Expected condition, action, or expression kind.')
        }
        if (!Array.isArray(definition.parameters)) {
          issue(`${path}.parameters`, 'Expected an array of parameter definitions.')
          return
        }

        const parameterIds = new Set<string>()
        definition.parameters.forEach((parameter, parameterIndex) => {
          const parameterPath = `${path}.parameters[${parameterIndex}]`
          if (!isPlainRecord(parameter)) {
            issue(parameterPath, 'Expected a parameter definition object.')
            return
          }
          requireString(parameter.id, `${parameterPath}.id`)
          if (typeof parameter.id === 'string') {
            if (parameterIds.has(parameter.id)) issue(`${parameterPath}.id`, `Duplicate parameter ID "${parameter.id}".`)
            parameterIds.add(parameter.id)
          }
          if (!['string', 'number', 'boolean', 'expression', 'any'].includes(String(parameter.valueType))) {
            issue(`${parameterPath}.valueType`, 'Expected a supported parameter value type.')
          }
          if (parameter.required !== undefined && typeof parameter.required !== 'boolean') {
            issue(`${parameterPath}.required`, 'Expected a boolean.')
          }
        })
      })
    }

    return diagnostics.length === 0
      ? { valid: true, manifest: input as unknown as EngineExtensionManifest, diagnostics }
      : failure(diagnostics)
  } catch {
    return failure([{ code: 'schema.invalid-extension-manifest', severity: 'error', message: 'Extension manifest could not be safely inspected.' }])
  }

  function requireString(value: unknown, path: string): void {
    if (typeof value !== 'string' || value.trim() === '') issue(path, 'Expected a non-empty string.')
  }

  function issue(path: string, message: string): void {
    diagnostics.push({
      code: 'schema.invalid-extension-manifest',
      severity: 'error',
      message,
      details: { path },
    })
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function failure(diagnostics: Diagnostic[]): ExtensionManifestValidationResult {
  return { valid: false, diagnostics }
}
