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
  <OverviewSectionCard
    section="alerts"
    :title="t('overview.sections.alerts')"
    :link-label="t('overview.viewAll')"
    :view="view"
    @retry="emit('retry')"
    @view-all="emit('open')"
  >
    <template #empty>
      <OEmptyState
        size="inline"
        icon="notifications"
        :title="t('overview.alerts.emptyTitle')"
        data-test="overview-alerts-empty"
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            data-test="overview-alerts-open-btn"
            @click="emit('open')"
          >
            {{ t("overview.alerts.emptyAction") }}
          </OButton>
        </template>
      </OEmptyState>
    </template>
    <ul class="flex flex-col" data-test="overview-alerts-rows">
      <li v-for="row in rows" :key="row.key">
        <OverviewRowButton :data-test="`overview-alerts-row-${row.key}`" @click="emit('open')">
          <span class="text-text-body text-sm">{{ row.label }}</span>
          <OTag type="countChip" :value="row.count > 0 ? row.tone : 'neutral'">{{
            row.count
          }}</OTag>
        </OverviewRowButton>
      </li>
    </ul>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { useI18nTyped } from "@/types/i18n";
import type { OverviewAlertsData, OverviewSection } from "@/ts/interfaces/overview";
import OverviewRowButton from "./OverviewRowButton.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import { firingCount, sectionView } from "./overviewFormat";

const props = defineProps<{
  section?: OverviewSection<OverviewAlertsData>;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
}>();

const emit = defineEmits<{ retry: []; open: [] }>();

const { t } = useI18nTyped();

const view = computed(() => {
  const base = sectionView(props.section, props);
  return base === "ok" && props.section?.data?.total === 0 ? "empty" : base;
});

const rows = computed(() => {
  const data = props.section?.data;
  return [
    {
      key: "firing",
      label: t("overview.alerts.firing"),
      count: firingCount(data),
      tone: "error",
    },
    {
      key: "pending",
      label: t("overview.alerts.pending"),
      count: data?.by_state.pending ?? 0,
      tone: "warning",
    },
    {
      key: "failing",
      label: t("overview.alerts.failing"),
      count: data?.failed_evaluation ?? 0,
      tone: "error",
    },
  ];
});
</script>
