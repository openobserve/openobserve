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
    <!-- Resolving the _rumdata schema before deciding which panels can run -->
    <div
      v-if="!schemaResolved"
      data-test="errors-dashboard-schema-loading"
      class="flex h-[calc(100vh-15.625rem)] w-full items-center justify-center pb-4 text-center"
    >
      <div>
        <OSpinner size="md" class="mx-auto block" />
        <div class="w-full text-center">Loading Dashboard</div>
      </div>
    </div>

    <OEmptyState
      v-else-if="showEmptyState"
      data-test="errors-dashboard-empty"
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
        <div class="performance-dashboard">
          <RenderDashboardCharts
            ref="errorRenderDashboardChartsRef"
            :viewOnly="true"
            :frame="false"
            :dashboardData="dashboardData"
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
          <div class="w-full text-center">Loading Dashboard</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, onActivated, onMounted, nextTick, type Ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import errorDashboard from "@/utils/rum/errors.json";
import useRumPerformanceTab from "@/composables/rum/useRumPerformanceTab";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

export default defineComponent({
  name: "ErrorsDashboard",
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
    selectedDate: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ["variablesManagerReady"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    // Adaptive dashboard: drops panels the stream can't serve, reflowing the survivors.
    // See docs/designs/MOBILE_RUM_ADAPTIVE_UI_DESIGN.md.
    const { dashboardData, schemaResolved, showEmptyState, ensureRumSchema } =
      useRumPerformanceTab(errorDashboard);

    const showDashboardSettingsDialog = ref(false);
    const viewOnly = ref(true);
    const errorsByView = ref([]);
    const variablesData = ref({ isVariablesLoading: true, values: [] });
    const errorRenderDashboardChartsRef = ref(null);

    const refDateTime: any = ref(null);
    const refreshInterval = ref(0);
    const isLoading: Ref<boolean[]> = ref([]);

    onMounted(() => {
      ensureRumSchema();
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

    const addSettingsData = () => {
      showDashboardSettingsDialog.value = true;
    };

    // Handle data zoom from chart interactions
    const onDataZoom = (event: any) => {
      // Update the dateTime prop to trigger parent to update time range
      emit("update:dateTime", event);
    };

    return {
      dashboardData,
      schemaResolved,
      showEmptyState,
      t,
      store,
      refDateTime,
      refreshInterval,
      viewOnly,
      variablesData,
      onVariablesManagerReady,
      addSettingsData,
      showDashboardSettingsDialog,
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
