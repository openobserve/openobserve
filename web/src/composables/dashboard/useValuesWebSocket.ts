import { ref } from "vue";
import useSearchWebSocket from "../useSearchWebSocket";
import { useStore } from "vuex";
import {
  generateTraceContext,
  isWebSocketEnabled,
} from "../../utils/zincutils";
import StreamService from "../../services/stream";
import stream from "../../services/stream";

const traceIdMapper = ref<{ [key: string]: string[] }>({});

const useValuesWebSocket = () => {
  const store = useStore();
  const searchResults = ref<any[]>([]);

  // ------------- Start WebSocket Implementation -------------
  const {
    fetchQueryDataWithWebSocket,
    sendSearchMessageBasedOnRequestId,
    cancelSearchQueryBasedOnRequestId,
  } = useSearchWebSocket();

  // Utility functions
  const addTraceId = (field: string, traceId: string) => {
    if (!traceIdMapper.value[field]) {
      traceIdMapper.value[field] = [];
    }
    traceIdMapper.value[field].push(traceId);
  };

  const removeTraceId = (field: string, traceId: string) => {
    if (traceIdMapper.value[field]) {
      traceIdMapper.value[field] = traceIdMapper.value[field].filter(
        (id) => id !== traceId,
      );
    }
  };

  const cancelTraceId = (field: string) => {
    const traceIds = traceIdMapper.value[field];
    if (traceIds && traceIds.length > 0) {
      traceIds.forEach((traceId) => {
        cancelSearchQueryBasedOnRequestId({
          trace_id: traceId,
          org_id: store?.state?.selectedOrganization?.identifier,
        });
      });
      // Clear the trace IDs after cancellation
      traceIdMapper.value[field] = [];
    }
  };

  const sendSearchMessage = (queryReq: any) => {
    const payload = {
      type: "values",
      content: {
        trace_id: queryReq.traceId,
        payload: queryReq.queryReq,
        stream_type: queryReq.queryReq.stream_type || "logs",
        search_type: "ui",
        use_cache: (window as any).use_cache ?? true,
        org_id: store.state.selectedOrganization.identifier,
      },
    };

    if (
      Object.hasOwn(queryReq.queryReq, "regions") &&
      Object.hasOwn(queryReq.queryReq, "clusters")
    ) {
      payload.content.payload["regions"] = queryReq.queryReq.regions;
      payload.content.payload["clusters"] = queryReq.queryReq.clusters;
    }

    sendSearchMessageBasedOnRequestId(payload);
  };

  const handleSearchClose = (
    payload: any,
    response: any,
    variableObject: any,
  ) => {
    const errorCodes = [1001, 1006, 1010, 1011, 1012, 1013];
    if (errorCodes.includes(response.code)) {
      handleSearchError(
        payload,
        {
          content: {
            message: "WebSocket connection terminated unexpectedly",
            trace_id: payload.traceId,
            code: response.code,
            error_details: response.error_details,
          },
          type: "error",
        },
        variableObject,
      );
    }

    removeTraceId(variableObject.name, payload.traceId);
  };

  const handleSearchError = (request: any, err: any, variableObject: any) => {
    removeTraceId(variableObject.name, request.traceId);
  };

  const handleSearchReset = (data: any) => {
    cancelTraceId(data.name);
  };

  const handleSearchResponse = (
    payload: any,
    response: any,
    dashboardPanelData: any,
  ) => {
    try {
      if (
        response.content?.results?.hits?.length &&
        response.type === "search_response"
      ) {
        console.log("Fetching field values: response", response);
        console.log(
          "Fetching field values: dashboardPanelData",
          dashboardPanelData,
        );

        const hits = response.content.results.hits;
        const fieldHit = hits.find(
          (field: any) => field.field === dashboardPanelData.name,
        );
        console.log("Fetching field values: fieldHit", fieldHit);

        if (!fieldHit) {
          return;
        }

        // Process the response
        const newOptions = fieldHit.values
          .map((it: any) => it.zo_sql_key)
          .filter((it: any) => it);

        console.log("Fetching field values: newOptions", newOptions);

        // Create a deep clone of the dashboard panel data
        const dashboardPanelDataClone = JSON.parse(
          JSON.stringify(dashboardPanelData),
        );

        // Initialize filterValue array if it doesn't exist
        if (!dashboardPanelDataClone.dashboardPanelData.meta.filterValue) {
          dashboardPanelDataClone.dashboardPanelData.meta.filterValue = [];
        }

        // Create a Set of existing values for efficient duplicate checking
        const existingValues = new Set(
          dashboardPanelDataClone.dashboardPanelData.meta.filterValue.map(
            (item: any) => item.value || item,
          ),
        );

        console.log("Fetching field values: existingValues", existingValues);

        // Add only new unique values
        newOptions.forEach((option: any) => {
          if (!existingValues.has(option)) {
            dashboardPanelDataClone.dashboardPanelData.meta.filterValue.push(
              option,
            );
            existingValues.add(option);
          }
        });

        console.log(
          "Fetching field values: Updated filterValue:",
          dashboardPanelDataClone.dashboardPanelData.meta.filterValue,
        );
      }
    } catch (error) {
      console.error(
        `[WebSocket] Error processing response for ${dashboardPanelData.name}:`,
        error,
      );
    }
  };

  const initializeWebSocketConnection = (
    payload: any,
    variableObject: any,
  ): string => {
    return fetchQueryDataWithWebSocket(payload, {
      open: sendSearchMessage,
      close: (p: any, r: any) => handleSearchClose(p, r, variableObject),
      error: (p: any, r: any) => handleSearchError(p, r, variableObject),
      message: (p: any, r: any) => handleSearchResponse(p, r, variableObject),
      reset: handleSearchReset,
    }) as string;
  };

  // ------------- End WebSocket Implementation -------------

  const fetchFieldValues = async (
    queryReq: any,
    dashboardPanelData: any,
    name: any,
  ) => {
    console.log("Fetching field values:", queryReq);

    if (isWebSocketEnabled()) {
      // Use WebSocket
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
      };

      const res = initializeWebSocketConnection(wsPayload, {
        name: name,
        dashboardPanelData: dashboardPanelData,
      });
      console.log("Fetching field values: res websocket", res);

      return res;
    } else {
      // Use REST API
      try {
        const response = await StreamService.fieldValues({
          org_identifier: store.state.selectedOrganization.identifier,
          stream_name: queryReq.stream_name,
          start_time: queryReq.start_time,
          end_time: queryReq.end_time,
          fields: queryReq.fields,
          size: queryReq.size,
          type: queryReq.stream_type,
          no_count: queryReq.no_count,
        });
        return dashboardPanelData.meta.filterValue.push({
          column: name,
          value: response?.data?.hits?.[0]?.values
            .map((it: any) => it.zo_sql_key)
            .filter((it: any) => it),
        });
      } catch (error) {
        console.error("Error fetching field values:", error);
        throw error;
      }
    }
  };

  return {
    handleSearchClose,
    handleSearchError,
    handleSearchReset,
    handleSearchResponse,
    initializeWebSocketConnection,
    isWebSocketEnabled,
    addTraceId,
    removeTraceId,
    fetchFieldValues,
  };
};

export default useValuesWebSocket;
