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
  <div class="flex flex-col gap-1 px-2 py-1.5 text-xs" :data-test="testId">
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="text-text-secondary">{{ t("rum.analytics.funnel.didNotSee") }}</span>
      <OTag :label="kindLabel(x.step)" :variant="kindVariant(x.step)" size="xs" />
      <span class="text-text-body min-w-0 font-mono break-all">{{ labelOf(x.step) }}</span>
      <span class="text-text-secondary">{{
        x.b !== undefined
          ? t("rum.analytics.funnel.exclusionBetween", { a: x.a, b: x.b })
          : t("rum.analytics.funnel.exclusionWithin", {
              seconds: (x.withinMs ?? 0) / 1000,
              a: x.a,
            })
      }}</span>
      <OTag
        v-if="isWholeFunnel(x, stepCount)"
        :label="t('rum.analytics.funnel.exclusionWholeFunnel')"
        variant="default-outline"
        size="xs"
        :data-test="`${testId}-whole`"
      />
      <OTag
        v-if="removed !== null"
        :label="
          t('rum.analytics.funnel.exclusionRemoved', {
            count: formatCount(removed, sampled),
            step: x.b ?? x.a,
          })
        "
        variant="default-soft"
        size="xs"
        :data-test="`${testId}-removed`"
      />
      <span class="ms-auto flex items-center gap-0.5">
        <OPopover side="bottom" align="end" content-class="p-3 w-72 max-w-[calc(100vw-1.5rem)]">
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              :aria-label="t('rum.analytics.funnel.exclusionMode')"
              :data-test="`${testId}-edit`"
              ><OTooltip :content="t('rum.analytics.funnel.exclusionMode')"
            /></OButton>
          </template>
          <div class="flex flex-col gap-3">
            <OToggleGroup
              :model-value="x.b !== undefined ? 'between' : 'within'"
              type="single"
              :label="t('rum.analytics.funnel.exclusionMode')"
              label-position="top"
              :data-test="`${testId}-mode`"
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
              :model-value="x.a"
              :options="stepOptions(1, x.b !== undefined ? stepCount - 1 : stepCount)"
              :label="t('rum.analytics.funnel.exclusionFrom')"
              size="sm"
              :data-test="`${testId}-from`"
              @update:model-value="(v) => emit('update', spanFrom(x, Number(v), stepCount))"
            />
            <OSelect
              v-if="x.b !== undefined"
              :model-value="x.b"
              :options="stepOptions(x.a + 1, stepCount)"
              :label="t('rum.analytics.funnel.exclusionTo')"
              size="sm"
              :data-test="`${testId}-to`"
              @update:model-value="(v) => emit('update', { ...x, b: Number(v) })"
            />
            <OInput
              v-else
              type="number"
              size="sm"
              :min="1"
              :max="MAX_STEP_MS / 1000"
              :label="t('rum.analytics.funnel.exclusionSeconds')"
              :model-value="(x.withinMs ?? 0) / 1000"
              :data-test="`${testId}-seconds`"
              @update:model-value="(v) => setSeconds(toMs(v))"
            />
          </div>
        </OPopover>
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="close"
          :aria-label="t('rum.analytics.funnel.removeExclusion')"
          :data-test="`${testId}-remove`"
          @click="emit('remove')"
          ><OTooltip :content="t('rum.analytics.funnel.removeExclusion')"
        /></OButton>
      </span>
    </div>
    <span
      v-if="problemText"
      class="text-status-error-text"
      role="alert"
      :data-test="`${testId}-invalid`"
      >{{ problemText }}</span
    >
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import useStepLabels from "@/components/rum/productAnalytics/funnelParts/useStepLabels";
import {
  MAX_STEP_MS,
  isWholeFunnel,
  spanFrom,
  toMs,
} from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import type { NamedEventsStatus } from "@/composables/rum/useNamedEvents";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  formatCount,
  type ExclusionProblem,
  type NamedEvent,
} from "@/utils/rum/productAnalyticsModel";
import type { ExclusionStep, SampleRatio } from "@/utils/rum/productAnalyticsQueries";

const props = defineProps<{
  x: ExclusionStep;
  testId: string;
  stepCount: number;
  removed: number | null;
  problem: ExclusionProblem | null;
  sampled: SampleRatio;
  events: NamedEvent[];
  eventsStatus: NamedEventsStatus;
}>();
const emit = defineEmits<{ update: [ExclusionStep]; remove: [] }>();
const { t } = useI18nTyped();
const { labelOf, kindLabel, kindVariant } = useStepLabels(
  () => props.events,
  () => props.eventsStatus,
);
const DEFAULT_WITHIN_MS = 5000;

const problemText = computed(() => {
  const p = props.problem;
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

const setSeconds = (ms: number | undefined) => {
  if (ms !== undefined) emit("update", { step: props.x.step, a: props.x.a, withinMs: ms });
};

const setMode = (mode: unknown) => {
  const x = props.x;
  if (mode === "within" && x.b !== undefined)
    emit("update", { step: x.step, a: x.a, withinMs: DEFAULT_WITHIN_MS });
  else if (mode === "between" && x.b === undefined)
    emit("update", spanFrom({ step: x.step, a: x.a, b: x.a + 1 }, x.a, props.stepCount));
};
</script>
