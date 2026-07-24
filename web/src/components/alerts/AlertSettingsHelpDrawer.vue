<!-- Copyright 2026 OpenObserve Inc. -->
<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
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
    ? "seg-live"
    : kind === "sample"
      ? "seg-sample"
      : kind === "opaque"
        ? "seg-opaque"
        : "seg-text";
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
// process_dest_template in src/service/alerts/alert.rs). Each has a one-line
// description shown on hover so the list teaches, not just lists.
// NOTE: alert_agg_value is intentionally ABSENT — the UI elsewhere advertises
// it but the server never substitutes it, so it would be sent as literal text.
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
  copyToClipboard(`{${name}}`, { successMessage: `Copied {${name}}` });
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
    <div class="help-body">
      <!-- Legend (shown only when a non-empty preview is actually on screen, so
           the colored swatches always have something to explain). Readable in
           both themes. -->
      <div v-if="showLegend" data-test="help-legend" class="help-legend">
        <span class="help-legend__title">{{ t("alerts.alertSettings.helpLegendTitle") }}</span>
        <span class="help-legend__item">
          <span class="help-legend__swatch help-legend__swatch--live">High CPU</span>
          <span class="help-legend__sep">=</span>
          {{ t("alerts.alertSettings.helpLegendLive") }}
        </span>
        <span class="help-legend__item">
          <span class="help-legend__swatch help-legend__swatch--sample">42</span>
          <span class="help-legend__sep">=</span>
          {{ t("alerts.alertSettings.helpLegendSample") }}
        </span>
        <span class="help-legend__item">
          <span class="help-legend__swatch help-legend__swatch--opaque">{{ "{rows}" }}</span>
          <span class="help-legend__sep">=</span>
          {{ t("alerts.alertSettings.helpLegendOpaque") }}
        </span>
      </div>

      <!-- ══ TEMPLATE OVERRIDE ══ -->
      <template v-if="topic === 'template'">
        <section class="help-section">
          <h3 class="help-section__title">
            {{ t("alerts.alertSettings.helpWhatThisDoes") }}
          </h3>
          <p class="help-section__text help-section__text--mb">
            {{ t("alerts.alertSettings.helpTemplateExplain") }}
          </p>
          <p class="help-section__text" data-test="help-template-when">
            <span class="help-inline-label">{{
              t("alerts.alertSettings.helpTemplateWhenHeading")
            }}</span>
            {{ t("alerts.alertSettings.helpTemplateWhenDesc") }}
          </p>
        </section>

        <OSeparator />

        <section class="help-section" data-test="help-current-section">
          <h3 class="help-section__title">
            {{ t("alerts.alertSettings.helpCurrentHeading") }}
          </h3>

          <!-- Override set: one rendered body -->
          <template v-if="snapshotTemplate">
            <p class="help-section__text help-section__text--mb">
              {{ t("alerts.alertSettings.helpCurrentOverrideHeading") }}
            </p>
            <pre
              v-if="currentSegments.length"
              class="preview-box"
            ><template v-for="(s, i) in currentSegments" :key="i"
                ><span :class="segClass(s.kind)">{{ s.text }}</span></template
              ></pre>
            <p v-else class="help-empty">
              {{ t("alerts.alertSettings.helpCurrentBodyEmpty") }}
            </p>
          </template>

          <!-- No override: each destination's current message, side by side -->
          <template v-else>
            <p class="help-section__text help-section__text--mb">
              {{ t("alerts.alertSettings.helpCurrentNoOverride") }}
            </p>
            <p v-if="!snapshotDestinations.length" class="help-empty">
              {{ t("alerts.alertSettings.helpCurrentNoDestinations") }}
            </p>
            <ul v-else class="help-dest-list">
              <li
                v-for="d in snapshotDestinations"
                :key="d.name"
                data-test="help-destination-row"
                class="help-dest-card"
              >
                <div class="help-dest-card__head">
                  <span class="help-dest-card__name">{{ d.name }}</span>
                  <span class="help-dest-card__tpl">{{ d.template || "—" }}</span>
                </div>
                <pre
                  v-if="d.segments.length"
                  data-test="help-destination-preview"
                  class="preview-box preview-box--nested"
                ><template v-for="(s, i) in d.segments" :key="i"
                    ><span :class="segClass(s.kind)">{{ s.text }}</span></template
                  ></pre>
                <p v-else class="help-empty help-empty--sm">
                  {{ t("alerts.alertSettings.helpDestinationNoTemplate") }}
                </p>
              </li>
            </ul>
          </template>
        </section>

        <OSeparator />

        <section class="help-section">
          <h3 class="help-section__title">
            {{ t("alerts.alertSettings.helpPreviewHeading") }}
          </h3>
          <OSelect
            v-model="previewTemplate"
            :options="templateNames"
            clearable
            data-test="help-preview-template-select"
            :placeholder="t('alerts.alertSettings.helpPreviewSelectPlaceholder')"
            class="help-preview-select"
          />
          <template v-if="previewTemplate">
            <pre
              v-if="previewSegments.length"
              class="preview-box"
            ><template v-for="(s, i) in previewSegments" :key="i"
                ><span :class="segClass(s.kind)">{{ s.text }}</span></template
              ></pre>
            <p v-else class="help-empty">
              {{ t("alerts.alertSettings.helpCurrentBodyEmpty") }}
            </p>
            <OButton
              data-test="help-apply-template-btn"
              :disabled="applyDisabled"
              class="help-apply-btn"
              @click="applyTemplate"
            >
              {{ t("alerts.alertSettings.helpApplyToAlert") }}
            </OButton>
          </template>
          <p v-else class="help-empty" data-test="help-preview-select-empty">
            {{ t("alerts.alertSettings.helpPreviewSelectEmpty") }}
          </p>
        </section>
      </template>

      <!-- ══ ADDITIONAL VARIABLES ══ -->
      <template v-else-if="topic === 'variables'">
        <section class="help-section">
          <h3 class="help-section__title">
            {{ t("alerts.alertSettings.helpWhatThisDoes") }}
          </h3>
          <p class="help-section__text">
            {{ t("alerts.alertSettings.helpVariablesExplain") }}
          </p>
        </section>

        <OSeparator />

        <!-- WHY: teach the payoff with a concrete before/after -->
        <section class="help-section" data-test="help-why">
          <h3 class="help-section__title">
            {{ t("alerts.alertSettings.helpWhyHeading") }}
          </h3>
          <p class="help-section__text help-section__text--mb">
            {{ t("alerts.alertSettings.helpWhyIntro") }}
          </p>
          <div class="help-compare">
            <div class="help-compare__col help-compare__col--bad">
              <span class="help-compare__label">{{
                t("alerts.alertSettings.helpWhyWithoutLabel")
              }}</span>
              <p class="help-compare__desc">
                {{ t("alerts.alertSettings.helpWhyWithoutDesc") }}
              </p>
              <pre class="preview-box preview-box--nested">{{
                t("alerts.alertSettings.helpWhyWithoutCode")
              }}</pre>
            </div>
            <div class="help-compare__col help-compare__col--good">
              <span class="help-compare__label">{{
                t("alerts.alertSettings.helpWhyWithLabel")
              }}</span>
              <p class="help-compare__desc">
                {{ t("alerts.alertSettings.helpWhyWithDesc") }}
              </p>
              <pre class="preview-box preview-box--nested">{{
                t("alerts.alertSettings.helpWhyWithCode")
              }}</pre>
            </div>
          </div>
        </section>

        <OSeparator />

        <!-- A concrete, doc-accurate worked example with rendered result -->
        <section class="help-section" data-test="help-example">
          <h3 class="help-section__title">
            {{ t("alerts.alertSettings.helpExampleHeading") }}
          </h3>
          <p class="help-section__text help-section__text--mb">
            {{ t("alerts.alertSettings.helpVariablesExampleCaption") }}
          </p>
          <pre class="preview-box">{{ t("alerts.alertSettings.helpVariablesExampleCode") }}</pre>
          <span class="help-result-label">{{
            t("alerts.alertSettings.helpExampleResultLabel")
          }}</span>
          <pre class="preview-box preview-box--result">{{
            t("alerts.alertSettings.helpVariablesExampleResult")
          }}</pre>
        </section>

        <OSeparator />

        <!-- Built-in reference: collapsed by default so a beginner isn't hit
             with 18 cryptic tokens. Opt in to browse. -->
        <section class="help-section">
          <button
            type="button"
            class="help-disclosure"
            data-test="help-builtin-toggle"
            :aria-expanded="showBuiltIns"
            @click="showBuiltIns = !showBuiltIns"
          >
            <OIcon :name="showBuiltIns ? 'chevron-down' : 'chevron-right'" size="sm" />
            <span>{{ t("alerts.alertSettings.helpBuiltInHeading") }}</span>
          </button>
          <template v-if="showBuiltIns">
            <p class="help-section__hint help-section__hint--top">
              {{ t("alerts.alertSettings.helpBuiltInIntro") }}
            </p>
            <div class="help-chips" data-test="help-builtin-list">
              <button
                v-for="v in builtInVars"
                :key="v.name"
                type="button"
                data-test="help-builtin-var"
                class="help-chip"
                :title="v.desc"
                @click="copyVar(v.name)"
              >
                {{ "{" + v.name + "}" }}
              </button>
            </div>
            <p class="help-section__hint">
              {{ t("alerts.alertSettings.helpBuiltInFooter") }}
            </p>
          </template>
        </section>

        <OSeparator />

        <section class="help-section" data-test="help-your-variables">
          <h3 class="help-section__title">
            {{ t("alerts.alertSettings.helpYourVariablesHeading") }}
          </h3>
          <template v-if="!displayedVariables.length">
            <p class="help-empty">
              {{ t("alerts.alertSettings.helpYourVariablesEmpty") }}
            </p>
          </template>
          <ul v-else class="help-var-list">
            <li v-for="cv in displayedVariables" :key="cv.id" class="help-var-row">
              <span class="help-var-row__key">{{ "{" + cv.key + "}" }}</span>
              <span class="help-var-row__val">{{ cv.value }}</span>
            </li>
          </ul>
        </section>
      </template>

      <!-- ══ ROW TEMPLATE ══ -->
      <template v-else>
        <section class="help-section">
          <h3 class="help-section__title">
            {{ t("alerts.alertSettings.helpWhatThisDoes") }}
          </h3>
          <p class="help-section__text">
            {{ t("alerts.alertSettings.helpRowTemplateExplain") }}
          </p>
        </section>

        <OSeparator />

        <!-- WHY: the compose story (row template formats one record; {rows}
             expands them all into the main template) -->
        <section class="help-section" data-test="help-row-why">
          <h3 class="help-section__title">
            {{ t("alerts.alertSettings.helpRowTemplateWhyHeading") }}
          </h3>
          <p class="help-section__text help-section__text--mb">
            {{ t("alerts.alertSettings.helpRowTemplateWhyDesc") }}
          </p>
        </section>

        <OSeparator />

        <!-- Worked example: row template + main template composing via {rows} -->
        <section class="help-section" data-test="help-row-example">
          <h3 class="help-section__title">
            {{ t("alerts.alertSettings.helpExampleHeading") }}
          </h3>
          <p class="help-section__text help-section__text--mb">
            {{ t("alerts.alertSettings.helpRowTemplateExampleCaption") }}
          </p>
          <div class="help-compose">
            <span class="help-compose__label">{{
              t("alerts.alertSettings.helpRowTemplateExampleRowLabel")
            }}</span>
            <pre class="preview-box preview-box--nested">{{
              t("alerts.alertSettings.helpRowTemplateExampleRowCode")
            }}</pre>
            <span class="help-compose__label">{{
              t("alerts.alertSettings.helpRowTemplateExampleMainLabel")
            }}</span>
            <pre class="preview-box preview-box--nested">{{
              t("alerts.alertSettings.helpRowTemplateExampleMainCode")
            }}</pre>
            <span class="help-compose__label help-result-label">{{
              t("alerts.alertSettings.helpExampleResultLabel")
            }}</span>
            <pre class="preview-box preview-box--result">{{
              t("alerts.alertSettings.helpRowTemplateExampleResult")
            }}</pre>
          </div>
        </section>

        <OSeparator />

        <section class="help-section">
          <h3 class="help-section__title">
            {{ t("alerts.alertSettings.helpRowTemplateTypeHeading") }}
          </h3>
          <p class="help-section__text">
            {{ t("alerts.alertSettings.helpRowTemplateTypeExplain") }}
          </p>
          <p class="help-current-type" data-test="help-row-template-type">
            {{ t("alerts.alertSettings.helpRowTemplateTypeCurrent") }}
            <OBadge variant="primary-soft" size="sm">{{ rowTemplateType }}</OBadge>
          </p>
        </section>

        <OSeparator />

        <section class="help-section">
          <h3 class="help-section__title">
            {{ t("alerts.alertSettings.helpPreviewHeadingShort") }}
          </h3>
          <pre
            v-if="rowSegments.length"
            class="preview-box"
          ><template v-for="(s, i) in rowSegments" :key="i"
              ><span :class="segClass(s.kind)">{{ s.text }}</span></template
            ></pre>
          <p v-else class="help-empty" data-test="help-row-preview-empty">
            {{ t("alerts.alertSettings.helpRowTemplatePreviewEmpty") }}
          </p>
        </section>
      </template>
    </div>
  </ODrawer>
