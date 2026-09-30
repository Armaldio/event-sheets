import type { ExecutionTrace } from './runtime.js'

export interface ConstructTraceDifference {
  path: string
  expected: unknown
  actual: unknown
}

export interface ConstructTraceComparison {
  matches: boolean
  differences: ConstructTraceDifference[]
}

/** Compare an engine trace with a saved trace captured from Construct. */
export function compareConstructTraces(
  actual: ExecutionTrace,
  expected: ExecutionTrace,
): ConstructTraceComparison {
  const differences: ConstructTraceDifference[] = []
  compare('documentId', actual.documentId, expected.documentId)
  compare('sheetId', actual.sheetId, expected.sheetId)
  compare('status', actual.status, expected.status)
  compare('entries.length', actual.entries.length, expected.entries.length)
  const count = Math.max(actual.entries.length, expected.entries.length)
  for (let index = 0; index < count; index += 1) {
    const actualEntry = actual.entries[index]
    const expectedEntry = expected.entries[index]
    if (!actualEntry || !expectedEntry) continue
    for (const field of ['sequence', 'kind', 'nodeId', 'status', 'parentNodeId', 'details'] as const) {
      compare(`entries[${index}].${field}`, actualEntry[field], expectedEntry[field])
    }
  }
  compare('diagnostics', actual.diagnostics, expected.diagnostics)
  return { matches: differences.length === 0, differences }

  function compare(path: string, actualValue: unknown, expectedValue: unknown): void {
    if (stableStringify(actualValue) === stableStringify(expectedValue)) return
    differences.push({ path, expected: expectedValue, actual: actualValue })
  }
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const record = value as Record<string, unknown>
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(record[key])).join(',') + '}'
}
