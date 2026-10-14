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
    class="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]"
    :class="collapsed ? 'lg:grid-cols-[auto_minmax(0,1fr)]' : 'lg:grid-cols-[22rem_minmax(0,1fr)]'"
    data-test="rum-analytics-funnel-layout-rail"
  >
    <aside
      ref="aside"
      class="border-border-default flex min-w-0 flex-col gap-4 border-e max-lg:border-e-0 max-lg:pe-0 lg:min-h-0 lg:overflow-y-auto"
      :class="collapsed ? 'pe-2' : 'pe-4'"
    >
      <div v-if="collapsed" class="max-lg:hidden" data-test="rum-analytics-funnel-rail-collapsed">
        <OButton
          variant="outline"
          size="icon-xs-sq"
          :aria-label="t('rum.analytics.funnel.expandRail')"
          :aria-expanded="false"
          data-test="rum-analytics-funnel-rail-collapse-btn"
          @click="toggleCollapsed"
        >
          <OIcon name="keyboard-double-arrow-right" size="sm" />
          <OTooltip :content="t('rum.analytics.funnel.expandRail')" />
        </OButton>
      </div>
      <div
        class="flex min-w-0 flex-col gap-4"
        :class="collapsed ? 'lg:hidden' : ''"
        data-test="rum-analytics-funnel-rail-sections"
      >
        <FunnelSectionRow
          :title="t('rum.analytics.funnel.railSteps')"
          stacked
          test-id="rum-analytics-funnel-rail-steps"
        >
          <template #action>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="add"
              :aria-label="t('rum.analytics.funnel.addStep')"
              :aria-expanded="adding"
              data-test="rum-analytics-funnel-rail-add-step-btn"
              @click="adding = !adding"
              ><OTooltip :content="t('rum.analytics.funnel.addStep')"
            /></OButton>
            <OButton
              variant="outline"
              size="icon-xs-sq"
              class="max-lg:hidden"
              :aria-label="t('rum.analytics.funnel.collapseRail')"
              :aria-expanded="true"
              data-test="rum-analytics-funnel-rail-collapse-btn"
              @click="toggleCollapsed"
            >
              <OIcon name="keyboard-double-arrow-left" size="sm" />
              <OTooltip :content="t('rum.analytics.funnel.collapseRail')" />
            </OButton>
          </template>
          <template #body>
            <VueDraggableNext
              :model-value="def.steps"
              handle=".funnel-drag-handle"
              item-key="key"
              class="flex flex-col gap-1.5"
              @update:model-value="onDrag"
            >
              <div
                v-for="(step, i) in def.steps"
                :key="`${step.kind}:${step.key}:${i}`"
                class="rounded-default flex flex-col gap-1.5 border"
                :class="open === i ? 'border-accent bg-surface-accent' : 'border-border-default'"
              >
                <div class="flex items-center gap-0.5 pe-1">
                  <span
                    class="group relative flex shrink-0 items-center self-stretch ps-1 max-md:gap-0.5"
                  >
                    <span
                      class="text-text-secondary w-4 text-center text-xs tabular-nums md:group-hover:invisible"
                      >{{ i + 1 }}</span
                    >
                    <OIcon
                      name="drag-indicator"
                      size="sm"
                      class="funnel-drag-handle text-text-secondary cursor-grab md:invisible md:absolute md:inset-0 md:m-auto md:group-hover:visible"
                      :data-test="`rum-analytics-funnel-rail-step-${i}-drag`"
                    />
                  </span>
                  <span
                    class="min-w-0 flex-1 py-1.5 pe-1.5"
                    :data-test="`rum-analytics-funnel-rail-step-${i}`"
                  >
                    <RailStepLine :step="step" :events="events" :events-status="eventsStatus" />
                  </span>
                  <OButton
                    v-if="step.kind === 'p'"
                    :variant="open === i ? 'ghost-primary' : 'ghost'"
                    size="icon-xs"
                    icon-left="filter-alt"
                    :aria-label="t('rum.analytics.funnel.stepFilters')"
                    :aria-expanded="open === i"
                    :data-test="`rum-analytics-funnel-rail-step-${i}-filters`"
                    @click="open = open === i ? null : i"
                    ><OTooltip :content="t('rum.analytics.funnel.stepFilters')"
                  /></OButton>
                  <OButton
                    variant="ghost"
                    size="icon-xs"
                    icon-left="close"
                    :aria-label="t('rum.analytics.funnel.remove')"
                    :data-test="`rum-analytics-funnel-rail-step-${i}-remove`"
                    @click="remove(i)"
                    ><OTooltip :content="t('rum.analytics.funnel.remove')"
                  /></OButton>
                </div>
                <div v-if="open === i && step.kind === 'p'" class="px-2 pb-2">
                  <StepConditionEditor
                    :step="step"
                    :index="i"
                    compact
                    @update="(s) => replaceStep(i, s)"
                  />
                </div>
              </div>
            </VueDraggableNext>
            <div
              v-if="adding"
              class="border-accent bg-surface-accent rounded-default border p-1.5"
              data-test="rum-analytics-funnel-rail-add-step"
            >
              <FunnelAddStep
                :def="def"
                :suggestions="suggestions"
                :suggestions-state="suggestionsState"
                :sampled="sampled"
                :events="events"
                stacked
                @update:def="(d) => emit('update:def', d)"
                @suggestions-retry="emit('suggestions-retry')"
              />
            </div>
          </template>
        </FunnelSectionRow>
        <FunnelFilterBar
          :def="def"
          :fields="filterFields"
          :field-types="filterFieldTypes"
          :values="filterValues"
          stacked
          @update:def="(d) => emit('update:def', d)"
          @filter-values="(f) => emit('filter-values', f)"
        />
        <ExclusionSection
          :def="def"
          :removed="removed"
          :sampled="sampled"
          :events="events"
          :events-status="eventsStatus"
          stacked
          @update:def="(d) => emit('update:def', d)"
        />
        <div data-test="rum-analytics-funnel-rail-app-filters">
          <AppFiltersSummary
            :counts="appFilters"
            :included="includeHidden"
            :app="app"
            always
            stacked
            @include="emit('include-hidden')"
            @hide="emit('hide-hidden')"
            @edit="emit('edit-app-filters')"
          />
        </div>
        <FunnelSectionRow
          :title="t('rum.analytics.funnel.railSettings')"
          stacked
          boxed
          test-id="rum-analytics-funnel-rail-settings"
        >
          <template v-for="(s, i) in settings" :key="s.id">
            <span v-if="i > 0" class="text-text-secondary" aria-hidden="true">{{ separator }}</span>
            <span
              class="text-text-secondary"
              :title="s.label"
              :data-test="`rum-analytics-funnel-rail-setting-${s.id}`"
              >{{ s.value }}</span
            >
          </template>
        </FunnelSectionRow>
      </div>
    </aside>
    <div class="min-w-0 lg:min-h-0 lg:overflow-y-auto">
      <OCard
        variant="outlined"
        class="rounded-surface flex min-w-0 flex-col"
        data-test="rum-analytics-funnel-card"
      >
        <slot name="header" />
        <div class="flex flex-col gap-2 px-4 py-3">
          <slot name="notices" />
          <div v-if="!failed" class="flex min-w-0 flex-col" data-test="rum-analytics-funnel">
            <FunnelStepsTable
              :def="def"
              :result="result"
              :removed-at="removedAt"
              :state="state"
              :sampled="sampled"
              :events="events"
              :events-status="eventsStatus"
              :unit-label="unitLabel"
              :unit-noun="unitNoun"
              :hide-time="hideTime"
              rail-edits
              @update:def="(d) => emit('update:def', d)"
              @dropoff="(k) => emit('dropoff', k)"
            />
          </div>
          <slot name="footer" />
        </div>
      </OCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import FunnelStepsTable from "@/components/rum/productAnalytics/funnelParts/FunnelStepsTable.vue";
