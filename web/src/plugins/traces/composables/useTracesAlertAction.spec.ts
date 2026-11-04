// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, reactive } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import searchService from "@/services/search";
import {
  alertCreationDialog,
  closeAlertCreationDialog,
  rebuildAlertPrefill,
} from "@/composables/alerts/useAlertCreation";
import { tracesSearchRunSignature } from "@/plugins/traces/tracesSearchBar.utils";

vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));

const state = vi.hoisted(() => ({ searchObj: null as any }));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: state.searchObj, tracesParser: { value: null } }),
}));

const resolveSpy = vi.hoisted(() => vi.fn((text: string | undefined) => (text ?? "").trim()));
vi.mock("@/utils/traces/resolveTracesFilter", () => ({ resolveTracesFilter: resolveSpy }));

import { useTracesAlertAction } from "./useTracesAlertAction";

const search = vi.mocked(searchService.search);

const makeSearchObj = () =>
  reactive({
    meta: { searchMode: "traces", sqlMode: false, lastRunSignature: null as string | null },
    data: {
      editorValue: "service_name = 'checkout'",
      stream: { selectedStream: { label: "default", value: "default" } as any },
      datetime: { type: "relative", relativeTimePeriod: "15m", startTime: 0, endTime: 0 },
    },
  });

const markRun = () => {
  state.searchObj.meta.lastRunSignature = tracesSearchRunSignature(state.searchObj);
};

let action: ReturnType<typeof useTracesAlertAction>;
const mountHost = () =>
  mount(
    defineComponent({
      setup() {
        action = useTracesAlertAction();
        return () => null;
      },
    }),
    { global: { plugins: [i18n, store] } },
  );

const respond = (row: Record<string, unknown> | null) =>
  search.mockResolvedValue({ data: { hits: row ? [row] : [] } } as any);

