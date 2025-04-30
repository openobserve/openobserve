import { ref, Ref } from "vue";
import streamService from "../services/stream";
import { addLabelsToSQlQuery } from "@/utils/query/sqlUtils";
import { buildVariablesDependencyGraph } from "@/utils/dashboard/variables/variablesDependencyUtils";

export const useVariablesManager = (store: any, props: any) => {
  const variablesDependencyGraph = ref({});
  const currentlyExecutingPromises: { [key: string]: Function } = {};

  const isVariableParentLoading = (variableObject: any): boolean => {
    const parentVariables =
      variablesDependencyGraph.value[variableObject.name]?.parentVariables ||
      [];
    return parentVariables.some((parentName: string) => {
      const parentVariable = variableObject.variablesData.values.find(
        (v: any) => v.name === parentName,
      );
      return parentVariable?.isLoading;
    });
  };

  const loadSingleVariableDataByName = async (
    variableObject: any,
  ): Promise<boolean> => {
    const { name } = variableObject;

    // Skip if not visible or not pending loading
    if (!variableObject.isVisible || !variableObject.isVariableLoadingPending) {
      return false;
    }

    // Check if any parent is loading
    if (isVariableParentLoading(variableObject)) {
      return false;
    }

    try {
      // Set loading state
      variableObject.isLoading = true;

      // Perform API call
      const queryContext = await buildQueryContext(variableObject);
      const response = await fetchFieldValues(variableObject, queryContext);

      // Update options
      await updateVariableOptions(variableObject, response.data.hits);

      // Reset loading states
      variableObject.isLoading = false;
      variableObject.isVariableLoadingPending = false;

      // Load immediate children
      await loadImmediateChildren(variableObject);

      return true;
    } catch (error) {
      variableObject.isLoading = false;
      variableObject.isVariableLoadingPending = false;
      return false;
    }
  };

  const loadImmediateChildren = async (variableObject: any) => {
    const childVariables =
      variablesDependencyGraph.value[variableObject.name]?.childVariables || [];
    const childVariableObjects = variableObject.variablesData.values.filter(
      (v: any) => childVariables.includes(v.name),
    );

    for (const childVariable of childVariableObjects) {
      await loadSingleVariableDataByName(childVariable);
    }
  };

  const triggerLoading = (variablesList: any[]) => {
    // Build dependency graph
    variablesDependencyGraph.value =
      buildVariablesDependencyGraph(variablesList);

    // Set visibility based on global, tabs and panels
    setVariablesVisibility(variablesList);

    // Split into independent and dependent variables
    const { independentVariables, dependentVariables } =
      categorizeVariables(variablesList);

    // Load independent variables first
    independentVariables.forEach((variable) => {
      loadSingleVariableDataByName(variable);
    });
  };

  const onValueChange = async (changedVariable: any) => {
    // Set loading pending for dependent variables
    const dependentVariables = getAllDependentVariables(changedVariable.name);
    dependentVariables.forEach((varName) => {
      const variable = changedVariable.variablesData.values.find(
        (v: any) => v.name === varName,
      );
      if (variable) {
        variable.isVariableLoadingPending = true;
      }
    });

    // Load data for all affected variables
    await loadSingleVariableDataByName(changedVariable);
  };

  // Helper functions
  const categorizeVariables = (variables: any[]) => {
    const independentVariables = variables.filter(
      (v) => !variablesDependencyGraph.value[v.name]?.parentVariables?.length,
    );
    const dependentVariables = variables.filter(
      (v) =>
        variablesDependencyGraph.value[v.name]?.parentVariables?.length > 0,
    );
    return { independentVariables, dependentVariables };
  };

  const getAllDependentVariables = (
    variableName: string,
    visited = new Set<string>(),
  ): string[] => {
    if (visited.has(variableName)) return [];
    visited.add(variableName);

    const immediateChildren =
      variablesDependencyGraph.value[variableName]?.childVariables || [];
    const allChildren = [...immediateChildren];

    for (const childName of immediateChildren) {
      const childrenOfChild = getAllDependentVariables(childName, visited);
      allChildren.push(...childrenOfChild);
    }

    return Array.from(new Set(allChildren));
  };

  const setVariablesVisibility = (variables: any[]) => {
    variables.forEach((variable) => {
      // Set isVisible based on scope and visibility rules
      variable.isVisible = determineVariableVisibility(variable);
    });
  };

  const determineVariableVisibility = (variable: any) => {
    // Implement visibility logic based on global, tabs and panels
    // This is a placeholder - implement actual logic based on your requirements
    return true;
  };

  // API call related functions
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
      org_identifier: store.state.selectedOrganization.identifier,
      stream_name: variable.query_data.stream,
      start_time: new Date(
        props.selectedTimeDate?.start_time?.toISOString(),
      ).getTime(),
      end_time: new Date(
        props.selectedTimeDate?.end_time?.toISOString(),
      ).getTime(),
      fields: [variable.query_data.field],
      size: variable.query_data.max_record_size || 10,
      type: variable.query_data.stream_type,
      query_context: queryContext,
      no_count: true,
    };

    const response = await streamService.fieldValues(payload);
    return response;
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

  const findVariableByName = (name: string) => {
    return store.state.variables.find((v: any) => v.name === name);
  };

  return {
    triggerLoading,
    loadSingleVariableDataByName,
    onValueChange,
  };
};
