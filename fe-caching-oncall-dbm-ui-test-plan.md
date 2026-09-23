# On-call + DB monitoring caching — manual UI test plan

Every read in the on-call module and two reads in DB monitoring now go through the
shared query cache. So do the reads on-call screens make to other modules — the org's
users, service correlation, alert destinations and incident titles. Every cached on-call
screen also has a Refresh button that shows how old its data is, and the Routing tables
gained search, column resize and a column manager. This plan is how you prove all of that
by hand, in the browser. It also covers one fix outside both modules: the Home Overview's
**Recent events** asks the server for the exact time range again (§10).

Nothing here needs a code change to run. Every expectation is a **count of network
requests** you can read off the DevTools Network tab.

---

## 0. Before you start — is on-call switched on?

The on-call screens only exist when the backend was built with the enterprise feature
**and** `O2_ONCALL_ENABLED` is on. The routes are registered behind both
(`src/api/http/src/handler/http/router/mod.rs`), so on a build without them every on-call
URL returns **404**.

**Check in ten seconds:** left rail → **Reliability**. If the flyout shows **Pages**,
**Teams** and **Routing**, you are good. If those entries are missing, or the screens open
on "On-call is not available", stop — §4, §5, §7.1–7.6 and 7.8 cannot be tested here, and every
visit *will* issue requests because a failed read is never cached (rule 3). That is not a
caching bug.

You also need **at least one team with a member and a rotation** to exercise the counts.
An org with no teams will show a setup checklist and read almost nothing.

Sections **6 (DB monitoring)** and **8 (global behaviours)** do not depend on on-call and
can be run on any build.

---

## 1. Setup, once

1. Open the app, pick the org you will test in, and **stay in it** — org is part of every
   cache key, so switching orgs mid-test invalidates your own results.
2. Open DevTools → **Network**.
3. Set the filter to `oncall` (or `db_monitoring` for part 6). Rows that name another
   request — `/users`, `service_streams`, `semantic-groups`, `alerts/destinations`,
   `alerts/incidents`, `alerts/{id}` — are reads on-call makes to other modules and do not
   contain `oncall`; set the filter to the text that row names.
4. Tick **Preserve log** — you need requests to survive route changes.
5. Leave **Disable cache UNTICKED**. That checkbox is the *browser's* HTTP cache and has
   nothing to do with what is being tested; the query cache lives in JavaScript memory.

**Clearing between cases:** press **F5**. A full page load always starts with an empty
query cache — nothing in this migration is written to disk. (The dashboard panel cache is
the one thing in the app that survives a reload; it is not part of this work.)

---

## 2. The three rules that explain every expected result

Read these once and most of the table below becomes predictable.

1. **A read is reused while it is "fresh"**, and each read has its own freshness window
   (its *stale time*). Revisit inside the window → **no request**. Outside it → one
   request, then the window restarts.
2. **A write expires what it touched.** After saving, the next read of anything that write
   affected goes to the server — exactly once, not twice.
3. **A failed read is never remembered.** If an endpoint errors, the next visit retries it.
   This matters: on a deployment where on-call endpoints are not enabled, *every* visit
   will issue requests and that is correct behaviour, not a caching failure. See §8.

---

## 3. Freshness windows (stale times)

| Window | Applies to |
|---|---|
| **1 minute** | Live state: who is on call now, team overview, escalation preview and progress, pages/responses, deliveries, coverage gaps, unrouted signals, my on-call. From other modules: incident titles on the Pages list |
| **5 minutes** | Derived from config: reachability, config risks, team load, resolved schedule, overrides, unavailability, ownership stats, DB monitoring instance list. From other modules: service correlation — field aliases (semantic groups), identity config, discovered services, dimension analytics |
| **1 hour** | Configuration: teams, team detail, members, schedule, policy, schedule presets, routing config, ownership rules, response history and prior causes. From other modules: the org's users, alert destinations |

Reads from other modules keep the window their own module uses — the users list is the
same entry IAM → Users reads, so a visit to either warms the other.
| **1 min / 1 hour** | DB monitoring tab counts — 1 minute on a *relative* range, 1 hour on an *absolute* one |

Anything left over from a read stops being held after **3 hours** unused; after that a
revisit is a cold load again.

