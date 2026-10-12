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

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import FunnelLayoutInline from "./FunnelLayoutInline.vue";
import type { FunnelResult } from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef, StepRef } from "@/utils/rum/productAnalyticsQueries";

const store = createStore({
  state: { selectedOrganization: { identifier: "org1" }, timezone: "UTC", zoConfig: {} },
});
// Content renders only after its trigger is clicked, so a test must open one step's options to see them.
const popoverStub = {
  emits: ["update:open"],
  data: () => ({ shown: false }),
  template:
    '<div><div @click="shown = true; $emit(\'update:open\', true)"><slot name="trigger" /></div><slot v-if="shown" /></div>',
};

const IDLE = { status: "idle", rows: [], error: null } as never;
const OK = { status: "ok", rows: [], error: null } as never;
const steps = [
  { kind: "p", key: "/web" },
  { kind: "p", key: "/web/logs" },
  { kind: "p", key: "/web/billings" },
];
const defWith = (x: unknown[], s: unknown[] = steps): FunnelDef =>
  ({ steps: s, unit: "sessions", window: "session", breakdown: null, x }) as unknown as FunnelDef;

const resultOf = (units: number[]): FunnelResult => ({
  steps: units.map((u, i) => ({
    step: steps[i] as StepRef,
    units: u,
    ofFirst: u / units[0],
    ofPrevious: i ? u / units[i - 1] : 1,
    dropoff: i < units.length - 1 ? u - units[i + 1] : 0,
    seen: 1,
    medianMs: null,
    p90Ms: null,
  })),
  step1Sessions: null,
  leftOut: null,
});

