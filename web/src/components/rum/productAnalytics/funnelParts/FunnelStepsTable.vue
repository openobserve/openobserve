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
  <div class="flex flex-col" data-test="rum-analytics-funnel-steps-table">
    <div
      class="text-text-secondary bg-surface-subtle grid items-center gap-x-3 px-2 py-2 text-xs max-md:hidden"
      :class="gridClass"
      data-test="rum-analytics-funnel-steps-header"
    >
      <span />
      <span
        v-for="col in headerCols"
        :key="col.id"
        class="flex items-center gap-1"
        :class="col.id === 'step' ? '' : 'justify-end'"
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
            <span
              class="text-text-heading text-end font-semibold tabular-nums"
              :data-test="`rum-analytics-funnel-step-${i}-count`"
              >{{ formatCount(result.steps[i].units, sampled) }}</span
            >
            <span class="text-end tabular-nums">{{
              i === 0 ? dash : pct(result.steps[i].ofPrevious)
            }}</span>
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
            <span class="text-end tabular-nums">{{ pct(result.steps[i].ofFirst) }}</span>
            <span class="min-w-24">
              <FunnelStepBar
                :value="result.steps[i].ofFirst"
                :removed="removedShare(i)"
                :data-test="`rum-analytics-funnel-bar-${i}`"
              />
            </span>
          </template>
          <template v-else-if="numbersHeld">
            <span
              v-for="n in hideTime ? 4 : 5"
              :key="n"
              class="text-text-secondary text-end"
              :data-test="n === 1 ? `rum-analytics-funnel-step-${i}-held` : undefined"
              >{{ dash }}</span
            >
          </template>
          <template v-else>
            <OSkeleton v-for="n in hideTime ? 4 : 5" :key="n" type="text" class="h-5 w-full" />
          </template>
          <span class="flex items-center justify-end gap-0.5">
            <StepConditionPopover
              v-if="step.kind === 'p'"
              :step="step"
              :index="i"
              @update="(s) => replaceStep(i, s)"
            />
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
            v-if="result.steps[i].dropoff > 0"
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
import StepConditionPopover from "@/components/rum/productAnalytics/funnelParts/StepConditionPopover.vue";
import useStepLabels from "@/components/rum/productAnalytics/funnelParts/useStepLabels";
import {
  removeStep,
  reorderSteps,
  stepOrder,
  type FunnelEdit,
} from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import type { NamedEventsStatus } from "@/composables/rum/useNamedEvents";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  formatCount,
  formatDuration,
  type FunnelResult,
  type NamedEvent,
} from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef, SampleRatio, StepRef } from "@/utils/rum/productAnalyticsQueries";

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
}>();
const emit = defineEmits<{
  "update:def": [FunnelDef];
  dropoff: [number];
}>();
const { t } = useI18nTyped();
const { labelOf, kindLabel, kindVariant, filterChips } = useStepLabels(
  () => props.events,
  () => props.eventsStatus,
  () => props.deletedNames ?? {},
);
const dash = raw("—");

const gridClass = computed(() =>
  props.hideTime
    ? "grid-cols-[3rem_minmax(0,3fr)_5.5rem_7rem_5.5rem_minmax(6rem,2fr)_4rem]"
    : "grid-cols-[3rem_minmax(0,3fr)_5.5rem_7rem_8rem_5.5rem_minmax(6rem,2fr)_4rem]",
);

const headerCols = computed(() => [
  { id: "step", label: t("rum.analytics.funnel.step"), tip: t("rum.analytics.funnel.orderLabel") },
  {
    id: "unit",
    label: props.unitLabel,
    tip: t("rum.analytics.funnel.unitTooltip", { unit: props.unitLabel }),
  },
  {
    id: "of-previous",
    label: t("rum.analytics.funnel.ofPrevious"),
    tip: t("rum.analytics.funnel.ofPreviousTooltip"),
  },
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
    tip: t("rum.analytics.funnel.ofFirstTooltip"),
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

const replaceStep = (i: number, step: StepRef) =>
  emit("update:def", { ...props.def, steps: props.def.steps.map((s, j) => (j === i ? step : s)) });

const remove = (i: number) => apply(removeStep(props.def, i));

const onDrag = (steps: StepRef[]) => {
  const order = stepOrder(props.def.steps, steps);
  if (order) apply(reorderSteps(props.def, order));
};
</script>
