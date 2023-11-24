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
      <div class="flex q-gutter-sm items-center">
        <!-- histogram interval for sql queries -->
        <q-select v-if="!promqlMode" v-model="histogramInterval"
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
import { parseDuration } from "@/utils/date";
import { Parser } from "node-sql-parser/build/mysql"

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
    },
    selectedDate: {
      type: Object,
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
    const { dashboardPanelData, promqlMode, resetDashboardPanelData } =
      useDashboardPanelData();
    const selectedDate = ref(JSON.parse(JSON.stringify(props.selectedDate ?? {})));
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
    const histogramInterval: any = ref("auto");

    const histogramIntervalOptions = [
      {
        label: "Auto",
        value: "auto",
      },
      {
        label: "1 second",
        value: "1 second",
      },
      {
        label: "5 seconds",
        value: "5 seconds",
      
      },
      {
        label: "10 seconds",
        value: "10 seconds",
      
      },
      {
        label: "30 seconds",
        value: "30 seconds",
      
      },
      {
        label: "1 minute",
        value: "1 minute",
      
      },
      {
        label: "5 minutes",
        value: "5 minutes",
      },
      {
        label: "10 minutes",
        value: "10 minutes",
      },
      {
        label: "30 minutes",
        value: "30 minutes",
      },
      {
        label: "1 hour",
        value: "1 hour",
      },
      {
        label: "6 hours",
        value: "6 hours",
      },
      {
        label: "12 hours",
        value: "12 hours",
      },
      {
        label: "1 day",
        value: "1 day",
      },
      {
        label: "7 days",
        value: "7 days",
      },
      {
        label: "30 days",
        value: "30 days",
      }
    ]


    watch(() => histogramInterval.value , () => {
      // replace the histogram interval in the query by finding histogram aggregation
      dashboardPanelData?.data?.queries?.forEach((query: any) => {
        const parser = new Parser();
        const ast: any = parser.astify(query?.query);
        
        // Iterate over the columns to check if the column is histogram
        ast.columns.forEach((column: any) => {

          // check if the column is histogram
          if (column.expr.type === "function" && column.expr.name === "histogram") {

            const histogramExpr = column.expr;
            if (histogramExpr.args && histogramExpr.args.type === "expr_list") {

              // if selected histogramInterval is auto then remove interval argument
              if(histogramInterval.value.value == "auto"){
                histogramExpr.args.value = histogramExpr.args.value.slice(0, 1);
              }

              // else update interval argument
              else{
                // check if there is existing interval value
                // if have then simply update
                // else insert new arg
                if(histogramExpr.args.value[1]){
                  // Update existing interval value
                  histogramExpr.args.value[1] = {
                    type: "single_quote_string",
                    value: `${histogramInterval.value.value}`
                  }
                }
                else{
                  // create new arg for interval
                  histogramExpr.args.value.push({
                    type: "single_quote_string",
                    value: `${histogramInterval.value.value}`
                  })
                }
              }
            } 
          }
          const sql = parser.sqlify(ast);
          query.query = sql.replace(/`/g, '"');  
        });
      })
      // copy the data object excluding the reactivity
      chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      // refresh the date time based on current time if relative date is selected
      dateTimePickerRef.value && dateTimePickerRef.value.refresh();
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
      promqlMode,
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