# Audit Limitations

## Environment and access

- **Target:** `<dev-env>/web/`, enterprise build v1.1.0-rc2, org `default` (8 orgs visible). Results reflect this build and its data; a different build or org may differ.
- **Authentication:** the auditor signed in manually in a headed browser; the session state was reused headlessly. The automation never read the credentials. Logout, OAuth callback (`/cb`, `/slack/oauth/callback`), and marketplace onboarding routes were excluded.
- **Theme:** the org theme was **O2 Signature** (light `#6B76E3`, dark `#8B8DF0`). Contrast results apply to that theme only.

## Routes not tested or only partially tested

| Group | Count | Reason |
|---|---|---|
| Parameterised detail/edit routes (`/alerts/detail/:id`, `/slos/:id`, `/incidents/:id`, `/oncall/teams/:teamId`, `/synthetics/:id/results`, `/ai/datasets/:id`, `/iam/roles/edit/:role`, `/iam/groups/edit/:group`, …) | 33 | No entities in the environment's lists, or clicking a row did not open a detail page. Creating entities was out of scope (audit-only, no data changes). |
| Ingestion integration guides | 167 of 183 | Same template; 16 sampled across all categories (custom, recommended, databases, security, devops, servers, languages, message queues, networking, AI integrations, others). |
| Settings sub-routes redirecting to General: Nodes, License, Password Policy, Domain Management, Query Management, Announcements (+edit), Synthetics Locations | 8 | Not in this org's Settings menu; likely `_meta` org or feature-flag gated. |
| Routes that redirected because they need context: `/dashboards/view`, `/dashboards/add_panel`, `/traces/trace-details`, `/pipeline/pipelines/edit`, RUM performance tabs | 8 | `/dashboards/view` was tested via in-app navigation; the others were tested only as their redirect target. |
| `/streams/stream-explore` | 1 | Direct load timed out; in-app "Explore" leads to `/logs` (tested). |
| Billing routes | 5 | Loaded (enterprise build), but no cloud billing data. |

## Assistive technology and browsers

- **No real screen reader was run** (VoiceOver/NVDA/JAWS). Every statement about announcements is based on the DOM and accessibility attributes and is unverified. This applies especially to toasts (A11Y-13), dialogs, menus, and charts.
- Only Chromium 140 (headless; headed only for the manual login) was used. Firefox, Safari, Edge, iOS, and Android were not tested.
- Windows High Contrast / forced-colors mode was not tested.
- Voice control (Voice Control / Dragon) was not tested; A11Y-25 comes from source review.

## Manual checks not completed

- 1.4.11 Non-text Contrast: focus rings and input borders were checked for visibility (pixel diff), not for numeric 3:1 contrast.
- 1.4.13 Content on Hover or Focus: tooltips did not render in headless hover within 1.8 s. The suspicion (A11Y-26) rests on source code (`hoverable:false` default).
- 2.5.1 Pointer Gestures, 2.5.2 Pointer Cancellation, 2.5.7 Dragging Movements: dashboard layout editing, pipeline/workflow canvases, and column reordering were not exercised.
- 3.3.4 Error Prevention, 3.3.7 Redundant Entry: multi-step and destructive flows were not completed.
- 2.2.1 Timing: session expiry and re-authentication were not tested.
- 3.3.8 Accessible Authentication: the SSO identity provider and any MFA steps were not tested.
- Reflow, zoom, and text spacing were sampled on 9 key pages, not all routes. Editors, dashboards, and canvas views were not reflow-tested.
- Dark theme was scanned with axe on 12 routes only.

## Measurement caveats and possible false positives

- The **pixel-diff focus check** flags a stop as "no visible focus" when under 2% of the surrounding pixels change. Monaco's caret blink and subtle rings can give borderline readings. The `/dashboards` "Created" column header (partly off-viewport) is **inconclusive** and is not reported as a finding.
- **Toast lifetime** (~2 s) was measured once, for the "Date range copied" toast. Other toasts may use different durations (the source default is 5 s for success/info).
- axe `color-contrast` "incomplete" results (gradients, overlapping elements) were not manually resolved. Raw counts are in `test-results/axe-per-route/*.json`.
- Route-level instance counts for findings mapped from axe signatures are averaged per page when one signature spans several pages (`page-audit-report.md` notes this).
- **A11Y-23** (titles) counts duplicates including routes that redirected. The real number of distinct views sharing one title is lower.
- The source-review statistics (406 icon-only buttons, 171 unlabelled OSelect usages, 29 unlabelled switches, 106 OSearchInput usages) come from a heuristic grep and were not each verified in the browser.

## Unresolved questions

1. Is the 3:1 floor in `utils/theme.ts` an accepted brand decision? If so, it needs an explicit accessibility exception or an alternative accessible theme.
2. Should single-key shortcuts get a user preference (A11Y-25)? This is a product decision.
3. Are the redirecting Settings sub-pages intended to be `_meta`-org only? They should be audited from the `_meta` org.
4. Which of the parameterised detail views are highest priority to audit next? A seeded test org with alerts, incidents, SLOs, and on-call teams would unblock them.

