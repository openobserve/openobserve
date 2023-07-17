import { ref, watch, reactive, onMounted} from "vue";
import queryService from "../../src/services/search";
import { useStore } from "vuex";
// import { defineEmits } from "vue";

export const useSearchApi = (  selectedTimeObj: any, props: any, emit: any) => {
  const data =ref([])
  const loading = ref(false);
  let currentDependentVariablesData = props.variablesData?.values || [];
  const store = useStore();
  const errorDetail = ref("");
  const isDirty =ref(true)
  // const emit = defineEmits(['error']);
  console.log("props", props);

  const loadData = async () => {
    console.log("inside loadData");
    
    loading.value = true;
    //single or multiple API call
    //wait for all response
    //merge the dashboard data and set data ref
      // If the current query is dependent and the the data is not available for the variables, then don't run the query
      if (isQueryDependentOnTheVariables() && !canRunQueryBasedOnVariables()) {
        return;
      }
      isDirty.value = false;

      // continue if it is not dependent on the variables or dependent variables' values are available
      let queryData = props.data.query;
      const chartParams = {
        title: "Found " + "2" + " hits in " + "10" + " ms",
      };

      const sqlQueryModified = queryData;

      // get query object
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
      //replace query value

      const query = {
        query: {
          sql: replaceQueryValue(queryData),
          sql_mode: "full",
          start_time: startISOTimestamp,
          end_time: endISOTimestamp,
          size: 0,
        },
      };

      loading.value = true;

      // Check if stream_type is "metrics", customQuery exists, and queryType is "promql"
      if (
        props.data.fields.stream_type == "metrics" &&
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
            data.value = res.data.data;
            // Clear errorDetail
            errorDetail.value = "";
          })
          .catch((error) => {
            // Process API error for "promql"
            processApiError(error, "promql");
          })
          .finally(() => {
            loading.value = false;
          });
      } else {
        console.log("Calling search API");
        // Call search API
        await queryService
          .search({
            org_identifier: store.state.selectedOrganization.identifier,
            query: query,
            page_type: props.data.fields.stream_type,
          })
          .then((res) => {
            // Set searchQueryData.data to the API response hits
            data.value = res.data.hits;
            // Clear errorDetail
            errorDetail.value = "";
          })
          .catch((error) => {
            // Process API error for "sql"
            processApiError(error, "sql");
          })
          .finally(() => {
            loading.value = false;
          });
      }
    
    loading.value = false;
  };
  
  watch(() => [selectedTimeObj], () => {
    loadData()
  });
  
    const isQueryDependentOnTheVariables = () => {
      const dependentVariables = props?.variablesData?.values?.filter(
        (it: any) => props.data.query.includes(`$${it.name}`)
      );
      return dependentVariables?.length > 0;
    };

    const canRunQueryBasedOnVariables = () => {
      const dependentVariables = props?.variablesData?.values?.filter(
        (it: any) => props.data.query.includes(`$${it.name}`)
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
      if (currentDependentVariablesData?.length) {
        currentDependentVariablesData?.forEach((variable: any) => {
          const variableName = `$${variable.name}`;
          const variableValue = variable.value;
          query = query.replace(variableName, variableValue);
        });
        return query;
      } else {
        return query;
      }
    };
    const processApiError = async (error: any, type: string) => {
      switch (type) {
        case "promql": {
          // Get the error detail value from the response data or error message
          const errorDetailValue = error.response?.data?.error || error.message;
          // Trim the error message if it exceeds 300 characters
          const trimmedErrorMessage =
            errorDetailValue.length > 300
              ? errorDetailValue.slice(0, 300) + " ..."
              : errorDetailValue;
          // Set the trimmed error message to the errorDetail value
          errorDetail.value = trimmedErrorMessage;
          // Emit an 'error' event with the trimmed error message
          emit("error", trimmedErrorMessage);
          break;
        }
        case "sql": {
          // Get the error detail value from the response data or error message
          const errorDetailValue =
            error.response?.data.error_detail ?? error.message;
          // Trim the error message if it exceeds 300 characters
          const trimmedErrorMessage =
            errorDetailValue.length > 300
              ? errorDetailValue.slice(0, 300) + " ..."
              : errorDetailValue;
          // Set the trimmed error message to the errorDetail value
          errorDetail.value = trimmedErrorMessage;
          // Emit an 'error' event with the trimmed error message
          emit("error", trimmedErrorMessage);
          break;
        }
        default:
          break;
      }
    };
  return {
    loadData,
    data,
    loading,
    errorDetail,
    isDirty,
    isQueryDependentOnTheVariables,
    canRunQueryBasedOnVariables,
    replaceQueryValue,
    processApiError,
  };
};
