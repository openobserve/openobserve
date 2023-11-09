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

import { ref, watch, reactive, toRefs, onMounted, onUnmounted } from "vue";
import queryService from "../../services/search";
import { useStore } from "vuex";
import { addLabelToPromQlQuery } from "@/utils/query/promQLUtils";
import { addLabelToSQlQuery } from "@/utils/query/sqlUtils";

const formatInterval = (interval: any) => {
  switch (true) {
    // 0.01s
    case interval <= 10:
      return { value: 1, unit: "ms" }; // 0.001s
    // 0.015s
    case interval <= 15:
      return { value: 10, unit: "ms" }; // 0.01s
    // 0.035s
    case interval <= 35:
      return { value: 20, unit: "ms" }; // 0.02s
    // 0.075s
    case interval <= 75:
      return { value: 50, unit: "ms" }; // 0.05s
    // 0.15s
    case interval <= 150:
      return { value: 100, unit: "ms" }; // 0.1s
    // 0.35s
    case interval <= 350:
      return { value: 200, unit: "ms" }; // 0.2s
    // 0.75s
    case interval <= 750:
      return { value: 500, unit: "ms" }; // 0.5s
    // 1.5s
    case interval <= 1500:
      return { value: 1, unit: "s" }; // 1s
    // 3.5s
    case interval <= 3500:
      return { value: 2, unit: "s" }; // 2s
    // 7.5s
    case interval <= 7500:
      return { value: 5, unit: "s" }; // 5s
    // 12.5s
    case interval <= 12500:
      return { value: 10, unit: "s" }; // 10s
    // 17.5s
    case interval <= 17500:
      return { value: 15, unit: "s" }; // 15s
    // 25s
    case interval <= 25000:
      return { value: 20, unit: "s" }; // 20s
    // 45s
    case interval <= 45000:
      return { value: 30, unit: "s" }; // 30s
    // 1.5m
    case interval <= 90000:
      return { value: 1, unit: "m" }; // 1m
    // 3.5m
    case interval <= 210000:
      return { value: 2, unit: "m" }; // 2m
    // 7.5m
    case interval <= 450000:
      return { value: 5, unit: "m" }; // 5m
    // 12.5m
    case interval <= 750000:
      return { value: 10, unit: "m" }; // 10m
    // 17.5m
    case interval <= 1050000:
      return { value: 15, unit: "m" }; // 15m
    // 25m
    case interval <= 1500000:
      return { value: 20, unit: "m" }; // 20m
    // 45m
    case interval <= 2700000:
      return { value: 30, unit: "m" }; // 30m
    // 1.5h
    case interval <= 5400000:
      return { value: 1, unit: "h" }; // 1h
    // 2.5h
    case interval <= 9000000:
      return { value: 2, unit: "h" }; // 2h
    // 4.5h
    case interval <= 16200000:
      return { value: 3, unit: "h" }; // 3h
    // 9h
    case interval <= 32400000:
      return { value: 6, unit: "h" }; // 6h
    // 24h
    case interval <= 86400000:
      return { value: 12, unit: "h" }; // 12h
    // 48h
    case interval <= 172800000:
      return { value: 24, unit: "h" }; // 24h
    // 1w
    case interval <= 604800000:
      return { value: 24, unit: "h" }; // 24h
    // 3w
    case interval <= 1814400000:
      return { value: 1, unit: "w" }; // 1w
    // 2y
    case interval < 3628800000:
      return { value: 30, unit: "d" }; // 30d
    default:
      return { value: 1, unit: "y" }; // 1y
  }
};

const getTimeInSecondsBasedOnUnit = (seconds: any, unit: any) => {
  switch (true) {
    case unit === "ms":
      return seconds / 1000;
    case unit === "s":
      return seconds;
    case unit === "m":
      return seconds * 60;
    case unit === "h":
      return seconds * 60 * 60;
    case unit === "d":
      return seconds * 60 * 60 * 24;
    case unit === "w":
      return seconds * 60 * 60 * 24 * 7;
    case unit === "y":
      return seconds * 60 * 60 * 24 * 7 * 12;
    default:
      return seconds;
  }
};

