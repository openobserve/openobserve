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
  <div ref="root" class="flex flex-col gap-4" data-test="fleet-collector-versions">
    <OCard variant="outlined" data-test="fleet-collector-versions-distribution">
      <OCardSection role="header">
        <OText variant="panel-title">{{ t("fleet.upgrades.distribution") }}</OText>
      </OCardSection>
      <OSeparator />
      <OCardSection role="body">
        <div
          v-if="summaryLoading"
          class="flex justify-center py-4"
          data-test="fleet-collector-versions-distribution-loading"
        >
          <OSpinner />
        </div>
        <div
          v-else-if="summaryError && !summary"
          data-test="fleet-collector-versions-distribution-error"
        >
          <OEmptyState
            size="inline"
            preset="load-error"
            :action-label="t('emptyState.loadError.action')"
            action-icon="refresh"
            @action="refresh"
          />
        </div>
        <OBanner
          v-if="summaryError && summary"
          class="mb-3"
          variant="error"
          dense
          :content="t('fleet.common.loadFailed')"
          data-test="fleet-collector-versions-distribution-stale"
        />
        <FleetVersionBars
          v-if="summary"
          :versions="summary?.versions ?? []"
          :target="summary?.target_version ?? ''"
          :outdated-versions="outdatedVersions"
        />
      </OCardSection>
    </OCard>

    <OCard
      v-if="outdated.length || listLoading || listError || listForbidden"
      ref="outdatedCard"
      variant="outlined"
      data-test="fleet-collector-versions-outdated"
    >
      <OCardSection role="header" class="justify-between">
        <div class="flex items-center gap-2">
          <OText variant="panel-title">{{ t("fleet.upgrades.outdatedTitle") }}</OText>
          <OText variant="meta" data-test="fleet-collector-versions-outdated-count">{{
            listForbidden ? DASH : outdated.length
          }}</OText>
        </div>
      </OCardSection>
      <OTable
        :data="outdated"
        :columns="columns"
        row-key="id"
        pagination="client"
        :page-size="10"
        :frame="false"
        :loading="listLoading"
        :error="listError"
        :forbidden="listForbidden"
        data-test="fleet-collector-versions-outdated-table"
      >
        <template #cell-status="{ row }">
          <OTag type="serviceStatus" :value="row.status" />
        </template>
        <template #cell-version="{ row }">
          <span class="inline-flex items-center gap-1.5 font-mono text-xs">
            {{ row.version ?? DASH }}
            <template v-if="summary?.target_version">
              <OIcon name="arrow-forward" size="xs" class="text-text-secondary" />
              {{ summary.target_version }}
            </template>
          </span>
        </template>
        <template #error>
          <div data-test="fleet-collector-versions-outdated-error">
            <OEmptyState size="block" preset="load-error" @action="refresh" />
          </div>
        </template>
      </OTable>
    </OCard>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import FleetVersionBars from "./FleetVersionBars.vue";
import {
  isForbidden,
  osLabel,
  useFleetCollectors,
  useFleetSummary,
  type CollectorRow,
} from "./useFleetApi";

const DASH = raw("—");

const { t } = useI18nTyped();

const list = useFleetCollectors();
const summaryQuery = useFleetSummary();
const summary = summaryQuery.summary;
const summaryLoading = summaryQuery.loading;
const summaryError = summaryQuery.error;
const listLoading = list.loading;
const listForbidden = computed(() => isForbidden(list.error.value));
const outdated = computed(() => list.rows.value.filter((c) => c.outdated));
// Neutral without rows to classify; a failed non-403 refresh keeps the cached flags.
const outdatedVersions = computed(() =>
  list.loading.value || listForbidden.value || (list.error.value && !list.rows.value.length)
    ? null
    : [...new Set(outdated.value.map((c) => c.version).filter((v): v is string => !!v))],
);
const listError = computed(() =>
  list.error.value && !listForbidden.value && !list.rows.value.length
    ? String(list.error.value)
    : null,
);
const refresh = () => Promise.all([list.refetch(), summaryQuery.refetch()]);

const columns = computed<OTableColumnDef<CollectorRow>[]>(() => [
  { id: "name", header: t("fleet.collectors.collector"), accessorKey: "name", size: 220 },
  { id: "status", header: t("fleet.common.status"), accessorKey: "status", size: 120 },
  {
    id: "os",
    header: t("fleet.collectors.os"),
    accessorFn: (r) => osLabel(r.os) ?? DASH,
    size: 130,
  },
  { id: "version", header: t("fleet.collectors.version"), accessorKey: "version", size: 200 },
]);

const root = ref<HTMLElement | null>(null);
const outdatedCard = ref<{ $el: HTMLElement } | null>(null);

function scrollToOutdated() {
  (outdatedCard.value?.$el ?? root.value)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

defineExpose({ refreshCollectors: () => list.refetch(), scrollToOutdated });
</script>