---

## 4. On-call — read caching

For each row: do the steps, count the matching requests. "Revisit" always means **navigate
away to another section and come back**, not a browser reload.

**"The return issues none" assumes you come back inside the shortest window on that
screen** — one minute wherever live state is involved. Come back later and only the reads
whose window has passed fire again, while the rest stay cached. Fewer requests on the
return than on the first visit is the expected result, not a partial miss. The **Window**
column names which windows are in play; 4.15 is the row that tests this on purpose.

All on-call screens live under **Reliability** in the left rail. Hovering it opens a
flyout with **Pages**, **Teams** and **Routing**.

| # | Screen | What it proves | Click path | Window | Expect |
|---|---|---|---|---|---|
| 4.1 | **Teams** | The list is reused | Rail → **Reliability** → **Teams**. Watch `/oncall/teams`, `/oncall/teams/*/on-call`, `/oncall/routing/config`. Rail → **Logs**. Rail → **Reliability** → **Teams** again. | 1 h / 1 min | First visit issues them; **the return issues none** |
| 4.2 | **Teams → Refresh** | A refresh really re-reads | On Teams, click the **refresh button** (icon + age) at the right of the table toolbar | — | `/oncall/teams` **and** `/oncall/teams/*/on-call` fire again. Routing config does **not** — the button does not own it. No `/users` either; see 4.24 |
| 4.3 | **Team detail** | The heaviest screen is reused | On Teams, **click a team row**. Count everything. Rail → **Logs**. Rail → **Reliability** → **Teams** → same row again. | mixed | First open ≈ 11 requests (`/oncall/teams` and `/on-call` are reused from the Teams screen — see 4.4); **a reopen within a minute issues none**. Later, only the four 1-minute reads — `/on-call`, `/responses`, `/overview`, `/escalation-preview` — fire again; the rest stay cached |
| 4.4 | **Detail reuses the list** | Cross-screen sharing | Go to **Teams** first, then click a team row | — | Opening the team does **not** re-request `/oncall/teams` or that team's `/on-call` — both came from the Teams visit |
| 4.5 | **Team detail → Recheck** | The findings button forces | On a team with a problem (e.g. **no members**), the attention banner appears above the tabs. Click **Show all / expand** on it, then **Recheck** in its footer | — | `/overview`, `/reachability`, `/config-risks`, `/load` all fire again. *(No banner means the team is healthy — use a team with no members)* |
| 4.6 | **Escalation policies** | The N+1 collapses | Visit **Teams**, open a **team**, then go back and use the **Escalation policies** link on the Teams page | 1 h / 1 min | Policies may issue **zero** requests — it needs teams + each team's policy and on-call, which the earlier screens already read |
| 4.7 | **Policies cold** | It still works from cold | While on Escalation policies, press **F5** | — | 1 × `/oncall/teams`, then 1 × `/policy` and 1 × `/on-call` **per team**; navigating away and back issues none |
| 4.8 | **Policies → Refresh** | Forces the whole fan-out | Click the **refresh button** (icon + age) in the Policies toolbar | — | Teams, every policy and every on-call fire again |
| 4.9 | **Routing** | Reused, and shares the team list | Rail → **Reliability** → **Teams**, then rail → **Reliability** → **Routing**. Leave to **Logs** and return to Routing. | 1 h / 5 min / 1 min | Routing adds `/ownership/stats` + `/unrouted` only — the team list is reused; the return issues none. (It also reads four service-correlation entries from another module; see 4.18–4.19) |
| 4.10 | **Pages (responses)** | The paged walk is one cached answer | Rail → **Reliability** → **Pages**. `/oncall/responses` may fire up to 3 times (it walks pages). Rail → **Logs**, then back to **Pages**. | 1 min | The return issues **no** page walk and no `/coverage-gaps`, `/ownership` |
| 4.11 | **Pages → Refresh** | Forces the walk | Click the **refresh button** (icon + age) in the Pages toolbar | — | The page walk runs again, plus the context reads. With the filter widened to `alerts/`, it also re-reads the full alert destinations list and one incident per linked incident |
| 4.12 | **Page detail** | Detail is reused | On Pages, **click a row** to open it. Count. Click **back**. Open the **same row** again. | mixed | First open ≈ 8–12 reads; **the reopen issues none**. The alert rule read (`alerts/{id}`, not under the `oncall` filter) fires on every open by design; see 7.8 |
| 4.13 | **My on-call** | Reused | Open **My on-call** (from the Pages screen header, or the rail if present). Leave to **Logs** and return. | 1 min | `/my/teams` and `/my/deliveries` on first visit; none on the return |
| 4.14 | **Incident drawer** | Shares the team list | Rail → **Reliability** → **Incidents** → click an incident that paged someone. Close the drawer, reopen the same incident. | 1 min / 1 h | `/incidents/*/responses` once; the reopen issues none, and `/oncall/teams` is reused from any earlier screen |
| 4.15 | **The minute really expires** | The window is real, not permanent | On **Teams**, note the clock. Wait **over a minute**. Rail → **Logs**, then back to **Teams**. | 1 min | `/oncall/teams/*/on-call` fires again (1 min window). `/oncall/teams` does **not** (1 hour window) |

