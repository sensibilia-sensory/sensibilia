# Sensory methods and sample handling

All ten registered methods have configuration editors, interactive assessor rehearsals, server
validators and contextual exports. Select **Coded samples** to add blind codes and private product
or preparation labels. Then **Add test → Test method**, choose the method, and configure its content,
samples, scales and settings. Multiple instances and different methods can share one study.
Saved tests can be inserted into **Session flow** alongside consent, screening and instructions.
Publication freezes the configuration and products; later drafts copy them with new identifiers.

| Method ID | Configuration and observation |
| --- | --- |
| `hedonic-9-v1` | Nine ordered liking categories scored 1 (dislike extremely) to 9 (like extremely), 5 = neither like nor dislike; no zero. One or more questions with stable IDs, required/optional, and explicit skips only if enabled. Nine labels in ascending score order; the two ends must be named, steps between may be left unnamed. Not a substitute for intensity or JAR scaling. v1 has no coded-sample selection. |
| `tcata-v1` | Temporal CATA inside a current-sample loop: 1–30 researcher attributes, a start instruction, a run duration (1–600 s) and a declared timing tolerance (1–1000 ms). Assessors select and deselect attributes as the sample changes; several may be active at once. Every attribute is tracked for the whole run. |
| `cata-v1` | Researcher attributes; select applicable terms per product. Record every term as selected/unselected, with explicit skips only if enabled. |
| `rata-v1` | Select applicable terms, then rate configured intensity or applicability. Editable 2–11 category scale, origin 0 or 1, optional selected-but-unrated convention. |
| `jar-v1` | Researcher attributes on 3, 5 or 7 categories: too little → just about right → too much. Middle category is the ideal; preserve that meaning when translating labels. |
| `triangle-v1` | Exactly two products; serve a blinded triad with two identical and one different. Forced choice of the different sample. Difference/similarity purpose is explicit. |
| `duo-trio-v1` | Exactly two products; reference plus two coded samples. Forced choice of the matching sample. Balanced-reference or configured constant-reference technique. |
| `two-afc-v1` | Exactly two products; blinded pair with a researcher-written question. Forced choice, no tie option. Directional (names the product expected to have more of the attribute, so answers are scored) or preference (no correct answer). |
| `flash-profile-v1` | 2–30 products, assessor-generated sensory descriptors, then full product rankings from low to high intensity for each descriptor. Configurable descriptor limits and ties. |
| `napping-v1` | 2–50 products on a blank digital 3:2 similarity map. Tap/drag or use keyboard placement. Optional product descriptions after mapping. |

Attribute methods allow no sample selection for a single unassigned product, with `sample_id=null`.
With coded samples, all required attribute/product pairs need observations before Continue or
completion. Unselected does not mean missing. Assessors may legitimately select no CATA/RATA terms;
the collection client must persist the explicit unselected events when finalizing that screen.
Flash profiling and Napping require all configured products. Discrimination tasks have no skip,
“same” or “don't know” response.

## Contracts and values

New configurations and values carry a `kind` discriminator. The hedonic payload predates it and has
none: `{"state":"rated","rating":7}` or, when skips are enabled, `{"state":"skipped","rating":null}`.
Skipping is disabled by default; no event means missing. Ratings are ordered categories: the
software does not imply that the distances between them are equal.
The live OpenAPI describes every shape; registry configuration schemas are frozen in
`migrations/versions/methods_v1.json`. Reserved set-level question IDs are `choice`, `profile`, and
`map`. Those events have `sample_id=null`; individual product context is inside their value/plan.

Example values (UUID keys stand for the actual configured products):

```json
{"kind":"cata","state":"unselected"}
{"kind":"rata","state":"selected","rating":0}
{"kind":"rata","state":"selected","rating":null}
{"kind":"jar","state":"rated","rating":3}
{"kind":"triangle","state":"chosen","selected_slot_id":"s2"}
{"kind":"duo_trio","state":"chosen","selected_slot_id":"s1"}
{"kind":"two_afc","state":"chosen","selected_slot_id":"s2"}
{"kind":"flash_profile","state":"profile","attributes":[
  {"id":"own-term-1","term":"Toasted cereal","ranks":{"<product-a-uuid>":1,"<product-b-uuid>":2}}
]}
{"kind":"napping","state":"mapped","points":{
  "<product-a-uuid>":{"x":0,"y":0,"description":""},
  "<product-b-uuid>":{"x":60,"y":40,"description":""}
}}
```

