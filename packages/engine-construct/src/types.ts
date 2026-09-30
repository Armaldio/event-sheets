import type { Diagnostic, Expression, JsonObject } from '@project/schema'

export type ConstructParameterType =
  | 'number'
  | 'string'
  | 'any'
  | 'boolean'
  | 'combo'
  | 'combo-grouped'
  | 'cmp'
  | 'object'
  | 'objectname'
  | 'projectfile'
  | 'layer'
  | 'layout'
  | 'keyb'
  | 'instancevar'
  | 'instancevarbool'
  | 'eventvar'
  | 'eventvarbool'
  | 'animation'
  | 'objinstancevar'

export interface ConstructParameterItemGroup {
  id: string
  items: string[]
}

export interface ConstructParameterDefinition {
  id: string
  type: ConstructParameterType
  optional?: boolean
  name?: string
  initialValue?: string
  items?: string[]
  itemGroups?: ConstructParameterItemGroup[]
  allowedPluginIds?: string[]
  filter?: string
}

export interface AceDefinitionBase {
  id: string
  objectClass?: string
  behaviorType?: string
  pluginId?: string
  category: string
  name: string
  parameters?: ConstructParameterDefinition[]
  validate?: (parameters: readonly Expression[]) => readonly Diagnostic[]
  editorMetadata?: JsonObject
}

export interface ConditionDefinition extends AceDefinitionBase {
  scriptName: string
  isTrigger?: boolean
  isFakeTrigger?: boolean
  isStatic?: boolean
  isLooping?: boolean
  isInvertible?: boolean
  isCompatibleWithTriggers?: boolean
}

export interface ActionDefinition extends AceDefinitionBase {
  scriptName: string
  isAsync?: boolean
  isStatic?: boolean
}

export interface ExpressionDefinition extends AceDefinitionBase {
  expressionName: string
  returnType: 'number' | 'string' | 'any'
  isVariadicParameters?: boolean
}

export interface ConstructExtensionDefinitions {
  id: string
  conditions?: readonly Omit<ConditionDefinition, 'objectClass' | 'behaviorType' | 'pluginId'>[]
  actions?: readonly Omit<ActionDefinition, 'objectClass' | 'behaviorType' | 'pluginId'>[]
  expressions?: readonly Omit<ExpressionDefinition, 'objectClass' | 'behaviorType' | 'pluginId'>[]
}

/** Definitions scoped to one Construct object class. */
export interface ConstructExtension extends ConstructExtensionDefinitions {
  objectClass: string
}

/** Definitions scoped to a Construct behavior attached to object classes. */
export interface ConstructBehaviorExtension extends ConstructExtensionDefinitions {
  behaviorType: string
}

/** Definitions scoped to a Construct plugin, resolved using project object type metadata. */
export interface ConstructPluginExtension extends ConstructExtensionDefinitions {
  pluginId: string
}

/** Optional ACE lookup context from project object and behavior metadata. */
export interface ConstructAceLookupOptions {
  behaviorType?: string
  pluginId?: string
}

export interface ConstructEngineOptions {
  extensions?: readonly (ConstructExtension | ConstructBehaviorExtension | ConstructPluginExtension)[]
}

export interface ConstructEngine {
  readonly id: 'construct'
  readonly registry: import('./registry.js').ConstructRegistry
}
