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

//! The time-slice branch of the SLO form, in PromQL.
//!
//! The API decides the language from the STREAM: PromQL is the only language
//! valid over metrics, and SQL is invalid there. Until the form said so, every
//! metrics time-slice was a guaranteed 400 at save. The rules under test are
//! the ones the backend enforces at save time — the language discriminator, the
//! ban on a PromQL scope, and the fact that a fragment in one language must
//! never survive into a config declared to be in the other.

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";

let routeParams: Record<string, string> = {};

// `useRoute` is replaced to choose new-vs-edit per test; `useRouter` so a save
// does not navigate. The rest of vue-router stays real — the test router helper
// builds a real router from it, and OPageHeader's back button calls
// `useRouter()` at setup.
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
    getStreams: vi.fn().mockResolvedValue({ list: [{ name: "http_latency" }] }),
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

/** Every prop the real field takes, so an unbound one is visible. `language`
 *  defaults to a SENTINEL rather than to "sql": a stub that defaults to the
 *  right answer cannot tell "bound correctly" from "never bound". */
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
        SloTimeSlicePreview: SloTimeSlicePreviewStub,
        SelectFolderDropDown: SelectFolderDropDownStub,
        SloPreviewChart: true,
        SloAlertPreview: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

type Form = Awaited<ReturnType<typeof mountForm>>;

/** OSelect sets `inheritAttrs: false`, so its `data-test` stays in `$attrs`. */
function byAttr(w: VueWrapper, component: Component, test: string) {
  const hit = w.findAllComponents(component).find((c) => String(c.vm.$attrs["data-test"]) === test);
  if (!hit) throw new Error(`no component tagged ${test}`);
  return hit;
}

/** SloExpressionField takes `data-test` as a declared PROP, not an attribute. */
function fieldOrNone(w: VueWrapper, test: string) {
  return w.findAllComponents(SloExpressionFieldStub).find((c) => c.props("dataTest") === test);
}

/** Throws on a miss, so a renamed selector fails as itself rather than as
 *  "cannot read properties of undefined" ten lines later. */
function field(w: VueWrapper, test: string) {
  const hit = fieldOrNone(w, test);
  if (!hit) throw new Error(`no expression field tagged ${test}`);
  return hit;
}

const selectType = async (w: Form, type: string) => {
  await w.find(`[data-test="slos-addslo-sli-type-${type}"]`).trigger("click");
  await flushPromises();
};

const setSelect = async (w: Form, test: string, value: string) => {
  byAttr(w, OSelect, test).vm.$emit("update:modelValue", value);
  await flushPromises();
};

const setField = async (w: Form, test: string, value: string) => {
  field(w, test).vm.$emit("update:modelValue", value);
  await flushPromises();
};

const save = async (w: Form) => {
  await w.find('[data-test="slos-addslo-save"]').trigger("click");
  await flushPromises();
};

const savedConfig = () =>
  (vi.mocked(sloService.create).mock.calls[0][1] as { config: Record<string, unknown> }).config;

const updatedConfig = () =>
  (vi.mocked(sloService.update).mock.calls[0][2] as { config: Record<string, unknown> }).config;

/** A metrics time slice, built the way the form is filled in. */
const buildPromqlSlice = async (w: Form, expr = "up") => {
  await selectType(w, "time_slice");
  await setSelect(w, "slos-addslo-timeslice-stream-type", "metrics");
  await setSelect(w, "slos-addslo-timeslice-stream", "http_latency");
  await setField(w, "slos-addslo-aggregate", expr);
};

