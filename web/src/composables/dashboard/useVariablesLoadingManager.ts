/**
 * Composable for managing hierarchical dashboard variables loading
 *
 * This composable handles the complex logic of loading variables across three levels:
 * - Global: Always visible at dashboard level
 * - Tab: Visible for active tab only (lazy loaded)
 * - Panel: Visible for specific panels (lazy loaded when panel becomes visible)
 *
 * Key Features:
 * - Lazy loading: Tab and panel variables load only when needed
 * - Dependency resolution: Variables can depend on other variables at any level
 * - URL synchronization: Variable values are synced with URL parameters
 * - Proper isolation: Each level's values are stored separately with context
 * - Loading cascade: Global → Tab → Panel (prevents premature API calls)
 *
 * @see VARIABLES_HANDLING_SYSTEM.md for complete documentation
 */

import { computed, nextTick, reactive, ref, watch } from 'vue';
import { getScopeType } from '@/utils/dashboard/variables/variablesScopeUtils';

/**
 * Variable scope levels
 */
export type VariableScope = 'global' | 'tabs' | 'panels';

/**
 * Variable value with scope context
 * For global variables: just the value
 * For tab variables: array of { tabId, value }
 * For panel variables: array of { panelId, value }
 */
export type ScopedValue =
  | any // Global variable value (string, number, array for multi-select)
  | Array<{ tabId: string; value: any }> // Tab-scoped values
  | Array<{ panelId: string; value: any }>; // Panel-scoped values

/**
 * Structure for variables data emitted to parent
 */
export interface VariablesData {
  isVariablesLoading: boolean;
  values: Array<{
    name: string;
    value: any;
    scope: VariableScope;
    _isCurrentLevel: boolean;
    [key: string]: any; // Additional variable config properties
  }>;
}

/**
 * Structure for merged variables (internal state)
 */
export interface MergedVariables {
  [varName: string]: ScopedValue;
}

/**
 * Loading state for different levels
 */
export interface LoadingState {
  global: boolean;
  tab: boolean;
  panels: Set<string>; // Set of loaded panel IDs
}

/**
 * Options for the composable
 */
export interface UseVariablesLoadingManagerOptions {
  dashboardVariables: any; // Dashboard variables config
  selectedTabId: string | null; // Currently active tab ID
  initialVariableValues?: { value: Record<string, any> }; // Initial values from URL or parent
}

/**
 * Hook for managing hierarchical variables loading
 */