### Reads on-call makes to other modules

Set the Network filter to the text in the row, not `oncall`.

| # | Screen | What it proves | Click path | Window | Expect |
|---|---|---|---|---|---|
| 4.16 | **Schedule & Members tabs** | Both tabs share one user list | Filter `/users`. Open a team → **Schedule** tab → **Members** tab → **Schedule** again | 1 h | One `/users`, on whichever tab comes first; the other tab and every return issue **none**. None at all if IAM → Users or another on-call screen read it within the hour |
| 4.17 | **New team drawer** | The member picker reuses the same list | Filter `/users`. **Teams** → **New team** → close (Esc) → **New team** again | 1 h | At most one `/users` on the first open; **the reopen issues none** |
| 4.18 | **Team → Routing tab** | Service-correlation reads are reused | Filter `/service_streams\|semantic-groups/` (regex). Open a team → **Routing** tab → another tab → **Routing** again | 5 min | First visit: `semantic-groups`, `service_streams/_analytics`, `service_streams` and `service_streams/config/identity`; **the return issues none** |
| 4.19 | **Routing page** | It shares those four with the team tab | Right after 4.18, rail → **Reliability** → **Routing** | 5 min | None of the four fire again |
| 4.20 | **Escalation policy editor** | The destination picker is reused | Filter `alerts/destinations`. Team → **Escalation Policies** → **Edit** → close → **Edit** again | 1 h | At most one on the first open; **none** on the reopen. (`/channel` still fires both times; see 7.3) |
| 4.21 | **Pages list** | Incident titles and the destination check are reused | Filter `/alerts\/(incidents\|destinations)/` (regex). Rail → **Reliability** → **Pages** → **Logs** → **Pages** | 1 min / 1 h | First visit: one read per linked incident, plus the destinations list unless 4.20 or an alert form read it within the hour. **The return within a minute issues none** |

### Refresh buttons

Every cached on-call screen has a Refresh button, and every one shows the age of the data
it is showing. Tables (Teams, Escalation policies, Pages, Routing) have it at the right of
the table toolbar as icon + age; the team page, page detail and My on-call have it in the
page header as dot + age + icon.

| # | Screen | What it proves | Click path | Expect |
|---|---|---|---|---|
| 4.22 | **The age is the data's** | The age comes from the cache, not your visit | On **Teams**, wait about 20 seconds → **Logs** → **Teams** | The refresh button reads about "20s ago", not "just now" — the list came from the cache |
| 4.23 | **Team page → Refresh** | Re-reads the page and the open tab | Open a team → **Routing** tab → **Refresh** in the header (left of "Cover a shift") | The page's own 13 on-call reads, plus the Routing tab's: rule stats, unrouted, routing config and the four correlation reads (20 in total). Then open **Members**: its reads (`/users`, absences, next shift) fire **once**, and a return after that issues none |
| 4.24 | **Teams → Refresh → New team** | Refresh also expires the picker's user list | Filter `/users`. **Teams** → **Refresh** → **New team** | Refresh itself sends no `/users`; the drawer's open reads it **once** |
| 4.25 | **Routing page → Refresh** | Forces every read on the page | Routing → **refresh** at the right of the table toolbar | Teams, rule stats, unrouted, routing config and the four correlation reads — 8 in total |
| 4.26 | **Page detail → Refresh** | Forces every read and keeps the page | Open a page → **Refresh** in the header | Every read on the page fires once: the record, team, members, teams, prior causes, history, escalation, deliveries, who is on call, policy, reachability and the alert rule — plus the next handover on a page that is still open. The page stays on screen; no loading skeleton |
| 4.27 | **My on-call → Refresh** | Forces both reads | **My on-call** → **Refresh** in the header | `/my/teams` and `/my/deliveries`, once each |

