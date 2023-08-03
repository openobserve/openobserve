import { ref, watch, reactive, toRefs, onMounted } from "vue";
import queryService from "../../services/search";
import { useStore } from "vuex";

export const usePanelDataLoader = (
  panelSchema: any,
  selectedTimeObj: any,
  variablesData: any
) => {

  console.log(panelSchema);
  

  const state = reactive({
    data: [],
    loading: false,
    errorDetail: "",
  });

  const currentDependentVariablesData = ref(variablesData.value?.values || []);
  const store = useStore();
  let controller: AbortController | null = null;

  const loadData = async () => {
    console.log("loadData");

    const controller = new AbortController();
    state.loading = true;

    if (isQueryDependentOnTheVariables() && !canRunQueryBasedOnVariables()) {
      return;
    }
    // console.log("queryDataa", panelSchema.value.query);

    const queryData = panelSchema.value.query;
    const timestamps = selectedTimeObj.value;
    let startISOTimestamp: any;
    let endISOTimestamp: any;
    // console.log("timestamps", timestamps);
    if (
      timestamps.start_time != "Invalid Date" &&
      timestamps.end_time != "Invalid Date"
    ) {
      startISOTimestamp =
        new Date(timestamps.start_time.toISOString()).getTime() * 1000;
      endISOTimestamp =
        new Date(timestamps.end_time.toISOString()).getTime() * 1000;
    }
    // console.log("Query data:", queryData);
    // console.log("Timestamps:", timestamps);
    const query = {
      query: {
        sql: replaceQueryValue(queryData),
        sql_mode: "full",
        start_time: startISOTimestamp,
        end_time: endISOTimestamp,
        size: 0,
      },
    };
    // console.log("Query:", query);

    state.loading = true;
    // console.log("Calling search API");

    if (
      panelSchema.value.fields?.stream_type == "metrics" &&
      panelSchema.value.customQuery &&
      panelSchema.value.queryType == "promql"
    ) {
      console.log("usePanelDataLoader: ", JSON.stringify(panelSchema));
      // console.log("Calling metrics_query_range API");
      const queryPromises = panelSchema.value.queries?.map(async (it: any) => {
        console.log("usePanelDataLoader: querypromises map", it.query);

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
            // Clear errorDetail
          })
          .catch((error) => {
            console.log("oops, error", error);

            // Process API error for "promql"
            processApiError(error, "promql");
          });
        // .finally(() => {
        //   state.loading = false;
        // });
      });
      console.log("usePanelDataLoader: querypromises", queryPromises);

      const queryResults = await Promise.all(queryPromises);
      state.loading = false;
      state.data = queryResults;
    } else {
      // console.log("Calling search APiii");

      // Call search API
      await queryService
        .search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: query,
          page_type: panelSchema.value.fields?.stream_type,
        })
        .then((res) => {
          // Set searchQueryData.data to the API response hits
          state.data = res.data.hits;
          // Clear errorDetail
          state.errorDetail = "";
        })
        .catch((error) => {
          // Process API error for "sql"
          processApiError(error, "sql");
        })
        .finally(() => {
          state.loading = false;
        });
    }
  };

  onMounted(() => {
    console.log("usePanelDataLoader mounted");
    if (panelSchema.value.query) {
      loadData();
    }
  });

  watch(
    [panelSchema, selectedTimeObj],
    async (
      [newConfigs, newTimerange],
      [oldConfigs, oldTimerange],
      onInvalidate
    ) => {
      console.log("usePanelDataLoader: schema changed");

      // TODO: check for query OR queries array for promql
      // if (panelSchema.value.query) {
      loadData();
      // }
    }
  );

  const isQueryDependentOnTheVariables = () => {
    const dependentVariables = variablesData.value?.values?.filter((it: any) =>
      panelSchema.value.query.includes(`$${it.name}`)
    );
    return dependentVariables?.length > 0;
  };

  const canRunQueryBasedOnVariables = () => {
    const dependentVariables = variablesData.value?.values?.filter((it: any) =>
      panelSchema.value.query.includes(`$${it.name}`)
    );

    if (dependentVariables?.length > 0) {
      const dependentAvailableVariables = dependentVariables.filter(
        (it: any) => !it.isLoading
      );

      if (dependentAvailableVariables.length == dependentVariables.length) {
        return true;
      } else {
        return false;
      }
    } else {
      return true;
    }
  };

  const replaceQueryValue = (query: any) => {
    if (currentDependentVariablesData.value?.length) {
      currentDependentVariablesData.value?.forEach((variable: any) => {
        const variableName = `$${variable.name}`;
        const variableValue = variable.value;
        query = query.replaceAll(variableName, variableValue);
      });
    }
    return query;
  };

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
          error.response?.data.error_detail ?? error.message;
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
  return {
    ...toRefs(state),
    loadData,
  };
};
