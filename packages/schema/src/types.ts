export const CURRENT_SCHEMA_VERSION = 1

export type NodeId = string

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export interface SourceLocation {
  sourceId?: string
  offsetStart?: number
  offsetEnd?: number
  lineStart?: number
  lineEnd?: number
  columnStart?: number
  columnEnd?: number
}

export type DiagnosticSeverity = 'info' | 'warning' | 'error'

export interface Diagnostic {
  code: string
  severity: DiagnosticSeverity
  message: string
  nodeId?: NodeId
  sourceLocation?: SourceLocation
  details?: JsonValue
}

export interface EngineDescriptor {
  id: string
  compatibilityVersion?: string
}

export interface NodeBase {
  id: NodeId
  sourceLocation?: SourceLocation
  metadata?: JsonObject
}

export type StructuralNodeType = 'sheet' | 'event' | 'condition' | 'action' | 'variable' | 'function'

export interface UnknownNode<TNodeType extends StructuralNodeType = StructuralNodeType> extends NodeBase {
  type: 'unknown'
  nodeType: TNodeType
  raw: JsonValue
}

export interface InvalidNode<TNodeType extends StructuralNodeType = StructuralNodeType> extends NodeBase {
  type: 'invalid'
  nodeType: TNodeType
  raw: JsonValue
  diagnostic: Diagnostic
}

export interface IncompleteNode<TNodeType extends StructuralNodeType = StructuralNodeType> extends NodeBase {
  type: 'incomplete'
  nodeType: TNodeType
  sourceText?: string
  expected?: string[]
}

export type RecoveryNode<TNodeType extends StructuralNodeType> =
  | UnknownNode<TNodeType>
  | InvalidNode<TNodeType>
  | IncompleteNode<TNodeType>

export interface ExpressionBase {
  id?: NodeId
  sourceLocation?: SourceLocation
  sourceText?: string
}

export interface LiteralExpression extends ExpressionBase {
  type: 'literal'
  value: JsonPrimitive
}

export interface IdentifierExpression extends ExpressionBase {
  type: 'identifier'
  name: string
}

export interface VariableExpression extends ExpressionBase {
  type: 'variable'
  name: string
  variableId?: NodeId
}

export interface PropertyExpression extends ExpressionBase {
  type: 'property'
  object: Expression
  property: string
  computed?: boolean
}

export interface UnaryExpression extends ExpressionBase {
  type: 'unary'
  operator: string
  argument: Expression
}

export interface BinaryExpression extends ExpressionBase {
  type: 'binary'
  operator: string
  left: Expression
  right: Expression
}

export interface CallExpression extends ExpressionBase {
  type: 'call'
  callee: string
  arguments: Expression[]
}

export interface ConditionalExpression extends ExpressionBase {
  type: 'conditional'
  test: Expression
  whenTrue: Expression
  whenFalse: Expression
}

export interface ArrayExpression extends ExpressionBase {
  type: 'array'
  elements: Expression[]
}

export interface InvalidExpression extends ExpressionBase {
  type: 'invalid'
  sourceText: string
  message: string
}

export interface IncompleteExpression extends ExpressionBase {
  type: 'incomplete'
  sourceText: string
  expected?: string[]
}

export interface UnknownExpression extends ExpressionBase {
  type: 'unknown'
  sourceText: string
  syntax?: string
}

export type Expression =
  | LiteralExpression
  | IdentifierExpression
  | VariableExpression
  | PropertyExpression
  | UnaryExpression
  | BinaryExpression
  | CallExpression
  | ConditionalExpression
  | ArrayExpression
  | InvalidExpression
  | IncompleteExpression
  | UnknownExpression

export interface Condition extends NodeBase {
  type: 'condition'
  operation: string
  parameters: Expression[]
  parameterIds?: string[]
  inverted?: boolean
}

export interface Action extends NodeBase {
  type: 'action'
  operation: string
  parameters: Expression[]
  parameterIds?: string[]
}

export interface CommentAction extends NodeBase {
  type: 'comment'
  text: string
}

export type ConditionNode = Condition | RecoveryNode<'condition'>
export type ActionNode = Action | CommentAction | RecoveryNode<'action'>

export interface Event extends NodeBase {
  type: 'event'
  eventKind?: 'block' | 'group' | 'function' | 'comment'
  conditions: ConditionNode[]
  actions: ActionNode[]
  variables?: VariableNode[]
  subEvents?: EventNode[]
  enabled?: boolean
  initiallyEnabled?: boolean
  label?: string
  functionParameters?: FunctionParameter[]
  functionReturnType?: string
  functionCopyPicked?: boolean
  comment?: string
  isOrBlock?: boolean
  isElse?: boolean
}

