import {
  CURRENT_SCHEMA_VERSION,
  diffEventDocuments,
  type ActionNode,
  type ConditionNode,
  type Diagnostic,
  type EventDocument,
  type EventDocumentDiff,
  type EventNode,
  type EventSheetInclude,
  type EventSheetNode,
  type Expression,
  type IncompleteNode,
  type InvalidNode,
  type JsonObject,
  type JsonValue,
  type ParseResult,
  type SourceLocation,
  type StreamParser,
  type UnknownNode,
  type VariableDeclaration,
  type VariableNode,
} from '@project/schema'
import { parseConstructExpression, parseConstructLiteral } from './expression-parser.js'
import { constructEngine, type ConstructRegistry } from './registry.js'
import type { ActionDefinition, ConditionDefinition, ConstructParameterType } from './types.js'

export interface ParseConstructOptions {
  sourceId?: string
  fallbackSheetName?: string
  registry?: ConstructRegistry
  /** Plugin IDs keyed by object class when parsing a standalone event sheet. */
  objectClassPluginIds?: Readonly<Record<string, string>>
}

export interface ConstructStreamSnapshot extends ParseResult {
  index: number
  complete: boolean
  diff: EventDocumentDiff
}

/** Parse one Construct event sheet JSON resource into the public event document schema. */
export function parseConstruct(source: string, options: ParseConstructOptions = {}): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch {
    const recovered = closeTruncatedJson(source)
    if (recovered !== undefined) {
      try {
        parsed = JSON.parse(recovered) as unknown
        const mapped = mapEventSheet(parsed, options, createSourceLocationMap(recovered, parsed, options.sourceId, source.length))
        mapped.diagnostics.unshift(diagnostic(
          'construct.incomplete-input',
          'Input ended before the Construct event sheet JSON was complete; parsed the recoverable prefix.',
          'warning',
          undefined,
          options.sourceId,
          { sourceLength: source.length },
        ))
        return { ...mapped, status: 'partial' }
      } catch {
        // Fall through to an explicit partial document below.
      }
    }

    return incompleteDocument(source, options, 'construct.invalid-json', 'Construct event sheet input is not valid JSON.')
  }
  return mapEventSheet(parsed, options, createSourceLocationMap(source, parsed, options.sourceId))
}

/** Reparse accumulated source on each snapshot; stable Construct SIDs keep IDs steady. */
export function createConstructParser(options: ParseConstructOptions = {}): StreamParser {
  let source = ''
  let lastRecoverable: ParseResult | undefined
  let finalResult: ParseResult | undefined
  let finished = false

  return {
    push(chunk: string): void {
      if (finished) throw new TypeError('Cannot push input after the Construct parser has finished.')
      source += chunk
    },
    snapshot(): ParseResult {
      if (finalResult) return finalResult
      const current = parseConstruct(source, options)
      const invalidJson = current.diagnostics.some(({ code }) => code === 'construct.invalid-json')
      if (!invalidJson) lastRecoverable = current
      if (invalidJson && lastRecoverable) {
        return {
          document: lastRecoverable.document,
          diagnostics: current.diagnostics,
          status: 'partial',
        }
      }
      return { ...current, status: 'partial' }
    },
    finish(): ParseResult {
      if (finalResult) return finalResult
      finished = true
      const result = parseConstruct(source, options)
      const invalidJson = result.diagnostics.some(({ code }) => code === 'construct.invalid-json')
      if (!invalidJson) lastRecoverable = result
      if (invalidJson && lastRecoverable) {
        finalResult = { document: lastRecoverable.document, diagnostics: result.diagnostics, status: 'partial' }
        return finalResult
      }
      finalResult = result
      return finalResult
    },
  }
}

/** Consume provider-agnostic generated text as stable-ID parser snapshots. */
export async function* parseConstructStream(
  chunks: AsyncIterable<string>,
  options: ParseConstructOptions = {},
): AsyncGenerator<ConstructStreamSnapshot> {
  const parser = createConstructParser(options)
  let previousDocument: EventDocument | undefined
  let index = 0

  for await (const chunk of chunks) {
    parser.push(chunk)
    const result = parser.snapshot()
    yield {
      ...result,
      index: index++,
      complete: false,
      diff: previousDocument
        ? diffEventDocuments(previousDocument, result.document)
        : diffEventDocuments(result.document, result.document),
    }
    previousDocument = result.document
  }

  const result = parser.finish()
  yield {
    ...result,
    index,
    complete: true,
    diff: previousDocument
      ? diffEventDocuments(previousDocument, result.document)
      : diffEventDocuments(result.document, result.document),
  }
}

// The shorter name follows the streaming API described by the public project plan.
export const createParser = createConstructParser

