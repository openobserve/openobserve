// Copyright 2023 Zinc Labs Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { ref, computed, reactive, toRaw } from "vue";
import {
  buildScopedDependencyGraph,
  detectCyclesInScopedGraph,
  extractVariableNames,
  type ScopedDependencyGraph,
} from "@/utils/dashboard/variables/variablesDependencyUtils";
import { b64EncodeUnicode } from "@/utils/zincutils";
import dashboardService from "@/services/dashboards";
import { useStore } from "vuex";

export interface VariableConfig {
  name: string;
  label?: string;
  type: "query_values" | "custom" | "constant" | "textbox" | "dynamic_filters";
  scope: "global" | "tabs" | "panels";
  tabs?: string[];
  panels?: string[];
  value: any;
  multiSelect?: boolean;
  query_data?: {
    stream_type?: string;
    stream?: string;
    field: string;
    max_record_size?: number;
    filter?: Array<{
      name?: string;
      operator?: string;
      value?: string;
      filter?: string;
    }>;
  };
  options?: Array<{
    label: string;
    value: string;
    selected?: boolean;
  }>;
  selectAllValueForMultiSelect?: "first" | "all" | "custom";
  customMultiSelectValue?: string[];
  isVariableLoadingPending?: boolean;
  isLoading?: boolean;
  isVariablePartialLoaded?: boolean;
  hideOnDashboard?: boolean;
  escapeSingleQuotes?: boolean;
}

export interface VariableRuntimeState extends VariableConfig {
  tabId?: string;
  panelId?: string;
  error?: string;
}

export interface UseVariablesManager {
  variablesData: {
    global: VariableRuntimeState[];
    tabs: Record<string, VariableRuntimeState[]>;
    panels: Record<string, VariableRuntimeState[]>;
  };
  dependencyGraph: ScopedDependencyGraph;
  tabsVisibility: Record<string, boolean>;
  panelsVisibility: Record<string, boolean>;
  isLoading: boolean;
  initialize: (config: VariableConfig[], dashboard: any) => Promise<void>;
  loadGlobalVariables: () => Promise<void>;
  loadTabVariables: (tabId: string) => Promise<void>;
  loadPanelVariables: (panelId: string) => Promise<void>;
  loadSingleVariable: (variableKey: string) => Promise<void>;
  setTabVisibility: (tabId: string, visible: boolean) => void;
  setPanelVisibility: (panelId: string, visible: boolean) => void;
  updateVariableValue: (
    name: string,
    scope: "global" | "tabs" | "panels",
    tabId: string | undefined,
    panelId: string | undefined,
    newValue: any
  ) => Promise<void>;
  getVariable: (
    name: string,
    scope: "global" | "tabs" | "panels",
    tabId?: string,
    panelId?: string
  ) => VariableRuntimeState | undefined;
  getVariablesForPanel: (panelId: string, tabId: string) => VariableRuntimeState[];
  getVariablesForTab: (tabId: string) => VariableRuntimeState[];
  getAllVisibleVariables: (tabId?: string, panelId?: string) => VariableRuntimeState[];
  isVariableReady: (variableKey: string) => boolean;
  getDependentVariables: (variableKey: string) => string[];
  syncToUrl: (router: any, route: any) => void;
  loadFromUrl: (route: any) => void;
}

// Helper to generate variable keys
export const getVariableKey = (
  name: string,
  scope: "global" | "tabs" | "panels",
  tabId?: string,
  panelId?: string
): string => {
  if (scope === "global") {
    return `${name}@global`;
  } else if (scope === "tabs") {
    return `${name}@tab@${tabId}`;
  } else {
    return `${name}@panel@${panelId}`;
  }
};

// Helper to expand variables for scopes
const expandVariablesForScopes = (
  variables: VariableConfig[]
): VariableRuntimeState[] => {
  const expanded: VariableRuntimeState[] = [];

  variables.forEach((variable) => {
    const scope = variable.scope || "global";

    if (scope === "global") {
      expanded.push({
        ...variable,
        scope: "global",
        // Initialize loading states - set pending to false initially
        // Will be set to true when loadSingleVariable is called
        isVariableLoadingPending: false,
        isLoading: false,
        isVariablePartialLoaded: variable.type !== "query_values", // Non-query types are immediately ready
      });
    } else if (scope === "tabs" && variable.tabs && variable.tabs.length > 0) {
      // Create instance for each tab
      variable.tabs.forEach((tabId) => {
        expanded.push({
          ...variable,
          scope: "tabs",
          tabId,
          // Initialize loading states - pending will be set when tab becomes visible
          isVariableLoadingPending: false,
          isLoading: false,
          isVariablePartialLoaded: false,
        });
      });
    } else if (scope === "panels" && variable.panels && variable.panels.length > 0) {
      // Create instance for each panel
      variable.panels.forEach((panelId) => {
        expanded.push({
          ...variable,
          scope: "panels",
          panelId,
          // Initialize loading states - pending will be set when panel becomes visible
          isVariableLoadingPending: false,
          isLoading: false,
          isVariablePartialLoaded: false,
        });
      });
    }
  });

  return expanded;
};

