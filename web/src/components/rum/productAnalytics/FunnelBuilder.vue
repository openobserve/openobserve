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
  <div class="flex flex-col" data-test="rum-analytics-funnel">
    <div
      class="text-text-secondary border-border-default grid items-end gap-x-3 border-b px-2 pb-1.5 text-xs max-md:hidden"
      :class="gridClass"
    >
      <span />
      <span>{{ t("rum.analytics.funnel.step") }}</span>
      <span class="text-end">{{ unitLabel }}</span>
      <span class="text-end">{{ t("rum.analytics.funnel.ofFirst") }}</span>
      <span class="text-end">{{ t("rum.analytics.funnel.ofPrevious") }}</span>
      <span v-if="!hideTime" class="text-end underline decoration-dotted underline-offset-2"
        >{{ t("rum.analytics.funnel.timeFromFirst") }}
        <OTooltip :content="t('rum.analytics.funnel.timeTooltip', { unit: unitNoun })" />
      </span>
      <span>{{ t("rum.analytics.funnel.reached") }}</span>
      <span />
    </div>
    <VueDraggableNext
      :model-value="def.steps"
      handle=".funnel-drag-handle"
      item-key="key"
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
          </span>
          <template v-if="numbersReady && result && result.steps[i]">
            <span
              class="text-text-heading text-end font-semibold tabular-nums"
              :data-test="`rum-analytics-funnel-step-${i}-count`"
              >{{ formatCount(result.steps[i].units, sampled) }}</span
            >
            <span class="text-end tabular-nums">{{ pct(result.steps[i].ofFirst) }}</span>
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
            <OProgressBar
              :value="result.steps[i].ofFirst"
              size="lg"
              class="min-w-24"
              :data-test="`rum-analytics-funnel-bar-${i}`"
            />
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
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="arrow-upward"
              :disabled="i === 0"
              :aria-label="t('rum.analytics.funnel.moveUp')"
              :data-test="`rum-analytics-funnel-step-${i}-move-up`"
              @click="move(i, -1)"
              ><OTooltip :content="t('rum.analytics.funnel.moveUp')"
            /></OButton>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="arrow-downward"
              :disabled="i === def.steps.length - 1"
              :aria-label="t('rum.analytics.funnel.moveDown')"
              :data-test="`rum-analytics-funnel-step-${i}-move-down`"
              @click="move(i, 1)"
              ><OTooltip :content="t('rum.analytics.funnel.moveDown')"
            /></OButton>
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

    <div
      class="flex flex-wrap items-center gap-2 px-2 pt-2"
      data-test="rum-analytics-funnel-suggestions"
    >
      <span v-if="suggestions.length" class="text-text-secondary flex items-center gap-1 text-xs">
        <OIcon name="auto-awesome" size="sm" />{{
          t("rum.analytics.funnel.nextStep", { step: def.steps.length })
        }}
      </span>
      <OButton
        v-for="(s, i) in suggestions"
        :key="`${s.step.kind}:${s.step.key}`"
        variant="outline"
        size="sm"
        icon-left="add"
        :disabled="full"
        :data-test="`rum-analytics-funnel-suggestion-${i}`"
        @click="add(s.step)"
      >
        <span class="flex items-center gap-1.5">
          <OTag :label="kindLabel(s.step)" :variant="kindVariant(s.step)" size="xs" />
          <span class="max-w-60 truncate font-mono text-xs">{{ s.step.key }}</span>
          <span class="text-text-secondary text-xs">{{ formatCount(s.units, sampled) }}</span>
        </span>
      </OButton>
      <span class="w-72 max-md:w-full">
        <StepPicker
          :model-value="null"
          :placeholder="t('rum.analytics.funnel.searchStep')"
          :events="events"
          :disabled="full"
          data-test="rum-analytics-funnel-add-step-select"
          @update:model-value="(s) => s && add(s)"
        />
        <OTooltip v-if="full" :content="t('rum.analytics.funnel.maxSteps')" />
      </span>
    </div>
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
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import StepPicker from "@/components/rum/productAnalytics/StepPicker.vue";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import type { NamedEventsStatus } from "@/composables/rum/useNamedEvents";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  MAX_PARAM_LENGTH,
  encodeDef,
  formatCount,
  formatDuration,
  funnelParam,
  type FunnelResult,
  type NamedEvent,
} from "@/utils/rum/productAnalyticsModel";
import {
  MAX_FUNNEL_STEPS,
  type FunnelDef,
  type SampleRatio,
  type StepRef,
} from "@/utils/rum/productAnalyticsQueries";
import { stepLabel } from "@/utils/rum/productAnalyticsPanels";

const props = defineProps<{
  def: FunnelDef;
  result: FunnelResult | null;
  suggestions: { step: StepRef; units: number }[];
  state: PanelState<unknown>;
  sampled: SampleRatio;
  events: NamedEvent[];
  eventsStatus: NamedEventsStatus;
  unitLabel: I18nText;
  unitNoun: I18nText;
  hideTime: boolean;
}>();
const emit = defineEmits<{ "update:def": [FunnelDef]; dropoff: [number] }>();
const { t } = useI18nTyped();
const dash = raw("—");

const gridClass = computed(() =>
  props.hideTime
    ? "grid-cols-[3rem_minmax(0,1fr)_5.5rem_5rem_5rem_minmax(6rem,18rem)_6.5rem]"
    : "grid-cols-[3rem_minmax(0,1fr)_5.5rem_5rem_5rem_6.5rem_minmax(6rem,18rem)_6.5rem]",
);

const numbersReady = computed(() => props.state.status === "ok");
// A panel held for unreadable events has nothing coming, so a skeleton would promise numbers that never arrive.
const numbersHeld = computed(
  () =>
    props.state.status === "idle" &&
    (props.eventsStatus === "failed" || props.eventsStatus === "forbidden"),
);
const full = computed(() => props.def.steps.length >= MAX_FUNNEL_STEPS);

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const isDeleted = (s: StepRef) => s.kind === "e" && !props.events.some((e) => e.id === s.key);

// With no list to name it, an event's id is opaque, so it stays neutral until the list is ready.
const labelOf = (s: StepRef): I18nText =>
  s.kind === "e" && props.eventsStatus !== "ready" && !props.events.some((e) => e.id === s.key)
    ? t("rum.analytics.events.unloadedStep")
    : raw(stepLabel(s, props.events));

const kindLabel = (s: StepRef) =>
  s.kind === "p"
    ? t("rum.analytics.kind.page")
    : s.kind === "c"
      ? t("rum.analytics.kind.click")
      : t("rum.analytics.kind.event");

const kindVariant = (s: StepRef): BadgeVariant =>
  s.kind === "p" ? "blue-soft" : s.kind === "c" ? "teal-soft" : "purple-soft";

const update = (steps: StepRef[]) => emit("update:def", { ...props.def, steps });

const move = (i: number, by: number) => {
  const steps = [...props.def.steps];
  const j = i + by;
  if (j < 0 || j >= steps.length) return;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  update(steps);
};

const remove = (i: number) => update(props.def.steps.filter((_, j) => j !== i));

// The URL keeps the funnel, so a step that would push it past what a link can carry is refused.
const add = (step: StepRef) => {
  if (full.value) return;
  const steps = [...props.def.steps, step];
  if (encodeDef(funnelParam({ ...props.def, steps })).length > MAX_PARAM_LENGTH) {
    toast({ variant: "error", message: t("rum.analytics.funnel.tooLongForLink") });
    return;
  }
  update(steps);
};

const onDrag = (steps: StepRef[]) => update(steps);
</script>