function mapEventSheet(
  input: unknown,
  options: ParseConstructOptions,
  sourceLocations: ReadonlyMap<string, SourceLocation>,
): ParseResult {
  const diagnostics: Diagnostic[] = []
  const ids = new Set<string>()
  const nodeSourceLocations = new Map<string, SourceLocation>()
  const registry = options.registry ?? constructEngine.registry
  const sourceLocationAt = (path: string): SourceLocation | undefined => sourceLocations.get(path) ?? location(options.sourceId)
  const sourceLocation = sourceLocationAt('')

  if (!isRecord(input) || !isJsonValue(input)) {
    return incompleteDocument('', options, 'construct.invalid-sheet', 'Expected a Construct event sheet object.')
  }

  const documentId = uniqueId(`construct-document:${sidOf(input) ?? 'root'}`, 'document', ids, diagnostics, sourceLocation)
  const sheets: EventSheetNode[] = []
  if (!Array.isArray(input.events)) {
    const nodeId = uniqueId(sidId(input, 'sheet', sourceLocation?.sourceId), 'sheet', ids, diagnostics, sourceLocation)
    if (sourceLocation) nodeSourceLocations.set(nodeId, sourceLocation)
    const message = 'Construct event sheet is missing its events array.'
    const nodeDiagnostic = diagnostic('construct.incomplete-sheet', message, 'error', nodeId, options.sourceId)
    diagnostics.push(nodeDiagnostic)
    sheets.push({
      type: 'incomplete',
      nodeType: 'sheet',
      id: nodeId,
      ...(sourceLocation === undefined ? {} : { sourceLocation }),
      sourceText: JSON.stringify(input),
      expected: ['events'],
      metadata: rawMetadata(input),
    })
    return withNodeSourceLocations({ document: makeDocument(documentId, sheets), diagnostics, status: 'partial' })
  }

  const sheetId = uniqueId(sidId(input, 'sheet', sourceLocation?.sourceId), 'sheet', ids, diagnostics, sourceLocation)
  if (sourceLocation) nodeSourceLocations.set(sheetId, sourceLocation)
  const events: EventNode[] = []
  const variables: VariableNode[] = []
  const includes: EventSheetInclude[] = []
  input.events.forEach((event, index) => {
    const path = `events[${index}]`
    if (isRecord(event) && event.eventType === 'variable') {
      variables.push(mapVariable(event, path, options, ids, diagnostics))
    } else if (isRecord(event) && event.eventType === 'include' && typeof event.includeSheet === 'string') {
      includes.push(mapInclude(event, path, ids, diagnostics))
    } else {
      events.push(mapEvent(event, path, options, registry, ids, diagnostics))
    }
  })
  const sheetName = typeof input.name === 'string' && input.name.trim()
    ? input.name
    : options.fallbackSheetName?.trim() || 'Event sheet'
  sheets.push({
    id: sheetId,
    name: sheetName,
    events,
    ...(variables.length > 0 ? { variables } : {}),
    ...(includes.length > 0 ? { includes } : {}),
    ...(sourceLocation === undefined ? {} : { sourceLocation }),
    metadata: rawMetadata(input, {
      fallbackSheetName: options.fallbackSheetName?.trim() || 'Event sheet',
    }),
  })

  return withNodeSourceLocations({
    document: makeDocument(documentId, sheets),
    diagnostics,
    status: diagnostics.some(({ severity, code }) => severity === 'error' || code.startsWith('construct.incomplete-'))
      ? 'partial'
      : 'complete',
  })

  function withNodeSourceLocations(result: ParseResult): ParseResult {
    return {
      ...result,
      diagnostics: result.diagnostics.map((item) => {
        const sourceLocation = item.nodeId ? nodeSourceLocations.get(item.nodeId) : undefined
        return sourceLocation ? { ...item, sourceLocation } : item
      }),
    }
  }

  function mapVariable(
    record: Record<string, unknown>,
    path: string,
    parseOptions: ParseConstructOptions,
    seenIds: Set<string>,
    outputDiagnostics: Diagnostic[],
    scope: VariableDeclaration['scope'] = 'global',
  ): VariableNode {
    const raw = record as unknown as JsonValue
    const sourceLocation = sourceLocationAt(path)
    const nodeId = uniqueId(sidId(record, path, sourceLocation?.sourceId), path, seenIds, outputDiagnostics, sourceLocation)
    if (sourceLocation) nodeSourceLocations.set(nodeId, sourceLocation)
    if (typeof record.name !== 'string' || typeof record.type !== 'string') {
      const expected = [
        ...(typeof record.name !== 'string' ? ['name'] : []),
        ...(typeof record.type !== 'string' ? ['type'] : []),
      ]
      outputDiagnostics.push(diagnostic(
        'construct.incomplete-variable',
        'Construct variable is missing its name or type; its raw data was retained.',
        'warning', nodeId, parseOptions.sourceId, { path, expected },
      ))
      return unknownNode('variable', nodeId, raw, sourceLocation)
    }

    let initialValue: Expression | undefined
    if (record.initialValue !== undefined) {
      if (!isJsonValue(record.initialValue)) {
        outputDiagnostics.push(diagnostic(
          'construct.invalid-variable-initial-value',
          `Initial value for Construct variable "${record.name}" is not JSON-compatible.`,
          'warning', nodeId, parseOptions.sourceId, { path },
        ))
        return unknownNode('variable', nodeId, raw, sourceLocation)
      }
      initialValue = constructVariableInitialValue(record.type, record.initialValue)
      const initialValueSourceLocation = sourceLocationAt(`${path}.initialValue`)
      if (initialValueSourceLocation) initialValue.sourceLocation = initialValueSourceLocation
      if (initialValue.type === 'unknown' || initialValue.type === 'incomplete') {
        outputDiagnostics.push(diagnostic(
          initialValue.type === 'incomplete' ? 'construct.incomplete-variable-initial-value' : 'construct.unknown-variable-initial-value',
          `Initial value for Construct variable "${record.name}" could not be parsed; its source was preserved.`,
          'warning', nodeId, parseOptions.sourceId, { path, sourceText: initialValue.sourceText },
        ))
      }
    }

    const variable: VariableDeclaration = {
      id: nodeId,
      name: record.name,
      dataType: record.type,
      scope,
      ...(initialValue === undefined ? {} : { initialValue }),
      ...(sourceLocation === undefined ? {} : { sourceLocation }),
      metadata: rawMetadata(record),
    }
    return variable
  }

  function mapInclude(
    record: Record<string, unknown>,
    path: string,
    seenIds: Set<string>,
    outputDiagnostics: Diagnostic[],
  ): EventSheetInclude {
    const sourceLocation = sourceLocationAt(path)
    const nodeId = uniqueId(sidId(record, path, sourceLocation?.sourceId), path, seenIds, outputDiagnostics, sourceLocation)
    if (sourceLocation) nodeSourceLocations.set(nodeId, sourceLocation)
    return {
      id: nodeId,
      sheetName: record.includeSheet as string,
      ...(sourceLocation === undefined ? {} : { sourceLocation }),
      metadata: rawMetadata(record),
    }
  }

  function mapEvent(
    value: unknown,
    path: string,
    parseOptions: ParseConstructOptions,
    aceRegistry: ConstructRegistry,
    seenIds: Set<string>,
    outputDiagnostics: Diagnostic[],
  ): EventNode {
    const raw = isJsonValue(value) ? value : null
    const record = isRecord(value) ? value : undefined
    const sourceLocation = sourceLocationAt(path)
    const nodeId = uniqueId(sidId(record, path, sourceLocation?.sourceId), path, seenIds, outputDiagnostics, sourceLocation)
    if (sourceLocation) nodeSourceLocations.set(nodeId, sourceLocation)
    if (!record) {
      const issue = diagnostic('construct.invalid-event', 'Expected a Construct event block object.', 'error', nodeId, parseOptions.sourceId, { path })
      outputDiagnostics.push(issue)
      return invalidNode('event', nodeId, raw, issue, sourceLocation)
    }

    if (typeof record.eventType !== 'string') {
      outputDiagnostics.push(diagnostic('construct.incomplete-event', 'Construct event is missing its eventType.', 'warning', nodeId, parseOptions.sourceId, { path }))
      return incompleteNode('event', nodeId, record, ['eventType'], sourceLocation)
    }
    if (record.eventType === 'comment') {
      if (typeof record.text !== 'string') {
        outputDiagnostics.push(diagnostic(
          'construct.incomplete-comment-event',
          'Construct comment event is missing its text.',
          'warning', nodeId, parseOptions.sourceId, { path, expected: ['text'] },
        ))
        return unknownNode('event', nodeId, raw, sourceLocation)
      }
      return {
        type: 'event',
        id: nodeId,
        eventKind: 'comment',
        comment: record.text,
        conditions: [],
        actions: [],
        ...(sourceLocation === undefined ? {} : { sourceLocation }),
        metadata: rawMetadata(record),
      }
    }
    const isFunctionBlock = record.eventType === 'function-block'
    const isCustomActionBlock = record.eventType === 'custom-ace-block'
      && record.aceType === 'action'
      && typeof record.objectClass === 'string'
      && typeof record.aceName === 'string'
    if ((isFunctionBlock || isCustomActionBlock) && record.functionIsAsync === true) {
      outputDiagnostics.push(diagnostic(
        'construct.unsupported-async-function',
        'Asynchronous Construct function and custom action blocks are preserved but are not executable by this synchronous runtime.',
        'warning', nodeId, parseOptions.sourceId, { path },
      ))
      return unknownNode('event', nodeId, raw, sourceLocation)
    }
    if (record.eventType !== 'block' && record.eventType !== 'group' && record.eventType !== 'function'
      && !isFunctionBlock && !isCustomActionBlock) {
      outputDiagnostics.push(diagnostic('construct.unknown-event', `Unsupported Construct event type "${record.eventType}".`, 'warning', nodeId, parseOptions.sourceId, { path, eventType: record.eventType }))
      return unknownNode('event', nodeId, raw, sourceLocation)
    }
    const isFunctionLike = isFunctionBlock || isCustomActionBlock
    const eventKind = isFunctionLike ? 'function' : record.eventType as 'block' | 'group' | 'function'
    const functionParameterRecords = isFunctionLike ? record.functionParameters : record.parameters
    const functionReturnType = isFunctionLike ? record.functionReturnType : record.returnType
    const functionCopyPicked = isFunctionLike ? record.functionCopyPicked : record.copyPicked
    if (eventKind !== 'group' && (!Array.isArray(record.conditions) || !Array.isArray(record.actions))) {
      const expected = [
        ...(!Array.isArray(record.conditions) ? ['conditions'] : []),
        ...(!Array.isArray(record.actions) ? ['actions'] : []),
      ]
      outputDiagnostics.push(diagnostic('construct.incomplete-event', 'Construct event is missing its conditions or actions array.', 'warning', nodeId, parseOptions.sourceId, { path, expected }))
      return incompleteNode('event', nodeId, record, expected, sourceLocation)
    }

    const conditions: ConditionNode[] = eventKind === 'group' ? [] : (record.conditions as unknown[]).map((condition, index) => mapAce(
      condition,
      `${path}.conditions[${index}]`,
      'condition',
      parseOptions,
      aceRegistry,
      seenIds,
      outputDiagnostics,
    )) as ConditionNode[]
    const actions: ActionNode[] = eventKind === 'group' ? [] : (record.actions as unknown[]).map((action, index) => mapAce(
      action,
      `${path}.actions[${index}]`,
      'action',
      parseOptions,
      aceRegistry,
      seenIds,
      outputDiagnostics,
    )) as ActionNode[]
    const localVariables: VariableNode[] = []
    const subEvents: EventNode[] | undefined = Array.isArray(record.children)
      ? record.children.flatMap((child, index) => {
        if (isRecord(child) && child.eventType === 'variable') {
          localVariables.push(mapVariable(
            child,
            `${path}.children[${index}]`,
            parseOptions,
            seenIds,
            outputDiagnostics,
            'local',
          ))
          return []
        }
        return [mapEvent(child, `${path}.children[${index}]`, parseOptions, aceRegistry, seenIds, outputDiagnostics)]
      })
      : undefined
    if (record.children !== undefined && subEvents === undefined) {
      outputDiagnostics.push(diagnostic('construct.invalid-children', 'Construct event children must be an array.', 'warning', nodeId, parseOptions.sourceId, { path }))
    }

    return {
      type: 'event',
      id: nodeId,
      eventKind,
      conditions,
      actions,
      ...(localVariables.length > 0 ? { variables: localVariables } : {}),
      ...(subEvents === undefined ? {} : { subEvents }),
      ...(eventKind === 'group'
        ? (typeof record.disabled === 'boolean' ? { enabled: !record.disabled } : {})
        : (typeof record.isEnabled === 'boolean' ? { enabled: record.isEnabled } : {})),
      ...(eventKind === 'group' && typeof record.isActiveOnStart === 'boolean'
        ? { initiallyEnabled: record.isActiveOnStart }
        : {}),
      ...(eventKind === 'function' && Array.isArray(functionParameterRecords) ? {
        functionParameters: functionParameterRecords.flatMap((parameter, index) => {
          if (!isRecord(parameter) || !isJsonValue(parameter)) {
            outputDiagnostics.push(diagnostic(
              'construct.invalid-function-parameter',
              'Construct function parameters must be objects.',
              'warning',
              nodeId,
              parseOptions.sourceId,
              { path: `${path}.parameters[${index}]` },
            ))
            return []
          }
          const parameterPath = `${path}.${isFunctionLike ? 'functionParameters' : 'parameters'}[${index}]`
          const parameterSourceLocation = sourceLocationAt(parameterPath)
          const parameterId = uniqueId(sidId(parameter, parameterPath, parameterSourceLocation?.sourceId), parameterPath, seenIds, outputDiagnostics, parameterSourceLocation)
          if (parameterSourceLocation) nodeSourceLocations.set(parameterId, parameterSourceLocation)
          return [{
            id: parameterId,
            name: typeof parameter.name === 'string' ? parameter.name : `param${index}`,
            dataType: typeof parameter.type === 'string' ? parameter.type : 'any',
            ...(parameterSourceLocation === undefined ? {} : { sourceLocation: parameterSourceLocation }),
            metadata: rawMetadata(parameter),
          }]
        }),
      } : {}),
      ...(eventKind === 'function' && typeof functionReturnType === 'string'
        ? { functionReturnType }
        : {}),
      ...(eventKind === 'function' && typeof functionCopyPicked === 'boolean'
        ? { functionCopyPicked }
        : {}),
      ...(isCustomActionBlock
        ? { label: `${record.objectClass as string}::${record.aceName as string}` }
        : typeof (eventKind === 'group' ? record.title : isFunctionBlock ? record.functionName : record.name) === 'string'
          ? { label: eventKind === 'group'
            ? record.title as string
            : (isFunctionBlock ? record.functionName : record.name) as string }
          : {}),
      ...(record.isOrBlock === true ? { isOrBlock: true } : {}),
      ...(record.isElse === true ? { isElse: true } : {}),
      ...(sourceLocation === undefined ? {} : { sourceLocation }),
      metadata: rawMetadata(record),
    }
  }

  function mapAce(
    value: unknown,
    path: string,
    kind: 'condition' | 'action',
    parseOptions: ParseConstructOptions,
    aceRegistry: ConstructRegistry,
    seenIds: Set<string>,
    outputDiagnostics: Diagnostic[],
  ): ConditionNode | ActionNode {
    const raw = isJsonValue(value) ? value : null
    const record = isRecord(value) ? value : undefined
    const sourceLocation = sourceLocationAt(path)
    const nodeId = uniqueId(sidId(record, path, sourceLocation?.sourceId), path, seenIds, outputDiagnostics, sourceLocation)
    if (sourceLocation) nodeSourceLocations.set(nodeId, sourceLocation)
    if (!record) {
      const issue = diagnostic(`construct.invalid-${kind}`, `Expected a Construct ${kind} object.`, 'error', nodeId, parseOptions.sourceId, { path })
      outputDiagnostics.push(issue)
      return invalidNode(kind, nodeId, raw, issue, sourceLocation)
    }

    if (kind === 'action' && record.type === 'comment') {
      if (typeof record.text === 'string') {
        return {
          type: 'comment',
          id: nodeId,
          text: record.text,
          ...(sourceLocation === undefined ? {} : { sourceLocation }),
          metadata: rawMetadata(record),
        }
      }
      outputDiagnostics.push(diagnostic(
        'construct.incomplete-comment-action',
        'Construct comment action is missing its text.',
        'warning', nodeId, parseOptions.sourceId, { path, expected: ['text'] },
      ))
      return unknownNode(kind, nodeId, raw, sourceLocation)
    }

    if (kind === 'action' && record.type === 'script') {
      if (typeof record.script !== 'string' && !Array.isArray(record.script)) {
        outputDiagnostics.push(diagnostic(
          'construct.incomplete-script-action',
          'Construct script action is missing its script source.',
          'warning', nodeId, parseOptions.sourceId, { path, expected: ['script'] },
        ))
        return incompleteNode(kind, nodeId, record, ['script'], sourceLocation)
      }
      outputDiagnostics.push(diagnostic(
        'construct.unsupported-script-action',
        'Construct script action source is preserved but is not executed by this engine.',
        'warning', nodeId, parseOptions.sourceId, { path },
      ))
      return unknownNode(kind, nodeId, raw, sourceLocation)
    }

    if (kind === 'action' && typeof record.callFunction === 'string') {
      const rawParameters = record.parameters === undefined ? [] : record.parameters
      if (!Array.isArray(rawParameters) || !isJsonValue(rawParameters)) {
        const issue = diagnostic(
          'construct.invalid-action-parameters',
          'Construct function call parameters must be an array.',
          'error', nodeId, parseOptions.sourceId, { path },
        )
        outputDiagnostics.push(issue)
        return invalidNode(kind, nodeId, raw, issue, sourceLocation)
      }
      return {
        type: 'action',
        id: nodeId,
        operation: `Functions.${record.callFunction}`,
        parameters: rawParameters.map((parameter) => parameterExpression(parameter, 'any')),
        ...(sourceLocation === undefined ? {} : { sourceLocation }),
        metadata: rawMetadata(record),
      }
    }

    if (kind === 'action' && typeof record.customAction === 'string' && typeof record.objectClass === 'string') {
      const rawParameters = record.parameters === undefined ? [] : record.parameters
      if (!Array.isArray(rawParameters) || !isJsonValue(rawParameters)) {
        const issue = diagnostic(
          'construct.invalid-action-parameters',
          'Construct custom action parameters must be an array.',
          'error', nodeId, parseOptions.sourceId, { path },
        )
        outputDiagnostics.push(issue)
        return invalidNode(kind, nodeId, raw, issue, sourceLocation)
      }
      const owner = typeof record.customActionObjectClass === 'string'
        ? record.customActionObjectClass
        : record.objectClass
      return {
        type: 'action',
        id: nodeId,
        operation: `Functions.${owner}::${record.customAction}`,
        parameters: rawParameters.map((parameter) => parameterExpression(parameter, 'any')),
        ...(sourceLocation === undefined ? {} : { sourceLocation }),
        metadata: rawMetadata(record),
      }
    }

    if (typeof record.id !== 'string' || typeof record.objectClass !== 'string') {
      const expected = [
        ...(typeof record.id !== 'string' ? ['id'] : []),
        ...(typeof record.objectClass !== 'string' ? ['objectClass'] : []),
      ]
      outputDiagnostics.push(diagnostic(`construct.incomplete-${kind}`, `Construct ${kind} is missing its id or objectClass.`, 'warning', nodeId, parseOptions.sourceId, { path, expected }))
      return incompleteNode(kind, nodeId, record, expected, sourceLocation)
    }

    const behaviorType = typeof record.behaviorType === 'string' ? record.behaviorType : undefined
    const pluginIds = parseOptions.objectClassPluginIds
    const mappedPluginId = pluginIds && Object.hasOwn(pluginIds, record.objectClass)
      ? pluginIds[record.objectClass]
      : undefined
    const pluginId = typeof mappedPluginId === 'string' ? mappedPluginId : undefined
    const lookupOptions = {
      ...(behaviorType === undefined ? {} : { behaviorType }),
      ...(pluginId === undefined ? {} : { pluginId }),
    }
    const definition = kind === 'condition'
      ? aceRegistry.getCondition(record.objectClass, record.id, lookupOptions)
      : aceRegistry.getAction(record.objectClass, record.id, lookupOptions)
    const parameterRecord = record.parameters === undefined ? {} : record.parameters
    if (!isRecord(parameterRecord) || !isJsonValue(parameterRecord)) {
      const issue = diagnostic(`construct.invalid-${kind}-parameters`, `Construct ${kind} parameters must be an object.`, 'error', nodeId, parseOptions.sourceId, { path })
      outputDiagnostics.push(issue)
      return invalidNode(kind, nodeId, raw, issue, sourceLocation)
    }

    if (!definition && kind === 'action' && record.objectClass === 'Functions') {
      const parameterIds = Object.keys(parameterRecord)
      return {
        type: 'action',
        id: nodeId,
        operation: `Functions.${record.id}`,
        parameters: parameterIds.map((parameterId) => parameterExpression(parameterRecord[parameterId] ?? null, 'any')),
        parameterIds,
        ...(sourceLocation === undefined ? {} : { sourceLocation }),
        metadata: rawMetadata(record),
      }
    }
    if (!definition) {
      outputDiagnostics.push(diagnostic(`construct.unknown-${kind}`, `No registered Construct ${kind} for ${record.objectClass}.${record.id}.`, 'warning', nodeId, parseOptions.sourceId, { path, objectClass: record.objectClass, aceId: record.id }))
      return unknownNode(kind, nodeId, raw, sourceLocation)
    }

    const parameters = mapParameters(parameterRecord, definition, nodeId, `${path}.parameters`, kind, parseOptions, outputDiagnostics)
    const base = {
      id: nodeId,
      operation: `${record.objectClass}.${definition.id}`,
      parameters,
      ...(definition.parameters === undefined ? {} : { parameterIds: definition.parameters.map(({ id }) => id) }),
      ...(sourceLocation === undefined ? {} : { sourceLocation }),
      metadata: rawMetadata(record, pluginId === undefined ? {} : { pluginId }),
    }
    if (kind === 'condition') {
      const isInverted = record.isInverted === true
      return {
        type: 'condition',
        ...base,
        ...(isInverted ? { inverted: true } : {}),
      }
    }
    return { type: 'action', ...base }
  }

  function mapParameters(
    rawParameters: Record<string, unknown>,
    definition: ConditionDefinition | ActionDefinition,
    nodeId: string,
    parameterPath: string,
    kind: 'condition' | 'action',
    parseOptions: ParseConstructOptions,
    outputDiagnostics: Diagnostic[],
  ): Expression[] {
    const definitions = definition.parameters ?? []
    const parameterKeys = Object.keys(rawParameters)
    const values = Object.values(rawParameters)
    if (!definition.parameters) {
      if (values.length > 0) outputDiagnostics.push(diagnostic(
        `construct.unmapped-${kind}-parameters`,
        `Registered ${kind} ${(definition.behaviorType ?? definition.objectClass ?? 'Construct')}.${definition.id} has no parameter definitions; raw parameters were retained.`,
        'warning', nodeId, parseOptions.sourceId,
      ))
      return []
    }

    return definitions.map((parameter, index) => {
      const present = Object.hasOwn(rawParameters, parameter.id) || index < values.length
      if (!present) {
        if (parameter.optional === true) return { type: 'incomplete', sourceText: '', expected: [parameter.id] }
        outputDiagnostics.push(diagnostic(
          'construct.incomplete-parameter',
          `Construct ${kind} is missing parameter "${parameter.id}".`,
          'warning', nodeId, parseOptions.sourceId, { parameterId: parameter.id },
        ))
        return { type: 'incomplete', sourceText: '', expected: [parameter.id] }
      }
      const parameterKey = Object.hasOwn(rawParameters, parameter.id) ? parameter.id : parameterKeys[index]
      const value = parameterKey === undefined ? values[index] : rawParameters[parameterKey]
      if (!isJsonValue(value)) return { type: 'unknown', sourceText: String(value) }
      const expression = parameterExpression(value, parameter.type)
      if (expression.type === 'unknown' || expression.type === 'incomplete') outputDiagnostics.push(diagnostic(
        expression.type === 'incomplete' ? 'construct.incomplete-expression' : 'construct.unknown-expression',
        expression.type === 'incomplete'
          ? `Construct parameter "${parameter.id}" contains an incomplete expression.`
          : `Could not parse the expression for Construct parameter "${parameter.id}"; its source was preserved.`,
        'warning', nodeId, parseOptions.sourceId, { parameterId: parameter.id, sourceText: expression.sourceText },
      ))
      const sourceLocation = parameterKey === undefined ? undefined : sourceLocationAt(`${parameterPath}.${parameterKey}`)
      return sourceLocation ? { ...expression, sourceLocation } : expression
    })
  }
}

