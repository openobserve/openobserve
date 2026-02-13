// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { ChatMessage, ChatHistoryEntry } from '@/types/chat';

const DB_NAME = 'o2ChatDB';
const DB_VERSION = 1;
const STORE_NAME = 'chatHistory';
const MAX_HISTORY_ITEMS = 100;

/**
 * Initialize IndexedDB for chat history storage.
 * Reuses the same DB/store as O2AIChat so all AI interactions
 * (chat + inline query generation) appear in one history panel.
 */
const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('title', 'title', { unique: false });
      }
    };
  });
};

/**
 * Composable for managing AI chat history in IndexedDB.
 * Shared between O2AIChat (full chat) and QueryEditor (inline AI bar).
 */
export function useChatHistory() {
  /**
   * Save a chat session (messages + metadata) to IndexedDB.
   *
   * @param messages - Array of ChatMessage objects (user + assistant)
   * @param sessionId - UUIDv7 session ID for tracking
   * @param title - Chat title (defaults to truncated first user message)
   * @param existingChatId - If updating an existing entry, pass its ID
   * @returns The chat ID of the saved entry
   */
  const saveToHistory = async (
    messages: ChatMessage[],
    sessionId: string,
    title?: string,
    existingChatId?: number | null,
  ): Promise<number | null> => {
    if (messages.length === 0) return null;

    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const dbStore = transaction.objectStore(STORE_NAME);

      // Generate title from first user message if not provided
      const firstUserMessage = messages.find((msg) => msg.role === 'user');
      const resolvedTitle =
        title ||
        (firstUserMessage
          ? firstUserMessage.content.length > 40
            ? firstUserMessage.content.substring(0, 40) + '...'
            : firstUserMessage.content
          : 'New Chat');

      // Strip Vue reactivity from messages
      const serializableMessages = messages.map((msg) => {
        const serialized: any = {
          role: msg.role,
          content: msg.content,
        };
        if (msg.contentBlocks && msg.contentBlocks.length > 0) {
          serialized.contentBlocks = JSON.parse(
            JSON.stringify(msg.contentBlocks),
          );
        }
        return serialized;
      });

      const chatData = {
        timestamp: new Date().toISOString(),
        title: resolvedTitle,
        messages: serializableMessages,
        sessionId,
      };

      const chatId = existingChatId || Date.now();

      return new Promise((resolve, reject) => {
        const request = dbStore.put({ ...chatData, id: chatId });
        request.onsuccess = (event: Event) => {
          const resultId = (event.target as IDBRequest).result as number;
          resolve(resultId);
        };
        request.onerror = () => {
          console.error('Error saving chat history:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('Error saving to chat history:', error);
      return null;
    }
  };

  /**
   * Load all chat history entries, sorted by timestamp descending.
   * Automatically prunes entries beyond MAX_HISTORY_ITEMS.
   *
   * @returns Array of ChatHistoryEntry objects
   */
  const loadHistory = async (): Promise<ChatHistoryEntry[]> => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.index('timestamp').openCursor(null, 'prev');

      const history: ChatHistoryEntry[] = [];

      await new Promise<void>((resolve, reject) => {
        request.onsuccess = (event: Event) => {
          const cursor = (event.target as IDBRequest)
            .result as IDBCursorWithValue;
          if (cursor) {
            history.push(cursor.value);
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });

      // Prune old entries beyond MAX_HISTORY_ITEMS
      if (history.length > MAX_HISTORY_ITEMS) {
        const itemsToDelete = history.slice(MAX_HISTORY_ITEMS);
        const deleteTransaction = db.transaction(STORE_NAME, 'readwrite');
        const deleteStore = deleteTransaction.objectStore(STORE_NAME);

        for (const item of itemsToDelete) {
          deleteStore.delete(item.id);
        }

        await new Promise<void>((resolve, reject) => {
          deleteTransaction.oncomplete = () => resolve();
          deleteTransaction.onerror = () => reject(deleteTransaction.error);
        });
      }

      return history.slice(0, MAX_HISTORY_ITEMS);
    } catch (error) {
      console.error('Error loading chat history:', error);
      return [];
    }
  };

  /**
   * Load a single chat entry by its ID.
   *
   * @param chatId - The ID of the chat to load
   * @returns The chat entry, or null if not found
   */
  const loadChat = async (
    chatId: number,
  ): Promise<ChatHistoryEntry | null> => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.get(chatId);
        request.onsuccess = () => {
          resolve(request.result || null);
        };
        request.onerror = () => {
          console.error('Error loading chat:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('Error loading chat:', error);
      return null;
    }
  };

  /**
   * Delete a single chat entry by its ID.
   *
   * @param chatId - The ID of the chat to delete
   * @returns true if deletion succeeded
   */
  const deleteChatById = async (chatId: number): Promise<boolean> => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.delete(chatId);
        request.onsuccess = () => resolve(true);
        request.onerror = () => {
          console.error('Error deleting chat:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('Error deleting chat:', error);
      return false;
    }
  };

  /**
   * Clear all chat history entries.
   *
   * @returns true if clear succeeded
   */
  const clearAllHistory = async (): Promise<boolean> => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve(true);
        request.onerror = () => {
          console.error('Error clearing history:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('Error clearing history:', error);
      return false;
    }
  };

  /**
   * Update the title of an existing chat entry.
   *
   * @param chatId - The ID of the chat to update
   * @param newTitle - The new title
   * @returns true if update succeeded
   */
  const updateChatTitle = async (
    chatId: number,
    newTitle: string,
  ): Promise<boolean> => {
    try {
      const db = await initDB();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const getRequest = store.get(chatId);
        getRequest.onsuccess = () => {
          const chat = getRequest.result;
          if (chat) {
            chat.title = newTitle;
            const putRequest = store.put(chat);
            putRequest.onsuccess = () => resolve(true);
            putRequest.onerror = () => {
              console.error('Error updating title:', putRequest.error);
              reject(putRequest.error);
            };
          } else {
            resolve(false);
          }
        };
        getRequest.onerror = () => {
          console.error('Error retrieving chat for title update:', getRequest.error);
          reject(getRequest.error);
        };
      });
    } catch (error) {
      console.error('Error updating chat title:', error);
      return false;
    }
  };

  return {
    saveToHistory,
    loadHistory,
    loadChat,
    deleteChatById,
    clearAllHistory,
    updateChatTitle,
  };
}
