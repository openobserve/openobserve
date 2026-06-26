# Action Column Icons — Audit & Standard

Status: **Spec finalized** · Remediation: **pending**
Scope: every list/table view with a row "Actions" column in `web/`.

The user reported four classes of inconsistency: (1) same logical action drawn with
different icons, (2) same icon styled differently, (3) different left-to-right order,
(4) different cell alignment. This document is the single source of truth for fixing them.

---

## 1. The Standard (finalized)

### 1.1 Alignment
- Actions column is **center-aligned**.
- Wrapper: `tw:flex tw:items-center tw:justify-center tw:gap-2`.
- Column header label also centered.

### 1.2 Button & icon sizing (already mostly consistent — keep)
- Button: `size="icon-sm"`.
- Icon: `OIcon ... size="sm"`.
- Use `OButton` ghost variants, never raw `q-btn`/`q-icon` for row actions.

### 1.3 Play / Pause (enable ↔ disable toggle)
- **Running / enabled →** show **pause** icon, `ghost-destructive` (red).
- **Paused / disabled →** show **play** (`play_arrow`) icon, `ghost-success` (green).
- Icon names: `pause` and `play_arrow` (Material), or the OIcon equivalents `pause` / `play`.
- This is always the **first** inline action.

### 1.4 Kebab policy — "always kebab"
- Inline: the **primary toggle only** (play/pause), when the row has one.
- **All other actions** (view, edit, duplicate, move, schema, explore, download, delete…)
  live inside a single trailing **3-dot kebab** (`more_vert`).
- Kebab is always the **last** element in the row.
- Exception: a view with *only one* non-toggle action may show it inline instead of a
  one-item kebab (use judgment; prefer kebab when ≥2).

### 1.5 Delete
- Delete is **always red/destructive** — both standalone/inline **and** inside the kebab
  menu (red label + red icon, as shown in the Action Scripts menu).
- Delete is always the **last** item in the kebab (or last inline icon if standalone).

### 1.6 Canonical icon vocabulary (one icon per concept)
| Concept | Icon | Notes |
|---|---|---|
| Enable (paused→run) | `play_arrow` | green `ghost-success` |
| Disable (run→pause) | `pause` | red `ghost-destructive` |
| View / preview | `visibility` | never `search` for "view" |
| Explore / query data | `search` | data-exploration only, distinct from view |
| Edit | `edit` | already consistent ✓ |
| Duplicate / clone | `content_copy` | already consistent ✓ |
| Move (folder) | `drive_file_move` | |
| Schema / fields | `schema` | |
| Download / export | `download` | |
| More menu | `more_vert` | kebab |
| Delete | `delete` | always red, inline & in menu |

### 1.7 Canonical order (left → right)
`[ play/pause ] … [ ⋮ kebab ]`
Inside the kebab, top → bottom:
`View → Edit → Duplicate → Move → Schema/Explore → Download → ─── → Delete`

---

## 2. Per-view audit (current state)

| View | File | Lines |
|---|---|---|
| Alerts | `web/src/components/alerts/AlertList.vue` | 295–407 |
| Pipelines | `web/src/components/pipeline/PipelinesList.vue` | 89–190 |
| Reports | `web/src/components/reports/ReportList.vue` | 191–240 |
| Functions | `web/src/components/functions/FunctionList.vue` | 88–114 |
| Enrichment Tables | `web/src/components/functions/EnrichmentTableList.vue` | 195–239 |
| Incidents | `web/src/components/alerts/IncidentList.vue` | 158–182 |
| Alert Templates | `web/src/components/alerts/TemplateList.vue` | 116–159 |
| Alert Destinations | `web/src/components/alerts/AlertsDestinationList.vue` | 173–203 |
| Service Accounts | `web/src/components/iam/serviceAccounts/ServiceAccountsList.vue` | 110–142 |
| Users / IAM | `web/src/components/iam/users/User.vue` | 131–162 |
| Anomaly Detection | `web/src/components/anomaly_detection/AnomalyDetectionList.vue` | 86–135 |
| Action Scripts | `web/src/components/actionScripts/ActionScripts.vue` | 101–127 |
| Running Queries | `web/src/components/queries/SummaryList.vue` | 43–52 |
| Cipher Keys | `web/src/components/settings/CipherKeys.vue` | 78–97 |

### Current order & toggle color (the drift)
| View | Current order | Toggle color | Align | Kebab? |
|---|---|---|---|---|
| Alerts | Toggle → Edit → Copy → ⋮ | pause=red | left | yes |
| Pipelines | Toggle → View → Edit → ⋮ | neutral | left | yes |
| Reports | Toggle → Edit → Move → Delete | pause=red | left | no |
| Functions | Edit → Delete → Tree | — | left | no |
| Enrichment | Search → Schema → Edit → Delete | — | center | no |
| Incidents | Acknowledge → Resolve → Reopen | n/a (status) | left | no |
| Templates | Edit → … → Delete | — | left | no |
| Destinations | … | — | center | no |
| Service Accts | … | — | left | no |
| Users | … | — | left | no |
| Anomaly | Toggle → … | neutral | center | no |
| Action Scripts | … | — | left | no |
| Queries | … | — | left | no |
| Cipher Keys | … | — | left | no |

### Already consistent (do not touch)
- Button size `icon-sm`, icon size `sm`.
- `edit` icon for edit, `content_copy` for duplicate.

---

## 3. Remediation checklist (per view → target)

For each view: center-align, apply play=green/pause=red, collapse non-toggle actions
into a kebab, delete neutral-in-menu, normalize icon vocabulary & order.

- [ ] Alerts — recolor toggle (play green), keep kebab, move Copy/Edit order to standard
- [ ] Pipelines — toggle red/green, collapse View/Edit into kebab, center
- [ ] Reports — add kebab (Edit/Move/Delete inside), toggle green play, center
- [ ] Functions — kebab (Edit/Tree/Delete), center, delete red-in-menu
- [ ] Enrichment Tables — kebab (Explore=search/Schema/Edit/Delete), keep center
- [ ] Incidents — status actions exempt from toggle rule; center + confirm icon vocab
- [ ] Templates — kebab, center
- [ ] Destinations — kebab, keep center
- [ ] Service Accounts — kebab, center
- [ ] Users / IAM — kebab, center
- [ ] Anomaly Detection — toggle red/green, kebab, keep center
- [ ] Action Scripts — kebab, center
- [ ] Running Queries — center, confirm vocab
- [ ] Cipher Keys — kebab, center, delete red-in-menu

---

## 4. Suggested shared primitive (follow-up)
Most drift comes from each view hand-rolling its actions cell. Consider a single
`ORowActions` component taking `{ primaryToggle?, menuItems[] }` that bakes in
alignment, sizing, toggle colors, and the kebab — so new views can't drift again.
Track separately from the per-view remediation above.