function parameterExpression(value: JsonValue, type: ConstructParameterType): Expression {
  if (type === 'any' || type === 'number') return parseConstructExpression(value, typeof value === 'string' ? value : JSON.stringify(value))
  if (type === 'string' && typeof value === 'string') {
    const sourceText = value.trim()
    if (sourceText.startsWith('"') && sourceText.endsWith('"')) {
      const expression = parseConstructExpression(value, value)
      if (expression.type === 'literal' && typeof expression.value === 'string') return expression
    }
  }
  if (type === 'boolean' && (value === 'true' || value === 'false')) {
    return { type: 'literal', value: value === 'true' }
  }
  return parseConstructLiteral(value)
}

function constructVariableInitialValue(dataType: string, value: JsonValue): Expression {
  if (dataType === 'string') return parseConstructLiteral(typeof value === 'string' ? value : String(value))
  if (dataType === 'boolean' && (value === 'true' || value === 'false')) {
    return { type: 'literal', value: value === 'true', sourceText: value }
  }
  if (dataType === 'number') return parseConstructExpression(value, typeof value === 'string' ? value : JSON.stringify(value))
  return parseConstructLiteral(value)
}

function incompleteDocument(source: string, options: ParseConstructOptions, code: string, message: string): ParseResult {
  const diagnostics = [diagnostic(code, message, 'error', undefined, options.sourceId, { sourceLength: source.length })]
  const sourceLocation = location(options.sourceId)
  const safeSourceId = options.sourceId?.replaceAll('\\', '/').replaceAll('/', ':') ?? 'root'
  const incompleteId = `construct:incomplete-sheet:${safeSourceId}`
  const sheet: IncompleteNode<'sheet'> = {
    type: 'incomplete',
    nodeType: 'sheet',
    id: incompleteId,
    ...(sourceLocation === undefined ? {} : { sourceLocation }),
    sourceText: source,
    expected: ['Construct event sheet object with events array'],
  }
  const document: EventDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: `construct-document:incomplete:${safeSourceId}`,
    engine: { id: 'construct' },
    sheets: [sheet],
    variables: [],
  }
  return { document, diagnostics, status: 'partial' }
}

