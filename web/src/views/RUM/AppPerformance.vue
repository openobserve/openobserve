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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <OPageLayout
    :key="store.state.selectedOrganization.identifier"
    data-test="rum-performance-page"
    :title="t('rum.performanceSummaryLabel')"
    :subtitle="t('rum.performanceSummarySubtitle')"
    title-data-test="rum-performance-title"
    icon="speed"
    bleed
  >
    <template #actions>
      <DateTimePickerDashboard
        class="rum-date-time-picker"
        ref="dateTimePicker"
        v-model="selectedDate"
        menu-align="end"
      />
      <AutoRefreshInterval
        v-model="refreshInterval"
        :min-refresh-interval="store.state?.zoConfig?.min_auto_refresh_interval || 5"
        trigger
        class="app-performance-auto-refresh-interval"
        @trigger="refreshData"
      />
      <OButton
        icon-left="refresh"
        :variant="isVariablesChanged ? 'ghost-warning' : 'outline'"
        size="icon-toolbar"
        data-test="rum-performance-refresh"
        @click="refreshData"
      >
        <OTooltip
          :content="
            isVariablesChanged
              ? t('dashboard.refreshToApplyVariableChanges')
              : t('dashboard.refresh')
          "
        />
      </OButton>
    </template>
    <OTabs
      class="px-page-edge border-border-default shrink-0 border-b"
      v-model="activePerformanceTab"
      align="left"
      dense
    >
      <OTab v-for="tab in tabs" :key="tab.value" :name="tab.value" :label="tab.label" />
    </OTabs>

    <router-view v-slot="{ Component }">
      <keep-alive>
        <div class="min-h-0 flex-1">
          <div class="bg-card-glass-bg h-full overflow-hidden">
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
  </OPageLayout>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, watch, onMounted, nextTick, computed, onActivated } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { getDashboard } from "@/utils/commons.ts";
import { parseDuration, generateDurationLabel } from "@/utils/date";
import { reactive } from "vue";
import { useRoute } from "vue-router";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import overviewDashboard from "@/utils/rum/overview.json";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import usePerformance from "@/composables/rum/usePerformance";
import useRum from "@/composables/rum/useRum";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";

export default defineComponent({
  name: "AppPerformance",
  components: {
    AutoRefreshInterval,
    OTabs,
    OTab,
    DateTimePickerDashboard,
    OButton,
    OTooltip,
    OPageLayout,
  },
  setup() {
    const { t } = useI18n();

    const activePerformanceTab = ref("overview");
    const activePerformanceComponent = ref(null);
    const { performanceState } = usePerformance();
    useRum();

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
      { label: t("rum.overview"), value: "overview" },
      { label: t("rum.webVitals"), value: "web_vitals" },
      { label: t("rum.errors"), value: "errors" },
      { label: t("rum.api"), value: "api" },
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
        activePerformanceTab.value = routeNameMapping[router.currentRoute.value.name];
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
        !(currentDashboardData.data?.variables && currentDashboardData.data?.variables?.list.length)
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

      const tab = routeNameMapping[router.currentRoute.value.name?.toString() || "placeholder"];
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
      valueType: params.period ? "relative" : params.from && params.to ? "absolute" : "relative",
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
      await deletePanel(store, route.query.dashboard, panelId, route.query.folder ?? "default");
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
