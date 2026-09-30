# @project/schema

The engine-neutral TypeScript model and serialization boundary for event-sheet
documents. This package has no Vue or Construct runtime dependency.

```ts
import {
  CURRENT_SCHEMA_VERSION,
  createNodeId,
  deserializeDocument,
  serializeDocument,
  type EventDocument,
} from '@project/schema'

const document: EventDocument = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: createNodeId(),
  engine: { id: 'construct' },
  sheets: [],
  variables: [],
}

const json = serializeDocument(document)
const result = deserializeDocument(json)
```

Stable node IDs also support structural comparisons between snapshots:

```ts
import { diffEventDocuments } from '@project/schema'

const diff = diffEventDocuments(previousDocument, nextDocument)
// diff.operations reports added, removed, updated, and moved nodes.
```

Source-location changes are ignored so streamed text updates do not mark every
node as structurally changed.

Deserialization validates untrusted JSON and returns structured diagnostics
instead of throwing. Recovery nodes and expression nodes retain incomplete,
invalid, or unknown content so parsers and viewers can preserve useful structure.

`HostAdapter` is the engine-neutral boundary for runtime calls. `callAction`
and `evaluateCondition` may receive optional `AceInvocationScope` metadata so
an adapter can distinguish an ACE registered to a behavior or plugin; existing
handlers can ignore the optional argument.