Each line is an independent example, wrapped in the usual event envelope when submitted.
RATA zero requires scale origin 0; selected/null requires `require_ratings=false`. Unselected and
skipped RATA have null ratings. Missing means no event. Rating values are strict integers.
Flash descriptor IDs and case-insensitive terms must be unique within a profile. Rank every product,
using consecutive ranks from 1; ties share a rank (1,1,2). With ties disabled, ranks must be a complete
permutation. Dense tie encoding is explicit and can be transformed for a reviewed analysis later.
Napping coordinates are finite numbers, bounded x=0..60 and y=0..40. Origin is top left, x increases
right and y increases downward; overlapping points and boundary zero are valid. Descriptions are
accepted only when enabled. Map coordinates are cm-equivalent, not measured physical screen sizes.

TCATA is not submitted as a single answer. The tablet records each run locally and submits it whole
to `POST /sessions/{session_id}/temporal-runs`; the run and all its transitions commit atomically
before acknowledgement. A run has a `state` of `complete` (the full configured duration, no
interruption), `interrupted` (with at least one flag: `hidden`, `reload`, `clock_gap`,
`storage_failure`, `event_limit`) or `skipped` (only when enabled; no transitions). Each transition
carries its own `client_event_id`, a consecutive `seq`, `elapsed_ms` from the start, the
`attribute_id` and `selected` true/false. Transitions must alternate per attribute (no redundant
select or deselect) and stay within the run. An interrupted run cannot resume its original clock.

## Provisioning and preparation

1. Publish the configured study.
2. Researcher `POST /sessions` with the published version ID and assessor code. Retain its returned
   session credential; session provisioning is currently an API operation.
3. Researcher `GET /sessions/{session_id}/serving-plan` returns the frozen preparation order,
   blind serving codes, product labels/IDs, reference and comparison answer key.
4. Session `GET /sessions/{session_id}/test` returns package schema 3 for these methods. Cache
   this complete package; do not reconstruct/randomize serving orders in a collection client.
5. Submit validated response events idempotently; for routed forms submit Continue only after
   persisting and synchronizing the required method observations. Server enforcement follows
   the assigned form path. An offline client must enforce the same completion rules locally.

Triangle allocation balances six sequences (AAB, ABA, BAA, ABB, BAB, BBA). Duo-trio balances four
reference/order combinations, or two with a constant reference. 2-AFC balances two orders (AB, BA). Allocation randomly chooses among
least-used combinations across provisioned sessions for that configured test; abandoned sessions
still count. Each discrimination serving, including repeated products and the reference, receives
a distinct random three-digit code. Public slots omit product identity and the answer key.
Other methods use catalog blind codes and a frozen shuffled order. Researcher labels never appear
in tablet packages. A rehearsal displays representative comparison codes, not a real allocation.

## Export interpretation

Attribute events remain one row per product/attribute, including skips and correction history.
Flash profiles expand into descriptor × product rows (`descriptor_id`, `descriptor`, `rank`).
Napping maps expand into product rows (`x`, `y`, `coordinate_units`, optional `descriptor`).
Comparison rows include `selected_code`, boolean `correct` and the private `serving_plan_json`.
TCATA exports one `temporal_run` row per run (state, `temporal_elapsed_milliseconds`,
`clock_resolution_ms`, `interruption_flags_json`) followed by one row per transition, ordered by
`temporal_seq`, with the attribute as `question_id` and `selected`/`unselected` as its state.
All method rows carry lossless `value_json`, common identifiers/timestamps, and product codes/labels
where applicable. The full profile/map JSON repeats on its expanded rows, so group by event ID
before counting atomic submissions. Use `is_current` when selecting corrected observations.

## Analysis (optional add-on)

With the analysis add-on installed, Results > Analyses offers, per method:

