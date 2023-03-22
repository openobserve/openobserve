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
      <div class="q-table__title q-mr-md">{{ list[0].title }}</div>
      <div class="flex items-baseline q-gutter-sm">
        <q-btn
          class="q-ml-md q-mb-xs text-bold"
          outline
          padding="sm lg"
          color="white"
          text-color="black"
          no-caps
          :label="t('panel.add')"
          @click="addPanelData"
        />
        <q-btn
          class="q-ml-md q-mb-xs text-bold"
          outline
          padding="sm lg"
          color="white"
          text-color="black"
          no-caps
          :label="draggable ? t(`panel.cancel`) : t(`panel.edit`)"
          @click="isDraggableClick"
        />
        <q-btn
          class="q-ml-md q-mb-xs text-bold no-border"
          padding="sm lg"
          color="secondary"
          no-caps
          :disable="!draggable"
          :label="t(`panel.save`)"
          @click="saveDashboardOnClick"
        />
        <q-btn
          class="q-ml-md q-mb-xs text-bold"
          outline
          padding="sm lg"
          color="red"
          no-caps
          :label="t(`dashboard.delete`)"
          @click="deleteDashboardOnClick"
        />
        <q-btn
          class="q-ml-md q-mb-xs text-bold"
          padding="sm lg"
          color="white"
          no-caps
          :label="t(`dashboard.goBackToDashboard`)"
          outline
          text-color="black"
          @click="goBackToDashboardList"
        />
        <date-time ref="refDateTime" @date-change="dateChange" />
      </div>
    </div>
    <q-separator></q-separator>
    <div class="displayDiv">
      <grid-layout
        v-if="list[0].panels?.length > 0"
        v-model:layout.sync="list[0].layouts"
        :col-num="12"
        :row-height="30"
        :is-draggable="draggable"
        :is-resizable="draggable"
        :vertical-compact="true"
        :autoSize="true"
        :restore-on-drag="true"
        :use-css-transforms="true"
        @layout-created="layoutCreatedEvent"
        @layout-before-mount="layoutBeforeMountEvent"
        @layout-mounted="layoutMountedEvent"
        @layout-ready="layoutReadyEvent"
        @layout-updated="layoutUpdatedEvent"
      >
        <grid-item
          class="plotlyBackground"
          v-for="item in list[0].panels"
          :key="item.id"
          :x="getPanelLayout(list[0].layouts, item.id, 'x')"
          :y="getPanelLayout(list[0].layouts, item.id, 'y')"
          :w="getPanelLayout(list[0].layouts, item.id, 'w')"
          :h="getPanelLayout(list[0].layouts, item.id, 'h')"
          :i="getPanelLayout(list[0].layouts, item.id, 'i')"
          :minH="getMinimumHeight(item.type)"
          @resize="resizeEvent"
          @move="moveEvent"
          @resized="resizedEvent"
          @container-resized="containerResizedEvent"
          @moved="movedEvent"
          drag-allow-from=".drag-allow"
        >
          <div>
            <PanelContainer
              @updated:chart="onUpdatePanel"
              :draggable="draggable"
              :data="item"
              :selectedTimeDate="currentTimeObj"
            >
            </PanelContainer>
          </div>
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
import {
  defineComponent,
  ref,
  computed,
  watch,
  onMounted,
  onActivated,
} from "vue";
import { useStore } from "vuex";
import { useQuasar, date, copyToClipboard } from "quasar";
import { useI18n } from "vue-i18n";
import dashboardService from "../../services/dashboards";
import DateTime from "../../components/DateTime.vue";
import VueGridLayout from "vue3-grid-layout";
import { useRouter } from "vue-router";
import {
  getConsumableDateTime,
  getDashboard,
} from "../../utils/commons.ts";
import { toRaw, unref, reactive } from "vue";
import PanelContainer from "../../components/dashboards/PanelContainer.vue";
import { useRoute } from "vue-router";
import { deletePanel, updateDashboard } from "../../utils/commons";

