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
    <!-- Resolving the _rumdata schema before deciding which panels can run -->
    <div
      v-if="!schemaResolved"
      data-test="performance-summary-schema-loading"
      class="flex h-[calc(100vh-15.625rem)] w-full items-center justify-center pb-4 text-center"
    >
      <div>
        <OSpinner size="md" class="mx-auto block" />
        <div class="w-full text-center">Loading Dashboard</div>
      </div>
    </div>

    <!-- Stream has no metrics this view can render (e.g. no recognised RUM fields) -->
    <OEmptyState
      v-else-if="showEmptyState"
      data-test="performance-summary-empty"
      size="block"
      illustration="pulse"
      :hide-action="true"
    >
      <template #title>{{ t("rum.performanceEmptyTitle") }}</template>
      <template #description>{{ t("rum.performanceEmptyDescription") }}</template>
    </OEmptyState>

    <template v-else>
      <div
        class="max-h-[calc(100vh-200px)] min-h-0! overflow-y-auto"
        :class="isLoading.length ? 'invisible' : 'visible'"
      >
        <RenderDashboardCharts
          ref="performanceChartsRef"
          :viewOnly="true"
          :frame="false"
          :dashboardData="dashboardData"
          :currentTimeObj="dateTime"
          searchType="RUM"
          @variablesManagerReady="onVariablesManagerReady"
        >
          <!-- Fixed column labels only make sense for the full browser layout; hide them
               once panels have been filtered out for a mobile-only stream. -->
          <template v-if="!wasFiltered" v-slot:before_panels>
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
          <div class="w-full text-center">Loading Dashboard</div>
        </div>
      </div>
    </template>
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
import useRumPerformanceTab from "@/composables/rum/useRumPerformanceTab";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

export default defineComponent({
  name: "PerformanceSummary",
  components: {
    RenderDashboardCharts,
    OSpinner,
    OEmptyState,
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

    // Adaptive dashboard: drops panels whose columns the stream can't serve (browser Web
    // Vitals for a mobile-only stream, and vice versa), reflowing the survivors. Browser
    // data renders as before. See docs/designs/MOBILE_RUM_ADAPTIVE_UI_DESIGN.md.
    const { dashboardData, schemaResolved, showEmptyState, wasFiltered, ensureRumSchema } =
      useRumPerformanceTab(overviewDashboard);

    onMounted(() => {
      // Fire-and-forget: ensureRumSchema resolves the gate independently and handles its
      // own errors.
      ensureRumSchema();
    });

    onActivated(() => {
      updateLayout();
    });

    const updateLayout = async () => {
      await nextTick();
      window.dispatchEvent(new Event("resize"));
    };

    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const store = useStore();

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
      await ensureRumSchema();
    };

    // Variables manager event handler - pass through to parent
    const onVariablesManagerReady = (manager: any) => {
      emit("variablesManagerReady", manager);
    };

    return {
      dashboardData,
      schemaResolved,
      showEmptyState,
      wasFiltered,
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
      getQueryParamsForDuration,
      performanceChartsRef,
      isLoading,
      updateLayout,
      getSelectedDateFromQueryParams,
    };
  },
});
</script>
