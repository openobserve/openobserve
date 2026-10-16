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
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <OTable
      v-model:selected-ids="selectedIds"
      class="min-h-0 flex-1"
      :data="tableRows"
      :columns="columns"
      row-key="id"
      selection="multiple"
      :frame="false"
      pagination="client"
      :page-size="20"
      :page-size-options="[20, 50, 100]"
      :show-global-filter="false"
      :column-visibility="{ ip: false, arch: false, drift: false }"
      :persist-columns="true"
      table-id="fleet-collectors"
      :loading="loading"
      :error="loadError"
      :forbidden="noAccess"
      :row-rail-tone="railTone"
      :row-class="rowClass"
      data-test="fleet-collectors-table"
      @row-click="openCollector"
    >
      <template #subheader>
        <div class="px-page-edge border-table-row-divider border-b py-1.5">
          <OStatStrip
            :items="statusStats"
            compact
            selectable
            :selected-key="statusFilter"
            default-key="all"
            @select="onStatSelect"
          />
        </div>
      </template>

      <template #toolbar>
        <div
          class="flex w-full min-w-0 items-center gap-2 max-md:contents"
          data-drawer-anchor="fleet-collectors-toolbar"
        >
          <OButton
            variant="outline"
            size="icon-toolbar"
            icon-left="filter-list"
            class="lg:hidden"
            :aria-label="t('common.filters')"
            data-test="fleet-collectors-mobile-filters-btn"
            @click="mobileFiltersOpen = true"
          >
            <OTooltip :content="t('common.filters')" />
          </OButton>
          <div class="min-w-0 flex-1 max-md:min-w-40">
            <OSearchInput
              v-model="search"
              class="w-full"
              size="sm"
              clearable
              :placeholder="
                allFleets ? t('fleet.collectors.searchAllFleets') : t('fleet.collectors.search')
              "
              data-test="fleet-collectors-search"
            >
              <template #icon-right>
                <OToggleGroup
                  :model-value="allFleets ? 'all' : 'this'"
                  type="single"
                  class="me-1 self-center"
                  data-test="fleet-collectors-scope"
                  @update:model-value="(v) => (allFleets = v === 'all')"
                >
                  <OToggleGroupItem
                    value="this"
                    size="xs"
                    icon-left="folder-outline"
                    data-test="fleet-collectors-scope-this"
                    :title="t('fleet.collectors.searchThisFleetTitle')"
                    ><span class="max-lg:hidden">{{
                      t("fleet.collectors.searchThisFleet")
                    }}</span></OToggleGroupItem
                  >
                  <OToggleGroupItem
                    value="all"
                    size="xs"
                    icon-left="search"
                    data-test="fleet-collectors-scope-all"
                    :title="t('fleet.collectors.searchAllFleetsTitle')"
                    ><span class="max-lg:hidden">{{
                      t("fleet.collectors.allFleets")
                    }}</span></OToggleGroupItem
                  >
                </OToggleGroup>
              </template>
            </OSearchInput>
          </div>
          <OSelect
            v-model="osFilter"
            class="max-lg:hidden"
            width="sm"
            size="sm"
            clearable
            :options="osOptions"
            :placeholder="t('fleet.collectors.allOs')"
            data-test="fleet-collectors-os-filter"
          />
        </div>
      </template>

      <template #toolbar-trailing>
        <ORefreshButton
          layout="inline"
          variant="outline"
          :last-run-at="lastUpdatedAt"
          :loading="fetching"
          data-test="fleet-collectors-refresh"
          @click="refresh"
        />
      </template>

      <template #cell-name="{ row }">
        <div class="flex min-w-0 flex-col">
          <span class="truncate font-medium">{{ row.name }}</span>
          <span v-if="row.hostname" class="text-text-secondary truncate text-xs">{{
            row.hostname
          }}</span>
        </div>
      </template>

      <template #cell-status="{ row }">
        <OTag type="serviceStatus" :value="row.status" />
      </template>

      <template #cell-os="{ row }">
        <span
          v-if="row.os"
          :data-test="`fleet-collectors-os-${row.id}`"
          class="inline-flex items-center gap-1.5"
        >
          <OIcon :name="osIcon(row.os)" size="sm" class="text-text-secondary" />
          <span>{{ raw(osLabel(row.os)) }}</span>
        </span>
        <span v-else class="text-text-muted" :data-test="`fleet-collectors-os-${row.id}`">{{
          DASH
        }}</span>
      </template>

      <template #cell-version="{ row }">
        <span class="inline-flex items-center gap-1.5">
          <span v-if="row.version" class="font-mono text-xs">{{ row.version }}</span>
          <span v-else class="text-text-muted">{{ DASH }}</span>
          <OTag
            v-if="row.outdated"
            variant="warning-soft"
            size="xs"
            :label="t('fleet.collectors.outdated')"
          />
        </span>
      </template>

      <template #cell-config="{ row }">
        <span
          v-if="row.config"
          class="inline-flex min-w-0 items-center gap-1.5"
          :data-test="`fleet-collectors-config-${row.id}`"
        >
          <span class="truncate">{{ row.config }}</span>
          <span v-if="row.configVersion !== null" class="text-text-secondary text-xs">{{
            t("fleet.common.versionShort", { version: row.configVersion })
          }}</span>
          <OTag
            v-if="row.delivery && row.delivery !== 'running'"
            type="fleetDelivery"
            :value="row.delivery"
            size="xs"
          />
        </span>
        <span v-else class="text-text-muted" :data-test="`fleet-collectors-config-${row.id}`">{{
          DASH
        }}</span>
      </template>

      <template #cell-fleet="{ row }">
        <span class="truncate" :data-test="`fleet-collectors-fleet-${row.id}`">{{
          row.fleetName
        }}</span>
      </template>

      <template #cell-lastSeen="{ row }">
        <OTimeCell :value="row.lastSeen" unit="ms" mode="relative" />
      </template>

      <template #cell-drift="{ row }">
        <span :data-test="`fleet-collectors-drift-${row.id}`">
          <OTag
            v-if="row.drifted === true"
            variant="warning-soft"
            :label="t('fleet.collectors.drifted')"
          />
          <span v-else-if="row.drifted === false" class="text-text-secondary">{{
            t("fleet.collectors.inSync")
          }}</span>
          <span v-else class="text-text-muted">{{ DASH }}</span>
        </span>
      </template>

      <template #cell-ip="{ row }">
        <span v-if="row.ip">{{ row.ip }}</span>
        <span v-else class="text-text-muted">{{ DASH }}</span>
      </template>

      <template #cell-actions="{ row }">
        <ODropdown align="end">
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="more-vert"
              :aria-label="t('fleet.common.actions')"
              :data-test="`fleet-collectors-row-menu-${row.id}`"
              @click.stop
            >
              <OTooltip :content="t('fleet.common.actions')" />
            </OButton>
          </template>
          <ODropdownItem
            icon-left="drive-file-move"
            :data-test="`fleet-collectors-row-move-${row.id}`"
            @select="openMove([row])"
          >
            {{ t("fleet.collectors.moveToFleet") }}
          </ODropdownItem>
          <ODropdownItem
            icon-left="link-off"
            variant="destructive"
            :data-test="`fleet-collectors-row-unenroll-${row.id}`"
            @select="unenrollRows([row])"
          >
            {{ t("fleet.collectors.unenroll") }}
          </ODropdownItem>
        </ODropdown>
      </template>

      <template #selection-actions>
        <OButton
          variant="outline"
          size="sm"
          icon-left="drive-file-move"
          data-test="fleet-collectors-bulk-move"
          @click="openMove(selectedRows)"
        >
          {{ t("fleet.collectors.moveToFleet") }}
        </OButton>
        <OButton
          variant="outline-destructive"
          size="sm"
          icon-left="link-off"
          :loading="unenroll.isPending.value"
          data-test="fleet-collectors-bulk-unenroll"
          @click="unenrollSelected"
        >
          {{ t("fleet.collectors.unenroll") }}
        </OButton>
      </template>

      <template #empty>
        <div data-test="fleet-collectors-empty">
          <OEmptyState size="hero" preset="no-data" :filtered="isFiltered" @action="clearFilters" />
        </div>
      </template>

      <template #error>
        <div data-test="fleet-collectors-error">
          <OEmptyState size="hero" preset="load-error" @action="refresh" />
        </div>
      </template>
    </OTable>

    <ODrawer
      v-if="!isDesktop"
      v-model:open="mobileFiltersOpen"
      side="left"
      :width="80"
      :title="t('common.filters')"
      anchor='[data-drawer-anchor="fleet-collectors-toolbar"]'
      data-test="fleet-collectors-mobile-filters-drawer"
    >
      <div class="flex flex-col gap-4">
        <OSelect
          v-model="osFilter"
          size="sm"
          clearable
          :label="t('fleet.collectors.os')"
          :options="osOptions"
          :placeholder="t('fleet.collectors.allOs')"
          data-test="fleet-collectors-mobile-os-filter"
        />
      </div>
    </ODrawer>

    <MoveAcrossFolders
      v-model:open="moveOpen"
      :active-folder-id="moveSource"
      :module-id="moveIds"
      type="fleets"
      @updated="onMoved"
    />

    <FleetCollectorDrawer
      v-model:open="drawerOpen"
      :collector-id="activeId"
      :initial-tab="initialTab"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useMutation } from "@tanstack/vue-query";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef, RowRailTone } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import MoveAcrossFolders from "@/components/common/sidebar/MoveAcrossFolders.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useOrgId } from "@/composables/query/useOrgId";
