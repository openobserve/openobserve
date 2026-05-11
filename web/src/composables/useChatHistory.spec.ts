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

/// <reference lib="dom" />
/* global BufferSource, Event, IDBCursorWithValue, IDBObjectStore, IDBRequest, IDBVersionChangeEvent, queueMicrotask, setTimeout, crypto, TextEncoder */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ChatMessage } from "@/ts/interfaces/chat";

// ---------------------------------------------------------------------------
// crypto.subtle mock — deterministic fake hash based on input bytes
// Must be declared before the composable is imported so the module-level
// computeUserOrgKey function sees the mock on first call.
// ---------------------------------------------------------------------------
vi.stubGlobal("crypto", {
  subtle: {
    digest: vi
      .fn()
      .mockImplementation(async (_algo: string, data: BufferSource) => {
        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array((data as ArrayBufferView).buffer);
        const buf = new Uint8Array(32);
        for (let i = 0; i < bytes.length && i < 32; i++) {
          buf[i] = bytes[i];
        }
        return buf.buffer;
      }),
  },
});

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB mock
//
// Implements only the IDB surface used by useChatHistory:
//   open, objectStore, put, get, getAll, delete, openCursor,
//   createIndex, transaction, IDBKeyRange.only
//
// All callbacks are invoked via microtask (queueMicrotask) so that the
// composable's Promise chains resolve naturally when the test awaits the
// returned promise — no setTimeout / sleep required.
// ---------------------------------------------------------------------------

type RecordMap = Map<number, Record<string, unknown>>;

 
interface MockIndex {
  name: string;
  keyPath: string;
  getAll(keyRange: { value: unknown }): MockRequest;
  openCursor(keyRange: { value: unknown }): MockRequest;
}

interface MockObjectStore {
  name: string;
  records: RecordMap;
  indexes: Map<string, MockIndex>;
  indexNames: { contains(name: string): boolean };
  createIndex(name: string, keyPath: string, opts?: unknown): MockIndex;
  index(name: string): MockIndex;
  put(record: Record<string, unknown>): MockRequest;
  get(id: number): MockRequest;
  delete(id: number): MockRequest;
}

interface MockRequest {
  result: unknown;
  error: unknown;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
}

interface MockTransaction {
  objectStore(name: string): MockObjectStore;
  oncomplete: (() => void) | null; // setter fires after microtasks via setTimeout(0)
  onerror: (() => void) | null;
  _stores: Map<string, MockObjectStore>;
  _complete(): void;
}

interface MockDB {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(
    name: string,
    opts: { keyPath: string; autoIncrement: boolean },
  ): MockObjectStore;
  transaction(storeName: string, mode: string): MockTransaction;
  _stores: Map<string, MockObjectStore>;
}
 

// In-memory database registry — persists across transactions within a test
// Also tracks the version at which each DB was last upgraded so we don't
// repeat the onupgradeneeded sequence on every open() call.
const dbRegistry = new Map<string, { db: MockDB; version: number }>();

// Global auto-increment counter used by the put mock so that consecutive calls
// to the composable's saveToHistory (which uses Date.now() as the chatId) never
// collide even when multiple calls happen within the same millisecond.
let _autoIdCounter = 1;

function makeRequest(initialResult: unknown = undefined): MockRequest {
  return {
    result: initialResult,
    error: null,
    onsuccess: null,
    onerror: null,
  };
}

