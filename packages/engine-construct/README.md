# @project/engine-construct

Construct-specific definitions and registries live here. Add-on definitions can
be supplied when creating an engine:

```ts
import { createConstructEngine, defineConstructExtension } from '@project/engine-construct'

const custom = defineConstructExtension({
  id: 'example.health',
  objectClass: 'Health',
  conditions: [{
    id: 'is-alive',
    category: 'general',
    name: 'Is alive',
    scriptName: 'IsAlive',
  }],
})

const engine = createConstructEngine({ extensions: [custom] })
```

Behavior definitions use `behaviorType` so one definition can resolve for any
object class that owns that behavior:

```ts
const tween = defineConstructExtension({
  id: 'example.tween',
  behaviorType: 'Tween',
  conditions: [{
    id: 'is-playing',
    category: 'playback',
    name: 'Is playing',
    scriptName: 'IsPlaying',
    parameters: [{ id: 'tags', type: 'string' }],
    isInvertible: true,
  }],
})
```

Plugin definitions use `pluginId`, allowing the same ACE definition to resolve
for differently named object types that use that plugin:

```ts
const textPlugin = defineConstructExtension({
  id: 'example.text-plugin',
  pluginId: 'ExampleText',
  actions: [{
    id: 'set-message',
    category: 'text',
    name: 'Set message',
    scriptName: 'SetMessage',
    parameters: [{ id: 'message', type: 'any' }],
  }],
})
```

Project imports read `plugin-id` from `objectTypes/*.json` and use it during
ACE lookup. When parsing a standalone sheet, pass an `objectClassPluginIds`
record in the parser options to provide the same context. Behavior-scoped
definitions have first priority, followed by object-class definitions, then
plugin-scoped definitions.

Built-in common ACEs include Destroy, Pick children, Is overlapping at offset, and
Compare Z elevation conditions, plus Set visible, Move at angle, Set X, Set Y, and Set Z
elevation actions. The runtime delegates positions and Z elevation values and
comparisons to the host; the host supplies their behavior. Plugin ACEs include Set text for `Text`,
`Spritefont2`, and `TextBox`; TextBox Append text, Scroll to bottom, and On text
changed; the `Json` Has key condition and Parse action; and `Camera3D` Rotate
camera, Set field of view, Look parallel to layout, and Set position actions.
The `Clipboard` Copy text action evaluates its text and delegates the copy
request to the host; browser permissions and the copy result triggers remain
host behavior. The plugin subset also recognizes the asynchronous `AJAX` Request project file
and `System` Wait actions during import; the synchronous runtime reports both
as unsupported. Shape3D, Sprite, and Tilemap plugin metadata resolves Set
default color and delegates its evaluated color argument to the host; color
rendering remains host behavior. Other entries include Mouse Cursor is over
object, which delegates its object parameter and inversion to the host; the
`Audio` Is tag playing condition and Play by name action, the `List` Compare
selected item text condition, the
`Button` On clicked trigger, and Sprite Is animation playing and Is mirrored
conditions, plus Set animation, Set mirrored, and Spawn another object actions.
The host supplies Button click detection and Sprite mirror state. Spawn another
object arguments are delegated to the host adapter; the host implements
instance creation and hierarchy picking. Family plugin metadata is read
alongside object type metadata. The built-in behavior subset
includes Timer Start timer and Stop timer, Tween Is
playing, Set enabled, Stop tweens, Stop all tweens, Tween (one property), and
Tween (value), plus Bullet Set enabled; 8 Direction and Platform Simulate
control, and Platform Is on floor.

This is a starting ACE set, not a claim of complete Construct compatibility.
Unregistered features remain unsupported until their behavior and fixtures are
implemented.

Registered ACEs may include a `validate(parameters)` callback. `compileConstruct`
adds its structured findings to the compile diagnostics and supplies the ACE's
node ID and source range when the callback leaves those fields out.

## Event sheet parser

`parseConstruct(source)` accepts one event sheet JSON resource. It maps tested
`block`, `group`, event comments, action comments, root-level global variables, registered
condition/action shapes, and preserves raw Construct objects in node metadata.
Unsupported or incomplete content returns diagnostics and recovery nodes.
Project imports also resolve event-sheet include references to stable target
sheet IDs. Compilation expands resolved includes inline at their original
positions and skips cycles with a diagnostic.
The streaming API reparses accumulated text on each snapshot and uses
Construct SIDs for stable node IDs. `parseConstructStream(asyncChunks)` yields
one parser result and structural diff per provider chunk plus a completed
final result.

