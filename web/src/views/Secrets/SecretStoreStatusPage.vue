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

<!-- Root only: deployment internals no tenant admin can act on (R13-37). -->
<template>
  <OPageLayout :title="t('secrets.rootStatus.title')" icon="dns" bleed>
    <template #actions>
      <OTag
        v-if="isRoot && status"
        size="sm"
        :variant="GATE_VARIANT[status.gate]"
        icon=""
        :label="gateLabel"
        data-test="secret-store-status-gate"
      />
      <ORefreshButton
        v-if="isRoot"
        layout="inline"
        variant="outline"
        :last-run-at="statusQuery.dataUpdatedAt.value"
        :loading="statusQuery.isFetching.value"
        data-test="secret-store-status-refresh"
        @click="statusQuery.refetch()"
      />
    </template>

    <OContent class="flex flex-col gap-4 py-4">
      <OEmptyState
        v-if="!isRoot"
        size="inline"
        icon="lock"
        :title="t('secrets.rootStatus.rootOnly')"
        data-test="secret-store-status-root-only"
      />
      <OEmptyState
        v-else-if="statusQuery.isError.value"
        preset="load-error"
        size="inline"
        data-test="secret-store-status-error"
        @action="statusQuery.refetch()"
      />
      <template v-else-if="status">
        <OBanner
          v-if="behindNodes > 0"
          variant="warning"
          icon="warning"
          :content="t('secrets.rootStatus.nodesBehind', { count: behindNodes }, behindNodes)"
          data-test="secret-store-status-behind"
        />
        <dl
          class="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-6 gap-y-2 text-sm max-md:grid-cols-1"
          data-test="secret-store-status-facts"
        >
          <dt class="text-text-secondary">{{ t("secrets.rootStatus.unprefixedRows") }}</dt>
          <dd class="text-text-body">{{ status.unprefixed_cipher_rows }}</dd>
          <dt class="text-text-secondary">{{ t("secrets.rootStatus.aesencRows") }}</dt>
          <dd class="text-text-body">
            {{ t("secrets.rootStatus.aesencValue", { count: status.aesenc_system_rows }) }}
          </dd>
          <dt class="text-text-secondary">{{ t("secrets.rootStatus.wrapFloor") }}</dt>
          <dd class="font-mono">{{ status.wrap_floor || "—" }}</dd>
          <dt class="text-text-secondary">{{ t("secrets.rootStatus.wrapMigration") }}</dt>
          <dd class="text-text-body">{{ t("secrets.rootStatus.wrapSteps") }}</dd>
        </dl>
      </template>
    </OContent>

    <div v-if="isRoot" class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
      <OTable
        :frame="false"
        :data="status?.nodes ?? []"
        :columns="columns"
        row-key="node"
        :loading="statusQuery.isPending.value"
        pagination="none"
        :default-columns="false"
        :show-global-filter="false"
        data-test="secret-store-status-nodes"
      >
        <template #cell-node="{ row }">
          <span class="font-mono">{{ row.node }}</span>
        </template>
        <template #cell-refs_enabled="{ row }">
          <OTag
            size="xs"
            :variant="row.refs_enabled ? 'success-soft' : 'warning-soft'"
            icon=""
            :label="row.refs_enabled ? t('secrets.rootStatus.yes') : t('secrets.rootStatus.no')"
          />
        </template>
        <template #cell-fga_mode="{ row }">
          <span class="font-mono">{{ row.fga_mode }}</span>
        </template>
      </OTable>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useOrgRole } from "@/composables/useOrgRole";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { MetaStoreStatus } from "@/services/secrets";
import { secretMetaStatusQuery } from "@/services/secrets.queries";

const { t } = useI18nTyped();

const { isRoot } = useOrgRole();
const statusQuery = useQuery(() =>
  Object.assign(secretMetaStatusQuery(), { enabled: isRoot.value }),
);
const status = computed(() => statusQuery.data.value);

const GATE_VARIANT: Record<MetaStoreStatus["gate"], BadgeVariant> = {
  closed: "error-soft",
  writable: "warning-soft",
  latched: "success-soft",
};
const GATE_KEYS = {
  closed: "secrets.rootStatus.gateClosed",
  writable: "secrets.rootStatus.gateWritable",
  latched: "secrets.rootStatus.gateLatched",
} as const;
const gateLabel = computed((): I18nText | undefined =>
  status.value ? t(GATE_KEYS[status.value.gate]) : undefined,
);

const behindNodes = computed(
  () => (status.value?.nodes ?? []).filter((n) => n.level < 1 || !n.refs_enabled).length,
);

const columns: OTableColumnDef[] = [
  {
    id: "node",
    header: t("secrets.rootStatus.node"),
    accessorKey: "node",
    size: 240,
    meta: { flex: true },
  },
  { id: "level", header: t("secrets.rootStatus.level"), accessorKey: "level", size: 100 },
  { id: "refs_enabled", header: t("secrets.rootStatus.refsEnabled"), size: 140 },
  { id: "fga_mode", header: t("secrets.rootStatus.fgaMode"), size: 140 },
];
</script>
