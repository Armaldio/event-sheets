import { isJsonObject, type Diagnostic, type Expression } from '@project/schema'
import type {
  ActionDefinition,
  ConstructBehaviorExtension,
  ConditionDefinition,
  ConstructAceLookupOptions,
  ConstructEngine,
  ConstructEngineOptions,
  ConstructExtension,
  ConstructPluginExtension,
  ConstructParameterDefinition,
  ConstructParameterItemGroup,
  ConstructParameterType,
  ExpressionDefinition,
} from './types.js'

const parameterTypes = new Set<ConstructParameterType>([
  'number', 'string', 'any', 'boolean', 'combo', 'combo-grouped', 'cmp',
  'object', 'objectname', 'projectfile', 'layer', 'layout', 'keyb',
  'instancevar', 'instancevarbool', 'eventvar', 'eventvarbool', 'animation',
  'objinstancevar',
])

const systemExtension: ConstructExtension = {
  id: 'builtin.construct.system',
  objectClass: 'System',
  conditions: [
    {
      id: 'compare-two-values',
      category: 'general',
      name: 'Compare two values',
      scriptName: 'Compare',
      parameters: [
        { id: 'first-value', type: 'any' },
        { id: 'comparison', type: 'cmp' },
        { id: 'second-value', type: 'any' },
      ],
      isInvertible: true,
    },
    {
      id: 'is-between-values',
      category: 'general',
      name: 'Is between values',
      scriptName: 'IsBetweenValues',
      parameters: [
        { id: 'value', type: 'any' },
        { id: 'lower-bound', type: 'any' },
        { id: 'upper-bound', type: 'any' },
      ],
      isInvertible: true,
    },
    {
      id: 'every-tick',
      category: 'general',
      name: 'Every tick',
      scriptName: 'EveryTick',
      isInvertible: true,
    },
    {
      id: 'every-x-seconds',
      category: 'time',
      name: 'Every X seconds',
      scriptName: 'EveryXSeconds',
      parameters: [{ id: 'interval-seconds', type: 'number' }],
    },
    {
      id: 'else',
      category: 'general',
      name: 'Else',
      scriptName: 'Else',
    },
    {
      id: 'trigger-once-while-true',
      category: 'general',
      name: 'Trigger once while true',
      scriptName: 'TriggerOnceWhileTrue',
    },
    {
      id: 'is-group-active',
      category: 'general',
      name: 'Is group active',
      scriptName: 'IsGroupActive',
      parameters: [{ id: 'group-name', type: 'string' }],
      isInvertible: true,
    },
    {
      id: 'layer-is-visible',
      category: 'layers',
      name: 'Layer is visible',
      scriptName: 'LayerIsVisible',
      parameters: [{ id: 'layer', type: 'layer' }],
      isInvertible: true,
    },
    {
      id: 'layer-is-interactive',
      category: 'layers',
      name: 'Layer is interactive',
      scriptName: 'LayerIsInteractive',
      parameters: [{ id: 'layer', type: 'layer' }],
      isInvertible: true,
    },
    {
      id: 'repeat',
      category: 'loops',
      name: 'Repeat',
      scriptName: 'Repeat',
      parameters: [{ id: 'count', type: 'number' }],
      isLooping: true,
    },
    {
      id: 'for',
      category: 'loops',
      name: 'For',
      scriptName: 'For',
      parameters: [
        { id: 'name', type: 'string' },
        { id: 'start-index', type: 'number' },
        { id: 'end-index', type: 'number' },
      ],
      isLooping: true,
    },
    {
      id: 'repeat-while',
      category: 'loops',
      name: 'While',
      scriptName: 'While',
      isLooping: true,
    },
    {
      id: 'for-each',
      category: 'loops',
      name: 'For Each',
      scriptName: 'ForEach',
      parameters: [{ id: 'object', type: 'object' }],
      isLooping: true,
    },
    {
      id: 'for-each-ordered',
      category: 'loops',
      name: 'For Each Ordered',
      scriptName: 'ForEachOrdered',
      parameters: [
        { id: 'object', type: 'object' },
        { id: 'order', type: 'any' },
      ],
      isLooping: true,
    },
    {
      id: 'pick-by-comparison',
      category: 'pick-instances',
      name: 'Pick by comparison',
      scriptName: 'PickByComparison',
      parameters: [
        { id: 'object', type: 'object' },
        { id: 'first-value', type: 'any' },
        { id: 'comparison', type: 'cmp' },
        { id: 'second-value', type: 'any' },
      ],
      isInvertible: true,
    },
    {
      id: 'pick-by-evaluate',
      category: 'pick-instances',
      name: 'Pick by evaluate',
      scriptName: 'PickByEvaluate',
      parameters: [
        { id: 'object', type: 'object' },
        { id: 'expression', type: 'any' },
      ],
      isInvertible: true,
    },
    {
      id: 'pick-all',
      category: 'pick-instances',
      name: 'Pick all',
      scriptName: 'PickAll',
      parameters: [{ id: 'object', type: 'object' }],
      isInvertible: true,
    },
    {
      id: 'pick-overlapping-point',
      category: 'pick-instances',
      name: 'Pick overlapping point',
      scriptName: 'PickOverlappingPoint',
      parameters: [
        { id: 'object', type: 'object' },
        { id: 'x', type: 'number' },
        { id: 'y', type: 'number' },
      ],
      isInvertible: true,
    },
    {
      id: 'compare-eventvar',
      category: 'global-local-variables',
      name: 'Compare variable',
      scriptName: 'CompareEventvar',
      parameters: [
        { id: 'variable', type: 'eventvar' },
        { id: 'comparison', type: 'cmp' },
        { id: 'value', type: 'any' },
      ],
      isInvertible: true,
    },
    {
      id: 'compare-boolean-eventvar',
      category: 'global-local-variables',
      name: 'Is boolean variable true',
      scriptName: 'CompareBooleanEventvar',
      parameters: [{ id: 'variable', type: 'eventvarbool' }],
      isInvertible: true,
    },
    {
      id: 'on-start-of-layout',
      category: 'triggers',
      name: 'On start of layout',
      scriptName: 'OnStartOfLayout',
      isTrigger: true,
    },
  ],
  actions: [
    {
      id: 'stop-loop',
      category: 'loops',
      name: 'Stop loop',
      scriptName: 'StopLoop',
    },
    {
      id: 'set-eventvar-value',
      category: 'global-local-variables',
      name: 'Set value',
      scriptName: 'SetEventvarValue',
      parameters: [
        { id: 'variable', type: 'eventvar' },
        { id: 'value', type: 'any' },
      ],
    },
    {
      id: 'add-to-eventvar',
      category: 'global-local-variables',
      name: 'Add to variable',
      scriptName: 'AddToEventvar',
      parameters: [
        { id: 'variable', type: 'eventvar' },
        { id: 'value', type: 'number' },
      ],
    },
    {
      id: 'subtract-from-eventvar',
      category: 'global-local-variables',
      name: 'Subtract from variable',
      scriptName: 'SubtractFromEventvar',
      parameters: [
        { id: 'variable', type: 'eventvar' },
        { id: 'value', type: 'number' },
      ],
    },
    {
      id: 'reset-eventvar',
      category: 'global-local-variables',
      name: 'Reset variable',
      scriptName: 'ResetEventvar',
      parameters: [{ id: 'variable', type: 'eventvar' }],
    },
    {
      id: 'reset-global-variables',
      category: 'global-local-variables',
      name: 'Reset global variables',
      scriptName: 'ResetGlobalVariables',
      parameters: [{ id: 'reset-static', type: 'boolean', optional: true }],
    },
    {
      id: 'set-boolean-eventvar',
      category: 'global-local-variables',
      name: 'Set boolean variable',
      scriptName: 'SetBooleanEventvar',
      parameters: [
        { id: 'variable', type: 'eventvarbool' },
        { id: 'value', type: 'boolean' },
      ],
    },
    {
      id: 'toggle-boolean-eventvar',
      category: 'global-local-variables',
      name: 'Toggle boolean variable',
      scriptName: 'ToggleBooleanEventvar',
      parameters: [{ id: 'variable', type: 'eventvarbool' }],
    },
    {
      id: 'go-to-layout',
      category: 'layouts',
      name: 'Go to layout',
      scriptName: 'GoToLayout',
      parameters: [{ id: 'layout', type: 'layout' }],
    },
    {
      id: 'go-to-layout-by-name',
      category: 'layouts',
      name: 'Go to layout by name',
      scriptName: 'GoToLayoutByName',
      parameters: [{ id: 'layout', type: 'string' }],
    },
    {
      id: 'restart-layout',
      category: 'layouts',
      name: 'Restart layout',
      scriptName: 'RestartLayout',
    },
    {
      id: 'set-layout-vanishing-point',
      category: 'layouts',
      name: 'Set layout vanishing point',
      scriptName: 'SetLayoutVanishingPoint',
      parameters: [
        { id: 'vanishing-point-x', type: 'number' },
        { id: 'vanishing-point-y', type: 'number' },
      ],
    },
    {
      id: 'wait',
      category: 'time',
      name: 'Wait',
      scriptName: 'Wait',
      parameters: [{ id: 'seconds', type: 'number' }],
      isAsync: true,
    },
    {
      id: 'wait-for-previous-actions',
      category: 'general',
      name: 'Wait for previous actions',
      scriptName: 'WaitForPreviousActions',
      isAsync: true,
    },
    {
      id: 'set-group-active',
      category: 'general',
      name: 'Set group active',
      scriptName: 'SetGroupActive',
      parameters: [
        { id: 'group-name', type: 'string' },
        { id: 'state', type: 'combo', items: ['deactivated', 'activated', 'toggle'] },
      ],
    },
    {
      id: 'create-object',
      category: 'object-actions',
      name: 'Create object',
      scriptName: 'CreateObject',
      parameters: [
        { id: 'object-to-create', type: 'object' },
        { id: 'layer', type: 'layer' },
        { id: 'x', type: 'number' },
        { id: 'y', type: 'number' },
      ],
    },
    {
      id: 'set-layer-visible',
      category: 'layers',
      name: 'Set layer visible',
      scriptName: 'SetLayerVisible',
      parameters: [
        { id: 'layer', type: 'layer' },
        { id: 'visibility', type: 'combo', items: ['invisible', 'visible'] },
      ],
    },
    {
      id: 'set-layer-interactive',
      category: 'layers',
      name: 'Set layer interactive',
      scriptName: 'SetLayerInteractive',
      parameters: [
        { id: 'layer', type: 'layer' },
        { id: 'interactive', type: 'boolean' },
      ],
    },
    {
      id: 'set-layer-scale',
      category: 'layers',
      name: 'Set layer scale',
      scriptName: 'SetLayerScale',
      parameters: [
        { id: 'layer', type: 'layer' },
        { id: 'scale', type: 'number' },
      ],
    },
    {
      id: 'set-layer-effect-enabled',
      category: 'layers',
      name: 'Set layer effect enabled',
      scriptName: 'SetLayerEffectEnabled',
      parameters: [
        { id: 'layer', type: 'layer' },
        { id: 'mode', type: 'combo', items: ['enable', 'disable'] },
        { id: 'effect', type: 'string' },
      ],
    },
    {
      id: 'set-collision-cell-size',
      category: 'general',
      name: 'Set collision cell size',
      scriptName: 'SetCollisionCellSize',
      parameters: [
        { id: 'width', type: 'number' },
        { id: 'height', type: 'number' },
      ],
    },
    {
      id: 'set-time-scale',
      category: 'time',
      name: 'Set time scale',
      scriptName: 'SetTimeScale',
      parameters: [{ id: 'time-scale', type: 'number' }],
    },
  ],
}