function makeDocument(id: string, sheets: EventSheetNode[]): EventDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    engine: { id: 'construct' },
    metadata: { construct: { format: 'event-sheet-json' } },
    sheets,
    variables: [],
  }
}

function incompleteNode<T extends 'sheet' | 'event' | 'condition' | 'action'>(
  nodeType: T,
  id: string,
  raw: Record<string, unknown>,
  expected: string[],
  sourceLocation: SourceLocation | undefined,
): IncompleteNode<T> {
  return {
    type: 'incomplete',
    nodeType,
    id,
    sourceText: JSON.stringify(raw),
    expected,
    ...(sourceLocation === undefined ? {} : { sourceLocation }),
    metadata: rawMetadata(raw),
  }
}

function invalidNode<T extends 'event' | 'condition' | 'action'>(
  nodeType: T,
  id: string,
  raw: JsonValue,
  issue: Diagnostic,
  sourceLocation: SourceLocation | undefined,
): InvalidNode<T> {
  return {
    type: 'invalid',
    nodeType,
    id,
    raw,
    diagnostic: issue,
    ...(sourceLocation === undefined ? {} : { sourceLocation }),
  }
}

function unknownNode<T extends 'event' | 'condition' | 'action' | 'variable'>(
  nodeType: T,
  id: string,
  raw: JsonValue,
  sourceLocation: SourceLocation | undefined,
): UnknownNode<T> {
  return {
    type: 'unknown',
    nodeType,
    id,
    raw,
    ...(sourceLocation === undefined ? {} : { sourceLocation }),
  }
}

