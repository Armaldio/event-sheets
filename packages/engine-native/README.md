# @project/engine-native

The Native engine consumes the shared `EventDocument` schema and defines its
own registry, validation rules, expression evaluator, and runtime. It has no
dependency on `@project/engine-construct`.

```ts
import { createNativeEngine } from '@project/engine-native'

const engine = createNativeEngine()
const validation = engine.validate(document)
const trace = engine.run(document, 'sheet:main')
```

Each `run` call starts with a fresh variable store initialized from document
and selected-sheet declarations. Conditions run left to right with AND
semantics; events marked `isOrBlock` use short-circuit OR semantics. A failed
parent skips its child events. Children share the current run's variables.
Inverted conditions negate their result. There is no implicit Else behavior or
object selection state. Sheet variables with a duplicate name replace the
document value for that run. Instance-scoped variables and function
definitions are reported as unsupported.

The initial registry provides `Native.always`, `Native.compare`,
`Native.set-variable`, and `Native.increment-variable`. Custom condition and
action handlers can be registered with `NativeRegistry`. Unknown operations,
unsupported expressions, invalid sheet IDs, and handler errors are reported in
validation results or runtime diagnostics.

This is a small native execution model, not an attempt to reproduce Construct.
Function calls, object-instance variables, loops, and host-specific object
operations are not part of this initial slice.
