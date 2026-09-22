# Caching migration plan — On-call and DB monitoring (2026-09-18)

Detailed audit of the two modules that have no TanStack Query caching, with the concrete
declarations, tiers, invalidation map and per-file changes needed to implement it. Every
`file:line` was verified against the tree on branch `fix/caching-oncall` (merged main).

## Ground rules (same as every migrated module)

- Reads are `queryOptions()` in `services/<domain>.queries.ts`; keys live in
  `services/<domain>.querykeys.ts` and are rooted with `orgKey(org, …)` from
  `composables/query/keys.ts`. `<domain>Keys.all(org)` is the invalidation scope.
- Tiers from `composables/query/cachePolicy.ts`: `LIVE_STALE_TIME` 1 min,
  `MEDIUM_STALE_TIME` 5 min, `NORMAL_STALE_TIME` 1 h. **Never set `gcTime` or a
  `persister` on a declaration** — the client owns both.
- Writes are `mutationOptions()` with `meta.invalidates: [scope…]`; the client's
  MutationCache applies it. Hand-written "reload after save" calls become redundant.
- A user **Refresh forces every read on the view**:
  `invalidateQueries({ queryKey, exact: true, refetchType: "none" })` then `fetchQuery`.
  Mount, paging and filter changes read the cache. Never `{ ...opts, staleTime: 0 }`.
- Any window anchored on `Date.now()` is bucketed in the **key only** with
  `quantizeRange()` (`composables/query/queryClient.ts:188`); the request keeps the exact
  range. Filters go through `stableFilters()` (`:170`).
- Template to mirror: `services/synthetics.querykeys.ts` + `services/synthetics.queries.ts`.

---

# Part 1 — On-call

`services/oncall.ts` (944 lines): **31 GET reads + `previewRouting` (a POST-shaped read)
= 32 reads, 28 writes**, consumed by 20 files. No queries, no keys, no polling anywhere in
the module (the only timers in any consumer are incident/RCA ones in
`IncidentDetailDrawer.vue:1891,1894`). Everything is mount / watch / button driven, so
this is a clean migration.

## 1.1 Files to create

`services/oncall.querykeys.ts` — keys only, no transport import:

```ts
import { orgKey } from "@/composables/query/keys";
import { quantizeRange, stableFilters } from "@/composables/query/queryClient";

export const oncallKeys = {
  all: (org: string) => orgKey(org, "oncall"),

  // Teams and everything that belongs to one team sits under teams/<id>, so a
  // team-shaped write drops one prefix.
  teamsAll: (org: string) => orgKey(org, "oncall", "teams"),
  teams: (org: string) => orgKey(org, "oncall", "teams", "list"),
  team: (org: string, id: string) => orgKey(org, "oncall", "teams", id),
  teamOverview: (org: string, id: string) => orgKey(org, "oncall", "teams", id, "overview"),
  teamLoad: (org: string, id: string) => orgKey(org, "oncall", "teams", id, "load"),
  teamReachability: (org: string, id: string) => orgKey(org, "oncall", "teams", id, "reachability"),
  teamRisks: (org: string, id: string) => orgKey(org, "oncall", "teams", id, "risks"),
  members: (org: string, id: string) => orgKey(org, "oncall", "teams", id, "members"),
  schedule: (org: string, id: string) => orgKey(org, "oncall", "teams", id, "schedule"),
  resolvedSchedule: (org: string, id: string, from: number, to: number, rotation?: string) =>
    orgKey(org, "oncall", "teams", id, "resolved", quantizeRange(from, to), rotation ?? "primary"),
  whoIsOnCall: (org: string, id: string, at?: number) =>
    orgKey(org, "oncall", "teams", id, "who", at === undefined ? "now" : quantizeRange(at, at).start),
  policy: (org: string, id: string) => orgKey(org, "oncall", "teams", id, "policy"),
  escalationPreview: (org: string, id: string, priority?: number) =>
    orgKey(org, "oncall", "teams", id, "escalationPreview", priority ?? "default"),
  overrides: (org: string, id: string, from: number, to: number) =>
    orgKey(org, "oncall", "teams", id, "overrides", quantizeRange(from, to)),

  unavailability: (org: string, from: number, to: number) =>
    orgKey(org, "oncall", "unavailability", quantizeRange(from, to)),
  presets: (org: string) => orgKey(org, "oncall", "presets"),
  routingConfig: (org: string) => orgKey(org, "oncall", "routing", "config"),
  ownershipAll: (org: string) => orgKey(org, "oncall", "ownership"),
  ownershipRules: (org: string, teamId?: string) => orgKey(org, "oncall", "ownership", "rules", teamId ?? "all"),
  ownershipStats: (org: string, teamId?: string, days?: number) =>
    orgKey(org, "oncall", "ownership", "stats", teamId ?? "all", days ?? "default"),
  unrouted: (org: string, filters: Record<string, unknown>) =>
    orgKey(org, "oncall", "unrouted", stableFilters(filters)),
  coverageGaps: (org: string) => orgKey(org, "oncall", "coverageGaps", "now"),

  responsesAll: (org: string) => orgKey(org, "oncall", "responses"),
  responses: (org: string, filters: Record<string, unknown>) =>
    orgKey(org, "oncall", "responses", "list", stableFilters(filters)),
  response: (org: string, id: string) => orgKey(org, "oncall", "responses", id),
  responseProgress: (org: string, id: string) => orgKey(org, "oncall", "responses", id, "progress"),
  responseDeliveries: (org: string, id: string, limit?: number, offset?: number) =>
    orgKey(org, "oncall", "responses", id, "deliveries", limit ?? "default", offset ?? 0),
  responsePriorCauses: (org: string, id: string) => orgKey(org, "oncall", "responses", id, "priorCauses"),
  responseHistory: (org: string, id: string, limit?: number) =>
    orgKey(org, "oncall", "responses", id, "history", limit ?? "default"),
  responsesForIncident: (org: string, incidentId: string) =>
    orgKey(org, "oncall", "responses", "incident", incidentId),

  myAll: (org: string) => orgKey(org, "oncall", "my"),
  myOnCall: (org: string) => orgKey(org, "oncall", "my", "teams"),
  myDeliveries: (org: string, filters: Record<string, unknown>) =>
    orgKey(org, "oncall", "my", "deliveries", stableFilters(filters)),
};
```

