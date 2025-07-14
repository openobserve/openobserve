<!-- Copyright 2023 OpenObserve Inc.

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
    <!-- flag to check if dashboardVariablesAndPanelsDataLoaded which is used while print mode-->
    <span
      v-if="isDashboardVariablesAndPanelsDataLoadedDebouncedValue"
      id="dashboardVariablesAndPanelsDataLoaded"
      style="display: none"
    >
    </span>
    <VariablesValueSelector
      v-if="currentTimeObj['__global'] || currentTimeObj['__variables'] "
      :variablesConfig="dashboardData?.variables"
      :showDynamicFilters="dashboardData.variables?.showDynamicFilters"
      :selectedTimeDate="currentTimeObj['__variables'] || currentTimeObj['__global']"
      :initialVariableValues="initialVariableValues"
      @variablesData="variablesDataUpdated"
      ref="variablesValueSelectorRef"
    />
    <TabList
      v-if="showTabs && selectedTabId !== null"
      class="q-mt-sm"
      :dashboardData="dashboardData"
      :viewOnly="viewOnly"
      @refresh="refreshDashboard"
    />
    <slot name="before_panels" />
    <div class="displayDiv">
      <div
        v-if="
          store.state.printMode &&
          panels.length === 1 &&
          panels[0].type === 'table'
        "
        style="height: 100%; width: 100%"
      >
        <PanelContainer
          @onDeletePanel="onDeletePanel"
          @onViewPanel="onViewPanel"
          :viewOnly="viewOnly"
          :data="panels[0] || {}"
          :dashboardId="dashboardData.dashboardId"
          :folderId="folderId"
          :reportId="folderId"
          :selectedTimeDate="
            (panels[0]?.id ? currentTimeObj[panels[0].id] : undefined) ||
            currentTimeObj['__global'] ||
            {}
          "
          :variablesData="
            currentVariablesDataRef[panels[0].id] ||
            currentVariablesDataRef['__global']
          "
          :forceLoad="forceLoad"
          :searchType="searchType"
          @updated:data-zoom="$emit('updated:data-zoom', $event)"
          @onMovePanel="onMovePanel"
          @refreshPanelRequest="refreshPanelRequest"
          @refresh="refreshDashboard"
          @update:initial-variable-values="updateInitialVariableValues"
          @onEditLayout="openEditLayout"
          style="height: 100%; width: 100%"
        />
      </div>
      <div
        v-else
        ref="gridStackContainer"
        class="grid-stack"
      >
        <div
          v-for="item in panels"
          :key="item.id + selectedTabId"
          :gs-id="item.id"
          :gs-x="getPanelLayout(item, 'x')"
          :gs-y="getPanelLayout(item, 'y')"
          :gs-w="getPanelLayout(item, 'w')"
          :gs-h="getPanelLayout(item, 'h')"
          :gs-min-w="getMinimumWidth(item.type)"
          :gs-min-h="getMinimumHeight(item.type)"
          class="grid-stack-item gridBackground"
          :class="store.state.theme == 'dark' ? 'dark' : ''"
        >
          <div class="grid-stack-item-content">
            <PanelContainer
              @onDeletePanel="onDeletePanel"
              @onViewPanel="onViewPanel"
              :viewOnly="viewOnly"
              :data="item"
              :dashboardId="dashboardData.dashboardId"
              :folderId="folderId"
              :reportId="reportId"
              :selectedTimeDate="
                currentTimeObj[item.id] || currentTimeObj['__global'] || {}
              "
              :variablesData="
                currentVariablesDataRef[item.id] ||
                currentVariablesDataRef['__global']
              "
              :currentVariablesData="variablesData"
              :width="getPanelLayout(item, 'w')"
              :height="getPanelLayout(item, 'h')"
              :forceLoad="forceLoad"
              :searchType="searchType"
              @updated:data-zoom="$emit('updated:data-zoom', $event)"
              @onMovePanel="onMovePanel"
              @refreshPanelRequest="refreshPanelRequest"
              @refresh="refreshDashboard"
              @update:initial-variable-values="updateInitialVariableValues"
              @onEditLayout="openEditLayout"
            >
            </PanelContainer>
          </div>
        </div>
      </div>
    </div>

    <!-- view panel dialog -->
    <q-dialog
      v-model="showViewPanel"
      :no-route-dismiss="true"
      full-height
      full-width
    >
      <q-card style="overflow: hidden">
        <ViewPanel
          :folderId="folderId"
          :dashboardId="dashboardData.dashboardId"
          :panelId="viewPanelId"
          :selectedDateForViewPanel="selectedDateForViewPanel"
          :initialVariableValues="variablesData"
          :searchType="searchType"
          @close-panel="() => (showViewPanel = false)"
          :class="store.state.theme == 'dark' ? 'dark-mode' : 'bg-white'"
          @update:initial-variable-values="updateInitialVariableValues"
        />
      </q-card>
    </q-dialog>
    <div v-if="!panels.length">
      <!-- if data not available show nodata component -->
      <NoPanel @update:Panel="addPanelData" :view-only="viewOnly" />
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  onActivated,
  onMounted,
  onUnmounted,
  onBeforeUnmount,
  provide,
  ref,
  watch,
  nextTick,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { reactive } from "vue";
