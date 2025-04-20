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

  // Generate a unique key based on the scope, tabId, and panelId
  const getStateKey = () => {
    console.log("Generating state key...");
    if (scope === "global") return "__global";
    if (scope === "tabs" && tabId) return `tab_${tabId}`;
    if (scope === "panels" && panelId) return `panel_${panelId}`;
    return "__global"; // Default fallback
  };

  const stateKey = getStateKey();

  // Track the variable loading status for the current component
  const setVariableLoadingStatus = (
    variableName: string,
    isLoading: boolean,
  ) => {
    console.log(`Setting loading status for variable: ${variableName}, isLoading: ${isLoading}`);
    // Update local state
    currentVariablesLoadingState.value[variableName] = isLoading;

    // Update global state
    globalState.variablesData[`${stateKey}_${variableName}`] = isLoading;

    return currentVariablesLoadingState.value;
  };

  // Check if all variables are loaded for this component
  const areAllVariablesLoaded = computed(() => {
    console.log("Checking if all variables are loaded...");
    if (Object.keys(currentVariablesLoadingState.value).length === 0) {
      return true;
    }

    return !Object.values(currentVariablesLoadingState.value).some(
      (isLoading) => isLoading,
    );
  });

  // Set the loading state for a panel
  const setPanelLoadingStatus = (panelId: string, isLoading: boolean) => {
    console.log(`Setting panel loading status for panel: ${panelId}, isLoading: ${isLoading}`);
    globalState.panels[panelId] = isLoading;
  };

  // Add trace IDs for tracking search requests
  const addSearchRequestTraceIds = (panelId: string, traceIds: string[]) => {
    console.log(`Adding trace IDs for panel: ${panelId}, traceIds: ${traceIds}`);
    globalState.searchRequestTraceIds[panelId] = traceIds;
  };

  // Check if a variable has dependencies that are still loading
  const hasLoadingDependencies = (
    variableName: string,
    dependencies: string[],
  ) => {
    console.log(`Checking loading dependencies for variable: ${variableName}`);
    if (!dependencies || dependencies.length === 0) return false;

    return dependencies.some((dependencyName) => {
      const key = `${stateKey}_${dependencyName}`;
      return globalState.variablesData[key] === true;
    });
  };

  // Check dependency graph and determine if this variable should start loading
  const shouldLoadVariable = (variableName: string, dependencies: string[]) => {
    console.log(`Checking if variable should load: ${variableName}`);
    if (!dependencies || dependencies.length === 0) {
      return true; // No dependencies, can load immediately
    }

    // If any dependency is still loading, we should wait
    return !hasLoadingDependencies(variableName, dependencies);
  };

  // Get all loading states
  const getAllLoadingStates = () => {
    console.log("Getting all loading states...");
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
