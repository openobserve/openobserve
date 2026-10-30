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
    class="rounded-surface overflow-hidden"
    data-test="rum-analytics-overview-features"
  >
    <div class="border-border-default flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <span class="text-text-heading text-sm font-semibold">{{
        t("rum.analytics.events.featuresTitle")
      }}</span>
      <span class="text-text-secondary min-w-0 flex-1 truncate text-xs">{{
        t("rum.analytics.events.featuresSubtitle")
      }}</span>
    </div>
    <OEmptyState
      v-if="permission === 'none'"
      preset="no-access"
      size="inline"
      data-test="rum-analytics-overview-features-no-access"
    />
    <OEmptyState
      v-else-if="!events.length"
      preset="no-data"
      size="inline"
      :title="t('rum.analytics.events.featuresEmpty')"
      data-test="rum-analytics-overview-features-empty"
    >
      <template #actions>
        <OButton
          v-if="permission === 'write'"
          variant="outline"
          size="sm"
          data-test="rum-analytics-overview-features-create-btn"
          @click="emit('manage')"
          >{{ t("rum.analytics.events.manage") }}</OButton
        >
      </template>
    </OEmptyState>
    <RankedKeysTable
      v-else
      :rows="rows"
      kind="e"
      view="all"
      :chip="chip"
      :show-users="showUsers"
      :users-label="usersLabel"
      :users-tooltip="usersTooltip"
      :state="state"
      :key-label="t('rum.analytics.events.name')"
      :events-label="t('rum.analytics.columns.events')"
      :compare-label="compareLabel"
      :trend-full="trendFull"
      :trended="trended"
      :labels="labels"
      data-test="rum-analytics-overview-features-table"
      @build-funnel="(s) => emit('build-funnel', s)"
      @paths="(s) => emit('paths', s)"
      @trend="(s) => emit('trend', s)"
      @retry="emit('retry')"
    />
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import RankedKeysTable from "@/components/rum/productAnalytics/RankedKeysTable.vue";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";
import type { NamedEventsPermission } from "@/composables/rum/useNamedEvents";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { ChipFilter, NamedEvent, RankedRow } from "@/utils/rum/productAnalyticsModel";
import type { StepRef } from "@/utils/rum/productAnalyticsQueries";

const props = defineProps<{
  rows: RankedRow[];
  events: readonly NamedEvent[];
  chip: ChipFilter;
  showUsers: boolean;
  usersLabel?: I18nText;
  usersTooltip?: I18nText;
  state: PanelState<unknown>;
  permission: NamedEventsPermission;
  compareLabel: I18nText;
  trendFull: boolean;
  trended: readonly StepRef[];
}>();
const emit = defineEmits<{
  "build-funnel": [StepRef];
  paths: [StepRef];
  trend: [StepRef];
  manage: [];
  retry: [];
}>();
const { t } = useI18nTyped();

const labels = computed(() => Object.fromEntries(props.events.map((e) => [e.id, e.name])));
</script>
