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
    class="flex items-center flex-wrap gap-2"
    data-test="metrics-explorer-label-filter-bar"
  >
    <!-- Existing filters -->
    <!-- Keyed and removed by the WHOLE matcher, never by the label: a label can
         carry several of them (`status=~"5.."` and `status!="503"`), and keying
         on the label alone would collide two chips onto one v-for key. -->
    <OTag
      v-for="filter in filters"
      :key="labelFilterKey(filter)"
      variant="primary"
      size="sm"
      shape="rounded"
      :data-test="`metrics-explorer-label-chip-${filter.label}`"
    >
      <span class="font-mono text-xs"
        >{{ filter.label }} {{ filter.operator || "=" }}
        {{ filter.value }}</span
      >
      <template #trailing>
        <button
          type="button"
          class="ml-1 inline-flex items-center cursor-pointer"
          :aria-label="`Remove filter ${labelFilterKey(filter)}`"
          :data-test="`metrics-explorer-label-chip-remove-${filter.label}`"
          @click.stop="$emit('remove', filter)"
        >
          <OIcon name="close" size="xs" />
        </button>
      </template>
    </OTag>

    <!-- Membership resolution is deferred to the first filter interaction, so the
         bar itself reports that the grid is still narrowing. -->
    <span
      v-if="schemaLoading"
      class="inline-flex items-center cursor-help"
      role="status"
      aria-label="Resolving label membership"
      data-test="metrics-explorer-label-schema-loading"
    >
      <OTooltip content="Resolving which metrics carry these labels…" :delay="200" />
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
        Filter
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
          placeholder="Select a label"
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
        <span class="text-xs font-mono text-text-secondary shrink-0">
          {{ draftLabel }}
        </span>
        <!-- Defaulted to `=`, one click to change. All four PromQL matchers are
             supported by the selector builder, so regex filters cost nothing
             extra — but they never get in the way of the common case. -->
        <div class="w-20">
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
            placeholder="Select or type a value"
            :options="valueOptions"
            :loading="valuesLoading"
            @update:model-value="onValuePicked"
            @create="onValueCreated"
            @close="onDropdownClosed"
          />
        </div>
        <span
          v-if="suggestionsUnavailable"
          class="text-xs text-text-secondary shrink-0"
          data-test="metrics-explorer-label-picker-no-suggestions"
        >
          No suggestions — type a value.
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import {
  labelFilterKey,
  type LabelFilter,
} from "@/composables/metrics/useMetricsExplorerGrid";

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
  /** First open only — lets the parent lazily fetch label names. */
  (e: "focus-picker"): void;
}>();

type Step = "idle" | "label" | "value";
const step = ref<Step>("idle");
const pickerRequested = ref(false);

const labelStepRef = ref<HTMLElement | null>(null);
const valueStepRef = ref<HTMLElement | null>(null);
/** The VALUE select specifically — the operator select renders before it. */
const valueSelectRef = ref<HTMLElement | null>(null);

const draftLabel = ref<string | null>(null);
const draftOperator = ref<string>("=");
const draftValue = ref<string | null>(null);
const labelError = ref("");

const valueOptions = ref<{ label: string; value: string }[]>([]);
const valuesLoading = ref(false);
const suggestionsUnavailable = ref(false);

const labelOptions = computed(() =>
  props.labelNames.map((name) => ({ label: name, value: name })),
);

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

const startPicking = () => {
  resetDraft();
  step.value = "label";
  if (!pickerRequested.value) {
    pickerRequested.value = true;
    emit("focus-picker");
  }
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
    labelError.value = "Invalid label name.";
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
    valueOptions.value = (values ?? []).map((v) => ({ label: v, value: v }));
    suggestionsUnavailable.value = valueOptions.value.length === 0;
  } catch {
    valueOptions.value = [];
    suggestionsUnavailable.value = true;
  } finally {
    valuesLoading.value = false;
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