function rawMetadata(raw: Record<string, unknown>, extra: JsonObject = {}): JsonObject {
  return { construct: { raw: raw as JsonObject, ...extra } }
}

function uniqueId(
  candidate: string,
  path: string,
  ids: Set<string>,
  diagnostics: Diagnostic[],
  sourceLocation: SourceLocation | undefined,
): string {
  if (!ids.has(candidate)) {
    ids.add(candidate)
    return candidate
  }
  let safeId = `${candidate}:${path}`
  let suffix = 2
  while (ids.has(safeId)) safeId = `${candidate}:${path}:${suffix++}`
  ids.add(safeId)
  diagnostics.push({
    code: 'construct.duplicate-sid',
    severity: 'warning',
    message: `Duplicate Construct SID "${candidate}" was replaced with a path-based ID.`,
    nodeId: safeId,
    ...(sourceLocation === undefined ? {} : { sourceLocation }),
    details: { path, originalId: candidate },
  })
  return safeId
}

function sidId(record: Record<string, unknown> | undefined, path: string, sourceId?: string): string {
  const scopedPath = sourceId === undefined ? path : `${sourceId.replaceAll('\\', '/')}:${path}`
  return `construct:${sidOf(record) ?? scopedPath}`
}

function sidOf(record: Record<string, unknown> | undefined): string | undefined {
  const sid = record?.sid
  if (typeof sid === 'string' && sid.trim()) return sid
  if (typeof sid === 'number' && Number.isSafeInteger(sid) && sid >= 0) return String(sid)
  return undefined
}

