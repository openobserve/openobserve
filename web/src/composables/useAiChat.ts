import store from "@/stores";

let contextHandler : any;

const useAiChat = () => {

    const getContext = async () => {
        const context = await contextHandler();
        return context;
    }

    const registerAiChatHandler = (handler: any) => {
        contextHandler = handler;
    }

    const removeAiChatHandler = () => {
        contextHandler = null;
    }

    const fetchAiChat = async (messages: any[],model: string,org_id: string) => {
        let url  = `${store.state.API_ENDPOINT}/api/${org_id}/ai/chat_stream`;
        const context = await getContext();

        const _messages = JSON.parse(JSON.stringify(messages));

        const currentMessage = _messages[_messages.length - 1];

        currentMessage.content = getFormattedContext(currentMessage, context);

        let body = '';
        body = model.length > 0 ? JSON.stringify({ model, messages: _messages }) : JSON.stringify({ messages: _messages });

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

//     # 1. Context
// - Project: Building a log monitoring dashboard.
// - Tech stack: Vue 3 + Tailwind CSS.
// - Goal: Implement a dynamic table with filterable columns.
// - Constraints: Data comes from a large dataset (100K+ records), so performance matters.
// - Current status: Using `@datatables.net-vue3`, but filters are lagging.
// # 2. Request
// - Can you help optimize filtering performance or suggest an alternative approach?

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


    return {
        fetchAiChat,
        registerAiChatHandler,
        removeAiChatHandler,
    }
};

export default useAiChat;