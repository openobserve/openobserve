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
import FunnelLayoutRail from "./FunnelLayoutRail.vue";
import type { FunnelResult } from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef, StepRef } from "@/utils/rum/productAnalyticsQueries";

const store = createStore({
  state: { selectedOrganization: { identifier: "org1" }, timezone: "UTC", zoConfig: {} },
});
// Follows `open` like the real popover, so a controlled popover can be driven from its trigger.
const popoverStub = {
  props: ["open"],
  emits: ["update:open"],
  data: () => ({ inner: false }),
  computed: {
    shown(this: { open?: boolean; inner: boolean }) {
      return this.open ?? this.inner;
    },
  },
  methods: {
    flip(this: { shown: boolean; inner: boolean; $emit: (e: string, v: boolean) => void }) {
      this.inner = !this.shown;
      this.$emit("update:open", this.inner);
    },
  },
  template: '<div><div @click="flip"><slot name="trigger" /></div><slot v-if="shown" /></div>',
};
const draggableStub = {
  name: "VueDraggableNext",
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: "<div><slot /></div>",
};
const IDLE = { status: "idle", rows: [], error: null } as never;
const DEF = {
  steps: [
    { kind: "p", key: "/web", f: { errored: true } },
    { kind: "c", key: "save-btn" },
  ],
  unit: "sessions",
  window: "session",
  breakdown: null,
  x: [{ step: { kind: "p", key: "/x" }, a: 1, b: 2 }],
} as FunnelDef;

