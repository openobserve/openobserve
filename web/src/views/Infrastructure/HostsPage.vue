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

<!--
  HostsPage — the Infra → Hosts fleet list (design 4.8). Filter/facet/sort/page
  state rides URL query params: flat routes get no keep-alive under
  MainLayout's bare router-view, so the page must survive remounts.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef, OTableSortParams } from "@/lib/core/Table/OTable.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";
import DateTime from "@/components/DateTime.vue";
import DataSourceSetupCard from "@/components/ingestion/setupCard/DataSourceSetupCard.vue";
import HostDetailDrawer from "./HostDetailDrawer.vue";
import { useHostsList, utilizationTint, type HostRow } from "./useHostsList";
import { HOSTS_DEFAULT_RELATIVE_PERIOD, HOSTS_DEFAULT_WINDOW_US } from "./hostsQueries";
import { useWorkloadDetection } from "@/composables/useWorkloadDetection";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";

const store = useStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18nTyped();

const detection = useWorkloadDetection();
const list = useHostsList();
const {
  filteredRows,
  pagedRows,
  facets,
  fleetCount,
  banners,
  pageError,
  nameFilter,
  statusFilter,
  osFilter,
  sortBy,
  sortDesc,
  page,
} = list;

const hostsState = computed(() => detection.states.value.hosts);
const loading = ref(false);

const nowUs = () => Date.now() * 1000;
const range = ref({ start: nowUs() - HOSTS_DEFAULT_WINDOW_US, end: nowUs() });

const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

const refreshList = async () => {
  loading.value = true;
  try {
    await list.refresh({ orgId: orgId.value, start: range.value.start, end: range.value.end });
  } finally {
    loading.value = false;
  }
};

const onDateChange = (date: { startTime: number; endTime: number; userChangedValue?: boolean }) => {
  range.value = { start: date.startTime, end: date.endTime };
  // DateTime replays on mount with userChangedValue:false — "do not fetch" (DateTime.vue contract).
  if (date.userChangedValue === false) return;
  if (hostsState.value !== "detected") return;
  refreshList();
};

// ── URL-carried state (design 4.7: flat routes remount, params persist) ─────
const first = (v: unknown): string | undefined => {
  const flat = [v].flat();
  return flat[0] != null ? String(flat[0]) : undefined;
};

const restoreFromQuery = () => {
  const q = route.query;
  if (first(q.name)) nameFilter.value = first(q.name)!;
  if (q.status) statusFilter.value = [q.status].flat().map(String);
  if (q.os) osFilter.value = [q.os].flat().map(String);
  const pageParam = Number(first(q.page));
  if (Number.isFinite(pageParam) && pageParam > 1) page.value = pageParam;
  if (first(q.sort)) sortBy.value = first(q.sort)!;
  if (first(q.desc)) sortDesc.value = first(q.desc) !== "false";
};

const syncQuery = () => {
  const q: Record<string, any> = { ...route.query };
  const put = (key: string, value: any, isDefault: boolean) => {
    if (isDefault) delete q[key];
    else q[key] = value;
  };
  put("name", nameFilter.value, !nameFilter.value);
  put("status", statusFilter.value, statusFilter.value.length === 0);
  put("os", osFilter.value, osFilter.value.length === 0);
  put("page", String(page.value), page.value <= 1);
  const defaultSort = sortBy.value === "cpu" && sortDesc.value;
  put("sort", sortBy.value, defaultSort);
  put("desc", String(sortDesc.value), defaultSort);
  router.replace({ query: q });
};

// Suppressed during the org-switch reset so state watchers don't re-add stale params.
let suppressQuerySync = false;
watch(
  [nameFilter, statusFilter, osFilter, page, sortBy, sortDesc],
  ([name, status, os, pg], [oldName, oldStatus, oldOs, oldPg]) => {
    if (suppressQuerySync) return;
    const filterChanged = name !== oldName || status !== oldStatus || os !== oldOs;
    // A filter change invalidates the page; a same-tick page write (URL restore) wins.
    if (filterChanged && pg === oldPg && pg !== 1) {
      page.value = 1;
      return;
    }
    syncQuery();
  },
);

