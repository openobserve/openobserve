import { reactive } from "vue";
import streamService from "@/services/stream";
import {
  buildVariablesDependencyGraph,
  getVariableLoadOrder,
} from "@/utils/dashboard/variables/variablesDependencyUtils";
import type { VariableDependencyGraph } from "@/utils/dashboard/variables/variablesDependencyUtils";

export const useVariablesManager = (props: any) => {
  const state = reactive({
    isLoading: false,
    scopes: {
      global: { values: [] },
      tabs: {},
      panels: {},
    },
  });

  const errors = reactive<Record<string, string>>({});

  const validateVariable = (variable: any) => {
    const variableName = variable.name;
    errors[variableName] = "";

    // Validate required fields
    if (!variable.name) {
      errors[variableName] = "Variable name is required";
      return false;
    }

    // Validate query variables
    if (variable.type === "query_values") {
      if (!variable.query_data?.stream) {
        errors[variableName] = "Stream name is required for query variables";
        return false;
      }
      if (!variable.query_data?.field) {
        errors[variableName] = "Field name is required for query variables";
        return false;
      }
    }

    return true;
  };

  const clearErrors = () => {
    Object.keys(errors).forEach((key) => {
      errors[key] = "";
    });
  };

  const dependencyGraph = reactive<VariableDependencyGraph>({});

  const updateDependencyGraph = () => {
    const allVariables = [
      ...state.scopes.global.values,
      ...Object.values(state.scopes.tabs).flatMap((tab) => tab.values),
      ...Object.values(state.scopes.panels).flatMap((panel) => panel.values),
    ];
    dependencyGraph.value = buildVariablesDependencyGraph(allVariables);
  };

  // Enhance initializeVariablesData
  const initializeVariablesData = (config: any) => {
    if (!config) return;

    clearErrors();

    // Reset state
    state.isLoading = false;
    state.scopes = {
      global: { values: [] },
      tabs: {},
      panels: {},
    };

    // Initialize and validate variables by scope
    config.list?.forEach((variable: any) => {
      if (!validateVariable(variable)) {
        console.warn(`Variable ${variable.name} failed validation`);
        return;
      }

      const variableData = {
        ...variable,
        isLoading: false,
        isVariableLoadingPending: true,
        isVisible: false,
        options: variable.options || [],
        value: null,
        error: null,
      };

      switch (variable.scope) {
        case "global":
          state.scopes.global.values.push(variableData);
          break;
        case "tabs":
          if (!state.scopes.tabs[variable.tabId]) {
            state.scopes.tabs[variable.tabId] = { values: [] };
          }
          state.scopes.tabs[variable.tabId].values.push(variableData);
          break;
        case "panels":
          if (!state.scopes.panels[variable.panelId]) {
            state.scopes.panels[variable.panelId] = { values: [] };
          }
          state.scopes.panels[variable.panelId].values.push(variableData);
          break;
      }
    });

    // Build initial dependency graph
    updateDependencyGraph();
  };

  const loadSingleVariableDataByName = async (name: string) => {
    const variable = findVariableByName(name);
    if (!variable || !variable.isVisible || !variable.isVariableLoadingPending)
      return false;

    // Check parent dependencies
    const parentVariables = findParentVariables(variable);
    if (
      parentVariables.some((v) => v.isLoading || v.isVariableLoadingPending)
    ) {
      return false;
    }

    try {
      variable.isLoading = true;
      const result = await fetchVariableData(variable);
      updateVariableOptions(variable, result);
      variable.isLoading = false;
      variable.isVariableLoadingPending = false;

      // Load immediate child variables
      const childVariables = findChildVariables(variable);
      for (const child of childVariables) {
        if (child.isVisible) {
          await loadSingleVariableDataByName(child.name);
        }
      }

      return true;
    } catch (error) {
      variable.isLoading = false;
      variable.isVariableLoadingPending = false;
      variable.error = error.message || "Failed to load variable data";
      return false;
    }
  };

  const triggerLoading = (variableNames: string[]) => {
    // Get load order based on dependencies
    const loadOrder = getVariableLoadOrder(dependencyGraph);

    // Filter to only requested variables and their dependencies
    const variablesToLoad = loadOrder.filter((name) => {
      const variable = findVariableByName(name);
      if (!variable?.isVisible) return false;

      // Include if directly requested
      if (variableNames.includes(name)) return true;

      // Include if it's a dependency of a requested variable
      const isDependent = variableNames.some((requestedName) => {
        return dependencyGraph[requestedName]?.parentVariables.includes(name);
      });

      return isDependent;
    });

    // Mark variables for loading in dependency order
    variablesToLoad.forEach((name) => {
      const variable = findVariableByName(name);
      if (variable) {
        variable.isVariableLoadingPending = true;
        if (variable.type !== "constant") {
          variable.value = variable.multiSelect ? [] : null;
        }
      }
    });

    // Start loading variables
    variablesToLoad.forEach((name) => {
      loadSingleVariableDataByName(name);
    });
  };

  const onValueChange = async (name: string, newValue: any) => {
    const variable = findVariableByName(name);
    if (!variable) return;

    const oldValue = variable.value;
    variable.value = newValue;

    // If value hasn't changed, no need to update dependencies
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;

    // Get all dependent variables in correct load order
    const loadOrder = getVariableLoadOrder(dependencyGraph);
    const dependentVariables = loadOrder.filter((varName) => {
      // Include if it depends on the changed variable
      return dependencyGraph[varName]?.parentVariables.includes(name);
    });

    // Mark dependent variables for reload
    dependentVariables.forEach((varName) => {
      const v = findVariableByName(varName);
      if (v?.isVisible) {
        v.isVariableLoadingPending = true;
        v.value = v.multiSelect ? [] : null;
      }
    });

    // Load dependent variables in order
    for (const varName of dependentVariables) {
      const v = findVariableByName(varName);
      if (v?.isVisible) {
        await loadSingleVariableDataByName(varName);
      }
    }
  };

  // Update variable visibility handling
  const updateVisibility = (tabId: string, visiblePanelIds: string[]) => {
    // Update visibility flags
    state.scopes.global.values.forEach((v) => (v.isVisible = true));

    Object.entries(state.scopes.tabs).forEach(([id, tab]) => {
      tab.values.forEach((v) => (v.isVisible = id === tabId));
    });

    Object.entries(state.scopes.panels).forEach(([id, panel]) => {
      panel.values.forEach((v) => (v.isVisible = visiblePanelIds.includes(id)));
    });

    // Get all newly visible variables
    const visibleVariables = [
      ...state.scopes.global.values,
      ...(state.scopes.tabs[tabId]?.values || []),
      ...visiblePanelIds.flatMap((id) => state.scopes.panels[id]?.values || []),
    ].filter((v) => v.isVisible);

    // Trigger loading for newly visible variables
    if (visibleVariables.length) {
      triggerLoading(visibleVariables.map((v) => v.name));
    }
  };

  const findVariableByName = (name: string) => {
    // Search in global scope
    let variable = state.scopes.global.values.find((v) => v.name === name);
    if (variable) return variable;

    // Search in tabs scope
    for (const tab of Object.values(state.scopes.tabs)) {
      variable = tab.values.find((v) => v.name === name);
      if (variable) return variable;
    }

    // Search in panels scope
    for (const panel of Object.values(state.scopes.panels)) {
      variable = panel.values.find((v) => v.name === name);
      if (variable) return variable;
    }

    return null;
  };

  const findParentVariables = (variable: any) => {
    // Get parent variables based on query dependencies
    if (variable.query_data?.filter) {
      return variable.query_data.filter
        .map((filter: any) => findVariableByName(filter.name))
        .filter(Boolean);
    }
    return [];
  };

  const findChildVariables = (variable: any) => {
    // Find all variables that depend on this variable
    const allVariables = [
      ...state.scopes.global.values,
      ...Object.values(state.scopes.tabs).flatMap((tab) => tab.values),
      ...Object.values(state.scopes.panels).flatMap((panel) => panel.values),
    ];

    return allVariables.filter((v) => {
      return v.query_data?.filter?.some((f: any) => f.name === variable.name);
    });
  };

  const fetchVariableData = async (variable: any) => {
    if (variable.type !== "query_values") return [];

    const queryContext = await buildQueryContext(variable);
    return await fetchFieldValues(variable, queryContext);
  };

  const buildQueryContext = async (variable: any) => {
    const timestamp_column = "_timestamp";
    let query = `SELECT ${timestamp_column} FROM '${variable.query_data.stream}'`;

    // Apply filters
    if (variable.query_data.filter) {
      for (const filter of variable.query_data.filter) {
        const parentVar = findVariableByName(filter.name);
        if (parentVar?.value) {
          query += ` AND ${filter.name} = '${parentVar.value}'`;
        }
      }
    }

    return query;
  };

  const fetchFieldValues = async (variable: any, queryContext: any) => {
    const payload = {
      org_identifier: props.orgIdentifier,
      stream_name: variable.query_data.stream,
      fields: [variable.query_data.field],
      size: variable.query_data.max_record_size || 1000,
      start_time: props.selectedTimeDate?.start_time,
      end_time: props.selectedTimeDate?.end_time,
      query_context: queryContext,
    };

    const response = await streamService.fieldValues(payload);
    return response.data.hits;
  };

  const updateVariableOptions = (variable: any, hits: any[]) => {
    const fieldHit = hits.find(
      (hit: any) => hit.field === variable.query_data.field,
    );
    if (!fieldHit) return;

    variable.options = fieldHit.values
      .filter((v: any) => v.zo_sql_key || v.zo_sql_key === "")
      .map((v: any) => ({
        label: v.zo_sql_key !== "" ? v.zo_sql_key.toString() : "<blank>",
        value: v.zo_sql_key.toString(),
      }));

    // Set default value if not already set
    if (variable.value === null && variable.options.length > 0) {
      variable.value = variable.multiSelect
        ? [variable.options[0].value]
        : variable.options[0].value;
    }
  };

  return {
    state,
    initializeVariablesData,
    updateVisibility,
    loadSingleVariableDataByName,
    onValueChange,
    findVariableByName,
    triggerLoading,
    errors,
    clearErrors,
    validateVariable,
    dependencyGraph,
  };
};