| Method | Analysis |
| --- | --- |
| Nine-point hedonic | Two-way ANOVA (sample + assessor) with Tukey HSD or Fisher LSD letters, or Friedman |
| Triangle, duo-trio, 2-AFC | Exact binomial difference or similarity test with pc, pd and d′ (sensR); 2-AFC preference as a two-sided binomial test |
| JAR (with a hedonic test on the same samples) | Penalty analysis: shares, mean drops, penalties, Welch tests |
| CATA | Cochran's Q, pairwise McNemar (Holm), correspondence analysis; impact on liking with a hedonic test |
| RATA | Unchecked scored 0; per-attribute two-way ANOVA (sample + assessor) with Tukey HSD or Fisher LSD letters, share checked, PCA map of mean ratings |

A power calculator for triangle, duo-trio and 2-AFC works without the add-on. TCATA,
flash profiling (GPA), Napping (MFA), panel performance, preference mapping and clustering are
not implemented; use the R-ready export for them.

## Methodological basis and limits

The nine-point hedonic scale follows D. R. Peryam and F. J. Pilgrim (1957), *Hedonic scale method
of measuring food preferences*, Food Technology 11, 9–14; the historical papers are published by
[Peryam & Kroll Research Corporation](https://www.pk-research.com/wp-content/uploads/2021/09/TheNinePointHedonicScale-Papers.pdf),
with practitioner context from the
[Society of Sensory Professionals](https://www.sensorysociety.org/knowledge/sspwiki/Pages/The%209-point%20Hedonic%20Scale.aspx).
Default English labels come from the implementation. Translated or modified labels need researcher
review to keep the intended category meanings; the software checks only that the ends are named.
Sample handling, blinding, presentation order, language validation and instructions suited to the
product and population remain protocol decisions and are not standardised by the software.

CATA follows selection of applicable sensory terms as reviewed by
[Jaeger et al. (2020)](https://doi.org/10.1016/j.foodqual.2019.103794).
RATA explicitly separates intensity and applicability ratings described by
[Ares et al. (2014)](https://doi.org/10.1016/j.foodqual.2014.03.006).
The three-point intensity and five-point applicability presets provide endpoints; researchers
review labels for their protocol. Custom scales and optional selected/unrated answers are explicit
configuration conventions, not automatic methodological assumptions.
JAR category meanings follow the [Society of Sensory Professionals guide](https://www.sensorysociety.org/knowledge/sspwiki/Pages/Just%20About%20Right%20Scales.aspx).
TCATA follows the temporal check-all-that-apply method described by
[Castura et al. (2016)](https://doi.org/10.1016/j.foodqual.2015.06.017): several attributes may be
active at once, and no fading or dominance is implemented. Automated tests establish software
behaviour, not touch latency or timing precision on a particular tablet. Before relying on TCATA
timing, measure it on your own devices against an independent reference and compare the result with
the tolerance declared in the configuration.

Triangle and duo-trio implement the forced-choice tasks and reference techniques described by
[ISO 4120:2021](https://www.iso.org/standard/76666.html) and
[ISO 10399:2026](https://www.iso.org/standard/88370.html). These registry references do not assert
full ISO compliance: laboratory preparation, assessor selection, sample sizes and statistical
decision procedures need a reviewed protocol. The complete standards were not incorporated.
2-AFC (paired comparison) follows the directional/preference forced-choice task described by
[ISO 5495:2005](https://www.iso.org/standard/31621.html), with the same limits on compliance claims.
Open points: no "no preference" option is offered, and the standard's statistical decision
procedures are not implemented; the export carries `correct` only for directional tests.
Flash profiling follows own-vocabulary comparative ranking described by
[Dairou and Sieffermann (2002)](https://doi.org/10.1111/j.1365-2621.2002.tb10685.x) and
[Delarue and Sieffermann (2004)](https://doi.org/10.1016/S0950-3293(03)00085-5).

Napping is **digital projective mapping**, adapted from the physical-sheet procedure. Rectangle
shape matters to results; the geometry and lack of semantic axes follow the investigation by
[Hopfer and Heymann (2013)](https://www.sciencedirect.com/science/article/abs/pii/S095032931200184X).
The registry cites [Pagès (2005)](https://doi.org/10.1016/j.foodqual.2005.01.006).
Changing screen size and touch interactions need laboratory validation; a 3:2 screen canvas does
not establish equivalence with a 60 × 40 cm paper sheet. Simulated Chromium touch checks are
automated, but actual Android tablet use and durable offline PWA storage remain pending.
