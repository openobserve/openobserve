// @vitest-environment jsdom
// Tests for useScorerRuns — the data backbone of the Scorer detail Runs
// tab. Mirrors useEvalJobRuns but filters by `attributes_scorer_id` and
// has no failures-by-scorer rollup (one scorer, no breakdown to do).
// Like the job composable, KPIs fire eagerly and runs hits fire lazily.

const mockExecuteQuery = vi.fn();
vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({
    executeQuery: mockExecuteQuery,
    cancelAll: vi.fn(),
  }),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import { useScorerRuns, type ScorerRunsWindow } from "./useScorerRuns";

const DEFAULT_WINDOW: ScorerRunsWindow = { startUs: 100, endUs: 200 };
const AGENT_FILTER = {
  name: "support-agent",
  id: "agent-123",
  source_stream: "prod_traces",
  source_stream_type: "traces",
};

beforeEach(() => {
  mockExecuteQuery.mockReset();
});

async function flushAsync() {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useScorerRuns — KPI refresh (eager)", () => {
  it("does not query when scorerId is null", async () => {
    useScorerRuns(ref<string | null>(null), ref(DEFAULT_WINDOW), ref(false));
    await flushAsync();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it("fires the KPI query immediately when scorerId is set, regardless of runsEnabled", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(false),
    );
    await flushAsync();

    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    const [sql, startUs, endUs, pageType] = mockExecuteQuery.mock.calls[0];
    expect(sql).toContain('FROM "_evaluator"');
    expect(sql).toContain("attributes_scorer_id");
    expect(sql).toContain("'scorer-1'");
    expect(startUs).toBe(100);
    expect(endUs).toBe(200);
    expect(pageType).toBe("traces");
  });

  it("derives successRate from total and success counts", async () => {
    mockExecuteQuery.mockResolvedValue([
      {
        total_runs: 40,
        success_runs: 36,
        failure_runs: 4,
        avg_latency_ms: 120,
      },
    ]);
    const { kpis } = useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(false),
    );
    await flushAsync();

    expect(kpis.value).toEqual({
      totalRuns: 40,
      successRate: 90,
      avgLatencyMs: 120,
      failureCount: 4,
    });
  });

  it("returns successRate=null when total_runs=0", async () => {
    mockExecuteQuery.mockResolvedValue([
      { total_runs: 0, success_runs: 0, failure_runs: 0, avg_latency_ms: null },
    ]);
    const { kpis } = useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(false),
    );
    await flushAsync();

    expect(kpis.value.successRate).toBeNull();
    expect(kpis.value.totalRuns).toBe(0);
  });

  it("escapes single quotes in scorerId", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    useScorerRuns(ref<string | null>("s'1"), ref(DEFAULT_WINDOW), ref(false));
    await flushAsync();
    expect(mockExecuteQuery.mock.calls[0][0]).toContain("'s''1'");
  });

  it("filters evaluator KPIs inline on attributes_target_agent_id when agent is selected", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(false),
      ref(AGENT_FILTER),
    );
    await flushAsync();

    const sql = mockExecuteQuery.mock.calls[0][0];
    expect(sql).toContain("attributes_target_agent_id = 'agent-123'");
    expect(sql).not.toContain("attributes_target_trace_id IN (");
  });
});

