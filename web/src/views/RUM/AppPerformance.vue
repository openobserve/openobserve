<!-- Copyright 2023 OpenObserve Inc.

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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div :key="store.state.selectedOrganization.identifier">
    <div class="tw:pb-[0.625rem] tw:px-[0.625rem]">
      <div class="card-container">
        <div class="flex justify-between items-center q-py-sm q-px-md">
          <div class="performance_title">
            {{ t("rum.performanceSummaryLabel") }}
          </div>
          <div class="flex items-center">
            <DateTimePickerDashboard
              class="q-ml-sm rum-date-time-picker"
              ref="dateTimePicker"
              v-model="selectedDate"
            />
            <AutoRefreshInterval
              v-model="refreshInterval"
              :min-refresh-interval="
                store.state?.zoConfig?.min_auto_refresh_interval || 5
              "
              trigger
              class="app-performance-auto-refresh-interval tw:ml-[0.5rem]! tw:pl-0! tw:overflow-hidden!"
              @trigger="refreshData"
            />
            <q-btn
              :outline="isVariablesChanged ? false : true"
              class="q-ml-sm tw:border! tw:border-solid! tw:h-[2rem] tw:px-[0.325rem]!"
              :class="
                !isVariablesChanged
                  ? 'hover:tw:bg-[var(--o2-hover-accent)]!'
                  : ''
              "
              data-test="rum-performance-refresh"
              padding="xs"
              no-caps
              icon="refresh"
              @click="refreshData"
              :color="isVariablesChanged ? 'warning' : ''"
              :text-color="store.state.theme == 'dark' ? 'white' : 'dark'"
            >
              <q-tooltip>
                {{
                  isVariablesChanged
                    ? t("dashboard.refreshToApplyVariableChanges")
                    : t("dashboard.refresh")
                }}
              </q-tooltip>
            </q-btn>
          </div>
        </div>
        <AppTabs
          class="q-px-md"
          :tabs="tabs"
          v-model:active-tab="activePerformanceTab"
        />
      </div>
    </div>

    <router-view v-slot="{ Component }">
      <keep-alive>
        <div class="tw:pb-[0.375rem] tw:px-[0.625rem] tw:h-[calc(100%-101px)]!">
          <div
            class="card-container tw:py-[0.625rem] tw:h-full tw:overflow-hidden"
          >
            <component
              :is="Component"
              :date-time="currentTimeObj"
              :selected-date="selectedDate"
              ref="activePerformanceComponent"
              @variablesManagerReady="onVariablesManagerReady"
              @update:dateTime="onDataZoom"
            />
          </div>
        </div>
      </keep-alive>
    </router-view>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  ref,
  watch,
  onMounted,
  nextTick,
  computed,
  onActivated,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { getConsumableDateTime, getDashboard } from "@/utils/commons.ts";
import { parseDuration, generateDurationLabel } from "@/utils/date";
import { reactive } from "vue";
import { useRoute } from "vue-router";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import overviewDashboard from "@/utils/rum/overview.json";
import AppTabs from "@/components/common/AppTabs.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import usePerformance from "@/composables/rum/usePerformance";
import useRum from "@/composables/rum/useRum";

