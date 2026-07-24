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
  <div class="relative-position">
    <div
      class="max-h-[calc(100vh-200px)] min-h-0! overflow-y-auto"
      :class="isLoading.length ? 'invisible' : 'visible'"
    >
      <RenderDashboardCharts
        ref="performanceChartsRef"
        :viewOnly="true"
        :frame="false"
        :dashboardData="currentDashboardData.data"
        :currentTimeObj="dateTime"
        searchType="RUM"
        @variablesManagerReady="onVariablesManagerReady"
      >
        <template v-slot:before_panels>
          <div class="flex items-center pt-3 text-base font-bold font-medium">
            <div class="w-[25%] text-center">
              {{ t("rum.webVitalsLabel") }}
            </div>
            <div class="w-[25%] text-center">
              {{ t("rum.errorLabel") }}
            </div>
            <div class="w-[25%] text-center">
              {{ t("rum.sessionLabel") }}
            </div>
          </div>
        </template>
      </RenderDashboardCharts>
    </div>
    <div
      v-show="isLoading.length"
      class="absolute top-0 flex h-[calc(100vh-15.625rem)] w-full items-center justify-center pb-4 text-center"
    >
      <div>
        <OSpinner
          size="md"
          class="mx-auto block"
          data-test="performance-summary-loading-indicator"
        />
        <div class="w-full text-center">{{ t("rum.loadingDashboard") }}</div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, watch, onMounted, nextTick, onActivated, type Ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { getDashboard, deletePanel } from "@/utils/commons.ts";
import { parseDuration, generateDurationLabel } from "@/utils/date";
import { reactive } from "vue";
import { useRoute } from "vue-router";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import overviewDashboard from "@/utils/rum/overview.json";
import { convertDashboardSchemaVersion } from "../../../utils/dashboard/convertDashboardSchemaVersion";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

export default defineComponent({
  name: "PerformanceSummary",
  components: {
    RenderDashboardCharts,
    OSpinner,
  },
  props: {
    dateTime: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ["variablesManagerReady"],
  setup(props, { emit }) {
    // onMounted(async () => {
    //   await loadDashboard();
    // });

    const performanceChartsRef = ref(null);
    const isLoading: Ref<boolean[]> = ref([]);

    onMounted(async () => {
      await loadDashboard();
    });

    onActivated(() => {
      updateLayout();
    });

    const updateLayout = async () => {
      await nextTick();
      window.dispatchEvent(new Event("resize"));
    };

    const loadDashboard = async () => {
      // schema migration
      currentDashboardData.value.data = convertDashboardSchemaVersion(overviewDashboard);

      // if variables data is null, set it to empty list

      if (
        !(
          currentDashboardData.value.data?.variables &&
          currentDashboardData.value.data?.variables?.list.length
        )
      ) {
        variablesData.isVariablesLoading = false;
        variablesData.values = [];
      }
    };

    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const store = useStore();
    const currentDashboardData = ref({
      data: {},
    });

    // boolean to show/hide settings sidebar
    const showDashboardSettingsDialog = ref(false);

    // variables data
    const variablesData = reactive({});
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
    watch(selectedDate, () => {
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

    // [END] date picker related variables

    // back button to render dashboard List page
    const goBackToDashboardList = () => {
      return router.push({
        path: "/dashboards",
        query: {
          dashboard: route.query.dashboard,
          folder: route.query.folder ?? "default",
        },
      });
    };

    //add panel
    const addPanelData = () => {
      return router.push({
        path: "/dashboards/add_panel",
        query: {
          dashboard: route.query.dashboard,
          folder: route.query.folder ?? "default",
        },
      });
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
      await deletePanel(store, route.query.dashboard, panelId, route.query.folder ?? "default");
      await loadDashboard();
    };

    // Variables manager event handler - pass through to parent
    const onVariablesManagerReady = (manager: any) => {
      emit("variablesManagerReady", manager);
    };

    return {
      currentDashboardData,
      goBackToDashboardList,
      addPanelData,
      t,
      getDashboard,
      store,
      // date variables
      dateTimePicker,
      selectedDate,
      currentTimeObj,
      refreshInterval,
      refreshData,
      onDeletePanel,
      variablesData,
      onVariablesManagerReady,
      showDashboardSettingsDialog,
      openSettingsDialog,
      loadDashboard,
      getQueryParamsForDuration,
      performanceChartsRef,
      isLoading,
      updateLayout,
      getSelectedDateFromQueryParams,
    };
  },
});
</script>