### Routing page tables

Both tabs on the Routing page — **Assigned rules** and **Unrouted rules** — use the same
toolbar as the app's other tables: the tabs, a search box, a column manager and refresh.

| # | What | Steps | Expect |
|---|---|---|---|
| 4.28 | Search | On **Assigned rules**, type part of a rule (a service name, say) in **Search…** | Only matching rules stay, and each keeps its order number from the full list. On **Unrouted rules**, search matches the signal, its path, or who was notified |
| 4.29 | Search clears on tab switch | Search on **Assigned rules**, then click **Unrouted rules** | The search box is empty on the other tab |
| 4.30 | Manage columns | Click the columns icon left of refresh → untick **Health** | The Health column disappears; **Reset to default** brings it back. The choice is remembered in this browser. Unrouted offers Identity path, Triggered and What happened |
| 4.31 | Column resize | Drag the right edge of a column header | The column widens or narrows; **Manage columns → Reset column widths** restores it |
| 4.32 | Unrouted queue error | Only if the unrouted queue fails to load | "Could not load the unrouted queue" with **Try again** shows inside the table; the tabs, search and refresh stay on screen, and Try again reloads it |

---

## 5. On-call — writes must refresh what they touched

Rule 2 in action. After each write, the listed screen must show the change **without you
pressing refresh**, and must reach the server exactly once to do it.

| # | Write | Steps | Expect |
|---|---|---|---|
| 5.1 | Add a member | Team → Members → add someone | The roster shows them immediately. One `/members` request, not two |
| 5.2 | Remove a member | Team → Members → remove | Row disappears; coverage chip and overview re-read |
| 5.3 | Edit the team | Team → Edit → change the name → Save | New name on the detail header *and* in the Teams list when you go back |
| 5.4 | Change the timezone | Team → Edit → change timezone → Save | The schedule/calendar re-reads — a timezone moves every resolved shift |
| 5.5 | Save a schedule | Team → Schedule → edit a rotation → Save | Calendar and "who is on call" both update |
| 5.6 | Apply a preset | Team → Schedule → presets → apply | Same as 5.5 |
| 5.7 | Delete a rotation | Team → Schedule → delete a lane → confirm | Timeline redraws without it |
| 5.8 | Save the policy | Team → Escalation → edit → Save | Ladder, overview and the dry-run preview all reflect it |
| 5.9 | Take/give a cover | Team → Schedule → Take override | Calendar band **and** the Covers list beneath both update |
| 5.10 | Delete a cover | Covers list → remove | Both update again |
| 5.11 | Record an absence | Team → Members → mark away | Absence list and the resolved shifts both re-read |
| 5.12 | Create a team | Teams → Add team (with members) | New team appears in the list without a manual refresh |
| 5.13 | Delete a team | Teams → delete | Gone from the list, and from Policies and Routing when you visit them |
| 5.14 | Set the default team | Teams → set catch-all (or Routing) | The catch-all label updates on **both** Teams and Routing |
| 5.15 | Ack / snooze / resolve a page | Responses → row action | The row's state changes; the list re-reads once |
| 5.16 | Bulk resolve | Responses → select several → Resolve → pick a cause + note → confirm | All selected rows resolve; the list re-reads **once**, not once per row. The cause and note are saved |
| 5.17 | Add a note | Response detail → add note | Timeline shows it |
| 5.18 | Handoff | Response detail → hand off | Assignee changes; team stats re-read |
| 5.19 | Create/edit/delete an ownership rule | Routing → rules | The rules list **and** the unrouted queue both re-read — a deleted rule sends its paths back to unrouted |
| 5.20 | Dismiss an unrouted signal | Routing → unrouted → dismiss | Queue re-reads |
| 5.21 | Mark deliveries read | My on-call → mark read | Unread badge drops immediately and the list re-reads |

