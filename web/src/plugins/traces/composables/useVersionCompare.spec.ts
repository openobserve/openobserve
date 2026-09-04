// Copyright 2026 OpenObserve Inc.
//
// Tests for the useVersionCompare orchestrator composable. We mock
// useLLMInsights (two independent instances), fetchRawSample, and
// resolveCompareWindows/buildCompareResult inputs so the test focuses
// purely on the composable's orchestration logic: per-arm independence,
// error isolation, sameVariant short-circuit, and UNSET rejection.

// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// vi.mock() must be hoisted above all imports.
// ---------------------------------------------------------------------------

const mockInstances: any[] = [];

vi.mock("./useLLMInsights", () => ({
  useLLMInsights: vi.fn(() => {
    const { ref } = require("vue");
    const instance = {
      kpi: ref({
        requestCount: 0,
        traceCount: 0,
        errorCount: 0,
        totalTokens: 0,
        totalCost: 0,
        p95DurationMicros: 0,
      }),
      loading: ref(false),
      p95Loading: ref(false),
      error: ref(null),
      hasLoadedOnce: ref(false),
      availableStreams: ref([]),
      streamsLoaded: ref(false),
      fetchAll: vi.fn(async () => {}),
      cancelAll: vi.fn(),
    };
    mockInstances.push(instance);
    return instance;
  }),
}));

const mockFetchRawSample = vi.fn(async () => ({ durations: [], costs: [] }));
vi.mock("../versionCompare/rawSample", () => ({
  fetchRawSample: (...args: any[]) => mockFetchRawSample(...args),
}));

function insufficientDelta() {
  return { a: 0, b: 0, delta: 0, lo: 0, hi: 0, straddles_zero: true, insufficient: true };
}

// Default: the sketch endpoint reports `insufficient` for every metric so
// existing tests (written against the raw-sample fallback path) keep passing
// without modification. Tests that want the sketch (default) path override
// this mock's resolved value per-test.
const mockCompareAgentVersions = vi.fn(async () => ({
  data: {
    p50: insufficientDelta(),
    p95: insufficientDelta(),
    p99: insufficientDelta(),
    cost: insufficientDelta(),
  },
}));
vi.mock("@/services/gen-ai-agent-mapping.service", () => ({
  compareAgentVersions: (...args: any[]) => mockCompareAgentVersions(...args),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      selectedOrganization: { identifier: "test-org" },
      zoConfig: { sql_base64_enabled: false },
    },
  })),
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: vi.fn(() => ({
    fetchQueryDataWithHttpStream: vi.fn(),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  })),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string, params?: Record<string, any>) => (params ? key + JSON.stringify(params) : key),
  })),
}));

// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { useVersionCompare } from "./useVersionCompare";

const H = 3_600_000_000; // 1 hour in microseconds

function makeAgent(overrides: Partial<GenAiAgentListItem> = {}): GenAiAgentListItem {
  return {
    name: "checkout-agent",
    id: "agent-1",
    source_stream: "traces_stream",
    source_stream_type: "traces",
    env: "prod",
    version: "1.5.0",
    first_seen: 1000 * H - 48 * H,
    last_seen: 1000 * H,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInstances.length = 0;
  mockFetchRawSample.mockClear();
  mockFetchRawSample.mockResolvedValue({ durations: [], costs: [] });
  mockCompareAgentVersions.mockClear();
  mockCompareAgentVersions.mockResolvedValue({
    data: {
      p50: insufficientDelta(),
      p95: insufficientDelta(),
      p99: insufficientDelta(),
      cost: insufficientDelta(),
    },
  });
});

describe("useVersionCompare — setup", () => {
  it("instantiates two independent useLLMInsights instances", () => {
    useVersionCompare();
    expect(mockInstances.length).toBe(2);
    expect(mockInstances[0]).not.toBe(mockInstances[1]);
  });
});

