<!-- Copyright 2026 OpenObserve Inc. -->
<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { copyToClipboard } from "@/utils/clipboard";
import {
  renderTemplate,
  buildPreviewContext,
  type PreviewSegment,
  type AlertFormFacts,
  type ExtraLiveValues,
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
    extra?: ExtraLiveValues;
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
    extra: () => ({}),
  },
);

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
  (e: "apply:template", name: string): void;
}>();

const { t } = useI18nTyped();

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

const ctx = computed(() => buildPreviewContext(props.facts, props.extra));

function bodyOf(name: string): string {
  const tpl = props.templates.find((x: any) => x.name === name);
  if (!tpl) return "";
  return typeof tpl.body === "string" ? tpl.body : JSON.stringify(tpl.body, null, 2);
}

function segmentsFor(name: string): PreviewSegment[] {
  return renderTemplate(bodyOf(name), ctx.value);
}

// segClass maps a segment kind to its visual style class.
function segClass(kind: string) {
  return kind === "live"
    ? "text-text-heading font-semibold"
    : kind === "sample"
      ? "text-text-secondary italic underline decoration-dashed"
      : kind === "opaque"
        ? "rounded-default bg-surface-subtle-hover text-text-body px-1"
        : "text-text-body";
}

// ── CURRENT snapshot, frozen when the drawer opens ──────────────────
const snapshotTemplate = ref("");
interface DestSnapshot {
  name: string;
  template: string;
  segments: PreviewSegment[];
}
const snapshotDestinations = ref<DestSnapshot[]>([]);

/** Resolve the destination's configured template to its name and renderable
 *  body. A destination's `template` may be a bare name (string) or a full
 *  Template object (with body). When only a name is present, resolve the body
 *  from the already-loaded `templates` list — no extra API call. */
function destTemplateInfo(destName: string): { name: string; body: string } {
  const d = props.destinations.find((x: any) => x.name === destName);
  const tpl = d ? (d as any).template : undefined;
  if (!tpl) return { name: "", body: "" };
  if (typeof tpl === "string") {
    return { name: tpl, body: bodyOf(tpl) };
  }
  // full Template object on the destination
  const name = tpl.name ?? "";
  const body =
    tpl.body != null
      ? typeof tpl.body === "string"
        ? tpl.body
        : JSON.stringify(tpl.body, null, 2)
      : bodyOf(name);
  return { name, body };
}

// ── Local preview dropdown (does NOT mutate the form) ───────────────
const previewTemplate = ref<string | undefined>(undefined);

// Snapshot the "current" state whenever the drawer opens. `immediate` so a
// drawer that mounts already-open (the v-model:open path) still captures on
// its first open — without it, the first open would show an empty Current
// section and no legend until the user closed and reopened.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      snapshotTemplate.value = props.currentTemplate;
      snapshotDestinations.value = props.selectedDestinations.map((name) => {
        const info = destTemplateInfo(name);
        return {
          name,
          template: info.name,
          segments: renderTemplate(info.body, ctx.value),
        };
      });
      previewTemplate.value = props.currentTemplate || undefined;
    }
  },
  { immediate: true },
);
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

// Preview of the template currently selected in the panel dropdown.
const previewSegments = computed(() =>
  previewTemplate.value ? segmentsFor(previewTemplate.value) : [],
);

// Rendered body of the frozen "current override" snapshot, if any.
const currentSegments = computed(() =>
  snapshotTemplate.value ? segmentsFor(snapshotTemplate.value) : [],
);

// Show the legend only when a non-empty rendered preview is actually visible,
// so its colored swatches always have something on screen to explain.
const showLegend = computed(() => {
  if (props.topic === "rowTemplate") return rowSegments.value.length > 0;
  if (props.topic === "template") {
    return (
      currentSegments.value.length > 0 ||
      previewSegments.value.length > 0 ||
      snapshotDestinations.value.some((d) => d.segments.length > 0)
    );
  }
  return false;
});

