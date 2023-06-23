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
      <div class="flex">
        <q-btn no-caps @click="goBackToDashboardList" padding="xs" outline icon="arrow_back_ios_new" />
        <span class="q-table__title q-mx-md q-mt-xs">{{ list[0].title }}</span>
      </div>
      <div class="flex">
        <q-btn outline padding="xs" no-caps icon="add" @click="addPanelData">
          <q-tooltip>{{ t('panel.add') }}</q-tooltip>
        </q-btn>
        <!-- <q-btn class="q-ml-md q-mb-xs text-bold" outline padding="sm lg" color="white" text-color="black" no-caps
          :label="draggable ? t(`panel.cancel`) : t(`panel.edit`)" @click="isDraggableClick" />
        <q-btn class="q-ml-md q-mb-xs text-bold no-border" padding="sm lg" color="secondary" no-caps :disable="!draggable"
          :label="t(`panel.save`)" @click="saveDashboardOnClick" /> -->
        <!-- <q-btn class="q-ml-md q-mb-xs text-bold" outline padding="sm lg" color="red" no-caps
          :label="t(`dashboard.delete`)" @click="deleteDashboardOnClick" /> -->
        <!--<q-btn class="q-ml-md q-mb-xs text-bold" padding="sm lg" color="white" no-caps
            :label="t(`dashboard.goBackToDashboard`)" outline text-color="black" @click="goBackToDashboardList" />-->
        <DateTimePicker 
          class="q-ml-sm"
          ref="refDateTime"
          v-model="selectedDate"
        />
        <AutoRefreshInterval v-model="refreshInterval" trigger @trigger="refreshData"/>
        <q-btn class="q-ml-sm" outline padding="xs" no-caps icon="refresh" @click="refreshData">
        </q-btn>
        <ExportDashboard :dashboardId="list?.[0]?.dashboardId"/>
      </div>
    </div>
    <q-separator></q-separator>
    <q-q-separator></q-q-separator>
    <div  v-if="list[0].variables?.list?.length > 0">
      <div v-for="item in list[0].variables?.list">
        <div v-if="item.type === 'textBox'" style="width: 20%;">
          <q-input v-model="item.name" :label="item.label" dense></q-input>
        </div>
        <div v-else-if="item.type === 'dateBox'" style="width: 20%;">
          <q-input v-model="item.name" :label="item.label" dense></q-input>
        </div>
      </div>
    </div>
    <div class="displayDiv">
      <grid-layout v-if="list[0].panels?.length > 0" v-model:layout.sync="list[0].layouts" :col-num="12" :row-height="30"
        :is-draggable="draggable" :is-resizable="draggable" :vertical-compact="true" :autoSize="true"
        :restore-on-drag="true" :use-css-transforms="true" @layout-created="layoutCreatedEvent"
        @layout-before-mount="layoutBeforeMountEvent" @layout-mounted="layoutMountedEvent"
        @layout-ready="layoutReadyEvent" @layout-updated="layoutUpdatedEvent">
        <grid-item class="plotlyBackground" v-for="item in list[0].panels" :key="item.id"
          :x="getPanelLayout(list[0].layouts, item.id, 'x')" :y="getPanelLayout(list[0].layouts, item.id, 'y')"
          :w="getPanelLayout(list[0].layouts, item.id, 'w')" :h="getPanelLayout(list[0].layouts, item.id, 'h')"
          :i="getPanelLayout(list[0].layouts, item.id, 'i')" :minH="getMinimumHeight(item.type)" :minW="getMinimumWidth(item.type)" @resize="resizeEvent"
          @move="moveEvent" @resized="resizedEvent" @container-resized="containerResizedEvent" @moved="movedEvent"
          drag-allow-from=".drag-allow">
          <div style="height: 100%;">
            <PanelContainer @updated:chart="onUpdatePanel" @duplicatePanel="onDuplicatePanel" :draggable="draggable" :data="item"
              :selectedTimeDate="currentTimeObj" 
              :width="getPanelLayout(list[0].layouts, item.id, 'w')" :height="getPanelLayout(list[0].layouts, item.id, 'h')">
            </PanelContainer>
          </div>
        </grid-item>
      </grid-layout>
    </div>
    <div v-if="!list[0].panels?.length">
     <!-- if data not available show nodata component -->
      <NoPanel @update:Panel="addPanelData" />
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
  nextTick,
} from "vue";
import { useStore } from "vuex";
import { useQuasar, date, copyToClipboard } from "quasar";
import { useI18n } from "vue-i18n";
import DateTimePicker from "../../components/DateTimePicker.vue";
import VueGridLayout from "vue3-grid-layout";
import { useRouter } from "vue-router";
import {
  getConsumableDateTime,
  getDashboard,
  addPanel
} from "../../utils/commons.ts";
import { parseDuration, generateDurationLabel, getDurationObjectFromParams, getQueryParamsForDuration } from "../../utils/date"
import { toRaw, unref, reactive } from "vue";
import PanelContainer from "../../components/dashboards/PanelContainer.vue";
import { useRoute } from "vue-router";
import { deletePanel, updateDashboard } from "../../utils/commons";
import NoPanel from "../../components/shared/grid/NoPanel.vue";
import AutoRefreshInterval from "../../components/AutoRefreshInterval.vue"
import ExportDashboard from "../../components/dashboards/ExportDashboard.vue"
import streamService from "../../services/stream";

