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
});