// The user's context variables, normalized for display. The form often holds
// a blank starter row ({ key: "", value: "" }) and the backend may send an
// object instead of an array — neither should render as a stray "{}" row, so
// we coerce to an array and drop entries without a key.
const displayedVariables = computed(() => {
  const raw = props.contextAttributes;
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.entries(raw as Record<string, string>).map(([key, value]) => ({
          id: key,
          key,
          value,
        }))
      : [];
  return list.filter((v) => v && v.key && v.key.trim() !== "");
});

// Built-in variables the server actually substitutes (source of truth:
// process_dest_template in src/core/src/alerts/alert.rs). Each has a one-line
// description shown on hover so the list teaches, not just lists.
const builtInVars: { name: string; desc: string }[] = [
  { name: "org_name", desc: "Your organization name" },
  { name: "stream_type", desc: "Stream type (logs, metrics, traces)" },
  { name: "stream_name", desc: "Name of the stream the alert watches" },
  { name: "alert_name", desc: "The alert's name" },
  { name: "alert_type", desc: "Alert type (e.g. scheduled, real-time)" },
  { name: "alert_period", desc: "Evaluation window, in minutes" },
  { name: "alert_operator", desc: "Threshold comparison operator (>, <, =)" },
  { name: "alert_threshold", desc: "The configured threshold value" },
  { name: "alert_count", desc: "Number of matching records" },
  {
    name: "alert_agg_value",
    desc: "The evaluated aggregation value for the triggering group (empty when the alert has no aggregation value)",
  },
  { name: "alert_description", desc: "The alert's description text" },
  { name: "alert_start_time", desc: "Window start time (ISO 8601)" },
  { name: "alert_end_time", desc: "Window end time (ISO 8601)" },
  { name: "alert_url", desc: "Link back to OpenObserve to investigate" },
  { name: "alert_trigger_time", desc: "When the alert fired (ISO 8601)" },
  { name: "alert_trigger_time_millis", desc: "Trigger time in epoch millis" },
  { name: "alert_trigger_time_seconds", desc: "Trigger time in epoch seconds" },
  { name: "alert_trigger_time_str", desc: "Trigger time, human-readable" },
  { name: "rows", desc: "All matching rows, formatted by the row template" },
];

// Built-in reference is collapsed by default — a beginner shouldn't be hit
// with 18 cryptic tokens up front; they expand it only when they want to browse.
const showBuiltIns = ref(false);

function copyVar(name: string) {
  copyToClipboard(`{${name}}`, t, { successMessage: `Copied {${name}}` });
}

defineExpose({ applyTemplate, previewTemplate });
</script>

