import { getUUID, getWebSocketUrl } from "@/utils/zincutils";
import useWebSocket from "@/composables/useWebSocket";
import type { SearchRequestPayload } from "@/ts/interfaces";
import { useStore } from "vuex";
import { ref } from "vue";
import authService from "@/services/auth";

type MessageHandler = (event: MessageEvent) => void;
type OpenHandler = (event: Event) => void;
type CloseHandler = (event: CloseEvent) => void;
type ErrorHandler = (event: Event) => void;

type WebSocketHandler = MessageHandler | CloseHandler | ErrorHandler;

type HandlerMap = Record<"message" | "close" | "error", WebSocketHandler[]>;

const webSocket = useWebSocket();

const traces: Record<string, HandlerMap | any> = {};
// const openHandlers: OpenHandler[] = [];
const socketId = ref<string | null>(null);

const inactiveSocketId = ref<string | null>(null);

const isCreatingSocket = ref(false);

const socketRetryCodes = [1001, 1006, 1010, 1011, 1012, 1013];

const socketFailureCount = ref(0);

const maxSearchRetries = 5;

const isInDrainMode = ref(false);

const useSearchWebSocket = () => {
  const store = useStore();

  const onOpen = (response: any) => {
    isCreatingSocket.value = false;
    Object.keys(traces).forEach((traceId) => {
      console.log("on open", traceId, traces[traceId]?.open?.length);
      if(traces[traceId].isActive) {
        traces[traceId].isInitiated = true;
        traces[traceId].open.forEach((handler: any) => handler(response));
      }
    });
  };

  const onMessage = (response: any) => {
    if (response.type === "end") {
      socketFailureCount.value = 0;
      traces[response.content.trace_id]?.close?.forEach((handler: any) =>
        handler(response),
      );
      cleanUpListeners(response.content.trace_id);
      return;
    }

    // close the inactive socket if there are no any traces with isActive false
    if(Object.keys(traces).every((traceId) => !traces[traceId].isActive) && inactiveSocketId.value) {
      webSocket.closeSocket(inactiveSocketId.value as string);
      inactiveSocketId.value = null;
    }

    traces[response.content.trace_id]?.message?.forEach((handler: any) =>
      handler(response),
    );
  };

  const onClose = (response: any, _socketId: string) => {    
    isCreatingSocket.value = false;
    socketId.value = null;

    const shouldRetry = socketRetryCodes.includes(response.code);
    
    if(shouldRetry) socketFailureCount.value++;

    if(inactiveSocketId.value && _socketId === inactiveSocketId.value) {
      inactiveSocketId.value = null;
    }

    // reset isInDrainMode to false
    if (shouldRetry && socketFailureCount.value < maxSearchRetries) {
      setTimeout(() => {
        Object.keys(traces).forEach((traceId) => {
          if(traces[traceId].isInitiated) {
            response.code = 1000;
            traces[traceId]?.close.forEach((handler: any) => handler(response));
            traces[traceId]?.reset.forEach((handler: any) => handler(traces[traceId].data));
            cleanUpListeners(traceId);        
          }
        });
      }, 1000);
    } else {
      Object.keys(traces).forEach((traceId) => {
        if(traces[traceId].isInitiated) {
          traces[traceId]?.close.forEach((handler: any) => handler(response));
          cleanUpListeners(traceId);
        }
      });
    }
  };

  const onError = (response: any) => {
    if(response.type === 'error'){
      if(response.content.should_client_retry && response.content.trace_id){
        setTimeout(() => {
          retryActiveTrace(response.content.trace_id, response);
        }, 300)

        return;
      }

      if(response.content.code === 401) {
        // Store the current socketId as inactive and clear it
        inactiveSocketId.value = socketId.value;
        socketId.value = null;
        isInDrainMode.value = true;

        const traceIdToRetry = response.content.trace_id;

        if(traceIdToRetry) retryActiveTrace(traceIdToRetry, response);

        // Mark all traces from old socket as inactive
        Object.keys(traces).forEach(traceId => {
          if (traces[traceId].socketId === inactiveSocketId.value) {
            traces[traceId].isActive = false;
          }
        });

        resetAuthToken();

        return;
      }
    }

    traces[response.content.trace_id].error.forEach((handler: any) =>
      handler(response),
    );
    // cleanUpListeners(response.traceId)
  };

  const createSocketConnection = (org_id: string) => {
    isCreatingSocket.value = true;

    socketId.value = getUUID();

    const url = getWebSocketUrl(socketId.value, org_id);
    // If needed we can store the socketID in global state
    webSocket.connect(socketId.value, url);

    webSocket.addOpenHandler(socketId.value, onOpen);

    // When we receive message from BE/server
    webSocket.addMessageHandler(socketId.value, onMessage);

    // On closing of ws, when search is completed Server closes the WS
    webSocket.addCloseHandler(socketId.value, onClose);

    webSocket.addErrorHandler(socketId.value, onError);
  };

  const fetchQueryDataWithWebSocket = (
    data: {
      queryReq: SearchRequestPayload;
      type: "search" | "histogram" | "pageCount";
      isPagination: boolean;
      traceId: string;
      org_id: string;
    },
    handlers: {
      open: (data: any, response: any) => void;
      message: (data: any, response: any) => void;
      close: (data: any, response: any) => void;
      error: (data: any, response: any) => void;
      reset: (data: any, response: any) => void;
    }  
  ) => {
    try {
      traces[data.traceId] = {
        open: [],
        message: [],
        close: [],
        error: [],
        reset: [],
        data: data,
        isActive: true, //  True if the trace id is on current active socket. If false, 
        socketId: socketId.value, // Track which socket this search was initiated on
        isInitiated: false, // True if the search was initiated on the current socket
      };

      traces[data.traceId].message.push(handlers.message.bind(null, data));
      traces[data.traceId].close.push(handlers.close.bind(null, data));
      traces[data.traceId].error.push(handlers.error.bind(null, data));
      traces[data.traceId].open.push(handlers.open.bind(null, data));
      traces[data.traceId].reset.push(handlers.reset.bind(null, data));

      if (isInDrainMode.value) {
        return data.traceId;
      }

      initiateSocketConnection(data, handlers);

      return data.traceId;
    } catch (error: any) {
      console.error(
        `Error in fetching search data: ${error instanceof Error ? error.message : String(error)}`,
      );
      return "";
    }
  };

  const initiateSocketConnection = (data: {
    queryReq: SearchRequestPayload;
    type: "search" | "histogram" | "pageCount";
    isPagination: boolean;
    traceId: string;
    org_id: string;
  }, handlers: {
    open: (data: any, response: any) => void;
    message: (data: any, response: any) => void;
    close: (data: any, response: any) => void;
    error: (data: any, response: any) => void;
    reset: (data: any, response: any) => void;
  }) => {
    if (!socketId.value) {
      createSocketConnection(data.org_id);
    } else if (!isCreatingSocket.value) {
      traces[data.traceId].isInitiated = true;
      handlers.open(data, null);
    }
  }

  const sendSearchMessageBasedOnRequestId = (data: any) => {
    try {
      
      if(!traces[data.traceId].isActive && inactiveSocketId.value) {
        webSocket.sendMessage(inactiveSocketId.value as string, JSON.stringify(data));
        return;
      }

      webSocket.sendMessage(socketId.value as string, JSON.stringify(data));
    } catch (error: any) {
      console.error(
        `Failed to send WebSocket message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const cancelSearchQueryBasedOnRequestId = (payload: {
    trace_id: string;
    org_id: string;
  }) => {
    const socket = webSocket.getWebSocketBasedOnSocketId(
      socketId.value as string,
    );
    // check state of socket
    if (socket && socket.readyState === WebSocket.OPEN) {
      webSocket.sendMessage(
        socketId.value as string,
        JSON.stringify({
          type: "cancel",
          content: payload,
        }),
      );
    }
  };

  const closeSocketBasedOnRequestId = (traceId: string) => {
    try {
      cleanUpListeners(traceId);
    } catch (error: any) {
      console.error(`Failed to clean search trace ${traceId}:`, error);
    }
  };

  const cleanUpListeners = (traceId: string) => {
    // Remove all event listeners
    if (traces[traceId]) traces[traceId].close.length = 0;
    if (traces[traceId]) traces[traceId].error.length = 0;
    if (traces[traceId]) traces[traceId].message.length = 0;
    if (traces[traceId]) traces[traceId].reset.length = 0;
    if (traces[traceId]) traces[traceId].open.length = 0;

    delete traces[traceId];
  };

  const closeSocketWithError = () => {
      webSocket.sendMessage(
        socketId.value as string,
        JSON.stringify({
          type: "test_abnormal_close",
          content: {
            req_id: socketId.value,
          },
        }),
      );
  };

  const closeSocket = () => {
    webSocket.cleanupSocket(socketId.value as string);
  }

  const retryActiveTrace = (traceId: string, response: any) => {
    console.log("retryActiveTrace", traceId, response);
    traces[traceId]?.close.forEach((handler: any) => handler(response));
    traces[traceId]?.reset.forEach((handler: any) => handler(traces[traceId].data));
    cleanUpListeners(traceId);   
  }

  const resetAuthToken = () => {
    authService.refresh_token().then((res: any) => {
      isInDrainMode.value = false;
      console.log("resetAuthToken", res);
      // Retry the request
      console.log("traces", Object.keys(traces));
      Object.keys(traces).forEach((traceId) => {
        console.log("reset request closed by 401", traces[traceId], traces[traceId].isInitiated);
        if(!traces[traceId].isInitiated) {
          initiateSocketConnection(traces[traceId].data, {
            open: traces[traceId].open[0],
            message: traces[traceId].message[0],
            close: traces[traceId].close[0],
            error: traces[traceId].error[0],
            reset: traces[traceId].reset[0],
          });
        }
      });
    }).catch((err: any) => {
      console.error("Error in refreshing auth token", err);
    }).finally(() => {
      isInDrainMode.value = false;
    });
  }

  return {
    fetchQueryDataWithWebSocket,
    sendSearchMessageBasedOnRequestId,
    cancelSearchQueryBasedOnRequestId,
    closeSocketBasedOnRequestId,
    cleanUpListeners,
    closeSocketWithError,
    closeSocket
  };
};

export default useSearchWebSocket;
