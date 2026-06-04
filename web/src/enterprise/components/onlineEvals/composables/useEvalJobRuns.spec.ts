// @vitest-environment jsdom
// Tests for useEvalJobRuns — the Runs / Failures data backbone of the Eval
// Job detail drawer. The composable splits into two refresh paths:
//   • KPIs: eager — fires whenever the drawer is open (jobId set)
//   • runs hits + failures-by-scorer rollup: lazy — only when the Runs or
//     Failures tab is the active one
// We mock `executeQuery` so the tests drive the SQL boundary directly.

// ---------------------------------------------------------------------------
// vi.mock() must be hoisted above imports.

const mockExecuteQuery = vi.fn();
vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({
    executeQuery: mockExecuteQuery,
    cancelAll: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref, nextTick } from "vue";
import { useEvalJobRuns, type JobRunsWindow } from "./useEvalJobRuns";

const DEFAULT_WINDOW: JobRunsWindow = { startUs: 100, endUs: 200 };

beforeEach(() => {
  mockExecuteQuery.mockReset();
});

// `flushAsync` waits long enough for all the chained promise microtasks
// inside the composable's watchers to settle. Each refresh path is two
// chained awaits (executeQuery → assignment), so 3 microtask flushes is
// enough.
async function flushAsync() {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useEvalJobRuns — KPI refresh", () => {
  it("does not query when jobId is null", async () => {
    const jobId = ref<string | null>(null);
    const dateWindow = ref(DEFAULT_WINDOW);
    const enabled = ref(false);

    useEvalJobRuns(jobId, dateWindow, enabled);
    await flushAsync();

    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it("fires the KPI query as soon as jobId is set, even when the tab is not active", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const jobId = ref<string | null>("job-1");
    const dateWindow = ref(DEFAULT_WINDOW);
    const enabled = ref(false); // tab NOT active

    useEvalJobRuns(jobId, dateWindow, enabled);
    await flushAsync();

    // Exactly one call — the KPI query — and it targets `_evaluator` traces.
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    const [sql, startUs, endUs, pageType] = mockExecuteQuery.mock.calls[0];
    expect(sql).toContain('FROM "_evaluator"');
    expect(sql).toContain("attributes_job_id");
    expect(sql).toContain("'job-1'");
    expect(startUs).toBe(100);
    expect(endUs).toBe(200);
    expect(pageType).toBe("traces");
  });

  // The KPI strip displays a percentage; the composable derives it from the
  // total + success counts because the backend doesn't compute the ratio.
  it("derives successRate from total and success counts", async () => {
    mockExecuteQuery.mockResolvedValue([
      { total_runs: 100, success_runs: 95, failure_runs: 5, avg_latency_ms: 250 },
    ]);
    const jobId = ref<string | null>("job-1");
    const enabled = ref(false);

    const { kpis } = useEvalJobRuns(jobId, ref(DEFAULT_WINDOW), enabled);
    await flushAsync();

    expect(kpis.value).toEqual({
      totalRuns: 100,
      successRate: 95,
      avgLatencyMs: 250,
      failureCount: 5,
    });
  });

  it("returns successRate=null when total_runs is zero (avoids divide-by-zero)", async () => {
    mockExecuteQuery.mockResolvedValue([
      { total_runs: 0, success_runs: 0, failure_runs: 0, avg_latency_ms: null },
    ]);
    const jobId = ref<string | null>("job-1");

    const { kpis } = useEvalJobRuns(jobId, ref(DEFAULT_WINDOW), ref(false));
    await flushAsync();

    expect(kpis.value.totalRuns).toBe(0);
    expect(kpis.value.successRate).toBeNull();
  });

  it("returns null KPIs when the query yields no rows", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const jobId = ref<string | null>("job-1");

    const { kpis } = useEvalJobRuns(jobId, ref(DEFAULT_WINDOW), ref(false));
    await flushAsync();

    expect(kpis.value).toEqual({
      totalRuns: null,
      successRate: null,
      avgLatencyMs: null,
      failureCount: null,
    });
  });

  // Defensive escape — apostrophe in jobId would otherwise break the SQL.
  it("escapes single quotes in jobId to prevent SQL injection", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const jobId = ref<string | null>("job'1");

    useEvalJobRuns(jobId, ref(DEFAULT_WINDOW), ref(false));
    await flushAsync();

    const sql = mockExecuteQuery.mock.calls[0][0];
    expect(sql).toContain("'job''1'");
  });
});

