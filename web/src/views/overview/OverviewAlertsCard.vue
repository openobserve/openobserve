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
    <ul class="flex flex-col" data-test="overview-alerts-rows">
      <li v-for="row in rows" :key="row.key">
        <OButton
          variant="ghost"
          block
          class="h-auto! justify-between! gap-3! px-0! py-1.5! text-start"
          :data-test="`overview-alerts-row-${row.key}`"
          @click="emit('open')"
        >
          <span class="text-text-body text-sm">{{ row.label }}</span>
          <OTag type="countChip" :value="row.count > 0 ? row.tone : 'neutral'">{{
            row.count
          }}</OTag>
        </OButton>
      </li>
    </ul>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { useI18nTyped } from "@/types/i18n";
import type { OverviewAlertsData, OverviewSection } from "@/ts/interfaces/overview";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import { sectionView } from "./overviewFormat";

const props = defineProps<{
  section?: OverviewSection<OverviewAlertsData>;
  pending: boolean;
  failed: boolean;
}>();

const emit = defineEmits<{ retry: []; open: [] }>();

const { t } = useI18nTyped();

const view = computed(() => sectionView(props.section, props));

const rows = computed(() => {
  const data = props.section?.data;
  return [
    {
      key: "firing",
      label: t("overview.alerts.firing"),
      count: data?.by_state.firing ?? 0,
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