</template>

<style scoped lang="scss">
/* keep(complex-state): the .seg-live/-sample/-opaque/-text segment styles are
   applied by the computed segClass() mapper to the v-for'd preview segments —
   a dynamic, per-kind class name the utility layer cannot inline — and the
   legend / preview-box / destination-card BEM blocks cascade hover and kind
   variants around them. All values already resolve to design tokens. */
// Colors use the design-token layer defined in src/lib/styles/tokens/*.css
// (--color-*, --radius-*) — the same theme-aware tokens the O* component
// library consumes, with dark-mode overrides in tokens/dark.css.

// ── Layout ───────────────────────────────────────────────────────────
.help-body {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.25rem;
  font-size: var(--text-sm);
  color: var(--color-text-body);
}

// ── Legend: a compact, readable key (not a banner) ───────────────────
// A small key that reads top-to-bottom: each row is a concrete example of how
// that kind of value appears in the preview, then "= plain explanation".
// Stacked (not wrapped inline) so labels never get cramped or cut off.
.help-legend {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: var(--radius-default);
  background: var(--color-surface-subtle);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);

  &__title {
    font-weight: 600;
    color: var(--color-text-heading);
  }

  &__item {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    line-height: 1.4;
  }

  &__sep {
    color: var(--color-text-muted);
  }

  // Each swatch is a real example rendered in that style, so the row is
  // self-explanatory: the swatch IS what it describes.
  &__swatch {
    flex-shrink: 0;
    min-width: 3.5rem;
    padding: 0.0625rem 0.375rem;
    border-radius: var(--radius-default);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: 1.4;
    text-align: center;
  }
  &__swatch--live {
    font-weight: 600;
    color: var(--color-text-heading);
    background: var(--color-surface-base);
    border: 1px solid var(--color-border-subtle);
  }
  &__swatch--sample {
    font-style: italic;
    color: var(--color-text-secondary);
    text-decoration: underline dashed;
    background: var(--color-surface-base);
    border: 1px solid var(--color-border-subtle);
  }
  &__swatch--opaque {
    background: var(--color-surface-subtle-hover);
    color: var(--color-text-body);
  }
}