```ts
import { createConstructParser, parseConstruct } from '@project/engine-construct'

const result = parseConstruct(eventSheetJson, { sourceId: 'main.c3ev' })
const parser = createConstructParser()
parser.push(firstChunk)
const snapshot = parser.snapshot()
```

## Project import

`importConstruct` also accepts an extracted folder-project file map. It reads
`project.c3proj`, imports every indexed event sheet, retains the project
manifest in document metadata, and returns diagnostics for missing or
unsupported content. File values may be UTF-8 strings or binary `Uint8Array`s.
Absolute and traversal paths are rejected, and colliding normalized paths
produce diagnostics instead of silently replacing one file with another.
To compare a local corpus of folder projects before and after round-trip export,
build the package and run
`node packages/engine-construct/tools/audit-folder-corpus.mjs /path/to/projectfolders`.
The report includes import/export status, content deltas, and remaining import
diagnostics; it does not claim full Construct compatibility.

```ts
import { importConstruct } from '@project/engine-construct'

const result = importConstruct({
  'project.c3proj': projectJson,
  'eventSheets/Main.json': mainSheetJson,
  'eventSheets/Shared/Common.json': commonSheetJson,
})
```

Use `importConstructArchive` to import a ZIP-based `.c3p` archive directly:

```ts
import { importConstructArchive } from '@project/engine-construct'

const result = importConstructArchive(projectBytes)
```

