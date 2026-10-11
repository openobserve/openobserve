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
              v-for="chip in filterChips(step)"
              :key="chip"
              :label="chip"
              variant="default-outline"
              size="xs"
            />
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
            <OPopover
              v-if="step.kind === 'p'"
              side="bottom"
              align="end"
              content-class="p-3 w-80 max-w-[calc(100vw-1.5rem)]"
            >
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="filter-alt"
                  :aria-label="t('rum.analytics.funnel.stepFilters')"
                  :data-test="`rum-analytics-funnel-step-${i}-filters`"
                  ><OTooltip :content="t('rum.analytics.funnel.stepFilters')"
                /></OButton>
              </template>
              <div
                class="flex flex-col gap-3"
                :data-test="`rum-analytics-funnel-step-${i}-filters-popover`"
              >
                <span class="text-text-heading text-sm font-semibold">{{
                  t("rum.analytics.funnel.stepFilters")
                }}</span>
                <OInput
                  type="number"
                  size="sm"
                  :min="0"
                  :max="MAX_STEP_MS / 1000"
                  :label="t('rum.analytics.funnel.filterMinTime')"
                  :model-value="step.f?.minMs !== undefined ? step.f.minMs / 1000 : ''"
                  :data-test="`rum-analytics-funnel-step-${i}-filter-min`"
                  @update:model-value="(v) => setFilters(i, { minMs: toMs(v) })"
                />
                <OCheckbox
                  :model-value="!!step.f?.frustrated"
                  :label="t('rum.analytics.funnel.filterFrustrated')"
                  :data-test="`rum-analytics-funnel-step-${i}-filter-frustrated`"
                  @update:model-value="(v) => setFilters(i, { frustrated: v === true })"
                />
                <OCheckbox
                  :model-value="!!step.f?.errored"
                  :label="t('rum.analytics.funnel.filterErrored')"
                  :data-test="`rum-analytics-funnel-step-${i}-filter-errored`"
                  @update:model-value="(v) => setFilters(i, { errored: v === true })"
                />
              </div>
            </OPopover>
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
      v-for="(x, j) in exclusions"
      :key="j"
      class="flex flex-wrap items-center gap-1.5 px-2 py-1.5 text-xs"
      :data-test="`rum-analytics-funnel-exclusion-${j}`"
    >
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
      <span class="ms-auto flex items-center gap-0.5">
        <OPopover side="bottom" align="end" content-class="p-3 w-72 max-w-[calc(100vw-1.5rem)]">
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              :aria-label="t('rum.analytics.funnel.exclusionMode')"
              :data-test="`rum-analytics-funnel-exclusion-${j}-edit`"
              ><OTooltip :content="t('rum.analytics.funnel.exclusionMode')"
            /></OButton>
          </template>
          <div class="flex flex-col gap-3">
            <OToggleGroup
              :model-value="x.b !== undefined ? 'between' : 'within'"
              type="single"
              :label="t('rum.analytics.funnel.exclusionMode')"
              label-position="top"
              :data-test="`rum-analytics-funnel-exclusion-${j}-mode`"
              @update:model-value="(m) => setMode(j, m)"
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
              :options="stepOptions(1, x.b !== undefined ? def.steps.length - 1 : def.steps.length)"
              :label="t('rum.analytics.funnel.exclusionFrom')"
              size="sm"
              :data-test="`rum-analytics-funnel-exclusion-${j}-from`"
              @update:model-value="(v) => setExclusion(j, spanFrom(x, Number(v)))"
            />
            <OSelect
              v-if="x.b !== undefined"
              :model-value="x.b"
              :options="stepOptions(x.a + 1, def.steps.length)"
              :label="t('rum.analytics.funnel.exclusionTo')"
              size="sm"
              :data-test="`rum-analytics-funnel-exclusion-${j}-to`"
              @update:model-value="(v) => setExclusion(j, { ...x, b: Number(v) })"
            />
            <OInput
              v-else
              type="number"
              size="sm"
              :min="1"
              :max="MAX_STEP_MS / 1000"
              :label="t('rum.analytics.funnel.exclusionSeconds')"
              :model-value="(x.withinMs ?? 0) / 1000"
              :data-test="`rum-analytics-funnel-exclusion-${j}-seconds`"
              @update:model-value="
                (v) => toMs(v) && setExclusion(j, { step: x.step, a: x.a, withinMs: toMs(v) })
              "
            />
          </div>
        </OPopover>
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="close"
          :aria-label="t('rum.analytics.funnel.removeExclusion')"
          :data-test="`rum-analytics-funnel-exclusion-${j}-remove`"
          @click="removeExclusion(j)"
          ><OTooltip :content="t('rum.analytics.funnel.removeExclusion')"
        /></OButton>
      </span>
    </div>

    <div
      class="flex flex-wrap items-center gap-2 px-2 pt-2"
      data-test="rum-analytics-funnel-suggestions"
    >
      <AnalyticsPanelState
        v-if="suggestionsState.status === 'error' || suggestionsState.status === 'forbidden'"
        :state="suggestionsState"
        data-test="rum-analytics-funnel-suggestions"
        @retry="emit('suggestions-retry')"
      />
      <template v-else>
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
      </template>
      <span class="w-72 max-md:w-full">
        <StepPicker
          :model-value="null"
          :placeholder="t('rum.analytics.funnel.searchStep')"
          :events="events"
          :kinds="STEP_KINDS"
          :disabled="full"
          data-test="rum-analytics-funnel-add-step-select"
          @update:model-value="(s) => s && add(s)"
        />
        <OTooltip v-if="full" :content="t('rum.analytics.funnel.maxSteps')" />
      </span>
      <span>
        <OButton
          variant="outline"
          size="sm"
          icon-left="add"
          :disabled="!!exclusionBlocked"
          data-test="rum-analytics-funnel-add-exclusion-btn"
          @click="pickingExclusion = true"
          >{{ t("rum.analytics.funnel.addExclusion") }}</OButton
        >
        <OTooltip v-if="exclusionBlocked" :content="exclusionBlocked" />
      </span>
      <span v-if="pickingExclusion" class="flex items-center gap-1.5 max-md:w-full">
        <span class="w-72 max-md:w-full">
          <StepPicker
            :model-value="null"
            :placeholder="t('rum.analytics.funnel.exclusionPick')"
            :events="events"
            :kinds="STEP_KINDS"
            data-test="rum-analytics-funnel-exclusion-select"
            @update:model-value="(s) => s && addExclusion(s)"
          />
        </span>
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="close"
          :aria-label="t('common.cancel')"
          data-test="rum-analytics-funnel-exclusion-cancel"
          @click="pickingExclusion = false"
          ><OTooltip :content="t('common.cancel')"
        /></OButton>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import StepPicker from "@/components/rum/productAnalytics/StepPicker.vue";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
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
  type ExclusionStep,
  type FunnelDef,
  type SampleRatio,
  type StepFilters,
  type StepKind,
  type StepRef,
} from "@/utils/rum/productAnalyticsQueries";
import { stepLabel } from "@/utils/rum/productAnalyticsPanels";

