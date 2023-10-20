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
  <q-page class="q-pa-md" :key="store.state.selectedOrganization.identifier">
    <div class="flex justify-end items-center q-pa-sm">
      <DateTimePicker
        class="q-ml-sm"
        ref="refDateTime"
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
      <ExportDashboard :dashboardId="currentDashboardData.data?.dashboardId" />
    </div>
    <q-separator></q-separator>
    <RenderDashboardCharts
      :viewOnly="viewOnly"
      :dashboardData="currentDashboardData.data"
      :currentTimeObj="currentTimeObj"
    />
    <q-dialog
      v-model="showDashboardSettingsDialog"
      position="right"
      full-height
      maximized
    >
      <DashboardSettings @refresh="loadDashboard" />
    </q-dialog>
  </q-page>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, watch, onActivated, nextTick } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import DateTimePicker from "@/components/DateTimePicker.vue";
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
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import ExportDashboard from "@/components/dashboards/ExportDashboard.vue";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";

export default defineComponent({
  name: "AppPerformance",
  components: {
    DateTimePicker,
    AutoRefreshInterval,
    ExportDashboard,
    RenderDashboardCharts,
  },
  setup() {
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
    const currentTimeObj = ref({});
    const refreshInterval = ref(0);
    const selectedDate = ref();

    // variables data
    const variablesData = reactive({});
    const variablesDataUpdated = (data: any) => {
      Object.assign(variablesData, data);
    };

    onActivated(async () => {
      await loadDashboard();
    });

    const loadDashboard = async () => {
      currentDashboardData.data = await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default"
      );
      currentDashboardData.data = data;

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

    const refreshData = () => {
      currentTimeObj.value = getConsumableDateTime(
        currentDurationSelectionObj.value
      );
    };

    watch(selectedDate, () => {
      const c = toRaw(unref(selectedDate.value));
      currentDurationSelectionObj.value = selectedDate.value;
      currentTimeObj.value = getConsumableDateTime(
        currentDurationSelectionObj.value
      );
    });

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
      currentTimeObj,
      refreshInterval,
      refreshData,
      selectedDate,
      viewOnly,
      eventLog,
      variablesData,
      variablesDataUpdated,
      addSettingsData,
      showDashboardSettingsDialog,
      loadDashboard,
    };
  },
});
</script>

<style lang="scss" scoped>
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}
</style>
