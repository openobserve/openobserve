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

//! Choosing SQL or PromQL for a metrics stream.
//!
//! A metrics stream is an ordinary stream with a `value` column, so SQL
//! addresses it as well as PromQL does — `avg(value)` over
//! `histogram(_timestamp, '5 minute')` is a perfectly good SLI. The form used
//! to DERIVE the language from the stream type and force PromQL on metrics,
//! which put the SQL half out of reach entirely. The language is a choice now,
//! and these are the rules that choice has to keep: PromQL is the default for
//! metrics, SQL is unreachable nowhere else, and a fragment written in one
//! language never survives into a payload declared to be in the other.

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let routeParams: Record<string, string> = {};

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => ({ params: routeParams, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/services/slos", () => ({
  default: {
    get: vi.fn(),
    create: vi.fn().mockResolvedValue({ data: {} }),
    update: vi.fn().mockResolvedValue({ data: {} }),
    eligibleAlerts: vi.fn().mockResolvedValue({ data: { list: [] } }),
    alertPreview: vi.fn().mockResolvedValue({ data: null }),
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue({ list: [{ name: "cpu_usage" }] }),
    getStream: vi.fn().mockResolvedValue({ schema: [] }),
  }),
}));

import AddSlo from "@/views/slos/AddSlo.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import sloService from "@/services/slos";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

/** `language` defaults to a SENTINEL rather than to "sql": a stub that defaults
 *  to the right answer cannot tell "bound correctly" from "never bound". */
