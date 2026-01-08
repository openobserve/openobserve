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
  <div
    class="card-container"
    :class="store.state.printMode ? '' : 'tw:h-full tw:overflow-y-auto'"
  >
    <div class="tw:px-[0.625rem]">
      <!-- flag to check if dashboardVariablesAndPanelsDataLoaded which is used while print mode-->
      <span
        v-if="isDashboardVariablesAndPanelsDataLoadedDebouncedValue"
        id="dashboardVariablesAndPanelsDataLoaded"
        style="display: none"
      >
      </span>

      <VariablesValueSelector
        v-if="
          globalVariables.length > 0 ||
          dashboardData.variables?.showDynamicFilters
        "
        :scope="'global'"
        :variablesConfig="{ list: globalVariables }"
        :variablesManager="variablesManager"
        :selectedTimeDate="currentTimeObj['__global']"
        :initialVariableValues="initialVariableValues"
        data-test="global-variables-selector"
      />

      <!-- Tab List -->
      <TabList
        v-if="showTabs && selectedTabId !== null"
        class="q-mt-sm"
        :dashboardData="dashboardData"
        :viewOnly="viewOnly"
        @refresh="refreshDashboard"
      />

      <!-- Tab-scoped Variables (for active tab, if using manager) -->
      <VariablesValueSelector
        v-if="
          variablesManager && currentTabVariables.length > 0 && selectedTabId
        "
        :scope="'tabs'"
        :tabId="selectedTabId"
        :variablesConfig="{ list: currentTabVariables }"
        :variablesManager="variablesManager"
        :selectedTimeDate="currentTimeObj['__global']"
        :initialVariableValues="initialVariableValues"
        data-test="tab-variables-selector"
      />

      <slot name="before_panels" />
      <div class="displayDiv">
        <div
          v-if="
            store.state.printMode &&
            panels.length === 1 &&
            panels[0]?.type === 'table'
          "
          style="height: 100%; width: 100%"
        >
          <!-- Panel-scoped Variables (if any, if using manager) -->
          <VariablesValueSelector
            v-if="
              variablesManager && getPanelVariables(panels[0].id).length > 0
            "
            :scope="'panels'"
            :panelId="panels[0].id"
            :tabId="selectedTabId"
            :variablesConfig="{ list: getPanelVariables(panels[0].id) }"
            :variablesManager="variablesManager"
            :selectedTimeDate="currentTimeObj['__global']"
            :initialVariableValues="initialVariableValues"
            data-test="panel-variables-selector"
          />

          <PanelContainer
            @onDeletePanel="onDeletePanel"
            @onViewPanel="onViewPanel"
            :viewOnly="viewOnly"
            :data="panels[0] || {}"
            :dashboardId="dashboardData.dashboardId"
            :folderId="folderId"
            :reportId="folderId"
            :selectedTimeDate="
              (panels[0]?.id ? currentTimeObj?.[panels[0]?.id] : undefined) ||
              currentTimeObj['__global'] ||
              {}
            "
            :shouldRefreshWithoutCache="
              (panels?.[0]?.id
                ? shouldRefreshWithoutCacheObj?.[panels?.[0]?.id]
                : undefined) || false
            "
            :variablesData="getMergedVariablesForPanel(panels[0]?.id)"
            :currentVariablesData="getLiveVariablesForPanel(panels[0]?.id)"
            :forceLoad="forceLoad"
            :searchType="searchType"
            :runId="runId"
            :tabId="selectedTabId"
            :tabName="
              dashboardData?.tabs?.find(
                (tab: any) => tab.tabId === selectedTabId,
              )?.name
            "
            :dashboardName="dashboardName"
            :folderName="folderName"
            :showLegendsButton="showLegendsButton"
            @updated:data-zoom="$emit('updated:data-zoom', $event)"
            @onMovePanel="onMovePanel"
            @refreshPanelRequest="refreshPanelRequest"
            @refresh="refreshDashboard"
            @update:initial-variable-values="updateInitialVariableValues"
            @onEditLayout="openEditLayout"
            @contextmenu="$emit('chart:contextmenu', $event)"
            style="height: 100%; width: 100%"
          />
        </div>
        <div v-else ref="gridStackContainer" class="grid-stack">
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
              <!-- Panel with Panel-Level Variables -->
              <div class="panel-with-variables">
                <!-- Original Panel Container -->

                <PanelContainer
                  @onDeletePanel="onDeletePanel"
                  @onViewPanel="onViewPanel"
                  :viewOnly="viewOnly"
                  :data="item"
                  :dashboardId="dashboardData.dashboardId"
                  :folderId="folderId"
                  :reportId="reportId"
                  :selectedTimeDate="
                    currentTimeObj?.[item?.id] ||
                    currentTimeObj['__global'] ||
                    {}
                  "
                  :shouldRefreshWithoutCache="
                    shouldRefreshWithoutCacheObj?.[item?.id] || false
                  "
                  :variablesData="getMergedVariablesForPanel(item.id)"
                  :currentVariablesData="getLiveVariablesForPanel(item.id)"
                  :width="getPanelLayout(item, 'w')"
                  :height="getPanelLayout(item, 'h')"
                  :forceLoad="forceLoad"
                  :searchType="searchType"
                  :runId="runId"
                  :tabId="selectedTabId"
                  :tabName="
                    dashboardData?.tabs?.find(
                      (tab: any) => tab.tabId === selectedTabId,
                    )?.name
                  "
                  :dashboardName="dashboardName"
                  :folderName="folderName"
                  :allowAlertCreation="allowAlertCreation"
                  :showLegendsButton="showLegendsButton"
                  @updated:data-zoom="$emit('updated:data-zoom', $event)"
                  @onMovePanel="onMovePanel"
                  @refreshPanelRequest="refreshPanelRequest"
                  @refresh="refreshDashboard"
                  @update:initial-variable-values="updateInitialVariableValues"
                  @onEditLayout="openEditLayout"
                  @update:runId="updateRunId"
                  @contextmenu="$emit('chart:contextmenu', $event)"
                >
                  <!-- Panel-Level Variables (shown below drag-allow section) -->
                  <template #panel-variables>
                    <div
                      class="panel-variables-container q-px-xs q-py-xs"
                      :data-test="`dashboard-panel-${item.id}-variables`"
                    >
                      <VariablesValueSelector
                        v-if="
                          variablesManager &&
                          getPanelVariables(item.id).length > 0
                        "
                        :scope="'panels'"
                        :panelId="item.id"
                        :tabId="selectedTabId"
                        :variablesConfig="{ list: getPanelVariables(item.id) }"
                        :variablesManager="variablesManager"
                        :selectedTimeDate="currentTimeObj['__global']"
                        :initialVariableValues="initialVariableValues"
                        :style="{ marginBottom: '8px' }"
                        data-test="panel-variables-selector"
                      />
                    </div>
                  </template>
                </PanelContainer>
              </div>
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
            @update:initial-variable-values="updateInitialVariableValues"
          />
        </q-card>
      </q-dialog>
      <div v-if="!panels.length">
        <!-- if data not available show nodata component -->
        <NoPanel @update:Panel="addPanelData" :view-only="viewOnly" />
      </div>
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
import { useVariablesManager } from "@/composables/dashboard/useVariablesManager";
import type { useVariablesManager as UseVariablesManagerType } from "@/composables/dashboard/useVariablesManager";
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
    "variablesManagerReady",
  ],
  props: {
    viewOnly: {},
    dashboardData: {},
    folderId: {},
    reportId: {},
    currentTimeObj: {},
    shouldRefreshWithoutCacheObj: {},
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
    runId: {
      type: String,
      default: null,
    },
    dashboardName: {
      type: String,
      default: "",
    },
    folderName: {
      type: String,
      default: "",
    },
    allowAlertCreation: {
      type: Boolean,
      default: false,
    },
    showLegendsButton: {
      type: Boolean,
      default: false,
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

    const showViewPanel = ref(false);
    // holds the view panel id
    const viewPanelId = ref("");

    // Store IntersectionObserver for cleanup
    const panelObserver = ref<IntersectionObserver | null>(null);

    // inject selected tab, default will be default tab
    const selectedTabId = inject("selectedTabId", ref("default"));

    // Helper function to set up panel visibility observers
    const setupPanelObservers = async () => {
      // Clean up existing observer
      if (panelObserver.value) {
        panelObserver.value.disconnect();
        panelObserver.value = null;
      }

      // Wait for DOM to be ready
      await nextTick();

      // Create new IntersectionObserver
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const panelId = entry.target.getAttribute("gs-id");
            if (panelId && entry.isIntersecting) {
              // Mark panel as visible - variables will load if ready
              variablesManager.setPanelVisibility(panelId, true);
            } else if (panelId && !entry.isIntersecting) {
              // Panel is leaving viewport
              variablesManager.setPanelVisibility(panelId, false);
            }
          });
        },
        {
          threshold: 0.1, // Panel is visible if 10% is in viewport
        },
      );

      // Observe all current panel elements
      const panelElements =
        gridStackContainer.value?.querySelectorAll(".grid-stack-item");
      panelElements?.forEach((el: Element) => observer.observe(el));

      // Store observer for cleanup
      panelObserver.value = observer;
    };

    // Create our own variables manager instead of injecting from parent
    // This makes RenderDashboardCharts self-contained and reusable
    const variablesManager = useVariablesManager();

    // Removed committedVersion and getAllVariablesFlat - no longer needed after cleanup

    // Provide to child components (VariablesValueSelector, etc.)
    provide("variablesManager", variablesManager);

    // Computed properties for filtered variables by scope
    const globalVariables = computed(() => {
      return (
        props.dashboardData?.variables?.list?.filter(
          (v: any) => !v.scope || v.scope === "global",
        ) || []
      );
    });

    const currentTabVariables = computed(() => {
      if (!selectedTabId.value) return [];
      return (
        props.dashboardData?.variables?.list?.filter(
          (v: any) =>
            v.scope === "tabs" && v.tabs?.includes(selectedTabId.value),
        ) || []
      );
    });

    // Helper to get panel-scoped variables
    const getPanelVariables = (panelId: string) => {
      return (
        props.dashboardData?.variables?.list?.filter(
          (v: any) => v.scope === "panels" && v.panels?.includes(panelId),
        ) || []
      );
    };

    // Helper to get merged variables for a panel (global + tab + panel)
    const getMergedVariablesForPanel = (panelId: string) => {
      // Priority 1: Check for panel-specific committed/frozen override
      // This happens when user clicks Refresh on a specific panel
      if (currentVariablesDataRef.value?.[panelId]) {
        return currentVariablesDataRef.value[panelId];
      }

      // Priority 2: Use manager's committed state
      // CRITICAL: Use COMMITTED state (not live state)!
      // This prevents panels from reloading on every variable change
      // Panels only reload when user clicks Refresh (which commits the changes)
      const mergedVars = variablesManager.getCommittedVariablesForPanel(
        panelId,
        selectedTabId.value,
      );

      // Convert to old format for backward compatibility
      // Panel expects: { isVariablesLoading: boolean, values: Array<VariableRuntimeState> }
      return {
        isVariablesLoading: variablesManager.isLoading.value,
        values: mergedVars,
      };
    };

    // Helper to get LIVE (uncommitted) variables for a panel
    // Used for detecting changes and showing yellow refresh icon
    const getLiveVariablesForPanel = (panelId: string) => {
      // Get live variables for the selected tab and panel
      // This allows panel to detect uncommitted changes including panel-scoped ones
      const liveVars = variablesManager.getVariablesForPanel(
        panelId,
        selectedTabId.value,
      );

      // Convert to old format for backward compatibility
      return {
        isVariablesLoading: variablesManager.isLoading.value,
        values: liveVars,
      };
    };

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
    // This watcher handles dashboard-wide refresh (user clicks main Refresh button)
    watch(
      () => props?.currentTimeObj?.__global,
      () => {
        // Sync currentVariablesDataRef with manager's COMMITTED state
        // Use committed state to match what panels are rendering
        const allGlobalVars = variablesManager.committedVariablesData.global;
        currentVariablesDataRef.value = {
          __global: JSON.parse(
            JSON.stringify({
              isVariablesLoading: variablesManager.isLoading.value,
              values: allGlobalVars,
            }),
          ),
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

    const variablesDataUpdated = (data: any) => {
      try {
        // Update the live variables data (immediate UI state)
        variablesData.value = data;

        // The manager handles variable updates directly
        // This function is primarily for compatibility with legacy variable selectors
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
          column: 192, // 192-column grid for fine-grained positioning
          cellHeight: "17px", // Base cell height
          margin: 2, // Minimal margin between panels
          draggable: {
            enable: !props.viewOnly && !saveDashboardData.isLoading.value, // Enable dragging unless view-only or saving
            handle: ".drag-allow", // Only allow dragging from specific handle
          },
          resizable: {
            enable: !props.viewOnly && !saveDashboardData.isLoading.value, // Enable resizing unless view-only or saving
          },
          disableResize: props.viewOnly || saveDashboardData.isLoading.value, // Disable resize in view-only
          disableDrag: props.viewOnly || saveDashboardData.isLoading.value, // Disable drag in view-only
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
        // skip if viewOnly mode
        if (props.viewOnly) {
          return;
        }

        if (gridStackUpdateInProgress) {
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
    };
    // Optimized GridStack refresh function
    const refreshGridStack = async () => {
      if (!gridStackContainer.value) {
        return;
      }

      gridStackUpdateInProgress = true;

      // Fully destroy existing instance if it exists
      if (gridStackInstance) {
        gridStackInstance.destroy(false); // false = do not remove DOM elements
        gridStackInstance = null;
      }

      // Wait for Vue to update DOM with new panels
      await nextTick();
      await nextTick();

      // Re-initialize GridStack
      initGridStack();

      const grid = gridStackInstance;
      if (!grid) {
        gridStackUpdateInProgress = false;
        return;
      }

      grid.batchUpdate();
      // Clear any auto-discovered widgets to ensure we add them explicitly with correct config
      grid.removeAll(false);

      if (panels.value.length === 0) {
        grid.batchUpdate(false);
        gridStackUpdateInProgress = false;
        return;
      }

      // Explicitly add widgets with correct layout configuration
      for (const panel of panels.value) {
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
          }
        }
      }

      grid.batchUpdate(false);

      gridStackUpdateInProgress = false;
      window.dispatchEvent(new Event("resize"));

      // Re-setup panel observers for the new panels
      await setupPanelObservers();
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
        return panelData?.layout?.w || 96;
      } else if (position == "h") {
        return panelData?.layout?.h || 18;
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
          return 8; // 8 grid units minimum height

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
          return 12; // 12 grid units minimum width

        default:
          break;
      }
    };

    // disable resize and drag for view only mode and when saving dashboard
    // do it based on watcher on viewOnly and saveDashboardData.isLoading
    watch(
      () => props.viewOnly || saveDashboardData.isLoading.value,
      async (newValue) => {
        if (gridStackInstance) {
          gridStackInstance.setStatic(newValue === true);
        }

        // If switching from viewOnly (print mode) to interactive, force a refresh
        if (newValue === false) {
          await nextTick();
          await refreshGridStack();
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

      // Set up IntersectionObserver for panel visibility (for lazy loading panel-scoped variables)
      await setupPanelObservers();
    });

    // Initialize variables manager when dashboard data changes
    watch(
      () => props.dashboardData,
      async (newDashboardData) => {
        if (!newDashboardData) return;

        try {
          // Initialize variables manager with dashboard variables
          await variablesManager.initialize(
            newDashboardData?.variables?.list || [],
            newDashboardData,
          );

          // Load variables from URL parameters (e.g., ?var-foo=bar)
          // This is critical for dashboard links from the list page
          variablesManager.loadFromUrl(route);

          // INITIALIZATION COMMIT: Commit initial state to populate committedVariablesData
          // This serves multiple purposes:
          // 1. Prevents false "uncommitted changes" indicator on dashboard load
          // 2. Allows panels to see variable structure immediately (even with null/pending values)
          // 3. Establishes baseline for auto-commit logic (first load vs reload detection)
          variablesManager.commitAll();

          // Notify parent that manager is ready
          emit("variablesManagerReady", variablesManager);

          // Set the selected tab as visible if available
          if (selectedTabId.value) {
            variablesManager.setTabVisibility(selectedTabId.value, true);
          }
        } catch (error: any) {
          console.error("Error initializing variables manager:", error);
        }
      },
      { immediate: true },
    );

    // PROGRESSIVE LOADING: Auto-commit when variables finish loading for the first time
    // This enables panels to see variable values immediately without user clicking Refresh
    //
    // How it works:
    // - Watch for isVariablePartialLoaded transitions from false → true
    // - Check if variable was already loaded in committed state
    // - If NOT in committed state (or was never loaded) → first load → AUTO-COMMIT
    // - If in committed state with isVariablePartialLoaded=true → reload → NO COMMIT
    //
    // Scenarios:
    // 1. Initial dashboard load → variables not in committed state → AUTO-COMMIT ✅
    // 2. Tab switch → tab variables not in committed state → AUTO-COMMIT ✅
    // 3. Panel visible → panel variables not in committed state → AUTO-COMMIT ✅
    // 4. User changes parent → child reloads, but child already in committed state → NO COMMIT ✅
    watch(
      () => ({
        global: variablesManager.variablesData.global,
        tabs: variablesManager.variablesData.tabs,
        panels: variablesManager.variablesData.panels,
      }),
      (newData) => {
        // Helper to find variable in committed state
        const findInCommitted = (v: any) => {
          if (v.scope === 'global') {
            return variablesManager.committedVariablesData.global.find(
              (cv: any) => cv.name === v.name
            );
          } else if (v.scope === 'tabs' && v.tabId) {
            const tabVars = variablesManager.committedVariablesData.tabs[v.tabId] || [];
            return tabVars.find((cv: any) => cv.name === v.name);
          } else if (v.scope === 'panels' && v.panelId) {
            const panelVars = variablesManager.committedVariablesData.panels[v.panelId] || [];
            return panelVars.find((cv: any) => cv.name === v.name);
          }
          return null;
        };

        // Check all variables for newly loaded ones
        const allVariables = [
          ...newData.global,
          ...Object.values(newData.tabs).flat(),
          ...Object.values(newData.panels).flat(),
        ];

        let shouldAutoCommit = false;

        for (const variable of allVariables) {
          // Only check query_values variables that just finished loading
          if (variable.type !== 'query_values') continue;
          if (!variable.isVariablePartialLoaded) continue;

          // Find this variable in committed state
          const committedVar = findInCommitted(variable);

          if (!committedVar) {
            // Variable doesn't exist in committed state → first load
            shouldAutoCommit = true;
            break;
          } else if (committedVar.isVariablePartialLoaded === false) {
            // Variable exists but was never loaded → first load
            shouldAutoCommit = true;
            break;
          }
          // else: committedVar.isVariablePartialLoaded === true → reload → no commit
        }

        if (shouldAutoCommit) {
          // Auto-commit so panels see the new values
          variablesManager.commitAll();
        }
      },
      { deep: true }
    );

    // Watch for tab visibility changes
    watch(
      () => selectedTabId.value,
      (newTabId, oldTabId) => {
        if (newTabId) {
          // Mark new tab as visible - variables will load if ready
          variablesManager.setTabVisibility(newTabId, true);

          // Mark old tab as hidden (optional - for cleanup)
          if (oldTabId && oldTabId !== newTabId) {
            variablesManager.setTabVisibility(oldTabId, false);
          }
        }
      },
      { immediate: true },
    );

    // Clean up GridStack instance before component unmounts to prevent memory leaks
    onBeforeUnmount(() => {
      // Clean up IntersectionObserver
      if (panelObserver.value) {
        panelObserver.value.disconnect();
        panelObserver.value = null;
      }

      // Clean up GridStack instance
      if (gridStackInstance) {
        gridStackInstance.off("change");
        gridStackInstance.off("resizestop");
        gridStackInstance.destroy(false);
        gridStackInstance = null;
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
     * Updates the initial variable values (used for drilldowns)
     * @param args - Any arguments (not used with variables manager)
     */
    const updateInitialVariableValues = async (...args: any) => {
      // if view panel is open then close it
      showViewPanel.value = false;

      // first, refresh the dashboard
      refreshDashboard(true);

      // NOTE: With the variables manager, this works without changing the initial variable values
      // The manager handles variable updates automatically

      // This is necessary to ensure that panels refresh automatically based on the drilldown
      // without requiring the user to click on refresh to load the panel/whole dashboard
      // Use committed state to match panel expectations
      const allGlobalVars = variablesManager.committedVariablesData.global;
      currentVariablesDataRef.value = {
        __global: JSON.parse(
          JSON.stringify({
            isVariablesLoading: variablesManager.isLoading.value,
            values: allGlobalVars,
          }),
        ),
      };
    };

    const refreshPanelRequest = (
      panelId,
      shouldRefreshWithoutCache = false,
    ) => {
      emit("refreshPanelRequest", panelId, shouldRefreshWithoutCache);

      // Panel-specific refresh: creates a snapshot for this panel only
      // Commit ONLY the panel scope if needed,
      // but the main reload driver is the local override in currentVariablesDataRef
      variablesManager.commitScope("panels", panelId);

      // Get merged variables for this panel and store as override
      const panelVars = variablesManager.getVariablesForPanel(
        panelId,
        selectedTabId.value,
      );
      currentVariablesDataRef.value = {
        ...currentVariablesDataRef.value,
        [panelId]: JSON.parse(
          JSON.stringify({
            isVariablesLoading: variablesManager.isLoading.value,
            values: panelVars,
          }),
        ),
      };
    };

    const updateRunId = (newRunId) => {
      emit("update:runId", newRunId);
    };

    const openEditLayout = (id: string) => {
      emit("openEditLayout", id);
    };

    // Exposed methods for parent components to interact with variables manager
    const commitAllVariables = () => {
      variablesManager.commitAll();
    };

    const getUrlParams = (options = { useLive: false }) => {
      return variablesManager.getUrlParams(options);
    };

    const getVariablesManager = () => {
      return variablesManager;
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
      updateRunId,
      updateInitialVariableValues,
      isDashboardVariablesAndPanelsDataLoadedDebouncedValue,
      currentQueryTraceIds,
      openEditLayout,
      saveDashboardData,
      currentVariablesDataRef,
      resetGridLayout,
      refreshGridStack,
      // New scoped variables properties
      variablesManager,
      globalVariables,
      currentTabVariables,
      getPanelVariables,
      getMergedVariablesForPanel,
      getLiveVariablesForPanel,
      // Exposed methods for parent components
      commitAllVariables,
      getUrlParams,
      getVariablesManager,
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
    // height: 100%;
  }
}

.panel-with-variables {
  height: 100%;
  display: flex;
  flex-direction: column;
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
