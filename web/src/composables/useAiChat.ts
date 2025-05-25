import store from "@/stores";
const useAiChat = () => {
    const fetchAiChat = async (messages: any[],model: string,org_id: string) => {
        let url  = `${store.state.API_ENDPOINT}/api/${org_id}/ai/chat_stream`;
        let body = '';
        body = model.length > 0 ? JSON.stringify({ model, messages }) : JSON.stringify({ messages });
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
    return {
        fetchAiChat
    }
};

export default useAiChat;