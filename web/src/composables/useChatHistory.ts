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

import { foldTurns, mergeIncremental, type StoredTurn } from "@/components/O2AIChat.history";
import type { ChatMessage, ChatHistoryEntry, TurnSpan } from "@/ts/interfaces/chat";
import { raw, type TranslateFn } from "@/types/i18n";
import { notifyChatListChanged } from "@/utils/chatListRevision";
import { computeUserOrgKey } from "@/utils/userOrgKey";

const DB_NAME = "o2ChatDB";
const DB_VERSION = 2;
const STORE_NAME = "chatHistory";
const MAX_HISTORY_ITEMS = 100;
// Turns a top-up read may return; a longer gap is cheaper as one full read.
const INCREMENTAL_TURN_LIMIT = 50;
// A live save whose turn the server never reports stops winning after this, so a lost turn cannot pin a stale copy.
const LIVE_SAVE_GRACE_MS = 10 * 60_000;

// One memoised connection: opening one per call leaked an IDBDatabase per operation.
let dbPromise: Promise<IDBDatabase> | null = null;

/** Open the chat history store; version 2 added the userOrgKey index. */
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
  /** Set on a chat forked from a share: the share's id. */
  forked_from_share?: string;
}

/** A stored chat (`GET /api/{org}/ai/chats/{session_id}`). */
export interface ServerChatDetail extends ServerChatSummary {
  not_modified: boolean;
  /** Changes with the committed seq or any turn's status; pass back as `known_version`. */
  state_version?: string;
  turns?: StoredTurn[];
  /** A turn is still being generated. */
  active_turn?: boolean;
  /** Set when `turns` holds only the turns past this `known_seq`. */
  partial_from_seq?: number;
  /** `limit` cut older turns off `turns`. */
  has_more?: boolean;
}

/** Server-side chat persistence; when enabled IndexedDB only caches it, and errors carry the HTTP `status`. */
export interface ChatHistoryServer {
  enabled: () => boolean;
  list: (
    orgId: string,
    limit: number,
  ) => Promise<{ chats: ServerChatSummary[]; next_cursor?: string }>;
  get: (
    orgId: string,
    sessionId: string,
    knownSeq?: number,
    limit?: number,
    knownVersion?: string,
  ) => Promise<ServerChatDetail>;
  rename: (orgId: string, sessionId: string, title: string) => Promise<unknown>;
  remove: (orgId: string, sessionId: string) => Promise<unknown>;
  removeAll: (orgId: string) => Promise<unknown>;
}

// Module scope: the list (HomeChatHistory) and the chat that opens an entry (O2AIChat) share only the numeric id.
const listedSessions = new Map<number, string>();
const listedTitles = new Map<number, string>();

/** Chat entry ids are creation times in ms; a UUIDv7 session id carries one. */
const idFromSessionId = (sessionId: string): number =>
  parseInt(sessionId.replace(/-/g, "").slice(0, 12), 16);

const statusOf = (error: unknown): number | undefined =>
  (error as { status?: number } | null)?.status;

const spansCover = (record: ChatHistoryEntry): boolean =>
  !!record.cachedTurnSpans &&
  record.cachedTurnSpans.reduce((sum, span) => sum + span.count, 0) === record.messages.length;

/** A chat whose turns may still change without its committed seq moving must be revalidated in full. */
const isSettled = (detail: ServerChatDetail, turns: StoredTurn[]): boolean =>
  !detail.active_turn && !turns.some((turn) => turn.status === "running");

// A turn that ended here commits on the server a moment later (a Stop, notably), so until the server has it settled the save wins.
const isLiveSaveAhead = (record: ChatHistoryEntry, turns: StoredTurn[]): boolean => {
  if (!record.serverBacked || record.cachedLastSeq !== undefined || !record.liveTurnId)
    return false;
  if (record.liveSavedAt !== undefined && Date.now() - record.liveSavedAt > LIVE_SAVE_GRACE_MS) {
    return false;
  }
  const turn = turns.find((stored) => stored.turn_id === record.liveTurnId);
  return !turn || turn.status === "running";
};

