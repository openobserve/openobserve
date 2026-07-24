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
  <div data-test="performance-error-dashboard" class="rounded-default relative-position">
    <div
      class="max-h-[calc(100vh-200px)] min-h-0! overflow-y-auto"
      :class="isLoading.length ? 'invisible' : 'visible'"
    >
      <div class="performance-dashboard">
        <RenderDashboardCharts
          ref="errorRenderDashboardChartsRef"
          :viewOnly="true"
          :frame="false"
          :dashboardData="currentDashboardData.data"
          :currentTimeObj="dateTime"
          searchType="RUM"
          @variablesManagerReady="onVariablesManagerReady"
          @updated:data-zoom="onDataZoom"
        />
      </div>
    </div>
    <div
      v-show="isLoading.length"
      class="absolute top-0 flex h-[calc(100vh-15.625rem)] w-full items-center justify-center pb-4 text-center"
    >
      <div>
        <OSpinner size="md" class="mx-auto block" />
        <div class="w-full text-center">{{ t("rum.loadingDashboard") }}</div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, onActivated, onMounted, nextTick, type Ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { reactive } from "vue";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import errorDashboard from "@/utils/rum/errors.json";
import { convertDashboardSchemaVersion } from "../../../utils/dashboard/convertDashboardSchemaVersion";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

export default defineComponent({
  name: "ErrorsDashboard",
  components: {
    RenderDashboardCharts,
    OSpinner,
  },
  props: {
    dateTime: {
      type: Object,
      default: () => ({}),
    },
    selectedDate: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ["variablesManagerReady"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const currentDashboardData = reactive({
      data: {},
    });
    const showDashboardSettingsDialog = ref(false);
    const viewOnly = ref(true);
    const errorsByView = ref([]);
    const variablesData = ref({ isVariablesLoading: true, values: [] });
    const errorRenderDashboardChartsRef = ref(null);

    const refDateTime: any = ref(null);
    const refreshInterval = ref(0);
    const isLoading: Ref<boolean[]> = ref([]);

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

    // Variables manager event handler - pass through to parent
    const onVariablesManagerReady = (manager: any) => {
      emit("variablesManagerReady", manager);
    };

    const columns = [
      {
        name: "url",
        label: t("rum.viewURL"),
        field: (row) => row["url"],
        align: "left",
      },
      {
        name: "error_count",
        label: t("rum.errorCount"),
        field: (row: any) => row["error_count"],
        align: "left",
        sortable: true,
        style: { width: "56px" },
      },
    ];

    const loadDashboard = async () => {
      // schema migration
      currentDashboardData.data = convertDashboardSchemaVersion(errorDashboard);

      // if variables data is null, set it to empty list
      if (
        !(currentDashboardData.data?.variables && currentDashboardData.data?.variables?.list.length)
      ) {
        if (variablesData.value) {
          variablesData.value.isVariablesLoading = false;
          variablesData.value.values = [];
        }
      }
    };

    const addSettingsData = () => {
      showDashboardSettingsDialog.value = true;
    };

    // Handle data zoom from chart interactions
    const onDataZoom = (event: any) => {
      // Update the dateTime prop to trigger parent to update time range
      emit("update:dateTime", event);
    };

    return {
      currentDashboardData,
      t,
      store,
      refDateTime,
      refreshInterval,
      viewOnly,
      variablesData,
      onVariablesManagerReady,
      addSettingsData,
      showDashboardSettingsDialog,
      loadDashboard,
      columns,
      errorsByView,
      errorRenderDashboardChartsRef,
      isLoading,
      updateLayout,
      onDataZoom,
    };
  },
});
</script>
