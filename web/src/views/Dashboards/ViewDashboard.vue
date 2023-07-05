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
        <span class="q-table__title q-mx-md q-mt-xs">{{ currentDashboardData.data.title }}</span>
      </div>
      <div class="flex">
        <q-btn outline padding="xs" no-caps icon="add" @click="addPanelData">
          <q-tooltip>{{ t('panel.add') }}</q-tooltip>
        </q-btn>
        <q-btn outline padding="xs" class="q-ml-sm" no-caps icon="settings" @click="addSettingsData">
          <q-tooltip>{{ t('dashboard.setting') }}</q-tooltip>
        </q-btn>
        <DateTimePicker 
          class="q-ml-sm"
          ref="refDateTime"
          v-model="selectedDate"
        />
        <AutoRefreshInterval v-model="refreshInterval" trigger @trigger="refreshData"/>
        <q-btn class="q-ml-sm" outline padding="xs" no-caps icon="refresh" @click="refreshData">
        </q-btn>
        <ExportDashboard :dashboardId="currentDashboardData.data?.dashboardId"/>
      </div>
    </div>
    <q-separator></q-separator>
    <q-q-separator></q-q-separator>
    <div v-if="variablesData.values?.length > 0 && !variablesData.isVariablesLoading"
      class="flex q-mt-sm q-ml-sm">
      <div v-for="item in variablesData.values" class="q-mr-lg">
        <div v-if="item.type == 'query'">
          <q-select
            outlined
            dense
            v-model="item.value"
            :options="item.options"
            :label="item.label"
          ></q-select>
          <!-- <q-input v-model="item.name" :label="item.label" dense></q-input> -->
        </div>
        <div v-else-if="item.type == 'constant'">
          <q-input v-model="item.name" :label="item.label" dense outlined readonly></q-input>
        </div>
        <div v-else-if="item.type == 'textbox'">
          <q-input v-model="item.name" :label="item.label" dense outlined></q-input>
        </div>
         <!-- v-model="item.value" -->
        <div v-if="item.type == 'custom_fields'">
          <q-select
              outlined
              dense
              v-model="item.value"
              :options="item.options"
              :label="item.label"
            ></q-select>
        </div>
      </div>
    </div>
    <div class="displayDiv" v-if="!(variablesData.isVariablesLoading)">
      <grid-layout v-if="currentDashboardData.data.panels?.length > 0" v-model:layout.sync="currentDashboardData.data.layouts" :col-num="12" :row-height="30"
        :is-draggable="draggable" :is-resizable="draggable" :vertical-compact="true" :autoSize="true"
        :restore-on-drag="true" :use-css-transforms="true">
        <grid-item class="plotlyBackground" v-for="item in currentDashboardData.data.panels" :key="item.id"
          :x="getPanelLayout(currentDashboardData.data.layouts, item.id, 'x')" :y="getPanelLayout(currentDashboardData.data.layouts, item.id, 'y')"
          :w="getPanelLayout(currentDashboardData.data.layouts, item.id, 'w')" :h="getPanelLayout(currentDashboardData.data.layouts, item.id, 'h')"
          :i="getPanelLayout(currentDashboardData.data.layouts, item.id, 'i')" :minH="getMinimumHeight(item.type)" :minW="getMinimumWidth(item.type)" @resized="resizedEvent" @moved="movedEvent"
          drag-allow-from=".drag-allow">
          <div style="height: 100%;">
            <PanelContainer @updated:chart="onUpdatePanel" @duplicatePanel="onDuplicatePanel" :draggable="draggable" :data="item"
              :selectedTimeDate="currentTimeObj" :variablesData="variablesData"
              :width="getPanelLayout(currentDashboardData.data.layouts, item.id, 'w')" :height="getPanelLayout(currentDashboardData.data.layouts, item.id, 'h')">
            </PanelContainer>
          </div>
        </grid-item>
      </grid-layout>
    </div>
    <div v-if="!currentDashboardData.data.panels?.length">
     <!-- if data not available show nodata component -->
      <NoPanel @update:Panel="addPanelData" />
    </div>
    <q-dialog
      v-model="showDashboardSettingsDialog"
      position="right"
      full-height
      maximized
    >
     <DashboardSettings @updated="updateDashboardList" />
    </q-dialog>
    
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
import DashboardSettings from "./DashboardSettings.vue";

