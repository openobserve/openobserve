<!-- right 2026 OpenObserve Inc.

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
  <div class="p-0 bg-(--q-background) w-full h-full flex flex-col min-h-0">
    <AppPageHeader
      :title="t('logs.searchJobInspector.title')"
      :back="{ onClick: goBack, dataTest: 'inspector-close-button' }"
      class="shrink-0 px-4 border-b border-border-default"
    >
      <template #title>
        <span data-test="inspector-title">{{ t('logs.searchJobInspector.title') }}</span>
      </template>
      <template #actions>
        <div
          v-if="profileData && !hasNoData"
          :class="[
            'flex items-center gap-1.5 px-2 py-1 rounded-md border',
            store.state.theme === 'dark'
              ? 'bg-gray-800/50 border-gray-600'
              : 'bg-gray-50 border-gray-200'
          ]"
        >
          <svg class="w-3.5 h-3.5 opacity-70" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="6" width="18" height="14" rx="2" :stroke="store.state.theme === 'dark' ? '#9CA3AF' : '#6B7280'" stroke-width="2"/>
            <path d="M3 10h18M8 3v4M16 3v4" :stroke="store.state.theme === 'dark' ? '#9CA3AF' : '#6B7280'" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <div class="flex items-center gap-1.5">
            <span
              :class="[
                'text-[10px] font-small px-1.5 py-0.5 rounded',
                store.state.theme === 'dark'
                  ? 'text-gray-300 bg-gray-700/50'
                  : 'text-gray-600 bg-gray-100'
              ]"
            >
              {{ store.state.timezone || 'UTC' }}
            </span>
            <div
              :class="[
                'text-xs font-semibold',
                store.state.theme === 'dark' ? 'text-gray-200' : 'text-gray-800'
              ]"
            >
              {{ formatTimeRange(profileData.start_time, profileData.end_time) }}
            </div>
          </div>
        </div>
      </template>
    </AppPageHeader>
    <div class="w-full flex flex-col flex-1 min-h-0 overflow-hidden pt-2.5">
      <!-- Summary Stats Card -->
      <div v-if="!loading" class="mb-[0.625rem] mx-2.5 shrink-0">
        <div class="grid gap-3" style="grid-template-columns: 1fr 1fr 1fr 1.6fr 0.9fr;">
          <!-- Results Returned -->
          <div class="stat-tile">
            <div
              class="rounded-lg p-3 border shadow-sm h-28 flex flex-col justify-between"
              :class="store.state.theme === 'dark' ? 'bg-[#181A1B] border-gray-700' : 'bg-white border-gray-200'"
            >
              <div class="flex justify-between items-start">
                <div
                  class="text-base font-small"
                  :class="store.state.theme === 'dark' ? 'text-gray-400' : 'text-gray-500'"
                >
                  {{ t('logs.searchJobInspector.results') }}
                </div>
                <div
                  class="w-10 h-10 rounded-lg flex items-center justify-center border"
                  style="background: rgba(57, 126, 246, 0.2); border-color: rgba(57, 126, 246, 0.35);"
                >
                  <img src="@/assets/images/home/records.svg" :alt="t('logs.searchJobInspector.resultsIconAlt')" class="h-6 w-6" />
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <div
                  class="text-2xl font-bold"
                  :class="store.state.theme === 'dark' ? 'text-white' : 'text-gray-900'"
                >
                  {{ hasNoData ? 'NA' : (profileData?.data_records || 0).toLocaleString() }}
                </div>
                <div
                  class="text-[10px]"
                  :class="store.state.theme === 'dark' ? 'text-gray-500' : 'text-gray-400'"
                >
                  {{ t('logs.searchJobInspector.returnedFromQuery') }}
                </div>
              </div>
            </div>
          </div>

          <!-- Events Scanned -->
          <div class="stat-tile">
            <div
              class="rounded-lg p-3 border shadow-sm h-28 flex flex-col justify-between"
              :class="store.state.theme === 'dark' ? 'bg-[#181A1B] border-gray-700' : 'bg-white border-gray-200'"
            >
              <div class="flex justify-between items-start">
                <div
                  class="text-base font-small"
                  :class="store.state.theme === 'dark' ? 'text-gray-400' : 'text-gray-500'"
                >
                  {{ t('logs.searchJobInspector.scannedEvents') }}
                </div>
                <div
                  class="w-10 h-10 rounded-lg flex items-center justify-center border"
                  style="background: rgba(57, 126, 246, 0.2); border-color: rgba(57, 126, 246, 0.35);"
                >
                  <img src="@/assets/images/home/streams.svg" :alt="t('logs.searchJobInspector.eventsIconAlt')" class="h-6 w-6" />
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <div
                  class="text-2xl font-bold"
                  :class="store.state.theme === 'dark' ? 'text-white' : 'text-gray-900'"
                >
                  {{ hasNoData ? 'NA' : (profileData?.scan_records || 0).toLocaleString() }}
                </div>
                <div
                  class="text-[10px]"
                  :class="store.state.theme === 'dark' ? 'text-gray-500' : 'text-gray-400'"
                >
                  {{ t('logs.searchJobInspector.scannedEventsForQuery') }}
                </div>
              </div>
            </div>
          </div>

          <!-- Time Taken -->
          <div class="stat-tile">
            <div
              class="rounded-lg p-3 border shadow-sm h-28 flex flex-col justify-between"
              :class="store.state.theme === 'dark' ? 'bg-[#181A1B] border-gray-700' : 'bg-white border-gray-200'"
            >
              <div class="flex justify-between items-start">
                <div
                  class="text-base font-small"
                  :class="store.state.theme === 'dark' ? 'text-gray-400' : 'text-gray-500'"
                >
                  {{ t('logs.searchJobInspector.timeTaken') }}
                </div>
                <div
                  class="w-10 h-10 rounded-lg flex items-center justify-center border"
                  style="background: rgba(34, 197, 94, 0.2); border-color: rgba(34, 197, 94, 0.35);"
                >
                  <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="9" :stroke="store.state.theme === 'dark' ? '#10B981' : '#059669'" stroke-width="2"/>
                    <path d="M12 6v6l4 2" :stroke="store.state.theme === 'dark' ? '#10B981' : '#059669'" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <div
                  class="text-2xl font-bold"
                  :class="store.state.theme === 'dark' ? 'text-white' : 'text-gray-900'"
                >
                  {{ hasNoData ? 'NA' : formatDuration(profileData?.time_taken || profileData?.total_duration) }}
                </div>
                <div
                  class="text-[10px]"
                  :class="hasNoData ? (store.state.theme === 'dark' ? 'text-gray-500' : 'text-gray-400') : getResponseTimeLabel(profileData?.time_taken || profileData?.total_duration).colorClass"
                >
                  {{ hasNoData ? t('logs.searchJobInspector.noData') : getResponseTimeLabel(profileData?.time_taken || profileData?.total_duration).text }}
                </div>
              </div>
            </div>
          </div>

          <!-- Trace ID -->
          <div class="stat-tile">
            <div
              class="rounded-lg p-3 border shadow-sm h-28 flex flex-col justify-between"
              :class="store.state.theme === 'dark' ? 'bg-[#181A1B] border-gray-700' : 'bg-white border-gray-200'"
            >
              <div class="flex justify-between items-start">
                <div
                  class="text-base font-small"
                  :class="store.state.theme === 'dark' ? 'text-gray-400' : 'text-gray-500'"
                >
                  {{ t('logs.searchJobInspector.traceId') }}
                </div>
                <div
                  class="w-10 h-10 rounded-lg flex items-center justify-center border"
                  style="background: rgba(242, 220, 245, 0.25); border-color: rgba(242, 220, 245, 0.45);"
                >
                  <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7 8h10M7 12h10M7 16h6" :stroke="store.state.theme === 'dark' ? '#E9D5FD' : '#A855F7'" stroke-width="2" stroke-linecap="round"/>
                    <rect x="3" y="4" width="18" height="16" rx="2" :stroke="store.state.theme === 'dark' ? '#E9D5FD' : '#A855F7'" stroke-width="2"/>
                  </svg>
                </div>
              </div>
              <div class="flex flex-col gap-1">
                <div
                  class="text-sm font-mono truncate font-semibold leading-tight overflow-hidden"
                  :class="hasNoData ? (store.state.theme === 'dark' ? 'text-gray-400' : 'text-gray-500') : (store.state.theme === 'dark' ? 'text-blue-400' : 'text-blue-600')"
                >
                  {{ hasNoData ? 'NA' : traceId }}
                  <OTooltip v-if="!hasNoData" :content="traceId" />
                </div>
              </div>
            </div>
          </div>

          <!-- View Query -->
          <div class="stat-tile">
            <div
              class="rounded-lg p-3 border shadow-sm h-28 flex flex-col items-center justify-center transition-all"
              :class="[
                store.state.theme === 'dark' ? 'bg-[#181A1B] border-gray-700' : 'bg-white border-gray-200',
                hasNoData ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary hover:shadow-lg'
              ]"
              @click="!hasNoData && (showSqlDialog = true)"
            >
              <div
                class="w-12 h-12 rounded-lg flex items-center justify-center border mb-2"
                style="background: rgba(245, 235, 147, 0.25); border-color: rgba(245, 235, 147, 0.45);"
              >
                <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" :stroke="store.state.theme === 'dark' ? '#FDE68A' : '#CA8A04'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div
                class="text-sm font-semibold"
                :class="store.state.theme === 'dark' ? 'text-blue-400' : 'text-blue-600'"
              >
                {{ t('logs.searchJobInspector.viewQuery') }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Error Message -->
      <OBanner
        v-if="errorMessage"
        variant="error"
        icon="error"
        :content="errorMessage"
        class="mb-[0.625rem] shrink-0"
        data-test="inspector-error-banner"
      />

      <!-- Profile Data Table (OTable handles loading skeleton) -->
      <div v-if="loading || (profileData && profileData.events)" class="w-full flex-1 min-h-0 overflow-hidden">
        <div class="card-container h-full">
          <OTable
            :data="hierarchicalEvents"
            :columns="columns"
            row-key="id"
            :loading="loading"
            pagination="none"
            :show-global-filter="false"
            tree
            tree-column-id="index"
            :default-columns="false"
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="logs-search-job-inspector"
            style="width: 100%;"
            class="o2-table o2-row-md o2-table-header-sticky"
            data-test="inspector-events-table"
          >
            <template #cell-index="{ row }">
              <span class="inline-block">{{ row.index }}</span>
            </template>

            <template #cell-duration="{ row }">
              <div class="flex items-center gap-2 min-w-[150px]">
                <div
                  class="h-5 rounded-[3px] min-w-[4px] transition-[width] duration-300 ease-in-out"
                  :style="{
                    width: calculateBarWidth(row.duration) + '%',
                    backgroundColor: getDurationColor(row.duration),
                  }"
                ></div>
                <span class="text-[13px] whitespace-nowrap min-w-[50px]">{{ formatDuration(row.duration) }}</span>
              </div>
            </template>

            <template #cell-component="{ row }">
              <span :title="row.component">{{ row.component }}</span>
            </template>

            <template #cell-desc="{ row }">
              <span class="text-xs" :title="row.desc || '-'">{{ row.desc || '-' }}</span>
            </template>

            <template #empty>
              <no-data />
            </template>
          </OTable>
        </div>
      </div>
    </div>

    <!-- SQL Query Dialog -->
    <ODrawer data-test="search-job-inspector-sql-drawer" v-model:open="showSqlDialog" size="lg" :title="t('logs.searchJobInspector.sqlQuery')">
      <template #header-right>
        <OButton
          v-if="profileData?.sql"
          variant="ghost"
          size="icon-sm"
          :class="[
                'border',
                copiedSql ? 'text-green-600 border-green-400' : 'border-gray-300'
              ]"
          @click="copySql"
          data-test="inspector-copy-sql-btn"
        >
          <OIcon name="content-copy" size="sm" v-if="!copiedSql" />
              <OIcon name="check" size="sm" v-else />
          <OTooltip :content="copiedSql ? t('logs.searchJobInspector.copied') : t('logs.searchJobInspector.sql')" />
        </OButton>
      </template>
      <div
        class="rounded p-4 max-h-[calc(100vh-150px)] overflow-auto"
        :class="store.state.theme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-[#f5f5f5]'"
      >
        <pre
          class="font-mono text-[13px] leading-[1.6] m-0 whitespace-pre-wrap break-words"
          data-test="inspector-sql-query-content"
        >{{ profileData?.sql || t('logs.searchJobInspector.noSqlAvailable') }}</pre>
      </div>
    </ODrawer>

    <!-- Trace ID Dialog -->
    <ODialog data-test="search-job-inspector-trace-id-dialog" v-model:open="showTraceIdDialog" size="sm" :title="t('logs.searchJobInspector.fullTraceId')">
      <div class="flex items-center gap-3">
        <div class="flex-1 font-mono text-sm break-all p-3 rounded border"
             :class="store.state.theme === 'dark' ? 'bg-gray-800 border-gray-700 text-blue-400' : 'bg-gray-50 border-gray-200 text-blue-600'">
          {{ traceId }}
        </div>
        <OButton
          variant="primary"
          size="sm-action"
          @click="copyTraceId"
        ><OIcon name="content-copy" size="sm"  class="mr-1" /></OButton>
      </div>
    </ODialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, computed, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import searchService from "@/services/search";