describe("useVersionCompare — run", () => {
  it("fires two independent fetches with two windows + two agents", async () => {
    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0", first_seen: 1000 * H - 48 * H, last_seen: 1000 * H });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);

    await vc.run("traces_stream");

    const [armA, armB] = mockInstances;
    expect(armA.fetchAll).toHaveBeenCalledTimes(1);
    expect(armB.fetchAll).toHaveBeenCalledTimes(1);

    const [streamA, startA, endA, agentA] = armA.fetchAll.mock.calls[0];
    const [streamB, startB, endB, agentB] = armB.fetchAll.mock.calls[0];

    expect(streamA).toBe("traces_stream");
    expect(streamB).toBe("traces_stream");
    expect(agentA).toEqual(a);
    expect(agentB).toEqual(b);
    // Windows must differ (disjoint natural lifetimes → different start/end).
    expect(startA).not.toBe(startB);
    expect(endA).not.toBe(endB);
  });

  it("isolates per-arm errors: B erroring does not blank A's kpi", async () => {
    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0" });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);

    const [armA, armB] = mockInstances;
    armA.kpi.value = { ...armA.kpi.value, traceCount: 500, totalCost: 10 };
    armB.error.value = "boom";
    armB.fetchAll = vi.fn(async () => {
      armB.error.value = "boom";
    });

    await vc.run("traces_stream");

    expect(vc.kpiA.value.traceCount).toBe(500);
    expect(vc.errorB.value).toBe("boom");
    expect(vc.errorA.value).toBeFalsy();
  });

  it("A==B (same env+version) sets sameVariant and short-circuits (no fetch)", async () => {
    const vc = useVersionCompare();
    const a = makeAgent({ env: "prod", version: "1.5.0" });
    const b = makeAgent({ env: "prod", version: "1.5.0" });
    vc.setPair(a, b);

    expect(vc.sameVariant.value).toBe(true);

    await vc.run("traces_stream");

    const [armA, armB] = mockInstances;
    expect(armA.fetchAll).not.toHaveBeenCalled();
    expect(armB.fetchAll).not.toHaveBeenCalled();
  });

  it("windows come from resolveCompareWindows using each variant's first/last seen", async () => {
    const vc = useVersionCompare();
    const now = 1000 * H;
    const a = makeAgent({ version: "1.5.0", first_seen: now - 10 * H, last_seen: now });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: now - 100 * H,
      last_seen: now - 9 * H,
    });
    vc.setPair(a, b);

    await vc.run("traces_stream");

    expect(vc.windows.value).not.toBeNull();
    expect(vc.windows.value!.mode).toBe("sinceRollout");
    expect(vc.windows.value!.overlap).toBe("partial");
  });

  it("rejects an UNSET arm (null/undefined version) — does not run, exposes an error", async () => {
    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0" });
    const b = makeAgent({ version: null });
    vc.setPair(a, b);

    await vc.run("traces_stream");

    const [armA, armB] = mockInstances;
    expect(armA.fetchAll).not.toHaveBeenCalled();
    expect(armB.fetchAll).not.toHaveBeenCalled();
    expect(vc.errorA.value || vc.errorB.value).toBeTruthy();
  });

  it("builds a CompareResult once both arms resolve", async () => {
    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0" });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);

    await vc.run("traces_stream");

    expect(vc.result.value).not.toBeNull();
    expect(vc.result.value!.metrics.length).toBeGreaterThan(0);
    expect(mockFetchRawSample).toHaveBeenCalledTimes(2);
  });

  it("populates sampledNote after a run", async () => {
    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0" });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);

    expect(vc.sampledNote.value).toBeNull();
    await vc.run("traces_stream");

    expect(vc.sampledNote.value).toBeTruthy();
    expect(typeof vc.sampledNote.value).toBe("string");
  });
});

