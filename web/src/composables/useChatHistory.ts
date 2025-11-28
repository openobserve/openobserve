// Composable for managing AI chat history in IndexedDB
// Shared between O2AIChat.vue and SearchBar.vue

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatHistoryEntry {
  id?: number;
  title: string;
  timestamp: string;
  model: string;
  messages: ChatMessage[];
}

// DB constants
const DB_NAME = 'o2ChatDB';
const DB_VERSION = 1;
const STORE_NAME = 'chatHistory';

export const useChatHistory = () => {
  /**
   * Initialize IndexedDB connection
   * Creates database and object store if they don't exist
   */
  const initDB = (): Promise<IDBDatabase> => {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('title', 'title', { unique: false });
          store.createIndex('model', 'model', { unique: false });
        }
      };
    });
  };

  /**
   * Find a chat by model name, or create new one if not found
   * Used for special chats like 'logs-page-ai-assistant'
   */
  const findOrCreateChatByModel = async (
    model: string,
    title: string
  ): Promise<number> => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const dbStore = transaction.objectStore(STORE_NAME);

      // Find existing chat with this model
      const request = dbStore.openCursor();
      return new Promise<number>((resolve) => {
        request.onsuccess = async (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const chat = cursor.value;
            if (chat.model === model) {
              resolve(chat.id);
              return;
            }
            cursor.continue();
          } else {
            // No existing chat found, create new one
            const chatId = await createChat({
              title,
              timestamp: new Date().toISOString(),
              model,
              messages: []
            });
            resolve(chatId);
          }
        };
      });
    } catch (error) {
      console.error('Error finding/creating chat by model:', error);
      throw error;
    }
  };

  /**
   * Create a new chat entry
   */
  const createChat = async (chat: ChatHistoryEntry): Promise<number> => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const dbStore = transaction.objectStore(STORE_NAME);

      const request = dbStore.add(chat);
      return new Promise<number>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as number);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error creating chat:', error);
      throw error;
    }
  };

  /**
   * Get a chat by ID
   */
  const getChat = async (chatId: number): Promise<ChatHistoryEntry | null> => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const dbStore = transaction.objectStore(STORE_NAME);

      const request = dbStore.get(chatId);
      return new Promise<ChatHistoryEntry | null>((resolve) => {
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
    } catch (error) {
      console.error('Error getting chat:', error);
      return null;
    }
  };

  /**
   * Update an existing chat
   */
  const updateChat = async (chat: ChatHistoryEntry): Promise<void> => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const dbStore = transaction.objectStore(STORE_NAME);

      const request = dbStore.put(chat);
      return new Promise<void>((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error updating chat:', error);
      throw error;
    }
  };

  /**
   * Append messages to an existing chat
   */
  const appendMessages = async (
    chatId: number,
    messages: ChatMessage[]
  ): Promise<void> => {
    try {
      const chat = await getChat(chatId);
      if (!chat) {
        throw new Error(`Chat with id ${chatId} not found`);
      }

      chat.messages.push(...messages);
      chat.timestamp = new Date().toISOString();

      await updateChat(chat);
    } catch (error) {
      console.error('Error appending messages:', error);
      throw error;
    }
  };

  /**
   * Delete a chat by ID
   */
  const deleteChat = async (chatId: number): Promise<void> => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const dbStore = transaction.objectStore(STORE_NAME);

      const request = dbStore.delete(chatId);
      return new Promise<void>((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error deleting chat:', error);
      throw error;
    }
  };

  /**
   * Load all chat history, sorted by timestamp (newest first)
   */
  const loadAllChats = async (): Promise<ChatHistoryEntry[]> => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.index('timestamp').openCursor(null, 'prev');

      return new Promise<ChatHistoryEntry[]>((resolve) => {
        const chats: ChatHistoryEntry[] = [];
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            chats.push(cursor.value);
            cursor.continue();
          } else {
            resolve(chats);
          }
        };
        request.onerror = () => resolve([]);
      });
    } catch (error) {
      console.error('Error loading all chats:', error);
      return [];
    }
  };

  /**
   * Clear all chat history
   */
  const clearAllChats = async (): Promise<void> => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const dbStore = transaction.objectStore(STORE_NAME);

      const request = dbStore.clear();
      return new Promise<void>((resolve, reject) => {
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error clearing all chats:', error);
      throw error;
    }
  };

  return {
    // Core DB operations
    initDB,

    // Chat CRUD operations
    createChat,
    getChat,
    updateChat,
    deleteChat,

    // Specialized operations
    findOrCreateChatByModel,
    appendMessages,
    loadAllChats,
    clearAllChats,

    // Constants (for external use if needed)
    DB_NAME,
    DB_VERSION,
    STORE_NAME,
  };
};
