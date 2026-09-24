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

import { messagesFromTurns, type StoredTurn } from "@/components/O2AIChat.history";
import type { ChatMessage, ChatHistoryEntry } from "@/ts/interfaces/chat";
import { raw, type TranslateFn } from "@/types/i18n";
import { computeUserOrgKey } from "@/utils/userOrgKey";

const DB_NAME = "o2ChatDB";
const DB_VERSION = 2;
const STORE_NAME = "chatHistory";
const MAX_HISTORY_ITEMS = 100;

// Opening a connection per call leaked one IDBDatabase per operation, so the
// single connection is memoised and reused for the page's lifetime.
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Initialize IndexedDB for chat history storage.
 * Version 2 adds the userOrgKey index for per-user/org isolation.
 */
const initDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      // A version change elsewhere closes this handle; drop it so the next call reopens.
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = (event.target as IDBOpenDBRequest).transaction!;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Fresh install — create store with all indexes
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("title", "title", { unique: false });
        store.createIndex("userOrgKey", "userOrgKey", { unique: false });
      } else {
        // Upgrade from v1 — add userOrgKey index to existing store
        const store = transaction.objectStore(STORE_NAME);
        if (!store.indexNames.contains("userOrgKey")) {
          store.createIndex("userOrgKey", "userOrgKey", { unique: false });
        }
      }
    };
  });

  // A failed open must not be cached, otherwise every later call rejects.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
};

/** A chat in the server's list (`GET /api/{org}/ai/chats`). */
export interface ServerChatSummary {
  session_id: string;
  title: string;
  created_at: number; // microseconds
  updated_at: number; // microseconds
  last_committed_seq: number;
}

/** A stored chat (`GET /api/{org}/ai/chats/{session_id}`). */
export interface ServerChatDetail extends ServerChatSummary {
  not_modified: boolean;
  turns?: StoredTurn[];
}

/**
 * Server-side chat persistence. When `enabled()`, the server holds the
 * canonical history and IndexedDB is a cache of it (see `useChatHistory`).
 * Errors carry the HTTP `status` when there was one.
 */
export interface ChatHistoryServer {
  enabled: () => boolean;
  list: (orgId: string, limit: number) => Promise<{ chats: ServerChatSummary[]; next_cursor?: string }>;
  get: (orgId: string, sessionId: string, knownSeq?: number) => Promise<ServerChatDetail>;
  rename: (orgId: string, sessionId: string, title: string) => Promise<unknown>;
  remove: (orgId: string, sessionId: string) => Promise<unknown>;
  removeAll: (orgId: string) => Promise<unknown>;
}

// Entry id → session id of server chats listed but not cached locally. Module
// scope: the list (HomeChatHistory) and the chat that opens an entry
// (O2AIChat) are separate instances that share only the numeric id.
const listedSessions = new Map<number, string>();

/** Chat entry ids are creation times in ms; a UUIDv7 session id carries one. */
const idFromSessionId = (sessionId: string): number =>
  parseInt(sessionId.replace(/-/g, "").slice(0, 12), 16);

const statusOf = (error: unknown): number | undefined =>
  (error as { status?: number } | null)?.status;

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
 * @param t - Translator from the calling component's `useI18nTyped()`.
 * @param server - Server-side persistence. When enabled, lists, loads,
 *   renames and deletes go to the server, and IndexedDB only caches what it
 *   returned (plus chats that predate persistence, which stay browser-only).
 */
