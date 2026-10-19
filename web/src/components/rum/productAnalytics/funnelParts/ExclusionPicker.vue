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
    class="flex h-104 flex-col gap-2 max-lg:h-auto lg:max-h-[calc(var(--reka-popper-available-height,26rem)-1.625rem)]"
    data-test="rum-analytics-funnel-exclusion-picker"
  >
    <template v-if="current === null">
      <div class="flex min-h-0 flex-1 flex-col max-lg:h-72">
        <OFieldList
          keyboard
          :fields="listRows"
          :search="search"
          :search-placeholder="t('rum.analytics.funnel.exclusionPick')"
          search-class="px-0"
          row-key="value"
          :loading="loading && !search"
          :show-pagination="false"
          @update:search="onSearchInput"
          @row-click="onRowClick"
        >
          <template #field-row="{ row }">
            <OFieldRow :data-test="`rum-analytics-funnel-exclusion-picker-step-${row.value}`">
              <OTag :label="kindLabel(row.step)" :variant="kindVariant(row.step)" size="xs" />
              <OTruncatedText as="span" class="min-w-0">{{ row.name }}</OTruncatedText>
              <OTag v-if="row.badge" :label="row.badge" variant="default-outline" size="xs" />
            </OFieldRow>
          </template>
          <template #loading>
            <span
              class="text-text-secondary py-2 text-xs"
              data-test="rum-analytics-funnel-exclusion-picker-loading"
              >{{ t("rum.analytics.funnel.exclusionLoading") }}</span
            >
          </template>
          <template #empty>
            <span
              v-if="loading"
              class="text-text-secondary py-2 text-xs"
              data-test="rum-analytics-funnel-exclusion-picker-loading"
              >{{ t("rum.analytics.funnel.exclusionLoading") }}</span
            >
            <span
              v-else-if="failed && !listRows.length"
              class="text-text-secondary flex items-center gap-1.5 text-xs"
              >{{ t("rum.analytics.funnel.exclusionLoadFailed") }}
              <OButton
                variant="ghost-primary"
                size="xs"
                data-test="rum-analytics-funnel-exclusion-picker-retry"
                @click="load"
                >{{ t("common.retry") }}</OButton
              ></span
            >
            <span
              v-else
              class="text-text-secondary py-2 text-xs"
              data-test="rum-analytics-funnel-exclusion-picker-no-step"
              >{{ t("components.select.noOptionsFound") }}</span
            >
          </template>
        </OFieldList>
      </div>
      <span
        v-if="failed && listRows.length"
        class="text-text-secondary flex items-center gap-1.5 text-xs"
        >{{ t("rum.analytics.funnel.exclusionLoadFailed") }}
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="rum-analytics-funnel-exclusion-picker-retry"
          @click="load"
          >{{ t("common.retry") }}</OButton
        ></span
      >
      <span
        v-if="noCustom"
        class="text-text-secondary text-xs"
        data-test="rum-analytics-funnel-exclusion-picker-no-custom"
        >{{ t("rum.analytics.picker.noCustom") }}</span
      >
    </template>
    <template v-else>
      <span class="flex min-w-0 items-center gap-1.5">
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="arrow-back"
          :aria-label="t('rum.analytics.funnel.exclusionChangeStep')"
          data-test="rum-analytics-funnel-exclusion-picker-back"
          @click="back"
          ><OTooltip :content="t('rum.analytics.funnel.exclusionChangeStep')"
        /></OButton>
        <OTag :label="kindLabel(current.step)" :variant="kindVariant(current.step)" size="xs" />
        <span
          class="text-text-heading min-w-0 text-sm font-semibold break-all"
          data-test="rum-analytics-funnel-exclusion-picker-step"
          >{{ labelOf(current.step) }}</span
        >
      </span>
      <OToggleGroup
        :model-value="current.b !== undefined ? 'between' : 'within'"
        type="single"
        :label="t('rum.analytics.funnel.exclusionMode')"
        label-position="top"
        data-test="rum-analytics-funnel-exclusion-picker-mode"
        @update:model-value="setMode"
      >
        <OToggleGroupItem value="between" size="xs">{{
          t("rum.analytics.funnel.exclusionModeBetween")
        }}</OToggleGroupItem>
        <OToggleGroupItem value="within" size="xs">{{
          t("rum.analytics.funnel.exclusionModeWithin")
        }}</OToggleGroupItem>
      </OToggleGroup>
      <OSelect
        :model-value="current.a"
        :options="stepOptions(1, current.b !== undefined ? stepCount - 1 : stepCount)"
        :label="t('rum.analytics.funnel.exclusionFrom')"
        size="sm"
        data-test="rum-analytics-funnel-exclusion-picker-from"
        @update:model-value="(v) => setFrom(Number(v))"
      />
      <OSelect
        v-if="current.b !== undefined"
        :model-value="current.b"
        :options="stepOptions(current.a + 1, stepCount)"
        :label="t('rum.analytics.funnel.exclusionTo')"
        size="sm"
        data-test="rum-analytics-funnel-exclusion-picker-to"
        @update:model-value="(v) => setTo(Number(v))"
      />
      <OInput
        v-else
        type="number"
        size="sm"
        :min="1"
        :max="MAX_STEP_MS / 1000"
        :label="t('rum.analytics.funnel.exclusionSeconds')"
        :model-value="secondsText"
        data-test="rum-analytics-funnel-exclusion-picker-seconds"
        @update:model-value="setSeconds"
      />
      <span
        v-if="secondsInvalid"
        class="text-status-error-text text-xs"
        role="alert"
        data-test="rum-analytics-funnel-exclusion-picker-seconds-invalid"
        >{{ t("rum.analytics.funnel.exclusionSecondsInvalid", { max: MAX_STEP_MS / 1000 }) }}</span
      >
      <span
        v-if="problemText"
        class="text-status-error-text text-xs"
        role="alert"
        data-test="rum-analytics-funnel-exclusion-picker-invalid"
        >{{ problemText }}</span
      >
      <span
        class="border-border-default mt-auto flex items-center justify-end gap-1.5 border-t pt-2"
      >
        <OButton
          variant="ghost"
          size="sm"
          data-test="rum-analytics-funnel-exclusion-picker-cancel"
          @click="emit('cancel')"
          >{{ t("common.cancel") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm"
          :disabled="problem !== null || secondsInvalid"
          data-test="rum-analytics-funnel-exclusion-picker-apply"
          @click="apply"
          >{{ t("common.apply") }}</OButton
        >
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OFieldList from "@/lib/lists/FieldList/OFieldList.vue";
import OFieldRow from "@/lib/lists/FieldList/OFieldRow.vue";
import type { FieldItem } from "@/lib/lists/FieldList/OFieldList.types";
import useStepLabels from "@/components/rum/productAnalytics/funnelParts/useStepLabels";
import {
  MAX_STEP_MS,
  newExclusion,
  spanFrom,
  toMs,
} from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import type { NamedEventsStatus } from "@/composables/rum/useNamedEvents";
import useStepOptions, { decode } from "@/composables/rum/useStepOptions";
import { raw, useI18nTyped } from "@/types/i18n";
import { exclusionProblem, type NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type {
  ExclusionStep,
  FunnelDef,
  StepKind,
  StepRef,
} from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "ExclusionPicker" });

const STEP_KINDS: StepKind[] = ["e", "p", "c", "r"];
const DEFAULT_WITHIN_MS = 5000;
const SEARCH_DEBOUNCE_MS = 300;

const props = defineProps<{
  def: FunnelDef;
  events: NamedEvent[];
  eventsStatus: NamedEventsStatus;
  deletedNames?: Readonly<Record<string, string>>;
  initial?: ExclusionStep;
}>();
const emit = defineEmits<{
  apply: [ExclusionStep];
  cancel: [];
}>();
const { t } = useI18nTyped();
const { labelOf, kindLabel, kindVariant } = useStepLabels(
  () => props.events,
  () => props.eventsStatus,
  () => props.deletedNames ?? {},
);
const { options, loading, failed, noCustom, load, onSearch } = useStepOptions({
  events: () => props.events,
  kinds: () => STEP_KINDS,
});

const step = ref<StepRef | null>(props.initial?.step ?? null);
// The range survives a trip back to the list, so changing the step keeps what was set.
const draft = ref<ExclusionStep | null>(props.initial ?? null);
const search = ref("");
// The typed text is kept apart from `draft`, so an invalid entry blocks Apply instead of being dropped.
const secondsText = ref<string | number>((props.initial?.withinMs ?? 0) / 1000);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const stepCount = computed(() => props.def.steps.length);

// OFieldList hides a header only when no row with the same `group` matches the search.
const listRows = computed<FieldItem[]>(() =>
  options.value.map((o) => {
    const value = String(o.value);
    if (o.header) {
      const kind = value.slice("header:".length);
      return { name: o.label, value, isGroup: true, groupName: o.label, group: kind };
    }
    const ref_ = decode(value);
    return { name: o.label, value, group: ref_.kind, step: ref_, badge: o.badge };
  }),
);

const current = computed(() => (step.value === null ? null : draft.value));

const problem = computed(() =>
  current.value === null ? null : exclusionProblem(props.def.steps, current.value),
);

// toMs clamps to a day and accepts fractions, so the stated 1 s to 1 day range is enforced here.
const secondsMs = computed(() => {
  const n = Number(secondsText.value);
  const ms = toMs(secondsText.value);
  return ms !== undefined && n >= 1 && n * 1000 <= MAX_STEP_MS ? ms : undefined;
});

const secondsInvalid = computed(
  () => current.value !== null && current.value.b === undefined && secondsMs.value === undefined,
);

const problemText = computed(() => {
  const p = problem.value;
  if (!p) return null;
  return p.kind === "inside"
    ? t("rum.analytics.funnel.exclusionInside", { b: p.b, k: p.step })
    : t("rum.analytics.funnel.exclusionAnchor", { a: p.a });
});

const stepOptions = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => ({
    label: raw(String(from + k)),
    value: from + k,
  }));

