# Frontend Caching (`feat/fe-caching`) — Manual UI Test Plan

Branch: `feat/fe-caching` · PR: [#13642](https://github.com/openobserve/openobserve/pull/13642)

Everything below is a **UI navigation path**, not a URL. Follow the clicks exactly as
written. Each module lists: **where to go**, **what to check**, **what to expect**.

---

## 0. Before you start

### 0.1 Setup

1. `cd web`
2. **`npm install`** — this is not optional. The branch adds `@tanstack/vue-query`,
   `@tanstack/query-persist-client-core` and `@tanstack/vue-query-devtools`. A
   `node_modules` from `main` does not have them and the app will not build.
3. `npm run dev`
4. Log in.

### 0.2 The three instruments you will use all day

| Instrument | How to open | What it tells you |
| --- | --- | --- |
| **Network tab** | DevTools → Network → filter `Fetch/XHR` | Whether a request actually went to the server. This is the primary signal. |
| **TanStack Query Devtools** | Bottom corner of the app (**dev builds only**) — click the floating logo | Every cache entry, its key, its state (`fresh` / `stale` / `fetching` / `inactive`) and its payload. Fastest way to prove a screen painted from cache. |
| **Application tab** | DevTools → Application | **Local Storage** → keys starting `o2q-` · **IndexedDB** → `o2Cache` (store `kv`) and `o2FieldValues` |

Every cache key starts `["org", "<your-org-id>", …]`. If you see a key that does not,
that is a bug — it opts out of the org-switch and logout purges.

### 0.3 The vocabulary used below

| Term | Meaning |
| --- | --- |
| **Cold read** | Nothing in cache. Skeleton shows, one request goes out. |
| **Warm revisit** | Cache has rows. Rows paint **instantly, with no skeleton**; a background request may follow. |
| **Fresh** | Inside the freshness window — a revisit issues **no request at all**. |
| **Stale** | Past the window — rows still paint instantly, then a background request refreshes them in place. |
| **Force** | The Refresh button / `r` key. Always reaches the server, **without** blanking the table. |

**Freshness windows in this build** (from `web/src/composables/query/cachePolicy.ts`):

| Window | Duration | Applies to |
| --- | --- | --- |
| Default | **30 seconds** | Most entity lists and detail reads |
| Config | **5 minutes** | Streams, folders, functions, destinations, templates, actions, regex patterns, org settings |
| Session | **forever** | `/config`, built-in regex patterns |
| Persisted-to-disk max age | **24 hours** | Anything in `localStorage` / `IndexedDB` |

> When a step says "wait past the window", use the table above to know whether that is
> 30 s or 5 min for the surface you are on.

---

## 1. The universal checklist — run this on EVERY cached list

Sections 2 onward name the surfaces. For each one, run these eight checks. They are the
same checks every time, so they are written out once here.

| # | Check | Steps | Expected |
| --- | --- | --- | --- |
| **C1** | Cold read | Hard-reload (Ctrl+Shift+R), navigate to the page | Skeleton appears, **exactly one** request in Network, rows render |
| **C2** | Warm revisit — fresh | Navigate away to another module, come straight back (within the freshness window) | Rows appear **instantly, no skeleton**, and **zero requests** in Network |
| **C3** | Warm revisit — stale | Navigate away, wait past the freshness window, come back | Rows appear **instantly, no skeleton**, then **one** background request; the table updates in place — it must never blank out |
| **C4** | Refresh button | Click the Refresh icon in the page header | **One** request goes out every single time (even inside the freshness window). Rows stay on screen throughout. The **spinner is on the button**, not a full-table skeleton |
| **C5** | `r` keyboard shortcut | Click on empty page area (not in an input), press **`r`** | Identical behaviour to C4 — one request, rows stay, button spins. *This was broken on 11 pages before this branch; it is the highest-value check in the list.* **Skip C5 on SLOs (§7), Synthetics (§11) and Workflows (§12)** — those three pages register no keyboard shortcuts at all, so `r` doing nothing there is expected, not a bug (§24 item 10) |
| **C6** | Create / Edit | Create or edit a row, save | You return to the list and the new/edited row is **already there**. You should **not** have to press Refresh |
| **C7** | Delete + navigate back | Delete a row → confirm → then navigate to another module and come **straight back** | The row is gone immediately **and is still gone on return**. A deleted row reappearing is the single most likely regression in this branch |
| **C8** | Filter/search survives refresh | Type a search term, then press Refresh (or `r`) | The search term and the filtered result set are **preserved**. The list must not reset to unfiltered |

---

## 2. App shell, session and organization

### 2.1 Login and app config

**UI path:** Sign out → Login screen → sign in

| Check | Expected |
| --- | --- |
| Log in, watch Network | `/config` is requested **once** |
| Navigate across five different modules | `/config` is **never** requested again — it is cached for the whole session |
| DevTools → Application → Local Storage | There is **no** `o2q-` key holding `/config`. It is memory-only **by design** (the payload carries the RUM client token) |

### 2.1a New-deploy detection (build version checker)

The stale-build detector reads `/config` through the same cache, so caching it too
aggressively would stop the "a new version is available" prompt from ever firing.

**UI path:** stay logged in while a new build is deployed to the same server

| Check | Steps | Expected |
| --- | --- | --- |
| **Stale-build prompt still fires** | With the app open, deploy/restart the server on a new build, then navigate around until a chunk fails to load | The "new version / please reload" handling still triggers. It must **not** be suppressed by the cached `/config` |
| Baseline is recorded | DevTools → Application → Local Storage → key `o2_initial_commit_hash` | Present and matching the running build |
| No re-check storm | Watch Network while triggering several chunk errors in a row | The config re-check is throttled (~5 min), not fired per error |
| After reloading onto the new build | Reload | `o2_initial_commit_hash` updates to the new commit and the prompt stops |

### 2.2 Organization switch — the most important cross-cutting test

**UI path:** Top navbar → Organization dropdown → pick a different organization

| Check | Expected |
| --- | --- |
| Before switching, note the `o2q-` keys in Local Storage for org A | They exist |
| Switch to org B, then re-inspect Local Storage | **Org A's `o2q-` keys are gone.** Org B's start appearing |
| Visit Streams, Dashboards, Alerts in org B | You see **org B's data only**. Never a row from org A |
| Switch back to org A within a couple of minutes and open a list you had open | Rows paint instantly from memory (the in-memory cache is deliberately kept across an org switch — only the on-disk copy is purged) |
| DevTools → Application → IndexedDB → `o2Cache` → `kv` | No entries left whose key contains org A's identifier |

### 2.3 Logout — nothing may survive

**UI path:** Top-right user avatar → **Sign Out**

| Check | Expected |
| --- | --- |
| Before logging out, confirm `o2q-*` keys exist in Local Storage and `o2Cache` / `o2FieldValues` have entries in IndexedDB | They do |
| Sign out, then inspect the Application tab again | **All** `o2q-*` localStorage keys gone; `o2Cache` and `o2FieldValues` emptied |
| Log in as a **different user** | No list anywhere shows the previous user's data, even for a flash |
| **Field-value residue after logout** (fixed — see §24 item 6) | As user A, expand a field on a stream in Logs. Sign out **without reloading the browser**. Log in as user B, who is restricted from that stream, in the **same org**, within 60 seconds. Type that field name → `=` in the Logs editor | User B must **not** be offered A's cached values — the logout purge now clears the in-memory field-value read cache as well as IndexedDB |

### 2.4 Reload persistence

**UI path:** Streams (or Dashboards → any folder) → press F5

| Check | Expected |
| --- | --- |
| Reload the page while sitting on Streams | The stream list paints from `localStorage` **before** any request completes, then revalidates in place |
| Reload while sitting on a Dashboard with panels | Panels restore their last results from IndexedDB **without re-running the queries** |

---

## 3. Streams

**UI path:** Left sidebar → **Streams**

Run **C1–C8**. Plus these:

| Check | Steps | Expected |
| --- | --- | --- |
| Pagination is warm | Go to page 1, then page 2, then back to page 1 | Page 1 returns with **no request**. Moving to page 2 the first time issues one request — and page 3 is quietly pre-fetched, so moving forward again is instant |
| Sort does not double-request | Click a column header to sort | **Exactly one** request — not two |
| Stream type tabs | Switch Logs → Metrics → Traces → back to Logs | Returning to a tab you have already loaded issues no request |
| **Delete a stream (the key one)** | Delete a stream → confirm → navigate to Dashboards → come back to Streams | The deleted stream is **gone and stays gone**, including on page 2 and under a search filter. It must not flash back |
| Deleted stream leaves dropdowns | After deleting, open Logs → stream selector; open Alerts → New Alert → stream dropdown | The deleted stream is **not** offered |
| Refresh stats button | Streams → **Refresh Stats** button | Issues a request; the table keeps its rows |

**Storage note:** the stream *name list* (used by every stream dropdown in the app) is
persisted to `localStorage`. On an org with a very large number of streams this can hit
the browser's ~5 MB storage budget — the app swallows that silently and simply stops
persisting. Not a crash, but if reload-persistence stops working on a huge org, this is why.

---

## 4. Logs

**UI path:** Left sidebar → **Logs**

> The log **search itself is deliberately NOT cached** — see §17. What is cached here is
> the surrounding furniture.

| Surface | UI path | Check | Expected |
| --- | --- | --- | --- |
| Saved views | Logs → **Saved Views** dropdown in the search bar | Open, close, reopen | Second open issues no request |
| Saved views write-through | Save a new view → reopen the dropdown | The new view is listed without a manual refresh |
| Functions in the search bar | Logs → **Functions** dropdown | Open it, then go to Pipelines → Functions and back | The list is shared — one cache entry, not two requests |
| SQL editor function catalogue | Logs → switch to **SQL mode** → start typing in the editor | The query-function autocomplete catalogue is config-tier: requested once per **5-minute window**, not on every keystroke or editor open (a revalidate after the window is expected) |
| Missing catalogue is remembered | On a backend that returns nothing for the catalogue | It is asked **once** and the empty answer is cached — not re-asked repeatedly |
| Actions menu | Logs → **Actions** menu (enterprise) | Open on Logs, then again after navigating away and back | Second open issues no request |
| Field value autocomplete | Logs → click into the query editor → type a field name → `=` → wait for value suggestions | Values are served from IndexedDB `o2FieldValues` on the second attempt for the same field |
| Field values purge | Switch org, then check IndexedDB `o2FieldValues` | Previous org's entries are gone |

### 4.1 Field-value autocomplete cache — **not Logs-only**

**UI path:** six entry points across five pages — each row of the first table below is one.

This cache has **two writers** (expanding a field in the sidebar, and Run Query results)
and is reachable from **six entry points across five pages**. Values are stored under
`org | streamType | streamName | field`, so a value captured on one page is offered on
every other page for the same stream. It is a **two-layer** cache: an in-memory read cache
(1-minute TTL, 500-entry cap) in front of IndexedDB `o2FieldValues`.

Test each surface below at least once — a value captured on one should be offered on the others.

| Surface | UI path | Expected |
| --- | --- | --- |
| **Logs sidebar** | Logs → left field sidebar → click a field to expand it | Values load; expanding the same field again is instant (in-memory hit, no request) |
| **Logs Run Query** | Logs → run a query with results | Values are harvested from the result hits in the background — check `o2FieldValues` grows. This must have **no visible effect on rendering** (writes are scheduled on idle) |
| **Traces sidebar** | Traces → left field sidebar → expand a field | Same behaviour as Logs. Values captured here are shared with the other surfaces |
| **Pipelines** | Pipelines → open a pipeline → a node's field/condition value input | Suggestions offered from the shared cache |
| **Dashboard panel builder** | Dashboards → open a dashboard → Add Panel → add a filter → open its value dropdown | Suggestions offered from the shared cache |
| **PromQL suggestions** | Metrics → PromQL editor → start typing a label value | Suggestions offered from the shared cache |

| Cross-cutting check | Steps | Expected |
| --- | --- | --- |
| Values are shared across surfaces | Expand field `X` on a stream in **Logs**, then open the **dashboard panel filter** for the same stream and field | Values are offered **with no request** — same cache entry |
| Second read is instant | Expand a field, collapse it, expand it again within a minute | Served from the in-memory layer — no IndexedDB read, no request |
| Cold stream has no values | Pick a stream nobody has searched or expanded yet | Empty suggestions is **correct** — that is a cold cache, not a bug |
| Org switch purges them | Switch org → check IndexedDB `o2FieldValues` | Previous org's entries gone |
| Private browsing | Repeat in a private window | Suggestions still work in-session; nothing persists; no console error |

---

## 4A. Metrics Explorer

**UI path:** Left sidebar → **Metrics**

> The metrics **query itself is not cached** (§17). But the **Metrics Explorer grid cards
> use the same IndexedDB panel-result cache the Dashboards page uses** — so this page does
> need testing, not just the negative check.

| Check | Steps | Expected |
| --- | --- | --- |
| **Explorer cards restore their results** | Metrics → let the explorer grid cards render → navigate to Streams → come back to Metrics | The cards **repaint their previous results immediately** rather than re-running every query |
| Cards restore across reload | Let the cards render → press F5 | Restored from IndexedDB |
| Verify the storage | DevTools → Application → IndexedDB → `o2Cache` → `kv` | Entries exist for the explorer cards. Console shows **no `DataCloneError`** |
| Changing the selection is a clean miss | Change the metric / time window, then change it back | A different selection fetches fresh; returning to the previous one is a cache hit |
| Refresh button | Metrics → Refresh | Reaches the server; the cards keep their content while it runs |
| Purged on org switch | Switch org → check `o2Cache` | Previous org's explorer entries gone |

---

## 5. Dashboards

### 5.1 Dashboard list and folders

**UI path:** Left sidebar → **Dashboards**

Run **C1–C8**. Plus:

| Check | Steps | Expected |
| --- | --- | --- |
| Folder switching | Dashboards → click folder A → folder B → back to folder A | Folder A returns instantly with no request |
| Folder list | Reload the page on Dashboards | The folder rail paints from `localStorage` before the request lands |
| **Refresh button actually refreshes** | Dashboards → Refresh icon | One request, every time. *This was a no-op before this branch* |
| **`r` shortcut** | Dashboards list → press `r` | One request. *Also previously a no-op* |
| **Delete a dashboard** | Dashboards → folder → delete a dashboard → confirm → go to Streams → come back to Dashboards | Deleted dashboard is gone **and stays gone**. *This was a shipped bug: it used to come back on the next visit* |
| Create a dashboard | Dashboards → **New Dashboard** → save | You land on the new dashboard; going back to the list shows it without a manual refresh |
| Move a dashboard between folders | Move a dashboard to another folder, then open both folders | Source folder no longer lists it; destination folder does |
| Favourites | Star a dashboard → reload the page | The star survives the reload (favourites are persisted per user) |
| Home dashboard | Settings → set a home dashboard → go to Home | Applied; changing it updates Home without a reload |

### 5.2 Dashboard panels — the IndexedDB result cache

**UI path:** Dashboards → open a folder → open a dashboard → (panels render)

| Check | Steps | Expected |
| --- | --- | --- |
| **Panel results survive a revisit** | Open a dashboard, let panels render → navigate to Streams → come back to the dashboard | Panels **restore their previous results immediately and fire NO queries**. This is by design — a restored panel does not revalidate |
| Panel results survive reload | Open a dashboard, let panels render → press F5 | Panels restore from IndexedDB, no queries re-run |
| **Panel cache is really written** | DevTools → Application → IndexedDB → `o2Cache` → `kv` | Entries whose key contains `panels` and your folder/dashboard/panel ids. **The store must not be empty** — before this branch every write threw `DataCloneError` and the cache stayed empty. Also check the Console: **no `DataCloneError`** |
| Changing the time range refetches | Open a dashboard → change the time range → change it back | **Every** time-range change re-runs the panel queries, including the return — same as main. The cache keeps ONE entry per panel+variables (the last run); only a mount/reload restores it, tolerating a different span with the "cached data differs" badge |
| Variables fork the cache entries | Change a dashboard variable, then change it back | Each variable combination has its own stored entry, but changing back still re-runs the queries (restore is mount-only, as above) |
| **Deleting a panel drops its cache** | Dashboards → open a dashboard → Edit → delete a panel → save → inspect IndexedDB `o2Cache` → `kv` | That panel's entries are **gone**, not left behind to age out |
| Manual cache clear still works | Console: `await window._o2_removeDashboardCache()` then reload the dashboard | All panels re-run their queries |
| Inspect the cache | Console: `await window._o2_getDashboardCache()` | Returns an object keyed by folder → dashboard → panel |

### 5.3 Add / edit panel

**UI path:** Dashboards → open a dashboard → **Add Panel** (or Edit on an existing panel)

| Check | Expected |
| --- | --- |
| Open Add Panel → the stream dropdown | Populated from the cached stream list, no fresh request if you were just on Streams |
| Save a panel, return to the dashboard | The new panel renders; other panels keep their cached results |

### 5.4 Annotations

**UI path:** Dashboards → open a dashboard → on a time-series panel, drag-select a range → **Add Annotation**

| Check | Expected |
| --- | --- |
| Add an annotation → close the dialog | The annotation appears on the panel without a manual reload |
| Edit / delete an annotation | The chart updates immediately |
| Reopen the dashboard | Annotations list is served from cache; one request at most |

### 5.5 Import dashboard

**UI path:** Dashboards → **Import**

| Check | Expected |
| --- | --- |
| Import a dashboard JSON → go back to the list | The imported dashboard is listed without a manual refresh |

### 5.6 Dashboard picker dropdown (used outside the Dashboards module)

**UI paths where the picker appears:** Reports → **New Report** → dashboard selector ·
Alerts → dashboard-linked flows · anywhere a "select a dashboard" dropdown is offered

| Check | Steps | Expected |
| --- | --- | --- |
| Picker reads from the shared cache | Open Dashboards → folder A, then open a form with the dashboard picker and select folder A | The dashboard list appears **with no request** — the picker and the Dashboards page share one cache entry |
| Picker refresh | If the picker has a refresh affordance, use it | Reaches the server; the option list stays populated meanwhile |
| Create a dashboard, then open the picker | | The new dashboard is offered without a manual refresh |
| Empty folder | Select a folder with no dashboards | The picker shows its empty state, not a permanent spinner |

---

## 6. Alerts

### 6.1 Alerts list

**UI path:** Left sidebar → **Alerts**

Run **C1–C8**. Plus:

| Check | Steps | Expected |
| --- | --- | --- |
| **Search survives refresh** | Alerts → type a name in the in-folder search → press Refresh (or `r`) | The search term **and** the filtered rows are preserved. *This was broken — refresh used to drop the search* |
| **Refresh button re-enables** | Click Refresh, wait for it to finish, click Refresh again | The button becomes clickable again after the first load. *It used to stay disabled* |
| Folder switching | Switch alert folders back and forth | Returning to a folder is instant |
| Alert type filter | Switch between alert types | Each filter combination caches separately |
| **Delete an alert** | Delete → confirm → navigate away → come back | Row gone and stays gone. Also open the deleted alert's detail if you have a link to it — it must **not** serve a cached copy |
| Enable / disable an alert | Toggle an alert | The row's state updates immediately, no manual refresh |

### 6.2 Alert create / edit

**UI path:** Alerts → **New Alert** (or click an existing alert → Edit)

| Check | Expected |
| --- | --- |
| Destination dropdown | Populated from cache — no request if you were recently on the Destinations page |
| Template dropdown | Same |
| Stream dropdown | Same, from the cached stream list |
| Create a **new destination** from inside the alert form | The new destination appears in the alert form's dropdown **immediately** |
| Save the alert → back on the list | The alert is there without a manual refresh |

### 6.3 Alert destinations

**UI path:** Left sidebar → **Alerts** → **Destinations** tab

Run **C1–C8** (note C5 `r` — this was one of the broken shortcuts).

| Check | Expected |
| --- | --- |
| Create a destination → the list | New row present without manual refresh |
| Delete a destination → navigate away → return | Gone and stays gone |
| Open **Alerts → New Alert** afterwards | The deleted destination is not offered |
| **Import a destination** — Alerts → Destinations → **Import** → paste/upload JSON → import | The imported destination is in the list **without a manual refresh**, and is offered in the alert form's dropdown |

> ⚠️ **Security check:** open DevTools → Application → Local Storage — there must be **no**
> `o2q-` entry for destinations. Destination payloads can carry webhook `Authorization`
> headers, PagerDuty routing keys and Opsgenie/ServiceNow credentials, so the list is
> cached in memory only (resolved — see §24 item 1).

### 6.4 Alert templates

**UI path:** Left sidebar → **Alerts** → **Templates** tab

Run **C1–C8** (including the `r` shortcut).

| Check | Expected |
| --- | --- |
| Create / edit / delete a template | List updates without a manual refresh; deleted template stays gone across navigation |
| Open a destination form afterwards | Template dropdown reflects the change |
| **Import a template** — Alerts → Templates → **Import** → paste/upload JSON → import | The imported template is in the list **without a manual refresh** |
| **Template preview panel** — Alerts → Templates → open a template → Preview | The destination list it needs comes from cache — no extra request if you were recently on the Destinations page |

### 6.5 Alert history / evaluation history

**UI paths:**
- Alerts → click an alert → **History** tab
- Alerts → **Alert History** page
- Alerts → open an alert → **Evaluation History** drawer

| Check | Expected |
| --- | --- |
| Open the same history from all three surfaces | They **share one cache entry** — the second and third do not re-request |
| Change the time range | Each range caches separately |
| Refresh button on each | One request each; rows stay on screen |
| Paginate | Paging forward is warm — the next page is pre-fetched |

### 6.6 Incidents

**UI path:** Left sidebar → **Alerts** → **Incidents**

Run **C1–C5**. Plus:

| Check | Expected |
| --- | --- |
| Switch status filters (Open / Acknowledged / Resolved) | Each status caches separately; going back to a status you already viewed is instant |
| Paginate | Page changes keep the table populated — no blank flash between pages |

### 6.7 External alert sources

**UI path:** Left sidebar → **Alerts** → **Sources**

Run **C1–C5** (this was one of the `r`-shortcut fixes).

### 6.8 Dependency graph

**UI path:** Alerts → select an alert → **Dependencies** (also reachable from Destinations and Templates when deleting an item that is in use)

| Check | Expected |
| --- | --- |
| Open the dependency view from the Alerts page, then from Destinations, then from Templates | All three share **one** cached read of the org's alert graph. You should see one request, not three |
| Delete something with dependencies | The impact dialog lists them; after deleting, the affected lists refresh |

### 6.9 Anomaly detection

**UI path:** Left sidebar → **Alerts** → anomaly alert entries

| Check | Expected |
| --- | --- |
| Open the anomaly config list, navigate away and back | Cached, no re-request within the window |
| Anomaly history | Cached per limit; refresh forces |

---

## 7. SLOs

**UI path:** Left sidebar → **SLOs**

Run **C1–C8**, **except C5** — this page registers no keyboard shortcuts, so `r` does nothing by design. The Refresh button (`slos-slolist-refresh`) still applies for C4.

| Check | Steps | Expected |
| --- | --- | --- |
| **Failed load surfaces an error** | With the backend stopped or the SLO endpoint failing, open SLOs | An **error state** is shown — *not* a silently empty table pretending there are no SLOs. *This was the bug fixed here* |
| Folder filter | Switch SLO folders | Each folder caches separately |
| Enable / disable an SLO | Toggle | Row updates in place, no full refetch flicker |
| Move SLOs between folders | Select rows → Move | Both source and destination folder lists correct afterwards |
| **Delete an SLO** | Delete → navigate away → return | Gone and stays gone |
| Open an SLO detail | Click a row, go back, click the same row | ⚠️ **A request on every open is EXPECTED — not a bug.** `sloDetailQuery` is declared but no page reads it (§24 item 8). Only the *list* is cached |

---

## 8. Reports

**UI path:** Left sidebar → **Reports**

Run **C1–C8**.

| Check | Steps | Expected |
| --- | --- | --- |
| **One request per refresh** | Open Network, clear it, click Refresh | **Exactly one** request. *It used to fire two* |
| **Search survives refresh** | Type a report name in search → press `r` | Search term and filtered rows preserved. *The `r` shortcut used to drop the search* |
| **Rows survive refresh** | Click Refresh while reading the table | Rows stay on screen; only the button spins. *It used to blank the table* |
| Folder and tab filters | Switch folders and the report tabs | Each combination caches separately |
| Create a report → back to list | Present without manual refresh |
| Open a report for editing, go back, reopen | ⚠️ **A request on every open is EXPECTED — not a bug.** `reportDetailQuery` is declared but unread (§24 item 8). Only the *list* is cached |
| Delete a report → navigate away → return | Gone and stays gone |

---

## 9. Pipelines

### 9.1 Pipelines list

**UI path:** Left sidebar → **Pipelines** → **Pipelines**

Run **C1–C8**.

| Check | Expected |
| --- | --- |
| Open a pipeline in the editor, go back, reopen the same one | ⚠️ **A request on every open is EXPECTED — not a bug.** `pipelineDetailQuery` is declared but unread (§24 item 8). Only the *list* is cached |
| Delete a pipeline → navigate away → return | Gone and stays gone |
| Import a pipeline | Appears in the list without a manual refresh |

### 9.2 Pipeline destinations

**UI path:** Left sidebar → **Pipelines** → **Destinations** (also **Settings → Pipeline Destinations**)

Run **C1–C8**, including the `r` shortcut.

| Check | Expected |
| --- | --- |
| Create a destination from inside the pipeline editor (a node's destination picker) | The new destination shows up in the picker immediately, and on the Destinations page |

### 9.3 Pipeline history

**UI path:** Pipelines → open a pipeline → **History**

| Check | Expected |
| --- | --- |
| Paginate | Table keeps its rows between pages; no blank flash |
| Refresh button | One request; rows stay |

---

## 10. Functions and Enrichment Tables

### 10.1 Functions

**UI path:** Left sidebar → **Pipelines** → **Functions**

Run **C1–C8**.

| Check | Steps | Expected |
| --- | --- | --- |
| **Second visit paints rows** | Open Functions → go to Streams → come back to Functions | Rows are there. *A shipped bug made the list render **empty** from the second visit onward with no request — this is the regression test for it* |
| **`r` shortcut** | Press `r` on the Functions list | One request goes out. *Previously a no-op* |
| Create a function → back to list | Present without manual refresh |
| Delete a function → navigate away → return | Gone and stays gone |
| Bulk-delete several functions | All selected rows gone; count updates; still gone after navigating away |
| Function appears in Logs | After creating one, open Logs → Functions dropdown | The new function is offered |
| Deep link | Open Functions via the "add"/"update" deep link | The dialog opens **once**, not twice (a cached paint followed by a fresh one must not re-trigger it) |

### 10.2 Enrichment tables — ⚠️ **needs an org that actually has enrichment tables**

**UI path:** Left sidebar → **Pipelines** → **Enrichment Tables**

> The author flagged this one as **not verified live** because the test backend had no
> enrichment tables. Please exercise it on an org that has some.

| Check | Steps | Expected |
| --- | --- | --- |
| Refresh keeps rows | With tables listed, click Refresh | Rows **stay on screen**; only the button spins. No skeleton, no page remount |
| Refresh reaches the server | Watch Network while clicking Refresh | One request |
| Page does not remount | Click Refresh and watch the page state | The page must **not** navigate to itself or reset its scroll and filters |
| Upload a new enrichment table | It appears in the list without a manual refresh |

---

## 11. Synthetics

**UI path:** Left sidebar → **Synthetics**

Run **C1–C8**, **except C5** — this page registers no keyboard shortcuts, so `r` does nothing by design. The Refresh button (`synthetic-monitoring-refresh-btn`) still applies for C4.

| Check | Steps | Expected |
| --- | --- | --- |
| Create a **Browser Test** | Synthetics → **Add** → Browser | Destination dropdown populated from cache; on save, the monitor is in the list without a manual refresh |
| Create a **Protocol Check** | Synthetics → **Add** → API/Protocol | Same |
| Edit a monitor, save, return to the list | The edit is reflected immediately (the whole synthetics scope is invalidated on save) |
| Open a monitor's detail, go back, reopen | ⚠️ **A request on every open is EXPECTED — not a bug.** `monitorDetailQuery` is declared but unread (§24 item 8). Only the *list* is cached |
| Monitor results / runs | Synthetics → open a monitor → **Results** → paginate | Table keeps rows between pages; refresh forces one request |
| Delete a monitor → navigate away → return | Gone and stays gone |
| Folder filter | Each folder caches separately |

### 11.1 Synthetics agent tokens

**UI path:** Left sidebar → **IAM** → **Synthetics Tokens**

| Check | Expected |
| --- | --- |
| **Refresh button works** | One request every click. *It used to do nothing while the entry was fresh* |
| `r` shortcut | Same as the button |
| Create / rotate / enable / disable a token | List updates without a manual refresh |
| **Tokens are never written to disk** | DevTools → Application → Local Storage: **no** `o2q-` entry contains an agent token. IndexedDB likewise |

---

## 12. Workflows

**UI path:** Left sidebar → **Workflows**

Run **C1–C8**, **except C5** — this page registers no keyboard shortcuts, so `r` does nothing by design. The Refresh button (`workflow-list-refresh`) still applies for C4.

| Check | Expected |
| --- | --- |
| Create a workflow → back to list | Present without manual refresh |
| Delete a workflow → navigate away → return | Gone and stays gone |
| Workflow runs → paginate | Table keeps rows between pages |

---

## 13. Actions

**UI path:** Left sidebar → **Actions** (enterprise)

Run **C1–C8**, including the `r` shortcut (this was one of the fixes).

| Check | Expected |
| --- | --- |
| Create / edit an action script → back to list | Reflected without manual refresh |
| Delete → navigate away → return | Gone and stays gone |
| Open Logs → Actions menu after creating one | The new action is offered |

---

## 14. IAM

**UI path:** Left sidebar → **IAM**

### 14.1 Users

**UI path:** IAM → **Users**

Run **C1–C8** (`r` shortcut applies).

| Check | Expected |
| --- | --- |
| The role dropdown when adding a user | Populated from the **same cached role list** the Roles page uses — opening Users after Roles issues no extra request |
| Invite a user → the pending-invites list | The invite appears without a manual refresh. Note: `pendingInvitesQuery` is declared but unread (§24 item 8), so this list is **not** cache-backed — a request per visit is expected |
| Change a user's role → navigate away → return | The new role persists |

### 14.2 Roles

**UI path:** IAM → **Roles**

Run **C1–C8**.

| Check | Steps | Expected |
| --- | --- | --- |
| Roles and Users share one read | Open Roles, then Users, watching Network | The role list is fetched **once**, not once per page |
| Open a role → **Permissions** tab | | ⚠️ **A request on every open is EXPECTED — not a bug.** `rolePermissionsQuery` is declared but unread (§24 item 8) |
| Resource list | | The permission resource list is persisted (it is enum-like) — it survives a reload with no request |
| Create / edit / delete a role | | List updates without manual refresh; deleted role stays gone |
| Bulk-delete roles | | All selected gone; still gone after navigating away |

### 14.3 Groups

**UI path:** IAM → **User Groups**

Run **C1–C8**.

| Check | Expected |
| --- | --- |
| Open a group → **Roles** tab | Reads from the shared role cache |
| Create / edit / delete a group | List updates without manual refresh; deleted group stays gone |
| Bulk-delete groups | Same |

### 14.4 Quota

**UI path:** IAM → **Quota**

| Check | Expected |
| --- | --- |
| Open Quota, switch away, come back | The **module list is loaded once**, not on every visit. *It used to reload every time* |
| Change a quota value and save | Reflected without a manual refresh |

### 14.5 Service accounts

**UI path:** IAM → **Service Accounts**

Run **C1–C8**, including the `r` shortcut.

| Check | Steps | Expected |
| --- | --- | --- |
| **Mount does not force a refetch** | Open Service Accounts → go to Users → come back within 30 s, watching Network | **Zero** requests on the return visit. *It used to force one on every mount* |
| Create a service account | | Appears in the list without a manual refresh |
| **Tokens never persisted** | | Local Storage has **no** `o2q-` entry containing a service-account token |
| Delete → navigate away → return | | Gone and stays gone |

### 14.6 Ingestion tokens

**UI path:** IAM → **Ingestion Tokens**

| Check | Expected |
| --- | --- |
| **Refresh button works** | One request per click. *It used to do nothing while the entry was fresh* |
| `r` shortcut | Same |
| Create a token / enable / disable | List updates without a manual refresh |
| **Never persisted** | No `o2q-` localStorage entry contains an ingestion token; nothing in IndexedDB either |

### 14.7 Organizations

**UI path:** IAM → **Organizations**

| Check | Expected |
| --- | --- |
| Run C1–C5 | Standard cache behaviour |
| **Org cleanup tasks dialog** — IAM → Organizations → open an org's cleanup tasks | The dialog **polls every 5 seconds** while open, and **stops polling when closed** (confirm the requests stop in Network) |

### 14.8 MCP Server

**UI path:** IAM → **MCP Server**

| Check | Expected |
| --- | --- |
| Open, navigate away, return | Org data read from cache |
| Any token shown here is **not** in localStorage | Confirm in the Application tab |

---

## 15. Settings

**UI path:** Left sidebar → **Settings**

### 15.1 General / Organization settings

**UI path:** Settings → **General** · Settings → **Organization**

| Check | Expected |
| --- | --- |
| Open, navigate away, return | Settings paint instantly; no request within 5 minutes |
| Change a setting and save | The change is reflected everywhere it is used (theme, query defaults) without a reload |
| Reload the page | Org settings paint from `localStorage` before the request lands |

### 15.2 Nodes

**UI path:** Settings → **Nodes**

| Check | Steps | Expected |
| --- | --- | --- |
| Run C1–C5 | | Standard behaviour |
| **Filter survives refresh** | Apply a node filter → press Refresh (or `r`) | Filter and filtered rows preserved. *Refresh used to reset it* |
| **Not persisted to disk** | Check Local Storage | No `o2q-` entry for the node list — stale cluster topology is deliberately memory-only |

### 15.3 Cipher Keys

**UI path:** Settings → **Cipher Keys**

Run **C1–C8**.

| Check | Expected |
| --- | --- |
| **Key material never written to disk** | Local Storage has **no** `o2q-` entry containing cipher key material; IndexedDB likewise. This is an explicit design decision — verify it holds |
| Open a key's detail, go back, reopen | ⚠️ **A request on every open is EXPECTED — not a bug.** `cipherKeyDetailQuery` is declared but unread (§24 item 8). Only the *list* is cached |
| Create / delete a key | List updates without a manual refresh; deleted key stays gone |

### 15.4 Regex Patterns

**UI path:** Settings → **Regex Patterns**

Run **C1–C8**.

> This page previously had its **own** bespoke `sessionStorage` cache class
> (`regex_patterns_cache_<org>`, 1-hour TTL). The PR **deleted** it in favour of the
> shared layer — see the sessionStorage check below.

| Check | Steps | Expected |
| --- | --- | --- |
| **Revalidation actually happens** | Create a pattern in another tab or as another user, then return here, wait past 5 min and revisit | The list revalidates. *It used to read a local store copy and never consult the cache, so an invalidated entry was never refreshed* |
| Delete a pattern → navigate away → return | | Gone and stays gone |
| **Old sessionStorage cache is gone** | DevTools → Application → **Session Storage** | No `regex_patterns_cache_*` key is ever written |
| Stale sessionStorage residue is harmless | If an older build left a `regex_patterns_cache_*` key, reload with it present | The page ignores it entirely — nothing reads that key any more |

### 15.5 Built-in patterns

**UI path:** Settings → **Regex Patterns** → **Built-in** tab

| Check | Expected |
| --- | --- |
| Open, navigate away, return, reload the page | Requested **once per session** and persisted — these never change |
| Refresh button | Still forces a request |

### 15.6 AI Toolsets

**UI path:** Settings → **AI Toolsets**

Run **C1–C8**, including `r`.

| Check | Expected |
| --- | --- |
| Create / edit / delete a toolset | List updates without a manual refresh; deleted toolset stays gone |

### 15.7 Model Pricing

**UI path:** Settings → **Model Pricing**

| Check | Steps | Expected |
| --- | --- | --- |
| **Newly saved model appears** | Settings → Model Pricing → **Add** → fill in → Save → return to the list | The new model is **listed**. *This was a shipped bug — it did not show up* |
| **Refresh button spins and works** | Click Refresh | One request goes out **and the button shows a spinner**. *The button used to be wired to the cold-read flag, so it spun nothing* |
| **Old sessionStorage cache is gone** | DevTools → Application → **Session Storage** | No `model_pricing_cache_*` key is ever written. The bespoke 24-hour sessionStorage cache this page used was deleted in favour of the shared layer |
| `r` shortcut | | Same as the button |
| Edit a model's pricing → back to the list | | Reflected without a manual refresh |
| Delete a model → navigate away → return | | Gone and stays gone |

### 15.8 License

**UI path:** Settings → **License**

| Check | Expected |
| --- | --- |
| Open the page | The license is **always re-read** (it carries live ingestion usage counters) — it is deliberately *not* frozen |
| Update the license key, then reopen | The new entitlement shows immediately, not a stale one |
| **Not persisted** | No `o2q-` localStorage entry for the license |
| **Upgrade dialog reads the same license** — trigger the *Enterprise upgrade* dialog (click a PRO/enterprise-gated feature on a community build) | The dialog shows **current** entitlement/limits, never a stale copy. It reads through the same cached license entry |
| Upgrade dialog after a license change | Update the license, then reopen the dialog | It reflects the new license |

### 15.9 Query management / Running queries

**UI path:** Settings → **Query Management**

| Check | Expected |
| --- | --- |
| Open the page | This is **deliberately uncached** — every open reads fresh. Refresh works as before |

---

## 16. Traces

**UI path:** Left sidebar → **Traces**

> The trace **search** is uncached (§17). What is cached is the trace DAG.

| Check | Steps | Expected |
| --- | --- | --- |
| **Trace DAG is cached to disk** | Traces → run a search → open a trace → open the **Service Map / DAG** view → go back → reopen the same trace's DAG | The second open is **instant with no request** — a trace is immutable, so its DAG is cached forever |
| DAG persists across reload | Open a trace DAG → F5 → reopen the same trace | Restored from IndexedDB |
| Verify the storage | DevTools → Application → IndexedDB → `o2Cache` → `kv` | Entries for the trace DAG exist |
| Purged on org switch | Switch org → check `o2Cache` | Previous org's DAG entries gone |
| **Services catalog keeps its results** | Traces → **Services** → run a search → run a second search | The previous results **stay on screen** while the next one runs — the table must not blank between searches |
| Services catalog refresh | Click Refresh | Reaches the server; results stay while it runs |

---

## 17. What must NOT be cached — negative tests

These are as important as the positive tests. If any of these start serving stale data,
that is a correctness bug.

| Surface | UI path | Expected |
| --- | --- | --- |
| **Log search** | Logs → run a query → run it again | **Every run hits the server.** Never served from the frontend cache |
| **Trace search** | Traces → run a search twice | Every run hits the server |
| **Metrics search** | Metrics → run a query twice | Every run hits the server |
| **Stream Explorer table** | Streams → open a stream → Explore | It is a search, not a list — always fresh |
| **RUM error tracking / performance** | RUM → Error Tracking / Performance | Dashboard-backed searches — always fresh |
| **AI chat / SSE streams** | AI Assistant | Streaming; never cached |
| **Dashboard save** | Dashboards → open a dashboard → edit → Save, twice in a row | **No "save conflict" / hash mismatch error.** The dashboard read used inside the save path must not be served from cache |
| **Billing checkout URLs** | Billing → Plans → start a subscription/checkout | Each attempt produces a **fresh** URL — never a reused one |
| **Billing payment sources** | Billing → payment details | Not cached |
| **Ingestion / login / uploads** | Any POST/PUT/DELETE | One-shot, never cached |

---

## 18. Credentials — must never touch disk

Open **DevTools → Application → Local Storage** and **IndexedDB**, then search every
`o2q-*` value for these. **None of them may appear:**

| Value | Where it comes from | UI path to populate it |
| --- | --- | --- |
| RUM client token | inside `/config` | Any page load |
| Cipher key material | cipher keys list | Settings → Cipher Keys |
| Ingestion tokens | ingestion token list | IAM → Ingestion Tokens |
| Org passcode | passcode | Data sources page |
| RUM API token | rum token | Data sources → RUM |
| Service-account tokens | service accounts list | IAM → Service Accounts |
| Synthetics agent tokens | agent token list | IAM → Synthetics Tokens |

Visit each page above, then re-inspect storage. These values must live in memory only.

---

## 19. Home / Overview

**UI path:** Left sidebar → **Home**

| Check | Steps | Expected |
| --- | --- | --- |
| **Tab switching does not re-request** | Home → switch between the Overview tabs a few times | Each tab loads **once**. *It used to re-request on every tab switch* |
| Refresh keeps content | Once a section has loaded, click Refresh | The section content stays on screen while it revalidates |
| Overview reads | Home → Overview | The alert, incident, anomaly and service-topology summaries are cached; a return visit within 30 s issues no request |
| Service graph | Home → Service Graph (or Traces → Service Graph) | Cached per time range; changing the range forks the entry, changing back is instant |
| Usage tab | Home → **Usage** | Cached; refresh forces |

---

## 20. Data sources / Ingestion

**UI path:** Left sidebar → **Data sources**

| Check | Expected |
| --- | --- |
| Open the page, navigate away, return | Ingestion tokens and passcode read from memory cache; no re-request within the window |
| Reset the passcode | The displayed passcode updates immediately |
| Create/toggle an ingestion token | Reflected without a manual refresh |
| **Nothing persisted** | No `o2q-` localStorage entry contains the passcode or an ingestion token |

---

## 21. RUM

**UI path:** Left sidebar → **RUM**

| Check | Expected |
| --- | --- |
| RUM → **Sessions** → paginate | Table keeps its rows between pages; no blank flash |
| Refresh button | One request; rows stay |
| RUM → **Error Tracking** / **Performance** | Search-backed — always fresh (see §17) |

---

## 22. Enterprise modules

### 22.1 Online Evals

**UI path:** Left sidebar → **AI** → **Evaluations**

| Check | Steps | Expected |
| --- | --- | --- |
| **Revisit keeps rows** | Open Evaluations → navigate away → wait past 30 s → come back | Rows **stay on screen** and swap in place. *It used to blank the whole page for ~470 ms while it blocked on a stale entry* |
| **Skeleton only when genuinely cold** | Hard-reload, then open the page | Skeleton on the first visit only |
| Providers list | Settings → LLM Providers, then a scorer form's provider dropdown | Shared cache — persisted, one request |
| Scorers / score configs / eval jobs | Each list: run C1–C5 | Standard cache behaviour |
| Refresh buttons on each list | Click each | **Each reaches the server** — one request per click |
| Create / activate / pause / delete a scorer or job | | The list updates without a manual refresh |
| Score config versions | Open a score config → Versions | Cached per config |
| **Scorer Library** | AI → Evaluations → **Scorer Library** → open it, close it, reopen | Second open is a cache hit. Its own refresh action **forces** a server read |
| **Manual evaluation dialog** | AI → Evaluations → **Run manual evaluation** | The job list in the dialog comes from cache — no request if you were just on the jobs list |

### 22.2 AI Observability — Datasets

**UI path:** Left sidebar → **AI** → **Datasets**

| Check | Steps | Expected |
| --- | --- | --- |
| **Mount does not force** | Open Datasets → navigate away → come back within 30 s | **Zero** requests. *It used to fetch on every single visit* |
| **Refresh forces** | Click the Refresh button | One request; rows stay |
| Table survives a revisit | Go away and back | Rows are still there — the page no longer starts from empty |

### 22.3 AI Observability — Queues

**UI path:** Left sidebar → **AI** → **Queues**

Same three checks as Datasets.

### 22.3a AI Observability — LLM Insights dashboard (panel cache)

**UI path:** Left sidebar → **AI** → **LLM Insights**

> This page renders its charts through the **same IndexedDB panel-result cache** the
> Dashboards page uses, under a minted identity of *stream + agent + time window*.

| Check | Steps | Expected |
| --- | --- | --- |
| Panels restore on revisit | Let the charts render → navigate away → come back with the **same** stream/agent/time window | Charts **repaint from cache** rather than re-running their queries |
| A different selection is a clean miss | Change the agent, or the stream, or the time window | Fresh fetch — it must **not** show the previous selection's data |
| Switching back is a hit | Change the selection, then change it back | Instant repaint of the earlier result |
| Stream tab vs Agent tab | Switch between the Stream and Agent tabs | Each keeps its own cached identity; no cross-contamination between tabs |
| Compare mode | Enter and exit compare mode | Charts stay coherent; no stale panel left behind from the other mode |
| Verify the storage | DevTools → Application → IndexedDB → `o2Cache` → `kv` | Entries exist for these panels; Console shows **no `DataCloneError`** |

### 22.4 Billing

**UI path:** Left sidebar → **Billing**

| Check | Expected |
| --- | --- |
| Billing → **Usage** | Cached in memory; revisit within 30 s issues no request |
| Billing → **Invoice History** | Same |
| Billing → **Billing Group** members | ⚠️ **Not cached** — `billingGroupMembersQuery` and `subscriptionQuery` are declared but unread (§24 item 8). A request per visit is expected |
| **Nothing billing-related persisted** | No `o2q-` localStorage entry for any billing read |
| Billing → **Plans** → start checkout | Fresh single-use URL every attempt (see §17) |

---

## 23. Resilience / edge cases

| Scenario | How to reproduce | Expected |
| --- | --- | --- |
| **Private browsing / storage blocked** | Open the app in a private window, or block site data in browser settings | The app works normally. Nothing persists, everything still caches **in memory**. No crash, no console error |
| **localStorage quota full** | An org with a very large number of streams, or manually fill localStorage | The app still works; persistence silently stops. No crash |
| **Offline → back online** | DevTools → Network → Offline, navigate around, then go back Online | Lists paint from cache while offline; when the connection returns, queries refetch automatically |
| **Server error on a list** | Stop the backend, then open a cached list | Cached rows are still shown; an error is surfaced (not a silent empty table) |
| **4xx does not retry-storm** | Trigger a 403 on a list (a user without permission) | **One** request, one error. No retry loop, no repeated error toasts |
| **Multiple tabs** | Open the app in two tabs, delete a row in tab A, then switch to tab B and interact | Tab B corrects itself on its next revalidation. A short window of staleness is acceptable |
| **Window focus** | Leave a list open, switch to another app for a minute, come back | Volatile lists (stream pages, alerts, reports, incidents, SLOs, synthetics) revalidate on focus. Config-tier lists do not |
| **Console is clean** | Keep the Console open throughout all testing | **No `DataCloneError`**, no `Maximum recursive updates`, no unhandled promise rejections from the query layer |

---

## 24. Review notes to raise with the team

These came out of the code review of this branch. They are not blockers for testing, but
worth a decision.

1. **Alert destinations are persisted to `localStorage`.** ~~Destination payloads can embed
   webhook `Authorization` headers, PagerDuty routing keys and Opsgenie/ServiceNow
   credentials.~~ **Resolved:** `destinationsQuery` no longer declares a persister — the
   list is cached in memory only, matching cipher keys/tokens/passcodes. AI Toolsets and
   Action Scripts stay persisted (their list payloads carry no credentials).

2. **`PERSIST_BUSTER` is `"1"`.** If a cached response shape changes without bumping it,
   a persisted payload from an older build will be rendered by a newer one. Add a
   bump-the-buster step to the release checklist for any API response-shape change.

3. **Stream name list on very large orgs.** It is persisted to `localStorage`, which has a
   ~5 MB budget shared with the rest of the app. Quota errors are swallowed by design, so
   the failure mode is "reload-persistence quietly stops working", not a crash. Worth
   measuring on the largest org available.

4. **Enrichment tables were never verified live** (the test backend had no tables). §10.2
   is by inspection only — please prioritise it on an org that has enrichment tables.

5. **`useServerTable` has no consumers.** [`composables/query/useServerTable.ts`](../src/composables/query/useServerTable.ts)
   is built, exported and documented as "the fix for the blank-table flicker", but no page
   imports it — the server-paginated surfaces (Streams, alert history, pipeline history)
   were each done inline instead. Either adopt it on those pages or drop it; right now it
   is untested-by-use code carrying a `keepPreviousData` + prefetch policy that the real
   pages re-implement by hand.

6. **The field-value in-memory cache is never cleared on purge.**
   [`composables/fieldValueStore.ts`](../src/composables/fieldValueStore.ts) keeps a
   module-level `readCache` Map (60 s TTL, 500 entries) in front of IndexedDB. The purge
   path clears the *IndexedDB* layer only — `purgePersistedOrg` / `purgeAllPersisted` call
   `fieldValueDB.clearOrg` / `clearAll` and never touch this Map. `queryClient.clear()`
   does not reach it either, because it is not a query.

   Keys are org-scoped (`org|streamType|streamName|field`), so **there is no cross-org
   leak**. The exposure is same-org, sequential logins in one browser tab: logout is a
   `router.push("/logout")`, not a page reload, so user A's captured field *values* remain
   readable for up to 60 s — which matters only where RBAC restricts user B from that
   stream. Narrow and suggestion-only, but the fix is one line: clear the Map from the
   purge path. Verify with the §2.3 test before deciding it is acceptable.

   **Resolved:** `fieldValueStore.clearReadCache()` is now called from both purge paths
   (`purgeOrgQueries` on org switch, `purgeAllQueries` on logout).

8. **Eleven declared queries have zero consumers — the detail reads were never wired up.**
   These are declared in `*.queries.ts`, and `api-cache-inventory.md` lists most of them
   under "Cached today", but no page imports them. The screens they were written for still
   fetch uncached, straight through the service:

   | Declaration | Screen it was written for | Actual behaviour today |
   | --- | --- | --- |
   | `sloDetailQuery` | SLO detail | Request on every open |
   | `reportDetailQuery` | Report edit | Request on every open |
   | `pipelineDetailQuery` | Pipeline editor | Request on every open |
   | `monitorDetailQuery` | Synthetics monitor detail | Request on every open |
   | `cipherKeyDetailQuery` | Cipher key detail | Request on every open |
   | `rolePermissionsQuery` | IAM role permissions tab | Request on every open |
   | `pendingInvitesQuery` | IAM pending invites | Request on every visit |
   | `orgListQuery` | Org switcher list | Not cache-backed |
   | `subscriptionQuery` | Billing subscription | Request on every visit |
   | `billingGroupMembersQuery` | Billing group members | Request on every visit |
   | `deleteDestinationMutation` | Single-destination delete | Dead declaration only — the page calls the service directly and prunes the cache by hand, so **behaviour is correct**; just unreachable code |

   Either wire them up or delete them. Until then, the "Detail reads" section of
   `api-cache-inventory.md` is **wrong**, and the affected rows in this plan are marked
   ⚠️ so you do not file them as bugs.

   Verify with:
   ```bash
   cd web/src && grep -rl "sloDetailQuery" . --include=*.vue --include=*.ts \
     | grep -v '\.spec\.' | grep -v '\.queries\.ts$'   # → no output
   ```

10. **Three list pages register no keyboard shortcuts.** SLOs, Synthetics and Workflows
   each ship a Refresh button but no `useShortcuts` block, so the `r` refresh shortcut every
   comparable list has is simply absent. The branch audited and repaired all 43 registered
   refresh shortcuts; these three were never registered in the first place, so the audit
   could not have caught them. Worth adding for consistency — every other list page has it.

   ```bash
   cd web/src && grep -c useShortcuts views/slos/SloList.vue \n     views/SyntheticMonitoring.vue components/workflows/WorkflowsList.vue   # → 0 0 0
   ```

11. **Docs drift.** `web/docs/api-cache-inventory.md` says "63 cached reads" and describes
   a `persist: "none"` option; the shipped API is plain `queryOptions()` with the
   persister simply omitted, and there are now more query modules than the inventory
   lists (incidents, anomaly detection, service graph, LLM datasets/queues, API keys).
   Worth a refresh pass before merge.

### Verified during review

- **Type-check clean** — `npx vue-tsc --noEmit -p tsconfig.app.json --composite false` → exit 0.
- **Query-layer and panel-cache unit tests pass** — `fetchInto.spec.ts` (5 tests),
  `usePanelCache.spec.ts` (26 tests).
- **Migrated component specs pass** — 699/702 across functions, settings, IAM roles and
  alert templates. The single failure (`AddEnrichmentTable.spec.ts`) is a known
  parallel-load timeout; it passes when run alone.
- **Purge wiring confirmed** — org switch → `purgeOrgQueries` in `MainLayout.vue`;
  logout → `purgeAllQueries` in `stores/index.ts`.

---

## 24A. Coverage map — every cache consumer → the section that tests it

Derived by listing every file in `web/src` that imports a `*.queries` module, the query
client, `fetchInto`, `useServerTable` or `usePanelCache`, then mapping each to a section
above. Use this to confirm nothing was skipped.

| Consumer (source file) | Tested in |
| --- | --- |
| `main.ts`, `views/Login.vue`, `utils/auth.ts` | §2.1 |
| `utils/buildVersionChecker.ts` | §2.1a |
| `layouts/MainLayout.vue` | §2.2 |
| `stores/index.ts` (logout purge) | §2.3 |
| `composables/useStreams.ts`, `views/LogStream.vue` | §3 |
| `plugins/logs/SearchBar.vue`, `composables/useLogs/useSearchBar.ts` | §4 |
| `composables/useSuggestions.ts` (SQL function catalogue) | §4 |
| `composables/useFunctions.ts`, `composables/useActions.ts` | §4, §10.1, §13 |
| `composables/fieldValueDB.ts`, `composables/fieldValueStore.ts` | §4.1 |
| `composables/useFieldValuesStream.ts`, `useLogs/useStreamFields.ts`, `usePromqlSuggestions.ts`, `plugins/logs/IndexList.vue`, `composables/dashboard/useDashboardPanel.ts` | §4.1 |
| `composables/metrics/useMetricsExplorerGrid.ts` | §4A |
| `utils/commons.ts`, `views/Dashboards/Dashboards.vue` | §5.1 |
| `composables/useFavoriteDashboards.ts`, `composables/useHomeDashboard.ts` | §5.1 |
| `composables/dashboard/usePanelCache.ts`, `usePanelDataLoader.ts` | §5.2 |
| `views/Dashboards/addPanel/AddPanel.vue`, `addPanel/ConfigPanel.vue`, `addPanel/DashboardQueryEditor.vue` | §5.3 |
| `composables/dashboard/useAnnotations.ts`, `addPanel/AddAnnotation.vue` | §5.4 |
| `views/Dashboards/ImportDashboard.vue`, `DashboardJsonEditor.vue`, `RenderDashboardCharts.vue` | §5.5 |
| `components/dashboards/SelectDashboardDropdown.vue` | §5.6 |
| `components/alerts/AlertList.vue`, `views/AppAlerts.vue` | §6.1 |
| `views/AddAlertView.vue` | §6.2 |
| `components/alerts/AlertsDestinationList.vue`, `AddDestination.vue`, `ImportDestination.vue` | §6.3 |
| `components/alerts/TemplateList.vue`, `AddTemplate.vue`, `ImportTemplate.vue`, `template-content/TemplatePreviewPanel.vue` | §6.4 |
| `components/alerts/AlertHistory.vue`, `AlertHistoryDrawer.vue`, `AlertEvaluationHistory.vue` | §6.5 |
| `components/alerts/IncidentList.vue` | §6.6 |
| `components/alerts/ExternalAlertSourcesList.vue` | §6.7 |
| `composables/alerts/useDependencyGraph.ts`, `components/alerts/DependencyImpactDialog.vue` | §6.8 |
| `services/anomaly_detection.queries.ts` consumers | §6.9 |
| `views/slos/SloList.vue` | §7 |
| `components/reports/ReportList.vue` | §8 |
| `components/pipeline/PipelinesList.vue`, `ImportPipeline.vue`, `composables/usePipelines.ts` | §9.1 |
| `components/alerts/PipelinesDestinationList.vue`, `flow/forms/DestinationPicker.vue`, `pipeline/NodeForm/CreateDestinationForm.vue`, `composables/usePrebuiltDestinations.ts` | §9.2 |
| `components/functions/FunctionList.vue`, `AddFunction.vue` | §10.1 |
| `components/functions/EnrichmentTableList.vue` | §10.2 ⚠️ |
| `views/SyntheticMonitoring.vue`, `synthetics/CreateBrowserTest.vue`, `CreateProtocolCheck.vue` | §11 |
| `components/iam/SyntheticsTokens.vue` | §11.1 |
| `components/workflows/WorkflowsList.vue` | §12 |
| `components/actionScripts/EditScript.vue`, `ActionScripts.vue` | §13 |
| `components/iam/users/User.vue` | §14.1 |
| `components/iam/roles/AppRoles.vue`, `AddRole.vue`, `EditRole.vue`, `readonlyPreset.ts` | §14.2 |
| `components/iam/groups/AppGroups.vue`, `AddGroup.vue`, `EditGroup.vue`, `GroupRoles.vue` | §14.3 |
| `components/iam/quota/Quota.vue` | §14.4 |
| `components/iam/serviceAccounts/ServiceAccountsList.vue`, `AddServiceAccount.vue` | §14.5 |
| `components/iam/IngestionTokens.vue` | §14.6 |
| `components/iam/organizations/OrgCleanupTasksDialog.vue` | §14.7 |
| `components/iam/McpServer.vue` | §14.8 |
| `components/settings/General.vue` | §15.1 |
| `components/settings/Nodes.vue` | §15.2 |
| `components/settings/CipherKeys.vue` | §15.3 |
| `components/settings/RegexPatternList.vue` | §15.4 |
| `components/settings/BuiltInPatternsTab.vue` | §15.5 |
| `components/settings/AiToolsets.vue` | §15.6 |
| `components/settings/ModelPricingList.vue`, `ModelPricingEditor.vue` | §15.7 |
| `components/settings/License.vue`, `components/EnterpriseUpgradeDialog.vue` | §15.8 |
| `components/queries/RunningQueries.vue` | §15.9 |
| `plugins/traces/TraceDAG.vue`, `ServicesCatalog.vue` | §16 |
| `views/OverviewTab.vue`, `views/UsageTab.vue`, `services/service_graph.queries.ts` | §19 |
| `views/Ingestion.vue`, `services/api_keys.queries.ts` | §20 |
| `views/RUM/AppSessions.vue` | §21 |
| `enterprise/components/OnlineEvals.vue`, `onlineEvals/useOnlineEvalsData.ts`, `ScorerLibrary.vue`, `ManualEvaluationDialog.vue` | §22.1 |
| `enterprise/views/AIObservability/DatasetsPage.vue` | §22.2 |
| `enterprise/views/AIObservability/QueuesPage.vue` | §22.3 |
| `plugins/traces/LLMInsightsDashboard.vue` | §22.3a |
| `enterprise/components/billings/usage.vue`, `invoiceTable.vue` | §22.4 |

**Not user-testable (no UI of their own):** `composables/query/*` (the layer itself),
`services/*.queries.ts` / `*.querykeys.ts` (declarations and key factories),
`composables/dashboard/panel.querykeys.ts`, `lib/core/EmptyState/presets.ts` (copy only),
`test/unit/helpers/*`. `App.vue` only mounts the Query Devtools panel — exercised as the
instrument in §0.2, not as a surface.

### How this map was built (so you can re-run it)

```bash
cd web/src
grep -rlE "from \"@/services/[a-zA-Z_.-]+\.quer(ies|ykeys)\"|from \"@/composables/query|usePanelCache|@tanstack/vue-query|fieldValueStore|fieldValueDB" \
  --include=*.vue --include=*.ts . | grep -v '\.spec\.' | grep -v '^\./test/' | sort
```

Match on `fieldValueStore` / `fieldValueDB`, **not** on a bare `fieldValue` — ~21 files
have a local variable by that name and are not cache consumers.

After removing `services/*`, `composables/query/*`, `panel.querykeys.ts` and `App.vue`
(all listed as not user-testable above), that yields **98 UI-bearing consumers**; every one
appears in the table above. Re-run it after any change to the branch to catch a surface
added later.

---

## 25. Bug report template

```
Module:            (e.g. Alerts → Destinations)
UI path:           (exact clicks)
Check that failed: (e.g. C7 — delete + navigate back)
Steps:             1. ...
                   2. ...
Expected:
Actual:
Network tab:       (requests fired / not fired)
Query Devtools:    (key + state of the relevant entry)
Storage:           (relevant o2q-* key or IndexedDB entry, if any)
Console:           (any errors)
Org / build:
```
