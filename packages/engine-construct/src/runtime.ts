import { isJsonObject } from '@project/schema'
import type {
  Condition,
  Diagnostic,
  AceInvocationScope,
  HostAdapter,
  JsonObject,
  JsonValue,
  ParseStatus,
  FunctionDefinition,
  VariableDeclaration,
  VariableNode,
} from '@project/schema'
import type { CompiledAction, CompiledCondition, CompiledConstructDocument, CompiledEvent } from './compiler.js'
import { compareConstructValues, evaluateConstructExpression, type ConstructEvaluationContext, type ConstructEvaluationResult } from './expression-runtime.js'

interface FunctionFrame {
  definition: FunctionDefinition
  parameters: JsonValue[]
  variables: Map<string, JsonValue>
  initialVariables: Map<string, JsonValue>
  staticVariableKeys?: Map<string, string>
  returnValue: JsonValue
  lastCallReturnValue: JsonValue
}

interface EventVariableFrame {
  variables: Map<string, JsonValue>
  initialVariables: Map<string, JsonValue>
  staticVariableKeys: Map<string, string>
}

export interface ConstructSelectionContext<TInstance = unknown> {
  selectionsByObjectType: Map<string, Set<TInstance>>
  familySelections: Map<string, Set<TInstance>>
  parentContext?: ConstructSelectionContext<TInstance>
  containerRelationships: Map<TInstance, Set<TInstance>>
  createdInstances: Set<TInstance>
}

export function createSelectionContext<TInstance = unknown>(
  parentContext?: ConstructSelectionContext<TInstance>,
): ConstructSelectionContext<TInstance> {
  return {
    selectionsByObjectType: new Map(),
    familySelections: new Map(),
    ...(parentContext === undefined ? {} : { parentContext }),
    containerRelationships: new Map(),
    createdInstances: new Set(),
  }
}

export type ExecutionTraceKind = 'sheet' | 'event' | 'condition' | 'action'
export type ExecutionTraceStatus = 'selected' | 'passed' | 'failed' | 'executed' | 'skipped' | 'unsupported'

export interface ExecutionTraceEntry {
  sequence: number
  kind: ExecutionTraceKind
  nodeId: string
  status: ExecutionTraceStatus
  parentNodeId?: string
  details?: JsonObject
}

export interface ExecutionTrace {
  documentId: string
  sheetId: string
  status: ParseStatus
  entries: ExecutionTraceEntry[]
  diagnostics: Diagnostic[]
}

export interface ConstructTrigger<TInstance = unknown> {
  operation: string
  parameters?: readonly JsonValue[]
  selectionsByObjectType?: Readonly<Record<string, readonly TInstance[]>>
}

export interface ConstructRuntime<TInstance = unknown, TContext = unknown> {
  readonly adapter: HostAdapter<TContext, TInstance>
  readonly selection: ConstructSelectionContext<TInstance>
  readonly variables: Map<string, JsonValue>
  run(document: CompiledConstructDocument, sheetId: string): ExecutionTrace
  dispatchTrigger(document: CompiledConstructDocument, sheetId: string, trigger: ConstructTrigger<TInstance>): ExecutionTrace
  reset(): void
}

