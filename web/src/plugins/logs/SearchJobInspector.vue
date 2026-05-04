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
  <q-page class="search-job-inspector q-pa-none">
    <div class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem]">
      <!-- Header Card -->
      <div class="card-container tw:mb-[0.625rem] tw:mt-[0.325rem]">
        <div class="flex justify-between full-width tw:py-3 tw:px-4 items-center">
          <div class="tw:flex tw:items-center tw:gap-3">
            <div class="q-table__title tw:font-[600]" data-test="inspector-title">
              Search Job Inspector
            </div>
            <div
              v-if="profileData && !hasNoData"
              :class="[
                'tw:flex tw:items-center tw:gap-1.5 tw:px-2 tw:py-1 tw:rounded-md tw:border',
                store.state.theme === 'dark'
                  ? 'tw:bg-gray-800/50 tw:border-gray-600'
                  : 'tw:bg-gray-50 tw:border-gray-200'
              ]"
            >
              <svg class="tw:w-[14px] tw:h-[14px] tw:opacity-70" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="6" width="18" height="14" rx="2" :stroke="store.state.theme === 'dark' ? '#9CA3AF' : '#6B7280'" stroke-width="2"/>
                <path d="M3 10h18M8 3v4M16 3v4" :stroke="store.state.theme === 'dark' ? '#9CA3AF' : '#6B7280'" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <div class="tw:flex tw:items-center tw:gap-1.5">
                <span
                  :class="[
                    'tw:text-[10px] tw:font-small tw:px-1.5 tw:py-0.5 tw:rounded',
                    store.state.theme === 'dark'
                      ? 'tw:text-gray-300 tw:bg-gray-700/50'
                      : 'tw:text-gray-600 tw:bg-gray-100'
                  ]"
                >
                  {{ store.state.timezone || 'UTC' }}
                </span>
                <div
                  :class="[
                    'tw:text-xs tw:font-semibold',
                    store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-800'
                  ]"
                >
                  {{ formatTimeRange(profileData.start_time, profileData.end_time) }}
                </div>
              </div>
            </div>
          </div>
          <div class="tw:flex tw:items-center">
            <OButton
              variant="ghost"
              size="icon-sm"
              @click="goBack"
              data-test="inspector-close-button"
            >
              <X :size="16" />
              <q-tooltip>Close</q-tooltip>
            </OButton>
          </div>
        </div>
      </div>

      <!-- Summary Stats Card -->
      <div v-if="!loading" class="tw:mb-[0.625rem]">
        <div class="tw:grid tw:gap-3" style="grid-template-columns: 1fr 1fr 1fr 1.6fr 0.9fr;">
          <!-- Results Returned -->
          <div class="stat-tile">
            <div
              class="tw:rounded-lg tw:p-3 tw:border tw:shadow-sm tw:h-28 tw:flex tw:flex-col tw:justify-between"
              :class="store.state.theme === 'dark' ? 'tw:bg-[#181A1B] tw:border-gray-700' : 'tw:bg-white tw:border-gray-200'"
            >
              <div class="tw:flex tw:justify-between tw:items-start">
                <div
                  class="tw:text-base tw:font-small"
                  :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                >
                  Results
                </div>
                <div
                  class="tw:w-10 tw:h-10 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:border"
                  style="background: rgba(57, 126, 246, 0.2); border-color: rgba(57, 126, 246, 0.35);"
                >
                  <img src="@/assets/images/home/records.svg" alt="Results Icon" class="tw:h-6 tw:w-6" />
                </div>
              </div>
              <div class="tw:flex tw:flex-col tw:gap-1">
                <div
                  class="tw:text-2xl tw:font-bold"
                  :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-900'"
                >
                  {{ hasNoData ? 'NA' : (profileData?.data_records || 0).toLocaleString() }}
                </div>
                <div
                  class="tw:text-[10px]"
                  :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'"
                >
                  Returned from query
                </div>
              </div>
            </div>
          </div>

          <!-- Events Scanned -->
          <div class="stat-tile">
            <div
              class="tw:rounded-lg tw:p-3 tw:border tw:shadow-sm tw:h-28 tw:flex tw:flex-col tw:justify-between"
              :class="store.state.theme === 'dark' ? 'tw:bg-[#181A1B] tw:border-gray-700' : 'tw:bg-white tw:border-gray-200'"
            >
              <div class="tw:flex tw:justify-between tw:items-start">
                <div
                  class="tw:text-base tw:font-small"
                  :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                >
                  Scanned Events
                </div>
                <div
                  class="tw:w-10 tw:h-10 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:border"
                  style="background: rgba(57, 126, 246, 0.2); border-color: rgba(57, 126, 246, 0.35);"
                >
                  <img src="@/assets/images/home/streams.svg" alt="Events Icon" class="tw:h-6 tw:w-6" />
                </div>
              </div>
              <div class="tw:flex tw:flex-col tw:gap-1">
                <div
                  class="tw:text-2xl tw:font-bold"
                  :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-900'"
                >
                  {{ hasNoData ? 'NA' : (profileData?.scan_records || 0).toLocaleString() }}
                </div>
                <div
                  class="tw:text-[10px]"
                  :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'"
                >
                  Scanned events for this query
                </div>
              </div>
            </div>
          </div>

          <!-- Time Taken -->
          <div class="stat-tile">
            <div
              class="tw:rounded-lg tw:p-3 tw:border tw:shadow-sm tw:h-28 tw:flex tw:flex-col tw:justify-between"
              :class="store.state.theme === 'dark' ? 'tw:bg-[#181A1B] tw:border-gray-700' : 'tw:bg-white tw:border-gray-200'"
            >
              <div class="tw:flex tw:justify-between tw:items-start">
                <div
                  class="tw:text-base tw:font-small"
                  :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                >
                  Time Taken
                </div>
                <div
                  class="tw:w-10 tw:h-10 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:border"
                  style="background: rgba(34, 197, 94, 0.2); border-color: rgba(34, 197, 94, 0.35);"
                >
                  <svg class="tw:h-6 tw:w-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="9" :stroke="store.state.theme === 'dark' ? '#10B981' : '#059669'" stroke-width="2"/>
                    <path d="M12 6v6l4 2" :stroke="store.state.theme === 'dark' ? '#10B981' : '#059669'" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                </div>
              </div>
              <div class="tw:flex tw:flex-col tw:gap-1">
                <div
                  class="tw:text-2xl tw:font-bold"
                  :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-900'"
                >
                  {{ hasNoData ? 'NA' : formatDuration(profileData?.time_taken || profileData?.total_duration) }}
                </div>
                <div
                  class="tw:text-[10px]"
                  :class="hasNoData ? (store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400') : getResponseTimeLabel(profileData?.time_taken || profileData?.total_duration).colorClass"
                >
                  {{ hasNoData ? 'No data' : getResponseTimeLabel(profileData?.time_taken || profileData?.total_duration).text }}
                </div>
              </div>
            </div>
          </div>

          <!-- Trace ID -->
          <div class="stat-tile">
            <div
              class="tw:rounded-lg tw:p-3 tw:border tw:shadow-sm tw:h-28 tw:flex tw:flex-col tw:justify-between"
              :class="store.state.theme === 'dark' ? 'tw:bg-[#181A1B] tw:border-gray-700' : 'tw:bg-white tw:border-gray-200'"
            >
              <div class="tw:flex tw:justify-between tw:items-start">
                <div
                  class="tw:text-base tw:font-small"
                  :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                >
                  Trace ID
                </div>
                <div
                  class="tw:w-10 tw:h-10 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:border"
                  style="background: rgba(242, 220, 245, 0.25); border-color: rgba(242, 220, 245, 0.45);"
                >
                  <svg class="tw:h-6 tw:w-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7 8h10M7 12h10M7 16h6" :stroke="store.state.theme === 'dark' ? '#E9D5FD' : '#A855F7'" stroke-width="2" stroke-linecap="round"/>
                    <rect x="3" y="4" width="18" height="16" rx="2" :stroke="store.state.theme === 'dark' ? '#E9D5FD' : '#A855F7'" stroke-width="2"/>
                  </svg>
                </div>
              </div>
              <div class="tw:flex tw:flex-col tw:gap-1">
                <div
                  class="tw:text-sm tw:font-mono tw:truncate tw:font-semibold tw:leading-tight tw:overflow-hidden"
                  :class="hasNoData ? (store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500') : (store.state.theme === 'dark' ? 'tw:text-blue-400' : 'tw:text-blue-600')"
                >
                  {{ hasNoData ? 'NA' : traceId }}
                  <q-tooltip v-if="!hasNoData" class="tw:text-xs">{{ traceId }}</q-tooltip>
                </div>
              </div>
            </div>
          </div>

          <!-- View Query -->
          <div class="stat-tile">
            <div
              class="tw:rounded-lg tw:p-3 tw:border tw:shadow-sm tw:h-28 tw:flex tw:flex-col tw:items-center tw:justify-center tw:transition-all"
              :class="[
                store.state.theme === 'dark' ? 'tw:bg-[#181A1B] tw:border-gray-700' : 'tw:bg-white tw:border-gray-200',
                hasNoData ? 'tw:opacity-50 tw:cursor-not-allowed' : 'tw:cursor-pointer hover:tw:border-primary hover:tw:shadow-lg'
              ]"
              @click="!hasNoData && (showSqlDialog = true)"
            >
              <div
                class="tw:w-12 tw:h-12 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:border tw:mb-2"
                style="background: rgba(245, 235, 147, 0.25); border-color: rgba(245, 235, 147, 0.45);"
              >
                <svg class="tw:h-7 tw:w-7" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-5M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" :stroke="store.state.theme === 'dark' ? '#FDE68A' : '#CA8A04'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div
                class="tw:text-sm tw:font-semibold"
                :class="store.state.theme === 'dark' ? 'tw:text-blue-400' : 'tw:text-blue-600'"
              >
                View Query
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Error Message -->
      <q-banner
        v-if="errorMessage"
        class="bg-negative text-white tw:mb-[0.625rem]"
        data-test="inspector-error-banner"
      >
        <template v-slot:avatar>
          <q-icon name="error" />
        </template>
        {{ errorMessage }}
      </q-banner>

      <!-- Loading State -->
      <div v-if="loading" class="card-container tw:h-[calc(100vh-242px)]">
        <div class="flex flex-center tw:h-full">
          <q-spinner-hourglass color="primary" size="50px" />
        </div>
      </div>

      <!-- Profile Data Table -->
      <div v-if="!loading  && profileData && profileData.events" class="tw:w-full tw:h-full">
        <div class="card-container tw:h-[calc(100vh-242px)]">
          <q-table
            :rows="hierarchicalEvents"
            :columns="columns"
            row-key="id"
            :pagination="{ rowsPerPage: 0 }"
            hide-pagination
            style="width: 100%; height: calc(100vh - 242px)"
            class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
            data-test="inspector-events-table"
          >
            <!-- Index column with expand/collapse -->
            <template v-slot:body-cell-index="props">
              <q-td
                :props="props"
                class="tree-cell"
                :class="{
                  'tree-has-children': props.row.level > 0,
                  'tree-is-parent': props.row.children && props.row.children.length > 0,
                  'tree-last-child': props.row.isLastChild
                }"
                :style="props.row.level > 0 ? {
                  '--tree-level': props.row.level,
                  '--tree-indent': `${props.row.level * 30}px`
                } : {}"
              >
                <div
                  :style="{ paddingLeft: getPaddingLeft(props.row.level) }"
                  class="row items-center no-wrap tree-node-content"
                >
                  <!-- Always reserve space for expand icon to keep alignment consistent -->
                  <div class="tree-icon-wrapper">
                    <q-icon
                      v-if="props.row.children && props.row.children.length > 0"
                      :name="
                        props.row.expanded
                          ? 'keyboard_arrow_down'
                          : 'keyboard_arrow_right'
                      "
                      size="xs"
                      class="cursor-pointer tree-expand-icon"
                      @click="toggleNode(props.row)"
                    />
                  </div>
                  <span class="tree-index-text">
                    {{ props.row.index }}
                  </span>
                </div>
              </q-td>
            </template>

            <!-- Duration column with bar -->
            <template v-slot:body-cell-duration="props">
              <q-td :props="props">
                <div class="duration-cell">
                  <div
                    class="duration-bar"
                    :style="{
                      width: calculateBarWidth(props.row.duration) + '%',
                      backgroundColor: getDurationColor(props.row.duration),
                    }"
                  ></div>
                  <span class="duration-text">{{ formatDuration(props.row.duration) }}</span>
                </div>
              </q-td>
            </template>

            <!-- Description column -->
            <template v-slot:body-cell-desc="props">
              <q-td :props="props">
                <div class="text-caption">{{ props.row.desc || '-' }}</div>
              </q-td>
            </template>

            <template #no-data>
              <no-data />
            </template>
          </q-table>
        </div>
      </div>
    </div>

    <!-- SQL Query Dialog -->
    <ODrawer v-model:open="showSqlDialog" size="lg">
      <template #header>
        <div class="tw:flex tw:items-center tw:justify-between tw:w-full">
          <div class="text-h6">SQL Query</div>
          <OButton
            v-if="profileData?.sql"
            variant="ghost"
            size="icon-sm"
            :class="[
                'tw:border',
                copiedSql ? 'tw:text-green-600 tw:border-green-400' : 'tw:border-gray-300'
              ]"
            @click="copySql"
            data-test="inspector-copy-sql-btn"
          >
            <Copy v-if="!copiedSql" :size="16" />
              <Check v-else :size="16" />
            <q-tooltip>{{ copiedSql ? 'Copied!' : 'Copy SQL' }}</q-tooltip>
          </OButton>
        </div>
      </template>
      <div :class="['sql-query-container', store.state.theme === 'dark' ? 'sql-query-container--dark' : '']">
        <pre class="sql-query" data-test="inspector-sql-query-content">{{ profileData?.sql || 'No SQL query available' }}</pre>
      </div>
    </ODrawer>

    <!-- Trace ID Dialog -->
    <ODialog v-model:open="showTraceIdDialog" size="sm">
      <template #header>
        <div class="text-h6">Full Trace ID</div>
      </template>
      <div class="tw:flex tw:items-center tw:gap-3">
        <div class="tw:flex-1 tw:font-mono tw:text-sm tw:break-all tw:p-3 tw:rounded tw:border"
             :class="store.state.theme === 'dark' ? 'tw:bg-gray-800 tw:border-gray-700 tw:text-blue-400' : 'tw:bg-gray-50 tw:border-gray-200 tw:text-blue-600'">
          {{ traceId }}
        </div>
        <OButton
          variant="primary"
          size="sm-action"
          @click="copyTraceId"
        ><Copy :size="14" class="tw:mr-1" />Copy</OButton>
      </div>
    </ODialog>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, computed, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import searchService from "@/services/search";