function location(sourceId: string | undefined): SourceLocation | undefined {
  return sourceId === undefined ? undefined : { sourceId }
}

interface JsonSourceRange {
  start: number
  end: number
  properties?: Map<string, JsonSourceRange>
  elements?: JsonSourceRange[]
}

function createSourceLocationMap(
  source: string,
  value: unknown,
  sourceId: string | undefined,
  sourceLength = source.length,
): Map<string, SourceLocation> {
  let cursor = 0
  const lineStarts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1)
  }

  function skipWhitespace(): void {
    while (/\s/.test(source[cursor] ?? '')) cursor += 1
  }

  function parseString(): string {
    const start = cursor
    cursor += 1
    let escaped = false
    while (cursor < source.length) {
      const character = source[cursor]
      cursor += 1
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') return JSON.parse(source.slice(start, cursor)) as string
    }
    throw new SyntaxError('Unterminated JSON string.')
  }

  function parseValue(): JsonSourceRange {
    skipWhitespace()
    const start = cursor
    const character = source[cursor]
    if (character === '"') {
      parseString()
      return { start, end: cursor }
    }
    if (character === '{') {
      cursor += 1
      skipWhitespace()
      const properties = new Map<string, JsonSourceRange>()
      if (source[cursor] === '}') cursor += 1
      else {
        while (cursor < source.length) {
          skipWhitespace()
          const key = parseString()
          skipWhitespace()
          if (source[cursor] !== ':') throw new SyntaxError('Expected a JSON colon.')
          cursor += 1
          properties.set(key, parseValue())
          skipWhitespace()
          if (source[cursor] === '}') {
            cursor += 1
            break
          }
          if (source[cursor] !== ',') throw new SyntaxError('Expected a JSON comma.')
          cursor += 1
        }
      }
      return { start, end: cursor, properties }
    }
    if (character === '[') {
      cursor += 1
      skipWhitespace()
      const elements: JsonSourceRange[] = []
      if (source[cursor] === ']') cursor += 1
      else {
        while (cursor < source.length) {
          elements.push(parseValue())
          skipWhitespace()
          if (source[cursor] === ']') {
            cursor += 1
            break
          }
          if (source[cursor] !== ',') throw new SyntaxError('Expected a JSON comma.')
          cursor += 1
        }
      }
      return { start, end: cursor, elements }
    }
    while (cursor < source.length && !/[\s,\]}]/.test(source[cursor] ?? '')) cursor += 1
    if (cursor === start) throw new SyntaxError('Expected a JSON value.')
    return { start, end: cursor }
  }

  let root: JsonSourceRange
  try {
    root = parseValue()
    skipWhitespace()
    if (cursor !== source.length) return new Map()
  } catch {
    return new Map()
  }

  const output = new Map<string, SourceLocation>()
  const endLimit = Math.min(source.length, sourceLength)
  function position(offset: number): { line: number; column: number } {
    let low = 0
    let high = lineStarts.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if ((lineStarts[middle] ?? 0) <= offset) low = middle + 1
      else high = middle
    }
    const lineIndex = Math.max(0, low - 1)
    return { line: lineIndex + 1, column: offset - (lineStarts[lineIndex] ?? 0) + 1 }
  }

  function visit(value: unknown, range: JsonSourceRange, path: string): void {
    const offsetStart = Math.min(range.start, endLimit)
    const offsetEnd = Math.max(offsetStart, Math.min(range.end, endLimit))
    const start = position(offsetStart)
    const end = position(offsetEnd)
    output.set(path, {
      ...(sourceId === undefined ? {} : { sourceId }),
      offsetStart,
      offsetEnd,
      lineStart: start.line,
      lineEnd: end.line,
      columnStart: start.column,
      columnEnd: end.column,
    })

    if (Array.isArray(value) && range.elements) {
      value.forEach((child, index) => {
        const childRange = range.elements?.[index]
        if (childRange) visit(child, childRange, `${path}[${index}]`)
      })
    } else if (isRecord(value) && range.properties) {
      for (const [key, child] of Object.entries(value)) {
        const childRange = range.properties.get(key)
        if (childRange) visit(child, childRange, path ? `${path}.${key}` : key)
      }
    }
  }

  visit(value, root, '')
  return output
}

function diagnostic(
  code: string,
  message: string,
  severity: Diagnostic['severity'],
  nodeId?: string,
  sourceId?: string,
  details?: JsonValue,
): Diagnostic {
  return {
    code,
    message,
    severity,
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(sourceId === undefined ? {} : { sourceLocation: { sourceId } }),
    ...(details === undefined ? {} : { details }),
  }
}

function closeTruncatedJson(source: string): string | undefined {
  if (!source.trim()) return undefined
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (const character of source) {
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{' || character === '[') stack.push(character)
    else if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '['
      if (stack.pop() !== expected) return undefined
    }
  }
  let suffix = ''
  if (inString) suffix += escaped ? '\\"' : '"'
  while (stack.length) suffix += stack.pop() === '{' ? '}' : ']'
  try {
    JSON.parse(source + suffix)
    return source + suffix
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isJsonValue(value: unknown, ancestors = new WeakSet<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || ancestors.has(value)) return false
  ancestors.add(value)
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : Object.values(value).every((entry) => isJsonValue(entry, ancestors))
  ancestors.delete(value)
  return valid
}
