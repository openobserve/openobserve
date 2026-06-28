# Alert Additional Settings — Contextual Help Side Panels

**Date:** 2026-06-28
**Branch/worktree:** `alerts-advanced-settings-help-panels`
**Status:** Design approved, pending spec review

## Problem

On the alert **Additional Settings** tab (`Advanced.vue`), each control has an info `(i)` icon
that today shows a one-line `OTooltip`. These tooltips don't tell the user what is actually
changing. The headline example: **Template Override** just lists templates — it never shows the
*current* notification message, nor what the message would look like if a different template is
chosen.

## Goal

**Augment** the thin tooltips on three controls (keep them on hover) with rich, contextual help
that opens on click in a right-side side panel (`ODrawer`). Each panel explains the control and
shows a **data-driven preview that substitutes scalar variables truthfully and marks everything
runtime-expanded as "filled at notification time"** — so the user sees what's changing without
being misled by a fake render. All help is delivered through OpenObserve components.

### Controls in scope
- **Template Override** — CURRENT (what's sent today) vs. a non-destructive template preview with
  an "Apply to alert" action.
- **Additional Variables** — explain context attributes, list built-in variables, echo user's vars.
- **Row Template** — explain row formatting + `{rows:N}`/`{var:N}`, preview scalar substitution.

Out of scope: **Description** field (self-explanatory, has no info icon today).

## Architecture

### Single shared drawer
Canonical OpenObserve pattern (matches `AlertHistoryDrawer.vue` and the JSON editor drawer in
`AddAlert.vue`): one non-persistent right-side `ODrawer`, controlled by `v-model:open`, dims the
background, closes on Escape / outside-click. `ODrawer` already neutralizes the reka-ui
focus-trap / interact-outside issues for dropdowns and selects opened *inside* the drawer, so the
Template Override panel can host its own `OSelect`.

**New component:** `web/src/components/alerts/AlertSettingsHelpDrawer.vue`
- Props: `open: boolean`, `topic: "template" | "variables" | "rowTemplate"`, plus the data it needs
  to render previews (form model refs / values — see Data Flow).
- Emits: `update:open`.
- Body renders one of three sub-sections by `topic`; header title changes per topic.
- `size` ≈ `lg` (640px) — enough room for rendered message previews.

### Trigger changes in `Advanced.vue`
Each info icon's `<OButton>` currently wraps an `<OTooltip>`. **Keep the hover tooltip** (the fast
glanceable one-liner) and **add** an `@click` that sets `helpTopic` and `helpDrawerOpen = true`.
So: hover = instant reminder, click = open the rich help drawer. (Reviewer consensus — removing the
tooltip was a convenience regression for the "wait, what's this again?" case.) Local state added to
`Advanced.vue`:
```
const helpDrawerOpen = ref(false);
const helpTopic = ref<"template" | "variables" | "rowTemplate">("template");
function openHelp(topic) { helpTopic.value = topic; helpDrawerOpen.value = true; }
```
The `<AlertSettingsHelpDrawer>` is rendered once at the bottom of `Advanced.vue`.

### Preview renderer — `useTemplatePreview` composable
**New file:** `web/src/composables/alerts/useTemplatePreview.ts`.

Client-side `{variable}` → value substitution **for display only**. Real substitution happens
server-side at notification time (`src/service/alerts/alert.rs:1689-1836`); this is purely a visual
aid for **scalar variables**. It deliberately does NOT attempt to reproduce the server's
context-sensitive logic.

**Three value classes, visually distinguished** (this is the key correctness safeguard — a single
"Preview" label is not enough; the danger is mock numbers sitting next to real ones):
- **Live values** (from the form) — rendered plain/normal. Source of truth: `alert_name`,
  `stream_name`, `stream_type`, `alert_operator`, `alert_threshold`, `alert_period`.
- **Sample/mock values** (runtime-only) — rendered in a distinct "sample" style (dashed/italic, with
  a hover note "example value — actual value determined at trigger time"): `alert_count`,
  `alert_agg_value`, `alert_trigger_time*`, `org_name`, `alert_start_time`, `alert_end_time`,
  `alert_url`.
- **Opaque/runtime-expanded tokens** — rendered as a labeled chip "filled at notification time",
  NOT faked. This covers everything the client cannot faithfully reproduce: `{rows}`, `{rows:N}`,
  `{var:N}`, `{...rows}` / `{...rows:N}` spread syntax, and any `{rows}` sitting inside a JSON
  context (where the server strips surrounding quotes and injects a raw array). Unknown tokens
  (e.g. stream fields, user context_attributes) also render as chips.

A small legend under each preview maps the three styles. Copy-to-clipboard on the rendered output.

**Why not fake `{rows}`/JSON:** the SRE review (reading `alert.rs`) confirmed the server does
JSON-context quote-stripping, `{...rows}` flatten, `{rows:N}` truncation interplay, and string/JSON
fallback that a naive TS replacer cannot match. Faking them produces a confident-but-wrong preview —
worse than none. So we render only what we can render truthfully and chip the rest.

- Exposes `render(templateBody: string): { html }` (scalars substituted, everything else chipped)
  and `renderRowTemplate(rowTemplate, sampleRows)` (same rules; row-level expansion shown as a chip).