export default defineComponent({
  name: "ViewDashboard",
  components: {
    GridLayout: VueGridLayout.GridLayout,
    GridItem: VueGridLayout.GridItem,
    DateTimePicker,
    PanelContainer,
    NoPanel,
    AutoRefreshInterval,
    ExportDashboard,
    DashboardSettings
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
    const draggable = ref(true);
    const eventLog = ref([])

    const refDateTime: any = ref(null);
    const $q = useQuasar();
    const currentDurationSelectionObj = ref ({})
    const currentTimeObj = ref({});
    const refreshInterval = ref(0);
    const selectedDate = ref()
    const variablesData = reactive({
      isVariablesLoading: false,
      values: []
    })

    onActivated(async () => {
      console.log("on activated called");
      
      await loadDashboard();
    })

    const loadDashboard = async () => {
      console.log("inside load dashboard");
      
      let data = JSON.parse(JSON.stringify(await getDashboard(
        store,
        route.query.dashboard
      )))
      currentDashboardData.data = data

      if(data?.variables && data?.variables?.list.length){
        console.log("viewDashboard: inside if");
        
        variablesData.isVariablesLoading = true
        await getVariablesData(data)
      }else{

        console.log("viewDashboard: inside else");
        data.variables = null
        variablesData.isVariablesLoading = false
        variablesData.values = []
      }
     
    };

    const addSettingsData = () => {
      showDashboardSettingsDialog.value = true;
    };

    const getVariablesData = async(data: any) => {

      console.log("data:", data);
      
      const currentTempDashboardData = data || currentDashboardData.data
      const promise = currentTempDashboardData.variables?.list?.map((it)=> {
        
        const obj = {name: it.name, label : it.label, type: it.type, value: "", isLoading: false }
        switch (it.type) {
          
          case "query":{
            obj.isLoading = true
            console.log("------",currentTimeObj.value.start_time);
            return streamService
            .fieldValues({
              org_identifier: store.state.selectedOrganization.identifier,
              stream_name: it.query_data.stream,
              start_time: new Date(currentTimeObj.value.start_time?.toISOString()).getTime() * 1000,
              end_time: new Date(currentTimeObj.value.end_time?.toISOString()).getTime() * 1000,
              fields: [it.query_data.field],
              size: 10,
              type: it.query_data.stream_type,
            })
            .then((res: any) => {
              obj.isLoading = false
              if (res.data.hits.length) {
                console.log("-res-", res.data.hits);
                
                obj["options"] = res.data.hits
                  .find((field: any) => field.field === it.query_data.field)
                  .values.map((value: any) => value.zo_sql_key ? value.zo_sql_key : "null")
                obj.value = obj.options[0] || ""

                return obj
              } else {
                return obj
              }
            })
            .catch((err: any) => {
              return obj
            })
            // break;
          }
          case "constant":{
            obj.value = it.value
            return obj
            // break;
          }
          case "textbox":{
            obj.value = it.value
            return obj
            // break;
          }
          case "custom_fields":{
            obj["options"] = it.options
            obj.value = obj.options[0] || ""
            return obj
            // break;
          }
          default:
            obj.value = it.value
            return obj
        }
      })
      variablesData.values = await Promise.all(promise)
      variablesData.isVariablesLoading = false
      console.log("variablesData", JSON.stringify(variablesData));
      console.log("-after-",data)
    }

    // back button to render dashboard List page
    const goBackToDashboardList = () => {
      return router.push("/dashboards");
    };

    //create a duplicate panel
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

    //add panel
    const addPanelData = () => {
      return router.push({
        path: "/dashboards/add_panel",
        query: { dashboard: route.query.dashboard },
      });
    };

    // const currentDashboardData.data = computed(async function () {
    //   console.log("before",JSON.stringify(toRaw(currentDashboardData.data)));
      
    //   let data = toRaw(currentDashboardData.data);
    //   const variables = {}

    //   variables["list"] = [
    //       {
    //         "type" : "query_value",
    //         "name" : "namespace1",
    //         "label" : "NameSpace",
    //         "queryData" : {
    //           "streamType" : "logs",
    //           "stream" : "gke-fluentbit",
    //           "streamField" : "kubernetes_host",
    //         }
    //       },
    //       {
    //         "type" : "constant",
    //         "name" : "namespace2",
    //         "label" : "NameSpace2",
    //         "value" : "alpha1"
    //       }
    //     ]

    //   data["variables"] = variables
    //   variablesData.isVariablesLoading = true
    //   const promise = data.variables.list.map((it)=> {
        
    //     const obj = {name: it.name, label : it.label, value: "", isLoading: false }
    //     switch (it.type) {
          
    //       case "query_value":{
    //         obj.isLoading = true
    //         console.log("------",currentTimeObj.value.start_time);
    //         return streamService
    //         .fieldValues({
    //           org_identifier: store.state.selectedOrganization.identifier,
    //           stream_name: it.queryData.stream,
    //           start_time: new Date(currentTimeObj.value.start_time?.toISOString()).getTime() * 1000,
    //           end_time: new Date(currentTimeObj.value.end_time?.toISOString()).getTime() * 1000,
    //           fields: [it.queryData.streamField],
    //           size: 10,
    //           type: "traces",
    //         })
    //         .then((res: any) => {
    //           obj.isLoading = false
    //           if (res.data.hits.length) {
    //             console.log("-res-", res.data.hits);
                
    //             obj["options"] = res.data.hits
    //               .find((field: any) => field.field === it.queryData.streamField)
    //               .values.map((value: any) => value.zo_sql_key ? value.zo_sql_key : "null")
    //             obj.value = obj.options[0] || ""

    //             return obj
    //           } else {
    //             return obj
    //           }
    //         })
    //         .catch((err: any) => {
    //           return obj
    //         })
    //         // break;
    //       }
    //       case "constant":{
    //         obj.value = it.value
    //         return obj
    //         // break;
    //       }
    //       default:{
    //         console.log("default");
    //         break;
    //       }
    //     }
    //   })
    //   variablesData.values =await Promise.all(promise)
    //   variablesData.isVariablesLoading = false
    //   console.log("variablesData", JSON.stringify(variablesData));
      
    //   console.log("-after-",data)

    //   return data;
    // });
    
    const refreshData = () => {
      currentTimeObj.value = getConsumableDateTime(currentDurationSelectionObj.value)
    }

    watch(selectedDate, () => {
      const c = toRaw(unref(selectedDate.value));
      currentDurationSelectionObj.value = selectedDate.value
      currentTimeObj.value = getConsumableDateTime(currentDurationSelectionObj.value);
      getVariablesData()
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

    const isDraggableClick = (evt, row) => {
      draggable.value = !draggable.value;
    }

    const disableDraggable = (evt, row) => {
      draggable.value = false;
    }

    const onUpdatePanel = async(panelDataElementValue: any) => {
      console.log("on update panel called");
      
      await deletePanel(
        store,
        route.query.dashboard,
        panelDataElementValue.id
      );
      await loadDashboard()
    }

    const movedEvent = (i, newX, newY) => {
      saveDashboard()
    }

    const getPanelLayout = (layout, panelId, position) => {
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
    }

    const getMinimumHeight = (type) => {
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
    }

    const getMinimumWidth = (type) => {
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
    }

    return {
      currentDashboardData,
      goBackToDashboardList,
      addPanelData,
      onDuplicatePanel,
      t,
      currentDashboardData,
      getDashboard,
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
      currentTimeObj,
      refreshInterval,
      refreshData,
      selectedDate,
      isDraggableClick,
      disableDraggable,
      onUpdatePanel,
      movedEvent,
      eventLog,
      getPanelLayout,
      getMinimumHeight,
      getMinimumWidth,
      variablesData,
      addSettingsData,
      showDashboardSettingsDialog
    };
  }
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