describe("AddSlo — time-slice PromQL", () => {
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

  describe("choosing the language", () => {
    // `language_suits_stream`: PromQL is valid ONLY over metrics, and SQL is
    // invalid there — so the stream type decides, and the form must say which.
    it("declares prom_ql for a metrics stream", async () => {
      const w = await mountForm();
      await buildPromqlSlice(w);
      await save(w);

      expect(savedConfig().query_language).toBe("prom_ql");
      expect(savedConfig().stream_type).toBe("metrics");
      expect(savedConfig().query).toBe("up");
    });

    it("declares sql for a non-metrics stream", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");
      await setSelect(w, "slos-addslo-timeslice-stream-type", "traces");
      await setField(w, "slos-addslo-aggregate", "avg(duration)");
      await save(w);

      expect(savedConfig().query_language).toBe("sql");
    });

    it("goes back to sql when the stream type leaves metrics", async () => {
      const w = await mountForm();
      await buildPromqlSlice(w);
      await setSelect(w, "slos-addslo-timeslice-stream-type", "logs");
      await setField(w, "slos-addslo-aggregate", "avg(took)");
      await save(w);

      expect(savedConfig().query_language).toBe("sql");
    });

    // The stream type can already BE metrics when the time-slice branch opens:
    // one config object is shared across SLI types, so a metrics stream picked
    // on the count branch is still selected after switching type — with no
    // event ever fired on the time-slice picker. Deriving the language from
    // the model rather than from that picker's handler is what covers this.
    it("declares prom_ql for a metrics stream chosen before the branch opened", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");
      await selectType(w, "time_slice");
      await setField(w, "slos-addslo-aggregate", "up");
      await save(w);

      expect(savedConfig().query_language).toBe("prom_ql");
      expect(fieldOrNone(w, "slos-addslo-timeslice-scope")).toBeUndefined();
    });

    // The count branch is not part of this change: its config must not gain a
    // discriminator, not even after the time-slice branch has set one.
    it("leaves no discriminator behind on the count branch", async () => {
      const w = await mountForm();
      await buildPromqlSlice(w);
      await selectType(w, "count");
      await setSelect(w, "slos-addslo-stream-type", "logs");
      await setField(w, "slos-addslo-good-expr", "code < 500");
      await save(w);

      const source = savedConfig().source as { mode: string; query: Record<string, unknown> };
      expect(source.mode).toBe("single_query");
      expect(source.query).not.toHaveProperty("query_language");
    });

    // …but the language it was written in has to survive the excursion. Forget
    // it and the flip back reads as a first assignment, and a PromQL
    // expression is saved declared as SQL — an SLO that measures nothing.
    it("still remembers the language after a trip through the count branch", async () => {
      const w = await mountForm();
      await buildPromqlSlice(w, "histogram_quantile(0.95, sum by (le) (rate(x[5m])))");
      await selectType(w, "count");
      await setSelect(w, "slos-addslo-stream-type", "logs");
      await selectType(w, "time_slice");

      expect(field(w, "slos-addslo-aggregate").props("modelValue")).toBe("");
    });
  });

  describe("the scope field", () => {
    // A scope reaches a SQL plan as a `WHERE (…)` fragment; a PromQL plan is
    // the bare expression, so there is nowhere to put one — the backend
    // rejects a non-empty scope outright rather than narrowing nothing.
    it("is hidden in PromQL mode", async () => {
      const w = await mountForm();
      await buildPromqlSlice(w);

      expect(fieldOrNone(w, "slos-addslo-timeslice-scope")).toBeUndefined();
    });

    it("is still offered for a SQL time slice", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");

      expect(fieldOrNone(w, "slos-addslo-timeslice-scope")).toBeDefined();
    });

    // The other half of the same rule: SQL time slices still scope, and
    // dropping `scope` from the payload outright would satisfy the PromQL case
    // while silently breaking this one.
    it("still reaches the payload for a SQL time slice", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");
      await setField(w, "slos-addslo-aggregate", "avg(took)");
      await setField(w, "slos-addslo-timeslice-scope", "service = 'checkout'");
      await save(w);

      expect(savedConfig().scope).toBe("service = 'checkout'");
    });

    it("never reaches the payload for a PromQL slice", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");
      await setField(w, "slos-addslo-timeslice-scope", "service = 'checkout'");
      await setSelect(w, "slos-addslo-timeslice-stream-type", "metrics");
      await setField(w, "slos-addslo-aggregate", "up");
      await save(w);

      expect(savedConfig()).not.toHaveProperty("scope");
    });

    it("is untouched on the count branch", async () => {
      const w = await mountForm();

      expect(fieldOrNone(w, "slos-addslo-scope")).toBeDefined();
    });
  });

  // `SliConfig::TimeSlice.comparator` has no serde default, so a payload
  // without it is a 422 with nothing actionable in it — which is what every
  // time-slice SLO got unless the user happened to open the dropdown.
  describe("the comparator", () => {
    it("reaches the payload for a SQL slice whose dropdown was never opened", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");
      await setField(w, "slos-addslo-aggregate", "avg(took)");
      await save(w);

      expect(savedConfig().comparator).toBe("<");
    });

    it("reaches the payload for an untouched PromQL slice", async () => {
      const w = await mountForm();
      await buildPromqlSlice(w);
      await save(w);

      expect(savedConfig().comparator).toBe("<");
    });

    // One flat config is shared across the SLI types, and `CountSource` has no
    // comparator — a seeded default that rode along would be a spare key in a
    // definition nobody wrote.
    it("is not sent on the count branch", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");
      await selectType(w, "count");
      await setField(w, "slos-addslo-good-expr", "code < 500");
      await save(w);

      const source = savedConfig().source as { query: Record<string, unknown> };
      expect(source.query).not.toHaveProperty("comparator");
    });
  });

  describe("when the language flips", () => {
    it("drops the SQL aggregate rather than letting it become PromQL", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");
      await setField(w, "slos-addslo-aggregate", "approx_percentile_cont(took, 0.95)");
      await setSelect(w, "slos-addslo-timeslice-stream-type", "metrics");

      expect(field(w, "slos-addslo-aggregate").props("modelValue")).toBe("");
    });

    it("drops the PromQL expression on the way back to SQL", async () => {
      const w = await mountForm();
      await buildPromqlSlice(w, "histogram_quantile(0.95, rate(x[5m]))");
      await setSelect(w, "slos-addslo-timeslice-stream-type", "logs");

      expect(field(w, "slos-addslo-aggregate").props("modelValue")).toBe("");
    });

    // Switching between two SQL stream types is not a flip — losing the
    // expression there would be gratuitous.
    it("keeps the expression when both sides are SQL", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");
      await setField(w, "slos-addslo-aggregate", "avg(took)");
      await setSelect(w, "slos-addslo-timeslice-stream-type", "traces");

      expect(field(w, "slos-addslo-aggregate").props("modelValue")).toBe("avg(took)");
    });
  });

  describe("what the fields say", () => {
    /** A key that resolved to nothing comes back AS the key. */
    const isResolved = (text: unknown) => !String(text).startsWith("slos.");

    it("speaks PromQL in the aggregate field's label and hint", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");
      const sqlLabel = field(w, "slos-addslo-aggregate").props("label");
      const sqlHint = field(w, "slos-addslo-aggregate").props("hint");

      await setSelect(w, "slos-addslo-timeslice-stream-type", "metrics");
      const promql = field(w, "slos-addslo-aggregate");

      expect(promql.props("label")).not.toBe(sqlLabel);
      expect(promql.props("hint")).not.toBe(sqlHint);
      expect(isResolved(promql.props("label"))).toBe(true);
      expect(String(promql.props("hint"))).toContain("PromQL");
    });

    it("puts the field itself into PromQL", async () => {
      const w = await mountForm();
      await buildPromqlSlice(w);

      expect(field(w, "slos-addslo-aggregate").props("language")).toBe("prom_ql");
    });

    it("keeps the SQL field in SQL", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");

      expect(field(w, "slos-addslo-aggregate").props("language")).toBe("sql");
    });

    // Prometheus' lookback delta keeps answering for a stale gauge for about
    // five minutes, so a freshness objective on a bare gauge sees silence late.
    it("warns that a bare gauge detects silence late", async () => {
      const w = await mountForm();
      await buildPromqlSlice(w);

      const note = w.find('[data-test="slos-addslo-promql-absent-note"]');
      expect(note.exists()).toBe(true);
      // The advice must be to aggregate over the slice window, NOT to reach for
      // `absent_over_time()`: that emits a sample only while data is MISSING, so
      // every healthy slice would return nothing and read as unmeasured — the
      // exact inversion of what a freshness objective needs.
      expect(note.text()).toContain("_over_time");
      expect(note.text()).not.toContain("absent_over_time");
    });

    it("shows that warning only in PromQL mode", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");

      expect(w.find('[data-test="slos-addslo-promql-absent-note"]').exists()).toBe(false);
    });
  });

  it("tells the preview which language to run", async () => {
    const w = await mountForm();
    await buildPromqlSlice(w);

    const preview = w.findComponent(SloTimeSlicePreviewStub);
    expect(preview.exists()).toBe(true);
    expect(preview.props("queryLanguage")).toBe("prom_ql");
    expect(preview.props("aggregate")).toBe("up");
  });

  // One series per group is the intended shape of a grouped PromQL SLI, not a
  // collision — the preview cannot tell the two apart on its own.
  it("tells the preview whether the SLO is grouped", async () => {
    const w = await mountForm();
    await buildPromqlSlice(w);
    expect(w.findComponent(SloTimeSlicePreviewStub).props("grouped")).toBe(false);

    byAttr(w, OSelect, "slos-addslo-group-by").vm.$emit("update:modelValue", ["pod"]);
    await flushPromises();

    expect(w.findComponent(SloTimeSlicePreviewStub).props("grouped")).toBe(true);
  });

  it("tells the preview when it is SQL", async () => {
    const w = await mountForm();
    await selectType(w, "time_slice");
    await setSelect(w, "slos-addslo-timeslice-stream", "http_latency");
    await setField(w, "slos-addslo-aggregate", "avg(took)");

    expect(w.findComponent(SloTimeSlicePreviewStub).props("queryLanguage")).toBe("sql");
  });

  describe("editing a stored SLO", () => {
    const stored = (config: Record<string, unknown>) => ({
      data: {
        name: "checkout latency",
        description: "",
        tags: [],
        sli_type: "time_slice",
        config,
        target: 99.9,
        window_secs: 30 * 86400,
        slice_interval_secs: 300,
        group_by: null,
        enabled: true,
      },
    });

    it("keeps a stored PromQL expression instead of clearing it on hydration", async () => {
      vi.mocked(sloService.get).mockResolvedValue(
        stored({
          stream: "http_latency",
          stream_type: "metrics",
          query_language: "prom_ql",
          query: "histogram_quantile(0.95, rate(http_latency_bucket[5m]))",
          comparator: "<",
          threshold: 500,
        }) as never,
      );
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();

      expect(field(w, "slos-addslo-aggregate").props("modelValue")).toBe(
        "histogram_quantile(0.95, rate(http_latency_bucket[5m]))",
      );
      expect(field(w, "slos-addslo-aggregate").props("language")).toBe("prom_ql");
    });

    // A definition saved before the discriminator existed carries none. Reading
    // its absence as a language change would wipe the query on open.
    it("keeps a stored SQL aggregate that predates the discriminator", async () => {
      vi.mocked(sloService.get).mockResolvedValue(
        stored({
          stream: "default",
          stream_type: "logs",
          query: "approx_percentile_cont(took, 0.95)",
          comparator: "<",
          threshold: 500,
        }) as never,
      );
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();

      expect(field(w, "slos-addslo-aggregate").props("modelValue")).toBe(
        "approx_percentile_cont(took, 0.95)",
      );
    });

    // The default only fills a blank. A stored comparator IS the definition,
    // so overwriting it would redefine the SLO just by opening it.
    it("keeps a stored comparator rather than replacing it with the default", async () => {
      vi.mocked(sloService.get).mockResolvedValue(
        stored({
          stream: "default",
          stream_type: "logs",
          query_language: "sql",
          query: "avg(took)",
          comparator: ">=",
          threshold: 99,
        }) as never,
      );
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();
      await save(w);

      expect(updatedConfig().comparator).toBe(">=");
      expect(w.find('[data-test="slos-addslo-regen-warning"]').exists()).toBe(false);
    });

    // The regeneration banner means "this discards every measurement taken so
    // far". Declaring a language the definition already implied is not that.
    it("does not report a redefinition just for opening a stored SLO", async () => {
      vi.mocked(sloService.get).mockResolvedValue(
        stored({
          stream: "http_latency",
          stream_type: "metrics",
          query_language: "prom_ql",
          query: "up",
          comparator: "<",
          threshold: 1,
        }) as never,
      );
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();

      expect(w.find('[data-test="slos-addslo-regen-warning"]').exists()).toBe(false);
    });
  });
});