export const useVariablesManager = () => {
  const store = useStore();

  // ========== STATE ==========
  const variablesData = reactive<{
    global: VariableRuntimeState[];
    tabs: Record<string, VariableRuntimeState[]>;
    panels: Record<string, VariableRuntimeState[]>;
  }>({
    global: [],
    tabs: {},
    panels: {},
  });

  const dependencyGraph = ref<ScopedDependencyGraph>({});
  const tabsVisibility = ref<Record<string, boolean>>({});
  const panelsVisibility = ref<Record<string, boolean>>({});
  const currentDashboard = ref<any>(null);
  const panelTabMapping = ref<Record<string, string>>({});

  // Promise tracking for cancellation
  const currentlyExecutingPromises = new Map<string, { reject: Function }>();

  const isLoading = computed(() => {
    const hasLoadingGlobal = variablesData.global.some((v) => v.isLoading);
    const hasLoadingTabs = Object.values(variablesData.tabs).some((vars) =>
      vars.some((v) => v.isLoading)
    );
    const hasLoadingPanels = Object.values(variablesData.panels).some((vars) =>
      vars.some((v) => v.isLoading)
    );
    return hasLoadingGlobal || hasLoadingTabs || hasLoadingPanels;
  });

  // ========== HELPER FUNCTIONS ==========
  const getAllVariablesFlat = (): VariableRuntimeState[] => {
    const allVars: VariableRuntimeState[] = [...variablesData.global];

    Object.values(variablesData.tabs).forEach((tabVars) => {
      allVars.push(...tabVars);
    });

    Object.values(variablesData.panels).forEach((panelVars) => {
      allVars.push(...panelVars);
    });

    return allVars;
  };

  const findVariableByKey = (
    key: string,
    allVariables: VariableRuntimeState[]
  ): VariableRuntimeState | undefined => {
    return allVariables.find((v) => {
      const varKey = getVariableKey(v.name, v.scope, v.tabId, v.panelId);
      return varKey === key;
    });
  };

  const isVariableVisible = (
    variable: VariableRuntimeState,
    tabsVis: Record<string, boolean>,
    panelsVis: Record<string, boolean>
  ): boolean => {
    if (variable.scope === "global") return true;
    if (variable.scope === "tabs") {
      return tabsVis[variable.tabId!] === true;
    }
    if (variable.scope === "panels") {
      return panelsVis[variable.panelId!] === true;
    }
    return false;
  };

  const canVariableLoad = (
    variable: VariableRuntimeState,
    tabsVis: Record<string, boolean>,
    panelsVis: Record<string, boolean>,
    allVariables: VariableRuntimeState[],
    depGraph: ScopedDependencyGraph
  ): boolean => {
    const key = getVariableKey(variable.name, variable.scope, variable.tabId, variable.panelId);

    // Check 1: Is visible?
    if (!isVariableVisible(variable, tabsVis, panelsVis)) {
      return false;
    }

    // Check 2: Already loading?
    if (variable.isLoading) {
      return false;
    }

    // Check 3: All parents ready?
    const parents = depGraph[key]?.parents || [];
    const allParentsReady = parents.every((parentKey) => {
      const parentVar = findVariableByKey(parentKey, allVariables);
      return parentVar?.isVariablePartialLoaded === true;
    });

    return allParentsReady;
  };

  const buildPanelTabMapping = (dashboard: any) => {
    const mapping: Record<string, string> = {};
    if (!dashboard?.tabs) return mapping;

    dashboard.tabs.forEach((tab: any) => {
      if (tab.panels) {
        tab.panels.forEach((panel: any) => {
          mapping[panel.id] = tab.tabId;
        });
      }
    });

    return mapping;
  };

  // ========== INITIALIZATION ==========
  const initialize = async (config: VariableConfig[], dashboard: any) => {
    currentDashboard.value = dashboard;
    panelTabMapping.value = buildPanelTabMapping(dashboard);

    // Migrate legacy variables (no scope) to global
    const migratedConfig = config.map((v) => ({
      ...v,
      scope: v.scope || "global",
    }));

    // Step 1: Expand variables for scopes
    const expandedVars = expandVariablesForScopes(migratedConfig);

    // Step 2: Populate state
    variablesData.global = [];
    variablesData.tabs = {};
    variablesData.panels = {};

    expandedVars.forEach((varState) => {
      if (varState.scope === "global") {
        variablesData.global.push(varState);
      } else if (varState.scope === "tabs") {
        if (!variablesData.tabs[varState.tabId!]) {
          variablesData.tabs[varState.tabId!] = [];
        }
        variablesData.tabs[varState.tabId!].push(varState);
      } else if (varState.scope === "panels") {
        if (!variablesData.panels[varState.panelId!]) {
          variablesData.panels[varState.panelId!] = [];
        }
        variablesData.panels[varState.panelId!].push(varState);
      }
    });

    // Step 3: Build dependency graph
    try {
      dependencyGraph.value = buildScopedDependencyGraph(
        expandedVars,
        panelTabMapping.value
      );
    } catch (error: any) {
      console.error("Error building dependency graph:", error);
      throw error;
    }

    // Step 4: Detect cycles
    const cycle = detectCyclesInScopedGraph(dependencyGraph.value);
    if (cycle) {
      throw new Error(`Circular dependency detected: ${cycle.join(" → ")}`);
    }

    // Step 5: Automatically load global variables that have no dependencies
    // This starts the cascading load process
    console.log('[VariablesManager] Initialization complete, loading global variables...');
    await loadGlobalVariables();
    console.log('[VariablesManager] Global variables load initiated');
  };

  // ========== LOADING ==========
  const loadGlobalVariables = async () => {
    const globalVars = variablesData.global;
    const independentVars = globalVars.filter((v) => {
      const key = getVariableKey(v.name, v.scope);
      const parents = dependencyGraph.value[key]?.parents || [];
      return parents.length === 0;
    });

    console.log('[VariablesManager] Loading global variables:',
      independentVars.map(v => v.name).join(', ') || 'none'
    );

    const promises = independentVars.map((v) =>
      loadSingleVariable(getVariableKey(v.name, v.scope))
    );

    await Promise.allSettled(promises);
  };

  const loadTabVariables = async (tabId: string) => {
    const tabVars = variablesData.tabs[tabId] || [];
    const allVars = getAllVariablesFlat();
    const loadableVars = tabVars.filter((v) =>
      canVariableLoad(
        v,
        tabsVisibility.value,
        panelsVisibility.value,
        allVars,
        dependencyGraph.value
      )
    );

    const promises = loadableVars.map((v) =>
      loadSingleVariable(getVariableKey(v.name, v.scope, v.tabId, v.panelId))
    );

    await Promise.allSettled(promises);
  };

  const loadPanelVariables = async (panelId: string) => {
    const panelVars = variablesData.panels[panelId] || [];
    const allVars = getAllVariablesFlat();
    const loadableVars = panelVars.filter((v) =>
      canVariableLoad(
        v,
        tabsVisibility.value,
        panelsVisibility.value,
        allVars,
        dependencyGraph.value
      )
    );

    const promises = loadableVars.map((v) =>
      loadSingleVariable(getVariableKey(v.name, v.scope, v.tabId, v.panelId))
    );

    await Promise.allSettled(promises);
  };

  const loadSingleVariable = (variableKey: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      // Cancel previous request
      if (currentlyExecutingPromises.has(variableKey)) {
        currentlyExecutingPromises.get(variableKey)!.reject("Cancelled");
        currentlyExecutingPromises.delete(variableKey);
      }

      currentlyExecutingPromises.set(variableKey, { reject });

      const allVars = getAllVariablesFlat();
      const variable = findVariableByKey(variableKey, allVars);

      if (!variable) {
        reject("Variable not found");
        return;
      }

      // Check visibility
      if (!isVariableVisible(variable, tabsVisibility.value, panelsVisibility.value)) {
        variable.isVariableLoadingPending = true;
        reject("Not visible");
        return;
      }

      // Check dependencies
      const parents = dependencyGraph.value[variableKey]?.parents || [];
      const allParentsReady = parents.every((parentKey) => {
        const parent = findVariableByKey(parentKey, allVars);
        return parent?.isVariablePartialLoaded === true;
      });

      if (!allParentsReady) {
        variable.isVariableLoadingPending = true;

        // Trigger loading of unloaded parents
        const unloadedParents = parents.filter((parentKey) => {
          const parent = findVariableByKey(parentKey, allVars);
          return !parent?.isVariablePartialLoaded && !parent?.isLoading;
        });

        if (unloadedParents.length > 0) {
          // Load parents first, then retry loading this variable
          Promise.allSettled(
            unloadedParents.map(parentKey => loadSingleVariable(parentKey))
          ).then(() => {
            // After parents are loaded, retry loading this variable
            loadSingleVariable(variableKey).then(resolve).catch(reject);
          });
        } else {
          // Parents are loading, just wait
          reject("Dependencies not ready");
        }
        return;
      }

      // Start loading
      variable.isLoading = true;
      variable.isVariableLoadingPending = false;

      // Handle by type
      if (variable.type === "query_values") {
        loadQueryValuesVariable(variable, variableKey, resolve, reject);
      } else if (variable.type === "constant") {
        // Constant: value should already be set in config
        // Just mark as loaded
        finalizeVariableLoading(variable, variableKey, true, resolve);
      } else if (variable.type === "custom") {
        // Custom: value should already be set in config
        // Just mark as loaded
        finalizeVariableLoading(variable, variableKey, true, resolve);
      } else if (variable.type === "textbox") {
        // Textbox: value should already be set in config
        // Just mark as loaded
        finalizeVariableLoading(variable, variableKey, true, resolve);
      } else {
        // Other immediate types
        finalizeVariableLoading(variable, variableKey, true, resolve);
      }
    });
  };

  const loadQueryValuesVariable = (
    variable: VariableRuntimeState,
    variableKey: string,
    resolve: Function,
    reject: Function
  ) => {
    // Note: The actual API call is handled by VariablesValueSelector.vue
    // This manager just tracks loading states and dependencies
    // The VariablesValueSelector watches the manager state and calls APIs as needed

    console.log('[VariablesManager] Marking variable as pending:', variableKey);

    // Mark as pending so the selector knows to fire the API
    // The selector will see isVariableLoadingPending = true and fire the WebSocket API
    variable.isVariableLoadingPending = true;
    variable.isLoading = false; // Not loading yet, just pending

    // Immediately resolve - the component will handle the actual loading
    resolve(true);
  };

  const buildQueryContext = (
    variable: VariableRuntimeState,
    allVariables: VariableRuntimeState[]
  ) => {
    const filters: string[] = [];

    // Process filters and replace variable references
    if (variable.query_data?.filter) {
      variable.query_data.filter.forEach((filter) => {
        const filterString = filter.filter || filter.value || "";
        if (filterString) {
          // Replace variables in filter
          const replacedFilter = replaceVariablesInFilter(filterString, variable, allVariables);
          filters.push(replacedFilter);
        }
      });
    }

    // Build SQL query context for the API
    const streamName = variable.query_data?.stream || "";
    let sqlQuery = "";

    if (filters.length > 0) {
      // Combine filters with AND
      const whereClause = filters.join(" AND ");
      sqlQuery = b64EncodeUnicode(`SELECT * FROM '${streamName}' WHERE ${whereClause}`);
    }

    return { filters, sqlQuery };
  };

  const replaceVariablesInFilter = (
    filterString: string,
    currentVariable: VariableRuntimeState,
    allVariables: VariableRuntimeState[]
  ): string => {
    let replaced = filterString;

    // Extract variable names from filter
    const variableNames = extractVariableNames(filterString);

    variableNames.forEach((varName) => {
      // Resolve parent variable based on scope hierarchy
      const parentVar = resolveParentVariable(
        varName,
        currentVariable,
        allVariables
      );

      if (parentVar && parentVar.value !== null && parentVar.value !== undefined) {
        const value = Array.isArray(parentVar.value)
          ? parentVar.value.join(",")
          : String(parentVar.value);

        // Replace both $varName and ${varName} formats
        replaced = replaced.replace(new RegExp(`\\$\\{${varName}\\}`, "g"), value);
        replaced = replaced.replace(new RegExp(`\\$${varName}`, "g"), value);
      } else {
        // Use sentinel value for null/undefined
        replaced = replaced.replace(new RegExp(`\\$\\{${varName}\\}`, "g"), "_o2_all_");
        replaced = replaced.replace(new RegExp(`\\$${varName}`, "g"), "_o2_all_");
      }
    });

    return replaced;
  };

  const resolveParentVariable = (
    parentName: string,
    childVariable: VariableRuntimeState,
    allVariables: VariableRuntimeState[]
  ): VariableRuntimeState | undefined => {
    // Resolution order (child looking for parent):
    // 1. If child is global: Look in global only
    // 2. If child is tab: Look in same tab, then global
    // 3. If child is panel: Look in same panel, then parent tab, then global

    if (childVariable.scope === "global") {
      return allVariables.find(
        (v) => v.name === parentName && v.scope === "global"
      );
    }

    if (childVariable.scope === "tabs") {
      // Check same tab first
      let parent = allVariables.find(
        (v) =>
          v.name === parentName &&
          v.scope === "tabs" &&
          v.tabId === childVariable.tabId
      );
      if (parent) return parent;

      // Fall back to global
      return allVariables.find(
        (v) => v.name === parentName && v.scope === "global"
      );
    }

    if (childVariable.scope === "panels") {
      // Check same panel first
      let parent = allVariables.find(
        (v) =>
          v.name === parentName &&
          v.scope === "panels" &&
          v.panelId === childVariable.panelId
      );
      if (parent) return parent;

      // Check parent tab
      const tabId = panelTabMapping.value[childVariable.panelId!];
      if (tabId) {
        parent = allVariables.find(
          (v) =>
            v.name === parentName && v.scope === "tabs" && v.tabId === tabId
        );
        if (parent) return parent;
      }

      // Fall back to global
      return allVariables.find(
        (v) => v.name === parentName && v.scope === "global"
      );
    }

    return undefined;
  };

  // Note: Response handling is done by VariablesValueSelector.vue
  // This manager just provides state tracking

  const finalizeVariableLoading = (
    variable: VariableRuntimeState,
    variableKey: string,
    success: boolean,
    resolve: Function
  ) => {
    variable.isLoading = false;
    variable.isVariablePartialLoaded = success;

    currentlyExecutingPromises.delete(variableKey);

    // Trigger children only if successfully loaded
    if (success) {
      const children = dependencyGraph.value[variableKey]?.children || [];
      const allVars = getAllVariablesFlat();

      children.forEach((childKey) => {
        const childVar = findVariableByKey(childKey, allVars);
        // Load child if it's pending due to this parent
        if (
          childVar &&
          childVar.isVariableLoadingPending &&
          canVariableLoad(
            childVar,
            tabsVisibility.value,
            panelsVisibility.value,
            allVars,
            dependencyGraph.value
          )
        ) {
          loadSingleVariable(childKey).catch(() => {
            // Ignore errors from child loading
          });
        }
      });
    }

    resolve(success);
  };

  // ========== VISIBILITY ==========
  const setTabVisibility = (tabId: string, visible: boolean) => {
    tabsVisibility.value[tabId] = visible;

    if (visible) {
      loadTabVariables(tabId).catch(() => {
        // Ignore errors
      });
    }
  };

  const setPanelVisibility = (panelId: string, visible: boolean) => {
    panelsVisibility.value[panelId] = visible;

    if (visible) {
      loadPanelVariables(panelId).catch(() => {
        // Ignore errors
      });
    }
  };

  // ========== VALUE UPDATES ==========
  const updateVariableValue = async (
    name: string,
    scope: "global" | "tabs" | "panels",
    tabId: string | undefined,
    panelId: string | undefined,
    newValue: any
  ) => {
    const variable = getVariable(name, scope, tabId, panelId);
    if (!variable) {
      console.log('[VariablesManager] Variable not found:', name, scope);
      return;
    }
    variable.value = newValue;

    // Trigger dependent variables to reload
    const variableKey = getVariableKey(name, scope, tabId, panelId);
    const children = dependencyGraph.value[variableKey]?.children || [];
    const allVars = getAllVariablesFlat();

    console.log('[VariablesManager] Found', children.length, 'children for', variableKey, ':', children);

    const promises = children.map((childKey) => {
      const childVar = findVariableByKey(childKey, allVars);
      if (childVar) {
        console.log('[VariablesManager] Marking child as pending:', childKey,
          'scope:', childVar.scope, 'tabId:', childVar.tabId, 'panelId:', childVar.panelId);
        // Reset child's loading state to force reload
        childVar.isVariablePartialLoaded = false;
        childVar.isVariableLoadingPending = true;
      } else {
        console.warn('[VariablesManager] Child variable not found:', childKey);
      }
      return loadSingleVariable(childKey).catch(() => {
        // Ignore errors
      });
    });

    await Promise.allSettled(promises);
    console.log('[VariablesManager] Finished updating', name, 'and loading', children.length, 'children');
  };

  // ========== QUERIES ==========
  const getVariable = (
    name: string,
    scope: "global" | "tabs" | "panels",
    tabId?: string,
    panelId?: string
  ): VariableRuntimeState | undefined => {
    if (scope === "global") {
      return variablesData.global.find((v) => v.name === name);
    } else if (scope === "tabs" && tabId) {
      return variablesData.tabs[tabId]?.find((v) => v.name === name);
    } else if (scope === "panels" && panelId) {
      return variablesData.panels[panelId]?.find((v) => v.name === name);
    }
    return undefined;
  };

  const getVariablesForPanel = (
    panelId: string,
    tabId: string
  ): VariableRuntimeState[] => {
    // Merge: global + tab + panel
    const merged = [
      ...variablesData.global,
      ...(tabId && variablesData.tabs[tabId] ? variablesData.tabs[tabId] : []),
      ...(variablesData.panels[panelId] || []),
    ];

    return merged;
  };

  const getVariablesForTab = (tabId: string): VariableRuntimeState[] => {
    return [
      ...variablesData.global,
      ...(variablesData.tabs[tabId] || []),
    ];
  };

  const getAllVisibleVariables = (
    tabId?: string,
    panelId?: string
  ): VariableRuntimeState[] => {
    if (panelId) {
      const panelTabId = panelTabMapping.value[panelId] || tabId || "";
      return getVariablesForPanel(panelId, panelTabId);
    } else if (tabId) {
      return getVariablesForTab(tabId);
    } else {
      return variablesData.global;
    }
  };

  const isVariableReady = (variableKey: string): boolean => {
    const allVars = getAllVariablesFlat();
    const variable = findVariableByKey(variableKey, allVars);
    return variable?.isVariablePartialLoaded === true;
  };

  const getDependentVariables = (variableKey: string): string[] => {
    return dependencyGraph.value[variableKey]?.children || [];
  };

  // ========== URL SYNCHRONIZATION ==========
  const syncToUrl = (router: any, route: any) => {
    const queryParams: Record<string, string | string[]> = { ...route.query };

    // Global variables
    variablesData.global.forEach((variable) => {
      if (variable.type !== "dynamic_filters") {
        const key = `var-${variable.name}`;
        queryParams[key] = formatValueForUrl(variable.value);
      }
    });

    // Tab variables
    Object.entries(variablesData.tabs).forEach(([tabId, variables]) => {
      variables.forEach((variable) => {
        if (variable.type !== "dynamic_filters") {
          const key = `var-${variable.name}.t.${tabId}`;
          queryParams[key] = formatValueForUrl(variable.value);
        }
      });
    });

    // Panel variables
    Object.entries(variablesData.panels).forEach(([panelId, variables]) => {
      variables.forEach((variable) => {
        if (variable.type !== "dynamic_filters") {
          const key = `var-${variable.name}.p.${panelId}`;
          queryParams[key] = formatValueForUrl(variable.value);
        }
      });
    });

    router.replace({
      query: queryParams,
    });
  };

  const formatValueForUrl = (value: any): string | string[] => {
    if (Array.isArray(value)) {
      // Return array directly - Vue Router will handle multiple params
      // URL will be: ?var-name=value1&var-name=value2 instead of ?var-name=value1,value2
      return value.map(v => String(v));
    }
    return String(value);
  };

  const loadFromUrl = (route: any) => {
    const query = route.query;
    console.log('[VariablesManager] Loading values from URL:', Object.keys(query).filter(k => k.startsWith('var-')));

    Object.entries(query).forEach(([key, value]) => {
      if (!key.startsWith("var-")) return;

      const parsed = parseVariableUrlKey(key);
      if (!parsed) {
        console.warn('[VariablesManager] Failed to parse URL key:', key);
        return;
      }

      // Drilldown scenario: If scope is global but variable name doesn't exist as global,
      // apply to all tab/panel instances of that variable name
      if (parsed.scope === "global") {
        const globalVar = getVariable(parsed.name, "global");

        if (globalVar) {
          // Normal global variable - set its value
          applyUrlValueToVariable(globalVar, value);
        } else {
          // No global variable with this name - apply to all tab/panel instances
          // This handles drilldown URLs like var-region=CA that should apply to all tabs
          let appliedToAny = false;

          // Apply to all tab instances with this name
          Object.values(variablesData.tabs).forEach((tabVars) => {
            const tabVar = tabVars.find(v => v.name === parsed.name);
            if (tabVar) {
              applyUrlValueToVariable(tabVar, value);
              appliedToAny = true;
            }
          });

          // Apply to all panel instances with this name
          Object.values(variablesData.panels).forEach((panelVars) => {
            const panelVar = panelVars.find(v => v.name === parsed.name);
            if (panelVar) {
              applyUrlValueToVariable(panelVar, value);
              appliedToAny = true;
            }
          });

          if (!appliedToAny) {
            console.warn('[VariablesManager] Variable not found for URL key:', key, parsed);
          }
        }
      } else {
        // Scoped variable in URL - apply to that specific instance
        const variable = getVariable(parsed.name, parsed.scope, parsed.tabId, parsed.panelId);
        if (!variable) {
          console.warn('[VariablesManager] Variable not found for URL key:', key, parsed);
          return;
        }
        applyUrlValueToVariable(variable, value);
      }
    });
  };

  const applyUrlValueToVariable = (variable: VariableRuntimeState, value: any) => {
    // Parse value - handle both array format (multiple params) and comma-separated (legacy)
    let parsedValue: any;
    if (variable.multiSelect) {
      if (Array.isArray(value)) {
        // URL format: ?var-name=value1&var-name=value2
        parsedValue = value;
      } else if (typeof value === 'string' && value.includes(',')) {
        // Legacy format: ?var-name=value1,value2
        parsedValue = value.split(',');
      } else {
        // Single value as array
        parsedValue = [value];
      }
    } else {
      // Single select - take first value if array
      parsedValue = Array.isArray(value) ? value[0] : value;
    }

    console.log('[VariablesManager] Setting', variable.name, '(scope:', variable.scope, variable.tabId || variable.panelId || '', ') from URL to:', parsedValue);
    variable.value = parsedValue;

    // Mark variable as needing reload to apply the URL value in its query
    // This ensures dependent children also reload with the new parent value
    if (variable.type === 'query_values') {
      variable.isVariableLoadingPending = true;
      variable.isVariablePartialLoaded = false;
    } else {
      // For non-query types (constant, textbox, custom), mark as loaded
      variable.isVariablePartialLoaded = true;
    }
  };

  interface ParsedUrlKey {
    name: string;
    scope: "global" | "tabs" | "panels";
    tabId?: string;
    panelId?: string;
  }

  const parseVariableUrlKey = (key: string): ParsedUrlKey | null => {
    // Remove "var-" prefix
    const withoutPrefix = key.replace(/^var-/, "");

    // Check for tab scope: var-region.t.tab-1
    const tabMatch = withoutPrefix.match(/^(.+)\.t\.(.+)$/);
    if (tabMatch) {
      return {
        name: tabMatch[1],
        scope: "tabs",
        tabId: tabMatch[2],
      };
    }

    // Check for panel scope: var-city.p.panel-123
    const panelMatch = withoutPrefix.match(/^(.+)\.p\.(.+)$/);
    if (panelMatch) {
      return {
        name: panelMatch[1],
        scope: "panels",
        panelId: panelMatch[2],
      };
    }

    // Global scope (no suffix)
    return {
      name: withoutPrefix,
      scope: "global",
    };
  };

  return {
    variablesData,
    dependencyGraph: computed(() => dependencyGraph.value),
    tabsVisibility: computed(() => tabsVisibility.value),
    panelsVisibility: computed(() => panelsVisibility.value),
    isLoading,
    initialize,
    loadGlobalVariables,
    loadTabVariables,
    loadPanelVariables,
    loadSingleVariable,
    setTabVisibility,
    setPanelVisibility,
    updateVariableValue,
    getVariable,
    getVariableKey,
    getVariablesForPanel,
    getVariablesForTab,
    getAllVisibleVariables,
    isVariableReady,
    getDependentVariables,
    syncToUrl,
    loadFromUrl,
  };
};
