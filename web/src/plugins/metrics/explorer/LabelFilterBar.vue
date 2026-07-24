<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    ref="barRef"
    class="relative flex min-w-0 flex-1 items-center gap-2"
    :class="expanded ? 'flex-wrap' : 'flex-nowrap'"
    data-test="metrics-explorer-label-filter-bar"
  >
    <!-- Invisible copy of EVERY chip at its natural width — what the fit
         computation measures. Chips cap at 250px, so a long value never
         monopolises the row. -->
    <div
      ref="measureRef"
      class="pointer-events-none invisible absolute flex h-0 gap-2 overflow-hidden"
      aria-hidden="true"
    >
      <OTag
        v-for="filter in filters"
        :key="labelFilterKey(filter)"
        type="fieldTag"
        value="primarysm"
        class="max-w-62.5"
      >
        <span class="truncate font-mono text-xs"
          >{{ filter.label }} {{ filter.operator || "=" }} {{ filter.value }}</span
        >
        <template #trailing>
          <span class="ml-1 inline-flex items-center"><OIcon name="close" size="xs" /></span>
        </template>
      </OTag>
    </div>

    <!-- Keyed and removed by the WHOLE matcher, never by the label: a label can
         carry several of them (`status=~"5.."` and `status!="503"`), and keying
         on the label alone would collide two chips onto one v-for key. -->
    <!-- The registry's fieldTag/primarysm — the same variant+size the group
         pins, spelled as type/value instead of loose props. -->
    <template v-for="(filter, i) in shownFilters" :key="labelFilterKey(filter)">
      <!-- Said, not inferred. Matchers in a PromQL selector are ALWAYS AND, but
           two adjacent chips look equally like "either of these" — and the one
           thing a second chip cannot mean is OR, so the ambiguity always resolves
           the wrong way. The title carries the fix (`=~` with a regex) for anyone
           who wanted OR and now knows they did not get it. -->
      <span
        v-if="i > 0"
        class="text-3xs text-text-secondary shrink-0 tracking-wide uppercase select-none"
        :title="t('metrics.explorer.labels.andSeparatorTitle')"
        data-test="metrics-explorer-label-and"
        >{{ t("metrics.explorer.labels.andSeparator") }}</span
      >
      <OTag
        type="fieldTag"
        value="primarysm"
        class="max-w-62.5 min-w-0"
        :data-test="`metrics-explorer-label-chip-${filter.label}`"
      >
        <!-- The chip truncates its value; the tooltip is where the whole matcher
             stays readable. -->
        <OTooltip :content="`${filter.label} ${filter.operator || '='} ${filter.value}`" />
        <span class="truncate font-mono text-xs"
          >{{ filter.label }} {{ filter.operator || "=" }} {{ filter.value }}</span
        >
        <template #trailing>
          <button
            type="button"
            class="ml-1 inline-flex cursor-pointer items-center"
            :aria-label="
              t('metrics.explorer.labels.removeFilterAria', {
                filter: labelFilterKey(filter),
              })
            "
            :data-test="`metrics-explorer-label-chip-remove-${filter.label}`"
            @click.stop="$emit('remove', filter)"
          >
            <OIcon name="close" size="xs" />
          </button>
        </template>
      </OTag>
    </template>
    <OTag
      v-if="hiddenFilters.length"
      type="countChip"
      value="neutral"
      size="sm"
      clickable
      class="h-7 shrink-0"
      role="button"
      tabindex="0"
      :aria-label="t('metrics.explorer.labels.moreFiltersTooltip')"
      data-test="metrics-explorer-label-overflow"
      @click="expanded = true"
      @keydown.enter="expanded = true"
    >
      {{ t("metrics.explorer.labels.moreFilters", { count: hiddenFilters.length }) }}
      <OTooltip :delay="300" :max-width="'28rem'">
        <template #content>
          <div class="space-y-1">
            <div v-for="filter in hiddenFilters" :key="labelFilterKey(filter)">
              <span>{{ filter.label }}</span
              >{{ filter.operator || "=" }}<span>{{ filter.value }}</span>
            </div>
            <!-- The click affordance is invisible without being said. -->
            <div class="opacity-70">
              {{ t("metrics.explorer.labels.moreFiltersTooltip") }}
            </div>
          </div>
        </template>
      </OTooltip>
    </OTag>

    <!-- ONE wrapper for every action after the chips, so when the expanded row
         wraps, they move to the next line together — never split across lines. -->
    <div
      ref="actionsRef"
      class="flex shrink-0 items-center gap-2"
      data-test="metrics-explorer-label-actions"
    >
      <OButton
        v-if="expanded && filters.length > fitCount"
        variant="ghost"
        size="xs"
        class="shrink-0"
        data-test="metrics-explorer-label-show-less"
        @click="expanded = false"
      >
        {{ t("metrics.explorer.labels.showLess") }}
      </OButton>

      <!-- Membership resolution is deferred to the first filter interaction, so the
         bar itself reports that the grid is still narrowing. -->
      <span
        v-if="schemaLoading"
        class="inline-flex cursor-help items-center"
        role="status"
        :aria-label="t('metrics.explorer.labels.schemaLoadingAria')"
        data-test="metrics-explorer-label-schema-loading"
      >
        <OTooltip :content="t('metrics.explorer.labels.schemaLoadingTooltip')" :delay="200" />
        <OSpinner size="xs" />
      </span>

      <!-- Two steps, no Add button: click Filter -> pick a label -> pick a value,
         and the chip commits on selection. Each dropdown is auto-opened as it
         appears, so picking a filter costs one click per decision the user
         actually makes, instead of one click per widget. -->
      <div class="relative flex items-center gap-2">
        <OButton
          v-if="step === 'idle'"
          variant="outline"
          size="xs"
          icon-left="add"
          data-test="metrics-explorer-label-add"
          @click="startPicking"
        >
          {{ t("metrics.explorer.labels.addFilter") }}
        </OButton>

        <div
          v-else-if="step === 'label'"
          ref="labelStepRef"
          class="w-56"
          data-test="metrics-explorer-label-picker-label"
        >
          <OSelect
            v-model="draftLabel"
            searchable
            size="sm"
            :placeholder="t('metrics.explorer.labels.selectLabel')"
            :options="labelOptions"
            :loading="labelNamesLoading"
            :error="!!labelError"
            :error-message="labelError"
            @update:model-value="onLabelPicked"
            @close="onDropdownClosed"
          />
        </div>

        <div
          v-else
          ref="valueStepRef"
          class="flex items-center gap-2"
          data-test="metrics-explorer-label-picker-value"
        >
          <span class="text-text-secondary shrink-0 font-mono text-xs">
            {{ draftLabel }}
          </span>
          <!-- Defaulted to `=`, one click to change. All four PromQL matchers are
             supported by the selector builder, so regex filters cost nothing
             extra — but they never get in the way of the common case.

             The tooltip is where `=~` earns its keep: matching either of two
             values is the one thing chips CANNOT do by adding a second filter
             (matchers in a PromQL selector are always AND, and this engine
             rejects `or` matchers outright), so regex alternation is the only
             way to say it — and a user has no reason to guess that. The labels
             stay the bare symbols: they are what PromQL calls these, and the
             trigger is `w-20`. -->
          <div class="w-20">
            <OTooltip
              :content="t('metrics.explorer.labels.operatorHelp')"
              content-class="whitespace-pre-line"
              max-width="20rem"
              :delay="200"
            />
            <OSelect
              v-model="draftOperator"
              size="sm"
              :options="operatorOptions"
              data-test="metrics-explorer-label-picker-operator"
            />
          </div>
          <div ref="valueSelectRef" class="w-56">
            <!-- `creatable` is what keeps the chip usable when suggestions fail:
               the user can always type a value and commit it with Enter. -->
            <OSelect
              v-model="draftValue"
              searchable
              creatable
              size="sm"
              :placeholder="t('metrics.explorer.labels.selectOrTypeValue')"
              :options="valueOptions"
              :loading="valuesLoading"
              @update:model-value="onValuePicked"
              @create="onValueCreated"
              @close="onDropdownClosed"
            />
          </div>
          <span
            v-if="suggestionsUnavailable"
            class="text-text-secondary shrink-0 text-xs"
            data-test="metrics-explorer-label-picker-no-suggestions"
          >
            {{ t("metrics.explorer.labels.noSuggestions") }}
          </span>
          <OButton
            variant="ghost"
            size="xs"
            icon-left="close"
            :aria-label="t('metrics.explorer.labels.cancelDraftAria')"
            data-test="metrics-explorer-label-picker-cancel"
            @click="cancel"
          >
            <OTooltip :content="t('metrics.explorer.labels.cancelDraftAria')" />
          </OButton>
        </div>
      </div>

      <!-- The empty-row hint, typed out.
         A SIBLING of the picker block above, never a branch inside it: an extra
         `v-if` between that block's `v-if` and its `v-else-if` silently breaks
         the chain, and `+ Filter` then renders at the same time as the value
         picker. That is a real bug this file has already had.

         Idle + unfiltered only — it is a hint about the empty state, so it gets
         out of the way the moment there is a chip or an open picker. -->
      <span
        v-if="step === 'idle' && !filters.length"
        class="query-editor-placeholder-overlay pointer-events-none min-w-0 flex-1 overflow-hidden select-none"
        aria-hidden="true"
        data-test="metrics-explorer-label-hint"
      >
        <!-- The SAME element the Logs placeholder types into (tailwind.css:75), so
           the font, size and colour are the one shared rule rather than a second
           opinion on it.

           `flex-1 min-w-0 overflow-hidden` on the wrapper, and `block` here: the
           shared rule is `nowrap` + `ellipsis`, which only clips once something
           BOUNDS the width. As a bare inline flex item it took its full intrinsic
           width instead and pushed `+ Filter` along the row — the hint is the one
           thing here that must yield, never the control. -->
        <span class="query-editor-placeholder-typewriter block">{{ filterHint }}</span>
      </span>

      <OButton
        v-if="filters.length > 1 && step === 'idle'"
        variant="ghost"
        size="xs"
        class="shrink-0"
        data-test="metrics-explorer-label-clear-all"
        @click="$emit('clear-all')"
      >
        {{ t("metrics.explorer.labels.clearAll") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useFilterHint } from "@/composables/metrics/useFilterHint";
import { labelFilterKey, type LabelFilter } from "@/composables/metrics/useMetricsExplorerGrid";

/** The PromQL selector builder throws on anything else, so an invalid name is
 *  rejected here rather than being turned into a broken query. */
const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** The four PromQL label matchers. `buildSelector` validates against this set. */
const operatorOptions = [
  { label: "=", value: "=" },
  { label: "!=", value: "!=" },
  { label: "=~", value: "=~" },
  { label: "!~", value: "!~" },
];

const props = defineProps<{
  filters: LabelFilter[];
  labelNames: string[];
  labelNamesLoading: boolean;
  schemaLoading: boolean;
  /** Best-effort value suggestions; may resolve empty or reject. */
  loadValues: (label: string) => Promise<string[]>;
}>();

const emit = defineEmits<{
  (e: "add", filter: LabelFilter): void;
  (e: "remove", filter: LabelFilter): void;
  (e: "clear-all"): void;
  /** First open only — lets the parent lazily fetch label names. */
  (e: "focus-picker"): void;
}>();

const { t } = useI18n();

/* ------------------------------------------------------ chip overflow */

const barRef = ref<HTMLElement | null>(null);
const measureRef = ref<HTMLElement | null>(null);
const actionsRef = ref<HTMLElement | null>(null);

const expanded = ref(false);

/** The row's gap-2, in px. */
const CHIP_GAP = 8;
/** Room kept for the "+N more" chip whenever the fit hides anything. */
const MORE_CHIP_WIDTH = 90;
/**
 * The `and` between two chips, plus the extra gap it introduces.
 *
 * The measurement clone holds chips only, so without this the fit would be
 * computed for a narrower row than the one actually rendered and the last chip
 * would overflow. Deliberately a constant rather than another cloned node: the
 * word is a fixed, tiny, uppercase string — measuring it would cost a second
 * reflow to learn something that cannot vary.
 */
const AND_SEPARATOR_WIDTH = 24 + CHIP_GAP;

/**
 * How many chips fit on ONE line beside the actions — from the chips' real
 * widths (each capped at 250px), not a fixed count, so a wide screen shows
 * more and a narrow one fewer.
 */
const fitCount = ref(Number.MAX_SAFE_INTEGER);

const measure = async () => {
  await nextTick();
  const bar = barRef.value;
  const meas = measureRef.value;
  // No layout to measure (jsdom, hidden tab): show everything rather than
  // clamping on a width of zero.
  if (!bar || !meas || !bar.clientWidth) {
    fitCount.value = Number.MAX_SAFE_INTEGER;
    return;
  }

  const chipWidths = [...meas.children].map(
    (c) => (c as HTMLElement).getBoundingClientRect().width,
  );
  const actions = actionsRef.value?.getBoundingClientRect().width ?? 0;
  const avail = bar.clientWidth - actions - CHIP_GAP;

  let used = 0;
  let count = 0;
  for (const w of chipWidths) {
    // Every chip but the first is preceded by `and` — the clone does not hold
    // those, so their width is added here.
    const next = used + (count ? CHIP_GAP + AND_SEPARATOR_WIDTH : 0) + w;
    if (next > avail) break;
    used = next;
    count++;
  }
  if (count < chipWidths.length) {
    // The "+N more" chip has to fit on the line too.
    while (count > 1 && used + CHIP_GAP + MORE_CHIP_WIDTH > avail) {
      count--;
      // Mirrors the addition above exactly — including the `and` this chip
      // brought with it. An asymmetric subtraction would leave `used` drifting
      // from the row's real width with every step.
      used -= chipWidths[count] + (count ? CHIP_GAP + AND_SEPARATOR_WIDTH : 0);
    }
  }
  fitCount.value = Math.max(1, count);
  // Everything fits again (a removal, a wider window): fold the row back up.
  if (props.filters.length <= fitCount.value) expanded.value = false;
};

let barResizeObserver: ResizeObserver | null = null;

onMounted(() => {
  measure();
  if (typeof ResizeObserver !== "undefined" && barRef.value) {
    barResizeObserver = new ResizeObserver(() => measure());
    barResizeObserver.observe(barRef.value);
  }
});

onBeforeUnmount(() => {
  barResizeObserver?.disconnect();
  barResizeObserver = null;
});

watch(() => props.filters, measure, { deep: true });

const shownFilters = computed(() =>
  expanded.value ? props.filters : props.filters.slice(0, fitCount.value),
);
const hiddenFilters = computed(() => (expanded.value ? [] : props.filters.slice(fitCount.value)));

type Step = "idle" | "label" | "value";
const step = ref<Step>("idle");

const labelStepRef = ref<HTMLElement | null>(null);
const valueStepRef = ref<HTMLElement | null>(null);
/** The VALUE select specifically — the operator select renders before it. */
const valueSelectRef = ref<HTMLElement | null>(null);

const draftLabel = ref<string | null>(null);
const draftOperator = ref<string>("=");
const draftValue = ref<string | null>(null);
const labelError = ref("");

/**
 * The empty-row typewriter hint.
 *
 * Enabled only while the row is idle and unfiltered — the only moment it is on
 * screen. The loop is a chain of timers, so leaving it armed behind a committed
 * chip or an open picker would burn them for something nobody can see.
 */
const hintEnabled = computed(() => step.value === "idle" && !props.filters.length);
const { placeholder: filterHint } = useFilterHint(
  computed(() => props.labelNames ?? []),
  hintEnabled,
);

const valueOptions = ref<{ label: string; value: string }[]>([]);
const valuesLoading = ref(false);
const suggestionsUnavailable = ref(false);

const labelOptions = computed(() => props.labelNames.map((name) => ({ label: name, value: name })));

/**
 * Opens a freshly-rendered OSelect.
 *
 * OSelect keeps its open state private, so the only way in is to do what a user
 * would: click the trigger. Without this, every step would cost an extra click
 * just to reveal the dropdown that the user has already asked for.
 */
const autoOpen = async (getHost: () => HTMLElement | null) => {
  await nextTick();
  // Past the current event turn: clicking the trigger from *inside* the click
  // that revealed it lands while the popover's outside-click handler is still
  // listening, so it opens and instantly closes again.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

  const trigger = getHost()?.querySelector<HTMLElement>("button");
  trigger?.click();
  trigger?.focus();
};

const resetDraft = () => {
  draftLabel.value = null;
  draftOperator.value = "=";
  draftValue.value = null;
  labelError.value = "";
  valueOptions.value = [];
  suggestionsUnavailable.value = false;
  valuesLoading.value = false;
};

const cancel = () => {
  step.value = "idle";
  resetDraft();
};

// On EVERY open, not just the first: a window change drops the loaded label
// names (they are window-scoped), so a one-shot emit left the picker saying
// "No options found" for the rest of the page. The parent's loader dedupes —
// it returns early while names are loaded or loading — so re-emitting is free.
const startPicking = () => {
  resetDraft();
  step.value = "label";
  emit("focus-picker");
  autoOpen(() => labelStepRef.value);
};

/**
 * Suggestions are best-effort. An empty result or a rejection degrades to a
 * hint — never to a disabled field — so the filter stays addable either way.
 */
const onLabelPicked = async (value: unknown) => {
  const label = typeof value === "string" ? value.trim() : "";
  if (!label) return;

  if (!LABEL_NAME_RE.test(label)) {
    labelError.value = t("metrics.explorer.labels.invalidLabel");
    return;
  }

  draftLabel.value = label;
  labelError.value = "";
  valueOptions.value = [];
  suggestionsUnavailable.value = false;

  // Advance straight to the value: the label alone is not a filter, so making
  // the user click onward would be asking for a decision they already made.
  step.value = "value";
  valuesLoading.value = true;
  autoOpen(() => valueSelectRef.value);

  try {
    const values = await props.loadValues(label);
    // The draft moved on while this was in flight — the user picked another
    // label, or cancelled. A slow answer for label A must not overwrite the
    // picker that is now showing label B.
    if (draftLabel.value !== label) return;
    valueOptions.value = (values ?? []).map((v) => ({ label: v, value: v }));
    suggestionsUnavailable.value = valueOptions.value.length === 0;
  } catch {
    if (draftLabel.value !== label) return;
    valueOptions.value = [];
    suggestionsUnavailable.value = true;
  } finally {
    if (draftLabel.value === label) valuesLoading.value = false;
  }
};

const commit = (value: string) => {
  const label = (draftLabel.value ?? "").trim();
  const trimmed = (value ?? "").trim();
  if (!LABEL_NAME_RE.test(label) || !trimmed) return;

  emit("add", {
    label,
    value: trimmed,
    operator: draftOperator.value || "=",
  });
  cancel();
};

/** Selecting a value IS the commit — there is nothing left to confirm. */
const onValuePicked = (value: unknown) => {
  if (typeof value === "string" && value) commit(value);
};

/** Free-text commit, for when suggestions are unavailable. */
const onValueCreated = (value: string) => {
  if (value) commit(value);
};

/** Closing a dropdown without choosing abandons the draft. */
const onDropdownClosed = () => {
  if (step.value === "label" && !draftLabel.value) cancel();
};

defineExpose({
  startPicking,
  cancel,
  draftOperator,
  onLabelPicked,
  onValuePicked,
  onValueCreated,
});
</script>