describe("useScorerRuns — runs hits (lazy)", () => {
  it("does not fire the runs query when runsEnabled is false", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(false),
    );
    await flushAsync();
    // Only the KPI query.
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  it("fires the runs query when runsEnabled flips to true", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const runsEnabled = ref(false);

    useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      runsEnabled,
    );
    await flushAsync();
    mockExecuteQuery.mockClear();

    runsEnabled.value = true;
    await flushAsync();

    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    const sql = mockExecuteQuery.mock.calls[0][0];
    expect(sql).toContain("LIMIT 200");
    expect(sql).toContain("ORDER BY _timestamp DESC");
    expect(sql).not.toContain("attributes_target_agent_name");
    expect(sql).not.toContain("attributes_target_agent_id");
  });

  it("clears runs when runsEnabled flips back to false", async () => {
    mockExecuteQuery.mockResolvedValueOnce([
      { total_runs: 1, success_runs: 1 },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([
      {
        span_id: "s1",
        attributes_status: "success",
        attributes_response: '{"value_numeric": 0.5}',
      },
    ]);

    const runsEnabled = ref(true);
    const { runs } = useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      runsEnabled,
    );
    await flushAsync();
    expect(runs.value.length).toBe(1);

    runsEnabled.value = false;
    await flushAsync();
    expect(runs.value).toEqual([]);
  });

  // Each run row exposes the foreign job id so the Scorer detail's Runs tab
  // can resolve and display the job name in the row.
  it("surfaces attributes_job_id on each run row", async () => {
    mockExecuteQuery.mockResolvedValueOnce([
      { total_runs: 1, success_runs: 1 },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([
      {
        span_id: "s1",
        attributes_status: "success",
        attributes_job_id: "job-42",
      },
    ]);

    const { runs } = useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(runs.value[0].jobId).toBe("job-42");
  });

  it("falls back to a synthetic id when span_id is missing", async () => {
    mockExecuteQuery.mockResolvedValueOnce([
      { total_runs: 1, success_runs: 1 },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([
      {
        // No span_id.
        _timestamp: 12345,
        attributes_target_span_id: "tgt-1",
        attributes_status: "success",
      },
    ]);

    const { runs } = useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    // The synthesised id is enough to key the row in the OTable.
    expect(runs.value[0].id).toBe("12345-tgt-1");
  });
});

describe("useScorerRuns — score / status parsing", () => {
  it("parses numeric / boolean / categorical scores into separate fields", async () => {
    mockExecuteQuery.mockResolvedValueOnce([
      { total_runs: 3, success_runs: 3 },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([
      { span_id: "a", attributes_response: '{"value_numeric": 0.75}' },
      { span_id: "b", attributes_response: '{"value_boolean": true}' },
      { span_id: "c", attributes_response: '{"value_categorical": "good"}' },
    ]);

    const { runs } = useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(runs.value[0].scoreNumeric).toBe(0.75);
    expect(runs.value[1].scoreBoolean).toBe(true);
    expect(runs.value[2].scoreCategorical).toBe("good");
  });

  // Statuses outside the known set collapse to "unknown" so the status pill
  // doesn't render an unexpected class.
  it("normalises unknown status values to 'unknown'", async () => {
    mockExecuteQuery.mockResolvedValueOnce([
      { total_runs: 1, success_runs: 1 },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([
      { span_id: "a", attributes_status: "weird_status" },
    ]);

    const { runs } = useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(runs.value[0].status).toBe("unknown");
  });

  // `_timestamp` from the streaming endpoint comes back in microseconds for
  // newer rows but milliseconds for older ones. The composable picks based
  // on magnitude so the relativeTime helper gets a consistent ms value.
  it("normalises microsecond timestamps to milliseconds", async () => {
    mockExecuteQuery.mockResolvedValueOnce([
      { total_runs: 1, success_runs: 1 },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([
      { span_id: "a", _timestamp: 1_700_000_000_000_000 }, // microseconds
    ]);

    const { runs } = useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    // 1.7e15 µs ≈ 1.7e12 ms.
    expect(runs.value[0].timestampMs).toBe(1_700_000_000_000);
  });

  it("keeps millisecond timestamps as-is", async () => {
    mockExecuteQuery.mockResolvedValueOnce([
      { total_runs: 1, success_runs: 1 },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([
      { span_id: "a", _timestamp: 1_700_000_000_000 }, // milliseconds
    ]);

    const { runs } = useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(runs.value[0].timestampMs).toBe(1_700_000_000_000);
  });
});

describe("useScorerRuns — reactivity", () => {
  it("re-fetches when the date window changes", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const dateWindow = ref<ScorerRunsWindow>({ startUs: 100, endUs: 200 });
    useScorerRuns(ref<string | null>("scorer-1"), dateWindow, ref(false));
    await flushAsync();

    mockExecuteQuery.mockClear();
    dateWindow.value = { startUs: 999, endUs: 9999 };
    await flushAsync();

    expect(mockExecuteQuery).toHaveBeenCalled();
    const [, startUs, endUs] = mockExecuteQuery.mock.calls[0];
    expect(startUs).toBe(999);
    expect(endUs).toBe(9999);
  });

  it("clears KPIs when scorerId becomes null", async () => {
    mockExecuteQuery.mockResolvedValueOnce([
      { total_runs: 5, success_runs: 5 },
    ]);
    const scorerId = ref<string | null>("scorer-1");
    const { kpis } = useScorerRuns(scorerId, ref(DEFAULT_WINDOW), ref(false));
    await flushAsync();
    expect(kpis.value.totalRuns).toBe(5);

    scorerId.value = null;
    await flushAsync();
    expect(kpis.value.totalRuns).toBeNull();
  });
});

describe("useScorerRuns — error handling", () => {
  it("KPI query errors leave KPIs at empty state without throwing", async () => {
    mockExecuteQuery.mockRejectedValueOnce(new Error("network"));
    const { kpis } = useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(false),
    );
    await flushAsync();
    expect(kpis.value.totalRuns).toBeNull();
  });

  it("Runs query errors leave runs at empty without throwing", async () => {
    mockExecuteQuery.mockResolvedValueOnce([
      { total_runs: 1, success_runs: 1 },
    ]);
    mockExecuteQuery.mockRejectedValueOnce(new Error("network"));
    const { runs } = useScorerRuns(
      ref<string | null>("scorer-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();
    expect(runs.value).toEqual([]);
  });
});