export default defineComponent({
  name: "ViewDashboard",
  components: {
    GridLayout: VueGridLayout.GridLayout,
    GridItem: VueGridLayout.GridItem,
    DateTimePicker,
    PanelContainer,
    NoPanel,
    AutoRefreshInterval,
    ExportDashboard
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
    const currentDurationSelectionObj = ref ({})
    const currentTimeObj = ref({});
    const refreshInterval = ref(0);
    const selectedDate = ref()

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
      currentDurationSelectionObj.value = dateValue
      currentTimeObj.value = getConsumableDateTime(currentDurationSelectionObj.value);
    };

    const initialize = () => { };

    // back button to render dashboard List page
    const goBack = () => {
      return router.push("/dashboards");
    };

    const goBackToDashboardList = () => {
      goBack();
    };

    const deleteDashboardOnClick = async () => {
      await deleteDashboard(route.query.dashboard);
    };

    const onDuplicatePanel = async (data: any): Promise<void> => {

      // Show a loading spinner notification.
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });

      // Generate a unique panel ID.
      const panelId = "Panel_ID" + Math.floor(Math.random() * (99999 - 10 + 1)) + 10;

      // Duplicate the panel data with the new ID.
      const panelData = JSON.parse(JSON.stringify(data));
      panelData.id = panelId;

      try {
        // Add the duplicated panel to the dashboard.
        await addPanel(store, route.query.dashboard, panelData);

        // Show a success notification.
        $q.notify({
          type: "positive",
          message: `Panel Duplicated Successfully`,
        });

        // Navigate to the new panel.
        return router.push({
          path: "/dashboards/add_panel",
          query: { dashboard: String(route.query.dashboard), panelId: panelId }
        });
      } catch (err) {
        // Show an error notification.
        $q.notify({
          type: "negative",
          message: err?.response?.data["error"]
            ? JSON.stringify(err?.response?.data["error"])
            : 'Panel duplication failed',
        });
      }

      // Hide the loading spinner notification.
      dismiss();

    };

    // save the dashboard value
    const saveDashboard = async () => {
      const dashboardId = route.query.dashboard
      await updateDashboard(
        store,
        store.state.selectedOrganization.identifier,
        dashboardId,
        currentDashboardData.data
      );

      $q.notify({
        type: "positive",
        message: "Dashboard updated successfully.",
        timeout: 5000,
      });

    };

    //add dashboardId
    const addNewPanel = (dashboardId: String) => {
      return router.push({
        path: "/dashboards/add_panel",
        query: { dashboard: dashboardId },
      });
    };

    const addPanelData = () => {
      addNewPanel(route.query.dashboard);
    };

    let list = computed(function () {
      console.log("before",JSON.stringify(toRaw(currentDashboardData.data)));
      
      // let data = toRaw(currentDashboardData.data);
      // console.log("-currentTimeObj-", JSON.stringify(currentTimeObj.value));
      
      // const variables = {}

      // variables["list"] = [
      //     {
      //       "type" : "query_value",
      //       "name" : "namespace1",
      //       "label" : "NameSpace",
      //       "queryData" : {
      //         "streamType" : "logs",
      //         "stream" : "gke-fluentbit",
      //         "streamField" : "kubernetes_host",
      //       }
      //     }
      //   ]

      // data["variables"] = variables

      // data.variables.map((it)=> {
      //   const obj = {name: it.name, value: null, isLoading: false }
      //   switch (it.type) {
          
      //     case query_value:{
      //       obj.isLoading = true

      //       streamService
      //       .fieldValues({
      //         org_identifier: store.state.selectedOrganization.identifier,
      //         stream_name: it.queryData.stream,
      //         start_time: currentTimeObj.start_time,
      //         end_time: currentTimeObj.end_time,
      //         fields: [it.queryData.streamField],
      //         size: 10,
      //         type: "traces",
      //       })
      //       .then((res: any) => {
      //         if (res.data.hits.length) {
      //           fieldValues.value[it.queryData.streamField]["values"] = res.data.hits
      //             .find((field: any) => field.field === name)
      //             .values.map((value: any) => {
      //               return {
      //                 key: value.key ? value.key : "null",
      //                 count: formatNumberWithPrefix(value.num),
      //               };
      //             });
      //         }
      //   })
      //       break;
      //     }
            
        
      //     default:{

      //       break;
      //     }
      //   }
      // })

      // console.log("-after-",data)

      return [toRaw(currentDashboardData.data)];
    });

    const refreshData = () => {
      currentTimeObj.value = getConsumableDateTime(currentDurationSelectionObj.value)
    }

    watch(selectedDate, () => {
      dateChange(selectedDate.value)
    })

    // ------- work with query params ----------
    onActivated(async() => {
      const params = route.query

      if(params.refresh) {
        refreshInterval.value = parseDuration(params.refresh)
      }

      if(params.period || (params.to && params.from)){
        selectedDate.value = getDurationObjectFromParams(params)
      }

      // resize charts if needed
      await nextTick();
      window.dispatchEvent(new Event("resize"))
      
    })

    // whenever the refreshInterval is changed, update the query params
    watch([refreshInterval, selectedDate], () => {
      
      router.replace({
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          refresh: generateDurationLabel(refreshInterval.value),
          ...getQueryParamsForDuration(selectedDate.value)
        }
      })
    })

    initialize();

    return {
      currentDashboardData,
      goBackToDashboardList,
      deleteDashboardOnClick,
      addPanelData,
      onDuplicatePanel,
      t,
      list,
      goBack,
      getDashboard,
      dateVal: initialDateValue,
      // deleteDashboard,
      addNewPanel,
      // saveDashboardOnClick,
      saveDashboard,
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
      refreshInterval,
      refreshData,
      selectedDate
    };
  },
  data() {
    return {
      computedTimeObj: Date.now(),
      draggable: true,
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
      this.saveDashboard()
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
      this.saveDashboard()
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
          return 4;
          break;

        default:
          break;
      }
    },
    getMinimumWidth(type) {
      switch (type) {
        case "area":
        case "bar":
        case "h-bar":
        case "line":
        case "pie":
        case "scatter":
        case "table":
          return 3;
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
  background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><circle cx='5' cy='5' r='5' fill='#999999'/></svg>") no-repeat;
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
  background: #00000000 !important;
  border-radius: 4px;
  border-color: #494949 !important;
}
</style>
