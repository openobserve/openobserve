<!-- Copyright 2022 Zinc Labs Inc. and Contributors

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
  <q-page class="q-pa-md">
    <div class="flex justify-between items-center q-pa-sm">
      <div class="q-table__title q-mr-md">{{ t("panel.editPanel") }}</div>
      <div class="flex items-baseline q-gutter-sm">
        <date-time
          ref="refDateTime"
          v-model="dateVal"
          @update:date="dateChange"
        />
        <q-btn
          class="q-ml-md q-mb-xs text-bold"
          outline
          padding="sm lg"
          color="red"
          no-caps
          :label="t(`Discard`)"
          @click="goBacToDashboardList"
        />
        <q-btn
          class="q-ml-md q-mb-xs text-bold"
          outline
          padding="sm lg"
          color="white"
          text-color="black"
          no-caps
          :label="t(`Save`)"
          @click="savePanelOnClick"
        />
        <q-btn
          class="q-ml-md q-mb-xs text-bold no-border"
          padding="sm lg"
          color="secondary"
          no-caps
          :label="t(`Apply`)"
          @click="runQuery"
        />
      </div>
    </div>
    <q-separator></q-separator>
    <div class="row" style="minheight: 82vh">
      <div class="col-9">
        <div style="marginleft: -45px; minheight: 45vh">
          <div v-if="vizualizationType === 'BarChart'">
            <ReactiveBarChart
              ref="plotChart"
              :data="plotData"
              @updated:chart="onChartUpdate"
            ></ReactiveBarChart>
          </div>
          <div v-else-if="vizualizationType === 'TimeSeries'">
            <ReactiveLineChart
              ref="plotChart"
              :data="plotData"
              @updated:chart="onChartUpdate"
            />
          </div>
          <div id="tableCustom1" v-else-if="vizualizationType === 'Table'">
            <ReactiveTableChart
              ref="plotChart"
              :data="plotData"
              @updated:chart="onChartUpdate"
            />
          </div>
          <div v-else-if="vizualizationType === 'Stat'">
            <ReactiveTableChart
              ref="plotChart"
              :data="plotData"
              @updated:chart="onChartUpdate"
            />
          </div>
          <div v-else>
            <!-- <ReactiveTableChart
              ref="plotChart"
              :data="plotData"
              @updated:chart="onChartUpdate"
            /> -->
          </div>
        </div>
        <q-separator></q-separator>

        <q-tabs v-model="panelTab" class="text-teal" align="left">
          <q-tab name="query" :label="t(`Query`)" no-caps />
          <q-tab name="transform" :label="t(`Transform`)" no-caps />
          <q-tab name="alert" :label="t(`Alert`)" no-caps />
        </q-tabs>

        <q-tab-panels v-model="panelTab" animated>
          <q-tab-panel name="query">
            <div class="q-col-gutter-xs" style="width: 100%, height:50%"></div>
            <div class="q-pa-md" style="max-width: 800px">
              <q-input
                v-model="queryText"
                ref="queryTextA"
                filled
                clearable
                autogrow
                color="green-8"
                label="Please provide SQL Query for Visualization"
                hint="Press Apply Button to complete query preview"
              />
            </div>
            <div>
              <q-h3 no-caps:label="getDashboard"></q-h3></div
          ></q-tab-panel>
          <q-tab-panel name="transform"> </q-tab-panel>
          <q-tab-panel name="alert"> </q-tab-panel>
        </q-tab-panels>
      </div>

      <q-separator vertical class="col-shrink" style="width: 1px"></q-separator>

      <div class="col q-pa-md">
        <q-select
          dense
          outlined
          v-model="vizualizationType"
          :options="options"
          label="Type of Visualization"
          @update:model-value="(value) => selectVizualization(value)"
        />

        <q-expansion-item
          switch-toggle-side
          :label="t(`Panel Option`)"
          class="q-mt-md"
        >
          <q-form ref="adddashboardForm" class="q-pl-md">
            <!-- <q-input
              v-if="beingUpdated"
              v-model="dashboardData.id"
              :readonly="beingUpdated"
              :disabled="beingUpdated"
              :label="t('panel.id')"
            /> -->
            <q-input
              v-model="panelName"
              :label="t('panel.name') + '*'"
              class="q-py-md showLabelOnTop"
              stack-label
              filled
              dense
            />
            <q-input
              v-model="panelDesc"
              type="textarea"
              :label="t('panel.typeDesc') + '*'"
              class="q-py-md showLabelOnTop"
              stack-label
              filled
              dense
            />
          </q-form>
        </q-expansion-item>
      </div>
    </div>
  </q-page>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, watch, unref, toRaw, onMounted } from "vue";