/** Run the supported Construct subset and return a structured trace. */
export function createConstructRuntime<TInstance = unknown, TContext = unknown>(
  adapter: HostAdapter<TContext, TInstance>,
): ConstructRuntime<TInstance, TContext> {
  const selection = createSelectionContext<TInstance>()
  const variables = new Map<string, JsonValue>()
  const initialVariableValues = new Map<string, JsonValue>()
  const groupActiveByName = new Map<string, boolean>()
  const triggerOnceActiveEvents = new Set<string>()
  const loopStack: Array<{ name: string; index: number; stopRequested: boolean }> = []
  const staticEventVariableState = new Map<string, { value: JsonValue; initialValue: JsonValue }>()
  let initializedDocumentId: string | undefined
  const initializedSheetIds = new Set<string>()

  function run(document: CompiledConstructDocument, sheetId: string): ExecutionTrace {
    return execute(document, sheetId)
  }

  function dispatchTrigger(
    document: CompiledConstructDocument,
    sheetId: string,
    trigger: ConstructTrigger<TInstance>,
  ): ExecutionTrace {
    return execute(document, sheetId, trigger)
  }

  function execute(
    document: CompiledConstructDocument,
    sheetId: string,
    trigger?: ConstructTrigger<TInstance>,
  ): ExecutionTrace {
    clearSelection(selection)
    loopStack.length = 0
    const loopIterations = new Map<CompiledCondition, Array<{
      name: string
      index: number
      selection: ConstructSelectionContext<TInstance>
    }>>()
    for (const [objectType, instances] of Object.entries(trigger?.selectionsByObjectType ?? {})) {
      selection.selectionsByObjectType.set(objectType, new Set(instances))
    }
    const diagnostics = [...document.diagnostics]
    const functionStack: FunctionFrame[] = []
    const variableScopes: Array<Pick<FunctionFrame, 'variables' | 'initialVariables' | 'staticVariableKeys'>> = []
    let lastFunctionReturnValue: JsonValue = 0
    if (document.engineId !== 'construct') {
      diagnostics.push(runtimeDiagnostic(
        'construct.runtime.wrong-engine',
        'Cannot run a ' + document.engineId + ' compiled document with the Construct runtime.',
      ))
    }
    if (adapter.engineId !== 'construct') {
      diagnostics.push(runtimeDiagnostic(
        'construct.runtime.wrong-adapter',
        'The Construct runtime requires a Construct host adapter.',
      ))
    }

    const sheet = document.sheets.find(({ source }) => source.id === sheetId)
    if (!sheet) {
      diagnostics.push(runtimeDiagnostic(
        'construct.runtime.missing-sheet',
        'Compiled document "' + document.documentId + '" has no sheet "' + sheetId + '".',
        sheetId,
      ))
    }
    const entries: ExecutionTraceEntry[] = []
    let sequence = 0
    const addEntry = (
      kind: ExecutionTraceKind,
      nodeId: string,
      status: ExecutionTraceStatus,
      parentNodeId?: string,
      details?: JsonObject,
    ): ExecutionTraceEntry => {
      const result: ExecutionTraceEntry = {
        sequence: sequence++,
        kind,
        nodeId,
        status,
        ...(parentNodeId === undefined ? {} : { parentNodeId }),
        ...(details === undefined ? {} : { details }),
      }
      entries.push(result)
      return result
    }

    if (sheet && !('type' in sheet.source)) {
      if (initializedDocumentId !== document.documentId) {
        variables.clear()
        initialVariableValues.clear()
        initializedSheetIds.clear()
        staticEventVariableState.clear()
        triggerOnceActiveEvents.clear()
        groupActiveByName.clear()
        initializedDocumentId = document.documentId
        initializeVariables(document.variables, undefined, diagnostics)
        initializeGroupStates(document)
      }
      if (!initializedSheetIds.has(sheet.source.id)) {
        initializeVariables(undefined, sheet.variables, diagnostics)
        initializedSheetIds.add(sheet.source.id)
      }
      resetLocalVariables(document.variables)
      resetLocalVariables(sheet.variables)
      addEntry('sheet', sheet.source.id, 'selected')
      runSiblings(sheet.events, undefined, undefined, trigger)
    }

    return {
      documentId: document.documentId,
      sheetId,
      status: diagnostics.some(({ severity }) => severity === 'warning' || severity === 'error') ? 'partial' : 'complete',
      entries,
      diagnostics,
    }

    function initializeVariables(
      documentVariables: VariableNode[] | undefined,
      sheetVariables: VariableNode[] | undefined,
      outputDiagnostics: Diagnostic[],
    ): void {
      const initialContext = evaluationContext(createSelectionContext(selection))
      for (const variable of [...(documentVariables ?? []), ...(sheetVariables ?? [])]) {
        if ('type' in variable) {
          outputDiagnostics.push(runtimeDiagnostic(
            'construct.runtime.unsupported-variable',
            'Variable "' + variable.id + '" cannot be initialized because it is a recovery node.',
            variable.id,
          ))
          continue
        }
        const value = initialVariableValue(variable, initialContext, outputDiagnostics)
        if (value !== undefined) {
          variables.set(variable.name, value)
          initialVariableValues.set(variable.name, value)
        }
      }
    }

    function resetLocalVariables(variableNodes: VariableNode[] | undefined): void {
      for (const variable of variableNodes ?? []) {
        if ('type' in variable || variable.scope !== 'local' || isStaticVariable(variable)) continue
        if (initialVariableValues.has(variable.name)) {
          variables.set(variable.name, initialVariableValues.get(variable.name) as JsonValue)
        }
      }
    }

    function initialVariableValue(
      variable: VariableDeclaration,
      context: ConstructEvaluationContext<TInstance, TContext>,
      outputDiagnostics: Diagnostic[],
    ): JsonValue | undefined {
      if (!variable.initialValue) return defaultVariableValue(variable.dataType)
      const value = safeEvaluate(variable.initialValue, context, variable.id, outputDiagnostics)
      return value?.value
    }

    function runSiblings(
      siblings: CompiledEvent[],
      parent?: ConstructSelectionContext<TInstance>,
      parentNodeId?: string,
      activeTrigger?: ConstructTrigger<TInstance>,
    ): void {
      let previousSiblingRan = false
      let previousSiblingWasTrigger = false
      let hasPreviousSibling = false
      for (const sibling of siblings) {
        if (sibling.source.type === 'event' && sibling.source.eventKind === 'comment') {
          runEvent(
            sibling,
            parent,
            parentNodeId,
            previousSiblingRan,
            activeTrigger,
            hasPreviousSibling,
            previousSiblingWasTrigger,
          )
          continue
        }
        previousSiblingRan = runEvent(
          sibling,
          parent,
          parentNodeId,
          previousSiblingRan,
          activeTrigger,
          hasPreviousSibling,
          previousSiblingWasTrigger,
        )
        previousSiblingWasTrigger = isTriggerEvent(sibling)
        hasPreviousSibling = true
      }
    }

    function invokeFunction(
      name: string,
      parameters: readonly JsonValue[],
      callSiteNodeId: string,
      callerSelection?: ConstructSelectionContext<TInstance>,
      allowNoneReturn = false,
      customActionSelection?: { ownerObjectClass: string; targetObjectClass: string },
    ): ConstructEvaluationResult {
      const compiled = document.functions.find(({ source }) => source.name.toLowerCase() === name.toLowerCase())
      if (!compiled) return { supported: false, reason: 'Function "' + name + '" is not defined.' }
      const returnType = compiled.source.returnType?.toLowerCase() ?? 'none'
      if (returnType === 'none' && !allowNoneReturn) {
        return { supported: false, reason: 'Function "' + name + '" has no return value.' }
      }
      if (functionStack.length >= 64) {
        return { supported: false, reason: 'Function call depth exceeded the runtime limit of 64.' }
      }

      const localVariables = new Map<string, JsonValue>()
      compiled.source.parameters.forEach((parameter, index) => {
        localVariables.set(parameter.name, parameters[index] ?? null)
      })
      const frame: FunctionFrame = {
        definition: compiled.source,
        parameters: [...parameters],
        variables: localVariables,
        initialVariables: new Map(localVariables),
        returnValue: 0,
        lastCallReturnValue: 0,
      }
      const callerFrame = functionStack.at(-1)
      functionStack.push(frame)
      variableScopes.push(frame)
      try {
        let functionSelection = compiled.copyPicked && callerSelection
          ? forkSelectionContext(callerSelection)
          : createSelectionContext<TInstance>()
        if (customActionSelection && !compiled.copyPicked) {
          const callingSelection = callerSelection ?? selection
          const targetInstances = currentObjects(customActionSelection.targetObjectClass, callingSelection)
          functionSelection = createSelectionContext<TInstance>()
          setPickedInstances(functionSelection, customActionSelection.ownerObjectClass, targetInstances)
        }
        // Function selection changes never leak back to the calling event.
        runSiblings(compiled.body, functionSelection, callSiteNodeId)
      } finally {
        variableScopes.pop()
        functionStack.pop()
      }
      lastFunctionReturnValue = frame.returnValue
      if (callerFrame) callerFrame.lastCallReturnValue = frame.returnValue
      return { supported: true, value: frame.returnValue }
    }

    function runEvent(
      event: CompiledEvent,
      parent?: ConstructSelectionContext<TInstance>,
      parentNodeId?: string,
      previousSiblingRan = false,
      activeTrigger?: ConstructTrigger<TInstance>,
      hasPreviousSibling = false,
      previousSiblingWasTrigger = false,
    ): boolean {
      const declarations = event.source.type === 'event' ? event.source.variables : undefined
      if (!declarations || declarations.length === 0) {
        return runEventBody(event, parent, parentNodeId, previousSiblingRan, activeTrigger, hasPreviousSibling, previousSiblingWasTrigger)
      }

      const frame: EventVariableFrame = {
        variables: new Map(),
        initialVariables: new Map(),
        staticVariableKeys: new Map(),
      }
      variableScopes.push(frame)
      try {
        const initialSelection = parent ?? selection
        for (const variable of declarations) {
          if ('type' in variable) {
            diagnostics.push(runtimeDiagnostic(
              'construct.runtime.unsupported-variable',
              'Local variable "' + variable.id + '" cannot be initialized because it is a recovery node.',
              variable.id,
            ))
            continue
          }
          const staticKey = document.documentId + ':' + event.source.id + ':' + variable.id
          const isStatic = isStaticVariable(variable)
          const staticState = isStatic ? staticEventVariableState.get(staticKey) : undefined
          const initialValue = staticState
            ? staticState.initialValue
            : initialVariableValue(variable, evaluationContext(initialSelection), diagnostics)
              ?? defaultVariableValue(variable.dataType)
          const value = staticState ? staticState.value : initialValue
          frame.variables.set(variable.name, value)
          frame.initialVariables.set(variable.name, initialValue)
          if (isStatic) frame.staticVariableKeys.set(variable.name, staticKey)
        }
        return runEventBody(event, parent, parentNodeId, previousSiblingRan, activeTrigger, hasPreviousSibling, previousSiblingWasTrigger)
      } finally {
        for (const [name, key] of frame.staticVariableKeys) {
          const value = frame.variables.get(name)
          const initialValue = frame.initialVariables.get(name)
          if (value !== undefined && initialValue !== undefined) {
            staticEventVariableState.set(key, { value, initialValue })
          }
        }
        variableScopes.pop()
      }
    }

    function runEventBody(
      event: CompiledEvent,
      parent?: ConstructSelectionContext<TInstance>,
      parentNodeId?: string,
      previousSiblingRan = false,
      activeTrigger?: ConstructTrigger<TInstance>,
      hasPreviousSibling = false,
      previousSiblingWasTrigger = false,
    ): boolean {
      if (event.source.type !== 'event') {
        addEntry('event', event.source.id, 'unsupported', parentNodeId, { nodeType: event.source.nodeType })
        return false
      }
      if (event.source.eventKind === 'function') {
        addEntry('event', event.source.id, 'skipped', parentNodeId, { reason: 'function-definition' })
        skipContents(event, event.source.id)
        return false
      }
      if (event.source.eventKind === 'comment') {
        addEntry('event', event.source.id, 'skipped', parentNodeId, { reason: 'comment' })
        skipContents(event, event.source.id)
        return false
      }
      const groupName = event.source.eventKind === 'group' ? event.source.label : undefined
      const groupActive = groupName === undefined ? undefined : groupActiveByName.get(groupName)
      const inactiveOnStart = event.source.eventKind === 'group'
        && (groupActive === false || (groupActive === undefined && event.source.initiallyEnabled === false))
      const disabled = event.source.enabled === false
      if (disabled || inactiveOnStart) {
        addEntry('event', event.source.id, 'skipped', parentNodeId, {
          reason: disabled ? 'disabled' : 'inactive-on-start',
        })
        skipContents(event, event.source.id)
        return false
      }

      const currentSelection = parent ? forkSelectionContext(parent) : forkSelectionContext(selection)
      const hasTrigger = event.conditions.some(isTriggerCondition)
      const hasTriggerDescendant = event.children.some(containsTrigger)
      const isTriggerParent = activeTrigger !== undefined && !hasTrigger && hasTriggerDescendant
      if (hasTrigger && activeTrigger === undefined) {
        addEntry('event', event.source.id, 'skipped', parentNodeId, { reason: 'awaiting-trigger' })
        skipContents(event, event.source.id)
        return false
      }
      if (hasTrigger && activeTrigger !== undefined && !event.conditions.some((condition) =>
        isTriggerCondition(condition) && triggerMatches(condition, activeTrigger, evaluationContext(currentSelection)),
      )) {
        addEntry('event', event.source.id, 'skipped', parentNodeId, { reason: 'trigger-not-matched' })
        skipContents(event, event.source.id)
        return false
      }
      if (activeTrigger !== undefined && !hasTrigger && !hasTriggerDescendant) {
        addEntry('event', event.source.id, 'skipped', parentNodeId, { reason: 'not-triggered' })
        skipContents(event, event.source.id)
        return false
      }

      const eventEntry = addEntry('event', event.source.id, 'failed', parentNodeId)
      const loopingConditions = event.conditions.filter((condition) => condition.definition?.isLooping === true)
      if (loopingConditions.length > 0 && event.source.isOrBlock === true) {
        eventEntry.status = 'unsupported'
        diagnostics.push(runtimeDiagnostic(
          'construct.runtime.unsupported-loop-shape',
          'Looping conditions inside OR blocks are not supported.',
          event.source.id,
        ))
        for (const condition of event.conditions) skipCondition(condition, event.source.id)
        skipActionsAndChildren(event)
        return false
      }
      const elseConditions = event.conditions.filter(isElseCondition)
      const isElseEvent = event.source.isElse === true || elseConditions.length > 0
      if (isElseEvent) {
        if (activeTrigger !== undefined || !hasPreviousSibling || previousSiblingWasTrigger) {
          eventEntry.status = 'unsupported'
          diagnostics.push(runtimeDiagnostic(
            'construct.runtime.invalid-else-position',
            activeTrigger !== undefined
              ? 'Else events cannot be evaluated during trigger dispatch.'
              : 'Else must follow a non-trigger event in the same sibling list.',
            event.source.id,
          ))
          skipActionsAndChildren(event)
          return false
        }
        eventEntry.details = { isElse: true, previousSiblingRan }
        for (const condition of event.conditions) {
          if (isElseCondition(condition)) {
            addEntry('condition', condition.source.id, previousSiblingRan ? 'failed' : 'passed', event.source.id, {
              operation: 'System.else',
              result: !previousSiblingRan,
            })
          } else if (previousSiblingRan) {
            skipCondition(condition, event.source.id)
          }
        }
        if (previousSiblingRan) {
          eventEntry.status = 'failed'
          skipActionsAndChildren(event)
          return false
        }
      }

      let conditionsPassed = true
      const conditions = event.conditions.filter((condition) => !isElseCondition(condition))
      if (event.source.isOrBlock === true) {
        if (conditions.length === 0) {
          conditionsPassed = false
          eventEntry.status = 'unsupported'
          diagnostics.push(runtimeDiagnostic(
            'construct.runtime.empty-or-block',
            'An OR block must contain at least one condition.',
            event.source.id,
          ))
        } else {
          const result = runOrConditions(conditions, currentSelection, event.source.id, activeTrigger)
          conditionsPassed = result.passed
          if (result.status === 'unsupported') eventEntry.status = 'unsupported'
        }
      } else {
        const loopCondition = loopingConditions[0]
        const loopConditionIndex = loopCondition === undefined ? -1 : conditions.indexOf(loopCondition)
        for (const [index, condition] of conditions.entries()) {
          if (loopConditionIndex >= 0 && index > loopConditionIndex) {
            skipCondition(condition, event.source.id)
            continue
          }
          if (!conditionsPassed) {
            if (isTriggerOnceCondition(condition)) triggerOnceActiveEvents.delete(event.source.id)
            skipCondition(condition, event.source.id)
            continue
          }
          const result = runCondition(condition, currentSelection, event.source.id, activeTrigger)
          if (result.status === 'unsupported') {
            conditionsPassed = false
            eventEntry.status = 'unsupported'
          } else if (!result.passed) {
            conditionsPassed = false
          }
        }
      }
      if (!conditionsPassed) {
        if (eventEntry.status !== 'unsupported') eventEntry.status = 'failed'
        skipActionsAndChildren(event)
        return false
      }

      eventEntry.status = 'passed'
      if (loopingConditions.length > 0) {
        let bodyRuns = 0
        let unsupportedBody = false
        let iterationFrames = 0
        const loopConditionIndices = loopingConditions.map((condition) => conditions.indexOf(condition))

        const executeLoopLevel = (level: number, parentSelection: ConstructSelectionContext<TInstance>): void => {
          const loopCondition = loopingConditions[level]
          const loopConditionIndex = loopConditionIndices[level]
          if (!loopCondition || loopConditionIndex === undefined || loopConditionIndex < 0) {
            unsupportedBody = true
            skipIterationBody(event)
            return
          }

          if (level > 0) {
            const result = runCondition(loopCondition, parentSelection, event.source.id, activeTrigger)
            if (result.status === 'unsupported') {
              unsupportedBody = true
              skipIterationBody(event)
              return
            }
            if (!result.passed) return
          }

          const isWhile = loopCondition.source.type === 'condition'
            && loopCondition.source.operation === 'System.repeat-while'
          const iterations = isWhile ? undefined : loopIterations.get(loopCondition)
          if (!isWhile && iterations === undefined) {
            unsupportedBody = true
            skipIterationBody(event)
            return
          }

          const maxIterations = isWhile ? 10_000 : iterations?.length ?? 0
          const nextLoopConditionIndex = loopConditionIndices[level + 1]
          const endOfConditions = nextLoopConditionIndex ?? conditions.length
          const conditionsAfterLoop = conditions.slice(loopConditionIndex + 1, endOfConditions)
          let stopped = false
          for (let index = 0; index < maxIterations; index += 1) {
            iterationFrames += 1
            if (loopingConditions.length > 1 && iterationFrames > 10_000) {
              diagnostics.push(runtimeDiagnostic(
                'construct.runtime.loop-iteration-limit',
                'Nested loops stopped after reaching the runtime limit of 10000 total iterations.',
                loopCondition.source.id,
              ))
              unsupportedBody = true
              skipIterationBody(event)
              stopped = true
              break
            }

            const iteration = iterations?.[index] ?? {
              name: '',
              index,
              selection: forkSelectionContext(parentSelection),
            }
            const loopFrame = { name: iteration.name, index: iteration.index, stopRequested: false }
            loopStack.push(loopFrame)
            try {
              const bodyConditions = runLoopBodyConditions(
                conditionsAfterLoop,
                iteration.selection,
                event.source.id,
                activeTrigger,
              )
              if (bodyConditions.status === 'unsupported') {
                unsupportedBody = true
                skipIterationBody(event)
                stopped = true
              } else if (!bodyConditions.passed) {
                skipIterationBody(event)
                if (isWhile) stopped = true
              } else if (nextLoopConditionIndex !== undefined) {
                executeLoopLevel(level + 1, iteration.selection)
                if (unsupportedBody) stopped = true
              } else {
                bodyRuns += 1
                if (isTriggerParent) {
                  for (const action of event.actions) {
                    addEntry('action', action.source.id, 'skipped', event.source.id, { reason: 'trigger-parent' })
                  }
                } else {
                  for (const action of event.actions) runAction(action, iteration.selection, event.source.id)
                }
                runSiblings(event.children, iteration.selection, event.source.id, activeTrigger)
              }
              if (loopFrame.stopRequested) stopped = true
            } finally {
              loopStack.pop()
            }
            if (stopped || loopFrame.stopRequested) break
          }
          if (isWhile && !stopped && maxIterations === 10_000) {
            diagnostics.push(runtimeDiagnostic(
              'construct.runtime.while-iteration-limit',
              'While stopped after reaching the runtime limit of 10000 iterations.',
              loopCondition.source.id,
            ))
            unsupportedBody = true
          }
        }

        executeLoopLevel(0, currentSelection)
        eventEntry.details = { loopCount: bodyRuns }
        eventEntry.status = unsupportedBody ? 'unsupported' : bodyRuns > 0 ? 'passed' : 'failed'
        return bodyRuns > 0
      }
      if (isTriggerParent) {
        eventEntry.details = { triggerParent: true }
        for (const action of event.actions) addEntry('action', action.source.id, 'skipped', event.source.id, { reason: 'trigger-parent' })
      } else {
        for (const action of event.actions) runAction(action, currentSelection, event.source.id)
      }
      runSiblings(event.children, currentSelection, event.source.id, activeTrigger)
      return true
    }

    function runLoopBodyConditions(
      conditions: CompiledCondition[],
      currentSelection: ConstructSelectionContext<TInstance>,
      parentNodeId: string,
      activeTrigger?: ConstructTrigger<TInstance>,
    ): { status: 'supported' | 'unsupported'; passed: boolean } {
      let passed = true
      for (const condition of conditions) {
        if (!passed) {
          skipCondition(condition, parentNodeId)
          continue
        }
        const result = runCondition(condition, currentSelection, parentNodeId, activeTrigger)
        if (result.status === 'unsupported') return result
        passed = result.passed
      }
      return { status: 'supported', passed }
    }

    function skipIterationBody(event: CompiledEvent): void {
      for (const action of event.actions) addEntry('action', action.source.id, 'skipped', event.source.id)
      for (const child of event.children) skipEvent(child, event.source.id)
    }

    function runOrConditions(
      conditions: CompiledCondition[],
      currentSelection: ConstructSelectionContext<TInstance>,
      parentNodeId: string,
      activeTrigger?: ConstructTrigger<TInstance>,
    ): { status: 'supported' | 'unsupported'; passed: boolean } {
      const passingBranches: ConstructSelectionContext<TInstance>[] = []
      let hasUnsupportedCondition = false
      for (const condition of conditions) {
        const branch = forkSelectionContext(currentSelection)
        const result = runCondition(condition, branch, parentNodeId, activeTrigger)
        if (result.status === 'unsupported') hasUnsupportedCondition = true
        else if (result.passed) passingBranches.push(branch)
      }
      if (hasUnsupportedCondition) return { status: 'unsupported', passed: false }
      if (passingBranches.length === 0) return { status: 'supported', passed: false }
      mergeOrSelections(currentSelection, passingBranches)
      return { status: 'supported', passed: true }
    }

    function mergeOrSelections(
      target: ConstructSelectionContext<TInstance>,
      passingBranches: readonly ConstructSelectionContext<TInstance>[],
    ): void {
      const objectTypes = new Set<string>()
      for (const branch of passingBranches) {
        for (const objectType of branch.selectionsByObjectType.keys()) objectTypes.add(objectType)
        for (const objectType of branch.familySelections.keys()) objectTypes.add(objectType)
      }
      for (const objectType of target.selectionsByObjectType.keys()) objectTypes.add(objectType)
      for (const objectType of target.familySelections.keys()) objectTypes.add(objectType)

      for (const objectType of objectTypes) {
        const union = new Set<TInstance>()
        for (const branch of passingBranches) {
          const selected = branch.selectionsByObjectType.get(objectType)
            ?? branch.familySelections.get(objectType)
            ?? target.selectionsByObjectType.get(objectType)
            ?? target.familySelections.get(objectType)
            ?? adapter.queryObjects(objectType)
          for (const instance of selected) union.add(instance)
        }
        target.familySelections.delete(objectType)
        target.selectionsByObjectType.set(objectType, union)
      }
    }

    function skipActionsAndChildren(event: CompiledEvent): void {
      for (const action of event.actions) addEntry('action', action.source.id, 'skipped', event.source.id)
      for (const child of event.children) skipEvent(child, event.source.id)
    }

    function runCondition(
      condition: CompiledCondition,
      currentSelection: ConstructSelectionContext<TInstance>,
      parentNodeId: string,
      activeTrigger?: ConstructTrigger<TInstance>,
    ): { status: 'supported'; passed: boolean } | { status: 'unsupported'; passed: false } {
      if (condition.source.type !== 'condition' || !condition.definition) {
        addEntry('condition', condition.source.id, 'unsupported', parentNodeId)
        diagnostics.push(runtimeDiagnostic(
          'construct.runtime.unsupported-condition',
          'Condition "' + condition.source.id + '" has no executable Construct handler.',
          condition.source.id,
        ))
        return { status: 'unsupported', passed: false }
      }
      if (condition.source.inverted === true && condition.definition.isInvertible !== true) {
        addEntry('condition', condition.source.id, 'unsupported', parentNodeId, { operation: condition.source.operation })
        diagnostics.push(runtimeDiagnostic(
          'construct.runtime.unsupported-inverted-condition',
          'The registered Construct condition does not support inversion.',
          condition.source.id,
        ))
        return { status: 'unsupported', passed: false }
      }

      const operation = condition.source.operation
      const context = evaluationContext(currentSelection)
      let passed: boolean | undefined
      let selectedCount: number | undefined
      try {
        if (condition.definition.isTrigger) {
          passed = activeTrigger !== undefined && triggerMatches(condition, activeTrigger, context)
        } else if (operation === 'System.every-tick') passed = true
        else if (operation === 'System.for-each' || operation === 'System.for-each-ordered') {
          const objectType = literalString(condition.source.parameters[0])
          if (objectType) {
            let instances = [...currentObjects(objectType, currentSelection)]
            let orderingValid = true
            if (operation === 'System.for-each-ordered') {
              const orderExpression = condition.source.parameters[1]
              if (!orderExpression) {
                orderingValid = false
              } else {
                const ordered = instances.map((instance, index) => ({
                  instance,
                  index,
                  value: safeEvaluate(
                    orderExpression,
                    evaluationContext(currentSelection, { objectType, instance }),
                    condition.source.id,
                    diagnostics,
                  ),
                }))
                if (ordered.some(({ value }) => value === undefined)
                  || ordered.some(({ value }) => value !== undefined
                    && ordered.some((other) => other.value !== undefined
                      && compareOrderedValues(value.value, other.value.value) === undefined))) {
                  orderingValid = false
                } else {
                  ordered.sort((left, right) => {
                    const compared = compareOrderedValues(left.value?.value ?? null, right.value?.value ?? null) ?? 0
                    return compared || left.index - right.index
                  })
                  instances = ordered.map(({ instance }) => instance)
                }
              }
            }
            if (orderingValid) {
              selectedCount = instances.length
              passed = selectedCount > 0
              loopIterations.set(condition, instances.map((instance, index) => {
                const selectionForIteration = forkSelectionContext(currentSelection)
                setPickedInstances(selectionForIteration, objectType, [instance])
                return { name: '', index, selection: selectionForIteration }
              }))
            }
          }
        } else if (operation === 'System.repeat') {
          const countExpression = condition.source.parameters[0]
          if (countExpression) {
            const count = safeEvaluate(countExpression, context, condition.source.id, diagnostics)
            const iterations = count ? loopCount(count.value) : undefined
            if (iterations !== undefined && iterations <= 10_000) {
              selectedCount = iterations
              passed = iterations > 0
              loopIterations.set(condition, Array.from({ length: iterations }, (_, index) => ({
                name: '',
                index,
                selection: forkSelectionContext(currentSelection),
              })))
            } else {
              diagnostics.push(runtimeDiagnostic(
                'construct.runtime.invalid-loop-count',
                'Repeat requires a finite non-negative count of at most 10000.',
                condition.source.id,
              ))
            }
          }
        } else if (operation === 'System.for') {
          const name = constructStringParameter(condition.source.parameters[0])
          const startExpression = condition.source.parameters[1]
          const endExpression = condition.source.parameters[2]
          const start = startExpression
            ? safeEvaluate(startExpression, context, condition.source.id, diagnostics)?.value
            : undefined
          const end = endExpression
            ? safeEvaluate(endExpression, context, condition.source.id, diagnostics)?.value
            : undefined
          if (name !== undefined
            && typeof start === 'number' && Number.isSafeInteger(start)
            && typeof end === 'number' && Number.isSafeInteger(end)) {
            const count = end < start ? 0 : end - start + 1
            if (count <= 10_000) {
              selectedCount = count
              passed = count > 0
              loopIterations.set(condition, Array.from({ length: count }, (_, index) => ({
                name,
                index: start + index,
                selection: forkSelectionContext(currentSelection),
              })))
            } else {
              diagnostics.push(runtimeDiagnostic(
                'construct.runtime.invalid-for-range',
                'For requires a range of at most 10000 iterations.',
                condition.source.id,
              ))
            }
          } else {
            diagnostics.push(runtimeDiagnostic(
              'construct.runtime.invalid-for-range',
              'For requires a string loop name and finite safe integer start and end indexes.',
              condition.source.id,
            ))
          }
        } else if (operation === 'System.repeat-while') passed = true
        else if (operation === 'System.trigger-once-while-true') {
          passed = !triggerOnceActiveEvents.has(parentNodeId)
          triggerOnceActiveEvents.add(parentNodeId)
        }
        else if (operation === 'System.is-group-active') {
          const groupName = constructStringParameter(condition.source.parameters[0])
          const groupActive = groupName === undefined ? undefined : groupActiveByName.get(groupName)
          if (groupActive !== undefined) passed = groupActive
        }
        else if (operation === 'System.compare-two-values') {
          const left = condition.source.parameters[0]
          const comparisonExpression = condition.source.parameters[1]
          const right = condition.source.parameters[2]
          if (left && comparisonExpression && right) {
            const leftValue = safeEvaluate(left, context, condition.source.id, diagnostics)
            const comparisonValue = safeEvaluate(comparisonExpression, context, condition.source.id, diagnostics)
            const rightValue = safeEvaluate(right, context, condition.source.id, diagnostics)
            if (leftValue && comparisonValue && rightValue) {
              const comparison = typeof comparisonValue.value === 'number'
                ? comparisonValue.value
                : Number(comparisonValue.value)
              passed = compareConstructValues(leftValue.value, rightValue.value, comparison)
            }
          }
        } else if (operation === 'System.is-between-values') {
          const valueExpression = condition.source.parameters[0]
          const lowerExpression = condition.source.parameters[1]
          const upperExpression = condition.source.parameters[2]
          if (valueExpression && lowerExpression && upperExpression) {
            const value = safeEvaluate(valueExpression, context, condition.source.id, diagnostics)
            const lower = safeEvaluate(lowerExpression, context, condition.source.id, diagnostics)
            const upper = safeEvaluate(upperExpression, context, condition.source.id, diagnostics)
            if (value && lower && upper) {
              const atOrAboveLower = compareConstructValues(value.value, lower.value, 5)
              const atOrBelowUpper = compareConstructValues(value.value, upper.value, 3)
              if (atOrAboveLower !== undefined && atOrBelowUpper !== undefined) {
                passed = atOrAboveLower && atOrBelowUpper
              }
            }
          }
        } else if (operation === 'System.compare-eventvar') {
          const variableName = literalString(condition.source.parameters[0])
          const comparisonExpression = condition.source.parameters[1]
          const valueExpression = condition.source.parameters[2]
          if (variableName && hasRuntimeVariable(variableName) && comparisonExpression && valueExpression) {
            const currentValue = getRuntimeVariable(variableName)
            const comparisonValue = safeEvaluate(comparisonExpression, context, condition.source.id, diagnostics)
            const expectedValue = safeEvaluate(valueExpression, context, condition.source.id, diagnostics)
            if (currentValue !== undefined && comparisonValue && expectedValue) {
              const comparison = typeof comparisonValue.value === 'number'
                ? comparisonValue.value
                : Number(comparisonValue.value)
              passed = compareConstructValues(currentValue, expectedValue.value, comparison)
            }
          }
        } else if (operation === 'System.compare-boolean-eventvar') {
          const variableName = literalString(condition.source.parameters[0])
          const currentValue = variableName === undefined ? undefined : getRuntimeVariable(variableName)
          if (typeof currentValue === 'boolean') passed = currentValue
        } else if (operation === 'System.pick-by-comparison') {
          const objectType = literalString(condition.source.parameters[0])
          const left = condition.source.parameters[1]
          const comparisonExpression = condition.source.parameters[2]
          const right = condition.source.parameters[3]
          if (objectType && left && comparisonExpression && right) {
            const candidates = currentObjects(objectType, currentSelection)
            const selected = new Set<TInstance>()
            const comparisonValue = safeEvaluate(comparisonExpression, context, condition.source.id, diagnostics)
            if (comparisonValue) {
              const comparison = typeof comparisonValue.value === 'number'
                ? comparisonValue.value
                : Number(comparisonValue.value)
              let validSelection = true
              for (const instance of candidates) {
                const candidateContext = evaluationContext(currentSelection, { objectType, instance })
                const leftValue = safeEvaluate(left, candidateContext, condition.source.id, diagnostics)
                const rightValue = safeEvaluate(right, candidateContext, condition.source.id, diagnostics)
                if (!leftValue || !rightValue) {
                  validSelection = false
                  break
                }
                const matches = compareConstructValues(leftValue.value, rightValue.value, comparison)
                if (matches === undefined) {
                  validSelection = false
                  break
                }
                if (condition.source.inverted === true ? !matches : matches) selected.add(instance)
              }
              if (validSelection) {
                setPickedInstances(currentSelection, objectType, [...selected])
                selectedCount = selected.size
                passed = selected.size > 0
              }
            }
          }
        } else if (operation === 'System.pick-by-evaluate') {
          const objectType = literalString(condition.source.parameters[0])
          const expression = condition.source.parameters[1]
          if (objectType && expression) {
            const candidates = currentObjects(objectType, currentSelection)
            const selected: TInstance[] = []
            let validSelection = true
            for (const instance of candidates) {
              const candidateContext = evaluationContext(currentSelection, { objectType, instance })
              const result = safeEvaluate(expression, candidateContext, condition.source.id, diagnostics)
              if (!result || (typeof result.value !== 'boolean'
                && (typeof result.value !== 'number' || !Number.isFinite(result.value)))) {
                validSelection = false
                break
              }
              const matches = typeof result.value === 'boolean' ? result.value : result.value !== 0
              if (condition.source.inverted === true ? !matches : matches) selected.push(instance)
            }
            if (validSelection) {
              setPickedInstances(currentSelection, objectType, selected)
              selectedCount = selected.length
              passed = selected.length > 0
            }
          }
        } else if (operation === 'System.pick-all') {
          const objectType = literalString(condition.source.parameters[0])
          if (objectType) {
            const instances = currentObjects(objectType, currentSelection, true)
            if (condition.source.inverted === true) {
              setPickedInstances(currentSelection, objectType, [])
              selectedCount = 0
              passed = instances.length === 0
            } else {
              setPickedInstances(currentSelection, objectType, instances)
              selectedCount = instances.length
              passed = instances.length > 0
            }
          }
        } else if (operation === 'System.pick-overlapping-point') {
          const objectType = literalString(condition.source.parameters[0])
          const xExpression = condition.source.parameters[1]
          const yExpression = condition.source.parameters[2]
          const xResult = xExpression
            ? safeEvaluate(xExpression, context, condition.source.id, diagnostics)
            : undefined
          const yResult = yExpression
            ? safeEvaluate(yExpression, context, condition.source.id, diagnostics)
            : undefined
          const x = xResult === undefined ? Number.NaN : Number(xResult.value)
          const y = yResult === undefined ? Number.NaN : Number(yResult.value)
          if (objectType && Number.isFinite(x) && Number.isFinite(y) && adapter.pickOverlappingPoint) {
            const candidates = currentObjects(objectType, currentSelection)
            const overlaps = adapter.pickOverlappingPoint(objectType, x, y, candidates, adapter.getContext())
            if (overlaps !== undefined) {
              const overlapSet = new Set(overlaps)
              const selected = candidates.filter((instance) => {
                const overlapsPoint = overlapSet.has(instance)
                return 'inverted' in condition.source && condition.source.inverted === true
                  ? !overlapsPoint
                  : overlapsPoint
              })
              // Intersect host hits with the active Construct selection.
              setPickedInstances(currentSelection, objectType, selected)
              selectedCount = selected.length
              passed = selected.length > 0
            }
          }
        } else if (operation.endsWith('.pick-by-unique-id')) {
          const objectType = operation.slice(0, operation.lastIndexOf('.'))
          const uniqueIdExpression = condition.source.parameters[0]
          const uniqueIdResult = uniqueIdExpression
            ? safeEvaluate(uniqueIdExpression, context, condition.source.id, diagnostics)
            : undefined
          const uniqueId = Number(uniqueIdResult?.value)
          if (Number.isFinite(uniqueId) && adapter.pickInstanceByUniqueId) {
            const candidates = currentObjects(objectType, currentSelection)
            const matched = adapter.pickInstanceByUniqueId(objectType, uniqueId, candidates, adapter.getContext())
            if (matched !== undefined) {
              const inverted = 'inverted' in condition.source && condition.source.inverted === true
              const selected = candidates.filter((instance) => inverted ? instance !== matched : instance === matched)
              setPickedInstances(currentSelection, objectType, selected)
              selectedCount = selected.length
              passed = selected.length > 0
            }
          }
        } else if (operation.endsWith('.pick-children')) {
          const objectType = operation.slice(0, operation.lastIndexOf('.'))
          const childType = literalString(condition.source.parameters[0])
          const which = literalString(condition.source.parameters[1])
          if (childType && (which === 'own' || which === 'all') && adapter.getHierarchyChildren) {
            const selectedChildren = new Set(currentObjects(childType, currentSelection))
            const pickedChildren = new Set<TInstance>()
            const visited = new Set<TInstance>()
            const pending: TInstance[] = []
            for (const parent of currentObjects(objectType, currentSelection)) {
              for (const child of adapter.getHierarchyChildren(parent)) pending.push(child)
            }
            while (pending.length > 0) {
              const child = pending.pop()!
              if (visited.has(child)) continue
              visited.add(child)
              if (selectedChildren.has(child)) pickedChildren.add(child)
              if (which === 'all') {
                for (const descendant of adapter.getHierarchyChildren(child)) pending.push(descendant)
              }
            }
            setPickedInstances(currentSelection, childType, [...pickedChildren])
            selectedCount = pickedChildren.size
            passed = selectedCount > 0
          }
        } else if (operation.endsWith('.is-between-angles')) {
          const objectType = operation.slice(0, operation.lastIndexOf('.'))
          const firstAngleExpression = condition.source.parameters[0]
          const secondAngleExpression = condition.source.parameters[1]
          const firstAngleResult = firstAngleExpression
            ? safeEvaluate(firstAngleExpression, context, condition.source.id, diagnostics)
            : undefined
          const secondAngleResult = secondAngleExpression
            ? safeEvaluate(secondAngleExpression, context, condition.source.id, diagnostics)
            : undefined
          const firstAngle = Number(firstAngleResult?.value)
          const secondAngle = Number(secondAngleResult?.value)
          if (firstAngleResult && secondAngleResult && Number.isFinite(firstAngle) && Number.isFinite(secondAngle)) {
            const normalizeAngle = (angle: number): number => ((angle % 360) + 360) % 360
            const arcLength = normalizeAngle(secondAngle - firstAngle)
            const inverted = condition.source.inverted === true
            const selected = currentObjects(objectType, currentSelection).filter((instance) => {
              const angle = Number(adapter.getProperty(instance, 'angle'))
              if (!Number.isFinite(angle)) return false
              const offset = normalizeAngle(angle - firstAngle)
              const matches = offset <= arcLength
              return inverted ? !matches : matches
            })
            setPickedInstances(currentSelection, objectType, selected)
            selectedCount = selected.length
            passed = selected.length > 0
          }
        } else if (operation.endsWith('.compare-instance-variable')) {
          const objectType = operation.slice(0, operation.lastIndexOf('.'))
          const variableName = literalString(condition.source.parameters[0])
          const comparisonExpression = condition.source.parameters[1]
          const valueExpression = condition.source.parameters[2]
          const comparisonResult = comparisonExpression
            ? safeEvaluate(comparisonExpression, context, condition.source.id, diagnostics)
            : undefined
          if (variableName !== undefined && comparisonResult && valueExpression) {
            const comparison = typeof comparisonResult.value === 'number'
              ? comparisonResult.value
              : Number(comparisonResult.value)
            const selected: TInstance[] = []
            let validSelection = true
            for (const instance of currentObjects(objectType, currentSelection)) {
              const candidateContext = evaluationContext(currentSelection, { objectType, instance })
              const expectedValue = safeEvaluate(valueExpression, candidateContext, condition.source.id, diagnostics)
              if (!expectedValue) {
                validSelection = false
                break
              }
              const currentValue = adapter.getProperty(instance, variableName)
              const matches = compareConstructValues(currentValue, expectedValue.value, comparison)
              if (matches === undefined) {
                validSelection = false
                break
              }
              if (condition.source.inverted === true ? !matches : matches) selected.push(instance)
            }
            if (validSelection) {
              setPickedInstances(currentSelection, objectType, selected)
              selectedCount = selected.length
              passed = selected.length > 0
            }
          }
        } else if (operation.endsWith('.is-boolean-instance-variable-set')) {
          const objectType = operation.slice(0, operation.lastIndexOf('.'))
          const variableName = literalString(condition.source.parameters[0])
          if (variableName !== undefined) {
            const inverted = condition.source.inverted === true
            const selected = currentObjects(objectType, currentSelection).filter((instance) => {
              const isSet = adapter.getProperty(instance, variableName) === true
              return inverted ? !isSet : isSet
            })
            setPickedInstances(currentSelection, objectType, selected)
            selectedCount = selected.length
            passed = selected.length > 0
          }
        } else if (adapter.evaluateCondition) {
          const parameters: JsonValue[] = []
          let validParameters = true
          for (const expression of condition.source.parameters) {
            const result = safeEvaluate(expression, context, condition.source.id, diagnostics)
            if (!result) {
              validParameters = false
              break
            }
            parameters.push(result.value)
          }
          if (validParameters) {
            const scope = aceInvocationScope(condition.definition)
            passed = scope === undefined
              ? adapter.evaluateCondition(operation, parameters, adapter.getContext())
              : adapter.evaluateCondition(operation, parameters, adapter.getContext(), scope)
          }
        }
      } catch (error) {
        diagnostics.push(runtimeDiagnostic(
          'construct.runtime.host-error',
          error instanceof Error ? error.message : 'Host adapter failed while evaluating a condition.',
          condition.source.id,
        ))
      }
      if (passed !== undefined && condition.source.inverted === true
        && operation !== 'System.pick-by-comparison' && operation !== 'System.pick-all'
        && operation !== 'System.pick-overlapping-point'
        && !operation.endsWith('.is-between-angles')
        && !operation.endsWith('.compare-instance-variable')
        && !operation.endsWith('.is-boolean-instance-variable-set')) {
        passed = !passed
      }
      if (passed === undefined) {
        addEntry('condition', condition.source.id, 'unsupported', parentNodeId, { operation })
        diagnostics.push(runtimeDiagnostic(
          'construct.runtime.unsupported-condition',
          'Condition "' + operation + '" has invalid parameters or uses unsupported behavior.',
          condition.source.id,
        ))
        return { status: 'unsupported', passed: false }
      }
      addEntry('condition', condition.source.id, passed ? 'passed' : 'failed', parentNodeId, {
        operation,
        result: passed,
        ...(condition.definition.isTrigger ? { trigger: activeTrigger?.operation ?? null } : {}),
        ...(selectedCount === undefined ? {} : { selectedCount }),
      })
      return { status: 'supported', passed }
    }

    function triggerMatches(
      condition: CompiledCondition,
      dispatched: ConstructTrigger<TInstance>,
      context: ConstructEvaluationContext<TInstance, TContext>,
    ): boolean {
      if (condition.source.type !== 'condition' || condition.source.operation !== dispatched.operation) return false
      if (dispatched.parameters === undefined) return true
      if (dispatched.parameters.length !== condition.source.parameters.length) return false
      return condition.source.parameters.every((expression, index) => {
        const expected = safeEvaluate(expression, context, condition.source.id, diagnostics)
        const actual = dispatched.parameters?.[index]
        return expected !== undefined
          && actual !== undefined
          && compareConstructValues(expected.value, actual, 0) === true
      })
    }

    function runAction(
      action: CompiledAction,
      currentSelection: ConstructSelectionContext<TInstance>,
      parentNodeId: string,
    ): void {
      if (action.source.type === 'comment') {
        addEntry('action', action.source.id, 'skipped', parentNodeId, { reason: 'comment' })
        return
      }
      if (action.source.type !== 'action' || !action.definition) {
        addEntry('action', action.source.id, 'unsupported', parentNodeId)
        diagnostics.push(runtimeDiagnostic(
          'construct.runtime.unsupported-action',
          'Action "' + action.source.id + '" has no executable Construct handler.',
          action.source.id,
        ))
        return
      }
      if (action.definition.isAsync === true) {
        unsupportedAction(action, parentNodeId, 'Asynchronous Construct actions are not awaited by this synchronous runtime.')
        return
      }
      try {
        if (action.source.operation === 'Functions.set-return-value') {
          const frame = functionStack.at(-1)
          const expression = action.source.parameters[0]
          if (!frame || !expression) {
            unsupportedAction(action, parentNodeId, 'Set return value requires an active function and a value expression.')
            return
          }
          const result = safeEvaluate(expression, evaluationContext(currentSelection), action.source.id, diagnostics)
          if (!result) {
            unsupportedAction(action, parentNodeId, 'Set return value could not evaluate its value expression.')
            return
          }
          const returnType = frame.definition.returnType?.toLowerCase()
          if ((returnType === 'number' && typeof result.value !== 'number')
            || (returnType === 'string' && typeof result.value !== 'string')) {
            unsupportedAction(action, parentNodeId, 'Set return value does not match the function return type.')
            return
          }
          frame.returnValue = result.value
          addEntry('action', action.source.id, 'executed', parentNodeId, {
            operation: action.source.operation,
            value: result.value,
          })
          return
        }
        if (action.source.operation.startsWith('Functions.')) {
          const functionName = action.source.operation.slice('Functions.'.length)
          const parameters: JsonValue[] = []
          for (const expression of action.source.parameters) {
            const result = safeEvaluate(expression, evaluationContext(currentSelection), action.source.id, diagnostics)
            if (!result) {
              unsupportedAction(action, parentNodeId, 'Function action parameter could not be evaluated.')
              return
            }
            parameters.push(result.value)
          }
          const constructMetadata = action.source.metadata?.construct
          const rawAction = isJsonObject(constructMetadata) && isJsonObject(constructMetadata.raw)
            ? constructMetadata.raw
            : undefined
          const customActionSelection = typeof rawAction?.customAction === 'string'
            && typeof rawAction.objectClass === 'string'
            ? {
              ownerObjectClass: typeof rawAction.customActionObjectClass === 'string'
                ? rawAction.customActionObjectClass
                : rawAction.objectClass,
              targetObjectClass: rawAction.objectClass,
            }
            : undefined
          const result = invokeFunction(
            functionName,
            parameters,
            action.source.id,
            currentSelection,
            true,
            customActionSelection,
          )
          if (!result.supported) {
            unsupportedAction(action, parentNodeId, result.reason)
            return
          }
          addEntry('action', action.source.id, 'executed', parentNodeId, {
            operation: action.source.operation,
            functionName,
            argumentCount: parameters.length,
          })
          return
        }
        if (action.source.operation === 'System.stop-loop') {
          for (const loopFrame of loopStack) loopFrame.stopRequested = true
          addEntry('action', action.source.id, 'executed', parentNodeId, {
            operation: action.source.operation,
            activeLoopCount: loopStack.length,
          })
          return
        }
        if (action.source.operation === 'System.reset-global-variables') {
          const resetStaticExpression = action.source.parameters[0]
          const isMissingOptionalValue = !resetStaticExpression
            || (resetStaticExpression.type === 'incomplete' && !resetStaticExpression.sourceText)
          const resetStaticResult = isMissingOptionalValue
            ? { value: false }
            : resetStaticExpression
              ? safeEvaluate(resetStaticExpression, evaluationContext(currentSelection), action.source.id, diagnostics)
              : undefined
          if (!resetStaticResult || typeof resetStaticResult.value !== 'boolean') {
            unsupportedAction(action, parentNodeId, 'Reset global variables requires a boolean Reset static value.')
            return
          }
          for (const [name, initialValue] of initialVariableValues) variables.set(name, initialValue)
          if (resetStaticResult.value) {
            for (const state of staticEventVariableState.values()) state.value = state.initialValue
            for (const scope of variableScopes) {
              for (const [name, key] of scope.staticVariableKeys ?? []) {
                const initialValue = scope.initialVariables.get(name)
                if (initialValue !== undefined) scope.variables.set(name, initialValue)
                const state = staticEventVariableState.get(key)
                if (state) state.value = state.initialValue
              }
            }
          }
          addEntry('action', action.source.id, 'executed', parentNodeId, {
            operation: action.source.operation,
            resetStatic: resetStaticResult.value,
            resetVariableCount: initialVariableValues.size,
          })
          return
        }
        if (action.source.operation === 'System.create-object') {
          const expressions = action.source.parameters
          const evaluated = expressions.map((expression) => expression
            ? safeEvaluate(expression, evaluationContext(currentSelection), action.source.id, diagnostics)
            : undefined)
          const objectType = evaluated[0]?.value
          const layer = evaluated[1]?.value
          const x = evaluated[2]?.value
          const y = evaluated[3]?.value
          if (typeof objectType !== 'string' || layer === undefined || typeof x !== 'number' || typeof y !== 'number') {
            unsupportedAction(action, parentNodeId, 'Create object requires an object type, layer, and numeric position.')
            return
          }
          const instance = adapter.createInstance(objectType, { layer, x, y })
          const containerMembers = adapter.getContainerMembers?.(instance) ?? [instance]
          const linkedInstances = containerMembers.includes(instance)
            ? containerMembers
            : [instance, ...containerMembers]
          setPickedInstances(currentSelection, objectType, linkedInstances)
          for (const member of linkedInstances) currentSelection.createdInstances.add(member)
          addEntry('action', action.source.id, 'executed', parentNodeId, {
            operation: action.source.operation,
            objectType,
            layer,
            x,
            y,
            selectedCount: 1,
          })
          return
        }
        if (action.source.operation === 'System.set-group-active') {
          const groupName = constructStringParameter(action.source.parameters[0])
          const state = literalString(action.source.parameters[1])
          const current = groupName === undefined ? undefined : groupActiveByName.get(groupName)
          if (groupName === undefined || current === undefined) {
            unsupportedAction(action, parentNodeId, 'Set group active requires the name of a known event group.')
            return
          }
          const active = state === 'activated' ? true
            : state === 'deactivated' ? false
              : state === 'toggle' ? !current
                : undefined
          if (active === undefined) {
            unsupportedAction(action, parentNodeId, 'Set group active state must be activated, deactivated, or toggle.')
            return
          }
          groupActiveByName.set(groupName, active)
          addEntry('action', action.source.id, 'executed', parentNodeId, {
            operation: action.source.operation,
            groupName,
            active,
          })
          return
        }
        if ([
          'System.set-eventvar-value',
          'System.add-to-eventvar',
          'System.subtract-from-eventvar',
          'System.reset-eventvar',
          'System.set-boolean-eventvar',
          'System.toggle-boolean-eventvar',
        ].includes(action.source.operation)) {
          const variableName = literalString(action.source.parameters[0])
          if (!variableName) {
            unsupportedAction(action, parentNodeId, 'Event variable action requires a variable name.')
            return
          }

          const operation = action.source.operation
          const currentValue = getRuntimeVariable(variableName)
          let nextValue: JsonValue | undefined
          if (operation === 'System.set-eventvar-value' || operation === 'System.set-boolean-eventvar') {
            const expression = action.source.parameters[1]
            if (!expression) {
              unsupportedAction(action, parentNodeId, 'Set event variable requires a value expression.')
              return
            }
            const evaluated = safeEvaluate(expression, evaluationContext(currentSelection), action.source.id, diagnostics)
            if (evaluated && (operation !== 'System.set-boolean-eventvar' || typeof evaluated.value === 'boolean')) {
              nextValue = evaluated.value
            }
          } else if (operation === 'System.add-to-eventvar' || operation === 'System.subtract-from-eventvar') {
            const expression = action.source.parameters[1]
            if (typeof currentValue === 'number' && expression) {
              const evaluated = safeEvaluate(expression, evaluationContext(currentSelection), action.source.id, diagnostics)
              if (evaluated && typeof evaluated.value === 'number') {
                nextValue = operation === 'System.add-to-eventvar'
                  ? currentValue + evaluated.value
                  : currentValue - evaluated.value
              }
            }
          } else if (operation === 'System.reset-eventvar') {
            nextValue = resetRuntimeVariable(variableName)
          } else if (operation === 'System.toggle-boolean-eventvar' && typeof currentValue === 'boolean') {
            nextValue = !currentValue
          }

          if (nextValue === undefined) {
            unsupportedAction(action, parentNodeId, 'Event variable action could not produce a value for "' + variableName + '".')
            return
          }
          setRuntimeVariable(variableName, nextValue)
          addEntry('action', action.source.id, 'executed', parentNodeId, {
            operation,
            variable: variableName,
            value: nextValue,
          })
          return
        }

        if (action.source.operation.endsWith('.set-instvar-value')) {
          const objectType = action.source.operation.slice(0, action.source.operation.lastIndexOf('.'))
          const variableName = literalString(action.source.parameters[0])
          const valueExpression = action.source.parameters[1]
          if (variableName === undefined || !valueExpression) {
            unsupportedAction(action, parentNodeId, 'Set instance variable requires a variable name and value expression.')
            return
          }
          const updates: Array<{ instance: TInstance; value: JsonValue }> = []
          for (const instance of currentObjects(objectType, currentSelection)) {
            const evaluated = safeEvaluate(
              valueExpression,
              evaluationContext(currentSelection, { objectType, instance }),
              action.source.id,
              diagnostics,
            )
            if (!evaluated) {
              unsupportedAction(action, parentNodeId, 'Set instance variable could not evaluate its value expression.')
              return
            }
            updates.push({ instance, value: evaluated.value })
          }
          for (const { instance, value } of updates) adapter.setProperty(instance, variableName, value)
          addEntry('action', action.source.id, 'executed', parentNodeId, {
            operation: action.source.operation,
            variable: variableName,
            selectedCount: updates.length,
          })
          return
        }
        if (action.source.operation.endsWith('.destroy')) {
          const objectType = action.source.operation.slice(0, action.source.operation.lastIndexOf('.'))
          const selectedInstances = currentObjects(objectType, currentSelection)
          const instancesToDestroy = new Set<TInstance>()
          for (const instance of selectedInstances) {
            for (const member of adapter.getContainerMembers?.(instance) ?? [instance]) {
              instancesToDestroy.add(member)
            }
          }
          for (const instance of instancesToDestroy) adapter.destroyInstance(instance)
          addEntry('action', action.source.id, 'executed', parentNodeId, {
            operation: action.source.operation,
            selectedCount: selectedInstances.length,
            destroyedCount: instancesToDestroy.size,
          })
          return
        }

        const [objectClass, actionId] = splitOperation(action.source.operation)
        const isStaticAction = action.definition?.isStatic === true
        const isGlobalAction = objectClass === 'System' || isStaticAction
        const instances = isGlobalAction ? [] : currentObjects(objectClass, currentSelection)
        const executionTargets: (TInstance | undefined)[] = isGlobalAction ? [undefined] : [...instances]
        for (const instance of executionTargets) {
          const context = evaluationContext(
            currentSelection,
            instance === undefined ? undefined : { objectType: objectClass, instance },
          )
          const parameters: JsonValue[] = []
          for (const [index, expression] of action.source.parameters.entries()) {
            const parameter = action.definition.parameters?.[index]
            if (parameter?.type === 'string'
              && parameter.optional === true
              && parameter.initialValue !== undefined
              && expression.type === 'incomplete'
              && !expression.sourceText) {
              parameters.push(parameter.initialValue)
              continue
            }
            const value = safeEvaluate(expression, context, action.source.id, diagnostics)
            if (!value) {
              unsupportedAction(action, parentNodeId, 'Action parameter could not be evaluated.')
              return
            }
            parameters.push(value.value)
          }
          const scope = aceInvocationScope(action.definition)
          if (scope === undefined) {
            adapter.callAction(objectClass, actionId, instance === undefined ? [] : [instance], parameters)
          } else {
            adapter.callAction(objectClass, actionId, instance === undefined ? [] : [instance], parameters, scope)
          }
        }
        addEntry('action', action.source.id, 'executed', parentNodeId, {
          operation: action.source.operation,
          selectedCount: instances.length,
          ...(loopStack.length === 0 ? {} : { loopIndex: loopStack.at(-1)?.index ?? 0 }),
        })
      } catch (error) {
        diagnostics.push(runtimeDiagnostic(
          'construct.runtime.host-error',
          error instanceof Error ? error.message : 'Host adapter failed while executing an action.',
          action.source.id,
        ))
        addEntry('action', action.source.id, 'unsupported', parentNodeId, { operation: action.source.operation })
      }
    }

    function unsupportedAction(action: CompiledAction, parentNodeId: string, message: string): void {
      addEntry('action', action.source.id, 'unsupported', parentNodeId,
        action.source.type === 'action' ? { operation: action.source.operation } : undefined)
      diagnostics.push(runtimeDiagnostic('construct.runtime.unsupported-action', message, action.source.id))
    }

    function skipCondition(condition: CompiledCondition, parentNodeId: string): void {
      addEntry('condition', condition.source.id, 'skipped', parentNodeId)
    }

    function skipEvent(event: CompiledEvent, parentNodeId: string): void {
      addEntry('event', event.source.id, 'skipped', parentNodeId)
      skipContents(event, event.source.id)
    }

    function skipContents(event: CompiledEvent, parentNodeId: string): void {
      for (const condition of event.conditions) skipCondition(condition, parentNodeId)
      for (const action of event.actions) addEntry('action', action.source.id, 'skipped', parentNodeId)
      for (const child of event.children) skipEvent(child, parentNodeId)
    }

    function currentObjects(
      objectType: string,
      currentSelection: ConstructSelectionContext<TInstance>,
      pickAll = false,
    ): readonly TInstance[] {
      const selected = currentSelection.selectionsByObjectType.get(objectType)
        ?? currentSelection.familySelections.get(objectType)
      return selected === undefined || pickAll
        ? adapter.queryObjects(objectType)
        : [...selected]
    }

    function setPickedInstances(
      currentSelection: ConstructSelectionContext<TInstance>,
      objectType: string,
      instances: readonly TInstance[],
    ): void {
      const selectedByType = new Map<string, Set<TInstance>>([[objectType, new Set(instances)]])
      for (const instance of instances) {
        const members = new Set(adapter.getContainerMembers?.(instance) ?? [instance])
        members.add(instance)
        for (const member of members) {
          const memberType = adapter.getObjectType(member)
          const selected = selectedByType.get(memberType) ?? new Set<TInstance>()
          selected.add(member)
          selectedByType.set(memberType, selected)
          currentSelection.containerRelationships.set(member, members)
        }
      }
      for (const [type, selected] of selectedByType) {
        currentSelection.selectionsByObjectType.set(type, selected)
      }
    }

    function evaluationContext(
      currentSelection: ConstructSelectionContext<TInstance>,
      candidate?: { objectType: string; instance: TInstance },
    ): ConstructEvaluationContext<TInstance, TContext> {
      const frame = functionStack.at(-1)
      const scopedVariables = variableScopes.length === 0 ? variables : new Map(variables)
      for (const scope of variableScopes) {
        for (const [name, value] of scope.variables) scopedVariables.set(name, value)
      }
      return {
        adapter,
        selection: currentSelection,
        variables: scopedVariables,
        loopIndices: loopStack,
        ...(frame ? {
          functionParameters: frame.parameters,
          functionReturnValue: frame.lastCallReturnValue,
        } : { functionReturnValue: lastFunctionReturnValue }),
        ...(candidate ? { candidate } : {}),
      }
    }

    function getRuntimeVariable(name: string): JsonValue | undefined {
      for (const scope of [...variableScopes].reverse()) {
        if (scope.variables.has(name)) return scope.variables.get(name)
      }
      return variables.get(name)
    }

    function hasRuntimeVariable(name: string): boolean {
      return variableScopes.some((scope) => scope.variables.has(name)) || variables.has(name)
    }

    function setRuntimeVariable(name: string, value: JsonValue): void {
      for (const scope of [...variableScopes].reverse()) {
        if (scope.variables.has(name)) {
          scope.variables.set(name, value)
          return
        }
      }
      variables.set(name, value)
    }

    function resetRuntimeVariable(name: string): JsonValue | undefined {
      for (const scope of [...variableScopes].reverse()) {
        if (scope.variables.has(name)) return scope.initialVariables.get(name)
      }
      return initialVariableValues.get(name)
    }

    function safeEvaluate(
      expression: Condition['parameters'][number],
      context: ConstructEvaluationContext<TInstance, TContext>,
      nodeId: string,
      outputDiagnostics: Diagnostic[],
    ): { value: JsonValue } | undefined {
      try {
        const result = evaluateConstructExpression(expression, {
          ...context,
          callFunction: (name, parameters) => invokeFunction(name, parameters, nodeId, context.selection),
        })
        if (result.supported) return { value: result.value }
        outputDiagnostics.push(runtimeDiagnostic('construct.runtime.unsupported-expression', result.reason, nodeId))
        return undefined
      } catch (error) {
        outputDiagnostics.push(runtimeDiagnostic(
          'construct.runtime.expression-error',
          error instanceof Error ? error.message : 'Expression evaluation failed.',
          nodeId,
        ))
        return undefined
      }
    }
  }

  return { adapter, selection, variables, run, dispatchTrigger, reset }

  function initializeGroupStates(document: CompiledConstructDocument): void {
    for (const sheet of document.sheets) {
      for (const event of sheet.events) visit(event)
    }

    function visit(event: CompiledEvent): void {
      const source = event.source
      if (source.type === 'event' && source.eventKind === 'group' && source.label) {
        groupActiveByName.set(source.label, source.enabled !== false && source.initiallyEnabled !== false)
      }
      for (const child of event.children) visit(child)
    }
  }

  function reset(): void {
    clearSelection(selection)
    variables.clear()
    initializedDocumentId = undefined
    staticEventVariableState.clear()
    initializedSheetIds.clear()
    triggerOnceActiveEvents.clear()
    groupActiveByName.clear()
    loopStack.length = 0
  }
}

