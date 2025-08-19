/**
 * useLogsWebSocketHandling.ts
 * 
 * Manages WebSocket connections and real-time data streaming for the logs module.
 * Handles WebSocket search, streaming data, real-time updates, and connection management.
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { useStore } from 'vuex';
import {
  getWebSocketUrl,
  generateTraceContext,
  isWebSocketEnabled,
  isStreamingEnabled,
} from '@/utils/zincutils';
import {
  WebSocketSearchResponse,
  WebSocketSearchPayload,
  WebSocketErrorResponse,
} from '@/ts/interfaces/query';
import type { 
  UseLogsWebSocketHandling,
  SearchObject
} from './INTERFACES_AND_TYPES';

/**
 * WebSocket Handling Composable
 * 
 * Provides comprehensive WebSocket management functionality including:
 * - WebSocket connection management
 * - Real-time search and streaming
 * - Message handling and processing
 * - Connection retry and error handling
 * - Streaming data aggregation
 * - Real-time histogram updates
 */
export default function useLogsWebSocketHandling(
  searchObj: Ref<SearchObject>
): UseLogsWebSocketHandling {
  const store = useStore();

  // ========================================
  // REACTIVE STATE
  // ========================================

  // WebSocket connection
  const webSocket = ref<WebSocket | null>(null);
  const isConnected = ref<boolean>(false);
  const isConnecting = ref<boolean>(false);
  const connectionId = ref<string>('');

  // Streaming state
  const isStreaming = ref<boolean>(false);
  const streamingData = ref<any[]>([]);
  const streamingMetrics = ref<{
    totalHits: number;
    processedMessages: number;
    lastUpdateTime: number;
    streamingStartTime: number;
  }>({
    totalHits: 0,
    processedMessages: 0,
    lastUpdateTime: 0,
    streamingStartTime: 0,
  });

  // Connection management
  const reconnectAttempts = ref<number>(0);
  const maxReconnectAttempts = ref<number>(5);
  const reconnectDelay = ref<number>(1000);
  const heartbeatInterval = ref<NodeJS.Timeout | null>(null);
  const connectionTimeout = ref<NodeJS.Timeout | null>(null);

  // Message tracking
  const messageQueue = ref<any[]>([]);
  const lastMessageId = ref<string>('');
  const duplicateMessages = ref<Set<string>>(new Set());

  // Error handling
  const connectionError = ref<string>('');
  const lastError = ref<any>(null);

  // ========================================
  // COMPUTED PROPERTIES
  // ========================================

  const canUseWebSocket: ComputedRef<boolean> = computed(() => 
    isWebSocketEnabled() && isStreamingEnabled()
  );

  const connectionStatus: ComputedRef<'disconnected' | 'connecting' | 'connected' | 'error'> = computed(() => {
    if (connectionError.value) return 'error';
    if (isConnecting.value) return 'connecting';
    if (isConnected.value) return 'connected';
    return 'disconnected';
  });

  const canReconnect: ComputedRef<boolean> = computed(() => 
    reconnectAttempts.value < maxReconnectAttempts.value
  );

  const streamingRate: ComputedRef<number> = computed(() => {
    const duration = Date.now() - streamingMetrics.value.streamingStartTime;
    if (duration === 0) return 0;
    return streamingMetrics.value.processedMessages / (duration / 1000);
  });

  // ========================================
  // WEBSOCKET CONNECTION MANAGEMENT
  // ========================================

  /**
   * Initializes WebSocket connection for search streaming
   * 
   * @param queryPayload Search query payload
   * @returns Promise resolving to connection status
   */
  const initializeSearchConnection = async (queryPayload: any): Promise<boolean> => {
    try {
      if (!canUseWebSocket.value) {
        throw new Error('WebSocket not supported or disabled');
      }

      // Close existing connection if any
      await closeConnection();

      isConnecting.value = true;
      connectionError.value = '';
      
      // Generate connection ID and trace context
      connectionId.value = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const traceContext = generateTraceContext();

      // Build WebSocket URL
      const wsUrl = getWebSocketUrl();
      if (!wsUrl) {
        throw new Error('WebSocket URL not configured');
      }

      // Create WebSocket connection
      webSocket.value = new WebSocket(wsUrl);
      
      // Set connection timeout
      connectionTimeout.value = setTimeout(() => {
        if (connectionStatus.value === 'connecting') {
          handleConnectionError(new Error('Connection timeout'));
        }
      }, 30000); // 30 second timeout

      // Setup event handlers
      setupWebSocketEventHandlers();

      // Wait for connection to open
      await waitForConnection();

      // Send initial search payload
      const searchPayload: WebSocketSearchPayload = {
        type: 'search',
        data: {
          ...queryPayload,
          trace_id: traceContext.traceId,
          span_id: traceContext.spanId,
          connection_id: connectionId.value,
        },
      };

      sendMessage(searchPayload);

      // Initialize streaming metrics
      streamingMetrics.value = {
        totalHits: 0,
        processedMessages: 0,
        lastUpdateTime: Date.now(),
        streamingStartTime: Date.now(),
      };

      // Start heartbeat
      startHeartbeat();

      return true;

    } catch (error: any) {
      console.error('Failed to initialize WebSocket connection:', error);
      handleConnectionError(error);
      return false;
    } finally {
      isConnecting.value = false;
      if (connectionTimeout.value) {
        clearTimeout(connectionTimeout.value);
        connectionTimeout.value = null;
      }
    }
  };

  /**
   * Sets up WebSocket event handlers
   */
  const setupWebSocketEventHandlers = (): void => {
    if (!webSocket.value) return;

    webSocket.value.onopen = handleConnectionOpen;
    webSocket.value.onmessage = handleMessage;
    webSocket.value.onerror = handleConnectionError;
    webSocket.value.onclose = handleConnectionClose;
  };

  /**
   * Waits for WebSocket connection to open
   */
  const waitForConnection = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!webSocket.value) {
        reject(new Error('WebSocket not initialized'));
        return;
      }

      if (webSocket.value.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      const onOpen = () => {
        clearTimeout(timeout);
        resolve();
      };

      const onError = (error: Event) => {
        clearTimeout(timeout);
        reject(new Error('Connection failed'));
      };

      webSocket.value.addEventListener('open', onOpen, { once: true });
      webSocket.value.addEventListener('error', onError, { once: true });
    });
  };

  // ========================================
  // EVENT HANDLERS
  // ========================================

  /**
   * Handles WebSocket connection open
   */
  const handleConnectionOpen = (event: Event): void => {
    console.log('WebSocket connection opened');
    isConnected.value = true;
    isConnecting.value = false;
    reconnectAttempts.value = 0;
    connectionError.value = '';
  };

  /**
   * Handles incoming WebSocket messages
   */
  const handleMessage = (event: MessageEvent): void => {
    try {
      const message = JSON.parse(event.data);
      
      // Check for duplicate messages
      const messageId = message.id || message.request_id;
      if (messageId && duplicateMessages.value.has(messageId)) {
        console.warn('Duplicate message received:', messageId);
        return;
      }
      if (messageId) {
        duplicateMessages.value.add(messageId);
        lastMessageId.value = messageId;
      }

      // Add to message queue
      messageQueue.value.push(message);

      // Process message based on type
      processWebSocketMessage(message);

      // Update metrics
      streamingMetrics.value.processedMessages++;
      streamingMetrics.value.lastUpdateTime = Date.now();

    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  };

  /**
   * Handles WebSocket connection errors
   */
  const handleConnectionError = (error: any): void => {
    console.error('WebSocket connection error:', error);
    lastError.value = error;
    connectionError.value = error.message || 'WebSocket connection error';
    
    // Attempt reconnection if possible
    if (canReconnect.value) {
      scheduleReconnection();
    }
  };

  /**
   * Handles WebSocket connection close
   */
  const handleConnectionClose = (event: CloseEvent): void => {
    console.log('WebSocket connection closed:', event.code, event.reason);
    isConnected.value = false;
    isStreaming.value = false;
    
    // Stop heartbeat
    stopHeartbeat();
    
    // Clear connection timeout
    if (connectionTimeout.value) {
      clearTimeout(connectionTimeout.value);
      connectionTimeout.value = null;
    }

    // Attempt reconnection if not a clean close and reconnection is allowed
    if (event.code !== 1000 && canReconnect.value) {
      scheduleReconnection();
    }
  };

  // ========================================
  // MESSAGE PROCESSING
  // ========================================

  /**
   * Processes incoming WebSocket messages
   * 
   * @param message Incoming message object
   */
  const processWebSocketMessage = (message: any): void => {
    try {
      switch (message.type) {
        case 'search_response':
          handleSearchResponse(message as WebSocketSearchResponse);
          break;
        case 'streaming_data':
          handleStreamingData(message);
          break;
        case 'histogram_data':
          handleHistogramData(message);
          break;
        case 'page_count':
          handlePageCount(message);
          break;
        case 'metadata':
          handleMetadata(message);
          break;
        case 'error':
          handleErrorResponse(message as WebSocketErrorResponse);
          break;
        case 'close':
          handleSearchClose(message);
          break;
        case 'heartbeat':
          handleHeartbeat(message);
          break;
        default:
          console.warn('Unknown message type received:', message.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  };

  /**
   * Handles search response messages
   */
  const handleSearchResponse = (response: WebSocketSearchResponse): void => {
    if (!response.content?.results) return;

    const results = response.content.results;
    const hits = results.hits || [];
    const total = results.total || 0;

    // Update search results
    if (response.append) {
      searchObj.value.data.queryResults.hits = [
        ...(searchObj.value.data.queryResults.hits || []),
        ...hits
      ];
    } else {
      searchObj.value.data.queryResults.hits = hits;
    }

    searchObj.value.data.queryResults.total = total;
    searchObj.value.data.queryResults.took = results.took || 0;
    searchObj.value.data.queryResults.scan_size = results.scan_size || 0;

    // Update streaming data
    streamingData.value = hits;
    streamingMetrics.value.totalHits = total;

    // Mark as streaming if more data expected
    isStreaming.value = response.streaming || false;
  };

  /**
   * Handles streaming data messages
   */
  const handleStreamingData = (message: any): void => {
    const data = message.data;
    if (!data || !Array.isArray(data)) return;

    // Append streaming data
    streamingData.value = [...streamingData.value, ...data];
    searchObj.value.data.queryResults.hits = [
      ...(searchObj.value.data.queryResults.hits || []),
      ...data
    ];

    // Update metrics
    streamingMetrics.value.totalHits += data.length;
  };

  /**
   * Handles histogram data messages
   */
  const handleHistogramData = (message: any): void => {
    const histogramData = message.histogram;
    if (!histogramData) return;

    // Update histogram in search object
    searchObj.value.data.histogram = {
      xData: histogramData.x_data || [],
      yData: histogramData.y_data || [],
      chartParams: histogramData.chart_params || {},
      errorCode: 0,
      errorMsg: '',
      errorDetail: '',
    };
  };

  /**
   * Handles page count messages
   */
  const handlePageCount = (message: any): void => {
    const pageCount = message.page_count;
    if (typeof pageCount === 'number') {
      searchObj.value.data.queryResults.total = pageCount;
    }
  };

  /**
   * Handles metadata messages
   */
  const handleMetadata = (message: any): void => {
    const metadata = message.metadata;
    if (!metadata) return;

    // Update query metadata
    if (metadata.columns) {
      searchObj.value.data.queryResults.columns = metadata.columns;
    }
    
    if (metadata.time_offset !== undefined) {
      searchObj.value.data.queryResults.time_offset = metadata.time_offset;
    }

    if (metadata.histogram_interval) {
      searchObj.value.meta.resultGrid.chartInterval = metadata.histogram_interval;
    }
  };

  /**
   * Handles error response messages
   */
  const handleErrorResponse = (response: WebSocketErrorResponse): void => {
    const error = response.error;
    
    searchObj.value.data.errorMsg = error.message || 'WebSocket search error';
    searchObj.value.data.errorCode = error.code || 1;
    searchObj.value.data.errorDetail = error.details || '';

    if (error.trace_id) {
      searchObj.value.data.additionalErrorMsg = `TraceID: ${error.trace_id}`;
    }

    // Stop streaming on error
    isStreaming.value = false;
  };

  /**
   * Handles search close messages
   */
  const handleSearchClose = (message: any): void => {
    isStreaming.value = false;
    
    // Finalize results
    if (message.final_results) {
      searchObj.value.data.queryResults = {
        ...searchObj.value.data.queryResults,
        ...message.final_results
      };
    }
  };

  /**
   * Handles heartbeat messages
   */
  const handleHeartbeat = (message: any): void => {
    // Respond with heartbeat ack if required
    if (message.require_ack) {
      sendMessage({ type: 'heartbeat_ack', timestamp: Date.now() });
    }
  };

  // ========================================
  // CONNECTION MANAGEMENT
  // ========================================

  /**
   * Sends a message through the WebSocket
   */
  const sendMessage = (message: any): boolean => {
    if (!webSocket.value || webSocket.value.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected, cannot send message');
      return false;
    }

    try {
      webSocket.value.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending WebSocket message:', error);
      return false;
    }
  };

  /**
   * Sends cancellation message to abort current search
   */
  const sendCancelSearchMessage = (): void => {
    sendMessage({
      type: 'cancel_search',
      connection_id: connectionId.value,
      timestamp: Date.now(),
    });
  };

  /**
   * Starts heartbeat mechanism
   */
  const startHeartbeat = (): void => {
    stopHeartbeat(); // Clear any existing heartbeat
    
    heartbeatInterval.value = setInterval(() => {
      if (isConnected.value) {
        sendMessage({
          type: 'heartbeat',
          connection_id: connectionId.value,
          timestamp: Date.now(),
        });
      }
    }, 30000); // Send heartbeat every 30 seconds
  };

  /**
   * Stops heartbeat mechanism
   */
  const stopHeartbeat = (): void => {
    if (heartbeatInterval.value) {
      clearInterval(heartbeatInterval.value);
      heartbeatInterval.value = null;
    }
  };

  /**
   * Schedules reconnection attempt
   */
  const scheduleReconnection = (): void => {
    if (!canReconnect.value) return;

    const delay = reconnectDelay.value * Math.pow(2, reconnectAttempts.value); // Exponential backoff
    
    console.log(`Scheduling reconnection attempt ${reconnectAttempts.value + 1} in ${delay}ms`);
    
    setTimeout(() => {
      if (!isConnected.value) {
        reconnectAttempts.value++;
        // Note: This would need the original query payload to reconnect
        // In practice, this might be stored or passed differently
        console.log('Attempting to reconnect...');
      }
    }, delay);
  };

  /**
   * Closes WebSocket connection
   */
  const closeConnection = async (): Promise<void> => {
    isStreaming.value = false;
    stopHeartbeat();
    
    if (connectionTimeout.value) {
      clearTimeout(connectionTimeout.value);
      connectionTimeout.value = null;
    }

    if (webSocket.value) {
      try {
        if (webSocket.value.readyState === WebSocket.OPEN) {
          // Send close message before closing
          sendMessage({
            type: 'close',
            connection_id: connectionId.value,
          });
          
          webSocket.value.close(1000, 'Normal closure');
        }
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
      
      webSocket.value = null;
    }

    isConnected.value = false;
    isConnecting.value = false;
  };

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  /**
   * Resets WebSocket state
   */
  const resetWebSocketState = (): void => {
    streamingData.value = [];
    streamingMetrics.value = {
      totalHits: 0,
      processedMessages: 0,
      lastUpdateTime: 0,
      streamingStartTime: 0,
    };
    messageQueue.value = [];
    duplicateMessages.value.clear();
    lastMessageId.value = '';
    connectionError.value = '';
    lastError.value = null;
    reconnectAttempts.value = 0;
  };

  /**
   * Gets WebSocket connection statistics
   */
  const getConnectionStats = (): any => {
    return {
      connectionStatus: connectionStatus.value,
      isStreaming: isStreaming.value,
      totalHits: streamingMetrics.value.totalHits,
      processedMessages: streamingMetrics.value.processedMessages,
      streamingRate: streamingRate.value,
      reconnectAttempts: reconnectAttempts.value,
      connectionId: connectionId.value,
      lastMessageId: lastMessageId.value,
    };
  };

  // ========================================
  // RETURN INTERFACE
  // ========================================

  return {
    // Connection State
    isConnected,
    isConnecting,
    canUseWebSocket,
    connectionStatus,
    connectionId,
    connectionError,

    // Streaming State
    isStreaming,
    streamingData,
    streamingMetrics,
    streamingRate,

    // Connection Management
    initializeSearchConnection,
    closeConnection,
    sendMessage,
    sendCancelSearchMessage,

    // Message Processing
    processWebSocketMessage,
    handleSearchResponse,
    handleStreamingData,
    handleHistogramData,

    // Utility Functions
    resetWebSocketState,
    getConnectionStats,
    canReconnect,

    // Error Handling
    lastError,
    reconnectAttempts,

    // Raw WebSocket
    webSocket,
  };
}