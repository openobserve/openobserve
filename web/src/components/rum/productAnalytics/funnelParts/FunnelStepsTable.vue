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
    class="flex flex-col"
    :class="compare ? (hideTime ? 'md:min-w-[60rem]' : 'md:min-w-[69rem]') : ''"
    data-test="rum-analytics-funnel-steps-table"
  >
    <!-- Two rows in both states, so turning compare on or off never moves the table. -->
    <div
      class="text-text-secondary bg-surface-subtle flex flex-col gap-1 px-2 py-2 text-xs max-md:hidden"
      data-test="rum-analytics-funnel-steps-header"
    >
      <div class="grid h-5 items-end gap-x-3" :class="gridClass">
        <span
          v-if="compare"
          class="border-border-default col-span-3 col-start-4 flex items-center justify-center gap-1 border-b pb-0.5"
          data-test="rum-analytics-funnel-col-of-previous"
          >{{ t("rum.analytics.funnel.ofPrevious") }}
          <span
            tabindex="0"
            role="img"
            :aria-label="t('rum.analytics.funnel.ofPreviousTooltip')"
            class="flex items-center"
          >
            <OIcon name="info-outline" size="xs" />
            <OTooltip :content="t('rum.analytics.funnel.ofPreviousTooltip')" />
          </span>
        </span>
      </div>
      <div class="grid min-h-8 items-end gap-x-3" :class="gridClass">
        <span />
        <span
          v-for="col in headerCols"
          :key="col.id"
          class="flex items-center gap-1"
          :class="col.id === 'step' ? '' : 'justify-end text-end'"
          :data-test="`rum-analytics-funnel-col-${col.id}`"
          >{{ col.label }}
          <span tabindex="0" role="img" :aria-label="col.tip" class="flex items-center">
            <OIcon name="info-outline" size="xs" />
            <OTooltip :content="col.tip" />
          </span>
        </span>
        <span />
        <span />
      </div>
    </div>
    <VueDraggableNext
      :model-value="def.steps"
      handle=".funnel-drag-handle"
      @update:model-value="onDrag"
    >
      <div v-for="(step, i) in def.steps" :key="`${step.kind}:${step.key}:${i}`">
        <div
          class="grid items-center gap-x-3 px-2 py-2 max-md:flex max-md:flex-wrap"
          :class="gridClass"
          :data-test="`rum-analytics-funnel-step-${i}`"
        >
          <span class="flex items-center gap-1">
            <OIcon
              name="drag-indicator"
              size="sm"
              class="funnel-drag-handle text-text-secondary cursor-grab"
            />
            <span
              class="text-text-secondary bg-surface-panel rounded-full px-1.5 text-xs tabular-nums"
              >{{ i + 1 }}</span
            >
          </span>
          <span class="flex min-w-0 flex-wrap items-center gap-1.5 max-md:basis-full">
            <OTag :label="kindLabel(step)" :variant="kindVariant(step)" size="xs" />
            <span class="text-text-body min-w-0 font-mono text-xs break-all">{{
              labelOf(step)
            }}</span>
            <OTag
              v-if="
                step.kind === 'e' && (eventsStatus === 'failed' || eventsStatus === 'forbidden')
              "
              :label="t('rum.analytics.funnel.eventNotLoaded')"
              variant="default-soft"
              size="xs"
              :data-test="`rum-analytics-funnel-step-${i}-unavailable`"
            />
            <OTag
              v-else-if="eventsStatus === 'ready' && isDeleted(step)"
              :label="t('rum.analytics.funnel.deletedEvent')"
              variant="warning-soft"
              size="xs"
              :data-test="`rum-analytics-funnel-step-${i}-deleted`"
            />
            <OTag
              v-else-if="result && result.steps[i] && result.steps[i].seen === 0"
              :label="t('rum.analytics.funnel.notSeen')"
              variant="warning-soft"
              icon="warning"
              size="xs"
              :data-test="`rum-analytics-funnel-step-${i}-not-seen`"
            />
            <span
              v-if="filterChips(step).length"
              class="flex basis-full flex-wrap items-center gap-1 text-xs"
              :data-test="`rum-analytics-funnel-step-${i}-where`"
            >
              <span class="text-text-secondary">{{ t("rum.analytics.funnel.where") }}</span>
              <OTag
                v-for="chip in filterChips(step)"
                :key="chip"
                :label="chip"
                variant="primary-outline"
                size="xs"
              />
            </span>
          </span>
          <template v-if="numbersReady && result && result.steps[i]">
            <span v-if="compare" class="flex flex-col items-end tabular-nums">
              <span
                class="text-text-heading font-semibold"
                :data-test="`rum-analytics-funnel-step-${i}-count`"
                >{{ formatCount(result.steps[i].units, sampled) }}</span
              >
              <span
                v-if="stepCompare(i)?.prevUnits != null"
                class="text-text-secondary text-xs"
                :data-test="`rum-analytics-funnel-step-${i}-prev-count`"
                >{{
                  t("rum.analytics.funnel.previousCount", {
                    count: formatCount(stepCompare(i)?.prevUnits ?? 0, sampled),
                  })
                }}</span
              >
            </span>
            <span
              v-else
              class="text-text-heading text-end font-semibold tabular-nums"
              :data-test="`rum-analytics-funnel-step-${i}-count`"
              >{{ formatCount(result.steps[i].units, sampled) }}</span
            >
            <span class="text-end tabular-nums">{{
              i === 0 ? dash : pct(result.steps[i].ofPrevious)
            }}</span>
            <template v-if="compare">
              <span
                class="text-end tabular-nums"
                :class="prevRate(i) === null ? 'text-text-secondary' : 'text-text-body'"
                :data-test="`rum-analytics-funnel-step-${i}-prev-rate`"
                >{{ prevRate(i) === null ? dash : pct(prevRate(i) ?? 0)
                }}<OTooltip
                  v-if="compareFailed && i > 0"
                  :content="t('rum.analytics.funnel.previousFailed')"
              /></span>
              <span class="flex justify-end" :data-test="`rum-analytics-funnel-step-${i}-change`">
                <FunnelChangeCell
                  :change="stepCompare(i)?.change ?? null"
                  :unit-noun="unitNoun"
                  :failed="compareFailed && i > 0"
                  end
                />
              </span>
            </template>
            <span
              v-if="!hideTime"
              class="flex flex-col items-end tabular-nums"
              :data-test="`rum-analytics-funnel-step-${i}-time`"
            >
              <template v-if="i > 0 && result.steps[i].units > 0">
                <span>{{ formatDuration(result.steps[i].medianMs) }}</span>
                <span class="text-text-secondary text-xs">{{
                  t("rum.analytics.funnel.p90", {
                    value: raw(formatDuration(result.steps[i].p90Ms)),
                  })
                }}</span>
              </template>
              <span v-else>{{ dash }}</span>
            </span>
            <span v-if="prevBars" class="flex flex-col items-end tabular-nums">
              <span>{{ pct(result.steps[i].ofFirst) }}</span>
              <span
                class="text-text-secondary text-xs"
                :data-test="`rum-analytics-funnel-step-${i}-prev-of-first`"
                >{{
                  stepCompare(i)?.prevOfFirst == null ? dash : pct(stepCompare(i)?.prevOfFirst ?? 0)
                }}</span
              >
            </span>
            <span v-else class="text-end tabular-nums">{{ pct(result.steps[i].ofFirst) }}</span>
            <span class="min-w-24">
              <FunnelStepBar
                :value="result.steps[i].ofFirst"
                :removed="removedShare(i)"
                :compare="prevBars"
                :previous="stepCompare(i)?.prevOfFirst ?? null"
                :data-test="`rum-analytics-funnel-bar-${i}`"
              />
            </span>
          </template>
          <template v-else-if="numbersHeld">
            <span
              v-for="n in numberCols"
              :key="n"
              class="text-text-secondary text-end"
              :data-test="n === 1 ? `rum-analytics-funnel-step-${i}-held` : undefined"
              >{{ dash }}</span
            >
          </template>
          <template v-else>
            <OSkeleton v-for="n in numberCols" :key="n" type="text" class="h-5 w-full" />
          </template>
          <span class="flex items-center justify-end gap-0.5">
            <StepConditionPopover
              :step="step"
              :index="i"
              :fields="stepFields(i).map((f) => f.field)"
              :fields-state="fieldSampleState"
              :values="filterValues"
              @update="(s) => replaceStep(i, s)"
              @filter-values="(f) => emit('filter-values', f)"
              @load-fields="emit('load-fields')"
            />
            <ODropdown align="end" @update:open="(o) => o && emit('load-fields')">
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="more-vert"
                  :aria-label="t('rum.analytics.funnel.stepMenu')"
                  :data-test="`rum-analytics-funnel-step-${i}-menu`"
                  ><OTooltip :content="t('rum.analytics.funnel.stepMenu')"
                /></OButton>
              </template>
              <ODropdownItem
                icon-left="alt-route"
                :data-test="`rum-analytics-funnel-step-${i}-break-down`"
                @select="emit('break-down-step', i + 1)"
                >{{ t("rum.analytics.funnel.breakDownByStep") }}</ODropdownItem
              >
              <ODropdownItem
                v-if="i < def.steps.length - 1"
                icon-left="show-chart"
                :data-test="`rum-analytics-funnel-step-${i}-trend-from`"
                @select="emit('trend-from-step', i + 1)"
                >{{ t("rum.analytics.funnel.trendFromHere") }}</ODropdownItem
              >
            </ODropdown>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="close"
              :aria-label="t('rum.analytics.funnel.remove')"
              :data-test="`rum-analytics-funnel-step-${i}-remove`"
              @click="remove(i)"
              ><OTooltip :content="t('rum.analytics.funnel.remove')"
            /></OButton>
          </span>
        </div>
        <div
          v-if="i < def.steps.length - 1 && numbersReady && result && result.steps[i]"
          class="ps-12 pb-1"
        >
          <OButton
            v-if="result.steps[i].dropoff > 0 && dropCompare(i)"
            :variant="dropVariant(i)"
            size="xs"
            icon-left="arrow-downward"
            icon-right="chevron-right"
            aria-haspopup="dialog"
            :aria-label="
              t('rum.analytics.funnel.droppedCompareAria', { ...dropParams(i), step: i + 1 })
            "
            :data-test="`rum-analytics-funnel-dropoff-${i}`"
            @click="emit('dropoff', i + 1)"
            >{{ t("rum.analytics.funnel.droppedCompare", dropParams(i))
            }}<OTooltip
              :content="
                t('rum.analytics.funnel.droppedCompareTooltip', {
                  ...dropParams(i),
                  outOf: formatCount(result.steps[i].units, sampled),
                  prevOutOf: formatCount(dropCompare(i)?.prevOutOf ?? 0, sampled),
                  unit: unitNoun,
                  range: raw(compare?.rangeExact ?? ''),
                  prevRange: raw(compare?.prevRangeExact ?? ''),
                })
              "
          /></OButton>
          <OButton
            v-else-if="result.steps[i].dropoff > 0"
            variant="ghost-primary"
            size="xs"
            icon-left="arrow-downward"
            icon-right="chevron-right"
            aria-haspopup="dialog"
            :aria-label="
              t('rum.analytics.funnel.droppedAria', {
                count: formatCount(result.steps[i].dropoff, sampled),
                pct: pct(1 - result.steps[i + 1].ofPrevious),
                step: i + 1,
              })
            "
            :data-test="`rum-analytics-funnel-dropoff-${i}`"
            @click="emit('dropoff', i + 1)"
            >{{
              t("rum.analytics.funnel.dropped", {
                count: formatCount(result.steps[i].dropoff, sampled),
                pct: pct(1 - result.steps[i + 1].ofPrevious),
              })
            }}<OTooltip :content="t('rum.analytics.funnel.droppedTooltip')"
          /></OButton>
          <span
            v-else
            class="text-text-secondary text-xs"
            :data-test="`rum-analytics-funnel-dropoff-${i}`"
            >{{ t("rum.analytics.funnel.noneDropped") }}</span
          >
        </div>
      </div>
    </VueDraggableNext>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import FunnelStepBar from "@/components/rum/productAnalytics/funnelParts/FunnelStepBar.vue";
