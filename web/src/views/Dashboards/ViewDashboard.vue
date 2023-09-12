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
    <div class="flex justify-between items-center q-pa-sm">
      <div class="flex">
        <q-btn no-caps @click="goBackToDashboardList" padding="xs" outline icon="arrow_back_ios_new" />
        <span class="q-table__title q-mx-md q-mt-xs">{{ currentDashboardData.data.title }}</span>
      </div>
      <div class="flex">
        <q-btn outline padding="xs" no-caps icon="add" @click="addPanelData" data-test="dashboard-panel-add">
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
    <RenderDashboardCharts :draggable="draggable" :dashboardData="currentDashboardData.data" :currentTimeObj="currentTimeObj" @onDeletePanel="onDeletePanel"/>
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
import {
  defineComponent,
  ref,
  watch,
  onActivated,
  nextTick,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import DateTimePicker from "../../components/DateTimePicker.vue";
import { useRouter } from "vue-router";
import {
  getConsumableDateTime,
  getDashboard
} from "../../utils/commons.ts";
import { parseDuration, generateDurationLabel, getDurationObjectFromParams, getQueryParamsForDuration } from "../../utils/date"
import { toRaw, unref, reactive } from "vue";
import { useRoute } from "vue-router";
import { deletePanel } from "../../utils/commons";
import AutoRefreshInterval from "../../components/AutoRefreshInterval.vue"
import ExportDashboard from "../../components/dashboards/ExportDashboard.vue"
import DashboardSettings from "./DashboardSettings.vue";
import RenderDashboardCharts from "./RenderDashboardCharts.vue";
import VariablesValueSelector from "../../components/dashboards/VariablesValueSelector.vue";


export default defineComponent({
  name: "ViewDashboard",
  emits:["onDeletePanel"],
  components: {
    DateTimePicker,
    AutoRefreshInterval,
    ExportDashboard,
    DashboardSettings,
    VariablesValueSelector,
    RenderDashboardCharts
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
    const currentDurationSelectionObj = ref ({})
    const currentTimeObj = ref({});
    const refreshInterval = ref(0);
    const selectedDate = ref()

    // variables data
    const variablesData = reactive({});
    const variablesDataUpdated = (data: any) => {
      Object.assign(variablesData,data)
    }

    onActivated(async () => {
      await loadDashboard();
    })

    const loadDashboard = async () => {
      
      currentDashboardData.data = await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default"
      )
      currentDashboardData.data = data;

      // if variables data is null, set it to empty list
      if(!(currentDashboardData.data?.variables && currentDashboardData.data?.variables?.list.length)) {
        variablesData.isVariablesLoading = false
        variablesData.values = []
      }
    };

    const addSettingsData = () => {
      showDashboardSettingsDialog.value = true;
    };

    // back button to render dashboard List page
    const goBackToDashboardList = () => {
      return router.push({
        path:"/dashboards",
        query: { dashboard: route.query.dashboard, folder: route.query.folder ?? "default" },
      });
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
        await addPanel(store, route.query.dashboard, panelData, route.query.folder ?? "default");

        // Show a success notification.
        $q.notify({
          type: "positive",
          message: `Panel Duplicated Successfully`,
        });

        // Navigate to the new panel.
        return router.push({
          path: "/dashboards/add_panel",
          query: { dashboard: String(route.query.dashboard), panelId: panelId, folder: route.query.folder ?? "default" },
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
        query: { dashboard: route.query.dashboard, folder: route.query.folder ?? "default" },
      });
    };
    
    const refreshData = () => {
      currentTimeObj.value = getConsumableDateTime(currentDurationSelectionObj.value)
    }

    watch(selectedDate, () => {
      const c = toRaw(unref(selectedDate.value));
      currentDurationSelectionObj.value = selectedDate.value
      currentTimeObj.value = getConsumableDateTime(currentDurationSelectionObj.value);
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
          folder: route.query.folder,
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

    const onDeletePanel = async(panelId: any) => {      
      await deletePanel(
        store,
        route.query.dashboard,
        panelDataElementValue.id,
        route.query.folder ?? "default"
      );
      await loadDashboard()
    }
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
      isDraggableClick,
      disableDraggable,
      onDeletePanel,
      draggable,
      eventLog,
      variablesData,
      variablesDataUpdated,
      addSettingsData,
      showDashboardSettingsDialog,
      loadDashboard,
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

.vue-grid-layout {
    transition: none;
  }

  .vue-grid-item {
    transition: none;
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
  border-color: #c2c2c27a !important;
}
</style>