import { queryClient } from "@/composables/query/queryClient";
import { unenrollCollectorsMutation } from "@/services/fleet.queries";
import { fleetKeys } from "@/services/fleet.querykeys";
import { raw, useI18nTyped } from "@/types/i18n";
import FleetCollectorDrawer from "./FleetCollectorDrawer.vue";
import { OS_LABEL, type FleetOs } from "./fleetFormat";
import {
  isForbidden,
  osLabel,
  serverMessage,
  useFleetCollectors,
  type CollectorRow,
} from "./useFleetApi";

const STATUS_FILTERS = ["offline", "degraded", "drifted", "outdated", "online"];
const DRAWER_TABS = ["overview", "health", "config", "history"];

const DASH = raw("—");

const props = defineProps<{
  fleetId: string;
  forbidden: boolean;
}>();
const allFleets = defineModel<boolean>("allFleets", { default: false });

const { t } = useI18nTyped();

const { confirm } = useConfirmDialog();
const orgId = useOrgId();
const unenroll = useMutation(() => unenrollCollectorsMutation(orgId.value));

const list = useFleetCollectors();
const rowsAll = list.rows;
const loading = list.loading;
const fetching = list.fetching;
const lastUpdatedAt = list.lastUpdatedAt;
const listForbidden = computed(() => isForbidden(list.error.value));
const noAccess = computed(() => listForbidden.value || props.forbidden);
// A failed refetch keeps the stale rows on screen.
const loadError = computed(() =>
  list.error.value && !noAccess.value && !rowsAll.value.length ? String(list.error.value) : null,
);