// ── Org switching — flat routes get no remount for free (design 4.8) ────────
watch(
  () => store.state.selectedOrganization?.identifier,
  async (next, prev) => {
    if (!next || next === prev) return;
    suppressQuerySync = true;
    nameFilter.value = "";
    statusFilter.value = [];
    osFilter.value = [];
    page.value = 1;
    sortBy.value = "cpu";
    sortDesc.value = true;
    const q: Record<string, any> = { ...route.query };
    for (const key of ["host", "name", "status", "os", "page", "sort", "desc"]) delete q[key];
    await router.replace({ query: q });
    suppressQuerySync = false;
    // The new org's fan-out only runs once detection confirms host streams exist there.
    await detection.refresh();
    if (hostsState.value === "detected") refreshList();
  },
);

// Empty→live flip: the list loads the moment detection turns detected.
watch(hostsState, (state, prev) => {
  if (state === "detected" && prev !== "detected") refreshList();
});

onMounted(() => {
  restoreFromQuery();
  detection.refresh();
  if (hostsState.value === "detected") refreshList();
});

// ── Drawer — deep-linked via ?host= so it survives reload ───────────────────
const drawerHost = computed(() => first(route.query.host) ?? "");
const drawerStatus = computed(
  () => list.rows.value.find((r) => r.host_name === drawerHost.value)?.status ?? "UNKNOWN",
);
const drawerOs = computed(
  () => list.rows.value.find((r) => r.host_name === drawerHost.value)?.os_type ?? null,
);
// The row's OWN last-seen: stream stats are fleet-wide, so a dead host behind a
// live fleet would leave the drawer's panels un-badged (§5.3, §7.3).
const drawerLastSeenUs = computed(
  () => list.rows.value.find((r) => r.host_name === drawerHost.value)?.lastSeenUs ?? null,
);
const openDrawer = (host: string) => {
  router.replace({ query: { ...route.query, host } });
};
const closeDrawer = () => {
  const q: Record<string, any> = { ...route.query };
  delete q.host;
  router.replace({ query: q });
};

// ── Facets ───────────────────────────────────────────────────────────────────
const toggleStatus = (value: string) => {
  statusFilter.value = statusFilter.value.includes(value)
    ? statusFilter.value.filter((v) => v !== value)
    : [...statusFilter.value, value];
};
const toggleOs = (value: string) => {
  osFilter.value = osFilter.value.includes(value)
    ? osFilter.value.filter((v) => v !== value)
    : [...osFilter.value, value];
};

const statusLabel = (status: string) =>
  status === "ACTIVE"
    ? t("infra.hosts.statusActive")
    : status === "INACTIVE"
      ? t("infra.hosts.statusInactive")
      : t("infra.hosts.statusUnknown");

// ── Table ─────────────────────────────────────────────────────────────────────
const columns = computed<OTableColumnDef<HostRow>[]>(() => [
  { id: "host", header: t("infra.hosts.columnHost"), accessorKey: "host_name", sortable: true },
  { id: "os", header: t("infra.hosts.columnOs"), accessorKey: "os_type", size: 96, sortable: true },
  {
    id: "status",
    header: t("infra.hosts.columnStatus"),
    accessorKey: "status",
    size: 110,
    sortable: true,
  },
  // Wider than a bare "100%" — the utilization bar shares the cell with the number.
  {
    id: "cpu",
    header: t("infra.hosts.columnCpu"),
    accessorKey: "cpu",
    size: 150,
    minSize: 110,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "memory",
    header: t("infra.hosts.columnMemory"),
    accessorKey: "memoryPct",
    size: 150,
    minSize: 110,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "disk",
    header: t("infra.hosts.columnDisk"),
    accessorKey: "disk",
    size: 150,
    minSize: 110,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "load",
    header: t("infra.hosts.columnLoad"),
    accessorKey: "load",
    size: 96,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "lastSeen",
    header: t("infra.hosts.columnLastSeen"),
    accessorKey: "lastSeen",
    size: 170,
    sortable: true,
  },
]);

const SORT_FIELD_BY_COLUMN: Record<string, string> = {
  host: "host_name",
  os: "os_type",
  status: "status",
  cpu: "cpu",
  memory: "memoryPct",
  disk: "disk",
  load: "load",
  lastSeen: "lastSeen",
};