// ── Sections ─────────────────────────────────────────────────────────
.help-section {
  display: flex;
  flex-direction: column;

  &__title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-heading);
    margin: 0 0 0.5rem;
  }

  &__text {
    color: var(--color-text-secondary);
    line-height: 1.5;
    margin: 0;

    &--mb {
      margin-bottom: 0.75rem;
    }
  }

  &__hint {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    margin: 0.5rem 0 0;

    &--top {
      margin: 0 0 0.5rem;
    }
  }
}

// Collapsible section header ("Browse built-in variables") — looks like a
// clickable disclosure row, matching .help-section__title weight.
.help-disclosure {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-heading);

  &:hover {
    color: var(--color-text-link);
  }
}

// "What gets sent" rendered-result label + box — shows the concrete output so
// a beginner sees input → result, not just a template full of placeholders.
.help-result-label {
  display: block;
  margin: 0.625rem 0 0.25rem;
  font-size: var(--text-2xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-secondary);
}

.preview-box--result {
  border-left: 0.125rem solid var(--color-primary-500);
}

.help-empty {
  // Empty-state guidance is meant to be READ — use secondary text, not the
  // muted/placeholder token which is too faint (esp. in light mode).
  color: var(--color-text-secondary);
  font-style: italic;
  margin: 0;

  &--sm {
    font-size: var(--text-xs);
  }
}