const functionsExtension: ConstructExtension = {
  id: 'builtin.construct.functions',
  objectClass: 'Functions',
  actions: [{
    id: 'set-return-value',
    category: 'functions',
    name: 'Set return value',
    scriptName: 'SetReturnValue',
    parameters: [{ id: 'value', type: 'any' }],
  }],
}

const keyboardExtension: ConstructExtension = {
  id: 'builtin.construct.keyboard',
  objectClass: 'Keyboard',
  conditions: [
    {
      id: 'key-is-down',
      category: 'general',
      name: 'Key is down',
      scriptName: 'IsKeyDown',
      parameters: [{ id: 'key', type: 'keyb' }],
      isInvertible: true,
    },
    {
      id: 'on-key-pressed',
      category: 'triggers',
      name: 'On key pressed',
      scriptName: 'OnKeyPressed',
      parameters: [{ id: 'key', type: 'keyb' }],
      isTrigger: true,
    },
  ],
  actions: [{
    id: 'lock-keyboard',
    category: 'keyboard',
    name: 'Lock keyboard',
    scriptName: 'LockKeyboard',
    isStatic: true,
    parameters: [{ id: 'keys', type: 'string' }],
  }],
}

const touchExtension: ConstructExtension = {
  id: 'builtin.construct.touch',
  objectClass: 'Touch',
  conditions: [{
    id: 'has-nth-touch',
    category: 'general',
    name: 'Has Nth touch',
    scriptName: 'HasNthTouch',
    parameters: [{ id: 'touch-number', type: 'number' }],
    isInvertible: true,
  }, {
    id: 'is-touching-object',
    category: 'general',
    name: 'Is touching object',
    scriptName: 'IsTouchingObject',
    parameters: [{ id: 'object', type: 'object' }],
    isInvertible: true,
  }, {
    id: 'on-nth-touch-start',
    category: 'general',
    name: 'On nth touch start',
    scriptName: 'OnNthTouchStart',
    parameters: [{ id: 'touch-number', type: 'number' }],
    isTrigger: true,
  }, {
    id: 'on-nth-touch-end',
    category: 'general',
    name: 'On nth touch end',
    scriptName: 'OnNthTouchEnd',
    parameters: [{ id: 'touch-number', type: 'number' }],
    isTrigger: true,
  }],
}

const mouseButtons = ['left', 'middle', 'right']

const mouseExtension: ConstructExtension = {
  id: 'builtin.construct.mouse',
  objectClass: 'Mouse',
  conditions: [
    {
      id: 'cursor-is-over-object',
      category: 'general',
      name: 'Cursor is over object',
      scriptName: 'CursorIsOverObject',
      parameters: [{ id: 'object', type: 'object' }],
      isInvertible: true,
    },
    {
      id: 'mouse-button-is-down',
      category: 'general',
      name: 'Mouse button is down',
      scriptName: 'IsMouseButtonDown',
      parameters: [{ id: 'mouse-button', type: 'combo', items: mouseButtons }],
      isInvertible: true,
    },
    {
      id: 'has-pointer-lock',
      category: 'general',
      name: 'Has pointer lock',
      scriptName: 'HasPointerLock',
      isInvertible: true,
    },
    {
      id: 'on-click',
      category: 'triggers',
      name: 'On click',
      scriptName: 'OnClick',
      parameters: [
        { id: 'mouse-button', type: 'combo', items: mouseButtons },
        { id: 'click-type', type: 'combo', items: ['clicked'] },
      ],
      isTrigger: true,
    },
    {
      id: 'on-object-clicked',
      category: 'triggers',
      name: 'On object clicked',
      scriptName: 'OnObjectClicked',
      parameters: [
        { id: 'mouse-button', type: 'combo', items: mouseButtons },
        { id: 'click-type', type: 'combo', items: ['clicked', 'double-clicked'] },
        { id: 'object-clicked', type: 'object' },
      ],
      isTrigger: true,
    },
    {
      id: 'on-movement',
      category: 'triggers',
      name: 'On movement',
      scriptName: 'OnMovement',
      isTrigger: true,
    },
    {
      id: 'on-mouse-wheel',
      category: 'triggers',
      name: 'On mouse wheel',
      scriptName: 'OnMouseWheel',
      parameters: [{ id: 'direction', type: 'combo', items: ['up', 'down', 'any'] }],
      isTrigger: true,
    },
  ],
  actions: [{
    id: 'request-pointer-lock',
    category: 'pointer-lock',
    name: 'Request pointer lock',
    scriptName: 'RequestPointerLock',
    isStatic: true,
    parameters: [{ id: 'unadjusted-movement', type: 'boolean', optional: true }],
  }],
}

