# @project/visual

Vue components for viewing schema-first event documents. The first component is
`EventSheetEditor`, which renders event trees, conditions, actions, recovery
nodes, variables, and parser diagnostics.

```vue
<script setup lang="ts">
import { EventSheetEditor } from '@project/visual'
import '@project/visual/style.css'
</script>

<template>
  <EventSheetEditor :document="document" :diagnostics="diagnostics" readonly />
</template>
```

The document stays plain schema data. This package does not parse Construct
resources or implement engine behavior.

In editing mode, `EventSheetEditor` emits `selection-change` with the selected
event ID. It emits `undefined` when selection clears, so a host can keep
debugging or inspection panels synchronized without reading the component DOM.

Hosts can also apply the editor's typed immutable commands without mounting
the component:

```ts
import { applyEditorCommand } from '@project/visual'
import type { EventDocument } from '@project/schema'

const next: EventDocument = applyEditorCommand(document, {
  type: 'update-action-operation',
  eventId: 'event-1',
  actionId: 'action-1',
  operation: 'System.set-eventvar-value',
})
```

LLM integrations can return the same bounded commands to create a validated
repair preview. The provider receives the document and structured diagnostics;
the helper does not call a model or publish the proposed document automatically.

```ts
import { proposeRepair } from '@project/visual'

const proposal = await proposeRepair(document, diagnostics, async ({ document, diagnostics }) => {
  return model.suggestEditorCommands({ document, diagnostics })
})
if (proposal.ok) {
  // Review proposal.diff before adopting proposal.document.
}
```