describe("useVersionCompare — sketch endpoint (Task 7)", () => {
  function sufficientDelta(a: number, b: number, delta: number, lo: number, hi: number) {
    return { a, b, delta, lo, hi, straddles_zero: lo <= 0 && hi >= 0, insufficient: false };
  }

  it("calls the compare endpoint and maps p50/p95/p99/cost into the result; error-rate still comes from KPI, not the endpoint", async () => {
    mockCompareAgentVersions.mockResolvedValue({
      data: {
        p50: sufficientDelta(100, 90, 10, 2, 18),
        p95: sufficientDelta(300, 250, 50, 10, 90),
        p99: sufficientDelta(500, 400, 100, 20, 180),
        cost: sufficientDelta(0.01, 0.008, 0.002, 0.0005, 0.0035),
      },
    });

    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0" });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);

    const [armA, armB] = mockInstances;
    armA.kpi.value = { ...armA.kpi.value, traceCount: 500, errorCount: 50 };
    armB.kpi.value = { ...armB.kpi.value, traceCount: 500, errorCount: 10 };

    await vc.run("traces_stream");

    expect(mockCompareAgentVersions).toHaveBeenCalledTimes(1);
    // Endpoint drives latency/cost.
    const p50 = vc.result.value!.metrics.find((m) => m.key === "p50")!;
    expect(p50.a).toBe(100);
    expect(p50.b).toBe(90);
    expect(p50.ci?.delta).toBe(10);
    const cost = vc.result.value!.metrics.find((m) => m.key === "cost")!;
    expect(cost.ci?.delta).toBeCloseTo(0.002);
    // Error-rate comes from the KPI mock, NOT the endpoint (endpoint has no
    // error-rate field at all).
    const errorRate = vc.result.value!.metrics.find((m) => m.key === "errorRate")!;
    expect(errorRate.a).toBeCloseTo(0.1); // 50/500
    expect(errorRate.b).toBeCloseTo(0.02); // 10/500
    expect(errorRate.verdict).not.toBe("insufficient");
  });

  it("exposes error_diff from the endpoint response on the errorDiff ref", async () => {
    const errorDiff = {
      introduced: [{ fail_class: "timeout", count: 3 }],
      fixed: [{ fail_class: "rate_limit", count: 1 }],
      shared: [{ fail_class: "auth_error", count_a: 5, count_b: 2, delta: 3 }],
      insufficient: false,
    };
    mockCompareAgentVersions.mockResolvedValue({
      data: {
        p50: sufficientDelta(100, 90, 10, 2, 18),
        p95: sufficientDelta(300, 250, 50, 10, 90),
        p99: sufficientDelta(500, 400, 100, 20, 180),
        cost: sufficientDelta(0.01, 0.008, 0.002, 0.0005, 0.0035),
        error_diff: errorDiff,
      },
    });

    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0" });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);

    await vc.run("traces_stream");

    expect(vc.errorDiff.value).toEqual(errorDiff);
  });

  it("leaves errorDiff null when the endpoint falls back to the raw-sample path", async () => {
    mockCompareAgentVersions.mockResolvedValue({
      data: {
        p50: insufficientDelta(),
        p95: insufficientDelta(),
        p99: insufficientDelta(),
        cost: insufficientDelta(),
      },
    });

    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0" });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);

    await vc.run("traces_stream");

    expect(vc.errorDiff.value).toBeNull();
  });

  it("does NOT call fetchRawSample by default when the endpoint returns sufficient CIs", async () => {
    mockCompareAgentVersions.mockResolvedValue({
      data: {
        p50: sufficientDelta(100, 90, 10, 2, 18),
        p95: sufficientDelta(300, 250, 50, 10, 90),
        p99: sufficientDelta(500, 400, 100, 20, 180),
        cost: sufficientDelta(0.01, 0.008, 0.002, 0.0005, 0.0035),
      },
    });

    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0" });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);

    await vc.run("traces_stream");

    expect(mockFetchRawSample).not.toHaveBeenCalled();
  });

  it("falls back to fetchRawSample when the endpoint reports insufficient for latency", async () => {
    // Default beforeEach mock already returns all-insufficient.
    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0" });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);

    await vc.run("traces_stream");

    expect(mockCompareAgentVersions).toHaveBeenCalledTimes(1);
    expect(mockFetchRawSample).toHaveBeenCalledTimes(2);
  });

  it("falls back to fetchRawSample when the endpoint call rejects/errors", async () => {
    mockCompareAgentVersions.mockRejectedValue(new Error("network error"));

    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0" });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);

    await vc.run("traces_stream");

    expect(mockFetchRawSample).toHaveBeenCalledTimes(2);
    expect(vc.result.value).not.toBeNull();
  });

  it("maps a straddles_zero:true MetricDelta to verdict nochange, and a clear p95 regression (straddles_zero:false, delta>0) to verdict higher", async () => {
    mockCompareAgentVersions.mockResolvedValue({
      data: {
        p50: sufficientDelta(100, 100, 0, -5, 5), // straddles zero
        // Clear p95 regression: B is HIGHER than A (delta = A - B < 0, CI
        // entirely negative), so verdict resolves to "higher" per the
        // classifyVerdict contract (delta<0 ⇒ B regressed ⇒ higher).
        p95: sufficientDelta(200, 300, -100, -180, -20),
        p99: sufficientDelta(400, 500, -100, -180, -20),
        cost: sufficientDelta(0.01, 0.01, 0, -0.001, 0.001),
      },
    });

    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0" });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);

    const [armA, armB] = mockInstances;
    armA.kpi.value = { ...armA.kpi.value, traceCount: 500 };
    armB.kpi.value = { ...armB.kpi.value, traceCount: 500 };

    await vc.run("traces_stream");

    const p50 = vc.result.value!.metrics.find((m) => m.key === "p50")!;
    expect(p50.verdict).toBe("nochange");
    const p95 = vc.result.value!.metrics.find((m) => m.key === "p95")!;
    expect(p95.verdict).toBe("higher");
  });
});

