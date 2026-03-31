import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock fieldValueDB ────────────────────────────────────────────────────────
vi.mock("@/composables/fieldValueDB", () => ({
  mergeValues: vi.fn().mockResolvedValue(undefined),
  mergeMultipleValues: vi.fn().mockResolvedValue(undefined),
  getValues: vi.fn().mockResolvedValue([]),
  evictExpired: vi.fn().mockResolvedValue(0),
  trimToMaxFields: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock extractValuesFromHits ───────────────────────────────────────────────
vi.mock("@/utils/fieldValueUtils", () => ({
  extractValuesFromHits: vi.fn().mockReturnValue({
    status: ["200", "404"],
    env: ["prod", "staging"],
  }),
}));

import * as fieldValueDB from "@/composables/fieldValueDB";
import { extractValuesFromHits } from "@/utils/fieldValueUtils";
import {
  captureFromSearchHits,
  captureFromValuesApi,
  getFieldValuesForSuggestion,
} from "./useFieldValueStore";

const ctx = { org: "myorg", streamType: "logs", streamName: "http_logs" };

// ─── scheduleWrite behaviour ─────────────────────────────────────────────────
// requestIdleCallback is not available in jsdom — our code falls back to
// setTimeout(0). We use vi.useFakeTimers() to control when those fire.

describe("captureFromSearchHits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when hits is empty", async () => {
    captureFromSearchHits(ctx, [], []);
    await vi.runAllTimersAsync();
    expect(fieldValueDB.mergeMultipleValues).not.toHaveBeenCalled();
  });

  it("does nothing when hits is null/undefined", async () => {
    captureFromSearchHits(ctx, null as any, []);
    await vi.runAllTimersAsync();
    expect(fieldValueDB.mergeMultipleValues).not.toHaveBeenCalled();
  });

  it("calls extractValuesFromHits with up to 100 hits", async () => {
    const hits = Array.from({ length: 150 }, (_, i) => ({ status: `${i}` }));
    captureFromSearchHits(ctx, hits, []);
    await vi.runAllTimersAsync();
    expect(extractValuesFromHits).toHaveBeenCalledWith(
      hits.slice(0, 100),
      [],
      expect.any(Number),
    );
  });

  it("calls mergeMultipleValues with correct composite keys", async () => {
    captureFromSearchHits(ctx, [{ status: "200" }], ["status"]);
    await vi.runAllTimersAsync();
    expect(fieldValueDB.mergeMultipleValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ key: "myorg|logs|http_logs|status" }),
        expect.objectContaining({ key: "myorg|logs|http_logs|env" }),
      ]),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("passes schemaFields to extractValuesFromHits", async () => {
    const schema = ["status", "env"];
    captureFromSearchHits(ctx, [{ status: "200" }], schema);
    await vi.runAllTimersAsync();
    expect(extractValuesFromHits).toHaveBeenCalledWith(
      expect.any(Array),
      schema,
      expect.any(Number),
    );
  });

  it("does not call mergeMultipleValues when extractValuesFromHits returns empty", async () => {
    vi.mocked(extractValuesFromHits).mockReturnValueOnce({});
    captureFromSearchHits(ctx, [{ status: "200" }], []);
    await vi.runAllTimersAsync();
    expect(fieldValueDB.mergeMultipleValues).not.toHaveBeenCalled();
  });
});

// ─── captureFromValuesApi ─────────────────────────────────────────────────────

describe("captureFromValuesApi", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls mergeValues with correct key and values", async () => {
    captureFromValuesApi(ctx, "status", [
      { key: "200" },
      { key: "404" },
    ]);
    await vi.runAllTimersAsync();
    expect(fieldValueDB.mergeValues).toHaveBeenCalledWith(
      "myorg|logs|http_logs|status",
      ["200", "404"],
      "values_api",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("filters out empty-string values", async () => {
    captureFromValuesApi(ctx, "status", [{ key: "" }, { key: "200" }]);
    await vi.runAllTimersAsync();
    expect(fieldValueDB.mergeValues).toHaveBeenCalledWith(
      expect.any(String),
      ["200"],
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("filters out values longer than 200 chars", async () => {
    const long = "x".repeat(201);
    captureFromValuesApi(ctx, "status", [{ key: long }, { key: "200" }]);
    await vi.runAllTimersAsync();
    expect(fieldValueDB.mergeValues).toHaveBeenCalledWith(
      expect.any(String),
      ["200"],
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("does nothing when all values are filtered out", async () => {
    captureFromValuesApi(ctx, "status", [{ key: "" }]);
    await vi.runAllTimersAsync();
    expect(fieldValueDB.mergeValues).not.toHaveBeenCalled();
  });

  it("does nothing when entries array is empty", async () => {
    captureFromValuesApi(ctx, "status", []);
    await vi.runAllTimersAsync();
    expect(fieldValueDB.mergeValues).not.toHaveBeenCalled();
  });

  it("uses correct stream context in composite key", async () => {
    const tracesCtx = { org: "acme", streamType: "traces", streamName: "default" };
    captureFromValuesApi(tracesCtx, "service", [{ key: "frontend" }]);
    await vi.runAllTimersAsync();
    expect(fieldValueDB.mergeValues).toHaveBeenCalledWith(
      "acme|traces|default|service",
      ["frontend"],
      "values_api",
      expect.any(Number),
      expect.any(Number),
    );
  });
});

// ─── getFieldValuesForSuggestion ──────────────────────────────────────────────

describe("getFieldValuesForSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns values from IDB on cache miss", async () => {
    vi.mocked(fieldValueDB.getValues).mockResolvedValueOnce(["200", "404"]);
    const values = await getFieldValuesForSuggestion(ctx, "status");
    expect(values).toEqual(["200", "404"]);
    expect(fieldValueDB.getValues).toHaveBeenCalledWith("myorg|logs|http_logs|status");
  });

  it("returns cached values on second call (cache hit, no extra IDB read)", async () => {
    // Use a unique field name to avoid cache pollution from other tests
    const freshCtx = { org: "cachetest", streamType: "logs", streamName: "mystream" };
    vi.mocked(fieldValueDB.getValues).mockResolvedValue(["prod", "staging"]);

    await getFieldValuesForSuggestion(freshCtx, "env");
    await getFieldValuesForSuggestion(freshCtx, "env");

    // IDB should only be called once — second call served from cache
    expect(fieldValueDB.getValues).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when IDB throws", async () => {
    vi.mocked(fieldValueDB.getValues).mockRejectedValueOnce(new Error("IDB error"));
    const values = await getFieldValuesForSuggestion(ctx, "broken_field");
    expect(values).toEqual([]);
  });

  it("returns empty array when IDB returns empty", async () => {
    vi.mocked(fieldValueDB.getValues).mockResolvedValueOnce([]);
    const values = await getFieldValuesForSuggestion(ctx, "empty_field");
    expect(values).toEqual([]);
  });

  it("builds correct composite key from context", async () => {
    const specificCtx = { org: "acme", streamType: "traces", streamName: "spans" };
    vi.mocked(fieldValueDB.getValues).mockResolvedValueOnce(["frontend"]);
    await getFieldValuesForSuggestion(specificCtx, "service");
    expect(fieldValueDB.getValues).toHaveBeenCalledWith("acme|traces|spans|service");
  });
});
