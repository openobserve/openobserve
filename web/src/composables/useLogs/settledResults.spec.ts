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

import { describe, it, expect } from "vitest";
import { nextTick, reactive } from "vue";
import {
  EMPTY_SETTLED,
  resolveHistogramView,
  resolveSummary,
  useSettledSummary,
  type SettledSummary,
  type SummaryInput,
} from "./settledResults";

const parts = (total: string, took = 100, start = 1, end = 50) => ({
  start,
  end,
  total,
  took,
  scanLabel: "Scan Size",
  scanSize: "1 GB",
});

const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  loading: false,
  loadingHistogram: false,
  parts: null,
  hasHits: false,
  failed: false,
  pageCount: 1,
  ...over,
});

const settledWith = (total: string, pageCount = 5): SettledSummary => ({
  parts: parts(total),
  pageCount,
});

describe("resolveSummary", () => {
  it("shows no values while a first run is still counting", () => {
    const { view } = resolveSummary(
      input({ loadingHistogram: true, parts: parts("51"), hasHits: true, pageCount: 2 }),
      EMPTY_SETTLED,
    );
    expect(view).toEqual({ parts: null, updating: true, pageCount: 1 });
  });

  it("never shows a per-partition total before the count settles", () => {
    let settled = EMPTY_SETTLED;
    const shown: string[] = [];
    for (const total of ["51", "3.0K", "1.8M", "3.5M"]) {
      const next = resolveSummary(
        input({ loadingHistogram: true, parts: parts(total), hasHits: true }),
        settled,
      );
      settled = next.settled;
      if (next.view.parts) shown.push(next.view.parts.total);
    }
    expect(shown).toEqual([]);
  });

  it("writes total, took, scan and page count once the run settles", () => {
    const { view, settled } = resolveSummary(
      input({ parts: parts("3.6M", 654), hasHits: true, pageCount: 11 }),
      EMPTY_SETTLED,
    );
    expect(view).toMatchObject({ updating: false, pageCount: 11 });
    expect(view.parts).toMatchObject({ total: "3.6M", took: 654 });
    expect(settled.pageCount).toBe(11);
  });

  it("keeps the previous run's values, marked as updating, while a new run loads", () => {
    const prior = settledWith("3.6M", 11);
    const starting = resolveSummary(input({ loading: true }), prior);
    const interim = resolveSummary(
      input({ loadingHistogram: true, parts: parts("51", 243), hasHits: true, pageCount: 2 }),
      prior,
    );
    for (const { view } of [starting, interim]) {
      expect(view).toMatchObject({ updating: true, pageCount: 11 });
      expect(view.parts?.total).toBe("3.6M");
    }
  });

  it("keeps the event total when the next page settles", () => {
    const prior = settledWith("3.6M", 11);
    const loadingPage = resolveSummary(input({ loading: true, parts: parts("3.6M") }), prior);
    expect(loadingPage.view.parts?.start).toBe(1);
    const page2 = resolveSummary(
      input({ parts: parts("3.6M", 175, 51, 100), hasHits: true, pageCount: 12 }),
      loadingPage.settled,
    );
    expect(page2.view.parts).toMatchObject({ start: 51, end: 100, total: "3.6M" });
    expect(page2.view.updating).toBe(false);
  });

  it("shows no stale values after a failed run", () => {
    const { view, settled } = resolveSummary(
      input({ failed: true, parts: parts("0") }),
      settledWith("3.6M"),
    );
    expect(view.parts).toBeNull();
    expect(settled.parts).toBeNull();
  });

  it("shows no stale values after a run cancelled before any rows arrived", () => {
    const { view } = resolveSummary(input(), settledWith("3.6M"));
    expect(view).toMatchObject({ parts: null, updating: false });
  });

  it("waits for the rows' post-processing instead of blanking the chips", () => {
    const { view } = resolveSummary(input({ hasHits: true }), settledWith("3.6M"));
    expect(view).toMatchObject({ updating: true });
    expect(view.parts?.total).toBe("3.6M");
  });

  it("settles at once for runs without a follow-up count, like SQL aggregations", () => {
    const { view } = resolveSummary(
      input({ parts: parts("12", 30, 1, 12), hasHits: true }),
      settledWith("3.6M"),
    );
    expect(view).toMatchObject({ updating: false });
    expect(view.parts?.total).toBe("12");
  });
});

describe("useSettledSummary", () => {
  it("rewrites the chips once per re-query, however many partitions stream in", async () => {
    const state = reactive(input({ parts: parts("3.6M"), hasHits: true, pageCount: 11 }));
    const view = useSettledSummary(() => ({ ...state }));
    const seen: string[] = [];
    const record = () => seen.push(`${view.value.parts?.total}|${view.value.parts?.took}`);
    record();

    state.loading = true;
    state.parts = null;
    await nextTick();
    record();
    state.parts = parts("51", 243);
    state.hasHits = true;
    state.pageCount = 2;
    state.loadingHistogram = true;
    state.loading = false;
    await nextTick();
    record();
    for (const [total, took] of [
      ["3.0K", 332],
      ["1.8M", 550],
    ] as const) {
      state.parts = parts(total, took);
      await nextTick();
      record();
    }
    state.parts = parts("3.7M", 654);
    state.pageCount = 11;
    state.loadingHistogram = false;
    await nextTick();
    record();

    expect([...new Set(seen)]).toEqual(["3.6M|100", "3.7M|654"]);
    expect(view.value.updating).toBe(false);
  });
});

describe("resolveHistogramView", () => {
  const base = {
    showHistogram: true,
    hasChart: false,
    loading: false,
    loadingHistogram: false,
    histogramPoints: 0,
    liveMode: false,
  };

  it("holds one placeholder until the first chart exists, with no empty state in between", () => {
    expect(resolveHistogramView({ ...base, loading: true }).phase).toBe("placeholder");
    expect(
      resolveHistogramView({ ...base, loadingHistogram: true, histogramPoints: 40 }).phase,
    ).toBe("placeholder");
  });

  it("shows the empty state only once an idle run produced no chart", () => {
    expect(resolveHistogramView(base).phase).toBe("empty");
  });

  it("keeps the previous chart, marked stale, while a re-query replaces it", () => {
    const starting = resolveHistogramView({ ...base, hasChart: true, loading: true });
    const streaming = resolveHistogramView({
      ...base,
      hasChart: true,
      loadingHistogram: true,
      histogramPoints: 12,
    });
    expect(starting).toEqual({ phase: "chart", stale: true });
    expect(streaming).toEqual({ phase: "chart", stale: true });
  });

  it("does not mark the chart stale while only the page changes", () => {
    expect(
      resolveHistogramView({ ...base, hasChart: true, loading: true, histogramPoints: 91 }),
    ).toEqual({ phase: "chart", stale: false });
  });

  it("does not dim the chart on every live-mode tick", () => {
    expect(
      resolveHistogramView({
        ...base,
        hasChart: true,
        loadingHistogram: true,
        histogramPoints: 91,
        liveMode: true,
      }).stale,
    ).toBe(false);
  });

  it("drops a leftover chart when the settled run has no histogram points", () => {
    expect(resolveHistogramView({ ...base, hasChart: true }).phase).toBe("empty");
  });

  it("renders nothing while the histogram is hidden", () => {
    expect(resolveHistogramView({ ...base, showHistogram: false, loading: true }).phase).toBe(
      "hidden",
    );
  });
});