export type EventNode = Event | RecoveryNode<'event'>

export interface EventSheet extends NodeBase {
  name: string
  events: EventNode[]
  variables?: VariableNode[]
  includes?: EventSheetInclude[]
}

export type EventSheetNode = EventSheet | RecoveryNode<'sheet'>

export interface EventSheetInclude extends NodeBase {
  sheetName: string
  targetSheetId?: NodeId
}

export type VariableScope = 'global' | 'local' | 'instance'

export interface VariableDeclaration extends NodeBase {
  name: string
  dataType: string
  scope: VariableScope
  initialValue?: Expression
}

export type VariableNode = VariableDeclaration | RecoveryNode<'variable'>

export interface FunctionParameter extends NodeBase {
  name: string
  dataType: string
}

export interface FunctionDefinition extends NodeBase {
  name: string
  parameters: FunctionParameter[]
  body: EventNode[]
  returnType?: string
}

export type FunctionNode = FunctionDefinition | RecoveryNode<'function'>

export interface EventDocument {
  schemaVersion: number
  id: NodeId
  engine: EngineDescriptor
  metadata?: JsonObject
  sheets: EventSheetNode[]
  variables: VariableNode[]
  functions?: FunctionNode[]
  extensions?: Record<string, JsonValue>
}

export type ParseStatus = 'partial' | 'complete'

export interface ParseResult {
  document: EventDocument
  diagnostics: Diagnostic[]
  status: ParseStatus
}

export interface StreamParser {
  push(chunk: string): void
  snapshot(): ParseResult
  finish(): ParseResult
}

export interface ParameterDefinition {
  id: string
  valueType: 'string' | 'number' | 'boolean' | 'expression' | 'any'
  required?: boolean
}

export interface ExtensionDefinition {
  id: string
  kind: 'condition' | 'action' | 'expression'
  displayName: string
  parameters: ParameterDefinition[]
}

export interface EngineExtensionManifest {
  id: string
  version: string
  definitions: ExtensionDefinition[]
  metadata?: JsonObject
}

export interface DocumentImporter<TSource = unknown, TOptions = undefined> {
  readonly engineId: string
  import(source: TSource, options?: TOptions): ParseResult
}

export interface ExportResult<TOutput = string> {
  output: TOutput
  diagnostics: Diagnostic[]
  status: ParseStatus
}

export interface DocumentExporter<TOutput = string> {
  readonly engineId: string
  export(document: EventDocument): ExportResult<TOutput>
}

/** Scope metadata for an ACE registered to a behavior or plugin. */
export interface AceInvocationScope {
  behaviorType?: string
  pluginId?: string
}

export interface HostAdapter<TContext = unknown, TInstance = unknown> {
  readonly engineId: string
  getContext(): TContext
  evaluateCondition?(
    operation: string,
    parameters: readonly JsonValue[],
    context: TContext,
    scope?: AceInvocationScope,
  ): boolean | undefined
  evaluateExpression?(
    callee: string,
    parameters: readonly JsonValue[],
    context: TContext,
  ): JsonValue | undefined
  getInstances(objectType: string): readonly TInstance[]
  getObjectType(instance: TInstance): string
  getProperty(instance: TInstance, property: string): JsonValue
  setProperty(instance: TInstance, property: string, value: JsonValue): void
  callAction(
    objectClass: string,
    actionId: string,
    instances: readonly TInstance[],
    parameters: readonly JsonValue[],
    scope?: AceInvocationScope,
  ): void
  createInstance(objectType: string, properties?: Readonly<JsonObject>): TInstance
  /** Destroys one instance; the Construct runtime calls this for all linked container members. */
  destroyInstance(instance: TInstance): void
  queryObjects(objectType: string, predicate?: (instance: TInstance) => boolean): readonly TInstance[]
  /** Returns candidates whose Construct collision polygons overlap a layout point; undefined means unsupported. */
  pickOverlappingPoint?(
    objectType: string,
    x: number,
    y: number,
    candidates: readonly TInstance[],
    context: TContext,
  ): readonly TInstance[] | undefined
  /** Resolves a Construct UID to an instance from the active candidate set; undefined means unsupported, null means no match. */
  pickInstanceByUniqueId?(
    objectType: string,
    uniqueId: number,
    candidates: readonly TInstance[],
    context: TContext,
  ): TInstance | null | undefined
  /** Returns all instances linked to this instance by its Construct container, including itself. */
  getContainerMembers?(instance: TInstance): readonly TInstance[]
  /** Returns this instance's direct Construct hierarchy children, excluding the instance itself. */
  getHierarchyChildren?(instance: TInstance): readonly TInstance[]
}