const commonObjectConditions: readonly ConditionDefinition[] = [{
  id: 'on-created',
  category: 'general',
  name: 'On created',
  scriptName: 'OnCreated',
  isTrigger: true,
}, {
  id: 'on-collision-with-another-object',
  category: 'collisions',
  name: 'On collision with another object',
  scriptName: 'OnCollisionWithAnotherObject',
  parameters: [{ id: 'object', type: 'object' }],
  isTrigger: true,
}, {
  id: 'is-overlapping-another-object',
  category: 'collisions',
  name: 'Is overlapping another object',
  scriptName: 'IsOverlappingAnotherObject',
  parameters: [{ id: 'object', type: 'object' }],
  isInvertible: true,
}, {
  id: 'is-between-angles',
  category: 'angles',
  name: 'Is between angles',
  scriptName: 'IsBetweenAngles',
  parameters: [
    { id: 'first-angle', type: 'number' },
    { id: 'second-angle', type: 'number' },
  ],
  isInvertible: true,
}, {
  id: 'pick-by-unique-id',
  category: 'pick-instances',
  name: 'Pick by unique ID',
  scriptName: 'PickByUniqueId',
  parameters: [{ id: 'unique-id', type: 'number' }],
  isInvertible: true,
}, {
  id: 'pick-children',
  category: 'hierarchy',
  name: 'Pick children',
  scriptName: 'PickChildren',
  parameters: [
    { id: 'child', type: 'object' },
    { id: 'which', type: 'combo', items: ['own', 'all'] },
  ],
}, {
  id: 'compare-instance-variable',
  category: 'instance-variables',
  name: 'Compare instance variable',
  scriptName: 'CompareInstanceVariable',
  parameters: [
    { id: 'instance-variable', type: 'instancevar' },
    { id: 'comparison', type: 'cmp' },
    { id: 'value', type: 'any' },
  ],
  isInvertible: true,
}, {
  id: 'compare-z-elevation',
  category: 'size-position',
  name: 'Compare Z elevation',
  scriptName: 'CompareZElevation',
  parameters: [
    { id: 'which', type: 'combo', items: ['z-elevation'] },
    { id: 'comparison', type: 'cmp' },
    { id: 'z-elevation', type: 'number' },
  ],
  isInvertible: true,
}, {
  id: 'compare-y',
  category: 'size-position',
  name: 'Compare Y',
  scriptName: 'CompareY',
  parameters: [
    { id: 'comparison', type: 'cmp' },
    { id: 'y-co-ordinate', type: 'number' },
  ],
  isInvertible: true,
}, {
  id: 'is-overlapping-at-offset',
  category: 'collisions',
  name: 'Is overlapping at offset',
  scriptName: 'IsOverlappingAtOffset',
  parameters: [
    { id: 'object', type: 'object' },
    { id: 'offset-x', type: 'number' },
    { id: 'offset-y', type: 'number' },
  ],
  isInvertible: true,
}, {
  id: 'is-boolean-instance-variable-set',
  category: 'instance-variables',
  name: 'Is boolean instance variable set',
  scriptName: 'IsBooleanInstanceVariableSet',
  parameters: [{ id: 'instance-variable', type: 'instancevarbool' }],
  isInvertible: true,
}]

const commonObjectActions: readonly ActionDefinition[] = [{
  id: 'destroy',
  category: 'general',
  name: 'Destroy',
  scriptName: 'Destroy',
}, {
  id: 'set-position',
  category: 'position',
  name: 'Set position',
  scriptName: 'SetPosition',
  parameters: [
    { id: 'x', type: 'number' },
    { id: 'y', type: 'number' },
  ],
}, {
  id: 'set-enabled',
  category: 'state',
  name: 'Set enabled',
  scriptName: 'SetEnabled',
  parameters: [{ id: 'state', type: 'combo', items: ['disabled', 'enabled'] }],
}, {
  id: 'set-solid-collision-filter',
  category: 'collision',
  name: 'Set solid collision filter',
  scriptName: 'SetSolidCollisionFilter',
  parameters: [
    { id: 'mode', type: 'combo', items: ['inclusive', 'exclusive'] },
    { id: 'tags', type: 'string' },
  ],
}, {
  id: 'set-angle',
  category: 'angles',
  name: 'Set angle',
  scriptName: 'SetAngle',
  parameters: [{ id: 'angle', type: 'number' }],
}, {
  id: 'set-angle-toward-position',
  category: 'angles',
  name: 'Set angle toward position',
  scriptName: 'SetAngleTowardPosition',
  parameters: [
    { id: 'x', type: 'number' },
    { id: 'y', type: 'number' },
  ],
}, {
  id: 'set-instvar-value',
  category: 'instance-variables',
  name: 'Set instance variable',
  scriptName: 'SetInstvarValue',
  parameters: [
    { id: 'instance-variable', type: 'instancevar' },
    { id: 'value', type: 'any' },
  ],
}, {
  id: 'subtract-from-instvar',
  category: 'instance-variables',
  name: 'Subtract from instance variable',
  scriptName: 'SubtractFromInstvar',
  parameters: [
    { id: 'instance-variable', type: 'instancevar' },
    { id: 'value', type: 'any' },
  ],
}, {
  id: 'set-boolean-instvar',
  category: 'instance-variables',
  name: 'Set boolean instance variable',
  scriptName: 'SetBooleanInstvar',
  parameters: [
    { id: 'instance-variable', type: 'instancevarbool' },
    { id: 'value', type: 'boolean' },
  ],
}, {
  id: 'set-x',
  category: 'size-position',
  name: 'Set X',
  scriptName: 'SetX',
  parameters: [{ id: 'x', type: 'number' }],
}, {
  id: 'set-y',
  category: 'size-position',
  name: 'Set Y',
  scriptName: 'SetY',
  parameters: [{ id: 'y', type: 'number' }],
}, {
  id: 'set-z-elevation',
  category: 'size-position',
  name: 'Set Z elevation',
  scriptName: 'SetZElevation',
  parameters: [{ id: 'z', type: 'number' }],
}, {
  id: 'move-at-angle',
  category: 'size-position',
  name: 'Move at angle',
  scriptName: 'MoveAtAngle',
  parameters: [
    { id: 'angle', type: 'number' },
    { id: 'distance', type: 'number' },
  ],
}, {
  id: 'set-visible',
  category: 'appearance',
  name: 'Set visible',
  scriptName: 'SetVisible',
  parameters: [{ id: 'visibility', type: 'combo', items: ['invisible', 'visible', 'toggle'] }],
}]

const commonObjectConditionById = new Map(commonObjectConditions.map((definition) => [definition.id, definition]))
const commonObjectActionById = new Map(commonObjectActions.map((definition) => [definition.id, definition]))

const gamepadButtons = [
  'button-a', 'button-b', 'button-x', 'button-y',
  'd-pad-up', 'd-pad-down', 'd-pad-left', 'd-pad-right',
  'left-shoulder-button', 'right-shoulder-button',
  'left-shoulder-trigger', 'right-shoulder-trigger',
  'back-view', 'start-menu', 'left-stick', 'right-stick',
]

const gamepadExtension: ConstructExtension = {
  id: 'builtin.construct.gamepad',
  objectClass: 'Gamepad',
  conditions: [
    {
      id: 'is-button-down',
      category: 'general',
      name: 'Is button down',
      scriptName: 'IsButtonDown',
      parameters: [
        { id: 'gamepad', type: 'number' },
        { id: 'button', type: 'combo', items: gamepadButtons },
      ],
      isInvertible: true,
    },
    {
      id: 'compare-axis',
      category: 'general',
      name: 'Compare axis',
      scriptName: 'CompareAxis',
      parameters: [
        { id: 'gamepad', type: 'number' },
        { id: 'axis', type: 'combo', items: [
          'left-analog-x-axis', 'left-analog-y-axis',
          'right-analog-x-axis', 'right-analog-y-axis',
        ] },
        { id: 'comparison', type: 'cmp' },
        { id: 'value', type: 'number' },
      ],
      isInvertible: true,
    },
    {
      id: 'on-button-pressed',
      category: 'triggers',
      name: 'On button pressed',
      scriptName: 'OnButtonPressed',
      parameters: [
        { id: 'gamepad', type: 'number' },
        { id: 'button', type: 'combo', items: gamepadButtons },
      ],
      isFakeTrigger: true,
    },
  ],
}

const browserExtension: ConstructExtension = {
  id: 'builtin.construct.browser',
  objectClass: 'Browser',
  conditions: [{
    id: 'is-fullscreen',
    category: 'general',
    name: 'Is fullscreen',
    scriptName: 'IsFullscreen',
    isInvertible: true,
  }],
  actions: [
    {
      id: 'alert',
      category: 'window',
      name: 'Alert',
      scriptName: 'Alert',
      isStatic: true,
      parameters: [{ id: 'message', type: 'any' }],
    },
    {
      id: 'log',
      category: 'debugging',
      name: 'Log',
      scriptName: 'Log',
      isStatic: true,
      parameters: [
        { id: 'type', type: 'combo', items: ['log', 'warning', 'error'] },
        { id: 'message', type: 'any' },
      ],
    },
    {
      id: 'cancel-fullscreen',
      category: 'window',
      name: 'Cancel fullscreen',
      scriptName: 'CancelFullscreen',
      isStatic: true,
    },
    {
      id: 'request-fullscreen',
      category: 'window',
      name: 'Request fullscreen',
      scriptName: 'RequestFullscreen',
      isStatic: true,
      parameters: [
        { id: 'mode', type: 'combo', items: ['stretch-letterbox-scale'] },
        { id: 'navigation-ui', type: 'combo', items: ['show', 'hide'] },
      ],
    },
    {
      id: 'reload',
      category: 'navigation',
      name: 'Reload',
      scriptName: 'Reload',
      isStatic: true,
    },
    {
      id: 'open-url-in-new-window',
      category: 'navigation',
      name: 'Open URL in new window',
      scriptName: 'OpenURLInNewWindow',
      isStatic: true,
      parameters: [
        { id: 'url', type: 'string' },
        { id: 'tag', type: 'string' },
      ],
    },
  ],
}