Archive import supports stored and DEFLATE entries, preserves binary resources,
and defaults to limits of 128 MiB compressed input, 128 MiB expanded content,
and 10,000 entries. These limits can be changed through the options argument.
This does not establish broad Construct compatibility: the published format
guide notes that the project format is not a stable public interchange
specification.
[Construct project format](https://www.construct.net/en/tutorials/constructs-project-format-3275).
Only exercised fixtures count as verified support. Expression parsing covers
a small common subset; unsupported source remains represented as an unknown
or incomplete node or expression.

## Export

`analyzeConstructExport(document)` reports whether the document's event
structures are supported, whether source information can be preserved, and
whether export may lose project files or node data. Unknown nodes with raw
Construct records are emitted unchanged and reported as unsupported.

```ts
import {
  analyzeConstructExport,
  exportConstructArchive,
  exportConstructProject,
  exportConstructSheet,
} from '@project/engine-construct'

const review = analyzeConstructExport(result.document)
const sheet = result.document.sheets[0]
if (sheet) {
  const eventSheetJson = exportConstructSheet(sheet)
}
const projectFiles = exportConstructProject(result.document)
const projectArchive = exportConstructArchive(result.document)
```

Both exporters return `{ output, diagnostics, status }`. Project export returns
a text and binary file map, updates event-sheet and manifest JSON, and reports
referenced resource files that were absent from the import input. Unsafe paths
and duplicate normalized file paths in preserved metadata are diagnosed and
omitted; event-sheet output collisions are reported without replacing unrelated
files. Archive export packages the resulting safe file map as a ZIP file. The
`constructExporter` value implements the schema's `DocumentExporter`
interface for integrations that select exporters dynamically.

## Execution foundation

`compileConstruct(document)` validates the public IR and resolves registered
Construct conditions and actions into a `CompiledConstructDocument`.
`createConstructRuntime(hostAdapter)` provides an explicit selection context
and structured trace entries for a selected sheet. The initial executable
subset includes Keyboard's Key is down and On key pressed conditions, System's
Compare two values, Every tick, Pick by comparison,
Pick all, Repeat, For, While, For Each, For Each Ordered, Else, Trigger once while
true, Stop loop, and Set event variable actions. OR
blocks, supported condition inversion, and registered object actions are also
implemented. Object actions evaluate their parameters against selected
instances and delegate to the host adapter. Passing parent selections are
inherited by sub-events; sibling events start with a fresh selection context.
Destroy sends the picked instances and any linked container members to the
host's `destroyInstance` method; the host owns final destruction timing.
Pick children selects direct hierarchy children with `own` and recursively
selects descendants with `all`; hosts expose direct hierarchy children through
the optional `HostAdapter.getHierarchyChildren` method.
Failed conditions skip that event's actions and children. Unsupported nodes,
conditions, expressions, and actions appear as diagnostics and trace entries.
Keyboard key-state checks delegate to `HostAdapter.evaluateCondition`; key-press
events run only when the host dispatches a matching `Keyboard.on-key-pressed`
trigger with its numeric key value.
System layer visibility/interactivity checks use `evaluateCondition`; layer
visibility/interactivity changes and Set time scale use `callAction` with
evaluated parameters. The host supplies those runtime semantics.
Gamepad button and axis conditions are evaluated by `evaluateCondition`.
`Gamepad.on-button-pressed` is marked as a fake trigger, so the host evaluates
its one-tick press result during normal event processing rather than dispatching
it through `runtime.dispatchTrigger`.
Event groups honor their active-on-start state, and the tested System Set group
active action can activate, deactivate, or toggle a named group.
System Create object calls `HostAdapter.createInstance` with its layer and
position, then makes the returned instance available to the action's child
events. Hosts can return linked container members from
`HostAdapter.getContainerMembers`; those instances are picked for child events
by their object types. Family picking and actions use the host's
`queryObjects(familyName)` result.
Function blocks import and export with their parameters, return type, and
copy-picked setting. Number and String functions run through `Functions.Name(...)`
expressions or the legacy `Function.Call(...)` expression. Parameters are scoped
to each call, recursion is limited to 64 active calls, and picking resets by
default and is restored on return. None-returning function blocks run through
dynamic `Functions.Name` actions. Asynchronous functions remain unsupported.

`runtime.run(compiled, sheetId)` models one ordinary event-sheet tick. A host
can deliver a registered Construct trigger with
`runtime.dispatchTrigger(compiled, sheetId, { operation, parameters })`. The
trigger operation must match the registered condition; supplying parameters
also requires an exact parameter match. For trigger conditions that pick
instances, `ConstructTrigger.selectionsByObjectType` lets the host supply
those picked instances. Trigger sub-events evaluate their parent conditions
but do not rerun the parent actions.

The expression evaluator handles literals, variables, object properties,
arrays, common arithmetic and comparison operators, Construct's logical and
string-building operators, conditionals, and a small set of numeric functions.
Object names with leading digits, including `3DCamera` and `8Direction`, parse
as identifiers; the host supplies their runtime properties.
Unhandled identifier and function expressions are passed to the host adapter's
`evaluateExpression` callback, which can provide frame time, project, viewport,
plugin, and other host-backed values. This is a tested subset, not a full
Construct expression implementation.
Schema variable declarations, including imported root-level Construct globals,
are initialized on the first run, retain values across later runs for the same
document, and are restored to initial values by `runtime.reset()`. Local schema
declarations reset at the start of each run; Construct static locals retain their
values. Nested Construct declarations are attached to their owning event; their
local values are scoped to that event and static locals persist between runs.

`analyzeConstructTrace(document, trace, provider)` gives a caller-supplied
analyzer a compact trace with event labels, ACE operations, and source ranges.
`compareConstructTraces(actual, captured)` compares structured runtime output
with a saved Construct trace capture. Three checked-in Construct r495.2 preview
captures record ACE calls, arguments, and condition results for passing and
short-circuited runs of the sample event, including a run with Mouse
`IsOverObject`. Since Construct did not export this engine's `ExecutionTrace`
shape, each fixture stores a source-mapped projection for sheet, event, group,
and skipped-node rows and keeps the observed ACE calls separately. The
automated comparison covers only those three runs.

Host adapters implement the engine-neutral `HostAdapter` contract from
`@project/schema`. The Construct runtime does not own host instances.
Registered custom object actions run through `callAction`. Hosts may also
implement `evaluateCondition` and `evaluateExpression` to supply custom ACE and
expression behavior; handlers receive evaluated JSON arguments and the host
context. Behavior or plugin scoped ACEs also receive their `AceInvocationScope`
as the final callback argument, so hosts can distinguish identical IDs owned
by different behavior types or plugins. `evaluateExpression` also receives
unhandled identifier expressions with an empty argument list.

## Compatibility status

[`COMPATIBILITY.md`](./COMPATIBILITY.md) lists feature-level `TESTED`,
`UNTESTED`, `KNOWN_DIVERGENCE`, and `UNSUPPORTED` states. The same report is
available to integrations through `formatConstructCompatibilityReport()`.
Fixtures record their baseline source and expected selections, actions, and
output; most cite the published Construct manual. The report also records one
Construct r495.2 editor open/save check and three live preview captures for the
sample's triggered GO event, covering a passing path, a short-circuited path,
and a passing path with Mouse `IsOverObject`. The Construct-saved copy also
round-trips through import and export with its normalized paths and all file
contents preserved. A full-project edit test
changes one supported layout action and checks that other JSON values and
opaque files survive export. These checks do not establish broad
project-format compatibility or general runtime equivalence.
