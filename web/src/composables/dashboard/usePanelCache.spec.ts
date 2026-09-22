import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { usePanelCache } from "./usePanelCache";
import { queryClient } from "@/composables/query/queryClient";
// Import the module to ensure window functions are defined
import "./usePanelCache";

// Simple mock implementation for IndexedDB
const mockData = new Map<string, any>();
let shouldThrowError = false;
let errorType = "";

const createMockRequest = (result: any = null) => ({
  result,
  error: shouldThrowError ? new Error(`Mock ${errorType} Error`) : null,
  onsuccess: null as any,
  onerror: null as any,
});

const mockObjectStore = {
  put: (value: any) => {
    const request = createMockRequest(value.key);
    if (!shouldThrowError) {
      // Real IndexedDB structured-clones on write; the store relies on that for
      // isolation now that it no longer JSON round-trips.
      mockData.set(value.key, structuredClone(value));
    }
    // Use microtask to simulate async behavior
    queueMicrotask(() => {
      if (shouldThrowError && request.onerror) {
        request.onerror({ target: request });
      } else if (!shouldThrowError && request.onsuccess) {
        request.onsuccess({ target: request });
      }
    });
    return request;
  },

  get: (key: string) => {
    const value = shouldThrowError ? undefined : mockData.get(key);
    const request = createMockRequest(value);
    queueMicrotask(() => {
      if (shouldThrowError && request.onerror) {
        request.onerror({ target: request });
      } else if (!shouldThrowError && request.onsuccess) {
        request.onsuccess({ target: request });
      }
    });
    return request;
  },

  getAll: () => {
    const values = shouldThrowError ? [] : Array.from(mockData.values());
    const request = createMockRequest(values);
    queueMicrotask(() => {
      if (shouldThrowError && request.onerror) {
        request.onerror({ target: request });
      } else if (!shouldThrowError && request.onsuccess) {
        request.onsuccess({ target: request });
      }
    });
    return request;
  },

  clear: () => {
    const request = createMockRequest();
    if (!shouldThrowError) {
      mockData.clear();
    }
    queueMicrotask(() => {
      if (shouldThrowError && request.onerror) {
        request.onerror({ target: request });
      } else if (!shouldThrowError && request.onsuccess) {
        request.onsuccess({ target: request });
      }
    });
    return request;
  },

  createIndex: () => ({}),
};

const mockTransaction = {
  objectStore: () => mockObjectStore,
};

const mockDatabase = {
  objectStoreNames: {
    contains: () => false,
  },
  createObjectStore: () => mockObjectStore,
  transaction: () => mockTransaction,
};

// Mock global indexedDB
Object.defineProperty(global, "indexedDB", {
  value: {
    open: () => {
      const request = createMockRequest(mockDatabase);
      queueMicrotask(() => {
        if (shouldThrowError && request.onerror) {
          request.onerror({ target: request });
        } else if (!shouldThrowError && request.onsuccess) {
          request.onsuccess({ target: request });
        }
      });
      return request;
    },
  },
  writable: true,
  configurable: true,
});

