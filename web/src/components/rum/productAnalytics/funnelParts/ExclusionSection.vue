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
  <section class="flex flex-col gap-1" data-test="rum-analytics-funnel-exclusions">
    <div class="flex flex-wrap items-center gap-2 px-2">
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="text-text-heading text-sm font-semibold">{{
          t("rum.analytics.funnel.exclusionStepsTitle")
        }}</span>
        <span class="text-text-secondary text-xs">{{
          t("rum.analytics.funnel.exclusionStepsCaption")
        }}</span>
      </span>
      <span>
        <OButton
          variant="outline"
          size="sm"
          icon-left="add"
          :disabled="!!blocked"
          data-test="rum-analytics-funnel-add-exclusion-btn"
          @click="picking = true"
          >{{ t("rum.analytics.funnel.addExclusionStep") }}</OButton
        >
        <OTooltip v-if="blocked" :content="blocked" />
      </span>
    </div>

    <ExclusionRow
      v-for="(x, j) in exclusions"
      :key="j"
      :x="x"
      :test-id="`rum-analytics-funnel-exclusion-${j}`"
      :step-count="def.steps.length"
      :removed="removed[j] ?? null"
      :problem="rowProblems[j] ?? null"
      :sampled="sampled"
      :events="events"
      :events-status="eventsStatus"
      @update="(next) => editRow(j, next)"
      @remove="removeRow(j)"
    />
    <ExclusionRow
      v-if="pending"
      :x="pending"
      test-id="rum-analytics-funnel-exclusion-pending"
      :step-count="def.steps.length"
      :removed="null"
      :problem="exclusionProblem(def.steps, pending)"
      :sampled="sampled"
      :events="events"
      :events-status="eventsStatus"
      @update="editPending"
      @remove="pending = null"
    />

    <span v-if="picking" class="flex items-center gap-1.5 px-2 max-md:w-full">
      <span class="w-72 max-md:w-full">
        <StepPicker
          :model-value="null"
          :placeholder="t('rum.analytics.funnel.exclusionPick')"
          :events="events"
          :kinds="STEP_KINDS"
          data-test="rum-analytics-funnel-exclusion-select"
          @update:model-value="(s) => s && pick(s)"
        />
      </span>
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="close"
        :aria-label="t('common.cancel')"
        data-test="rum-analytics-funnel-exclusion-cancel"
        @click="picking = false"
        ><OTooltip :content="t('common.cancel')"
      /></OButton>
    </span>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import StepPicker from "@/components/rum/productAnalytics/StepPicker.vue";
import ExclusionRow from "@/components/rum/productAnalytics/funnelParts/ExclusionRow.vue";
import { fitsSteps, newExclusion } from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import type { NamedEventsStatus } from "@/composables/rum/useNamedEvents";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import {
  exclusionProblem,
  type ExclusionProblem,
  type NamedEvent,
} from "@/utils/rum/productAnalyticsModel";
import type {
  ExclusionStep,
  FunnelDef,
  SampleRatio,
  StepKind,
  StepRef,
} from "@/utils/rum/productAnalyticsQueries";

const props = defineProps<{
  def: FunnelDef;
  removed: (number | null)[];
  sampled: SampleRatio;
  events: NamedEvent[];
  eventsStatus: NamedEventsStatus;
}>();
const emit = defineEmits<{ "update:def": [FunnelDef] }>();
const { t } = useI18nTyped();
const STEP_KINDS: StepKind[] = ["e", "p", "c", "r"];
const MAX_EXCLUSIONS = 5;
const picking = ref(false);
// An invalid exclusion is held here, never in the funnel, until its range or target is fixed.
const pending = ref<ExclusionStep | null>(null);
const rowProblems = ref<Record<number, ExclusionProblem>>({});

const exclusions = computed(() => props.def.x ?? []);

const blocked = computed<I18nText | null>(() => {
  if (props.def.steps.length < 2) return t("rum.analytics.funnel.exclusionNeedsSteps");
  return exclusions.value.length + (pending.value ? 1 : 0) >= MAX_EXCLUSIONS
    ? t("rum.analytics.funnel.maxExclusions", { max: MAX_EXCLUSIONS })
    : null;
});

const updateX = (x: ExclusionStep[]) => emit("update:def", { ...props.def, x });

const pick = (step: StepRef) => {
  picking.value = false;
  if (blocked.value) return;
  const x = newExclusion(props.def, step);
  if (exclusionProblem(props.def.steps, x)) pending.value = x;
  else updateX([...exclusions.value, x]);
};

const editPending = (x: ExclusionStep) => {
  if (!fitsSteps(x, props.def.steps.length)) return;
  if (exclusionProblem(props.def.steps, x)) {
    pending.value = x;
    return;
  }
  pending.value = null;
  updateX([...exclusions.value, x]);
};

const editRow = (j: number, x: ExclusionStep) => {
  if (!fitsSteps(x, props.def.steps.length)) return;
  const problem = exclusionProblem(props.def.steps, x);
  const { [j]: _, ...rest } = rowProblems.value;
  rowProblems.value = problem ? { ...rest, [j]: problem } : rest;
  if (!problem) updateX(exclusions.value.map((e, k) => (k === j ? x : e)));
};

const removeRow = (j: number) => {
  rowProblems.value = {};
  updateX(exclusions.value.filter((_, k) => k !== j));
};

// A held row's step numbers belong to the steps it was picked against.
watch(
  () => props.def.steps,
  () => {
    pending.value = null;
    rowProblems.value = {};
  },
);
</script>
