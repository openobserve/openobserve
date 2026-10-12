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
    class="grid grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)] gap-4 max-md:grid-cols-1"
    data-test="rum-analytics-funnel-layout-rail"
  >
    <aside
      class="border-border-default flex flex-col gap-4 border-e pe-4 max-md:border-e-0 max-md:pe-0"
    >
      <section class="flex flex-col gap-1" data-test="rum-analytics-funnel-rail-steps">
        <span class="text-text-heading text-sm font-semibold">{{
          t("rum.analytics.funnel.railSteps")
        }}</span>
        <template v-for="(step, i) in def.steps" :key="`${step.kind}:${step.key}:${i}`">
          <StepConditionPopover
            v-if="step.kind === 'p'"
            :step="step"
            :index="i"
            @update="(s) => replaceStep(i, s)"
          >
            <template #trigger>
              <OButton
                variant="ghost"
                size="sm"
                :aria-label="t('rum.analytics.funnel.stepFilters')"
                :data-test="`rum-analytics-funnel-rail-step-${i}`"
              >
                <RailStepLine
                  :step="step"
                  :index="i"
                  :events="events"
                  :events-status="eventsStatus"
                />
              </OButton>
            </template>
          </StepConditionPopover>
          <span v-else class="px-2 py-1" :data-test="`rum-analytics-funnel-rail-step-${i}`">
            <RailStepLine :step="step" :index="i" :events="events" :events-status="eventsStatus" />
          </span>
        </template>
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
      </section>
      <ExclusionSection
        :def="def"
        :removed="removed"
        :sampled="sampled"
        :events="events"
        :events-status="eventsStatus"
        @update:def="(d) => emit('update:def', d)"
      />
      <section class="flex flex-col gap-1" data-test="rum-analytics-funnel-rail-app-filters">
        <span class="text-text-heading text-sm font-semibold">{{
          t("rum.analytics.exclusions.title", { app: raw(app) })
        }}</span>
        <AppFiltersSummary
          :counts="appFilters"
          :included="includeHidden"
          always
          @include="emit('include-hidden')"
          @edit="emit('edit-app-filters')"
        />
      </section>
      <section class="flex flex-col gap-1" data-test="rum-analytics-funnel-rail-settings">
        <span class="text-text-heading text-sm font-semibold">{{
          t("rum.analytics.funnel.railSettings")
        }}</span>
        <span
          v-for="s in settings"
          :key="s.id"
          class="flex gap-1.5 text-xs"
          :data-test="`rum-analytics-funnel-rail-setting-${s.id}`"
        >
          <span class="text-text-secondary">{{ s.label }}</span>
          <span class="text-text-body">{{ s.value }}</span>
        </span>
      </section>
    </aside>
    <div class="flex min-w-0 flex-col" data-test="rum-analytics-funnel">
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
        @update:def="(d) => emit('update:def', d)"
        @dropoff="(k) => emit('dropoff', k)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import FunnelStepsTable from "@/components/rum/productAnalytics/funnelParts/FunnelStepsTable.vue";
import FunnelAddStep from "@/components/rum/productAnalytics/funnelParts/FunnelAddStep.vue";
import ExclusionSection from "@/components/rum/productAnalytics/funnelParts/ExclusionSection.vue";
import AppFiltersSummary from "@/components/rum/productAnalytics/funnelParts/AppFiltersSummary.vue";
import StepConditionPopover from "@/components/rum/productAnalytics/funnelParts/StepConditionPopover.vue";
import RailStepLine from "@/components/rum/productAnalytics/funnelLayouts/rail/RailStepLine.vue";
import { removedByStep } from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import type {
  FunnelLayoutEmits,
  FunnelLayoutProps,
} from "@/components/rum/productAnalytics/funnelLayouts/types";
import { raw, useI18nTyped } from "@/types/i18n";
import type { StepRef } from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "FunnelLayoutRail" });

const props = defineProps<FunnelLayoutProps>();
const emit = defineEmits<FunnelLayoutEmits>();
const { t } = useI18nTyped();

const removedAt = computed(() => removedByStep(props.def, props.removed));

const replaceStep = (i: number, step: StepRef) =>
  emit("update:def", { ...props.def, steps: props.def.steps.map((s, j) => (j === i ? step : s)) });
</script>