describe("FunnelLayoutRail", () => {
  let wrapper: VueWrapper | null = null;

  const mountRail = (extra: Record<string, unknown> = {}) => {
    wrapper = mount(FunnelLayoutRail, {
      props: {
        def: DEF,
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
        appFilters: { builtin: 0, rules: 0, synthetic: 0 },
        includeHidden: false,
        filterFields: ["geo_info_country"],
        filterValues: { field: null, status: "idle", rows: [] },
        settings: [
          { id: "unit", label: "Count by" as never, value: "Sessions" as never },
          { id: "window", label: "Window" as never, value: "Same session" as never },
        ],
        ...extra,
      },
      global: {
        plugins: [store],
        stubs: {
          VueDraggableNext: draggableStub,
          OPopover: popoverStub,
          ODropdown: popoverStub,
          StepPicker: true,
        },
      },
      attachTo: document.body,
    });
    return wrapper;
  };

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("shows the rail sections beside the steps table", () => {
    const w = mountRail();
    const steps = w.find('[data-test="rum-analytics-funnel-rail-steps"]').text();
    expect(steps).toContain("/web");
    expect(steps).toContain("errored");
    expect(w.find('[data-test="rum-analytics-funnel-rail-step-1"]').text()).not.toContain("where");
    expect(w.find('[data-test="rum-analytics-funnel-exclusions"]').text()).toContain(
      "Exclusion steps",
    );
    expect(w.find('[data-test="rum-analytics-funnel-rail-app-filters"]').text()).toContain(
      "App filters for web",
    );
    expect(w.find('[data-test="rum-analytics-funnel-app-filters-none"]').exists()).toBe(true);
    expect(w.find('[data-test="rum-analytics-funnel-rail-setting-window"]').text()).toContain(
      "Same session",
    );
    expect(w.find('[data-test="rum-analytics-funnel-steps-table"]').exists()).toBe(true);
  });

  it("a page step's filter button expands its conditions in place and emits update:def", async () => {
    const w = mountRail();
    expect(w.find('[data-test="rum-analytics-funnel-step-0-filters-popover"]').exists()).toBe(
      false,
    );
    await w.find('[data-test="rum-analytics-funnel-rail-step-0-filters"]').trigger("click");
    const popover = w.find('[data-test="rum-analytics-funnel-step-0-filters-popover"]');
    expect(popover.text()).toMatch(/time on page/i);
    popover.findAllComponents({ name: "OCheckbox" }).at(0)!.vm.$emit("update:modelValue", true);
    await w.vm.$nextTick();
    const def = w.emitted("update:def")!.at(-1)![0] as FunnelDef;
    expect(def.steps[0].f).toEqual({ frustrated: true, errored: true });
  });

  it("a click step has no condition editor", () => {
    expect(
      mountRail().find('[data-test="rum-analytics-funnel-rail-step-1-filters"]').exists(),
    ).toBe(false);
  });

  it("the table leaves step edits to the rail", () => {
    const w = mountRail();
    expect(w.find('[data-test="rum-analytics-funnel-step-1-remove"]').exists()).toBe(false);
    expect(w.find('[data-test="rum-analytics-funnel-step-0-filters"]').exists()).toBe(false);
    expect(
      w.find('[data-test="rum-analytics-funnel-steps-table"] .funnel-drag-handle').exists(),
    ).toBe(false);
  });

  it("rail steps drag by the handle over their number, and a drop reorders the funnel", async () => {
    const w = mountRail();
    const handle = w.find('[data-test="rum-analytics-funnel-rail-step-0-drag"]');
    expect(handle.classes()).toContain("funnel-drag-handle");
    w.findComponent(draggableStub).vm.$emit("update:modelValue", [DEF.steps[1], DEF.steps[0]]);
    await w.vm.$nextTick();
    const def = w.emitted("update:def")!.at(-1)![0] as FunnelDef;
    expect(def.steps.map((s) => s.key)).toEqual(["save-btn", "/web"]);
    expect(def.x).toEqual([]);
  });

  it("puts the card beside the rail, with the page's header, notices and footer in it", () => {
    const base = mountRail();
    const props = base.props() as never;
    base.unmount();
    wrapper = mount(FunnelLayoutRail, {
      props,
      slots: {
        header: "<div data-test='h' />",
        notices: "<div data-test='n' />",
        footer: "<div data-test='f' />",
      },
      global: {
        plugins: [store],
        stubs: { VueDraggableNext: { template: "<div><slot /></div>" } },
      },
    });
    const card = wrapper.find('[data-test="rum-analytics-funnel-card"]');
    for (const id of ["h", "n", "f"]) expect(card.find(`[data-test="${id}"]`).exists()).toBe(true);
    expect(wrapper.find("aside").find('[data-test="rum-analytics-funnel-card"]').exists()).toBe(
      false,
    );
  });

  it("a failed panel keeps the rail but drops the steps table", () => {
    const w = mountRail({ failed: true });
    expect(w.find('[data-test="rum-analytics-funnel-rail-steps"]').exists()).toBe(true);
    expect(w.find('[data-test="rum-analytics-funnel-steps-table"]').exists()).toBe(false);
  });

  it("the Steps + opens the add-step box", async () => {
    const w = mountRail();
    expect(w.find('[data-test="rum-analytics-funnel-rail-add-step"]').exists()).toBe(false);
    await w.find('[data-test="rum-analytics-funnel-rail-add-step-btn"]').trigger("click");
    expect(w.find('[data-test="rum-analytics-funnel-rail-add-step"]').exists()).toBe(true);
  });

  it("the app filters switch turns hidden traffic off as well as on", async () => {
    const w = mountRail({
      appFilters: { builtin: 5, rules: 0, synthetic: 0 },
      includeHidden: true,
    });
    w.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", false);
    await w.vm.$nextTick();
    expect(w.emitted("hide-hidden")).toHaveLength(1);
  });

  it("a step removed from the rail reaches the rail's owner as update:def", async () => {
    const w = mountRail();
    await w.find('[data-test="rum-analytics-funnel-rail-step-1-remove"]').trigger("click");
    const def = w.emitted("update:def")!.at(-1)![0] as FunnelDef;
    expect(def.steps).toHaveLength(1);
    expect(def.x).toEqual([]);
  });

  it("renders Filter all steps as a rail section, and its chips remove a filter", async () => {
    const def = {
      ...DEF,
      f: [{ field: "geo_info_country", op: "in", values: ["India"] }],
    } as FunnelDef;
    const w = mountRail({ def });
    const aside = w.find("aside");
    const section = aside.find('[data-test="rum-analytics-funnel-filter-all"]');
    expect(section.text()).toContain("Filter all steps");
    await section
      .find('[data-test="rum-analytics-funnel-filter-geo_info_country"] button')
      .trigger("click");
    const next = w.emitted("update:def")!.at(-1)![0] as FunnelDef;
    expect(next).not.toHaveProperty("f");
  });

  it("shows a step's view conditions in the rail step card", () => {
    const vc = [{ t: "ref", op: "eq", values: ["google.com"] }];
    const def = {
      ...DEF,
      steps: [{ kind: "p", key: "/web", f: { vc } }, DEF.steps[1]],
    } as FunnelDef;
    expect(
      mountRail({ def }).find('[data-test="rum-analytics-funnel-rail-step-0"]').text(),
    ).toContain("from google.com");
  });
});

