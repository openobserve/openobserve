import { ref, watch, reactive } from "vue";
import queryService from "../services/search";
import { useStore } from "vuex";

export const useSearchApi = (
  data: any,
  selectedTimeObj: any,
  props: any,
  emit: any
) => {
  const state = reactive({
    data: [],
    selectedTimeObj,
    loading: false,
    errorDetail: "",
  });

  const currentDependentVariablesData = ref(props.variablesData?.values || []);
  const store = useStore();
  let controller: AbortController | null = null;

  const loadData = async () => {
    console.log("loadData");

    const controller = new AbortController();
    state.loading = true;

    if (isQueryDependentOnTheVariables() && !canRunQueryBasedOnVariables()) {
      return;
    }
    console.log("queryDataa", props.data.query);

    const queryData = props.data.query;
    const timestamps = props.selectedTimeObj;
    let startISOTimestamp: any;
    let endISOTimestamp: any;
    console.log("timestamps", timestamps);
    if (
      timestamps.start_time != "Invalid Date" &&
      timestamps.end_time != "Invalid Date"
    ) {
      startISOTimestamp =
        new Date(timestamps.start_time.toISOString()).getTime() * 1000;
      endISOTimestamp =
        new Date(timestamps.end_time.toISOString()).getTime() * 1000;
    }
    console.log("Query data:", queryData);
    console.log("Timestamps:", timestamps);
    const query = {
      query: {
        sql: replaceQueryValue(queryData),
        sql_mode: "full",
        start_time: startISOTimestamp,
        end_time: endISOTimestamp,
        size: 0,
      },
    };
    console.log("Query:", query);

    state.loading = true;
    console.log("Calling search API");

    if (
      props.data.fields?.stream_type == "metrics" &&
      props.data.customQuery &&
      props.data.queryType == "promql"
    ) {
      console.log("Calling metrics_query_range API");
      await queryService
        .metrics_query_range({
          org_identifier: store.state.selectedOrganization.identifier,
          query: replaceQueryValue(queryData),
          start_time: startISOTimestamp,
          end_time: endISOTimestamp,
        })
        .then((res) => {
          // Set searchQueryData.data to the API response data
          state.data = res.data.data;
          // Clear errorDetail
          state.errorDetail = "";
        })
        .catch((error) => {
          // Process API error for "promql"
          processApiError(error, "promql");
        })
        .finally(() => {
          state.loading = false;
        });
    } else {
      console.log("Calling search APiii");

      // Call search API
      await queryService
        .search({
          org_identifier: store.state.selectedOrganization.identifier,
          query: query,
          page_type: props.data.fields?.stream_type,
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

  watch(
    () => [props.data, state.selectedTimeObj],
    async (
      [newConfigs, newTimerange],
      [oldConfigs, oldTimerange],
      onInvalidate
    ) => {
      loadData();
    }
  );

  const isQueryDependentOnTheVariables = () => {
    const dependentVariables = props?.variablesData?.values?.filter((it: any) =>
      props.data.query.includes(`$${it.name}`)
    );
    return dependentVariables?.length > 0;
  };

  const canRunQueryBasedOnVariables = () => {
    const dependentVariables = props?.variablesData?.values?.filter((it: any) =>
      props.data.query.includes(`$${it.name}`)
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
        query = query.replace(variableName, variableValue);
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
        emit("error", trimmedErrorMessage);
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
        emit("error", trimmedErrorMessage);
        break;
      }
      default:
        break;
    }
  };
  return {
    ...state,
    loadData,
    data: state.data,
  };
};
