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
  <div>
    <VariablesValueSelector
      :variablesConfig="dashboardData?.variables"
      :selectedTimeDate="currentTimeObj"
      :initialVariableValues="initialVariableValues"
      @variablesData="variablesDataUpdated"
    />
    <slot name="before_panels" />
    <div class="displayDiv">
      <grid-layout
        ref="gridLayoutRef"
        v-if="dashboardData.panels?.length > 0"
        :layout.sync="getDashboardLayout(dashboardData)"
        :col-num="12"
        :row-height="30"
        :is-draggable="!viewOnly"
        :is-resizable="!viewOnly"
        :vertical-compact="true"
        :autoSize="true"
        :restore-on-drag="true"
        :use-css-transforms="false"
      >
        <grid-item
          class="gridBackground"
          v-for="item in dashboardData.panels"
          :key="item.id"
          :x="getPanelLayout(item, 'x')"
          :y="getPanelLayout(item, 'y')"
          :w="getPanelLayout(item, 'w')"
          :h="getPanelLayout(item, 'h')"
          :i="getPanelLayout(item, 'i')"
          :minH="getMinimumHeight(item.type)"
          :minW="getMinimumWidth(item.type)"
          @resized="resizedEvent"
          @moved="movedEvent"
          drag-allow-from=".drag-allow"
        >
          <div style="height: 100%">
            <PanelContainer
              @onDeletePanel="onDeletePanel"
              @onViewPanel="onViewPanel"
              :viewOnly="viewOnly"
              :data="item"
              :dashboardId="dashboardData.id"
              :selectedTimeDate="currentTimeObj"
              :variablesData="variablesData"
              :width="getPanelLayout(item, 'w')"
              :height="getPanelLayout(item, 'h')"
              @updated:data-zoom="$emit('updated:data-zoom', $event)"
            >
            </PanelContainer>
          </div>
        </grid-item>
      </grid-layout>
    </div>

    <!-- view panel dialog -->
    <q-dialog v-model="showViewPanel">
      <q-card style="min-width: 95vw; min-height: 90vh">
        <ViewPanel
          :panelId="viewPanelId"
          :currentTimeObj="currentTimeObj"
          :initialVariableValues="initialVariableValues"
          @close-panel="() => (showViewPanel = false)"
          :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
        />
      </q-card>
    </q-dialog>
    <div v-if="!dashboardData.panels?.length">
      <!-- if data not available show nodata component -->
      <NoPanel @update:Panel="addPanelData" :view-only="viewOnly" />
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, provide, ref } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import VueGridLayout from "vue3-grid-layout";
import { useRouter } from "vue-router";
import { reactive } from "vue";
import PanelContainer from "../../components/dashboards/PanelContainer.vue";
import { useRoute } from "vue-router";
import { updateDashboard } from "../../utils/commons";
import NoPanel from "../../components/shared/grid/NoPanel.vue";
import VariablesValueSelector from "../../components/dashboards/VariablesValueSelector.vue";
import ViewPanel from "@/components/dashboards/viewPanel/ViewPanel.vue";

export default defineComponent({
  name: "RenderDashboardCharts",
  emits: ["onDeletePanel", "onViewPanel", "variablesData", "updated:data-zoom"],
  props: [
    "viewOnly",
    "dashboardData",
    "currentTimeObj",
    "initialVariableValues",
  ],
  components: {
    GridLayout: VueGridLayout.GridLayout,
    GridItem: VueGridLayout.GridItem,
    PanelContainer,
    NoPanel,
    VariablesValueSelector,
    ViewPanel,
  },
  setup(props: any, { emit }) {
    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const store = useStore();
    const $q = useQuasar();
    const gridLayoutRef = ref(null);

    const showViewPanel = ref(false);
    // holds the view panel id
    const viewPanelId = ref("");

    // variables data
    const variablesData = reactive({});
    const variablesDataUpdated = (data: any) => {
      Object.assign(variablesData, data);
      emit("variablesData", JSON.parse(JSON.stringify(variablesData)));
    };

    const hoveredSeriesState = ref({
      hoveredSeriesName: "",
      panelId: -1,
      dataIndex: -1,
      seriesIndex: -1,
      setHoveredSeriesName: function (name: string) {
        console.log("Called");
        
        hoveredSeriesState.value.hoveredSeriesName = name ?? "";
      },
      setIndex: function (
        dataIndex: number,
        seriesIndex: number,
        panelId: any
      ) {
        hoveredSeriesState.value.dataIndex = dataIndex ?? -1;
        hoveredSeriesState.value.seriesIndex = seriesIndex ?? -1;
        hoveredSeriesState.value.panelId = panelId ?? -1;
      },
    });

    // used provide and inject to share data between components
    // it is currently used in panelschemarendered, chartrenderer, convertpromqldata(via panelschemarenderer), and convertsqldata
    provide("hoveredSeriesState", hoveredSeriesState);

    // save the dashboard value
    const saveDashboard = async () => {
      await updateDashboard(
        store,
        store.state.selectedOrganization.identifier,
        props.dashboardData.dashboardId,
        props.dashboardData,
        route.query.folder ?? "default"
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
        query: {
          dashboard: route.query.dashboard,
          folder: route.query.folder ?? "default",
        },
      });
    };

    const movedEvent = (i, newX, newY) => {
      saveDashboard();
    };

    const resizedEvent = (i, newX, newY, newHPx, newWPx) => {
      window.dispatchEvent(new Event("resize"));
      saveDashboard();
    };

    const getDashboardLayout = (dashboardData) => {
      //map on each panels and return array of layouts
      return dashboardData.panels?.map((item) => item.layout) || [];
    };

    const getPanelLayout = (panelData, position) => {
      if (position == "x") {
        return panelData.layout?.x;
      } else if (position == "y") {
        return panelData?.layout?.y;
      } else if (position == "w") {
        return panelData?.layout?.w;
      } else if (position == "h") {
        return panelData?.layout?.h;
      } else if (position == "i") {
        return panelData?.layout?.i;
      }
      return 0;
    };

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

        default:
          break;
      }
    };

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

        default:
          break;
      }
    };

    const layoutUpdate = () => {
      if (gridLayoutRef.value) {
        gridLayoutRef.value.layoutUpdate();
      }
    };

    return {
      store,
      addPanelData,
      t,
      movedEvent,
      resizedEvent,
      getPanelLayout,
      getMinimumHeight,
      getMinimumWidth,
      variablesData,
      variablesDataUpdated,
      getDashboardLayout,
      gridLayoutRef,
      layoutUpdate,
      showViewPanel,
      viewPanelId,
    };
  },
  methods: {
    onDeletePanel(panelId) {
      this.$emit("onDeletePanel", panelId);
    },
    onViewPanel(panelId) {
      this.viewPanelId = panelId;
      this.showViewPanel = true;
    },
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

.gridBackground {
  background: #00000000 !important;
  border-radius: 4px;
  border-color: #c2c2c27a !important;
}
</style>
