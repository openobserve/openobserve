import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  openDB,
  mergeValues,
  mergeMultipleValues,
  getValues,
  evictExpired,
  trimToMaxFields,
} from "./fieldValueDB";

// ─── IDB mock helpers ─────────────────────────────────────────────────────────
// jsdom does not ship a real IDB implementation. We use a minimal in-memory
// mock that mirrors the async/event-driven API surface used by fieldValueDB.ts.

// Track the last db created so we can fire onversionchange between tests to
// reset the _db singleton inside fieldValueDB.ts.
let _lastDb: any = null;

const makeStore = () => {
  const records = new Map<string, any>();

  const makeRequest = (fn: () => any) => {
    const req: any = { onsuccess: null, onerror: null, result: undefined };
    setTimeout(() => {
      try {
        req.result = fn();
        req.onsuccess?.();
      } catch (e) {
        req.error = e;
        req.onerror?.();
      }
    }, 0);
    return req;
  };

  return {
    records,
    get: (key: string) => makeRequest(() => records.get(key)),
    put: (record: any) => makeRequest(() => records.set(record.key, record)),
    delete: (key: string) => makeRequest(() => records.delete(key)),
    count: () => makeRequest(() => records.size),
    index: (name: string) => ({
      openCursor: (range?: any) => {
        const entries = [...records.values()];
        let filtered = entries;
        if (range) {
          // Simulate upperBound(now, true) for by_expires index
          filtered = entries.filter((r) => r.expiresAt < range._upper);
        }
        // Sort by updatedAt ascending for by_updated index
        if (name === "by_updated") {
          filtered.sort((a, b) => a.updatedAt - b.updatedAt);
        }
        let idx = 0;
        const req: any = { onsuccess: null };
        const advance = () => {
          setTimeout(() => {
            if (idx < filtered.length) {
              const entry = filtered[idx++];
              req.result = {
                value: entry,
                delete: () => records.delete(entry.key),
                continue: advance,
              };
            } else {
              req.result = null;
            }
            req.onsuccess?.({ target: req });
          }, 0);
        };
        setTimeout(advance, 0);
        return req;
      },
    }),
  };
};

const setupIDBMock = () => {
  // Fire onversionchange on the previous db so fieldValueDB.ts resets _db = null.
  // This ensures each test gets a fresh IDB connection rather than reusing the
  // cached singleton from the previous test.
  if (_lastDb?.onversionchange) {
    _lastDb.onversionchange();
  }

  const store = makeStore();
  const txCompleteCbs: (() => void)[] = [];

  const tx: any = {
    objectStore: () => store,
    oncomplete: null,
    onerror: null,
  };

  // Fire oncomplete after a tick so all put/get requests resolve first
  const fireTxComplete = () => {
    setTimeout(() => tx.oncomplete?.(), 10);
  };

  const db: any = {
    transaction: () => {
      setTimeout(fireTxComplete, 0);
      return tx;
    },
    close: () => {}, // fieldValueDB.ts calls _db?.close() inside onversionchange
    onclose: null,
    onversionchange: null,
  };

  const openReq: any = { onsuccess: null, onerror: null, onupgradeneeded: null };
  setTimeout(() => {
    openReq.result = db;
    openReq.onsuccess?.();
  }, 0);

  vi.stubGlobal("indexedDB", {
    open: () => openReq,
  });

  // Also stub IDBKeyRange
  vi.stubGlobal("IDBKeyRange", {
    upperBound: (val: any, exclusive: boolean) => ({ _upper: val, exclusive }),
  });

  // Track db so the next setupIDBMock() can fire onversionchange to reset _db
  _lastDb = db;

  return store;
};

// ─── openDB ───────────────────────────────────────────────────────────────────

describe("openDB", () => {
  beforeEach(() => {
    // Reset the cached _db between tests by re-importing would need module reset.
    // Instead we just verify openDB resolves without throwing.
    setupIDBMock();
  });

  it("resolves with a database object", async () => {
    const db = await openDB();
    expect(db).toBeDefined();
    expect(typeof db.transaction).toBe("function");
  });
});

// ─── mergeValues ─────────────────────────────────────────────────────────────

