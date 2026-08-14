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

//! The COUNT branch of the SLO form, in PromQL.
//!
//! `CountSource::PromQl { good, total }` is a different SHAPE, not a different
//! dialect: it carries two expressions and neither a stream nor a scope, where
//! `SingleQuery` carries a stream, a scope and one predicate. So the form has
//! to swap the fields AND the wire shape together, and a fragment written for
//! one shape must never survive into the other.
//!
//! Until the form did that, choosing Metrics on the count branch was a
//! guaranteed 400: `language_suits_stream` forbids SQL over a metrics stream,
//! and the form sent `single_query` for every count SLI.

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
    getStreams: vi.fn().mockResolvedValue({ list: [{ name: "http_requests" }] }),
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
        SelectFolderDropDown: SelectFolderDropDownStub,
        SloTimeSlicePreview: true,
        SloAlertPreview: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

type Form = Awaited<ReturnType<typeof mountForm>>;

/** OSelect sets `inheritAttrs: false`, so its `data-test` stays in `$attrs`.
 *
 *  Typed as the concrete component rather than as `Component`: VTU resolves the
 *  generic overload to `VueWrapper<never>`, which makes `props("modelValue")`
 *  a type error. */
function byAttr(w: VueWrapper, component: typeof OSelect, test: string) {
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

const setSelect = async (w: Form, test: string, value: unknown) => {
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

/** The adjacently-tagged count source the payload carries. */
const savedSource = () => savedConfig().source as { mode: string; query: Record<string, unknown> };

const GOOD = 'increase(http_requests_total{code!~"5.."}[5m])';
const TOTAL = "increase(http_requests_total[5m])";

/** A metrics count SLI, built the way the form is filled in. */
const buildPromqlCount = async (w: Form, good = GOOD, total = TOTAL) => {
  await setSelect(w, "slos-addslo-stream-type", "metrics");
  await setField(w, "slos-addslo-promql-good", good);
  await setField(w, "slos-addslo-promql-total", total);
};

describe("AddSlo — count PromQL", () => {
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

  describe("the wire shape", () => {
    // `CountSource` is adjacently tagged (`mode`/`query`), and the PromQL arm's
    // tag is `prom_ql` — the same spelling `QueryLanguage::PromQl` uses.
    it("sends the prom_ql arm for a metrics count", async () => {
      const w = await mountForm();
      await buildPromqlCount(w);
      await save(w);

      expect(savedSource().mode).toBe("prom_ql");
      expect(savedSource().query).toEqual({ good: GOOD, total: TOTAL });
    });

    // The variant carries neither, and one flat `form.config` is shared across
    // every SLI type — so a stream and a scope chosen while the branch was SQL
    // are still sitting in the model when the PromQL payload is built. Filled
    // in BEFORE the switch on purpose: that is the state that can leak, and it
    // pins no opinion about which controls PromQL mode goes on rendering.
    it("carries no stream and no scope, which the variant has no home for", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream", "http_requests");
      await setField(w, "slos-addslo-scope", "service = 'checkout'");
      await buildPromqlCount(w);
      await save(w);

      expect(Object.keys(savedSource().query).sort()).toEqual(["good", "total"]);
    });

    // `CountSource` has no `deny_unknown_fields`, so a spare key is ignored —
    // but a MISSING one is a deserialization failure (axum `Json` -> 422), and
    // 422 says nothing a user can act on. Sent empty, the same mistake comes
    // back as the validator's own `EmptyExpression`.
    it("always sends both keys, even when an expression is still empty", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");
      await setField(w, "slos-addslo-promql-good", GOOD);
      await save(w);

      expect(savedSource().query).toEqual({ good: GOOD, total: "" });
    });

    // The other half of the rule, and the one with existing SLOs behind it:
    // nothing about the SQL count payload may move.
    it("leaves the single_query payload untouched for a non-metrics stream", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream", "http_requests");
      await setField(w, "slos-addslo-scope", "service = 'checkout'");
      await setField(w, "slos-addslo-good-expr", "code < 500");
      await save(w);

      expect(savedSource().mode).toBe("single_query");
      expect(savedSource().query).toEqual({
        stream_type: "logs",
        stream: "http_requests",
        scope: "service = 'checkout'",
        good_expr: "code < 500",
      });
    });
  });

  describe("the fields", () => {
    it("offers two PromQL expressions instead of scope and good-when", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");

      expect(fieldOrNone(w, "slos-addslo-promql-good")).toBeDefined();
      expect(fieldOrNone(w, "slos-addslo-promql-total")).toBeDefined();
      expect(fieldOrNone(w, "slos-addslo-scope")).toBeUndefined();
      expect(fieldOrNone(w, "slos-addslo-good-expr")).toBeUndefined();
    });

    it("puts both fields into PromQL", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");

      expect(field(w, "slos-addslo-promql-good").props("language")).toBe("prom_ql");
      expect(field(w, "slos-addslo-promql-total").props("language")).toBe("prom_ql");
    });

    it("keeps scope and good-when for a non-metrics stream", async () => {
      const w = await mountForm();

      expect(fieldOrNone(w, "slos-addslo-scope")).toBeDefined();
      expect(fieldOrNone(w, "slos-addslo-good-expr")).toBeDefined();
      expect(fieldOrNone(w, "slos-addslo-promql-good")).toBeUndefined();
      expect(fieldOrNone(w, "slos-addslo-promql-total")).toBeUndefined();
    });

    // The evaluator samples at slice ends, so a range selector wider or
    // narrower than the slice double-counts or misses events — silently, with
    // a plausible-looking SLI at the end of it.
    it("says the range selector should be one slice wide", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");

      const hint = w.find('[data-test="slos-addslo-count-promql-hint"]');
      expect(hint.exists()).toBe(true);
      expect(hint.text()).toContain("[5m]");
    });

    it("names the slice width actually chosen", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");
      await w.find('[data-test="slos-addslo-slice-60"]').trigger("click");
      await flushPromises();

      const hint = w.find('[data-test="slos-addslo-count-promql-hint"]').text();
      expect(hint).toContain("[1m]");
      // Not merely "mentions 1m too": a hint naming both widths is wrong about
      // whichever one is not selected.
      expect(hint).not.toContain("[5m]");
    });

    // A key that resolved to nothing comes back AS the key.
    it("labels both fields with real copy, not a bare i18n key", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");

      for (const test of ["slos-addslo-promql-good", "slos-addslo-promql-total"]) {
        expect(String(field(w, test).props("label")).startsWith("slos.")).toBe(false);
      }
      expect(field(w, "slos-addslo-promql-good").props("label")).not.toBe(
        field(w, "slos-addslo-promql-total").props("label"),
      );
    });

    it("shows that hint only in PromQL mode", async () => {
      const w = await mountForm();

      expect(w.find('[data-test="slos-addslo-count-promql-hint"]').exists()).toBe(false);
    });
  });

  describe("when the mode flips", () => {
    // A SQL predicate is not a PromQL expression, and `CountSource` ignores the
    // spare key rather than rejecting it — so a leaked fragment would be
    // invisible rather than loud.
    it("drops the SQL scope and predicate on the way to PromQL", async () => {
      const w = await mountForm();
      await setField(w, "slos-addslo-scope", "service = 'checkout'");
      await setField(w, "slos-addslo-good-expr", "code < 500");
      await buildPromqlCount(w);
      await save(w);

      expect(savedSource().query).toEqual({ good: GOOD, total: TOTAL });
    });

    it("drops the PromQL expressions on the way back to SQL", async () => {
      const w = await mountForm();
      await buildPromqlCount(w);
      await setSelect(w, "slos-addslo-stream-type", "logs");
      await setSelect(w, "slos-addslo-stream", "http_requests");
      await setField(w, "slos-addslo-good-expr", "code < 500");
      await save(w);

      expect(savedSource().mode).toBe("single_query");
      // The whole key set, not just the absence of `good`: `SingleQuery` has no
      // `deny_unknown_fields`, so any spare key rides along in silence.
      expect(savedSource().query).toEqual({
        stream_type: "logs",
        stream: "http_requests",
        good_expr: "code < 500",
      });
    });

    // Both directions clear the MODEL, not just the payload: a value filtered
    // out at save time but left in the form reappears the moment the mode flips
    // back, which is the same leak one step later.
    it("clears the fields it drops, rather than hiding a stale value", async () => {
      const w = await mountForm();
      await buildPromqlCount(w);
      await setSelect(w, "slos-addslo-stream-type", "logs");
      await setSelect(w, "slos-addslo-stream-type", "metrics");

      expect(field(w, "slos-addslo-promql-good").props("modelValue")).toBe("");
      expect(field(w, "slos-addslo-promql-total").props("modelValue")).toBe("");
    });

    it("clears the SQL fields it drops too", async () => {
      const w = await mountForm();
      await setField(w, "slos-addslo-scope", "service = 'checkout'");
      await setField(w, "slos-addslo-good-expr", "code < 500");
      await setSelect(w, "slos-addslo-stream-type", "metrics");
      await setSelect(w, "slos-addslo-stream-type", "logs");

      expect(field(w, "slos-addslo-scope").props("modelValue")).toBe("");
      expect(field(w, "slos-addslo-good-expr").props("modelValue")).toBe("");
    });

    // Two SQL stream types are not a flip — losing the predicate there would be
    // gratuitous.
    it("keeps the SQL predicate when both sides are SQL", async () => {
      const w = await mountForm();
      await setField(w, "slos-addslo-good-expr", "code < 500");
      await setSelect(w, "slos-addslo-stream-type", "traces");

      expect(field(w, "slos-addslo-good-expr").props("modelValue")).toBe("code < 500");
    });

    // The stream type does not change, so neither does the mode: an excursion
    // through another SLI type must not cost the expressions.
    it("keeps the expressions across a trip through the time-slice branch", async () => {
      const w = await mountForm();
      await buildPromqlCount(w);
      await selectType(w, "time_slice");
      await selectType(w, "count");

      expect(field(w, "slos-addslo-promql-good").props("modelValue")).toBe(GOOD);
      expect(field(w, "slos-addslo-promql-total").props("modelValue")).toBe(TOTAL);
    });

    // Phase 3's rule, guarded from this side. The time-slice branch leaves
    // `query_language`, `query`, `comparator` and `threshold` behind in the
    // shared config, so the assertion is the whole key set — checking one
    // absent key would pass while three others rode along.
    it("leaves nothing behind from the time-slice branch", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");
      await setSelect(w, "slos-addslo-timeslice-stream-type", "metrics");
      await setField(w, "slos-addslo-aggregate", "up");
      await selectType(w, "count");
      await setField(w, "slos-addslo-promql-good", GOOD);
      await setField(w, "slos-addslo-promql-total", TOTAL);
      await save(w);

      expect(savedSource().query).toEqual({ good: GOOD, total: TOTAL });
    });

    // The same rule on the SQL arm, which the time-slice branch pollutes with
    // `query`, `comparator` and `threshold`. Serde drops them, but they sit
    // inside the definition key and would claim a redefinition on an edit that
    // changed nothing.
    it("leaves nothing behind from the time-slice branch on the SQL arm either", async () => {
      const w = await mountForm();
      await selectType(w, "time_slice");
      await setField(w, "slos-addslo-aggregate", "avg(took)");
      await selectType(w, "count");
      await setSelect(w, "slos-addslo-stream", "http_requests");
      await setField(w, "slos-addslo-good-expr", "code < 500");
      await save(w);

      expect(savedSource().query).toEqual({
        stream_type: "logs",
        stream: "http_requests",
        good_expr: "code < 500",
      });
    });
  });

  describe("the preview", () => {
    it("tells the preview to run PromQL, with both expressions", async () => {
      const w = await mountForm();
      await buildPromqlCount(w);

      const preview = w.findComponent(SloPreviewChartStub);
      expect(preview.exists()).toBe(true);
      expect(preview.props("queryLanguage")).toBe("prom_ql");
      expect(preview.props("good")).toBe(GOOD);
      expect(preview.props("total")).toBe(TOTAL);
      expect(preview.props("sliceIntervalSecs")).toBe(300);
    });

    // The slice width sets both the evaluation step and the range selector the
    // hint asks for, so a preview pinned to the default previews a different
    // SLO from the one being defined.
    it("follows the slice width the form actually has", async () => {
      const w = await mountForm();
      await buildPromqlCount(w);
      await w.find('[data-test="slos-addslo-slice-60"]').trigger("click");
      await flushPromises();

      expect(w.findComponent(SloPreviewChartStub).props("sliceIntervalSecs")).toBe(60);
    });

    // A PromQL count source has no stream, so gating the preview on one would
    // leave it permanently blank.
    it("previews without a stream having been chosen", async () => {
      const w = await mountForm();
      await buildPromqlCount(w);

      const preview = w.findComponent(SloPreviewChartStub);
      expect(preview.exists()).toBe(true);
      expect(preview.props("stream")).toBe("");
    });

    it("waits for both expressions before previewing", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream-type", "metrics");
      await setField(w, "slos-addslo-promql-good", GOOD);

      expect(w.findComponent(SloPreviewChartStub).exists()).toBe(false);
    });

    it("leaves the SQL preview wiring alone", async () => {
      const w = await mountForm();
      await setSelect(w, "slos-addslo-stream", "http_requests");
      await setField(w, "slos-addslo-good-expr", "code < 500");

      const preview = w.findComponent(SloPreviewChartStub);
      expect(preview.exists()).toBe(true);
      expect(preview.props("queryLanguage")).toBe("sql");
      expect(preview.props("goodExpr")).toBe("code < 500");
      expect(preview.props("stream")).toBe("http_requests");
    });
  });

  describe("editing a stored SLO", () => {
    const stored = (source: Record<string, unknown>) => ({
      data: {
        name: "checkout success rate",
        description: "",
        tags: [],
        sli_type: "count",
        config: { source },
        target: 99.9,
        window_secs: 30 * 86400,
        slice_interval_secs: 300,
        group_by: null,
        enabled: true,
      },
    });

    const promqlSource = {
      mode: "prom_ql",
      query: { good: GOOD, total: TOTAL },
    };

    // The stored source carries NO stream_type — the mode is the only record
    // that it addresses metrics, and defaulting to `logs` would reopen it as a
    // SQL definition and re-save it as one.
    it("reopens a stored PromQL count in PromQL mode", async () => {
      vi.mocked(sloService.get).mockResolvedValue(stored(promqlSource) as never);
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();

      expect(field(w, "slos-addslo-promql-good").props("modelValue")).toBe(GOOD);
      expect(field(w, "slos-addslo-promql-total").props("modelValue")).toBe(TOTAL);
      expect(byAttr(w, OSelect, "slos-addslo-stream-type").props("modelValue")).toBe("metrics");
    });

    // The regeneration banner means "this discards every measurement taken so
    // far". Merely opening the SLO is not that.
    it("does not report a redefinition just for opening it", async () => {
      vi.mocked(sloService.get).mockResolvedValue(stored(promqlSource) as never);
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();

      expect(w.find('[data-test="slos-addslo-regen-warning"]').exists()).toBe(false);
    });

    it("round-trips it back out unchanged", async () => {
      vi.mocked(sloService.get).mockResolvedValue(stored(promqlSource) as never);
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();
      await save(w);

      const sent = vi.mocked(sloService.update).mock.calls[0][2] as {
        config: { source: unknown };
      };
      expect(sent.config.source).toEqual(promqlSource);
    });

    const sqlSource = {
      mode: "single_query",
      query: {
        stream: "default",
        stream_type: "logs",
        scope: "service = 'checkout'",
        good_expr: "code < 500",
      },
    };

    it("still reopens a stored single_query count as SQL", async () => {
      vi.mocked(sloService.get).mockResolvedValue(stored(sqlSource) as never);
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();

      expect(field(w, "slos-addslo-good-expr").props("modelValue")).toBe("code < 500");
      expect(fieldOrNone(w, "slos-addslo-promql-good")).toBeUndefined();
    });

    // Moving a live SLO from SQL to PromQL is a redefinition: every
    // measurement taken under the old source is discarded, and the banner is
    // the only warning before that happens.
    it("changes the arm and warns about the regeneration when the mode flips", async () => {
      vi.mocked(sloService.get).mockResolvedValue(stored(sqlSource) as never);
      routeParams = { slo_id: "slo-1" };

      const w = await mountForm();
      await buildPromqlCount(w);

      expect(w.find('[data-test="slos-addslo-regen-warning"]').exists()).toBe(true);

      await save(w);
      const sent = vi.mocked(sloService.update).mock.calls[0][2] as {
        config: { source: unknown };
      };
      expect(sent.config.source).toEqual({
        mode: "prom_ql",
        query: { good: GOOD, total: TOTAL },
      });
    });
  });
});
