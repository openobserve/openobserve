// Copyright 2023 OpenObserve Inc.
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

import { ref, computed, reactive } from "vue";
import {
  buildScopedDependencyGraph,
  detectCyclesInScopedGraph,
  extractVariableNames,
  type ScopedDependencyGraph,
} from "@/utils/dashboard/variables/variablesDependencyUtils";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";

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

// Helper to generate variable keys
export const getVariableKey = (
  name: string,
  scope: "global" | "tabs" | "panels",
  tabId?: string,
  panelId?: string,
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
  variables: VariableConfig[],
): VariableRuntimeState[] => {
  const expanded: VariableRuntimeState[] = [];

  // Helper to get initial value for a variable
  const getInitialValue = (variable: VariableConfig) => {
    // If value is explicitly set (not empty string), use it
    if (variable.value !== "" && variable.value !== undefined && variable.value !== null) {
      return variable.value;
    }

    // For query_values with custom or "all" configuration, set the appropriate default
    if (variable.type === "query_values") {
      if (
        variable.selectAllValueForMultiSelect === "custom" &&
        (variable as any).customMultiSelectValue?.length > 0
      ) {
        return variable.multiSelect
          ? (variable as any).customMultiSelectValue
          : (variable as any).customMultiSelectValue[0];
      } else if (variable.selectAllValueForMultiSelect === "all") {
        return variable.multiSelect ? [SELECT_ALL_VALUE] : SELECT_ALL_VALUE;
      }
    }

    // For custom type variables, select first option as default
    if (variable.type === "custom") {
      const options = (variable as any).options;
      if (options && options.length > 0) {
        return variable.multiSelect
          ? [options[0].value]
          : options[0].value;
      }
    }

    // Default: empty array for multiSelect, null otherwise
    return variable.multiSelect ? [] : null;
  };

  variables.forEach((variable) => {
    const scope = variable.scope || "global";
    const initialValue = getInitialValue(variable);

    // Check if variable has custom or "all" default - mark as partially loaded immediately
    const hasCustomOrAllDefault =
      variable.type === "query_values" &&
      (variable.selectAllValueForMultiSelect === "custom" ||
        variable.selectAllValueForMultiSelect === "all");

    if (scope === "global") {
      expanded.push({
        ...variable,
        scope: "global",
        value: initialValue,
        isVariableLoadingPending: false,
        isLoading: false,
        // Non-query types are immediately ready
        // Custom and "all" variables are also immediately ready (no API call needed)
        isVariablePartialLoaded: variable.type !== "query_values" || hasCustomOrAllDefault,
      });
    } else if (scope === "tabs" && variable.tabs && variable.tabs.length > 0) {
      variable.tabs.forEach((tabId) => {
        expanded.push({
          ...variable,
          scope: "tabs",
          tabId,
          value: initialValue,
          isVariableLoadingPending: false,
          isLoading: false,
          isVariablePartialLoaded: variable.type !== "query_values" || hasCustomOrAllDefault,
        });
      });
    } else if (
      scope === "panels" &&
      variable.panels &&
      variable.panels.length > 0
    ) {
      variable.panels.forEach((panelId) => {
        expanded.push({
          ...variable,
          scope: "panels",
          panelId,
          value: initialValue,
          isVariableLoadingPending: false,
          isLoading: false,
          isVariablePartialLoaded: variable.type !== "query_values" || hasCustomOrAllDefault,
        });
      });
    }
  });

  return expanded;
};