import { useStore } from "vuex";
import { useQuasar, date } from "quasar";

import { useI18n } from "vue-i18n";
import * as Plotly from "plotly.js";
import {
  getCurrentDashboard,
  getCurrentPanel,
  updateAllDashboardsFromBackend,
  setCurrentPanelToDashboardList,
  getDateConsumableDateTime,
  modifySQLQuery,
} from "../utils/commons.ts";

import queryService from "../services/nativequery";
import ReactiveLineChart from "../components/shared/plotly/linechart.vue";
import ReactiveBarChart from "../components/shared/plotly/barchart.vue";
import ReactiveTableChart from "../components/shared/plotly/tablechart.vue";
import DateTime from "../plugins/logs/DateTime.vue";
import { useRouter } from "vue-router";

export default defineComponent({
  name: "PageOrganization",
  components: {
    ReactiveLineChart,
    ReactiveBarChart,
    ReactiveTableChart,
    DateTime,
  },
  setup() {
    const { t } = useI18n();
    const $q = useQuasar();
    const selectedPerPage = ref<number>(20);
    const router = useRouter();
    const plotChart: any = ref({});
    // let visualizationSelector = "";
    const store = useStore();
    const queryTextA: any = "";
    const plotData: any = ref(null);
    const refDateTime: any = ref(null);
    let currentTimeObj = {};
    const pagination: any = ref({
      rowsPerPage: 20,
    });
    const queryText = ref(null);
    const vizualizationType = ref("BarChart");

    const dateVal = ref({
      tab: "relative",
      startDate: "",
      startTime: "",
      endDate: "",
      endTime: "",

      selectedRelativePeriod: "Minutes",
      selectedRelativeValue: 15,
      selectedFullTime: false,
    });
    const panelTab = ref("query");
    const panelName = ref("");
    const panelDesc = ref("");

    // when the datetime filter changes then update the results
    watch(dateVal.value, () => {
      if (dateVal.value) {
        dateChange(dateVal);
      }
    });

    const dateChange = (dateValue: any) => {
      const c = toRaw(unref(dateValue));
      currentTimeObj = getDateConsumableDateTime(c);
      return currentTimeObj;
      // const b = moment(String(currentTimeObj.start_time)).format('YYYY-MM-DDThh:mm:ssZ')
    };

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
    };

    const runQuery = () => {
      const chartParams = {
        title: "Found " + "2" + " hits in " + "10" + " ms",
      };

      currentTimeObj = dateChange(dateVal);

      const sqlQueryModified = modifySQLQuery(currentTimeObj, queryText.value);

      const query = { query: { sql: sqlQueryModified, sql_mode: "full" } };
      queryService
        .runquery(query, store.state.selectedOrganization.identifier)
        .then((res) => {
          if (vizualizationType.value === "Table") {
            const header_vals = Object.keys(res.data.hits[0]);
            let data_vals = [];
            let obj = {};
            let key = "";
            for (obj in res.data.hits) {
              let partobject = [];
              for (key in header_vals) {
                partobject.push(res.data.hits[obj][header_vals[key]]);
              }
              data_vals.push(partobject);
              partobject = [];
            }
            let output = data_vals[0].map((_, colIndex) =>
              data_vals.map((row) => row[colIndex])
            );
            const styledHeader = header_vals.map(
              (header) => "<b>" + header + "</b>"
            );
            const columnColor = output[0].map((col, index) => {
              if (index % 2 == 0) {
                return "#FFF";
              } else {
                return "#C9CCE6";
              }
            });
            plotData.value = {
              id: 1,
              type: "table",
              header: {
                values: styledHeader,
                align: "center",
                height: 30,
                line: { width: 1, color: "black" },
                fill: { color: "#7A80C2" },
                font: { family: "Arial", size: 14, color: "white" },
              },
              cells: {
                values: output,
                align: "center",
                height: 25,
                line: { color: "black", width: 1 },
                fill: { color: [columnColor] },
                font: { family: "Arial", size: 11, color: ["black"] },
              },
            };
          } else {
            let x_data = [];
            let y_data = [];
            res.data.hits.map((data: any) => {
              x_data.push(data.x_axis);
              y_data.push(data.y_axis);
            });
            plotData.value = {
              id: 1,
              x: x_data,
              y: y_data,
              chartParams: chartParams,
            };
          }
          $q.notify({
            type: "positive",
            message: "Query applied successfully.",
            timeout: 5000,
          });
        })
        .catch((error) => {
          $q.notify({
            type: "negative",
            message: "Something went wrong!",
            timeout: 5000,
          });
        });
    };
    const goBack = () => {
      return router.push("/dashboard");
    };

    const selectVizualization = (value) => {
      vizualizationType.value = value;
      // visualizationSelector = value;
    };

    const getDashboard = () => {
      return this.$route.query.dashboard;
    };

    const renderCurrentPanel = async (currentPanel) => {
      vizualizationType.value = currentPanel.type || "BarChart";
      queryText.value = currentPanel?.query?.[0];
      panelName.value = currentPanel?.name || "";
      panelDesc.value = currentPanel?.title || "";
      if (queryText.value) await runQuery();
    };

    const onChartUpdate = ({ start, end }: { start: any; end: any }) => {
      emit("updated:dates", { start, end });
    };

    const savePanelChangesToDashboard = async (
      dashId: String,
      panelId: String
    ) => {
      await updateAllDashboardsFromBackend(store);
      let modDashboardObject = toRaw(store.state.currentSelectedDashboard);
      let dashboardList = toRaw(store.state.allCurrentDashboards);

      const currentDashboard = await getCurrentDashboard(store, dashId);
      const currentPanel = await getCurrentPanel(store, dashId, panelId);

      currentTimeObj = dateChange(dateVal);
      const sqlQueryModified = modifySQLQuery(currentTimeObj, queryText.value);

      const maxI =
        currentDashboard.layouts?.length > 0
          ? Math.max(...currentDashboard.layouts?.map((obj) => obj.i))
          : 0;
      const maxY =
        currentDashboard.layouts?.length > 0
          ? Math.max(...currentDashboard.layouts?.map((obj) => obj.y))
          : 0;

      const newLayoutObj = {
        x: 0,
        y: currentDashboard.layouts?.length > 0 ? maxY + 10 : 0,
        w: 12,
        h: 12,
        i: maxI + 1,
        panelId: panelId,
        static: false,
      };
      const panelObject2 = {
        id: panelId,
        query: [sqlQueryModified],
        title: panelDesc.value,
        type: vizualizationType.value,
        name: panelName.value,
      };
      setCurrentPanelToDashboardList(
        dashboardList,
        dashId,
        panelId,
        panelObject2,
        store,
        newLayoutObj
      );
      return router.push({
        path: "/viewDashboard",
        query: { dashboard: dashId },
      });
    };

    return {
      t,
      goBack,
      queryText,
      currentTimeObj,
      savePanelChangesToDashboard,
      onChartUpdate,
      selectVizualization,
      // getVizualizationSelector,
      plotChart,
      plotData,
      runQuery,
      store,
      getDashboard,
      vizualizationType,
      queryTextA,
      // visualizationSelector,
      filterQuery: ref(""),
      renderCurrentPanel,
      refDateTime,
      dateVal,
      dateChange,
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
      model: ref(null),
      options: ["TimeSeries", "BarChart", "Table"],
      panelTab,
      panelName,
      panelDesc,
    };
  },
  methods: {
    goBacToDashboardList(evt, row) {
      this.goBack();
    },
    selectVizualization() {
      this.selectVizualization();
    },
    savePanelOnClick() {
      this.savePanelChangesToDashboard(
        this.$route.query.dashboard,
        this.$route.query.panelId
      );
    },
  },
  activated() {
    const dashboardList = toRaw(this.store.state.allCurrentDashboards);
    let currentPanel = {};
    for (const dashboard of dashboardList) {
      if (this.$route.query.dashboard === dashboard.name) {
        for (const panel of JSON.parse(toRaw(dashboard.details)).panels) {
          if (this.$route.query.panelId === panel.id) {
            currentPanel = panel;
          }
        }
      }
    }
    this.renderCurrentPanel(currentPanel);
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
