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
      <div class="q-table__title q-mr-md">{{ t("dashboard.header") }}</div>
      <div class="flex items-baseline q-gutter-sm">
        <q-btn
          class="q-ml-md q-mb-xs text-bold"
          outline
          padding="sm lg"
          color="white"
          text-color="black"
          no-caps
          :label="t(`Add Panel`)"
          @click="addNewPanelOnClick"
        />
        <q-btn
          class="q-ml-md q-mb-xs text-bold no-border"
          padding="sm lg"
          color="secondary"
          no-caps
          :label="t(`Save`)"
          @click="saveDashboardOnClick"
        />
        <q-btn
          class="q-ml-md q-mb-xs text-bold"
          outline
          padding="sm lg"
          color="red"
          no-caps
          :label="t(`Delete`)"
          @click="deleteDashboardOnClick"
        />
        <q-btn
          class="q-ml-md q-mb-xs text-bold"
          padding="sm lg"
          color="white"
          no-caps
          :label="t(`Go back to Dashboard`)"
          outline
          text-color="black"
          @click="goBacToDashboardList"
        />
        <date-time
          ref="refDateTime"
          v-model="dateVal"
          @update:date="dateChange"
        />
      </div>
    </div>
    <q-separator></q-separator>
    <div class="displayDiv">
      <grid-layout
        v-if="list[0].panels.length > 0"
        v-model:layout.sync="list[0].layouts"
        :col-num="12"
        :row-height="30"
        :is-draggable="draggable"
        :isResizable="true"
        :vertical-compact="false"
        :autoSize="true"
        :use-css-transforms="true"
        @layout-created="layoutCreatedEvent"
        @layout-before-mount="layoutBeforeMountEvent"
        @layout-mounted="layoutMountedEvent"
        @layout-ready="layoutReadyEvent"
        @layout-updated="layoutUpdatedEvent"
      >
        <!-- <li v-for="item in list[0]" :key="item">
        <PanelContainer :key="item.id" ref="{{item}}" :panelDataElement="item" :dashbordId="getDashboard"
          @updated:chart="onUpdatePanel">
        </PanelContainer> -->
        <grid-item
          class="plotlyBackground"
          v-for="item in list[0].panels"
          :key="item.id"
          :x="getPanelLayout(list[0].layouts, item.id, 'x')"
          :y="getPanelLayout(list[0].layouts, item.id, 'y')"
          :w="getPanelLayout(list[0].layouts, item.id, 'w')"
          :h="getPanelLayout(list[0].layouts, item.id, 'h')"
          :i="getPanelLayout(list[0].layouts, item.id, 'i')"
          @resize="resizeEvent"
          @move="moveEvent"
          @resized="resizedEvent"
          @container-resized="containerResizedEvent"
          @moved="movedEvent"
        >
          <PanelContainer
            :key="
              getPanelLayout(list[0].layouts, item.id, 'w') +
              getPanelLayout(list[0].layouts, item.id, 'h') +
              getPanelLayout(list[0].layouts, item.id, 'y') +
              getPanelLayout(list[0].layouts, item.id, 'x')
            "
            ref="{{item}}"
            :panelDataElement="item"
            :dashboardId="getDashboard"
            @updated:chart="onUpdatePanel"
            :selectedTimeDate="currentTimeObj"
          >
          </PanelContainer>
        </grid-item>
      </grid-layout>
    </div>
    <div>
      <q-h3 no-caps:label="getDashboard"></q-h3>
    </div>
  </q-page>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, computed, watch, onMounted } from "vue";
import { useStore } from "vuex";
import { useQuasar, date, copyToClipboard } from "quasar";
import { useI18n } from "vue-i18n";

import QTablePagination from "../components/shared/grid/Pagination.vue";
import NoData from "../components/shared/grid/NoData.vue";
import ReactiveBarChart from "../components/shared/plotly/barchart.vue";
import PanelContainer from "../components/shared/plotly/panelcontainer.vue";
import dashboardService from "../services/dashboards";
import DateTime from "../plugins/logs/DateTime.vue";
import VueGridLayout from "vue3-grid-layout";