const webSocketExtension: ConstructExtension = {
  id: 'builtin.construct.websocket',
  objectClass: 'WebSocket',
  conditions: [{
    id: 'is-open',
    category: 'connection',
    name: 'Is open',
    scriptName: 'IsOpen',
    isInvertible: true,
  }, {
    id: 'is-connecting',
    category: 'connection',
    name: 'Is connecting',
    scriptName: 'IsConnecting',
    isInvertible: true,
  }, {
    id: 'is-supported',
    category: 'connection',
    name: 'Is supported',
    scriptName: 'IsSupported',
    isInvertible: true,
  }, {
    id: 'on-opened',
    category: 'connection',
    name: 'On opened',
    scriptName: 'OnOpened',
    isTrigger: true,
  }, {
    id: 'on-message',
    category: 'messages',
    name: 'On message',
    scriptName: 'OnMessage',
    isTrigger: true,
  }, {
    id: 'on-closed',
    category: 'connection',
    name: 'On closed',
    scriptName: 'OnClosed',
    isTrigger: true,
  }, {
    id: 'on-error',
    category: 'connection',
    name: 'On error',
    scriptName: 'OnError',
    isTrigger: true,
  }, {
    id: 'on-binary-message',
    category: 'messages',
    name: 'On binary message',
    scriptName: 'OnBinaryMessage',
    isTrigger: true,
    parameters: [{ id: 'receive-to', type: 'object' }],
  }],
  actions: [{
    id: 'connect',
    category: 'connection',
    name: 'Connect',
    scriptName: 'Connect',
    isStatic: true,
    parameters: [
      { id: 'url', type: 'string' },
      { id: 'protocol-optional', type: 'string' },
    ],
  }, {
    id: 'send-text',
    category: 'messages',
    name: 'Send text',
    scriptName: 'SendText',
    isStatic: true,
    parameters: [{ id: 'data', type: 'any' }],
  }, {
    id: 'close',
    category: 'connection',
    name: 'Close',
    scriptName: 'Close',
    isStatic: true,
  }],
}

const tilemapExtension: ConstructExtension = {
  id: 'builtin.construct.tilemap',
  objectClass: 'Tilemap',
  actions: [{
    id: 'set-tile',
    category: 'tiles',
    name: 'Set tile',
    scriptName: 'SetTile',
    parameters: [
      { id: 'tile-x', type: 'number' },
      { id: 'tile-y', type: 'number' },
      { id: 'tile', type: 'number' },
      { id: 'state', type: 'string' },
    ],
  }],
}

const tweenBehaviorExtension: ConstructBehaviorExtension = {
  id: 'builtin.construct.behavior.tween',
  behaviorType: 'Tween',
  conditions: [{
    id: 'is-playing',
    category: 'playback',
    name: 'Is playing',
    scriptName: 'IsPlaying',
    parameters: [{ id: 'tags', type: 'string' }],
    isInvertible: true,
  }, {
    id: 'on-tweens-finished',
    category: 'triggers',
    name: 'On tweens finished',
    scriptName: 'OnTweensFinished',
    parameters: [{ id: 'tags', type: 'string' }],
    isTrigger: true,
  }, {
    id: 'on-any-tweens-finished',
    category: 'triggers',
    name: 'On any tweens finished',
    scriptName: 'OnAnyTweensFinished',
    isTrigger: true,
  }],
  actions: [{
    id: 'stop-tweens',
    category: 'playback',
    name: 'Stop tweens',
    scriptName: 'StopTweens',
    parameters: [{ id: 'tags', type: 'string' }],
  }, {
    id: 'stop-all-tweens',
    category: 'playback',
    name: 'Stop all tweens',
    scriptName: 'StopAllTweens',
  }, {
    id: 'tween-one-property',
    category: 'playback',
    name: 'Tween (one property)',
    scriptName: 'TweenOneProperty',
    parameters: [
      { id: 'tags', type: 'string' },
      { id: 'property', type: 'string' },
      { id: 'end-value', type: 'number' },
      { id: 'time', type: 'number' },
      { id: 'ease', type: 'string' },
      { id: 'destroy-on-complete', type: 'combo', items: ['yes', 'no'] },
      { id: 'loop', type: 'combo', items: ['yes', 'no'] },
      { id: 'ping-pong', type: 'combo', items: ['yes', 'no'] },
      { id: 'repeat-count', type: 'number' },
    ],
  }, {
    id: 'tween-two-properties',
    category: 'playback',
    name: 'Tween (two properties)',
    scriptName: 'TweenTwoProperties',
    parameters: [
      { id: 'tags', type: 'string' },
      { id: 'property', type: 'string' },
      { id: 'end-x', type: 'number' },
      { id: 'end-y', type: 'number' },
      { id: 'time', type: 'number' },
      { id: 'ease', type: 'string' },
      { id: 'destroy-on-complete', type: 'combo', items: ['yes', 'no'] },
      { id: 'loop', type: 'combo', items: ['yes', 'no'] },
      { id: 'ping-pong', type: 'combo', items: ['yes', 'no'] },
      { id: 'repeat-count', type: 'number' },
    ],
  }, {
    id: 'tween-value',
    category: 'playback',
    name: 'Tween (value)',
    scriptName: 'TweenValue',
    parameters: [
      { id: 'tags', type: 'string' },
      { id: 'start-value', type: 'number' },
      { id: 'end-value', type: 'number' },
      { id: 'time', type: 'number' },
      { id: 'ease', type: 'string' },
      { id: 'destroy-on-complete', type: 'combo', items: ['yes', 'no'] },
      { id: 'loop', type: 'combo', items: ['yes', 'no'] },
      { id: 'ping-pong', type: 'combo', items: ['yes', 'no'] },
      { id: 'repeat-count', type: 'number' },
    ],
  }, {
    id: 'set-enabled',
    category: 'state',
    name: 'Set enabled',
    scriptName: 'SetEnabled',
    parameters: [{ id: 'mode', type: 'combo', items: ['disabled', 'enabled'] }],
  }],
}

const timerBehaviorExtension: ConstructBehaviorExtension = {
  id: 'builtin.construct.behavior.timer',
  behaviorType: 'Timer',
  conditions: [{
    id: 'is-timer-running',
    category: 'timers',
    name: 'Is timer running',
    scriptName: 'IsTimerRunning',
    parameters: [{ id: 'tag', type: 'string' }],
    isInvertible: true,
  }, {
    id: 'on-timer',
    category: 'timers',
    name: 'On timer',
    scriptName: 'OnTimer',
    parameters: [{ id: 'tag', type: 'string' }],
    isTrigger: true,
  }],
  actions: [{
    id: 'start-timer',
    category: 'timers',
    name: 'Start timer',
    scriptName: 'StartTimer',
    parameters: [
      { id: 'duration', type: 'number' },
      { id: 'type', type: 'combo', items: ['once', 'regular'] },
      { id: 'tag', type: 'string' },
    ],
  }, {
    id: 'stop-timer',
    category: 'timers',
    name: 'Stop timer',
    scriptName: 'StopTimer',
    parameters: [{ id: 'tag', type: 'string' }],
  }],
}

const bulletBehaviorExtension: ConstructBehaviorExtension = {
  id: 'builtin.construct.behavior.bullet',
  behaviorType: 'Bullet',
  conditions: [{
    id: 'on-step',
    category: 'triggers',
    name: 'On step',
    scriptName: 'OnStep',
    isTrigger: true,
  }],
  actions: [{
    id: 'set-angle-of-motion',
    category: 'movement',
    name: 'Set angle of motion',
    scriptName: 'SetAngleOfMotion',
    parameters: [{ id: 'angle', type: 'number' }],
  }, {
    id: 'set-speed',
    category: 'movement',
    name: 'Set speed',
    scriptName: 'SetSpeed',
    parameters: [{ id: 'speed', type: 'number' }],
  }, {
    id: 'set-enabled',
    category: 'state',
    name: 'Set enabled',
    scriptName: 'SetEnabled',
    parameters: [{ id: 'state', type: 'combo', items: ['disabled', 'enabled'] }],
  }],
}

const moveToBehaviorExtension: ConstructBehaviorExtension = {
  id: 'builtin.construct.behavior.moveto',
  behaviorType: 'MoveTo',
  actions: [{
    id: 'move-to-object',
    category: 'movement',
    name: 'Move to object',
    scriptName: 'MoveToObject',
    parameters: [
      { id: 'object', type: 'object' },
      { id: 'image-point', type: 'number' },
      { id: 'mode', type: 'string' },
    ],
  }],
}

