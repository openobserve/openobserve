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
    section="storage"
    :title="t('overview.sections.storage')"
    :view="view"
    :summary-forbidden="forbidden"
    @retry="emit('retry')"
  >
    <template #empty>
      <OEmptyState
        size="inline"
        icon="storage"
        :title="t('overview.storage.emptyTitle')"
        data-test="overview-storage-empty"
      />
    </template>
    <div class="flex flex-col gap-3" data-test="overview-storage-body">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-text-body text-sm">{{ t("overview.storage.used") }}</span>
        <span class="text-text-heading text-lg font-semibold" data-test="overview-storage-total">{{
          raw(formatSizeFromMB(totalMb))
        }}</span>
      </div>
      <OSegmentedBar
        :segments="split.map((x) => x.segment)"
        size="md"
        :label="t('overview.storage.bySignal')"
        data-test="overview-storage-bar"
      />
      <ul class="flex flex-wrap gap-x-4 gap-y-1" data-test="overview-storage-legend">
        <li
          v-for="row in split"
          :key="row.signal"
          class="flex items-center gap-1.5 text-xs"
          :data-test="`overview-storage-legend-${row.signal}`"
        >
          <span
            :class="['size-2 shrink-0 rounded-full', SEGMENT_SWATCH[SIGNAL_VARIANT[row.signal]]]"
            aria-hidden="true"
          />
          <span class="text-text-body">{{ t(`overview.signals.${row.signal}`) }}</span>
          <span class="text-text-secondary tabular-nums">{{ raw(`${row.percent}%`) }}</span>
        </li>
      </ul>
      <p class="text-text-secondary text-xs">{{ t("overview.storage.splitNote") }}</p>
    </div>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSegmentedBar from "@/lib/data/SegmentedBar/OSegmentedBar.vue";
import { SEGMENT_SWATCH } from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatSizeFromMB } from "@/utils/formatters";
import type { OverviewSection, OverviewStreamsData } from "@/ts/interfaces/overview";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import { SIGNAL_VARIANT, sectionView, signalSplit } from "./overviewFormat";

const props = defineProps<{
  section?: OverviewSection<OverviewStreamsData>;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
}>();

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();

const totalMb = computed(() => props.section?.data?.total_storage_size_mb ?? 0);
const split = computed(() => signalSplit(props.section?.data?.by_type ?? []));

const view = computed(() => {
  const base = sectionView(props.section, props);
  return base === "ok" && totalMb.value <= 0 ? "empty" : base;
});
</script>