const search = ref("");
const statusFilter = ref<string | null>(null);
const osFilter = ref<string | null>(null);
const selectedIds = ref<string[]>([]);

const drawerOpen = ref(false);
const moveOpen = ref(false);
const moveIds = ref<string[]>([]);
const moveSource = ref("");
const mobileFiltersOpen = ref(false);
const { isDesktop } = useBreakpoint();
const activeId = ref<string | null>(null);
const initialTab = ref("overview");
const route = useRoute();

onMounted(() => {
  const { status, q } = route.query;
  if (typeof status === "string" && STATUS_FILTERS.includes(status)) statusFilter.value = status;
  if (typeof q === "string") search.value = q;
});

// Selected ids and an open collector belong to the previous org.
watch(orgId, () => {
  selectedIds.value = [];
  drawerOpen.value = false;
  moveOpen.value = false;
  mobileFiltersOpen.value = false;
});

// Watched, not read once: "View collectors" in the install dialog lands here while this view is mounted.
watch(
  () => [route.query.collector, route.query.ctab],
  ([collector, ctab]) => {
    if (typeof collector !== "string" || !collector) return;
    initialTab.value = typeof ctab === "string" && DRAWER_TABS.includes(ctab) ? ctab : "overview";
    activeId.value = collector;
    drawerOpen.value = true;
  },
  { immediate: true },
);