const physicsBehaviorExtension: ConstructBehaviorExtension = {
  id: 'builtin.construct.behavior.physics',
  behaviorType: 'Physics',
  actions: [{
    id: 'set-velocity',
    category: 'velocity',
    name: 'Set velocity',
    scriptName: 'SetVelocity',
    parameters: [
      { id: 'x-component', type: 'number' },
      { id: 'y-component', type: 'number' },
    ],
  }, {
    id: 'apply-force-at-angle',
    category: 'forces',
    name: 'Apply force at angle',
    scriptName: 'ApplyForceAtAngle',
    parameters: [
      { id: 'force', type: 'number' },
      { id: 'angle', type: 'number' },
      { id: 'image-point', type: 'number' },
    ],
  }, {
    id: 'set-world-gravity',
    category: 'world',
    name: 'Set world gravity',
    scriptName: 'SetWorldGravity',
    parameters: [{ id: 'gravity', type: 'number' }],
  }, {
    id: 'set-stepping-mode',
    category: 'world',
    name: 'Set stepping mode',
    scriptName: 'SetSteppingMode',
    parameters: [{ id: 'mode', type: 'combo', items: ['fixed', 'framerate'] }],
  }, {
    id: 'enabledisable-collisions',
    category: 'collisions',
    name: 'Enable/disable collisions',
    scriptName: 'EnableDisableCollisions',
    parameters: [
      { id: 'object', type: 'object' },
      { id: 'state', type: 'combo', items: ['enable', 'disable'] },
    ],
  }],
}

const cannon3dPhysicsBehaviorExtension: ConstructBehaviorExtension = {
  id: 'builtin.construct.behavior.cannon3d-physics',
  behaviorType: 'Cannon3DPhysics',
  actions: [{
    id: 'Raycast',
    category: 'raycasting',
    name: 'Raycast',
    scriptName: 'Raycast',
    parameters: [
      { id: 'tag', type: 'string' },
      { id: 'fromX', type: 'number' },
      { id: 'fromY', type: 'number' },
      { id: 'fromZ', type: 'number' },
      { id: 'toX', type: 'number' },
      { id: 'toY', type: 'number' },
      { id: 'toZ', type: 'number' },
      { id: 'collisionFilterGroup', type: 'number' },
      { id: 'collisionFilterMask', type: 'number' },
      { id: 'skipBackfaces', type: 'boolean' },
      { id: 'mode', type: 'string' },
    ],
  }],
}

const eightDirectionBehaviorExtension: ConstructBehaviorExtension = {
  id: 'builtin.construct.behavior.8direction',
  behaviorType: '8Direction',
  actions: [{
    id: 'set-vector-x',
    category: 'movement',
    name: 'Set vector X',
    scriptName: 'SetVectorX',
    parameters: [{ id: 'vector-x', type: 'number' }],
  }, {
    id: 'set-vector-y',
    category: 'movement',
    name: 'Set vector Y',
    scriptName: 'SetVectorY',
    parameters: [{ id: 'vector-y', type: 'number' }],
  }, {
    id: 'set-max-speed',
    category: 'movement',
    name: 'Set maximum speed',
    scriptName: 'SetMaxSpeed',
    parameters: [{ id: 'max-speed', type: 'number' }],
  }, {
    id: 'simulate-control',
    category: 'controls',
    name: 'Simulate control',
    scriptName: 'SimulateControl',
    parameters: [{ id: 'control', type: 'combo', items: ['left', 'right', 'up', 'down'] }],
  }, {
    id: 'stop',
    category: 'movement',
    name: 'Stop',
    scriptName: 'Stop',
  }],
}

const platformBehaviorExtension: ConstructBehaviorExtension = {
  id: 'builtin.construct.behavior.platform',
  behaviorType: 'Platform',
  conditions: [{
    id: 'is-on-floor',
    category: 'movement',
    name: 'Is on floor',
    scriptName: 'IsOnFloor',
    isInvertible: true,
  }, {
    id: 'is-falling',
    category: 'movement',
    name: 'Is falling',
    scriptName: 'IsFalling',
    isInvertible: true,
  }, {
    id: 'is-jumping',
    category: 'movement',
    name: 'Is jumping',
    scriptName: 'IsJumping',
    isInvertible: true,
  }, {
    id: 'is-moving',
    category: 'movement',
    name: 'Is moving',
    scriptName: 'IsMoving',
    isInvertible: true,
  }, {
    id: 'on-landed',
    category: 'movement',
    name: 'On landed',
    scriptName: 'OnLanded',
    isTrigger: true,
  }],
  actions: [{
    id: 'set-vector-y',
    category: 'movement',
    name: 'Set vector Y',
    scriptName: 'SetVectorY',
    parameters: [{ id: 'vector-y', type: 'number' }],
  }, {
    id: 'simulate-control',
    category: 'controls',
    name: 'Simulate control',
    scriptName: 'SimulateControl',
    parameters: [{ id: 'control', type: 'combo', items: ['left', 'right', 'jump'] }],
  }, {
    id: 'set-enabled',
    category: 'state',
    name: 'Set enabled',
    scriptName: 'SetEnabled',
    parameters: [{ id: 'state', type: 'combo', items: ['disabled', 'enabled'] }],
  }],
}

const solidBehaviorExtension: ConstructBehaviorExtension = {
  id: 'builtin.construct.behavior.solid',
  behaviorType: 'Solid',
  actions: [{
    id: 'set-tags',
    category: 'tags',
    name: 'Set tags',
    scriptName: 'SetTags',
    parameters: [{ id: 'tags', type: 'string' }],
  }],
}

const carBehaviorExtension: ConstructBehaviorExtension = {
  id: 'builtin.construct.behavior.car',
  behaviorType: 'Car',
  conditions: [{
    id: 'is-moving',
    category: 'movement',
    name: 'Is moving',
    scriptName: 'IsMoving',
    isInvertible: true,
  }],
  actions: [{
    id: 'simulate-control',
    category: 'controls',
    name: 'Simulate control',
    scriptName: 'SimulateControl',
    parameters: [{ id: 'control', type: 'combo', items: ['accelerate', 'brake', 'left', 'right'] }],
  }],
}

const textSetTextAction: Omit<ActionDefinition, 'objectClass' | 'behaviorType' | 'pluginId'> = {
  id: 'set-text',
  category: 'text',
  name: 'Set text',
  scriptName: 'SetText',
  parameters: [{ id: 'text', type: 'any' }],
}

const clipboardPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.clipboard',
  pluginId: 'Clipboard',
  actions: [{
    id: 'copy-text',
    category: 'clipboard',
    name: 'Copy text',
    scriptName: 'CopyText',
    parameters: [{ id: 'text', type: 'any' }],
  }],
}

const setDefaultColorAction: Omit<ActionDefinition, 'objectClass' | 'behaviorType' | 'pluginId'> = {
  id: 'set-default-color',
  category: 'appearance',
  name: 'Set default color',
  scriptName: 'SetDefaultColor',
  parameters: [{ id: 'color', type: 'any' }],
}

const textPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.text',
  pluginId: 'Text',
  conditions: [{
    id: 'has-tag-at-position',
    category: 'text',
    name: 'Has tag at position',
    scriptName: 'HasTagAtPosition',
    parameters: [
      { id: 'tag', type: 'string' },
      { id: 'x', type: 'number' },
      { id: 'y', type: 'number' },
    ],
    isInvertible: true,
  }],
  actions: [textSetTextAction],
}

const spriteFontPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.spritefont2',
  pluginId: 'Spritefont2',
  actions: [textSetTextAction],
}

const textInputPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.textbox',
  pluginId: 'TextBox',
  conditions: [{
    id: 'on-text-changed',
    category: 'input',
    name: 'On text changed',
    scriptName: 'OnTextChanged',
    isTrigger: true,
  }],
  actions: [
    textSetTextAction,
    {
      id: 'append-text',
      category: 'text',
      name: 'Append text',
      scriptName: 'AppendText',
      parameters: [{ id: 'text', type: 'any' }],
    },
    {
      id: 'scroll-to-bottom',
      category: 'text',
      name: 'Scroll to bottom',
      scriptName: 'ScrollToBottom',
    },
  ],
}

const buttonPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.button',
  pluginId: 'Button',
  conditions: [{
    id: 'on-clicked',
    category: 'input',
    name: 'On clicked',
    scriptName: 'OnClicked',
    isTrigger: true,
  }],
}

const jsonPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.json',
  pluginId: 'Json',
  conditions: [{
    id: 'has-key',
    category: 'keys',
    name: 'Has key',
    scriptName: 'HasKey',
    parameters: [{ id: 'path', type: 'string' }],
    isInvertible: true,
  }, {
    id: 'compare-value',
    category: 'values',
    name: 'Compare value',
    scriptName: 'CompareValue',
    parameters: [
      { id: 'path', type: 'string' },
      { id: 'cmp', type: 'cmp' },
      { id: 'value', type: 'any' },
    ],
    isInvertible: true,
  }, {
    id: 'is-boolean-set',
    category: 'values',
    name: 'Is boolean set',
    scriptName: 'IsBooleanSet',
    parameters: [{ id: 'path', type: 'string' }],
    isInvertible: true,
  }],
  actions: [{
    id: 'parse',
    category: 'data',
    name: 'Parse',
    scriptName: 'Parse',
    parameters: [{ id: 'data', type: 'string' }],
  }],
}

const ajaxPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.ajax',
  pluginId: 'AJAX',
  actions: [{
    id: 'request-project-file',
    category: 'requests',
    name: 'Request project file',
    scriptName: 'RequestProjectFile',
    parameters: [
      { id: 'tag', type: 'string' },
      { id: 'file', type: 'projectfile' },
    ],
    isAsync: true,
  }],
}

const listPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.list',
  pluginId: 'List',
  conditions: [{
    id: 'compare-selected-item-text',
    category: 'selection',
    name: 'Compare selected item text',
    scriptName: 'CompareSelectedItemText',
    parameters: [
      { id: 'text-to-compare', type: 'any' },
      { id: 'case-sensitivity', type: 'combo', items: ['case-sensitive', 'ignore-case'] },
    ],
    isInvertible: true,
  }, {
    id: 'on-selection-changed',
    category: 'selection',
    name: 'On selection changed',
    scriptName: 'OnSelectionChanged',
    isTrigger: true,
  }],
}

const sliderbarPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.sliderbar',
  pluginId: 'sliderbar',
  conditions: [{
    id: 'on-changing',
    category: 'selection',
    name: 'On changing',
    scriptName: 'OnChanging',
    isTrigger: true,
  }],
}

const drawingCanvasPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.drawingcanvas',
  pluginId: 'DrawingCanvas',
  actions: [{
    id: 'clear-canvas',
    category: 'canvas',
    name: 'Clear canvas',
    scriptName: 'ClearCanvas',
    parameters: [{ id: 'color', type: 'any' }],
  }, {
    id: 'fill-rect',
    category: 'canvas',
    name: 'Fill rect',
    scriptName: 'FillRect',
    parameters: [
      { id: 'left', type: 'number' },
      { id: 'top', type: 'number' },
      { id: 'right', type: 'number' },
      { id: 'bottom', type: 'number' },
      { id: 'color', type: 'any' },
    ],
  }, {
    id: 'set-position',
    category: 'canvas',
    name: 'Set position',
    scriptName: 'SetPosition',
    parameters: [
      { id: 'x', type: 'number' },
      { id: 'y', type: 'number' },
    ],
  }, {
    id: 'set-size',
    category: 'canvas',
    name: 'Set size',
    scriptName: 'SetSize',
    parameters: [
      { id: 'width', type: 'number' },
      { id: 'height', type: 'number' },
    ],
  }, {
    id: 'paste-object',
    category: 'canvas',
    name: 'Paste object',
    scriptName: 'PasteObject',
    parameters: [
      { id: 'object', type: 'object' },
      { id: 'effects', type: 'string' },
    ],
  }],
}

const camera3dPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.camera3d',
  pluginId: 'Camera3D',
  actions: [
    {
      id: 'rotate-camera',
      category: 'camera',
      name: 'Rotate camera',
      scriptName: 'RotateCamera',
      parameters: [
        { id: 'rotate-x', type: 'number' },
        { id: 'rotate-y', type: 'number' },
        { id: 'min-polar-angle', type: 'number' },
        { id: 'max-polar-angle', type: 'number' },
      ],
    },
    {
      id: 'set-field-of-view',
      category: 'camera',
      name: 'Set field of view',
      scriptName: 'SetFieldOfView',
      parameters: [{ id: 'fov', type: 'number' }],
    },
    {
      id: 'look-parallel-to-layout',
      category: 'camera',
      name: 'Look parallel to layout',
      scriptName: 'LookParallelToLayout',
      parameters: [
        { id: 'cam-x', type: 'number' },
        { id: 'cam-y', type: 'number' },
        { id: 'cam-z', type: 'number' },
        { id: 'look-angle', type: 'number' },
      ],
    },
    {
      id: 'set-position',
      category: 'camera',
      name: 'Set position',
      scriptName: 'SetPosition',
      parameters: [
        { id: 'x', type: 'number' },
        { id: 'y', type: 'number' },
        { id: 'z', type: 'number' },
        { id: 'which', type: 'combo', items: ['camera', 'look'] },
      ],
    },
  ],
}

const audioPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.audio',
  pluginId: 'Audio',
  conditions: [{
    id: 'is-tag-playing',
    category: 'playback',
    name: 'Is tag playing',
    scriptName: 'IsTagPlaying',
    parameters: [{ id: 'tag', type: 'string' }],
    isInvertible: true,
  }],
  actions: [{
    id: 'play-by-name',
    category: 'playback',
    name: 'Play by name',
    scriptName: 'PlayByName',
    parameters: [
      { id: 'folder', type: 'combo', items: ['sounds', 'music'] },
      { id: 'audio-file-name', type: 'string' },
      { id: 'loop', type: 'combo', items: ['not-looping', 'looping'] },
      { id: 'volume', type: 'number' },
      { id: 'stereo-pan', type: 'number' },
      { id: 'tag-optional', type: 'string' },
    ],
  }],
}

const spritePluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.sprite',
  pluginId: 'Sprite',
  conditions: [{
    id: 'is-animation-playing',
    category: 'animation',
    name: 'Is animation playing',
    scriptName: 'IsAnimationPlaying',
    parameters: [{ id: 'animation', type: 'string' }],
    isInvertible: true,
  }, {
    id: 'is-mirrored',
    category: 'appearance',
    name: 'Is mirrored',
    scriptName: 'IsMirrored',
    isInvertible: true,
  }],
  actions: [setDefaultColorAction, {
    id: 'spawn-another-object',
    category: 'creation',
    name: 'Spawn another object',
    scriptName: 'SpawnAnotherObject',
    parameters: [
      { id: 'object', type: 'object' },
      { id: 'layer', type: 'layer' },
      { id: 'image-point', type: 'string' },
      { id: 'create-hierarchy', type: 'boolean' },
      { id: 'template-name', type: 'string', optional: true, initialValue: '' },
    ],
  }, {
    id: 'set-animation',
    category: 'animation',
    name: 'Set animation',
    scriptName: 'SetAnimation',
    parameters: [
      { id: 'animation', type: 'string' },
      { id: 'from', type: 'combo', items: ['beginning', 'current-frame'] },
    ],
  }, {
    id: 'set-animation-speed',
    category: 'animation',
    name: 'Set animation speed',
    scriptName: 'SetAnimationSpeed',
    parameters: [{ id: 'speed', type: 'number' }],
  }, {
    id: 'set-mirrored',
    category: 'appearance',
    name: 'Set mirrored',
    scriptName: 'SetMirrored',
    parameters: [{ id: 'state', type: 'combo', items: ['not-mirrored', 'mirrored'] }],
  }],
}

const shape3dPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.shape3d',
  pluginId: 'Shape3D',
  actions: [setDefaultColorAction],
}

const tilemapPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.tilemap',
  pluginId: 'Tilemap',
  actions: [setDefaultColorAction, {
    id: 'set-size',
    category: 'tiles',
    name: 'Set size',
    scriptName: 'SetSize',
    parameters: [
      { id: 'width', type: 'number' },
      { id: 'height', type: 'number' },
    ],
  }, {
    id: 'erase-tile-range',
    category: 'tiles',
    name: 'Erase tile range',
    scriptName: 'EraseTileRange',
    parameters: [
      { id: 'tile-x', type: 'number' },
      { id: 'tile-y', type: 'number' },
      { id: 'width', type: 'number' },
      { id: 'height', type: 'number' },
    ],
  }, {
    id: 'set-tile-range',
    category: 'tiles',
    name: 'Set tile range',
    scriptName: 'SetTileRange',
    parameters: [
      { id: 'tile-x', type: 'number' },
      { id: 'tile-y', type: 'number' },
      { id: 'width', type: 'number' },
      { id: 'height', type: 'number' },
      { id: 'tile', type: 'number' },
      { id: 'state', type: 'string' },
    ],
  }],
}

const particlesPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.particles',
  pluginId: 'Particles',
  actions: [{
    id: 'set-rate',
    category: 'particles',
    name: 'Set rate',
    scriptName: 'SetRate',
    parameters: [{ id: 'rate', type: 'number' }],
  }],
}

const advancedRandomPluginExtension: ConstructPluginExtension = {
  id: 'builtin.construct.plugin.advanced-random',
  pluginId: 'AdvancedRandom',
  actions: [{
    id: 'seed',
    category: 'randomization',
    name: 'Set seed',
    scriptName: 'Seed',
    parameters: [{ id: 'seed', type: 'number' }],
  }, {
    id: 'octaves',
    category: 'randomization',
    name: 'Set octaves',
    scriptName: 'Octaves',
    parameters: [{ id: 'count', type: 'number' }],
  }],
}