describe("useVersionCompare — sameWallClock shared window (C1)", () => {
  it("fetches BOTH arms over the SAME shared window when align=sameWallClock and sharedWindow is supplied", async () => {
    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0", first_seen: 1000 * H - 48 * H, last_seen: 1000 * H });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);
    vc.align.value = "sameWallClock";

    const shared = { start: 500 * H, end: 510 * H };
    await vc.run("traces_stream", undefined, shared);

    const [armA, armB] = mockInstances;
    const [, startA, endA] = armA.fetchAll.mock.calls[0];
    const [, startB, endB] = armB.fetchAll.mock.calls[0];

    expect(startA).toBe(shared.start);
    expect(endA).toBe(shared.end);
    expect(startB).toBe(shared.start);
    expect(endB).toBe(shared.end);

    expect(mockFetchRawSample).toHaveBeenCalledTimes(2);
    const sampleCallA = mockFetchRawSample.mock.calls[0];
    const sampleCallB = mockFetchRawSample.mock.calls[1];
    // fetchRawSample(stream, filter, start, end, runner)
    expect(sampleCallA[2]).toBe(shared.start);
    expect(sampleCallA[3]).toBe(shared.end);
    expect(sampleCallB[2]).toBe(shared.start);
    expect(sampleCallB[3]).toBe(shared.end);
  });

  it("re-running with a NEW shared window (simulating a page date-picker change) re-fetches both arms with the new window", async () => {
    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0" });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 200 * H,
      last_seen: 1000 * H - 100 * H,
    });
    vc.setPair(a, b);
    vc.align.value = "sameWallClock";

    const shared1 = { start: 500 * H, end: 510 * H };
    await vc.run("traces_stream", undefined, shared1);

    const shared2 = { start: 600 * H, end: 610 * H };
    await vc.run("traces_stream", undefined, shared2);

    const [armA, armB] = mockInstances;
    expect(armA.fetchAll).toHaveBeenCalledTimes(2);
    expect(armB.fetchAll).toHaveBeenCalledTimes(2);

    const [, startA2, endA2] = armA.fetchAll.mock.calls[1];
    const [, startB2, endB2] = armB.fetchAll.mock.calls[1];
    expect(startA2).toBe(shared2.start);
    expect(endA2).toBe(shared2.end);
    expect(startB2).toBe(shared2.start);
    expect(endB2).toBe(shared2.end);
  });

  it("without a sharedWindow, sameWallClock falls back to each arm's own resolved window (no shared override)", async () => {
    const vc = useVersionCompare();
    const a = makeAgent({ version: "1.5.0", first_seen: 1000 * H - 48 * H, last_seen: 1000 * H });
    const b = makeAgent({
      version: "1.4.0",
      first_seen: 1000 * H - 48 * H,
      last_seen: 1000 * H,
    });
    vc.setPair(a, b);
    vc.align.value = "sameWallClock";

    await vc.run("traces_stream");

    const [armA, armB] = mockInstances;
    const [, startA, endA] = armA.fetchAll.mock.calls[0];
    const [, startB, endB] = armB.fetchAll.mock.calls[0];
    // Same concurrent lifetimes here, so windows happen to match naturally —
    // assert the call actually went through with resolved.a/b (not undefined).
    expect(startA).toBe(a.first_seen);
    expect(endA).toBe(a.last_seen);
    expect(startB).toBe(b.first_seen);
    expect(endB).toBe(b.last_seen);
  });
});