const onSortChange = (params: OTableSortParams) => {
  sortBy.value = SORT_FIELD_BY_COLUMN[params.column] ?? params.column;
  sortDesc.value = params.order === "desc";
};

const sortColumnId = computed(
  () =>
    Object.entries(SORT_FIELD_BY_COLUMN).find(([, field]) => field === sortBy.value)?.[0] ?? "cpu",
);

const tintClass = (value: number | null) => {
  const tint = utilizationTint(value);
  return tint === "critical" ? "text-error font-medium" : tint === "warn" ? "text-warning" : "";
};

// Bar tone reads the same utilizationTint as the number, so the two can never disagree.
const tintVariant = (value: number | null): ProgressBarVariant => {
  const tint = utilizationTint(value);
  return tint === "critical" ? "danger" : tint === "warn" ? "warning" : "default";
};

const barValue = (value: number | null) => (value == null ? 0 : value / 100);

const pct = (value: number | null) => (value == null ? raw("—") : raw(`${Math.round(value)}%`));
const num = (value: number | null) => (value == null ? raw("—") : raw(value.toFixed(2)));

// The shared dashboard byte scaler, so a 900MB container and a 512GB host both read correctly.
const bytes = (value: number) => formatUnitValue(getUnitValue(value, "bytes", "", 1));

// Either byte value missing means no absolutes — the percentage already carries the em-dash.
const memoryAbsolute = (row: HostRow) =>
  row.memoryUsedBytes != null && row.memoryTotalBytes != null
    ? t("infra.hosts.memoryAbsolute", {
        used: bytes(row.memoryUsedBytes),
        total: bytes(row.memoryTotalBytes),
      })
    : undefined;

// ── Empty-state onboarding (design 4.8: empty-state-as-onboarding) ──────────
const OS_SLUGS = ["linux", "windows", "macos"] as const;
const osSlug = ref<(typeof OS_SLUGS)[number]>("linux");
const osToggleLabel = (slug: string) =>
  slug === "linux" ? raw("Linux") : slug === "windows" ? raw("Windows") : raw("macOS");
</script>

