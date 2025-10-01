import store from "@/stores";
import { contextRegistry, createDefaultContextProvider } from "@/composables/contextProviders";

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

    const fetchAiChat = async (messages: any[],model: string,org_id: string) => {
        let url  = `${store.state.API_ENDPOINT}/api/${org_id}/ai/chat_stream`;
        
        // Try structured context first, fallback to legacy context
        const structuredContext = await getStructuredContext();
        const legacyContext = await getContext();

        // Clone the messages array to avoid mutating the original array, as it saves it in the indexDB
        const _messages = JSON.parse(JSON.stringify(messages));

        let body = '';
        if (structuredContext) {
            // Send structured context as separate field
            body = model.length > 0 
                ? JSON.stringify({ model, messages: _messages, context: structuredContext }) 
                : JSON.stringify({ messages: _messages, context: structuredContext });
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
            const response = await fetch(url, {
                method: 'POST',
                body: body,
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        return response;
        } catch (error) {
            console.error('Error fetching AI chat:', error);
            return null;
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