import { ref } from "vue";
import useHttpStreaming from "../useStreamingSearch";
import { useStore } from "vuex";
import {
  generateTraceContext,
  isStreamingEnabled,
} from "../../utils/zincutils";
import StreamService from "../../services/stream";

const traceIdMapper = ref<{ [key: string]: string[] }>({});

const useValuesWebSocket = () => {
  const store = useStore();

  // ------------- WebSocket Implementation Deprecated -------------
  // const {
  //   fetchQueryDataWithWebSocket,
  //   sendSearchMessageBasedOnRequestId,
  //   cancelSearchQueryBasedOnRequestId,
  // } = useSearchWebSocket();

  const { fetchQueryDataWithHttpStream } = useHttpStreaming();

  // ------------- WebSocket Utility Functions Deprecated -------------
  // const addTraceId = (field: string, traceId: string) => {
  //   if (!traceIdMapper.value[field]) {
  //     traceIdMapper.value[field] = [];
  //   }
  //   traceIdMapper.value[field].push(traceId);
  // };

  // const removeTraceId = (field: string, traceId: string) => {
  //   if (traceIdMapper.value[field]) {
  //     traceIdMapper.value[field] = traceIdMapper.value[field].filter(
  //       (id) => id !== traceId,
  //     );
  //   }
  // };

  // const cancelTraceId = (field: string) => {
  //   const traceIds = traceIdMapper.value[field];
  //   if (traceIds && traceIds.length > 0) {
  //     traceIds.forEach((traceId) => {
  //       cancelSearchQueryBasedOnRequestId({
  //         trace_id: traceId,
  //         org_id: store?.state?.selectedOrganization?.identifier,
  //       });
  //     });
  //     // Clear the trace IDs after cancellation
  //     traceIdMapper.value[field] = [];
  //   }
  // };

  // ------------- WebSocket Search Message Handler Deprecated -------------
  // const sendSearchMessage = (queryReq: any) => {
  //   const payload = {
  //     type: "values",
  //     content: {
  //       trace_id: queryReq.traceId,
  //       payload: queryReq.queryReq,
  //       stream_type: queryReq.queryReq.stream_type || "logs",
  //       search_type: "ui",
  //       use_cache: (window as any).use_cache ?? true,
  //       org_id: store.state.selectedOrganization.identifier,
  //     },
  //   };

  //   if (
  //     Object.hasOwn(queryReq.queryReq, "regions") &&
  //     Object.hasOwn(queryReq.queryReq, "clusters")
  //   ) {
  //     payload.content.payload["regions"] = queryReq.queryReq.regions;
  //     payload.content.payload["clusters"] = queryReq.queryReq.clusters;
  //   }

  //   sendSearchMessageBasedOnRequestId(payload);
  // };

  // ------------- WebSocket Handler Functions Deprecated -------------
  // const handleSearchClose = (
  //   payload: any,
  //   response: any,
  //   variableObject: any,
  // ) => {
  //   const errorCodes = [1001, 1006, 1010, 1011, 1012, 1013];
  //   if (errorCodes.includes(response.code)) {
  //     handleSearchError(
  //       payload,
  //       {
  //         content: {
  //           message: "WebSocket connection terminated unexpectedly",
  //           trace_id: payload.traceId,
  //           code: response.code,
  //           error_details: response.error_details,
  //         },
  //         type: "error",
  //       },
  //       variableObject,
  //     );
  //   }

  //   removeTraceId(variableObject.name, payload.traceId);
  // };

  // const handleSearchError = (request: any, err: any, variableObject: any) => {
  //   removeTraceId(variableObject.name, request.traceId);
  // };

  // const handleSearchReset = (data: any) => {
  //   cancelTraceId(data.name);
  // };

  const handleSearchResponse = (
    payload: any,
    response: any,
    variableObject: any,
  ) => {
    try {
      if (
        response.content?.results?.hits?.length &&
        (response.type === "search_response" ||
          response.type === "search_response_hits")
      ) {
        const hits = response.content.results.hits;
        const fieldHit = hits.find(
          (field: any) => field.field === variableObject.name,
        );

        if (!fieldHit) {
          return;
        }

        // Process the response
        const newOptions = fieldHit.values
          .map((it: any) => it.zo_sql_key)
          .filter((it: any) => it)
          .map((it: any) => String(it));

        // IMPORTANT: Access the correct dashboardPanelData object
        const dashboardPanelData = variableObject.dashboardPanelData;

        // Initialize filterValue array if it doesn't exist
        if (!dashboardPanelData.meta.filterValue) {
          dashboardPanelData.meta.filterValue = [];
        }

        // Find existing entry for this column
        const existingIndex = dashboardPanelData.meta.filterValue.findIndex(
          (item: any) => item.column === variableObject.name,
        );

        // Get existing values or initialize empty array
        let existingValues = [];
        if (existingIndex >= 0) {
          existingValues =
            dashboardPanelData.meta.filterValue[existingIndex].value || [];
        }

        // Merge existing values with new values, removing duplicates
        const mergedValues = Array.from(
          new Set([...existingValues, ...newOptions]),
        );

        // Update or add the entry
        if (existingIndex >= 0) {
          // Update existing entry
          dashboardPanelData.meta.filterValue[existingIndex].value =
            mergedValues;
        } else {
          // Add new entry
          dashboardPanelData.meta.filterValue.push({
            column: variableObject.name,
            value: mergedValues,
          });
        }
      }
    } catch (error) {}
  };

  const initializeConnection = (payload: any, variableObject: any): any => {
    if (isStreamingEnabled(store.state)) {
      fetchQueryDataWithHttpStream(payload, {
        data: (p: any, r: any) => handleSearchResponse(p, r, variableObject),
        error: (p: any, r: any) => console.error("Error in streaming:", p, r),
        complete: (p: any, r: any) => console.log("Streaming complete:", p, r),
        reset: () => console.log("Streaming reset"),
      });
      return;
    }
  };

  // ------------- End WebSocket Implementation -------------

  const fetchFieldValues = async (
    queryReq: any,
    dashboardPanelData: any,
    name: any,
  ) => {
    // Only use streaming/HTTP2
    const wsPayload = {
      queryReq: {
        stream_name: queryReq.stream_name,
        start_time: queryReq.start_time,
        end_time: queryReq.end_time,
        fields: queryReq.fields,
        size: queryReq.size,
        stream_type: queryReq.type,
        use_cache: (window as any).use_cache ?? true,
        no_count: queryReq.no_count,
        sql: "",
      },
      type: "values",
      isPagination: false,
      traceId: generateTraceContext().traceId,
      org_id: store.state.selectedOrganization.identifier,
      meta: queryReq,
    };

    const res = initializeConnection(wsPayload, {
      name: name,
      dashboardPanelData: dashboardPanelData,
    });

    return res;
  };

  return {
    handleSearchResponse,
    fetchFieldValues,
  };
};

export default useValuesWebSocket;
