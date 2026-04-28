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

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  extractCorrelationFilters,
  saveCorrelationFilters,
  loadCorrelationFilters,
  clearCorrelationFilters,
  buildCorrelationWhereClause,
  clearCorrelationCache,
  getCorrelationFieldNames,
  useCorrelationFilters,
  type SavedFilter,
} from "./useCorrelationDefaultSlug";

vi.mock("@/utils/identityConfig", () => ({
  loadIdentityConfig: vi.fn(),
}));

vi.mock("@/services/service_streams", () => ({
  default: {
    getSemanticGroups: vi.fn(),
  },
}));

import { loadIdentityConfig } from "@/utils/identityConfig";
import serviceStreamsApi from "@/services/service_streams";

// ── localStorage helpers ──────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
  clearCorrelationCache();
});

// ── extractCorrelationFilters ─────────────────────────────────────────────────

describe("extractCorrelationFilters", () => {
  it("returns empty array for empty query", () => {
    expect(extractCorrelationFilters("", ["host"])).toEqual([]);
  });

  it("returns empty array for empty tracked fields", () => {
    expect(extractCorrelationFilters("host = 'web-01'", [])).toEqual([]);
  });

  it("extracts a single matching field", () => {
    const result = extractCorrelationFilters("host = 'web-01'", ["host"]);
    expect(result).toEqual([{ field: "host", value: "web-01" }]);
  });

  it("ignores fields not in tracked list", () => {
    const result = extractCorrelationFilters("host = 'web-01' AND region = 'us'", ["host"]);
    expect(result).toEqual([{ field: "host", value: "web-01" }]);
  });

  it("extracts multiple tracked fields", () => {
    const result = extractCorrelationFilters(
      "host = 'web-01' AND region = 'us-east'",
      ["host", "region"],
    );
    expect(result).toEqual([
      { field: "host", value: "web-01" },
      { field: "region", value: "us-east" },
    ]);
  });

  it("strips SQL WHERE prefix before parsing", () => {
    const result = extractCorrelationFilters(
      "SELECT * FROM \"logs\" WHERE host = 'web-01'",
      ["host"],
    );
    expect(result).toEqual([{ field: "host", value: "web-01" }]);
  });

  it("updates existing field when it appears twice (last value wins)", () => {
    const result = extractCorrelationFilters(
      "host = 'web-01' AND host = 'web-02'",
      ["host"],
    );
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("web-02");
  });
});

// ── saveCorrelationFilters / loadCorrelationFilters ───────────────────────────

describe("saveCorrelationFilters", () => {
  it("stores filters in localStorage", () => {
    const filters: SavedFilter[] = [{ field: "host", value: "web-01" }];
    saveCorrelationFilters("org1", "logs", "mystream", filters);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "oo_correlation_filters_org1_logs_mystream",
      JSON.stringify(filters),
    );
  });

  it("does nothing when filters array is empty", () => {
    saveCorrelationFilters("org1", "logs", "mystream", []);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("does nothing when orgId is missing", () => {
    saveCorrelationFilters("", "logs", "mystream", [{ field: "host", value: "x" }]);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });
});

describe("loadCorrelationFilters", () => {
  it("returns stored filters", () => {
    const filters: SavedFilter[] = [{ field: "host", value: "web-01" }];
    saveCorrelationFilters("org1", "logs", "mystream", filters);
    expect(loadCorrelationFilters("org1", "logs", "mystream")).toEqual(filters);
  });

  it("returns empty array when key does not exist", () => {
    expect(loadCorrelationFilters("org1", "logs", "missing")).toEqual([]);
  });

  it("returns empty array on malformed JSON", () => {
    localStorageMock.getItem.mockReturnValueOnce("not-json{{{");
    expect(loadCorrelationFilters("org1", "logs", "mystream")).toEqual([]);
  });
});

// ── clearCorrelationFilters ───────────────────────────────────────────────────

describe("clearCorrelationFilters", () => {
  it("removes the localStorage key", () => {
    const filters: SavedFilter[] = [{ field: "host", value: "web-01" }];
    saveCorrelationFilters("org1", "logs", "mystream", filters);
    clearCorrelationFilters("org1", "logs", "mystream");
    expect(loadCorrelationFilters("org1", "logs", "mystream")).toEqual([]);
  });
});

// ── buildCorrelationWhereClause ───────────────────────────────────────────────

describe("buildCorrelationWhereClause", () => {
  it("returns empty string for empty filters", () => {
    expect(buildCorrelationWhereClause([])).toBe("");
  });

  it("builds a single condition", () => {
    expect(buildCorrelationWhereClause([{ field: "host", value: "web-01" }])).toBe(
      "host = 'web-01'",
    );
  });

  it("joins multiple conditions with AND", () => {
    const result = buildCorrelationWhereClause([
      { field: "host", value: "web-01" },
      { field: "region", value: "us-east" },
    ]);
    expect(result).toBe("host = 'web-01' AND region = 'us-east'");
  });

  it("escapes single quotes in values", () => {
    const result = buildCorrelationWhereClause([{ field: "name", value: "o'brien" }]);
    expect(result).toBe("name = 'o''brien'");
  });
});

// ── getCorrelationFieldNames ──────────────────────────────────────────────────

describe("getCorrelationFieldNames", () => {
  it("returns empty array when loadIdentityConfig throws", async () => {
    vi.mocked(loadIdentityConfig).mockRejectedValueOnce(new Error("network"));
    const result = await getCorrelationFieldNames("org1", "mystream", [{ name: "host" }]);
    expect(result).toEqual([]);
  });

  it("returns empty array when no tracked alias ids", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValueOnce({ tracked_alias_ids: [] });
    const result = await getCorrelationFieldNames("org1", "mystream", [{ name: "host" }]);
    expect(result).toEqual([]);
  });

  it("resolves aliasId directly when not in semantic groups but present in schema", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValueOnce({ tracked_alias_ids: ["host"] });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValueOnce({ data: [] });
    const result = await getCorrelationFieldNames("org1", "stream1", [{ name: "host" }]);
    expect(result).toEqual(["host"]);
  });

  it("resolves fields via semantic group mapping", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValueOnce({ tracked_alias_ids: ["alias1"] });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValueOnce({
      data: [{ id: "alias1", fields: ["host", "ip"] }],
    });
    const result = await getCorrelationFieldNames("org1", "stream2", [
      { name: "host" },
      { name: "region" },
    ]);
    expect(result).toEqual(["host"]);
  });

  it("caches results on second call", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["host"] });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({ data: [] });
    await getCorrelationFieldNames("org1", "cached-stream", [{ name: "host" }]);
    await getCorrelationFieldNames("org1", "cached-stream", [{ name: "host" }]);
    expect(loadIdentityConfig).toHaveBeenCalledTimes(1);
  });
});