function makeIndex(
  store: MockObjectStore,
  indexName: string,
  keyPath: string,
): MockIndex {
  return {
    name: indexName,
    keyPath,
    getAll(keyRange: { value: unknown }): MockRequest {
      const req = makeRequest();
      queueMicrotask(() => {
        const results: Record<string, unknown>[] = [];
        store.records.forEach((record) => {
          if (record[keyPath] === keyRange.value) {
            results.push({ ...record });
          }
        });
        req.result = results;
        if (req.onsuccess) req.onsuccess({ target: req } as unknown as Event);
      });
      return req;
    },
    openCursor(keyRange: { value: unknown }): MockRequest {
      const req = makeRequest();
      const matchingKeys: number[] = [];
      store.records.forEach((record, key) => {
        if (record[keyPath] === keyRange.value) {
          matchingKeys.push(key);
        }
      });

      let cursor: IDBCursorWithValue | null = null;
      let idx = 0;

      const advanceCursor = () => {
        if (idx < matchingKeys.length) {
          const key = matchingKeys[idx];
          const record = store.records.get(key);
          idx++;
          cursor = {
            value: record ? { ...record } : null,
            key,
            primaryKey: key,
            direction: "next",
            source: null as unknown as IDBObjectStore,
            request: null as unknown as IDBRequest,
            advance: vi.fn(),
            continue: vi.fn().mockImplementation(() => {
              queueMicrotask(() => {
                // Re-check after potential deletions
                // rebuild matching keys from current store state
                while (
                  idx < matchingKeys.length &&
                  !store.records.has(matchingKeys[idx])
                ) {
                  idx++;
                }
                advanceCursor();
              });
            }),
            continuePrimaryKey: vi.fn(),
            delete: vi.fn().mockImplementation(() => {
              if (key !== undefined) store.records.delete(key);
              return makeRequest();
            }),
            update: vi.fn(),
          } as unknown as IDBCursorWithValue;
          req.result = cursor;
          if (req.onsuccess) req.onsuccess({ target: req } as unknown as Event);
        } else {
          req.result = null;
          if (req.onsuccess) req.onsuccess({ target: req } as unknown as Event);
        }
      };

      queueMicrotask(advanceCursor);
      return req;
    },
  };
}

function makeObjectStore(name: string): MockObjectStore {
  const records: RecordMap = new Map();
  const indexes = new Map<string, MockIndex>();

  const store: MockObjectStore = {
    name,
    records,
    indexes,
    indexNames: {
      contains(indexName: string) {
        return indexes.has(indexName);
      },
    },
    createIndex(indexName: string, keyPath: string) {
      const idx = makeIndex(store, indexName, keyPath);
      indexes.set(indexName, idx);
      return idx;
    },
    index(indexName: string) {
      const idx = indexes.get(indexName);
      if (!idx)
        throw new Error(`Index '${indexName}' not found on store '${name}'`);
      return idx;
    },
    put(record: Record<string, unknown>) {
      const req = makeRequest();
      queueMicrotask(() => {
        let id = record.id as number | undefined;
        if (id === undefined || id === null) {
          id = _autoIdCounter++;
        } else if (records.has(id)) {
          // Check if this is a genuine update (same record) or a Date.now() collision
          const existing = records.get(id)!;
          if (
            existing.userOrgKey !== record.userOrgKey ||
            existing.sessionId !== record.sessionId
          ) {
            // Different record — collision from Date.now(); assign a fresh ID
            id = _autoIdCounter++;
          }
          // else: intentional update to the same record — keep the same id
        }
        records.set(id, { ...record, id });
        req.result = id;
        if (req.onsuccess) req.onsuccess({ target: req } as unknown as Event);
      });
      return req;
    },
    get(id: number) {
      const req = makeRequest();
      queueMicrotask(() => {
        const record = records.get(id);
        req.result = record ? { ...record } : undefined;
        if (req.onsuccess) req.onsuccess({ target: req } as unknown as Event);
      });
      return req;
    },
    delete(id: number) {
      const req = makeRequest();
      queueMicrotask(() => {
        records.delete(id);
        req.result = undefined;
        if (req.onsuccess) req.onsuccess({ target: req } as unknown as Event);
      });
      return req;
    },
  };

  return store;
}

