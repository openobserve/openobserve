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
  <ODrawer data-test="scheduled-dashboards-drawer"
    bleed
    :open="open"
    :width="60"
    :title="t('dashboard.scheduledDashboards')"
    @update:open="emit('update:open', $event)"
  >
    <template #header-right>
      <div class="flex items-center justify-end gap-2">
        <div class="app-tabs-container h-9">
          <AppTabs
            class="tabs-selection-container"
            :tabs="scheduledReportTypeTabs"
            v-model:active-tab="scheduledActiveTab"
          />
        </div>

        <OSearchInput
          data-test="alert-list-search-input"
          v-model="scheduledFilterQuery"
          :placeholder="t('reports.search')"
        />

        <OButton
          variant="primary"
          size="sm"
          data-test="alert-list-add-alert-btn"
          @click="createScheduledReport"
        >{{ t("dashboard.newReport") }}</OButton
        >
      </div>
    </template>

    <div
      data-test="scheduled-dashboards-container"
      class="scheduled-dashboards h-fit"
    >
    <OTable class="w-full"
      data-test="scheduled-dashboard-table"
      :data="displayReports"
      :columns="columns"
      row-key="id"
      pagination="client"
      :page-size="selectedPerPage"
      :page-size-options="perPageOptionsList"
      :show-global-filter="false"
      :default-columns="false"
      show-index
      :loading="loading"
    >
      <template #cell-name="{ row }">
        <span class="cursor-pointer" @click="openReport(row)">{{ row.name }}</span>
      </template>

      <template #cell-tab="{ row }">
        <span class="cursor-pointer" @click="openReport(row)">{{ row.tab }}</span>
      </template>

      <template #cell-time_range="{ row }">
        <span class="cursor-pointer" @click="openReport(row)">{{ row.time_range }}</span>
      </template>

      <template #cell-frequency="{ row }">
        <span class="cursor-pointer" @click="openReport(row)">{{ row.frequency }}</span>
      </template>

      <template #cell-last_triggered_at="{ row }">
        <span class="cursor-pointer" @click="openReport(row)">
          <OTimeCell
            :value="row.last_triggered_at_raw"
            unit="us"
            mode="absolute"
            :timezone="store.state.timezone"
            :empty-label="t('dashboard.scheduledDashboardsPage.never')"
          />
        </span>
      </template>

      <template #cell-created_at="{ row }">
        <span class="cursor-pointer" @click="openReport(row)">
          <OTimeCell
            :value="row.created_at_raw"
            unit="us"
            :timezone="store.state.timezone"
          />
        </span>
      </template>

      <template #empty>
        <NoData
          :filtered="!!scheduledFilterQuery"
          @action="scheduledFilterQuery = ''"
        />
      </template>
    </OTable>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { ScheduledDashboardReport } from "@/ts/interfaces/report";
import NoData from "@/components/shared/grid/NoData.vue";
import { convertUnixToDateFormat } from "@/utils/date";
import { useStore } from "vuex";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  reports: {
    type: Array,
    required: true,
  },
  loading: {
    type: Boolean,
    required: true,
  },
  folderId: {
    type: String,
    required: true,
  },
  dashboardId: {
    type: String,
    required: true,
  },
  tabId: {
    type: String,
    required: true,
  },
  tabs: {
    type: Array,
    required: true,
  },
});

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const { t } = useI18n();

const router = useRouter();

const scheduledFilterQuery = ref("");
const scheduledActiveTab = ref("cached");
const scheduledReportTypeTabs = reactive([
  { label: t("reports.cached"), value: "cached", icon: "database" },
  { label: t("reports.scheduled"), value: "shared", icon: "schedule" },
]);

const createScheduledReport = () => {
  router.push({
    name: "createReport",
    query: {
      folderId: props.folderId,
      dashboardId: props.dashboardId,
      tabId: props.tabId,
      type: "cached",
    },
  });
};

// Row shape for the list: adds the raw sort keys not on the shared interface.
// "#" is provided by OTable's show-index, so rows built here omit it.
type ScheduledReportRow = Omit<ScheduledDashboardReport, "#"> & {
  last_triggered_at_raw: number | null;
  created_at_raw: number | null;
};

const scheduledReports = ref<ScheduledReportRow[]>(
  props.reports as ScheduledReportRow[],
);

const formattedReports = ref<ScheduledReportRow[]>([]);

const store = useStore();

watch(
  () => props.reports,
  () => {
    formatReports();
  },
  {
    deep: true,
  },
);

watch(
  scheduledActiveTab,
  () => {
    filterReports();
  },
);
//this makes sure that reports are formatted when the component is mounted
//because sometimes watcher might not be triggered if the props are already set
onMounted(() => {
  formatReports();
});

const formatReports = () => {
  props.reports.length > 0 &&
    props.reports.forEach((report: any) => {
      scheduledReports.value.push({
        name: report.name,
        tab: getTabName(report.dashboards?.[0]?.tabs?.[0]),
        time_range: getTimeRangeValue(report.dashboards?.[0]?.timerange),
        frequency: getFrequencyValue(report.frequency),
        last_triggered_at_raw: report.last_triggered_at || null,
        last_triggered_at: report.last_triggered_at
          ? convertUnixToDateFormat(report.last_triggered_at)
          : "-",
        created_at_raw: report.created_at || null,
        created_at: convertUnixToDateFormat(report.created_at),
        orgId: report.org_id,
        isCached: !report?.destinations?.length,
      });
    });

  filterReports();
};