### Writes elsewhere that change what on-call shows

Saved outside on-call, but on-call reads the result, so they must expire it too. Warm
the entries first (open the Routing page, or Teams → **New team**), make the write, then
go back.

| # | Write | Steps | Expect |
|---|---|---|---|
| 5.22 | Save field aliases | Settings → Correlation → **Field aliases** → change a group → **Save**, then open Routing | All four correlation reads (`semantic-groups`, `service_streams/_analytics`, `service_streams`, `service_streams/config/identity`) fire once each |
| 5.23 | Import semantic groups | Open the Import semantic groups page (route `alerts/import-semantic-groups`) → pick a file → apply, then open Routing | Same as 5.22 |
| 5.24 | Save identity config | Settings → Correlation → **Service discovery** → change a set → **Save**, then open Routing | Same four fire once each — the discovered-services list is built from this config |
| 5.25 | Reset discovered services | Settings → Correlation → **Discovered services** → **Reset** → confirm, then open Routing. **Destructive: deletes every discovered service. Use a test org** | Same four fire once each |
| 5.26 | Add a user from a destination | Alerts → Notification destinations → add an email destination → **Recipients** → the add-user action at the bottom of the list → save the user. Then Teams → **New team** | The new user is in the member picker, after one `/users` |

---

## 6. DB monitoring

| # | What it proves | Steps | Window | Expect |
|---|---|---|---|---|
| 6.1 | One request for all tabs | Infra → Databases. Filter Network on `badges`. Click through **every** tab (Overview, Metrics, Top queries, Slowest calls, Activity, Deadlocks, Blocked queries, Table health) | — | **Exactly 1** `/db_monitoring/badges` for the whole sweep |
| 6.2 | Quick return is free | Leave the section, come back **within a minute**, same time range | 1 min | **No** new `/badges` |
| 6.3 | The minute expires (relative range) | Set range to a relative one ("Past 1 Hour"). Note the time. Wait **over a minute**. Leave and return. | 1 min | Exactly **one** new `/badges` |
| 6.4 | Absolute ranges are held longer | Set an **absolute** range. Leave and return repeatedly over several minutes. | 1 h | No new `/badges` — a closed window cannot change |
| 6.5 | Refresh forces | Click the refresh control | — | One new `/badges` |
| 6.6 | Filters are part of the question | Apply an instance/system filter | — | One new `/badges`; returning to the previous filter within its window issues none |
| 6.7 | Instance picker is shared | Open the scope filter's instance picker on one tab, then on another | 5 min | `/db_monitoring/instances` fires **once** for both |
| 6.8 | Counts are never blank-cached | If a count shows blank (a slice failed), leave and return | — | It retries — a failure is never remembered as the answer |

---

## 7. Deliberately **not** cached — these must always hit the server

Equally important: these are expected to fire **every single time**. If one of them stops
issuing a request, that is the bug.

| # | What | Steps | Expect |
|---|---|---|---|
| 7.1 | Routing simulator | Routing → type in the dimension boxes | `/oncall/routing/preview` fires per (debounced) keystroke — it is a dry run of a draft |
| 7.2 | Ownership rule preview | Routing/Ownership → editing a rule | Same |
| 7.3 | Team channel | Team → Escalation → open the editor twice | `/teams/*/channel` fires **both** times — it seeds a draft that gets saved back, so a stale copy would silently revert someone else's change |
| 7.4 | Team form schedule read | Teams → create a team with members and a handover time | `/teams/*/schedule` is read fresh — it seeds rotations that are about to be rewritten |
| 7.5 | Unstaffed guard (Teams) | Teams → set a team as the catch-all | `/coverage-gaps` fires at save time, every time |
| 7.6 | Unstaffed guard (Routing card) | Routing → default-team card → save | Same |
| 7.7 | The DBM table reads | Any DBM tab, change the time range | The tab's own table read fires — only the *counts* are cached, not the tables |
| 7.8 | The alert rule on a page | Filter `alerts/`. Open a page for an alert, go back, open it again | `/api/v2/…/alerts/{id}` fires **both** times — the page links to the alert editor, which starts its form from the cached alert, so on-call does not fill that cache |