import FunnelChangeCell from "@/components/rum/productAnalytics/funnelParts/FunnelChangeCell.vue";
import StepConditionPopover from "@/components/rum/productAnalytics/funnelParts/StepConditionPopover.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import useStepLabels from "@/components/rum/productAnalytics/funnelParts/useStepLabels";
import {
  removeStep,
  reorderSteps,
  stepOrder,
  type FunnelEdit,
} from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import type { FilterValuesState } from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import type { FieldSampleState } from "@/composables/rum/useFunnelFieldSample";
import { fieldsOnStep, type FieldSample, type SeenField } from "@/utils/rum/funnelFields";
import type { NamedEventsStatus } from "@/composables/rum/useNamedEvents";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  formatCount,
  formatDuration,
  type FunnelResult,
  type NamedEvent,
} from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef, SampleRatio, StepRef } from "@/utils/rum/productAnalyticsQueries";
import type { DropCompare, FunnelCompareView, StepCompare } from "@/utils/rum/funnelCompare";

const props = defineProps<{
  def: FunnelDef;
  result: FunnelResult | null;
  removedAt: (number | null)[];
  state: PanelState<unknown>;
  sampled: SampleRatio;
  events: NamedEvent[];
  eventsStatus: NamedEventsStatus;
  deletedNames?: Readonly<Record<string, string>>;
  unitLabel: I18nText;
  unitNoun: I18nText;
  hideTime: boolean;
  compare?: FunnelCompareView | null;
  fieldSample?: FieldSample | null;
  fieldSampleState?: FieldSampleState;
  filterValues?: FilterValuesState;
}>();
const emit = defineEmits<{
  "update:def": [FunnelDef];
  dropoff: [number];
  "filter-values": [string];
  "load-fields": [];
  "break-down-step": [number];
  "trend-from-step": [number];
}>();
const { t } = useI18nTyped();
const { labelOf, kindLabel, kindVariant, filterChips } = useStepLabels(
  () => props.events,
  () => props.eventsStatus,
  () => props.deletedNames ?? {},
);
const dash = raw("—");