export class ConstructRegistry {
  private readonly extensionIds = new Set<string>()
  private readonly objectClasses = new Set<string>()
  private readonly behaviorTypes = new Set<string>()
  private readonly conditions = new Map<string, ConditionDefinition>()
  private readonly actions = new Map<string, ActionDefinition>()
  private readonly expressions = new Map<string, ExpressionDefinition>()
  private readonly behaviorConditions = new Map<string, ConditionDefinition>()
  private readonly behaviorActions = new Map<string, ActionDefinition>()
  private readonly behaviorExpressions = new Map<string, ExpressionDefinition>()
  private readonly pluginConditions = new Map<string, ConditionDefinition>()
  private readonly pluginActions = new Map<string, ActionDefinition>()
  private readonly pluginExpressions = new Map<string, ExpressionDefinition>()

  registerExtension(extension: ConstructExtension | ConstructBehaviorExtension | ConstructPluginExtension): void {
    const staged = stageExtension(extension)
    if (this.extensionIds.has(staged.id)) {
      throw new TypeError(`Construct extension ID "${staged.id}" is already registered.`)
    }
    const scope = staged.objectClass ?? staged.behaviorType ?? staged.pluginId
    if (!scope) throw new TypeError('Construct extension must declare an objectClass, behaviorType, or pluginId.')
    const scopeLabel = staged.objectClass ? 'object class' : staged.behaviorType ? 'behavior type' : 'plugin ID'
    const scopedExtensions = staged.objectClass ? this.objectClasses
      : staged.behaviorType ? this.behaviorTypes : undefined
    if (scopedExtensions?.has(scope)) {
      throw new TypeError(`Construct ${scopeLabel} "${scope}" is already registered.`)
    }

    const conditions = staged.objectClass ? this.conditions
      : staged.behaviorType ? this.behaviorConditions : this.pluginConditions
    const actions = staged.objectClass ? this.actions
      : staged.behaviorType ? this.behaviorActions : this.pluginActions
    const expressions = staged.objectClass ? this.expressions
      : staged.behaviorType ? this.behaviorExpressions : this.pluginExpressions
    assertNoCollisions(conditions, staged.conditions, scope, 'condition')
    assertNoCollisions(actions, staged.actions, scope, 'action')
    assertNoCollisions(expressions, staged.expressions, scope, 'expression')

    for (const definition of staged.conditions) conditions.set(key(scope, definition.id), definition)
    for (const definition of staged.actions) actions.set(key(scope, definition.id), definition)
    for (const definition of staged.expressions) expressions.set(key(scope, definition.id), definition)
    this.extensionIds.add(staged.id)
    scopedExtensions?.add(scope)
  }

  getCondition(
    objectClass: string,
    id: string,
    scope?: string | ConstructAceLookupOptions,
  ): ConditionDefinition | undefined {
    const behaviorType = typeof scope === 'string' ? scope : scope?.behaviorType
    const pluginId = typeof scope === 'string' ? undefined : scope?.pluginId
    if (behaviorType !== undefined) {
      const behaviorDefinition = this.behaviorConditions.get(key(behaviorType, id))
      if (behaviorDefinition) return behaviorDefinition
    }
    return this.conditions.get(key(objectClass, id))
      ?? (pluginId === undefined ? undefined : this.pluginConditions.get(key(pluginId, id)))
      ?? commonObjectConditionById.get(id)
  }

  getAction(
    objectClass: string,
    id: string,
    scope?: string | ConstructAceLookupOptions,
  ): ActionDefinition | undefined {
    const behaviorType = typeof scope === 'string' ? scope : scope?.behaviorType
    const pluginId = typeof scope === 'string' ? undefined : scope?.pluginId
    if (behaviorType !== undefined) {
      const behaviorDefinition = this.behaviorActions.get(key(behaviorType, id))
      if (behaviorDefinition) return behaviorDefinition
    }
    return this.actions.get(key(objectClass, id))
      ?? (pluginId === undefined ? undefined : this.pluginActions.get(key(pluginId, id)))
      ?? commonObjectActionById.get(id)
  }

  getExpression(
    objectClass: string,
    id: string,
    scope?: string | ConstructAceLookupOptions,
  ): ExpressionDefinition | undefined {
    const behaviorType = typeof scope === 'string' ? scope : scope?.behaviorType
    const pluginId = typeof scope === 'string' ? undefined : scope?.pluginId
    if (behaviorType !== undefined) {
      const behaviorDefinition = this.behaviorExpressions.get(key(behaviorType, id))
      if (behaviorDefinition) return behaviorDefinition
    }
    return this.expressions.get(key(objectClass, id))
      ?? (pluginId === undefined ? undefined : this.pluginExpressions.get(key(pluginId, id)))
  }

  listConditions(): ConditionDefinition[] {
    return [...this.conditions.values(), ...this.behaviorConditions.values(), ...this.pluginConditions.values(), ...commonObjectConditions]
  }

  listActions(): ActionDefinition[] {
    return [...this.actions.values(), ...this.behaviorActions.values(), ...this.pluginActions.values(), ...commonObjectActions]
  }

  listExpressions(): ExpressionDefinition[] {
    return [...this.expressions.values(), ...this.behaviorExpressions.values(), ...this.pluginExpressions.values()]
  }
}

export function createConstructEngine(options: ConstructEngineOptions = {}): ConstructEngine {
  if (options.extensions !== undefined && !Array.isArray(options.extensions)) {
    throw new TypeError('Construct engine extensions must be an array.')
  }

  const registry = new ConstructRegistry()
  registry.registerExtension(systemExtension)
  registry.registerExtension(functionsExtension)
  registry.registerExtension(keyboardExtension)
  registry.registerExtension(touchExtension)
  registry.registerExtension(mouseExtension)
  registry.registerExtension(gamepadExtension)
  registry.registerExtension(browserExtension)
  registry.registerExtension(webSocketExtension)
  registry.registerExtension(tilemapExtension)
  registry.registerExtension(tweenBehaviorExtension)
  registry.registerExtension(timerBehaviorExtension)
  registry.registerExtension(bulletBehaviorExtension)
  registry.registerExtension(moveToBehaviorExtension)
  registry.registerExtension(physicsBehaviorExtension)
  registry.registerExtension(cannon3dPhysicsBehaviorExtension)
  registry.registerExtension(eightDirectionBehaviorExtension)
  registry.registerExtension(platformBehaviorExtension)
  registry.registerExtension(solidBehaviorExtension)
  registry.registerExtension(carBehaviorExtension)
  registry.registerExtension(clipboardPluginExtension)
  registry.registerExtension(textPluginExtension)
  registry.registerExtension(spriteFontPluginExtension)
  registry.registerExtension(textInputPluginExtension)
  registry.registerExtension(buttonPluginExtension)
  registry.registerExtension(jsonPluginExtension)
  registry.registerExtension(ajaxPluginExtension)
  registry.registerExtension(listPluginExtension)
  registry.registerExtension(sliderbarPluginExtension)
  registry.registerExtension(drawingCanvasPluginExtension)
  registry.registerExtension(camera3dPluginExtension)
  registry.registerExtension(audioPluginExtension)
  registry.registerExtension(spritePluginExtension)
  registry.registerExtension(shape3dPluginExtension)
  registry.registerExtension(tilemapPluginExtension)
  registry.registerExtension(particlesPluginExtension)
  registry.registerExtension(advancedRandomPluginExtension)
  for (const extension of options.extensions ?? []) registry.registerExtension(extension)
  return Object.freeze({ id: 'construct' as const, registry })
}

export function defineConstructExtension<T extends ConstructExtension | ConstructBehaviorExtension | ConstructPluginExtension>(extension: T): T {
  return extension
}

export const constructEngine = createConstructEngine()

type StagedExtension = {
  id: string
  objectClass?: string
  behaviorType?: string
  pluginId?: string
  conditions: ConditionDefinition[]
  actions: ActionDefinition[]
  expressions: ExpressionDefinition[]
}