describe("useEvalJobRuns — table refresh (lazy)", () => {
  it("does not fire runs/failures queries when tableEnabled is false", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const enabled = ref(false);

    useEvalJobRuns(ref<string | null>("job-1"), ref(DEFAULT_WINDOW), enabled);
    await flushAsync();

    // Only the KPI query, not the runs + failures-by-scorer queries.
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  it("fires the runs + failures-by-scorer queries when tableEnabled flips to true", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const enabled = ref(false);

    useEvalJobRuns(ref<string | null>("job-1"), ref(DEFAULT_WINDOW), enabled);
    await flushAsync();
    mockExecuteQuery.mockClear();

    enabled.value = true;
    await flushAsync();

    // Two queries fire in parallel — runs hits and the failures rollup.
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    const sqls = mockExecuteQuery.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes("LIMIT 200"))).toBe(true);
    expect(sqls.some((s) => s.includes("GROUP BY scorer_id"))).toBe(true);
  });

  it("clears runs + failures when tableEnabled flips back to false", async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total_runs: 1, success_runs: 1 }]);
    mockExecuteQuery.mockResolvedValueOnce([
      {
        span_id: "span-1",
        _timestamp: 123,
        attributes_status: "success",
        attributes_response: '{"value_numeric": 0.9}',
      },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([
      { scorer_id: "s1", total_runs: 10, failures: 1 },
    ]);

    const enabled = ref(true);
    const { runs, failuresByScorer } = useEvalJobRuns(
      ref<string | null>("job-1"),
      ref(DEFAULT_WINDOW),
      enabled,
    );
    await flushAsync();
    expect(runs.value.length).toBe(1);
    expect(failuresByScorer.value.length).toBe(1);

    enabled.value = false;
    await flushAsync();
    expect(runs.value).toEqual([]);
    expect(failuresByScorer.value).toEqual([]);
  });
});

describe("useEvalJobRuns — score extraction from attributes_response", () => {
  // attributes_response is a JSON string written by the judge. The composable
  // parses it and surfaces whichever of (numeric / boolean / categorical) is
  // populated so the Runs table can show the score regardless of dimension
  // type.
  it("extracts numeric scores from value_numeric", async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total_runs: 1, success_runs: 1 }]);
    mockExecuteQuery.mockResolvedValueOnce([
      {
        span_id: "span-1",
        attributes_status: "success",
        attributes_response: '{"value_numeric": 0.87}',
      },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([]);

    const { runs } = useEvalJobRuns(
      ref<string | null>("job-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(runs.value[0].scoreNumeric).toBe(0.87);
    expect(runs.value[0].scoreDisplay).toBe("0.87");
  });

  it("extracts boolean scores from value_boolean", async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total_runs: 1, success_runs: 1 }]);
    mockExecuteQuery.mockResolvedValueOnce([
      {
        span_id: "span-1",
        attributes_status: "success",
        attributes_response: '{"value_boolean": true}',
      },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([]);

    const { runs } = useEvalJobRuns(
      ref<string | null>("job-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(runs.value[0].scoreBoolean).toBe(true);
    expect(runs.value[0].scoreDisplay).toBe("true");
  });

  it("extracts categorical scores from value_categorical", async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total_runs: 1, success_runs: 1 }]);
    mockExecuteQuery.mockResolvedValueOnce([
      {
        span_id: "span-1",
        attributes_status: "success",
        attributes_response: '{"value_categorical": "good"}',
      },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([]);

    const { runs } = useEvalJobRuns(
      ref<string | null>("job-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(runs.value[0].scoreCategorical).toBe("good");
    expect(runs.value[0].scoreDisplay).toBe("good");
  });

  // Older judges write `score` / `passed` / `category` keys. Defensive code
  // surfaces those too so we don't show "—" for legacy rows.
  it("accepts legacy field aliases (score / passed / category)", async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total_runs: 3, success_runs: 3 }]);
    mockExecuteQuery.mockResolvedValueOnce([
      { span_id: "s1", attributes_response: '{"score": 0.5}' },
      { span_id: "s2", attributes_response: '{"passed": false}' },
      { span_id: "s3", attributes_response: '{"category": "ok"}' },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([]);

    const { runs } = useEvalJobRuns(
      ref<string | null>("job-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(runs.value[0].scoreNumeric).toBe(0.5);
    expect(runs.value[1].scoreBoolean).toBe(false);
    expect(runs.value[2].scoreCategorical).toBe("ok");
  });

  it("displays '—' when no recognisable score field is present", async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total_runs: 1, success_runs: 1 }]);
    mockExecuteQuery.mockResolvedValueOnce([
      { span_id: "s1", attributes_response: '{"reasoning": "plain text"}' },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([]);

    const { runs } = useEvalJobRuns(
      ref<string | null>("job-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(runs.value[0].scoreDisplay).toBe("—");
  });

  it("tolerates non-JSON attributes_response strings", async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total_runs: 1, success_runs: 1 }]);
    mockExecuteQuery.mockResolvedValueOnce([
      { span_id: "s1", attributes_response: "this is plain text" },
    ]);
    mockExecuteQuery.mockResolvedValueOnce([]);

    const { runs } = useEvalJobRuns(
      ref<string | null>("job-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(runs.value[0].scoreDisplay).toBe("—");
  });
});

