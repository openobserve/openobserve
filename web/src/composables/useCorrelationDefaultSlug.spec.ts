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

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true", isCloud: "false" },
}));

import { loadIdentityConfig } from "@/utils/identityConfig";
import {
  clearSemanticGroupsCache,
  clearSemanticGroupsCacheForOrg,
} from "@/utils/semanticGroupsCache";
import serviceStreamsApi from "@/services/service_streams";

// ── localStorage helpers ──────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
  vi.mocked(loadIdentityConfig).mockReset();
  vi.mocked(serviceStreamsApi.getSemanticGroups).mockReset();
  clearCorrelationCache();
  clearSemanticGroupsCache();
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
    const result = extractCorrelationFilters("host = 'web-01' AND region = 'us-east'", [
      "host",
      "region",
    ]);
    expect(result).toEqual([
      { field: "host", value: "web-01" },
      { field: "region", value: "us-east" },
    ]);
  });

  it("strips SQL WHERE prefix before parsing", () => {
    const result = extractCorrelationFilters("SELECT * FROM \"logs\" WHERE host = 'web-01'", [
      "host",
    ]);
    expect(result).toEqual([{ field: "host", value: "web-01" }]);
  });

  it("updates existing field when it appears twice (last value wins)", () => {
    const result = extractCorrelationFilters("host = 'web-01' AND host = 'web-02'", ["host"]);
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

const deferGroups = () => {
  let release!: (v: { data: unknown }) => void;
  vi.mocked(serviceStreamsApi.getSemanticGroups).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }) as never,
  );
  return (data: unknown) => release({ data });
};
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── getCorrelationFieldNames ──────────────────────────────────────────────────

