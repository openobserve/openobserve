import { getUUID, getWebSocketUrl } from "@/utils/zincutils";
import useWebSocket from "@/composables/useWebSocket";
import type { SearchRequestPayload } from "@/ts/interfaces";
import { useStore } from "vuex";
import { ref } from "vue";

type MessageHandler = (event: MessageEvent) => void;
type OpenHandler = (event: Event) => void;
type CloseHandler = (event: CloseEvent) => void;
type ErrorHandler = (event: Event) => void;

type WebSocketHandler =
  | MessageHandler
  | CloseHandler
  | ErrorHandler;

type HandlerMap = Record< 'message' | 'close' | 'error', WebSocketHandler[]>;

const webSocket = useWebSocket();

const traces: Record<string, HandlerMap> = {};

const openHandlers: OpenHandler[] = [];

const socketId = ref<string | null>(null);

const isCreatingSocket = ref(false);


const useSearchWebSocket = () => {
  const store = useStore();

  const onOpen = (response: any) => {
    isCreatingSocket.value = false;
    openHandlers.forEach((handler) => handler(response));
    openHandlers.length = 0;
  };

  const onMessage = (response: any) => {
    if(response.type === "end") {
      traces[response.content.trace_id]?.close?.forEach((handler) => handler(response));
      cleanUpListeners(response.content.trace_id)
    }
    traces[response.content.trace_id]?.message?.forEach((handler) => handler(response));
  };

  const onClose = (response: any) => {
    isCreatingSocket.value = false;
    socketId.value = null;
    Object.keys(traces).forEach((traceId) => {
      traces[traceId]?.close.forEach((handler) => handler(response));
      cleanUpListeners(traceId)
    });
  };

  const onError = (response: any) => {
    traces[response.content.trace_id].error.forEach((handler) => handler(response));
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
    webSocket.addCloseHandler(socketId.value, onClose,);

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
      open: (data: any) => void;
      message: (data: any, response: any) => void;
      close: (data: any, response: any) => void;
      error: (data: any, response: any) => void;
    },
  ) => {
    try {
      traces[data.traceId] = {
        message: [],
        close: [],
        error: [],
      };

      traces[data.traceId].message.push(handlers.message.bind(null, data));
      traces[data.traceId].close.push(handlers.close.bind(null, data));
      traces[data.traceId].error.push(handlers.error.bind(null, data)); 

      if(!socketId.value) {
        openHandlers.push(handlers.open.bind(null, data))
        createSocketConnection(data.org_id);
      } else if(isCreatingSocket.value){
        openHandlers.push(handlers.open.bind(null, data))
      } else {
        handlers.open(data);
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
      webSocket.sendMessage(socketId.value, JSON.stringify(data));
    } catch (error: any) {
      console.error(
        `Failed to send WebSocket message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const cancelSearchQueryBasedOnRequestId = (
    trace_id: string,
  ) => {
    const socket = webSocket.getWebSocketBasedOnSocketId(socketId.value);
    // check state of socket
    if (socket && socket.readyState === WebSocket.OPEN) {
      webSocket.sendMessage(
        socketId.value,
        JSON.stringify({
          type: "cancel",
          content: {
            trace_id: trace_id,
          },
        }),
      );
    }
  };

  const closeSocketBasedOnRequestId = (traceId: string) => {
    try {
      cleanUpListeners(traceId)
    } catch (error: any) {
      console.error(`Failed to clean search trace ${traceId}:`, error);
    }
  };


  const cleanUpListeners = (traceId: string) => {
    // Remove all event listeners
    console.log('traces', {...traces[traceId] || {}})
   if(traces[traceId]) traces[traceId].close.length = 0;
   if(traces[traceId]) traces[traceId].error.length = 0;
   if(traces[traceId]) traces[traceId].message.length = 0;

    delete traces[traceId]
  };

  return {
    fetchQueryDataWithWebSocket,
    sendSearchMessageBasedOnRequestId,
    cancelSearchQueryBasedOnRequestId,
    closeSocketBasedOnRequestId,
  };
};

export default useSearchWebSocket;
