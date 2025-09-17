import { reactive, ref, computed, watchEffect } from "vue";
import { useGlobalComposable } from "./useGlobalComposable";

export interface VariableState {
  name: string;
  scope: "global" | "tabs" | "panels";
  tabId?: string;
  panelId?: string;
  isLoading: boolean;
}

export function useVariablesComposable(options?: {
  scope?: "global" | "tabs" | "panels";
  tabId?: string;
  panelId?: string;
}) {
  const { injectGlobalState } = useGlobalComposable();
  const globalState = injectGlobalState();

  const scope = options?.scope || "global";
  const tabId = options?.tabId || null;
  const panelId = options?.panelId || null;

  const currentVariablesLoadingState = ref<Record<string, boolean>>({});

  const getStateKey = () => {
    if (scope === "global") return "global";
    if (scope === "tabs" && tabId) return `tab_${tabId}`;
    if (scope === "panels" && panelId) return `panel_${panelId}`;
    return "global"; // Default fallback
  };

  const stateKey = getStateKey();

  // Track the variable loading status for the current component
  const setVariableLoadingStatus = (
    variableName: string,
    isLoading: boolean,
  ) => {
    // Update local state
    currentVariablesLoadingState.value[variableName] = isLoading;

    // Update global state with proper scoping
    const globalKey = `${stateKey}_${variableName}`;
    console.log(
      `setVariableLoadingStatus: setting ${globalKey} to ${isLoading}`,
    );
    globalState.variablesData[globalKey] = isLoading;

    // If this is a panel-scoped variable, also update the parent tab's state
    if (scope === "panels" && tabId) {
      const tabKey = `tab_${tabId}_${variableName}`;
      console.log(
        `setVariableLoadingStatus: setting ${tabKey} to ${isLoading} (panel scoped)`,
      );
      globalState.variablesData[tabKey] = isLoading;
    }

    return currentVariablesLoadingState.value;
  };

  // Check if all variables are loaded for this component
  const areAllVariablesLoaded = computed(() => {
    if (Object.keys(currentVariablesLoadingState.value).length === 0) {
      return true;
    }

    console.log(
      `areAllVariablesLoaded: checking if all ${
        Object.keys(currentVariablesLoadingState.value).length
      } variables are loaded`,
    );
    return !Object.values(currentVariablesLoadingState.value).some(
      (isLoading) => isLoading,
    );
  });

  // Set the loading state for a panel
  const setPanelLoadingStatus = (panelId: string, isLoading: boolean) => {
    console.log(`setPanelLoadingStatus: setting ${panelId} to ${isLoading}`);
    globalState.panels[panelId] = isLoading;
  };

  // Add trace IDs for tracking search requests
  const addSearchRequestTraceIds = (panelId: string, traceIds: string[]) => {
    console.log(
      `addSearchRequestTraceIds: adding trace IDs ${traceIds} to ${panelId}`,
    );
    globalState.searchRequestTraceIds[panelId] = traceIds;
  };

  // Check if a variable has dependencies that are still loading
  const hasLoadingDependencies = (
    variableName: string,
    dependencies: string[],
  ) => {
    if (!dependencies || dependencies.length === 0) return false;

    return dependencies.some((dependencyName) => {
      // Check in current scope first
      const currentScopeKey = `${stateKey}_${dependencyName}`;
      if (globalState.variablesData[currentScopeKey] === true) return true;

      // If in panel scope, also check parent tab scope
      if (scope === "panels" && tabId) {
        const tabKey = `tab_${tabId}_${dependencyName}`;
        if (globalState.variablesData[tabKey] === true) return true;
      }

      // For tabs and panels, also check global scope
      if (scope !== "global") {
        const globalKey = `global_${dependencyName}`;
        if (globalState.variablesData[globalKey] === true) return true;
      }

      return false;
    });
  };

  // Check dependency graph and determine if this variable should start loading
  const shouldLoadVariable = (variableName: string, dependencies: string[]) => {
    if (!dependencies || dependencies.length === 0) {
      return true; // No dependencies, can load immediately
    }

    // If any dependency is still loading, we should wait
    return !hasLoadingDependencies(variableName, dependencies);
  };

  // Get all loading states
  const getAllLoadingStates = () => {
    return {
      variablesData: { ...globalState.variablesData },
      panels: { ...globalState.panels },
      searchRequestTraceIds: { ...globalState.searchRequestTraceIds },
    };
  };

  return {
    setVariableLoadingStatus,
    setPanelLoadingStatus,
    addSearchRequestTraceIds,
    shouldLoadVariable,
    hasLoadingDependencies,
    areAllVariablesLoaded,
    getAllLoadingStates,
    stateKey,
  };
}
