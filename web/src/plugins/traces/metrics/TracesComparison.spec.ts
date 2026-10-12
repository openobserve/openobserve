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

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import searchService from "@/services/search";
import {
  CARDS_PAGE,
  SAMPLE_LIMIT,
  compareFields,
  filterTermFor,
  type ComparisonSelection,
  type SampleRow,
} from "./traceComparison";

const { schemaFields, schemaError, searchObj, viewport } = vi.hoisted(() => ({
  schemaFields: { value: [] as { name: string; type: string }[] },
  schemaError: { value: null as Error | null },
  searchObj: { data: { datetime: { queryRangeRestrictionInHour: 0 } } },
  viewport: { mdUp: true },
}));

vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));

vi.mock("@/services/stream", () => ({
  default: {
    schema: vi.fn(() =>
      schemaError.value
        ? Promise.reject(schemaError.value)
        : Promise.resolve({ data: { schema: [...schemaFields.value] } }),
    ),
  },
}));

vi.mock("@/composables/useTraces", () => ({ default: () => ({ searchObj }) }));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      isMobile: computed(() => !viewport.mdUp),
      isTablet: computed(() => false),
      isDesktop: computed(() => viewport.mdUp),
      mdUp: computed(() => viewport.mdUp),
      lgUp: computed(() => viewport.mdUp),
    }),
  };
});

// `__esModule` is load-bearing: the field cards reach this through defineAsyncComponent.
vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  __esModule: true,
  default: { name: "ChartRenderer", props: ["data"], template: "<div />" },
}));

import TracesComparison from "./TracesComparison.vue";

const search = vi.mocked(searchService.search);
const store = createStore({
  state: { theme: "light", timezone: "UTC", selectedOrganization: { identifier: "org1" } },
});

const MIN = 60 * 1_000_000;
const HOUR = 60 * MIN;
const W0 = Date.UTC(2026, 9, 6, 12, 0, 0) * 1000;
const SELECTION: ComparisonSelection = {
  kind: "duration",
  windowStartUs: W0,
  windowEndUs: W0 + 10 * MIN,
  rangeStartUs: W0 - 30 * MIN,
  rangeEndUs: W0 + 40 * MIN,
  durationLoUs: 100_000,
  durationHiUs: 500_000,
  filter: "service_name = 'a'",
};

// 30 categorical fields whose selection share drifts by field index, so they rank f29 … f0.
const FIELDS = Array.from({ length: 30 }, (_, k) => `f${String(k).padStart(2, "0")}`);
const selRows: SampleRow[] = Array.from({ length: 100 }, (_, i) => ({
  ...Object.fromEntries(FIELDS.map((f, k) => [f, i < 50 + k ? "x" : "y"])),
  trace_id: `s${i}`,
  rare: i < 3 ? "r" : null,
}));
const baseRows: SampleRow[] = Array.from({ length: 100 }, (_, i) => ({
  ...Object.fromEntries(FIELDS.map((f) => [f, i < 50 ? "x" : "y"])),
  trace_id: `b${i}`,
}));
const SCHEMA = [
  ...["_timestamp", "start_time", "end_time", "duration", "events", "trace_id", "rare"],
  ...FIELDS,
].map((name) => ({ name, type: "Utf8" }));

interface Call {
  sql: string;
  start: number;
  end: number;
  signal: AbortSignal;
  resolve: (data: unknown) => void;
  reject: (e: unknown) => void;
}
let calls: Call[] = [];
const isCount = (c: Call) => c.sql.startsWith("SELECT count(*) AS n");
const isSelection = (c: Call) => c.start === SELECTION.windowStartUs && !c.sql.includes("NOT (");
const counts = () => calls.filter(isCount);
const samples = () => calls.filter((c) => !isCount(c));

// Answers each search as it arrives, unless a test takes over.
let autoRespond: ((c: Call) => unknown) | null = null;
const defaultResponse = (c: Call) =>
  isCount(c)
    ? { hits: [{ n: isSelection(c) ? 21077 : 1256694 }] }
    : { hits: isSelection(c) ? selRows : baseRows };