function makeTransaction(db: MockDB, _storeName: string): MockTransaction {
  let _oncomplete: (() => void) | null = null;
  let _onerror: (() => void) | null = null;

  const tx: MockTransaction = {
    _stores: new Map(),
    // oncomplete fires via setTimeout(0) so that all pending microtasks
    // (store.delete() calls) have drained before the transaction resolves.
    get oncomplete() {
      return _oncomplete;
    },
    set oncomplete(fn: (() => void) | null) {
      _oncomplete = fn;
      if (fn) {
        setTimeout(() => {
          if (_oncomplete) _oncomplete();
        }, 0);
      }
    },
    get onerror() {
      return _onerror;
    },
    set onerror(fn: (() => void) | null) {
      _onerror = fn;
    },
    objectStore(name: string) {
      if (!tx._stores.has(name)) {
        const existing = db._stores.get(name);
        if (!existing) throw new Error(`Object store '${name}' not found`);
        // Share the same store records across transactions within the same DB
        tx._stores.set(name, existing);
      }
      return tx._stores.get(name)!;
    },
    _complete() {
      if (tx.oncomplete) tx.oncomplete();
    },
  };
  return tx;
}

function makeDB(): MockDB {
  const stores = new Map<string, MockObjectStore>();
  const db: MockDB = {
    _stores: stores,
    objectStoreNames: {
      contains(name: string) {
        return stores.has(name);
      },
    },
    createObjectStore(
      name: string,
      _opts: { keyPath: string; autoIncrement: boolean },
    ) {
      const store = makeObjectStore(name);
      stores.set(name, store);
      return store;
    },
    transaction(storeName: string, _mode: string) {
      return makeTransaction(db, storeName);
    },
  };
  return db;
}

// Replace global indexedDB with the in-memory mock
const mockIndexedDB = {
  open(name: string, version: number) {
    const req = makeRequest() as MockRequest & {
      onerror: ((_e: Event) => void) | null;
      onsuccess: ((_e: Event) => void) | null;
      onupgradeneeded: ((_e: IDBVersionChangeEvent) => void) | null;
    };
    req.onupgradeneeded = null;

    queueMicrotask(() => {
      const entry = dbRegistry.get(name);
      const isNew = !entry;
      const oldVersion = entry ? entry.version : 0;

      let db: MockDB;
      if (isNew) {
        db = makeDB();
        dbRegistry.set(name, { db, version });
      } else {
        db = entry!.db;
      }

      const needsUpgrade = isNew || version > oldVersion;
      if (needsUpgrade && req.onupgradeneeded) {
        // Update the stored version
        if (!isNew) dbRegistry.set(name, { db, version });
        // Simulate upgrade event so the composable can create the object store
        const upgradeEvent = {
          target: {
            result: db,
            transaction: db.transaction("chatHistory", "versionchange"),
          },
          oldVersion,
          newVersion: version,
        } as unknown as IDBVersionChangeEvent;
        req.onupgradeneeded(upgradeEvent);
      }

      req.result = db;
      if (req.onsuccess) req.onsuccess({ target: req } as unknown as Event);
    });

    return req;
  },
};

vi.stubGlobal("indexedDB", mockIndexedDB);

// IDBKeyRange.only — used by loadHistory and clearAllHistory
vi.stubGlobal("IDBKeyRange", {
  only: (value: unknown) => ({ value }),
});

// ---------------------------------------------------------------------------
// Import composable AFTER mocks are set up
// ---------------------------------------------------------------------------
import { useChatHistory } from "./useChatHistory";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessages(count = 1): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `message ${i}`,
  }));
}

