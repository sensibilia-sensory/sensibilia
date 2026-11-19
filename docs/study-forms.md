# Session flow and question batteries

Open a study and select **Session flow**. The initial outline contains its existing sensory tests.
Saving the flow enables the new questionnaire package for that draft. An earlier published study
keeps its original configuration; create a new draft to add forms to it.

## Build the screens

Select a block in the outline and use **Add block** to choose the next screen. New screens are
inserted immediately after the selected block. Consent starts at the beginning of the flow.
Use **Find a block** for long forms; clearing the filter restores the complete outline.

- **Add consent** creates a single choice with “I agree” and “I do not agree”. Its initial rule
  continues on agreement and ends with the screen-out message on refusal. Enter your reviewed
  participant information in **Introductory text**.
- **Add choice** creates an ordinary question for screening or other survey items. Edit the wording
  and labels. Enable multiple selections for ingredient restrictions and mark “None” as an
  exclusive answer when appropriate.
  A single choice question can take its options from a **Standard scale** (agreement, frequency,
  purchase intent, liking) or a **Numbered scale**: pick 3 to 11 points and name the two ends, for
  example a 7-point scale from “Not at all” to “Extremely”. **Scale display** chooses how the
  assessor sees the options: a vertical list, a horizontal row with every option named, or a
  horizontal row naming only the two ends. Every option keeps its full text in exports whichever
  display is chosen. Multiple choice questions are always a vertical list.
- **Add instructions** (an Information step) creates a text page. Set the Continue button label
  and optionally require a checked acknowledgment using your wording in **Settings**. The text
  box takes several lines: Enter makes a new line and a blank line starts a new paragraph. Select
  words and use **Bold** or **Italic**, or type `**bold**` and `*italic*` yourself (`***both***`
  works too, and `\*` shows a star). Nothing else is interpreted: HTML, links and images typed
  into the text are shown as text.
- **Add question battery** creates a matrix whose rows share one response scale. Enter each row
  or paste one statement per line using **Add several rows at once**. Add/reorder rows and decide
  which answers are required. In **Response scale**, choose an agreement, consumption-frequency or familiarity template,
  edit every label, or copy a scale from another battery. A copied scale is independent. Optional
  integer scores, including zero, are exported as configured without analysis or reverse scoring.
  The same **Standard scale**, **Numbered scale** and **Scale display** settings apply. With a
  horizontal display each statement is one compact block instead of a stack of options: with
  only the two ends named, the statement, the end labels across the width and one row of numbered
  radio buttons; with every option named, a real table with a column per option.
- **Add sensory test** places a configured test in the flow. The test's own editor still controls
  its sensory questions and fixed method scale. Select card or shared-scale matrix presentation.

Move blocks by dragging a row by its grip (drop on a group to put the block inside it, above a row
to place it there) or with the up/down controls and the group buttons in the side panel. Each block is a separate assessor screen; all its changes
remain in the same draft form until **Save flow**. Stable identifiers are generated for blocks,
rows and options. **Show row codes** exposes the optional export-identifier editor.
Set the completion and screen-out wording through **Session endings**; **Done** returns to the
editor and **Save flow** persists those messages with all blocks.

**Duplicate block** inserts an independent copy after the selected screen, with a new block ID.
An if/else condition referencing the original screen itself references the copy in the duplicate.
Other route destinations remain explicit and may need adjustment; validation still applies.
Copied battery scales and wording can be edited independently. Duplicating a sensory-test block
immediately creates a separate saved test configuration in this draft, then adds its block to
the unsaved flow. Save the flow before leaving. If the flow is discarded, the copied test remains
available through **Add sensory test**. Published blocks cannot be duplicated until a new draft
is created.

Each configured sensory test needs one flow block before publication. To remove a test, remove
its flow block and save the flow first, then remove its configuration in the test editor. A
questionnaire-only study can be published with at least one valid form block.

## Set if / else rules

Open **Routing**. In **After this block**, choose an unconditional destination or enable **Use an if / else rule**.
Select the current or an earlier choice question, then select the option codes to match. “Any”
matches one or more of those options; “All” requires all of them. Choose both destinations:
next block, a named later block, finish, or screen out.

For example, put an allergy choice before a restriction notice and the evaluation. If Milk or
Soy is selected, route to the notice; otherwise route to the evaluation. Make the notice end
the session if that is your protocol. These decisions are explicit researcher settings, not
automatically derived from ingredient names. Product-by-product exclusions need sample handling
in a later feature.

