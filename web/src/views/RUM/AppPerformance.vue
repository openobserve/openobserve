<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <q-page :key="store.state.selectedOrganization.identifier">
    <div class="flex justify-between items-center q-py-sm q-px-md">
      <div class="performance_title">Performance Summary</div>
      <div class="flex items-center">
        <DateTimePickerDashboard
          class="q-ml-sm"
          ref="dateTimePicker"
          v-model="selectedDate"
        />
        <AutoRefreshInterval
          v-model="refreshInterval"
          trigger
          @trigger="refreshData"
        />
        <q-btn
          class="q-ml-sm"
          outline
          padding="xs"
          no-caps
          icon="refresh"
          @click="refreshData"
        >
        </q-btn>
      </div>
    </div>
    <AppTabs
      class="q-px-md"
      :tabs="tabs"
      v-model:active-tab="activePerformanceTab"
    />
    <q-separator></q-separator>
    <router-view v-slot="{ Component }">
      <keep-alive>
        <component
          :is="Component"
          :date-time="currentTimeObj"
          :selected-date="selectedDate"
        />
      </keep-alive>
    </router-view>
  </q-page>
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

export default defineComponent({
  name: "AppPerformance",
  components: {
    AutoRefreshInterval,
    AppTabs,
    DateTimePickerDashboard,
  },
  setup() {
    const activePerformanceTab = ref("overview");
    const { performanceState } = usePerformance();
    const tabs = [
      {
        label: "Overview",
        value: "overview",
        style: {
          width: "fit-content",
          padding: "8px 12px",
          margin: "0px 4px",
        },
      },
      {
        label: "Web Vitals",
        value: "web_vitals",
        style: {
          width: "fit-content",
          padding: "8px 12px",
          margin: "0px 4px",
        },
      },
      {
        label: "Errors",
        value: "errors",
        style: {
          width: "fit-content",
          padding: "8px 12px",
          margin: "0px 4px",
        },
      },
      {
        label: "API",
        value: "api",
        style: {
          width: "fit-content",
          padding: "8px 12px",
          margin: "0px 4px",
        },
      },
    ];

    const routeName = computed(() => router.currentRoute.value.name);

    onMounted(async () => {
      console.log(
        "onMounted ----------",
        routeName.value,
        activePerformanceTab.value
      );

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
      }
    );

    const { t } = useI18n();
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

      setTimeout(() => {
        router.push({
          name: routeNames[activePerformanceTab.value],
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
            refresh: generateDurationLabel(refreshInterval.value),
            ...getQueryParamsForDuration(selectedDate.value),
          },
        });
      }, 500);
    };

    watch(
      () => routeName.value,
      () => updateTabOnRouteChange()
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

    // variables data
    const variablesData = reactive({});
    const variablesDataUpdated = (data: any) => {
      Object.assign(variablesData, data);
      const variableObj = {};
      data.values.forEach((v) => {
        variableObj[`var-${v.name}`] = v.value;
      });
      router.replace({
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder,
          refresh: generateDurationLabel(refreshInterval.value),
          ...getQueryParamsForDuration(selectedDate.value),
          ...variableObj,
        },
      });
    };

    // ======= [START] default variable values

    const initialVariableValues = {};
    Object.keys(route.query).forEach((key) => {
      if (key.startsWith("var-")) {
        const newKey = key.slice(4);
        initialVariableValues[newKey] = route.query[key];
      }
    });
    // ======= [END] default variable values

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
        start_time: new Date(selectedDate.value.startTime),
        end_time: new Date(selectedDate.value.endTime),
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
        route.query.folder ?? "default"
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
      onDeletePanel,
      variablesData,
      variablesDataUpdated,
      showDashboardSettingsDialog,
      openSettingsDialog,
      loadDashboard,
      initialVariableValues,
      getQueryParamsForDuration,
      tabs,
      activePerformanceTab,
    };
  },
});
</script>

<style lang="scss" scoped>
.performance_title {
  font-size: 24px;
}
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}
</style>

<style lang="scss">
.performance-dashboard {
  min-height: auto !important;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}
</style>