<template>
  <ODrawer
    data-test="alert-settings-help-drawer"
    :open="open"
    size="lg"
    :title="title"
    @update:open="emit('update:open', $event)"
  >
    <div class="text-text-body flex flex-col gap-6 p-5 text-sm">
      <!-- Legend (shown only when a non-empty preview is actually on screen, so
           the colored swatches always have something to explain). Readable in
           both themes. -->
      <div
        v-if="showLegend"
        data-test="help-legend"
        class="rounded-default bg-surface-subtle text-text-secondary flex flex-col gap-2 p-3 text-xs"
      >
        <span class="text-text-heading font-semibold">{{
          t("alerts.alertSettings.helpLegendTitle")
        }}</span>
        <span class="flex items-baseline gap-2 leading-[1.4]">
          <span
            class="rounded-default text-2xs border-border-subtle bg-surface-base text-text-heading min-w-14 shrink-0 border px-1.5 py-px text-center font-mono leading-[1.4] font-semibold"
            >{{ t("alerts.alertSettings.helpLegendLiveExample") }}</span
          >
          <span class="text-text-muted">=</span>
          {{ t("alerts.alertSettings.helpLegendLive") }}
        </span>
        <span class="flex items-baseline gap-2 leading-[1.4]">
          <span
            class="rounded-default text-2xs border-border-subtle bg-surface-base text-text-secondary min-w-14 shrink-0 border px-1.5 py-px text-center font-mono leading-[1.4] italic underline decoration-dashed"
            >{{ t("alerts.alertSettings.helpLegendSampleExample") }}</span
          >
          <span class="text-text-muted">=</span>
          {{ t("alerts.alertSettings.helpLegendSample") }}
        </span>
        <span class="flex items-baseline gap-2 leading-[1.4]">
          <span
            class="rounded-default text-2xs bg-surface-subtle-hover text-text-body min-w-14 shrink-0 px-1.5 py-px text-center font-mono leading-[1.4]"
            >{{ raw("{rows}") }}</span
          >
          <span class="text-text-muted">=</span>
          {{ t("alerts.alertSettings.helpLegendOpaque") }}
        </span>
      </div>

      <!-- ══ TEMPLATE OVERRIDE ══ -->
      <template v-if="topic === 'template'">
        <section class="flex flex-col">
          <h3 class="text-text-heading m-0 mb-2 text-sm font-semibold">
            {{ t("alerts.alertSettings.helpWhatThisDoes") }}
          </h3>
          <p class="text-text-secondary m-0 mb-3 leading-[1.5]">
            {{ t("alerts.alertSettings.helpTemplateExplain") }}
          </p>
          <p class="text-text-secondary m-0 leading-[1.5]" data-test="help-template-when">
            <span class="text-text-heading font-semibold">{{
              t("alerts.alertSettings.helpTemplateWhenHeading")
            }}</span>
            {{ t("alerts.alertSettings.helpTemplateWhenDesc") }}
          </p>
        </section>

        <OSeparator />

        <section class="flex flex-col" data-test="help-current-section">
          <h3 class="text-text-heading m-0 mb-2 text-sm font-semibold">
            {{ t("alerts.alertSettings.helpCurrentHeading") }}
          </h3>

          <!-- Override set: one rendered body -->
          <template v-if="snapshotTemplate">
            <p class="text-text-secondary m-0 mb-3 leading-[1.5]">
              {{ t("alerts.alertSettings.helpCurrentOverrideHeading") }}
            </p>
            <pre
              v-if="currentSegments.length"
              data-test="help-preview-box"
              class="rounded-surface border-border-default bg-surface-subtle text-text-body m-0 border p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap"
            ><template v-for="(s, i) in currentSegments" :key="i"
                ><span :class="segClass(s.kind)">{{ s.text }}</span></template
              ></pre>
            <p v-else class="text-text-secondary m-0 italic">
              {{ t("alerts.alertSettings.helpCurrentBodyEmpty") }}
            </p>
          </template>

          <!-- No override: each destination's current message, side by side -->
          <template v-else>
            <p class="text-text-secondary m-0 mb-3 leading-[1.5]">
              {{ t("alerts.alertSettings.helpCurrentNoOverride") }}
            </p>
            <p v-if="!snapshotDestinations.length" class="text-text-secondary m-0 italic">
              {{ t("alerts.alertSettings.helpCurrentNoDestinations") }}
            </p>
            <ul v-else class="m-0 flex list-none flex-col gap-3 p-0">
              <li
                v-for="d in snapshotDestinations"
                :key="d.name"
                data-test="help-destination-row"
                class="rounded-surface border-border-default bg-surface-base flex flex-col gap-2 border p-3"
              >
                <div class="flex items-baseline justify-between gap-3">
                  <span class="text-text-heading font-semibold">{{ d.name }}</span>
                  <span class="text-text-muted text-xs">{{ d.template || "—" }}</span>
                </div>
                <pre
                  v-if="d.segments.length"
                  data-test="help-destination-preview"
                  class="rounded-surface border-border-subtle bg-surface-panel text-text-body m-0 border p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap"
                ><template v-for="(s, i) in d.segments" :key="i"
                    ><span :class="segClass(s.kind)">{{ s.text }}</span></template
                  ></pre>
                <p v-else class="text-text-secondary m-0 text-xs italic">
                  {{ t("alerts.alertSettings.helpDestinationNoTemplate") }}
                </p>
              </li>
            </ul>
          </template>
        </section>

        <OSeparator />

        <section class="flex flex-col">
          <h3 class="text-text-heading m-0 mb-2 text-sm font-semibold">
            {{ t("alerts.alertSettings.helpPreviewHeading") }}
          </h3>
          <OSelect
            v-model="previewTemplate"
            :options="templateNames"
            clearable
            data-test="help-preview-template-select"
            :placeholder="t('alerts.alertSettings.helpPreviewSelectPlaceholder')"
            class="mb-3 max-w-80"
          />
          <template v-if="previewTemplate">
            <pre
              v-if="previewSegments.length"
              data-test="help-preview-box"
              class="rounded-surface border-border-default bg-surface-subtle text-text-body m-0 border p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap"
            ><template v-for="(s, i) in previewSegments" :key="i"
                ><span :class="segClass(s.kind)">{{ s.text }}</span></template
              ></pre>
            <p v-else class="text-text-secondary m-0 italic">
              {{ t("alerts.alertSettings.helpCurrentBodyEmpty") }}
            </p>
            <OButton
              data-test="help-apply-template-btn"
              :disabled="applyDisabled"
              class="mt-3"
              @click="applyTemplate"
            >
              {{ t("alerts.alertSettings.helpApplyToAlert") }}
            </OButton>
          </template>
          <p v-else class="text-text-secondary m-0 italic" data-test="help-preview-select-empty">
            {{ t("alerts.alertSettings.helpPreviewSelectEmpty") }}
          </p>
        </section>
      </template>

      <!-- ══ ADDITIONAL VARIABLES ══ -->
      <template v-else-if="topic === 'variables'">
        <section class="flex flex-col">
          <h3 class="text-text-heading m-0 mb-2 text-sm font-semibold">
            {{ t("alerts.alertSettings.helpWhatThisDoes") }}
          </h3>
          <p class="text-text-secondary m-0 leading-[1.5]">
            {{ t("alerts.alertSettings.helpVariablesExplain") }}
          </p>
        </section>

        <OSeparator />

        <!-- WHY: teach the payoff with a concrete before/after -->
        <section class="flex flex-col" data-test="help-why">
          <h3 class="text-text-heading m-0 mb-2 text-sm font-semibold">
            {{ t("alerts.alertSettings.helpWhyHeading") }}
          </h3>
          <p class="text-text-secondary m-0 mb-3 leading-[1.5]">
            {{ t("alerts.alertSettings.helpWhyIntro") }}
          </p>
          <div class="flex flex-col gap-3">
            <div
              class="rounded-surface border-border-default border-l-warning-500 flex flex-col gap-1.5 border border-l-2 p-3"
            >
              <span
                class="text-text-secondary text-2xs font-semibold tracking-[0.03em] uppercase"
                >{{ t("alerts.alertSettings.helpWhyWithoutLabel") }}</span
              >
              <p class="text-text-secondary text-compact m-0 leading-[1.45]">
                {{ t("alerts.alertSettings.helpWhyWithoutDesc") }}
              </p>
              <pre
                data-test="help-preview-box"
                class="rounded-surface border-border-subtle bg-surface-panel text-text-body m-0 border p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap"
                >{{ t("alerts.alertSettings.helpWhyWithoutCode") }}</pre>
            </div>
            <div
              class="rounded-surface border-border-default border-l-primary-500 flex flex-col gap-1.5 border border-l-2 p-3"
            >
              <span
                class="text-text-secondary text-2xs font-semibold tracking-[0.03em] uppercase"
                >{{ t("alerts.alertSettings.helpWhyWithLabel") }}</span
              >
              <p class="text-text-secondary text-compact m-0 leading-[1.45]">
                {{ t("alerts.alertSettings.helpWhyWithDesc") }}
              </p>
              <pre
                data-test="help-preview-box"
                class="rounded-surface border-border-subtle bg-surface-panel text-text-body m-0 border p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap"
                >{{ t("alerts.alertSettings.helpWhyWithCode") }}</pre>
            </div>
          </div>
        </section>

        <OSeparator />

        <!-- A concrete, doc-accurate worked example with rendered result -->
        <section class="flex flex-col" data-test="help-example">
          <h3 class="text-text-heading m-0 mb-2 text-sm font-semibold">
            {{ t("alerts.alertSettings.helpExampleHeading") }}
          </h3>
          <p class="text-text-secondary m-0 mb-3 leading-[1.5]">
            {{ t("alerts.alertSettings.helpVariablesExampleCaption") }}
          </p>
          <pre
            data-test="help-preview-box"
            class="rounded-surface border-border-default bg-surface-subtle text-text-body m-0 border p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap"
            >{{ t("alerts.alertSettings.helpVariablesExampleCode") }}</pre>
          <span
            class="text-text-secondary text-2xs mx-0 mt-2.5 mb-1 block font-semibold tracking-[0.03em] uppercase"
            >{{ t("alerts.alertSettings.helpExampleResultLabel") }}</span
          >
          <pre
            data-test="help-preview-box"
            class="rounded-surface border-border-default bg-surface-subtle text-text-body border-l-primary-500 m-0 border border-l-2 p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap"
            >{{ t("alerts.alertSettings.helpVariablesExampleResult") }}</pre>
        </section>

        <OSeparator />

        <!-- Built-in reference: collapsed by default so a beginner isn't hit
             with 18 cryptic tokens. Opt in to browse. -->
        <section class="flex flex-col">
          <button
            type="button"
            class="text-text-heading hover:text-text-link flex cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-sm font-semibold"
            data-test="help-builtin-toggle"
            :aria-expanded="showBuiltIns"
            @click="showBuiltIns = !showBuiltIns"
          >
            <OIcon :name="showBuiltIns ? 'chevron-down' : 'chevron-right'" size="sm" />
            <span>{{ t("alerts.alertSettings.helpBuiltInHeading") }}</span>
          </button>
          <template v-if="showBuiltIns">
            <p class="text-text-secondary mx-0 mt-0 mb-2 text-xs">
              {{ t("alerts.alertSettings.helpBuiltInIntro") }}
            </p>
            <div class="flex flex-wrap gap-2" data-test="help-builtin-list">
              <button
                v-for="v in builtInVars"
                :key="v.name"
                type="button"
                data-test="help-builtin-var"
                class="rounded-default border-border-default text-text-code hover:bg-surface-subtle-hover cursor-pointer border bg-transparent px-2 py-1 font-mono text-xs transition-[background] duration-200"
                :title="v.desc"
                @click="copyVar(v.name)"
              >
                {{ "{" + v.name + "}" }}
              </button>
            </div>
            <p class="text-text-secondary mx-0 mt-2 mb-0 text-xs">
              {{ t("alerts.alertSettings.helpBuiltInFooter") }}
            </p>
          </template>
        </section>

        <OSeparator />

        <section class="flex flex-col" data-test="help-your-variables">
          <h3 class="text-text-heading m-0 mb-2 text-sm font-semibold">
            {{ t("alerts.alertSettings.helpYourVariablesHeading") }}
          </h3>
          <template v-if="!displayedVariables.length">
            <p class="text-text-secondary m-0 italic">
              {{ t("alerts.alertSettings.helpYourVariablesEmpty") }}
            </p>
          </template>
          <ul v-else class="m-0 flex list-none flex-col gap-1.5 p-0">
            <li
              v-for="cv in displayedVariables"
              :key="cv.id"
              class="rounded-default border-border-default flex justify-between gap-3 border px-2 py-1.5"
            >
              <span class="text-text-code font-mono text-xs">{{ "{" + cv.key + "}" }}</span>
              <span class="text-text-secondary">{{ cv.value }}</span>
            </li>
          </ul>
        </section>
      </template>

      <!-- ══ ROW TEMPLATE ══ -->
      <template v-else>
        <section class="flex flex-col">
          <h3 class="text-text-heading m-0 mb-2 text-sm font-semibold">
            {{ t("alerts.alertSettings.helpWhatThisDoes") }}
          </h3>
          <p class="text-text-secondary m-0 leading-[1.5]">
            {{ t("alerts.alertSettings.helpRowTemplateExplain") }}
          </p>
        </section>

        <OSeparator />

        <!-- WHY: the compose story (row template formats one record; {rows}
             expands them all into the main template) -->
        <section class="flex flex-col" data-test="help-row-why">
          <h3 class="text-text-heading m-0 mb-2 text-sm font-semibold">
            {{ t("alerts.alertSettings.helpRowTemplateWhyHeading") }}
          </h3>
          <p class="text-text-secondary m-0 mb-3 leading-[1.5]">
            {{ t("alerts.alertSettings.helpRowTemplateWhyDesc") }}
          </p>
        </section>

        <OSeparator />

        <!-- Worked example: row template + main template composing via {rows} -->
        <section class="flex flex-col" data-test="help-row-example">
          <h3 class="text-text-heading m-0 mb-2 text-sm font-semibold">
            {{ t("alerts.alertSettings.helpExampleHeading") }}
          </h3>
          <p class="text-text-secondary m-0 mb-3 leading-[1.5]">
            {{ t("alerts.alertSettings.helpRowTemplateExampleCaption") }}
          </p>
          <div class="flex flex-col gap-1.5">
            <span class="text-text-secondary text-2xs font-semibold tracking-[0.03em] uppercase">{{
              t("alerts.alertSettings.helpRowTemplateExampleRowLabel")
            }}</span>
            <pre
              data-test="help-preview-box"
              class="rounded-surface border-border-subtle bg-surface-panel text-text-body m-0 border p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap"
              >{{ t("alerts.alertSettings.helpRowTemplateExampleRowCode") }}</pre>
            <span class="text-text-secondary text-2xs font-semibold tracking-[0.03em] uppercase">{{
              t("alerts.alertSettings.helpRowTemplateExampleMainLabel")
            }}</span>
            <pre
              data-test="help-preview-box"
              class="rounded-surface border-border-subtle bg-surface-panel text-text-body m-0 border p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap"
              >{{ t("alerts.alertSettings.helpRowTemplateExampleMainCode") }}</pre>
            <span
              class="text-text-secondary text-2xs mx-0 mt-2.5 mb-1 block font-semibold tracking-[0.03em] uppercase"
              >{{ t("alerts.alertSettings.helpExampleResultLabel") }}</span
            >
            <pre
              data-test="help-preview-box"
              class="rounded-surface border-border-default bg-surface-subtle text-text-body border-l-primary-500 m-0 border border-l-2 p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap"
              >{{ t("alerts.alertSettings.helpRowTemplateExampleResult") }}</pre>
          </div>
        </section>

        <OSeparator />

        <section class="flex flex-col">
          <h3 class="text-text-heading m-0 mb-2 text-sm font-semibold">
            {{ t("alerts.alertSettings.helpRowTemplateTypeHeading") }}
          </h3>
          <p class="text-text-secondary m-0 leading-[1.5]">
            {{ t("alerts.alertSettings.helpRowTemplateTypeExplain") }}
          </p>
          <p
            class="text-text-secondary text-compact mx-0 mt-2 mb-0 flex items-center gap-2"
            data-test="help-row-template-type"
          >
            {{ t("alerts.alertSettings.helpRowTemplateTypeCurrent") }}
            <OBadge variant="primary-soft" size="sm">{{ rowTemplateType }}</OBadge>
          </p>
        </section>

        <OSeparator />

        <section class="flex flex-col">
          <h3 class="text-text-heading m-0 mb-2 text-sm font-semibold">
            {{ t("alerts.alertSettings.helpPreviewHeadingShort") }}
          </h3>
          <pre
            v-if="rowSegments.length"
            data-test="help-preview-box"
            class="rounded-surface border-border-default bg-surface-subtle text-text-body m-0 border p-3 font-mono text-xs leading-[1.6] break-words whitespace-pre-wrap"
          ><template v-for="(s, i) in rowSegments" :key="i"
              ><span :class="segClass(s.kind)">{{ s.text }}</span></template
            ></pre>
          <p v-else class="text-text-secondary m-0 italic" data-test="help-row-preview-empty">
            {{ t("alerts.alertSettings.helpRowTemplatePreviewEmpty") }}
          </p>
        </section>
      </template>
    </div>
  </ODrawer>
</template>
