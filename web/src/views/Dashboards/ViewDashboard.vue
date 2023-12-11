<!-- Copyright 2023 Zinc Labs Inc.

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
  <q-page class="q-pa-md" :key="store.state.selectedOrganization.identifier">
    <div class="flex justify-between items-center q-pa-sm">
      <div class="flex">
        <q-btn
          no-caps
          @click="goBackToDashboardList"
          padding="xs"
          outline
          icon="arrow_back_ios_new"
        />
        <span class="q-table__title q-mx-md q-mt-xs">{{
          currentDashboardData.data.title
        }}</span>
      </div>
      <div class="flex">
        <q-btn
          outline
          padding="xs"
          no-caps
          icon="add"
          @click="addPanelData"
          data-test="dashboard-panel-add"
        >
          <q-tooltip>{{ t("panel.add") }}</q-tooltip>
        </q-btn>
        <q-btn
          outline
          padding="xs"
          class="q-ml-sm"
          no-caps
          icon="settings"
          @click="openSettingsDialog"
        >
          <q-tooltip>{{ t("dashboard.setting") }}</q-tooltip>
        </q-btn>
        <!-- <DateTimePicker 
          class="q-ml-sm"
          ref="refDateTime"
          v-model="selectedDate"
        /> -->
        <DateTimePickerDashboard
          ref="dateTimePicker"
          class="q-ml-sm"
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
        <ExportDashboard
          :dashboardId="currentDashboardData.data?.dashboardId"
        />
      </div>
    </div>
    <q-separator></q-separator>
    <RenderDashboardCharts
      @variablesData="variablesDataUpdated"
      :initialVariableValues="initialVariableValues"
      :viewOnly="false"
      :dashboardData="currentDashboardData.data"
      :currentTimeObj="currentTimeObj"
      @onDeletePanel="onDeletePanel"
      @updated:data-zoom="onDataZoom"
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
import DateTimePicker from "../../components/DateTimePicker.vue";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import { useRouter } from "vue-router";
import { getConsumableDateTime, getDashboard } from "../../utils/commons.ts";
import { parseDuration, generateDurationLabel } from "../../utils/date";
import { toRaw, unref, reactive } from "vue";
import { useRoute } from "vue-router";
import { deletePanel } from "../../utils/commons";
import AutoRefreshInterval from "../../components/AutoRefreshInterval.vue";
import ExportDashboard from "../../components/dashboards/ExportDashboard.vue";
import DashboardSettings from "./DashboardSettings.vue";
import RenderDashboardCharts from "./RenderDashboardCharts.vue";
import VariablesValueSelector from "../../components/dashboards/VariablesValueSelector.vue";

export default defineComponent({
  name: "ViewDashboard",
  emits: ["onDeletePanel"],
  components: {
    DateTimePickerDashboard,
    AutoRefreshInterval,
    ExportDashboard,
    DashboardSettings,
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

    onActivated(async () => {
      await loadDashboard();
    });

    const loadDashboard = async () => {
      currentDashboardData.data = await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default"
      );

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
    watch(selectedDate, () => {
      console.log("selected date time updated: ", convertDateToReadableFormat(selectedDate.value));
      currentTimeObj.value = {
        start_time: new Date(selectedDate.value.startTime),
        end_time: new Date(selectedDate.value.endTime),
      };
    });

    const convertDateToReadableFormat = (date) => {
      const convertTimestamp = (timestampInMicro: number) => {
        return new Date(timestampInMicro / 1000).toLocaleString("en-US");
      }

      return (convertTimestamp(date.startTime) + " - " + convertTimestamp(date.endTime));
    };

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

    const onDataZoom = (event: any) => {
      dateTimePicker?.value?.setCustomDate("absolute", event);
    }

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
      onDataZoom
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
