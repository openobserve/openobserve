// Copyright 2026 OpenObserve Inc.
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
const DB_VERSION = 2;
const STORE_NAME = 'chatHistory';
const MAX_HISTORY_ITEMS = 100;

/**
 * Initialize IndexedDB for chat history storage.
 * Version 2 adds the userOrgKey index for per-user/org isolation.
 */
const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = (event.target as IDBOpenDBRequest).transaction!;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Fresh install — create store with all indexes
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('title', 'title', { unique: false });
        store.createIndex('userOrgKey', 'userOrgKey', { unique: false });
      } else {
        // Upgrade from v1 — add userOrgKey index to existing store
        const store = transaction.objectStore(STORE_NAME);
        if (!store.indexNames.contains('userOrgKey')) {
          store.createIndex('userOrgKey', 'userOrgKey', { unique: false });
        }
      }
    };
  });
};

/**
 * Compute an opaque SHA-256 hash of "email:orgIdentifier".
 * Falls back to a synchronous djb2 hash in environments without crypto.subtle.
 * The result is cached after first computation.
 */
const computeUserOrgKey = async (
  userEmail: string,
  orgIdentifier: string,
): Promise<string> => {
  const raw = `${userEmail}:${orgIdentifier}`;

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(raw),
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Synchronous djb2 fallback (test environments without crypto.subtle)
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = (((hash << 5) + hash) ^ raw.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
};

/**
 * Composable for managing AI chat history in IndexedDB.
 * Shared between O2AIChat (full chat) and QueryEditor (inline AI bar).
 *
 * All operations are scoped to the current user + organization by an opaque
 * SHA-256 hash stored on each record. Switching users or orgs automatically
 * shows only that context's history.
 *
 * @param getUserEmail - Getter returning the logged-in user's email. Using a
 *   getter (instead of a plain string) ensures the composable always reads the
 *   current value from the Vuex store, so org/user switches are reflected
 *   immediately without re-mounting the component.
 * @param getOrgIdentifier - Getter returning the current org identifier.
 */
export function useChatHistory(
  getUserEmail: () => string,
  getOrgIdentifier: () => string,
) {
  // Cache the last computed hash alongside the raw input that produced it.
  // When the org or user changes the raw string changes, triggering a new hash.
  let _cachedRaw: string | null = null;
  let _cachedKeyPromise: Promise<string> | null = null;

  const getUserOrgKey = (): Promise<string> => {
    const raw = `${getUserEmail()}:${getOrgIdentifier()}`;
    if (raw !== _cachedRaw) {
      _cachedRaw = raw;
      _cachedKeyPromise = computeUserOrgKey(getUserEmail(), getOrgIdentifier());
    }
    return _cachedKeyPromise!;
  };

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
      const [db, userOrgKey] = await Promise.all([initDB(), getUserOrgKey()]);
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
        if (msg.images && msg.images.length > 0) {
          serialized.images = JSON.parse(JSON.stringify(msg.images));
        }
        return serialized;
      });

      const chatData = {
        timestamp: new Date().toISOString(),
        title: resolvedTitle,
        messages: serializableMessages,
        sessionId,
        userOrgKey,
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
   * Load all chat history entries for the current user+org,
   * sorted by timestamp descending.
   * Automatically prunes entries beyond MAX_HISTORY_ITEMS.
   *
   * @returns Array of ChatHistoryEntry objects
   */
  const loadHistory = async (): Promise<ChatHistoryEntry[]> => {
    try {
      const [db, userOrgKey] = await Promise.all([initDB(), getUserOrgKey()]);
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('userOrgKey');

      const history = await new Promise<ChatHistoryEntry[]>(
        (resolve, reject) => {
          const request = index.getAll(IDBKeyRange.only(userOrgKey));
          request.onsuccess = () => {
            const results = (request.result as ChatHistoryEntry[]).sort(
              (a, b) =>
                new Date(b.timestamp).getTime() -
                new Date(a.timestamp).getTime(),
            );
            resolve(results);
          };
          request.onerror = () => reject(request.error);
        },
      );

      // Prune old entries beyond MAX_HISTORY_ITEMS (only for this user+org)
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
   * Returns null if not found or if it belongs to a different user+org.
   *
   * @param chatId - The ID of the chat to load
   * @returns The chat entry, or null if not found / not owned
   */
  const loadChat = async (
    chatId: number,
  ): Promise<ChatHistoryEntry | null> => {
    try {
      const [db, userOrgKey] = await Promise.all([initDB(), getUserOrgKey()]);
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.get(chatId);
        request.onsuccess = () => {
          const record = request.result as ChatHistoryEntry | undefined;
          // Verify ownership — reject records belonging to another user+org
          // Use strict inequality so pre-v2 records (userOrgKey === undefined) are also isolated
          if (!record || record.userOrgKey !== userOrgKey) {
            resolve(null);
            return;
          }
          resolve(record);
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
   * No-ops if the record belongs to a different user+org.
   *
   * @param chatId - The ID of the chat to delete
   * @returns true if deletion succeeded
   */
  const deleteChatById = async (chatId: number): Promise<boolean> => {
    try {
      const [db, userOrgKey] = await Promise.all([initDB(), getUserOrgKey()]);
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const getRequest = store.get(chatId);
        getRequest.onsuccess = () => {
          const record = getRequest.result as ChatHistoryEntry | undefined;
          // Use strict inequality so pre-v2 records (userOrgKey === undefined) are also isolated
          if (!record || record.userOrgKey !== userOrgKey) {
            resolve(false);
            return;
          }
          const deleteRequest = store.delete(chatId);
          deleteRequest.onsuccess = () => resolve(true);
          deleteRequest.onerror = () => {
            console.error('Error deleting chat:', deleteRequest.error);
            reject(deleteRequest.error);
          };
        };
        getRequest.onerror = () => {
          console.error('Error loading chat for deletion:', getRequest.error);
          reject(getRequest.error);
        };
      });
    } catch (error) {
      console.error('Error deleting chat:', error);
      return false;
    }
  };

  /**
   * Clear all chat history entries for the current user+org only.
   * Does not affect other users' or orgs' records.
   *
   * @returns true if clear succeeded
   */
  const clearAllHistory = async (): Promise<boolean> => {
    try {
      const [db, userOrgKey] = await Promise.all([initDB(), getUserOrgKey()]);
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('userOrgKey');

      return new Promise((resolve, reject) => {
        const request = index.openCursor(IDBKeyRange.only(userOrgKey));
        request.onsuccess = (event: Event) => {
          const cursor = (event.target as IDBRequest)
            .result as IDBCursorWithValue;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve(true);
          }
        };
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
   * No-ops if the record belongs to a different user+org.
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
      const [db, userOrgKey] = await Promise.all([initDB(), getUserOrgKey()]);
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const getRequest = store.get(chatId);
        getRequest.onsuccess = () => {
          const chat = getRequest.result as ChatHistoryEntry | undefined;
          // Use strict inequality so pre-v2 records (userOrgKey === undefined) are also isolated
          if (!chat || chat.userOrgKey !== userOrgKey) {
            resolve(false);
            return;
          }
          chat.title = newTitle;
          const putRequest = store.put(chat);
          putRequest.onsuccess = () => resolve(true);
          putRequest.onerror = () => {
            console.error('Error updating title:', putRequest.error);
            reject(putRequest.error);
          };
        };
        getRequest.onerror = () => {
          console.error(
            'Error retrieving chat for title update:',
            getRequest.error,
          );
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
