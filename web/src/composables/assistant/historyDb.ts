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

import type { ChatMessage, TurnSpan } from "@/ts/interfaces/chat";

import type { EntryOrigin, ForkSeed } from "./assistantStore.types";
import type { StoredTurn } from "./record";

// The legacy chat's database, unchanged: no version bump and no new store before cutover.
export const HISTORY_DB_NAME = "o2ChatDB";
export const HISTORY_DB_VERSION = 2;
export const HISTORY_STORE = "chatHistory";
export const LOCAL_CAP = 100;
export const LIVE_SAVE_GRACE_MS = 10 * 60_000;

/** One stored turn with the time it started, for ordering a merge. */
export type LocalTurn = StoredTurn & { startedAt?: number };

/** The legacy `ChatHistoryEntry` plus optional v2 fields; a legacy tab reads `messages` and ignores the rest. */
export interface LocalRecord {
  id: number;
  timestamp: string;
  title: string;
  messages: ChatMessage[];
  sessionId?: string;
  userOrgKey?: string;
  serverBacked?: boolean;
  cachedLastSeq?: number;
  cachedStateVersion?: string;
  cachedTurnSpans?: TurnSpan[];
  forkedFromShare?: string;
  liveTurnId?: string;
  liveSavedAt?: number;
  turns?: LocalTurn[];
  /** Absent on a legacy row, which counts as 0. */
  rev?: number;
  writer?: string;
  titleSource?: "generated" | "renamed" | "object";
  origin?: EntryOrigin;
  pinned?: boolean;
  ephemeral?: boolean;
  agentType?: string | null;
  seed?: ForkSeed;
  /** The server session an import created, so a resumed import skips it. */
  importedAs?: string;
}

/** The browser store as the history service sees it; a spec passes an in-memory one. */
export interface HistoryDb {
  list(userOrgKey: string): Promise<LocalRecord[]>;
  get(id: number): Promise<LocalRecord | null>;
  /** Read-compare-write in one transaction; `null` when the stored id is another user+org's or has no owner. */
  merge(record: LocalRecord, writer: string): Promise<LocalRecord | null>;
  /** Only rows this user+org owns go; any other id is left alone. */
  remove(ids: number[], userOrgKey: string): Promise<void>;
  removeAll(userOrgKeys: string[]): Promise<number>;
  /** Rows without `userOrgKey`, never listed. */
  countUnkeyed(): Promise<number>;
}

type MessageGroup = { key: string; at: number; messages: ChatMessage[] };

let dbPromise: Promise<IDBDatabase> | null = null;

/** The same database the legacy chat writes; one connection per page, dropped when another version takes over. */
export function createIndexedDbHistory(): HistoryDb {
  return {
    list: (userOrgKey) =>
      withStore("readonly", (store) =>
        request<LocalRecord[]>(store.index("userOrgKey").getAll(IDBKeyRange.only(userOrgKey))),
      ),
    get: (id) =>
      withStore("readonly", async (store) => (await request<LocalRecord>(store.get(id))) ?? null),
    merge: (record, writer) =>
      withStore("readwrite", async (store) => {
        const stored = (await request<LocalRecord | undefined>(store.get(record.id))) ?? undefined;
        if (stored && stored.userOrgKey !== record.userOrgKey) return null;
        const next = mergeLocalRecord(stored, record, writer);
        await request(store.put(next));
        return next;
      }),
    remove: (ids, userOrgKey) =>
      withStore("readwrite", async (store) => {
        for (const id of ids) {
          const stored = await request<LocalRecord | undefined>(store.get(id));
          if (stored?.userOrgKey === userOrgKey) await request(store.delete(id));
        }
      }),
    removeAll: (keys) =>
      withStore("readwrite", async (store) => {
        let removed = 0;
        for (const key of keys) {
          const ids = await request<IDBValidKey[]>(
            store.index("userOrgKey").getAllKeys(IDBKeyRange.only(key)),
          );
          for (const id of ids) await request(store.delete(id));
          removed += ids.length;
        }
        return removed;
      }),
    countUnkeyed: () =>
      withStore("readonly", async (store) => {
        const all = await request<LocalRecord[]>(store.getAll());
        return all.filter((row) => !row.userOrgKey).length;
      }),
  };
}