const formateRateInterval = (interval: any) => {
  let formattedStr = "";
  const days = Math.floor(interval / (3600 * 24));
  if (days > 0) formattedStr += days.toString() + "d";

  const hours = Math.floor((interval % (3600 * 24)) / 3600);
  if (hours > 0) formattedStr += hours.toString() + "h";

  const minutes = Math.floor((interval % 3600) / 60);
  if (minutes > 0) formattedStr += minutes.toString() + "m";

  const remainingSeconds = interval % 60;
  if (remainingSeconds > 0) formattedStr += remainingSeconds.toString() + "s";

  return formattedStr;
};

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
    // state.loading = true;

    // if variable is loading then do not call api simply return
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
      startISOTimestamp = new Date(
        timestamps.start_time.toISOString()
      ).getTime();
      endISOTimestamp = new Date(timestamps.end_time.toISOString()).getTime();
    } else {
      return;
    }

    state.loading = true;

    // Check if the query type is "promql"
    if (panelSchema.value.queryType == "promql") {
      // Iterate through each query in the panel schema
      const queryPromises = panelSchema.value.queries?.map(async (it: any) => {
        console.log("queryPromises", it);
        // Call the metrics_query_range API
        return queryService
          .metrics_query_range({
            org_identifier: store.state.selectedOrganization.identifier,
            query: replaceQueryValue(
              it.query,
              startISOTimestamp,
              endISOTimestamp,
              panelSchema.value.queryType
            ),
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
          console.log("sqlqueryPromise", it);
          return await queryService
            .search({
              org_identifier: store.state.selectedOrganization.identifier,
              query: {
                query: {
                  sql: replaceQueryValue(
                    it.query,
                    startISOTimestamp,
                    endISOTimestamp,
                    panelSchema.value.queryType
                  ),
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
  const replaceQueryValue = (
    query: any,
    startISOTimestamp: any,
    endISOTimestamp: any,
    queryType: any
  ) => {
    console.log(
      "replaceQueryValue",
      query,
      startISOTimestamp,
      endISOTimestamp,
      queryType
    );

    //fixed variables value calculations
    //scrape interval by default 15 seconds
    let scrapeInterval =
      store.state.organizationData.organizationSettings.scrape_interval ?? 15;

    // timestamp in seconds / chart panel width
    let __interval =
      (endISOTimestamp - startISOTimestamp) /
      (chartPanelRef.value?.offsetWidth ?? 1000) /
      1000;

    // if less than 1, set it to 1
    // minimum will be 15000 millisecond
    // __interval = Math.max(15000, __interval);

    // round interval
    const formattedInterval = formatInterval(__interval);

    // calculate rate interval in seconds
    // we need formatted interval value in seconds
    let __rate_interval: any = Math.max(
      getTimeInSecondsBasedOnUnit(
        formattedInterval.value,
        formattedInterval.unit
      ) + scrapeInterval,
      4 * scrapeInterval
    );

    //get interval in ms
    const __interval_ms =
      getTimeInSecondsBasedOnUnit(
        formattedInterval.value,
        formattedInterval.unit
      ) * 1000;

    const fixedVariables = [
      {
        name: "__interval_ms",
        value: `${__interval_ms}ms`,
      },
      {
        name: "__interval",
        value: `${formattedInterval.value}${formattedInterval.unit}`,
      },
      {
        name: "__rate_interval",
        value: `${formateRateInterval(__rate_interval)}`,
      },
    ];

    // replace fixed variables with its values
    fixedVariables?.forEach((variable: any) => {
      const variableName = `$${variable.name}`;
      const variableValue = variable.value;
      query = query.replaceAll(variableName, variableValue);
    });

    if (currentDependentVariablesData?.length) {
      console.log(
        "currentDependentVariablesData",
        currentDependentVariablesData
      );
      currentDependentVariablesData?.forEach((variable: any) => {
        const variableName = `$${variable.name}`;
        const variableValue = variable.value;
        query = query.replaceAll(variableName, variableValue);
      });

      if (queryType === "promql") {
        const adHocVariables = [
          {
            name: "kubernetes_namespace_name",
            value: "ziox-alpha1",
          },
        ];

        adHocVariables.forEach((variable: any) => {
          query = addLabelToPromQlQuery(query, variable.name, variable.value);
        });
        console.log("query", query);
      }

      if (queryType === "sql") {
        console.log("inside sql");

        const adHocSQLVariables = [
          {
            name: "kubernetes_namespace_name",
            value: "ziox-alpha1",
            operator: "=",
          },
        ];

        adHocSQLVariables.forEach((variable: any) => {
          query = addLabelToSQlQuery(
            query,
            variable.name,
            variable.value,
            variable.operator
          );
        });
        console.log("querySQL", query);
      }
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
          error.response?.data.error_detail ||
          error.response?.data.message ||
          error.message;
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
        return it.value == oldValue?.value && oldValue?.value != "";
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