import NoData from "@/components/shared/grid/NoData.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { X, Copy, Check } from "lucide-vue-next";

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
    OButton,
    ODrawer,
    ODialog,
    X,
    Copy,
    Check,
  },
  setup() {
    const router = useRouter();
    const route = useRoute();
    const store = useStore();
    const $q = useQuasar();

    const loading = ref(false);
    const errorMessage = ref("");
    const profileData = ref<ProfileData | null>(null);
    const expandedNodes = ref<Set<string>>(new Set());
    const showSqlDialog = ref(false);
    const showTraceIdDialog = ref(false);
    const copiedTraceId = ref(false);

    const traceId = computed(() => route.query.trace_id as string);
    const orgIdentifier = computed(
      () => route.query.org_identifier as string || store.state.selectedOrganization?.identifier
    );
    const startTime = computed(() => route.query.start_time ? parseInt(route.query.start_time as string) : undefined);
    const endTime = computed(() => route.query.end_time ? parseInt(route.query.end_time as string) : undefined);

    const columns = computed(() => [
      {
        name: "index",
        label: "#",
        field: "index",
        align: "left" as const,
        style: `width: ${indexColumnWidth.value}px; min-width: ${indexColumnWidth.value}px; max-width: ${indexColumnWidth.value}px`,
      },
      {
        name: "duration",
        label: "Duration",
        field: "duration",
        align: "left" as const,
        style: "width: 200px",
      },
      {
        name: "node_name",
        label: "Node Name",
        field: "node_name",
        align: "left" as const,
        style: "width: 200px",
      },
      {
        name: "search_role",
        label: "Role",
        field: "search_role",
        align: "left" as const,
        style: "width: 100px",
      },
      {
        name: "component",
        label: "Operation",
        field: "component",
        align: "left" as const,
        style: "width: 250px",
      },
      {
        name: "desc",
        label: "Description",
        field: "desc",
        align: "left" as const,
      },
    ]);

    const fetchProfileData = async () => {
      if (!traceId.value || !orgIdentifier.value) {
        errorMessage.value = "Missing required parameters";
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
          "Failed to fetch profile data";
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

    const expandAllNodes = (nodes: HierarchicalEvent[]) => {
      nodes.forEach((node) => {
        expandedNodes.value.add(node.id);
        if (node.children) {
          expandAllNodes(node.children);
        }
      });
    };

    const toggleNode = (node: HierarchicalEvent) => {
      if (expandedNodes.value.has(node.id)) {
        expandedNodes.value.delete(node.id);
      } else {
        expandedNodes.value.add(node.id);
      }
    };

    const hierarchicalEvents = computed(() => {
      if (!profileData.value?.events) return [];

      const hierarchy = buildHierarchy(profileData.value.events);
      const flattened: any[] = [];

      const flatten = (nodes: HierarchicalEvent[], level: number = 0) => {
        nodes.forEach((node) => {
          flattened.push({
            ...node,
            level,
            expanded: expandedNodes.value.has(node.id),
          });

          if (node.children && expandedNodes.value.has(node.id)) {
            flatten(node.children, level + 1);
          }
        });
      };

      flatten(hierarchy);
      return flattened;
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

    // Calculate padding left based on level
    // Base padding: 44px for level 1, then add 12px for each additional level
    const getPaddingLeft = (level: number): string => {
      if (level === 0) return '0px';
      return `${44 + (level - 1) * 12}px`;
    };

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
      if (!ms) return { text: "No data", colorClass: "tw:text-gray-400" };

      if (ms < 50) {
        return {
          text: "Ultra-fast response",
          colorClass: store.state.theme === 'dark' ? 'tw:text-green-400' : 'tw:text-green-600'
        };
      } else if (ms < 200) {
        return {
          text: "Fast response",
          colorClass: store.state.theme === 'dark' ? 'tw:text-green-400' : 'tw:text-green-600'
        };
      } else if (ms < 500) {
        return {
          text: "Good response",
          colorClass: store.state.theme === 'dark' ? 'tw:text-blue-400' : 'tw:text-blue-600'
        };
      } else if (ms < 1000) {
        return {
          text: "Moderate response",
          colorClass: store.state.theme === 'dark' ? 'tw:text-yellow-400' : 'tw:text-yellow-600'
        };
      } else {
        return {
          text: "Slow response",
          colorClass: store.state.theme === 'dark' ? 'tw:text-red-400' : 'tw:text-red-600'
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
      navigator.clipboard.writeText(traceId.value).then(() => {
        copiedTraceId.value = true;
        setTimeout(() => {
          copiedTraceId.value = false;
        }, 2000);
      }).catch(() => {
        $q.notify({ type: 'negative', message: 'Failed to copy trace ID to clipboard' });
      });
    };

    const copiedSql = ref(false);
    const copySql = () => {
      navigator.clipboard.writeText(profileData.value?.sql || "").then(() => {
        copiedSql.value = true;
        setTimeout(() => {
          copiedSql.value = false;
        }, 2000);
      }).catch(() => {
        $q.notify({ type: 'negative', message: 'Failed to copy SQL to clipboard' });
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
      toggleNode,
      getPaddingLeft,
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
    };
  },
});
</script>

<style lang="scss" scoped>
.search-job-inspector {
  background-color: var(--q-background);
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stat-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  opacity: 0.7;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  line-height: 2;
  color: var(--q-primary);
}

.stat-value-small {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}

.duration-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 150px;
}

.duration-bar {
  height: 20px;
  border-radius: 3px;
  min-width: 4px;
  transition: width 0.3s ease;
}

.duration-text {
  font-size: 13px;
  white-space: nowrap;
  min-width: 50px;
}

.sql-query-container {
  background-color: #f5f5f5;
  border-radius: 4px;
  padding: 16px;
  max-height: calc(100vh - 150px);
  overflow: auto;
}

.sql-query-container--dark {
  background-color: #1e1e1e;
}

.sql-query {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.trace-id {
  word-break: break-all;
}

// Tree connector styles - simplified with Quasar patterns
.tree-cell {
  position: relative;
  overflow: visible !important;
}

// Vertical and horizontal tree connector lines
.tree-has-children {
  // Vertical line connecting parent to children - always at 22px for all levels
  &::before {
    content: '';
    position: absolute;
    left: 22px;
    top: -50%;
    height: 150%;
    width: 1.5px;
    background-color: var(--q-primary);
    opacity: 0.7;
    z-index: 1;
  }

  // Horizontal line from vertical line to child's dot - length varies by level
  &::after {
    content: '';
    position: absolute;
    left: 22px;
    top: 50%;
    width: calc((var(--tree-level) - 1) * 12px + 16px);
    height: 1.5px;
    background-color: var(--q-primary);
    opacity: 0.7;
    z-index: 1;
  }

  // Last child: only show vertical line up to middle
  &.tree-last-child::before {
    top: -50%;
    height: 100%;
  }
}

// Content container
.tree-node-content {
  position: relative;
  z-index: 2;
  min-height: 24px; // Ensure consistent row height

  // Junction dot for child nodes
  &::before {
    .tree-has-children & {
      content: '';
      position: absolute;
      left: calc((var(--tree-level, 1) - 1) * 12px + 38px);
      top: 50%;
      width: 7px;
      height: 7px;
      background-color: var(--q-primary);
      opacity: 0.7;
      border: 2px solid var(--q-background);
      border-radius: 0; // Default square for leaf nodes
      transform: translateY(-50%);
      z-index: 3;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
    }

    // Circular dot for parent nodes (nodes with children)
    .tree-is-parent & {
      border-radius: 50%;
    }
  }
}

// Expand/collapse icon wrapper - always takes up consistent space
.tree-icon-wrapper {
  width: 20px; // Fixed width to reserve space for icon
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-right: 2px;
}

// Expand/collapse icon
.tree-expand-icon {
  flex-shrink: 0;
  vertical-align: middle;

  // Add left margin for child nodes to center it in the available space
  .tree-has-children & {
    margin-left: 4px;
  }
}

// Index text - consistent spacing
.tree-index-text {
  display: inline-block;
}
</style>