const props = defineProps<{
  def: FunnelDef;
  result: FunnelResult | null;
  suggestions: { step: StepRef; units: number }[];
  suggestionsState: PanelState<unknown>;
  state: PanelState<unknown>;
  sampled: SampleRatio;
  events: NamedEvent[];
  eventsStatus: NamedEventsStatus;
  deletedNames: Readonly<Record<string, string>>;
  unitLabel: I18nText;
  unitNoun: I18nText;
  hideTime: boolean;
}>();
const emit = defineEmits<{
  "update:def": [FunnelDef];
  dropoff: [number];
  "suggestions-retry": [];
}>();
const { t } = useI18nTyped();
const dash = raw("—");
const STEP_KINDS: StepKind[] = ["e", "p", "c", "r"];
const MAX_EXCLUSIONS = 5;
const MAX_STEP_MS = 86400000;
const DEFAULT_WITHIN_MS = 5000;
const pickingExclusion = ref(false);

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
    : raw(stepLabel(s, props.events, props.deletedNames));

const KIND_LABEL = {
  p: "rum.analytics.kind.page",
  c: "rum.analytics.kind.click",
  e: "rum.analytics.kind.event",
  r: "rum.analytics.kind.error",
} as const;
const KIND_VARIANT: Record<StepKind, BadgeVariant> = {
  p: "blue-soft",
  c: "teal-soft",
  e: "purple-soft",
  r: "error-soft",
};

const kindLabel = (s: StepRef) => t(KIND_LABEL[s.kind]);

