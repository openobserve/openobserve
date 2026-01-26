import store from "@/stores";
import { contextRegistry, createDefaultContextProvider } from "@/composables/contextProviders";
import { generateTraceContext } from "@/utils/zincutils";

let contextHandler : any;

const useAiChat = () => {

    const getContext = async () => {

        if(!contextHandler || typeof contextHandler !== 'function' ) {
            return "";
        }

        const context = await contextHandler();
        return context;
    }

    const registerAiChatHandler = (handler: any) => {
        contextHandler = handler;
    }

    const removeAiChatHandler = () => {
        contextHandler = null;
    }

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
            console.error('Error getting structured context:', error);
            return null;
        }
    }

    /**
     * Fetches AI chat response with streaming support and optional request cancellation
     *
     * @param messages - Array of chat messages to send to the AI
     * @param model - AI model to use (optional, defaults to server-side config)
     * @param org_id - Organization identifier for API routing
     * @param abortSignal - Optional AbortController signal for request cancellation
     * @param explicitContext - Optional explicit context to use (takes precedence over registered context)
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
    const fetchAiChat = async (messages: any[], model: string, org_id: string, abortSignal?: AbortSignal, explicitContext?: any) => {
        let url  = `${store.state.API_ENDPOINT}/api/${org_id}/ai/chat_stream`;

        // Try explicit context first, then structured context, then fallback to legacy context
        const contextToUse = explicitContext || await getStructuredContext();
        const legacyContext = await getContext();

        // Clone the messages array to avoid mutating the original array, as it saves it in the indexDB
        const _messages = JSON.parse(JSON.stringify(messages));

        let body = '';
        if (contextToUse) {
            // Extract agent_type from context if present (for SRE agent routing)
            const { agent_type, ...contextWithoutAgentType } = contextToUse;

            // Build payload with agent_type at root level if present
            const payload: any = {
                messages: _messages,
                context: contextWithoutAgentType
            };

            if (agent_type) {
                payload.agent_type = agent_type;
            }

            if (model.length > 0) {
                payload.model = model;
            }

            body = JSON.stringify(payload);
        } else if (legacyContext && _messages.length > 0) {
            // Fallback to legacy approach - inject context into message content
            const currentMessage = _messages[_messages.length - 1];
            currentMessage.content = getFormattedContext(currentMessage, legacyContext);
            body = model.length > 0 
                ? JSON.stringify({ model, messages: _messages }) 
                : JSON.stringify({ messages: _messages });
        } else {
            // No context available
            body = model.length > 0 
                ? JSON.stringify({ model, messages: _messages }) 
                : JSON.stringify({ messages: _messages });
        }

        try {
            // Generate traceparent header with UUID v7 for distributed tracing
            const { traceparent } = generateTraceContext();

            // Configure fetch options with abort signal for request cancellation
            const fetchOptions: RequestInit = {
                method: 'POST',
                body: body,
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'traceparent': traceparent,
                },
                // Add abort signal if provided to enable request cancellation
                ...(abortSignal && { signal: abortSignal })
            };

            const response = await fetch(url, fetchOptions);
        return response;
        } catch (error) {
            // Handle different types of errors appropriately
            if (error instanceof Error && error.name === 'AbortError') {
                // Return a special response to indicate cancellation
                return { cancelled: true, error };
            } else {
                console.error('Error fetching AI chat:', error);
                return null;
            }
        }
    }

    const getFormattedContext = (message: any, context: any) => {
        // Initialize context section

        let contextSection = "Context\n" +  `${Object.entries(context).map(([key, value]) => `${key}: ${tryToJson(value)}`).join("\n")}`;
        
        return message.content + "\n\n\n" + contextSection;
    }

    const tryToJson = (value: any) => {
        try {
            return JSON.stringify(value);
        } catch (error) {
            return value;
        }
    }

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
        contextRegistry.register('default', defaultProvider);
    }

    return {
        fetchAiChat,
        registerAiChatHandler,
        removeAiChatHandler,
        getContext,
        getStructuredContext,
        getFormattedContext,
        tryToJson,
        initializeDefaultContext,
    }
};

export default useAiChat;