const resetSeconds = () => {
  secondsText.value = (draft.value?.withinMs ?? 0) / 1000;
};

const clearSearchTimer = () => {
  if (searchTimer !== null) clearTimeout(searchTimer);
  searchTimer = null;
};

// After a failed load the top-up would clear `failed` and hide Retry, so typing retries the load instead.
const onSearchInput = (term: string) => {
  search.value = term;
  clearSearchTimer();
  searchTimer = setTimeout(() => {
    searchTimer = null;
    void (failed.value ? load() : onSearch(term));
  }, SEARCH_DEBOUNCE_MS);
};

const onRowClick = (row: FieldItem) => {
  if (row.isGroup) return;
  clearSearchTimer();
  const picked = decode(String(row.value));
  draft.value = draft.value ? { ...draft.value, step: picked } : newExclusion(props.def, picked);
  step.value = picked;
  resetSeconds();
};

const back = () => {
  step.value = null;
  search.value = "";
  void load();
};

const setFrom = (a: number) => {
  if (current.value) draft.value = spanFrom(current.value, a, stepCount.value);
};

const setTo = (b: number) => {
  if (current.value) draft.value = { ...current.value, b };
};

const setSeconds = (v: string | number) => {
  secondsText.value = v;
  const x = current.value;
  const ms = secondsMs.value;
  if (ms !== undefined && x) draft.value = { step: x.step, a: x.a, withinMs: ms };
};

const setMode = (mode: unknown) => {
  const x = current.value;
  if (!x) return;
  if (mode === "within" && x.b !== undefined)
    draft.value = { step: x.step, a: x.a, withinMs: DEFAULT_WITHIN_MS };
  else if (mode === "between" && x.b === undefined)
    draft.value = spanFrom({ step: x.step, a: x.a, b: x.a + 1 }, x.a, stepCount.value);
  resetSeconds();
};

const apply = () => {
  if (current.value && problem.value === null && !secondsInvalid.value)
    emit("apply", current.value);
};

onMounted(() => {
  if (step.value === null) void load();
});

onBeforeUnmount(clearSearchTimer);
</script>