Built-in variable list (source of truth, mirrors `AddTemplate.vue` variable guide):
`org_name, stream_type, stream_name, alert_name, alert_type, alert_period, alert_operator,
alert_threshold, alert_count, alert_agg_value, alert_start_time, alert_end_time, alert_url,
alert_trigger_time, alert_trigger_time_millis, alert_trigger_time_seconds, alert_trigger_time_str,
rows`, plus "all stream fields are variables" and `{rows:N}` / `{var:N}` truncation syntax.

## Panel contents

### Panel 1 — Template Override (`topic="template"`)
Stacked sections:
1. **What this does** — a template formats the notification message; selecting one here overrides
   each destination's own template for this alert.
2. **CURRENT** — what gets sent today, captured when the panel **opens**:
   - **Override set:** render that template's body via `useTemplatePreview`.
   - **No override set** (the common new-alert case): do NOT render one fake unified body — that
     would imply all destinations are homogeneous. Instead **list each attached destination and its
     template name** ("varies by destination"). If a destination's template body is readily
     available, offer a per-destination preview; otherwise just name it. (SRE recommendation —
     destinations routinely differ: Slack JSON vs PagerDuty vs webhook.)
3. **PREVIEW A TEMPLATE** — an `OSelect` inside the panel bound to a **local `previewTemplate`
   ref** (NOT the form). Picking one renders its `body` below via `useTemplatePreview` — purely
   exploratory, no mutation. An explicit **"Apply to alert"** footer button commits
   `previewTemplate` to the form's `template` field. (Reviewer consensus — a help panel must not
   silently change the alert while the user is just exploring. The earlier two-way-bound design was
   a footgun.) The button is disabled when `previewTemplate` equals the current form value.

### Panel 2 — Additional Variables (`topic="variables"`)
1. **What this does** — context attributes are extra key/value pairs passed to the destination
   alongside built-in variables; usable in templates as `{your_key}`.
2. **Built-in variables reference** — full list (above), copy-to-clipboard per item.
3. **Your variables right now** — echoes the key/value pairs currently entered in the form
   (`context_attributes`) so the user sees what they added and how to reference them.

### Panel 3 — Row Template (`topic="rowTemplate"`)
1. **What this does** — the row template formats *each matching row*; `{rows}` in the main
   template expands to all rows joined. Covers `{rows:N}` / `{var:N}` truncation.
2. **String vs JSON** — what the toggle changes (`row_template_type`).
3. **Preview** — renders the form's current `row_template` with scalar fields substituted; the
   row-level expansion (`{rows}`, `{rows:N}`, `{var:N}`, `{...rows}`) is shown as a "filled at
   notification time" chip rather than faked (see renderer rules above). Notes the active
   `row_template_type` (String/JSON).

## Data flow
`Advanced.vue` owns the form model (template, context_attributes, row_template, row_template_type,
templates list) and the alert's attached destinations. It passes the values the drawer needs as
props. The Template Override panel's `OSelect` is bound to a **local `previewTemplate` ref** inside
the drawer (no form mutation); an **"Apply to alert"** button emits the chosen value up to set the
form's `template`. The CURRENT section is captured in a `watch`/handler when `open` flips to true,
so it reflects the state at the moment help was opened.

## Components used (all existing OpenObserve)
`ODrawer`, `OSelect`, `OSeparator`, `OButton`, `OIcon`, `OToggleGroup` (read-only display),
`OTooltip` (retained on the info icons for hover help), copy-to-clipboard util, Tailwind `tw:*`
classes, theme tokens. New strings go in `locales/languages/en.json` under
`alerts.alertSettings.*` / `alerts.advanced.*`.

## i18n
- **Keep** the three single-line tooltip strings (still used for hover).
- Add panel headings, body copy, section labels, "Apply to alert", the value-class legend, and the
  CURRENT/preview labels as new i18n keys.

## Testing
- **Unit (Vitest):** `useTemplatePreview` — scalar substitution; live vs sample vs opaque
  classification; `{rows}` / `{rows:N}` / `{var:N}` / `{...rows}` all render as chips (NOT faked);
  unknown-token chipping; row-template rendering.
- **Component:** `AlertSettingsHelpDrawer` renders the correct section per `topic`; "Apply to alert"
  commits `previewTemplate` to the form and is disabled when unchanged; CURRENT is frozen at open;
  no-override CURRENT lists destinations rather than one body.
- **E2E (Playwright):** hover `(i)` shows tooltip; click `(i)` opens the drawer with correct
  content; selecting a template in the panel does NOT change the form until "Apply" is clicked;
  drawer closes on outside-click.
- Follow `data-test` conventions on all interactive elements.

## Risks / notes
- Preview is a **display approximation for scalars only**; everything context-sensitive is chipped,
  not faked — copy must never imply byte-exact output. The value-class legend (live / sample /
  opaque) is the core safeguard against mistaking a mock number for real config.
- The client renderer must NOT drift toward re-implementing `alert.rs`. If a future need for a
  byte-accurate preview arises, add a server-side test-render endpoint rather than expanding the TS
  renderer. (Captured here so the boundary is explicit.)
- Exploration is non-destructive: the panel dropdown is local; only "Apply to alert" mutates the
  form.
- Keep `Advanced.vue` lean — all panel markup lives in `AlertSettingsHelpDrawer.vue`, render
  logic in `useTemplatePreview.ts`.
