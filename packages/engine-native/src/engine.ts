import type { EventDocument } from '@project/schema'
import { createNativeRegistry, type NativeRegistry } from './registry.js'
import { runNativeDocument, type NativeExecutionTrace } from './runtime.js'
import { validateNativeDocument, type NativeValidationResult } from './validation.js'

export interface NativeEngine {
  readonly id: 'native'
  readonly registry: NativeRegistry
  validate(document: EventDocument): NativeValidationResult
  run(document: EventDocument, sheetId: string): NativeExecutionTrace
}

/** Create a Native engine with independent operation definitions and semantics. */
export function createNativeEngine(registry: NativeRegistry = createNativeRegistry()): NativeEngine {
  return {
    id: 'native',
    registry,
    validate: (document) => validateNativeDocument(document, registry),
    run: (document, sheetId) => runNativeDocument(document, sheetId, registry),
  }
}