const kindVariant = (s: StepRef): BadgeVariant => KIND_VARIANT[s.kind];

const exclusions = computed(() => props.def.x ?? []);

const exclusionBlocked = computed<I18nText | null>(() => {
  if (props.def.steps.length < 2) return t("rum.analytics.funnel.exclusionNeedsSteps");
  return exclusions.value.length >= MAX_EXCLUSIONS
    ? t("rum.analytics.funnel.maxExclusions", { max: MAX_EXCLUSIONS })
    : null;
});

const filterChips = (s: StepRef): I18nText[] => [
  ...(s.f?.minMs !== undefined
    ? [t("rum.analytics.funnel.filterOnPage", { seconds: s.f.minMs / 1000 })]
    : []),
  ...(s.f?.frustrated ? [t("rum.analytics.funnel.filterFrustratedTag")] : []),
  ...(s.f?.errored ? [t("rum.analytics.funnel.filterErroredTag")] : []),
];

const toMs = (v: string | number): number | undefined => {
  const n = Number(v);
  return v === "" || !Number.isFinite(n) || n <= 0
    ? undefined
    : Math.min(Math.round(n * 1000), MAX_STEP_MS);
};

const stepOptions = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => ({
    label: raw(String(from + k)),
    value: from + k,
  }));

const update = (steps: StepRef[]) => emit("update:def", { ...props.def, steps });

const updateX = (x: ExclusionStep[]) => emit("update:def", { ...props.def, x });

const setFilters = (
  i: number,
  patch: { minMs?: number; frustrated?: boolean; errored?: boolean },
) => {
  const steps = props.def.steps.map((s, j) => {
    if (j !== i) return s;
    const merged = { ...s.f, ...patch };
    const f: StepFilters = {
      ...(merged.minMs !== undefined ? { minMs: merged.minMs } : {}),
      ...(merged.frustrated ? { frustrated: true as const } : {}),
      ...(merged.errored ? { errored: true as const } : {}),
    };
    return Object.keys(f).length ? { kind: s.kind, key: s.key, f } : { kind: s.kind, key: s.key };
  });
  update(steps);
};

const addExclusion = (step: StepRef) => {
  pickingExclusion.value = false;
  if (exclusionBlocked.value) return;
  updateX([...exclusions.value, { step, a: 1, b: 2 }]);
};

const setExclusion = (j: number, x: ExclusionStep) =>
  updateX(exclusions.value.map((e, k) => (k === j ? x : e)));

const removeExclusion = (j: number) => updateX(exclusions.value.filter((_, k) => k !== j));

// A between row needs a later step, so moving its start onto the last step pulls it back one.
const spanFrom = (x: ExclusionStep, a: number): ExclusionStep => {
  if (x.b === undefined) return { step: x.step, a, withinMs: x.withinMs };
  const n = props.def.steps.length;
  const start = Math.min(a, n - 1);
  return { step: x.step, a: start, b: Math.max(x.b, start + 1) };
};

const setMode = (j: number, mode: unknown) => {
  const x = exclusions.value[j];
  if (mode === "within" && x.b !== undefined)
    setExclusion(j, { step: x.step, a: x.a, withinMs: DEFAULT_WITHIN_MS });
  else if (mode === "between" && x.b === undefined)
    setExclusion(j, spanFrom({ step: x.step, a: x.a, b: x.a + 1 }, x.a));
};

const move = (i: number, by: number) => {
  const steps = [...props.def.steps];
  const j = i + by;
  if (j < 0 || j >= steps.length) return;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  update(steps);
};

// An exclusion must never point at a missing step, so one that used the removed step goes with it.
const remove = (i: number) => {
  const n = i + 1;
  const shift = (k: number) => (k > n ? k - 1 : k);
  const kept: ExclusionStep[] = [];
  for (const x of exclusions.value) {
    if (x.a === n || x.b === n) {
      toast({
        variant: "info",
        message: t("rum.analytics.funnel.exclusionDropped", { step: labelOf(x.step) }),
      });
      continue;
    }
    kept.push(x.b !== undefined ? { ...x, a: shift(x.a), b: shift(x.b) } : { ...x, a: shift(x.a) });
  }
  emit("update:def", {
    ...props.def,
    steps: props.def.steps.filter((_, j) => j !== i),
    ...(props.def.x ? { x: kept } : {}),
  });
};

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