export function useVariablesLoadingManager(options: UseVariablesLoadingManagerOptions) {
  const { dashboardVariables, selectedTabId, initialVariableValues } = options;

  // ============================================
  // STATE MANAGEMENT
  // ============================================

  /**
   * Merged variables values across all levels
   * Structure:
   * {
   *   variableName: value (for global)
   *   OR
   *   variableName: [{ tabId, value }] (for tab-scoped)
   *   OR
   *   variableName: [{ panelId, value }] (for panel-scoped)
   * }
   */
  const mergedVariablesValues = ref<MergedVariables>({});

  /**
   * Current variables data for each context
   * __global: merged global + tab vars for panels without panel vars
   * panelId: merged global + tab + panel vars for specific panel
   */
  const currentVariablesDataRef = ref<Record<string, VariablesData>>({
    __global: { isVariablesLoading: false, values: [] },
  });

  /**
   * Loading state tracking
   */
  const loadingState = reactive<LoadingState>({
    global: false,
    tab: false,
    panels: new Set<string>(),
  });

  /**
   * Track if this is the initial dashboard load
   * Used to prevent premature API calls until all levels are ready
   */
  const isInitialDashboardLoad = ref(true);

  /**
   * Track last values to detect actual changes (avoid redundant updates)
   */
  const lastGlobalValues = ref<Record<string, any>>({});
  const lastTabValues = ref<Record<string, Record<string, any>>>({});
  const lastPanelValues = ref<Record<string, Record<string, any>>>({});

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  /**
   * Check if value is a scoped array (tab/panel scoped)
   */
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

  /**
   * Get variable value based on current context (tab/panel)
   * Priority: panelId > tabId > global value
   */
  const getContextualVariableValue = (
    varName: string,
    context?: { tabId?: string; panelId?: string }
  ): any => {
    const storedValue = mergedVariablesValues.value[varName];

    if (storedValue === undefined) return undefined;

    // If value is not an array or object, it's a simple global variable
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

    // If it's an array but not scoped, it's a global multi-select variable
    if (Array.isArray(storedValue)) {
      return storedValue;
    }

    // If we reach here, it's some other object - return as is
    return storedValue;
  };

  /**
   * Create config with ALL variables for dependency resolution
   * but only current level visible for UI
   */
  const createConfigWithAllVariables = (
    levelVars: any[],
    allVars: any[],
    baseConfig: any
  ) => {
    const configList = allVars.map((v: any) => ({
      ...v,
      _isCurrentLevel: levelVars.some((lv: any) => lv.name === v.name),
    }));

    return {
      ...baseConfig,
      list: configList,
      _levelVariables: levelVars, // Keep original level variables
    };
  };

  // ============================================
  // CONFIGURATION BUILDERS
  // ============================================

  /**
   * Global variables configuration
   * Only includes global-scoped variables
   */
  const globalVariablesConfig = computed(() => {
    if (!dashboardVariables?.list) {
      return { list: [], showDynamicFilters: false };
    }

    const globalVars = dashboardVariables.list.filter(
      (v: any) => getScopeType(v) === 'global'
    );

    return {
      ...dashboardVariables,
      list: globalVars,
    };
  });

  /**
   * Tab variables configuration
   * Includes global + tab variables for dependency resolution
   * Only tab variables are marked as _isCurrentLevel
   */
  const tabVariablesConfig = computed(() => {
    if (!dashboardVariables?.list || !selectedTabId) {
      return { list: [], showDynamicFilters: false, _levelVariables: [] };
    }

    const allVars = dashboardVariables.list;
    const globalVars = allVars.filter((v: any) => getScopeType(v) === 'global');
    const tabVars = allVars.filter(
      (v: any) =>
        getScopeType(v) === 'tabs' &&
        v.tabs &&
        v.tabs.includes(selectedTabId)
    );

    return createConfigWithAllVariables(
      tabVars,
      [...globalVars, ...tabVars],
      dashboardVariables
    );
  });

  /**
   * Get active tab variables (only tab-level, not including global)
   */
  const activeTabVariables = computed(() => {
    return tabVariablesConfig.value._levelVariables || [];
  });

  /**
   * Panel variables configuration
   * Includes global + tab + panel variables for full dependency resolution
   */
  const getPanelVariablesConfig = (panelId: string) => {
    if (!dashboardVariables?.list) {
      return { list: [], showDynamicFilters: false, _levelVariables: [] };
    }

    const allVars = dashboardVariables.list;
    const globalVars = allVars.filter((v: any) => getScopeType(v) === 'global');
    const tabVars = selectedTabId
      ? allVars.filter(
          (v: any) =>
            getScopeType(v) === 'tabs' &&
            v.tabs &&
            v.tabs.includes(selectedTabId)
        )
      : [];
    const panelVars = allVars.filter(
      (v: any) =>
        getScopeType(v) === 'panels' &&
        v.panels &&
        v.panels.includes(panelId)
    );

    return createConfigWithAllVariables(
      panelVars,
      [...globalVars, ...tabVars, ...panelVars],
      dashboardVariables
    );
  };

  /**
   * Get panel variables (only panel-level, not including global/tab)
   */
  const getPanelVariables = (panelId: string) => {
    const config = getPanelVariablesConfig(panelId);
    return config._levelVariables || [];
  };

  // ============================================
  // VARIABLE VALUE WRAPPERS
  // ============================================

  /**
   * Wrapper for passing to tab/global components
   * Resolves values based on current tab context
   */
  const mergedVariablesWrapper = computed(() => {
    const resolved: Record<string, any> = {};
    const currentTabId = selectedTabId;

    Object.keys(mergedVariablesValues.value).forEach((varName) => {
      resolved[varName] = getContextualVariableValue(varName, {
        tabId: currentTabId || undefined,
      });
    });

    return { value: resolved };
  });

  /**
   * Helper to get panel-specific variable wrapper
   * Resolves with panel priority
   */
  const getPanelVariablesWrapper = (panelId: string) => {
    const resolved: Record<string, any> = {};
    const currentTabId = selectedTabId;

    Object.keys(mergedVariablesValues.value).forEach((varName) => {
      resolved[varName] = getContextualVariableValue(varName, {
        tabId: currentTabId || undefined,
        panelId: panelId,
      });
    });

    return { value: resolved };
  };

  // ============================================
  // DATA UPDATE HANDLERS
  // ============================================

  /**
   * Handle global variables data update
   * Triggers tab variables load after completion
   */
  const handleGlobalVariablesUpdate = (data: VariablesData) => {
    // Only process when loading is complete
    if (data?.isVariablesLoading === true) {
      console.log(`[VariablesManager] Global variables still loading, waiting...`);
      return;
    }

    console.log(`[VariablesManager] Global variables loaded`);

    // Extract current global values
    const currentGlobalValues: Record<string, any> = {};
    if (data?.values) {
      data.values.forEach((v: any) => {
        if (v.name && v.value !== undefined && v._isCurrentLevel !== false) {
          currentGlobalValues[v.name] = v.value;
        }
      });
    }

    // Check if this is first load or values changed
    const isFirstLoad = !loadingState.global;
    let hasActualChanges = false;

    if (!isFirstLoad) {
      hasActualChanges = Object.keys(currentGlobalValues).some(
        (key) =>
          JSON.stringify(currentGlobalValues[key]) !==
          JSON.stringify(lastGlobalValues.value[key])
      );
    }

    // Update merged state only if changed or first load
    if (isFirstLoad || hasActualChanges) {
      const updatedValues: Record<string, any> = {
        ...mergedVariablesValues.value,
        ...currentGlobalValues,
      };
      mergedVariablesValues.value = updatedValues;
      lastGlobalValues.value = { ...currentGlobalValues };

      console.log('[VariablesManager] Updated global values:', currentGlobalValues);
    } else {
      return; // No changes, skip
    }

    // Mark global as loaded on first load
    if (isFirstLoad) {
      loadingState.global = true;

      // Return handler for child components to trigger tab load
      return {
        shouldTriggerTabLoad: activeTabVariables.value.length > 0,
        shouldTriggerPanelLoad: activeTabVariables.value.length === 0,
      };
    }

    return null;
  };

  /**
   * Handle tab variables data update
   * Triggers panel variables load after completion
   */
  const handleTabVariablesUpdate = (data: VariablesData, tabId: string) => {
    if (data?.isVariablesLoading === true) {
      console.log(`[VariablesManager] Tab ${tabId} variables still loading, waiting...`);
      return;
    }

    console.log(`[VariablesManager] Tab ${tabId} variables loaded`);

    // Extract current tab values
    const currentTabValues: Record<string, any> = {};
    if (data?.values) {
      data.values.forEach((v: any) => {
        if (v.name && v.value !== undefined && v._isCurrentLevel === true) {
          currentTabValues[v.name] = v.value;
        }
      });
    }

    // Check if first load or values changed
    const tabKey = `tab_${tabId}`;
    const isFirstLoad = !loadingState.tab;
    let hasActualChanges = false;

    if (!isFirstLoad) {
      hasActualChanges = Object.keys(currentTabValues).some((key) => {
        const lastValue = lastTabValues.value[tabKey]?.[key];
        return JSON.stringify(currentTabValues[key]) !== JSON.stringify(lastValue);
      });
    }

    // Update merged state only if changed or first load
    if (isFirstLoad || hasActualChanges) {
      // Store values with tab isolation
      Object.keys(currentTabValues).forEach((varName) => {
        const varValue = currentTabValues[varName];
        const existingValue = mergedVariablesValues.value[varName];

        if (!existingValue || !isScopedArray(existingValue)) {
          mergedVariablesValues.value[varName] = [];
        }

        const existingEntryIndex = mergedVariablesValues.value[varName].findIndex(
          (entry: any) => entry.tabId === tabId
        );

        if (existingEntryIndex >= 0) {
          mergedVariablesValues.value[varName][existingEntryIndex].value = varValue;
        } else {
          mergedVariablesValues.value[varName].push({ tabId, value: varValue });
        }
      });

      // Track last values for this tab
      if (!lastTabValues.value[tabKey]) {
        lastTabValues.value[tabKey] = {};
      }
      lastTabValues.value[tabKey] = { ...currentTabValues };

      console.log('[VariablesManager] Updated tab values:', currentTabValues);
    } else {
      loadingState.tab = true;
      return null;
    }

    // Mark tab as loaded on first load
    if (isFirstLoad) {
      loadingState.tab = true;

      return {
        shouldTriggerPanelLoad: true,
      };
    }

    return null;
  };

  /**
   * Handle panel variables data update
   * Final step in the loading cascade
   */
  const handlePanelVariablesUpdate = (data: VariablesData, panelId: string) => {
    // Check if still loading
    if (data?.isVariablesLoading === true) {
      console.log(`[VariablesManager] Panel ${panelId} variables still loading, skipping...`);
      return null;
    }

    // Check individual variable loading states
    const hasLoadingVariables = data?.values?.some(
      (v: any) =>
        v.isLoading === true ||
        v.isVariableLoadingPending === true ||
        (v.value === null && v.type === 'query_values')
    );

    if (hasLoadingVariables) {
      console.log(`[VariablesManager] Panel ${panelId} has loading variables, skipping...`);
      return null;
    }

    console.log(`[VariablesManager] Panel ${panelId} variables loaded`);

    // Extract current panel values
    const currentPanelValues: Record<string, any> = {};
    if (data?.values) {
      data.values.forEach((v: any) => {
        if (v.name && v.value !== undefined && v._isCurrentLevel === true) {
          currentPanelValues[v.name] = v.value;
        }
      });
    }

    // Check if first load or values changed
    const isFirstLoad = !lastPanelValues.value[panelId];
    let hasActualChanges = false;

    if (!isFirstLoad) {
      hasActualChanges = Object.keys(currentPanelValues).some(
        (key) =>
          JSON.stringify(currentPanelValues[key]) !==
          JSON.stringify(lastPanelValues.value[panelId]?.[key])
      );
    }

    // Update merged state only if changed or first load
    if (isFirstLoad || hasActualChanges) {
      // Store values with panel isolation
      Object.keys(currentPanelValues).forEach((varName) => {
        const varValue = currentPanelValues[varName];
        const existingValue = mergedVariablesValues.value[varName];

        if (!existingValue || !isScopedArray(existingValue)) {
          mergedVariablesValues.value[varName] = [];
        }

        const existingEntryIndex = mergedVariablesValues.value[varName].findIndex(
          (entry: any) => entry.panelId === panelId
        );

        if (existingEntryIndex >= 0) {
          mergedVariablesValues.value[varName][existingEntryIndex].value = varValue;
        } else {
          mergedVariablesValues.value[varName].push({ panelId, value: varValue });
        }
      });

      // Track last values for this panel
      if (!lastPanelValues.value[panelId]) {
        lastPanelValues.value[panelId] = {};
      }
      lastPanelValues.value[panelId] = { ...currentPanelValues };

      console.log('[VariablesManager] Updated panel values:', currentPanelValues);
    } else {
      return null;
    }

    // Mark panel as loaded
    if (isFirstLoad) {
      loadingState.panels.add(panelId);

      return {
        isFirstLoad: true,
      };
    }

    return null;
  };

  // ============================================
  // MERGED DATA BUILDERS
  // ============================================

  /**
   * Build merged variables data for a specific panel
   * Combines global + tab + panel level variables
   */
  const buildMergedVariablesDataForPanel = (panelId: string, baseData: any) => {
    const currentTabId = selectedTabId;
    const panelConfig = getPanelVariablesConfig(panelId);
    const allVariableConfigs = panelConfig.list || [];

    const mergedValues: any[] = [];

    allVariableConfigs.forEach((varConfig: any) => {
      const varName = varConfig.name;
      const scope = getScopeType(varConfig);

      // Check if variable's level has loaded
      let isLevelLoaded = false;
      if (scope === 'global') {
        isLevelLoaded = loadingState.global;
      } else if (scope === 'tabs') {
        isLevelLoaded = loadingState.tab;
      } else if (scope === 'panels') {
        isLevelLoaded = loadingState.panels.has(panelId);
      }

      if (!isLevelLoaded) {
        return; // Skip unloaded variables
      }

      // Get contextual value with panel priority
      const resolvedValue = getContextualVariableValue(varName, {
        panelId: panelId,
        tabId: currentTabId || undefined,
      });

      // Only include if value is not null/undefined
      if (resolvedValue !== undefined && resolvedValue !== null) {
        mergedValues.push({
          ...varConfig,
          value: resolvedValue,
          _isCurrentLevel: varConfig._isCurrentLevel,
          isLoading: false,
          isVariableLoadingPending: false,
          isVariablePartialLoaded: true,
        });
      }
    });

    return {
      ...baseData,
      values: mergedValues,
      isVariablesLoading: baseData.isVariablesLoading || false,
    };
  };

  /**
   * Build aggregated variables for URL synchronization
   * Includes all levels with proper scope annotations
   */
  const aggregatedVariablesForUrl = computed(() => {
    if (!dashboardVariables?.list) {
      return { isVariablesLoading: false, values: [] };
    }

    const allVars = dashboardVariables.list;
    const aggregatedValues: any[] = [];

    allVars.forEach((varConfig: any) => {
      const scope = getScopeType(varConfig);
      const varName = varConfig.name;

      if (scope === 'global') {
        const value = mergedVariablesValues.value[varName];
        const isValidValue =
          value !== undefined &&
          (typeof value !== 'object' ||
            value === null ||
            (Array.isArray(value) && !value.some((v: any) => v?.tabId || v?.panelId)));

        if (isValidValue) {
          aggregatedValues.push({
            ...varConfig,
            scope: 'global',
            value,
            _isCurrentLevel: true,
          });
        }
      } else if (scope === 'tabs') {
        const tabValues: any[] = [];
        const storedValue = mergedVariablesValues.value[varName];

        if (Array.isArray(storedValue)) {
          storedValue.forEach((entry: any) => {
            if (
              entry.tabId &&
              entry.value !== undefined &&
              varConfig.tabs &&
              varConfig.tabs.includes(entry.tabId)
            ) {
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
        const panelValues: any[] = [];
        const storedValue = mergedVariablesValues.value[varName];

        if (Array.isArray(storedValue)) {
          storedValue.forEach((entry: any) => {
            if (
              entry.panelId &&
              entry.value !== undefined &&
              varConfig.panels &&
              varConfig.panels.includes(entry.panelId)
            ) {
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
      isVariablesLoading: false,
      values: aggregatedValues,
    };
  });

  // ============================================
  // INITIALIZATION & RESET
  // ============================================

  /**
   * Initialize from URL or parent values
   */
  const initializeFromInitialValues = (values: { value: Record<string, any> }) => {
    if (values?.value) {
      mergedVariablesValues.value = { ...values.value };
      console.log('[VariablesManager] Initialized from initial values:', values.value);
    }
  };

  /**
   * Reset loading state (for tab changes or refresh)
   */
  const resetLoadingState = () => {
    loadingState.global = false;
    loadingState.tab = false;
    loadingState.panels.clear();
    isInitialDashboardLoad.value = true;
    lastGlobalValues.value = {};
    lastTabValues.value = {};
    lastPanelValues.value = {};
    console.log('[VariablesManager] Loading state reset');
  };

  /**
   * Mark initial load as complete
   * Allows panels to start fetching data
   */
  const markInitialLoadComplete = () => {
    isInitialDashboardLoad.value = false;
    console.log('[VariablesManager] Initial load marked complete');
  };

  // ============================================
  // WATCHERS
  // ============================================

  // Initialize from props
  watch(
    () => initialVariableValues,
    (newVal) => {
      if (newVal) {
        initializeFromInitialValues(newVal);
      }
    },
    { immediate: true }
  );

  // Reset on tab change
  watch(
    () => selectedTabId,
    (newTabId, oldTabId) => {
      if (newTabId !== oldTabId && oldTabId !== undefined) {
        console.log(`[VariablesManager] Tab changed: ${oldTabId} → ${newTabId}`);
        resetLoadingState();
      }
    }
  );

  // ============================================
  // PUBLIC API
  // ============================================

  return {
    // State
    mergedVariablesValues,
    currentVariablesDataRef,
    isInitialDashboardLoad,
    loadingState,

    // Configs
    globalVariablesConfig,
    tabVariablesConfig,
    activeTabVariables,
    getPanelVariablesConfig,
    getPanelVariables,

    // Wrappers
    mergedVariablesWrapper,
    getPanelVariablesWrapper,
    aggregatedVariablesForUrl,

    // Handlers
    handleGlobalVariablesUpdate,
    handleTabVariablesUpdate,
    handlePanelVariablesUpdate,

    // Builders
    buildMergedVariablesDataForPanel,
    getContextualVariableValue,

    // Lifecycle
    resetLoadingState,
    markInitialLoadComplete,
    initializeFromInitialValues,
  };
}