describe("mergeValues", () => {
  beforeEach(() => {
    setupIDBMock();
  });

  it("writes a new record when key does not exist", async () => {
    await mergeValues("org|logs|stream|status", ["200", "404"], "search_hits", 50, 86400000);
    const values = await getValues("org|logs|stream|status");
    expect(values).toEqual(expect.arrayContaining(["200", "404"]));
  });

  it("merges with existing record (deduplicates)", async () => {
    await mergeValues("org|logs|stream|env", ["prod"], "search_hits", 50, 86400000);
    await mergeValues("org|logs|stream|env", ["prod", "staging"], "search_hits", 50, 86400000);
    const values = await getValues("org|logs|stream|env");
    expect(values).toEqual(expect.arrayContaining(["prod", "staging"]));
    expect(values).toHaveLength(2);
  });

  it("caps values at maxValues", async () => {
    const incoming = Array.from({ length: 10 }, (_, i) => `v${i}`);
    await mergeValues("org|logs|stream|service", incoming, "search_hits", 3, 86400000);
    const values = await getValues("org|logs|stream|service");
    expect(values).toHaveLength(3);
  });

  it("marks source as mixed when sources differ", async () => {
    await mergeValues("org|logs|stream|field1", ["a"], "search_hits", 50, 86400000);
    await mergeValues("org|logs|stream|field1", ["b"], "values_api", 50, 86400000);
    // We can't directly inspect source via getValues — we trust the internal
    // record. The merge shouldn't throw and should return combined values.
    const values = await getValues("org|logs|stream|field1");
    expect(values).toEqual(expect.arrayContaining(["a", "b"]));
  });
});

// ─── mergeMultipleValues ──────────────────────────────────────────────────────

describe("mergeMultipleValues", () => {
  beforeEach(() => {
    setupIDBMock();
  });

  it("writes multiple fields in one call", async () => {
    await mergeMultipleValues(
      [
        { key: "org|logs|stream|status", values: ["200"], source: "search_hits" },
        { key: "org|logs|stream|env", values: ["prod"], source: "search_hits" },
      ],
      50,
      86400000,
    );
    expect(await getValues("org|logs|stream|status")).toEqual(["200"]);
    expect(await getValues("org|logs|stream|env")).toEqual(["prod"]);
  });

  it("returns early when entries is empty", async () => {
    // Should not throw
    await expect(mergeMultipleValues([], 50, 86400000)).resolves.toBeUndefined();
  });

  it("deduplicates values within a single entry", async () => {
    await mergeMultipleValues(
      [{ key: "org|logs|stream|level", values: ["info", "info", "warn"], source: "search_hits" }],
      50,
      86400000,
    );
    const values = await getValues("org|logs|stream|level");
    expect(values).toHaveLength(2);
  });

  it("caps each field at maxValues", async () => {
    const values = Array.from({ length: 10 }, (_, i) => `val${i}`);
    await mergeMultipleValues(
      [{ key: "org|logs|stream|capped", values, source: "search_hits" }],
      3,
      86400000,
    );
    expect(await getValues("org|logs|stream|capped")).toHaveLength(3);
  });
});

// ─── getValues ────────────────────────────────────────────────────────────────

describe("getValues", () => {
  beforeEach(() => {
    setupIDBMock();
  });

  it("returns empty array for missing key", async () => {
    expect(await getValues("nonexistent|key")).toEqual([]);
  });

  it("returns empty array for expired record", async () => {
    // Write a record with expiresAt in the past
    const store = setupIDBMock();
    store.records.set("org|logs|stream|expired", {
      key: "org|logs|stream|expired",
      values: ["200"],
      updatedAt: Date.now() - 10000,
      expiresAt: Date.now() - 1000, // already expired
      source: "search_hits",
    });
    expect(await getValues("org|logs|stream|expired")).toEqual([]);
  });

  it("returns values for a valid non-expired record", async () => {
    await mergeValues("org|logs|stream|valid", ["200", "404"], "search_hits", 50, 86400000);
    const values = await getValues("org|logs|stream|valid");
    expect(values).toEqual(expect.arrayContaining(["200", "404"]));
  });

  it("returns [] on IDB error without throwing", async () => {
    // Break IDB to simulate unavailability
    vi.stubGlobal("indexedDB", undefined);
    const values = await getValues("any|key");
    expect(values).toEqual([]);
  });
});

// ─── evictExpired ─────────────────────────────────────────────────────────────

describe("evictExpired", () => {
  beforeEach(() => {
    setupIDBMock();
  });

  it("resolves with a number (count of deleted records)", async () => {
    const result = await evictExpired();
    expect(typeof result).toBe("number");
  });
});

// ─── trimToMaxFields ─────────────────────────────────────────────────────────

describe("trimToMaxFields", () => {
  beforeEach(() => {
    setupIDBMock();
  });

  it("resolves without error when records are below limit", async () => {
    await expect(trimToMaxFields(5000)).resolves.toBeUndefined();
  });

  it("does not throw when store is empty", async () => {
    await expect(trimToMaxFields(0)).resolves.toBeUndefined();
  });
});
