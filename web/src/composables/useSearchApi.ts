import { ref, watch, reactive } from "vue";
import queryService from "../../src/services/search";
import { useStore } from "vuex";

export const useSearchApi = (selectedTimeObj: any, props: any, emit: any) => {
  const state = reactive({
    data: [],
    loading: false,
    errorDetail: "",
  });

  const currentDependentVariablesData = ref(props.variablesData?.values || []);
  const store = useStore();
  let controller: AbortController | null = null;

  const loadData = async () => {
    if (controller) {
      controller.abort(); 
    }

    controller = new AbortController(); 
    state.loading = true;

    if (isQueryDependentOnTheVariables() && !canRunQueryBasedOnVariables()) {
      return;
    }

    const queryData = props.data.query;
    const timestamps = selectedTimeObj.value;
    let startISOTimestamp: any;
    let endISOTimestamp: any;
    if (
      timestamps.start_time != "Invalid Date" &&
      timestamps.end_time != "Invalid Date"
    ) {
      startISOTimestamp =
        new Date(timestamps.start_time.toISOString()).getTime() * 1000;
      endISOTimestamp =
        new Date(timestamps.end_time.toISOString()).getTime() * 1000;
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

    if (
      props.data.fields.stream_type == "metrics" &&
      props.data.customQuery &&
      props.data.queryType == "promql"
    ) {
      console.log("Calling metrics_query_range API");
      try {
        const res = await queryService.metrics_query_range(
          {
            org_identifier: store.state.selectedOrganization.identifier,
            query: replaceQueryValue(queryData),
            start_time: startISOTimestamp,
            end_time: endISOTimestamp,
          },
          { signal: controller.signal }
        ); 

        state.data = res.data.data;
        state.errorDetail = "";
      } catch (error) {
        processApiError(error, "promql");
      } finally {
        state.loading = false;
      }
    } else {
      console.log("Calling search API");
      try {
        const res = await queryService.search(
          {
            org_identifier: store.state.selectedOrganization.identifier,
            query: query,
            page_type: props.data.fields.stream_type,
          },
          { signal: controller.signal }
        ); // Pass the signal to the API call

        state.data = res.data.hits;
        state.errorDetail = "";
      } catch (error) {
        processApiError(error, "sql");
      } finally {
        state.loading = false;
      }
    }
  };

  watch(
    () => [selectedTimeObj],
    () => {
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
  };
};