import { useRouter } from "vue-router";
import dashboards from "@/services/dashboards";
import {
  getCurrentDashboard,
  getCurrentPanel,
  deletePanelFromDashboard,
  setCurrentPanelToDashboardList,
  getDateConsumableDateTime,
} from "../utils/commons.ts";

import { isProxy, toRaw, unref } from "vue";
import { tsImportEqualsDeclaration } from "@babel/types";

export default defineComponent({
  name: "PageOrganization",
  components: {
    QTablePagination,
    ReactiveBarChart,
    PanelContainer,
    NoData,
    GridLayout: VueGridLayout.GridLayout,
    GridItem: VueGridLayout.GridItem,
    DateTime,
  },
  setup() {
    const { t } = useI18n();
    const selectedPerPage = ref<number>(20);
    const router = useRouter();
    const store = useStore();
    // let list = ref([])
    let valueList = [];
    const refDateTime: any = ref(null);
    const $q = useQuasar();
    let currentTimeObj: any = ref({});

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

    onMounted(() => {
      dateChange(dateVal);
    });

    watch(dateVal.value, () => {
      if (dateVal.value) {
        dateChange(dateVal);
      }
    });
    const dateChange = (dateValue: any) => {
      const c = toRaw(unref(dateValue));
      currentTimeObj.value = getDateConsumableDateTime(c);
    };

    const pagination: any = ref({
      rowsPerPage: 20,
    });

    const initialize = () => {};

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
    };

    const goBack = () => {
      return router.push("/dashboard");
    };

    const deleteDashboard = async (dashboardId: String) => {
      const baseObj = {};
      await dashboardService
        .delete(store.state.selectedOrganization.identifier, dashboardId)
        .then((res) => {
          $q.notify({
            type: "positive",
            message: "Dashboard deleted successfully.",
            timeout: 5000,
          });
        });
      goBack();
    };

    const saveDashboardOnClick = async (dashboardId: String) => {
      const currentDashboard = toRaw(store.state.currentSelectedDashboard);
      await dashboardService
        .save(
          store.state.selectedOrganization.identifier,
          currentDashboard.dashboardId,
          JSON.stringify(JSON.stringify(currentDashboard))
        )
        .then((res) => {
          $q.notify({
            type: "positive",
            message: "Dashboard saved successfully.",
            timeout: 5000,
          });
        });
      //goBack()
    };

    const getDashboard = () => {
      return currentDashboard.dashboardId;
    };
    const refreshAllDashboardsAndGetCurrentDashboard = async (
      dashId: String
    ) => {
      const a = await getCurrentDashboard(store, dashId);
      return a;
    };

    const addNewPanel = (dashboardId: String) => {
      const panelId =
        "Panel_ID" + Math.floor(Math.random() * (99999 - 10 + 1)) + 10;
      return router.push({
        path: "/editPanel",
        query: { dashboard: dashboardId, panelId: panelId },
      });
    };

    const deleteExistingPanel = async (
      panelDataElement: any,
      dashboardId: String,
      dashboardList: any
    ) => {
      //const panelId = 'Panel_ID' + Math.floor(Math.random() * (99999 - 10 + 1)) + 10
      deletePanelFromDashboard(
        store,
        dashboardId,
        panelDataElement.id,
        dashboardList
      );
      // await saveDashboardOnClick(dashboardId)
      //router.go(0);
    };

    let list = computed(function () {
      return [toRaw(store.state.currentSelectedDashboard)];
    });

    initialize();
    return {
      t,
      list,
      goBack,
      getDashboard,
      valueList,
      dateVal,
      deleteDashboard,
      addNewPanel,
      saveDashboardOnClick,
      deleteExistingPanel,
      refreshAllDashboardsAndGetCurrentDashboard,
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
      dateChange,
      currentTimeObj,
    };
  },
  data() {
    return {
      computedTimeObj: Date.now(),
      // layouts: [
      //   { x: 0, y: 0, w: 12, h: 12, i: 0, panelId: "Panel_ID607710", static: false },
      //   { x: 4, y: 4, w: 12, h: 12, i: 1, panelId: "Panel_ID7545110", static: false },
      // ],
      // layoutCopy:{
      //   Panel_ID607710 :{ x: 0, y: 0, w: 2, h: 2, i: "Panel_ID607710", static: false },
      //   Panel_ID7545110: { x: 20, y: 40, w: 2, h: 4, i: "Panel_ID7545110", static: false },

      // },
      // mockedData: {
      //   title: "Time Range Tester Dash",
      //   dashboardId: "DashID_1262352719",
      //   layout: [
      //     { x: 0, y: 0, w: 12, h: 12, i: 0, panelId: "Panel_ID607710", static: false },
      //     { x: 4, y: 4, w: 12, h: 12, i: 1, panelId: "Panel_ID7545110", static: false },
      //   ],
      //   dashboardLayout: {
      //     Panel_ID607710: { x: 0, y: 0, w: 2, h: 2, i: "0", static: false },
      //     Panel_ID7545110: { x: 0, y: 0, w: 2, h: 2, i: "0", static: false },
      //   },
      //   description: "Time Tester D",
      //   role: "User Dashboard",
      //   owner: "Ayon Bhattacharya",
      //   created: "2022-12-13T02:00:17.720Z",
      //   panels: [
      //     {
      //       id: "Panel_ID607710",
      //       query: [
      //         "select count(*) as y_axis, kubernetes.host as x_axis from default WHERE time_range(_timestamp,'2022-12-13T08:06:59+07:00', '2022-12-13T11:06:59+07:00') group by x_axis",
      //       ],
      //       title: "This is always a Description Text",
      //       type: "BarChart",
      //     },
      //     {
      //       id: "Panel_ID7545110",
      //       query: [
      //         "select count(*) as y_axis, kubernetes.host as x_axis from default WHERE time_range(_timestamp,'2022-12-13T08:09:33+07:00', '2022-12-13T11:09:33+07:00') group by x_axis",
      //       ],
      //       title: "This is always a Description Text",
      //       type: "Table",
      //     },
      //   ],
      // },

      draggable: true,
      resizable: true,
      index: 0,
      eventLog: [],
    };
  },
  methods: {
    goBacToDashboardList(evt, row) {
      this.goBack();
    },
    deleteDashboardOnClick(evt, row) {
      this.deleteDashboard(this.$route.query.dashboard);
    },
    saveDashboardOnClick(evt, row) {
      this.saveDashboard(this.$route.query.dashboard);
    },
    addNewPanelOnClick(evt, row) {
      this.addNewPanel(this.$route.query.dashboard);
    },
    onUpdatePanel(panelDataElementValue: any) {
      let dashboardList = toRaw(this.store.state.allCurrentDashboards);
      this.deleteExistingPanel(
        panelDataElementValue,
        this.$route.query.dashboard,
        dashboardList
      );
    },
    updateCurrentDateTimeObj() {
      this.computedTimeObj = Date.now();
    },
    moveEvent: function (i, newX, newY) {
      const msg = "MOVE i=" + i + ", X=" + newX + ", Y=" + newY;
      this.eventLog.push(msg);
    },
    movedEvent: function (i, newX, newY) {
      const msg = "MOVED i=" + i + ", X=" + newX + ", Y=" + newY;
      this.eventLog.push(msg);
    },
    resizeEvent: function (i, newH, newW, newHPx, newWPx) {
      const msg =
        "RESIZE i=" +
        i +
        ", H=" +
        newH +
        ", W=" +
        newW +
        ", H(px)=" +
        newHPx +
        ", W(px)=" +
        newWPx;
      this.eventLog.push(msg);
    },
    resizedEvent: function (i, newX, newY, newHPx, newWPx) {
      const msg =
        "RESIZED i=" +
        i +
        ", X=" +
        newX +
        ", Y=" +
        newY +
        ", H(px)=" +
        newHPx +
        ", W(px)=" +
        newWPx;
      this.eventLog.push(msg);
    },
    containerResizedEvent: function (i, newH, newW, newHPx, newWPx) {
      const msg =
        "CONTAINER RESIZED i=" +
        i +
        ", H=" +
        newH +
        ", W=" +
        newW +
        ", H(px)=" +
        newHPx +
        ", W(px)=" +
        newWPx;
      this.eventLog.push(msg);
    },
    layoutCreatedEvent: function (newLayout) {
      this.eventLog.push("Created layout");
    },
    layoutBeforeMountEvent: function (newLayout) {
      this.eventLog.push("beforeMount layout");
    },
    layoutMountedEvent: function (newLayout) {
      this.eventLog.push("Mounted layout");
    },
    layoutReadyEvent: function (newLayout) {
      this.eventLog.push("Ready layout");
    },
    layoutUpdatedEvent: function (newLayout) {
      this.eventLog.push("Updated layout");
    },
    getPanelLayout(layout, panelId, position) {
      for (const element of layout) {
        if (element.panelId == panelId) {
          if (position == "x") {
            return element.x;
          } else if (position == "y") {
            return element.y;
          } else if (position == "w") {
            return element.w;
          } else if (position == "h") {
            return element.h;
          } else if (position == "i") {
            return element.i;
          }
        }
      }

      return 0;
    },
  },
  async activated() {
    let dashboardList = toRaw(this.store.state.allCurrentDashboards);
    if (Object.keys(dashboardList).length === 0) {
      await this.refreshAllDashboardsAndGetCurrentDashboard(
        this.$route.query.dashboard
      );
    } else {
      for (const dashboard of dashboardList) {
        if (this.$route.query.dashboard === dashboard.name) {
          this.store.dispatch(
            "setCurrentSelectedDashboard",
            JSON.parse(dashboard.details)
          );
        }
      }
    }
    //await this.refreshAllDashboardsAndGetCurrentDashboard(this.$route.query.dashboard);
    //store.dispatch("setCurrentSelectedDashboard", modDashboardObject);
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

.vue-grid-layout {
  // background: #eee;
}

.vue-grid-item:not(.vue-grid-placeholder) {
  background: #ccc;
  border: 1px solid black;
}

.vue-grid-item .resizing {
  opacity: 0.9;
}

.vue-grid-item .static {
  background: #cce;
}

.vue-grid-item .text {
  font-size: 24px;
  text-align: center;
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  margin: auto;
  height: 100%;
  width: 100%;
}

.vue-grid-item .no-drag {
  height: 100%;
  width: 100%;
}

.vue-grid-item .minMax {
  font-size: 12px;
}

.vue-grid-item .add {
  cursor: pointer;
}

.vue-draggable-handle {
  position: absolute;
  width: 20px;
  height: 20px;
  top: 0;
  left: 0;
  background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><circle cx='5' cy='5' r='5' fill='#999999'/></svg>")
    no-repeat;
  background-position: bottom right;
  padding: 0 8px 8px 0;
  background-repeat: no-repeat;
  background-origin: content-box;
  box-sizing: border-box;
  cursor: pointer;
}

.layoutJSON {
  background: #ddd;
  border: 1px solid black;
  margin-top: 10px;
  padding: 10px;
}

.eventsJSON {
  background: #ddd;
  border: 1px solid black;
  margin-top: 10px;
  padding: 10px;
  height: 100px;
  overflow-y: scroll;
}

.displayDiv {
  clear: both;
  padding: 1.625em 0 0;
  // overflow: auto;
}
.plotlyBackground {
  background: #fff !important;
  border-radius: 4px;
  border-color: #d5d5d5 !important;
}
</style>