/** AI chat history scoped to the current user and org, cached in IndexedDB and backed by the server when `server` is enabled. */
export function useChatHistory(
  getUserEmail: () => string,
  getOrgIdentifier: () => string,
  t: TranslateFn,
  server?: ChatHistoryServer,
) {
  const serverOn = () => server?.enabled() ?? false;
  // Keyed by the raw input, so a user or org switch recomputes the hash.
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

  /** Save a chat to IndexedDB and return its entry id; `endedTurnId` marks a save made as that turn ended. */
  const saveToHistory = async (
    messages: ChatMessage[],
    sessionId: string,
    title?: string,
    existingChatId?: number | null,
    endedTurnId?: string,
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
        // No cachedLastSeq: a live save may differ from what the server committed, so the next open revalidates.
        ...(serverOn() && { serverBacked: true }),
        ...(serverOn() && endedTurnId && { liveTurnId: endedTurnId, liveSavedAt: Date.now() }),
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

  /** This user+org's cached chats, newest first, pruned to MAX_HISTORY_ITEMS. */
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

  /** One cached chat, or null when missing or owned by another user+org. */
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

  /** Delete one cached chat of this user+org. */
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

  /** Delete every cached chat of this user+org only. */
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

  /** Rename one cached chat of this user+org. */
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
    listedTitles.clear();
    for (const chat of page.chats) {
      listed.add(chat.session_id);
      const cached = cachedBySession.get(chat.session_id);
      const id = cached?.id ?? idFromSessionId(chat.session_id);
      if (!cached) {
        listedSessions.set(id, chat.session_id);
        listedTitles.set(id, chat.title);
      }
      merged.push({
        id,
        timestamp: new Date(chat.updated_at / 1000).toISOString(),
        title: raw(chat.title || cached?.title || t("common.newChat")),
        messages: cached?.messages ?? [],
        sessionId: chat.session_id,
        userOrgKey,
        serverBacked: true,
        cachedLastSeq: cached?.cachedLastSeq,
        forkedFromShare: chat.forked_from_share,
      });
    }
    const oldestListed = Math.min(...page.chats.map((c) => c.updated_at / 1000));
    for (const record of local) {
      if (record.sessionId && listed.has(record.sessionId)) continue;
      // Synced before and within the listed range, yet absent: deleted, possibly from another device.
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
    return merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  type Folded = { messages: ChatMessage[]; spans: TurnSpan[] };

  // A top-up read with a gap (`has_more`) or nothing cached to merge into falls back to a full read.
  const fetchFolded = async (
    sessionId: string,
    record: ChatHistoryEntry | null,
  ): Promise<{ detail: ServerChatDetail; folded: Folded | null }> => {
    const knownSeq = record?.cachedLastSeq;
    const limit = knownSeq === undefined ? undefined : INCREMENTAL_TURN_LIMIT;
    const knownVersion = knownSeq === undefined ? undefined : record?.cachedStateVersion;
    const detail = await server!.get(getOrgIdentifier(), sessionId, knownSeq, limit, knownVersion);
    if (detail.not_modified) return { detail, folded: null };
    const partial = detail.partial_from_seq !== undefined && detail.partial_from_seq !== null;
    if (!partial) return { detail, folded: foldTurns(detail.turns ?? [], t) };
    if (!detail.has_more && record && spansCover(record)) {
      const cached = { messages: record.messages, spans: record.cachedTurnSpans! };
      const merged = mergeIncremental(cached, detail.partial_from_seq!, detail.turns ?? [], t);
      return { detail, folded: merged };
    }
    const full = await server!.get(getOrgIdentifier(), sessionId);
    return { detail: full, folded: foldTurns(full.turns ?? [], t) };
  };

  // A history the server cannot read must still open, flagged, rather than leave the click silent.
  const unavailableEntry = async (
    chatId: number,
    sessionId: string,
    record: ChatHistoryEntry | null,
  ): Promise<ChatHistoryEntry> => ({
    ...(record ?? {
      id: chatId,
      timestamp: new Date().toISOString(),
      title: raw(listedTitles.get(chatId) || t("common.newChat")),
      messages: [],
      sessionId,
      userOrgKey: await getUserOrgKey(),
      serverBacked: true,
    }),
    historyUnavailable: true,
  });

  const loadChat = async (chatId: number): Promise<ChatHistoryEntry | null> => {
    const record = await loadLocalChat(chatId);
    const sessionId = record?.sessionId ?? listedSessions.get(chatId);
    if (!serverOn() || !sessionId) return record;
    let detail: ServerChatDetail;
    let folded: Folded | null;
    try {
      ({ detail, folded } = await fetchFolded(sessionId, record));
    } catch (error) {
      const status = statusOf(error);
      if (status === 404 && record?.serverBacked) {
        // Deleted on the server: the cached copy must not resurface.
        await deleteLocalChat(record.id);
        return null;
      }
      // A browser-only chat is a 404 too; it simply has nothing on the server.
      if (status === 404) return record;
      if (record && !record.serverBacked) return record;
      return unavailableEntry(chatId, sessionId, record);
    }
    if (!folded) return record;

    const { messages, spans } = folded;
    if (record && isLiveSaveAhead(record, detail.turns ?? [])) {
      return { ...record, forkedFromShare: detail.forked_from_share ?? record.forkedFromShare };
    }
    // Feedback votes live only in this browser; keep them when the shape matches.
    if (record && record.messages.length === messages.length) {
      messages.forEach((msg, i) => {
        if (record.messages[i]?.feedback) msg.feedback = record.messages[i].feedback;
      });
    }
    const settled = isSettled(detail, detail.turns ?? []);
    const entry: ChatHistoryEntry = {
      id: record?.id ?? chatId,
      timestamp: new Date(detail.updated_at / 1000).toISOString(),
      title: raw(detail.title || record?.title || t("common.newChat")),
      messages: JSON.parse(JSON.stringify(messages)),
      sessionId,
      userOrgKey: await getUserOrgKey(),
      serverBacked: true,
      ...(settled && {
        cachedLastSeq: detail.last_committed_seq,
        cachedTurnSpans: spans,
        ...(detail.state_version !== undefined && { cachedStateVersion: detail.state_version }),
      }),
      forkedFromShare: detail.forked_from_share,
    };
    try {
      await putRecord(entry);
      listedSessions.delete(chatId);
      listedTitles.delete(chatId);
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
    if (!sessionId) {
      const deleted = await deleteLocalChat(chatId);
      if (deleted) notifyChatListChanged();
      return deleted;
    }
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
    listedTitles.delete(chatId);
    await deleteLocalChat(chatId);
    notifyChatListChanged();
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
      listedTitles.clear();
    }
    const cleared = await clearLocalHistory();
    notifyChatListChanged();
    return cleared;
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
        notifyChatListChanged();
        const cached = await loadLocalChat(chatId);
        if (!cached) return true;
      }
    }
    const renamed = await updateLocalTitle(chatId, newTitle);
    if (renamed) notifyChatListChanged();
    return renamed;
  };

  /** Cache a server chat this browser has not listed yet (a fork) so `loadChat` can open it at once. */
  const adoptServerChat = async (sessionId: string, title: string): Promise<number> => {
    const id = idFromSessionId(sessionId);
    const existing = await loadLocalChat(id);
    if (existing) return id;
    // No cachedLastSeq, so the first open fetches the turns from the server.
    await putRecord({
      id,
      timestamp: new Date().toISOString(),
      title: raw(title || t("common.newChat")),
      messages: [],
      sessionId,
      userOrgKey: await getUserOrgKey(),
      serverBacked: true,
    });
    notifyChatListChanged();
    return id;
  };

  return {
    saveToHistory,
    loadHistory,
    adoptServerChat,
    loadChat,
    deleteChatById,
    clearAllHistory,
    updateChatTitle,
  };
}