export const useVariablesManager = () => {
  // ========== STATE ==========
  // TWO-TIER STATE ARCHITECTURE (like __global mechanism)

  // LIVE STATE: Updates immediately when user changes variables
  const variablesData = reactive<{
    global: VariableRuntimeState[];
    tabs: Record<string, VariableRuntimeState[]>;
    panels: Record<string, VariableRuntimeState[]>;
    isInitialized: boolean;
  }>({
    global: [],
    tabs: {},
    panels: {},
    isInitialized: false,
  });

  // COMMITTED STATE: Updates only when user clicks Refresh (like __global)
  // Panels use THIS state, not live state
  const committedVariablesData = reactive<{
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

  const isLoading = computed(() => {
    if (!variablesData.isInitialized) return true;

    // Helper to determine if a specific variable is still in its initial loading phase
    const isVarLoading = (v: VariableRuntimeState) => {
      if (v.type !== "query_values") return false;
      return (
        v.isLoading || v.isVariableLoadingPending || !v.isVariablePartialLoaded
      );
    };

    // Global variables are always relevant
    const hasLoadingGlobal = variablesData.global.some(isVarLoading);

    // Only check variables in visible tabs
    const hasLoadingTabs = Object.entries(variablesData.tabs).some(
      ([tabId, vars]) => tabsVisibility.value[tabId] && vars.some(isVarLoading),
    );

    // Only check variables in visible panels
    const hasLoadingPanels = Object.entries(variablesData.panels).some(
      ([panelId, vars]) =>
        panelsVisibility.value[panelId] && vars.some(isVarLoading),
    );

    return hasLoadingGlobal || hasLoadingTabs || hasLoadingPanels;
  });

  // Check if there are uncommitted changes (for yellow icon indicator)
  const hasUncommittedChanges = computed(() => {
    const globalChanged = !areVariableArraysEqual(
      variablesData.global,
      committedVariablesData.global,
    );
    if (globalChanged) {
      return true;
    }

    const allTabIds = new Set([
      ...Object.keys(variablesData.tabs),
      ...Object.keys(committedVariablesData.tabs),
    ]);
    for (const tabId of Array.from(allTabIds)) {
      if (
        !areVariableArraysEqual(
          variablesData.tabs[tabId] || [],
          committedVariablesData.tabs[tabId] || [],
        )
      ) {
        return true;
      }
    }

    const allPanelIds = new Set([
      ...Object.keys(variablesData.panels),
      ...Object.keys(committedVariablesData.panels),
    ]);
    for (const panelId of Array.from(allPanelIds)) {
      if (
        !areVariableArraysEqual(
          variablesData.panels[panelId] || [],
          committedVariablesData.panels[panelId] || [],
        )
      ) {
        return true;
      }
    }

    return false;
  });

  // ========== HELPER FUNCTIONS ==========
  const areVariableArraysEqual = (
    arr1: VariableRuntimeState[],
    arr2: VariableRuntimeState[],
  ): boolean => {
    if (arr1.length !== arr2.length) return false;

    for (let i = 0; i < arr1.length; i++) {
      const v1 = arr1[i];
      const v2 = arr2[i];

      if (v1.name !== v2.name) return false;

      if (Array.isArray(v1.value) && Array.isArray(v2.value)) {
        if (JSON.stringify(v1.value) !== JSON.stringify(v2.value)) {
          return false;
        }
      } else if (v1.value !== v2.value) {
        return false;
      }
    }

    return true;
  };

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
    allVariables: VariableRuntimeState[],
  ): VariableRuntimeState | undefined => {
    return allVariables.find((v) => {
      const varKey = getVariableKey(v.name, v.scope, v.tabId, v.panelId);
      return varKey === key;
    });
  };

  const isVariableVisible = (variable: VariableRuntimeState): boolean => {
    if (variable.scope === "global") return true;
    if (variable.scope === "tabs") {
      return tabsVisibility.value[variable.tabId!] === true;
    }
    if (variable.scope === "panels") {
      return panelsVisibility.value[variable.panelId!] === true;
    }
    return false;
  };

  const canVariableLoad = (variable: VariableRuntimeState): boolean => {
    const key = getVariableKey(
      variable.name,
      variable.scope,
      variable.tabId,
      variable.panelId,
    );

    // Check 1: Is visible?
    if (!isVariableVisible(variable)) {
      return false;
    }

    // Check 2: Already loading?
    if (variable.isLoading) {
      return false;
    }

    // Check 3: All parents ready?
    const parents = dependencyGraph.value[key]?.parents || [];
    const allVars = getAllVariablesFlat();

    const allParentsReady = parents.every((parentKey) => {
      const parentVar = findVariableByKey(parentKey, allVars);
      // Parent MUST be marked as partially loaded - this is the authoritative flag
      // that indicates the variable is ready to be used in queries
      if (!parentVar) {
        return false;
      }

      if (parentVar.isVariablePartialLoaded !== true) {
        return false;
      }

      // Additionally check that parent has a valid value
      const hasValue =
        parentVar.value !== null &&
        parentVar.value !== undefined &&
        parentVar.value !== "" &&
        (!Array.isArray(parentVar.value) || parentVar.value.length > 0);

      return hasValue;
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
  const initialize = async (
    config: VariableConfig[],
    dashboard: any,
    extraPanelTabMapping?: Record<string, string>,
  ) => {
    currentDashboard.value = dashboard;
    panelTabMapping.value = {
      ...buildPanelTabMapping(dashboard),
      ...(extraPanelTabMapping || {}),
    };

    // Migrate legacy variables (no scope) to global
    const migratedConfig = config.map((v) => ({
      ...v,
      scope: v.scope || "global",
    }));

    // Add "Dynamic filters" if enabled in dashboard
    if (dashboard?.variables?.showDynamicFilters) {
      migratedConfig.push({
        name: "Dynamic filters",
        type: "dynamic_filters",
        label: "Dynamic filters",
        scope: "global",
        value: [],
        options: [],
      } as any);
    }

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
        panelTabMapping.value,
      );
    } catch (error: any) {
      throw error;
    }

    // Step 4: Detect cycles
    const cycle = detectCyclesInScopedGraph(dependencyGraph.value);
    if (cycle) {
      throw new Error(`Circular dependency detected: ${cycle.join(" → ")}`);
    }

    // Step 5: Mark global independent variables as ready to load
    // Tab/panel variables will be marked when they become visible via setTabVisibility/setPanelVisibility
    const globalVars = variablesData.global;
    const independentGlobalVars = globalVars.filter((v) => {
      const key = getVariableKey(v.name, v.scope);
      const parents = dependencyGraph.value[key]?.parents || [];
      return parents.length === 0;
    });

    independentGlobalVars.forEach((v) => {
      // Mark as pending so selector will fire API
      // Skip custom and "all" variables during initial load - they don't need API calls
      if (v.type === "query_values") {
        const hasCustomOrAllDefault =
          v.selectAllValueForMultiSelect === "custom" ||
          v.selectAllValueForMultiSelect === "all";

        if (!hasCustomOrAllDefault) {
          v.isVariableLoadingPending = true;
        }
      }
    });

    // Step 5.5: Mark child variables of custom/all parents as pending
    // These children need to fire API calls even though their parents don't
    const dependentGlobalVars = globalVars.filter((v) => {
      const key = getVariableKey(v.name, v.scope);
      const parents = dependencyGraph.value[key]?.parents || [];
      return parents.length > 0;
    });

    dependentGlobalVars.forEach((v) => {
      if (v.type === "query_values") {
        const key = getVariableKey(v.name, v.scope);
        const parentKeys = dependencyGraph.value[key]?.parents || [];

        // Check if all parents are custom/all variables (and thus already loaded)
        const allParentsAreCustomOrAll = parentKeys.every((parentKey) => {
          const parentVar = globalVars.find((gv) => {
            const gvKey = getVariableKey(gv.name, gv.scope);
            return gvKey === parentKey;
          });

          if (!parentVar) return false;

          const parentIsCustomOrAll =
            parentVar.type === "query_values" &&
            (parentVar.selectAllValueForMultiSelect === "custom" ||
              parentVar.selectAllValueForMultiSelect === "all");

          return parentIsCustomOrAll;
        });

        // If all parents are custom/all, mark this child as pending to load
        if (allParentsAreCustomOrAll && parentKeys.length > 0) {
          v.isVariableLoadingPending = true;
        }
      }
    });

    // Step 6: Initialize committed state (empty at first)
    // Will be filled after variables load and user clicks refresh
    committedVariablesData.global = [];
    committedVariablesData.tabs = {};
    committedVariablesData.panels = {};

    variablesData.isInitialized = true;
  };

  // ========== COMMIT MECHANISM (like __global in main branch) ==========
  /**
   * Commits all live variable changes to committed state
   * This is triggered when user clicks the Dashboard Refresh button
   */
  const commitAll = () => {
    // Deep clone global variables
    committedVariablesData.global = variablesData.global.map((v) => ({
      ...v,
      value: Array.isArray(v.value) ? [...v.value] : v.value,
    }));

    // Deep clone tab variables
    committedVariablesData.tabs = {};
    Object.entries(variablesData.tabs).forEach(([tabId, vars]) => {
      committedVariablesData.tabs[tabId] = vars.map((v) => ({
        ...v,
        value: Array.isArray(v.value) ? [...v.value] : v.value,
      }));
    });

    // Deep clone panel variables
    committedVariablesData.panels = {};
    Object.entries(variablesData.panels).forEach(([panelId, vars]) => {
      committedVariablesData.panels[panelId] = vars.map((v) => ({
        ...v,
        value: Array.isArray(v.value) ? [...v.value] : v.value,
      }));
    });
  };

  /**
   * Commits variables for a specific scope (panel only)
   * This is triggered when user clicks panel-specific refresh
   */
  const commitScope = (scope: "panels", id: string) => {
    if (scope === "panels") {
      if (variablesData.panels[id]) {
        committedVariablesData.panels[id] = variablesData.panels[id].map(
          (v) => ({
            ...v,
            value: Array.isArray(v.value) ? [...v.value] : v.value,
          }),
        );
      }
    }
  };

  // ========== LOADING STATE MANAGEMENT ==========
  /**
   * Called by VariablesValueSelector when a variable completes loading
   * This triggers dependent children to start loading
   */
  const onVariablePartiallyLoaded = (variableKey: string) => {
    const allVars = getAllVariablesFlat();
    const variable = findVariableByKey(variableKey, allVars);

    if (!variable) return;

    // Mark as partially loaded
    variable.isVariablePartialLoaded = true;

    // Check if parent has null value (no data found)
    const parentHasNullValue =
      variable.value === null ||
      variable.value === undefined ||
      (Array.isArray(variable.value) && variable.value.length === 0);

    // Trigger children - ensure they're reset and ready to load with new parent value
    const children = dependencyGraph.value[variableKey]?.children || [];

    children.forEach((childKey) => {
      const childVar = findVariableByKey(childKey, allVars);
      if (childVar) {
        // If parent has null value, child should also be set to null WITHOUT firing API
        if (parentHasNullValue) {
          // Set child to null/empty without triggering API
          if (childVar.multiSelect) {
            childVar.value = [];
          } else {
            childVar.value = null;
          }
          childVar.options = [];
          childVar.isLoading = false;
          childVar.isVariableLoadingPending = false;
          childVar.isVariablePartialLoaded = true;

          // Recursively mark grandchildren as partially loaded with null values
          onVariablePartiallyLoaded(childKey);
        } else {
          // Parent has valid value, child can load normally
          // Check if child can load (has all parents ready and is visible)
          // Do this check BEFORE resetting to avoid triggering watchers prematurely
          if (canVariableLoad(childVar)) {
            // Reset child state to ensure it reloads with the new parent value
            // This is critical for scoped variables that need fresh data
            if (childVar.type === "query_values") {
              // Only reset if not already loading/pending
              if (!childVar.isLoading && !childVar.isVariableLoadingPending) {
                childVar.isVariablePartialLoaded = false;
                childVar.isLoading = false;
                // Reset value and options to force fresh load
                if (childVar.multiSelect) {
                  childVar.value = [];
                } else {
                  childVar.value = null;
                }
                childVar.options = [];
                // Mark as pending to trigger load
                childVar.isVariableLoadingPending = true;
              }
            } else {
              // Non-query types are immediate
              childVar.isVariablePartialLoaded = true;
              onVariablePartiallyLoaded(childKey);
            }
          }
        }
      }
    });
  };

  /**
   * Called when user changes a variable value
   * Marks dependent children as needing reload
   * This recursively resets all descendants in the dependency chain
   */
  const updateVariableValue = (
    name: string,
    scope: "global" | "tabs" | "panels",
    tabId: string | undefined,
    panelId: string | undefined,
    newValue: any,
  ) => {
    const variable = getVariable(name, scope, tabId, panelId);
    if (!variable) {
      return;
    }

    variable.value = newValue;

    // Recursively reset all descendants
    const resetDescendants = (parentKey: string) => {
      const children = dependencyGraph.value[parentKey]?.children || [];
      const allVars = getAllVariablesFlat();

      children.forEach((childKey) => {
        const childVar = findVariableByKey(childKey, allVars);
        if (childVar) {
          // Reset child's state completely - do this regardless of visibility
          // If the child is not visible now, it needs to be reset for when it becomes visible
          childVar.isVariablePartialLoaded = false;
          childVar.isLoading = false;
          // IMPORTANT: Do NOT set isVariableLoadingPending = true here
          // because we want sequential loading, not simultaneous loading.
          childVar.isVariableLoadingPending = false;

          // Reset value and options
          if (childVar.multiSelect) {
            childVar.value = [];
          } else {
            childVar.value = null;
          }
          childVar.options = [];

          // Recursively reset this child's descendants
          resetDescendants(childKey);
        }
      });
    };

    // Start the cascade from the changed variable
    const variableKey = getVariableKey(name, scope, tabId, panelId);
    resetDescendants(variableKey);

    // After resetting all descendants, trigger ONLY the immediate children
    // that are ready to load (i.e. all their parents are now ready)
    const immediateChildrenKeys = dependencyGraph.value[variableKey]?.children || [];
    const allVars = getAllVariablesFlat();

    immediateChildrenKeys.forEach(childKey => {
      const childVar = findVariableByKey(childKey, allVars);
      if (!childVar) {
        return;
      }

      const isVisible = isVariableVisible(childVar);
      const canLoad = canVariableLoad(childVar);

      if (isVisible && canLoad) {
        childVar.isVariableLoadingPending = true;
      }
    });
  };

  // ========== VISIBILITY ==========
  const setTabVisibility = (tabId: string, visible: boolean) => {
    tabsVisibility.value[tabId] = visible;

    if (visible) {
      // Mark variables as pending ONLY if they can actually load
      // (i.e. all their parents are already ready)
      const tabVars = variablesData.tabs[tabId] || [];
      tabVars.forEach((v) => {
        if (v.type === "query_values" && !v.isVariablePartialLoaded) {
          // Skip custom and "all" variables - they don't need API calls on visibility change
          const hasCustomOrAllDefault =
            v.selectAllValueForMultiSelect === "custom" ||
            v.selectAllValueForMultiSelect === "all";

          if (canVariableLoad(v) && !hasCustomOrAllDefault) {
            v.isVariableLoadingPending = true;
          }
        }
      });
    }
  };

  const setPanelVisibility = (panelId: string, visible: boolean) => {
    panelsVisibility.value[panelId] = visible;

    if (visible) {
      // Mark variables as pending ONLY if they can actually load
      // (i.e. all their parents are already ready)
      const panelVars = variablesData.panels[panelId] || [];

      panelVars.forEach((v) => {
        if (v.type === "query_values" && !v.isVariablePartialLoaded) {
          // Skip custom and "all" variables - they don't need API calls on visibility change
          const hasCustomOrAllDefault =
            v.selectAllValueForMultiSelect === "custom" ||
            v.selectAllValueForMultiSelect === "all";

          if (canVariableLoad(v) && !hasCustomOrAllDefault) {
            v.isVariableLoadingPending = true;
          }
        }
      });
    }
  };

  // ========== QUERIES ==========
  const getVariable = (
    name: string,
    scope: "global" | "tabs" | "panels",
    tabId?: string,
    panelId?: string,
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
    tabId: string,
  ): VariableRuntimeState[] => {
    // Merge: global + tab + panel (LIVE state)
    const merged = [
      ...variablesData.global,
      ...(tabId && variablesData.tabs[tabId] ? variablesData.tabs[tabId] : []),
      ...(variablesData.panels[panelId] || []),
    ];

    return merged;
  };

  /**
   * Get COMMITTED variables for a panel (used by panels for queries)
   * This is similar to how panels use currentVariablesDataRef.__global in main branch
   */
  const getCommittedVariablesForPanel = (
    panelId: string,
    tabId: string,
  ): VariableRuntimeState[] => {
    const merged = [
      ...committedVariablesData.global,
      ...(tabId && committedVariablesData.tabs[tabId]
        ? committedVariablesData.tabs[tabId]
        : []),
      ...(committedVariablesData.panels[panelId] || []),
    ];

    return merged;
  };

  const getVariablesForTab = (tabId: string): VariableRuntimeState[] => {
    return [...variablesData.global, ...(variablesData.tabs[tabId] || [])];
  };

  const getAllVisibleVariables = (
    tabId?: string,
    panelId?: string,
  ): VariableRuntimeState[] => {
    if (panelId) {
      return getVariablesForPanel(panelId, tabId || "");
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
  const loadFromUrl = (route: any) => {
    const query = route.query;

    Object.entries(query).forEach(([key, value]) => {
      if (!key.startsWith("var-")) return;

      const parsed = parseVariableUrlKey(key);
      if (!parsed) {
        return;
      }

      if (parsed.scope === "global") {
        const variable = getVariable(parsed.name, "global");
        if (variable) {
          const parsedValue = parseValue(value, variable.type, variable.multiSelect);
          variable.value = parsedValue;
          // CRITICAL: Mark as fully loaded so it doesn't try to fetch from API
          // When restoring from URL, we already have the value we need
          variable.isVariablePartialLoaded = true;
          variable.isVariableLoadingPending = false;
          variable.isLoading = false;
        }

        // ALSO apply to all tab/panel instances of same name (drilldown compatibility)
        Object.values(variablesData.tabs).forEach((tabVars) => {
          const tabVar = tabVars.find((v) => v.name === parsed.name);
          if (tabVar) {
            const parsedValue = parseValue(value, tabVar.type, tabVar.multiSelect);
            tabVar.value = parsedValue;
            // Mark as fully loaded
            tabVar.isVariablePartialLoaded = true;
            tabVar.isVariableLoadingPending = false;
            tabVar.isLoading = false;
          }
        });

        Object.values(variablesData.panels).forEach((panelVars) => {
          const panelVar = panelVars.find((v) => v.name === parsed.name);
          if (panelVar) {
            const parsedValue = parseValue(value, panelVar.type, panelVar.multiSelect);
            panelVar.value = parsedValue;
            // Mark as fully loaded
            panelVar.isVariablePartialLoaded = true;
            panelVar.isVariableLoadingPending = false;
            panelVar.isLoading = false;
          }
        });
      } else {
        // Scoped variable in URL - apply to that specific instance
        const variable = getVariable(
          parsed.name,
          parsed.scope,
          parsed.tabId,
          parsed.panelId,
        );
        if (variable) {
          const parsedValue = parseValue(value, variable.type, variable.multiSelect);
          variable.value = parsedValue;
          // Mark as fully loaded
          variable.isVariablePartialLoaded = true;
          variable.isVariableLoadingPending = false;
          variable.isLoading = false;
        }
      }
    });
  };

  interface ParsedUrlKey {
    name: string;
    scope: "global" | "tabs" | "panels";
    tabId?: string;
    panelId?: string;
  }

  const parseVariableUrlKey = (key: string): ParsedUrlKey | null => {
    const withoutPrefix = key.replace(/^var-/, "");

    const tabMatch = withoutPrefix.match(/^(.+)\.t\.(.+)$/);
    if (tabMatch) {
      return {
        name: tabMatch[1],
        scope: "tabs",
        tabId: tabMatch[2],
      };
    }

    const panelMatch = withoutPrefix.match(/^(.+)\.p\.(.+)$/);
    if (panelMatch) {
      return {
        name: panelMatch[1],
        scope: "panels",
        panelId: panelMatch[2],
      };
    }

    return {
      name: withoutPrefix,
      scope: "global",
    };
  };

  const parseValue = (value: any, type?: string, multiSelect?: boolean): any => {
    if (value === "" || value === undefined || value === null) {
      return type === "dynamic_filters" || multiSelect ? [] : null;
    }

    if (type === "dynamic_filters") {
      try {
        return JSON.parse(decodeURIComponent(value));
      } catch (e) {
        return [];
      }
    }

    if (multiSelect) {
      return Array.isArray(value) ? value : [value];
    }
    return Array.isArray(value) ? value[0] : value;
  };

  // ========== URL PARAMETER GENERATION ==========
  /**
   * Generates URL parameters for all variables with appropriate suffixes
   * @param opts - Options for URL parameter generation
   * @param opts.useLive - If true, uses live state; if false, uses committed state
   * @returns Record of var-prefixed keys with appropriate scope suffixes
   */
  const getUrlParams = (opts?: { useLive: boolean }): Record<string, any> => {
    const useLive = opts?.useLive ?? false;
    const variableParams: Record<string, any> = {};

    // Choose data source based on useLive flag
    const sourceData = useLive ? variablesData : committedVariablesData;

    // Helper to check if value is valid for URL
    const hasValidValue = (value: any): boolean => {
      if (value === null || value === undefined) return false;
      if (value === "null") return false;
      if (Array.isArray(value) && value.length === 0) return false;
      if (Array.isArray(value) && value.every((v) => v === null || v === undefined || v === "")) return false;
      return true;
    };

    // Global variables (no suffix)
    sourceData.global.forEach((variable: any) => {
      if (hasValidValue(variable.value)) {
        let value = variable.value;
        if (variable.type === "dynamic_filters") {
          value = encodeURIComponent(JSON.stringify(value));
        }
        variableParams[`var-${variable.name}`] = value;
      }
    });

    // Tab variables (use .t.[tabId] suffix)
    Object.entries(sourceData.tabs).forEach(([tabId, variables]: [string, any]) => {
      variables.forEach((variable: any) => {
        if (hasValidValue(variable.value)) {
          let value = variable.value;
          if (variable.type === "dynamic_filters") {
            value = encodeURIComponent(JSON.stringify(value));
          }
          variableParams[`var-${variable.name}.t.${tabId}`] = value;
        }
      });
    });

    // Panel variables (use .p.[panelId] suffix)
    Object.entries(sourceData.panels).forEach(([panelId, variables]: [string, any]) => {
      variables.forEach((variable: any) => {
        if (hasValidValue(variable.value)) {
          let value = variable.value;
          if (variable.type === "dynamic_filters") {
            value = encodeURIComponent(JSON.stringify(value));
          }
          variableParams[`var-${variable.name}.p.${panelId}`] = value;
        }
      });
    });

    return variableParams;
  };

  // ========== RETURN API ==========
  return {
    // State
    variablesData,
    committedVariablesData,
    dependencyGraph: computed(() => dependencyGraph.value),
    tabsVisibility: computed(() => tabsVisibility.value),
    panelsVisibility: computed(() => panelsVisibility.value),
    isLoading,
    hasUncommittedChanges,

    // Methods
    initialize,
    commitAll,
    commitScope,
    onVariablePartiallyLoaded,
    updateVariableValue,
    setTabVisibility,
    setPanelVisibility,
    getVariable,
    getVariablesForPanel,
    getCommittedVariablesForPanel,
    getVariablesForTab,
    getAllVisibleVariables,
    isVariableReady,
    getDependentVariables,
    loadFromUrl,
    getUrlParams,
  };
};