const GRID = {
  plain: "grid-cols-[3rem_minmax(0,3fr)_5.5rem_7rem_7rem_minmax(6rem,2fr)_6rem]",
  plainTime: "grid-cols-[3rem_minmax(0,3fr)_5.5rem_7rem_8rem_7rem_minmax(6rem,2fr)_6rem]",
  compare: "grid-cols-[3rem_minmax(0,3fr)_5.5rem_6rem_6rem_6.5rem_7rem_minmax(6rem,2fr)_6rem]",
  compareTime:
    "grid-cols-[3rem_minmax(0,3fr)_5.5rem_6rem_6rem_6.5rem_8rem_7rem_minmax(6rem,2fr)_6rem]",
} as const;

const gridClass = computed(() => {
  if (props.compare) return props.hideTime ? GRID.compare : GRID.compareTime;
  return props.hideTime ? GRID.plain : GRID.plainTime;
});

const numberCols = computed(() => (props.hideTime ? 4 : 5) + (props.compare ? 2 : 0));

const headerCols = computed(() => [
  { id: "step", label: t("rum.analytics.funnel.step"), tip: t("rum.analytics.funnel.orderLabel") },
  {
    id: "unit",
    label: props.unitLabel,
    tip: t("rum.analytics.funnel.unitTooltip", { unit: props.unitLabel }),
  },
  ...(props.compare
    ? [
        {
          id: "this-period",
          label: t("rum.analytics.funnel.thisPeriod"),
          tip: raw(props.compare.rangeExact),
        },
        {
          id: "previous-period",
          label: props.compare.label,
          tip: raw(props.compare.prevRangeExact),
        },
        {
          id: "change",
          label: t("rum.analytics.funnel.changeHeader"),
          tip: t("rum.analytics.funnel.changeHeaderTooltip"),
        },
      ]
    : [
        {
          id: "of-previous",
          label: t("rum.analytics.funnel.ofPrevious"),
          tip: t("rum.analytics.funnel.ofPreviousTooltip"),
        },
      ]),
  ...(props.hideTime
    ? []
    : [
        {
          id: "time",
          label: t("rum.analytics.funnel.timeFromFirst"),
          tip: t("rum.analytics.funnel.timeTooltip", { unit: props.unitNoun }),
        },
      ]),
  {
    id: "of-first",
    label: t("rum.analytics.funnel.ofFirst"),
    tip: props.compare
      ? t("rum.analytics.funnel.ofFirstCompareTooltip")
      : t("rum.analytics.funnel.ofFirstTooltip"),
  },
]);