describe("getCorrelationFieldNames", () => {
  it("returns empty array when loadIdentityConfig throws", async () => {
    vi.mocked(loadIdentityConfig).mockRejectedValueOnce(new Error("network"));
    const result = await getCorrelationFieldNames("org1", "logs", "mystream", [{ name: "host" }]);
    expect(result).toEqual([]);
  });

  it("returns empty array when no tracked alias ids", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValueOnce({ tracked_alias_ids: [] });
    const result = await getCorrelationFieldNames("org1", "logs", "mystream", [{ name: "host" }]);
    expect(result).toEqual([]);
  });

  it("resolves aliasId directly when not in semantic groups but present in schema", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValueOnce({ tracked_alias_ids: ["host"] });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValueOnce({ data: [] });
    const result = await getCorrelationFieldNames("org1", "logs", "stream1", [{ name: "host" }]);
    expect(result).toEqual(["host"]);
  });

  it("resolves fields via semantic group mapping", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValueOnce({ tracked_alias_ids: ["alias1"] });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValueOnce({
      data: [{ id: "alias1", fields: ["host", "ip"] }],
    });
    const result = await getCorrelationFieldNames("org1", "logs", "stream2", [
      { name: "host" },
      { name: "region" },
    ]);
    expect(result).toEqual(["host"]);
  });

  it("caches results on second call", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["host"] });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({ data: [] });
    await getCorrelationFieldNames("org1", "logs", "cached-stream", [{ name: "host" }]);
    await getCorrelationFieldNames("org1", "logs", "cached-stream", [{ name: "host" }]);
    expect(loadIdentityConfig).toHaveBeenCalledTimes(1);
  });

  it("does not cache an empty match from a call made before the schema loaded", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["alias1"] });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({
      data: [{ id: "alias1", fields: ["host"] }],
    });

    expect(await getCorrelationFieldNames("org1", "logs", "late-schema", [])).toEqual([]);
    expect(
      await getCorrelationFieldNames("org1", "logs", "late-schema", [{ name: "host" }]),
    ).toEqual(["host"]);
  });

  it("sends no request while the stream schema is still empty", async () => {
    expect(await getCorrelationFieldNames("org1", "logs", "no-schema", [])).toEqual([]);
    expect(loadIdentityConfig).not.toHaveBeenCalled();
    expect(serviceStreamsApi.getSemanticGroups).not.toHaveBeenCalled();
  });

  it("still returns resolved field names while the schema is briefly empty", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["host"] });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({ data: [] });
    await getCorrelationFieldNames("org1", "logs", "reloading", [{ name: "host" }]);
    expect(await getCorrelationFieldNames("org1", "logs", "reloading", [])).toEqual(["host"]);
  });

  it("keeps logs and traces matches apart on the same stream name", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({
      tracked_alias_ids: ["host", "service_name"],
    });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({ data: [] });
    expect(await getCorrelationFieldNames("org1", "logs", "default", [{ name: "host" }])).toEqual([
      "host",
    ]);
    expect(
      await getCorrelationFieldNames("org1", "traces", "default", [{ name: "service_name" }]),
    ).toEqual(["service_name"]);
    expect(await getCorrelationFieldNames("org1", "logs", "default", [{ name: "host" }])).toEqual([
      "host",
    ]);
  });

  it("resolves concurrent cold-cache callers with one groups lookup", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["host"] });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({ data: [] });
    await Promise.all(
      Array.from({ length: 6 }, () =>
        getCorrelationFieldNames("org1", "logs", "one-lookup", [{ name: "host" }]),
      ),
    );
    expect(serviceStreamsApi.getSemanticGroups).toHaveBeenCalledTimes(1);
  });

  it("uses identity settings that change while a groups lookup is pending", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["machine"] });
    const release = deferGroups();
    const before = getCorrelationFieldNames("org1", "logs", "old-stream", [{ name: "host" }]);
    await tick();
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["environment"] });
    const after = getCorrelationFieldNames("org1", "logs", "new-stream", [{ name: "namespace" }]);
    release([
      { id: "machine", fields: ["host"] },
      { id: "environment", fields: ["namespace"] },
    ]);
    expect(await before).toEqual(["host"]);
    expect(await after).toEqual(["namespace"]);
  });

  it("logs a failed groups load once for a burst of concurrent callers", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["host"] });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockRejectedValue({ response: { status: 500 } });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        getCorrelationFieldNames("org1", "logs", "failing", [{ name: "host" }]),
      ),
    );
    expect(results.every((r) => r.length === 1 && r[0] === "host")).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("treats a groups response with no data as no groups", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["alias1"] });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({ data: undefined } as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getCorrelationFieldNames("org1", "logs", "no-data", [{ name: "alias1" }])).toEqual(
      ["alias1"],
    );
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("matches each concurrent caller against its own schema", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({
      tracked_alias_ids: ["host", "service_name"],
    });
    const release = deferGroups();
    const logs = getCorrelationFieldNames("org1", "logs", "default", [{ name: "host" }]);
    const traces = getCorrelationFieldNames("org1", "traces", "default", [
      { name: "service_name" },
    ]);
    await tick();
    release([]);
    expect(await logs).toEqual(["host"]);
    expect(await traces).toEqual(["service_name"]);
  });

  it("resolves the newer schema when it replaces stale fields during a lookup", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["host"] });
    const release = deferGroups();
    const stale = getCorrelationFieldNames("org1", "logs", "swap", [{ name: "_timestamp" }]);
    const fresh = getCorrelationFieldNames("org1", "logs", "swap", [{ name: "host" }]);
    await tick();
    release([]);
    expect(await stale).toEqual([]);
    expect(await fresh).toEqual(["host"]);
    expect(await getCorrelationFieldNames("org1", "logs", "swap", [{ name: "host" }])).toEqual([
      "host",
    ]);
  });

  it("does not cache a lookup that finishes after switching to another org", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["host"] });
    const release = deferGroups();
    const schema = [{ name: "host" }, { name: "service_name" }];
    const abandoned = getCorrelationFieldNames("org1", "logs", "s", schema);
    await tick();
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({ data: [] });
    await getCorrelationFieldNames("org2", "logs", "s", schema);
    release([]);
    expect(await abandoned).toEqual(["host"]);
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["service_name"] });
    expect(await getCorrelationFieldNames("org1", "logs", "s", schema)).toEqual(["service_name"]);
  });

  it("recomputes with the current identity config when returning to an org mid-lookup", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["host"] });
    const release = deferGroups();
    const schema = [{ name: "host" }, { name: "service_name" }];
    const abandoned = getCorrelationFieldNames("org1", "logs", "s", schema);
    await tick();
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({ data: [] });
    await getCorrelationFieldNames("org2", "logs", "s", schema);
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["service_name"] });
    const back = getCorrelationFieldNames("org1", "logs", "s", schema);
    release([]);
    await abandoned;
    expect(await back).toEqual(["service_name"]);
  });

  it("does not cache an empty match when the shared groups request is cancelled", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["machine"] });
    const release = deferGroups();
    const cancelled = getCorrelationFieldNames("org1", "logs", "cancel", [{ name: "host" }]);
    await tick();
    clearSemanticGroupsCacheForOrg("org1");
    expect(await cancelled).toEqual([]);
    release([{ id: "machine", fields: ["host"] }]);
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({
      data: [{ id: "machine", fields: ["host"] }],
    });
    expect(await getCorrelationFieldNames("org1", "logs", "cancel", [{ name: "host" }])).toEqual([
      "host",
    ]);
  });

  it("reloads semantic mappings after clearCorrelationCache", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["machine"] });
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({
      data: [{ id: "machine", fields: ["host"] }],
    });
    const schema = [{ name: "host" }, { name: "hostname" }];
    expect(await getCorrelationFieldNames("org1", "logs", "reset", schema)).toEqual(["host"]);
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({
      data: [{ id: "machine", fields: ["hostname"] }],
    });
    clearCorrelationCache();
    expect(await getCorrelationFieldNames("org1", "logs", "reset", schema)).toEqual(["hostname"]);
  });

  it("shares one semantic-groups request across concurrent cold-cache callers", async () => {
    vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["alias1"] });
    let release!: (v: { data: unknown }) => void;
    vi.mocked(serviceStreamsApi.getSemanticGroups).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );

    const calls = Array.from({ length: 8 }, () =>
      getCorrelationFieldNames("org1", "logs", "burst-stream", [{ name: "host" }]),
    );
    await new Promise((r) => setTimeout(r, 0));
    release({ data: [{ id: "alias1", fields: ["host"] }] });

    const results = await Promise.all(calls);
    expect(serviceStreamsApi.getSemanticGroups).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.length === 1 && r[0] === "host")).toBe(true);
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
      setQuery: vi.fn((q: string) => {
        query = q;
      }),
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

    it("fires one semantic-groups request for a burst of per-chunk saves", async () => {
      vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["host"] });
      vi.mocked(serviceStreamsApi.getSemanticGroups).mockResolvedValue({ data: [] });

      const opts = makeOpts({ getQuery: () => `SELECT * FROM "default" WHERE host = 'web-01'` });
      const { save } = useCorrelationFilters(opts);
      await Promise.all(Array.from({ length: 10 }, () => save()));

      expect(serviceStreamsApi.getSemanticGroups).toHaveBeenCalledTimes(1);
      expect(loadCorrelationFilters("org1", "logs", "mystream")).toEqual([
        { field: "host", value: "web-01" },
      ]);
    });

    it("keeps saved alias filters when the shared groups load is cancelled", async () => {
      vi.mocked(loadIdentityConfig).mockResolvedValue({ tracked_alias_ids: ["host", "machine"] });
      const release = deferGroups();
      saveCorrelationFilters("org1", "logs", "mystream", [{ field: "hostname", value: "web-01" }]);
      const opts = makeOpts({
        getQuery: () => "hostname = 'web-01'",
        streamSchemaFields: () => [{ name: "host" }, { name: "hostname" }],
      });
      const saving = useCorrelationFilters(opts).save();
      await tick();
      clearSemanticGroupsCacheForOrg("org1");
      await saving;
      release([{ id: "machine", fields: ["hostname"] }]);
      expect(loadCorrelationFilters("org1", "logs", "mystream")).toEqual([
        { field: "hostname", value: "web-01" },
      ]);
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