/** Turns merge by `turnId` (this tab wins for its own), legacy `messages` by turn, and `rev` moves on. */
export function mergeLocalRecord(
  stored: LocalRecord | undefined,
  mine: LocalRecord,
  writer: string,
): LocalRecord {
  const base = stored ?? ({ rev: 0 } as Partial<LocalRecord>);
  const turns = mergeTurns(base.turns ?? [], mine.turns ?? []);
  const renamedThere = base.titleSource === "renamed" && mine.titleSource !== "renamed";
  return {
    ...base,
    ...mine,
    title: renamedThere && base.title ? base.title : mine.title,
    titleSource: renamedThere ? "renamed" : mine.titleSource,
    pinned: mine.pinned ?? base.pinned,
    origin: mine.origin ?? base.origin,
    messages: mergeMessages(base.messages ?? [], mine.messages),
    ...(turns.length > 0 && { turns }),
    rev: (base.rev ?? 0) + 1,
    writer,
  };
}

/** Legacy messages carry no ids, so a turn is keyed by its id, its send time, else its prompt text. */
export function messageGroups(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const message of messages) {
    const last = groups.at(-1);
    if (message.role === "user" || !last) {
      const key = message.turnId
        ? `turn:${message.turnId}`
        : typeof message.sentAt === "number"
          ? `at:${message.sentAt}`
          : `text:${String(message.content)}`;
      groups.push({ key, at: message.sentAt ?? groups.length, messages: [message] });
    } else last.messages.push(message);
  }
  return groups;
}

function mergeTurns(stored: LocalTurn[], mine: LocalTurn[]): LocalTurn[] {
  const byId = new Map<string, LocalTurn>();
  const loose: LocalTurn[] = [];
  for (const turn of [...stored, ...mine]) {
    if (turn.turn_id) byId.set(turn.turn_id, turn);
    else loose.push(turn);
  }
  return [...loose, ...byId.values()].sort(
    (a, b) => (a.startedAt ?? a.created ?? 0) - (b.startedAt ?? b.created ?? 0),
  );
}

function mergeMessages(stored: ChatMessage[], mine: ChatMessage[]): ChatMessage[] {
  const mineGroups = messageGroups(mine);
  const mineKeys = new Set(mineGroups.map((group) => group.key));
  const kept = messageGroups(stored).filter((group) => !mineKeys.has(group.key));
  if (kept.length === 0) return mine;
  const ordered = [...kept, ...mineGroups];
  // Without send times the stored turns come first, as they were written first.
  if (ordered.every((group) => typeof group.messages[0]?.sentAt === "number"))
    ordered.sort((a, b) => a.at - b.at);
  return ordered.flatMap((group) => group.messages);
}

// Every await inside the callback is an IndexedDB request, so the transaction never auto-commits early.
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(HISTORY_STORE, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  });
  const result = await run(tx.objectStore(HISTORY_STORE));
  await done;
  return result;
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    // The same upgrade the legacy chat runs, so whichever tab opens first leaves the same schema.
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.objectStoreNames.contains(HISTORY_STORE)
        ? req.transaction!.objectStore(HISTORY_STORE)
        : db.createObjectStore(HISTORY_STORE, { keyPath: "id", autoIncrement: true });
      if (!store.indexNames.contains("timestamp")) store.createIndex("timestamp", "timestamp");
      if (!store.indexNames.contains("title")) store.createIndex("title", "title");
      if (!store.indexNames.contains("userOrgKey")) store.createIndex("userOrgKey", "userOrgKey");
    };
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}