const numbersReady = computed(() => props.state.status === "ok");
// A panel held for unreadable events has nothing coming, so a skeleton would promise numbers that never arrive.
const numbersHeld = computed(
  () =>
    props.state.status === "idle" &&
    (props.eventsStatus === "failed" || props.eventsStatus === "forbidden"),
);

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const compareData = computed(() =>
  props.compare?.status === "ok" ? (props.compare.data ?? null) : null,
);
const compareFailed = computed(() => props.compare?.status === "failed");
// An empty previous period has no bar to draw, so the rows keep their compare-off bar.
const prevBars = computed(() => !!compareData.value && !compareData.value.empty);

const stepCompare = (i: number): StepCompare | null => compareData.value?.steps[i] ?? null;

const prevRate = (i: number): number | null =>
  i === 0 ? null : (stepCompare(i)?.prevOfPrevious ?? null);

const dropCompare = (i: number): DropCompare | null =>
  prevBars.value ? (compareData.value?.drops[i] ?? null) : null;

const dropParams = (i: number) => {
  const d = dropCompare(i);
  const r = props.result?.steps;
  return {
    pct: pct(r?.[i + 1] ? 1 - r[i + 1].ofPrevious : 0),
    count: formatCount(r?.[i]?.dropoff ?? 0, props.sampled),
    prevPct: pct(d?.prevRate ?? 0),
    prevCount: formatCount(d?.prevCount ?? 0, props.sampled),
  };
};