import FunnelAddStep from "@/components/rum/productAnalytics/funnelParts/FunnelAddStep.vue";
import ExclusionSection from "@/components/rum/productAnalytics/funnelParts/ExclusionSection.vue";
import FunnelFilterBar from "@/components/rum/productAnalytics/funnelParts/FunnelFilterBar.vue";
import FunnelSectionRow from "@/components/rum/productAnalytics/funnelParts/FunnelSectionRow.vue";
import AppFiltersSummary from "@/components/rum/productAnalytics/funnelParts/AppFiltersSummary.vue";
import StepConditionEditor from "@/components/rum/productAnalytics/funnelParts/StepConditionEditor.vue";
import useStepLabels from "@/components/rum/productAnalytics/funnelParts/useStepLabels";
import RailStepLine from "@/components/rum/productAnalytics/funnelLayouts/rail/RailStepLine.vue";
import {
  removedByStep,
  removeStep,
  reorderSteps,
  stepOrder,
  type FunnelEdit,
} from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import type {
  FunnelLayoutEmits,
  FunnelLayoutProps,
  FunnelLayoutSlots,
} from "@/components/rum/productAnalytics/funnelLayouts/types";
import { raw, useI18nTyped } from "@/types/i18n";
import type { StepRef } from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "FunnelLayoutRail" });

const props = defineProps<FunnelLayoutProps>();
const emit = defineEmits<FunnelLayoutEmits>();
defineSlots<FunnelLayoutSlots>();
const { t } = useI18nTyped();
const { labelOf } = useStepLabels(
  () => props.events,
  () => props.eventsStatus,
);
const separator = raw("·");
const COLLAPSED_KEY = "o2.rum.analytics.funnelRailCollapsed";

const aside = ref<HTMLElement | null>(null);
const open = ref<number | null>(null);
const adding = ref(false);
const collapsed = ref(false);
try {
  collapsed.value = localStorage.getItem(COLLAPSED_KEY) === "1";
} catch {
  // localStorage can be unavailable (private mode); default expanded.
}

// The toggle that was clicked leaves the DOM, so focus is handed to its replacement.
const toggleCollapsed = async () => {
  collapsed.value = !collapsed.value;
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed.value ? "1" : "0");
  } catch {
    // Non-fatal; the state just does not persist.
  }
  await nextTick();
  aside.value
    ?.querySelector<HTMLElement>('[data-test="rum-analytics-funnel-rail-collapse-btn"]')
    ?.focus();
};

const removedAt = computed(() => removedByStep(props.def, props.removed));

// A step count change shifts indexes, so an open editor would point at a different step.
watch(
  () => props.def.steps.length,
  (n, was) => {
    open.value = null;
    if (n > was) adding.value = false;
  },
);

const replaceStep = (i: number, step: StepRef) =>
  emit("update:def", { ...props.def, steps: props.def.steps.map((s, j) => (j === i ? step : s)) });

const apply = (edit: FunnelEdit) => {
  for (const x of edit.dropped) {
    toast({
      variant: "info",
      message: t("rum.analytics.funnel.exclusionDropped", { step: labelOf(x.step) }),
    });
  }
  emit("update:def", edit.def);
};

const remove = (i: number) => apply(removeStep(props.def, i));

// Indexes move with the steps, so an open editor would point at another step.
const onDrag = (steps: StepRef[]) => {
  const order = stepOrder(props.def.steps, steps);
  if (!order) return;
  open.value = null;
  apply(reorderSteps(props.def, order));
};
</script>
