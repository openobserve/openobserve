# On-Call UI — task list (2026-08-19)

**Branch:** `feat/oncall-foundation`
**Sources:** `designs/incidents/v2-reevaluated/on-call-escalation/{API-FOR-UI.md,IMPLEMENTATION-STATUS.md}`
(both re-dated 2026-08-19) + a code sweep of `web/src/{components/oncall,views/OnCall,services/oncall.ts,ts/interfaces/oncall.ts,utils/oncall.ts}`.

**Supersedes** `web/ONCALL-UI-TASKS.md` (2026-08-14). Roughly half of that file's rows are now done —
this list only carries what is still open, plus what the two docs added since.

**Legend for the Verified column**
`✅ confirmed` — I reproduced it in the tree (grep/test) · `📄 doc-only` — the audit reports it,
I did not re-drive it in a browser · `❔ needs check` — plausible, verify before starting.

---

## 0. Headline

| | |
|---|---|
| **Endpoints** | ~65 live endpoints. **60 are in `services/oncall.ts`.** 5 have no client at all, 2 more have a client with **zero callers**, and 4 request payloads are missing fields the API accepts. |
| **Broken controls** | **2 confirmed P0s.** `Escalate` returns 415 everywhere; `Request cover → Save` fires no request at all. Both are "the user believes they acted". |
| **Wiring** | Every `@click` / `@submit` in on-call resolves to a real handler — no dead bindings. The four dead `ODialog` bindings from the 08-17 audit are **fixed**. |
| **UI standards** | Clean on the CI-enforced rules: **no** inline `style=`, **no** `<style>` blocks, **no** Quasar, **no** `var(--o2-*)`, **no** arbitrary `[..px]`, **no** retired `rounded-*`. `OPageLayout`→`OPageHeader` on all 6 views. Zero missing i18n keys (incl. every dynamic `t(\`oncall.x_${...}\`)` key). |
| **The font problem you noticed** | **182 raw `text-xs`/`text-sm` vs 73 `<OText>`.** Typography is the one place the component library is bypassed, and it is why sizes/weights read differently screen to screen. 7 files use `OText` **zero** times. |

---

## A. CRITICAL — a control exists and does not work