/** Resolve the userOrgKey for a given email+org the same way the composable does. */
async function resolveKey(email: string, org: string): Promise<string> {
  const raw = `${email}:${org}`;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useChatHistory", () => {
  const USER1 = "user1@example.com";
  const ORG1 = "org-alpha";
  const USER2 = "user2@example.com";
  const ORG2 = "org-beta";

  beforeEach(() => {
    // Reset the DB registry and ID counter so every test starts with a fresh
    // in-memory database. The composable caches _keyPromise per instance, and
    // each test creates new instances, so no key cache leaks between tests.
    dbRegistry.clear();
    _autoIdCounter = 1;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Thin wrapper around composable.saveToHistory.
   * The put mock automatically assigns a unique ID when Date.now() would
   * collide, so no fake timers or manual ID management is needed here.
   */
  async function saveUnique(
    composable: ReturnType<typeof useChatHistory>,
    messages: ChatMessage[],
    sessionId: string,
    title?: string,
    existingChatId?: number | null,
  ): Promise<number | null> {
    return composable.saveToHistory(messages, sessionId, title, existingChatId);
  }

  // -------------------------------------------------------------------------
  describe("saveToHistory", () => {
    it("should return null when messages array is empty", async () => {
      const { saveToHistory } = useChatHistory(() => USER1, () => ORG1);
      const result = await saveToHistory([], "session-001");
      expect(result).toBeNull();
    });

    it("should return a numeric chat ID when messages are provided", async () => {
      const { saveToHistory } = useChatHistory(() => USER1, () => ORG1);
      const result = await saveToHistory(makeMessages(2), "session-001");
      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThan(0);
    });

    it("should use the provided title when one is given", async () => {
      const { saveToHistory, loadChat } = useChatHistory(() => USER1, () => ORG1);
      const chatId = await saveToHistory(
        makeMessages(1),
        "session-001",
        "My Custom Title",
      );
      expect(chatId).not.toBeNull();
      const entry = await loadChat(chatId!);
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe("My Custom Title");
    });

    it("should use the first user message as title when no title is provided", async () => {
      const { saveToHistory, loadChat } = useChatHistory(() => USER1, () => ORG1);
      const messages: ChatMessage[] = [
        { role: "user", content: "Hello, world!" },
        { role: "assistant", content: "Hi there!" },
      ];
      const chatId = await saveToHistory(messages, "session-002");
      expect(chatId).not.toBeNull();
      const entry = await loadChat(chatId!);
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe("Hello, world!");
    });

    it("should truncate the auto-generated title at 40 characters with ellipsis", async () => {
      const { saveToHistory, loadChat } = useChatHistory(() => USER1, () => ORG1);
      const longContent = "A".repeat(50);
      const messages: ChatMessage[] = [{ role: "user", content: longContent }];
      const chatId = await saveToHistory(messages, "session-003");
      expect(chatId).not.toBeNull();
      const entry = await loadChat(chatId!);
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe("A".repeat(40) + "...");
      expect(entry!.title.length).toBe(43);
    });

    it("should not truncate title when first user message is exactly 40 characters", async () => {
      const { saveToHistory, loadChat } = useChatHistory(() => USER1, () => ORG1);
      const exactContent = "B".repeat(40);
      const messages: ChatMessage[] = [{ role: "user", content: exactContent }];
      const chatId = await saveToHistory(messages, "session-004");
      const entry = await loadChat(chatId!);
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe(exactContent);
    });

    it("should store the userOrgKey on the saved record", async () => {
      const { saveToHistory, loadChat } = useChatHistory(() => USER1, () => ORG1);
      const expectedKey = await resolveKey(USER1, ORG1);
      const chatId = await saveToHistory(makeMessages(1), "session-005");
      expect(chatId).not.toBeNull();
      const entry = await loadChat(chatId!);
      expect(entry).not.toBeNull();
      expect(entry!.userOrgKey).toBe(expectedKey);
    });

    it("should update an existing chat when existingChatId is provided", async () => {
      const { saveToHistory, loadChat } = useChatHistory(() => USER1, () => ORG1);
      const chatId = await saveToHistory(
        makeMessages(1),
        "session-006",
        "Original Title",
      );
      expect(chatId).not.toBeNull();

      const updated = await saveToHistory(
        makeMessages(2),
        "session-006",
        "Updated Title",
        chatId,
      );
      expect(updated).toBe(chatId);

      const entry = await loadChat(chatId!);
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe("Updated Title");
      expect(entry!.messages).toHaveLength(2);
    });

    it("should use 'New Chat' as title when no user message exists", async () => {
      const { saveToHistory, loadChat } = useChatHistory(() => USER1, () => ORG1);
      const messages: ChatMessage[] = [
        { role: "assistant", content: "I am ready to help." },
      ];
      const chatId = await saveToHistory(messages, "session-007");
      expect(chatId).not.toBeNull();
      const entry = await loadChat(chatId!);
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe("New Chat");
    });
  });

  // -------------------------------------------------------------------------
  describe("loadHistory", () => {
    it("should return an empty array when no history exists", async () => {
      const { loadHistory } = useChatHistory(() => USER1, () => ORG1);
      const history = await loadHistory();
      expect(history).toEqual([]);
    });

    it("should return only the entries belonging to the current user+org", async () => {
      const h1 = useChatHistory(() => USER1, () => ORG1);
      const h2 = useChatHistory(() => USER2, () => ORG2);

      await saveUnique(h1, makeMessages(1), "s1", "Chat A");
      await saveUnique(h2, makeMessages(1), "s2", "Chat B");

      const user1History = await h1.loadHistory();
      expect(user1History).toHaveLength(1);
      expect(user1History[0].title).toBe("Chat A");
    });

    it("should sort results by timestamp descending (newest first)", async () => {
      const composable = useChatHistory(() => USER1, () => ORG1);
      const { loadHistory } = composable;

      // Each saveUnique advances the fake clock by 1 ms, giving distinct IDs
      // and distinct ISO timestamps so the sort order is deterministic.
      const id1 = await saveUnique(composable, makeMessages(1), "s1", "Oldest");
      const id2 = await saveUnique(composable, makeMessages(1), "s2", "Middle");
      const id3 = await saveUnique(composable, makeMessages(1), "s3", "Newest");

      // Patch timestamps to ensure deterministic ordering independent of wall clock
      const db = dbRegistry.get("o2ChatDB")!.db;
      const storeRecords = db._stores.get("chatHistory")!.records;
      storeRecords.get(id1!)!.timestamp = "2024-01-01T10:00:00.000Z";
      storeRecords.get(id2!)!.timestamp = "2024-01-02T10:00:00.000Z";
      storeRecords.get(id3!)!.timestamp = "2024-01-03T10:00:00.000Z";

      const history = await loadHistory();
      expect(history).toHaveLength(3);
      expect(history[0].title).toBe("Newest");
      expect(history[1].title).toBe("Middle");
      expect(history[2].title).toBe("Oldest");
    });

    it("should prune entries beyond 100 items for the current user+org only", async () => {
      const composable = useChatHistory(() => USER1, () => ORG1);
      const { loadHistory } = composable;

      // Save 105 chats for user1; saveUnique advances the clock each call
      for (let i = 0; i < 105; i++) {
        await saveUnique(
          composable,
          makeMessages(1),
          `session-${i}`,
          `Chat ${i}`,
        );
      }

      const history = await loadHistory();
      expect(history).toHaveLength(100);
    });

    it("should not prune entries belonging to other users when current user exceeds 100", async () => {
      const h1 = useChatHistory(() => USER1, () => ORG1);
      const h2 = useChatHistory(() => USER2, () => ORG2);

      // 105 for user1; saveUnique ensures unique IDs
      for (let i = 0; i < 105; i++) {
        await saveUnique(h1, makeMessages(1), `s1-${i}`, `U1 Chat ${i}`);
      }
      // 2 for user2
      await saveUnique(h2, makeMessages(1), "s2-0", "U2 Chat 0");
      await saveUnique(h2, makeMessages(1), "s2-1", "U2 Chat 1");

      // Trigger pruning for user1
      await h1.loadHistory();

      // user2's records must still be intact
      const user2History = await h2.loadHistory();
      expect(user2History).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  describe("loadChat", () => {
    it("should return the chat entry when ID and ownership match", async () => {
      const { saveToHistory, loadChat } = useChatHistory(() => USER1, () => ORG1);
      const messages = makeMessages(2);
      const chatId = await saveToHistory(
        messages,
        "session-load-1",
        "Load Test",
      );
      expect(chatId).not.toBeNull();

      const entry = await loadChat(chatId!);
      expect(entry).not.toBeNull();
      expect(entry!.id).toBe(chatId);
      expect(entry!.title).toBe("Load Test");
      expect(entry!.messages).toHaveLength(2);
    });

    it("should return null when the chatId does not exist", async () => {
      const { loadChat } = useChatHistory(() => USER1, () => ORG1);
      const entry = await loadChat(99999);
      expect(entry).toBeNull();
    });

    it("should return null when the record belongs to a different user+org", async () => {
      const h1 = useChatHistory(() => USER1, () => ORG1);
      const h2 = useChatHistory(() => USER2, () => ORG2);

      const chatId = await h1.saveToHistory(
        makeMessages(1),
        "s-cross",
        "User1 Chat",
      );
      expect(chatId).not.toBeNull();

      // user2 must not be able to read user1's chat
      const entry = await h2.loadChat(chatId!);
      expect(entry).toBeNull();
    });

    it("should return a legacy record (no userOrgKey) for the same user context", async () => {
      // Legacy records have no userOrgKey — the composable allows them through
      const { loadChat } = useChatHistory(() => USER1, () => ORG1);

      // First: ensure DB is initialised by doing a read
      await useChatHistory(() => USER1, () => ORG1).loadHistory();

      const legacyId = 777;
      const storeRecords = dbRegistry
        .get("o2ChatDB")!
        .db._stores.get("chatHistory")!.records;
      storeRecords.set(legacyId, {
        id: legacyId,
        timestamp: "2023-01-01T00:00:00.000Z",
        title: "Legacy Chat",
        messages: [],
        sessionId: "legacy-session",
        // no userOrgKey property
      });

      const entry = await loadChat(legacyId);
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe("Legacy Chat");
    });
  });

  // -------------------------------------------------------------------------
  describe("deleteChatById", () => {
    it("should delete an owned record and return true", async () => {
      const { saveToHistory, deleteChatById, loadChat } = useChatHistory(
        () => USER1,
        () => ORG1,
      );
      const chatId = await saveToHistory(
        makeMessages(1),
        "s-del-1",
        "To Delete",
      );
      expect(chatId).not.toBeNull();

      const deleted = await deleteChatById(chatId!);
      expect(deleted).toBe(true);

      const entry = await loadChat(chatId!);
      expect(entry).toBeNull();
    });

    it("should return false when the chatId does not exist", async () => {
      const { deleteChatById } = useChatHistory(() => USER1, () => ORG1);
      // Initialise DB first
      await useChatHistory(() => USER1, () => ORG1).loadHistory();
      const result = await deleteChatById(99999);
      expect(result).toBe(false);
    });

    it("should return false when the record belongs to a different user+org", async () => {
      const h1 = useChatHistory(() => USER1, () => ORG1);
      const h2 = useChatHistory(() => USER2, () => ORG2);

      const chatId = await h1.saveToHistory(
        makeMessages(1),
        "s-del-cross",
        "User1 Chat",
      );
      expect(chatId).not.toBeNull();

      const result = await h2.deleteChatById(chatId!);
      expect(result).toBe(false);

      // Original record must still exist for user1
      const entry = await h1.loadChat(chatId!);
      expect(entry).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("clearAllHistory", () => {
    it("should return true and remove all records for the current user+org", async () => {
      const composable = useChatHistory(() => USER1, () => ORG1);
      const { clearAllHistory, loadHistory } = composable;

      await saveUnique(composable, makeMessages(1), "s1", "Chat 1");
      await saveUnique(composable, makeMessages(1), "s2", "Chat 2");

      const result = await clearAllHistory();
      expect(result).toBe(true);

      const history = await loadHistory();
      expect(history).toHaveLength(0);
    });

    it("should return true even when there is no history to clear", async () => {
      const { clearAllHistory } = useChatHistory(() => USER1, () => ORG1);
      // Initialise DB
      await useChatHistory(() => USER1, () => ORG1).loadHistory();
      const result = await clearAllHistory();
      expect(result).toBe(true);
    });

    it("should only delete records for the current user+org, leaving others intact", async () => {
      const h1 = useChatHistory(() => USER1, () => ORG1);
      const h2 = useChatHistory(() => USER2, () => ORG2);

      await saveUnique(h1, makeMessages(1), "s1", "User1 Chat 1");
      await saveUnique(h1, makeMessages(1), "s2", "User1 Chat 2");
      await saveUnique(h2, makeMessages(1), "s3", "User2 Chat 1");

      const cleared = await h1.clearAllHistory();
      expect(cleared).toBe(true);

      const user1History = await h1.loadHistory();
      expect(user1History).toHaveLength(0);

      const user2History = await h2.loadHistory();
      expect(user2History).toHaveLength(1);
      expect(user2History[0].title).toBe("User2 Chat 1");
    });
  });

  // -------------------------------------------------------------------------
  describe("updateChatTitle", () => {
    it("should update the title and return true for an owned record", async () => {
      const { saveToHistory, updateChatTitle, loadChat } = useChatHistory(
        () => USER1,
        () => ORG1,
      );
      const chatId = await saveToHistory(
        makeMessages(1),
        "s-upd-1",
        "Old Title",
      );
      expect(chatId).not.toBeNull();

      const result = await updateChatTitle(chatId!, "New Title");
      expect(result).toBe(true);

      const entry = await loadChat(chatId!);
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe("New Title");
    });

    it("should return false when the chatId does not exist", async () => {
      const { updateChatTitle } = useChatHistory(() => USER1, () => ORG1);
      // Initialise DB
      await useChatHistory(() => USER1, () => ORG1).loadHistory();
      const result = await updateChatTitle(99999, "Any Title");
      expect(result).toBe(false);
    });

    it("should return false when the record belongs to a different user+org", async () => {
      const h1 = useChatHistory(() => USER1, () => ORG1);
      const h2 = useChatHistory(() => USER2, () => ORG2);

      const chatId = await h1.saveToHistory(
        makeMessages(1),
        "s-upd-cross",
        "Original",
      );
      expect(chatId).not.toBeNull();

      const result = await h2.updateChatTitle(chatId!, "Hijacked Title");
      expect(result).toBe(false);

      // Title must remain unchanged for user1
      const entry = await h1.loadChat(chatId!);
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe("Original");
    });
  });

  // -------------------------------------------------------------------------
  describe("user+org isolation", () => {
    it("should produce different userOrgKeys for different user+org combinations", async () => {
      const key1 = await resolveKey(USER1, ORG1);
      const key2 = await resolveKey(USER2, ORG2);
      const key3 = await resolveKey(USER1, ORG2);
      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });

    it("should produce the same userOrgKey for repeated calls with the same email+org", async () => {
      const key1 = await resolveKey(USER1, ORG1);
      const key2 = await resolveKey(USER1, ORG1);
      expect(key1).toBe(key2);
    });

    it("should not return another user's chats via loadHistory", async () => {
      const h1 = useChatHistory(() => USER1, () => ORG1);
      const h2 = useChatHistory(() => USER2, () => ORG2);

      for (let i = 0; i < 3; i++) {
        await saveUnique(h1, makeMessages(1), `s1-${i}`, `User1 Chat ${i}`);
      }
      for (let i = 0; i < 2; i++) {
        await saveUnique(h2, makeMessages(1), `s2-${i}`, `User2 Chat ${i}`);
      }

      const h1History = await h1.loadHistory();
      const h2History = await h2.loadHistory();

      expect(h1History).toHaveLength(3);
      expect(h2History).toHaveLength(2);

      h1History.forEach((entry) => expect(entry.title).toMatch(/^User1/));
      h2History.forEach((entry) => expect(entry.title).toMatch(/^User2/));
    });

    it("should not allow loadChat to return a record owned by another user+org", async () => {
      const h1 = useChatHistory(() => USER1, () => ORG1);
      const h2 = useChatHistory(() => USER2, () => ORG2);

      const chatId = await h1.saveToHistory(
        makeMessages(2),
        "s-iso-load",
        "Isolated Chat",
      );
      expect(chatId).not.toBeNull();

      expect(await h2.loadChat(chatId!)).toBeNull();
      expect(await h1.loadChat(chatId!)).not.toBeNull();
    });

    it("should not allow deleteChatById to delete a record owned by another user+org", async () => {
      const h1 = useChatHistory(() => USER1, () => ORG1);
      const h2 = useChatHistory(() => USER2, () => ORG2);

      const chatId = await h1.saveToHistory(
        makeMessages(1),
        "s-iso-del",
        "Should Stay",
      );
      expect(chatId).not.toBeNull();

      expect(await h2.deleteChatById(chatId!)).toBe(false);
      expect(await h1.loadChat(chatId!)).not.toBeNull();
    });

    it("should not allow clearAllHistory to delete records owned by another user+org", async () => {
      const h1 = useChatHistory(() => USER1, () => ORG1);
      const h2 = useChatHistory(() => USER2, () => ORG2);

      await saveUnique(h1, makeMessages(1), "s-clear-1", "User1 A");
      await saveUnique(h1, makeMessages(1), "s-clear-2", "User1 B");
      await saveUnique(h2, makeMessages(1), "s-clear-3", "User2 A");

      await h2.clearAllHistory();

      expect(await h2.loadHistory()).toHaveLength(0);
      expect(await h1.loadHistory()).toHaveLength(2);
    });

    it("should not allow updateChatTitle to modify a record owned by another user+org", async () => {
      const h1 = useChatHistory(() => USER1, () => ORG1);
      const h2 = useChatHistory(() => USER2, () => ORG2);

      const chatId = await h1.saveToHistory(
        makeMessages(1),
        "s-iso-upd",
        "Protected Title",
      );
      expect(chatId).not.toBeNull();

      expect(await h2.updateChatTitle(chatId!, "Tampered")).toBe(false);

      const entry = await h1.loadChat(chatId!);
      expect(entry).not.toBeNull();
      expect(entry!.title).toBe("Protected Title");
    });

    it("should scope the userOrgKey cache per composable instance", async () => {
      // Two instances for different user+org pairs created from the same factory call
      const h1 = useChatHistory(() => USER1, () => ORG1);
      const h2 = useChatHistory(() => USER2, () => ORG2);

      const id1 = await saveUnique(
        h1,
        makeMessages(1),
        "key-cache-1",
        "H1 Chat",
      );
      const id2 = await saveUnique(
        h2,
        makeMessages(1),
        "key-cache-2",
        "H2 Chat",
      );

      expect(id1).not.toBeNull();
      expect(id2).not.toBeNull();

      // Each instance must only see its own record
      expect(await h1.loadChat(id2!)).toBeNull();
      expect(await h2.loadChat(id1!)).toBeNull();
    });

    it("should recompute the hash when the org getter returns a new value", async () => {
      // Simulate an org switch by using a mutable variable as the getter source
      let currentOrg = ORG1;
      const composable = useChatHistory(() => USER1, () => currentOrg);

      // Save a chat while in ORG1
      const chatIdOrg1 = await composable.saveToHistory(
        makeMessages(1),
        "s-switch-1",
        "Org1 Chat",
      );
      expect(chatIdOrg1).not.toBeNull();

      // Switch to ORG2 — the getter now returns ORG2
      currentOrg = ORG2;

      // Save a chat while in ORG2
      const chatIdOrg2 = await composable.saveToHistory(
        makeMessages(1),
        "s-switch-2",
        "Org2 Chat",
      );
      expect(chatIdOrg2).not.toBeNull();

      // History after the switch should only show ORG2's chat
      const historyOrg2 = await composable.loadHistory();
      expect(historyOrg2).toHaveLength(1);
      expect(historyOrg2[0].title).toBe("Org2 Chat");

      // Switch back to ORG1 — should see only ORG1's chat
      currentOrg = ORG1;
      const historyOrg1 = await composable.loadHistory();
      expect(historyOrg1).toHaveLength(1);
      expect(historyOrg1[0].title).toBe("Org1 Chat");
    });
  });
});
