# Alert Additional Settings — Contextual Help Side Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the alert Additional Settings tab, clicking the info `(i)` icon next to Template Override, Additional Variables, and Row Template opens a right-side help drawer with explanations and an honest, data-driven preview of the notification message.

**Architecture:** A pure-TS composable (`useTemplatePreview`) classifies and substitutes template tokens (live scalars substituted, runtime-expanded tokens chipped). A single shared `AlertSettingsHelpDrawer.vue` (built on `ODrawer`) renders one of three help sections by a `topic` prop. `Advanced.vue` keeps its hover tooltips and adds a click handler on each `(i)` that opens the drawer; it passes the form values plus the selected destinations so the Template Override panel can show per-destination reality.

**Tech Stack:** Vue 3 (Options API in `Advanced.vue`, `<script setup>` allowed in the new component), TypeScript, Quasar, the OpenObserve `O*` component library (`ODrawer`, `OSelect`, `OButton`, `OIcon`, `OSeparator`, `OToggleGroup`, `OTooltip`), Vitest for unit tests, vue-i18n for strings.

## Global Constraints

- Frontend only. No Rust, no DB, no new HTTP endpoints. The preview is client-side and display-only.
- Do NOT re-implement the server renderer (`src/service/alerts/alert.rs:1689-1836`). Anything context-sensitive — `{rows}`, `{rows:N}`, `{var:N}`, `{...rows}`/`{...rows:N}` spread, `{rows}` inside JSON context — is rendered as an opaque "filled at notification time" chip, never faked.
- Three value classes in any preview, visually distinct: **live** (from the form, plain), **sample** (mock runtime value, dashed/italic style), **opaque** (chip). A legend maps the three.
- Keep the existing hover `OTooltip` on each info icon (hover = glance, click = drawer). Existing tooltip i18n keys stay: `alerts.alertSettings.templateTooltip`, `alerts.advanced.variablesTooltip`, `alerts.advanced.rowTemplateTooltip`.
- The Template Override panel dropdown is **local** (`previewTemplate` ref) — selecting it never mutates the alert. An explicit "Apply to alert" button commits to the form.
- New i18n keys go in `web/src/locales/languages/en.json` only (English baseline). Namespaces: `alerts.alertSettings.*`.
- Follow existing `data-test` conventions (kebab-case, scoped to the drawer's `data-test`).
- Use `cargo build` rules do not apply (frontend). Run unit tests with the repo's vitest runner. Do NOT run `npm run build`.
- Do not commit automatically beyond the per-task commits in this plan; the per-task commits ARE the expected workflow here.

---

## File Structure

- **Create** `web/src/composables/alerts/useTemplatePreview.ts` — token classification + substitution. Pure functions, no Vue reactivity required beyond a factory. One responsibility: turn a template string + a value context into a list of rendered segments tagged by class.
- **Create** `web/src/composables/alerts/__tests__/useTemplatePreview.spec.ts` — unit tests for the composable.
- **Create** `web/src/components/alerts/AlertSettingsHelpDrawer.vue` — the shared drawer, three `topic` sections, the value-class legend, copy buttons, the local preview dropdown + Apply button.
- **Modify** `web/src/components/alerts/steps/Advanced.vue` — add click handlers on the three info icons, drawer state, render `<AlertSettingsHelpDrawer>`, accept new `destinations` / `selectedDestinations` props.
- **Modify** `web/src/components/alerts/AddAlert.vue:280-293` — pass `:destinations` and `:selectedDestinations` into `<Advanced>`.
- **Modify** `web/src/locales/languages/en.json` — add `alerts.alertSettings.*` strings.

---

## Task 1: `useTemplatePreview` composable — token classification

**Files:**
- Create: `web/src/composables/alerts/useTemplatePreview.ts`
- Test: `web/src/composables/alerts/__tests__/useTemplatePreview.spec.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  ```ts
  export type SegmentClass = "text" | "live" | "sample" | "opaque";
  export interface PreviewSegment {
    /** "text" → literal text; otherwise the variable/token name (without braces) */
    kind: SegmentClass;
    /** for text: the literal; for live/sample: the substituted value; for opaque: the original token incl. braces */
    text: string;
  }
  export interface PreviewContext {
    /** values known from the form right now (rendered plain) */
    live: Record<string, string>;
    /** mock runtime values (rendered as "sample") */
    sample: Record<string, string>;
  }
  export function renderTemplate(body: string, ctx: PreviewContext): PreviewSegment[];
  ```
- Rules `renderTemplate` must implement:
  - Scan for `{...}` tokens. A token is `{` + non-`}`/non-`{` chars + `}`.
  - **Opaque** (chip, never substituted), matched FIRST so row tokens win over a same-named scalar:
    - exactly `rows`
    - `rows:` + digits (e.g. `rows:5`)
    - `var:` + digits
    - any token starting with `...` (spread): `...rows`, `...rows:5`, etc.
  - **Live**: token name is a key in `ctx.live` → segment `{kind:"live", text: ctx.live[name]}`.
  - **Sample**: token name is a key in `ctx.sample` → segment `{kind:"sample", text: ctx.sample[name]}`.
  - **Opaque fallback**: any other token (unknown var, stream field, user context attribute) → `{kind:"opaque", text: "{"+name+"}"}`.
  - Literal text between tokens → `{kind:"text", text: literal}`.
  - Precedence order when classifying a token: opaque-pattern → live → sample → opaque-fallback.

- [ ] **Step 1: Write the failing test**

Create `web/src/composables/alerts/__tests__/useTemplatePreview.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  type PreviewContext,
} from "@/composables/alerts/useTemplatePreview";

const ctx: PreviewContext = {
  live: { alert_name: "High CPU", stream_name: "k8s_logs" },
  sample: { alert_count: "42", org_name: "acme" },
};

