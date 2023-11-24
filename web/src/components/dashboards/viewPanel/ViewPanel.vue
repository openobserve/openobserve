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

<!-- eslint-disable vue/no-unused-components -->
<template>
  <div style="height: calc(100vh - 57px);" class="scroll">
    <div class="flex justify-between items-center q-pa-md">
      <div class="flex items-center q-table__title q-mr-md">
        <span>
          {{ dashboardPanelData.data.title }}
        </span>
      </div>
      <div class="flex q-gutter-sm">
        <q-select v-model="histogramInterval"
        label="Histogram interval"
        :options="histogramIntervalOptions" behavior="menu" filled borderless dense
        class="q-ml-sm" style="width: 150px;">
      </q-select>
        <DateTimePickerDashboard v-model="selectedDate" ref="dateTimePickerRef"/>
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
        />
        <q-btn
          no-caps
          @click="goBack"
          padding="xs"
          class="q-ml-md"
          flat
          icon="close"
        />
      </div>
    </div>
    <q-separator></q-separator>
    <div class="row" style="height: calc(100vh - 130px); overflow-y: auto">
      <div class="col" style="width: 100%; height:100%;">
            <div class="row" style="height: 100%; overflow-y: auto; ">
              <div class="col" style="height: 100%">
                    <div class="layout-panel-container col" style="height:100%;">
                      <VariablesValueSelector :variablesConfig="currentDashboardData.data?.variables"
                        :selectedTimeDate="dashboardPanelData.meta.dateTime" @variablesData="variablesDataUpdated" />
                      <div style="flex:1;">
                        <PanelSchemaRenderer :key="dashboardPanelData.data.type" :panelSchema="chartData" :selectedTimeObj="dashboardPanelData.meta.dateTime" :variablesData="variablesData" :width="6" @error="handleChartApiError"/>
                      </div>
                      <DashboardErrorsComponent :errors="errorData" />
                    </div>
              </div>
            </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  toRaw,
  nextTick,
  watch,
  reactive,
  onUnmounted,
  onMounted,
} from "vue";

import { useI18n } from "vue-i18n";
import {
  getDashboard,
  getPanel,
} from "../../../utils/commons";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import DateTimePickerDashboard from "../../../components/DateTimePickerDashboard.vue";
import DashboardErrorsComponent from "../../../components/dashboards/addPanel/DashboardErrors.vue"
import VariablesValueSelector from "../../../components/dashboards/VariablesValueSelector.vue";
import PanelSchemaRenderer from "../../../components/dashboards/PanelSchemaRenderer.vue";
import _ from "lodash-es";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import { onActivated } from "vue";
import { generateDurationLabel, parseDuration } from "@/utils/date";

export default defineComponent({
  name: "ViewPanel",
  components: {
    DateTimePickerDashboard,
    DashboardErrorsComponent,
    VariablesValueSelector,
    PanelSchemaRenderer,
    AutoRefreshInterval
  },
  props: {
    panelId: {
      type: String,
      required: true,
    }
  },
  emits: ["closePanel"],
  setup(props, { emit }) {
    // This will be used to copy the chart data to the chart renderer component
    // This will deep copy the data object without reactivity and pass it on to the chart renderer
    const chartData = ref({});
    const { t } = useI18n();
    const router = useRouter();
    const route = useRoute();
    const store = useStore();
    const { dashboardPanelData, resetDashboardPanelData } =
      useDashboardPanelData();
    const selectedDate = ref()
    const dateTimePickerRef: any = ref(null);
    const errorData: any = reactive({
      errors: []
    })
    let variablesData :any = reactive({});
    const variablesDataUpdated = (data: any) => {
      Object.assign(variablesData, data)
    }
    const currentDashboardData : any = reactive({
      data: {},
    });

    // refresh interval v-model
    const refreshInterval = ref(0);

    // histogram interval
    const histogramInterval = ref("auto");

    const histogramIntervalOptions = [
      {
        label: "Auto",
        value: "auto",
      },
      {
        label: "1 second",
        value: "1s",
      },
      {
        label: "5 seconds",
        value: "5s",
      
      },
      {
        label: "10 seconds",
        value: "10s",
      
      },
      {
        label: "30 seconds",
        value: "30s",
      
      },
      {
        label: "1 minute",
        value: "1m",
      
      },
      {
        label: "5 minutes",
        value: "5m",
      },
      {
        label: "10 minutes",
        value: "10m",
      },
      {
        label: "30 minutes",
        value: "30m",
      },
      {
        label: "1 hour",
        value: "1h",
      },
      {
        label: "6 hours",
        value: "6h",
      },
      {
        label: "12 hours",
        value: "12h",
      },
      {
        label: "1 day",
        value: "1d",
      },
      {
        label: "7 days",
        value: "7d",
      },
      {
        label: "30 days",
        value: "30d",
      }
    ]


    watch(() => histogramInterval.value , () => {
      console.log(histogramInterval.value, dashboardPanelData,"new value");
    })

    onUnmounted(async () => {
      // clear a few things
      resetDashboardPanelData();
    });

    onMounted(async () => {
      errorData.errors = []
      
      // todo check for the edit more
      if (props.panelId) {
        const panelData = await getPanel(
          store,
          route.query.dashboard,
          props.panelId,
          route.query.folder
        );
        Object.assign(dashboardPanelData.data, JSON.parse(JSON.stringify(panelData)));
        await nextTick();
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data))
        // updateDateTime(selectedDate.value)
      }
      await nextTick();
      loadDashboard();
    });

    onActivated(() =>{
      const params: any = route.query;

      if (params.refresh) {
        refreshInterval.value = parseDuration(params.refresh);
      }
    })

    const refreshData = () => {
      dateTimePickerRef.value.refresh();
    };

    const currentDashboard = toRaw(store.state.currentSelectedDashboard);

    const loadDashboard = async () => {

      let data = JSON.parse(JSON.stringify(await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default"
      )));
      currentDashboardData.data = data

      // if variables data is null, set it to empty list
      if (!(currentDashboardData.data?.variables && currentDashboardData.data?.variables?.list.length)) {
        variablesData.isVariablesLoading = false
        variablesData.values = []
      }
    };

    watch(selectedDate, () => {
      updateDateTime(selectedDate.value)
    })

    // whenever the refreshInterval is changed, update the query params
    // watch([refreshInterval, selectedDate], () => {
    //   router.replace({
    //     query: {
    //       org_identifier: store.state.selectedOrganization.identifier,
    //       dashboard: route.query.dashboard,
    //       folder: route.query.folder,
    //       refresh: generateDurationLabel(refreshInterval.value),
    //       ...getQueryParamsForDuration(selectedDate.value),
    //     },
    //   });
    // });

    const updateDateTime = (value: object) => {
      dashboardPanelData.meta.dateTime = {
        start_time: new Date(selectedDate.value.startTime),
        end_time: new Date(selectedDate.value.endTime)
      }
    };
    const goBack = () => {
      emit("closePanel");
    };

    const handleChartApiError = (errorMessage: any) => {
      const errorList = errorData.errors;
      errorList.splice(0);
      errorList.push(errorMessage);
    };
    return {
      t,
      updateDateTime,
      goBack,
      currentDashboard,
      dashboardPanelData,
      chartData,
      selectedDate,
      errorData,
      handleChartApiError,
      variablesDataUpdated,
      currentDashboardData,
      variablesData,
      dateTimePickerRef,
      refreshInterval,
      refreshData,
      histogramInterval,
      histogramIntervalOptions
    };
  }
});
</script>

<style lang="scss" scoped>
.layout-panel-container {
  display: flex;
  flex-direction: column;
}
</style>