function clearSelection<TInstance>(selection: ConstructSelectionContext<TInstance>): void {
  selection.selectionsByObjectType.clear()
  selection.familySelections.clear()
  selection.containerRelationships.clear()
  selection.createdInstances.clear()
}

function forkSelectionContext<TInstance>(
  parent: ConstructSelectionContext<TInstance>,
): ConstructSelectionContext<TInstance> {
  const child = createSelectionContext(parent)
  for (const [key, instances] of parent.selectionsByObjectType) child.selectionsByObjectType.set(key, new Set(instances))
  for (const [key, instances] of parent.familySelections) child.familySelections.set(key, new Set(instances))
  for (const [instance, related] of parent.containerRelationships) child.containerRelationships.set(instance, new Set(related))
  for (const instance of parent.createdInstances) child.createdInstances.add(instance)
  return child
}

function literalString(expression: Condition['parameters'][number] | undefined): string | undefined {
  return expression?.type === 'literal' && typeof expression.value === 'string' ? expression.value : undefined
}

function constructStringParameter(expression: Condition['parameters'][number] | undefined): string | undefined {
  const value = literalString(expression)
  if (value === undefined || !value.startsWith('"') || !value.endsWith('"')) return value
  try {
    const decoded: unknown = JSON.parse(value)
    return typeof decoded === 'string' ? decoded : value
  } catch {
    return value
  }
}

