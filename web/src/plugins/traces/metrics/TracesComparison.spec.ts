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
  searchObj: {
    data: { datetime: { queryRangeRestrictionInHour: 0 } },
    meta: { searchMode: "traces" as "traces" | "spans" },
  },
  viewport: { mdUp: true },
}));

vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));

// A pass-through portal keeps the drawer's body inside the wrapper, where the helpers look.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  const { defineComponent } = await import("vue");
  return {
    ...actual,
    DialogPortal: defineComponent(
      (_, { slots }) =>
        () =>
          slots.default?.(),
    ),
  };
});

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

import { DialogContent } from "reka-ui";
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
    ? { hits: isSelection(c) ? [{ n: 21077, traces: 3120 }] : [{ n: 1256694, traces: 98012 }] }
    : { hits: isSelection(c) ? selRows : baseRows };

let wrapper: any = null;
const settle = async () => {
  for (let i = 0; i < 8; i++) await flushPromises();
};
const PRESET_CONTEXT = { rangeStartUs: W0, rangeEndUs: W0 + HOUR, filter: "service_name = 'a'" };
const mountPanel = async (selection: ComparisonSelection | null = SELECTION) => {
  wrapper = mount(TracesComparison, {
    props: { selection, streamName: "default", presetContext: PRESET_CONTEXT },
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
  searchObj.meta.searchMode = "traces";
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
  document.body.innerHTML = "";
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

  describe("side panel", () => {
    const drawer = () => wrapper.findComponent({ name: "ODrawer" });
    const panel = () =>
      wrapper
        .findAllComponents(DialogContent)
        .find((c: any) => c.attributes("data-o2-drawer") !== undefined)!;

    it("opens as a non-modal Drill down panel over the right of the results", async () => {
      await mountPanel(null);
      expect(drawer().props()).toMatchObject({
        open: true,
        modal: false,
        seamless: true,
        side: "right",
        portalTarget: "#tracesThirdLevel",
        title: i18n.global.t("traces.drillDown"),
      });
      expect(wrapper.text()).not.toMatch(/comparison|compare selection/i);
      expect(document.body.style.pointerEvents).not.toBe("none");
    });

    it("leaves the list behind it interactive, never inert", async () => {
      const list = document.createElement("div");
      list.setAttribute("data-test", "traces-search-result-list");
      document.body.appendChild(list);
      await mountPanel();
      expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    });

    it("closes from the × button", async () => {
      await mountPanel();
      await wrapper.find('[data-test="o-drawer-close-btn"]').trigger("click");
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it("closes on Escape", async () => {
      await mountPanel();
      const target = document.createElement("div");
      document.body.appendChild(target);
      const ev = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      target.dispatchEvent(ev);
      await panel().vm.$emit("escapeKeyDown", ev);
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it("heads the panel with the selected and baseline trace counts in the Traces view", async () => {
      await mountPanel();
      expect(text("traces-drill-down-counts")).toBe(
        "3,120 selected traces vs 98,012 baseline traces",
      );
    });

    it("counts spans in the Spans view", async () => {
      searchObj.meta.searchMode = "spans";
      await mountPanel();
      expect(text("traces-drill-down-counts")).toBe(
        "21,077 selected spans vs 1,256,694 baseline spans",
      );
    });

    it("labels the baseline toggle Rest of range and Before selection", async () => {
      await mountPanel();
      expect(text("traces-comparison-baseline-toggle-outside")).toBe("Rest of range");
      expect(text("traces-comparison-baseline-toggle-before")).toBe("Before selection");
    });
  });

  describe("presets", () => {
    const R0 = PRESET_CONTEXT.rangeStartUs;
    const R1 = PRESET_CONTEXT.rangeEndUs;
    const MID = R0 + HOUR / 2;
    const pick = async (preset: string) => {
      await wrapper.find(`[data-test="traces-drill-down-preset-${preset}"]`).trigger("click");
      await settle();
    };
    // Preset selections are told apart from their baselines by the error term or the window.
    const presetResponse = (c: Call) => {
      if (c.sql.includes("approx_percentile_cont")) return { hits: [{ p90: 250_000 }] };
      const selection =
        (c.sql.includes("span_status = 'ERROR'") && !c.sql.includes("!= 'ERROR'")) ||
        (c.sql.includes("duration >= 250000") && !c.sql.includes("NOT (")) ||
        c.start === MID;
      if (isCount(c)) return { hits: [{ n: selection ? 40 : 400, traces: selection ? 4 : 40 }] };
      return { hits: selection ? selRows : baseRows };
    };

    beforeEach(() => {
      autoRespond = presetResponse;
    });

    it("offers the three presets under the no-selection message and searches nothing", async () => {
      await mountPanel(null);
      expect(has("traces-comparison-no-selection")).toBe(true);
      expect(text("traces-drill-down-presets")).toContain("Or start from a preset");
      for (const [id, label] of [
        ["errors", "Errors vs rest"],
        ["slowest", "Slowest 10% vs rest"],
        ["recent", "Recent vs earlier"],
      ]) {
        expect(text(`traces-drill-down-preset-${id}`)).toBe(label);
      }
      expect(search).not.toHaveBeenCalled();
    });

    it("compares the errors in the whole range with the rest of it", async () => {
      await mountPanel(null);
      await pick("errors");
      const where = counts().map((c) => c.sql);
      expect(counts().every((c) => c.start === R0 && c.end === R1)).toBe(true);
      expect(where.some((q) => q.endsWith("AND span_status = 'ERROR'"))).toBe(true);
      expect(where.some((q) => q.includes("COALESCE(span_status, '') != 'ERROR'"))).toBe(true);
      expect(has("traces-comparison")).toBe(true);
      expect(has("traces-drill-down-presets")).toBe(false);
    });

    it("asks for the p90 duration first, then compares the spans at or over it", async () => {
      await mountPanel(null);
      await pick("slowest");
      expect(calls[0].sql).toBe(
        `SELECT approx_percentile_cont(duration, 0.9) AS p90 FROM "default" WHERE (service_name = 'a')`,
      );
      expect([calls[0].start, calls[0].end]).toEqual([R0, R1]);
      expect(counts().some((c) => c.sql.endsWith("AND duration >= 250000"))).toBe(true);
      expect(has("traces-comparison")).toBe(true);
    });

    it("stays on the presets and says so when the range has no durations", async () => {
      autoRespond = (c) => ({ hits: c.sql.includes("approx_percentile_cont") ? [] : [] });
      await mountPanel(null);
      await pick("slowest");
      expect(counts()).toHaveLength(0);
      expect(has("traces-drill-down-presets")).toBe(true);
      expect(text("traces-drill-down-preset-empty")).toBe(
        i18n.global.t("traces.drillDownPanel.presetEmpty"),
      );
    });

    it("goes back to the presets with a note when a preset finds no spans", async () => {
      autoRespond = (c) => {
        const errorsSide = c.sql.includes("span_status = 'ERROR'") && !c.sql.includes("!= 'ERROR'");
        return isCount(c) ? { hits: [{ n: errorsSide ? 0 : 400, traces: 0 }] } : { hits: [] };
      };
      await mountPanel(null);
      await pick("errors");
      expect(has("traces-comparison-empty-selection")).toBe(false);
      expect(has("traces-drill-down-presets")).toBe(true);
      expect(text("traces-drill-down-preset-empty")).toBe(
        i18n.global.t("traces.drillDownPanel.presetNoMatch"),
      );
    });

    it("shows the slowest preset's band as a readable duration", async () => {
      autoRespond = (c) => {
        if (c.sql.includes("approx_percentile_cont")) return { hits: [{ p90: 18_900 }] };
        const selection = c.sql.includes("duration >= 18900") && !c.sql.includes("NOT (");
        if (isCount(c)) return { hits: [{ n: selection ? 40 : 400, traces: 4 }] };
        return { hits: selection ? selRows : baseRows };
      };
      await mountPanel(null);
      await pick("slowest");
      expect(text("traces-comparison-summary")).toContain("≥ 18.90ms");
      expect(text("traces-comparison-summary")).not.toContain("us");
    });

    it("never flashes the presets while a preset with another baseline loads", async () => {
      autoRespond = (c) =>
        isCount(c) && c.start === MID ? { hits: [{ n: 0, traces: 0 }] } : presetResponse(c);
      await mountPanel(null);
      await pick("recent");
      expect(has("traces-drill-down-presets")).toBe(true);
      autoRespond = null;
      await wrapper.find('[data-test="traces-drill-down-preset-slowest"]').trigger("click");
      await settle();
      const seen: boolean[] = [];
      const observer = new MutationObserver(() =>
        seen.push(!!document.querySelector('[data-test="traces-drill-down-presets"]')),
      );
      observer.observe(document.body, { childList: true, subtree: true });
      calls
        .find((c) => c.sql.includes("approx_percentile_cont"))!
        .resolve({ hits: [{ p90: 250_000 }] });
      await settle();
      observer.disconnect();
      expect(seen).not.toContain(true);
      expect(has("traces-comparison-loading")).toBe(true);
    });

    it("words the query-limit error for a preset as a range, not a selection", async () => {
      searchObj.data.datetime.queryRangeRestrictionInHour = 0.5;
      await mountPanel(null);
      await pick("errors");
      expect(wrapper.text()).toContain(
        i18n.global.t("traces.comparison.presetRangeTooLong", { hours: 0.5 }),
      );
      expect(wrapper.text()).not.toContain("The selection is longer");
    });

    it("compares the second half of the range with the first half", async () => {
      await mountPanel(null);
      await pick("recent");
      const windows = counts().map((c) => [c.start, c.end]);
      expect(windows).toContainEqual([MID, R1]);
      expect(windows).toContainEqual([R0, MID]);
      expect(
        wrapper
          .find('[data-test="traces-comparison-baseline-toggle-before"]')
          .attributes("data-state"),
      ).toBe("on");
    });
  });
});
