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
  <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <OTable
      :data="filteredLocations"
      :columns="columns"
      row-key="id"
      :loading="loading"
      pagination="client"
      :page-size="20"
      :page-size-options="[10, 20, 50]"
      :show-global-filter="false"
      :persist-columns="true"
      table-id="synthetics-private-locations-table"
      :enable-column-resize="true"
      data-test="synthetics-private-locations-table"
      @row-click="openDetail"
    >
      <template #toolbar>
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <div class="min-w-0 flex-1">
            <OInput
              v-model="search"
              :placeholder="t('synthetics.privateLocations.searchPlaceholder')"
              class="w-full"
              data-test="synthetics-private-locations-search-input"
            />
          </div>
        </div>
      </template>

      <template #toolbar-trailing>
        <OButton
          variant="outline"
          size="icon-sm"
          class="w-8!"
          icon-left="refresh"
          :loading="loading"
          :title="t('common.refresh')"
          data-test="synthetics-private-locations-refresh-btn"
          @click="emit('refresh')"
        />
      </template>

      <!-- Status — "unknown" is not a state of the location, it is the limit of
           what this region can see, so it carries the explanation with it. -->
      <template #cell-status="{ row }">
        <OTooltip
          v-if="liveStatus(row as SyntheticLocation) === 'unknown'"
          :content="t('synthetics.privateLocations.status.unknownHint')"
        >
          <OBadge variant="default-outline" :dot="true" size="sm">
            {{ t("synthetics.privateLocations.status.unknown") }}
          </OBadge>
        </OTooltip>
        <OBadge v-else :variant="statusVariant((row as any).status)" :dot="true" size="sm">
          {{ t(`synthetics.privateLocations.status.${(row as any).status}`) }}
        </OBadge>
      </template>

      <!-- Label + pool subtext -->
      <template #cell-name="{ row }">
        <div class="flex min-w-0 flex-col">
          <span class="truncate font-medium">{{ (row as any).label }}</span>
          <span class="text-text-muted truncate text-xs">{{ (row as any).pool }}</span>
        </div>
      </template>

      <!-- Agents: live/total count (a location is a pool of interchangeable
           agents). Names/health are on the detail page; shown here on hover. -->
      <template #cell-agents="{ row }">
        <div class="flex min-w-0 flex-col" :title="agentSubtext(row as any) || ''">
          <!-- 0/0 would read as "no agents installed"; this region simply has
               no count to give. -->
          <span v-if="liveStatus(row as SyntheticLocation) === 'unknown'" class="text-text-muted"
            >—</span
          >
          <span v-else class="truncate"
            >{{ (row as any).live_agents ?? 0
            }}<span class="text-text-muted">/{{ (row as any).agents_total ?? 0 }}</span></span
          >
          <span v-if="(row as any).version" class="text-text-muted truncate text-xs"
            >{{ t("synthetics.versionPrefix") }}{{ (row as any).version }}</span
          >
        </div>
      </template>

      <!-- Checks per minute -->
      <template #cell-cmin="{ row }">
        <span v-if="(row as any).checks_per_min != null">~{{ (row as any).checks_per_min }}</span>
        <span v-else class="text-text-muted">—</span>
      </template>

      <!-- Capability type chips -->
      <template #cell-types="{ row }">
        <div class="flex flex-wrap gap-1">
          <OTag
            v-for="ty in (row as any).types"
            :key="ty"
            size="xs"
            shape="rounded"
            variant="default-soft"
          >
            {{ String(ty).toUpperCase() }}
          </OTag>
          <span v-if="!(row as any).types?.length" class="text-text-muted">—</span>
        </div>
      </template>

      <!-- Last seen -->
      <template #cell-lastSeen="{ row }">
        <span v-if="(row as any).last_seen_at">{{
          formatTimeAgoUs((row as any).last_seen_at)
        }}</span>
        <span v-else class="text-text-muted">—</span>
      </template>

      <!-- Row actions -->
      <template #cell-actions="{ row }">
        <div class="flex items-center gap-1" @click.stop>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="content-copy"
            :title="t('synthetics.privateLocations.copySetupCmd')"
            :data-test="`synthetics-private-locations-copy-btn-${(row as any).id}`"
            @click="emit('copy-setup', row as any)"
          />
          <OButton
            variant="ghost-destructive"
            size="icon-sm"
            icon-left="delete"
            :disabled="checksUsing(row) > 0"
            :title="
              checksUsing(row) > 0
                ? t('synthetics.privateLocations.deleteBlocked', {
                    count: checksUsing(row),
                  })
                : t('synthetics.table.delete')
            "
            :data-test="`synthetics-private-locations-delete-btn-${(row as any).id}`"
            @click="emit('delete', row as any)"
          />
        </div>
      </template>

      <template #empty>
        <OEmptyState
          v-if="!loading"
          size="hero"
          illustration="browser-check"
          :filtered="!!search"
          :title="t('synthetics.privateLocations.empty.title')"
          :description="t('synthetics.privateLocations.empty.description')"
          data-test="synthetics-private-locations-empty-state"
        />
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { SyntheticLocation } from "@/types/synthetics";
import { formatTimeAgoUs } from "@/utils/synthetics/format";
import { locationLiveStatus as liveStatus } from "@/utils/synthetics/locationLiveStatus";
import { syntheticsPrivateLocationRoute } from "@/utils/synthetics/routes";

