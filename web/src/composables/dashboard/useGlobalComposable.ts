import { reactive, provide, inject } from "vue";

export interface VariablesAndPanelsDataLoadingState {
  variablesData: Record<string, boolean>;
  panels: Record<string, boolean>;
  searchRequestTraceIds: Record<string, string[]>;
}

const GLOBAL_KEY = Symbol("variablesAndPanelsDataLoadingState");

export function useGlobalComposable() {
  const loadingState = reactive<VariablesAndPanelsDataLoadingState>({
    variablesData: {},
    panels: {},
    searchRequestTraceIds: {},
  });

  const provideGlobalState = () => {
    console.log("Providing global state");
    provide(GLOBAL_KEY, loadingState);
    return loadingState;
  };

  const injectGlobalState = () => {
    const state = inject<VariablesAndPanelsDataLoadingState>(GLOBAL_KEY);

    if (!state) {
      console.error("Global loading state was not provided");
      throw new Error("Global loading state was not provided");
    }

    console.log("Injecting global state");
    return state;
  };

  return {
    provideGlobalState,
    injectGlobalState,
  };
}
