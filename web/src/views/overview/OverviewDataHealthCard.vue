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
    section="data-health"
    :title="t('overview.sections.dataHealth')"
    :link-label="t('overview.viewAll')"
    :view="view"
    @retry="emit('retry')"
    @view-all="emit('open')"
  >
    <template #empty>
      <p class="text-text-secondary text-sm" data-test="overview-data-health-none">
        {{ t("overview.dataHealth.noPipelines") }}
      </p>
    </template>
    <OButton
      variant="ghost"
      block
      class="justify-between"
      data-test="overview-data-health-row-pipelines"
      @click="emit('open')"
    >
      <span class="text-text-body text-sm">{{ t("overview.dataHealth.pipelinesErrored") }}</span>
      <span class="flex items-center gap-2">
        <OTag type="countChip" :value="errored > 0 ? 'error' : 'success'">{{
          errored > 0
            ? t("overview.dataHealth.errorCount", { errored, total })
            : t("overview.dataHealth.allHealthy")
        }}</OTag>
      </span>
    </OButton>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { useI18nTyped } from "@/types/i18n";
import type { OverviewPipelinesData, OverviewSection } from "@/ts/interfaces/overview";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import { sectionView } from "./overviewFormat";

const props = defineProps<{
  section?: OverviewSection<OverviewPipelinesData>;
  pending: boolean;
  failed: boolean;
}>();

const emit = defineEmits<{ retry: []; open: [] }>();

const { t } = useI18nTyped();

const errored = computed(() => props.section?.data?.errored ?? 0);
const total = computed(() => props.section?.data?.total ?? 0);

const view = computed(() => {
  const base = sectionView(props.section, props);
  return base === "ok" && total.value === 0 ? "empty" : base;
});
</script>