describe("FunnelLayoutInline: exclusion steps and step filters", () => {
  let wrapper: VueWrapper | null = null;

  const mountLayout = (def: FunnelDef, extra: Record<string, unknown> = {}) => {
    wrapper = mount(FunnelLayoutInline, {
      props: {
        def,
        result: null,
        removed: [],
        suggestions: [],
        suggestionsState: IDLE,
        state: IDLE,
        sampled: 1 as never,
        events: [],
        eventsStatus: "ready",
        unitLabel: "Sessions" as never,
        unitNoun: "sessions" as never,
        hideTime: false,
        app: "web",
        appFilters: null,
        includeHidden: false,
        settings: [],
        filterFields: ["geo_info_country"],
        filterValues: { field: null, status: "idle", rows: [] },
        ...extra,
      },
      global: {
        plugins: [store],
        stubs: {
          VueDraggableNext: { template: "<div><slot /></div>" },
          OPopover: popoverStub,
          ODropdown: popoverStub,
          StepPicker: true,
        },
      },
      attachTo: document.body,
    });
    return wrapper;
  };

  const exclusionPicker = (w: VueWrapper) =>
    w
      .findAllComponents({ name: "StepPicker" })
      .find((c) => c.props("dataTest") === "rum-analytics-funnel-exclusion-select");

  const pickExclusion = async (w: VueWrapper, step: StepRef) => {
    await w.find('[data-test="rum-analytics-funnel-add-exclusion-btn"]').trigger("click");
    exclusionPicker(w)!.vm.$emit("update:modelValue", step);
    await w.vm.$nextTick();
  };

  const lastDef = (w: VueWrapper) => w.emitted("update:def")?.at(-1)?.[0] as FunnelDef | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("the exclusion steps sit in their own section, not in the add-step row", () => {
    const w = mountLayout(defWith([]));
    const section = w.find('[data-test="rum-analytics-funnel-exclusions"]');
    expect(section.text()).toContain("Exclusion steps");
    expect(section.text()).toContain(
      "A session that did this between the two steps stops counting at the second step.",
    );
    expect(section.text()).toContain("Add exclusion step");
    const addRow = w.find('[data-test="rum-analytics-funnel-suggestions"]');
    expect(addRow.find('[data-test="rum-analytics-funnel-add-exclusion-btn"]').exists()).toBe(
      false,
    );
  });

  it("the picker asks for a page or click", async () => {
    const w = mountLayout(defWith([]));
    await w.find('[data-test="rum-analytics-funnel-add-exclusion-btn"]').trigger("click");
    expect(exclusionPicker(w)!.props("placeholder")).toBe("Pick a page or click");
  });

  it("a new exclusion spans step 1 to the last step", async () => {
    const w = mountLayout(defWith([]));
    await pickExclusion(w, { kind: "p", key: "/web/ingestion" });
    expect(lastDef(w)!.x).toEqual([{ step: { kind: "p", key: "/web/ingestion" }, a: 1, b: 3 }]);
  });

  it("a row over the whole funnel says so, a narrower one does not", () => {
    const w = mountLayout(
      defWith([
        { step: { kind: "p", key: "/x" }, a: 1, b: 3 },
        { step: { kind: "p", key: "/y" }, a: 2, b: 3 },
      ]),
    );
    expect(w.find('[data-test="rum-analytics-funnel-exclusion-0-whole"]').exists()).toBe(true);
    expect(w.find('[data-test="rum-analytics-funnel-exclusion-1-whole"]').exists()).toBe(false);
    expect(w.find('[data-test="rum-analytics-funnel-exclusion-0"]').text()).toMatch(
      /Did not see.*\/x.*between step 1 and step 3/,
    );
  });

  it("no validation shows before a pick", async () => {
    const w = mountLayout(defWith([]));
    await w.find('[data-test="rum-analytics-funnel-add-exclusion-btn"]').trigger("click");
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it("a page strictly inside the span shows why right after the pick and is not applied", async () => {
    const w = mountLayout(defWith([]));
    await pickExclusion(w, { kind: "p", key: "/web/logs" });
    expect(w.emitted("update:def")).toBeUndefined();
    const invalid = w.find('[data-test="rum-analytics-funnel-exclusion-pending-invalid"]');
    expect(invalid.text()).toContain("step 3 already did this at step 2");
  });

  it("narrowing a held row's range to a valid span applies it", async () => {
    const w = mountLayout(defWith([]));
    await pickExclusion(w, { kind: "p", key: "/web/logs" });
    await w.find('[data-test="rum-analytics-funnel-exclusion-pending-edit"]').trigger("click");
    w.findAllComponents({ name: "OSelect" })
      .find((c) => c.attributes("data-test") === "rum-analytics-funnel-exclusion-pending-to")!
      .vm.$emit("update:modelValue", 2);
    await w.vm.$nextTick();
    expect(lastDef(w)!.x).toEqual([{ step: { kind: "p", key: "/web/logs" }, a: 1, b: 2 }]);
    expect(w.find('[data-test="rum-analytics-funnel-exclusion-pending"]').exists()).toBe(false);
  });

  it("step a's and step b's own pages are valid for a between row", async () => {
    const w = mountLayout(defWith([]));
    await pickExclusion(w, { kind: "p", key: "/web" });
    await pickExclusion(w, { kind: "p", key: "/web/billings" });
    const emitted = w.emitted("update:def")!.map((e) => (e[0] as FunnelDef).x);
    expect(emitted).toHaveLength(2);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it("switching a row to within N s on step a's own page is refused with a reason", async () => {
    const w = mountLayout(defWith([{ step: { kind: "p", key: "/web" }, a: 1, b: 3 }]));
    await w.find('[data-test="rum-analytics-funnel-exclusion-0-edit"]').trigger("click");
    w.find('[data-test="rum-analytics-funnel-exclusion-0"]')
      .findComponent({ name: "OToggleGroup" })
      .vm.$emit("update:modelValue", "within");
    await w.vm.$nextTick();
    expect(w.emitted("update:def")).toBeUndefined();
    expect(w.find('[data-test="rum-analytics-funnel-exclusion-0-invalid"]').text()).toContain(
      "page of step 1",
    );
  });

  it("switching a within row on the last step of a 2-step funnel to between stays in range", async () => {
    const w = mountLayout(
      defWith([{ step: { kind: "p", key: "/x" }, a: 2, withinMs: 5000 }], steps.slice(0, 2)),
    );
    await w.find('[data-test="rum-analytics-funnel-exclusion-0-edit"]').trigger("click");
    w.find('[data-test="rum-analytics-funnel-exclusion-0"]')
      .findComponent({ name: "OToggleGroup" })
      .vm.$emit("update:modelValue", "between");
    await w.vm.$nextTick();
    expect(lastDef(w)!.x).toEqual([{ step: { kind: "p", key: "/x" }, a: 1, b: 2 }]);
  });

  it("a seconds value that rounds to 0 ms is not applied", async () => {
    const w = mountLayout(defWith([{ step: { kind: "p", key: "/x" }, a: 2, withinMs: 5000 }]));
    await w.find('[data-test="rum-analytics-funnel-exclusion-0-edit"]').trigger("click");
    const seconds = w
      .find('[data-test="rum-analytics-funnel-exclusion-0"]')
      .findComponent({ name: "OInput" });
    seconds.vm.$emit("update:modelValue", "0.0003");
    await w.vm.$nextTick();
    expect(w.emitted("update:def")).toBeUndefined();
    seconds.vm.$emit("update:modelValue", "2");
    await w.vm.$nextTick();
    expect(lastDef(w)!.x).toEqual([{ step: { kind: "p", key: "/x" }, a: 2, withinMs: 2000 }]);
  });

  it("removed counts show as a chip on the row and a hatched segment on step b's bar", () => {
    const w = mountLayout(defWith([{ step: { kind: "p", key: "/x" }, a: 1, b: 3 }]), {
      result: resultOf([100, 60, 30]),
      state: OK,
      removed: [12],
    });
    expect(w.find('[data-test="rum-analytics-funnel-exclusion-0-removed"]').text()).toBe(
      "12 removed at step 3",
    );
    const bar = w.find('[data-test="rum-analytics-funnel-bar-2"]');
    expect(
      bar.find('[data-test="rum-analytics-funnel-bar-removed"]').attributes("style"),
    ).toContain("width: 12%");
    const bar1 = w.find('[data-test="rum-analytics-funnel-bar-1"]');
    expect(bar1.find('[data-test="rum-analytics-funnel-bar-removed"]').exists()).toBe(false);
  });

  it("moving a step remaps its exclusions in the emitted definition", async () => {
    const w = mountLayout(defWith([{ step: { kind: "p", key: "/x" }, a: 2, b: 3 }]));
    await w.find('[data-test="rum-analytics-funnel-step-0-move-down"]').trigger("click");
    expect(lastDef(w)!.x).toEqual([{ step: { kind: "p", key: "/x" }, a: 1, b: 3 }]);
  });

  it("a move that inverts a span drops the exclusion", async () => {
    const w = mountLayout(defWith([{ step: { kind: "p", key: "/x" }, a: 2, b: 3 }]));
    await w.find('[data-test="rum-analytics-funnel-step-1-move-down"]').trigger("click");
    expect(lastDef(w)!.x).toEqual([]);
  });

  it("shows a within-N-seconds exclusion row with its page and its seconds", () => {
    const w = mountLayout(
      defWith([{ step: { kind: "p", key: "/web/ingestion" }, a: 2, withinMs: 5000 }]),
    );
    expect(w.text()).toContain("/web/ingestion");
    expect(w.text()).toMatch(/\b5\s?s\b/);
  });

  it("a page step's options offer time on page, frustrated and errored; a click step has none", async () => {
    const w = mountLayout(
      defWith(
        [],
        [
          { kind: "p", key: "/web" },
          { kind: "c", key: "save-btn" },
        ],
      ),
    );
    await w.find('[data-test="rum-analytics-funnel-step-0-filters"]').trigger("click");
    const page = w.find('[data-test="rum-analytics-funnel-step-0"]').text();
    expect(page).toMatch(/time on page/i);
    expect(page).toMatch(/frustrat/i);
    expect(w.find('[data-test="rum-analytics-funnel-step-1-filters"]').exists()).toBe(false);
  });

  it("choosing the frustrated filter on a page step emits a def whose step carries it", async () => {
    const w = mountLayout(defWith([], steps.slice(0, 2)));
    await w.find('[data-test="rum-analytics-funnel-step-0-filters"]').trigger("click");
    w.findAllComponents({ name: "OCheckbox" })
      .find((c) => c.attributes("data-test") === "rum-analytics-funnel-step-0-filter-frustrated")!
      .vm.$emit("update:modelValue", true);
    await w.vm.$nextTick();
    const def = lastDef(w)!;
    expect(def.steps[0].f?.frustrated).toBe(true);
    expect(def.steps[1].f?.frustrated).toBeUndefined();
  });

  it("the app filters line forwards its links as layout events", async () => {
    const w = mountLayout(defWith([]), {
      appFilters: { builtin: 3, rules: 2, synthetic: 0 },
    });
    await w.find('[data-test="rum-analytics-funnel-app-filters-include"]').trigger("click");
    await w.find('[data-test="rum-analytics-funnel-app-filters-edit"]').trigger("click");
    expect(w.emitted("include-hidden")).toHaveLength(1);
    expect(w.emitted("edit-app-filters")).toHaveLength(1);
  });

  it("renders Filter all steps on the card, with chips, and asks the owner for a field's values", async () => {
    const def = {
      ...defWith([]),
      f: [{ field: "geo_info_country", op: "in", values: ["India"] }],
    } as FunnelDef;
    const w = mountLayout(def, { filterFields: ["geo_info_country", "usr_email"] });
    const section = w.find('[data-test="rum-analytics-funnel-filter-all"]');
    expect(section.text()).toContain("Filter all steps");
    expect(
      section.find('[data-test="rum-analytics-funnel-filter-geo_info_country"]').text(),
    ).toContain("Country is one of India");
    await w.find('[data-test="rum-analytics-funnel-add-filter-btn"]').trigger("click");
    await w
      .find('[data-test="rum-analytics-funnel-field-picker-field-usr_email"]')
      .trigger("click");
    expect(
      w.find('[data-test="rum-analytics-funnel-field-picker-field-geo_info_country"]').exists(),
    ).toBe(false);
    expect(w.emitted("filter-values")).toEqual([["usr_email"]]);
  });

  it("shows a step's view conditions as chips under the step", () => {
    const vc = [{ t: "param", key: "utm_source", op: "eq", values: ["ads"] }];
    const w = mountLayout(defWith([], [{ kind: "p", key: "/web", f: { vc } }, steps[1]]));
    expect(w.find('[data-test="rum-analytics-funnel-steps-table"]').text()).toContain(
      "utm_source = ads",
    );
  });
});
