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
  <div class="rounded-default relative-position">
    <div
      class="performance-dashboard"
      :class="isLoading.length ? 'invisible' : 'visible'"
    >
      <div
        data-test="learn-web-vitals-link"
        class="font-bold ml-3 px-2 rounded-default mt-2 py-1 text-sm w-fit flex items-center bg-badge-indigo-soft-bg"
      >
        <OIcon
          name="info"
          size="sm"
          class="mr-1"
        />
        {{ t("rum.learnWebVitalsLabel") }}
        <a
          href="https://web.dev/articles/vitals"
          title="https://web.dev/articles/vitals"
          class="ml-1 text-badge-indigo-soft-text"
          target="_blank"
        >
          {{ t("rum.clickHereLabel") }}
        </a>
      </div>
      <RenderDashboardCharts
        ref="webVitalsChartsRef"
        :viewOnly="true"
        :frame="false"
        :dashboardData="currentDashboardData.data"
        :currentTimeObj="dateTime"
        searchType="RUM"
        @variablesManagerReady="onVariablesManagerReady"
        @updated:data-zoom="onDataZoom"
      />
    </div>
    <div
      v-show="isLoading.length"
      class="pb-4 flex items-center justify-center text-center absolute w-full h-[calc(100vh-15.625rem)] top-0"
    >
      <div>
        <OSpinner size="md" class="mx-auto block" />
        <div class="text-center w-full">Loading Dashboard</div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  ref,
  watch,
  onActivated,
  nextTick,
  onMounted,
  type Ref,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { getConsumableDateTime, getDashboard } from "@/utils/commons.ts";
import {
  parseDuration,
  generateDurationLabel,
  getDurationObjectFromParams,
  getQueryParamsForDuration,
} from "@/utils/date";
import { toRaw, unref, reactive } from "vue";
import { useRoute } from "vue-router";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import overviewDashboard from "@/utils/rum/web_vitals.json";
import { convertDashboardSchemaVersion } from "../../../utils/dashboard/convertDashboardSchemaVersion";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "WebVitalsDashboard",
  components: {
    RenderDashboardCharts,
    OSpinner,
    OIcon,
},
  props: {
    dateTime: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ["variablesManagerReady", "update:dateTime"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const store = useStore();
    const currentDashboardData = reactive({
      data: {},
    });
    const showDashboardSettingsDialog = ref(false);
    const viewOnly = ref(true);
    const eventLog = ref([]);

    const refDateTime: any = ref(null);
    const currentDurationSelectionObj = ref({});
    const refreshInterval = ref(0);
    const selectedDate = ref();
    const webVitalsChartsRef = ref(null);
    const isLoading: Ref<boolean[]> = ref([]);

    // Variables manager event handler - pass through to parent
    const onVariablesManagerReady = (manager: any) => {
      emit("variablesManagerReady", manager);
    };

    // Handle data zoom from chart interactions
    const onDataZoom = (event: any) => {
      // Update the dateTime prop to trigger parent to update time range
      emit("update:dateTime", event);
    };

    onMounted(async () => {
      await loadDashboard();
      updateLayout();
    });

    onActivated(() => {
      updateLayout();
    });

    const updateLayout = async () => {
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      // emit window resize event to trigger the layout
      window.dispatchEvent(new Event("resize"));
    };

    const loadDashboard = async () => {
      // schema migration
      currentDashboardData.data =
        convertDashboardSchemaVersion(overviewDashboard);

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

    const addSettingsData = () => {
      showDashboardSettingsDialog.value = true;
    };

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

    // ------- work with query params ----------
    onActivated(async () => {
      const params = route.query;

      if (params.refresh) {
        refreshInterval.value = parseDuration(params.refresh);
      }

      if (params.period || (params.to && params.from)) {
        selectedDate.value = getDurationObjectFromParams(params);
      }

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

    return {
      currentDashboardData,
      goBackToDashboardList,
      addPanelData,
      t,
      getDashboard,
      store,
      refDateTime,
      filterQuery: ref(""),
      filterData(rows: string | any[], terms: string) {
        const filtered = [];
        terms = terms.toLowerCase();
        for (let i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      },
      refreshInterval,
      selectedDate,
      viewOnly,
      eventLog,
      onVariablesManagerReady,
      onDataZoom,
      addSettingsData,
      showDashboardSettingsDialog,
      loadDashboard,
      webVitalsChartsRef,
      isLoading,
      updateLayout,
      router,
    };
  },
});
</script>