const getTabName = (tabId: string) => {
  const tab = props.tabs.find((tab: any) => tab.tabId === tabId) as any;
  return tab?.name;
};

const filterReports = () => {
  // filter reports based on the selected tab
  // If reports are cached, show only cached reports
  if (scheduledActiveTab.value === "cached") {
    formattedReports.value = scheduledReports.value.filter(
      (report) => report.isCached,
    );
  } else {
    formattedReports.value = scheduledReports.value.filter(
      (report) => !report.isCached,
    );
  }
};

const columns: OTableColumnDef[] = [
  {
    id: "name",
    header: t("reports.name"),
    accessorKey: "name",
    sortable: true,
    size: COL.name,
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "tab",
    header: t("reports.tab"),
    accessorKey: "tab",
    sortable: true,
    size: COL.streamName,
    meta: { align: "left" },
  },
  {
    id: "time_range",
    header: t("reports.timeRange"),
    accessorKey: "time_range",
    sortable: true,
    size: COL.date,
    meta: { align: "left" },
  },
  {
    id: "frequency",
    header: t("reports.frequency"),
    accessorKey: "frequency",
    sortable: true,
    size: COL.frequency,
    meta: { align: "left" },
  },
  {
    id: "last_triggered_at",
    header: t("reports.lastTriggeredAt"),
    accessorKey: "last_triggered_at",
    sortable: false,
    size: COL.dateAbsolute,
    meta: { align: "left" },
  },
  {
    id: "created_at",
    header: t("reports.createdAt"),
    accessorKey: "created_at",
    sortable: false,
    size: COL.createdAt,
    meta: { align: "left" },
  },
];

const selectedPerPage = ref(20);

const perPageOptionsList = [5, 10, 20, 50, 100];

const displayReports = computed(() => {
  let reports = formattedReports.value;
  if (scheduledFilterQuery.value) {
    const query = scheduledFilterQuery.value.toLowerCase();
    reports = reports.filter((row: any) =>
      Object.values(row).some((v) =>
        String(v).toLowerCase().includes(query),
      ),
    );
  }
  return reports;
});

const openReport = (row: any) => {
  router.push({
    name: "createReport",
    query: {
      name: row.name,
      org_identifier: row.orgId,
    },
  });
};

const getFrequencyValue = (frequency: any) => {
  if (frequency.type === "cron") {
    return t("dashboard.scheduledDashboardsPage.cronFrequency", {
      cron: frequency.cron,
    });
  } else {
    switch (frequency.type) {
      case "once":
        return t("dashboard.scheduledDashboardsPage.once");
      case "hours":
        return frequency.interval > 1
          ? t("dashboard.scheduledDashboardsPage.everyHours", {
              interval: frequency.interval,
            })
          : t("dashboard.scheduledDashboardsPage.everyHour");
      case "weeks":
        return frequency.interval > 1
          ? t("dashboard.scheduledDashboardsPage.everyWeeks", {
              interval: frequency.interval,
            })
          : t("dashboard.scheduledDashboardsPage.everyWeek");
      case "months":
        return frequency.interval > 1
          ? t("dashboard.scheduledDashboardsPage.everyMonths", {
              interval: frequency.interval,
            })
          : t("dashboard.scheduledDashboardsPage.everyMonth");
      case "days":
        return frequency.interval > 1
          ? t("dashboard.scheduledDashboardsPage.everyDays", {
              interval: frequency.interval,
            })
          : t("dashboard.scheduledDashboardsPage.everyDay");
      default:
        return "";
    }
  }
};

const getTimeRangeValue = (dateTime: any) => {
  if (dateTime.type === "relative") {
    return t("dashboard.scheduledDashboardsPage.past", { period: dateTime.period });
  } else {
    const startDateTime = convertUnixToDateFormat(dateTime.from);
    const endDateTime = convertUnixToDateFormat(dateTime.to);
    return `${startDateTime} - ${endDateTime}`;
  }
};
</script>

<style scoped>
/* keep(lib-override:o2-table.rum-tabs): table header-row background and the pill-style
   time-range tabs — target OTable / tab child DOM reached via :deep(). */
.scheduled-dashboards :deep(thead tr) {
  background-color: var(--color-table-header-bg);
}

.scheduled-dashboards :deep(.rum-tabs) {
  border: 1px solid var(--color-border-default);
  height: fit-content;
  border-radius: 0.25rem;
  overflow: hidden;
}

.scheduled-dashboards :deep(.rum-tab) {
  width: fit-content !important;
  padding: 0.25rem 0.75rem !important;
  border: none !important;
}

.scheduled-dashboards :deep(.rum-tab:hover) {
  background: var(--color-surface-subtle-hover);
}

.scheduled-dashboards :deep(.rum-tab.active) {
  background: var(--color-brand-indigo);
  color: var(--color-white) !important;
}
</style>