const isFiltered = computed(() => !!search.value || !!statusFilter.value || !!osFilter.value);

function matchesStatus(c: CollectorRow, key: string | null) {
  if (!key || key === "all") return true;
  if (key === "drifted") return c.drifted === true;
  if (key === "outdated") return c.outdated;
  return c.status === key;
}

const scopeRows = computed(() =>
  allFleets.value ? rowsAll.value : rowsAll.value.filter((c) => c.fleetId === props.fleetId),
);

const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  return scopeRows.value.filter((c) => {
    if (!matchesStatus(c, statusFilter.value)) return false;
    if (osFilter.value && c.os !== osFilter.value) return false;
    if (!q) return true;
    return [c.id, c.name, c.hostname, c.ip, c.config, c.version, c.fleetName].some(
      (s) => !!s && s.toLowerCase().includes(q),
    );
  });
});

// OTable shows its no-access state only with zero rows.
const tableRows = computed(() => (props.forbidden ? [] : rows.value));

// A hidden row must never be a bulk target.
watch(tableRows, (visible) => {
  const ids = new Set(visible.map((c) => c.id));
  if (selectedIds.value.some((id) => !ids.has(id)))
    selectedIds.value = selectedIds.value.filter((id) => ids.has(id));
});

const statusCounts = computed(() => {
  if (loading.value || noAccess.value) return null;
  const counts = { offline: 0, degraded: 0, drifted: 0, outdated: 0, online: 0, total: 0 };
  for (const c of scopeRows.value) {
    counts.total += 1;
    counts[c.status] += 1;
    if (c.drifted === true) counts.drifted += 1;
    if (c.outdated) counts.outdated += 1;
  }
  return counts;
});

const statusStats = computed<StatItem[]>(() => {
  const counts = statusCounts.value;
  const n = (key: "offline" | "degraded" | "drifted" | "outdated" | "online") =>
    counts?.[key] ?? DASH;
  const items: StatItem[] = [
    {
      key: "offline",
      label: t("fleet.stats.offline"),
      value: n("offline"),
      icon: "cloud-off",
      tone: "error",
    },
    {
      key: "degraded",
      label: t("fleet.stats.degraded"),
      value: n("degraded"),
      icon: "warning",
      tone: "warning",
    },
    {
      key: "drifted",
      label: t("fleet.stats.drifted"),
      value: n("drifted"),
      icon: "sync-problem",
      tone: "orange",
    },
    {
      key: "outdated",
      label: t("fleet.stats.outdated"),
      value: n("outdated"),
      icon: "update",
      tone: "info",
    },
    {
      key: "online",
      label: t("fleet.stats.online"),
      value: n("online"),
      icon: "check-circle",
      tone: "success",
    },
    {
      key: "all",
      label: t("fleet.stats.total"),
      value: counts?.total ?? DASH,
      icon: "dns",
      tone: "neutral",
    },
  ];
  return items.map((item) => ({ ...item, dataTest: `fleet-collectors-stat-${item.key}` }));
});

function onStatSelect(key: string) {
  statusFilter.value = key === "all" || statusFilter.value === key ? null : key;
}

const osOptions = computed(() =>
  (Object.keys(OS_LABEL) as FleetOs[]).map((os) => ({ label: raw(OS_LABEL[os]), value: os })),
);

function clearFilters() {
  search.value = "";
  statusFilter.value = null;
  osFilter.value = null;
}

const refresh = () =>
  Promise.all([
    list.refetch(),
    queryClient.refetchQueries({ queryKey: fleetKeys.fleets(orgId.value) }),
    queryClient.refetchQueries({ queryKey: fleetKeys.rollouts(orgId.value) }),
  ]);