Routes can only move forward. A prior choice must be answered on every possible route to the
block that uses it. Removing or moving blocks may invalidate rules; the editor shows the issues
and the server independently validates the saved flow. Nothing silently falls back to an
evaluation when a condition's source is missing.

## Rehearse, save and publish

**Preview block** opens the selected screen in a dialog. **Preview session** starts at the first block
and follows choices through the complete route. Try agreement and refusal, each restriction
branch, acknowledgments, required matrix rows, explicit skips and the final message. The route
taken appears below. Preview answers are temporary and create no sessions or observations.

Save the flow, review the sensory test configurations, then **Publish study**. Screens, routes,
scales, wording, block codes and version metadata become immutable. Create a new draft for
changes; earlier sessions keep their exact publication. The researcher preview supports desktop,
tablet and phone widths; the offline assessor application is still the next development stage.

## API contract for an assessor renderer

`VersionRead.form` is null for legacy sequential tests, otherwise a `StudyForm` with
`schema_version: 1`. The frozen schema is [form_v1.json](contracts/form_v1.json); OpenAPI describes
the discriminated block and value types. `/sessions/{id}/test` returns package schema 2 when a
form is assigned, including every route, choice label, matrix row/scale and sensory configuration.
The session's test `presentation_order` remains its fixed list of test UUIDs; the form supplies
screen order and branches. A tablet must use the package's form when package schema is 2.

`GET /sessions/{id}/progress` returns `current_step_id`, `visited_step_ids`, and a terminal
`outcome`/`message` when the route has ended. It does not return an arbitrary new assignment.

Persist one event locally when the assessor presses Continue, before reporting that it is saved.
Submit events in traversal order through `POST /sessions/{id}/form-events`:

```json
{
  "events": [{
    "client_event_id": "032dc714-b393-48b1-8ff9-45d4a9a7d090",
    "step_id": "consent",
    "recorded_at": "2026-10-08T12:00:00+00:00",
    "value": {"state": "answered", "selected": ["yes"]}
  }]
}
```

The step code and option codes must come from the assigned package. Block values are:

| Kind | Continue submission value |
| --- | --- |
| Instructions | `{"state":"continued","acknowledged":true}`; true is required when configured |
| Choice | `{"state":"answered","selected":["option-code"]}`; nonempty, one for single choice |
| Matrix | `{"state":"matrix","answers":{"row-code":{"state":"selected","option_id":"option-code"}}}` |
| Sensory test | `{"state":"continued","acknowledged":false}` after its required observations commit |

A matrix skip is `{"state":"skipped","option_id":null}` when enabled. Optional rows may be
omitted; required rows need an answer or an allowed explicit skip. Unknown rows/options are rejected.
To retry, keep identical values and the original UUID. Accepted and duplicate acknowledgments
use the existing committed batch contract. Empty selections never mean “No”.

For test blocks, use the existing `/responses` API for ratings and its correction history. First
synchronize preceding form Continue events, then the test observations, then the test Continue
event, then subsequent form events. These APIs do not accept events out of traversal order.
A batch of form events commits atomically; any rejected event rolls back the whole batch.
Refreshes and clock differences must not change UUIDs or reorder the local event queue.

Form Continue submissions freeze their answers. Revisiting or changing a completed block is not
supported; start a separately provisioned session rather than silently changing an earlier
screening decision. Exact retries are accepted after advancing and after session closure.
`POST /sessions/{id}/complete` records `completed` or `screened_out` only once a terminal route
has been reached. It does not require responses from skipped branches.
Staff can also end an assessment that is still in progress (`POST /sessions/{id}/end`, status
`ended`, with `completed_at` set to the moment of ending). An ended session still accepts events
whose client `recorded_at` is not later than that moment, so answers a tablet recorded offline are
not lost, and rejects anything recorded afterwards. Exports show the status `ended`; no skipped or
missing values are fabricated for the unanswered steps.

Researchers can read atomic submissions using `/studies/{id}/form-responses`. The existing CSV
combines them with sensory events. Additional columns are `step_id`, `block_kind`,
`form_schema_version`, `option_label`, and `score_json`. Matrix answers expand to rows, preserving
their original event ID and timestamps; use session/event/row identifiers together. A missing
optional row has `{"state":"missing"}`. Unvisited blocks have no rows. Instructions and test
Continue events use `question_id: continue`; choices use `question_id: choice` with the complete
selected list, including explicit “None”. Decode `score_json` to distinguish null from zero.
