import { getUUID, getWebSocketUrl } from "@/utils/zincutils";
import useWebSocket from "@/composables/useWebSocket";
import type { SearchRequestPayload } from "@/ts/interfaces";
import { useStore } from "vuex";
import { ref } from "vue";

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

const isCreatingSocket = ref(false);

const socketRetryCodes = [1001, 1006, 1010, 1011, 1012, 1013];

const maxSearchRetries = 3;

const cancelledAbnormalClose = ref(false);

const useSearchWebSocket = () => {
  const store = useStore();

  const onOpen = (response: any) => {
    isCreatingSocket.value = false;
    Object.keys(traces).forEach((traceId) => {
      console.log("on open", traceId, traces[traceId]?.open?.length);
      traces[traceId].open.forEach((handler: any) => handler(response));
    });
  };

  const onMessage = (response: any) => {
    if (response.type === "end") {
      traces[response.content.trace_id]?.close?.forEach((handler: any) =>
        handler(response),
      );
      cleanUpListeners(response.content.trace_id);
      return;
    }

    traces[response.content.trace_id]?.message?.forEach((handler: any) =>
      handler(response),
    );
  };

  const onClose = (response: any) => {
    isCreatingSocket.value = false;
    socketId.value = null;


    console.log("onClose", response);
    if (socketRetryCodes.includes(response.code)) {
      console.log("socketRetryCodes.includes(response.code)", socketRetryCodes.includes(response.code), Object.keys(traces));
      Object.keys(traces).forEach((traceId) => {
        traces[traceId].retryCount = traces[traceId].retryCount + 1;

        console.log("Retry count ----", traces[traceId].retryCount);

          if (traces[traceId].retryCount <= maxSearchRetries) {
              fetchQueryDataWithWebSocket(traces[traceId].data, {
                open: traces[traceId].open[0],
                message: traces[traceId].message[0],
                close: traces[traceId].close[0],
                error: traces[traceId].error[0],
              }, true);

            return;
          } else {
            traces[traceId]?.close.forEach((handler: any) => handler(response));
            cleanUpListeners(traceId);
          }
      });
    } else {
      Object.keys(traces).forEach((traceId) => {
        traces[traceId]?.close.forEach((handler: any) => handler(response));
        cleanUpListeners(traceId);
      });
    }
  };

  const onError = (response: any) => {
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
    },
    retry: boolean = false
  ) => {
    try {
      console.log("fetchQueryDataWithWebSocket", retry, handlers.close);
      if(!retry) {
        traces[data.traceId] = {
          open: [],
          message: [],
          close: [],
          error: [],
          data: data,
          retryCount: 0,
        };

        traces[data.traceId].message.push(handlers.message.bind(null, data));
        traces[data.traceId].close.push(handlers.close.bind(null, data));
        traces[data.traceId].error.push(handlers.error.bind(null, data));
        traces[data.traceId].open.push(handlers.open.bind(null, data));
      } 

      if(retry) console.log("Retrying ----", data.traceId);

      if (!socketId.value) {
        if(retry) console.log("Creating socket connection ----", data.traceId);
        createSocketConnection(data.org_id);
      } else if (!isCreatingSocket.value) {
        if(retry) console.log("call open handler ----", data.traceId);
        handlers.open(data, null);
      }

      return data.traceId;
    } catch (error: any) {
      console.error(
        `Error in fetching search data: ${error instanceof Error ? error.message : String(error)}`,
      );
      return "";
    }
  };

  const sendSearchMessageBasedOnRequestId = (data: any) => {
    try {
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
    console.log("traces", { ...(traces[traceId] || {}) });
    if (traces[traceId]) traces[traceId].close.length = 0;
    if (traces[traceId]) traces[traceId].error.length = 0;
    if (traces[traceId]) traces[traceId].message.length = 0;

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

  return {
    fetchQueryDataWithWebSocket,
    sendSearchMessageBasedOnRequestId,
    cancelSearchQueryBasedOnRequestId,
    closeSocketBasedOnRequestId,
    cleanUpListeners,
    closeSocketWithError
  };
};

export default useSearchWebSocket;