function stageExtension(extension: ConstructExtension | ConstructBehaviorExtension | ConstructPluginExtension): StagedExtension {
  if (!isRecord(extension)) throw new TypeError('Construct extension must be an object.')
  const id = requiredString(extension.id, 'extension id')
  const objectClass = extension.objectClass === undefined
    ? undefined
    : requiredString(extension.objectClass, 'object class')
  const behaviorType = extension.behaviorType === undefined
    ? undefined
    : requiredString(extension.behaviorType, 'behavior type')
  const pluginId = extension.pluginId === undefined
    ? undefined
    : requiredString(extension.pluginId, 'plugin ID')
  if ([objectClass, behaviorType, pluginId].filter((scope) => scope !== undefined).length !== 1) {
    throw new TypeError('Construct extension must declare exactly one of objectClass, behaviorType, or pluginId.')
  }
  const scope = objectClass ?? behaviorType ?? pluginId
  if (!scope) throw new TypeError('Construct extension scope must not be empty.')
  return {
    id,
    ...(objectClass === undefined ? {} : { objectClass }),
    ...(behaviorType === undefined ? {} : { behaviorType }),
    ...(pluginId === undefined ? {} : { pluginId }),
    conditions: stageDefinitions<ConditionDefinition>(extension.conditions, scope, objectClass, behaviorType, pluginId, 'condition'),
    actions: stageDefinitions<ActionDefinition>(extension.actions, scope, objectClass, behaviorType, pluginId, 'action'),
    expressions: stageDefinitions<ExpressionDefinition>(extension.expressions, scope, objectClass, behaviorType, pluginId, 'expression'),
  }
}

function stageDefinitions<T extends ConditionDefinition | ActionDefinition | ExpressionDefinition>(
  definitions: unknown,
  scope: string,
  objectClass: string | undefined,
  behaviorType: string | undefined,
  pluginId: string | undefined,
  kind: 'condition' | 'action' | 'expression',
): T[] {
  if (definitions === undefined) return []
  if (!Array.isArray(definitions)) throw new TypeError(`Construct ${kind}s must be an array.`)
  return definitions.map((definition, index) => stageDefinition(definition, scope, objectClass, behaviorType, pluginId, kind, index) as T)
}

function stageDefinition(
  definition: unknown,
  scope: string,
  objectClass: string | undefined,
  behaviorType: string | undefined,
  pluginId: string | undefined,
  kind: 'condition' | 'action' | 'expression',
  index: number,
): ConditionDefinition | ActionDefinition | ExpressionDefinition {
  const path = `${scope}.${kind}[${index}]`
  if (!isRecord(definition)) throw new TypeError(`Expected an object at ${path}.`)
  const id = requiredString(definition.id, `${path}.id`)
  const category = requiredString(definition.category, `${path}.category`)
  const name = requiredString(definition.name, `${path}.name`)
  const parameters = stageParameters(definition.parameters, path)
  if (definition.validate !== undefined && typeof definition.validate !== 'function') {
    throw new TypeError(`Expected a validation function at ${path}.`)
  }
  if (definition.editorMetadata !== undefined && !isJsonObject(definition.editorMetadata)) {
    throw new TypeError(`Expected JSON editor metadata at ${path}.`)
  }

  const base = {
    id,
    ...(objectClass === undefined ? {} : { objectClass }),
    ...(behaviorType === undefined ? {} : { behaviorType }),
    ...(pluginId === undefined ? {} : { pluginId }),
    category,
    name,
    ...(parameters === undefined ? {} : { parameters }),
    ...(definition.validate === undefined ? {} : { validate: definition.validate as (values: readonly Expression[]) => readonly Diagnostic[] }),
    ...(definition.editorMetadata === undefined ? {} : { editorMetadata: definition.editorMetadata }),
  }

  if (kind === 'condition') {
    const scriptName = requiredString(definition.scriptName, `${path}.scriptName`)
    assertBooleanProperties(definition, ['isTrigger', 'isFakeTrigger', 'isStatic', 'isLooping', 'isInvertible', 'isCompatibleWithTriggers'], path)
    return {
      ...base,
      scriptName,
      ...copyBooleanProperties(definition, ['isTrigger', 'isFakeTrigger', 'isStatic', 'isLooping', 'isInvertible', 'isCompatibleWithTriggers']),
    } as ConditionDefinition
  }

  if (kind === 'action') {
    const scriptName = requiredString(definition.scriptName, `${path}.scriptName`)
    assertBooleanProperties(definition, ['isAsync', 'isStatic'], path)
    return { ...base, scriptName, ...copyBooleanProperties(definition, ['isAsync', 'isStatic']) } as ActionDefinition
  }

  const expressionName = requiredString(definition.expressionName, `${path}.expressionName`)
  if (definition.returnType !== 'number' && definition.returnType !== 'string' && definition.returnType !== 'any') {
    throw new TypeError(`Expected a valid expression return type at ${path}.`)
  }
  assertBooleanProperties(definition, ['isVariadicParameters'], path)
  return {
    ...base,
    expressionName,
    returnType: definition.returnType,
    ...copyBooleanProperties(definition, ['isVariadicParameters']),
  } as ExpressionDefinition
}

function stageParameters(value: unknown, path: string): ConstructParameterDefinition[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new TypeError(`Expected a parameter array at ${path}.`)
  const ids = new Set<string>()
  return value.map((parameter, index) => {
    const parameterPath = `${path}.parameters[${index}]`
    if (!isRecord(parameter)) throw new TypeError(`Expected a parameter object at ${parameterPath}.`)
    const id = requiredString(parameter.id, `${parameterPath}.id`)
    if (ids.has(id)) throw new TypeError(`Duplicate parameter ID "${id}" at ${parameterPath}.`)
    ids.add(id)
    if (typeof parameter.type !== 'string' || !parameterTypes.has(parameter.type as ConstructParameterType)) {
      throw new TypeError(`Unsupported Construct parameter type at ${parameterPath}.`)
    }
    const itemGroups = stageItemGroups(parameter.itemGroups, parameterPath)
    const items = stageStringArray(parameter.items, `${parameterPath}.items`)
    if (parameter.type === 'combo' && items === undefined) {
      throw new TypeError(`Combo parameter at ${parameterPath} requires items.`)
    }
    if (parameter.type === 'combo-grouped' && itemGroups === undefined) {
      throw new TypeError(`Grouped combo parameter at ${parameterPath} requires itemGroups.`)
    }
    if (parameter.name !== undefined) requiredString(parameter.name, `${parameterPath}.name`)
    if (parameter.initialValue !== undefined && typeof parameter.initialValue !== 'string') {
      throw new TypeError(`Expected a string initialValue at ${parameterPath}.`)
    }
    if (parameter.filter !== undefined && typeof parameter.filter !== 'string') {
      throw new TypeError(`Expected a string filter at ${parameterPath}.`)
    }
    const allowedPluginIds = stageStringArray(parameter.allowedPluginIds, `${parameterPath}.allowedPluginIds`)
    assertBooleanProperties(parameter, ['optional'], parameterPath)
    return {
      id,
      type: parameter.type as ConstructParameterType,
      ...(parameter.optional === undefined ? {} : { optional: parameter.optional as boolean }),
      ...(parameter.name === undefined ? {} : { name: parameter.name as string }),
      ...(parameter.initialValue === undefined ? {} : { initialValue: parameter.initialValue as string }),
      ...(items === undefined ? {} : { items }),
      ...(itemGroups === undefined ? {} : { itemGroups }),
      ...(allowedPluginIds === undefined ? {} : { allowedPluginIds }),
      ...(parameter.filter === undefined ? {} : { filter: parameter.filter as string }),
    }
  })
}

function stageItemGroups(value: unknown, path: string): ConstructParameterItemGroup[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new TypeError(`Expected itemGroups to be an array at ${path}.`)
  return value.map((group, index) => {
    const groupPath = `${path}.itemGroups[${index}]`
    if (!isRecord(group)) throw new TypeError(`Expected an item group at ${groupPath}.`)
    return {
      id: requiredString(group.id, `${groupPath}.id`),
      items: stageStringArray(group.items, `${groupPath}.items`, true) ?? [],
    }
  })
}

function stageStringArray(value: unknown, path: string, required = false): string[] | undefined {
  if (value === undefined && !required) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`Expected an array of strings at ${path}.`)
  }
  return [...value]
}

function assertNoCollisions<T extends { id: string }>(
  existing: ReadonlyMap<string, T>,
  incoming: readonly T[],
  objectClass: string,
  kind: string,
): void {
  const pending = new Set<string>()
  for (const definition of incoming) {
    const definitionKey = key(objectClass, definition.id)
    if (existing.has(definitionKey) || pending.has(definitionKey)) {
      throw new TypeError(`Duplicate Construct ${kind} ID "${definition.id}" in object class "${objectClass}".`)
    }
    pending.add(definitionKey)
  }
}

function assertBooleanProperties(record: Record<string, unknown>, properties: readonly string[], path: string): void {
  for (const property of properties) {
    if (record[property] !== undefined && typeof record[property] !== 'boolean') {
      throw new TypeError(`Expected a boolean at ${path}.${property}.`)
    }
  }
}

function copyBooleanProperties(record: Record<string, unknown>, properties: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(properties.flatMap((property) =>
    typeof record[property] === 'boolean' ? [[property, record[property] as boolean]] : [],
  ))
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Expected a non-empty string at ${path}.`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function key(objectClass: string, id: string): string {
  return `${objectClass}\u0000${id}`
}
