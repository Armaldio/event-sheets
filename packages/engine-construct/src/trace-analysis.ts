import type {
  Diagnostic,
  EventDocument,
  EventNode,
  EventSheetNode,
  SourceLocation,
} from '@project/schema'
import type { ExecutionTrace, ExecutionTraceEntry } from './runtime.js'

export interface ConstructTraceNodeContext {
  nodeType: string
  label?: string
  operation?: string
  sourceLocation?: SourceLocation
}

export interface ConstructTraceAnalysisContext {
  documentId: string
  sheetId: string
  status: ExecutionTrace['status']
  entries: Array<ExecutionTraceEntry & { node?: ConstructTraceNodeContext }>
  diagnostics: Diagnostic[]
}

/** Attach source and editor context to a runtime trace for provider-based analysis. */
export function createConstructTraceAnalysisContext(
  document: EventDocument,
  trace: ExecutionTrace,
): ConstructTraceAnalysisContext {
  const nodes = new Map<string, ConstructTraceNodeContext>()
  for (const sheet of document.sheets) collectSheet(sheet)
  const diagnostics = trace.diagnostics.map((item) => {
    const sourceLocation = item.sourceLocation ?? (item.nodeId ? nodes.get(item.nodeId)?.sourceLocation : undefined)
    return sourceLocation ? { ...item, sourceLocation } : { ...item }
  })
  return {
    documentId: trace.documentId,
    sheetId: trace.sheetId,
    status: trace.status,
    entries: trace.entries.map((entry) => {
      const node = nodes.get(entry.nodeId)
      return node ? { ...entry, node } : { ...entry }
    }),
    diagnostics,
  }

  function collectSheet(sheet: EventSheetNode): void {
    addNode(sheet, 'sheet', 'name' in sheet ? sheet.name : undefined)
    if (!('events' in sheet)) return
    for (const event of sheet.events) collectEvent(event)
  }

  function collectEvent(event: EventNode): void {
    addNode(event, 'event', event.type === 'event' ? event.label : undefined)
    if (event.type !== 'event') return
    for (const ace of [...event.conditions, ...event.actions]) {
      addNode(
        ace,
        ace.type === 'comment' ? 'action' : ace.type,
        ace.type === 'condition' || ace.type === 'action' ? ace.operation : undefined,
      )
    }
    for (const child of event.subEvents ?? []) collectEvent(child)
  }

  function addNode(
    node: { id: string; sourceLocation?: SourceLocation; type?: string; nodeType?: string },
    fallbackType: string,
    labelOrOperation?: string,
  ): void {
    const nodeType = node.type === 'unknown' || node.type === 'invalid' || node.type === 'incomplete'
      ? node.nodeType ?? fallbackType
      : node.type ?? fallbackType
    const isAce = nodeType === 'condition' || nodeType === 'action'
    nodes.set(node.id, {
      nodeType,
      ...(labelOrOperation === undefined ? {} : isAce ? { operation: labelOrOperation } : { label: labelOrOperation }),
      ...(node.sourceLocation === undefined ? {} : { sourceLocation: node.sourceLocation }),
    })
  }
}

export type ConstructTraceAnalysisProvider<T> = (context: ConstructTraceAnalysisContext) => Promise<T>

/** Package concise, source-mapped execution evidence with a caller-supplied analyzer. */
export async function analyzeConstructTrace<T>(
  document: EventDocument,
  trace: ExecutionTrace,
  provider: ConstructTraceAnalysisProvider<T>,
): Promise<{ context: ConstructTraceAnalysisContext; analysis: T }> {
  const context = createConstructTraceAnalysisContext(document, trace)
  return { context, analysis: await provider(context) }
}