| # | Task | File | Verified |
|---|---|---|---|
| **A1** | **`Escalate` sends no body → server answers 415 on every screen.** `http().post(url)` with no payload and no `Content-Type`. Send `{}` as JSON. This one call backs the response-detail Escalate button, the ladder's `@escalate`, and the ReachAlarm banner — **manual escalation is unreachable product-wide.** IMPLEMENTATION-STATUS §7 now names this "the top release blocker". | [services/oncall.ts:629](src/services/oncall.ts#L629) | ✅ confirmed |
| **A2** | **`Request cover` → Save issues no request.** `makeOnCallCoverSchema` requires `start_at` + `end_at` (numbers); the form only ever renders `OFormDateTimeRange name="window"`. Zod fails on two keys with no rendered control, so nothing surfaces and `@submit` never fires. Fix: validate `window: {from,to}` in the schema and map to the pair in `onSubmit` (which already does the mapping). The **swap** tab bypasses the form and works, which is why this survived. | [OnCallCoverForm.schema.ts:19-21](src/components/oncall/OnCallCoverForm.schema.ts#L19) vs [OnCallCoverForm.vue:132](src/components/oncall/OnCallCoverForm.vue#L132) | ✅ confirmed — I ran the schema against the form's real value shape and it rejects it |
| **A3** | **Add a submit test to `OnCallCoverForm.spec.ts`.** The spec stubs `OForm` entirely, so validation is never exercised — that is exactly why A2 shipped. Assert `save` is emitted with `start_at`/`end_at` from a real `OForm`. | [OnCallCoverForm.spec.ts:48](src/components/oncall/OnCallCoverForm.spec.ts#L48) | ✅ confirmed |

---

## B. Endpoint coverage — what the API has and the UI does not call

### B.1 No client at all

| # | Endpoint | Decision | Verified |
|---|---|---|---|
| **B1** | `GET /oncall/my/deliveries` + `POST /oncall/my/deliveries/read` | **Build.** "Did my pages actually reach me" has no surface; returns `total:19, unread:19` on the audit instance. Needs a service method + a screen (personal inbox, or a tab on the redirected `/oncall/me`). | ✅ confirmed — string appears nowhere in `web/` |
| **B2** | `GET\|PUT\|DELETE /oncall/contacts/{email}` | **Do not build.** Deferred by decision 2026-08-19 (API-FOR-UI §L.0, IMPLEMENTATION-STATUS §7). A person's address is their login. | 📄 doc decision |
| **B3** | `GET\|POST /api/v2/{org}/oncall/ack` | **No UI needed** — server-rendered confirm page for the emailed link. Backend note: an *expired* link renders raw JSON instead of the HTML page. Raise with backend, do not build around it. | 📄 doc-only |

### B.2 Client exists, zero callers

| # | Item | Task | Verified |
|---|---|---|---|
| **B4** | `oncallService.myOnCall` → `GET /oncall/my/teams` | Never called. The same fact is currently derived from one `/teams/{id}/on-call` per team (11 calls on the audit org). Use it in `OnCallResponses.vue` (`myShift`) and drop the fan-out. | ✅ confirmed |
| **B5** | `oncallService.listOverrides` → `GET .../overrides` | Never called. See D3. | ✅ confirmed |

### B.3 Request payloads missing fields the API accepts

| # | Item | Task | Verified |
|---|---|---|---|
| **B6** | `setSchedule` / `Rotation` type | `Rotation` models `slot`, `secondary_offset`, `priority`, `restrictions` — but **not `starts_at`, `ends_at`, `secondary_slot`, `source`.** Add all four to the TS type and to `PUT .../schedule`. Knock-ons in C2, D2, D4. | ✅ confirmed |
| **B7** | `setPolicy` | Accepts `final_action` but **not `repeat_count`.** Add it, and surface both (D5). | ✅ confirmed |
| **B8** | `listResponses` | Supports `team_id`, `include_resolved`, `limit`, `offset`. The API also validates **`cause`, `subject_type` + `source_id`, `ownership_path`** — no param, no control. | ✅ confirmed |
| **B9** | `listResponses` — `team_id` is never sent | The team filter in the triage list filters **client-side** over the ≤600 rows already loaded, so it silently misses anything past the cap. Pass `team_id` and refetch. | ✅ confirmed — [OnCallResponses.vue:1010](src/views/OnCall/OnCallResponses.vue#L1010) |

### B.4 Wrong endpoint chosen

| # | Item | Task | Verified |
|---|---|---|---|
| **B10** | Routing dimension picker | `OnCallRouting.vue` populates the attribute list from `alerts/deduplication/semantic-groups` — the **full 61-entry catalogue**. `GET /service_streams/_analytics` returns the ~7 that actually exist, with cardinality, `recommended_priority_dimensions` and `sample_values`. Already in `services/service_streams.ts:240`, unused by on-call. This is the core of the §J rebuild (D9). | ✅ confirmed — [OnCallRouting.vue:506](src/views/OnCall/OnCallRouting.vue#L506) |

---

## C. Contract drift — the UI and the backend now disagree

| # | Task | Verified |
|---|---|---|
| **C1** | **`secondary_offset` doc comment is stale.** `ts/interfaces/oncall.ts` says *"Absent means derived — `max(1, len/2)`"*. Per API-FOR-UI §0.1 #11 (2026-08-18) the default is now **`1`** — the derived secondary is the person who takes over next, so the calendar's "Next" and the ladder's 2nd rung are the same person. Fix the comment **and** check nothing renders both as different people. | ✅ confirmed |
| **C2** | **`secondary_slot` / `source` survive the create-team round-trip only by accident.** `amendStaffedRotations` does the right read-back-merge and `{...rotation}` carries unknown keys through at runtime — but they are absent from the TS type, so any future explicit-key rewrite silently drops them. Model them (B6). Also: **`source: "default"` should be cleared** on a human edit; it is currently carried through. | ✅ confirmed — [OnCallTeamForm.vue:348](src/components/oncall/OnCallTeamForm.vue#L348) |
| **C3** | **Create-team applies one shift/anchor to *every* staffed rotation.** `amendStaffedRotations` maps `shift_micros`/`anchor_micros` over all rotations returned by the read-back. On a 2-slot team the secondary's own handover day (Thu 14:00) is overwritten with the primary's — collapsing the two slots onto one handover. Apply the form's values to the **default-slot** rotations only. | ✅ confirmed |
| **C4** | **`staffedSlots` reads only `rotation.slot`.** A *derived* secondary lives on `rotation.secondary_slot`, which is the common case since the backend auto-staffs it. Consequence: no secondary lane on the calendar, and the cover dialog's slot picker never appears (it is gated on `slotOptions.length > 1`). Depends on B6. | ✅ confirmed — [OnCallTeamDetail.vue:856](src/views/OnCall/OnCallTeamDetail.vue#L856) |

---

## D. Missing surfaces — backend has it, no screen reaches it

Ranked by what it costs a real team.

| # | Task | Endpoint | Verified |
|---|---|---|---|
| **D1** | **3 of 8 escalation targets cannot be picked.** `TARGET_KINDS` lists five; `on_call_in_slot`, `next_on_call_in_slot`, `everyone_in_slot` are in the TS union and in `utils/oncall.ts`'s renderer but **not in the picker**. Since 2026-08-18 every ≥2-person rotation has a secondary slot **no rung can page.** Needs the kind + a slot select in `OnCallPolicyEditor.vue`. **Highest-value item in this section.** | `PUT .../policy` | ✅ confirmed — [ts/interfaces/oncall.ts:48](src/ts/interfaces/oncall.ts#L48) |
| **D2** | **Covers cannot be deleted.** `deleteOverride` is called only as a *swap rollback*. From the UI a cover is permanent. | `DELETE .../overrides/{id}` | ✅ confirmed — [OnCallTeamDetail.vue:916](src/views/OnCall/OnCallTeamDetail.vue#L916) |
| **D3** | **Covers cannot be listed.** A cover shows only as a "· override" annotation on a calendar cell — no rows, no `reason`, no `covering_for`, no overlap stack. | `GET .../overrides` | ✅ confirmed |
| **D4** | **A layer cannot be retired.** `Rotation.ends_at` is never sent. Deleting is the only substitute and it discards exactly the history the field exists to keep. Depends on B6. | `PUT .../schedule` | ✅ confirmed |
| **D5** | **`repeat_count` / `final_action` are read-only.** The policy editor renders a *warning* that `notify_default_team` has no team nominated — for a value it cannot set. | `PUT .../policy` | ✅ confirmed |
| **D6** | **The incident/response card never names the rung.** `reached_rung_micros` (careful: `0` is a real value, test for `undefined`) and the `exhausted` event are in payloads the screen already fetches. `reached_rung_micros` appears in **no** `.vue` file. | already fetched | ✅ confirmed |
| **D7** | **Impacted rows are untagged in triage.** Each row carries `origin_response_id`; only the detail view uses it. Badge it in the list so "my team's page" is distinguishable from "somebody else's blast radius". | already fetched | ✅ confirmed |
| **D8** | **`Escalate`'s 200 body is discarded.** `escalated_to`, `chased`, `recipients[]`, `deduplicated` are all thrown away for a generic toast. Say who it reached. (Do after A1 — the call never succeeds today.) | already fetched | ✅ confirmed — [OnCallResponseDetail.vue:1224](src/views/OnCall/OnCallResponseDetail.vue#L1224) |
| **D9** | **Rebuild the Routing screens per API-FOR-UI §J.** Estate-first rows sorted by `PAGES 30d`, one-click `Claim` on the team screen, coverage %, `_analytics`-driven pickers, rename *Dimension*→*Attribute* and *Ownership rules*→*Service ownership*. Biggest item on this list; spec is self-contained and needs no backend work. Depends on B10. | §J.6 (all live) | 📄 doc-only, spec not started |

---

## E. Navigation, links and dead weight

| # | Task | Verified |
|---|---|---|
| **E1** | **`/oncall/policies` is an orphan route.** It is registered in `useEnterpriseRoutes.ts:259` but appears in **no** nav group and has **zero** inbound links anywhere in `web/src`. Decide: add a nav entry, link it from the team list, or delete the route + view. | ✅ confirmed |
| **E2** | **`OnCallLoadBalance.vue` is imported nowhere.** Wire it into the team page (it renders `/load` fairness) or delete it. | ✅ confirmed |
| **E3** | **Three components independently fetch the routing config** (`OnCallDefaultTeamCard`, `OnCallOwnership`, `OnCallPolicyEditor`). Hoist `default_team_id` to one source. | ✅ confirmed |
| **E4** | Verified clean: every `@click`/`@submit`/`@save`/`@update:open` in on-call resolves to a defined handler, and every `router.push` name (`onCallTeams`, `onCallTeamDetail`, `onCallResponses`, `onCallResponseDetail`, `onCallRouting`, `alertList`, `alertDetail`, `logs`) exists in the route table. `/oncall/me` correctly redirects to the Pages list with `mine=1`. **No task — do not regress.** | ✅ confirmed |

---

## F. UI standards / component-library conformance

### F.1 Already clean — do not regress

No inline `style=`, no `<style>` blocks, no `<q-*>` components, no `var(--o2-*)`, no Tailwind
arbitrary values, no retired `rounded-sm/md/lg/xl` (only `rounded-default` / `rounded-surface` /
`rounded-full`), no `useI18n` from `vue-i18n`, all six views on `OPageLayout` → `OPageHeader`,
zero missing i18n keys including every dynamically-built key. `npm run lint:design:strict` passes.

### F.2 Typography — this is the "different font style" you are seeing

| # | Task | Verified |
|---|---|---|
| **F1** | **Migrate raw text-size classes to `<OText variant>`.** `OText` fixes size + weight + colour + element per semantic variant (`page-title` / `section` / `panel-title` / `body` / `body-strong` / `label` / `meta` / `mono`). On-call currently writes **182** raw `text-xs`/`text-sm`/`text-lg` against **73** `<OText>`. Hand-rolled pairs like `text-sm font-medium` and `text-xs text-text-secondary` map to no variant at all, which is exactly why the same kind of label renders at two sizes on two screens. | ✅ confirmed |
| | **Worst first (raw count → OText count):** `OnCallPolicyEditor` 17→0 · `OnCallResponses` 11→0 · `OnCallMembers` 11→0 · `OnCallScheduleEditor` 10→5 · `OnCallRoutingSimulator` 10→2 · `OnCallResponseDetail` 9→3 · `OnCallL0Editor` 7→2 · `OnCallTimeline` 6→0 · `OnCallPriorCauses` 5→0 · `OnCallNowStrip` 4→0 · `OnCallFiringHistory` 4→0 | |
| **F2** | **Three bare `<button>` elements.** Two are legitimate full-width clickable rows/cards ([OnCallRecentPages.vue:63](src/components/oncall/OnCallRecentPages.vue#L63), [OnCallSchedulePresets.vue:27](src/components/oncall/OnCallSchedulePresets.vue#L27)) — confirm the library has no card/row primitive before keeping them. The third is a **remove-chip** inside a target tag ([OnCallPolicyEditor.vue:98](src/components/oncall/OnCallPolicyEditor.vue#L98)) and should be an `OTag` removable / `OButton` icon. | ✅ confirmed |
| **F3** | **Once F1 lands, add on-call to the strict design sweep.** `lint:design:strict` reported "20 files scanned" — it is diff-scoped, so it is not proof the whole `oncall/` tree is clean. | ✅ confirmed |

---

## G. Correctness — will be filed as a bug by somebody eventually

All 📄 doc-only from the 2026-08-18 browser audit; confirm before starting.

| # | Item |
|---|---|
| **G1** | Per-row ladder loads cover the **25 oldest** records only. |
| **G2** | `anchor_micros` is parsed in the **browser's** timezone under a label saying "the team's timezone". |
| **G3** | Absences show only the **earliest per person**, and the delete control disappears while they are on call. |
| **G4** | Policy `destinations` are hidden unless a rung has `webhook` ticked. |
| **G5** | Restrictions snap to 30-minute boundaries; rung delays come from a fixed six-value list. |
| **G6** | Where a member reads *Unreachable*, print `why_not` and link the org-user record. Done in `OnCallMembers` and `OnCallRoutingSimulator` — **check every other Unreachable render site.** |

---

## H. Ask the backend (not UI work)

| # | Item |
|---|---|
| **H1** | Preset control **"First shift begins"** is served as `duration_micros` — a length, not an instant. Either the label or the field is wrong; settle it in `preset_catalogue` before a screen commits to a reading. |
| **H2** | **Pick one vocabulary** (API-FOR-UI §0.4). Backend's position: either render `escalation-preview`'s strings everywhere and delete the `target_*` i18n keys, or send the enum and render `target_*` everywhere. `utils/oncall.ts:401-404` currently regex-matches the backend's English back into i18n keys — that is a bridge, not a decision, and it breaks the day a string changes. |
| **H3** | An **expired ack link** renders raw JSON in a mail client rather than the plain HTML page. |
| **H4** | `D-44` (open, by decision): an unknown `response_id` on a **mutation** returns 500 where the sibling GETs return 404. UI should not present 500 as "server broken" on those paths. |

---

## Suggested order

1. **A1, A2, A3** — two controls that lie to the user. Half a day.
2. **B6 → C1–C4, D1, D4** — the schedule/policy type gap. Everything about the secondary slot is
   downstream of `Rotation` being three fields short.
3. **D2, D3, D6, D7, D8, B9** — free or near-free; the data is already on the page.
4. **F1** — typography sweep, worst five files first.
5. **B1, B4, D5, B8** — real but self-contained new surfaces.
6. **D9 (§J routing rebuild)** — largest, spec is complete, no backend work.
7. **E1, E2, E3, F2, F3, G1–G6** — cleanup and correctness.