import NoData from "@/components/shared/grid/NoData.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";

import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { copyToClipboard } from "@/utils/clipboard";

interface ProfileEvent {
  timestamp: string;
  node_name?: string;
  search_role?: string;
  duration: number;
  component: string;
  desc?: string;
  region?: string;
  cluster?: string;
  trace_id?: string;
  events?: ProfileEvent[]; // Nested events from backend
}

interface HierarchicalEvent extends ProfileEvent {
  id: string;
  children?: HierarchicalEvent[];
  level?: number;
  expanded?: boolean;
  index?: string;
  isLastChild?: boolean;
}

interface ProfileData {
  sql: string;
  start_time: string;
  end_time: string;
  total_duration: number;
  events: ProfileEvent[];
  data_records?: number;
  scan_records?: number;
  time_taken?: number;
}

export default defineComponent({
  name: "SearchJobInspector",
  components: {
    NoData,
    AppPageHeader,
    OButton,
    ODrawer,
    ODialog,
    OSpinner,
    OTooltip,
    OIcon,
    OTable,
},
  setup() {
    const router = useRouter();
    const route = useRoute();
    const store = useStore();
    const { t } = useI18n();

    const loading = ref(false);
    const errorMessage = ref("");
    const profileData = ref<ProfileData | null>(null);
    const showSqlDialog = ref(false);
    const showTraceIdDialog = ref(false);
    const copiedTraceId = ref(false);

    const traceId = computed(() => route.query.trace_id as string);
    const orgIdentifier = computed(
      () => route.query.org_identifier as string || store.state.selectedOrganization?.identifier
    );
    const startTime = computed(() => route.query.start_time ? parseInt(route.query.start_time as string) : undefined);
    const endTime = computed(() => route.query.end_time ? parseInt(route.query.end_time as string) : undefined);

    const columns = computed<OTableColumnDef[]>(() => [
      {
        id: "index",
        header: "#",
        accessorKey: "index",
        meta: { align: "left" },
        size: indexColumnWidth.value,
      },
      {
        id: "duration",
        header: t("logs.searchJobInspector.columnDuration"),
        accessorKey: "duration",
        meta: { align: "left" },
        size: 200,
      },
      {
        id: "node_name",
        header: t("logs.searchJobInspector.columnNodeName"),
        accessorKey: "node_name",
        meta: { align: "left" },
        size: 280,
      },
      {
        id: "search_role",
        header: t("logs.searchJobInspector.columnRole"),
        accessorKey: "search_role",
        meta: { align: "left" },
        size: COL.role,
      },
      {
        id: "component",
        header: t("logs.searchJobInspector.columnOperation"),
        accessorKey: "component",
        meta: { align: "left" },
        size: 340,
      },
      {
        id: "desc",
        header: t("logs.searchJobInspector.columnDescription"),
        accessorKey: "desc",
        meta: { align: "left", autoWidth: true },
        size: COL.description,
      },
    ]);

    const fetchProfileData = async () => {
      if (!traceId.value || !orgIdentifier.value) {
        errorMessage.value = t("logs.searchJobInspector.missingParameters");
        return;
      }

      loading.value = true;
      errorMessage.value = "";

      try {
        const response = await searchService.get_search_profile(
          orgIdentifier.value,
          traceId.value,
          startTime.value,
          endTime.value
        );
        profileData.value = response.data;
      } catch (error: any) {
        console.error("Error fetching profile data:", error);
        errorMessage.value =
          error.response?.data?.message ||
          error.message ||
          t("logs.searchJobInspector.failedToFetch");
      } finally {
        loading.value = false;
      }
    };

    // Build hierarchical structure from backend nested events
    const buildHierarchy = (events: ProfileEvent[]): HierarchicalEvent[] => {
      const hierarchy: HierarchicalEvent[] = [];

      // Process events recursively, handling nested children
      const processEvent = (
        event: ProfileEvent,
        parentIndex: string,
        level: number,
        isLast: boolean = false
      ): HierarchicalEvent => {
        const hierarchicalEvent: HierarchicalEvent = {
          ...event,
          id: parentIndex,
          index: parentIndex,
          level,
          expanded: false,
          isLastChild: isLast,
        };

        // If the event has children, process them recursively
        if (event.events && event.events.length > 0) {
          hierarchicalEvent.children = event.events.map((childEvent, childIndex) => {
            const childIndexStr = `${parentIndex}.${childIndex + 1}`;
            const isLastChildInArray = childIndex === event.events!.length - 1;
            return processEvent(childEvent, childIndexStr, level + 1, isLastChildInArray);
          });
        }

        return hierarchicalEvent;
      };

      // Process top-level events
      events.forEach((event, i) => {
        const isLastEvent = i === events.length - 1;
        hierarchy.push(processEvent(event, (i + 1).toString(), 0, isLastEvent));
      });

      return hierarchy;
    };

    const hierarchicalEvents = computed(() => {
      if (!profileData.value?.events) return [];
      return buildHierarchy(profileData.value.events);
    });

    const maxDuration = computed(() => {
      if (!profileData.value?.events) return 1;

      const findMax = (events: ProfileEvent[]): number => {
        let max = 0;
        for (const event of events) {
          if (event.duration > max) max = event.duration;
          if (event.events && event.events.length > 0) {
            const childMax = findMax(event.events);
            if (childMax > max) max = childMax;
          }
        }
        return max;
      };

      return findMax(profileData.value.events) || 1;
    });

    // Calculate maximum depth in the hierarchy
    const maxDepth = computed(() => {
      if (!hierarchicalEvents.value || hierarchicalEvents.value.length === 0) return 0;
      return Math.max(...hierarchicalEvents.value.map((e: any) => e.level || 0));
    });

    // Calculate index column width based on max depth
    // Base width: 150px, add 50px for each level starting from level 4
    const indexColumnWidth = computed(() => {
      const baseWidth = 150;
      if (maxDepth.value >= 4) {
        return baseWidth + (maxDepth.value - 3) * 50;
      }
      return baseWidth;
    });

    const calculateBarWidth = (duration: number) => {
      return (duration / maxDuration.value) * 100;
    };

    const getDurationColor = (duration: number) => {
      const percentage = (duration / maxDuration.value) * 100;
      if (percentage > 75) return "#f44336"; // red
      if (percentage > 50) return "#ff9800"; // orange
      if (percentage > 25) return "#ffc107"; // yellow
      return "#4caf50"; // green
    };

    const formatDuration = (ms: number | undefined) => {
      if (!ms) return "0ms";
      if (ms < 1000) return `${ms.toFixed(0)}ms`;
      return `${(ms / 1000).toFixed(2)}s`;
    };

    const formatTimeRange = (start: string, end: string) => {
      if (!start || !end) return "-";
      try {
        const timeZone = store.state.timezone || 'UTC';
        const startMs = parseInt(start) / 1000; // Convert microseconds to milliseconds
        const endMs = parseInt(end) / 1000;
        const startDate = new Date(startMs).toLocaleString('en-US', { timeZone });
        const endDate = new Date(endMs).toLocaleString('en-US', { timeZone });
        return `${startDate} - ${endDate}`;
      } catch {
        return "-";
      }
    };

    const getResponseTimeLabel = (ms: number | undefined) => {
      if (!ms) return { text: t("logs.searchJobInspector.noData"), colorClass: "text-gray-400" };

      if (ms < 50) {
        return {
          text: t("logs.searchJobInspector.ultraFastResponse"),
          colorClass: store.state.theme === 'dark' ? 'text-green-400' : 'text-green-600'
        };
      } else if (ms < 200) {
        return {
          text: t("logs.searchJobInspector.fastResponse"),
          colorClass: store.state.theme === 'dark' ? 'text-green-400' : 'text-green-600'
        };
      } else if (ms < 500) {
        return {
          text: t("logs.searchJobInspector.goodResponse"),
          colorClass: store.state.theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
        };
      } else if (ms < 1000) {
        return {
          text: t("logs.searchJobInspector.moderateResponse"),
          colorClass: store.state.theme === 'dark' ? 'text-yellow-400' : 'text-yellow-600'
        };
      } else {
        return {
          text: t("logs.searchJobInspector.slowResponse"),
          colorClass: store.state.theme === 'dark' ? 'text-red-400' : 'text-red-600'
        };
      }
    };

    const hasNoData = computed(() => {
      return !profileData.value || !profileData.value.events || profileData.value.events.length === 0;
    });

    watch(
      () => store.state.selectedOrganization?.identifier,
      (newOrg, oldOrg) => {
        if (oldOrg && newOrg !== oldOrg) {
          router.push({
            name: "logs",
            query: { org_identifier: newOrg },
          });
        }
      },
      { flush: "sync" },
    );

    const goBack = () => {
      router.back();
    };

    const copyTraceId = () => {
      copyToClipboard(traceId.value, {
        errorMessage: t('logs.searchJobInspector.failedToCopyTraceId'),
      }).then((success) => {
        if (success) {
          copiedTraceId.value = true;
          setTimeout(() => {
            copiedTraceId.value = false;
          }, 2000);
        }
      });
    };

    const copiedSql = ref(false);
    const copySql = () => {
      copyToClipboard(profileData.value?.sql || "", {
        errorMessage: t('logs.searchJobInspector.failedToCopySql'),
      }).then((success) => {
        if (success) {
          copiedSql.value = true;
          setTimeout(() => {
            copiedSql.value = false;
          }, 2000);
        }
      });
    };

    onMounted(() => {
      fetchProfileData();
    });

    return {
      loading,
      errorMessage,
      profileData,
      traceId,
      columns,
      hierarchicalEvents,
      indexColumnWidth,
      calculateBarWidth,
      getDurationColor,
      formatDuration,
      formatTimeRange,
      getResponseTimeLabel,
      goBack,
      showSqlDialog,
      showTraceIdDialog,
      copiedTraceId,
      copyTraceId,
      copiedSql,
      copySql,
      store,
      hasNoData,
      t,
    };
  },
});
</script>
