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
  <div ref="root" class="flex flex-col gap-3" data-test="fleet-collector-versions">
    <OCard
      :title="t('fleet.upgrades.distribution')"
      data-test="fleet-collector-versions-distribution"
    >
      <div
        v-if="summaryLoading"
        class="flex flex-col gap-3"
        data-test="fleet-collector-versions-distribution-loading"
      >
        <OSkeleton v-for="n in 3" :key="n" shape="block" class="h-4" />
      </div>
      <div
        v-else-if="summaryError && !summary"
        data-test="fleet-collector-versions-distribution-error"
      >
        <OEmptyState
          size="compact"
          kind="error"
          :title="t('emptyState.loadError.title')"
          :text="t('emptyState.loadError.description')"
          @action="refresh"
        />
      </div>
      <OInlineNotice
        v-if="summaryError && summary"
        class="mb-3"
        tone="err"
        :message="t('fleet.common.loadFailed')"
        data-test="fleet-collector-versions-distribution-stale"
      />
      <FleetVersionBars
        v-if="summary"
        :versions="summary?.versions ?? []"
        :target="summary?.target_version ?? ''"
        :outdated-versions="outdatedVersions"
      />
    </OCard>

    <OCard
      v-if="outdated.length || listLoading || listError || listForbidden"
      ref="outdatedCard"
      flush
      data-test="fleet-collector-versions-outdated"
    >
      <template #header>
        <h3 class="text-text-heading text-compact min-w-0 truncate font-semibold">
          {{ t("fleet.upgrades.outdatedTitle") }}
        </h3>
        <span
          class="text-text-muted shrink-0 text-xs"
          data-test="fleet-collector-versions-outdated-count"
          >{{ listForbidden ? DASH : outdated.length }}</span
        >
      </template>
      <OTable
        :data="outdated"
        :columns="columns"
        row-key="id"
        pagination="client"
        :page-size="10"
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
            <OEmptyState
              kind="error"
              :title="t('emptyState.loadError.title')"
              :text="t('emptyState.loadError.description')"
              @action="refresh"
            />
          </div>
        </template>
      </OTable>
    </OCard>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
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
