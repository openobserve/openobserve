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
