# Frontend Caching (`feat/fe-caching`) — Manual UI Test Plan

Branch: `feat/fe-caching` · PR: [#13642](https://github.com/openobserve/openobserve/pull/13642)

Companion doc: [fe-caching-manual-test-issues.md](./fe-caching-manual-test-issues.md) — findings from the test runs.

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

> **Cold-read counts assume an empty cache.** Ctrl+Shift+R clears the HTTP cache but **not**
> `localStorage`, so persisted queries (templates, destinations, streams, folders, functions,
> regex patterns, org settings) can survive a hard reload and will not re-request. If a C1
> count comes out lower than listed, that is usually why — not a fault. For a genuinely cold
> read, log out and back in, or clear site data.

### Which sections get C1–C8, and which do not

**C1–C8 applies only to a cached LIST page** — a table of rows with a Refresh button and
create / edit / delete. Everywhere else, run only that section's own rows.

| Run **C1–C8 + the section's rows** | Run **the section's rows ONLY** |
| --- | --- |
| §3 Streams · §5.1 Dashboards · §6.1 Alerts · §6.3 Destinations · §6.4 Templates · §7 SLOs · §8 Reports · §9.1 Pipelines · §9.2 Pipeline destinations · §10.1 Functions · §11 Synthetics · §12 Workflows · §13 Actions · §14.1–14.5 IAM · §15.3 Cipher Keys · §15.4 Regex Patterns · §15.6 AI Toolsets | §2 App shell · **§4 Logs** · §4.1 Field values · §4A Metrics · §5.2–5.6 Panels/annotations · §6.5 Alert history · §6.8 Dependencies · §14.7 Organizations · §15.1 General · §15.2 Nodes · §15.5 Built-in patterns · §15.7 Model pricing · §15.8 License · §16 Traces · §19 Home · §20 Data sources · §21 RUM · §22 Enterprise · §23 Edge cases |

A section that wants C1–C8 says **"Run C1–C8"** under its UI path. If it doesn't say that,
it doesn't want them.

Sections 2 onward name the surfaces. For each list page, run these eight checks. They are
the same checks every time, so they are written out once here.

| # | Check | Steps | Expected |
| --- | --- | --- | --- |
| **C1** | Cold read | Hard-reload (Ctrl+Shift+R), navigate to the page | Skeleton appears, **one** request in Network, rows render. **Exception — server-paginated tables (Streams, §3): expect TWO** — the page you asked for, plus a background prefetch of the next page. That is by design, see §3 |
| **C2** | Warm revisit — fresh | Navigate away to another module, come straight back (within the freshness window) | Rows appear **instantly, no skeleton**, and **zero requests** in Network |
| **C3** | Warm revisit — stale | Navigate away, wait past the freshness window, come back | Rows appear **instantly, no skeleton**, then **one** background request; the table updates in place — it must never blank out |
| **C4** | Refresh button | Click the Refresh icon in the page header | **One** request goes out every single time (even inside the freshness window). Rows stay on screen throughout. The **spinner is on the button**, not a full-table skeleton |
| **C5** | `r` keyboard shortcut | Click on empty page area (not in an input), press **`r`** | Identical behaviour to C4 — one request, rows stay, button spins. *This was broken on 11 pages before this branch; it is the highest-value check in the list.* **Skip C5 on SLOs (§7), Synthetics (§11), Workflows (§12) and BOTH alert-history surfaces (§6.5)** — these pages register no keyboard shortcuts at all, so `r` doing nothing there is expected, not a bug (§24 item 10). Browser-verified for §6.5 with a real keypress: **0 requests, no repaint**; neither `AlertHistory.vue` nor `AlertEvaluationHistory.vue` imports `useShortcuts`, **on this branch or on `main`** (47 other pages do) |
| **C6** | Create / Edit | Create or edit a row, save | You return to the list and the new/edited row is **already there**. You should **not** have to press Refresh |
| **C7** | Delete + navigate back | Delete a row → confirm → then navigate to another module and come **straight back** | The row is gone immediately **and is still gone on return**. A deleted row reappearing is the single most likely regression in this branch |
| **C8** | Filter/search survives refresh | Type a search term, then press Refresh (or `r`) | The search term and the filtered result set are **preserved**. The list must not reset to unfiltered |

### 1.1 How many requests should a cold load fire? — read this before C1

"One request" is the **default**, not a universal rule. Two legitimate reasons a page
fires more, neither of which is a bug:

**(a) The page prefetches the next page.** Only **two** surfaces do this — verified by
grepping every `prefetchQuery` call site in the app:

| Surface | Section | Cold load | Then each page change |
| --- | --- | --- | --- |
| **Streams** | §3 | **2** — page 1 + prefetch of page 2 | **1** (the page itself is cached; the request warms the page *ahead*) |
| **Alert History** — standalone page, **URL-only, no UI path** (§6.5) | §6.5 | **2** — page 1 + prefetch of page 2 | **1**, same pattern |

On the **last** page the prefetch is skipped, so expect **0**. The prefetch is also
skipped whenever there is **no next page at all** — fewer than one page of rows means
**1 request is correct**, on either surface. And within Alerts, only the standalone
**Alert History** page prefetches: the alert-detail **History tab** and the **History
drawer** never do, so expect 1 there always.
`main` prefetches nowhere, so it shows 1-1-1-1 where this branch shows 2-1-0-0.

**(b) The page genuinely needs several lists.** These fire one request *per list* on a
cold load — count them against this table, not against "one".

> **These are UPPER BOUNDS, not exact counts.** They come from static analysis of which
> queries each page references. The real number is often lower because some queries are
> conditional: gated by edition (`isEnterprise` / `isCloud`), by a feature flag, by which
> tab is open, or fired only on a user action rather than on mount. Two known examples —
> the Alerts list references `alertDetailQuery` but only fires it when you **open a row**,
> so its cold load is 3, not 4; and Home → Overview fires fewer than 5 on a community
> build. **Fewer requests than listed is fine. More is worth reporting.**

| Page | Section | Cold requests | Which queries |
| --- | --- | --- | --- |
| Home → Overview | §19 | up to **5** | alert history · anomaly configs · anomaly history · incidents · service topology. **Enterprise/cloud only for the services + incidents sections** — a community build fires fewer |
| AI → Evaluations | §22.1 | **4** | providers · score configs · scorers · eval jobs |
| IAM → Users | §14.1 | **4** | org users · roles · assignable roles · all user roles |
| Alerts list | §6.1 | **4** | alerts · destinations · templates · folders. (`alertDetailQuery` is **not** one of them — it fires only when you open a row) |
| Data sources | §20 | **3** | ingestion tokens · passcode · RUM tokens |
| Alerts → dependency graph | §6.8 | **3** | alert dependencies · destinations · templates |
| IAM → Roles → Edit role | §14.2 | **3** | resources · destinations · templates |
| Alerts → Destinations | §6.3 | **2** | destinations · templates |
| Pipelines → Destinations | §9.2 | **2** | destinations · templates |
| IAM → Roles | §14.2 | **2** | roles · all user roles |
| IAM → Add service account | §14.5 | **2** | roles · groups |
| Streams | §3 | **2** + prefetch | stream page · org summary |
| Dashboards | §5.1 | **2** | folders · dashboards-by-folder |
| Settings → General | §15.1 | **2** | config · org summary |
| Home → Usage | §19 | **2** | config · org summary |
| Add / Edit alert | §6.2 | **2** | alert detail · destinations |
| App shell (any page) | §2 | **2** | `/config` · org settings |

**What C2 tests is unchanged and is the real signal:** whatever the cold count is, the
**warm revisit within the freshness window must be ZERO**. A page that fires 4 on a cold
load and 0 on return is working correctly. A page that fires 4 both times is not.

---

## 1.2 Cache policy — testing the mechanics themselves

C1–C8 test each *screen*. This section tests the **cache engine**: freshness windows,
eviction, focus refetch, polling and retry. Run it **once**, on any convenient list page —
these are global behaviours, not per-module.

**Use the TanStack Query Devtools** (§0.2) for this section. It shows every entry's state
badge — `fresh` / `stale` / `fetching` / `inactive` — which is far easier than inferring
freshness from the Network tab.

### The four freshness tiers

| Tier | Duration | Applies to | How to verify |
| --- | --- | --- | --- |
| **Default** | **30 s** | Most lists — alerts, SLOs, reports, pipelines, dashboards, IAM | Open a list, watch its Devtools badge flip `fresh` → `stale` after 30 s |
| **Config** | **5 min** | Streams, folders, functions, destinations, templates, actions, regex patterns, org settings | Same, but the flip takes 5 minutes |
| **Session** | **forever** | `/config` and built-in regex patterns only | Badge stays `fresh` for the whole session — it must **never** go stale |
| **Persisted max age** | **24 h** | Anything in localStorage / IndexedDB | An entry older than 24 h is discarded on read rather than served |

| # | Check | Steps | Expected |
| --- | --- | --- | --- |
| **P1** | Fresh window suppresses the request | Open Alerts, note the time. Navigate away and back **within 30 s** | **Zero** requests. Devtools badge reads `fresh` |
| **P2** | Stale window triggers revalidation | Same, but wait **past 30 s** | Rows paint instantly, then **one** background request. Badge goes `stale` → `fetching` → `fresh` |
| **P3** | Config tier is longer | Open Streams, come back **after 1 minute** | Still **zero** requests — the 5-minute tier has not expired. This is what distinguishes the tiers |
| **P4** | Session tier never expires | Sit in the app for 10+ minutes, navigating around | `/config` is requested **once, ever**. Never re-requested |
| **P5** | Built-in patterns never expire | Settings → Regex Patterns → Built-in tab, revisit repeatedly | One request per session, and it survives F5 (persisted) |

### Eviction, focus, polling, retry

| # | Check | Steps | Expected |
| --- | --- | --- | --- |
| **P6** | Unused entries are garbage-collected | Open a list, navigate away, **wait 5+ minutes** without returning, then come back | A **cold read with a skeleton** — the entry was evicted from memory. Config-tier entries are held 30 min instead, so use a default-tier list (Alerts, Reports) for this |
| **P7** | Refetch on window focus | Open **Alerts**, switch to another application for over 30 s, switch back | **One** background request; rows stay on screen. Applies to the volatile lists — alerts, streams, reports, incidents, SLOs, synthetics, dashboards, pipelines, IAM, workflows |
| **P8** | No focus refetch on config tier | Same, but on **Settings → Regex Patterns** | **Zero** requests — config-tier reads deliberately do not refetch on focus |
| **P9** | Polling starts and stops | IAM → Organizations → open an org's **cleanup tasks** dialog | A request every **5 s** while open. **Close the dialog → polling stops entirely.** A poll that continues after close is a leak |
| **P10** | Polling stops on completion | Leave the cleanup dialog open until the task reports complete | Polling stops by itself, without closing the dialog |
| **P11** | 4xx does not retry | Trigger a 403 — sign in as a user without permission for some list | **One** request, one error. **No retry storm, no repeated toasts.** 400/401/403/404 are never retried |
| **P12** | 5xx / network errors do retry | Stop the backend, then open a list | Up to **2 retries** before the error surfaces |
| **P13** | Reconnect refetches | DevTools → Network → **Offline**, navigate, then back to **Online** | Queries refetch automatically on reconnect |

### Persistence lifecycle

| # | Check | Steps | Expected |
| --- | --- | --- | --- |
| **P14** | Persisted entries survive reload | Visit Streams and Dashboards, then press **F5** | Lists paint from localStorage before any request completes |
| **P15** | Version buster discards old payloads | Console: `localStorage.setItem('o2q-["org","default","functions","list"]', '{"buster":"0"}')` then reload Functions | The tampered entry is **discarded, not rendered** — a mismatched buster is treated as invalid |
| **P16** | Corrupt entry is discarded | Console: write `'not json'` into any `o2q-` key, reload that page | Entry removed, page loads normally from the server. **No crash** |

---

## 2. App shell, session and organization

**Scope:** each sub-section below states its own — see them individually.

### 2.1 Login and app config

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Sign out → Login screen → sign in

| Check | Expected |
| --- | --- |
| Log in, watch Network | `/config` is requested **once** |
| Navigate across five different modules | `/config` is **never** requested again — it is cached for the whole session |
| DevTools → Application → Local Storage | There is **no** `o2q-` key holding `/config`. It is memory-only **by design** (the payload carries the RUM client token) |

### 2.1a New-deploy detection (build version checker)

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

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

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Top navbar → Organization dropdown → pick a different organization

| Check | Expected |
| --- | --- |
| Before switching, note the `o2q-` keys in Local Storage for org A | They exist |
| Switch to org B, then re-inspect Local Storage | **Org A's `o2q-` keys are gone.** Org B's start appearing |
| Visit Streams, Dashboards, Alerts in org B | You see **org B's data only**. Never a row from org A |
| Switch back to org A within a couple of minutes and open a list you had open | Rows paint instantly from memory (the in-memory cache is deliberately kept across an org switch — only the on-disk copy is purged) |
| DevTools → Application → IndexedDB → `o2Cache` → `kv` | No entries left whose key contains org A's identifier |

> **Expected quirk — do not file this as a bug.** After one round trip (A → B → A), you
> will find **no `o2q-` keys for either org**. That is the design, not a purge failure:
>
> 1. Switching away deletes the leaving org's localStorage keys but **keeps its in-memory
>    entries** — deliberately, so switching back costs no requests.
> 2. The persister only writes **after the query function actually runs**
>    (`persistQuery` sits after `await queryFn(ctx)` in the library).
>
> So on re-entry the memory copy is still fresh → no fetch → nothing re-written to disk.
>
> | Step | In-memory | localStorage |
> | --- | --- | --- |
> | Start in org A | fetches | ✅ A's keys |
> | → org B | A kept | A's deleted · ✅ B's keys |
> | → back to A | A still fresh, **no fetch** | B's deleted · ❌ A's **not** re-written |
> | → B again | B still fresh, **no fetch** | ❌ nothing |
>
> **To prove it:** switch away, **wait > 5 minutes** (the config-tier window these
> persisted queries use), switch back, open Dashboards. The entries go stale, refetch, and
> the keys reappear. If they do **not** reappear after a stale refetch, *that* is a bug.
>
> Consequence worth knowing for §2.4: any org you bounce away from and back to inside
> 5 minutes loses its reload-persistence until something refetches. See §24 item 12.

### 2.3 Logout — nothing may survive

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Top-right user avatar → **Sign Out**

| Check | Expected |
| --- | --- |
| Before logging out, confirm `o2q-*` keys exist in Local Storage and `o2Cache` / `o2FieldValues` have entries in IndexedDB | They do |
| Sign out, then inspect the Application tab again | **All** `o2q-*` localStorage keys gone; `o2Cache` and `o2FieldValues` emptied |
| Log in as a **different user** | No list anywhere shows the previous user's data, even for a flash |
| **Field-value residue after logout** (known issue — see §24 item 6) | As user A, expand a field on a stream in Logs. Sign out **without reloading the browser**. Log in as user B, who is restricted from that stream, in the **same org**, within 60 seconds. Type that field name → `=` in the Logs editor  ·  ⚠️ User B may still be offered A's cached values. Logout is a route change, not a page reload, so the in-memory field-value cache survives its 60-second TTL. **A full browser reload clears it.** Confirm the blast radius and report what you see |

### 2.4 Reload persistence

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Streams (or Dashboards → any folder) → press F5

| Check | Expected |
| --- | --- |
| Reload the page while sitting on Streams | The stream list paints from `localStorage` **before** any request completes, then revalidates in place |
| Reload while sitting on a Dashboard with panels | Panels restore their last results from IndexedDB **without re-running the queries** |

---

## 3. Streams

**UI path:** Left sidebar → **Streams**

**Scope:** the two check tables below, then this page's own rows.

#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **3 (page + next-page prefetch + `/summary`)** request(s) |
| C2 | Go to another module, come **straight** back (within **30 s**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **30 s**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a stream, save | Back on the list, the stream is **already there** — no manual refresh |
| C7 | Delete a stream → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Steps | Expected |
| --- | --- | --- |
| **Pagination is warm** | Watch Network across: land → page 2 → page 3 → back to page 1 | See the request table below. The key property: **the page you land on is never fetched after the first time** — the one request you see is always warming the page *ahead* |
| Sort does not double-request | Click a column header to sort | **2 requests, and they must have DIFFERENT offsets** — browser-verified: `offset=0&sort=name&asc=false` (re-sorted page 1) + `offset=20&…&asc=false` (prefetch of re-sorted page 2). Sorting resets to page 1, so it behaves like a fresh cold load. **The bug to watch for is two requests with the SAME `offset=0` and identical params** — that was the old double-fire, where the sort handler and the watcher both triggered a load |

**Expected request count per action** (54 streams, page size 20 → 3 pages). This branch
prefetches page N+1 after **every** page load, so the counts are not what you might guess:

| Action | Requests | What they are |
| --- | --- | --- |
| Land on Streams (cold) | **2** | page 1 · **+ prefetch of page 2** |
| → page 2 | **1** | page 2 served from cache · + prefetch of page 3 |
| → page 3 | **1** | page 3 from cache · + prefetch of page 4 (none here, so may be 0 on the last page) |
| → back to page 2 | **0** | cached, and page 3 still fresh so no prefetch |
| → back to page 1 | **0** | cached, and page 2 still fresh |

> **Two requests on first landing is CORRECT, not a bug.** `main` has no prefetching at
> all (verified: zero `prefetch` occurrences in its `LogStream.vue`) and fires one. The
> extra upfront request buys instant forward paging. Compare against main and you will see
> 1-1-1-1 there versus 2-1-0-0 here — main re-fetches every page every time, including
> pages you have already visited.
| Stream type tabs | Switch Logs → Metrics → Traces → back to Logs | Returning to a tab you have already loaded issues no request |
| **Delete a stream (the key one)** | Delete a stream → confirm → navigate to Dashboards → come back to Streams | The deleted stream is **gone and stays gone**, including on page 2 and under a search filter. It must not flash back |
| Deleted stream leaves dropdowns | After deleting, open Logs → stream selector; open Alerts → New Alert → stream dropdown | The deleted stream is **not** offered |
| Refresh stats button | Streams → **Refresh Stats** button | Issues a request; the table keeps its rows |

**Storage note — measured.** The stream *name list* (used by every stream dropdown in the
app) is persisted to `localStorage` under
`o2q-["org","<org>","streams","nameList","logs"]`.

Measured on a live instance: **781 bytes per stream** (53 streams → 41.4 KB). So this key
alone would need roughly **6,700 streams in one org** to exhaust a 5 MB budget. Real, but
not near-term for most deployments.

It is **not the biggest** entry, though — the SQL-editor function catalogue
(`…"functions","queryFunctions"`) measured **68.8 KB**, larger than the stream list. Total
across all persisted keys on a normal org: **~110 KB**, comfortably inside budget.

If the budget is ever exceeded the app swallows the error and silently stops persisting —
no crash, but reload-persistence quietly stops working. To check your own totals:

```js
Object.keys(localStorage).filter(k => k.startsWith('o2q-'))
  .map(k => ({ key: k, kb: +(localStorage[k].length/1024).toFixed(1) }))
  .sort((a,b) => b.kb - a.kb)
```

---

## 4. Logs

**UI path:** Left sidebar → **Logs**

> **Run the rows in this section only — NOT C1–C8.** Logs is a search page, not a cached
> list: there is no row table to cache, nothing to delete, and no list Refresh button. The
> universal checklist does not apply here. What is cached on Logs is the surrounding
> furniture — saved views, functions, actions, field values — and each has its own row.
>
> The log **search itself is deliberately NOT cached** — see §17.

| Surface | UI path | Check | Expected |
| --- | --- | --- | --- |
| Saved views | Logs → **Saved Views** dropdown in the search bar | Open, close, reopen | Second open issues no request |
| Saved views write-through | — | — | The new view is listed without a manual refresh |
| Functions in the search bar | Logs → **Functions** dropdown | Open it, then go to Pipelines → Functions and back | The list is shared — one cache entry, not two requests |
| SQL editor function catalogue | — | — | **One** request to `/query_functions` the first time; **zero** on reopening the editor; **zero** after F5 (it is persisted to localStorage). Payload is large — 356 functions on a typical backend — so not re-fetching it per page load is the real win |
| Missing catalogue is remembered | — | ⚠️ **Skip — not testable on a current backend** | Only applies where `/api/{org}/query_functions` is absent (404). Check with `curl -u <email>:<passcode> <url>/api/<org>/query_functions`; a **200 means this row does not apply** |
| Action scripts (enterprise only) | Left sidebar → **Logs** — the list loads on **page init**, not on menu open | Land on Logs fresh, then navigate to Streams and back | **One** request to `/api/{org}/actions` on first load; **zero** on return. Switching the search-bar transform selector from **Function** to **Action** fetches nothing — it filters an already-loaded list. Requires Enterprise/Cloud (`isActionsEnabled`) |
| Field values | — | **See §4.1** — it has its own section, because the cache spans nine surfaces beyond Logs and the reader/writer distinction matters | |

### 4.1 Field-value autocomplete cache — **not Logs-only**

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** thirteen surfaces across Logs, Traces, Dashboards, Alerts, SLOs, RUM, Metrics
and Pipelines — each is a row in the Writers / Readers tables below.

Field *values* (not field names) are captured once and reused everywhere. Stored in
IndexedDB `o2FieldValues` under `org | streamType | streamName | field`, behind a
60-second in-memory read cache.

> ## Read this before testing: writers never show cache hits
>
> This cache has a **fill** side and a **spend** side. Only the spend side is a cache test.
>
> | Direction | What it does | What you observe |
> | --- | --- | --- |
> | **WRITE** (fill) | Fetches values from the server, then stores them | **A request every single time**, including repeats |
> | **READ** (spend) | Looks values up in the store | **Zero requests** when captured earlier |
>
> **Writers do not consult the cache at all**, and that is deliberate: a sidebar shows
> value **counts scoped to your current time range** (`info 14, warn 13`), while the store
> keeps only the value names. Serving a sidebar from cache would show counts that are
> missing or wrong. The autocomplete needs only the names, so the store is enough there.
>
> **Expanding a sidebar field ten times = ten requests. Correct. Not a cache miss.**

### Writers — fill the cache (always fetch)

| Surface | UI path |
| --- | --- |
| Logs sidebar | Logs → left field sidebar → click the `›` beside a field |
| Logs Run Query | Logs → Run query — values harvested from result rows in the background |
| Traces sidebar | Traces → left field sidebar → expand a field |
| Pipelines (scheduled node) | Pipelines → open a pipeline → a scheduled node's query builder |

**What to check on a writer:** the request fires and **the store grows**. Nothing else.
Confirm in DevTools → Application → IndexedDB → `o2FieldValues`. Run Query specifically
must have **no visible effect on rendering** — its writes are scheduled on browser idle.

### Readers — spend the cache (should not fetch)

**This is where the caching is actually tested.** Each of these offers value suggestions
pulled from the shared store:

| Surface | UI path |
| --- | --- |
| **Logs query editor** | Logs → query editor → type `<field>=` |
| Traces query editor | Traces → query editor → type `<field>=` |
| Dashboard panel builder | Dashboards → open a dashboard → Add Panel → add a filter → open its value dropdown |
| Alert query builder | Alerts → New Alert → the query/condition builder |
| Anomaly detection config | Alerts → anomaly alert → config step |
| SLO builder | SLOs → Add SLO → the query builder |
| Function tester | Pipelines → Functions → Test Function |
| RUM error / session filters | RUM → Error Tracking or Sessions → a filter input |
| PromQL labels | Metrics → PromQL editor → type a label value |

**What to check on a reader:** values appear with **zero requests**.

### The test that matters — fill on one surface, spend on another

| # | Step | Expected |
| --- | --- | --- |
| 1 | Logs → set a time range that covers your data → expand `latency_ms` in the sidebar | One request (a writer — expected). Store now holds that field |
| 2 | Clear the Network tab | — |
| 3 | Click into the **query editor**, type `latency_ms=` | Values appear, **zero requests** ← **this is the caching test** |
| 4 | Repeat step 3 for `level=`, `code=`, `user=` | Same — values, no requests |
| 5 | Open a **dashboard panel filter** on the same stream/field | Same values, **zero requests** — one store serving two modules |

### Other checks

| Check | Steps | Expected |
| --- | --- | --- |
| Cold stream has no values | Type `<field>=` for a stream nobody has searched | **Empty is correct** — a cold cache, not a bug |
| Time range matters | Expand a field with a range that excludes your data | "No values found" is correct — widen the range first |
| Org switch purges | Switch org → check IndexedDB `o2FieldValues` | Previous org's entries gone; they do **not** come back on returning until something re-captures |
| Private browsing | Repeat in a private window | Suggestions work in-session, nothing persists, no console error |

---

## 4A. Metrics Explorer

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

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

**Scope:** each sub-section below states its own — see them individually.

### 5.1 Dashboard list and folders

**UI path:** Left sidebar → **Dashboards**

**Scope:** the two check tables below, then this page's own rows.

#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **4 (home_dashboard + folders + favourites + dashboards)** request(s) |
| C2 | Go to another module, come **straight** back (within **30 s**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **30 s**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a dashboard, save | Back on the list, the dashboard is **already there** — no manual refresh |
| C7 | Delete a dashboard → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Steps | Expected |
| --- | --- | --- |
| Folder switching | Dashboards → click folder A → folder B → back to folder A | Folder A returns instantly with no request |
| Folder list | Reload the page on Dashboards | The folder rail paints from `localStorage` before the request lands |
| **Refresh button actually refreshes** | Dashboards → Refresh icon | One request, every time. *This was a no-op before this branch* |
| **`r` shortcut** | Dashboards list → press `r` | One request. *Also previously a no-op* |
| **Delete a dashboard** | Dashboards → folder → delete a dashboard → confirm → go to Streams → come back to Dashboards | Deleted dashboard is gone **and stays gone**. *This was a shipped bug: it used to come back on the next visit* |
| Create a dashboard | Dashboards → **New Dashboard** → save | You land on the new dashboard; going back to the list shows it without a manual refresh |
| Move a dashboard between folders | Move a dashboard to another folder, then open both folders | Source folder no longer lists it; destination folder does |
| Favourites | Star a dashboard → reload the page **within 5 minutes** | 🐛 **KNOWN BUG — the star disappears.** Reproduced and confirmed: the server saves it, but `setQueryData` does not write through to localStorage, so the reload hydrates a stale empty list that is still "fresh" and never refetches. Wait past 5 min and it self-heals. See §24 item 16 |
| Home dashboard (org-wide pin) | **Dashboards** → a dashboard's row action (or open it → same action) → **Set as Home**. *Not in Settings — there is no such control there* | Click **Home**: that dashboard renders instead of the overview. Re-pin a different one → Home updates with no reload. Unpin → overview returns |
| Home dashboard survives reload | Pin a dashboard → press **F5 within 5 minutes** | ⚠️ **Expected to FAIL** — `setHomeDashboard` uses the same `setQueryData` pattern as the confirmed favourites bug (§24 item 16) on the same persisted `settingQuery`. If the pin is lost, that confirms Issue 10 affects both call sites — and this one is **org-wide**, so it is worse |

### 5.2 Dashboard panels — the IndexedDB result cache

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Dashboards → open a folder → open a dashboard → (panels render)

| Check | Steps | Expected |
| --- | --- | --- |
| **Panel results survive a revisit** | Open a dashboard, let panels render → navigate to Streams → come back to the dashboard | Panels **restore their previous results immediately and fire NO queries**. This is by design — a restored panel does not revalidate |
| Panel results survive reload | Open a dashboard, let panels render → press F5 | Panels restore from IndexedDB, no queries re-run |
| **Panel cache is really written** | DevTools → Application → IndexedDB → `o2Cache` → `kv` | Entries whose key contains `panels` and your folder/dashboard/panel ids. **The store must not be empty** — before this branch every write threw `DataCloneError` and the cache stayed empty. Also check the Console: **no `DataCloneError`** |
| Time range does **NOT** fork the cache | Open a dashboard → change the range → change it back | ⚠️ **Corrected expectation.** `getCacheKey()` holds only panelSchema + variables + dashboard/folder id — **the window is not in it**. There is **one entry per panel+variables**, so changing the range re-queries and changing back re-queries again. It is **not** instant |
| Duration matters, bounds do not | Load at Past 1 Week, then pick a **different** 1-week absolute window | **No ⚠ warning** — same duration, so the cached result is still shown while the new one loads. Pick a *different length* (24 h) and the panel raises `isCachedDataDifferWithCurrentTimeRange` until fresh data lands. This is the design: a week-long result stays usable for another week-long window, with "Last Refreshed" reporting its true age |
| Variables fork the cache | Change a dashboard variable, then change it back | Same — each variable combination has its own entry |
| **Deleting a panel drops its cache** | Dashboards → open a dashboard → Edit → delete a panel → save → inspect IndexedDB `o2Cache` → `kv` | That panel's entries are **gone**, not left behind to age out |
| Manual cache clear still works | Console: `await window._o2_removeDashboardCache()` then reload the dashboard | All panels re-run their queries |
| Inspect the cache | Console: `await window._o2_getDashboardCache()` | Returns an object keyed by folder → dashboard → panel |

### 5.3 Add / edit panel

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Dashboards → open a dashboard → **Add Panel** (or Edit on an existing panel)

| Check | Expected |
| --- | --- |
| Open Add Panel → the stream dropdown | **Opening it fires zero requests** — the option list comes from the cached stream list (browser-verified). But **selecting** a stream fires `GET /api/{org}/streams/{name}/schema` every time, including re-selecting the same one. That read is **deliberately un-migrated** (listed as backlog in `api-cache-inventory.md`), so a schema request per selection is expected today — it is not the list being re-fetched |
| Save a panel, return to the dashboard | The new panel renders; other panels keep their cached results |

### 5.4 Annotations

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Dashboards → open a dashboard → on a time-series panel, drag-select a range → **Add Annotation**

| Check | Expected |
| --- | --- |
| Add an annotation → close the dialog | The annotation appears on the panel without a manual reload |
| Edit / delete an annotation | The chart updates immediately |
| Reopen the dashboard | Annotations list is served from cache; one request at most |

### 5.5 Import dashboard

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Dashboards → **Import**

| Check | Expected |
| --- | --- |
| Import a dashboard JSON → go back to the list | The imported dashboard is listed without a manual refresh |

### 5.6 Dashboard picker dropdown (used outside the Dashboards module)

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

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

**Scope:** each sub-section below states its own — see them individually.

### 6.1 Alerts list

**UI path:** Left sidebar → **Alerts**

**Scope:** the two check tables below, then this page's own rows.

#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **3 (alerts + destinations + templates)** request(s) |
| C2 | Go to another module, come **straight** back (within **30 s**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **30 s**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a alert, save | Back on the list, the alert is **already there** — no manual refresh |
| C7 | Delete a alert → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Steps | Expected |
| --- | --- | --- |
| **Search survives refresh** | Alerts → type a name in the in-folder search → press Refresh (or `r`) | The search term **and** the filtered rows are preserved. *This was broken — refresh used to drop the search* |
| **Refresh button re-enables** | Click Refresh, wait for it to finish, click Refresh again | The button becomes clickable again after the first load. *It used to stay disabled* |
| Folder switching | Switch alert folders back and forth | Returning to a folder is instant |
| Alert type filter | Switch between alert types | Each filter combination caches separately |
| **Delete an alert** | Delete → confirm → navigate away → come back | Row gone and stays gone. Also open the deleted alert's detail if you have a link to it — it must **not** serve a cached copy |
| Enable / disable an alert | Toggle an alert | The row's state updates immediately, no manual refresh |

### 6.2 Alert create / edit

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Alerts → **New Alert** (or click an existing alert → Edit)

| Check | Expected |
| --- | --- |
| Opening the form | **2 requests only** — `/folders/alerts` and `/workflows`. Browser-verified. No destinations, templates or streams request: those come from cache. (The `/workflows` call is issue #15 — the workflow dropdown bypasses the cache) |
| Destination dropdown | **0 requests**, fully populated — browser-verified |
| Stream dropdown | **0 requests**, populated from the cached stream list — browser-verified |
| Template dropdown | ⚠️ **There is no template dropdown on the alert form.** Templates are chosen when creating a *destination*, not an alert — test that in §6.3. Skip this row |
| Create a **new destination** from inside the alert form | ⚠️ **"Add Destination" opens a NEW BROWSER TAB**, not a dialog (`window.open(url, "_blank")` in `AlertDestinationsField.vue`). The new tab has its own query cache, so a destination created there does **not** appear in the original tab by itself. That is what the **↻ Refresh latest Destinations** button beside it is for. Expect: create in the new tab → switch back → click ↻ → it appears |
| Save the alert → back on the list | The alert is there without a manual refresh — verified via the clone path in §6.1 C6 (`POST` then automatic refetch) |

### 6.3 Alert destinations

**UI path:** Left sidebar → **Alerts** → **Destinations** tab

Run **C1–C8** (note C5 `r` — this was one of the broken shortcuts).


#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **2–3 requests** — destinations + the dependency-graph alert read, plus templates *only if its persisted entry has gone stale*. Browser-verified at 2. **Note: a hard reload does NOT clear localStorage**, so persisted queries survive it and the cold count is often lower than a truly empty cache would give. For a genuine cold read, log out first or clear site data |
| C2 | Go to another module, come **straight** back (within **5 min**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **5 min**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a destination, save | Back on the list, the destination is **already there** — no manual refresh |
| C7 | Delete a destination → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Expected |
| --- | --- |
| Create a destination → the list | New row present without manual refresh |
| Delete a destination → navigate away → return | Gone and stays gone |
| Open **Alerts → New Alert** afterwards | The deleted destination is not offered |
| **Import a destination** — Alerts → Destinations → **Import** → paste/upload JSON → import | The imported destination is in the list **without a manual refresh**, and is offered in the alert form's dropdown |

> ✅ **Security check — verified fixed (2026-08-26).** Destination payloads can carry webhook
> `Authorization` headers, PagerDuty routing keys and Opsgenie/ServiceNow credentials.
> `destinationsQuery` is now **memory-only** — no persister — so none of that reaches disk.
> Confirmed in the browser: with 32 destinations on screen there is **no**
> `o2q-["org","<org>","alerts","destinations",…]` key in localStorage, and a forced refresh
> does not create one. Re-check with:
>
> ```js
> Object.keys(localStorage).filter(k => k.startsWith('o2q-') && /destinations/.test(k))
> // expected: []
> ```

### 6.4 Alert templates

**UI path:** Left sidebar → **Alerts** → **Templates** tab

Run **C1–C8** (including the `r` shortcut).


#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **2** — destinations + the dependency-graph alert read (both feed the “Used by” column). **The template list itself is served from localStorage**, so it fires nothing. Browser-verified request(s) |
| C2 | Go to another module, come **straight** back (within **5 min**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **5 min**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a template, save | Back on the list, the template is **already there** — no manual refresh |
| C7 | Delete a template → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Expected |
| --- | --- |
| Create / edit / delete a template | List updates without a manual refresh; deleted template stays gone across navigation |
| Open a destination form afterwards | Template dropdown reflects the change |
| **Import a template** — Alerts → Templates → **Import** → paste/upload JSON → import | The imported template is in the list **without a manual refresh** |
| **Template preview panel** — Alerts → Templates → open a template → Preview | The destination list it needs comes from cache — no extra request if you were recently on the Destinations page |

### 6.5 Alert history / evaluation history

**Scope:** run **C1–C4** plus the rows below. **C5 does not apply** — the alert-detail route registers no keyboard shortcuts (no registry entry; neither `AlertEvaluationHistory.vue` nor `AlertHistory.vue` calls `useShortcuts`), so `r` doing nothing there is correct, not a bug. C6–C8 are skipped — no create/edit/delete or search filter on these surfaces.

**UI paths — corrected, browser-verified:**
- **Alerts → click an alert → the "Alert History" tab.** The tab is labelled *Alert History*, not "History"; the alert detail page has exactly two tabs, *Alert History* and *Configuration*. This is the surface most users reach.
- **Home → Overview → the Anomalies section → "Investigate" on a row.** The history **drawer** lives on Home Overview, **not** on the alert detail page. The button sits inside `v-for="item in anomalies"`, so the section only renders when `anomalies.length > 0`. ⚠️ **Blocked without anomaly-detection data** — with none configured the Overview shows *"All systems clear"* and there is no row to click, so the drawer cannot be reached. Verify with `GET /api/{org}/anomaly_detection`; an empty `[]` means skip this surface.
- **Alerts → Alert History page** — ⚠️ **no UI path; URL only:**
  `http://localhost:8081/web/alerts/history?org_identifier=default`

| Check | Expected |
| --- | --- |
| Open the same history from all three surfaces | ⚠️ **They do NOT share a cache entry — corrected.** The three surfaces request different page sizes (standalone **20**, alert-detail History tab **25**, drawer different again), and `size` is part of the query key, so each keeps its own entry. Browser-verified: the detail tab fires `from=0&size=25` even right after the standalone page has loaded `size=20`. **Expect one request per surface**, not a shared hit |
| Change the time range | ✅ **Browser-verified — each range keeps its own entry, and returning to a range you already used costs 0 requests.** Measured: pick **15 m** → **2** requests (page 1 + prefetch); pick **1 h** → **2** (new range, cold); switch **back to 15 m** → **0**, the table repaints instantly. The two windows sit in the key as separate entries (`15m@1787814960000000` vs `60m@1787812260000000`), so neither overwrites the other |
| ⏱️ **Why you may still see requests when you switch back** | **Not a cache miss — the range is quantized to a 60-second bucket.** `alertHistoryQuery` runs `quantizeRange(start, end)` with `bucketMs = 60_000`, because a relative range is anchored to a raw `now` and would otherwise mint a fresh key on every open. Consequence for testing: **do the A → B → A round trip inside the same wall-clock minute.** A minute later the bucket has advanced, the key legitimately changes, and you get 2 requests again. That is correct behaviour |
| Refresh — **standalone Alert History page** | ✅ **Browser-verified:** exactly **1** request (`from=0&size=20`), and **rows stay on screen** — row count sampled 14× during the fetch never left 20, zero skeleton placeholders. This surface splits the two states correctly: `loading = historyList.isLoading` (skeleton, cold read only) vs `fetching = historyList.isFetching` (button spinner) |
| Refresh — **alert-detail "Alert History" tab** | ⚠️ **Expect the table to blank to a skeleton — this is normal here, not a cache failure.** Browser-verified: rows drop **25 → 0** with 50 skeleton placeholders for ~300 ms, then repaint. `AlertEvaluationHistory.vue` drives `:loading` from a plain `ref(false)` flipped around *every* fetch, so it cannot tell a cached read from a network one. **Identical on `main`** — the branch did not introduce it. Judge this row by the request count (**1**), not by the skeleton |
| Return to a page you already visited — **alert-detail tab** | ✅ **Browser-verified: 0 requests AND no skeleton at all.** Page 1 → 2 fires 1 request and blanks; page 2 → back to 1 fires **0** and never blanks (the cached read resolves before Vue paints). This is the cleanest proof the cache is working on this surface |
| Alert History tab → **Configuration** → back to Alert History | ⏱️ **Depends on how long you take — both answers are correct.** Browser-verified on the alert-detail page: round trip completed while the data is **< 30 s old → 0 requests**; the same round trip after the data is **> 30 s old → 1 request**. This is the **30-second `staleTime`**: `alertHistoryQuery` sets none, so it inherits the global `DEFAULT_STALE_TIME = 30_000`. Reading the Configuration tab normally takes longer than 30 s, which is why it looks like it refetches *every* time. **To test the cache, do the round trip in under 30 s.** |
| C2 warm revisit — **standalone page** (leave via *Back to Alerts*, return via browser Back) | ✅ **Browser-verified 0 requests** when the return lands in the **same minute bucket as the cold load**. ⚠️ The constraint is the *load* time, not the last refresh: remounting the page recomputes the relative window from `Date.now()`, so if ≥ 60 s has passed since the page first loaded, the remount mints the next bucket and you get **2** requests (page 1 + prefetch). Measured both ways: return at load+5 s → **0**; return after the bucket rolled → **2**, with two keys exactly 60 s apart in the URL |
| Why the refetch is so visible on this tab but not the standalone page | Both surfaces have the same 30 s `staleTime` and both refetch when stale. The standalone page keeps its rows on screen while it revalidates, so you never notice; the alert-detail tab blanks to a skeleton, so the same refetch is obvious. That difference is the pre-existing loading-flag behaviour, not a difference in caching |
| Paginate — **standalone Alerts → Alert History page ONLY** | **Cold load fires 2** (page 1 + prefetch of page 2), then **1** per page change — the page you land on is cached, the request warms the page *ahead*. Same pattern as Streams, see §1.1. **Requires more than one page of data in the selected time range**; with ≤ 20 records in range there is no next page, so **1 request is correct** |
| Paginate — **alert-detail History tab and the History drawer** | These two do **NOT** prefetch. Expect **1** request per page, always. Do not apply the prefetch expectation here |

> ⚠️ **Watch the record total while testing.** If any alert in the org fires on a short
> frequency, new history rows land continuously and the `of N` total drifts between checks
> (observed 373 → 719 → 360 across three range switches during verification). A changed
> total is the data moving, **not** the cache failing — compare request *counts*, not totals.

**Browser-verified** on a live instance (56 history records, 3 pages) — use these as the
reference numbers. Note the two surfaces even use different page sizes:

| Surface | Page size | Request seen | Count |
| --- | --- | --- | --- |
| **Alerts → Alert History** (standalone page) | **20** | `from=0&size=20` **+ `from=20&size=20`** | **2** |
| **Alert detail → History tab** | **25** | `from=0&size=25` only | **1** |

Paging on the standalone page, measured:

| Action | New requests | What they are |
| --- | --- | --- |
| Cold load | **2** | page 1 (`from=0`) + prefetch of page 2 (`from=20`) |
| → page 2 | **1** | page 2 served from cache; the request prefetches page 3 (`from=40`) |
| → page 3 (last page) | **0** | already prefetched, and no page 4 exists to warm |

> **⚠️ The standalone page has NO UI path — it is unreachable by clicking.** Verified
> exhaustively: `AlertList.vue` defines `goToAlertHistory()` and returns it, but no
> template element binds it; the only other entry is the **Alert Insights** page, whose
> own entry point (`goToAlertInsights()`) is likewise defined, returned and bound to
> nothing. There is no sidebar item, tab or link to either. Reach it only by URL:
>
> ```
> http://localhost:8081/web/alerts/history?org_identifier=default
> ```
>
> **So every alert-history surface a user can actually click to fires ONE request and
> never prefetches.** If you are testing by clicking, one request is always correct here.
> See §24 item 14 — two routed pages with no way in is worth raising on its own.

### 6.6 Incidents

**Scope:** run **C1–C5** plus **C8**, and the rows below. ⚠️ **C6 and C7 do not apply** — incidents are generated by the backend, so the page has no create or delete affordance; status and severity changes are edits (`PATCH …/update`). Browser-verified.

**UI path:** **Left sidebar → hover Reliability → Incidents.**

> Requires the backend flag **`O2_INCIDENTS_ENABLED=true`** (enterprise config
> `o2cfg.incidents.enabled`; the frontend reads it as `zoConfig.incidents_enabled`). With it
> off, `MainLayout.vue:648` never splices the link in and **both Incidents and External Alert
> Sources (§6.7) vanish from the Reliability flyout** — they share `requires: "incidentList"`.
> Verify with `store.state.zoConfig.incidents_enabled`, or
> `curl -su <user> localhost:5080/api/default/config | grep incidents_enabled`.
> ⚠️ The unauthenticated `/config` no longer carries the flag — use `/api/{org}/config`.
> Note it is a **flyout child of Reliability**, not a tab under Alerts.

**Seeding data.** Incidents have no create endpoint — the backend mints one when an alert
with `creates_incident: true` breaches. **One alert produces one incident**, not one per
dimension value (verified: a single alert matching every service produced a single incident,
not one per service). So for N rows you need N alerts. Recipe: ingest `level=error` rows for
N distinct services into a stream, create one alert per service filtered to it, wait ~90 s,
then **disable the alerts** so the counts stop moving mid-test.

**Browser-verified end to end with 33 incidents (30 Active / 3 Resolved, 2 pages at page
size 20):**

| # | Check | Result |
| --- | --- | --- |
| C1 | Cold read | ✅ **1** — `GET /api/v2/{org}/alerts/incidents?limit=1000&offset=0`, confirmed via CDP after clearing the entry |
| C2 | Warm revisit < 30 s | ✅ **0** — measured with the entry verified 5 s old |
| C3 | Stale revisit > 30 s | ✅ **1**, and the table **never blanked** — sampled 16× during the refetch, rows held at 20, zero skeleton placeholders |
| C4 | Refresh button | ✅ **1** every time, **rows stay on screen** — 14 samples, no blank, no skeleton |
| C5 | `r` shortcut | ✅ **1** — real keypress. This page *does* register the shortcut (unlike §6.5) |
| C6 / C7 | Create / edit / delete | ❌ **Not applicable** — no create or delete affordance; incidents are backend-generated. Status changes are edits (`PATCH …/update`) |
| C8 | Search survives Refresh | ✅ Term preserved after Refresh |
| — | **Pagination** page 1 → 2 | ✅ **0 requests** |
| — | **Pagination** page 2 → back to 1 | ✅ **0 requests** |
| — | Status filters Active / Resolved / All | ✅ **0 requests** each, and the summary tiles recount correctly (Active `30 Total`, All `33 Total`, Resolved `3 Total`) |
| — | Severity tiles P1 / clear | ✅ **0 requests**; P1 narrowed to 7 rows |
| — | Search box | ✅ **0 requests** — client-side; `queue` narrowed 20 → 1 |
| — | Row click → incident detail | **3** requests, all detail-scoped: `…/{id}`, `…/{id}/events`, `…/{id}/rca/history` |
| — | Detail → back to the list | ✅ **0 requests**, list still cached |

**Why paging and filtering are free:** the query fetches `limit=1000` **once** and the
component paginates client-side (`:data="visibleIncidents"`, a search → status → severity
computed chain; no `pagination="server"`). One cache entry backs every page, filter and sort.
⚠️ The flip side is a **silent cap at 1000** — see §24. Pre-existing: `main`'s
`IncidentList.vue:550` already had `const limit = 1000`.

**Cache policy** — `staleTime` **30 s**, `gcTime` 5 min, `refetchOnWindowFocus: true`.
Key: `["org","<org>","incidents","list",{"limit":1000,"offset":0}]` — the status filter is
**not** in the key, which is why switching tabs costs nothing.

**Persistence: memory-only.** Verified against *both* stores — no `o2q-…incident…` key in
localStorage **and** none in IndexedDB (`o2Cache/kv`). Closing the tab always yields a cold read.

**Loading states are wired correctly here:** `loading = incidentsList.isPending` (skeleton,
cold read only) and `fetching = incidentsList.isFetching` (button spinner) — the same correct
split as the standalone Alert History page, and the opposite of the alert-detail tab in §6.5.

> ⚠️ **Two measurement traps on this page.** (1) `performance.getEntriesByType('resource')`
> silently drops entries once its 250-entry buffer overflows on this SPA — it reported **0**
> incident requests on a cold load that CDP showed as **1**. Use the Network panel, not
> resource timing. (2) A C2 that returns 1 usually means the entry had already aged past 30 s
> during earlier steps — click **Refresh** immediately before navigating away.
⚠️ **Ignore the C1–C8 table further down this section** — it is the generic template. The
table above supersedes it for this page: C6/C7 do not apply, and the C1 count is
cache-state-dependent.

Run **C1–C5**. Plus:


#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **1** request(s) |
| C2 | Go to another module, come **straight** back (within **30 s**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **30 s**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a incident, save | Back on the list, the incident is **already there** — no manual refresh |
| C7 | Delete a incident → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Expected |
| --- | --- |
| Switch status filters (Open / Acknowledged / Resolved) | Each status caches separately; going back to a status you already viewed is instant |
| Paginate | Page changes keep the table populated — no blank flash between pages |

### 6.7 External alert sources

**Scope:** run **C1–C8** — ⚠️ **corrected: C6–C8 all apply here.** The page has an **Add source** button (`alert-sources-add-btn`), a per-row **Delete** (`alert-sources-delete-<id>`) and a **search box** (`alert-sources-search-input`), plus per-row Edit, Rotate token, Toggle enabled, Copy token and Reveal URL. The earlier "no create/edit/delete or search filter" scope was wrong.

**UI path:** **Left sidebar → hover Reliability → External Alert Sources.**

> ⚠️ **Not "Alerts → Sources"** — there is no such tab. It is a **flyout child of Reliability**,
> gated on the same **`O2_INCIDENTS_ENABLED=true`** flag as Incidents (§6.6); with the flag off
> the entry is absent entirely. Direct URL is **`/web/alert-sources`** — note the **hyphen**;
> `/web/alert_sources` returns 404.

**Seeding data:** `POST /api/v2/{org}/incidents/integrations` with
`{"name":"…","source_type":"auto","destinations":[]}`. Every org already has one
auto-created source named `default`, which **cannot be deleted** (its Delete button is
disabled and explains why — it is the fallback for senders without their own source).

### ⚠️ Read this before judging any request count on this page

**The list query is cached; the per-row status fan-out is not.** On mount and on every
refresh the page issues **one `/senders` request per row** on top of the list read.
Browser-verified with 23 sources:

| Action | List reads | `/senders` reads | **Total** |
| --- | --- | --- | --- |
| C1 cold load | 1 | 23 | **24** |
| C2 warm revisit (entry 6 s old) | **0** | **23** | **23** |
| C4 Refresh button | 1 | 23 | **24** |
| C5 `r` shortcut | 1 | 23 | **24** |

So the plan's generic **"C2 → 0 requests"** is **false on this page** — the list is free, but
23 requests still go out. Judge C2 here by the **list** count only, and expect the fan-out.

**Attribution:** the fan-out is **pre-existing** — `main`'s `ExternalAlertSourcesList.vue`
calls `listSenders` per row at lines 556/572, identical to the branch at 578/594. What is
specific to this branch is that `alertSourcesQuery` caches the **single cheap** list call and
leaves the **N expensive** ones uncached, so migrating this page removed 1 request out of 24
(~4%). There is no `senders` entry in `alert_sources.querykeys.ts` at all.

**Browser-verified results (23 sources, 2 pages at page size 20):**

| # | Check | Result |
| --- | --- | --- |
| C1 | Cold read | ✅ 1 list read (+23 senders — see above) |
| C2 | Warm revisit < 30 s | ✅ **0 list reads** (+23 senders). Measured with the entry verified 6 s old |
| C3 | Stale revisit > 30 s | ✅ 1 list read, and the table **never blanked** — 16 samples, rows held at 20, zero skeletons |
| C4 | Refresh button | ✅ 1 list read, **rows stay on screen**, no skeleton |
| C5 | `r` shortcut | ✅ Works — real keypress, 1 list read. The shortcut fix holds |
| C6 | Create → row present without manual refresh | ✅ 1 `POST`, then **1 automatic list refetch**; the new row appears on the list unaided. Toast *"Alert source created"* |
| C7 | Delete → away → straight back | ⚠️ **The Delete button cannot be clicked — it is clipped off the row.** The Actions cell is a fixed **160px** with `overflow:hidden` but its 5 buttons need **176px**, so Delete (the 5th) is cut off, and the table has no horizontal scroll to reach it. `elementFromPoint` at its centre returns the scroll container, not the button. Root cause: `meta: { actionCount: 4 }` in `SloList.vue:661` while the row renders **5** buttons — **pre-existing, identical on `main`** (introduced by `0cfa518433`), so not filed against this branch. **Workaround:** delete via `DELETE /api/{org}/slos/{id}`, then do the UI half — Refresh, row gone, navigate away, come straight back, **row must still be gone**. The caching half was verified that way: 1 `DELETE`, 1 refetch, gone immediately and still gone on return |
| C8 | Search then Refresh | ✅ Term **preserved**, filtered rows preserved (`grafana` → 1 row, still 1 after Refresh) |
| S1 | Sort a column | ✅ **0 requests**. Only **Name** is sortable; cycles asc → desc → unsorted. No blank, **no double-fire**. ⚠️ The sort handle is `o2-table-th-sort-trigger`, **not** the `th` — clicking the header cell itself does nothing |
| S2 | Page forward, then back | ✅ **0 requests** each way; page 2 shows the remaining 3 rows |
| S3 | Bulk action | ❌ **N/A** — no row checkboxes and no bulk affordance |
| S4 | Search with no matches | ✅ Proper empty state: *"No alert sources found"*. Not a spinner, not stale rows |
| S5 | Clear the search | ✅ Full list returns, **0 requests** |
| S6 | Export / download | ❌ **N/A** — this page offers no export |

**🔐 Security check — passed.** Every source carries a bearer token (`o2iat_…`) in its webhook
URL. Verified it never reaches disk: **no** `o2q-…integration…` key in localStorage, **no**
`o2iat_` string anywhere in localStorage, and **none** in any IndexedDB store (all 4 scanned).
The table also **masks** the token in the URL column (`o2iat_****abcd`) behind explicit
*Reveal full URL* / *Copy token* actions. Same standard destinations were held to in issue #10.
⚠️ When you test Reveal/Copy yourself, do not paste the result anywhere that gets committed.

**Cache policy** — `staleTime` **30 s** (global default), `refetchOnWindowFocus: true`.
Key: `["org","<org>","alert-sources","list"]`. Persistence: **memory-only**.



#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **1** request(s) |
| C2 | Go to another module, come **straight** back (within **30 s**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **30 s**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a source, save | Back on the list, the source is **already there** — no manual refresh |
| C7 | Delete a source → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Steps | Expected |
| --- | --- | --- |
| **`r` shortcut reaches the server** | Click empty page area, press `r` | One request. *This was one of the ten `r`-shortcut fixes — it used to do nothing* |
| Refresh button | Click Refresh | One request; rows stay on screen |
| Warm revisit | Navigate away and back within 30 s | Zero requests |

### 6.8 Dependency graph

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** ⚠️ **Corrected — "Alerts → select an alert → Dependencies" does not exist.**
The Alerts page has **no dependency entry point whatsoever**: browser-verified that it exposes
no control, tab or `data-test` matching *depend / usage / impact / graph*, and `AlertList.vue`
imports only `invalidateDependencyGraphCache` — it never calls `useDependencyGraph()`.

The real paths, both browser-verified:

- **Alerts → Destination Templates → the "Used by" cell on a row** (e.g. `3 destinations · 68 alerts`)
- **Alerts → Destinations → the "Used by" cell on a row**

Clicking that cell opens the impact dialog. `DependencyImpactDialog.vue` is rendered **only**
by `DependencyUsageCell.vue`, which those two lists embed — there is no third surface.

⚠️ **The row's Delete button is _not_ the impact dialog.** Deleting an in-use template shows a
plain *"Are you sure you want to delete template?"* confirm with no dependency list at all
(verified on `cachetest_tmpl1`, in use by 3 destinations and 68 alerts). Only the **Used by**
cell shows impact.

| Check | Result |
| --- | --- |
| Open the dependency view from each surface | ✅ **They share one cached read.** Measured: landing on **Destinations** fires **2** (`alerts?include_dependencies=true` + `alerts/templates`) and **0** for destinations — that list was already cached by the Alerts page. Switching to **Templates** fires **0**. Opening the **impact dialog** fires **0**. So the graph is read once per org and reused everywhere |
| Delete something with dependencies | ✅ **The dialog lists them in full.** `cachetest_tmpl1` → *"Used by 3 destinations · 68 alerts"* with every dependent named, each row carrying its own **open** and **delete** action (`dependency-impact-open-<name>`, `dependency-impact-delete-<name>`) |
| After deleting, the affected lists refresh | ✅ Deleting a dependent alert from inside the dialog fired **1 `DELETE`** and **0 graph refetches** — the count updated **68 → 67 live in the open dialog**, and the Templates list cell behind it changed to `3 67` with no request. Returning to the Alerts list refetched once, the row was gone and the total read **67** |

**Why the graph is read once.** `useDependencyGraph` pulls all three lists through the query
cache rather than the services, so it reuses whatever the page it was opened from already
fetched:

```ts
const [alerts, destinations, templates] = await Promise.all([
  queryClient.fetchQuery(alertDependenciesQuery(org)),
  queryClient.fetchQuery(destinationsQuery(org, "alert")),
  queryClient.fetchQuery(templatesQuery(org)),
]);
```

On top of that sits a **module-level graph cache** with a 5-minute TTL
(`GRAPH_TTL_MS = 300_000`), which is why the second and third surfaces cost literally nothing —
they do not even reach the query cache. Mutations call `invalidateDependencyGraphCache()`, and a
delete made from the dialog folds itself in via `applyDependencyDeletion()` instead of
refetching, which is what makes the 68 → 67 update instant.

**Testing note:** because of that 5-minute module cache, a *second* pass through these surfaces
will show 0 requests even on the first one. To measure the cold path again, hard-reload first.


### 6.9 Anomaly detection

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

⚠️ **There are TWO different surfaces here and they use DIFFERENT queries.** The rows below
describe the Overview one; the UI path in the old text pointed at the other.

| Surface | UI path | Query it uses |
| --- | --- | --- |
| **Anomaly config list + history** ← what these rows test | **Home → Overview** | `anomalyConfigsQuery` + `anomalyHistoryQuery` (`/api/{org}/anomaly_detection[/history]`) |
| **Anomaly alert rows** | **Reliability → Alerts → Anomalies tab** | `alertsListQuery` with `alert_type=anomaly_detection` — **not** the anomaly endpoints |

Browser-verified: `OverviewTab.vue` is the **only** consumer of both anomaly queries. The
Anomalies tab fires `GET /v2/{org}/alerts?…&alert_type=anomaly_detection` and never touches
`/anomaly_detection`.

**Seeding data.** Both surfaces are empty until at least one anomaly config exists, and
**history is short-circuited when there are none** — `loadAnomalies` does
`if (!configs.length) { anomalies.value = []; return; }`, so `anomalyHistoryQuery` never runs
on an empty org. Create one with `POST /api/v2/{org}/alerts` and `alert_type:
"anomaly_detection"` plus an `anomaly_config` block. ⚠️ `histogram_interval` and
`schedule_interval` are **strings** (`"5m"`, `"15m"`) — passing integers returns HTTP 422.

**Browser-verified with 3 configs seeded:**

| Check | Result |
| --- | --- |
| Open the anomaly config list, navigate away and back | ✅ **Cached.** Cold read fires **2** — `GET /{org}/anomaly_detection` + `GET /{org}/anomaly_detection/history?limit=20`. Leaving to another module and returning **within the window fires 0**. A return after the 30 s window fires 1 (the config list), which is correct, not a miss |
| Anomaly history — cached per limit | ✅ The limit is **in the key**: `["org","<org>","anomalyDetection","history",20]`. A different limit is a separate entry. ⚠️ **Not exercisable from the UI** — `OverviewTab` hardcodes `limit: 20`, so there is no control that varies it. Verify by reading the key, not by clicking |
| Anomaly history — refresh forces | ✅ The **Refresh button** (`data-test="refresh-button"`, top-right of Overview) fires **both** reads every time. Verified by clicking it twice back-to-back: **2 requests each time**, no caching in between |
| *(bonus)* Anomalies tab caches too | ✅ **Reliability → Alerts → Anomalies**, switch to All and straight back: **0 requests**. Its entry is `["org","<org>","alerts","list","default","anomaly_detection"]` — the alert-type is part of the key, so each tab keeps its own entry |

**Cache policy** — both anomaly queries: `staleTime` **30 s**, `gcTime` 5 min,
`refetchOnWindowFocus: true`. Confirmed at runtime.

> ⚠️ **Testing trap:** on an org with no anomaly configs, this section looks like it passes
> while proving nothing — the config list returns `[]` and history never fires at all. Confirm
> with `GET /api/{org}/anomaly_detection`; if it returns `[]`, seed a config first or the
> history rows are untested.


## 7. SLOs

**UI path:** **Left sidebar → hover Reliability → SLOs.** (Not a top-level rail item — it is a
flyout child of Reliability, alongside Incidents and External Alert Sources.)

**Seeding data:** `POST /api/{org}/slos` — note the path has **no `/v2`**; `/api/v2/{org}/slos`
returns *"Organization not found"*. Minimum body: `name`, `folder_id`, `sli_type`,
`config.source.query.{stream,stream_type,good_expr}`, `window_secs`, `slice_interval_secs`,
`target`. Page size is **25**, so seed 26+ to get two pages.

### 🔴 Known finding — see issue #20

**C1 fires 2 requests, not 1.** Every cold mount issues both:

```
GET /api/{org}/slos                  <- fired while readFolder is still undefined; never rendered
GET /api/{org}/slos?folder=default   <- the one that actually paints the table
```

`main` fetched once. Reproduced on a cold page load, a stale (>30 s) revisit, and the
navigation back to the list after a create. **Expect 2 until #20 is fixed** — do not file it
again.

**Browser-verified with 35 SLOs (2 pages at page size 25):**

| # | Check | Result |
| --- | --- | --- |
| C1 | Cold read | 🔴 **2 requests** — see above. Should be 1 |
| C2 | Warm revisit < 30 s | ✅ **0** (measured with the entry verified 6 s old) |
| C3 | Stale revisit > 30 s | ✅ Table **never blanked** — 16 samples, rows held, zero skeletons. Request count is 2, same cause as C1 |
| C4 | Refresh button (`slos-slolist-refresh`) | ✅ **1** request, rows stay on screen, no skeleton |
| C5 | `r` shortcut | ✅ **Nothing happens — correct.** Real keypress, 0 requests. This page registers no shortcuts |
| C6 | Create → back on the list | ✅ 1 `POST`, returns to the list, **new row already present**, total incremented |
| C7 | Delete → away → straight back | ✅ Confirm dialog (**Delete**), 1 `DELETE`, 1 refetch. Gone immediately **and still gone on return** |
| C8 | Search then Refresh | ✅ Term **preserved**, filtered rows preserved |
| S1 | Sort a column | ✅ **0 requests**, no blank, **no double-fire**. Only **Name** sorts |
| S2 | Page forward, then back | ✅ **0 requests** each way |
| S3 | Bulk action | ✅ Row checkboxes work → *"Move 3 selected"* appears. **Move only** — there is no bulk delete |
| S4 | Search with no matches | ✅ Proper empty state: *"No data"*. Not a spinner, not stale rows |
| S5 | Clear the search | ✅ Full list returns, **0 requests** |
| S6 | Export | ✅ Per-row export buttons (`slos-slolist-export-<name>`), icon-only in the Actions column |

> ⚠️ **The sort cycle has THREE states and one looks like a no-op.** The Name header goes
> **descending → ascending → neutral**, and the neutral state renders in ascending order — so
> one click in every three appears to do nothing. It is not broken: the header **icon** changes
> even when the row order does not. Judge sorting by the icon, not the first row. (The header is
> also not exposed as a button and carries no `aria-sort`, so a screen reader cannot tell either
> — pre-existing in the shared table component.)

> ⚠️ **The sort handle is `o2-table-th-sort-trigger`, not the `th`.** Clicking the header cell
> itself does nothing.


## 8. Reports

**UI path:** ⚠️ **Corrected — not a top-level sidebar item.** It is **Left sidebar → hover
Dashboards → Reports** (the Dashboards flyout has exactly two children: *Dashboards* and
*Reports*). While you are on `/web/reports` the rail highlights **Dashboards**, which is how to
tell it is a flyout child.

**Seeding data:** `POST /api/{org}/reports?folder=default`. Two traps in the payload —
the org field is **`orgId`** (camelCase, not `org_id`), and `dashboards[].timerange` requires
**`from` and `to`** even for a relative range. Page size is 20.

**Browser-verified with 21 reports:**

| # | Check | Result |
| --- | --- | --- |
| C1 | Cold read | ✅ **2 requests** — `GET /v2/{org}/folders/reports` + `GET /v2/{org}/reports?folder=default&cache=false`. Matches the expected count |
| C2 | Warm revisit < 30 s | ✅ **0** (measured with the entry verified 8 s old) |
| C3 | Stale revisit > 30 s | ✅ **1** request, and the table **never blanked** — 14 samples, rows held at 20, zero skeletons |
| C4 | Refresh button | ✅ **1** request every time, rows stay on screen, no skeleton. Verified twice back-to-back |
| C5 | `r` shortcut | ✅ **1** request — real keypress. The shortcut works on this page |
| C6 | Create → back on the list | ✅ 1 `POST`, returns to the list, **new row already present**, total 20 → 21 |
| C7 | Delete → away → straight back | ✅ Confirm dialog (**OK**), 1 `DELETE`, 1 refetch. Gone immediately, and **still gone on return with 0 requests** |
| C8 | Search then Refresh | ✅ Term **preserved**, filtered rows preserved. Typing fires **0** requests (client-side) |
| S2 | Page forward, then back | ✅ **0 requests** each way |
| S4 | Search with no matches | ✅ Proper empty state: *"No reports found"* |
| S5 | Clear the search | ✅ Full list returns, **0 requests** |

> ⚠️ **Two measurement traps on this page — both cost me a false "double-fire" reading.**
>
> **1 · Refresh can look like 3 requests.** `reportsQuery` sets `refetchOnWindowFocus: true`, and
> this page keeps **two** entries — `cache=false` (Scheduled tab) and `cache=true` (Cached tab).
> If the click that hits Refresh is also the click that returns focus to the page, the focus
> refetch fires for **both** entries on top of the refresh itself. Observed:
> `cache=false`, `cache=true`, `cache=false`. Click somewhere on the page first, let it settle,
> **then** click Refresh — it is **1**.
>
> **2 · Scripted clicks can double-fire.** Dispatching a full pointer sequence
> (`pointerdown → mousedown → pointerup → mouseup → click`) triggered the handler twice, giving
> two identical `cache=false` requests. A plain `.click()` gives one. If you automate this page,
> verify with a real click before filing a double-fire bug — I very nearly filed one.

**Create-form note (C6):** *Report title* and *Recipients* are required and sit **below** the
dashboard selectors, so a first Save fails with *"This field is required"* / *"Add valid
emails!"* while the visible top half looks complete. Fill those two before saving.


## 9. Pipelines

**Scope:** each sub-section below states its own — see them individually.

### 9.1 Pipelines list

**UI path:** **Left sidebar → hover Data → Pipelines** (`/web/pipeline`). The Data flyout holds
*Streams, Pipelines, Workflows, Functions, Enrichment Tables, Data sources*.

**Seeding data:** `POST /api/{org}/pipelines`. ⚠️ **Only one _realtime_ pipeline is allowed per
source stream** — a second returns *"A realtime pipeline with same source stream already
exists"*. For bulk seeding use **scheduled** pipelines (`source.source_type: "scheduled"` with a
`query_condition` + `trigger_condition`), which have no such limit. Page size is 20.

> ✅ **Issue #21 was found here and is now FIXED on this branch.** The list used to render
> **completely empty on every cold load** — *"Create your first pipeline"* with 0 rows — while
> the query cache held every pipeline. Clicking any tab made them appear with 0 requests.
> `filteredPipelines` is now a computed derived from the query rather than a ref hand-assigned
> by `updateActiveTab()`. If you see an empty list on a cold load, that regression is back.

**Browser-verified with 24 pipelines (3 realtime + 21 scheduled), after the fix:**

> ⚠️ The counts below are **as measured at the time** (24 pipelines: 3 realtime + 21 scheduled).
> Seed data has grown since, so a re-run will show different totals — check that the tab counts
> still **add up** (realtime + scheduled = all), not that they match these exact numbers.

| # | Check | Result |
| --- | --- | --- |
| C1 | Cold read | ✅ **1** request — `GET /api/{org}/pipelines`. Rows render immediately, **no tab click needed** (this is the #21 regression check) |
| C2 | Warm revisit < 30 s | ✅ **0** (measured with the entry verified 8 s old) |
| C3 | Stale revisit > 30 s | ✅ **1** request, table **never blanked** — 14 samples, rows held at 20, zero skeletons |
| C4 | Refresh button | ✅ **1** request, rows stay on screen, no skeleton |
| C5 | `r` shortcut | ✅ **1** request — real keypress |
| C6 | Create / edit → back on the list | ✅ **Now passes — but only after fixing issue #22, which this row originally missed.** The editor never invalidated the pipelines scope, so a save returned to **stale rows** until you hit Refresh (measured: server 25, list stuck at 24, **0 requests** on the editor→list round trip). Fixed in `PipelineEditor.vue` **and** `ImportPipeline.vue`; re-measured: **1** request on return, total 25 → 26, the new row present. ⚠️ The canvas itself is not automatable, but the invalidation **is** — create via `POST /api/{org}/pipelines`, then do the editor→list route round trip |
| C7 | Delete → away → straight back | ✅ Delete lives in the row's **⋮ menu** (*Export / Delete / Create Backfill*), then an **OK** confirm. 1 `DELETE` + 1 refetch, gone immediately, **still gone on return with 0 requests** |
| C8 | Search then Refresh | ✅ Term **preserved**, filtered rows preserved. Typing fires **0** requests (client-side) |
| S2 | Page forward, then back | ✅ **0 requests** each way |
| S4 | Search with no matches | ✅ Proper empty state: *"No pipelines found"* |
| S5 | Clear the search | ✅ Full list returns, **0 requests** |
| — | Tab filter All / Scheduled / Realtime | ✅ **0 requests** each; counts add up (Realtime **3** + Scheduled **21** = All **24**). Client-side |

> ⚠️ **The tab controls are an `OToggleGroup`, not plain buttons.** Target them by
> `data-test="tab-all"` / `tab-scheduled` / `tab-realtime`. Selecting them by visible text inside
> `[data-test="pipeline-list-tabs"]` silently does nothing — which looks exactly like a broken
> filter. It cost me a false alarm.


### 9.2 Pipeline destinations

**UI path:** **Left sidebar → Settings → Pipeline Destinations** (`/web/settings/pipeline_destinations`).
⚠️ There is no `/web/pipeline/destinations` route — that URL 404s. The route is registered in
`useManagementRoutes.ts` under Settings, not under Pipelines.

**Seeding data:** `POST /api/{org}/alerts/destinations?module=pipeline`. ⚠️ The URL passes
through an **SSRF guard** — a host that does not resolve (e.g. `example.invalid`) is rejected
with HTTP 400. Use a resolvable host such as `https://example.com/...`.

> 🔴 **Issue #23 was found here and is now FIXED.** Deleting a destination left the row on
> screen, and it survived navigating away and back — the exact failure C7 exists to catch. Both
> the single-row and bulk delete paths now force a refetch. If a deleted destination reappears,
> that regression is back.

**Browser-verified with 10 seeded destinations:**

| # | Check | Result |
| --- | --- | --- |
| C1 | Cold read | ✅ **2 requests** — `alerts/destinations?…&module=pipeline` + `alerts/templates` |
| C2 | Warm revisit < 5 min | ✅ **0** (measured with the entry 10 s old) |
| C3 | Stale revisit > 5 min | ✅ **1** request at an entry age of **337 s**, and the table **never blanked** — 20 samples, rows held at 9, zero skeletons |
| C4 | Refresh button | ✅ **1** request, rows stay on screen, no skeleton |
| C5 | `r` shortcut | ✅ **1** request — real keypress |
| C6 | Create → back on the list | ✅ 1 `POST` + **1 automatic refetch**; new row present, 10 → 11. Works because the editor saves through `saveDestinationMutation`, whose `meta.invalidates` is applied by the global `MutationCache.onSuccess` handler |
| C7 | Delete → away → straight back | ✅ **after fixing #23.** 1 `DELETE` + 1 refetch, gone immediately (10 → 9), **still gone on return with 0 requests**. Before the fix: 0 refetches and the row stayed |
| C8 | Search then Refresh | ✅ Term **preserved**, filtered rows preserved. Typing fires **0** requests (client-side) |
| S4 | Search with no matches | ✅ Proper empty state: *"No destinations found"* |
| S5 | Clear the search | ✅ Full list returns, **0** requests |

**The create/delete asymmetry is worth understanding before testing other modules.** Writes that
go through a `mutationOptions` with `meta: { invalidates: [...] }` refresh their list
automatically — the global handler in `queryClient.ts:86` applies them. Writes that call the
service directly do **not**, and must pass `force` to their own reader. On this page the create
took the first path and the delete took the second, which is exactly why C6 passed and C7 failed.

> ⚠️ **The create form is a two-step wizard**, not a single form: *Choose Type* (OpenObserve /
> Splunk / Elasticsearch / Datadog / Dynatrace / Newrelic / Custom) → **Continue** → *Connection*
> (name, URL, and a pre-filled endpoint + Authorization header). Step 1 has no text inputs at
> all, so a script that looks for the name field before clicking Continue finds nothing.


---

> ⚠️ **The two checklists below are the originals, restored.** They were dropped when this
> section was rewritten with measured results. Where a row is already covered by the results
> table above, that measurement wins; everything else here still needs running.

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Expected |
| --- | --- |
| Create a destination from inside the pipeline editor (a node's destination picker) | The new destination shows up in the picker immediately, and on the Destinations page |

### 9.3 Pipeline history

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** ⚠️ **Not "open a pipeline → History".** History is a **page-level** view reached from
the **Pipeline History** button in the Pipelines page header — it is not per-pipeline; the
pipeline is chosen from a dropdown once you are there. Route:
`/web/pipeline/pipelines/history`.

> ⚠️ **The header button may not render.** `#o2-page-actions` (the shell teleport target the
> header buttons portal into) is sometimes absent, which hides *Pipeline History*, *Backfill*,
> *Import* and *New pipeline* entirely. Reproduced on this build. When that happens, reach the
> page by URL. Same root cause as the pipeline editor's missing Save button.

**Browser-verified:**

| Check | Result |
| --- | --- |
| Paginate | ⚠️ **The table DOES blank.** Page 1 → 2 fires 1 request and the rows are replaced by **114 skeleton placeholders** mid-flight; same going back to page 1. The expectation *"keeps its rows between pages; no blank flash"* is **not met**. **Pre-existing — identical on `main`**: `loading` is a plain `ref(false)` flipped around every fetch (`:loading` at lines 67/100, set at 702, cleared at 760; `main` has the same at 482/701/756), so it cannot tell a cached read from a network one. Not filed as a branch bug |
| Paginate — request count | **1 per page change**, both directions. Returning to page 1 refetches rather than serving from cache, because the key carries the **quantized time range** and the minute bucket moves — see §17/#17 |
| Refresh button | ✅ **1 request** — `GET /{org}/pipelines/history?start_time=…`. ⚠️ Rows do **not** stay: the same `loading` flag blanks the table to 114 skeletons for the duration. Judge this row by the **request count**, which is correct |

**Cold load fires 3 requests:** `pipelines` **twice** plus `pipelines/history` once. The two
identical `pipelines` reads are the parent list's cached query **and** `PipelineHistory`'s own
raw `pipelinesService.getPipelines(org)` call (line 666) that populates the pipeline dropdown.
**Pre-existing — `main` makes the same raw call at the same line**; this branch migrated only
the *history* read (`http().get` → `pipelineHistoryQuery`). It is a missed caching opportunity
rather than a regression: `pipelinesQuery` already exists and the parent has the data cached, so
`queryClient.fetchQuery(pipelinesQuery(org))` would make the second request free. Same shape as
issue #19.

✅ **The quantization fix (#17) is confirmed working here** — the request carries bucketed
timestamps (`start_time=…160000000&end_time=…060000000`, a clean 15-minute span on minute
boundaries) rather than a raw `Date.now()`, so revisits inside the same bucket can hit cache.


## 10. Functions and Enrichment Tables

**Scope:** each sub-section below states its own — see them individually.

### 10.1 Functions

**UI path:** **Left sidebar → hover Data → Functions** (`/web/pipeline/functions`).
⚠️ `/web/functions` 404s — the route lives under `/web/pipeline/`.

**Data:** the org already had 35 functions, so no seeding was needed. Page size is 20.

**Browser-verified — all eight checks pass, no bugs:**

| # | Check | Result |
| --- | --- | --- |
| C1 | Cold read | ✅ **1** request — `GET /{org}/functions?page_num=1&page_size=100000&…` |
| C2 | Warm revisit < 5 min | ✅ **0** (entry verified 7 s old) |
| C3 | Stale revisit > 5 min | ✅ **1** request at an entry age of **328 s**, and the table **never blanked** — 20 samples, rows held at 20, zero skeletons |
| C4 | Refresh button (`functions-list-refresh-btn`) | ✅ **1** request, **rows stay on screen**, no skeleton |
| C5 | `r` shortcut | ✅ **1** request — real keypress, rows stay |
| C6 | Create → back on the list | ✅ 1 `POST` + **1 automatic refetch**; total 34 → 35 and the new row is on the list |
| C7 | Delete → away → straight back | ✅ Confirm dialog, 1 `DELETE` + 1 refetch, gone immediately (35 → 34), **still gone on return with 0 requests** |
| C8 | Search then Refresh | ✅ Term **preserved**, filtered rows preserved. Typing fires **0** requests (client-side) |
| — | Paging 1 → 2 → 1 | ✅ **0 requests** each way |
| — | Search with no matches | ✅ Proper empty state: *"No functions found"* |
| — | Clear the search | ✅ Full list returns, **0** requests |

**Why C6 and C7 both pass here** — Functions is wired through the mutation layer, so the
invalidation is declarative rather than hand-rolled:

```ts
saveFunctionMutation        meta: { invalidates: [functionKeys.all(org)] }
deleteFunctionMutation      meta: { invalidates: [functionKeys.all(org)] }
bulkDeleteFunctionsMutation meta: { invalidates: [functionKeys.all(org)] }
```

The global `MutationCache.onSuccess` handler applies them, so no caller has to remember
`force`. **This is the pattern to compare against** when a create/delete elsewhere fails to
refresh — see §9.2, where the create used a mutation (passed) and the delete used a raw service
call (failed, issue #23).

> ⚠️ **The function name field is an inline-edit, not a plain input.** Until you click
> `add-function-name-input-trigger` there is **no `<input>` in the DOM at all** — a script that
> looks for the name field on arriving at the form finds nothing and looks broken. The body is a
> Monaco editor (4 models on the page), not a textarea.


---

> ⚠️ **The two checklists below are the originals, restored.** They were dropped when this
> section was rewritten with measured results. Where a row is already covered by the results
> table above, that measurement wins; everything else here still needs running.

**Smoke checks — measured on this page (all pass):**

| # | Check | Result |
| --- | --- | --- |
| S1 | Sort a column | ✅ **0 requests** across 3 clicks, no blank, no skeleton, **no double-fire**. Only **Name** sorts, cycling asc → desc → neutral with three distinct header icons |
| S2 | Page forward, then back | ✅ **0 requests** each way, no blank flash |
| S3 | Bulk action | ✅ Row checkboxes → **Delete** (`function-list-delete-functions-btn`). Selected 2, confirmed: **1 bulk call + 1 refetch**, both rows gone, selection cleared, total 36 → 34 |
| S4 | Search with no matches | ✅ Proper empty state: *"No functions found"* |
| S5 | Clear the search | ✅ Full list returns, **0 requests** |
| S6 | Export / download | ❌ **N/A — this page has no export at all.** Verified exhaustively: no export text anywhere on the page, no row overflow menu, and the only per-row actions are `function-list-edit-function-<name>` and `function-list-delete-function-<name>`. Skip this row here |

The original checklist follows for reference.

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks — measured (all 7 pass):**

| Check | Result |
| --- | --- |
| **Second visit paints rows** | ✅ Functions → Streams → back to Functions: **20 rows rendered, 0 requests**, no empty state. The shipped bug this row guards against does not reproduce |
| **`r` shortcut** | ✅ **1** request — real keypress. Not a no-op |
| Create a function → back to list | ✅ 1 `POST` (200) + 1 automatic refetch; row present without a manual refresh |
| Delete a function → navigate away → return | ✅ 1 `DELETE` + 1 refetch, gone immediately, **still gone on return with 0 requests** |
| Bulk-delete several functions | ✅ Selected 2 → **1 bulk call + 1 refetch**, both gone, selection cleared, count 36 → 34, **still gone after navigating away** |
| Function appears in Logs | ✅ Created through the UI, then **Logs → pick a stream → More → Function Editor → the ƒx dropdown**: the new function is offered, with **0 extra function requests** — the dropdown reads the same cached list |
| Deep link (`?action=add`) | ✅ **Opens once.** Sampled the DOM 24× over 6 s: never more than **1** `add-function-save-btn` and **1** name trigger. No double-mount from a cached paint followed by a fresh one |

> ⚠️ **Reaching the Logs function dropdown takes four steps** and it does not exist until you
> get there: **Logs → select a stream → More → Function Editor** → then the **ƒx** dropdown
> (`logs-search-bar-function-dropdown`) appears. With no stream selected there is no function
> control on the page at all.

> ⚠️ **The create form can fail silently.** A save whose name field never registered still
> fires a `POST`, so a script that counts requests reads it as success while nothing is created.
> Confirm the name shows in `add-function-name-input-value` **before** saving, and check the
> response status — not just that a request went out.

The original checklist follows for reference.

**This page's own checks** — specific to this module:

| Check | Steps | Expected |
| --- | --- | --- |
| **Second visit paints rows** | Open Functions → go to Streams → come back to Functions | Rows are there. *A shipped bug made the list render **empty** from the second visit onward with no request — this is the regression test for it* |
| **`r` shortcut** | Press `r` on the Functions list | One request goes out. *Previously a no-op* |
| Create a function → back to list | — | Present without manual refresh |
| Delete a function → navigate away → return | — | Gone and stays gone |
| Bulk-delete several functions | — | All selected rows gone; count updates; still gone after navigating away |
| Function appears in Logs | After creating one, open Logs → Functions dropdown | The new function is offered |
| Deep link | Open Functions via the "add"/"update" deep link | The dialog opens **once**, not twice (a cached paint followed by a fresh one must not re-trigger it) |

### 10.2 Enrichment tables

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** **Left sidebar → hover Data → Enrichment Tables** (`/web/pipeline/enrichment-tables`).

**Seeding data:** `POST /api/{org}/enrichment_tables/{name}?append=false` with a
`multipart/form-data` `file` field (a small CSV is enough). The org had **none**, which is why
the author could not verify this section — 10 were seeded to run it.

**✅ Now verified live with 11 tables. All four checks pass.**

| Check | Result |
| --- | --- |
| Refresh keeps rows | ✅ **Rows stay** — 16 samples during the refresh, never blanked, **zero skeletons**. Verified both with a full list (10 rows) and with an active filter (1 row) |
| Refresh reaches the server | ⚠️ **2 requests, not 1** — `GET /{org}/enrichment_tables/status` **and** `GET /{org}/streams?type=enrichment_tables`. **Not a double-fire**: two different endpoints, one for the table list and one for the per-table ingest status. Expect 2 |
| Page does not remount | ✅ URL unchanged, **scroll position unchanged**, and an active search filter is **preserved** (term still in the box, still filtering) across the refresh |
| Upload a new enrichment table | ✅ `POST …/enrichment_tables/{name}?append=false` → 200, then **both reads re-fire automatically** and the new table appears in the list, 10 → 11, **with no manual refresh** |

> ⚠️ **The cold load does NOT fetch the table list** — only `enrichment_tables/status`. The list
> itself comes from the cached `["org","<org>","streams","nameList","enrichment_tables"]` entry.
> Consequence when seeding via the API: the browser never saw those uploads, so the page shows
> **0 rows** until you press Refresh. That is the cache behaving correctly on an out-of-band
> change, **not** a bug — but it looks alarming. Seed first, then Refresh once.

> ⚠️ **The upload form's file input does not hold the file.** The component tracks the attachment
> in its own state, so `fileInput.files.length` reads **0** even when the file is attached and the
> form shows its name and size. Judge attachment by the filename appearing in the form, not by
> the input.

**Related known finding:** issue #12 — `enrichment_tables/status` fires on **every** visit while
the paired stream list is served from cache. Confirmed again here: the cold load's only request
was `/status`.

## 11. Synthetics

**UI path:** Left sidebar → **Synthetics**

**Scope:** the two check tables below, then this page's own rows.

#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **1** request(s) |
| C2 | Go to another module, come **straight** back (within **30 s**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **30 s**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | ⚠️ **Nothing happens — correct.** This page registers no keyboard shortcuts |
| C6 | Create or edit a monitor, save | Back on the list, the monitor is **already there** — no manual refresh |
| C7 | Delete a monitor → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Steps | Expected |
| --- | --- | --- |
| Create a **Browser Test** | Synthetics → **Add** → Browser | Destination dropdown populated from cache; on save, the monitor is in the list without a manual refresh |
| Create a **Protocol Check** | Synthetics → **Add** → API/Protocol | Same |
| Edit a monitor, save, return to the list | — | The edit is reflected immediately (the whole synthetics scope is invalidated on save) |
| Open a monitor's detail, go back, reopen | — | ⚠️ **A request on every open is EXPECTED — not a bug.** `monitorDetailQuery` is declared but unread (§24 item 8). Only the *list* is cached |
| Monitor results / runs | Synthetics → open a monitor → **Results** → paginate | Table keeps rows between pages; refresh forces one request |
| Delete a monitor → navigate away → return | — | Gone and stays gone |
| Folder filter | — | Each folder caches separately |

### 11.1 Synthetics agent tokens

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

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

**Scope:** the two check tables below, then this page's own rows.

#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **1** request(s) |
| C2 | Go to another module, come **straight** back (within **30 s**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **30 s**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | ⚠️ **Nothing happens — correct.** This page registers no keyboard shortcuts |
| C6 | Create or edit a workflow, save | Back on the list, the workflow is **already there** — no manual refresh |
| C7 | Delete a workflow → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Expected |
| --- | --- |
| Create a workflow → back to list | Present without manual refresh |
| Delete a workflow → navigate away → return | Gone and stays gone |
| Workflow runs → paginate | Table keeps rows between pages |

---

## 13. Actions

**UI path:** Left sidebar → **Actions** (enterprise)

**Scope:** the two check tables below, then this page's own rows.

#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **1** request(s) |
| C2 | Go to another module, come **straight** back (within **5 min**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **5 min**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a action script, save | Back on the list, the action script is **already there** — no manual refresh |
| C7 | Delete a action script → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Expected |
| --- | --- |
| Create / edit an action script → back to list | Reflected without manual refresh |
| Delete → navigate away → return | Gone and stays gone |
| Open Logs → Actions menu after creating one | The new action is offered |

---

## 14. IAM

**Scope:** each sub-section below states its own — see them individually.

**UI path:** Left sidebar → **IAM**

### 14.1 Users

**UI path:** IAM → **Users**

Run **C1–C8** (`r` shortcut applies).


#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **4 (users + 3 role lists)** request(s) |
| C2 | Go to another module, come **straight** back (within **30 s**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **30 s**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a user, save | Back on the list, the user is **already there** — no manual refresh |
| C7 | Delete a user → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Expected |
| --- | --- |
| The role dropdown when adding a user | Populated from the **same cached role list** the Roles page uses — opening Users after Roles issues no extra request |
| Invite a user → the pending-invites list | The invite appears without a manual refresh. Note: `pendingInvitesQuery` is declared but unread (§24 item 8), so this list is **not** cache-backed — a request per visit is expected |
| Change a user's role → navigate away → return | The new role persists |

### 14.2 Roles

**UI path:** IAM → **Roles**

**Scope:** the two check tables below, then this page's own rows.

#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **2 (roles + all-user-roles)** request(s) |
| C2 | Go to another module, come **straight** back (within **30 s**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **30 s**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a role, save | Back on the list, the role is **already there** — no manual refresh |
| C7 | Delete a role → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Steps | Expected |
| --- | --- | --- |
| Roles and Users share one read | Open Roles, then Users, watching Network | The role list is fetched **once**, not once per page |
| Open a role → **Permissions** tab | | ⚠️ **A request on every open is EXPECTED — not a bug.** `rolePermissionsQuery` is declared but unread (§24 item 8) |
| Resource list | | The permission resource list is persisted (it is enum-like) — it survives a reload with no request |
| Create / edit / delete a role | | List updates without manual refresh; deleted role stays gone |
| Bulk-delete roles | | All selected gone; still gone after navigating away |

### 14.3 Groups

**UI path:** IAM → **User Groups**

**Scope:** the two check tables below, then this page's own rows.

#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **1** request(s) |
| C2 | Go to another module, come **straight** back (within **30 s**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **30 s**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a group, save | Back on the list, the group is **already there** — no manual refresh |
| C7 | Delete a group → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Expected |
| --- | --- |
| Open a group → **Roles** tab | Reads from the shared role cache |
| Create / edit / delete a group | List updates without manual refresh; deleted group stays gone |
| Bulk-delete groups | Same |

### 14.4 Quota

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** IAM → **Quota**

| Check | Expected |
| --- | --- |
| Open Quota, switch away, come back | **One** `ratelimit/module_list` request per visit — *not two*. Commit `ec9313eda7` removed a double-load within a single mount; it did **not** put the list on the query layer, so a request per visit is correct |
| Change a quota value and save | Reflected without a manual refresh |

### 14.5 Service accounts

**UI path:** IAM → **Service Accounts**

**Scope:** the two check tables below, then this page's own rows.

#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **1** request(s) |
| C2 | Go to another module, come **straight** back (within **30 s**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **30 s**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a service account, save | Back on the list, the service account is **already there** — no manual refresh |
| C7 | Delete a service account → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Steps | Expected |
| --- | --- | --- |
| **Mount does not force a refetch** | Open Service Accounts → go to Users → come back within 30 s, watching Network | **Zero** requests on the return visit. *It used to force one on every mount* |
| Create a service account | | Appears in the list without a manual refresh |
| **Tokens never persisted** | | Local Storage has **no** `o2q-` entry containing a service-account token |
| Delete → navigate away → return | | Gone and stays gone |

### 14.6 Ingestion tokens

**Scope:** run **C1–C5** (cold read, warm revisit, Refresh button, `r` shortcut) and **C8** (search survives refresh), plus the rows below. C6/C7 are covered by this section's own rows where they apply.

**UI path:** IAM → **Ingestion Tokens**

| Check | Expected |
| --- | --- |
| **Refresh button works** | One request per click. *It used to do nothing while the entry was fresh* |
| `r` shortcut | Same |
| Create a token / enable / disable | List updates without a manual refresh |
| **Never persisted** | No `o2q-` localStorage entry contains an ingestion token; nothing in IndexedDB either |

### 14.7 Organizations

**Scope:** run **C1–C5** (cold read, warm revisit, Refresh button, `r` shortcut) and **C8** (search survives refresh), plus the rows below. C6/C7 are covered by this section's own rows where they apply.

**UI path:** IAM → **Organizations**

| Check | Expected |
| --- | --- |
| Run C1–C5 | Standard cache behaviour |
| **Org cleanup tasks dialog** — IAM → Organizations → open an org's cleanup tasks | The dialog **polls every 5 seconds** while open, and **stops polling when closed** (confirm the requests stop in Network) |

### 14.8 MCP Server

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** IAM → **MCP Server**

| Check | Expected |
| --- | --- |
| Open, navigate away, return | Org data read from cache |
| Any token shown here is **not** in localStorage | Confirm in the Application tab |

---

## 15. Settings

**Scope:** each sub-section below states its own — see them individually.

**UI path:** Left sidebar → **Settings**

### 15.1 General / Organization settings

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Settings → **General** · Settings → **Organization**

| Check | Expected |
| --- | --- |
| Open, navigate away, return | Settings paint instantly; no request within 5 minutes |
| Change a setting and save | The change is reflected everywhere it is used (theme, query defaults) without a reload |
| Reload the page | Org settings paint from `localStorage` before the request lands |

### 15.2 Nodes

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Settings → **Nodes**

| Check | Steps | Expected |
| --- | --- | --- |
| Run C1–C5 | | Standard behaviour |
| **Filter survives refresh** | Apply a node filter → press Refresh (or `r`) | Filter and filtered rows preserved. *Refresh used to reset it* |
| **Not persisted to disk** | Check Local Storage | No `o2q-` entry for the node list — stale cluster topology is deliberately memory-only |

### 15.3 Cipher Keys

**UI path:** Settings → **Cipher Keys**

**Scope:** the two check tables below, then this page's own rows.

#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **1** request(s) |
| C2 | Go to another module, come **straight** back (within **5 min**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **5 min**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a cipher key, save | Back on the list, the cipher key is **already there** — no manual refresh |
| C7 | Delete a cipher key → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

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


#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **1** request(s) |
| C2 | Go to another module, come **straight** back (within **5 min**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **5 min**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a pattern, save | Back on the list, the pattern is **already there** — no manual refresh |
| C7 | Delete a pattern → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Steps | Expected |
| --- | --- | --- |
| **Revalidation actually happens** | Create a pattern in another tab or as another user, then return here, wait past 5 min and revisit | The list revalidates. *It used to read a local store copy and never consult the cache, so an invalidated entry was never refreshed* |
| Delete a pattern → navigate away → return | | Gone and stays gone |
| **Old sessionStorage cache is gone** | DevTools → Application → **Session Storage** | No `regex_patterns_cache_*` key is ever written |
| Stale sessionStorage residue is harmless | If an older build left a `regex_patterns_cache_*` key, reload with it present | The page ignores it entirely — nothing reads that key any more |

### 15.5 Built-in patterns

**Scope:** run **C1–C5** (cold read, warm revisit, Refresh button, `r` shortcut) and **C8** (search survives refresh), plus the rows below. C6/C7 are covered by this section's own rows where they apply.

**UI path:** Settings → **Regex Patterns** → **Built-in** tab

| Check | Expected |
| --- | --- |
| Open, navigate away, return, reload the page | Requested **once per session** and persisted — these never change |
| Refresh button | Still forces a request |

### 15.6 AI Toolsets

**UI path:** Settings → **AI Toolsets**

**Scope:** the two check tables below, then this page's own rows.

#### What to run on this page

**Cache checks** — the point of this PR:

| # | Do this | Expect |
| --- | --- | --- |
| C1 | Hard-reload (Ctrl+Shift+R), open this page | Skeleton, then rows. **1** request(s) |
| C2 | Go to another module, come **straight** back (within **5 min**) | Rows appear **instantly, no skeleton**, **0 requests** |
| C3 | Go away, wait past **5 min**, come back | Rows appear instantly, then **1** background request. Table must **never** blank |
| C4 | Click the **Refresh** icon | **1** request every time. Rows stay; spinner is on the button, not a full-table skeleton |
| C5 | Click empty page area, press **`r`** | Same as C4 — 1 request, rows stay |
| C6 | Create or edit a toolset, save | Back on the list, the toolset is **already there** — no manual refresh |
| C7 | Delete a toolset → go to another module → come **straight** back | Gone immediately **and still gone on return** ← most likely regression |
| C8 | Type in the search box, then press Refresh | Search term **and** filtered rows preserved |

**Smoke checks** — did the data-fetching rewrite break anything ordinary:

| # | Do this | Expect |
| --- | --- | --- |
| S1 | Sort a column (click its header) | Rows re-order, table does not blank. **Requests: 0 on most pages** — they fetch the whole list (`page_size: 100000`) and sort in the browser. **Streams is the exception**: it is server-paginated, so expect **2** (re-sorted page + prefetch of the next). Two *identical* requests on any page is the old double-fire bug |
| S2 | Page forward, then back | Rows correct on every page; no blank flash between pages |
| S3 | Select several rows → bulk action (delete/move) if the page has one | All selected rows affected; count updates; selection clears |
| S4 | Search for something with **no** matches | A proper empty state — not a spinner, not stale rows |
| S5 | Clear the search | Full list returns |
| S6 | Export / download if the page offers it | Produces a file containing the rows you can see. **The control differs per page:** Alerts opens an Export dialog (JSON / Terraform tabs, then Download); **Destinations downloads immediately** from the ⬇ download-arrow icon in the Actions column — no dialog. Both are correct |

**This page's own checks** — specific to this module:

| Check | Expected |
| --- | --- |
| Create / edit / delete a toolset | List updates without a manual refresh; deleted toolset stays gone |

### 15.7 Model Pricing

**Scope:** run **C1–C5** (cold read, warm revisit, Refresh button, `r` shortcut) and **C8** (search survives refresh), plus the rows below. C6/C7 are covered by this section's own rows where they apply.

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

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Settings → **License**

| Check | Expected |
| --- | --- |
| Open the page | The license is **always re-read** (it carries live ingestion usage counters) — it is deliberately *not* frozen |
| Update the license key, then reopen | The new entitlement shows immediately, not a stale one |
| **Not persisted** | No `o2q-` localStorage entry for the license |
| **Upgrade dialog reads the same license** — trigger the *Enterprise upgrade* dialog (click a PRO/enterprise-gated feature on a community build) | The dialog shows **current** entitlement/limits, never a stale copy. It reads through the same cached license entry |
| Upgrade dialog after a license change | Update the license, then reopen the dialog  ·  It reflects the new license |

### 15.9 Query management / Running queries

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Settings → **Query Management**

| Check | Expected |
| --- | --- |
| Open the page | This is **deliberately uncached** — every open reads fresh. Refresh works as before |

---

## 16. Traces

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

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

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

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

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

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

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

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

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Left sidebar → **Data sources**

| Check | Expected |
| --- | --- |
| Open the page, navigate away, return | Ingestion tokens and passcode read from memory cache; no re-request within the window |
| Reset the passcode | The displayed passcode updates immediately |
| Create/toggle an ingestion token | Reflected without a manual refresh |
| **Nothing persisted** | No `o2q-` localStorage entry contains the passcode or an ingestion token |

---

## 21. RUM

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

**UI path:** Left sidebar → **RUM**

| Check | Expected |
| --- | --- |
| RUM → **Sessions** → paginate | Table keeps its rows between pages; no blank flash |
| Refresh button | One request; rows stay |
| RUM → **Error Tracking** / **Performance** | Search-backed — always fresh (see §17) |

---

## 22. Enterprise modules

**Scope:** each sub-section below states its own — see them individually.

### 22.1 Online Evals

**Scope:** run **C1–C5** (cold read, warm revisit, Refresh button, `r` shortcut) plus the rows below. C6–C8 are skipped — this page has no create/edit/delete or search filter.

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

**Scope:** run **C1–C5** (cold read, warm revisit, Refresh button, `r` shortcut) and **C8** (search survives refresh), plus the rows below. C6/C7 are covered by this section's own rows where they apply.

**UI path:** Left sidebar → **AI** → **Datasets**

| Check | Steps | Expected |
| --- | --- | --- |
| **Mount does not force** | Open Datasets → navigate away → come back within 30 s | **Zero** requests. *It used to fetch on every single visit* |
| **Refresh forces** | Click the Refresh button | One request; rows stay |
| Table survives a revisit | Go away and back | Rows are still there — the page no longer starts from empty |

### 22.3 AI Observability — Queues

**Scope:** run **C1–C5** (cold read, warm revisit, Refresh button, `r` shortcut) and **C8** (search survives refresh), plus the rows below. C6/C7 are covered by this section's own rows where they apply.

**UI path:** Left sidebar → **AI** → **Queues**

| Check | Steps | Expected |
| --- | --- | --- |
| **Mount does not force** | Open Queues → navigate away → come back within 30 s | **Zero** requests. *It used to fetch on every visit* |
| **Refresh forces** | Click the Refresh button | One request; rows stay on screen |
| Table survives a revisit | Go away and back | Rows still there — the page no longer starts from empty |

### 22.3a AI Observability — LLM Insights dashboard (panel cache)

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

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

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

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

**Scope:** run the rows in this section only — the C1–C8 checklist does not apply here.

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

1. **Alert destinations are persisted to `localStorage`.** Destination payloads can embed
   webhook `Authorization` headers, PagerDuty routing keys and Opsgenie/ServiceNow
   credentials. Cipher keys, ingestion tokens, passcodes, RUM and agent tokens are all
   explicitly kept out of storage — destinations are not. They *are* purged on org switch
   and logout, but until then they sit in plaintext on disk. Worth confirming this is
   intentional. Same question, lower stakes, for AI Toolsets and Action Scripts.

2. **`PERSIST_BUSTER` is `"1"`.** If a cached response shape changes without bumping it,
   a persisted payload from an older build will be rendered by a newer one. Add a
   bump-the-buster step to the release checklist for any API response-shape change.

3. **Stream name list on very large orgs.** It is persisted to `localStorage`, which has a
   ~5 MB budget shared with the rest of the app. Quota errors are swallowed by design, so
   the failure mode is "reload-persistence quietly stops working", not a crash. Worth
   measuring on the largest org available.

4. **Enrichment tables were never verified live** (the test backend had no tables). §10.2
   is by inspection only — please prioritise it on an org that has enrichment tables.

5. **`useServerTable` has no consumers.** [`composables/query/useServerTable.ts`](./src/composables/query/useServerTable.ts)
   is built, exported and documented as "the fix for the blank-table flicker", but no page
   imports it — the server-paginated surfaces (Streams, alert history, pipeline history)
   were each done inline instead. Either adopt it on those pages or drop it; right now it
   is untested-by-use code carrying a `keepPreviousData` + prefetch policy that the real
   pages re-implement by hand.

6. **The field-value in-memory cache is never cleared on purge.**
   [`composables/fieldValueStore.ts`](./src/composables/fieldValueStore.ts) keeps a
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

12. **Returning to an org never re-persists it.** The org-switch purge drops the leaving
   org's localStorage entries but keeps its in-memory ones, and the persister only writes
   after a real fetch. So re-entering an org inside its `staleTime` serves from memory,
   writes nothing to disk, and leaves that org with **no persisted entries at all** until
   something refetches.

   Net effect: the reload-persistence win is silently lost for any org the user bounces
   away from and back to within 5 minutes — on F5 that org re-fetches everything, which is
   the exact cost persistence was added to avoid. Two candidate fixes: re-persist the
   memory copy on org re-entry, or drop the leaving org's in-memory entries too so
   re-entry is a normal cold read. The first keeps the "switching back is free" property
   the design is built around; the second is simpler. Reproduced by hand — see the quirk
   box in §2.2.

14. **Two routed pages have no UI entry point** (pre-existing, not caused by this PR).
   `alerts/history` (Alert History) and `alerts/insights` (Alert Insights) are both
   registered routes with working pages, but nothing navigates to either.
   `AlertList.vue` defines and returns `goToAlertHistory()` and `goToAlertInsights()`;
   neither is bound to any template element. Alert Insights can reach Alert History, but
   nothing can reach Alert Insights. Verified by grepping every reference to both route
   names across the app.

   Relevant to this PR only because the standalone Alert History page is the **only**
   surface where the alert-history prefetch is exercised — so that code path ships but no
   user can reach it. Either wire up the buttons or drop the routes.

   ```bash
   cd web/src && grep -rn "goToAlertHistory|goToAlertInsights" components/alerts/AlertList.vue
   # → definition + return only; no @click binding
   ```

16. 🐛 **Dashboard favourites are lost on reload (caused by this PR).**
   Starring a dashboard writes to the server correctly, but the client's write-through is
   `queryClient.setQueryData(...)` — and `setQueryData` **does not invoke the persister**,
   which only writes at the end of a query-function run. So localStorage keeps the previous
   value. On reload the persisted (stale, often empty) list hydrates, carries its old
   `dataUpdatedAt`, counts as fresh inside `CONFIG_STALE_TIME` (5 min), and never
   refetches — **the star vanishes**. Past 5 minutes it self-heals, which makes it look
   intermittent.

   **Reproduced end to end**: starred a dashboard → server returned
   `setting_value: [{label: "smoke_dash_xray_024"}]` → localStorage still `[]` → reload →
   star gone, persisted entry age 611 s.

   New in this PR: `settingQuery` is newly persisted to localStorage, and the
   `setQueryData` write-through is new. Neither exists on `main`.

   Affects [`useFavoriteDashboards.ts`](./src/composables/useFavoriteDashboards.ts) and,
   and — ⚠️ **by code inspection only, not tested** — [`useHomeDashboard.ts`](./src/composables/useHomeDashboard.ts)
   (home-dashboard pin). Fix: invalidate instead of `setQueryData`, or persist explicitly
   after it the way `usePanelCache` does with `persistQueryByKey`.

17. **Docs drift.** `web/docs/api-cache-inventory.md` says "63 cached reads" and describes
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