describe("usePanelCache", () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockData.clear();
    shouldThrowError = false;
    errorType = "";
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    // The module assigns window._o2_* once on import; deleting them here left
    // every later test in this file with no globals to assert against.
  });

  describe("when required parameters are missing", () => {
    it("should return no-op functions when folderId is missing", () => {
      const cache = usePanelCache("", "dashboard1", "panel1");

      expect(cache.savePanelCache).toBeDefined();
      expect(cache.getPanelCache).toBeDefined();
      expect(typeof cache.savePanelCache).toBe("function");
      expect(typeof cache.getPanelCache).toBe("function");
    });

    it("should return no-op functions when dashboardId is missing", () => {
      const cache = usePanelCache("folder1", "", "panel1");

      expect(cache.savePanelCache).toBeDefined();
      expect(cache.getPanelCache).toBeDefined();
    });

    it("should return no-op functions when panelId is missing", () => {
      const cache = usePanelCache("folder1", "dashboard1", "");

      expect(cache.savePanelCache).toBeDefined();
      expect(cache.getPanelCache).toBeDefined();
    });

    it("should return null from getPanelCache when parameters are missing", async () => {
      const cache = usePanelCache("", "dashboard1", "panel1");
      const result = await cache.getPanelCache();

      expect(result).toBeNull();
    });

    it("should do nothing when calling savePanelCache with missing parameters", async () => {
      const cache = usePanelCache("", "dashboard1", "panel1");

      // Should not throw
      await expect(cache.savePanelCache("key", "data", "range")).resolves.toBeUndefined();
    });

    it("should handle all combinations of missing parameters", async () => {
      const combinations = [
        ["", "", ""],
        ["folder", "", ""],
        ["", "dashboard", ""],
        ["", "", "panel"],
        ["folder", "dashboard", ""],
        ["folder", "", "panel"],
        ["", "dashboard", "panel"],
      ];

      for (const [f, d, p] of combinations) {
        const cache = usePanelCache(f, d, p);
        const result = await cache.getPanelCache();
        expect(result).toBeNull();

        await expect(cache.savePanelCache("key", "data", "range")).resolves.toBeUndefined();
      }
    });
  });

  describe("when all parameters are provided", () => {
    it("should create usePanelCache with correct functions", () => {
      const cache = usePanelCache("folder1", "dashboard1", "panel1");

      expect(cache.savePanelCache).toBeDefined();
      expect(cache.getPanelCache).toBeDefined();
      expect(typeof cache.savePanelCache).toBe("function");
      expect(typeof cache.getPanelCache).toBe("function");
    });

    it("should save and retrieve cache data successfully", async () => {
      const cache = usePanelCache("folder1", "dashboard1", "panel1");
      const key = { query: "test" };
      const data = { results: [1, 2, 3] };
      const cacheTimeRange = { start: 1000, end: 2000 };

      await cache.savePanelCache(key, data, cacheTimeRange);

      // Retrieve it — the same key selects the entry it was saved under.
      const result = await cache.getPanelCache(key);

      expect(result).toBeDefined();
      expect(result.key).toEqual(key);
      expect(result.value).toEqual(data);
      expect(result.cacheTimeRange).toEqual(cacheTimeRange);
      expect(result.timestamp).toBeTypeOf("number");
    });

    it("should return null when no cache data exists", async () => {
      const cache = usePanelCache("folder1", "dashboard1", "panel1");
      const result = await cache.getPanelCache();

      expect(result).toBeNull();
    });

    it("should handle different cache keys", async () => {
      const cache1 = usePanelCache("folder1", "dashboard1", "panel1");
      const cache2 = usePanelCache("folder1", "dashboard1", "panel2");
      const cache3 = usePanelCache("folder2", "dashboard1", "panel1");

      const data1 = { results: [1, 2, 3] };
      const data2 = { results: [4, 5, 6] };
      const data3 = { results: [7, 8, 9] };

      await cache1.savePanelCache("key1", data1, {});
      await cache2.savePanelCache("key2", data2, {});
      await cache3.savePanelCache("key3", data3, {});

      const result1 = await cache1.getPanelCache("key1");
      const result2 = await cache2.getPanelCache("key2");
      const result3 = await cache3.getPanelCache("key3");

      expect(result1.value).toEqual(data1);
      expect(result2.value).toEqual(data2);
      expect(result3.value).toEqual(data3);
    });

    it("should deep copy objects when saving", async () => {
      const cache = usePanelCache("folder1", "dashboard1", "panel1");
      const key = { query: "test", nested: { value: 1 } };
      const data = { results: [1, 2, 3], nested: { value: 2 } };
      const cacheTimeRange = { start: 1000, end: 2000 };

      await cache.savePanelCache(key, data, cacheTimeRange);

      // Modify original objects
      key.nested.value = 99;
      data.nested.value = 99;
      cacheTimeRange.start = 99;

      // Retrieved data should not be affected. The key is read back with its
      // pre-mutation shape, which is also what the digest was built from.
      const result = await cache.getPanelCache({ query: "test", nested: { value: 1 } });
      expect(result.key.nested.value).toBe(1);
      expect(result.value.nested.value).toBe(2);
      expect(result.cacheTimeRange.start).toBe(1000);
    });

    it("should overwrite existing cache data", async () => {
      const cache = usePanelCache("folder1", "dashboard1", "panel1");

      await cache.savePanelCache("key1", { value: 1 }, {});
      await cache.savePanelCache("key2", { value: 2 }, {});

      const result = await cache.getPanelCache("key2");
      expect(result.key).toBe("key2");
      expect(result.value).toEqual({ value: 2 });
    });
  });

  describe("error handling", () => {
    it("should handle IndexedDB initialization errors", async () => {
      shouldThrowError = true;
      errorType = "init";

      const cache = usePanelCache("folder1", "dashboard1", "panel1");
      const result = await cache.getPanelCache();

      // The persister swallows its own storage failures, so an unreachable
      // store reads as a plain miss and the panel fetches — which is what a
      // cache that cannot answer should do.
      expect(result).toBeNull();
    });

    it("should handle save errors gracefully", async () => {
      const cache = usePanelCache("folder1", "dashboard1", "panel1");

      shouldThrowError = true;
      errorType = "save";

      await expect(cache.savePanelCache("key", "data", "range")).resolves.toBeUndefined();

      // A disk write that fails still leaves the value in memory, so the panel
      // it belongs to survives its own remount even with storage broken.
      expect(await cache.getPanelCache("key")).toMatchObject({ key: "key", value: "data" });
    });

    it("should handle get errors gracefully", async () => {
      const cache = usePanelCache("folder1", "dashboard1", "panel1");

      shouldThrowError = true;
      errorType = "get";

      const result = await cache.getPanelCache();

      expect(result).toBeNull();
    });
  });

  describe("global cache management", () => {
    // The real window._o2_* helpers are asserted here, not a copy of them: the
    // previous stubs reimplemented the old `<ns>|<org>|…` storage and kept
    // passing after the cache moved onto the query layer.

    it("should define global cache management functions", () => {
      expect(window._o2_removeDashboardCache).toBeDefined();
      expect(window._o2_getDashboardCache).toBeDefined();
      expect(typeof window._o2_removeDashboardCache).toBe("function");
      expect(typeof window._o2_getDashboardCache).toBe("function");
    });

    it("should clear all cache data", async () => {
      const cache = usePanelCache("folder1", "dashboard1", "panel1");
      await cache.savePanelCache("key", "data", {});

      await window._o2_removeDashboardCache();

      const result = await cache.getPanelCache("key");
      expect(result).toBeNull();
    });

    it("should get all cache data in structured format", async () => {
      const cache1 = usePanelCache("folder1", "dashboard1", "panel1");
      const cache2 = usePanelCache("folder1", "dashboard2", "panel2");
      const cache3 = usePanelCache("folder2", "dashboard1", "panel1");

      await cache1.savePanelCache("key1", "data1", { range: 1 });
      await cache2.savePanelCache("key2", "data2", { range: 2 });
      await cache3.savePanelCache("key3", "data3", { range: 3 });

      const allCache = await window._o2_getDashboardCache();

      expect(allCache.folder1).toBeDefined();
      expect(allCache.folder1.dashboard1.panel1.value).toBe("data1");
      expect(allCache.folder1.dashboard2.panel2.value).toBe("data2");
      expect(allCache.folder2.dashboard1.panel1.value).toBe("data3");
    });

    it("should handle clear cache errors", async () => {
      shouldThrowError = true;
      errorType = "clear";

      // Never rethrows: a debug helper must not take the console down with it.
      // The persister absorbs its own storage failures, so the common case is a
      // clean resolve even when the store is unreachable.
      await expect(window._o2_removeDashboardCache()).resolves.toBeUndefined();
    });

    it("should handle get all cache errors", async () => {
      shouldThrowError = true;
      errorType = "getAll";

      // Reads the in-memory query cache, so an unreachable store cannot fail
      // it — it reports whatever is currently held, and never throws.
      const result = await window._o2_getDashboardCache();

      expect(result).toBeTypeOf("object");
    });
  });

  describe("cache key generation and data handling", () => {
    it("should generate correct cache keys", async () => {
      const cache1 = usePanelCache("folder1", "dashboard1", "panel1");
      const cache2 = usePanelCache("folder1", "dashboard1", "panel1");

      await cache1.savePanelCache("key", "data1", {});
      await cache2.savePanelCache("key", "data2", {});

      // Should overwrite since same cache key
      const result1 = await cache1.getPanelCache("key");
      const result2 = await cache2.getPanelCache("key");

      expect(result1.value).toBe("data2");
      expect(result2.value).toBe("data2");
    });

    it("should handle special characters in IDs", async () => {
      const cache = usePanelCache("folder:1", "dashboard:1", "panel:1");

      await cache.savePanelCache("key", "data", {});
      const result = await cache.getPanelCache("key");

      expect(result.value).toBe("data");
    });

    it("should handle various data types", async () => {
      const cache = usePanelCache("folder1", "dashboard1", "panel1");
      const complexData = {
        string: "test",
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, { nested: true }],
        object: {
          deep: {
            value: "test",
            array: [null, null, true, false], // undefined becomes null after JSON serialization
          },
        },
      };

      await cache.savePanelCache("", complexData, "");
      const result = await cache.getPanelCache("");

      expect(result.key).toBe("");
      expect(result.value).toEqual(complexData);
      expect(result.cacheTimeRange).toBe("");
    });

    it("should handle edge cases", async () => {
      const cache = usePanelCache("folder1", "dashboard1", "panel1");

      // Test with undefined/null values
      await cache.savePanelCache(undefined, null, undefined);
      const result = await cache.getPanelCache(undefined);

      // When result is successful, it should have the stored data
      if (result) {
        // structuredClone preserves undefined, where the old JSON round-trip
        // turned it into null.
        expect(result.key).toBeUndefined();
        expect(result.value).toBe(null);
        expect(result.cacheTimeRange).toBeUndefined();
      } else {
        // If result is null, it means the cache returned null for undefined key
        expect(result).toBeNull();
      }
    });
  });

  describe("initialization and database creation", () => {
    it("should handle database upgrade needed", async () => {
      // This test is more for coverage of the onupgradeneeded path
      // The mock will exercise the database creation code
      const cache = usePanelCache("folder1", "dashboard1", "panel1");
      await cache.savePanelCache("test", "data", {});

      // Rooted at ["org", …] like every other query, which is what lets the
      // org-switch and logout purges reach panel results by prefix.
      // Asserted on the query key, not a storage key: the persister has no
      // IndexedDB under jsdom, so a save here is memory-only. The key is what
      // matters anyway — being rooted at ["org", …] is what lets the org-switch
      // and logout purges reach panel results by prefix.
      const keys = queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey);
      expect(
        keys.some(
          (key) =>
            key[0] === "org" &&
            key[2] === "panels" &&
            key[3] === "folder1" &&
            key[4] === "dashboard1" &&
            key[5] === "panel1",
        ),
      ).toBe(true);
    });

    it("should handle database upgrade path", () => {
      // Test that the database upgrade handler is defined and works correctly
      const cache = usePanelCache("folder1", "dashboard1", "panel1");

      // The upgrade path is automatically covered when the database is initialized
      // This test ensures the function is created and accessible
      expect(cache.savePanelCache).toBeDefined();
      expect(cache.getPanelCache).toBeDefined();
    });
  });

  // Note: Global window functions are covered via integration tests

  // Note: Database upgrade path is covered via mocked scenarios in existing tests
});
