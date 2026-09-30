# Construct editor project fixture

`project/` is the complete folder project from
[GenvidTechnologies/construct3-sample](https://github.com/GenvidTechnologies/construct3-sample/tree/v0.4.0)
at commit `e752e2470327dc1a8647766aefd94a5e36150173`. The upstream repository
identifies it as a Construct editor export and licenses it under the included
MIT No Attribution license.

The fixture exercises nested indexed resources, custom bundled addons, binary
assets, scripts, timelines, and unknown plugin ACEs. Tests verify that project
import and export preserve every file and every JSON value. Three Construct
runtime captures cover passing and short-circuited runs of the sample's GO
event, including one Mouse condition, not the project's overall runtime
behavior.

`construct3-sample-r495.2-editor-saved.c3p` is a separate archive downloaded
from Construct 3 r495.2 after opening an exporter-produced copy of this
project. It is retained as a corpus fixture for importing and exporting
Construct-generated archives. The round-trip test verifies its 63 paths after
normalizing backslash separators to slashes, along with every JSON value and
binary entry. Construct omitted external addon archives and generated
TypeScript declarations, and added editor `.uistate.json` files when saving
this copy. SHA-256:
`58af02c2617abbce5ddf33d21c811b14c1cd4b7cc17ebda0159394b74b755db3`.

`construct3-sample-r495.2-trigger-score1.c3p` is the exporter-produced 106-file
archive used for the Construct r495.2 preview capture. Its only difference from
the export is the global `score` initial value in `eventSheets/Event sheet
1.json`, changed from `0` to `1` so the GO event's conditions pass. The runtime
call capture and its source-mapped trace projection are in
`../../compatibility/construct-r495.2-trigger-trace.json`; the projected event
and group statuses are inferred from the recorded C3 calls, not exported by
Construct. SHA-256: `58da06aed9752e5eafc10664a1581dd22f3f93d5b6c06596651015ac2509687d`.

`construct3-sample-r495.2-trigger-score0.c3p` uses the same exporter-produced
archive with the global `score` initial value set to `0`, exercising the GO
event's first false condition. Construct called `Button.OnClicked`, then
`System.Compare(0, 4, 0)` returned false; it called no later condition or
action, and the button remained on Main Layout. Its capture and source-mapped
trace projection are in `../../compatibility/construct-r495.2-trigger-score-zero-trace.json`.
SHA-256: `6cebc2d63a6bb11929bb39188698a6e6b75e1fee672150329179fedf31b9d3ec`.

`construct3-sample-r495.2-mouse-cursor-score1.c3p` is a Construct-opened
variant of the passing archive with the Mouse singleton and a
`Mouse.IsOverObject(NavButton)` condition added to the GO event. In the r495.2
preview, the condition returned true, the remaining conditions and actions
ran, and the button moved to Second Layout. Its ACE-call capture and
source-mapped trace projection are in
`../../compatibility/construct-r495.2-mouse-cursor-trace.json`. SHA-256:
`23d6009d1f6b3fa732d40c7efba103db49de05e431821fec756bcf328319cc75`.