// Inline lead-in label for a sentence (e.g. "When should I override?").
.help-inline-label {
  font-weight: 600;
  color: var(--color-text-heading);
}

// "Currently selected: [String]" — readable label next to an OBadge showing
// the active row-template type (badge styling comes from OBadge, reused).
.help-current-type {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.5rem 0 0;
  font-size: var(--text-compact);
  color: var(--color-text-secondary);
}

// Row-template compose example: stacked labeled code blocks.
.help-compose {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;

  &__label {
    font-size: var(--text-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-text-secondary);
  }
}

// ── Why-use-a-variable before/after comparison ───────────────────────
.help-compare {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__col {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.75rem;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-surface);
    border-left-width: 0.125rem;

    &--bad {
      border-left-color: var(--color-warning-500);
    }
    &--good {
      border-left-color: var(--color-primary-500);
    }
  }

  &__label {
    font-size: var(--text-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-text-secondary);
  }
  &__desc {
    margin: 0;
    font-size: var(--text-compact);
    color: var(--color-text-secondary);
    line-height: 1.45;
  }
}

.help-preview-select {
  max-width: 20rem;
  margin-bottom: 0.75rem;
}

.help-apply-btn {
  margin-top: 0.75rem;
}

// ── Destination cards (current message per destination) ──────────────
.help-dest-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.help-dest-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-surface);
  background: var(--color-surface-base);

  &__head {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: baseline;
  }
  &__name {
    font-weight: 600;
    color: var(--color-text-heading);
  }
  &__tpl {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
}

