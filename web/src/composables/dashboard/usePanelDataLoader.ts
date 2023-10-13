// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import { ref, watch, reactive, toRefs, onMounted, onUnmounted } from "vue";
import queryService from "../../services/search";
import { useStore } from "vuex";

export const usePanelDataLoader = (
  panelSchema: any,
  selectedTimeObj: any,
  variablesData: any,
  chartPanelRef: any
) => {
  const state = reactive({
    data: [] as any,
    loading: false,
    errorDetail: "",
  });

  // observer for checking if panel is visible on the screen
  let observer: any = null;

  // is query needs to be called or not
  const isDirty: any = ref(true);

  // is panel currently visible or not
  const isVisible: any = ref(false);

  // currently dependent variables data
  let currentDependentVariablesData = variablesData.value?.values
    ? JSON.parse(JSON.stringify(variablesData.value?.values))
    : [];

  const store = useStore();
  let controller: AbortController | null = null;

  const loadData = async () => {

    isDirty.value = false;
    const controller = new AbortController();
    state.loading = true;

    if (isQueryDependentOnTheVariables() && !canRunQueryBasedOnVariables()) {

      return;
    }

    const queryData = panelSchema.value.queries[0].query;
    const timestamps = selectedTimeObj.value;
    let startISOTimestamp: any;
    let endISOTimestamp: any;
    if (
      timestamps?.start_time &&
      timestamps?.end_time &&
      timestamps.start_time != "Invalid Date" &&
      timestamps.end_time != "Invalid Date"
    ) {
      startISOTimestamp =
        new Date(timestamps.start_time.toISOString()).getTime() * 1000;
      endISOTimestamp =
        new Date(timestamps.end_time.toISOString()).getTime() * 1000;
    } else {
      return;
    }
    const query = {
      query: {
        sql: replaceQueryValue(queryData),
        sql_mode: "full",
        start_time: startISOTimestamp,
        end_time: endISOTimestamp,
        size: 0,
      },
    };

    state.loading = true;

    // Check if the query type is "promql"
    if (panelSchema.value.queryType == "promql") {

      // Iterate through each query in the panel schema
      const queryPromises = panelSchema.value.queries?.map(async (it: any) => {

        // Call the metrics_query_range API
        return queryService
          .metrics_query_range({
            org_identifier: store.state.selectedOrganization.identifier,
            query: replaceQueryValue(it.query),
            start_time: startISOTimestamp,
            end_time: endISOTimestamp,
          })
          .then((res) => {
            // Set searchQueryData.data to the API response data
            state.errorDetail = "";
            return res.data.data;
          })
          .catch((error) => {

            // Process API error for "promql"
            processApiError(error, "promql");
          });
      });


      // Wait for all query promises to resolve
      const queryResults = await Promise.all(queryPromises);
      state.loading = false;
      state.data = queryResults;
    } else {
      // Call search API

      // Get the page type from the first query in the panel schema
      const pageType = panelSchema.value.queries[0]?.fields?.stream_type;

      const sqlqueryPromise = panelSchema.value.queries?.map(
        async (it: any) => {
          return await queryService
            .search({
              org_identifier: store.state.selectedOrganization.identifier,
              query: {
                query: {
                  sql: replaceQueryValue(it.query),
                  sql_mode: "full",
                  start_time: startISOTimestamp,
                  end_time: endISOTimestamp,
                  size: 0,
                },
              },
              page_type: pageType,
            })
            .then((res) => {
              // Set searchQueryData.data to the API response hits
              // state.data = res.data.hits;
              state.errorDetail = "";
              return res.data.hits;
            })
            .catch((error) => {
              // Process API error for "sql"
              processApiError(error, "sql");
            });
        }
      );
      // Wait for all query promises to resolve
      const sqlqueryResults = await Promise.all(sqlqueryPromise);
      state.loading = false;
      state.data = sqlqueryResults;
    }
  };

  watch(
    // Watching for changes in panelSchema and selectedTimeObj
    () => [panelSchema?.value, selectedTimeObj?.value],
    async () => {
      isDirty.value = true;

      // TODO: check for query OR queries array for promql
      if (
        isVisible.value && // Checking if the panel is visible
        isDirty.value && // Checking if the data is dirty
        panelSchema.value.queries?.length && // Checking if there are queries
        panelSchema.value.queries[0]?.query // Checking if the first query exists
      ) {
        loadData(); // Loading the data
      }
    }
  );

  /**
   * Checks if the query is dependent on any of the variables.
   *
   * @return {boolean} Returns true if the query is dependent on any variables, false otherwise.
   */
  const isQueryDependentOnTheVariables = () => {
    const dependentVariables = variablesData.value?.values?.filter((it: any) =>
      panelSchema?.value?.queries
        ?.map((q: any) => q?.query?.includes(`$${it.name}`))
        ?.includes(true)
    );
    return dependentVariables?.length > 0;
  };

  /**
   * Checks if the query can be executed based on the available variables.
   *
   * @return {boolean} Whether the query can be executed based on the variables.
   */
  const canRunQueryBasedOnVariables = () => {

    const dependentVariables = variablesData.value?.values?.filter((it: any) =>
      panelSchema?.value?.queries
        ?.map((q: any) => {
          const includes = q?.query?.includes(`$${it.name}`);
          return includes;
        })
        ?.includes(true)
    );

    if (dependentVariables?.length > 0) {
      const dependentAvailableVariables = dependentVariables.filter(
        (it: any) => !it.isLoading
      );

      if (dependentAvailableVariables.length === dependentVariables.length) {
        return true;
      } else {
        return false;
      }
    } else {
      return true;
    }
  };

  /**
   * Replaces the query with the corresponding variable values.
   *
   * @param {any} query - The query to be modified.
   * @return {any} The modified query with replaced values.
   */
  const replaceQueryValue = (query: any) => {
    if (currentDependentVariablesData?.length) {

      currentDependentVariablesData?.forEach((variable: any) => {
        const variableName = `$${variable.name}`;
        const variableValue = variable.value;
        query = query.replaceAll(variableName, variableValue);
      });
      return query;
    } else {
      return query;
    }
  };

  /**
   * Processes an API error based on the given error and type.
   *
   * @param {any} error - The error object to be processed.
   * @param {any} type - The type of error being processed.
   */
  const processApiError = async (error: any, type: any) => {
    switch (type) {
      case "promql": {

        const errorDetailValue = error.response?.data?.error || error.message;
        const trimmedErrorMessage =
          errorDetailValue.length > 300
            ? errorDetailValue.slice(0, 300) + " ..."
            : errorDetailValue;
        state.errorDetail = trimmedErrorMessage;
        break;
      }
      case "sql": {
        const errorDetailValue =
          error.response?.data.error_detail || error.response?.data.message || error.message;
        const trimmedErrorMessage =
          errorDetailValue.length > 300
            ? errorDetailValue.slice(0, 300) + " ..."
            : errorDetailValue;
        state.errorDetail = trimmedErrorMessage;
        break;
      }
      default:
        break;
    }
  };

  const hasAtLeastOneQuery = () =>
    panelSchema.value.queries?.some((q: any) => q?.query);

  watch(
    () => isVisible.value,
    async () => {

      if (
        isVisible.value &&
        isDirty.value &&
        panelSchema.value.queries?.length &&
        hasAtLeastOneQuery()
      ) {
        loadData();
      }
    }
  );

  // [START] variables management

  // check when the variables data changes
  // 1. get the dependent variables
  // 2. compare the dependent variables data with the old dependent variables Data
  // 3. if the value of any current variable is changed, call the api
  watch(
    () => variablesData.value?.values,
    () => {
      // ensure the query is there
      if (!panelSchema.value.queries?.length) {
        return;
      }

      // 1. get the dependent variables list
      const newDependentVariablesData = variablesData.value?.values?.filter(
        (it: any) =>
          panelSchema.value.queries
            ?.map((q: any) => q?.query?.includes(`$${it.name}`))
            ?.includes(true)
      );

      // if no variables, no need to rerun the query
      if (!newDependentVariablesData?.length) {
        return;
      }

      // 2. compare with the previously saved variable values, the variables data is an array of objects with name and value
      const isAllValuesSame = newDependentVariablesData.every((it: any) => {
        const oldValue = currentDependentVariablesData.find(
          (it2: any) => it2.name == it.name
        );
        return it.value == oldValue?.value;
      });

      if (!isAllValuesSame) {
        currentDependentVariablesData = JSON.parse(
          JSON.stringify(newDependentVariablesData)
        );
        isDirty.value = true;
        if (isVisible.value) {
          loadData();
        }
      }
    },
    { deep: true }
  );

  const handleIntersection = async (entries: any) => {
    isVisible.value = entries[0].isIntersecting;
  };

  onMounted(async () => {
    observer = new IntersectionObserver(handleIntersection, {
      root: null,
      rootMargin: "0px",
      threshold: 0.1, // Adjust as needed
    });

    observer.observe(chartPanelRef.value);
  });

  // remove intersection observer
  onUnmounted(() => {
    if (observer) {
      observer.disconnect();
    }
  });

  return {
    ...toRefs(state),
    loadData,
  };
};