`services/oncall.queries.ts` — one `queryOptions()` per read below, one `mutationOptions()`
per write in §1.3. Unwrap `.data` in every `queryFn` so consumers get the payload.

## 1.2 Reads — tier and key inputs

| Read fn (`oncall.ts`) | Consumers (file:line) | Tier | Key inputs / note |
|---|---|---|---|
| `listTeams` :66 | OnCallTeams.vue:407, OnCallTeamDetail.vue:642, OnCallPolicies.vue:286, OnCallRouting.vue:397, OnCallResponses.vue:1703, OnCallResponseDetail.vue:1178, **AlertList.vue:1076, IncidentDetailDrawer.vue:1633, alerts/steps/Advanced.vue:425** | **NORMAL 1 h** | `teams(org)`. Nine screens re-fetch the same catalogue today — the biggest single win. The three alert screens are the issue #2652 Defect 6 sites. |
| `getTeam` :69 | OnCallTeamDetail.vue:637, OnCallResponseDetail.vue:1037 | NORMAL | `team(org,id)` |
| `listMembers` :97 | OnCallTeamDetail.vue:638, OnCallPolicyEditor.vue:1080, OnCallResponseDetail.vue:1166 | NORMAL | `members(org,id)` |
| `listSchedulePresets` :131 | OnCallSchedulePresets.vue:420 | NORMAL | `presets(org)`; replaces the ad-hoc `if (isOpen && !presets.length)` guard at :407 |
| `getSchedule` :153 | OnCallTeamDetail.vue:639, OnCallResponses.vue:1766 | NORMAL | `schedule(org,id)`. **Never** for OnCallTeamForm.vue:462 — editor cold load, keep the direct call. |
| `whoIsOnCall` :174 | OnCallTeamDetail.vue:641, OnCallTeams.vue:435, OnCallPolicies.vue:260, OnCallResponses.vue:1747/1763, OnCallResponseDetail.vue:1268, OnCallPolicyEditor.vue:1097 | **LIVE 1 min** | `whoIsOnCall(org,id,at)`. `at` omitted = server now → key `"now"`. ResponseDetail passes `closed_at` (immutable) — fine on the same key. |
| `getPolicy` :188 | OnCallTeamDetail.vue:640, OnCallPolicies.vue:259, OnCallResponses.vue:1760, OnCallResponseDetail.vue:1273 | NORMAL | `policy(org,id)`. PolicyEditor receives it as a prop (RMW) — no fetch there. |
| `listResponses` :221 | OnCallResponses.vue:1616 (paged loop), OnCallTeamDetail.vue:708 | **LIVE** | `responses(org,{team_id,include_resolved,cause,subject_type,source_id,ownership_path,limit,offset})`. See §1.5 on the pagination loop. |
| `getResponse` :269 | OnCallResponseDetail.vue:1006, OnCallResponses.vue:1823 | LIVE | `response(org,id)` |
| `listOwnershipRules` :274 | OnCallResponses.vue:1705, OnCallTeamDetail.vue:675 | NORMAL | `ownershipRules(org,teamId?)` |
| `ownershipStats` :285 | OnCallRouting.vue:429, OnCallOwnership.vue:255 | **MEDIUM 5 min** | `ownershipStats(org,teamId?,days?)` — counts accrue from traffic |
| `getTeamChannel` :339 | OnCallPolicyEditor.vue:709 | **never** | read-modify-write: the draft is seeded from it (:713). Keep the direct call. |
| `listUnavailability` :362 | OnCallMembers.vue:365, OnCallScheduleEditor.vue:521 | MEDIUM | `unavailability(org,from,to)` — both callers anchor on `Date.now()`, so the key **must** quantize |
| `getRoutingConfig` :406 | only via `composables/useOnCallRoutingConfig.ts:50` | NORMAL | `routingConfig(org)`. **Delete the composable's hand-rolled cache** (`config`/`loadedFor`/`inFlight` at :38-61, `load`/`refresh`/`__resetOnCallRoutingConfig`) and expose a thin `useQuery` wrapper instead. |
| `listResponsesForIncident` :510 | IncidentDetailDrawer.vue:1611 | LIVE | `responsesForIncident(org,incidentId)` |
| `escalationProgress` :522 | OnCallResponseDetail.vue:1389, OnCallResponses.vue:1803 (fan-out) | LIVE | `responseProgress(org,id)`. Carries a countdown — see §1.5. |
| `priorCauses` :534 | OnCallResponseDetail.vue:1208 | NORMAL | `responsePriorCauses(org,id)` — historical, immutable per id |
| `responseHistory` :542 | OnCallResponseDetail.vue:1212 | NORMAL | `responseHistory(org,id,limit)` |
| `listDeliveries` :559 | OnCallResponseDetail.vue:1236 | LIVE | `responseDeliveries(org,id,limit,offset)` — receipts land after the page |
| `coverageGaps` :644 | OnCallResponses.vue:1704 (checklist) | LIVE | `coverageGaps(org)`. **Never** for OnCallTeams.vue:473 and OnCallDefaultTeamCard.vue:206 — both are explicit "checked fresh at save time" guards (comment at DefaultTeamCard :200-203). Keep those direct. |
| `unroutedSignals` :666 | OnCallRouting.vue:461, OnCallOwnership.vue:269 | LIVE | `unrouted(org,filters)` |
| `myOnCall` :708 | OnCallMine.vue:192 | LIVE | `myOnCall(org)` |
| `myDeliveries` :715 | OnCallMyDeliveries.vue:217 | LIVE | `myDeliveries(org,{unread_only,limit,…})` — drives the unread badge |
| `listOverrides` :796 | OnCallCoverList.vue:235 | MEDIUM | `overrides(org,id,from,to)` — calendar window, quantize |
| `analyticsCauses` :849 | **none** | — | dead code; skip (or delete) |
| `teamReachability` :872 | OnCallTeamDetail.vue:694, OnCallResponseDetail.vue:1274 | MEDIUM | `teamReachability(org,id)` |
| `teamConfigRisks` :879 | OnCallTeamDetail.vue:695 | MEDIUM | `teamRisks(org,id)` |
| `resolvedSchedule` :887 | OnCallTeamDetail.vue:820 (**one call per rotation**), OnCallMembers.vue:382, OnCallResponseDetail.vue:1301 | MEDIUM | `resolvedSchedule(org,id,from,to,rotation)` — two callers anchor on `Date.now()`, quantize |
| `teamOverview` :917 | OnCallTeamDetail.vue:693, OnCallRouting.vue:531 | LIVE | `teamOverview(org,id)` — carries `covered_now` |
| `escalationPreview` :924 | OnCallTeamDetail.vue:1111 | LIVE | `escalationPreview(org,id,priority)` — "who it would wake right now" |
| `teamLoad` :940 | OnCallTeamDetail.vue:696 | MEDIUM | `teamLoad(org,id)` |
| `previewRouting` :420 (POST body) | OnCallRouting.vue:501 (debounced keystroke), :685, OnCallOwnership.vue:216 | **never** | per-keystroke dry run; leave as a plain call |