// ── useCorrelationFilters composable ─────────────────────────────────────────

describe("useCorrelationFilters", () => {
  const makeOpts = (overrides: Partial<Parameters<typeof useCorrelationFilters>[0]> = {}) => {
    let query = "";
    return {
      orgId: () => "org1",
      streamType: () => "logs",
      streamName: () => "mystream",
      streamSchemaFields: () => [{ name: "host" }],
      getQuery: () => query,
      setQuery: vi.fn((q: string) => { query = q; }),
      ...overrides,
    };
  };

  describe("save / sync", () => {
    it("clears filters when query is empty", async () => {
      vi.mocked(loadIdentityConfig).mockResolvedValueOnce({ tracked_alias_ids: ["host"] });
      vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValueOnce({ data: [] });

      saveCorrelationFilters("org1", "logs", "mystream", [{ field: "host", value: "old" }]);
      const opts = makeOpts({ getQuery: () => "" });
      const { save } = useCorrelationFilters(opts);
      await save();
      expect(loadCorrelationFilters("org1", "logs", "mystream")).toEqual([]);
    });

    it("saves matched filters from query", async () => {
      vi.mocked(loadIdentityConfig).mockResolvedValueOnce({ tracked_alias_ids: ["host"] });
      vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValueOnce({ data: [] });

      const opts = makeOpts({ getQuery: () => "host = 'web-01'" });
      const { save } = useCorrelationFilters(opts);
      await save();
      expect(loadCorrelationFilters("org1", "logs", "mystream")).toEqual([
        { field: "host", value: "web-01" },
      ]);
    });

    it("clears filters when no tracked fields match query", async () => {
      vi.mocked(loadIdentityConfig).mockResolvedValueOnce({ tracked_alias_ids: ["host"] });
      vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValueOnce({ data: [] });

      saveCorrelationFilters("org1", "logs", "mystream", [{ field: "host", value: "old" }]);
      const opts = makeOpts({ getQuery: () => "region = 'us-east'" });
      const { save } = useCorrelationFilters(opts);
      await save();
      expect(loadCorrelationFilters("org1", "logs", "mystream")).toEqual([]);
    });

    it("does nothing when orgId is missing", async () => {
      const opts = makeOpts({ orgId: () => "", getQuery: () => "host = 'x'" });
      const { save } = useCorrelationFilters(opts);
      await save();
      expect(loadIdentityConfig).not.toHaveBeenCalled();
    });
  });

  describe("restore", () => {
    it("sets query from saved filters", () => {
      saveCorrelationFilters("org1", "logs", "mystream", [{ field: "host", value: "web-01" }]);
      const setQuery = vi.fn();
      const opts = makeOpts({ getQuery: () => "", setQuery });
      const { restore } = useCorrelationFilters(opts);
      restore();
      expect(setQuery).toHaveBeenCalledWith("host = 'web-01'");
    });

    it("does not overwrite existing query", () => {
      saveCorrelationFilters("org1", "logs", "mystream", [{ field: "host", value: "web-01" }]);
      const setQuery = vi.fn();
      const opts = makeOpts({ getQuery: () => "existing query", setQuery });
      const { restore } = useCorrelationFilters(opts);
      restore();
      expect(setQuery).not.toHaveBeenCalled();
    });

    it("does nothing when no saved filters", () => {
      const setQuery = vi.fn();
      const opts = makeOpts({ getQuery: () => "", setQuery });
      const { restore } = useCorrelationFilters(opts);
      restore();
      expect(setQuery).not.toHaveBeenCalled();
    });

    it("does nothing when orgId is missing", () => {
      const setQuery = vi.fn();
      const opts = makeOpts({ orgId: () => "", getQuery: () => "", setQuery });
      const { restore } = useCorrelationFilters(opts);
      restore();
      expect(setQuery).not.toHaveBeenCalled();
    });
  });
});
