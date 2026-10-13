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
  <OCard
    variant="outlined"
    class="rounded-surface flex flex-col"
    data-test="rum-analytics-funnel-card"
  >
    <slot name="header" />
    <div class="flex flex-col gap-2 px-4 py-3">
      <slot name="notices" />
      <div
        v-if="!failed"
        class="flex flex-col gap-3"
        data-test="rum-analytics-funnel-layout-inline"
      >
        <div class="flex flex-col gap-1">
          <AppFiltersSummary
            :counts="appFilters"
            :included="includeHidden"
            :app="app"
            @include="emit('include-hidden')"
            @edit="emit('edit-app-filters')"
          />
          <FunnelFilterBar
            :def="def"
            :fields="filterFields"
            :field-types="filterFieldTypes"
            :values="filterValues"
            @update:def="(d) => emit('update:def', d)"
            @filter-values="(f) => emit('filter-values', f)"
          />
        </div>
        <div class="flex flex-col" data-test="rum-analytics-funnel">
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
          <span class="px-2 pt-2">
            <FunnelAddStep
              :def="def"
              :suggestions="suggestions"
              :suggestions-state="suggestionsState"
              :sampled="sampled"
              :events="events"
              @update:def="(d) => emit('update:def', d)"
              @suggestions-retry="emit('suggestions-retry')"
            />
          </span>
        </div>
        <ExclusionSection
          :def="def"
          :removed="removed"
          :sampled="sampled"
          :events="events"
          :events-status="eventsStatus"
          @update:def="(d) => emit('update:def', d)"
        />
      </div>
      <slot name="footer" />
    </div>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OCard from "@/lib/core/Card/OCard.vue";
import FunnelStepsTable from "@/components/rum/productAnalytics/funnelParts/FunnelStepsTable.vue";
import FunnelAddStep from "@/components/rum/productAnalytics/funnelParts/FunnelAddStep.vue";
import ExclusionSection from "@/components/rum/productAnalytics/funnelParts/ExclusionSection.vue";
import FunnelFilterBar from "@/components/rum/productAnalytics/funnelParts/FunnelFilterBar.vue";
import AppFiltersSummary from "@/components/rum/productAnalytics/funnelParts/AppFiltersSummary.vue";
import { removedByStep } from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import type {
  FunnelLayoutEmits,
  FunnelLayoutProps,
  FunnelLayoutSlots,
} from "@/components/rum/productAnalytics/funnelLayouts/types";

defineOptions({ name: "FunnelLayoutInline" });

const props = defineProps<FunnelLayoutProps>();
const emit = defineEmits<FunnelLayoutEmits>();
defineSlots<FunnelLayoutSlots>();

const removedAt = computed(() => removedByStep(props.def, props.removed));
</script>