describe("useEvalJobRuns — failures-by-scorer rollup", () => {
  it("computes failureRate = failures/total*100 per scorer", async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total_runs: 1, success_runs: 1 }]);
    mockExecuteQuery.mockResolvedValueOnce([]);
    mockExecuteQuery.mockResolvedValueOnce([
      { scorer_id: "s1", total_runs: 100, failures: 5 },
      { scorer_id: "s2", total_runs: 50, failures: 25 },
    ]);

    const { failuresByScorer } = useEvalJobRuns(
      ref<string | null>("job-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(failuresByScorer.value).toEqual([
      { scorerId: "s1", totalRuns: 100, failures: 5, failureRate: 5 },
      { scorerId: "s2", totalRuns: 50, failures: 25, failureRate: 50 },
    ]);
  });

  it("drops rows with no scorer_id (defensive)", async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total_runs: 1, success_runs: 1 }]);
    mockExecuteQuery.mockResolvedValueOnce([]);
    mockExecuteQuery.mockResolvedValueOnce([
      { scorer_id: "", total_runs: 10, failures: 1 },
      { scorer_id: "s1", total_runs: 10, failures: 1 },
    ]);

    const { failuresByScorer } = useEvalJobRuns(
      ref<string | null>("job-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(failuresByScorer.value).toHaveLength(1);
    expect(failuresByScorer.value[0].scorerId).toBe("s1");
  });
});

describe("useEvalJobRuns — reactivity", () => {
  it("re-fetches KPIs when the date window changes", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const dateWindow = ref<JobRunsWindow>({ startUs: 100, endUs: 200 });
    useEvalJobRuns(ref<string | null>("job-1"), dateWindow, ref(false));
    await flushAsync();

    mockExecuteQuery.mockClear();
    dateWindow.value = { startUs: 300, endUs: 400 };
    await flushAsync();

    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    const [, startUs, endUs] = mockExecuteQuery.mock.calls[0];
    expect(startUs).toBe(300);
    expect(endUs).toBe(400);
  });

  it("re-fetches when the jobId changes", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const jobId = ref<string | null>("job-1");
    useEvalJobRuns(jobId, ref(DEFAULT_WINDOW), ref(false));
    await flushAsync();

    mockExecuteQuery.mockClear();
    jobId.value = "job-2";
    await flushAsync();

    expect(mockExecuteQuery).toHaveBeenCalled();
    const sql = mockExecuteQuery.mock.calls[0][0];
    expect(sql).toContain("'job-2'");
  });

  it("clears KPIs to empty when jobId becomes null", async () => {
    mockExecuteQuery.mockResolvedValueOnce([
      { total_runs: 10, success_runs: 10 },
    ]);
    const jobId = ref<string | null>("job-1");
    const { kpis } = useEvalJobRuns(jobId, ref(DEFAULT_WINDOW), ref(false));
    await flushAsync();
    expect(kpis.value.totalRuns).toBe(10);

    jobId.value = null;
    await flushAsync();
    expect(kpis.value.totalRuns).toBeNull();
  });
});

describe("useEvalJobRuns — error handling", () => {
  it("KPI query errors do not throw — they leave KPIs at empty state", async () => {
    mockExecuteQuery.mockRejectedValueOnce(new Error("network"));

    const { kpis } = useEvalJobRuns(
      ref<string | null>("job-1"),
      ref(DEFAULT_WINDOW),
      ref(false),
    );
    await flushAsync();

    expect(kpis.value.totalRuns).toBeNull();
  });

  it("Runs / failures query errors do not throw — they leave tables empty", async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total_runs: 1, success_runs: 1 }]);
    mockExecuteQuery.mockRejectedValueOnce(new Error("network"));
    mockExecuteQuery.mockRejectedValueOnce(new Error("network"));

    const { runs, failuresByScorer } = useEvalJobRuns(
      ref<string | null>("job-1"),
      ref(DEFAULT_WINDOW),
      ref(true),
    );
    await flushAsync();

    expect(runs.value).toEqual([]);
    expect(failuresByScorer.value).toEqual([]);
  });
});