let wrapper: any = null;
const settle = async () => {
  for (let i = 0; i < 8; i++) await flushPromises();
};
const mountPanel = async (selection: ComparisonSelection | null = SELECTION) => {
  wrapper = mount(TracesComparison, {
    props: { selection, streamName: "default" },
    global: { plugins: [i18n, store] },
    attachTo: document.body,
  });
  await settle();
  return wrapper;
};
const has = (test: string) => wrapper.find(`[data-test="${test}"]`).exists();
const text = (test: string) => wrapper.find(`[data-test="${test}"]`).text();

beforeAll(async () => {
  await import("@/components/dashboards/panels/ChartRenderer.vue");
});

beforeEach(() => {
  queryClient.clear();
  calls = [];
  schemaFields.value = SCHEMA;
  schemaError.value = null;
  store.state.timezone = "UTC";
  searchObj.data.datetime.queryRangeRestrictionInHour = 0;
  viewport.mdUp = true;
  autoRespond = defaultResponse;
  search.mockReset();
  search.mockImplementation((req: any) => {
    return new Promise((resolve, reject) => {
      const q = req.query.query;
      const call: Call = {
        sql: q.sql,
        start: q.start_time,
        end: q.end_time,
        signal: req.signal,
        resolve: (data) => resolve({ data }),
        reject,
      };
      calls.push(call);
      if (autoRespond) call.resolve(autoRespond(call));
    }) as any;
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("TracesComparison", () => {
  it("shows the no-selection state and sends nothing without a selection", async () => {
    await mountPanel(null);
    expect(has("traces-comparison-no-selection")).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it("reads the schema, then counts both populations, then samples both, each pair in parallel", async () => {
    autoRespond = null;
    await mountPanel();
    expect(has("traces-comparison-loading")).toBe(true);
    expect(counts()).toHaveLength(2);
    expect(samples()).toHaveLength(0);
    for (const c of counts()) c.resolve(defaultResponse(c));
    await settle();
    expect(samples()).toHaveLength(2);
    for (const c of samples()) c.resolve(defaultResponse(c));
    await settle();
    expect(has("traces-comparison")).toBe(true);
  });

  it("sends each request with its population's own window and the search signal", async () => {
    await mountPanel();
    const sel = calls.filter(isSelection);
    expect(sel.every((c) => c.start === W0 && c.end === W0 + 10 * MIN)).toBe(true);
    expect(search.mock.calls.every(([req]: any[]) => req.page_type === "traces")).toBe(true);
    expect(calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
  });

  it("never names a reference_* column on a root-only stream", async () => {
    await mountPanel();
    expect(calls.some((c) => c.sql.includes("reference_parent"))).toBe(false);
  });

  it("keeps every request inside a 1 h query-range limit and says so in the note", async () => {
    searchObj.data.datetime.queryRangeRestrictionInHour = 1;
    await mountPanel({ ...SELECTION, rangeStartUs: W0 - 12 * HOUR, rangeEndUs: W0 + 12 * HOUR });
    expect(calls.every((c) => c.end - c.start <= HOUR)).toBe(true);
    expect(text("traces-comparison-sample-note")).toContain("1-hour query limit");
  });

  it("shows the distinct server messages of a partial response, one per line, and no cards", async () => {
    autoRespond = (c) => ({
      ...defaultResponse(c),
      is_partial: true,
      function_error: ["a", "b", "a"],
    });
    await mountPanel();
    expect(has("traces-comparison-error")).toBe(true);
    const lines = wrapper
      .findAll('[data-test="traces-comparison-error-line"]')
      .map((l: any) => l.text());
    expect(lines).toEqual(["a", "b"]);
    expect(wrapper.findAll('[data-test^="traces-comparison-field-"]')).toHaveLength(0);
  });

  it("explains a partial response without messages as a shortened range", async () => {
    autoRespond = (c) => ({ ...defaultResponse(c), is_partial: true, function_error: [] });
    await mountPanel();
    expect(text("traces-comparison-error")).toContain(
      i18n.global.t("traces.comparison.rangeClamped"),
    );
  });

  it("treats a moved start time as a clamped response", async () => {
    autoRespond = (c) => ({ ...defaultResponse(c), new_start_time: c.start + 1 });
    await mountPanel();
    expect(has("traces-comparison-error")).toBe(true);
  });

  it("renders the cards in score order with the sample and noise notes", async () => {
    await mountPanel();
    const cards = wrapper.findAll('[data-test^="traces-comparison-field-"]');
    const scores = cards.map((c: any) => Number(c.attributes("data-score")));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(cards[0].attributes("data-test")).toBe("traces-comparison-field-f29");
    const note = text("traces-comparison-sample-note");
    expect(note).toContain("100 sampled of 21,077 spans");
    expect(note).toContain("100 sampled of 1,256,694 spans");
    expect(note).toContain("within sampling noise");
  });

  it("shows the empty-baseline state and samples nothing when the baseline count is 0", async () => {
    autoRespond = (c) =>
      isCount(c) && !isSelection(c) ? { hits: [{ n: 0 }] } : defaultResponse(c);
    await mountPanel();
    expect(has("traces-comparison-empty-baseline")).toBe(true);
    expect(samples()).toHaveLength(0);
  });

  it("shows the empty-selection state when the selection count is 0", async () => {
    autoRespond = (c) => (isCount(c) && isSelection(c) ? { hits: [{ n: 0 }] } : defaultResponse(c));
    await mountPanel();
    expect(has("traces-comparison-empty-selection")).toBe(true);
  });

  it("refetches only the baseline, over the window just before, when the baseline is toggled", async () => {
    await mountPanel();
    const before = calls.length;
    const selectionSignals = calls.filter(isSelection).map((c) => c.signal);
    await wrapper.find('[data-test="traces-comparison-baseline-toggle-before"]').trigger("click");
    await settle();
    const added = calls.slice(before);
    expect(added).toHaveLength(2);
    expect(added.filter(isCount)).toHaveLength(1);
    const sample = added.find((c) => !isCount(c))!;
    expect(sample.end).toBe(SELECTION.windowStartUs);
    expect(sample.start).toBe(SELECTION.windowStartUs - 10 * MIN);
    expect(selectionSignals.every((s) => !s.aborted)).toBe(true);
    expect(has("traces-comparison")).toBe(true);
  });

  it("pairs the in-flight selection sample with the new baseline after a toggle during load", async () => {
    autoRespond = (c) => (isCount(c) ? defaultResponse(c) : undefined);
    search.mockImplementation((req: any) => {
      return new Promise((resolve, reject) => {
        const q = req.query.query;
        const call: Call = {
          sql: q.sql,
          start: q.start_time,
          end: q.end_time,
          signal: req.signal,
          resolve: (data) => resolve({ data }),
          reject,
        };
        calls.push(call);
        if (isCount(call)) call.resolve(defaultResponse(call));
      }) as any;
    });
    await mountPanel();
    const selSample = samples().find(isSelection)!;
    const oldBase = samples().find((c) => !isSelection(c))!;
    await wrapper.find('[data-test="traces-comparison-baseline-toggle-before"]').trigger("click");
    await settle();
    const newBase = samples().filter((c) => !isSelection(c))[1];
    expect(newBase.start).toBe(SELECTION.windowStartUs - 10 * MIN);
    // The new baseline is "just before"; give it distinct rows so the result shows which one was used.
    const beforeRows = baseRows.map((r) => ({ ...r, f00: "z" }));

    oldBase.resolve({ hits: baseRows });
    await settle();
    selSample.resolve({ hits: selRows });
    await settle();
    newBase.resolve({ hits: beforeRows });
    await settle();

    expect(samples().filter(isSelection)).toHaveLength(1);
    expect(has("traces-comparison")).toBe(true);
    const expected = compareFields(selRows, beforeRows, SCHEMA.slice(5), "duration");
    const f00 = wrapper.find('[data-test="traces-comparison-field-f00"]');
    const want = [...expected.ranked, ...expected.mostlyEmpty].find((f) => f.name === "f00")!;
    expect(Number(f00.attributes("data-score"))).toBeCloseTo(want.score, 1);
  });

  it("refetches a selection sample that failed when the baseline is toggled", async () => {
    autoRespond = (c) => {
      if (!isCount(c) && isSelection(c)) {
        c.reject(new Error("boom"));
        return undefined;
      }
      return defaultResponse(c);
    };
    await mountPanel();
    expect(has("traces-comparison-error")).toBe(true);
    autoRespond = defaultResponse;
    await wrapper.find('[data-test="traces-comparison-baseline-toggle-before"]').trigger("click");
    await settle();
    expect(samples().filter(isSelection)).toHaveLength(2);
    expect(has("traces-comparison")).toBe(true);
  });

  it("samples the outside baseline over the capped window and says so", async () => {
    await mountPanel({ ...SELECTION, rangeStartUs: W0 - 12 * HOUR, rangeEndUs: W0 + 12 * HOUR });
    const base = samples().find((c) => !isSelection(c))!;
    expect([base.start, base.end]).toEqual([W0 - 3 * HOUR, W0 + 10 * MIN + 3 * HOUR]);
    expect(text("traces-comparison-sample-note")).toContain("up to 3 h either side");
  });

  it("treats a sample that hits the row limit as an error, and Retry counts again", async () => {
    const full = Array.from({ length: SAMPLE_LIMIT }, () => ({ f00: "x" }));
    autoRespond = (c) => (!isCount(c) && isSelection(c) ? { hits: full } : defaultResponse(c));
    await mountPanel();
    expect(text("traces-comparison-error")).toContain("does not match the span count");
    const before = counts().length;
    autoRespond = defaultResponse;
    await wrapper.find('[data-test="traces-comparison-error"] button').trigger("click");
    await settle();
    expect(counts().length).toBeGreaterThan(before);
    expect(has("traces-comparison")).toBe(true);
  });

  it("shows a rejected search as an error that Retry refetches, but ignores an abort", async () => {
    autoRespond = (c) => {
      c.reject(new Error("server down"));
      return undefined;
    };
    await mountPanel();
    expect(has("traces-comparison-error")).toBe(true);
    autoRespond = defaultResponse;
    await wrapper.find('[data-test="traces-comparison-error"] button').trigger("click");
    await settle();
    expect(has("traces-comparison")).toBe(true);

    wrapper.unmount();
    wrapper = null;
    autoRespond = (c) => {
      c.reject(Object.assign(new Error("canceled"), { name: "CanceledError" }));
      return undefined;
    };
    await mountPanel();
    expect(has("traces-comparison-error")).toBe(false);
  });

  it("renders the next page of cards on Show more", async () => {
    await mountPanel();
    const cards = () => wrapper.findAll('[data-test^="traces-comparison-field-"]').length;
    expect(cards()).toBe(CARDS_PAGE);
    await wrapper.find('[data-test="traces-comparison-show-more"]').trigger("click");
    expect(cards()).toBe(30);
  });

  it("collapses the mostly-empty and high-cardinality groups, which list their fields", async () => {
    await mountPanel();
    for (const [group, field] of [
      ["traces-comparison-mostly-empty", "rare"],
      ["traces-comparison-high-cardinality", "trace_id"],
    ]) {
      const el = wrapper.find(`[data-test="${group}"]`);
      expect(el.attributes("data-state")).toBe("closed");
      await el.find("button").trigger("click");
      await settle();
      expect(wrapper.find(`[data-test="${group}"]`).text()).toContain(field);
    }
  });

  it("emits apply-filter with the term of a clicked value", async () => {
    await mountPanel();
    await wrapper.find('[data-test="traces-comparison-include-f29-0"]').trigger("click");
    const result = compareFields(selRows, baseRows, SCHEMA.slice(5), "duration");
    const f29 = result.ranked.find((f) => f.name === "f29")!;
    expect(wrapper.emitted("apply-filter")).toEqual([
      [filterTermFor(f29, f29.rows[0].bucket, "include")],
    ]);
  });

  it("keeps the selection summary visible on phones", async () => {
    viewport.mdUp = false;
    await mountPanel();
    const summary = wrapper.find('[data-test="traces-comparison-summary"]');
    expect(summary.exists()).toBe(true);
    expect(summary.text()).toContain("12:00:00");
    for (let el = summary.element as HTMLElement | null; el; el = el.parentElement) {
      expect(el.className?.toString() ?? "").not.toContain("max-md:hidden");
    }
  });
  it("shows the error state when the schema cannot be read, and Retry reads it again", async () => {
    schemaError.value = new Error("schema down");
    await mountPanel();
    expect(has("traces-comparison-error")).toBe(true);
    expect(has("traces-comparison-loading")).toBe(false);
    expect(search).not.toHaveBeenCalled();
    schemaError.value = null;
    await wrapper.find('[data-test="traces-comparison-error"] button').trigger("click");
    await settle();
    expect(has("traces-comparison")).toBe(true);
  });

  it("keeps the schema error and its Retry when the baseline is toggled", async () => {
    schemaError.value = new Error("schema down");
    await mountPanel();
    await wrapper.find('[data-test="traces-comparison-baseline-toggle-before"]').trigger("click");
    await settle();
    expect(has("traces-comparison-loading")).toBe(false);
    expect(wrapper.find('[data-test="traces-comparison-error"] button').exists()).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it("resumes after a schema refetch error once Retry reads the same columns, and shows a repeat failure", async () => {
    await mountPanel();
    schemaError.value = new Error("schema down");
    await queryClient.refetchQueries();
    await settle();
    expect(has("traces-comparison-error")).toBe(true);

    await wrapper.find('[data-test="traces-comparison-error"] button').trigger("click");
    await settle();
    expect(has("traces-comparison-loading")).toBe(false);
    expect(has("traces-comparison-error")).toBe(true);

    schemaError.value = null;
    await wrapper.find('[data-test="traces-comparison-error"] button').trigger("click");
    await settle();
    expect(has("traces-comparison")).toBe(true);
  });

  it("keeps a finished comparison when the schema refetches with the same columns", async () => {
    await mountPanel();
    expect(has("traces-comparison")).toBe(true);
    const before = calls.length;
    schemaFields.value = [...SCHEMA, { name: "_o2_extra", type: "Utf8" }];
    await queryClient.refetchQueries();
    await settle();
    expect(calls.length).toBe(before);
    expect(has("traces-comparison")).toBe(true);
  });

  it("decides whether the window spans two days in the app time zone", async () => {
    store.state.timezone = "Asia/Kolkata";
    // 18:00–19:00 UTC is one UTC day but 23:30–00:30 across midnight in Kolkata.
    const start = Date.UTC(2026, 9, 6, 18, 0, 0) * 1000;
    await mountPanel({
      ...SELECTION,
      kind: "rate",
      windowStartUs: start,
      windowEndUs: start + HOUR,
    });
    expect(text("traces-comparison-summary")).toBe("10-06 23:30:00–10-07 00:30:00");
  });

  it("puts only inline elements inside the empty state's paragraph", async () => {
    autoRespond = (c) => ({ ...defaultResponse(c), is_partial: true, function_error: ["a", "b"] });
    await mountPanel();
    const lines = wrapper.findAll('[data-test="traces-comparison-error-line"]');
    expect(lines.map((l: any) => l.element.tagName)).toEqual(["SPAN", "SPAN"]);
    expect(wrapper.find('[data-test="traces-comparison-error"] p div').exists()).toBe(false);
  });
});
