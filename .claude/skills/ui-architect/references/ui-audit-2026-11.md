# UI audit, November 2026 (background)

Background, not rules. This is the register of inconsistencies and bugs the November 2026
survey found (1,000+ screenshots across every area and a parse of all 1,809 Vue files). Each
row names the [guidelines](guidelines.md) id it breaks; the rule is what binds, this file only
shows where the app stood when the rules were written. Counts and line numbers are a snapshot
and drift as fixes land: re-measure before quoting one.

## Current inconsistencies

| Area | Finding | Rule | Evidence |
| --- | --- | --- | --- |
| Everywhere | Nine control heights; 170 of 1,046 rows and 91 of 119 toolbars mix them | S1 S2 | composition.md §1 |
| Everywhere | OButton: 40 declared variants × 23 sizes; 142 variant-and-size pairs in use | B2 | components.md |
| Everywhere | 288 undeclared props, including an ignored `disable` | B9 | components.md |
| Everywhere | 126 raw buttons and 260 clickable divs | KB4 | components.md |
| Everywhere | 118 hand-built copy buttons; no shared Copy component | P2 | components.md |
| Everywhere | Field stacks use six gap values; toolbars twelve | L4 | composition.md §2 |
| Everywhere | Back built 12 ways; 19 raw router.back(); no breadcrumb component | N3 | composition.md |
| Everywhere | Save in 8 kinds of place; 10 in Settings | V2 | composition.md · screens-settings-iam.md |
| Everywhere | 63 of 159 list pages keep filters only in memory | F11 | composition.md |
| Everywhere | 27 drawer widths (19 in vw); dialogs 480–1,080 | O3 | composition.md §4 |
| Everywhere | 18 overlays switch content without a fixed height | O4 | composition.md §4 |
| Everywhere | 64 hand-built confirms beside 104 ConfirmDialog uses | V8 | composition.md §4 |
| Everywhere | 28 of 61 full-page editors have no unsaved-change guard | V4 | composition.md |
| Everywhere | 2,230-line DateTime.vue while ODateTimeRange is unused | F8 | components.md |
| Everywhere | Five KPI tile designs | F7 | components.md · screens-data.md |
| Global shell | Header mixes 34, 28 and 30 px; overflows at 768 px | S2 R1 | screens-observe.md §1 |
| Global shell | Command palette re-centres as you type (top 184 → 360) | O5 | screens-observe.md · screens-settings-iam.md |
| Logs | Rail round trip cuts the URL to `?period=`; reload loses stream and query and shows the wrong range | N3 F11 | screens-observe.md §8 |
| Logs | Edited, unrun query loses its amber cue after a round trip; editor and results disagree | P4 | screens-observe.md §8 |
| Logs | Saved views: no "modified" state, applied view not marked | V2 | screens-observe.md |
| Logs | Visualize rewrites the query to aggregate SQL and it stays, so Patterns finds nothing | P4 | screens-observe.md |
| Logs, Traces | Lose scroll on Back; Traces falls back to the Spans tab | N3 | screens-observe.md §8 |
| Observe | Time picker "Absolute" reflows the toolbar and detaches its popover | O4 | screens-observe.md |
| Observe | Stream picker narrows 288 → 175 px while filtering | O4 | screens-observe.md |
| Observe | Create alert: page from Logs and Metrics, dialog then page from Traces | O2 | screens-observe.md §9 |
| Observe | Save view: 640 "Saved View" in Logs vs 480 "Save view" in Metrics | O2 T5 | screens-observe.md §9 |
| Observe | Nine time formats; "1162 ms" vs "158.00ms" | W4 T4 | screens-observe.md §9 |
| Observe | "Drill down" names three different features | N7 | screens-observe.md §9 |
| Observe | Primary is "Run query", "Refresh" or an icon; Share position differs per explorer | F1 F9 | screens-observe.md §9 |
| Dashboards | Header buttons 30 px vs 34 on lists; up to 5 header buttons, no More | S1 B8 | screens-respond.md |
| Dashboards | Create drilldown dialog shrinks 468 → 378 → 308 and moves 80 px each time | O4 | screens-respond.md |
| Dashboards | Enter in the add-panel title saves the panel | V7 | screens-respond.md |
| Dashboards | Four modal chains (New dashboard → Add folder …) | O8 | screens-respond.md |
| Alerting | Six raw router.back() calls leave the app from a deep link | N3 | screens-respond.md |
| Alerting | New destination's Save jumps from y 318 to 836 with the type | V2 P3 | screens-respond.md |
| Alerting | Switching alert type reflows the whole add-alert page | P3 | screens-respond.md |
| Respond | Segmented controls used as state filters on 12 screens | F6 | screens-respond.md |
| Respond | Four stepper layouts; Continue inside steps | V9 | screens-respond.md |
| Respond | Three versions of the same JSON import, no progress | U1 U3 | screens-respond.md |
| Data | Stream detail footer cut off at 1440 × 900 | O6 | screens-data.md · schema.vue:70 |
| Data | 8 drawer widths, 432 to 1,397 px; Associate function jumps 432 → 1,397 | O3 O4 | screens-data.md |
| Data | New stream, New enrichment table and Edit backfill dialogs grow and re-centre | O4 O5 | screens-data.md §10 |
| Data | "Drop your file here" but dropping is switched off | U1 | BaseImport.vue:127-134 |
| Data | Five destructive confirm styles, from type-to-confirm to a blue "OK" | V8 B3 | screens-data.md |
| Data | Seven empty-state looks; pager shown under empty tables | K5 D5 | screens-data.md |
| Data | Unknown written as "—", "--", "-", blank and "0" | C4 | screens-data.md |
| Settings | Four unsaved-change behaviours; most settings pages unguarded | V3 V5 | screens-settings-iam.md §0 |
| Settings | Form pages start at x = 335, list pages at x = 331 | L1 L3 | screens-settings-iam.md §0 |
| Settings | Section headings in about 9 size and weight pairs | T1 | screens-settings-iam.md §4 |
| Settings | Names differ across rail, header and tab (BYOB, Running queries, Nodes) | P2 | screens-settings-iam.md §0 |
| Settings, IAM | Token disable and token generation run without a confirmation | V8 | screens-settings-iam.md §0 |
| IAM | Update user grows 319 → 511 px and re-centres | O4 | screens-settings-iam.md §0 |
| AI | Small creates are drawers here and dialogs elsewhere; dialogs 480–1,024, drawers 432–1,224 | O2 O3 | screens-ai-infra-security.md §6 |
| AI | Validation in four places; Prompt error below the fold | V6 | screens-ai-infra-security.md §6 |
| AI | Five column headers clipped under the sticky Actions column | D7 | screens-ai-infra-security.md §6 |
| AI, Security | Time range in four forms with five different defaults | F8 | screens-ai-infra-security.md §6 |
| Security | Raw "Request failed with status code 404"; solid red banner on Fleet | K6 | screens-ai-infra-security.md §6 |
| AutoObserve | Custom header with 24–30 px titles and a "← Back" text link | T2 | screens-ai-infra-security.md §6 |
| Copy | About 100 Title Case strings and uppercase labels | T5 | all screen surveys |
| Copy | New, Create and Add mixed for the same action | W2 | screens-settings-iam.md · screens-respond.md |