import PanelContainer from "../../components/dashboards/PanelContainer.vue";
import { useRoute } from "vue-router";
import {
  checkIfVariablesAreLoaded,
  updateDashboard,
} from "../../utils/commons";
import { useCustomDebouncer } from "../../utils/dashboard/useCustomDebouncer";
import NoPanel from "../../components/shared/grid/NoPanel.vue";
import VariablesValueSelector from "../../components/dashboards/VariablesValueSelector.vue";
import TabList from "@/components/dashboards/tabs/TabList.vue";
import { inject } from "vue";
import useNotifications from "@/composables/useNotifications";
import { useLoading } from "@/composables/useLoading";
import { GridStack } from "gridstack";
import "gridstack/dist/gridstack.min.css";

const ViewPanel = defineAsyncComponent(() => {
  return import("@/components/dashboards/viewPanel/ViewPanel.vue");
});

export default defineComponent({
  name: "RenderDashboardCharts",
  emits: [
    "onDeletePanel",
    "onViewPanel",
    "variablesData",
    "refreshedVariablesDataUpdated",
    "updated:data-zoom",
    "refreshPanelRequest",
    "refresh",
    "onMovePanel",
    "panelsValues",
    "searchRequestTraceIds",
  ],
  props: {
    viewOnly: {},
    dashboardData: {},
    folderId: {},
    reportId: {},
    currentTimeObj: {},
    initialVariableValues: { value: {} },
    selectedDateForViewPanel: {},
    showTabs: {
      type: Boolean,
      default: false,
    },
    forceLoad: {
      type: Boolean,
      default: false,
      required: false,
    },
    searchType: {
      default: null,
      type: String || null,
    },
  },

  components: {
    PanelContainer,
    NoPanel,
    VariablesValueSelector,
    ViewPanel,
    TabList,
  },
  setup(props: any, { emit }) {
    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const store = useStore();
    const gridStackContainer = ref(null);

    // Initialize GridStack instance 
    // (not with ref: https://github.com/gridstack/gridstack.js/issues/2115)
    let gridStackInstance = null;
    const variablesValueSelectorRef = ref(null);

    const showViewPanel = ref(false);
    // holds the view panel id
    const viewPanelId = ref("");

    // inject selected tab, default will be default tab
    const selectedTabId = inject("selectedTabId", ref("default"));

    const panels: any = computed(() => {
      return selectedTabId.value !== null
        ? (props.dashboardData?.tabs?.find(
            (it: any) => it.tabId === selectedTabId.value,
          )?.panels ?? [])
        : [];
    });

    const {
      showPositiveNotification,
      showErrorNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();
    const refreshDashboard = (onlyIfRequired = false) => {
      emit("refresh", onlyIfRequired);
    };

    const onMovePanel = (panelId: any, newTabId: any) => {
      emit("onMovePanel", panelId, newTabId);
    };

    // variables data
    const variablesData = ref({});
    const currentVariablesDataRef: any = ref({ __global: {} });

    // ======= [START] dashboard PrintMode =======

    //reactive object for loading state of variablesData and panels
    const variablesAndPanelsDataLoadingState = reactive({
      variablesData: {},
      panels: {},
      searchRequestTraceIds: {},
    });

    // provide variablesAndPanelsDataLoadingState to share data between components
    provide(
      "variablesAndPanelsDataLoadingState",
      variablesAndPanelsDataLoadingState,
    );

    //computed property based on panels and variables loading state
    const isDashboardVariablesAndPanelsDataLoaded = computed(() => {
      // Get values of variablesData and panels
      const variablesDataValues = Object.values(
        variablesAndPanelsDataLoadingState.variablesData,
      );
      const panelsValues = Object.values(
        variablesAndPanelsDataLoadingState.panels,
      );

      // Check if every value in both variablesData and panels is false
      const isAllVariablesAndPanelsDataLoaded =
        variablesDataValues.every((value) => value === false) &&
        panelsValues.every((value) => value === false);

      return isAllVariablesAndPanelsDataLoaded;
    });

    watch(isDashboardVariablesAndPanelsDataLoaded, () => {
      emit("panelsValues", isDashboardVariablesAndPanelsDataLoaded.value);
    });

    // watch on currentTimeObj to update the variablesData
    watch(
      () => props?.currentTimeObj?.__global,
      () => {
        currentVariablesDataRef.value = {
          __global: JSON.parse(JSON.stringify(variablesData.value)),
        };
      },
    );

    watch(
      () => currentVariablesDataRef.value,
      () => {
        if (currentVariablesDataRef.value?.__global) {
          emit("variablesData", currentVariablesDataRef.value?.__global);
        }
      },
      { deep: true },
    );

    watch(
      () => variablesData.value,
      () => {
        emit("refreshedVariablesDataUpdated", variablesData.value);
      },
      { deep: true },
    );

    const currentQueryTraceIds = computed(() => {
      const traceIds = Object.values(
        variablesAndPanelsDataLoadingState.searchRequestTraceIds,
      );

      if (traceIds.length > 0) {
        return traceIds?.flat();
      }
      return [];
    });

    watch(currentQueryTraceIds, () => {
      emit("searchRequestTraceIds", currentQueryTraceIds.value);
    });

    // Create debouncer for isDashboardVariablesAndPanelsDataLoaded
    let {
      valueRef: isDashboardVariablesAndPanelsDataLoadedDebouncedValue,
      setImmediateValue,
      setDebounceValue,
    } = useCustomDebouncer(false, 3000);

    onActivated(() => {
      // set the initial value as false on component activated
      // also, this function will clear the settimeout if previously set
      setImmediateValue(false);
      window.dispatchEvent(new Event("resize"));
    });

    // Watch for changes in the computed property and update the debouncer accordingly
    watch(isDashboardVariablesAndPanelsDataLoaded, (newValue) => {
      // if value is false, then immediately set the value
      if (isDashboardVariablesAndPanelsDataLoaded.value === false) {
        setImmediateValue(newValue);
      } else if (store.state.printMode) {
        // if value is true, then debounce the value
        setDebounceValue(newValue);
      }
    });

    let needsVariablesAutoUpdate = true;

    const variablesDataUpdated = (data: any) => {
      try {
        // update the variables data
        variablesData.value = data;
        if (needsVariablesAutoUpdate) {
          // check if the length is > 0
          if (checkIfVariablesAreLoaded(variablesData.value)) {
            needsVariablesAutoUpdate = false;
          }
          currentVariablesDataRef.value = { __global: variablesData.value };
        }
        return;      
      } catch (error) {
        return;
      }
    };

    // ======= [END] dashboard PrintMode =======

    const hoveredSeriesState = ref({
      hoveredSeriesName: "",
      panelId: -1,
      dataIndex: -1,
      seriesIndex: -1,
      hoveredTime: null,
      setHoveredSeriesName: function (name: string) {
        hoveredSeriesState.value.hoveredSeriesName = name ?? "";
      },
      setIndex: function (
        dataIndex: number,
        seriesIndex: number,
        panelId: any,
        hoveredTime?: any,
      ) {
        hoveredSeriesState.value.dataIndex = dataIndex ?? -1;
        hoveredSeriesState.value.seriesIndex = seriesIndex ?? -1;
        hoveredSeriesState.value.panelId = panelId ?? -1;
        hoveredSeriesState.value.hoveredTime = hoveredTime ?? null;
      },
    });

    // used provide and inject to share data between components
    // it is currently used in panelschemarendered, chartrenderer, convertpromqldata(via panelschemarenderer), and convertsqldata
    provide("hoveredSeriesState", hoveredSeriesState);

    // save the dashboard value
    const saveDashboardData = useLoading(async () => {
      try {
        await updateDashboard(
          store,
          store.state.selectedOrganization.identifier,
          props.dashboardData.dashboardId,
          props.dashboardData,
          route.query.folder ?? "default",
        );

        showPositiveNotification("Dashboard updated successfully");
      } catch (error: any) {
        console.error("Error while saving dashboard:", error);
        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              "Dashboard update failed",
          );
        } else {
          showErrorNotification(error?.message ?? "Dashboard update failed", {
            timeout: 2000,
          });
        }

        // refresh dashboard
        refreshDashboard();
      } finally {
      }
    });

    //add panel
    const addPanelData = () => {
      return router.push({
        path: "/dashboards/add_panel",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder ?? "default",
          tab: route.query.tab ?? props.dashboardData.panels[0]?.tabId,
        },
      });
    };    
    // GridStack initialization and methods
    
    let gridStackUpdateInProgress = false;
    const initGridStack = () => {

      if (!gridStackContainer.value || gridStackInstance) return;

      // Initialize GridStack with optimal configuration
      gridStackInstance = GridStack.init(
        {
          column: 48, // 48-column grid for fine-grained positioning
          cellHeight: "34px", // Base cell height
          margin: 2, // Minimal margin between panels
          draggable: {
            enable: !props.viewOnly && !saveDashboardData.isLoading.value, // Enable dragging unless view-only or saving
            handle: ".drag-allow", // Only allow dragging from specific handle
          },
          resizable: {
            enable: !props.viewOnly && !saveDashboardData.isLoading.value, // Enable resizing unless view-only or saving
          },
          acceptWidgets: false, // Don't accept external widgets
          removable: false, // Don't allow removal by dragging out
          animate: false, // Disable animations for better performance
          float: false, // Keep panels aligned to grid
          minRow: 1, // Minimum grid height
          disableOneColumnMode: true, // Prevent mobile column collapse
          styleInHead: true, // Inject styles in head for better performance
        },
        gridStackContainer.value,
      );

      // Event listeners for GridStack interactions

      // Handle layout changes (drag/resize) - only update layout data, don't save during operations
      gridStackInstance.on("change", async (event, items) => {
    
        if(gridStackUpdateInProgress) {
          return;
        }

        if (items && items.length > 0) {
          updatePanelLayouts(items); // Update panel layout data
          saveDashboardData.execute(); // Save changes to backend
        }
      });

      // Trigger window resize after panel resize to update charts
      gridStackInstance.on("resizestop", (event, element) => {
        window.dispatchEvent(new Event("resize"));
      });
    }; // Update panel layout data from GridStack items
    const updatePanelLayouts = (items) => {
      items.forEach((item) => {
        const panelId = item.id;
        const panel = panels.value.find((p) => p.id === panelId);
        if (panel && panel.layout) {
          // Update panel layout coordinates
          panel.layout.x = item.x;
          panel.layout.y = item.y;
          panel.layout.w = item.w;
          panel.layout.h = item.h;
        }
      });
    }; // Optimized GridStack refresh function
    const refreshGridStack = async () => {
      if (!gridStackInstance || !gridStackContainer.value) {
        return;
      }

      gridStackUpdateInProgress = true;

      // Wait for Vue to finish DOM updates
      await nextTick();
      await nextTick();

      const grid = gridStackInstance;

      // IMPORTANT: Disable animation and floating during reconstruction for better performance
      grid.float(false);
      grid.setAnimation(false);

      // Clear all existing widgets completely to prevent stale references
      const existingElements = grid.getGridItems();
    
      // Force clear any remaining grid state
      grid.removeAll(false);
      // Wait for DOM cleanup to complete
      await nextTick(); // Ensure DOM is ready

      if (panels.value.length === 0) {
        return;
      }

      // Add panels in sorted order to maintain proper layout
      for (const panel of panels.value) {
        // Wait for the element to be available in DOM
        await nextTick();
        const element = gridStackContainer.value.querySelector(
          `[gs-id="${panel.id}"]`,
        );

        if (element) {
          try {
            const layoutConfig = {
              x: getPanelLayout(panel, "x"),
              y: getPanelLayout(panel, "y"),
              w: getPanelLayout(panel, "w"),
              h: getPanelLayout(panel, "h"),
              minW: getMinimumWidth(panel.type),
              minH: getMinimumHeight(panel.type),
              id: panel.id,
              noMove: props.viewOnly,
              noResize: props.viewOnly,
            };

            // Make widget with explicit layout
            grid.makeWidget(element, layoutConfig);
          } catch (error) {
            // Error adding widget, skip this panel
            console.error(
              `refreshGridStack: Error adding widget for ${panel.id}`,
              error,
            );
          }
        }
      }

      // Wait for all widgets to be added
      await nextTick(); // Ensure DOM is updated


      // Trigger window resize to ensure charts render correctly
      gridStackUpdateInProgress = false;
      window.dispatchEvent(new Event("resize"));
    };

    // Add a method to reset grid layout
    const resetGridLayout = async () => {
      if (!gridStackInstance) return;

      // Remove all widgets
      gridStackInstance.removeAll(false);

      // Wait for cleanup
      await nextTick();

      // Refresh with current panels
      await refreshGridStack();
    };

    const getPanelLayout = (panelData, position) => {
      if (position == "x") {
        return panelData.layout?.x || 0;
      } else if (position == "y") {
        return panelData?.layout?.y || 0;
      } else if (position == "w") {
        return panelData?.layout?.w || 12;
      } else if (position == "h") {
        return panelData?.layout?.h || 8;
      } else if (position == "i") {
        return panelData?.layout?.i || panelData.id;
      }
      return 0;
    };

    // Get minimum height based on panel type for optimal display
    const getMinimumHeight = (type) => {
      switch (type) {
        case "area":
        case "bar":
        case "h-bar":
        case "line":
        case "pie":
        case "scatter":
        case "table":
          return 4; // 4 grid units minimum height

        default:
          break;
      }
    };

    // Get minimum width based on panel type for optimal display
    const getMinimumWidth = (type) => {
      switch (type) {
        case "area":
        case "bar":
        case "h-bar":
        case "line":
        case "pie":
        case "scatter":
        case "table":
          return 3; // 3 grid units minimum width

        default:
          break;
      }
    };

    // disable resize and drag for view only mode and when saving dashboard
    // do it based on watcher on viewOnly and saveDashboardData.isLoading
    watch(
      () => props.viewOnly || saveDashboardData.isLoading.value,
      (newValue) => {
        if (gridStackInstance) {
          gridStackInstance.setStatic(newValue === true);
        }
      },
      { immediate: true },
    );

    watch(
      () => [selectedTabId.value],
      async (newPanels, oldPanels) => {
        // Only refresh if the number of tab changes
        await nextTick();
        await refreshGridStack();
      },
      { deep: true }, // Deep watch to catch layout changes within panels
    );

    // Initialize GridStack when component is mounted
    onMounted(async () => {
      await nextTick(); // Wait for DOM to be ready
      initGridStack(); // Initialize the grid system
      await nextTick(); // Wait for grid initialization to complete
    });

    // Clean up GridStack instance before component unmounts to prevent memory leaks
    onBeforeUnmount(() => {
      // Clean up GridStack instance
      if (gridStackInstance) {
        gridStackInstance.off("change");
        gridStackInstance.off("resizestop");
        gridStackInstance.destroy(false);
        gridStackInstance = null;
      }

      // Clean up other references
      if (variablesValueSelectorRef.value) {
        variablesValueSelectorRef.value = null;
      }
    });

    // Final cleanup when component is fully unmounted
    onUnmounted(() => {
      if (gridStackInstance) {
        gridStackInstance.destroy(false);
        gridStackInstance = null;
      }
    });

    /**
     * Updates the initial variable values using the variable value selector ref
     * @param args - Any arguments to be passed to `changeInitialVariableValues` method
     */
    const updateInitialVariableValues = async (...args: any) => {
      // if view panel is open then close it
      showViewPanel.value = false;

      // first, refresh the dashboard
      refreshDashboard(true);

      // NOTE: after variables in variables feature, it works without changing the initial variable values
      // then, update the initial variable values
      await variablesValueSelectorRef.value.changeInitialVariableValues(
        ...args,
      );

      // This is necessary to ensure that panels refresh automatically based on the drilldown
      // without requiring the user to click on refresh to load the panel/whole dashboard
      currentVariablesDataRef.value = {
        __global: JSON.parse(JSON.stringify(variablesData.value)),
      };
    };

    const refreshPanelRequest = (panelId) => {
      emit("refreshPanelRequest", panelId);

      currentVariablesDataRef.value = {
        ...currentVariablesDataRef.value,
        [panelId]: variablesData.value,
      };
    };

    const openEditLayout = (id: string) => {
      emit("openEditLayout", id);
    };

    return {
      store,
      addPanelData,
      t,
      getPanelLayout,
      getMinimumHeight,
      getMinimumWidth,
      variablesData,
      variablesDataUpdated,
      gridStackContainer,
      showViewPanel,
      viewPanelId,
      selectedTabId,
      panels,
      refreshDashboard,
      onMovePanel,
      refreshPanelRequest,
      variablesValueSelectorRef,
      updateInitialVariableValues,
      isDashboardVariablesAndPanelsDataLoadedDebouncedValue,
      currentQueryTraceIds,
      openEditLayout,
      saveDashboardData,
      currentVariablesDataRef,
      resetGridLayout,
      refreshGridStack,
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

.displayDiv {
  clear: both;
  min-height: 0;
  height: auto;
}

.gridBackground {
  background: transparent !important;
  border-radius: 4px;
  border-color: #c2c2c27a !important;
}

.gridBackground.dark {
  border-color: rgba(204, 204, 220, 0.12) !important;
}

/* Optimized GridStack layout styles for better performance and visual feedback */
.grid-stack {
  background: transparent;
  margin: 2px;

  /* When grid is static (disabled), hide resize handles */
  &.grid-stack-static {
    .ui-resizable-handle {
      display: none !important;
    }
  }
}

.grid-stack-item {
  background: transparent;

  &.dark {
    border-color: rgba(204, 204, 220, 0.12) !important;
  }
  .grid-stack-item-content {
    border: 1px solid #c2c2c27a;
    border-radius: 4px;
    overflow: visible;
    border-radius: inherit;
  }
}

/* GridStack theme overrides */
:deep(.grid-stack) {
  .grid-stack-item {
    .drag-allow {
      cursor: move;
    }

    &.ui-draggable-dragging {
      opacity: 0.8;
      z-index: 1000;
      transition: transform 0.15s ease;
    }

    &.ui-resizable-resizing {
      opacity: 0.9;
    }

    > .ui-resizable-handle {
      background: none;

      &.ui-resizable-se {
        background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M8 2 L8 8 L2 8' stroke='%23999999' stroke-width='1.5' fill='none' stroke-linecap='round'/></svg>")
          no-repeat center;
        background-size: 8px 8px;
        width: 16px;
        height: 16px;
        bottom: 2px;
        right: 2px;
        cursor: se-resize;
        transform: rotate(0deg) !important;
      }
    }
  }
}

/* Ensure proper box-sizing */
.grid-stack-item,
.grid-stack-item-content {
  box-sizing: border-box;
}
</style>