// Ported from the removed inline layout: the exclusion and step-option parts are shared, the rail is now their only host.
describe("FunnelLayoutRail: exclusion steps and step options", () => {
  let wrapper: VueWrapper | null = null;
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

  const mountLayout = (def: FunnelDef, extra: Record<string, unknown> = {}) => {
    wrapper = mount(FunnelLayoutRail, {
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
          VueDraggableNext: draggableStub,
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

  const dragTo = async (w: VueWrapper, order: StepRef[]) => {
    w.findComponent(draggableStub).vm.$emit("update:modelValue", order);
    await w.vm.$nextTick();
  };

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("the exclusion steps sit in their own rail section, not in the add-step row", () => {
    const w = mountLayout(defWith([]));
    const section = w.find('[data-test="rum-analytics-funnel-exclusions"]');
    expect(section.text()).toContain("Exclusion steps");
    expect(section.find('[data-test="rum-analytics-funnel-add-exclusion-btn"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-test="rum-analytics-funnel-suggestions"]').exists()).toBe(false);
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

  it("dragging a step remaps its exclusions in the emitted definition", async () => {
    const w = mountLayout(defWith([{ step: { kind: "p", key: "/x" }, a: 2, b: 3 }]));
    const [a, b, c] = steps as StepRef[];
    await dragTo(w, [b, a, c]);
    expect(lastDef(w)!.x).toEqual([{ step: { kind: "p", key: "/x" }, a: 1, b: 3 }]);
  });

  it("a drag that inverts a span drops the exclusion", async () => {
    const w = mountLayout(defWith([{ step: { kind: "p", key: "/x" }, a: 2, b: 3 }]));
    const [a, b, c] = steps as StepRef[];
    await dragTo(w, [a, c, b]);
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
    await w.find('[data-test="rum-analytics-funnel-rail-step-0-filters"]').trigger("click");
    const page = w.find('[data-test="rum-analytics-funnel-step-0-filters-popover"]').text();
    expect(page).toMatch(/time on page/i);
    expect(page).toMatch(/frustrat/i);
    expect(w.find('[data-test="rum-analytics-funnel-rail-step-1-filters"]').exists()).toBe(false);
  });

  it("choosing the frustrated filter on a page step emits a def whose step carries it", async () => {
    const w = mountLayout(defWith([], steps.slice(0, 2)));
    await w.find('[data-test="rum-analytics-funnel-rail-step-0-filters"]').trigger("click");
    w.findAllComponents({ name: "OCheckbox" })
      .find((c) => c.attributes("data-test") === "rum-analytics-funnel-step-0-filter-frustrated")!
      .vm.$emit("update:modelValue", true);
    await w.vm.$nextTick();
    const def = lastDef(w)!;
    expect(def.steps[0].f?.frustrated).toBe(true);
    expect(def.steps[1].f?.frustrated).toBeUndefined();
  });

  it("the app filters section forwards its links as layout events", async () => {
    const w = mountLayout(defWith([]), {
      appFilters: { builtin: 3, rules: 2, synthetic: 0 },
    });
    await w.find('[data-test="rum-analytics-funnel-app-filters-edit"]').trigger("click");
    expect(w.emitted("edit-app-filters")).toHaveLength(1);
    w.findComponent({ name: "OSwitch" }).vm.$emit("update:modelValue", true);
    await w.vm.$nextTick();
    expect(w.emitted("include-hidden")).toHaveLength(1);
  });

  it("asks the owner for a field's values when a filter field is picked", async () => {
    const w = mountLayout(defWith([]), { filterFields: ["geo_info_country", "usr_email"] });
    await w.find('[data-test="rum-analytics-funnel-add-filter-btn"]').trigger("click");
    await w.vm.$nextTick();
    const field = w.find('[data-test="rum-analytics-funnel-field-picker-field-usr_email"]');
    expect(field.exists()).toBe(true);
    await field.trigger("click");
    expect(w.emitted("filter-values")).toEqual([["usr_email"]]);
  });
});
