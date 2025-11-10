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
    :class="store.state.printMode ? '' : 'tw-h-full tw-overflow-y-auto'"
  >
    <div class="tw-px-[0.625rem]">
      <!-- flag to check if dashboardVariablesAndPanelsDataLoaded which is used while print mode-->
      <span
        v-if="isDashboardVariablesAndPanelsDataLoadedDebouncedValue"
        id="dashboardVariablesAndPanelsDataLoaded"
        style="display: none"
      >
      </span>
      <!-- GLOBAL VARIABLES - Always visible at top -->
      <div
        v-if="currentTimeObj['__global'] || currentTimeObj['__variables']"
        class="global-variables-container q-mb-sm"
      >
        <VariablesValueSelector
          key="global-variables"
          :variablesConfig="globalVariablesConfig"
          :showDynamicFilters="dashboardData.variables?.showDynamicFilters"
          :selectedTimeDate="
            currentTimeObj['__variables'] || currentTimeObj['__global']
          "
          :initialVariableValues="initialVariableValues"
          @variablesData="variablesDataUpdated"
          ref="variablesValueSelectorRef"
        />
      </div>
      <!-- TABS WITH TAB-LEVEL VARIABLES -->
      <div v-if="showTabs && selectedTabId !== null" class="tabs-container">
        <!-- Tab Headers -->
        <TabList
          class="q-mt-sm"
          :dashboardData="dashboardData"
          :viewOnly="viewOnly"
          @refresh="refreshDashboard"
        />

        <!-- Tab-Level Variables (shown below active tab) -->
        <div
          v-if="activeTabVariables.length > 0"
          class="tab-variables-container q-mt-xs q-px-sm q-py-xs"
          :data-test="`dashboard-tab-${selectedTabId}-variables`"
        >
          <VariablesValueSelector
            :key="`tab-variables-${selectedTabId}`"
            ref="tabVariablesValueSelectorRef"
            :variablesConfig="tabVariablesConfig"
            :showDynamicFilters="false"
            :selectedTimeDate="
              currentTimeObj['__variables'] || currentTimeObj['__global']
            "
            :initialVariableValues="mergedVariablesWrapper"
            :lazyLoad="true"
            @variablesData="tabVariablesDataUpdated"
          />
        </div>
      </div>
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
            :variablesData="
              currentVariablesDataRef?.[panels[0]?.id] ||
              currentVariablesDataRef['__global']
            "
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
            :data-panel-id="item.id"
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
                    currentTimeObj?.[item?.id] || currentTimeObj['__global'] || {}
                  "
                  :shouldRefreshWithoutCache="
                    shouldRefreshWithoutCacheObj?.[item?.id] || false
                  "
                  :variablesData="
                    currentVariablesDataRef?.[item?.id] ||
                    currentVariablesDataRef['__global']
                  "
                  :currentVariablesData="variablesData"
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
                  :panelVariablesConfig="getPanelVariablesConfig(item.id)"
                  @updated:data-zoom="$emit('updated:data-zoom', $event)"
                  @onMovePanel="onMovePanel"
                  @refreshPanelRequest="refreshPanelRequest"
                  @refresh="refreshDashboard"
                  @update:initial-variable-values="updateInitialVariableValues"
                  @onEditLayout="openEditLayout"
                  @update:runId="updateRunId"
                >
                  <!-- Panel-Level Variables (shown below drag-allow section) -->
                  <template #panel-variables>
                    <div
                      v-if="getPanelVariables(item.id).length > 0"
                      class="panel-variables-container q-px-xs q-py-xs"
                      :data-test="`dashboard-panel-${item.id}-variables`"
                    >
                      <VariablesValueSelector
                        :key="`panel-variables-${item.id}`"
                        :ref="(el) => setPanelVariableRef(el, item.id)"
                        :variablesConfig="getPanelVariablesConfig(item.id)"
                        :showDynamicFilters="false"
                        :selectedTimeDate="
                          currentTimeObj['__variables'] ||
                          currentTimeObj['__global']
                        "
                        :initialVariableValues="getPanelVariablesWrapper(item.id)"
                        :lazyLoad="true"
                        @variablesData="
                          (data) => panelVariablesDataUpdated(data, item.id)
                        "
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
import { getScopeType } from "@/utils/dashboard/variables/variablesScopeUtils";
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

    // Shared variables values across all levels for dependency resolution
    // New structure: {
    //   variableName: value || [] (for global vars - can be array for multi-select)
    //   OR
    //   variableName: [{ tabId, value: value || [] }] (for tab-scoped vars - array of tab values)
    //   OR
    //   variableName: [{ panelId, value: value || [] }] (for panel-scoped vars - array of panel values)
    // }
    const mergedVariablesValues = ref({});

    // Helper to check if value is a scoped array (tab/panel scoped)
    const isScopedArray = (value: any): boolean => {
      if (!Array.isArray(value)) return false;
      if (value.length === 0) return false;
      // Check if first element has tabId or panelId property
      return (
        typeof value[0] === 'object' &&
        value[0] !== null &&
        ('tabId' in value[0] || 'panelId' in value[0])
      );
    };

    // Helper to get variable value based on current context (tab/panel)
    const getContextualVariableValue = (
      varName: string,
      context?: { tabId?: string; panelId?: string }
    ) => {
      const storedValue = mergedVariablesValues.value[varName];

      if (storedValue === undefined) return undefined;

      // If value is not an array or object, it's a simple global variable (string, number, etc)
      if (typeof storedValue !== 'object' || storedValue === null) {
        return storedValue;
      }

      // Check if it's a scoped array (tab/panel scoped with structure like [{ tabId, value }])
      if (isScopedArray(storedValue)) {
        // Priority: panelId > tabId > first available value
        if (context?.panelId) {
          const panelEntry = storedValue.find((entry: any) => entry.panelId === context.panelId);
          if (panelEntry !== undefined) return panelEntry.value;
        }

        if (context?.tabId) {
          const tabEntry = storedValue.find((entry: any) => entry.tabId === context.tabId);
          if (tabEntry !== undefined) return tabEntry.value;
        }

        // Fallback: return first available value
        return storedValue.length > 0 ? storedValue[0].value : undefined;
      }

      // If it's an array but not scoped, it's a global multi-select variable - return as is
      if (Array.isArray(storedValue)) {
        return storedValue;
      }

      // If we reach here, it's some other object - return as is (shouldn't happen)
      return storedValue;
    };

    // Wrapper for passing to child components (they expect {value: {...}})
    // This resolves values based on current tab context
    // Note: Panel-specific resolution happens in getPanelVariablesWrapper
    const mergedVariablesWrapper = computed(() => {
      const resolved: Record<string, any> = {};
      const currentTabId = selectedTabId.value;

      // Get all variable names and resolve them for current context
      Object.keys(mergedVariablesValues.value).forEach((varName) => {
        resolved[varName] = getContextualVariableValue(varName, {
          tabId: currentTabId,
        });
      });

      return { value: resolved };
    });

    // Helper to get panel-specific variable wrapper
    const getPanelVariablesWrapper = (panelId: string) => {
      const resolved: Record<string, any> = {};
      const currentTabId = selectedTabId.value;

      // Get all variable names and resolve them with panel priority
      Object.keys(mergedVariablesValues.value).forEach((varName) => {
        resolved[varName] = getContextualVariableValue(varName, {
          tabId: currentTabId,
          panelId: panelId,
        });
      });

      return { value: resolved };
    };

    // ============================================
    // LEVEL-BASED VARIABLES LOGIC
    // ============================================

    // Helper to create config with ALL variables for dependency resolution
    // but only current level visible for UI
    const createConfigWithAllVariables = (
      levelVars: any[],
      allVars: any[],
      showFilters = false,
    ) => {
      // Mark which variables belong to current level (for rendering)
      const configList = allVars.map((v: any) => ({
        ...v,
        _isCurrentLevel: levelVars.some((lv: any) => lv.name === v.name),
      }));

      return {
        ...props.dashboardData.variables,
        list: configList,
        showDynamicFilters: showFilters,
        _levelVariables: levelVars, // Keep original level variables
      };
    };

    // Filter variables by scope - GLOBAL
    const globalVariablesConfig = computed(() => {
      if (!props.dashboardData?.variables?.list) {
        return { list: [], showDynamicFilters: false };
      }

      const globalVars = props.dashboardData.variables.list.filter(
        (v: any) => getScopeType(v) === "global",
      );

      // For global level, only include global variables in dependency graph
      return {
        ...props.dashboardData.variables,
        list: globalVars,
      };
    });

    const tabVariablesConfig = computed(() => {
      if (!props.dashboardData?.variables?.list || !selectedTabId.value) {
        return { list: [], showDynamicFilters: false };
      }

      const allVars = props.dashboardData.variables.list;
      const globalVars = allVars.filter(
        (v: any) => getScopeType(v) === "global",
      );
      const tabVars = allVars.filter(
        (v: any) =>
          getScopeType(v) === "tabs" &&
          v.tabs &&
          v.tabs.includes(selectedTabId.value),
      );

      // Include both global and tab variables for dependency resolution
      return createConfigWithAllVariables(
        tabVars,
        [...globalVars, ...tabVars],
        false,
      );
    });

    const activeTabVariables = computed(() => {
      // Return only tab-level variables for UI check
      return tabVariablesConfig.value._levelVariables || [];
    });

    const getPanelVariablesConfig = (panelId: string) => {
      if (!props.dashboardData?.variables?.list) {
        return { list: [], showDynamicFilters: false };
      }

      const allVars = props.dashboardData.variables.list;
      const globalVars = allVars.filter(
        (v: any) => getScopeType(v) === "global",
      );
      const tabVars = selectedTabId.value
        ? allVars.filter(
            (v: any) =>
              getScopeType(v) === "tabs" &&
              v.tabs &&
              v.tabs.includes(selectedTabId.value),
          )
        : [];
      const panelVars = allVars.filter(
        (v: any) =>
          getScopeType(v) === "panels" &&
          v.panels &&
          v.panels.includes(panelId),
      );

      // Include global, tab, and panel variables for full dependency resolution
      const config = createConfigWithAllVariables(
        panelVars,
        [...globalVars, ...tabVars, ...panelVars],
        false,
      );

      return config;
    };

    const getPanelVariables = (panelId: string) => {
      const config = getPanelVariablesConfig(panelId);
      return config._levelVariables || [];
    };


    // Track panel visibility
    const visiblePanels = ref(new Set<string>());

    // Track panel variable selector refs for lazy loading
    const panelVariableRefs = reactive<Record<string, any>>({});
    const panelVariablesLoaded = ref(new Set<string>());
    const tabVariablesValueSelectorRef = ref<any>(null);

    const setPanelVariableRef = (el: any, panelId: string) => {
      if (el) {
        panelVariableRefs[panelId] = el;
      } else {
        delete panelVariableRefs[panelId];
      }
    };

    // Trigger loading for panel variables when panel becomes visible
    const loadPanelVariablesIfVisible = (panelId: string) => {
      // Only load if: panel is visible, not already loaded, and tab variables are ready (if tab has variables)
      const hasTabVariables = activeTabVariables.value.length > 0;
      const canLoad = !hasTabVariables || tabVariablesReady.value;


      if (
        visiblePanels.value.has(panelId) &&
        !panelVariablesLoaded.value.has(panelId) &&
        canLoad
      ) {
        const ref = panelVariableRefs[panelId];
        if (ref && ref.loadAllVariablesData) {
          ref.loadAllVariablesData(true);
          panelVariablesLoaded.value.add(panelId);
        }
      }
    };

    // ============================================
    // END LEVEL-BASED VARIABLES LOGIC
    // ============================================

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

    // Aggregate all variables from all levels for URL syncing
    const aggregatedVariablesForUrl = computed(() => {
      if (!props.dashboardData?.variables?.list) {
        return { isVariablesLoading: false, values: [] };
      }

      const allVars = props.dashboardData.variables.list;
      const aggregatedValues: any[] = [];

      // Add global variables
      allVars.forEach((varConfig: any) => {
        const scope = getScopeType(varConfig);
        const varName = varConfig.name;

        if (scope === 'global') {
          // Global variable - get value directly (not nested)
          const value = mergedVariablesValues.value[varName];
          // Include if value is defined and either:
          // 1. Not an object (primitive values)
          // 2. Is null
          // 3. Is an array (for multi-select variables)
          // Exclude objects that have tabId or panelId (scoped values)
          const isValidValue = value !== undefined && (
            typeof value !== 'object' ||
            value === null ||
            (Array.isArray(value) && !value.some((v: any) => v?.tabId || v?.panelId))
          );

          if (isValidValue) {
            aggregatedValues.push({
              ...varConfig,
              scope: 'global',
              value,
              _isCurrentLevel: true,
            });
          }
        } else if (scope === 'tabs') {
          // Tab variable - collect values for all relevant tabs from nested structure
          const tabValues: any[] = [];
          const storedValue = mergedVariablesValues.value[varName];

          // storedValue is an array like [{ tabId: "tab1", value: "val1" }, { tabId: "tab2", value: "val2" }]
          if (Array.isArray(storedValue)) {
            storedValue.forEach((entry: any) => {
              // Verify this entry belongs to a tab defined in varConfig
              if (entry.tabId && entry.value !== undefined &&
                  varConfig.tabs && varConfig.tabs.includes(entry.tabId)) {
                tabValues.push({ tabId: entry.tabId, value: entry.value });
              }
            });
          }

          if (tabValues.length > 0) {
            aggregatedValues.push({
              ...varConfig,
              scope: 'tabs',
              value: tabValues,
              _isCurrentLevel: false,
            });
          }
        } else if (scope === 'panels') {
          // Panel variable - collect values for all relevant panels from nested structure
          const panelValues: any[] = [];
          const storedValue = mergedVariablesValues.value[varName];

          // storedValue is an array like [{ panelId: "panel1", value: "val1" }, { panelId: "panel2", value: "val2" }]
          if (Array.isArray(storedValue)) {
            storedValue.forEach((entry: any) => {
              // Verify this entry belongs to a panel defined in varConfig
              if (entry.panelId && entry.value !== undefined &&
                  varConfig.panels && varConfig.panels.includes(entry.panelId)) {
                panelValues.push({ panelId: entry.panelId, value: entry.value });
              }
            });
          }

          if (panelValues.length > 0) {
            aggregatedValues.push({
              ...varConfig,
              scope: 'panels',
              value: panelValues,
              _isCurrentLevel: false,
            });
          }
        }
      });

      return {
        isVariablesLoading: variablesData.value?.isVariablesLoading || false,
        values: aggregatedValues,
      };
    });

    // Emit aggregated variables when they change
    watch(
      aggregatedVariablesForUrl,
      (newValue) => {
        emit("variablesData", newValue);
      },
      { deep: true, immediate: true },
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

    // Track last global values to detect changes
    const lastGlobalValues = ref<Record<string, any>>({});

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

        // Extract current values from data.values that are GLOBAL level (_isCurrentLevel !== false)
        const currentGlobalValues: Record<string, any> = {};
        if (data?.values) {
          data.values.forEach((v: any) => {
            // Only include global variables (those that are current level in global config)
            if (v.name && v.value !== undefined && v._isCurrentLevel !== false) {
              currentGlobalValues[v.name] = v.value;
            }
          });
        }

        // Check if this is first load or if values actually changed
        const isFirstLoad = !globalVariablesLoaded.value;
        let hasActualChanges = false;

        if (!isFirstLoad) {
          // Compare with last values to detect actual changes
          hasActualChanges = Object.keys(currentGlobalValues).some(
            (key) =>
              JSON.stringify(currentGlobalValues[key]) !==
              JSON.stringify(lastGlobalValues.value[key])
          );
        }

        // Update merged state only if values changed or first load
        if (isFirstLoad || hasActualChanges) {
          const updatedValues: Record<string, any> = {
            ...mergedVariablesValues.value,
            ...currentGlobalValues,
          };
          mergedVariablesValues.value = updatedValues;
          lastGlobalValues.value = { ...currentGlobalValues };
        } else {
          return;
        }

        // Mark global as loaded and trigger tab load ONLY on first load
        if (isFirstLoad) {
          globalVariablesLoaded.value = true;

          nextTick(() => {
            if (
              tabVariablesValueSelectorRef.value &&
              activeTabVariables.value.length > 0
            ) {
              tabVariablesValueSelectorRef.value.loadAllVariablesData(true);
            } else if (activeTabVariables.value.length === 0) {
              tabVariablesReady.value = true;
              nextTick(() => {
                visiblePanels.value.forEach((panelId) => {
                  loadPanelVariablesIfVisible(panelId);
                });
              });
            }
          });
        }

        return;
      } catch (error) {
        return;
      }
    };

    // Track if global variables are loaded
    const globalVariablesLoaded = ref(false);

    // Track if tab variables are loaded
    const tabVariablesReady = ref(false);

    // Track last tab values to detect changes
    const lastTabValues = ref<Record<string, any>>({});

    // Handler for tab variables data updates
    const tabVariablesDataUpdated = (data: any) => {
      const currentTabId = selectedTabId.value;

      // Extract current tab values (only TAB level variables with _isCurrentLevel === true)
      const currentTabValues: Record<string, any> = {};
      if (data?.values) {
        data.values.forEach((v: any) => {
          // Only include tab-level variables (those marked as current level)
          if (v.name && v.value !== undefined && v._isCurrentLevel === true) {
            currentTabValues[v.name] = v.value;
          }
        });
      }

      // Check if this is first load or if values actually changed
      const tabKey = `tab_${currentTabId}`;
      const isFirstLoad = !tabVariablesReady.value;
      let hasActualChanges = false;

      if (!isFirstLoad) {
        // Compare with last values to detect actual changes for THIS tab
        hasActualChanges = Object.keys(currentTabValues).some((key) => {
          const lastValue = lastTabValues.value[tabKey]?.[key];
          return JSON.stringify(currentTabValues[key]) !== JSON.stringify(lastValue);
        });
      }

      // Update merged state only if values changed or first load
      if (isFirstLoad || hasActualChanges) {
        // Store values with tab isolation using array structure
        Object.keys(currentTabValues).forEach((varName) => {
          const varValue = currentTabValues[varName]; // Can be string, number, or array (for multi-select)

          // Check if this variable already has a scoped array structure
          const existingValue = mergedVariablesValues.value[varName];

          if (!existingValue || !isScopedArray(existingValue)) {
            // Initialize as scoped array if it doesn't exist or isn't already a scoped array
            mergedVariablesValues.value[varName] = [];
          }

          // Find if an entry for this tab already exists
          const existingEntryIndex = mergedVariablesValues.value[varName].findIndex(
            (entry: any) => entry.tabId === currentTabId
          );

          // Update or add the entry for this tab
          if (existingEntryIndex >= 0) {
            // Update existing entry
            mergedVariablesValues.value[varName][existingEntryIndex].value = varValue;
          } else {
            // Add new entry
            mergedVariablesValues.value[varName].push({
              tabId: currentTabId,
              value: varValue, // Preserve array structure for multi-select
            });
          }
        });

        // Track last values for this tab
        if (!lastTabValues.value[tabKey]) {
          lastTabValues.value[tabKey] = {};
        }
        lastTabValues.value[tabKey] = { ...currentTabValues };

      } else {
        // Still mark as ready but don't trigger cascades
        tabVariablesReady.value = true;
        return;
      }

      // Also update the main variablesData
      variablesData.value = {
        ...variablesData.value,
        ...data,
      };

      // Mark tab variables as ready and trigger panel loads ONLY on first load
      if (isFirstLoad) {
        tabVariablesReady.value = true;
        nextTick(() => {
          visiblePanels.value.forEach((panelId) => {
            loadPanelVariablesIfVisible(panelId);
          });
        });
      }
    };

    // Track last panel values to detect changes
    const lastPanelValues = ref<Record<string, Record<string, any>>>({});

    // Handler for panel variables data updates
    const panelVariablesDataUpdated = (data: any, panelId: string) => {

      // Extract current panel values (only PANEL level variables with _isCurrentLevel === true)
      const currentPanelValues: Record<string, any> = {};
      if (data?.values) {
        data.values.forEach((v: any) => {
          // Only include panel-level variables (those marked as current level)
          if (v.name && v.value !== undefined && v._isCurrentLevel === true) {
            currentPanelValues[v.name] = v.value;
          }
        });
      }

      // Check if this is first load or if values actually changed
      const isFirstLoad = !lastPanelValues.value[panelId];
      let hasActualChanges = false;

      if (!isFirstLoad) {
        // Compare with last values to detect actual changes for THIS panel
        hasActualChanges = Object.keys(currentPanelValues).some(
          (key) =>
            JSON.stringify(currentPanelValues[key]) !==
            JSON.stringify(lastPanelValues.value[panelId]?.[key])
        );
      }

      // Update merged state only if values changed or first load
      if (isFirstLoad || hasActualChanges) {
        // Store values with panel isolation using array structure
        Object.keys(currentPanelValues).forEach((varName) => {
          const varValue = currentPanelValues[varName]; // Can be string, number, or array (for multi-select)

          // Check if this variable already has a scoped array structure
          const existingValue = mergedVariablesValues.value[varName];

          if (!existingValue || !isScopedArray(existingValue)) {
            // Initialize as scoped array if it doesn't exist or isn't already a scoped array
            mergedVariablesValues.value[varName] = [];
          }

          // Find if an entry for this panel already exists
          const existingEntryIndex = mergedVariablesValues.value[varName].findIndex(
            (entry: any) => entry.panelId === panelId
          );

          // Update or add the entry for this panel
          if (existingEntryIndex >= 0) {
            // Update existing entry
            mergedVariablesValues.value[varName][existingEntryIndex].value = varValue;
          } else {
            // Add new entry
            mergedVariablesValues.value[varName].push({
              panelId: panelId,
              value: varValue, // Preserve array structure for multi-select
            });
          }
        });

        // Track last values for this panel
        if (!lastPanelValues.value[panelId]) {
          lastPanelValues.value[panelId] = {};
        }
        lastPanelValues.value[panelId] = { ...currentPanelValues };

      } else {
        return;
      }

      // Also update the main variablesData
      variablesData.value = {
        ...variablesData.value,
        ...data,
      };

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

      // Setup Intersection Observer for panel visibility tracking
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const panelId = entry.target.getAttribute("data-panel-id");
            if (panelId) {
              if (entry.isIntersecting) {
                visiblePanels.value.add(panelId);
                // Trigger lazy loading for panel variables when panel becomes visible
                nextTick(() => {
                  loadPanelVariablesIfVisible(panelId);
                });
              } else {
                visiblePanels.value.delete(panelId);
              }
            }
          });
        },
        {
          threshold: 0.1, // Trigger when 10% of panel is visible
          rootMargin: "50px", // Load slightly before coming into view
        },
      );

      // Observe all panels
      watch(
        () => panels.value,
        (newPanels) => {
          nextTick(() => {
            newPanels.forEach((panel: any) => {
              const element = document.querySelector(
                `[data-panel-id="${panel.id}"]`,
              );
              if (element) {
                observer.observe(element);
              }
            });
          });
        },
        { immediate: true },
      );

      // Cleanup observer on unmount
      onUnmounted(() => {
        observer.disconnect();
      });
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

    const refreshPanelRequest = (
      panelId,
      shouldRefreshWithoutCache = false,
    ) => {
      emit("refreshPanelRequest", panelId, shouldRefreshWithoutCache);

      currentVariablesDataRef.value = {
        ...currentVariablesDataRef.value,
        [panelId]: variablesData.value,
      };
    };

    const updateRunId = (newRunId) => {
      emit("update:runId", newRunId);
    };

    const openEditLayout = (id: string) => {
      emit("openEditLayout", id);
    };

    // Initialize mergedVariablesValues with initialVariableValues from props
    watch(
      () => props.initialVariableValues,
      (newVal) => {
        if (newVal?.value && Object.keys(newVal.value).length > 0) {
          mergedVariablesValues.value = { ...newVal.value };
        }
      },
      { immediate: true },
    );

    // Watch for tab changes - reset state
    watch(selectedTabId, (newTabId, oldTabId) => {
      if (newTabId !== oldTabId) {

        // Reset state for new tab
        tabVariablesReady.value = false;
        panelVariablesLoaded.value.clear();
        lastTabValues.value = {}; // Reset tab value tracking
        lastPanelValues.value = {}; // Reset panel value tracking

        // If no tab variables, mark as ready immediately
        nextTick(() => {
          if (activeTabVariables.value.length === 0) {
            tabVariablesReady.value = true;

            // Trigger panel loads if no tab variables
            nextTick(() => {
              visiblePanels.value.forEach((panelId) => {
                loadPanelVariablesIfVisible(panelId);
              });
            });
          }
        });
      }
    });

    // Initialize tab variables ready state on mount
    onMounted(() => {
      nextTick(() => {
        // If no tab variables on current tab, mark as ready
        if (activeTabVariables.value.length === 0) {
          tabVariablesReady.value = true;
        }
      });
    });

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
      variablesValueSelectorRef,
      updateInitialVariableValues,
      isDashboardVariablesAndPanelsDataLoadedDebouncedValue,
      currentQueryTraceIds,
      openEditLayout,
      saveDashboardData,
      currentVariablesDataRef,
      resetGridLayout,
      refreshGridStack,
      // Level-based variables
      globalVariablesConfig,
      tabVariablesConfig,
      activeTabVariables,
      getPanelVariablesConfig,
      getPanelVariables,
      visiblePanels,
      tabVariablesDataUpdated,
      panelVariablesDataUpdated,
      // Shared variables state
      mergedVariablesValues,
      // Panel lazy loading
      setPanelVariableRef,
      loadPanelVariablesIfVisible,
      tabVariablesValueSelectorRef,
      mergedVariablesWrapper,
      getPanelVariablesWrapper,
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

/* ============================================ */
/* LEVEL-BASED VARIABLES STYLING */
/* ============================================ */

.global-variables-container {
  background: rgba(var(--q-primary-rgb), 0.03);
  border-left: 3px solid var(--q-primary);
  padding: 8px 12px;
  border-radius: 4px;
}

.tabs-container {
  margin-bottom: 8px;
}

.tab-variables-container {
  background: rgba(var(--q-info-rgb), 0.03);
  border-left: 3px solid var(--q-info);
  border-radius: 4px;
  margin-top: 4px;
}

.panel-with-variables {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.panel-variables-container {
  background: rgba(var(--q-secondary-rgb), 0.02);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 4px 4px 0 0;
  font-size: 0.9em;

  .dark & {
    border-bottom-color: rgba(255, 255, 255, 0.08);
  }
}

/* END LEVEL-BASED VARIABLES STYLING */
</style>