## Bugs found during the survey

1. **/streams/stream-explore renders a blank page.** `SearchBar.vue:106` calls `defineAsyncComponent` without importing it. Nothing links there any more.
1. **Stream detail drawer.** Its footer is cut off at 1440 × 900 (`schema.vue:70`), a tooltip's text is printed inside a table cell (`schema.vue:371-383`), and closing it with edits discards them silently.
1. **Import pipeline error.** Importing an exported realtime pipeline fails with "Source stream name is required" when the real cause is that the stream already has a pipeline (`ImportPipeline.vue:899-908`).
1. **Drop zones that don't accept drops** on every BaseImport page (`BaseImport.vue:127-134`) and on the General logo upload.
1. **Enter saves the whole panel** from the add-panel title field; **Enter submits** the function form from its name field.
1. **Logs state loss.** After a rail round trip the URL is cut to `?period=…`; reloading it loses the stream and query and shows "Past 15 Minutes" although the URL says 6h.
1. **Logs Visualize** leaves its aggregate SQL behind, so Patterns finds nothing afterwards.
1. **A toast capitalises user-given names**: "Uxinv-obs view view applied successfully."
1. **The pipelines list's draft dot** is clipped and invisible for long names.
1. **Synthetics.** In-app links redirect to Home, and the list shows its first-run state on a 404.
1. **Escalation policies** says "No on-call teams yet" after the load failed; **External alert sources** blames the user's role for a disabled feature.
1. **Hidden settings routes** (Telephony, Slack, Synthetics locations) render an error, a blank page and a redirect with a stray toast.
1. **Session detail** drops the AI side rail; **MITRE** shows "…Enterprise v, …" with an empty interpolation.
1. **Deleting an in-use function** fails only after you confirm, with an error toast.
1. **Product analytics "Create named event"** shows a spinner that never ends.
