import store from "@/stores";
import { contextRegistry, createDefaultContextProvider } from "@/composables/contextProviders";
import { generateTraceContext, getUUIDv7 } from "@/utils/zincutils";
import type { ImageAttachment } from "@/ts/interfaces/chat";

let contextHandler: any;

const useAiChat = () => {
  const getContext = async () => {
    if (!contextHandler || typeof contextHandler !== "function") {
      return "";
    }

    const context = await contextHandler();
    return context;
  };

  const registerAiChatHandler = (handler: any) => {
    contextHandler = handler;
  };

  const removeAiChatHandler = () => {
    contextHandler = null;
  };

  /**
   * Get structured context from the context registry
   *
   * Example usage:
   * ```typescript
   * const structuredContext = await getStructuredContext();
   * if (structuredContext) {
   *   console.log('Page:', structuredContext.pageType);
   *   console.log('Data:', structuredContext.data);
   * }
   * ```
   */
  const getStructuredContext = async () => {
    try {
      return await contextRegistry.getActiveContext();
    } catch (error) {
      console.error("Error getting structured context:", error);
      return null;
    }
  };

  /**
   * Fetches AI chat response with streaming support and optional request cancellation
   *
   * @param messages - Array of chat messages to send to the AI
   * @param model - AI model to use (optional, defaults to server-side config)
   * @param org_id - Organization identifier for API routing
   * @param abortSignal - Optional AbortController signal for request cancellation
   * @param explicitContext - Optional explicit context to use (takes precedence over registered context)
   * @param sessionId - Optional UUID v7 session ID for tracking all API calls in a chat session
   * @param images - Optional array of image attachments for multimodal queries
   * @returns Promise<Response> - Fetch response object with streaming capabilities
   *
   * Example usage:
   * ```typescript
   * const abortController = new AbortController();
   * const response = await fetchAiChat(messages, 'gpt-4', 'org123', abortController.signal);
   *
   * // To cancel the request:
   * abortController.abort();
   * ```
   */
  const fetchAiChat = async (
    messages: any[],
    model: string,
    org_id: string,
    abortSignal?: AbortSignal,
    explicitContext?: any,
    sessionId?: string,
    images?: ImageAttachment[],
  ) => {
    let url = `${store.state.API_ENDPOINT}/api/${org_id}/ai/chat_stream`;

    // Try explicit context first, then structured context, then fallback to legacy context
    const contextToUse = explicitContext || (await getStructuredContext());
    const legacyContext = await getContext();

    // Clone the messages array to avoid mutating the original array, as it saves it in the indexDB
    const _messages = JSON.parse(JSON.stringify(messages));

    // Convert images to backend format (mimeType -> mime_type)
    const backendImages = images?.map((img) => ({
      data: img.data,
      mime_type: img.mimeType,
      filename: img.filename,
    }));

    let body = "";
    if (contextToUse) {
      // Strip agent_type from context (for SRE agent routing)
      const contextWithoutAgentType = { ...contextToUse };
      delete contextWithoutAgentType.agent_type;

      // Add user's timezone to context for time display formatting
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Build payload with agent_type at root level if present
      const payload: any = {
        messages: _messages,
        context: {
          ...contextWithoutAgentType,
          user_timezone: userTimezone,
        },
        ...(backendImages?.length && { images: backendImages }),
      };

      body = JSON.stringify(payload);
    } else if (legacyContext && _messages.length > 0) {
      // Fallback to legacy approach - inject context into message content
      const currentMessage = _messages[_messages.length - 1];
      currentMessage.content = getFormattedContext(currentMessage, legacyContext);
      // Add user's timezone to context
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const payload: any = {
        messages: _messages,
        ...(model.length > 0 && { model }),
        context: { user_timezone: userTimezone },
        ...(backendImages?.length && { images: backendImages }),
      };
      body = JSON.stringify(payload);
    } else {
      // No context available - still include timezone
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const payload: any = {
        messages: _messages,
        ...(model.length > 0 && { model }),
        context: { user_timezone: userTimezone },
        ...(backendImages?.length && { images: backendImages }),
      };
      body = JSON.stringify(payload);
    }

    try {
      // Generate traceparent header with UUID v7 for distributed tracing
      const { traceparent } = generateTraceContext();

      // Build headers object
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        traceparent: traceparent,
      };

      // Add session ID header if provided for linking API calls within a chat session
      if (sessionId) {
        headers["x-o2-assistant-session-id"] = sessionId;
        // With server-side chat persistence the server recognizes a repeated
        // turn id instead of running the model twice for one message.
        headers["x-o2-assistant-turn-id"] = getUUIDv7();
      }

      // Configure fetch options with abort signal for request cancellation
      const fetchOptions: RequestInit = {
        method: "POST",
        body: body,
        credentials: "include",
        headers,
        // Add abort signal if provided to enable request cancellation
        ...(abortSignal && { signal: abortSignal }),
      };

      const response = await fetch(url, fetchOptions);
      return response;
    } catch (error) {
      // Handle different types of errors appropriately
      if (error instanceof Error && error.name === "AbortError") {
        // Return a special response to indicate cancellation
        return { cancelled: true, error };
      } else {
        console.error("Error fetching AI chat:", error);
        return null;
      }
    }
  };

  /**
   * Submit user feedback (thumbs up/down) for an AI response
   *
   * @param feedbackType - "thumbs_up" or "thumbs_down"
   * @param org_id - Organization identifier
   * @param sessionId - Session ID for linking feedback to conversation
   * @param queryIndex - Index of the query in the session this feedback is for
   * @param traceId - Trace ID from the workflow to link feedback to the same trace
   */
  const submitFeedback = async (
    feedbackType: "thumbs_up" | "thumbs_down",
    org_id: string,
    sessionId?: string,
    queryIndex?: number,
    traceId?: string,
  ) => {
    const url = `${store.state.API_ENDPOINT}/api/${org_id}/ai/feedback`;

    const body: Record<string, any> = {
      feedback_type: feedbackType,
      query_index: queryIndex ?? -1,
    };

    // Include trace_id so the feedback span is linked to the workflow trace
    if (traceId) {
      body.trace_id = traceId;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (sessionId) {
      headers["x-o2-assistant-session-id"] = sessionId;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(body),
        credentials: "include",
        headers,
      });
      return response.ok;
    } catch (error) {
      console.error("Error submitting feedback:", error);
      return false;
    }
  };

  const getFormattedContext = (message: any, context: any) => {
    // Initialize context section

    let contextSection =
      "Context\n" +
      `${Object.entries(context)
        .map(([key, value]) => `${key}: ${tryToJson(value)}`)
        .join("\n")}`;

    return message.content + "\n\n\n" + contextSection;
  };

  const tryToJson = (value: any) => {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return value;
    }
  };

  /**
   * Initialize default context provider as fallback
   *
   * @param router - Vue router instance
   * @param store - Vuex store instance
   *
   * Example:
   * ```typescript
   * const { initializeDefaultContext } = useAiChat();
   * initializeDefaultContext(router, store);
   * ```
   */
  const initializeDefaultContext = (router: any, storeInstance: any) => {
    const defaultProvider = createDefaultContextProvider(router, storeInstance);
    contextRegistry.register("default", defaultProvider);
  };

  /**
   * Ask the server to stop the turn running in a chat session.
   *
   * With server-side chat persistence the turn is owned by an OpenObserve
   * background task rather than by the browser's request: aborting the fetch
   * closes our view of the stream, but generation continues. This is what
   * actually stops it. Whatever was produced up to that point stays saved.
   *
   * Fire-and-forget by design — the Stop button must not wait on the network.
   */
  const cancelAiChat = async (org_id: string, sessionId: string) => {
    const url = `${store.state.API_ENDPOINT}/api/${org_id}/ai/chats/${sessionId}/cancel`;
    return fetch(url, {
      method: "POST",
      credentials: "include",
      // The tab may be closing right after this; keepalive lets the browser
      // finish sending it anyway.
      keepalive: true,
      headers: {
        "x-o2-assistant-session-id": sessionId,
      },
    });
  };

  // --- Server-side chat history (`/api/{org}/ai/chats`) ---------------------

  const chatsUrl = (org_id: string, sessionId?: string) =>
    `${store.state.API_ENDPOINT}/api/${org_id}/ai/chats` +
    (sessionId ? `/${encodeURIComponent(sessionId)}` : "");

  const chatsRequest = async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, {
      credentials: "include",
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if (!response.ok) {
      const error: Error & { status?: number } = new Error(
        `Chat history request failed (${response.status})`,
      );
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  /** One page of the caller's stored conversations, most recent first. */
  const listServerChats = (org_id: string, limit = 100, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return chatsRequest(`${chatsUrl(org_id)}?${params}`);
  };

  /** A stored conversation; `not_modified` when `knownSeq` is still current. */
  const getServerChat = (org_id: string, sessionId: string, knownSeq?: number) => {
    const query = knownSeq === undefined ? "" : `?known_seq=${knownSeq}`;
    return chatsRequest(`${chatsUrl(org_id, sessionId)}${query}`);
  };

  const renameServerChat = (org_id: string, sessionId: string, title: string) =>
    chatsRequest(chatsUrl(org_id, sessionId), {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });

  const deleteServerChat = (org_id: string, sessionId: string) =>
    chatsRequest(chatsUrl(org_id, sessionId), { method: "DELETE" });

  const deleteAllServerChats = (org_id: string) =>
    chatsRequest(chatsUrl(org_id), { method: "DELETE" });

  /** The server-side persistence backend for `useChatHistory`. */
  const chatHistoryServer = () => ({
    enabled: () =>
      !!store.state.zoConfig?.ai_enabled && !!store.state.zoConfig?.ai_chat_persistence_enabled,
    list: (orgId: string, limit: number) => listServerChats(orgId, limit),
    get: (orgId: string, sessionId: string, knownSeq?: number) =>
      getServerChat(orgId, sessionId, knownSeq),
    rename: renameServerChat,
    remove: deleteServerChat,
    removeAll: deleteAllServerChats,
  });

  return {
    fetchAiChat,
    cancelAiChat,
    chatHistoryServer,
    listServerChats,
    getServerChat,
    renameServerChat,
    deleteServerChat,
    deleteAllServerChats,
    submitFeedback,
    registerAiChatHandler,
    removeAiChatHandler,
    getContext,
    getStructuredContext,
    getFormattedContext,
    tryToJson,
    initializeDefaultContext,
  };
};

export default useAiChat;