export default defineComponent({
  name: "ViewDashboard",
  components: {
    GridLayout: VueGridLayout.GridLayout,
    GridItem: VueGridLayout.GridItem,
    DateTime,
    PanelContainer,
  },
  setup() {
    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const store = useStore();
    const currentDashboardData = reactive({
      data: {},
    });

    const refDateTime: any = ref(null);
    const $q = useQuasar();
    let currentTimeObj: any = ref({});
    // let showNewPanel = ref(true)

    const initialDateValue = {
      tab: "relative",
      startDate: "",
      startTime: "",
      endDate: "",
      endTime: "",
      selectedRelativePeriod: "Minutes",
      selectedRelativeValue: 15,
      selectedFullTime: false,
    };

    // if the date value change, get the Date and time
    const dateChange = (dateValue: any) => {
      const c = toRaw(unref(dateValue));
      currentTimeObj.value = getConsumableDateTime(c);
    };

    const initialize = () => {};

    // back button to render dashboard List page
    const goBack = () => {
      return router.push("/dashboards");
    };

    const goBackToDashboardList = () => {
      goBack();
    };

    // delete dashboard remove the data from database and update store variable and redirect to dashboardList page
    const deleteDashboard = async (dashboardId: String) => {
      await dashboardService
        .delete(store.state.selectedOrganization.identifier, dashboardId)
        .then((res) => {
          const dashboardList = JSON.parse(
            JSON.stringify(toRaw(store.state.allDashboardList))
          );
          const newDashboardList = dashboardList.filter(
            (dashboard) => dashboard.name != dashboardId
          );
          store.dispatch("setAllDashboardList", newDashboardList);
          $q.notify({
            type: "positive",
            message: "Dashboard deleted successfully.",
            timeout: 5000,
          });
        });
      goBack();
    };

    const deleteDashboardOnClick = async () => {
      await deleteDashboard(route.query.dashboard);
    };

    // save the dashboard value
    const saveDashboard = async (dashboardId: String) => {
      await updateDashboard(
        store,
        store.state.selectedOrganization.identifier,
        dashboardId,
        currentDashboardData.data
      );
     
      currentDashboardData.data = await getDashboard(
        store,
        dashboardId
      );

      $q.notify({
        type: "positive",
        message: "Dashboard updated successfully.",
        timeout: 5000,
      });

    };

    const saveDashboardOnClick = async () => {
      saveDashboard(route.query.dashboard);
    };

    // //get current dashboard Id
    // const getDashboard = () => {
    //   return currentDashboardData.data.dashboardId;
    // };

    //add dashboardId
    const addNewPanel = (dashboardId: String) => {
      return router.push({
        path: "/dashboards/addPanel",
        query: { dashboard: dashboardId },
      });
    };

    const addPanelData = () => {
      addNewPanel(route.query.dashboard);
    };

    let list = computed(function () {
      return [toRaw(currentDashboardData.data)];
    });

    initialize();
    return {
      currentDashboardData,
      goBackToDashboardList,
      deleteDashboardOnClick,
      addPanelData,
      t,
      list,
      goBack,
      getDashboard,
      dateVal: initialDateValue,
      deleteDashboard,
      addNewPanel,
      saveDashboardOnClick,
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
      // showNewPanel,
    };
  },
  data() {
    return {
      computedTimeObj: Date.now(),
      draggable: false,
      index: 0,
      eventLog: [],
    };
  },
  methods: {
    isDraggableClick(evt, row) {
      this.draggable = !this.draggable;
    },
    disableDraggable(evt, row) {
      this.draggable = false;
    },
    async onUpdatePanel(panelDataElementValue: any) {
      
      // console.log(
      //   "deleting",
      //   this.$route.query.dashboard,
      //   panelDataElementValue,
      //   panelDataElementValue.id
      // );

      await deletePanel(
        this.store,
        this.$route.query.dashboard,
        panelDataElementValue.id
      );
      this.currentDashboardData.data = await getDashboard(
        this.store,
        this.$route.query.dashboard
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
      window.dispatchEvent(new Event("resize"));
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
    getMinimumHeight(type) {
      switch (type) {
        case "area":
        case "bar":
        case "h-bar":
        case "line":
        case "pie":
        case "scatter":
        case "table":
          return 13;
          break;

        default:
          break;
      }
    },
  },
  async activated() {
    this.currentDashboardData.data = await getDashboard(
      this.store,
      this.$route.query.dashboard
    );
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

// .vue-grid-item:not(.vue-grid-placeholder) {
//   background: #ccc;
//   border: 1px solid black;
// }

.vue-grid-item {
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
  // padding: 1.625em 0 0;
  // overflow: auto;
}
.plotlyBackground {
  background: #fff !important;
  border-radius: 4px;
  border-color: #d5d5d5 !important;
}
</style>
