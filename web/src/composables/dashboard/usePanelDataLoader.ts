import { ref, watch, reactive, toRefs, onMounted, onUnmounted, nextTick } from "vue";
import queryService from "../../services/search";
import { useStore } from "vuex";

export const usePanelDataLoader = (
  panelSchema: any,
  selectedTimeObj: any,
  variablesData: any,
  chartPanelRef: any
) => {

  const state = reactive({
    data: [],
    loading: false,
    errorDetail: "",
  });

  let currentDependentVariablesData = variablesData.value?.values ? JSON.parse(JSON.stringify(variablesData.value?.values)) : []

  const store = useStore();
  let controller: AbortController | null = null;

  const loadData = async () => {
    console.log("loadDataaaaaaaaaa",isVisible.value,isDirty.value);
    
    isDirty.value = false;
    const controller = new AbortController();
    state.loading = true;

    if (isQueryDependentOnTheVariables() && !canRunQueryBasedOnVariables()) {
      console.log('usePanelDataLoader: query dependent on ', isQueryDependentOnTheVariables(), !canRunQueryBasedOnVariables());
      
      return;
    }

    console.log("queryDataa", panelSchema);

    const queryData = panelSchema.value.queries[0].query;
    const timestamps = selectedTimeObj.value;
    let startISOTimestamp: any;
    let endISOTimestamp: any;
    // console.log("timestamps", timestamps);
    if (
      timestamps?.start_time && timestamps?.end_time &&
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
      // panelSchema.value.queries[0]?.fields.stream_type == "metrics" &&
      // panelSchema.value.customQuery &&
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
          page_type: panelSchema.value.queries[0]?.fields?.stream_type,
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
    ()=>[panelSchema?.value, selectedTimeObj?.value],
    async () => {
      isDirty.value=true;
      
      // TODO: check for query OR queries array for promql
      if (isVisible.value && isDirty.value && panelSchema.value.queries?.length && panelSchema.value.queries[0]?.query) {   
      loadData();
      }
    }
  );

  const isQueryDependentOnTheVariables = () => {
    const dependentVariables = variablesData.value?.values?.filter((it: any) =>
      (panelSchema?.value?.queries?.map((q: any) => q?.query?.includes(`$${it.name}`)))?.includes(true)
    );
    return dependentVariables?.length > 0;
  };

const canRunQueryBasedOnVariables = () => {
  console.log(variablesData.value?.values);

  const dependentVariables = variablesData.value?.values?.filter((it: any) =>
    panelSchema?.value?.queries?.map((q: any) => {
      const includes = q?.query?.includes(`$${it.name}`);
      console.log(`Query: ${includes} Includes: `);
      return includes;
    })?.includes(true)
  );

  console.log(dependentVariables);

  if (dependentVariables?.length > 0) {
    const dependentAvailableVariables = dependentVariables.filter(
      (it: any) => !it.isLoading
    );
console.log('dependentAvailableVariables: ',dependentAvailableVariables);

    if (dependentAvailableVariables.length === dependentVariables.length) {
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
        console.log("error message for usePanelDataLoader", error);
        
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


  let observer: any = null;
  const isDirty: any = ref(true);
  const isVisible: any = ref(false);

 

  watch(()=>isVisible.value, async () => {
    // console.log("loadDataaaaaaaaaa 3",isVisible.value,isDirty.value);
    
      if (isVisible.value && isDirty.value && (panelSchema.value.queries?.length)) {
        loadData();
      }
  })
  
  // remove intersection observer
  onUnmounted(() => {
      if (observer) {
          observer.disconnect();
      }
    });

    // [START] variables management

    // check when the variables data changes
    // 1. get the dependent variables
    // 2. compare the dependent variables data with the old dependent variables Data
    // 3. if the value of any current variable is changed, call the api
    watch(() => variablesData.value?.values, () => {
      console.log('variables changed, 1');
      // ensure the query is there
      if(!panelSchema.value.queries?.length) {
          return;
      }

      // 1. get the dependent variables list
      const newDependentVariablesData = variablesData.value?.values?.filter((it: any) =>
        panelSchema.value.queries?.map((q: any) => q?.query?.includes(`$${it.name}`))?.includes(true)
      );

      // if no variables, no need to rerun the query
      if(!newDependentVariablesData?.length) {
          return;
      }

      // 2. compare with the previously saved variable values, the variables data is an array of objects with name and value
      const isAllValuesSame = newDependentVariablesData.every((it: any) => {
          const oldValue = currentDependentVariablesData.find((it2: any) => it2.name == it.name);
          return it.value == oldValue?.value;
      });

      if(!isAllValuesSame) {
          currentDependentVariablesData = JSON.parse(JSON.stringify(newDependentVariablesData));
          isDirty.value = true;
          if(isVisible.value) {
            console.log("variables changed, 2, loading data");
            loadData();
          }
      }
  }, { deep: true });


  const handleIntersection = async(entries:any) => { 
    // console.log("entries",entries[0]); 
    isVisible.value = entries[0].isIntersecting;
  }
  
onMounted(async () => {       
      observer = new IntersectionObserver(handleIntersection, {
        root: null,
        rootMargin: '0px',
        threshold: 0.1 // Adjust as needed
      });

      observer.observe(chartPanelRef.value);
});


  return {
    ...toRefs(state),
    loadData,
  };
};
