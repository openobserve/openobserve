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
        <div class="w-full text-center">{{ t("rum.loadingDashboard") }}</div>
      </div>
    </div>

    <!-- The schema read was refused, which a retry cannot change -->
    <div v-else-if="schemaForbidden" class="p-4">
      <OEmptyState
        size="compact"
        preset="no-access"
        data-test="performance-summary-schema-forbidden"
      >
        <template #title>{{ t("rum.overviewPage.pageForbiddenTitle") }}</template>
        <template #description>{{ t("rum.overviewPage.forbiddenBody") }}</template>
      </OEmptyState>
    </div>

    <!-- The schema read failed, so which panels apply is unknown -->
    <div v-else-if="schemaError" class="p-4">
      <OEmptyState size="compact" preset="load-error" data-test="performance-summary-schema-error">
        <template #title>{{ t("rum.overviewPage.schemaErrorTitle") }}</template>
        <template #description>{{ t("rum.overviewPage.schemaErrorBody") }}</template>
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            icon-left="refresh"
            data-test="performance-summary-schema-retry"
            @click="retrySchema"
          >
            {{ t("rum.overviewPage.retry") }}
          </OButton>
        </template>
      </OEmptyState>
    </div>

    <!-- Stream has no metrics this view can render (e.g. no recognised RUM fields) -->
    <OEmptyState
      v-else-if="showEmptyState && !showBrowserOverview"
      data-test="performance-summary-empty"
      size="block"
      illustration="pulse"
      :hide-action="true"
    >
      <template #title>{{ t("rum.performanceEmptyTitle") }}</template>
      <template #description>{{ t("rum.performanceEmptyDescription") }}</template>
    </OEmptyState>

    <template v-else>
      <!-- eslint-disable local/no-hardcoded-px -- mixed with vh/vw — vh tracks the window while rem tracks font-size; keep the expression unit-consistent -->
      <div class="max-h-[calc(100vh-200px)] min-h-0! overflow-y-auto">
        <!-- eslint-enable local/no-hardcoded-px -->
        <div v-if="showBrowserOverview && showMobileSection" class="px-4 pt-3">
          <OText variant="meta" data-test="performance-summary-browser-only-note">
            {{ t("rum.overviewPage.mixedBrowserNote") }}
          </OText>
        </div>
        <PerformanceOverview
          v-if="showBrowserOverview"
          :date-time="overviewDateTime"
          :schema="presentFields"
          :selected-date="overviewPicker"
        />
        <div
          v-if="!showBrowserOverview || showMobileSection"
          :class="isLoading.length ? 'invisible' : 'visible'"
        >
          <div v-if="showBrowserOverview" class="px-4 pt-4">
            <OText variant="meta" data-test="performance-summary-mobile-filters-note">
              {{ t("rum.overviewPage.mixedMobileNote") }}
            </OText>
          </div>
          <RenderDashboardCharts
            ref="performanceChartsRef"
            :viewOnly="true"
            :frame="false"
            :dashboardData="renderedDashboard"
            :currentTimeObj="dateTime"
            searchType="RUM"
            @variablesManagerReady="onVariablesManagerReady"
          />
        </div>
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
    </template>
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
  onActivated,
  computed,
  shallowRef,
  type Ref,
} from "vue";
import { isEqual } from "lodash-es";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import { useRouter } from "vue-router";
import { getDashboard, deletePanel } from "@/utils/commons.ts";
import { parseDuration, generateDurationLabel } from "@/utils/date";
import { reactive } from "vue";
import { useRoute } from "vue-router";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import overviewDashboard from "@/utils/rum/overview.json";
import useRumPerformanceTab, { rangeFromPage } from "@/composables/rum/useRumPerformanceTab";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import PerformanceOverview from "@/components/rum/performance/PerformanceOverview.vue";
import { BROWSER_ONLY_FIELDS, MOBILE_ONLY_FIELDS } from "@/composables/rum/useRumPlatforms";
import { keepPlatformPanels } from "@/utils/rum/dashboardCapability";

export default defineComponent({
  name: "PerformanceSummary",
  components: {
    RenderDashboardCharts,
    OSpinner,
    OEmptyState,
    OButton,
    OText,
    PerformanceOverview,
  },
  props: {
    dateTime: {
      type: Object,
      default: () => ({}),
    },
    selectedDate: {
      type: Object,
      default: null,
    },
  },
  emits: ["variablesManagerReady"],
  setup(props, { emit }) {
    // onMounted(async () => {
    //   await loadDashboard();
    // });

    const performanceChartsRef = ref(null);
    const isLoading: Ref<boolean[]> = ref([]);

    // Panels the stream cannot serve are dropped; see docs/designs/MOBILE_RUM_ADAPTIVE_UI_DESIGN.md.
    const pageRange = computed(() => rangeFromPage(props.dateTime));
    const {
      dashboardData,
      schemaResolved,
      schemaError,
      schemaForbidden,
      presentFields,
      platforms,
      showEmptyState,
      wasFiltered,
      ensureRumSchema,
    } = useRumPerformanceTab(overviewDashboard, pageRange);

    const hasAny = (fields: string[]) =>
      !presentFields.value || fields.some((f) => presentFields.value.has(f));

    // With no platform data in range, the schema decides: browser-only fields mean the overview shows its empty state.
    const schemaIsBrowserOnly = computed(
      () =>
        !!presentFields.value &&
        BROWSER_ONLY_FIELDS.some((f) => presentFields.value.has(f)) &&
        !MOBILE_ONLY_FIELDS.some((f) => presentFields.value.has(f)),
    );
    const showBrowserOverview = computed(() => {
      const p = platforms.value;
      if (!p) return hasAny(BROWSER_ONLY_FIELDS);
      return p.hasBrowser || (!p.hasMobile && schemaIsBrowserOnly.value);
    });
    const showMobileSection = computed(
      () =>
        showBrowserOverview.value &&
        (platforms.value
          ? platforms.value.hasMobile
          : !!presentFields.value && MOBILE_ONLY_FIELDS.some((f) => presentFields.value.has(f))),
    );
    const nextDashboard = computed(() =>
      showBrowserOverview.value
        ? keepPlatformPanels(dashboardData.value, "mobile")
        : dashboardData.value,
    );
    // Equal content keeps one reference, so the probe landing does not make the charts requery.
    const renderedDashboard = shallowRef(nextDashboard.value);
    watch(nextDashboard, (next) => {
      if (!isEqual(next, renderedDashboard.value)) renderedDashboard.value = next;
    });
    const overviewDateTime = pageRange;
    const overviewPicker = computed(() => props.selectedDate);
    const retrySchema = () => {
      schemaResolved.value = false;
      ensureRumSchema();
    };

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

    const { t } = useI18nTyped();
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
    const pickerDate = ref(getSelectedDateFromQueryParams(route.query));

    // holds the current time for the dashboard
    const currentTimeObj = ref({});

    // refresh interval v-model
    const refreshInterval = ref(0);

    // when the date changes from the picker, update the current time object for the dashboard
    watch(pickerDate, () => {
      currentTimeObj.value = {
        start_time: new Date(pickerDate.value.startTime),
        end_time: new Date(pickerDate.value.endTime),
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
    watch([refreshInterval, pickerDate], () => {
      router.replace({
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder,
          refresh: generateDurationLabel(refreshInterval.value),
          ...getQueryParamsForDuration(pickerDate.value),
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
      renderedDashboard,
      showBrowserOverview,
      showMobileSection,
      overviewDateTime,
      overviewPicker,
      schemaError,
      schemaForbidden,
      presentFields,
      retrySchema,
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
      pickerDate,
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