export function useChatHistory(
  getUserEmail: () => string,
  getOrgIdentifier: () => string,
  t: TranslateFn,
  server?: ChatHistoryServer,
) {
  const serverOn = () => server?.enabled() ?? false;
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
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const dbStore = transaction.objectStore(STORE_NAME);

      // Generate title from first user message if not provided
      const firstUserMessage = messages.find((msg) => msg.role === "user");
      const resolvedTitle =
        title ||
        (firstUserMessage
          ? firstUserMessage.content.length > 40
            ? firstUserMessage.content.substring(0, 40) + "..."
            : firstUserMessage.content
          : t("common.newChat"));

      // Strip Vue reactivity from messages
      const serializableMessages = messages.map((msg) => {
        const serialized: any = {
          role: msg.role,
          content: msg.content,
        };
        if (msg.contentBlocks && msg.contentBlocks.length > 0) {
          serialized.contentBlocks = JSON.parse(JSON.stringify(msg.contentBlocks));
        }
        if (msg.images && msg.images.length > 0) {
          serialized.images = JSON.parse(JSON.stringify(msg.images));
        }
        if (msg.feedback) {
          serialized.feedback = msg.feedback;
        }
        return serialized;
      });

      const chatData = {
        timestamp: new Date().toISOString(),
        title: resolvedTitle,
        messages: serializableMessages,
        sessionId,
        userOrgKey,
        // A live save may be ahead of (or differ from) what the server
        // committed, so the next open revalidates (no cachedLastSeq).
        ...(serverOn() && { serverBacked: true }),
      };

      const chatId = existingChatId || Date.now();

      return new Promise((resolve, reject) => {
        const request = dbStore.put({ ...chatData, id: chatId });
        request.onsuccess = (event: Event) => {
          const resultId = (event.target as IDBRequest).result as number;
          resolve(resultId);
        };
        request.onerror = () => {
          console.error("Error saving chat history:", request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("Error saving to chat history:", error);
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
  const loadLocalHistory = async (): Promise<ChatHistoryEntry[]> => {
    try {
      const [db, userOrgKey] = await Promise.all([initDB(), getUserOrgKey()]);
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("userOrgKey");

      const history = await new Promise<ChatHistoryEntry[]>((resolve, reject) => {
        const request = index.getAll(IDBKeyRange.only(userOrgKey));
        request.onsuccess = () => {
          const results = (request.result as ChatHistoryEntry[]).sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          );
          resolve(results);
        };
        request.onerror = () => reject(request.error);
      });

      // Prune old entries beyond MAX_HISTORY_ITEMS (only for this user+org)
      if (history.length > MAX_HISTORY_ITEMS) {
        const itemsToDelete = history.slice(MAX_HISTORY_ITEMS);
        const deleteTransaction = db.transaction(STORE_NAME, "readwrite");
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
      console.error("Error loading chat history:", error);
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
  const loadLocalChat = async (chatId: number): Promise<ChatHistoryEntry | null> => {
    try {
      const [db, userOrgKey] = await Promise.all([initDB(), getUserOrgKey()]);
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const request = store.get(chatId);
        request.onsuccess = () => {
          const record = request.result as ChatHistoryEntry | undefined;
          // Verify ownership — reject records belonging to another user+org
          if (!record || (record.userOrgKey && record.userOrgKey !== userOrgKey)) {
            resolve(null);
            return;
          }
          resolve(record);
        };
        request.onerror = () => {
          console.error("Error loading chat:", request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("Error loading chat:", error);
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
  const deleteLocalChat = async (chatId: number): Promise<boolean> => {
    try {
      const [db, userOrgKey] = await Promise.all([initDB(), getUserOrgKey()]);
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const getRequest = store.get(chatId);
        getRequest.onsuccess = () => {
          const record = getRequest.result as ChatHistoryEntry | undefined;
          if (!record || (record.userOrgKey && record.userOrgKey !== userOrgKey)) {
            resolve(false);
            return;
          }
          const deleteRequest = store.delete(chatId);
          deleteRequest.onsuccess = () => resolve(true);
          deleteRequest.onerror = () => {
            console.error("Error deleting chat:", deleteRequest.error);
            reject(deleteRequest.error);
          };
        };
        getRequest.onerror = () => {
          console.error("Error loading chat for deletion:", getRequest.error);
          reject(getRequest.error);
        };
      });
    } catch (error) {
      console.error("Error deleting chat:", error);
      return false;
    }
  };

  /**
   * Clear all chat history entries for the current user+org only.
   * Does not affect other users' or orgs' records.
   *
   * @returns true if clear succeeded
   */
  const clearLocalHistory = async (): Promise<boolean> => {
    try {
      const [db, userOrgKey] = await Promise.all([initDB(), getUserOrgKey()]);
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("userOrgKey");

      return new Promise((resolve, reject) => {
        const request = index.openCursor(IDBKeyRange.only(userOrgKey));
        request.onsuccess = (event: Event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve(true);
          }
        };
        request.onerror = () => {
          console.error("Error clearing history:", request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error("Error clearing history:", error);
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
  const updateLocalTitle = async (chatId: number, newTitle: string): Promise<boolean> => {
    try {
      const [db, userOrgKey] = await Promise.all([initDB(), getUserOrgKey()]);
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      return new Promise((resolve, reject) => {
        const getRequest = store.get(chatId);
        getRequest.onsuccess = () => {
          const chat = getRequest.result as ChatHistoryEntry | undefined;
          if (!chat || (chat.userOrgKey && chat.userOrgKey !== userOrgKey)) {
            resolve(false);
            return;
          }
          chat.title = raw(newTitle);
          const putRequest = store.put(chat);
          putRequest.onsuccess = () => resolve(true);
          putRequest.onerror = () => {
            console.error("Error updating title:", putRequest.error);
            reject(putRequest.error);
          };
        };
        getRequest.onerror = () => {
          console.error("Error retrieving chat for title update:", getRequest.error);
          reject(getRequest.error);
        };
      });
    } catch (error) {
      console.error("Error updating chat title:", error);
      return false;
    }
  };

  const putRecord = async (entry: ChatHistoryEntry): Promise<void> => {
    const db = await initDB();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  };

  // --- Server-backed operations ------------------------------------------

  const loadHistory = async (): Promise<ChatHistoryEntry[]> => {
    const local = await loadLocalHistory();
    if (!serverOn()) return local;
    let page: { chats: ServerChatSummary[]; next_cursor?: string };
    try {
      page = await server!.list(getOrgIdentifier(), MAX_HISTORY_ITEMS);
    } catch (error) {
      // Offline or server trouble: what this browser cached is still useful.
      console.error("Error loading chat history from the server:", error);
      return local;
    }
    const userOrgKey = await getUserOrgKey();
    const cachedBySession = new Map(
      local.filter((r) => r.sessionId).map((r) => [r.sessionId as string, r]),
    );
    const listed = new Set<string>();
    const merged: ChatHistoryEntry[] = [];
    listedSessions.clear();
    for (const chat of page.chats) {
      listed.add(chat.session_id);
      const cached = cachedBySession.get(chat.session_id);
      const id = cached?.id ?? idFromSessionId(chat.session_id);
      if (!cached) listedSessions.set(id, chat.session_id);
      merged.push({
        id,
        timestamp: new Date(chat.updated_at / 1000).toISOString(),
        title: raw(chat.title || cached?.title || t("common.newChat")),
        messages: cached?.messages ?? [],
        sessionId: chat.session_id,
        userOrgKey,
        serverBacked: true,
        cachedLastSeq: cached?.cachedLastSeq,
      });
    }
    const oldestListed = Math.min(...page.chats.map((c) => c.updated_at / 1000));
    for (const record of local) {
      if (record.sessionId && listed.has(record.sessionId)) continue;
      // Synced from the server before, within the range the listing covers,
      // yet absent: deleted (possibly from another device).
      const goneFromServer =
        record.serverBacked &&
        record.cachedLastSeq !== undefined &&
        (!page.next_cursor || new Date(record.timestamp).getTime() > oldestListed);
      if (goneFromServer) {
        await deleteLocalChat(record.id);
        continue;
      }
      // Browser-only: a chat from before persistence, or one not yet listed.
      merged.push(record);
    }
    return merged.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  };

  const loadChat = async (chatId: number): Promise<ChatHistoryEntry | null> => {
    const record = await loadLocalChat(chatId);
    const sessionId = record?.sessionId ?? listedSessions.get(chatId);
    if (!serverOn() || !sessionId) return record;
    let detail: ServerChatDetail;
    try {
      detail = await server!.get(getOrgIdentifier(), sessionId, record?.cachedLastSeq);
    } catch (error) {
      if (statusOf(error) === 404 && record?.serverBacked) {
        // Deleted on the server: the cached copy must not resurface.
        await deleteLocalChat(record.id);
        return null;
      }
      // Browser-only chat (404), or offline/transient: show what is cached.
      return record;
    }
    if (detail.not_modified && record) return record;

    const messages = messagesFromTurns(detail.turns ?? [], t);
    // Feedback votes live only in this browser; keep them when the shape matches.
    if (record && record.messages.length === messages.length) {
      messages.forEach((msg, i) => {
        if (record.messages[i]?.feedback) msg.feedback = record.messages[i].feedback;
      });
    }
    const entry: ChatHistoryEntry = {
      id: record?.id ?? chatId,
      timestamp: new Date(detail.updated_at / 1000).toISOString(),
      title: raw(detail.title || record?.title || t("common.newChat")),
      messages: JSON.parse(JSON.stringify(messages)),
      sessionId,
      userOrgKey: await getUserOrgKey(),
      serverBacked: true,
      cachedLastSeq: detail.last_committed_seq,
    };
    try {
      await putRecord(entry);
      listedSessions.delete(chatId);
    } catch (error) {
      console.error("Error caching chat:", error);
    }
    return entry;
  };

  const serverSessionOf = async (chatId: number): Promise<string | null> => {
    const record = await loadLocalChat(chatId);
    if (record?.serverBacked && record.sessionId) return record.sessionId;
    return listedSessions.get(chatId) ?? null;
  };

  const deleteChatById = async (chatId: number): Promise<boolean> => {
    const sessionId = serverOn() ? await serverSessionOf(chatId) : null;
    if (!sessionId) return deleteLocalChat(chatId);
    try {
      await server!.remove(getOrgIdentifier(), sessionId);
    } catch (error) {
      // Already gone is fine; anything else must not look deleted.
      if (statusOf(error) !== 404) {
        console.error("Error deleting chat on the server:", error);
        return false;
      }
    }
    listedSessions.delete(chatId);
    await deleteLocalChat(chatId);
    return true;
  };

  const clearAllHistory = async (): Promise<boolean> => {
    if (serverOn()) {
      try {
        await server!.removeAll(getOrgIdentifier());
      } catch (error) {
        console.error("Error clearing chat history on the server:", error);
        return false;
      }
      listedSessions.clear();
    }
    return clearLocalHistory();
  };

  const updateChatTitle = async (chatId: number, newTitle: string): Promise<boolean> => {
    if (serverOn()) {
      const sessionId = await serverSessionOf(chatId);
      if (sessionId) {
        try {
          await server!.rename(getOrgIdentifier(), sessionId, newTitle);
        } catch (error) {
          console.error("Error renaming chat on the server:", error);
          return false;
        }
        const cached = await loadLocalChat(chatId);
        if (!cached) return true;
      }
    }
    return updateLocalTitle(chatId, newTitle);
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
