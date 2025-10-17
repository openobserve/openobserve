/**
 * Variables Loading Manager Composable
 *
 * SIMPLIFIED VERSION - Only manages cascade decisions, doesn't trigger loads
 *
 * Handles:
 * - Change detection (only cascade on value changes)
 * - Dependency resolution (via buildVariablesDependencyGraph)
 * - Cascade coordination
 */

import { ref } from 'vue';
import { buildVariablesDependencyGraph } from '../utils/dashboard/variables/variablesDependencyUtils';

export interface VariableRef {
  loadAllVariablesData: (isInitial: boolean) => Promise<void>;
  changeInitialVariableValues: (values: any) => Promise<void>;
  variablesData: {
    values: any[];
    isVariablesLoading: boolean;
  };
  variablesConfig?: any;
}

export function useVariablesLoadingManager() {
  // Component refs
  const globalRef = ref<VariableRef | null>(null);
  const tabRefs = ref<Record<string, VariableRef>>({});
  const panelRefs = ref<Record<string, VariableRef>>({});

  // Loading state tracking (to prevent duplicate cascades)
  const globalLoaded = ref(false);
  const tabsLoaded = ref<Set<string>>(new Set());
  const panelsLoaded = ref<Set<string>>(new Set());

  // Track which variables changed (for cascade decisions)
  const lastGlobalValues = ref<Record<string, any>>({});
  const lastTabValues = ref<Record<string, Record<string, any>>>({});
  const lastPanelValues = ref<Record<string, Record<string, any>>>({});

  /**
   * Extract variable values from data emit
   */
  const extractValues = (data: any): Record<string, any> => {
    const values: Record<string, any> = {};
    if (data?.values) {
      data.values.forEach((v: any) => {
        if (v.name && v.value !== undefined) {
          values[v.name] = v.value;
        }
      });
    }
    return values;
  };

  /**
   * Detect which variables changed by comparing values
   */
  const detectChanges = (
    newValues: Record<string, any>,
    oldValues: Record<string, any>
  ): string[] => {
    const changed: string[] = [];

    Object.keys(newValues).forEach(name => {
      if (JSON.stringify(newValues[name]) !== JSON.stringify(oldValues[name])) {
        changed.push(name);
      }
    });

    return changed;
  };

  /**
   * Check if component has variables that depend on changed variables
   */
  const hasDependencies = (
    variablesConfig: any,
    changedVarNames: string[]
  ): boolean => {
    if (!variablesConfig?.list) return false;

    // Build dependency graph
    const depGraph = buildVariablesDependencyGraph(variablesConfig.list);

    // Check if any variable in this config depends on changed variables
    return variablesConfig.list.some((v: any) => {
      const deps = depGraph[v.name] || [];
      return deps.some((dep: string) => changedVarNames.includes(dep));
    });
  };

  // ============================================
  // REF SETTERS
  // ============================================

  const setGlobalRef = (ref: VariableRef | null) => {
    globalRef.value = ref;
    console.log('[VarsManager] Global ref set:', !!ref);
  };

  const setTabRef = (tabId: string, ref: VariableRef | null) => {
    if (ref) {
      tabRefs.value[tabId] = ref;
      console.log('[VarsManager] Tab ref set:', tabId);
    } else {
      delete tabRefs.value[tabId];
      tabsLoaded.value.delete(tabId);
      delete lastTabValues.value[tabId];
      console.log('[VarsManager] Tab ref removed:', tabId);
    }
  };

  const setPanelRef = (panelId: string, ref: VariableRef | null) => {
    if (ref) {
      panelRefs.value[panelId] = ref;
      console.log('[VarsManager] Panel ref set:', panelId);
    } else {
      delete panelRefs.value[panelId];
      panelsLoaded.value.delete(panelId);
      delete lastPanelValues.value[panelId];
      console.log('[VarsManager] Panel ref removed:', panelId);
    }
  };

  // ============================================
  // DATA UPDATE HANDLERS
  // ============================================

  /**
   * Handle global variables data update
   * Only cascades if values actually changed
   */
  const onGlobalDataUpdate = async (data: any, mergedValues: Record<string, any>) => {
    const isFirstLoad = !globalLoaded.value;
    const currentValues = extractValues(data);
    const changed = detectChanges(currentValues, lastGlobalValues.value);

    // Update tracking
    lastGlobalValues.value = { ...currentValues };
    globalLoaded.value = true;

    console.log('[VarsManager] Global update:', {
      isFirstLoad,
      changed,
      valueCount: Object.keys(currentValues).length
    });

    // Skip cascade if no changes and not first load
    if (changed.length === 0 && !isFirstLoad) {
      console.log('[VarsManager] No global changes, skipping cascade');
      return;
    }

    // Cascade to tabs
    for (const tabId of Object.keys(tabRefs.value)) {
      const tabRef = tabRefs.value[tabId];
      if (!tabRef) continue;

      // Check if tab has dependencies on changed variables
      if (tabRef.variablesConfig && hasDependencies(tabRef.variablesConfig, changed)) {
        console.log('[VarsManager] Cascading to tab:', tabId, 'for changes:', changed);
        await tabRef.changeInitialVariableValues(mergedValues);
      }
    }

    // Cascade to panels (direct dependencies only, not through tabs)
    for (const panelId of Object.keys(panelRefs.value)) {
      const panelRef = panelRefs.value[panelId];
      if (!panelRef) continue;

      // Check if panel has dependencies on changed variables
      if (panelRef.variablesConfig && hasDependencies(panelRef.variablesConfig, changed)) {
        console.log('[VarsManager] Cascading to panel:', panelId, 'for changes:', changed);
        await panelRef.changeInitialVariableValues(mergedValues);
      }
    }
  };

  /**
   * Handle tab variables data update
   */
  const onTabDataUpdate = async (
    tabId: string,
    data: any,
    mergedValues: Record<string, any>
  ) => {
    const isFirstLoad = !tabsLoaded.value.has(tabId);

    if (!lastTabValues.value[tabId]) {
      lastTabValues.value[tabId] = {};
    }

    const currentValues = extractValues(data);
    const changed = detectChanges(currentValues, lastTabValues.value[tabId]);

    // Update tracking
    lastTabValues.value[tabId] = { ...currentValues };
    tabsLoaded.value.add(tabId);

    console.log('[VarsManager] Tab update:', {
      tabId,
      isFirstLoad,
      changed,
      valueCount: Object.keys(currentValues).length
    });

    // Skip cascade if no changes and not first load
    if (changed.length === 0 && !isFirstLoad) {
      console.log('[VarsManager] No tab changes, skipping cascade');
      return;
    }

    // Cascade to panels
    for (const panelId of Object.keys(panelRefs.value)) {
      const panelRef = panelRefs.value[panelId];
      if (!panelRef) continue;

      // Check if panel has dependencies on changed variables
      if (panelRef.variablesConfig && hasDependencies(panelRef.variablesConfig, changed)) {
        console.log('[VarsManager] Cascading to panel:', panelId, 'for changes:', changed);
        await panelRef.changeInitialVariableValues(mergedValues);
      }
    }
  };

  /**
   * Handle panel variables data update
   */
  const onPanelDataUpdate = async (
    panelId: string,
    data: any,
    mergedValues: Record<string, any>
  ) => {
    const isFirstLoad = !panelsLoaded.value.has(panelId);

    if (!lastPanelValues.value[panelId]) {
      lastPanelValues.value[panelId] = {};
    }

    const currentValues = extractValues(data);
    const changed = detectChanges(currentValues, lastPanelValues.value[panelId]);

    // Update tracking
    lastPanelValues.value[panelId] = { ...currentValues };
    panelsLoaded.value.add(panelId);

    console.log('[VarsManager] Panel update:', {
      panelId,
      isFirstLoad,
      changed,
      valueCount: Object.keys(currentValues).length
    });

    // Skip cascade if no changes and not first load
    if (changed.length === 0 && !isFirstLoad) {
      console.log('[VarsManager] No panel changes, skipping cascade');
      return;
    }

    // Panel → panel dependencies would cascade here
    const panelRef = panelRefs.value[panelId];
    if (panelRef?.variablesConfig && hasDependencies(panelRef.variablesConfig, changed)) {
      console.log('[VarsManager] Cascading panel → panel dependencies');
      await panelRef.changeInitialVariableValues(mergedValues);
    }
  };

  // ============================================
  // VISIBILITY HANDLERS (Simplified - just tracking)
  // ============================================

  const onTabVisible = async (tabId: string, mergedValues: Record<string, any>) => {
    console.log('[VarsManager] Tab visible:', tabId);
    // No action needed - VariablesValueSelector will load itself
  };

  const onTabHidden = (tabId: string) => {
    console.log('[VarsManager] Tab hidden:', tabId);
    // No action needed
  };

  const onPanelVisible = async (
    panelId: string,
    tabId: string | null,
    mergedValues: Record<string, any>
  ) => {
    console.log('[VarsManager] Panel visible:', panelId);
    // No action needed - VariablesValueSelector with lazyLoad will handle it
  };

  const onPanelHidden = (panelId: string) => {
    console.log('[VarsManager] Panel hidden:', panelId);
    // No action needed
  };

  /**
   * Reset all state
   */
  const reset = () => {
    console.log('[VarsManager] Resetting state');
    globalRef.value = null;
    tabRefs.value = {};
    panelRefs.value = {};
    globalLoaded.value = false;
    tabsLoaded.value.clear();
    panelsLoaded.value.clear();
    lastGlobalValues.value = {};
    lastTabValues.value = {};
    lastPanelValues.value = {};
  };

  return {
    // Ref setters
    setGlobalRef,
    setTabRef,
    setPanelRef,

    // Data update handlers
    onGlobalDataUpdate,
    onTabDataUpdate,
    onPanelDataUpdate,

    // Visibility handlers
    onTabVisible,
    onTabHidden,
    onPanelVisible,
    onPanelHidden,

    // Utilities
    reset,
    extractValues,

    // Exposed state (read-only)
    globalLoaded,
    tabsLoaded,
    panelsLoaded,
  };
}