export default defineComponent({
  name: "AppPerformance",
  components: {
    AutoRefreshInterval,
    AppTabs,
    DateTimePickerDashboard,
  },
  setup() {
    const { t } = useI18n();

    const activePerformanceTab = ref("overview");
    const activePerformanceComponent = ref(null);
    const { performanceState } = usePerformance();
    const { rumState } = useRum();

    // Variables manager will be initialized by RenderDashboardCharts in child components
    const variablesManager = ref(null);

    // Track if there are uncommitted variable changes
    const isVariablesChanged = computed(() => {
      // If using variables manager, access hasUncommittedChanges directly from the manager
      // Explicitly dereference to ensure Vue tracks the dependency
      const manager = variablesManager.value;

      if (manager && "hasUncommittedChanges" in manager) {
        // Access the value (Vue auto-unwraps computed refs in composable returns)
        const hasChanges = manager.hasUncommittedChanges;
        return hasChanges;
      }

      return false;
    });

    // Computed ref to access RenderDashboardCharts from the active child component
    const performanceChartsRef = computed(() => {
      return (
        activePerformanceComponent.value?.performanceChartsRef ||
        activePerformanceComponent.value?.webVitalsChartsRef ||
        activePerformanceComponent.value?.errorRenderDashboardChartsRef ||
        activePerformanceComponent.value?.apiDashboardChartsRef
      );
    });

    const tabs = [
      {
        label: t("rum.overview"),
        value: "overview",
        style: {
          width: "fit-content",
          padding: "0.5rem 0.75rem",
          margin: "0 0.25rem",
        },
      },
      {
        label: t("rum.webVitals"),
        value: "web_vitals",
        style: {
          width: "fit-content",
          padding: "0.5rem 0.75rem",
          margin: "0 0.25rem",
        },
      },
      {
        label: t("rum.errors"),
        value: "errors",
        style: {
          width: "fit-content",
          padding: "0.5rem 0.75rem",
          margin: "0 0.25rem",
        },
      },
      {
        label: t("rum.api"),
        value: "api",
        style: {
          width: "fit-content",
          padding: "0.5rem 0.75rem",
          margin: "0 0.25rem",
        },
      },
    ];

    const routeName = computed(() => router.currentRoute.value.name);

    onMounted(async () => {
      await loadDashboard();

      const routeNameMapping = {
        rumPerformanceSummary: "overview",
        rumPerformanceWebVitals: "web_vitals",
        rumPerformanceErrors: "errors",
        rumPerformanceApis: "api",
        RumPerformance: "overview",
      };

      if (routeNameMapping[router.currentRoute.value.name]) {
        activePerformanceTab.value =
          routeNameMapping[router.currentRoute.value.name];
      } else {
        activePerformanceTab.value = "overview";
      }

      updateRoute();
    });

    onActivated(async () => {
      await loadDashboard();
    });

    const loadDashboard = async () => {
      currentDashboardData.data = overviewDashboard;

      // if variables data is null, set it to empty list
      if (
        !(
          currentDashboardData.data?.variables &&
          currentDashboardData.data?.variables?.list.length
        )
      ) {
        variablesData.isVariablesLoading = false;
        variablesData.values = [];
      }
    };

    watch(
      () => activePerformanceTab.value,
      () => {
        updateRoute();
      },
    );

    const route = useRoute();
    const router = useRouter();
    const store = useStore();
    const currentDashboardData = reactive({
      data: {},
    });

    const updateRoute = async () => {
      const routeNames = {
        overview: "rumPerformanceSummary",
        web_vitals: "rumPerformanceWebVitals",
        errors: "rumPerformanceErrors",
        api: "rumPerformanceApis",
      };

      if (!routeNames[activePerformanceTab.value]) return;

      router.push({
        name: routeNames[activePerformanceTab.value],
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          refresh: generateDurationLabel(refreshInterval.value),
          ...getQueryParamsForDuration(selectedDate.value),
        },
      });
    };

    watch(
      () => routeName.value,
      () => updateTabOnRouteChange(),
    );

    const updateTabOnRouteChange = () => {
      const routeNameMapping: { [key: string]: string } = {
        rumPerformanceSummary: "overview",
        rumPerformanceWebVitals: "web_vitals",
        rumPerformanceErrors: "errors",
        rumPerformanceApis: "api",
      };

      const tab =
        routeNameMapping[
          router.currentRoute.value.name?.toString() || "placeholder"
        ];
      if (tab !== activePerformanceTab.value && tab !== undefined) {
        activePerformanceTab.value = tab;
      }
    };

    // boolean to show/hide settings sidebar
    const showDashboardSettingsDialog = ref(false);

    // Handler for when variables manager is ready from child component
    const onVariablesManagerReady = (manager: any) => {
      variablesManager.value = manager;
    };

    const openSettingsDialog = () => {
      showDashboardSettingsDialog.value = true;
    };

    // [START] date picker related variables --------

    /**
     * Retrieves the selected date from the query parameters.
     */
    const getSelectedDateFromQueryParams = (params) => ({
      valueType: params.period
        ? "relative"
        : params.from && params.to
          ? "absolute"
          : "relative",
      startTime: params.from ? params.from : null,
      endTime: params.to ? params.to : null,
      relativeTimePeriod: params.period ? params.period : null,
    });

    const dateTimePicker = ref(null); // holds a reference to the date time picker

    // holds the date picker v-modal
    const selectedDate = ref(getSelectedDateFromQueryParams(route.query));

    // holds the current time for the dashboard
    const currentTimeObj = ref({});

    // refresh interval v-model
    const refreshInterval = ref(0);

    // when the date changes from the picker, update the current time object for the dashboard
    watch(selectedDate, (value) => {
      performanceState.data.datetime = value;
      currentTimeObj.value = {
        __global: {
          start_time: new Date(selectedDate.value.startTime),
          end_time: new Date(selectedDate.value.endTime),
        },
      };
    });

    const getQueryParamsForDuration = (data: any) => {
      if (data.relativeTimePeriod) {
        return {
          period: data.relativeTimePeriod,
        };
      } else {
        return {
          from: data.startTime,
          to: data.endTime,
        };
      }
    };

    const refreshData = () => {
      // CRITICAL: Commit all live variable changes to committed state
      // This is the key mechanism that prevents premature API calls
      // Call commitAllVariables via the RenderDashboardCharts ref
      if (performanceChartsRef.value?.commitAllVariables) {
        performanceChartsRef.value.commitAllVariables();
      }

      // Refresh the dashboard
      dateTimePicker.value.refresh();
    };

    const onDataZoom = (event: any) => {
      const selectedDateObj = {
        start: new Date(event.start),
        end: new Date(event.end),
      };
      // Truncate seconds and milliseconds from the dates
      selectedDateObj.start.setMilliseconds(0);
      selectedDateObj.end.setMilliseconds(0);

      // Compare the truncated dates
      if (selectedDateObj.start.getTime() === selectedDateObj.end.getTime()) {
        // Increment the end date by 1 minute
        selectedDateObj.end.setMinutes(selectedDateObj.end.getMinutes() + 1);
      }

      // Update the selected date to trigger time range change
      dateTimePicker?.value?.setCustomDate("absolute", selectedDateObj);

      dateTimePicker.value.refresh();
    };

    // ------- work with query params ----------
    onActivated(async () => {
      const params = route.query;

      if (params.refresh) {
        refreshInterval.value = parseDuration(params.refresh);
      }

      // This is removed due to the bug of the new date time component
      // and is now rendered when the setup method is called
      // instead of onActivated
      // if (params.period || (params.to && params.from)) {
      //   selectedDate.value = getSelectedDateFromQueryParams(params);
      // }

      // resize charts if needed
      await nextTick();
      window.dispatchEvent(new Event("resize"));
    });

    // whenever the refreshInterval is changed, update the query params
    watch([refreshInterval, selectedDate], () => {
      router.replace({
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder,
          refresh: generateDurationLabel(refreshInterval.value),
          ...getQueryParamsForDuration(selectedDate.value),
        },
      });
    });

    const onDeletePanel = async (panelId: any) => {
      await deletePanel(
        store,
        route.query.dashboard,
        panelId,
        route.query.folder ?? "default",
      );
      await loadDashboard();
    };

    return {
      currentDashboardData,
      t,
      getDashboard,
      store,
      // date variables
      dateTimePicker,
      selectedDate,
      currentTimeObj,
      refreshInterval,
      // ----------------
      refreshData,
      onDataZoom,
      onDeletePanel,
      onVariablesManagerReady,
      showDashboardSettingsDialog,
      openSettingsDialog,
      loadDashboard,
      getQueryParamsForDuration,
      tabs,
      activePerformanceTab,
      activePerformanceComponent,
      isVariablesChanged,
    };
  },
});
</script>

<style lang="scss" scoped>
.performance_title {
  font-size: 1.5rem;
}
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}

.performance-dashboard {
  :deep(.card-container) {
    box-shadow: none !important;
    &:first-child {
      padding: 0 !important;
    }
  }
}

:deep(.app-performance-auto-refresh-interval) {
  .q-btn {
    height: 1.9rem !important;
    min-height: 1.9rem !important;
    border-radius: 0.375rem !important;
    padding: 0.125rem 0.25rem !important;

    &:hover {
      background-color: var(--o2-hover-accent);
    }
  }
}
</style>

<style lang="scss">
.performance-dashboard {
  min-height: auto !important;
  max-height: calc(100vh - 12.5rem);
  overflow-y: auto;

  .card-container {
    box-shadow: none !important;
    &:only-child {
      padding: 0 !important;
    }
  }
}
</style>
