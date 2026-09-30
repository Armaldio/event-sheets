GOAL FINAL
Build a modern, top-tier TypeScript monorepo for parsing, representing, viewing, editing, importing, exporting, and eventually executing event sheets.
Construct compatibility is the primary target.
The architecture must support:
☑ A stable public schema/IR that external tools can parse directly
☐ Construct-compatible import
☐ Construct-compatible export
☐ Construct-compatible execution
☑ Viewing Construct event sheets
☑ Editing Construct event sheets with drag and drop
☑ Partial and invalid documents without crashing
☑ Incremental/streamed generation, especially from LLMs
☑ User-defined conditions, actions, expressions, and other engine extensions
☑ Host adapter contract and Construct runtime integration
☑ Native engine uses the shared schema without coupling it to Construct
☑ One engine per document
☑ No requirement for engine switching in the initial architecture
☑ Compatibility tracked explicitly through tests rather than assumed
The three Construct-compatible goals above remain open until an authoritative audit validates the supported project formats against Construct and compares runtime behavior against Construct-generated traces. Two editor open/save checks in Construct r495.2 cover an exporter-produced tagged-sample archive and the original `BlankTemplate.c3p` from the public corpus. On 2026-09-29, all 15 pinned-corpus `.c3p` files imported and exported with `complete` status, and all 15 current outputs re-imported completely. A serial isolated headless Chromium pass opened 14 of those current outputs in Construct r495.2; all opened projects had zero browser page errors. `FirstPersonShooter2.c3p` remained blocked because it requires legacy Behavior Rapier 3D Physics (`mikal_cannon_3d_physics`, SDK v1), which this release cannot install. The Free edition’s event limit appeared on some projects. No previews were run and no project code was executed in this pass. Per-project results and output SHA-256 values are recorded in `packages/engine-construct/test/fixtures/compatibility/construct-r495.2-current-export-editor-open.json`. The earlier original-archive editor pass also opened 14 of 15 projects, with the same add-on blocker. For `BlankTemplate.c3p`, Construct displayed the project and its event sheets/layouts, then downloaded a 75-entry copy of the original 70-entry archive; the copy added five context/editor-state files, removed none, changed project and layout/editor-state JSON (including the AJAX project-file parameter shape), and changed no opaque-file bytes. Our importer accepts the copy as complete and re-exports the same normalized paths, JSON values, and opaque bytes. The tagged-sample archive produced a separate 63-file copy that also round-trips through our importer/exporter. A full-project edit test changes one supported layout action, preserves unrelated event-sheet JSON values and opaque files, and re-imports the edit. Backslash separators in some ZIP member names are canonicalized to slashes. The Free edition reported project limits; Construct also omitted editor-external addon archives and generated TypeScript declarations from the tagged-sample copy. Three preview runs captured the ACE calls for passing and short-circuited GO-button paths, including a passing path with Mouse `IsOverObject(NavButton)`. Their sheet/event/group trace rows are source-mapped projections, not Construct-exported debugger output. These checks do not validate general runtime behavior.
A read-only audit of 15 public Construct projects at [`fodi/construct-3-projects`](https://github.com/fodi/construct-3-projects/tree/4cd387425b1a6c20bf7607190be7b237a4a52f4a) found 15 complete imports and exports in project-folder, repacked ZIP, and repository `.c3p` forms. All folder and ZIP-repack exports preserved paths, JSON values, and opaque-file bytes. The actual `.c3p` exports preserved normalized paths, JSON values, and opaque-file bytes; their backslash-separated entry names were canonicalized to forward slashes. This audit exposed and fixed extraction of unsigned ZIP data descriptors, which had been appended to some stored files. Remaining import diagnostics include no unknown actions or conditions and 10 preserved but unsupported script actions; the pinned corpus produces no unknown-expression diagnostics. Six `Tilemap.set-tile` actions, ten common `set-visible` actions, six common `move-at-angle` actions, 11 common `set-z-elevation` actions, four common `set-x`/`set-y` actions, 18 plugin-scoped `set-text` actions, nine TextBox append/scroll actions, five Tween/Bullet `set-enabled` actions, nine 8 Direction/Platform `simulate-control` actions, 13 plugin-scoped Camera3D actions, two plugin-scoped Clipboard `copy-text` actions, 20 plugin-scoped `set-default-color` actions across Shape3D, Sprite, and Tilemap, three Audio `play-by-name` actions, one Browser `open-url-in-new-window` action, and one MoveTo `move-to-object` action and two Physics behavior actions, two Platform `set-enabled` actions, and five DrawingCanvas actions, ten Tween stop actions, 18 Tween one-property/value actions and one Tween two-property action, six Timer Start timer/Stop timer actions, seven plugin-scoped Sprite `set-animation` actions, eight plugin-scoped `set-mirrored` actions, and three `spawn-another-object` actions now import and delegate to the host. Five common `destroy` actions now dispatch selected instances and container members through the host. Six common `set-angle` actions evaluate and dispatch their angle values for the picked instances. Three common `set-angle-toward-position` actions evaluate and dispatch their coordinates. Four plugin-scoped Json `parse` actions also import and delegate to the host. Three System `wait` actions import their seconds parameter, and three AJAX `request-project-file` actions import tag and project-file parameters; both actions are marked asynchronous and reported unsupported by the synchronous runtime. Seven common `pick-children` conditions now select direct hierarchy children with `own` and descendants recursively with `all`; five common boolean instance-variable conditions now filter selected instances, 13 Tween `is-playing` conditions resolve through behavior-scoped registration, four TextBox `on-text-changed` triggers, eight Button `on-clicked` triggers, six JSON `has-key` conditions, four common overlap-at-offset conditions and seven common `compare-z-elevation` conditions, plus two common `compare-y` conditions, eight common `on-created`, two Tween `on-tweens-finished`, and one Tween `on-any-tweens-finished` trigger, three Audio `is-tag-playing` conditions, six Sprite `is-animation-playing` conditions and four `is-mirrored` conditions resolve through plugin-scoped registration, Platform `is-falling`, `is-jumping`, and `is-moving` checks plus Car `is-moving` and Platform `set-enabled`; four Platform `is-on-floor` conditions resolve through behavior-scoped registration, and two Mouse `cursor-is-over-object` conditions delegate to the host. Three List `compare-selected-item-text` conditions resolve through plugin-scoped registration. Family `plugin-id` values are now used alongside object type metadata to resolve those Sprite ACEs. Construct expressions with numeric-leading object identifiers such as `3DCamera`, `3DShape`, `3DProjectile`, and `8Direction` now parse; the pinned corpus produces no unknown-expression diagnostics, while host-provided values and function behavior remain unvalidated beyond the tested subset. Source-path fallback IDs produced no duplicate-ID diagnostics. Construct r495.2 opened 14 of the 15 original `.c3p` files; `FirstPersonShooter2.c3p` was blocked by its unavailable legacy Rapier 3D Physics add-on. The projects include third-party assets with varying licenses; the audit data is external and is not included in this workspace. Reproduce the audits with `node packages/engine-construct/tools/audit-folder-corpus.mjs /path/to/projectfolders /path/to/projectfiles` after building.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. MONOREPO FOUNDATION
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use:
☑ Vue 3
☑ TypeScript
☑ Vite
☑ pnpm workspaces
☑ Turborepo
☑ mise
☑ Vitest
☑ Vue Test Utils
☑ Playwright where integration/UI tests justify it — Chromium E2E covers runtime preview and streamed rendering
Repository structure:
apps/
  playground/
packages/
  schema/
  engine-construct/
  engine-native/
  visual/
tooling/
  typescript/
  lint/
  vite/
Root:
package.json
pnpm-workspace.yaml
turbo.json
mise.toml
tsconfig.json
Keep the package count deliberately small.
Do not create separate packages for:
parser
importer
exporter
registry
runtime
compatibility
validation
Those belong inside the engine package that owns them.
Dependency direction must remain:
visual → schema
visual → engine interface only where required
engine-construct → schema
engine-native → schema
schema → nothing engine-specific
engine-construct must never depend on engine-native.
engine-native must never depend on engine-construct.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. SCHEMA PACKAGE IS THE FOUNDATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
packages/schema is the most important public package.
Assume many users will never use the Vue editor.
They may simply do:
import {
  EventDocument,
  Event,
  Condition,
  Action
} from "@project/schema"
The package owns:
☑ Event document types
☑ Event sheets
☑ Events
☑ Conditions
☑ Actions
☑ Expressions
☑ Variables
☑ Functions/references where appropriate
☑ Node IDs
☑ Metadata
☑ Source locations
☑ Diagnostics contracts
☑ Partial/incomplete nodes
☑ Invalid nodes
☑ Unknown nodes
☑ Serialization contracts
☑ Schema version
☑ Migrations
☑ Engine descriptor
☑ Import/export interfaces
☑ Parser interfaces
☑ Host adapter contracts
☑ Extension/plugin contracts
It must NOT contain:
☑ Construct runtime behavior
☑ Construct ACE definitions
☑ Construct picking behavior
☑ Vue code
☑ Editor state
☑ Runtime mutable state
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. DOCUMENT MODEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every document targets exactly one engine.
Example conceptual shape:
EventDocument
  schemaVersion
  id
  engine
    id
    compatibilityVersion?
  metadata
  sheets
  variables
  functions?
  extensions?
Example:
engine.id = "construct"
or later:
engine.id = "native"
No mixed-engine documents.
This means a Construct document can safely contain Construct-specific extensions without pretending those semantics apply to Native.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. EVERYTHING IMPORTANT GETS A STABLE ID
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every structural node should have a stable ID:
☑ Sheet
☑ Event
☑ Condition
☑ Action
☑ Variable
☑ Function
☑ Possibly expression nodes where useful
IDs must not depend on array position.
This allows:
☑ Diagnostics pointing to nodes — diagnostics for visible event nodes focus and highlight their target
☑ Stable Vue rendering — Vue event and ACE keys use stable node IDs
☑ Drag and drop — event moves retain structural IDs
☑ Undo/redo — command history restores immutable document snapshots
☑ LLM incremental updates — streamed parser snapshots update stable-ID nodes and expose per-snapshot structural changes
☑ Future collaborative editing — serializable commands and stable-ID diffs provide an exchange boundary; realtime sync remains out of scope
☑ Structural diffs — schema diff reports stable-ID adds, removals, updates, and moves while ignoring source-offset churn
☑ Source mapping — imported sheet, event, ACE, and expression nodes retain offsets and line/column ranges
☑ Selection persistence — selected events survive external document snapshots while their IDs remain; removed events clear selection
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. DESIGN THE SCHEMA FOR PARTIAL DOCUMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A globally valid document must NEVER be required to display it.
This is a hard architectural rule.
The system must render as much as possible from:
☑ Valid documents — complete imported sheets render in the viewer
☑ Invalid documents — invalid ACE recovery nodes remain visible with diagnostics
☑ Incomplete documents — incomplete events, actions, and expressions render during streaming
☑ Unsupported Construct features — unsupported event forms and ACEs remain represented
☑ Unknown conditions/actions — both unknown condition and action nodes are imported and rendered
☑ Half-written LLM output — truncated JSON yields a partial document instead of throwing
☑ Partially received streams — successive parser snapshots update the playground viewer
Do not model parsing as:
parse(source): EventDocument
where parsing throws on the first error.
Model it as:
parse(source): ParseResult
ParseResult contains:
document
diagnostics
status
Possible status:
partial
complete
The parser should recover whenever possible.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. RECOVERY NODES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The schema must be capable of representing things the parser cannot fully understand.
Provide concepts equivalent to:
UnknownNode
InvalidNode
IncompleteNode
And potentially expression equivalents:
UnknownExpression
InvalidExpression
IncompleteExpression
Examples:
An LLM has streamed:
Event
  Condition Player.X > 50
  Action Player.Set
The UI should display:
Event
  Player.X > 50
  incomplete action
It should NOT discard the entire event.
Unknown Construct ACE:
Event
  SomeFuturePlugin.NewCondition(...)
  Player.Destroy
The unknown condition must remain represented.
This is important for forward compatibility and round-tripping.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. SOURCE INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every imported/parsing-originated node should optionally retain source information.
SourceLocation may contain:
sourceId
offsetStart
offsetEnd
lineStart
lineEnd
columnStart
columnEnd
Do not make every field mandatory.
This enables:
☑ Parser diagnostics — diagnostics with node IDs inherit the mapped source range of their target
☑ LLM repair — provider-supplied typed commands produce a validated preview and structural diff
☑ Text ↔ visual synchronization — editing Construct JSON reparses into the editor, and visual commands regenerate the source text
☑ Error highlighting — diagnostics focus and highlight their referenced visual nodes
☑ Future code/visual split views — playground shows synchronized editable Construct JSON beside the visual editor
☑ Mapping exported errors to their original source — analysis, sheet, and project export diagnostics inherit the imported node range
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. DIAGNOSTICS ARE FIRST-CLASS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use structured diagnostics.
Diagnostic:
code
severity
message
nodeId?
sourceLocation?
details?
Severity:
info
warning
error
Diagnostics should never exist merely as strings thrown from deep inside parsers.
Example codes:
construct.unknown-action
construct.unsupported-feature
construct.invalid-expression
parser.unexpected-token
schema.invalid-reference
export.lossy-conversion
The UI consumes diagnostics directly.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
9. EXPRESSIONS NEED A REAL AST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Do not treat every expression as an opaque string.
Represent expressions structurally.
Support concepts equivalent to:
LiteralExpression
IdentifierExpression
VariableExpression
PropertyExpression
UnaryExpression
BinaryExpression
CallExpression
ConditionalExpression
ArrayExpression
InvalidExpression
IncompleteExpression
UnknownExpression
Original source text may also be retained when imported.
This is important for:
☑ Editing — the visual editor parses common expression text into shared AST nodes
☑ Validation — schema validation checks AST shapes and registered ACE validators run during compilation
☑ Execution — Construct runtime evaluates the shared expression AST subset
☑ Analysis — compiler and export analysis inspect documents without UI dependencies
☑ LLM generation — generated Construct text streams into stable parser snapshots and supported expression syntax maps to the AST
☑ Construct compatibility — tested Construct expression and runtime fixtures use the AST
☑ Round-trip export — expression and sheet round-trips are covered by exporter tests
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
10. STREAMING MUST BE DESIGNED NOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LLM streaming is a first-class use case.
Define the API so incremental parsing is possible even if V1 internally reparses everything.
Desired API shape:
const parser = createParser()
parser.push(chunk)
const current = parser.snapshot()
parser.push(nextChunk)
const next = parser.snapshot()
parser.finish()
Also consider:
for await (const result of parseStream(stream)) {
  update(result.document)
}
Important:
☑ snapshot() must return something displayable — staged incomplete nodes remain schema-valid and renderable
☑ parser errors must not destroy previous valid sections — malformed trailing input retains the last valid partial tree
☑ incomplete trailing input must be expected — partial event/action/expression cases produce recovery state
☑ previously parsed node IDs should remain stable when possible — stable SIDs survive completion across chunks
Do not prematurely optimize incremental parsing.
V1 can reparse the complete accumulated input after each meaningful chunk.
Design the API correctly first.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
11. CONSIDER A STREAM-FRIENDLY SERIALIZATION FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Do not assume ordinary strict JSON is automatically the best LLM streaming format.
Evaluate whether the canonical transport format should support incremental production naturally.
Requirements:
☑ Human inspectable — Construct JSON and EventDocument JSON are readable
☑ Machine parseable — schema and Construct import APIs parse JSON
☑ Easy for LLMs to generate — the playground streams ordinary Construct JSON
☑ Recoverable when truncated — parser tests cover incomplete and malformed tails
☑ Supports stable IDs — Construct SIDs anchor imported nodes across snapshots
☑ Supports unknown nodes — unknown ACEs retain raw data and diagnostics
☑ Supports expressions — schema expressions and Construct expression parsing are implemented
☑ Versioned — EventDocument carries schemaVersion and has migration support
Keep canonical internal schema separate from transport syntax.
The internal EventDocument is authoritative.
Different parsers can eventually generate it.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
12. ENGINE-CONSTRUCT PACKAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
packages/engine-construct owns ALL Construct-specific code.
Suggested internal structure:
src/
  parser/
  import/
  export/
  runtime/
  registry/
  validation/
  compatibility/
  extensions/
  host/
  index.ts
Do not split these into npm packages.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
13. CONSTRUCT PUBLIC API
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Aim for a clean API such as:
import {
  constructEngine,
  parseConstruct,
  importConstruct,
  exportConstruct,
  createConstructParser,
  createConstructEngine
} from "@project/engine-construct"
Consumers should not need knowledge of internal modules.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
14. DEFINE WHAT "CONSTRUCT COMPATIBLE" MEANS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Compatibility target:
☑ Import — tested event-sheet and project subsets; see COMPATIBILITY.md
☑ Parse — complete, partial, malformed, and streaming input paths are tested
☑ Display — supported and recovery nodes render in the visual editor
☑ Edit — event, ACE, and expression editing are implemented
☑ Export — supported nodes export with preservation and loss diagnostics
☑ Execute — a tested Construct runtime subset emits structured traces
Long-term target is 100% semantic compatibility.
But do NOT claim 100% until demonstrated.
Repository documentation must explicitly state:
Construct compatibility is an implementation target.
Behavior may differ from Construct unless covered by compatibility tests.
Unsupported or unverified behavior must be reported.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
15. COMPATIBILITY STATUS MODEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Track individual features.
Possible states:
UNTESTED
TESTED
KNOWN_DIVERGENCE
UNSUPPORTED
Example:
Simple events        TESTED
Sub-events           TESTED
OR blocks            TESTED
Containers           TESTED (host-provided linked creation and child picks)
Families             TESTED (host family queries, picking, and actions)
Do not use vague percentages like:
"95% Construct compatible"
Compatibility is demonstrated through tests.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
16. BUILD A CONSTRUCT COMPATIBILITY SPEC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before implementing obscure semantics, document their expected behavior.
Implement a supported subset or record the limitation in the compatibility report.
A checked area means its status and evidence are documented; it does not imply full support.
For every tested or unsupported feature capture:
Input
Initial object selection
Condition behavior
Resulting selection
Action execution
Child-event behavior
Side effects
Expected output
Important areas eventually include:
☑ Object picking — TESTED
☑ Selection inheritance — TESTED
☑ Inverted conditions — scalar and Pick by comparison inversion are TESTED; inverted Pick all selects the empty complement and passes only when the object has no instances
☑ Else — TESTED
☑ OR blocks — TESTED
☑ Sub-events — TESTED
☑ Triggers — TESTED
☑ Trigger once — TESTED
☑ Comment events and action comments — text import/export, source-field preservation, and runtime no-op are TESTED
☑ Project fallback node IDs — source paths keep missing-SID IDs unique across event sheets
☑ Keyboard key conditions — Key is down delegates its numeric key to the host adapter; On key pressed uses matching numeric-key trigger dispatch
☑ System layer/time ACEs — layer visibility/interactivity checks and actions and Set time scale are host-adapter-backed
☑ Gamepad input conditions — button state and axis checks delegate to the host; On button pressed is a host-evaluated fake trigger checked during normal event processing
☑ Loops — Repeat, inclusive named For ranges, While, For Each, ordered For Each, Stop Loop, per-iteration condition ordering, nested loop conditions in AND events, and the 10000-frame nested safety cap are TESTED; fractional/unsafe For bounds and loop conditions in OR blocks remain UNSUPPORTED.
☑ For Each — TESTED
☑ Ordered For Each — numeric order expressions are evaluated in ascending order
☑ Families — host family queries drive picking and family actions
☑ Containers — optional host container membership propagates linked-instance picks to child events
☑ Object creation — System Create object with layer/position and linked container creation are TESTED
☑ Picking newly created instances — immediate and container-linked instances are picked for child events
☑ Functions — named function blocks, Number/String expression calls, None-returning action calls, parameters, recursion, return values, and picking behavior are TESTED; async functions remain UNSUPPORTED
☑ Return values — Number and String expression results and default 0 are TESTED; None-returning functions execute as actions
☑ Common expressions — operators, Construct string quoting, newline, StringSub, common math/text functions, and random ranges have runtime tests; numeric-leading object identifiers such as `3DCamera` and `8Direction` parse, scientific notation stays numeric, and host-backed identifiers/functions can delegate to the adapter. Construct values for project/layout/device/clock and plugin expressions remain UNTESTED.
☑ Event groups — TESTED; import/export preserves group fields and order, and runtime supports disabled/startup state, Is group active, and Set group active
☑ Includes — import/export and inline execution TESTED; circular includes are guarded
☑ Project archives — ZIP stored/DEFLATE import/export preserves binary files and enforces compressed-size, expanded-size, and entry-count limits; a tag-pinned 106-file editor-exported project round-trips as a folder map and .c3p archive, a supported action edit preserves unrelated JSON values and opaque files, and a 63-file Construct-saved archive round-trips with normalized paths; a separate 15-project folder audit preserves every path, JSON value, and opaque-file byte while imports remain partial
☑ Variables — root globals and nested event locals TESTED; local values are scoped to their owning event, and static local values persist across runs
☑ SOL restoration — TESTED
☑ Nested event behavior — TESTED subset
☑ Registered extension ACE dispatch — a trigger condition and behavior/plugin actions from a tagged editor project reach the host adapter with evaluated parameters and family targets; addon semantics remain UNTESTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
17. CONSTRUCT REGISTRY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Construct's available:
Conditions
Actions
Expressions
must come from a registry.
The registry belongs to engine-construct.
The visual editor asks the engine for available definitions.
Never do:
if (engine === "construct")
inside visual components.
Conceptual definition:
ConditionDefinition
  id
  category
  name
  parameters
  validate
  runtime?
  editorMetadata?
ActionDefinition
  id
  category
  name
  parameters
  validate
  runtime?
  editorMetadata?
ExpressionDefinition
  id
  parameters
  returnType
  validate
  runtime?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
18. USER EXTENSIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Users must be able to register their own functionality.
Example conceptual API:
const engine = createConstructEngine({
  extensions: [
    myExtension
  ]
})
Extension can register:
☑ Conditions — engine extensions register custom condition definitions
☑ Actions — engine extensions register custom action definitions
☑ Expressions — engine extensions register custom expression definitions
☑ Separate object/plugin type schema not needed yet — extensions identify object classes and host adapters own runtime instance data
☑ Validators — extension validators run at compile time and inherit ACE source locations
☑ Runtime handlers — registered actions use callAction; custom conditions and expressions can delegate to host callbacks
☑ Custom serialization hooks not needed yet — registered ACE parameters use definitions and imported raw Construct records are preserved
Keep the extension model engine-owned.
schema defines the interface.
engine-construct implements the behavior.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
19. DO NOT OVER-GENERALIZE PLUGINS YET
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Do not build an enormous generic plugin framework.
Initially support what is actually needed:
defineConstructExtension({
  id,
  conditions,
  actions,
  expressions
})
Generalize only when Native proves there are shared concepts worth extracting.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
20. CONSTRUCT IMPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Separate:
Parsing
Mapping
Validation
Do not create one giant importConstruct() implementation internally.
Pipeline:
Construct input
  ↓
Raw parser
  ↓
Construct representation
  ↓
Semantic mapper
  ↓
EventDocument
  ↓
Diagnostics
Public convenience API may still be:
importConstruct(input)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
21. PRESERVE INFORMATION WHEN IMPORTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Import should aim to preserve unknown information rather than discard it.
Especially important for:
☑ Unknown event types from future Construct versions remain opaque and round-trip; their semantics remain unsupported
☑ Third-party plugins — unregistered plugin ACE data is retained as an unknown node
☑ Unknown ACEs — raw condition/action data and diagnostics survive import
☑ Unsupported metadata — opaque source fields survive supported edits and export
☑ Round-trip export — untouched and edited sheets are re-imported and checked, including a supported action edit in the tagged full-project corpus
If something cannot be understood:
Preserve raw representation where reasonable.
Create an Unknown node/extension.
Attach a diagnostic.
Do NOT silently delete it.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
22. CONSTRUCT EXPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Export must be conservative.
Before export:
analyzeExport(document)
Return:
diagnostics
supported
lossless
potentiallyLossy
Never silently transform something into different behavior.
Unknown imported information should be preserved where possible.
Long-term target:
Construct
→ import
→ edit known node
→ export
→ Construct
without unrelated sections being rewritten or destroyed unnecessarily.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
23. ROUND-TRIP FIDELITY IS IMPORTANT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Create dedicated tests:
Construct input
→ import
→ export
→ compare semantically
Also:
Construct input
→ import
→ no changes
→ export
The output does not necessarily need byte-for-byte identity.
It should preserve equivalent information and semantics.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
24. CONSTRUCT EXECUTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Execution exists primarily for:
☑ Compatibility verification — feature fixtures record tested and unsupported behavior
☑ Tooling — compile and runtime APIs are public from engine-construct
☑ Preview — the playground can run the supported subset against a sample host adapter
☑ Analysis — compilation and export analysis report structured findings
☑ Tests — runtime and compatibility behavior have dedicated suites
Do not optimize the runtime for shipping production games yet.
Execution architecture:
EventDocument
  ↓
validation
  ↓
compile
  ↓
CompiledDocument
  ↓
runtime
  ↓
HostAdapter
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
25. HOST ADAPTERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The event engine must not own the host application's entities.
Use host adapters.
Conceptually:
HostAdapter
  getInstances()
  getObjectType()
  getProperty()
  setProperty()
  callAction()
  createInstance()
  destroyInstance()
  queryObjects()
Exact interface should evolve from tests.
Do not prematurely create a huge game-engine abstraction.
Implement only what Construct compatibility tests require.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
26. CONSTRUCT SELECTION STATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Construct-compatible selection/picking should be explicit runtime state.
Do not hide it behind arbitrary arrays.
Create something equivalent to:
SelectionContext
  selectionsByObjectType
  familySelections
  parentContext
  containerRelationships
  createdInstances
This will likely become one of the hardest and most important parts of engine-construct.
Treat it as a subsystem.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
27. EXECUTION TRACE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Build execution tracing early.
Example:
Event event-17
  condition Player.X > 100
    result true
    Player selection: [instance-3, instance-9]
  action Player.Destroy
    executed on: [instance-3, instance-9]
  child event event-18
    inherited selection: [...]
Trace entries should be structured data, not strings.
This will be extremely useful for:
☑ Debugging — structured entries record event, condition, and action outcomes
☑ Compatibility tests — fixtures exercise tested, divergent, and unsupported cases
☑ Playground — the developer panel displays preview traces and host interactions
☑ LLM analysis — runtime traces can be packaged with stable node, operation, and source context for a caller-supplied analyzer
☑ Comparing behavior with Construct — the comparator is exercised against three live Construct r495.2 ACE-call captures and source-mapped trace projections; other runtime behavior remains unvalidated against Construct
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
28. VISUAL PACKAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
packages/visual is a Vue 3 library.
Keep it opinionated and simple initially.
No headless framework.
No giant customization API.
No theme engine.
No slot for every pixel.
Primary component:
<EventSheetEditor />

Support readonly mode rather than maintaining an entirely different rendering system.
Example:
<EventSheetEditor
  :document="document"
  :engine="constructEngine"
  readonly
/>
This provides the viewer use case.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
29. VISUAL RESPONSIBILITIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
visual owns:
☑ Event sheet rendering
☑ Event rendering
☑ Conditions
☑ Actions
☑ Expressions
☑ Variables
☑ Selection
☑ Drag and drop
☑ Editing
☑ Diagnostics display
☑ Keyboard interactions — undo/redo, event movement/removal, deselection; text fields retain native editing shortcuts
☑ Undo/redo
☑ Readonly mode
visual does NOT own:
☑ Construct parsing — engine-specific parsing stays in engine-construct
☑ Construct semantics — ACE/runtime behavior stays in engine-construct
☑ Construct runtime — visual has no runtime dependency
☑ Construct ACE definitions — registries are engine-owned
☑ Schema validation rules — validation stays in the engine-neutral schema package
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
30. PARTIAL RENDERING IS A CORE VISUAL FEATURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every UI element must tolerate imperfect data.
Examples:
Unknown action:
[ ? ] MyPlugin.DoSomething(foo)
Incomplete action:
[ … ] Player.SetPosition(
Invalid expression:
Player.X > [invalid expression]
The rest of the sheet remains completely interactive.
One broken event must never prevent rendering the sheet.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
31. STREAMED UI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Create an explicit playground scenario for this.
Example:
LLM tokens
  ↓
parser.push()
  ↓
snapshot
  ↓
Vue update
  ↓
event sheet progressively appears
Test cases must include:
☑ Half an event — playground shows an incomplete event before completion
☑ Half an action — parser and playground snapshots render an incomplete action
☑ Half an expression — incomplete parameter text remains visible while streaming
☑ Missing closing syntax — parser recovers snapshots from truncated JSON
☑ Temporary malformed syntax — a trailing comma retains the previous partial tree
☑ Parser recovering when later chunks fix it — later chunks complete the same event/action/expression
☑ Stable node rendering during successive snapshots — playground asserts event DOM identity across snapshots
Avoid full UI teardown/recreation between snapshots.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
32. EDITING MODEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Support initially:
☑ Add event
☑ Remove event
☑ Move event
☑ Nest event
☑ Add condition
☑ Remove condition
☑ Reorder condition
☑ Edit condition parameters
☑ Add action
☑ Remove action
☑ Reorder action
☑ Edit action parameters
☑ Expression editing — common variable, property, operator, call, conditional, and array expressions parse into AST nodes; incomplete input remains editable
☑ Drag and drop
☑ Undo
☑ Redo
Don't build advanced customization before basic editing quality is excellent.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
33. COMMAND SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use commands for mutations.
Examples:
AddEvent
DeleteEvent
MoveEvent
AddCondition
UpdateCondition
DeleteCondition
AddAction
UpdateAction
DeleteAction
Benefits:
☑ Undo/redo
☑ Deterministic changes
☑ Easier testing
☑ Future LLM editing API through typed commands
☑ Future collaboration — serializable editor commands and stable-ID diffs are public integration points; realtime collaboration remains a non-goal
☑ Easier external editor integrations — typed immutable commands and selection-change are public APIs
This also gives a future LLM an API like:
applyCommand({
  type: "add-action",
  ...
})
instead of replacing arbitrary JSON.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
34. DO NOT USE VUE REACTIVITY AS THE DATA FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EventDocument must remain plain serializable data.
No:
ref()
reactive()
computed()
Proxy
Vue component references
inside the document.
The editor can wrap it in whatever reactive layer it needs.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
35. NATIVE ENGINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Native is secondary for now.
Do NOT build it first.
Construct should pressure-test the schema.
Once Construct architecture is stable enough:
☑ Implement Native using the same EventDocument structure
☑ Give Native cleaner semantics
☑ Do not imitate Construct quirks
☑ Do not require feature parity
☑ Do not make Construct simpler just so Native can share everything
Native may eventually become more powerful than Construct.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
36. SCHEMA SHOULD NOT BE THE LEAST COMMON DENOMINATOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Do not reduce the schema to only features shared by Native and Construct.
The schema represents event-oriented programs.
Engines define semantics.
Use engine-specific extensions when necessary.
Example:
Event.extensions.construct = ...
But only when something genuinely cannot be represented generically.
Avoid extension bags for normal features just because implementation is inconvenient.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
37. PUBLIC IMPORT INTERFACE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
schema defines something equivalent to:
Importer<Input, Options>
with:
import(input, options)
Result:
document
diagnostics
metadata
Import never assumes perfect input.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
38. PUBLIC EXPORT INTERFACE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
schema defines:
Exporter<Output, Options>
with:
analyze(document)
export(document, options)
ExportResult may contain:
output
diagnostics
Do not make external callers catch random internal exceptions for expected compatibility failures.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
39. VALIDATION LEVELS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Separate validation concepts:
Structural validation
→ Is this recognizable EventDocument data?
Schema validation
→ Are node shapes correct?
Semantic validation
→ Do references resolve?
Engine validation
→ Is this legal for Construct?
Export validation
→ Can this representation be exported losslessly?
Runtime validation
→ Can this execute with the supplied host?
Do not collapse all of these into validate() internally.
A convenience validate() facade is fine.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
40. FORMAT VERSIONING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Track separately:
schemaVersion
engine compatibility version
source format version if relevant
Example concept:
schemaVersion: 1
engine:
  id: "construct"
  compatibilityVersion: "rXXX"
Never overload one number to mean all of them.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
41. MIGRATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
schema owns migrations for EventDocument schema versions.
Example:
migrateDocument(document)
Migration behavior must be deterministic and tested.
Construct-version compatibility migrations belong in engine-construct when they represent Construct behavior rather than generic schema changes.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
42. TESTING PHILOSOPHY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tests are central, especially for Construct.
Use:
☑ Unit tests — schema, parser, export, runtime, command, and editor behavior are covered
☑ Parser fixtures — minimal Construct input and compatibility fixtures exercise mapping
☑ Invalid-input fixtures — malformed JSON, incomplete nodes, invalid ACEs, and partial prefixes are covered
☑ Streaming fixtures — snapshots cover stable IDs and recovery after later malformed chunks
☑ Round-trip tests — untouched and edited sheets are exported and re-imported
☑ Runtime behavior tests — event, selection, variable, trigger, and loop semantics are exercised
☑ UI component tests — readonly, recovery nodes, editing, selection, and diagnostic focus are covered
☑ Drag/drop tests — event reorder and sheet drop behavior are covered
☑ Compatibility tests — fixture statuses are checked against the explicit compatibility report
☑ Regression tests — parser recovery and editor history/selection behaviors have focused cases
Every discovered Construct edge case should become a permanent test.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
43. CONSTRUCT COMPARISON TESTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Long term, establish fixtures that represent known Construct behavior.
Structure:
fixtures/
  construct/
    picking/
    sub-events/
    else/
    or/
    triggers/
    loops/
    families/
    containers/
    expressions/
    variables/
    functions/
Each fixture contains:
input
expected behavior
expected selections
expected actions
expected output
compatibility state
Where possible, expected behavior should be obtained by comparison with actual Construct behavior rather than assumptions.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
44. TEST PARTIAL PARSING AGGRESSIVELY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Given the LLM use case, include fixtures such as:
""
"E"
"Event"
"Event {"
"Event {
 Condition"
"Event {
 Condition Player.X >"
and so on.
Each step should produce:
☑ No crash — partial source matrix covers empty, token, and malformed event prefixes
☑ A coherent snapshot — each partial source returns a schema-valid EventDocument
☑ Diagnostics — every matrix result includes at least one diagnostic
☑ Stable previously recognized structure — stream parser retains IDs and recoverable trees across chunks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
45. PLAYGROUND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
apps/playground should exist early.
It is the integration surface for development.
Provide panels:
Event sheet
Raw document
Diagnostics
Source input
Execution trace
Modes:
View
Edit
Stream simulation
Stream simulation should allow input to be revealed incrementally to validate parser/UI behavior.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
46. PLAYGROUND CONSTRUCT DEBUGGING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Provide developer tools such as:
☑ Current selection state — the editor emits selection-change for host inspection panels
☑ Event execution order — the playground renders structured trace entries
☑ Condition result — trace details show pass/fail outcomes
☑ Action targets — the preview host records target instance IDs and parameters
☑ Variables — runtime values are shown after preview execution
☑ Diagnostics — parser, compile, and runtime findings are listed
☑ Unknown ACEs — preserved unregistered ACEs are listed by operation and node ID
☑ Raw imported metadata — the preserved metadata block is inspectable
The playground is a development tool, not just a polished demo.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
47. PERFORMANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Do not prematurely optimize execution.
Performance priorities initially:
1. Large schema parsing
2. Large event-sheet rendering
3. Streaming updates
4. Editing responsiveness
5. Validation
Create realistic fixtures:
100 events
1,000 events
10,000 events
Measure before optimizing.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
48. UI PERFORMANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Avoid architectures requiring the complete document tree to rerender on every edit.
Stable node IDs should make fine-grained updates possible.
Consider virtualization only once measurements justify it.
But ensure the component architecture does not make future virtualization impossible.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
49. PARSER PERFORMANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Start simple.
V1 streaming may:
append chunk
→ reparse complete source
→ reuse IDs heuristically
→ return snapshot
Only implement true incremental parsing if measurements justify the complexity.
The public API should already allow replacing the implementation later.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
50. PUBLIC PACKAGE QUALITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every package has explicit package.json exports.
No consumer should import:
@project/engine-construct/src/parser/foo
Use:
@project/engine-construct
or intentionally supported subpaths such as:
@project/engine-construct/parser
Only expose subpaths when they provide meaningful API boundaries.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
51. TYPESCRIPT QUALITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Enable strict TypeScript.
Prefer:
strict
noImplicitOverride
noUncheckedIndexedAccess if practical
exactOptionalPropertyTypes if practical
Public APIs must not expose accidental any.
Incoming external data must receive runtime validation.
TypeScript types alone are not validation.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
52. PNPM / TURBO / MISE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use pnpm workspace dependencies.
Internal dependencies:
workspace:*
Use mise as the single documented runtime/tool bootstrap entry.
Desired onboarding:
mise install
pnpm install
pnpm dev
Turborepo tasks:
build
typecheck
lint
test
test:e2e
Ensure package task dependencies are explicitly modeled.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
53. CI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Required CI checks:
☑ Install from lockfile — CI uses `pnpm install --frozen-lockfile`
☑ Typecheck — CI runs `pnpm typecheck`
☑ Lint — CI runs `pnpm lint`
☑ Unit tests — CI runs the workspace test suite
☑ Compatibility tests — the workspace suite includes Construct compatibility fixtures
☑ Browser E2E tests — CI installs Chromium and verifies preview plus streaming flows
☑ Build packages — CI runs `pnpm build`
☑ Build playground — the workspace build includes the playground app
☑ Critical integration tests — CI test command runs parser-to-playground snapshot coverage
Do not require all Playwright scenarios on every tiny change if CI time becomes excessive; separate critical and full suites if necessary.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
54. DOCUMENTATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Document architecture decisions as short ADRs.
Important ADRs:
☑ One engine per document — documented in ADR-001
☑ Partial documents are valid parser results — documented in ADR-002
☑ Schema independent of Vue — documented in ADR-003
☑ Engine-specific behavior stays in engine packages — documented in ADR-004
☑ Construct compatibility is test-defined — documented in ADR-005
☑ Unknown information should be preserved — documented in ADR-006
☑ Host adapter owns external runtime state — documented in ADR-007
☑ Streaming is part of the public parser contract — documented in ADR-008
Avoid huge speculative architecture documents.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
55. INITIAL IMPLEMENTATION ORDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MILESTONE 1 — Repository
☑ pnpm workspace
☑ Turborepo
☑ mise
☑ shared TypeScript config
☑ linting
☑ Vitest
☑ basic CI
☑ playground booting
MILESTONE 2 — Schema
☑ EventDocument
☑ EventSheet
☑ Event
☑ Condition
☑ Action
☑ Expression AST
☑ Variables
☑ Stable IDs
☑ Diagnostics
☑ SourceLocation
☑ Unknown nodes
☑ Invalid nodes
☑ Incomplete nodes
☑ Schema version
MILESTONE 3 — Schema serialization
☑ Serialize
☑ Deserialize
☑ Runtime validation
☑ Migrations
☑ Round-trip tests — include a tag-pinned, editor-exported project corpus with folder and .c3p round-trips, a supported action edit, and a Construct-saved archive; JSON values and opaque files are preserved. Construct r495.2 opened the exporter-produced archive, while reopening the later importer/exporter round-trip remains unverified because that copy lacks its external addon archives
☑ Invalid data handling
MILESTONE 4 — Construct registry
☑ ConditionDefinition
☑ ActionDefinition
☑ ExpressionDefinition
☑ ParameterDefinition
☑ Registry implementation
☑ User extension API
   ☑ Basic Construct ACE set required by parser fixtures
MILESTONE 5 — Construct parser
☑ Parse minimal event sheet
☑ Produce diagnostics
☑ Recover from malformed/truncated input
☑ Preserve unknown data
☑ Source locations
☑ Stable IDs
☑ Parser fixtures
MILESTONE 6 — Streaming parser
☑ createParser()
☑ push()
☑ snapshot()
☑ finish()
☑ Partial expression handling
☑ Partial event handling
☑ Recovery tests
☑ Stream simulation
MILESTONE 7 — Viewer
☑ EventSheetEditor component
☑ Readonly mode
☑ Event rendering
☑ Condition rendering
☑ Action rendering
☑ Expression rendering
☑ Unknown node rendering
☑ Invalid node rendering
☑ Incomplete node rendering
☑ Diagnostic rendering
MILESTONE 8 — Streaming UI
☑ Connect parser snapshots to Vue
☑ Render while data is arriving
☑ Preserve previously displayed nodes
☑ Avoid crashes on malformed chunks
☑ Smooth incremental updates
☑ Demo in playground
MILESTONE 9 — Basic editing
☑ Select event
☑ Add/remove event
☑ Add/remove condition
☑ Add/remove action
☑ Edit parameters
☑ Reorder
☑ Nest
☑ Drag/drop
MILESTONE 10 — Commands
☑ Mutation command model
☑ Undo
☑ Redo
☑ Commands tested independently
☑ UI uses commands rather than arbitrary mutations
MILESTONE 11 — Construct import
☑ Import complete source
☑ Map to schema
☑ Preserve unknown data — opaque project files, unknown nodes, and unsupported ACE data are retained; invalid/colliding input paths are diagnosed
☑ Diagnostics
☑ Real fixtures
MILESTONE 12 — Construct export
☑ Export supported nodes — standalone sheets receive indexed event-sheet paths, and path collisions do not overwrite unrelated resources
☑ Export expressions
☑ Preserve opaque data where possible
☑ Export diagnostics — missing resources, unsupported content, unsafe paths, and output-path collisions are reported
☑ Lossy detection
☑ Round-trip tests
MILESTONE 13 — Construct execution foundation
☑ HostAdapter
☑ Compiler
☑ CompiledDocument
☑ Runtime
☑ SelectionContext
☑ ExecutionTrace
MILESTONE 14 — Construct execution basics
☑ Basic conditions
☑ Basic actions
☑ Object picking
☑ Sub-events
☑ Selection inheritance
☑ Variables
☑ Expressions
MILESTONE 15 — Compatibility suite
☑ Comparative fixtures
☑ TESTED status
☑ UNTESTED status
☑ KNOWN_DIVERGENCE status
☑ UNSUPPORTED status
☑ Human-readable compatibility report
MILESTONE 16 — Advanced Construct compatibility
Incrementally implement supported behavior and fixture unsupported or divergent behavior:
☑ Inverted conditions
☑ Else
☑ OR blocks
☑ Triggers
☑ Trigger once
☑ Loops — Repeat, inclusive named For ranges, While, For Each, ordered For Each, Stop Loop, per-iteration later conditions, LoopIndex, nested loop filtering, Stop Loop across nested loops, and the nested iteration cap have fixtures; fractional/unsafe For bounds and loop conditions in OR blocks are reported unsupported
☑ For Each — picked-instance iteration, ordered expression sorting, and LoopIndex fixtures
☑ Families — host family query fixture covers picking and family actions
☑ Containers — host membership fixture covers linked-instance creation and child selection
☑ Functions — named blocks import/export; Number/String expression calls; None-returning action calls; parameters, recursion, return values, and picking behavior are TESTED; async functions remain UNSUPPORTED
☑ Includes — project references and inline execution are TESTED; cycles are guarded
☑ Object creation edge cases — basic and linked-container creation/picking TESTED; other host-specific cases remain listed
☑ SOL restoration — parent picks survive child selection changes
☑ Remaining Construct semantics — untested and unsupported areas are listed in the report
☑ Mouse cursor-over-object — host delegation, object argument, and inversion are tested; a live Construct r495.2 preview call is captured for `NavButton`
☑ Set default color — `Shape3D`, `Sprite`, and `Tilemap` plugin metadata resolves 20 corpus actions; evaluated color arguments are delegated to the host, which owns rendering
☑ Pick children — direct `own` selection, recursive `all` descendants, and current child-selection filtering are tested; the pinned corpus has seven `own` uses
☑ Clipboard Copy text — plugin metadata resolves two corpus actions; evaluated text is delegated to the host, which handles browser permission and completion behavior
☑ Common Destroy — five corpus actions call host destruction for the picked instances and linked container members
☑ Common Is between angles — four corpus conditions filter picked instances, including wrapped clockwise ranges
☑ Common Set angle — six corpus actions evaluate and dispatch the angle for picked instances
☑ Common Set boolean instance variable — four corpus actions preserve, evaluate, and dispatch boolean values
☑ Common state and collision actions — Set enabled and Set solid collision filter dispatch; 8 Direction Stop preserves behavior scope
☑ Common Set position and Keyboard Lock keyboard — evaluated coordinates and key list delegate to the host
☑ System Set collision cell size — two corpus actions preserve, evaluate, and dispatch width and height
☑ Bullet Set speed — three behavior-scoped corpus actions preserve and evaluate speed before host dispatch
☑ Sprite Set animation speed, Bullet Set angle of motion, and System Set layer effect enabled — plugin, behavior, and static dispatch are tested
☑ Bullet On step — three corpus triggers match host-dispatched stepping events with picked projectile instances
☑ 8 Direction and Platform Set vector Y — four behavior-scoped actions preserve and dispatch evaluated movement components
☑ Common On collision with another object — three triggers preserve the other-object parameter and host-picked collision pair
☑ Timer Is timer running — three behavior-scoped conditions preserve tags and delegate state checks
☑ Mouse On object clicked — two corpus triggers preserve mouse parameters and dispatch with the picked object
☑ Mouse On mouse wheel — direction selector is preserved and host-dispatched (`any` in the pinned corpus)
☑ Solid Set tags — two legacy behavior actions preserve and dispatch tag strings
☑ Car Simulate control — two behavior-scoped actions preserve and dispatch accelerate and brake controls
☑ Particles Set rate — two plugin-scoped actions preserve and dispatch evaluated rates; host owns one-shot timing
☑ System Set layer scale — two actions preserve and evaluate scale expressions, including host-evaluated `LayerScale()`, before dispatch
☑ System Pick overlapping point — two conditions evaluate the layout point and use the host collision-polygon picker to set object selections
☑ System Pick by evaluate — candidate expressions filter active selections with inversion support
☑ Touch Is touching object — two conditions preserve the object parameter and delegate touch/collision state to the host
☑ Touch nth-touch triggers — start/end events preserve and match zero-based touch indexes
☑ List On selection changed — plugin-scoped trigger resolves from object plugin metadata
☑ Sliderbar On changing — five plugin-scoped triggers resolve from object plugin metadata
☑ WebSocket connection ACE subset — Connect/Close, connection state checks, and five connection/message triggers import, round-trip, and delegate to the host
☑ Common Is overlapping another object — five common and 3D collision checks preserve target object and delegate to the host
☑ Common Pick by unique ID — two conditions evaluate a UID and delegate instance resolution to the host
☑ Tween two-property action — one behavior-scoped action preserves and evaluates both target values and duration
☑ Common On created and Tween On tweens finished — triggers preserve picked instances and Tween tags
☑ Tween On any tweens finished — parameterless behavior trigger matches on the picked object
☑ Browser Open URL in new window — URL and window tag evaluate and delegate through the host
☑ MoveTo Move to object — object, image point, and mode resolve through behavior-scoped host dispatch
☑ Physics Set velocity and Apply force at angle — numeric parameters evaluate and dispatch through Physics scope
☑ Physics world configuration — gravity, stepping mode, and collision toggles dispatch through Physics scope
☑ Cannon3DPhysics Raycast — full parameter list evaluates and dispatches through behavior scope
☑ Common Set angle toward position — evaluated coordinates dispatch for selected objects
☑ Platform and Car movement ACE subset — behavior-scoped motion checks and Platform Set enabled dispatch
☑ Platform On landed and Timer On timer — behavior-scoped triggers match host events and Timer tags
☑ Common Compare Y — comparison code and coordinate evaluate before host delegation
☑ DrawingCanvas action subset — five plugin-scoped canvas actions resolve for object and family metadata
☑ 8 Direction Set vector X and Set maximum speed plus common Subtract from instance variable — evaluated parameters delegate through behavior-scoped or common host dispatch
MILESTONE 17 — Native engine
Only once schema and Construct integration have exposed enough real constraints.
☑ Native registry
☑ Native validation
☑ Native runtime
☑ Cleaner semantics than Construct
☑ Native-specific extensions through registered operation handlers
No requirement for parity with Construct.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
56. INITIAL MVP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The first useful public milestone should NOT wait for execution.
MVP:
☑ Stable schema package
☑ Construct-targeted documents
☑ Stable node IDs
☑ Diagnostics
☑ Partial/incomplete representation
☑ Construct event sheet parser
☑ Tolerant parsing
☑ Streaming parser API
☑ Construct registry
☑ User-defined ACE registrations
☑ Vue viewer
☑ Partial document rendering
☑ LLM streaming demo
☑ Basic editing — event/ACE edits, expression edits, keyboard shortcuts, and undo/redo are covered
☑ Drag and drop — event moves are tested within the editor
☑ JSON/schema import/export
☑ Playground
☑ Strong tests — parser, compatibility, runtime, editor, streaming, browser E2E, and round-trip suites pass
This is already valuable independently of full Construct execution.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
57. SECOND PUBLIC MILESTONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☑ Construct project/event import — indexed event sheets and the project manifest are covered by fixtures
☑ Construct export — supported event-sheet content exports with loss diagnostics
☑ Better editing — ACE expressions, event operations, keyboard commands, and undo/redo are implemented
☑ Round-trip preservation — untouched sheets and edited supported nodes are re-imported in tests
☑ More complete registry — common variable and layout ACEs found in the canonical sample are registered with tested variable handlers
☑ Compatibility diagnostics — tested, unsupported, and divergent behavior is recorded in the compatibility report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
58. THIRD PUBLIC MILESTONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☑ Construct execution — supported subset implemented; limits are listed in COMPATIBILITY.md
☑ Host adapters — runtime uses the schema HostAdapter contract
☑ Selection semantics — picking, inheritance, and restoration have compatibility fixtures
☑ Execution tracing — structured entries cover sheets, events, conditions, and actions
☑ Growing compatibility test matrix — behavior fixtures and tests are organized by feature
☑ Explicit compatibility report — COMPATIBILITY.md and the public formatter track status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
59. NON-GOALS FOR NOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☑ No engine switching workflow
☑ No mixed-engine documents
☑ No realtime collaboration
☑ No CRDT
☑ No backend
☑ No cloud storage
☑ No plugin marketplace
☑ No production game-runtime optimization
☑ No generic visual-programming platform
☑ No headless editor framework
☑ No complex theming architecture
☑ No dozens of micro-packages
☑ No claim of 100% Construct compatibility without tests — docs state compatibility is partial and feature-based
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
60. ARCHITECTURAL SUCCESS CRITERIA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The architecture is healthy when all of the following are true:
☑ A developer can install only @project/schema and validate event documents
☑ A developer can install @project/engine-construct and parse Construct-compatible data without Vue
☑ A developer can use @project/visual only when they actually want rendering/editing
☑ An incomplete LLM-generated event sheet renders instead of throwing
☑ One malformed condition does not destroy the rest of the document
☑ Unknown Construct features survive import instead of silently disappearing
☑ The Construct engine owns Construct semantics completely
☑ visual contains no hardcoded Construct semantic logic
☑ schema contains no Construct runtime logic
☑ User-defined Construct ACEs can be registered without modifying engine source
☑ Construct documents can be imported, viewed, edited, and exported within the supported subset
☑ Runtime behavior can be compared systematically against saved Construct captures; three r495.2 ACE-call captures are checked in, while broad runtime equivalence remains unaudited
☑ Compatibility status is backed by tests
☑ Native can be added without restructuring Construct — Native is a separate engine package
☑ Adding Native does not require changing the fundamental EventDocument format
☑ External products can embed the viewer
☑ External products can parse event sheets without the viewer
☑ Streaming LLM output can progressively become a complete visual event sheet
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL PRODUCT VISION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The library should eventually make all of these workflows natural:
Construct project
→ parse
→ inspect programmatically
Construct project
→ import
→ render as event sheet
Construct project
→ import
→ visually edit
→ export
→ reopen in Construct
Construct event sheet
→ import
→ execute against a host adapter
LLM
→ stream event-sheet representation
→ tolerant parser
→ progressively rendered UI
→ complete editable event sheet
External application
→ provide custom Construct-compatible conditions/actions/expressions
→ use the same schema and visual editor
Native document
→ use the same structural model
→ use different semantics
→ eventually evolve beyond Construct
FINAL GOAL:
Create a schema-first event-sheet ecosystem where Construct is the first and primary compatibility target, the schema is useful independently of the UI, parsing is resilient enough for incomplete and streamed input, the visual editor can always render whatever valid structure exists, engine-specific behavior remains isolated inside its engine package, and Construct compatibility progresses toward 100% through explicit comparative tests rather than assumptions.
