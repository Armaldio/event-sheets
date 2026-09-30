import {
  diffEventDocuments,
  validateEventDocument,
  type Diagnostic,
  type EventDocument,
  type EventDocumentDiff,
} from '@project/schema'
import { applyEditorCommand, type EditorCommand } from './commands.js'

export interface RepairContext {
  document: EventDocument
  diagnostics: readonly Diagnostic[]
}

/** Adapt any LLM provider to return bounded, serializable editor commands. */
export type RepairProvider = (context: RepairContext) => Promise<readonly EditorCommand[]>

export type RepairProposalResult =
  | { ok: true; document: EventDocument; commands: readonly EditorCommand[]; diff: EventDocumentDiff }
  | { ok: false; diagnostics: Diagnostic[] }

/** Build a validated preview; callers choose when to accept and publish it. */
export async function proposeRepair(
  document: EventDocument,
  diagnostics: readonly Diagnostic[],
  provider: RepairProvider,
): Promise<RepairProposalResult> {
  const commands = await provider({ document, diagnostics })
  if (!Array.isArray(commands)) {
    return {
      ok: false,
      diagnostics: [{
        code: 'visual.repair.invalid-proposal',
        severity: 'error',
        message: 'The repair provider must return an array of editor commands.',
      }],
    }
  }

  let proposed = document
  try {
    for (const command of commands) proposed = applyEditorCommand(proposed, command)
  } catch (error) {
    return {
      ok: false,
      diagnostics: [{
        code: 'visual.repair.command-rejected',
        severity: 'error',
        message: error instanceof Error ? error.message : 'The repair command could not be applied.',
      }],
    }
  }

  const validation = validateEventDocument(proposed)
  if (!validation.valid) return { ok: false, diagnostics: validation.diagnostics }
  return {
    ok: true,
    document: proposed,
    commands,
    diff: diffEventDocuments(document, proposed),
  }
}