<template>
  <OPageLayout :title="t('menu.hosts')" icon="dns" bleed>
    <template #actions>
      <div class="flex items-center gap-2">
        <OText v-if="hostsState === 'detected'" variant="meta" data-test="hosts-fleet-count">
          {{
            t(
              "infra.hosts.fleetCount",
              { total: fleetCount.total, active: fleetCount.active },
              fleetCount.total,
            )
          }}
        </OText>
        <DateTime
          auto-apply
          menu-align="end"
          default-type="relative"
          :default-relative-time="HOSTS_DEFAULT_RELATIVE_PERIOD"
          data-test-name="hosts-date-time"
          @on:date-change="onDateChange"
        />
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="refresh"
          data-test="hosts-refresh"
          :loading="loading"
          @click="refreshList"
        >
          {{ t("infra.hosts.refresh") }}
        </OButton>
      </div>
    </template>

    <!-- Detection unresolved: a spinner, never a false "set up" flash. -->
    <div v-if="hostsState === 'unknown'" class="flex min-h-60 items-center justify-center">
      <OSpinner size="lg" />
    </div>

    <!-- Undetected: onboarding, not a dead end — the embedded card carries the auto-import wiring. -->
    <div
      v-else-if="hostsState !== 'detected'"
      class="mx-auto flex max-w-3xl flex-col gap-3 py-6"
      data-test="hosts-empty-state"
    >
      <OText tag="h2" class="text-xl font-semibold">{{ t("infra.hosts.emptyHeadline") }}</OText>
      <OText variant="meta">{{ t("infra.hosts.emptyRbacHint") }}</OText>
      <div class="flex items-center gap-2 pt-2">
        <OButton
          v-for="slug in OS_SLUGS"
          :key="slug"
          :variant="osSlug === slug ? 'primary' : 'outline'"
          size="sm-action"
          :data-test="`hosts-os-toggle-${slug}`"
          @click="osSlug = slug"
        >
          {{ osToggleLabel(slug) }}
        </OButton>
      </div>
      <!-- Detection connecting inside the embedded card must flip this page live (design 4.8). -->
      <DataSourceSetupCard :slug="osSlug" @detected="detection.refresh({ force: true })" />
    </div>

    <!-- Total failure: ONE page-level surface, never stacked column warnings. -->
    <div
      v-else-if="pageError"
      class="flex min-h-60 flex-col items-center justify-center gap-2"
      data-test="hosts-page-error"
    >
      <OText class="text-lg font-semibold">{{ t("infra.hosts.pageError") }}</OText>
      <OText variant="meta">{{ raw(pageError) }}</OText>
      <OButton variant="outline" size="sm-action" data-test="hosts-retry" @click="refreshList">
        {{ t("infra.hosts.retry") }}
      </OButton>
    </div>

    <div v-else class="flex h-full min-h-0 flex-col gap-2">
      <div
        v-if="banners.liveness"
        class="border-border-default bg-surface-base rounded-default flex items-center justify-between gap-2 border px-3 py-2"
        data-test="hosts-liveness-banner"
      >
        <OText variant="meta">{{ t("infra.hosts.livenessBanner") }}</OText>
        <OButton variant="outline" size="sm-action" data-test="hosts-retry" @click="refreshList">
          {{ t("infra.hosts.retry") }}
        </OButton>
      </div>
      <div
        v-if="banners.lastSeen"
        class="border-border-default bg-surface-base rounded-default flex items-center gap-2 border px-3 py-2"
        data-test="hosts-lastseen-banner"
      >
        <OText variant="meta">{{ t("infra.hosts.lastSeenBanner") }}</OText>
      </div>

      <div class="flex min-h-0 flex-1 gap-4">
        <!-- Facet rail — fixed order; UNKNOWN appends last only when present. -->
        <div class="w-rail flex shrink-0 flex-col gap-3 overflow-y-auto px-2">
          <OSearchInput
            v-model="nameFilter"
            :placeholder="t('infra.hosts.filterPlaceholder')"
            data-test="hosts-name-filter"
          />
          <section class="flex flex-col gap-1">
            <OText variant="label" class="px-2 font-semibold">{{
              t("infra.hosts.statusFacet")
            }}</OText>
            <div
              v-for="facet in facets.status"
              :key="facet.value"
              :data-test="`hosts-facet-status-${facet.value}`"
              class="rounded-default hover:bg-surface-subtle flex items-center justify-between gap-2 px-2 py-1"
              :class="statusFilter.includes(facet.value) ? 'bg-surface-subtle' : ''"
            >
              <OCheckbox
                :model-value="statusFilter.includes(facet.value)"
                size="sm"
                class="min-w-0 flex-1"
                @update:model-value="toggleStatus(facet.value)"
              >
                <template #label>
                  <span class="truncate text-xs">{{ statusLabel(facet.value) }}</span>
                </template>
              </OCheckbox>
              <OTag type="countChip" value="neutral" size="xs" shape="rounded">{{
                facet.count
              }}</OTag>
            </div>
          </section>
          <section v-if="facets.os.length" class="flex flex-col gap-1">
            <OText variant="label" class="px-2 font-semibold">{{ t("infra.hosts.osFacet") }}</OText>
            <div
              v-for="facet in facets.os"
              :key="facet.value"
              :data-test="`hosts-facet-os-${facet.value}`"
              class="rounded-default hover:bg-surface-subtle flex items-center justify-between gap-2 px-2 py-1"
              :class="osFilter.includes(facet.value) ? 'bg-surface-subtle' : ''"
            >
              <OCheckbox
                :model-value="osFilter.includes(facet.value)"
                size="sm"
                class="min-w-0 flex-1"
                @update:model-value="toggleOs(facet.value)"
              >
                <template #label>
                  <span class="truncate text-xs" :title="raw(facet.value)">{{
                    raw(facet.value)
                  }}</span>
                </template>
              </OCheckbox>
              <OTag type="countChip" value="neutral" size="xs" shape="rounded">{{
                facet.count
              }}</OTag>
            </div>
          </section>
          <OText variant="meta" class="px-2 pb-2">{{ t("infra.hosts.rangeNote") }}</OText>
        </div>

        <div class="min-h-0 flex-1">
          <OTable
            :data="pagedRows"
            :columns="columns"
            :loading="loading"
            row-key="host_name"
            sorting="server"
            :sort-by="sortColumnId"
            :sort-order="sortDesc ? 'desc' : 'asc'"
            pagination="server"
            :page-size="50"
            :current-page="page"
            :total-count="filteredRows.length"
            :show-global-filter="false"
            @sort-change="onSortChange"
            @pagination-change="(p) => (page = p.page)"
          >
            <template #cell-host="{ row }">
              <OButton
                variant="ghost-primary"
                size="xs"
                :data-test="`hosts-row-${row.host_name}`"
                @click="openDrawer(row.host_name)"
              >
                {{ raw(row.host_name) }}
              </OButton>
            </template>
            <template #cell-os="{ row }">
              <span>{{ raw(row.os_type ?? "—") }}</span>
            </template>
            <template #cell-status="{ row }">
              <OTag
                :variant="
                  row.status === 'ACTIVE'
                    ? 'success-soft'
                    : row.status === 'INACTIVE'
                      ? 'default-soft'
                      : 'amber-soft'
                "
                size="xs"
                >{{ statusLabel(row.status) }}</OTag
              >
            </template>
            <template #cell-cpu="{ row }">
              <div
                class="flex w-full min-w-0 items-center justify-end gap-2"
                :data-test="`hosts-cell-cpu-${row.host_name}`"
                :data-tint="utilizationTint(row.cpu)"
              >
                <OProgressBar
                  v-if="row.cpu != null"
                  size="xs"
                  class="min-w-0 flex-1"
                  :value="barValue(row.cpu)"
                  :variant="tintVariant(row.cpu)"
                  :data-test="`hosts-bar-cpu-${row.host_name}`"
                />
                <span class="shrink-0 tabular-nums" :class="tintClass(row.cpu)">{{
                  pct(row.cpu)
                }}</span>
              </div>
            </template>
            <template #cell-memory="{ row }">
              <div
                class="flex w-full min-w-0 flex-col items-end"
                :data-test="`hosts-cell-memory-${row.host_name}`"
                :data-tint="utilizationTint(row.memoryPct)"
              >
                <div class="flex w-full min-w-0 items-center justify-end gap-2">
                  <OProgressBar
                    v-if="row.memoryPct != null"
                    size="xs"
                    class="min-w-0 flex-1"
                    :value="barValue(row.memoryPct)"
                    :variant="tintVariant(row.memoryPct)"
                    :data-test="`hosts-bar-memory-${row.host_name}`"
                  />
                  <span class="shrink-0 tabular-nums" :class="tintClass(row.memoryPct)">{{
                    pct(row.memoryPct)
                  }}</span>
                </div>
                <OText
                  v-if="memoryAbsolute(row)"
                  variant="meta"
                  class="text-2xs tabular-nums"
                  :data-test="`hosts-memory-absolute-${row.host_name}`"
                  >{{ memoryAbsolute(row) }}</OText
                >
              </div>
            </template>
            <template #cell-disk="{ row }">
              <div
                class="flex w-full min-w-0 items-center justify-end gap-2"
                :data-test="`hosts-cell-disk-${row.host_name}`"
                :data-tint="utilizationTint(row.disk)"
              >
                <OProgressBar
                  v-if="row.disk != null"
                  size="xs"
                  class="min-w-0 flex-1"
                  :value="barValue(row.disk)"
                  :variant="tintVariant(row.disk)"
                  :data-test="`hosts-bar-disk-${row.host_name}`"
                />
                <span class="shrink-0 tabular-nums" :class="tintClass(row.disk)">{{
                  pct(row.disk)
                }}</span>
              </div>
            </template>
            <template #cell-load="{ row }">
              <span>{{ num(row.load) }}</span>
            </template>
            <template #cell-lastSeen="{ row }">
              <span>{{ raw(row.lastSeen ?? "—") }}</span>
            </template>
          </OTable>
        </div>
      </div>
    </div>

    <HostDetailDrawer
      v-if="drawerHost"
      :host-name="drawerHost"
      :status="drawerStatus"
      :os-type="drawerOs"
      :last-seen-us="drawerLastSeenUs"
      :range="{ from: range.start, to: range.end }"
      @close="closeDrawer"
    />
  </OPageLayout>
</template>