// ── Built-in variable chips ──────────────────────────────────────────
.help-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.help-chip {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-default);
  background: transparent;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-code);
  cursor: pointer;
  transition: background 0.2s ease;

  &:hover {
    background: var(--color-surface-subtle-hover);
  }
}

// ── User's context variables list ────────────────────────────────────
.help-var-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.help-var-row {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-default);

  &__key {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-code);
  }
  &__val {
    color: var(--color-text-secondary);
  }
}

// ── Preview box + segment styles ─────────────────────────────────────
.preview-box {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.6;
  margin: 0;
  padding: 0.75rem;
  border-radius: var(--radius-surface);
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-subtle);
  color: var(--color-text-body);

  // Nested inside a destination card — lighter so it doesn't double-frame.
  &--nested {
    border-color: var(--color-border-subtle);
    background: var(--color-surface-panel);
  }
}

// live = the user's real data, shown plainly but with a touch of weight.
.seg-live {
  font-weight: 600;
  color: var(--color-text-heading);
}
// sample = a mock runtime value: clearly "example", never mistaken for real.
.seg-sample {
  font-style: italic;
  text-decoration: underline dashed;
  color: var(--color-text-secondary);
}
// opaque = filled at notification time. Readable chip in BOTH themes — the
// previous version put faint text on a near-same gray and was unreadable.
.seg-opaque {
  padding: 0 0.25rem;
  border-radius: var(--radius-default);
  background: var(--color-surface-subtle-hover);
  color: var(--color-text-body);
}
.seg-text {
  color: var(--color-text-body);
}
</style>