const props = defineProps<{
  locations: SyntheticLocation[];
  loading: boolean;
}>();
const emit = defineEmits<{
  (e: "refresh"): void;
  (e: "copy-setup", row: SyntheticLocation): void;
  (e: "delete", row: SyntheticLocation): void;
}>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const search = ref("");

const filteredLocations = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.locations;
  return props.locations.filter(
    (l) =>
      l.label.toLowerCase().includes(q) ||
      l.region.toLowerCase().includes(q) ||
      l.pool.toLowerCase().includes(q),
  );
});

/**
 * How many checks reference this location — the delete guard.
 *
 * The API field was renamed `monitors_count` -> `checks_count`; both are read so
 * a bundle and a server on opposite sides of that rename still guard correctly.
 *
 * Falls back to 1, not 0, when neither field is present. This gate exists to stop
 * deleting a location that checks still point at, so an unknown count must block
 * the delete rather than allow it — reading a renamed field as `undefined` is
 * exactly how it silently stopped guarding.
 */
const checksUsing = (row: unknown): number => {
  const r = row as { checks_count?: number; monitors_count?: number };
  return r.checks_count ?? r.monitors_count ?? 1;
};

const statusVariant = (status: string) =>
  status === "online" ? "success" : status === "offline" ? "error" : "default";

/** Live agent name(s), shown on hover over the agent-count cell. Full agent
 *  detail (incl. offline agents) lives on the location detail page. */
const agentSubtext = (row: SyntheticLocation) =>
  row.agent_names?.length ? row.agent_names.join(", ") : null;

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "status",
    header: t("synthetics.table.status"),
    accessorKey: "status",
    size: 110,
    minSize: 90,
    sortable: true,
  },
  {
    id: "name",
    header: t("synthetics.privateLocations.table.name"),
    accessorKey: "label",
    size: 220,
    minSize: 140,
    sortable: true,
    meta: { isName: true, flex: true },
  },
  {
    id: "region",
    header: t("synthetics.privateLocations.table.region"),
    accessorKey: "region",
    size: 120,
    minSize: 90,
    sortable: true,
    hideable: true,
  },
  {
    id: "agents",
    header: t("synthetics.privateLocations.table.agents"),
    accessorKey: "live_agents",
    size: 100,
    minSize: 80,
    sortable: true,
  },
  {
    id: "types",
    header: t("synthetics.privateLocations.table.types"),
    accessorKey: "types",
    size: 200,
    minSize: 120,
    sortable: false,
    hideable: true,
  },
  {
    id: "monitors",
    header: t("synthetics.privateLocations.table.checks"),
    accessorKey: "checks_count",
    size: 90,
    minSize: 70,
    sortable: true,
    meta: { align: "right" },
    hideable: true,
  },
  {
    id: "cmin",
    header: t("synthetics.privateLocations.table.checksPerMin"),
    accessorKey: "checks_per_min",
    size: 90,
    minSize: 70,
    sortable: true,
    meta: { align: "right" },
    hideable: true,
  },
  {
    id: "lastSeen",
    header: t("synthetics.privateLocations.table.lastSeen"),
    accessorKey: "last_seen_at",
    size: 110,
    minSize: 90,
    sortable: true,
    hideable: true,
  },
  {
    id: "actions",
    header: raw(""),
    accessorKey: "id",
    size: 90,
    minSize: 90,
    sortable: false,
    isAction: true,
  },
]);

const openDetail = (row: SyntheticLocation) => {
  router.push(
    syntheticsPrivateLocationRoute(
      { orgIdentifier: store.state.selectedOrganization?.identifier },
      row.id,
    ),
  );
};
</script>