const SloExpressionFieldStub = {
  name: "SloExpressionField",
  props: {
    modelValue: { type: String, default: "" },
    editorId: { type: String, default: "" },
    label: { type: String, default: "" },
    hint: { type: String, default: "" },
    required: { type: Boolean, default: false },
    language: { type: String, default: "UNBOUND" },
    keywords: { type: Array, default: () => [] },
    suggestions: { type: Array, default: null },
    fieldValueResolver: { type: Function, default: null },
    dataTest: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  template: "<div />",
};

const SloPreviewChartStub = {
  name: "SloPreviewChart",
  props: {
    streamType: { type: String, default: "" },
    stream: { type: String, default: "" },
    scope: { type: String, default: "" },
    goodExpr: { type: String, default: "" },
    good: { type: String, default: "" },
    total: { type: String, default: "" },
    sliceIntervalSecs: { type: Number, default: 0 },
    queryLanguage: { type: String, default: "UNBOUND" },
  },
  template: '<div data-test="slos-addslo-preview-section" />',
};

const SloTimeSlicePreviewStub = {
  name: "SloTimeSlicePreview",
  props: {
    streamType: { type: String, default: "" },
    stream: { type: String, default: "" },
    scope: { type: String, default: "" },
    aggregate: { type: String, default: "" },
    comparator: { type: String, default: "" },
    threshold: { type: [Number, String], default: null },
    sliceIntervalSecs: { type: Number, default: 0 },
    target: { type: Number, default: 0 },
    queryLanguage: { type: String, default: "UNBOUND" },
    grouped: { type: Boolean, default: false },
  },
  template: '<div data-test="slos-addslo-timeslice-preview-section" />',
};

const SelectFolderDropDownStub = { name: "SelectFolderDropDown", template: "<div />" };

let wrapper: VueWrapper | null = null;

async function mountForm() {
  wrapper = mount(AddSlo, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        SloExpressionField: SloExpressionFieldStub,
        SloPreviewChart: SloPreviewChartStub,
        SloTimeSlicePreview: SloTimeSlicePreviewStub,
        SelectFolderDropDown: SelectFolderDropDownStub,
        SloAlertPreview: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

type Form = Awaited<ReturnType<typeof mountForm>>;

/** OSelect sets `inheritAttrs: false`, so its `data-test` stays in `$attrs`. */
function byAttr(w: VueWrapper, component: typeof OSelect, test: string) {
  const hit = w.findAllComponents(component).find((c) => String(c.vm.$attrs["data-test"]) === test);
  if (!hit) throw new Error(`no component tagged ${test}`);
  return hit;
}

/** SloExpressionField takes `data-test` as a declared PROP, not an attribute. */
function fieldOrNone(w: VueWrapper, test: string) {
  return w.findAllComponents(SloExpressionFieldStub).find((c) => c.props("dataTest") === test);
}

function field(w: VueWrapper, test: string) {
  const hit = fieldOrNone(w, test);
  if (!hit) throw new Error(`no expression field tagged ${test}`);
  return hit;
}

const selectType = async (w: Form, type: string) => {
  await w.find(`[data-test="slos-addslo-sli-type-${type}"]`).trigger("click");
  await flushPromises();
};

const setSelect = async (w: Form, test: string, value: unknown) => {
  byAttr(w, OSelect, test).vm.$emit("update:modelValue", value);
  await flushPromises();
};

const setField = async (w: Form, test: string, value: string) => {
  field(w, test).vm.$emit("update:modelValue", value);
  await flushPromises();
};

/** The language toggle, clicked the way a user clicks it. */
const pickLanguage = async (w: Form, branch: "count" | "timeslice", language: string) => {
  const item = w.find(`[data-test="slos-addslo-${branch}-language-${language}"]`);
  if (!item.exists()) throw new Error(`no language option ${branch}/${language}`);
  await item.trigger("click");
  await flushPromises();
};

/** Which option the language toggle is actually showing as active. reka-ui
 *  marks it `data-state="on"`. Read because nothing else does: the toggle is
 *  bound one-way, so a dropped binding would leave every other test green. */
const activeLanguage = (w: Form, branch: "count" | "timeslice") =>
  ["sql", "prom_ql"].find(
    (l) =>
      w.find(`[data-test="slos-addslo-${branch}-language-${l}"]`).attributes("data-state") === "on",
  );

const save = async (w: Form) => {
  await w.find('[data-test="slos-addslo-save"]').trigger("click");
  await flushPromises();
};

const savedConfig = () =>
  (vi.mocked(sloService.create).mock.calls[0][1] as { config: Record<string, unknown> }).config;

const savedSource = () => savedConfig().source as { mode: string; query: Record<string, unknown> };

const GOOD_EXPR = "value < 0.8";
const SQL_AGG = "avg(value)";
const PROMQL_AGG = "avg_over_time(cpu_usage[5m])";

describe("AddSlo — SQL or PromQL over a metrics stream", () => {
  beforeEach(() => {
    routeParams = {};
    vi.mocked(sloService.create).mockClear();
    vi.mocked(sloService.update).mockClear();
    vi.mocked(sloService.get).mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  describe("the count branch", () => {
    it("offers the choice only for a metrics stream", async () => {
      const w = await mountForm();
      expect(w.find('[data-test="slos-addslo-count-language-sql"]').exists()).toBe(false);

      await setSelect(w, "slos-addslo-stream-type", "metrics");
      expect(w.find('[data-test="slos-addslo-count-language-sql"]').exists()).toBe(true);
      expect(w.find('[data-test="slos-addslo-count-language-prom_ql"]').exists()).toBe(true);

      // PromQL is invalid over logs, so there is nothing to choose there.
      await setSelect(w, "slos-addslo-stream-type", "logs");
      expect(w.find('[data-test="slos-addslo-count-language-sql"]').exists()).toBe(false);
    });

    it("starts a metrics count in PromQL", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");

      expect(fieldOrNone(w, "slos-addslo-promql-good")).toBeDefined();
      expect(fieldOrNone(w, "slos-addslo-good-expr")).toBeUndefined();
    });

    it("renders the SQL shape once SQL is chosen", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");
      await pickLanguage(w, "count", "sql");

      expect(fieldOrNone(w, "slos-addslo-scope")).toBeDefined();
      expect(fieldOrNone(w, "slos-addslo-good-expr")).toBeDefined();
      expect(fieldOrNone(w, "slos-addslo-promql-good")).toBeUndefined();
      expect(fieldOrNone(w, "slos-addslo-promql-total")).toBeUndefined();
    });

    // The PromQL range hint is advice about a range selector. SQL has none.
    it("drops the PromQL range hint in SQL", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");
      expect(w.find('[data-test="slos-addslo-count-promql-hint"]').exists()).toBe(true);

      await pickLanguage(w, "count", "sql");
      expect(w.find('[data-test="slos-addslo-count-promql-hint"]').exists()).toBe(false);
    });

    // The whole point: `single_query` over a metrics stream used to be a
    // guaranteed 400, so the form could not send this payload at all.
    it("sends single_query carrying the metrics stream type", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");
      await pickLanguage(w, "count", "sql");
      await setSelect(w, "slos-addslo-stream", "cpu_usage");
      await setField(w, "slos-addslo-good-expr", GOOD_EXPR);
      await save(w);

      expect(savedSource().mode).toBe("single_query");
      expect(savedSource().query).toEqual({
        stream: "cpu_usage",
        stream_type: "metrics",
        good_expr: GOOD_EXPR,
      });
    });

    // The MODEL is what has to be cleared, not just the payload: the SQL arm's
    // wire shape is an allow-list, so a leftover `good` is invisible there and
    // reappears the moment the language flips back.
    it("drops the PromQL expressions on the way to SQL", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");
      await setField(w, "slos-addslo-promql-good", "increase(a[5m])");
      await setField(w, "slos-addslo-promql-total", "increase(b[5m])");
      await pickLanguage(w, "count", "sql");
      await pickLanguage(w, "count", "prom_ql");

      expect(field(w, "slos-addslo-promql-good").props("modelValue")).toBe("");
      expect(field(w, "slos-addslo-promql-total").props("modelValue")).toBe("");
    });

    it("drops the SQL fragments on the way back to PromQL", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");
      await pickLanguage(w, "count", "sql");
      await setField(w, "slos-addslo-scope", "job = 'api'");
      await setField(w, "slos-addslo-good-expr", GOOD_EXPR);
      await pickLanguage(w, "count", "prom_ql");
      await pickLanguage(w, "count", "sql");

      expect(field(w, "slos-addslo-scope").props("modelValue")).toBe("");
      expect(field(w, "slos-addslo-good-expr").props("modelValue")).toBe("");
    });

    // Re-picking the stream type is a fresh start, and PromQL is what a
    // metrics stream starts as.
    it("returns to PromQL when metrics is picked again", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");
      await pickLanguage(w, "count", "sql");
      // The precondition, asserted: without it this test passes in a world
      // where SQL was never reachable at all.
      expect(fieldOrNone(w, "slos-addslo-good-expr")).toBeDefined();

      await setSelect(w, "slos-addslo-stream-type", "logs");
      await setSelect(w, "slos-addslo-stream-type", "metrics");

      expect(fieldOrNone(w, "slos-addslo-promql-good")).toBeDefined();
      expect(fieldOrNone(w, "slos-addslo-good-expr")).toBeUndefined();
    });

    // The preview runs the SLI as defined. Following the stream type instead
    // would run PromQL against a definition written in SQL.
    it("previews in the chosen language, not the stream's", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");
      await pickLanguage(w, "count", "sql");
      await setSelect(w, "slos-addslo-stream", "cpu_usage");
      await setField(w, "slos-addslo-good-expr", GOOD_EXPR);

      const preview = w.findComponent(SloPreviewChartStub);
      expect(preview.exists()).toBe(true);
      expect(preview.props("queryLanguage")).toBe("sql");
      expect(preview.props("streamType")).toBe("metrics");
      expect(preview.props("goodExpr")).toBe(GOOD_EXPR);
    });
  });

  describe("the time-slice branch", () => {
    const openMetricsSlice = async (w: Form) => {
      await selectType(w, "time_slice");
      await setSelect(w, "slos-addslo-timeslice-stream-type", "metrics");
      await setSelect(w, "slos-addslo-timeslice-stream", "cpu_usage");
    };

    it("offers the choice only for a metrics stream", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");
      expect(w.find('[data-test="slos-addslo-timeslice-language-sql"]').exists()).toBe(false);

      await setSelect(w, "slos-addslo-timeslice-stream-type", "metrics");
      expect(w.find('[data-test="slos-addslo-timeslice-language-sql"]').exists()).toBe(true);
    });

    // The whole config, not three keys: a time slice's wire shape is a SPREAD
    // of the flat model, so anything the language flip failed to clear rides
    // along in silence rather than being rejected.
    it("declares sql while keeping the metrics stream type", async () => {
      const w = await mountForm();
      await openMetricsSlice(w);
      await pickLanguage(w, "timeslice", "sql");
      await setField(w, "slos-addslo-aggregate", SQL_AGG);
      await save(w);

      expect(savedConfig()).toEqual({
        stream: "cpu_usage",
        stream_type: "metrics",
        query_language: "sql",
        query: SQL_AGG,
        // Required by the variant and seeded by the form, so it is part of the
        // shape even when the dropdown was never opened.
        comparator: "<",
      });
    });

    // A scope is a SQL `WHERE (…)` fragment, so it is back on the table the
    // moment the language is SQL — metrics stream or not.
    it("offers the scope again in SQL and sends it", async () => {
      const w = await mountForm();
      await openMetricsSlice(w);
      expect(fieldOrNone(w, "slos-addslo-timeslice-scope")).toBeUndefined();

      await pickLanguage(w, "timeslice", "sql");
      expect(fieldOrNone(w, "slos-addslo-timeslice-scope")).toBeDefined();

      await setField(w, "slos-addslo-aggregate", SQL_AGG);
      await setField(w, "slos-addslo-timeslice-scope", "job = 'api'");
      await save(w);

      expect(savedConfig().scope).toBe("job = 'api'");
    });

    // Compared against the SQL copy a logs slice shows rather than merely
    // asserting the absence of the word "PromQL": a negative like that stays
    // green forever once the PromQL copy is reworded.
    it("shows the SQL label and hint, the same ones a logs slice shows", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");
      const sqlLabel = field(w, "slos-addslo-aggregate").props("label");
      const sqlHint = field(w, "slos-addslo-aggregate").props("hint");

      await setSelect(w, "slos-addslo-timeslice-stream-type", "metrics");
      expect(field(w, "slos-addslo-aggregate").props("label")).not.toBe(sqlLabel);

      await pickLanguage(w, "timeslice", "sql");
      expect(field(w, "slos-addslo-aggregate").props("language")).toBe("sql");
      expect(field(w, "slos-addslo-aggregate").props("label")).toBe(sqlLabel);
      expect(field(w, "slos-addslo-aggregate").props("hint")).toBe(sqlHint);
    });

    // The lookback-delta warning is about how Prometheus answers for a stale
    // metric. A SQL slice with no rows is simply no rows.
    it("hides the PromQL absent-note in SQL", async () => {
      const w = await mountForm();
      await openMetricsSlice(w);
      expect(w.find('[data-test="slos-addslo-promql-absent-note"]').exists()).toBe(true);

      await pickLanguage(w, "timeslice", "sql");
      expect(w.find('[data-test="slos-addslo-promql-absent-note"]').exists()).toBe(false);
    });

    it("clears the aggregate when the language flips, in both directions", async () => {
      const w = await mountForm();
      await openMetricsSlice(w);
      await setField(w, "slos-addslo-aggregate", PROMQL_AGG);
      await pickLanguage(w, "timeslice", "sql");
      expect(field(w, "slos-addslo-aggregate").props("modelValue")).toBe("");

      await setField(w, "slos-addslo-aggregate", SQL_AGG);
      await pickLanguage(w, "timeslice", "prom_ql");
      expect(field(w, "slos-addslo-aggregate").props("modelValue")).toBe("");
    });

    // A scope typed in SQL has nowhere to go in a PromQL plan, and the backend
    // rejects a non-empty one outright.
    it("never lets a SQL scope ride into a PromQL payload", async () => {
      const w = await mountForm();
      await openMetricsSlice(w);
      await pickLanguage(w, "timeslice", "sql");
      await setField(w, "slos-addslo-timeslice-scope", "job = 'api'");
      await pickLanguage(w, "timeslice", "prom_ql");
      await setField(w, "slos-addslo-aggregate", PROMQL_AGG);
      await save(w);

      expect(savedConfig()).not.toHaveProperty("scope");
    });

    it("previews in the chosen language, not the stream's", async () => {
      const w = await mountForm();
      await openMetricsSlice(w);
      await pickLanguage(w, "timeslice", "sql");
      await setField(w, "slos-addslo-aggregate", SQL_AGG);

      const preview = w.findComponent(SloTimeSlicePreviewStub);
      expect(preview.exists()).toBe(true);
      expect(preview.props("queryLanguage")).toBe("sql");
      expect(preview.props("streamType")).toBe("metrics");
      expect(preview.props("aggregate")).toBe(SQL_AGG);
    });
  });

  describe("editing a stored SLO", () => {
    const stored = (sliType: string, config: Record<string, unknown>) => ({
      data: {
        name: "cpu headroom",
        description: "",
        tags: [],
        sli_type: sliType,
        config,
        target: 99.9,
        window_secs: 30 * 86400,
        slice_interval_secs: 300,
        group_by: null,
        enabled: true,
      },
    });

    const sqlCountSource = {
      mode: "single_query",
      query: {
        stream: "cpu_usage",
        stream_type: "metrics",
        scope: "job = 'api'",
        good_expr: GOOD_EXPR,
      },
    };

    // `single_query` + `stream_type: metrics` is the SQL-over-metrics count.
    // Reading the stream type alone would reopen it in PromQL and clear it.
    it("reopens a stored SQL count over metrics in SQL", async () => {
      vi.mocked(sloService.get).mockResolvedValue(
        stored("count", { source: sqlCountSource }) as never,
      );
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();

      expect(byAttr(w, OSelect, "slos-addslo-stream-type").props("modelValue")).toBe("metrics");
      expect(field(w, "slos-addslo-good-expr").props("modelValue")).toBe(GOOD_EXPR);
      expect(fieldOrNone(w, "slos-addslo-promql-good")).toBeUndefined();
      expect(activeLanguage(w, "count")).toBe("sql");
    });

    it("round-trips it back out unchanged", async () => {
      vi.mocked(sloService.get).mockResolvedValue(
        stored("count", { source: sqlCountSource }) as never,
      );
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();
      await save(w);

      const sent = vi.mocked(sloService.update).mock.calls[0][2] as { config: { source: unknown } };
      expect(sent.config.source).toEqual(sqlCountSource);
    });

    // Opening an SLO is not a redefinition, and the banner means "this
    // discards every measurement taken so far".
    it("does not claim a redefinition just for opening it", async () => {
      vi.mocked(sloService.get).mockResolvedValue(
        stored("count", { source: sqlCountSource }) as never,
      );
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();

      expect(w.find('[data-test="slos-addslo-regen-warning"]').exists()).toBe(false);
    });

    const sqlSlice = {
      stream: "cpu_usage",
      stream_type: "metrics",
      query_language: "sql",
      query: SQL_AGG,
      scope: "job = 'api'",
      comparator: "<",
      threshold: 80,
    };

    it("reopens a stored SQL time slice over metrics in SQL", async () => {
      vi.mocked(sloService.get).mockResolvedValue(stored("time_slice", sqlSlice) as never);
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();

      expect(field(w, "slos-addslo-aggregate").props("modelValue")).toBe(SQL_AGG);
      expect(field(w, "slos-addslo-aggregate").props("language")).toBe("sql");
      expect(fieldOrNone(w, "slos-addslo-timeslice-scope")).toBeDefined();
      expect(w.find('[data-test="slos-addslo-promql-absent-note"]').exists()).toBe(false);
      expect(activeLanguage(w, "timeslice")).toBe("sql");
    });

    // Reading an unrecognised stored language as "SQL" would reopen a metrics
    // slice in the wrong language and clear its expression on the way in. The
    // default has to stand instead.
    it("keeps PromQL when the stored language is not one it recognises", async () => {
      const { query_language: _dropped, ...legacy } = sqlSlice;
      vi.mocked(sloService.get).mockResolvedValue(
        stored("time_slice", { ...legacy, query: PROMQL_AGG, scope: undefined }) as never,
      );
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();

      expect(activeLanguage(w, "timeslice")).toBe("prom_ql");
      expect(field(w, "slos-addslo-aggregate").props("modelValue")).toBe(PROMQL_AGG);
    });

    it("round-trips the stored SQL time slice", async () => {
      vi.mocked(sloService.get).mockResolvedValue(stored("time_slice", sqlSlice) as never);
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();
      await save(w);

      const sent = vi.mocked(sloService.update).mock.calls[0][2] as {
        config: Record<string, unknown>;
      };
      expect(sent.config).toEqual(sqlSlice);
    });
  });
});