const columns = computed<OTableColumnDef<CollectorRow>[]>(() => [
  {
    id: "name",
    header: t("fleet.collectors.collector"),
    accessorKey: "name",
    size: 220,
    sortable: true,
  },
  {
    id: "status",
    header: t("fleet.common.status"),
    accessorKey: "status",
    size: 120,
    sortable: true,
  },
  { id: "os", header: t("fleet.collectors.os"), accessorKey: "os", size: 110, hideable: true },
  { id: "arch", header: t("fleet.collectors.arch"), accessorKey: "arch", size: 90, hideable: true },
  {
    id: "version",
    header: t("fleet.collectors.version"),
    accessorKey: "version",
    size: 140,
    sortable: true,
    hideable: true,
  },
  {
    id: "config",
    header: t("fleet.common.configuration"),
    accessorKey: "config",
    size: 200,
    hideable: true,
  },
  ...(allFleets.value
    ? [
        {
          id: "fleet",
          header: t("fleet.collectors.fleet"),
          accessorKey: "fleetName" as const,
          size: 160,
          sortable: true,
          hideable: true,
        },
      ]
    : []),
  {
    id: "drift",
    header: t("fleet.collectors.drift"),
    accessorKey: "drifted",
    size: 100,
    hideable: true,
  },
  {
    id: "lastSeen",
    header: t("fleet.collectors.lastSeen"),
    accessorKey: "lastSeen",
    size: 130,
    sortable: true,
    hideable: true,
  },
  { id: "ip", header: t("fleet.collectors.ip"), accessorKey: "ip", size: 130, hideable: true },
  { id: "actions", header: raw(""), isAction: true, size: 56 },
]);

function railTone(row: CollectorRow): RowRailTone | null {
  if (row.status === "offline") return "error";
  if (row.status === "degraded") return "warning";
  return null;
}

function rowClass(row: CollectorRow) {
  return row.status === "offline" ? "!bg-status-error-bg" : "";
}

function osIcon(os: string): IconName {
  const icons: Record<string, IconName> = {
    linux: "dns",
    macos: "computer",
    windows: "window",
    kubernetes: "hub",
  };
  return icons[os] ?? "dns";
}

function openCollector(row: CollectorRow) {
  initialTab.value = "overview";
  activeId.value = row.id;
  drawerOpen.value = true;
}

const selectedRows = computed(() => {
  const ids = new Set(selectedIds.value);
  return tableRows.value.filter((c) => ids.has(c.id));
});

// A mixed selection names no source, since the shared dialog would otherwise send ?folder=default.
function openMove(targets: CollectorRow[]) {
  const sources = new Set(targets.map((c) => c.fleetId));
  moveIds.value = targets.map((c) => c.id);
  moveSource.value = sources.size === 1 ? [...sources][0] : "";
  moveOpen.value = true;
}

function onMoved() {
  selectedIds.value = [];
  moveOpen.value = false;
  queryClient.invalidateQueries({ queryKey: fleetKeys.all(orgId.value) });
}

function unenrollSelected() {
  unenrollRows(selectedRows.value);
}

async function unenrollRows(targets: CollectorRow[]) {
  if (!targets.length) return;
  const org = orgId.value;
  const ok = await confirm({
    title:
      targets.length === 1
        ? t("fleet.collectors.unenrollTitle", { name: raw(targets[0].name) })
        : t("fleet.collectors.unenrollManyTitle", { count: targets.length }),
    message: t("fleet.collectors.unenrollMessage"),
    confirmLabel: t("fleet.collectors.unenroll"),
    confirmVariant: "destructive",
    focusCancel: true,
  });
  // The rows belong to the org the confirm was opened in; the mutation follows the current one.
  if (!ok || orgId.value !== org) return;
  try {
    const { succeeded, failed, firstError } = await unenroll.mutateAsync(targets.map((c) => c.id));
    const gone = new Set(succeeded);
    selectedIds.value = selectedIds.value.filter((id) => !gone.has(id));
    toast(
      failed.length
        ? {
            variant: "warning",
            message: t("fleet.collectors.unenrollPartial", {
              done: succeeded.length,
              total: targets.length,
              reason: raw(serverMessage(firstError)) || t("fleet.common.requestFailed"),
            }),
          }
        : {
            variant: "success",
            message: t(
              "fleet.collectors.unenrolledCount",
              { count: succeeded.length },
              succeeded.length,
            ),
          },
    );
  } catch (err) {
    toast({
      variant: "error",
      message: raw(serverMessage(err)) || t("fleet.common.requestFailed"),
    });
  }
}
</script>