function isElseCondition(condition: CompiledCondition): boolean {
  return condition.source.type === 'condition' && condition.source.operation === 'System.else'
}

function isTriggerCondition(condition: CompiledCondition): boolean {
  return condition.source.type === 'condition' && condition.definition?.isTrigger === true
}

function isTriggerOnceCondition(condition: CompiledCondition): boolean {
  return condition.source.type === 'condition' && condition.source.operation === 'System.trigger-once-while-true'
}

function isTriggerEvent(event: CompiledEvent): boolean {
  return event.conditions.some(isTriggerCondition)
}

function containsTrigger(event: CompiledEvent): boolean {
  return event.conditions.some(isTriggerCondition) || event.children.some(containsTrigger)
}

function splitOperation(operation: string): [string, string] {
  const separator = operation.lastIndexOf('.')
  return separator < 0
    ? ['', operation]
    : [operation.slice(0, separator), operation.slice(separator + 1)]
}

function aceInvocationScope(
  definition: { behaviorType?: string; pluginId?: string } | undefined,
): AceInvocationScope | undefined {
  if (definition?.behaviorType !== undefined) return { behaviorType: definition.behaviorType }
  if (definition?.pluginId !== undefined) return { pluginId: definition.pluginId }
  return undefined
}

function defaultVariableValue(dataType: string): JsonValue {
  if (dataType.toLowerCase() === 'string' || dataType.toLowerCase() === 'text') return ''
  if (dataType.toLowerCase() === 'boolean' || dataType.toLowerCase() === 'bool') return false
  return 0
}

function isStaticVariable(variable: VariableDeclaration): boolean {
  const construct = variable.metadata?.construct
  if (!construct || typeof construct !== 'object' || Array.isArray(construct)) return false
  const raw = construct.raw
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) && raw.isStatic === true
}

function loopCount(value: JsonValue): number | undefined {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : typeof value === 'boolean'
        ? Number(value)
        : value === null
          ? 0
          : Number.NaN
  return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : undefined
}

function compareOrderedValues(left: JsonValue, right: JsonValue): number | undefined {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'string' && typeof right === 'string') return left < right ? -1 : left > right ? 1 : 0
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  if (left === null && right === null) return 0
  return undefined
}

function runtimeDiagnostic(code: string, message: string, nodeId?: string): Diagnostic {
  return {
    code,
    severity: ['construct.runtime.wrong-engine', 'construct.runtime.wrong-adapter', 'construct.runtime.missing-sheet']
      .includes(code) || code.endsWith('host-error') ? 'error' : 'warning',
    message,
    ...(nodeId === undefined ? {} : { nodeId }),
  }
}