---

## 8. Global behaviours

| # | What | Steps | Expect |
|---|---|---|---|
| 8.1 | Browser reload always refetches | F5 on any on-call screen | Everything that screen needs is requested — the cache is memory-only |
| 8.2 | Org switch is isolated | Switch org from the header, visit the same screen | A full set of requests. Switching back within the window issues none — each org has its own entries |
| 8.3 | Long absence goes cold | Leave the app for **over 3 hours**, return | A cold load again |
| 8.4 | Two tabs do not interfere | Open on-call in two browser tabs | Each tab has its own cache; counts are per tab |
| 8.5 | Sign out | Sign out and back in | Cold load — everything is dropped |

---

## 9. Things that look like a bug but are not

- **Every visit issues requests and nothing is ever reused.** Check the response status
  first. If the endpoints are returning errors (404/403 on a build where on-call is not
  enabled), nothing is cached by design — rule 3. Caching cannot be judged on a
  deployment where the reads fail.
- **A count on a tab lags the table beneath it by a few seconds.** Expected inside the
  1-minute window. It must not lag by more than that.
- **A newly ingested metric or stream takes a moment to appear in a picker.** Lists are
  held for their window; the refresh control shows it immediately.
- **The first visit after a write issues a request.** That is rule 2 working — the write
  expired the entry. What would be wrong is **two** requests, or none at all.
- **Requests fire while a panel is off screen.** Unrelated to this work.
- **The refresh button says "12m ago" the moment a page opens.** That is the age of the
  cached data the page is showing, not of your visit. Refresh to fetch it again.
- **The `oncall` filter shows nothing for users, correlation, destinations or incidents.**
  Those reads belong to other modules and their URLs do not contain `oncall`; filter on
  the text the row names.

---

## 10. Home Overview — Recent events time range

Recent events is read from alert history. The request must carry the exact time range on
screen; only the cache key is rounded to the minute. A request that ends on a 5-minute mark
(`:00`, `:05`, `:10` …) when the range does not means the rounding is back, and the newest
alerts drop out of Recent events.

**Reading the range:** filter Network on `alerts/history`, click the newest request →
**Payload**. `start_time` and `end_time` are in microseconds; in the Console,
`new Date(<value> / 1000)` shows them as a time.

| # | What it proves | Steps | Window | Expect |
|---|---|---|---|---|
| 10.1 | The default range reaches "now" | Rail → **Home** → **Overview**. In the time picker choose **Relative** → **Past 15 Minutes**. Read the newest request's range | — | `end_time` is the moment the request was sent, to the second (e.g. 17:47:40, not 17:45:00); `start_time` is exactly 15 minutes earlier |
| 10.2 | A custom range is sent as chosen | Time picker → **Absolute** → pick a range whose ends are off a 5-minute mark, e.g. 10:12:30 → 10:27:30 | — | `start_time` and `end_time` read exactly 10:12:30 and 10:27:30 |
| 10.3 | The read is still cached | Leave to **Logs** and come back to **Home** within the same minute, range unchanged | 1 min | No new `alerts/history` |
| 10.4 | Refresh forces | Click the refresh button (icon + age) left of the time picker | — | One new `alerts/history`, for the same range the page loaded with. Refresh does not move the range; pick it again or press F5 to move it |

---

## 11. Sign-off

| Section | Cases | Pass | Notes |
|---|---|---|---|
| 4 — on-call reads, refresh, Routing tables | 32 | ☐ | |
| 5 — writes refresh | 26 | ☐ | |
| 6 — DB monitoring | 8 | ☐ | |
| 7 — deliberately uncached | 8 | ☐ | |
| 8 — global behaviours | 5 | ☐ | |
| 10 — Home Overview Recent events range | 4 | ☐ | |

**The two that matter most if you are short of time:** 4.6 (Policies costing zero requests
after visiting Teams and a team — the clearest proof the sharing works) and 6.3 (the DBM
tab count expiring after a minute on a relative range — the defect this work fixed). For
the reads from other modules, 4.18–4.19 is the quickest proof, and 4.23 covers the new
Refresh buttons.