describe("useTracesAlertAction", () => {
  beforeEach(() => {
    state.searchObj = makeSearchObj();
    search.mockReset();
    resolveSpy.mockClear();
    closeAlertCreationDialog();
  });
  afterEach(() => closeAlertCreationDialog());

  it("is disabled with 'Pick a stream first' when no stream is selected", () => {
    state.searchObj.data.stream.selectedStream = { label: "", value: "" };
    mountHost();
    expect(action.disabledReason.value).toBe("Pick a stream first");
  });

  it("is enabled once a stream is selected", () => {
    mountHost();
    expect(action.disabledReason.value).toBeNull();
  });

  it("seeds an Errors alert from one count over the capped period and opens the confirm dialog", async () => {
    state.searchObj.data.datetime = {
      type: "relative",
      relativeTimePeriod: "6h",
      startTime: 0,
      endTime: 0,
    };
    markRun();
    respond({ errors: 720 });
    mountHost();
    const before = Date.now() * 1000;
    await action.createAlert("errors");
    await flushPromises();

    expect(search).toHaveBeenCalledTimes(2);
    const [arg] = search.mock.calls[0];
    expect(arg.page_type).toBe("traces");
    expect(arg.query.query.sql).toBe(
      "SELECT approx_distinct(trace_id) AS errors FROM \"default\" WHERE (service_name = 'checkout') AND span_status = 'ERROR'",
    );
    const { start_time, end_time } = arg.query.query;
    expect(end_time).toBeGreaterThanOrEqual(before);
    expect(end_time - start_time).toBe(60 * 60 * 1_000_000);

    const prefill = alertCreationDialog.value?.prefill;
    expect(alertCreationDialog.value?.open).toBe(true);
    expect(prefill?.streamType).toBe("traces");
    expect(prefill?.sql).toContain("HAVING approx_distinct(trace_id) > 1080");
    expect(prefill?.triggerThreshold).toBe(1);
    expect(prefill?.triggerOperator).toBe(">=");
    expect(prefill?.warnings.map((w) => w.key)).toContain("tracesPeriodCapped");
    expect(prefill?.warnings.map((w) => w.key)).not.toContain("tracesNotRun");
  });

  it("counts spans in the Spans view", async () => {
    state.searchObj.meta.searchMode = "spans";
    markRun();
    respond({ matches: 10 });
    mountHost();
    await action.createAlert("matches");
    expect(search.mock.calls[0][0].query.query.sql).toBe(
      "SELECT count(*) AS matches FROM \"default\" WHERE service_name = 'checkout'",
    );
    expect(alertCreationDialog.value?.prefill.meta?.view).toBe("spans");
  });

  it("uses the editor's filter with a 'not run yet' note when the query has not run", async () => {
    state.searchObj.data.editorValue = "duration > '500ms'";
    respond({ matches: 3 });
    mountHost();
    await action.createAlert("matches");
    expect(resolveSpy).toHaveBeenCalledWith("duration > '500ms'", null, "default");
    const keys = alertCreationDialog.value?.prefill.warnings.map((w) => w.key);
    expect(keys).toContain("tracesNotRun");
  });

  it("passes a null seed when the count fails", async () => {
    markRun();
    search.mockRejectedValue(new Error("boom"));
    mountHost();
    await action.createAlert("rate");
    const prefill = alertCreationDialog.value?.prefill;
    expect(prefill?.meta?.seed).toBeNull();
    expect(prefill?.warnings.map((w) => w.key)).toContain("tracesSeedUnavailable");
  });

  it("treats a null seed value as unavailable instead of seeding 0", async () => {
    markRun();
    respond({ p95_duration: null, spans: 0 });
    mountHost();
    await action.createAlert("duration");
    const prefill = alertCreationDialog.value?.prefill;
    expect(prefill?.meta?.seed).toBeNull();
    expect(prefill?.warnings.map((w) => w.key)).toContain("tracesSeedUnavailable");
  });

  it("ignores a second click while the seed queries are still running", async () => {
    markRun();
    respond({ matches: 5 });
    mountHost();
    const first = action.createAlert("matches");
    const second = action.createAlert("matches");
    await Promise.all([first, second]);
    expect(search).toHaveBeenCalledTimes(1);

    await action.createAlert("matches");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a stream", async () => {
    state.searchObj.data.stream.selectedStream = null;
    mountHost();
    await action.createAlert("errors");
    expect(search).not.toHaveBeenCalled();
    expect(alertCreationDialog.value).toBeNull();
  });

  it("offers Error count (default) and Error rate as query choices for Errors, and rebuilds on a pick", async () => {
    markRun();
    search.mockImplementation((async (arg: any) => {
      const sql: string = arg.query.query.sql;
      const row = sql.includes("AS error_rate")
        ? { error_rate: 4.2, traces: 500 }
        : { errors: 720 };
      return { data: { hits: [row] } };
    }) as any);
    mountHost();
    await action.createAlert("errors");

    expect(search).toHaveBeenCalledTimes(2);
    const prefill = alertCreationDialog.value!.prefill;
    expect(prefill.queryChoices?.map((c) => c.tabName)).toEqual(["Error count", "Error rate"]);
    expect(prefill.queryIndex).toBe(0);
    expect(prefill.sql).toContain("HAVING approx_distinct(trace_id) > 1080");

    rebuildAlertPrefill({ queryIndex: 1 });
    const rebuilt = alertCreationDialog.value!.prefill;
    expect(rebuilt.queryIndex).toBe(1);
    expect(rebuilt.sql).toContain("AS error_rate");
    expect(rebuilt.sql).toMatch(/HAVING CAST\(.+\) \* 100 \/ approx_distinct\(trace_id\) > 7 /);
  });

  it("offers p50/p95/p99 as query choices for Duration, p95 first, and rebuilds on a pick", async () => {
    markRun();
    search.mockImplementation((async (arg: any) => {
      const sql: string = arg.query.query.sql;
      const p = sql.match(/AS (p\d+)_duration/)![1];
      const value = { p50: 1000, p95: 2000, p99: 3000 }[p];
      return { data: { hits: [{ [`${p}_duration`]: value, spans: 100 }] } };
    }) as any);
    mountHost();
    await action.createAlert("duration");

    expect(search).toHaveBeenCalledTimes(3);
    const prefill = alertCreationDialog.value!.prefill;
    expect(prefill.queryChoices?.map((c) => c.tabName)).toEqual(["p50", "p95", "p99"]);
    expect(prefill.queryIndex).toBe(1);
    expect(prefill.sql).toContain("approx_percentile_cont(duration, 0.95) > 3000");

    rebuildAlertPrefill({ queryIndex: 2 });
    const rebuilt = alertCreationDialog.value!.prefill;
    expect(rebuilt.queryIndex).toBe(2);
    expect(rebuilt.sql).toContain("approx_percentile_cont(duration, 0.99) > 4500");
  });
});