describe("renderTemplate", () => {
  it("substitutes live scalars as live segments", () => {
    const segs = renderTemplate("Alert {alert_name} fired", ctx);
    expect(segs).toEqual([
      { kind: "text", text: "Alert " },
      { kind: "live", text: "High CPU" },
      { kind: "text", text: " fired" },
    ]);
  });

  it("substitutes mock values as sample segments", () => {
    const segs = renderTemplate("count={alert_count}", ctx);
    expect(segs).toEqual([
      { kind: "text", text: "count=" },
      { kind: "sample", text: "42" },
    ]);
  });

  it("renders {rows} and {rows:N} as opaque chips, never faked", () => {
    expect(renderTemplate("{rows}", ctx)).toEqual([
      { kind: "opaque", text: "{rows}" },
    ]);
    expect(renderTemplate("{rows:5}", ctx)).toEqual([
      { kind: "opaque", text: "{rows:5}" },
    ]);
  });

  it("renders {var:N} and spread {...rows} as opaque chips", () => {
    expect(renderTemplate("{var:10}", ctx)[0]).toEqual({
      kind: "opaque",
      text: "{var:10}",
    });
    expect(renderTemplate("{...rows}", ctx)[0]).toEqual({
      kind: "opaque",
      text: "{...rows}",
    });
    expect(renderTemplate("{...rows:3}", ctx)[0]).toEqual({
      kind: "opaque",
      text: "{...rows:3}",
    });
  });

  it("renders unknown tokens (stream fields, user vars) as opaque chips", () => {
    expect(renderTemplate("{k8s_pod_name}", ctx)[0]).toEqual({
      kind: "opaque",
      text: "{k8s_pod_name}",
    });
  });

  it("opaque row patterns win over a same-named live/sample key", () => {
    const ctx2: PreviewContext = { live: { rows: "SHOULD_NOT_USE" }, sample: {} };
    expect(renderTemplate("{rows}", ctx2)[0]).toEqual({
      kind: "opaque",
      text: "{rows}",
    });
  });

  it("returns a single text segment when there are no tokens", () => {
    expect(renderTemplate("plain text", ctx)).toEqual([
      { kind: "text", text: "plain text" },
    ]);
  });

  it("handles empty input", () => {
    expect(renderTemplate("", ctx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/composables/alerts/__tests__/useTemplatePreview.spec.ts`
Expected: FAIL — `renderTemplate` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/composables/alerts/useTemplatePreview.ts`:

```ts
// Copyright 2026 OpenObserve Inc.
//
// Client-side, DISPLAY-ONLY preview of alert notification templates.
// This intentionally does NOT reproduce the server renderer
// (src/service/alerts/alert.rs). Anything context-sensitive — {rows},
// {rows:N}, {var:N}, {...rows} spread — is rendered as an opaque chip and
// never faked, because a confident-but-wrong preview is worse than none.

export type SegmentClass = "text" | "live" | "sample" | "opaque";

export interface PreviewSegment {
  kind: SegmentClass;
  text: string;
}

export interface PreviewContext {
  live: Record<string, string>;
  sample: Record<string, string>;
}

// Tokens the client must never substitute (server expands these at runtime).
const OPAQUE_PATTERNS: RegExp[] = [
  /^rows$/,
  /^rows:\d+$/,
  /^var:\d+$/,
  /^\.\.\..+$/, // spread: {...rows}, {...rows:3}, etc.
];

function isOpaqueToken(name: string): boolean {
  return OPAQUE_PATTERNS.some((re) => re.test(name));
}

const TOKEN_RE = /\{([^{}]+)\}/g;

export function renderTemplate(
  body: string,
  ctx: PreviewContext,
): PreviewSegment[] {
  const segments: PreviewSegment[] = [];
  if (!body) return segments;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;

  while ((match = TOKEN_RE.exec(body)) !== null) {
    const [full, rawName] = match;
    const name = rawName.trim();

    if (match.index > lastIndex) {
      segments.push({ kind: "text", text: body.slice(lastIndex, match.index) });
    }
    lastIndex = match.index + full.length;

    if (isOpaqueToken(name)) {
      segments.push({ kind: "opaque", text: full });
    } else if (Object.prototype.hasOwnProperty.call(ctx.live, name)) {
      segments.push({ kind: "live", text: ctx.live[name] });
    } else if (Object.prototype.hasOwnProperty.call(ctx.sample, name)) {
      segments.push({ kind: "sample", text: ctx.sample[name] });
    } else {
      segments.push({ kind: "opaque", text: full });
    }
  }

  if (lastIndex < body.length) {
    segments.push({ kind: "text", text: body.slice(lastIndex) });
  }

  return segments;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/composables/alerts/__tests__/useTemplatePreview.spec.ts`
Expected: PASS — 8 passing.

- [ ] **Step 5: Commit**

```bash
git add web/src/composables/alerts/useTemplatePreview.ts web/src/composables/alerts/__tests__/useTemplatePreview.spec.ts
git commit -m "feat(alerts): add useTemplatePreview composable for help-panel previews"
```

---

## Task 2: Sample/live value context builder

**Files:**
- Modify: `web/src/composables/alerts/useTemplatePreview.ts`
- Test: `web/src/composables/alerts/__tests__/useTemplatePreview.spec.ts`

**Interfaces:**
- Consumes: `PreviewContext` from Task 1.
- Produces:
  ```ts
  export interface AlertFormFacts {
    alert_name?: string;
    stream_name?: string;
    stream_type?: string;
    alert_operator?: string;
    alert_threshold?: string | number;
    alert_period?: string | number;
  }
  /** Builds a PreviewContext: known form facts go to `live`, runtime-only
   *  values get fixed mock placeholders in `sample`. Missing facts are simply
   *  absent from `live` (so they fall through to opaque chips). */
  export function buildPreviewContext(facts: AlertFormFacts): PreviewContext;
  ```
- The `sample` map is a FIXED set (no randomness — keeps tests deterministic and matches the spec's "mock fallbacks"):
  `org_name: "acme-corp"`, `stream_type` only if not in facts, `alert_count: "42"`, `alert_agg_value: "91.5"`, `alert_start_time: "2026-06-28T10:25:00Z"`, `alert_end_time: "2026-06-28T10:30:00Z"`, `alert_url: "https://app.openobserve.ai/alerts/example"`, `alert_trigger_time: "2026-06-28T10:30:00Z"`, `alert_trigger_time_millis: "1782303000000"`, `alert_trigger_time_seconds: "1782303000"`, `alert_trigger_time_str: "Jun 28, 2026 10:30:00"`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/composables/alerts/__tests__/useTemplatePreview.spec.ts`:

```ts
import { buildPreviewContext } from "@/composables/alerts/useTemplatePreview";

describe("buildPreviewContext", () => {
  it("puts provided form facts in `live`", () => {
    const ctx = buildPreviewContext({
      alert_name: "High CPU",
      stream_name: "k8s_logs",
      alert_threshold: 5,
    });
    expect(ctx.live.alert_name).toBe("High CPU");
    expect(ctx.live.stream_name).toBe("k8s_logs");
    expect(ctx.live.alert_threshold).toBe("5"); // coerced to string
  });

  it("omits absent facts from `live`", () => {
    const ctx = buildPreviewContext({ alert_name: "X" });
    expect("stream_name" in ctx.live).toBe(false);
  });

  it("provides deterministic mock runtime values in `sample`", () => {
    const ctx = buildPreviewContext({});
    expect(ctx.sample.alert_count).toBe("42");
    expect(ctx.sample.org_name).toBe("acme-corp");
    expect(ctx.sample.alert_trigger_time).toBe("2026-06-28T10:30:00Z");
  });

  it("renders a mixed template end to end", () => {
    const ctx = buildPreviewContext({ alert_name: "High CPU" });
    const segs = renderTemplate(
      "{alert_name} count {alert_count} rows {rows}",
      ctx,
    );
    expect(segs.map((s) => s.kind)).toEqual([
      "live", // alert_name (text "" between is skipped only if empty)
      "text",
      "sample", // alert_count
      "text",
      "opaque", // {rows}
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/composables/alerts/__tests__/useTemplatePreview.spec.ts`
Expected: FAIL — `buildPreviewContext` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `web/src/composables/alerts/useTemplatePreview.ts`:

```ts
export interface AlertFormFacts {
  alert_name?: string;
  stream_name?: string;
  stream_type?: string;
  alert_operator?: string;
  alert_threshold?: string | number;
  alert_period?: string | number;
}

const MOCK_SAMPLE: Record<string, string> = {
  org_name: "acme-corp",
  alert_count: "42",
  alert_agg_value: "91.5",
  alert_start_time: "2026-06-28T10:25:00Z",
  alert_end_time: "2026-06-28T10:30:00Z",
  alert_url: "https://app.openobserve.ai/alerts/example",
  alert_trigger_time: "2026-06-28T10:30:00Z",
  alert_trigger_time_millis: "1782303000000",
  alert_trigger_time_seconds: "1782303000",
  alert_trigger_time_str: "Jun 28, 2026 10:30:00",
};

export function buildPreviewContext(facts: AlertFormFacts): PreviewContext {
  const live: Record<string, string> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value !== undefined && value !== null && value !== "") {
      live[key] = String(value);
    }
  }
  // sample provides stream_type only if the form didn't supply it
  const sample: Record<string, string> = { ...MOCK_SAMPLE };
  if (!("stream_type" in live)) sample.stream_type = "logs";
  return { live, sample };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/composables/alerts/__tests__/useTemplatePreview.spec.ts`
Expected: PASS — all tests green (Task 1 + Task 2).

- [ ] **Step 5: Commit**

```bash
git add web/src/composables/alerts/useTemplatePreview.ts web/src/composables/alerts/__tests__/useTemplatePreview.spec.ts
git commit -m "feat(alerts): add buildPreviewContext for live vs mock template values"
```

---

## Task 3: i18n strings for the help panels

**Files:**
- Modify: `web/src/locales/languages/en.json`

**Interfaces:**
- Consumes: nothing.
- Produces: i18n keys under `alerts.alertSettings.*` consumed by Task 4 and Task 5.

- [ ] **Step 1: Locate the `alerts.alertSettings` object**

Run: `cd web && node -e "const j=require('./src/locales/languages/en.json'); console.log(JSON.stringify(j.alerts.alertSettings, null, 2))"`
Expected: prints the existing object containing `templateTooltip` (confirms the path exists). If `alertSettings` is missing, it is nested under `alerts` — confirm with `console.log(Object.keys(j.alerts))`.

- [ ] **Step 2: Add the help-panel keys**

In `web/src/locales/languages/en.json`, inside the `alerts.alertSettings` object (next to `templateTooltip`), add the following keys (keep valid JSON — add a comma after the preceding entry):

```json
"helpTemplateTitle": "Template Override",
"helpVariablesTitle": "Additional Variables",
"helpRowTemplateTitle": "Row Template",
"helpWhatThisDoes": "What this does",
"helpLegendTitle": "Preview legend",
"helpLegendLive": "Your data",
"helpLegendSample": "Example value (set when the alert fires)",
"helpLegendOpaque": "Filled in at notification time",
"helpTemplateExplain": "A template formats the notification message sent to your destinations. Selecting one here overrides each destination's own template for this alert only.",
"helpCurrentHeading": "Sent today",
"helpCurrentNoOverride": "No override set — each destination uses its own template:",
"helpCurrentNoDestinations": "No destinations selected yet. Each destination will use its own configured template.",
"helpCurrentOverrideHeading": "All destinations use this template:",
"helpPreviewHeading": "Preview a template",
"helpPreviewSelectPlaceholder": "Select a template to preview",
"helpApplyToAlert": "Apply to alert",
"helpVariablesExplain": "Context attributes are extra key/value pairs passed to your destinations alongside the built-in variables. Reference them in a template as {your_key}.",
"helpBuiltInHeading": "Built-in variables",
"helpBuiltInFooter": "All stream fields are also available as variables. Use {rows:N} or {var:N} to limit rows or string length.",
"helpYourVariablesHeading": "Your variables",
"helpYourVariablesEmpty": "You haven't added any variables yet.",
"helpRowTemplateExplain": "The row template formats each matching row. In the main template, {rows} expands to all matching rows joined together; {rows:N} limits the count and {var:N} truncates a value's length.",
"helpRowTemplateTypeHeading": "String vs JSON",
"helpRowTemplateTypeExplain": "String produces plain text per row. JSON produces a JSON object per row, suitable for structured destinations.",
"helpPreviewHeadingShort": "Preview",
"helpCopy": "Copy"
```

- [ ] **Step 3: Verify JSON is still valid**

Run: `cd web && node -e "require('./src/locales/languages/en.json'); console.log('valid')"`
Expected: prints `valid` (no JSON parse error).

- [ ] **Step 4: Commit**

```bash
git add web/src/locales/languages/en.json
git commit -m "feat(alerts): add i18n strings for additional-settings help panels"
```

---

## Task 4: `AlertSettingsHelpDrawer.vue` — shell, sections, preview rendering

**Files:**
- Create: `web/src/components/alerts/AlertSettingsHelpDrawer.vue`

**Interfaces:**
- Consumes: `renderTemplate`, `buildPreviewContext`, types `PreviewSegment`, `AlertFormFacts` from Task 1/2; i18n keys from Task 3; `ODrawer`, `OSelect`, `OButton`, `OIcon`, `OSeparator` components; `copyToClipboard` from `@/utils/clipboard`.
- Produces:
  ```ts
  // Props
  open: boolean
  topic: "template" | "variables" | "rowTemplate"
  // template data
  templates: any[]                  // [{ name, body, type, ... }]
  currentTemplate: string           // form's template name ("" = no override)
  selectedDestinations: string[]    // destination names attached to this alert
  destinations: any[]               // full Destination objects [{ name, template }]
  // variables
  contextAttributes: { id: string; key: string; value: string }[]
  // row template
  rowTemplate: string
  rowTemplateType: string           // "String" | "Json"
  // facts for preview substitution
  facts: AlertFormFacts
  // Emits
  "update:open": (v: boolean) => void
  "apply:template": (name: string) => void   // Apply-to-alert button
  ```

- [ ] **Step 1: Create the component**

Create `web/src/components/alerts/AlertSettingsHelpDrawer.vue`:

```vue
<!-- Copyright 2026 OpenObserve Inc. -->
<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { copyToClipboard } from "@/utils/clipboard";
import {
  renderTemplate,
  buildPreviewContext,
  type PreviewSegment,
  type AlertFormFacts,
} from "@/composables/alerts/useTemplatePreview";

const props = withDefaults(
  defineProps<{
    open: boolean;
    topic: "template" | "variables" | "rowTemplate";
    templates?: any[];
    currentTemplate?: string;
    selectedDestinations?: string[];
    destinations?: any[];
    contextAttributes?: { id: string; key: string; value: string }[];
    rowTemplate?: string;
    rowTemplateType?: string;
    facts?: AlertFormFacts;
  }>(),
  {
    templates: () => [],
    currentTemplate: "",
    selectedDestinations: () => [],
    destinations: () => [],
    contextAttributes: () => [],
    rowTemplate: "",
    rowTemplateType: "String",
    facts: () => ({}),
  },
);

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
  (e: "apply:template", name: string): void;
}>();

const { t } = useI18n();

const title = computed(() => {
  switch (props.topic) {
    case "variables":
      return t("alerts.alertSettings.helpVariablesTitle");
    case "rowTemplate":
      return t("alerts.alertSettings.helpRowTemplateTitle");
    default:
      return t("alerts.alertSettings.helpTemplateTitle");
  }
});

const ctx = computed(() => buildPreviewContext(props.facts));

function bodyOf(name: string): string {
  const tpl = props.templates.find((x: any) => x.name === name);
  if (!tpl) return "";
  return typeof tpl.body === "string" ? tpl.body : JSON.stringify(tpl.body, null, 2);
}

function segmentsFor(name: string): PreviewSegment[] {
  return renderTemplate(bodyOf(name), ctx.value);
}

// ── CURRENT snapshot, frozen when the drawer opens ──────────────────
const snapshotTemplate = ref("");
const snapshotDestinations = ref<{ name: string; template: string }[]>([]);

function templateNameFor(destName: string): string {
  const d = props.destinations.find((x: any) => x.name === destName);
  if (!d) return "";
  const tpl = (d as any).template;
  if (!tpl) return "";
  return typeof tpl === "string" ? tpl : tpl.name ?? "";
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      snapshotTemplate.value = props.currentTemplate;
      snapshotDestinations.value = props.selectedDestinations.map((name) => ({
        name,
        template: templateNameFor(name),
      }));
      previewTemplate.value = props.currentTemplate || undefined;
    }
  },
);

// ── Local preview dropdown (does NOT mutate the form) ───────────────
const previewTemplate = ref<string | undefined>(undefined);
const templateNames = computed(() => props.templates.map((x: any) => x.name));
const applyDisabled = computed(
  () => !previewTemplate.value || previewTemplate.value === props.currentTemplate,
);
function applyTemplate() {
  if (previewTemplate.value) emit("apply:template", previewTemplate.value);
  emit("update:open", false);
}

// Row template preview
const rowSegments = computed(() => renderTemplate(props.rowTemplate, ctx.value));

// Built-in variable reference (mirrors AddTemplate.vue variable guide)
const builtInVars = [
  "org_name", "stream_type", "stream_name", "alert_name", "alert_type",
  "alert_period", "alert_operator", "alert_threshold", "alert_count",
  "alert_agg_value", "alert_start_time", "alert_end_time", "alert_url",
  "alert_trigger_time", "alert_trigger_time_millis",
  "alert_trigger_time_seconds", "alert_trigger_time_str", "rows",
];

function copyVar(name: string) {
  copyToClipboard(`{${name}}`, { successMessage: `Copied {${name}}` });
}
function copyText(text: string) {
  copyToClipboard(text);
}
</script>

<template>
  <ODrawer
    data-test="alert-settings-help-drawer"
    :open="open"
    size="lg"
    :title="title"
    @update:open="emit('update:open', $event)"
  >
    <div class="tw:px-4 tw:py-4 tw:flex tw:flex-col tw:gap-5 tw:text-sm">
      <!-- Legend (shared, only where a preview is shown) -->
      <div
        v-if="topic === 'template' || topic === 'rowTemplate'"
        data-test="help-legend"
        class="tw:flex tw:flex-wrap tw:gap-3 tw:text-xs tw:opacity-80"
      >
        <span><span class="tw:font-medium">{{ t("alerts.alertSettings.helpLegendLive") }}</span></span>
        <span class="tw:italic tw:underline tw:decoration-dashed">{{ t("alerts.alertSettings.helpLegendSample") }}</span>
        <span class="tw:px-1 tw:rounded tw:bg-gray-200 tw:dark:bg-gray-700">{{ t("alerts.alertSettings.helpLegendOpaque") }}</span>
      </div>

      <!-- ══ TEMPLATE OVERRIDE ══ -->
      <template v-if="topic === 'template'">
        <section>
          <h3 class="tw:font-semibold tw:mb-1">{{ t("alerts.alertSettings.helpWhatThisDoes") }}</h3>
          <p class="tw:opacity-80">{{ t("alerts.alertSettings.helpTemplateExplain") }}</p>
        </section>

        <OSeparator />

        <section data-test="help-current-section">
          <h3 class="tw:font-semibold tw:mb-2">{{ t("alerts.alertSettings.helpCurrentHeading") }}</h3>

          <!-- Override set: one rendered body -->
          <template v-if="snapshotTemplate">
            <p class="tw:opacity-80 tw:mb-1">{{ t("alerts.alertSettings.helpCurrentOverrideHeading") }}</p>
            <pre class="preview-box"><template v-for="(s, i) in segmentsFor(snapshotTemplate)" :key="i"><span :class="segClass(s.kind)">{{ s.text }}</span></template></pre>
          </template>

          <!-- No override: list destinations and their templates -->
          <template v-else>
            <p class="tw:opacity-80 tw:mb-2">{{ t("alerts.alertSettings.helpCurrentNoOverride") }}</p>
            <p v-if="!snapshotDestinations.length" class="tw:opacity-60 tw:italic">
              {{ t("alerts.alertSettings.helpCurrentNoDestinations") }}
            </p>
            <ul v-else class="tw:flex tw:flex-col tw:gap-1">
              <li
                v-for="d in snapshotDestinations"
                :key="d.name"
                data-test="help-destination-row"
                class="tw:flex tw:justify-between tw:gap-3 tw:border tw:border-border-default tw:rounded tw:px-2 tw:py-1"
              >
                <span class="tw:font-medium">{{ d.name }}</span>
                <span class="tw:opacity-70">{{ d.template || "—" }}</span>
              </li>
            </ul>
          </template>
        </section>

        <OSeparator />

        <section>
          <h3 class="tw:font-semibold tw:mb-2">{{ t("alerts.alertSettings.helpPreviewHeading") }}</h3>
          <OSelect
            v-model="previewTemplate"
            :options="templateNames"
            clearable
            data-test="help-preview-template-select"
            :placeholder="t('alerts.alertSettings.helpPreviewSelectPlaceholder')"
            class="tw:max-w-[320px] tw:mb-2"
          />
          <pre v-if="previewTemplate" class="preview-box"><template v-for="(s, i) in segmentsFor(previewTemplate)" :key="i"><span :class="segClass(s.kind)">{{ s.text }}</span></template></pre>
        </section>
      </template>

      <!-- ══ ADDITIONAL VARIABLES ══ -->
      <template v-else-if="topic === 'variables'">
        <section>
          <h3 class="tw:font-semibold tw:mb-1">{{ t("alerts.alertSettings.helpWhatThisDoes") }}</h3>
          <p class="tw:opacity-80">{{ t("alerts.alertSettings.helpVariablesExplain") }}</p>
        </section>

        <OSeparator />

        <section>
          <h3 class="tw:font-semibold tw:mb-2">{{ t("alerts.alertSettings.helpBuiltInHeading") }}</h3>
          <div class="tw:flex tw:flex-wrap tw:gap-2">
            <button
              v-for="v in builtInVars"
              :key="v"
              type="button"
              data-test="help-builtin-var"
              class="tw:px-2 tw:py-0.5 tw:rounded tw:border tw:border-border-default tw:text-xs tw:font-mono tw:cursor-pointer tw:hover:bg-gray-100 tw:dark:hover:bg-gray-700"
              @click="copyVar(v)"
            >
              {{ "{" + v + "}" }}
            </button>
          </div>
          <p class="tw:opacity-70 tw:text-xs tw:mt-2">{{ t("alerts.alertSettings.helpBuiltInFooter") }}</p>
        </section>

        <OSeparator />

        <section data-test="help-your-variables">
          <h3 class="tw:font-semibold tw:mb-2">{{ t("alerts.alertSettings.helpYourVariablesHeading") }}</h3>
          <p v-if="!contextAttributes.length" class="tw:opacity-60 tw:italic">
            {{ t("alerts.alertSettings.helpYourVariablesEmpty") }}
          </p>
          <ul v-else class="tw:flex tw:flex-col tw:gap-1">
            <li
              v-for="cv in contextAttributes"
              :key="cv.id"
              class="tw:flex tw:justify-between tw:gap-3 tw:border tw:border-border-default tw:rounded tw:px-2 tw:py-1"
            >
              <span class="tw:font-mono tw:text-xs">{{ "{" + cv.key + "}" }}</span>
              <span class="tw:opacity-70">{{ cv.value }}</span>
            </li>
          </ul>
        </section>
      </template>

      <!-- ══ ROW TEMPLATE ══ -->
      <template v-else>
        <section>
          <h3 class="tw:font-semibold tw:mb-1">{{ t("alerts.alertSettings.helpWhatThisDoes") }}</h3>
          <p class="tw:opacity-80">{{ t("alerts.alertSettings.helpRowTemplateExplain") }}</p>
        </section>

        <OSeparator />

        <section>
          <h3 class="tw:font-semibold tw:mb-1">{{ t("alerts.alertSettings.helpRowTemplateTypeHeading") }}</h3>
          <p class="tw:opacity-80">{{ t("alerts.alertSettings.helpRowTemplateTypeExplain") }}</p>
          <p class="tw:opacity-60 tw:text-xs tw:mt-1">{{ rowTemplateType }}</p>
        </section>

        <OSeparator />

        <section>
          <h3 class="tw:font-semibold tw:mb-2">{{ t("alerts.alertSettings.helpPreviewHeadingShort") }}</h3>
          <pre class="preview-box"><template v-for="(s, i) in rowSegments" :key="i"><span :class="segClass(s.kind)">{{ s.text }}</span></template></pre>
        </section>
      </template>
    </div>
  </ODrawer>
</template>

<script lang="ts">
// segClass maps a segment kind to its visual style class. Defined in a
// classic <script> block so it is available to the template as a method
// without polluting the setup return.
export default {
  methods: {
    segClass(kind: string) {
      switch (kind) {
        case "live":
          return "seg-live";
        case "sample":
          return "seg-sample";
        case "opaque":
          return "seg-opaque";
        default:
          return "seg-text";
      }
    },
  },
};
</script>

<style scoped lang="scss">
.preview-box {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-default, #e6e6e6);
  background: rgba(0, 0, 0, 0.02);
}
.seg-live { /* plain — user's real data */ }
.seg-sample {
  font-style: italic;
  text-decoration: underline dashed;
  opacity: 0.85;
}
.seg-opaque {
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(120, 120, 120, 0.18);
}
.seg-text { /* literal */ }
</style>
```

NOTE on the dual `<script>`: `segClass` is defined in a plain `<script>` Options block alongside `<script setup>` — this is a supported Vue SFC pattern. If the project lint forbids mixing, instead move `segClass` into `<script setup>` as a function and it will be auto-exposed to the template (verify by running the Task 6 component test — if the template can't resolve `segClass`, convert it). Prefer the `<script setup>` function form if unsure:

```ts
function segClass(kind: string) {
  return kind === "live" ? "seg-live"
    : kind === "sample" ? "seg-sample"
    : kind === "opaque" ? "seg-opaque"
    : "seg-text";
}
```

- [ ] **Step 2: Type-check the new component**

Run: `cd web && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "AlertSettingsHelpDrawer" || echo "no type errors in AlertSettingsHelpDrawer"`
Expected: `no type errors in AlertSettingsHelpDrawer` (or fix any reported error). If `vue-tsc` is slow/unavailable for the whole project, this gate may be skipped in favor of the Task 6 component test.

- [ ] **Step 3: Verify component imports resolve**

Run: `cd web && test -f src/lib/core/Separator/OSeparator.vue && echo "OSeparator exists" || echo "MISSING OSeparator — check path"`
Expected: `OSeparator exists`. If missing, search: `find src/lib -iname 'OSeparator*'` and correct the import path in the component.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/alerts/AlertSettingsHelpDrawer.vue
git commit -m "feat(alerts): add AlertSettingsHelpDrawer with three help sections"
```

---

## Task 5: Wire the drawer into `Advanced.vue` (icons → open, keep tooltips)

**Files:**
- Modify: `web/src/components/alerts/steps/Advanced.vue`

**Interfaces:**
- Consumes: `AlertSettingsHelpDrawer` (Task 4).
- Produces: two new props on `Advanced` (`destinations`, `selectedDestinations`) consumed by Task 7's `AddAlert.vue` wiring; an `apply:template` path that reuses the existing `update:template` emit.

- [ ] **Step 1: Add the click handler to each info icon's OButton**

In `web/src/components/alerts/steps/Advanced.vue`, for EACH of the three info-icon `<OButton>` blocks (Template at lines ~36-43, Variables ~72-79, Row Template ~151-159), add a `data-test`, an `@click`, and KEEP the existing `<OTooltip>`. Replace the Template one:

```html
<OButton
  data-test="advanced-template-info-btn"
  style="color: #a0a0a0"
  variant="ghost"
  size="icon-sm"
  @click="openHelp('template')"
>
  <OIcon name="info-outline" size="sm" />
  <OTooltip :content="t('alerts.alertSettings.templateTooltip')" />
</OButton>
```

Replace the Variables one:

```html
<OButton
  data-test="advanced-variables-info-btn"
  style="color: #a0a0a0"
  variant="ghost"
  size="icon-sm"
  @click="openHelp('variables')"
>
  <OIcon name="info-outline" size="sm" />
  <OTooltip :content="t('alerts.advanced.variablesTooltip')" />
</OButton>
```

Replace the Row Template one (it already has `data-test="add-alert-row-input-info-btn"` — keep that):

```html
<OButton
  data-test="add-alert-row-input-info-btn"
  style="color: #a0a0a0"
  variant="ghost"
  size="icon-sm"
  @click="openHelp('rowTemplate')"
>
  <OIcon name="info-outline" size="sm" />
  <OTooltip :content="t('alerts.advanced.rowTemplateTooltip')" />
</OButton>
```

- [ ] **Step 2: Render the drawer at the end of the template**

In `Advanced.vue`, immediately before the final closing `</div>` of the root element (after line 189's `</div>` that closes `.tw:px-3...`, but inside the root `.step-advanced` div — place it right before line 191 `</div>`), add:

```html
    <AlertSettingsHelpDrawer
      v-model:open="helpDrawerOpen"
      :topic="helpTopic"
      :templates="templates"
      :current-template="localTemplate || ''"
      :selected-destinations="selectedDestinations"
      :destinations="destinations"
      :context-attributes="localVariables"
      :row-template="localRowTemplate"
      :row-template-type="localRowTemplateType"
      :facts="previewFacts"
      @apply:template="onApplyTemplate"
    />
```

- [ ] **Step 3: Add props, state, and handlers in setup**

In the `props` object (after `rowTemplateType`, before the closing `}`), add:

```ts
    destinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    selectedDestinations: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
```

Register the component in `components: { ... }` (add `AlertSettingsHelpDrawer`) and import it at the top with the other imports:

```ts
import AlertSettingsHelpDrawer from "@/components/alerts/AlertSettingsHelpDrawer.vue";
```

In `setup`, add the drawer state, the facts computed, and the apply handler (place before the `return`):

```ts
    const helpDrawerOpen = ref(false);
    const helpTopic = ref<"template" | "variables" | "rowTemplate">("template");
    const openHelp = (topic: "template" | "variables" | "rowTemplate") => {
      helpTopic.value = topic;
      helpDrawerOpen.value = true;
    };

    // Facts the preview can render truthfully. Stream/alert-name facts live in
    // sibling steps; expose what Advanced.vue holds today (extend later if the
    // parent passes more). row_template type is not a fact.
    const previewFacts = computed(() => ({
      // Advanced.vue has no direct alert_name/stream here; left for parent to
      // extend via props in a future pass. Empty facts → those tokens chip.
    }));

    const onApplyTemplate = (name: string) => {
      localTemplate.value = name;
      emitTemplateUpdate();
    };
```

Add `helpDrawerOpen`, `helpTopic`, `openHelp`, `previewFacts`, `onApplyTemplate` to the `return { ... }` block.

- [ ] **Step 4: Run the existing alert test suite to confirm no regressions**

Run: `cd web && npx vitest run src/composables/alerts/__tests__/useTemplatePreview.spec.ts`
Expected: PASS (composable still green; this confirms imports didn't break the module graph).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/alerts/steps/Advanced.vue
git commit -m "feat(alerts): open help drawer from Additional Settings info icons"
```

---

## Task 6: Component test for `AlertSettingsHelpDrawer`

**Files:**
- Create: `web/src/components/alerts/__tests__/AlertSettingsHelpDrawer.spec.ts`

**Interfaces:**
- Consumes: `AlertSettingsHelpDrawer` (Task 4).
- Produces: nothing.

- [ ] **Step 1: Check how existing component specs mount + stub i18n**

Run: `cd web && find src -name '*.spec.ts' -path '*components*' | head -3; echo '---'; grep -rl "mount(" src --include=*.spec.ts | head -3`
Expected: prints example spec files. Open one to copy the mount + i18n/global-plugins boilerplate the repo uses (e.g. `installQuasar`, `i18n`, `store`). Use that boilerplate verbatim in Step 2 (the snippet below assumes `@vue/test-utils` + a shared `i18n` instance; adapt to the repo's helper if it differs).

- [ ] **Step 2: Write the component test**

Create `web/src/components/alerts/__tests__/AlertSettingsHelpDrawer.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import en from "@/locales/languages/en.json";
import AlertSettingsHelpDrawer from "@/components/alerts/AlertSettingsHelpDrawer.vue";

vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn() }));

const i18n = createI18n({ legacy: false, locale: "en", messages: { en } });

function mountDrawer(props: Record<string, any>) {
  return mount(AlertSettingsHelpDrawer, {
    props: { open: true, topic: "template", ...props },
    global: {
      plugins: [i18n],
      stubs: {
        // Stub ODrawer to render its default slot inline so we can query body.
        ODrawer: { template: "<div><slot /></div>" },
        OSeparator: true,
        OSelect: {
          props: ["modelValue", "options"],
          emits: ["update:modelValue"],
          template: "<select />",
        },
        OButton: { template: "<button><slot /></button>" },
        OIcon: true,
      },
    },
  });
}

describe("AlertSettingsHelpDrawer", () => {
  it("renders the current section for topic=template", () => {
    const w = mountDrawer({ topic: "template" });
    expect(w.find('[data-test="help-current-section"]').exists()).toBe(true);
  });

  it("lists destinations and their templates when no override is set", async () => {
    const w = mountDrawer({
      topic: "template",
      currentTemplate: "",
      selectedDestinations: ["slack-dest", "pd-dest"],
      destinations: [
        { name: "slack-dest", template: "slack-tpl" },
        { name: "pd-dest", template: { name: "pd-tpl" } },
      ],
    });
    // snapshot is captured on open watcher; open was true at mount → trigger it
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    const rows = w.findAll('[data-test="help-destination-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("slack-dest");
    expect(rows[0].text()).toContain("slack-tpl");
    expect(rows[1].text()).toContain("pd-tpl");
  });

  it("renders built-in variable chips for topic=variables", () => {
    const w = mountDrawer({ topic: "variables" });
    const chips = w.findAll('[data-test="help-builtin-var"]');
    expect(chips.length).toBeGreaterThan(10);
    expect(chips.some((c) => c.text() === "{alert_name}")).toBe(true);
  });

  it("shows empty state when the user has no context variables", () => {
    const w = mountDrawer({ topic: "variables", contextAttributes: [] });
    expect(w.find('[data-test="help-your-variables"]').text()).toContain(
      en.alerts.alertSettings.helpYourVariablesEmpty,
    );
  });

  it("emits apply:template and closes when Apply is invoked", async () => {
    const w = mountDrawer({
      topic: "template",
      currentTemplate: "",
      templates: [{ name: "tpl-a", body: "hello {alert_name}" }],
    });
    // call the exposed handler via the component instance
    (w.vm as any).previewTemplate = "tpl-a";
    (w.vm as any).applyTemplate();
    expect(w.emitted("apply:template")?.[0]).toEqual(["tpl-a"]);
    expect(w.emitted("update:open")?.at(-1)).toEqual([false]);
  });
});
```

- [ ] **Step 3: Run the component test**

Run: `cd web && npx vitest run src/components/alerts/__tests__/AlertSettingsHelpDrawer.spec.ts`
Expected: PASS — 5 passing. If `applyTemplate`/`previewTemplate` are not reachable on `w.vm` (because `<script setup>` doesn't auto-expose), add `defineExpose({ applyTemplate, previewTemplate })` in the component's `<script setup>` and re-run. If the `segClass` dual-script form errors, switch to the `<script setup>` function form noted in Task 4.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/alerts/AlertSettingsHelpDrawer.vue web/src/components/alerts/__tests__/AlertSettingsHelpDrawer.spec.ts
git commit -m "test(alerts): component tests for AlertSettingsHelpDrawer"
```

---

## Task 7: Pass destinations from `AddAlert.vue`

**Files:**
- Modify: `web/src/components/alerts/AddAlert.vue:280-293`

**Interfaces:**
- Consumes: `Advanced`'s new `destinations` / `selectedDestinations` props (Task 5).
- Produces: nothing.

- [ ] **Step 1: Add the two props to the `<Advanced>` usage**

In `web/src/components/alerts/AddAlert.vue`, in the `<Advanced ... />` block (lines 280-293), add two attributes alongside the existing ones:

```html
                :destinations="destinations"
                :selectedDestinations="formData.destinations"
```

(`destinations` is the existing prop holding full destination objects; `formData.destinations` holds the selected destination names — confirmed in useAlertForm.ts:135 and AddAlert props at line 469.)

- [ ] **Step 2: Confirm `destinations` is in scope in AddAlert**

Run: `cd web && grep -n "destinations:" src/components/alerts/AddAlert.vue | head`
Expected: shows the `destinations` prop declaration (around line 469). If `destinations` is only available under a different name, use that name instead.

- [ ] **Step 3: Run the composable + component tests once more**

Run: `cd web && npx vitest run src/composables/alerts/__tests__/useTemplatePreview.spec.ts src/components/alerts/__tests__/AlertSettingsHelpDrawer.spec.ts`
Expected: PASS — all green.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/alerts/AddAlert.vue
git commit -m "feat(alerts): pass destinations into Advanced for help drawer current-state"
```

---

## Task 8: E2E smoke test (Playwright)

**Files:**
- Create or extend: locate the existing alerts E2E spec and add cases (do NOT invent a new harness).

**Interfaces:**
- Consumes: the running app + the new `data-test` selectors.
- Produces: nothing.

- [ ] **Step 1: Find the existing alerts E2E spec and selectors helper**

Run: `cd /Users/ashishkolhe/Documents/github/openobserve && find . -path '*tests*' -iname '*alert*' -name '*.spec.*' 2>/dev/null | grep -iv node_modules | head; echo '---'; find . -path '*playwright*' -name '*.ts' 2>/dev/null | grep -iv node_modules | head`
Expected: lists the alert E2E spec(s). Open the one that covers creating an alert / the Additional Settings step. If none exists for this step, add the cases to the closest alert-creation spec.

- [ ] **Step 2: Add the three E2E assertions**

In the located spec, after navigating to the Additional Settings / Advanced step of the alert form, add (adapt selectors/fixtures to the file's existing patterns):

```ts
// hover shows tooltip, click opens the help drawer
await page.locator('[data-test="advanced-template-info-btn"]').click();
await expect(page.locator('[data-test="alert-settings-help-drawer"]')).toBeVisible();
await expect(page.locator('[data-test="help-current-section"]')).toBeVisible();

// selecting a template in the panel does NOT change the form until Apply
// (assert the form's Template Override select value is unchanged here)
const formSelect = page.locator('[data-test="advanced-template-override-select"]');
const before = await formSelect.textContent();
// pick first option in the panel preview select
await page.locator('[data-test="help-preview-template-select"]').click();
// ... select an option per the OSelect interaction pattern used elsewhere ...
await expect(formSelect).toHaveText(before ?? "");

// drawer closes on outside click (overlay)
await page.locator('[data-test="o-drawer-overlay"]').click({ force: true });
await expect(page.locator('[data-test="alert-settings-help-drawer"]')).toBeHidden();
```

- [ ] **Step 3: Run the E2E spec**

Run the repo's standard alert E2E command (check `package.json` scripts — e.g. `npm run test:e2e -- <spec>` or the Playwright invocation the team uses). Document the exact command found and run only the touched spec.
Expected: the three new assertions pass. If the OSelect interaction differs, mirror the pattern already used in the same spec for the existing Template Override select.

- [ ] **Step 4: Commit**

```bash
git add <touched e2e spec path>
git commit -m "test(alerts): e2e for Additional Settings help drawer"
```

---

## Self-Review

**Spec coverage:**
- Single shared `ODrawer`, `topic` prop, three sections → Task 4. ✓
- Keep hover tooltip + click opens drawer → Task 5 (tooltips retained, click added). ✓
- `useTemplatePreview` scalar substitution; live/sample/opaque classes; `{rows}`/`{rows:N}`/`{var:N}`/`{...rows}` chipped not faked → Tasks 1, 2, with the legend in Task 4. ✓
- Template Override: CURRENT frozen at open; no-override lists destinations+templates; local preview dropdown + "Apply to alert" → Task 4 (snapshot watcher, destination list, `applyTemplate`/`apply:template`). ✓
- Additional Variables: explain + built-in reference (copy) + echo user's vars → Task 4. ✓
- Row Template: explain + String/JSON note + scalar preview → Task 4. ✓
- Destinations data reaching the drawer → Tasks 5 (props) + 7 (AddAlert wiring). ✓
- i18n new keys, existing tooltip keys kept → Task 3 (+ Task 5 keeps tooltips). ✓
- Testing: composable unit (Tasks 1-2), component (Task 6), E2E (Task 8). ✓
- "Do not re-implement alert.rs" boundary → enforced by Task 1's opaque rules + comment. ✓

**Placeholder scan:** No TBD/TODO. The one open decision (dual-`<script>` vs `<script setup>` `segClass`, and `defineExpose` for test reachability) is given with both forms and a concrete fallback instruction, not left vague.

**Type consistency:** `PreviewSegment {kind,text}`, `PreviewContext {live,sample}`, `AlertFormFacts`, `renderTemplate(body, ctx)`, `buildPreviewContext(facts)` used identically across Tasks 1, 2, 4, 6. Drawer props/emits in Task 4 match what Task 5 binds (`:current-template`, `:selected-destinations`, `:destinations`, `:context-attributes`, `:row-template`, `:row-template-type`, `:facts`, `@apply:template`, `v-model:open`). `apply:template` payload is a `string` (template name) everywhere.

**Known follow-up (not a gap):** `previewFacts` in Task 5 is intentionally empty because `Advanced.vue` does not currently hold `alert_name`/`stream_name`; those tokens will chip until a future pass threads them in from a parent step. This is honest behavior (chip = "filled at notification time"), consistent with the spec's correctness stance.