// Red is the same event as a red change on the next row; grey wins under the low-volume rule.
const dropVariant = (i: number) => {
  const d = dropCompare(i);
  if (d?.lowVolume) return "ghost-muted";
  return d?.rose ? "ghost-destructive" : "ghost-primary";
};

const isDeleted = (s: StepRef) => s.kind === "e" && !props.events.some((e) => e.id === s.key);

const removedShare = (i: number): number => {
  const first = props.result?.steps[0]?.units ?? 0;
  const removed = props.removedAt[i] ?? 0;
  return first > 0 ? removed / first : 0;
};

const apply = (edit: FunnelEdit | null) => {
  if (!edit) return;
  for (const x of edit.dropped) {
    toast({
      variant: "info",
      message: t("rum.analytics.funnel.exclusionDropped", { step: labelOf(x.step) }),
    });
  }
  emit("update:def", edit.def);
};

const stepFields = (i: number): SeenField[] => fieldsOnStep(props.fieldSample ?? null, i + 1);

const replaceStep = (i: number, step: StepRef) =>
  emit("update:def", { ...props.def, steps: props.def.steps.map((s, j) => (j === i ? step : s)) });

const remove = (i: number) => apply(removeStep(props.def, i));

const onDrag = (steps: StepRef[]) => {
  const order = stepOrder(props.def.steps, steps);
  if (order) apply(reorderSteps(props.def, order));
};
</script>