**Reads that stay direct (5):** `getTeamChannel`, `previewRouting`, `getSchedule` in
OnCallTeamForm, `coverageGaps` in the two save-time guards. Add a one-line comment at each
saying why it is uncached.

## 1.3 Writes → what each mutation must invalidate

Scopes: `teamsAll` = every team's list + per-team data; `team(id)` = one team's prefix
(detail, overview, members, schedule, resolved, who, policy, preview, overrides, risks…);
`responsesAll`; `response(id)`; `ownershipAll`; `unrouted*` (use `orgKey(org,"oncall","unrouted")`);
`routingConfig`; `unavailability*`; `myAll`.

| Write fn (`oncall.ts`) | Consumers | `meta.invalidates` |
|---|---|---|
| `createTeam` :78 | OnCallTeamForm.vue:332 | `teamsAll`, `myAll`, `coverageGaps` |
| `updateTeam` :89 | OnCallTeamForm.vue:326 | `teamsAll` (list + the team's prefix; tz change moves `resolved`/`who`) |
| `deleteTeam` :95 | OnCallTeams.vue:453 | `all` — the team disappears from every scope |
| `addMembers` :111 / `removeMember` :125 | OnCallMembers.vue:734/759, OnCallTeamForm.vue:361 | `team(id)`, `coverageGaps`, `myAll` |
| `applySchedulePreset` :148 / `setSchedule` :167 | OnCallSchedulePresets.vue:890, OnCallScheduleEditor.vue:911, OnCallTeamForm.vue:385, OnCallTeamDetail.vue:880 | `team(id)`, `coverageGaps`, `myAll` |
| `setPolicy` :214 | OnCallPolicyEditor.vue:1141 | `team(id)` (policy, escalationPreview, overview, risks) |
| `createOwnershipRule` :309 / `updateOwnershipRule` :327 / `deleteOwnershipRule` :333 | OnCallRouting.vue:633/627/660, OnCallOwnership.vue:301/375/295/320 | `ownershipAll`, `unrouted*` — **today the delete paths (Routing:664, Ownership:324) do not re-read the unrouted queue; the mutation fixes that** |
| `setTeamChannel` :355 | OnCallPolicyEditor.vue:724 | `team(id)`; **keep** the local patch at :729-730 (the drawer reads it while open) — or convert it to `setQueryData` |
| `createUnavailability` :391 / `deleteUnavailability` :400 | OnCallMembers.vue:425/456 | `unavailability*`, `team(id)`, `coverageGaps`, `myAll` |
| `setRoutingConfig` :418 | OnCallTeams.vue:492, OnCallOwnership.vue:333, OnCallDefaultTeamCard.vue:230 | `routingConfig`, `unrouted*`, `teamsAll` (risks) |
| `acknowledgeResponse` :436 / `snoozeResponse` :451 / `handoffResponse` :485 / `resolveResponse` :503 / `escalateNow` :637 | OnCallResponses.vue (row + bulk), OnCallResponseDetail.vue | `responsesAll`, `myAll`, and for handoff/resolve also `teamsAll` (overview stats) |
| `addNote` :465 | OnCallResponses.vue:1840, OnCallResponseDetail.vue:1113 | `response(id)` |
| `confirmRecovery` :594 | OnCallResponseDetail.vue:680 | `responsesAll` — it also closes the **owner's** record (:580-584), a different id |
| `promoteResponse` :614 | OnCallResponseDetail.vue:732 | `responsesAll` + `incidentKeys.all(org)` (it creates an incident) |
| `dismissUnroutedSignal` :701 | OnCallRouting.vue:672, OnCallOwnership.vue:394 | `unrouted*` |
| `markDeliveriesRead` :757 | OnCallMyDeliveries.vue:248 | `myAll`; **keep** `setUnread(res.data.unread)` at :249 — the count rides on the write response |
| `createOverride` :791 / `deleteOverride` :827 | OnCallTeamDetail.vue:1000/1007/1076/1028, OnCallCoverList.vue:262 | `team(id)`, `coverageGaps`, `myAll` |
| `testPage` :842 | OnCallTeamDetail.vue:764, OnCallRouting.vue:702 | `myAll` + `responseDeliveries` — see §1.5, the delivery lands later |

## 1.4 Consumer changes, file by file

For each file: replace direct reads with the query (`useQuery` for `<script setup>`
components, `queryClient.fetchQuery` where a flow sequences reads), replace direct writes
with `useMutation(() => xMutation(org))`, and **delete the post-save reload** the mutation
now makes redundant. Refresh buttons keep working through the standard force pattern.

| File | Reads → queries | Writes → mutations | Delete (now redundant) | Keep |
|---|---|---|---|---|
| views/OnCall/OnCallTeams.vue | listTeams :407, whoIsOnCall fan-out :435 | deleteTeam :453, setRoutingConfig :492 | `fetchTeams()` at :455 and :540 (`onSaved`) | `coverageGaps` guard :473 direct; feature probe :416 |
| views/OnCall/OnCallTeamDetail.vue | getTeam :637, members :638, schedule :639, policy :640, who :641, listTeams :642, listOwnershipRules :675, overview :693, reachability :694, risks :695, load :696, listResponses :708, resolvedSchedule :820 (per rotation), escalationPreview :1111 | setSchedule :880, createOverride :1000/1007/1076, deleteOverride :1028, testPage :764 | `fetchAll()` at :1134/:1144, `fetchAll()+fetchSegments()` :1137-1139, `refreshCoverage()` :1015/:1086, `@changed="fetchAll"` :232 and `@changed="fetchSegments"` :289 | `refreshCoverage()` :1038 (failed-rollback path), `firstId = created.data?.id` :1005 (rollback handle), window watch :1170 (key change refetches), feature probe :659 |
| views/OnCall/OnCallResponses.vue | listResponses :1616 (see §1.5), getResponse :1823, listTeams :1703, coverageGaps :1704, listOwnershipRules :1705, who :1747/1763, policy :1760, schedule :1766, escalationProgress :1803 | ack :1398/1515, snooze :1416/1526, resolve :1436/1536, handoff :1458, addNote :1840 | `fetchResponses()` at :1404/:1423/:1442/:1471/:1506, `fetchExpandedEvents()` :1843 | `refreshAll()` :1851 as the **forced** refresh path; probe :1665 and the short-circuit :1853-1855; bulk = invalidate once after `allSettled` |
| views/OnCall/OnCallResponseDetail.vue | getResponse :1006, getTeam :1037, members :1166, listTeams :1178, priorCauses :1208, history :1212, deliveries :1236, who :1268, policy :1273, reachability :1274, resolvedSchedule :1301, escalationProgress :1389 | resolve :1051, ack :1072, snooze :1091, addNote :1113, handoff :1138, confirmRecovery :680, promote :732, escalateNow :1360 | the `fetchResponse()` cascade re-runs at :688/:745/:1058/:1077/:1097/:1120/:1150/:1365 | refetch on **409** from promote :752 (error path); route-param watch :1410 (key change refetches) |
| views/OnCall/OnCallPolicies.vue | listTeams :286, policy + who fan-out :258-261 | — | — | refresh button :78-83 → force |
| views/OnCall/OnCallRouting.vue | listTeams :397, ownershipStats :429, unrouted :461, teamOverview :531 | create/update/delete rule :633/627/660, dismiss :672, testPage :702 | `fetchRules()+fetchSignals()` :647, `fetchRules()` :664, `fetchSignals()` :676 | `previewRouting` :501/:685 direct; probe :400 |
| views/OnCall/OnCallMine.vue | myOnCall :192 | — | — | probe :196 |
| components/oncall/OnCallMembers.vue | listUnavailability :365, resolvedSchedule :382 | addMembers :734, removeMember :759, createUnavailability :425, deleteUnavailability :456 | `Promise.all([fetchAbsences(), fetchSegments()])` :436/:461; the `emit("changed")` at :439/:462/:741/:764 no longer needs a loader behind it | teamId watch :774 (key change) |
| components/oncall/OnCallCoverList.vue | listOverrides :235 | deleteOverride :262 | `fetchCovers()` :269, `emit("changed")` :272 loader | `defineExpose({refresh})` :292 as force |
| components/oncall/OnCallOwnership.vue | ownershipStats :255, unrouted :269 | create/update/delete rule :301/375/295/320, setRoutingConfig :333, dismiss :394 | `Promise.all([fetchRules(), fetchSignals()])` :307/:389, `fetchRules()` :324, `fetchSignals()` :398 | `previewRouting` :216 direct |
| components/oncall/OnCallPolicyEditor.vue | members :1080, who :1097 (+ destinations, routingConfig — already-cached queries) | setPolicy :1141, setTeamChannel :724 | the 5-read refetch on every `props.open` flip (:1020-1039) collapses to cache reads; `who` stays live via its 1-min tier | `getTeamChannel` :709 direct (RMW); local patch :729-730 |
| components/oncall/OnCallScheduleEditor.vue | listUnavailability :521 | setSchedule :911 | loader behind `emit("saved")` :925 | draft resets :919-924 |
| components/oncall/OnCallSchedulePresets.vue | listSchedulePresets :420 | applySchedulePreset :890 | the `!presets.length` guard :407; loader behind `emit("applied")` :897 | dialog resets :896 |
| components/oncall/OnCallTeamForm.vue | — | createTeam :332, updateTeam :326, addMembers :361, setSchedule :385 | loader behind `emit("saved")` :339 | `getSchedule` :462 direct (editor cold load) |
| components/oncall/OnCallDefaultTeamCard.vue | routingConfig (via composable) | setRoutingConfig :230 | `refreshRoutingConfig()` :236 | `coverageGaps` guard :206 direct |
| components/oncall/OnCallMyDeliveries.vue | myDeliveries :217 | markDeliveriesRead :248 | `fetchDeliveries()` :250 | `setUnread(res.data.unread)` :249 |
| composables/useOnCallRoutingConfig.ts | getRoutingConfig :50 | — | the whole module cache :38-84 (`config`, `loadedFor`, `inFlight`, `load`, `refresh`, `__resetOnCallRoutingConfig`) | export shape `{ config, loading }` for the 4 callers, now backed by `useQuery` |
| components/alerts/AlertList.vue :1076, IncidentDetailDrawer.vue :1633, alerts/steps/Advanced.vue :425 | listTeams | — | — | these three are the #2652 Defect 6 sites; `queryClient.fetchQuery(oncallTeamsQuery(org))` |
| components/alerts/IncidentDetailDrawer.vue :1611 | listResponsesForIncident | — | — | — |

## 1.5 Special cases to handle explicitly

1. **Feature probe.** `listTeams`/`listResponses` double as the "is on-call available" probe
   via `isOnCallUnavailable()` (`utils/oncall.ts:1369`: 404, or 403 with "not supported").
   The client never retries 400/401/403/404/501 (`queryClient.ts:108`), so a query does not
   turn that into a retry storm — but the probe must keep reading `error.value` from the
   query, and the Responses short-circuit at :1853-1855 must keep skipping the later reads.
2. **Pagination loop.** `OnCallResponses.vue:1613-1638` walks up to `MAX_PAGES` pages of
   200 inside one "read". Simplest faithful port: one `queryOptions` whose `queryFn` runs
   the same loop and returns the concatenated rows, keyed on the filters (not on offset).
   `useInfiniteQuery` is the alternative if paging becomes user-driven later.
3. **Delayed effects — one invalidate at success is not enough:**
   - `snoozeResponse`: the ladder resumes when the snooze lapses with no client action.
     `responsesAll` on the 1-min tier covers it; the detail page can also re-read at
     `snoozed_until`.
   - `escalationProgress` carries a countdown (`OnCallResponses.vue:1793-1816`,
     `OnCallResponseDetail.vue:1387-1397`) that expires client-side while the entry is
     still fresh. Re-read (force) when the countdown fires.
   - `testPage` sends real pages; rows appear in `listDeliveries`/`myDeliveries`
     asynchronously. Invalidate at success **and** on the next panel open.
   - `confirmRecovery` changes the owner's record (another id): invalidate `responsesAll`,
     not just `response(id)`.
   - `promoteResponse` creates an incident: invalidate `incidentKeys.all(org)` too.
   - **Bulk row actions** (`OnCallResponses.vue:1396-1464`) fire N calls via
     `Promise.allSettled`: invalidate **once after the batch settles**, not per call.
   - Schedule-shaped data (`whoIsOnCall`, `resolvedSchedule`, `coverageGaps`) changes at
     the next handover with no write at all — that is why they sit on LIVE/MEDIUM, not NORMAL.
4. **N+1 fan-outs the cache collapses for free:** per-team `policy`+`who`+`schedule` in
   OnCallResponses :1756-1768, per-team `policy`+`who` in OnCallPolicies :258-261, per-team
   `who` in OnCallTeams :429-441, per-rotation `resolvedSchedule` in OnCallTeamDetail
   :818-828. Identical keys share one in-flight request.
5. **Dead code:** `analyticsCauses` (:849) has no consumer — do not declare it.

## 1.6 Suggested order

1. Keys + `oncallTeamsQuery` + `routingConfigQuery`; migrate `useOnCallRoutingConfig.ts`
   and the three alert-screen callers. Closes issue #2652 Defect 6 on its own.
2. Team pages: OnCallTeams, OnCallTeamDetail, OnCallPolicies + the team components
   (members, cover list, schedule editor, presets, policy editor, team form) with the
   team-scoped mutations.
3. Responses: OnCallResponses, OnCallResponseDetail, IncidentDetailDrawer + response
   mutations, including the delayed-effect handling in §1.5.
4. Routing/ownership/unrouted: OnCallRouting, OnCallOwnership, DefaultTeamCard.
5. My on-call / my deliveries.

## 1.7 Verification

- Specs, per migrated screen: revisit → **0** requests; Refresh → **1**; read after a
  write → **1**; `vi.spyOn(queryClient, "invalidateQueries")` called with the mutation's
  scopes. Assert the bulk path invalidates once.
- Feature-probe spec: a 404 from `listTeams` renders the unavailable state and issues no
  retry.
- UI: warm `oncallTeamsQuery`, then open Alerts → the alert list, the incident drawer and
  the destination form must send no `GET /oncall/teams`. Open Teams → Policies → Routing
  in sequence: one `/oncall/teams` in total.

---

# Part 2 — DB monitoring

`services/db_monitoring.ts` has 17 GET reads and no queries. **Only two are cacheable**;
both already run on hand-written module caches that the migration deletes.

## 2.1 The 15 that stay uncached

Window-scoped searches or live state — every one sends `start_time`/`end_time` and the
list pages re-pin the anchor on every load (`useDbmListPage.ts:186` → `scope.refresh()`;
`DbmShell.vue:170` `end = Date.now() * 1000`):
`getDatabases` :1150, `getQueries` :1168, `getSamples` :1195, `getQueryHistory` :1212,
`getQueryEndpoints` :1232, `getQueryInsights` :1258, `getServerQueries` :1330,
`getDeadlocks` :1371, `getActivity` :1392 (live sessions), `getBlocking` :1407 (live locks),
`getTableHealth` :1427, `getInstanceMetrics` :1497.
**Dead, delete instead:** `getQueryPlans` :1281, `getQueryServerMetrics` :1304,
`getServerSamples` :1356 — no non-spec caller (`SamplesPage.vue:593` records the removal).

## 2.2 Tab counts — `getBadges` via `composables/dbm/useDbmTabCounts.ts`

**Today.** Module `settled`/`inFlight` Maps (:525-526), key `dbmTabCountsKey(org, range,
filters)` (:269-279) = org + a **range tag** (`abs|start|end` for absolute, `rel|1h` for
relative) + five filters in fixed order (`DBM_COUNT_FILTER_KEYS` :247). The resolved
window is passed to the fetch but deliberately **not** to the key (:101-106), because the
list pages re-pin the anchor on every load. `force` (:534-537) skips `settled` but still
joins an in-flight request (:646). `clearDbmTabCounts()` (:529-532) exists for specs only.
Consumers: `DbmShell.vue:120` destructures `{ counts, load, publishOwnCount }` and provides
them (:222); the only force caller is `useDbmListPage.ts:225`.

**The "no TTL" argument (:92-99)** — "the same window over the same org with the same
filters is the same question, so it has the same answer" — is **true for absolute ranges**
(a closed past window is immutable) and **false for relative ones**: the key is `rel|1h`,
which does not move with the clock, so the cached number describes an ever-older hour
until a force or a filter change. A bounded `staleTime` is exactly the fix.

**Tier decision (to agree before implementing):** relative range → **LIVE 1 min**;
absolute range → **NORMAL 1 h**. 1 min still collapses all seven tab visits into one
`/badges` call, which is what the existing specs assert.

**Declarations:**

```ts
// services/db_monitoring.querykeys.ts
export const dbMonitoringKeys = {
  all: (org: string) => orgKey(org, "db_monitoring"),
  // The chosen range, not the resolved bounds — the list pages re-pin the anchor on every load.
  badges: (org: string, range: DbmRange, filters: DbmCountFilters) =>
    orgKey(org, "db_monitoring", "badges",
      range.type === "absolute"
        ? { abs: quantizeRange(range.startTime, range.endTime) }
        : { rel: range.relativeTimePeriod ?? "" },
      stableFilters({ ...filters })),
  instances: (org: string, startTime: number, endTime: number) =>
    orgKey(org, "db_monitoring", "instances", quantizeRange(startTime, endTime)),
};

// services/db_monitoring.queries.ts
export const dbmBadgesQuery = (org: string, range: DbmRange, window: DbmCountWindow, filters: DbmCountFilters) =>
  queryOptions({
    queryKey: dbMonitoringKeys.badges(org, range, filters),
    queryFn: () => fetchDbmTabCounts(org, window, filters),   // keep useDbmTabCounts.ts:299-447 as the fetcher
    staleTime: range.type === "absolute" ? NORMAL_STALE_TIME : LIVE_STALE_TIME,
    placeholderData: keepPreviousData,                        // preserves the no-blank contract
  });
```

**Delete** from `useDbmTabCounts.ts`: `settled`/`inFlight`/`clearDbmTabCounts` (:517-532),
the `latest` token (:575-583) and its checks (:623, :671, :701), the cache branch (:625-641),
the in-flight join and cleanup (:646-666), the `loading` ref (:573) → `isFetching`, and
`dbmTabCountsKey` (:269-279) → `dbMonitoringKeys.badges`.
**Keep:** `fetchDbmTabCounts` (:299-447), `carryForward` (:504-515), `publishedKey` /
`ownPublished` (:593-608), `publishOwnCount` (:724-740), `emptyDbmTabCounts` (:216-228).
**Move:** `worthKeeping` (:464-470) must become a `throw` inside the `queryFn` — an
all-`null` envelope is a *resolved* value and would otherwise be cached for `staleTime`.
`force` → the standard invalidate-then-fetch.

**Specs that must stay green:** `dbmTabCountsResilience.spec.ts` ("still serves the cache
when the whole scope is unchanged" → `getBadges` called once, :636-641; refetch on a
non-system filter change → 2 calls, :625-633; carry-forward and fallback cases) and
`dbmSectionTabCounts.spec.ts` ("issues exactly one request" :99-113; "no page re-fetches
the badges the shell already owns" :454-471; forced refresh :527-529). Replace
`clearDbmTabCounts()` in their `beforeEach` with `queryClient.clear()`.

## 2.3 Instance list — `getInstances` via `composables/dbm/useDbmFleetInstances.ts`

**Today.** `settled`/`inFlight` Maps (:60-61), key `dbmFleetKey(org, startTime, endTime)`
(:69-70) built from the **resolved microsecond bounds** — the module header (:50-52) claims
the chosen range, but the code uses the bounds. Those bounds come from `useDbmScope`
(:208-212) and are re-pinned on every `refresh()` (:254-257), so the key forks on every
refresh click. **No force path exists**; a failed read resolves `[]` and is not cached
(:100). Consumer: `useDbmScopeFilters.ts:273`, with a hand-derived key at :295 and a
`lastFleetKey` guard (:274, :296-297), called from inside the `fleetOptions` computed
(:308) because of a TDZ workaround (:275-291). Five pages supply the window
(`ActivityPage.vue:851`, `BlockedQueriesPage.vue:1045`, `DeadlocksPage.vue:1139`,
`MetricsPage.vue:381`, `TableHealthPage.vue:657`).

**Tier:** **MEDIUM 5 min** — an identity roster changes only when an engine starts or
stops reporting; the key **must** `quantizeRange()` the bounds or it never hits.

```ts
export const dbmInstancesQuery = (org: string, startTime: number, endTime: number) =>
  queryOptions({
    queryKey: dbMonitoringKeys.instances(org, startTime, endTime),
    queryFn: async () =>
      (await dbMonitoringService.getInstances(org, { startTime, endTime })).data?.hits ?? [],
    staleTime: MEDIUM_STALE_TIME,
  });
```

**Delete:** `useDbmFleetInstances.ts` :59-70 (maps, `clearDbmFleetInstances`,
`dbmFleetKey`) and :86-120 (`loadDbmFleetInstances`, `useDbmFleetInstances`) → a
`useQuery` with a computed key. Drop `.catch(() => [])` so a failure surfaces as `isError`.
In `useDbmScopeFilters.ts` delete `lastFleetKey` (:274), `refreshFleet` (:292-299) and the
side-effecting call at :308 — a reactive key removes the TDZ workaround; `fleetOptions`
(:307-318) reads `query.data.value`.

**Specs:** none cover `/instances` today (`useDbmScopeFilters.spec.ts` never mocks it) —
add a request-count test: same window twice → 1 call; refresh → 2.

## 2.4 Verification

- The two spec files above green with `queryClient.clear()` replacing both `clear*`
  helpers in the same `beforeEach` blocks (they are coupled only through the specs).
- UI: open Databases, switch through all tabs → one `/db_monitoring/badges`; click Refresh
  on a list page → one more; change a filter → one more; instance picker on two tabs →
  one `/db_monitoring/instances`.

---

## Checklist

- [x] `oncall.querykeys.ts`, `oncall.queries.ts`, 5 reads left direct with a comment
- [x] On-call consumers migrated; `useOnCallRoutingConfig.ts` cache deleted
- [x] Delayed-effect handling from §1.5; bulk actions invalidate once
- [x] Feature probe still renders the unavailable state with no retry
- [x] `db_monitoring.querykeys.ts` / `.queries.ts`; `/instances` migrated
- [x] Tab counts (`getBadges`): relative → LIVE 1 min, absolute → NORMAL 1 h (§2.2)
- [ ] Dead reads deleted: `analyticsCauses`, `getQueryPlans`, `getQueryServerMetrics`,
      `getServerSamples`. Deliberately NOT done: three of them still carry specs (and two
      specs assert their *absence* from a page), so deleting them is a separate cleanup
      with its own spec churn, unrelated to caching.
- [x] Specs: request counts, invalidation spies, probe; `vue-tsc --noEmit -p tsconfig.app.json --composite false` clean
- [x] Add both modules to the tier table in `.claude/skills/ui-architect/references/data-fetching.md`

### Two deviations from this plan, both deliberate

1. **The post-write reloads in §1.4's "Delete" column were kept.** That column assumed the
   consumers would move to `useQuery`, where an invalidation repaints the component. Every
   on-call screen instead kept its imperative shape — a ref filled by `fetchQuery`, which
   an invalidation expires but cannot repaint — because that is where each page's
   degradation rules live (a team whose rotation failed is left out of the map, a failed
   policy read leaves the row out entirely, a failed queue degrades one panel). Deleting
   the reload under that shape would have left stale rows on screen after every write.
   The reloads are all **unforced**, so each costs exactly one request: the mutation has
   already expired the entry by the time `mutateAsync` resolves.
2. **`useDbmFleetInstances` kept its imperative entry point** (`loadDbmFleetInstances`),
   so `useDbmScopeFilters`'s `lastFleetKey` guard and its call from inside `fleetOptions`
   stay. §2.3 proposed a `useQuery` with a computed key, but that key getter is evaluated
   during setup and reads `options.fleetWindow()`, which closes over refs the page declares
   in the same destructuring — the exact TDZ hazard the existing comment says was tried and
   reverted. Only the hand-rolled `settled`/`inFlight` maps were replaced by the cache.
