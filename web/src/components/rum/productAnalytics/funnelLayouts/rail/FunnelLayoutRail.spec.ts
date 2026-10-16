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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import type { FunnelResult } from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef, StepRef } from "@/utils/rum/productAnalyticsQueries";

vi.mock("@/composables/rum/useStepOptions", async (importOriginal) => {
  const { useStepOptionsMock } = await import("@/utils/rum/__fixtures__/stepOptionsMock");
  return {
    ...(await importOriginal<object>()),
    default: useStepOptionsMock,
    useStepOptions: useStepOptionsMock,
  };
});

import { resetStepOptions } from "@/utils/rum/__fixtures__/stepOptionsMock";
import FunnelLayoutRail from "./FunnelLayoutRail.vue";

const store = createStore({
  state: { selectedOrganization: { identifier: "org1" }, timezone: "UTC", zoConfig: {} },
});
// Follows `open` like the real popover, so a controlled popover can be driven from its trigger.
const popoverStub = {
  props: ["open", "side"],
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
const COLLAPSED_KEY = "o2.rum.analytics.funnelRailCollapsed";
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
const popoverAround = (w: VueWrapper, testId: string) =>
  w.findAllComponents(popoverStub).find((c) => c.find(`[data-test="${testId}"]`).exists());

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

  it("names a deleted named-event step by its last known name", () => {
    const w = mountRail({
      def: { ...DEF, steps: [DEF.steps[0], { kind: "e", key: "gone-id" }] },
      deletedNames: { "gone-id": "Old checkout" },
    });
    expect(w.find('[data-test="rum-analytics-funnel-step-1"]').text()).toContain("Old checkout");
  });

  it("shows the rail sections beside the steps table, with no step list in the rail", () => {
    const w = mountRail();
    expect(w.find("aside").text()).not.toContain("/web");
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

  it("a page step's filter button opens its conditions and emits update:def", async () => {
    const w = mountRail();
    expect(w.find('[data-test="rum-analytics-funnel-step-0-filters-popover"]').exists()).toBe(
      false,
    );
    await w.find('[data-test="rum-analytics-funnel-step-0-filters"]').trigger("click");
    const popover = w.find('[data-test="rum-analytics-funnel-step-0-filters-popover"]');
    expect(popover.text()).toMatch(/time on page/i);
    popover.findAllComponents({ name: "OCheckbox" }).at(0)!.vm.$emit("update:modelValue", true);
    await w.vm.$nextTick();
    const def = w.emitted("update:def")!.at(-1)![0] as FunnelDef;
    expect(def.steps[0].f).toEqual({ frustrated: true, errored: true });
  });

  it("a click step has no condition editor", () => {
    expect(mountRail().find('[data-test="rum-analytics-funnel-step-1-filters"]').exists()).toBe(
      false,
    );
  });

  it("table rows drag by their handle, and a drop reorders the funnel", async () => {
    const w = mountRail();
    expect(w.find('[data-test="rum-analytics-funnel-step-0"] .funnel-drag-handle').exists()).toBe(
      true,
    );
    w.findComponent(draggableStub).vm.$emit("update:modelValue", [DEF.steps[1], DEF.steps[0]]);
    await w.vm.$nextTick();
    const def = w.emitted("update:def")!.at(-1)![0] as FunnelDef;
    expect(def.steps.map((s) => s.key)).toEqual(["save-btn", "/web"]);
    expect(def.x).toEqual([]);
  });

  it("puts the card beside the rail, with the page's header, actions, notices and footer in it", () => {
    const base = mountRail();
    const props = base.props() as never;
    base.unmount();
    wrapper = mount(FunnelLayoutRail, {
      props,
      slots: {
        header: "<div data-test='h' />",
        actions: "<div data-test='a' />",
        notices: "<div data-test='n' />",
        footer: "<div data-test='f' />",
      },
      global: {
        plugins: [store],
        stubs: { VueDraggableNext: { template: "<div><slot /></div>" } },
      },
    });
    const card = wrapper.find('[data-test="rum-analytics-funnel-card"]');
    for (const id of ["h", "a", "n", "f"])
      expect(card.find(`[data-test="${id}"]`).exists()).toBe(true);
    const toolbar = card.find('[data-test="rum-analytics-funnel-toolbar"]');
    const ids = toolbar
      .findAll("[data-test]")
      .map((e) => e.attributes("data-test"))
      .filter((id) =>
        [
          "rum-analytics-funnel-rail-collapse-btn",
          "h",
          "rum-analytics-funnel-add-step-btn",
          "a",
        ].includes(id!),
      );
    expect(ids).toEqual([
      "rum-analytics-funnel-rail-collapse-btn",
      "h",
      "rum-analytics-funnel-add-step-btn",
      "a",
    ]);
    expect(wrapper.find("aside").find('[data-test="rum-analytics-funnel-card"]').exists()).toBe(
      false,
    );
  });

  it("a failed panel keeps the rail but drops the steps table", () => {
    const w = mountRail({ failed: true });
    expect(w.find('[data-test="rum-analytics-funnel-exclusions"]').exists()).toBe(true);
    expect(w.find('[data-test="rum-analytics-funnel-steps-table"]').exists()).toBe(false);
  });

  it("the toolbar Add step opens the add-step box, and an added step closes it", async () => {
    const w = mountRail();
    expect(w.find('[data-test="rum-analytics-funnel-add-step"]').exists()).toBe(false);
    await w.find('[data-test="rum-analytics-funnel-add-step-btn"]').trigger("click");
    expect(w.find('[data-test="rum-analytics-funnel-add-step"]').exists()).toBe(true);
    await w.setProps({ def: { ...DEF, steps: [...DEF.steps, { kind: "p", key: "/done" }] } });
    expect(w.find('[data-test="rum-analytics-funnel-add-step"]').exists()).toBe(false);
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

  it("a step removed from the table reaches the rail's owner as update:def", async () => {
    const w = mountRail();
    await w.find('[data-test="rum-analytics-funnel-step-1-remove"]').trigger("click");
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

  it("shows a step's view conditions in its table row", () => {
    const vc = [{ t: "ref", op: "eq", values: ["google.com"] }];
    const def = {
      ...DEF,
      steps: [{ kind: "p", key: "/web", f: { vc } }, DEF.steps[1]],
    } as FunnelDef;
    expect(mountRail({ def }).find('[data-test="rum-analytics-funnel-step-0"]').text()).toContain(
      "from google.com",
    );
  });

  describe("collapsible side panel", () => {
    const SECTIONS = '[data-test="rum-analytics-funnel-rail-sections"]';
    const PANEL = ".o-splitter__before";
    const SEPARATOR = '[role="separator"]';
    const TOGGLE = '[data-test="rum-analytics-funnel-rail-collapse-btn"]';
    const toggleIn = (w: VueWrapper) => {
      const toggle = w.find(TOGGLE);
      expect(toggle.exists()).toBe(true);
      return toggle;
    };

    beforeEach(() => {
      localStorage.removeItem(COLLAPSED_KEY);
    });

    afterEach(() => {
      localStorage.removeItem(COLLAPSED_KEY);
    });

    it("mounts expanded by default, with the toggle in the card toolbar", () => {
      const w = mountRail();
      expect(toggleIn(w).attributes("aria-expanded")).toBe("true");
      expect(toggleIn(w).attributes("aria-label")).toBe("Collapse side panel");
      expect(toggleIn(w).classes()).toContain("max-lg:hidden");
      expect(w.find('[data-test="rum-analytics-funnel-toolbar"]').find(TOGGLE).exists()).toBe(true);
      expect(w.find(PANEL).classes()).not.toContain("lg:hidden");
    });

    it("clicking the toggle hides the panel and remembers it", async () => {
      const w = mountRail();
      await toggleIn(w).trigger("click");
      expect(w.find(PANEL).classes()).toContain("lg:hidden");
      expect(toggleIn(w).attributes("aria-expanded")).toBe("false");
      expect(toggleIn(w).attributes("aria-label")).toBe("Expand side panel");
      expect(localStorage.getItem(COLLAPSED_KEY)).toBe("1");
      expect(w.find(SEPARATOR).classes()).toContain("hidden");
    });

    it("clicking the toggle again expands the panel and remembers that too", async () => {
      const w = mountRail();
      await toggleIn(w).trigger("click");
      await toggleIn(w).trigger("click");
      expect(w.find(PANEL).classes()).not.toContain("lg:hidden");
      expect(toggleIn(w).attributes("aria-expanded")).toBe("true");
      expect(localStorage.getItem(COLLAPSED_KEY)).toBe("0");
      expect(w.find(SEPARATOR).classes()).not.toContain("hidden");
      expect(w.find(SECTIONS).exists()).toBe(true);
    });

    it("mounts collapsed when the panel was collapsed last time", () => {
      localStorage.setItem(COLLAPSED_KEY, "1");
      const w = mountRail();
      expect(toggleIn(w).attributes("aria-expanded")).toBe("false");
      expect(w.find(PANEL).classes()).toContain("lg:hidden");
      expect(w.find('[data-test="rum-analytics-funnel-steps-table"]').exists()).toBe(true);
    });

    it("mounts expanded when localStorage throws", () => {
      const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      try {
        const w = mountRail();
        expect(toggleIn(w).attributes("aria-expanded")).toBe("true");
        expect(w.find(PANEL).classes()).not.toContain("lg:hidden");
      } finally {
        getItem.mockRestore();
      }
    });

    it("still collapses when localStorage cannot be written", async () => {
      const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      try {
        const w = mountRail();
        await toggleIn(w).trigger("click");
        expect(w.find(PANEL).classes()).toContain("lg:hidden");
      } finally {
        setItem.mockRestore();
      }
    });
  });

  describe("resizable side panel", () => {
    const WIDTH_KEY = "o2.rum.analytics.funnelRailWidth";
    const separatorOf = (w: VueWrapper) => w.find('[role="separator"]');
    const RealObserver = globalThis.ResizeObserver;
    const observeWidth = (width: number) => {
      globalThis.ResizeObserver = class {
        constructor(private cb: ResizeObserverCallback) {}
        observe() {
          this.cb([{ contentRect: { width } } as ResizeObserverEntry], this as never);
        }
        disconnect() {}
        unobserve() {}
      } as never;
    };

    beforeEach(() => localStorage.removeItem(WIDTH_KEY));
    afterEach(() => {
      localStorage.removeItem(WIDTH_KEY);
      globalThis.ResizeObserver = RealObserver;
    });

    it("starts at 22rem and lets the rail move between 17rem and 30rem", () => {
      const sep = separatorOf(mountRail());
      expect(sep.attributes("aria-valuenow")).toBe("352");
      expect(sep.attributes("aria-valuemin")).toBe("272");
      expect(sep.attributes("aria-valuemax")).toBe("480");
    });

    it("remembers a dragged width", async () => {
      const w = mountRail();
      w.findComponent({ name: "OSplitter" }).vm.$emit("update:modelValue", 400);
      await w.vm.$nextTick();
      expect(localStorage.getItem(WIDTH_KEY)).toBe("400");
      expect(separatorOf(w).attributes("aria-valuenow")).toBe("400");
    });

    it("clamps a remembered width into the limits", () => {
      localStorage.setItem(WIDTH_KEY, "900");
      expect(separatorOf(mountRail()).attributes("aria-valuenow")).toBe("480");
      wrapper?.unmount();
      localStorage.setItem(WIDTH_KEY, "100");
      expect(separatorOf(mountRail()).attributes("aria-valuenow")).toBe("272");
    });

    it("keeps the table's floor, so a narrow frame pins the rail at its minimum", async () => {
      observeWidth(1158);
      const w = mountRail();
      await w.vm.$nextTick();
      expect(separatorOf(w).attributes("aria-valuemax")).toBe("272");
      expect(separatorOf(w).attributes("aria-valuenow")).toBe("272");
    });

    it("gives the rail more room when the table has no time column", async () => {
      observeWidth(1318);
      const w = mountRail({ hideTime: true });
      await w.vm.$nextTick();
      expect(separatorOf(w).attributes("aria-valuemax")).toBe("480");
      await w.setProps({ hideTime: false });
      expect(separatorOf(w).attributes("aria-valuemax")).toBe("406");
    });
  });
});

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

  const ADD = "rum-analytics-funnel-add-exclusion-btn";
  const PICKER = "rum-analytics-funnel-exclusion-picker";
  const picker = (w: VueWrapper) => w.find(`[data-test="${PICKER}"]`);
  const chip = (w: VueWrapper, j: number) =>
    w.find(`[data-test="rum-analytics-funnel-exclusion-${j}"]`);
  const inPicker = (w: VueWrapper, id: string) => {
    const el = w.find(`[data-test="${PICKER}-${id}"]`);
    expect(el.exists()).toBe(true);
    return el;
  };
  const pickRow = async (w: VueWrapper, key: string) =>
    inPicker(w, `step-p:${key}`).trigger("click");
  const applyPicker = async (w: VueWrapper) => inPicker(w, "apply").trigger("click");
  const addExclusion = async (w: VueWrapper, key: string) => {
    await w.find(`[data-test="${ADD}"]`).trigger("click");
    await pickRow(w, key);
    await applyPicker(w);
  };

  const lastDef = (w: VueWrapper) => w.emitted("update:def")?.at(-1)?.[0] as FunnelDef | undefined;

  const dragTo = async (w: VueWrapper, order: StepRef[]) => {
    w.findComponent(draggableStub).vm.$emit("update:modelValue", order);
    await w.vm.$nextTick();
  };

  beforeEach(() =>
    resetStepOptions([
      { label: "Pages", header: true, value: "header:p" },
      ...["/web", "/web/logs", "/web/billings", "/web/ingestion", "/x"].map((key) => ({
        label: key,
        value: `p:${key}`,
        icon: "article",
      })),
    ]),
  );

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

  it("a new exclusion spans step 1 to the last step", async () => {
    const w = mountLayout(defWith([]));
    await addExclusion(w, "/web/ingestion");
    expect(lastDef(w)!.x).toEqual([{ step: { kind: "p", key: "/web/ingestion" }, a: 1, b: 3 }]);
  });

  it("a chip over the whole funnel says so, a narrower one names its steps", () => {
    const w = mountLayout(
      defWith([
        { step: { kind: "p", key: "/x" }, a: 1, b: 3 },
        { step: { kind: "p", key: "/y" }, a: 2, b: 3 },
      ]),
    );
    expect(chip(w, 0).text()).toMatch(/\/x over the whole funnel/);
    expect(chip(w, 0).text()).not.toContain("between step");
    expect(chip(w, 1).text()).toMatch(/\/y between step 2 and step 3/);
    expect(chip(w, 1).text()).not.toContain("whole funnel");
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
    await w.find('[data-test="rum-analytics-funnel-step-0-filters"]').trigger("click");
    const page = w.find('[data-test="rum-analytics-funnel-step-0-filters-popover"]').text();
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

  describe("exclusion steps add through a popover", () => {
    const SPAN_1_2 = { step: { kind: "p", key: "/x" }, a: 1, b: 2 };

    it("the exclusion + opens a popover like Filter all steps, on the picker's list", async () => {
      const w = mountLayout(defWith([]));
      expect(picker(w).exists()).toBe(false);
      await w.find(`[data-test="${ADD}"]`).trigger("click");
      const popover = popoverAround(w, ADD);
      expect(popover).toBeDefined();
      expect(popover!.find(`[data-test="${PICKER}"]`).exists()).toBe(true);
      expect(w.findAll(`[data-test="${PICKER}"]`)).toHaveLength(1);
      expect(w.findComponent(`[data-test="${ADD}"]`).props("active")).toBe(true);
      expect(picker(w).find(`[data-test="${PICKER}-step-p:/web/ingestion"]`).exists()).toBe(true);
      expect(picker(w).find(`[data-test="${PICKER}-apply"]`).exists()).toBe(false);
    });

    it("the exclusion popover opens to the right of the rail, like the filter popover", () => {
      const w = mountLayout(defWith([]));
      const filter = popoverAround(w, "rum-analytics-funnel-add-filter-btn");
      const exclusion = popoverAround(w, ADD);
      expect(filter?.props("side")).toBe("right");
      expect(exclusion?.props("side")).toBe("right");
      expect(exclusion?.attributes("content-class")).toBe(filter?.attributes("content-class"));
    });

    it("applying from the picker appends the exclusion and closes the popover", async () => {
      const w = mountLayout(defWith([SPAN_1_2]));
      await addExclusion(w, "/web/ingestion");
      expect(w.emitted("update:def")).toHaveLength(1);
      expect(lastDef(w)!.x).toEqual([
        SPAN_1_2,
        { step: { kind: "p", key: "/web/ingestion" }, a: 1, b: 3 },
      ]);
      expect(popoverAround(w, ADD)?.props("open")).toBe(false);
      expect(picker(w).exists()).toBe(false);
      expect(w.findComponent(`[data-test="${ADD}"]`).props("active")).toBe(false);
    });

    it("Cancel and closing the popover drop a staged edit", async () => {
      const w = mountLayout(defWith([SPAN_1_2]));
      const drops = [
        async () => inPicker(w, "cancel").trigger("click"),
        async () => {
          popoverAround(w, ADD)!.vm.$emit("update:open", false);
          await w.vm.$nextTick();
        },
      ];
      for (const drop of drops) {
        await chip(w, 0).trigger("click");
        expect(inPicker(w, "step").text()).toContain("/x");
        w.findAllComponents({ name: "OSelect" })
          .find((c) => c.attributes("data-test") === `${PICKER}-to`)!
          .vm.$emit("update:modelValue", 3);
        await w.vm.$nextTick();
        await drop();
        expect(picker(w).exists()).toBe(false);
        expect(popoverAround(w, ADD)?.props("open")).toBe(false);
        expect(w.emitted("update:def")).toBeUndefined();
        expect(chip(w, 0).text()).toContain("between step 1 and step 2");
      }
    });

    it("the popover reopens for a second add after the first closed it", async () => {
      const w = mountLayout(defWith([]));
      await addExclusion(w, "/web");
      expect(popoverAround(w, ADD)?.props("open")).toBe(false);
      await addExclusion(w, "/web/billings");
      expect(popoverAround(w, ADD)?.props("open")).toBe(false);
      expect(w.emitted("update:def")).toHaveLength(2);
      expect(lastDef(w)!.x).toEqual([{ step: { kind: "p", key: "/web/billings" }, a: 1, b: 3 }]);
    });

    it("reads as Did not see / and chips, one per exclusion", () => {
      const w = mountLayout(defWith([SPAN_1_2, { step: { kind: "p", key: "/y" }, a: 2, b: 3 }]));
      const text = w.find('[data-test="rum-analytics-funnel-exclusions"]').text();
      expect(text).toMatch(
        /Did not see\s*Page\s*\/x between step 1 and step 2\s*and\s*Page\s*\/y between step 2 and step 3/,
      );
      expect(text.match(/Did not see/g)).toHaveLength(1);
      expect(chip(w, 0).findComponent({ name: "OTruncatedText" }).text()).toBe(
        "/x between step 1 and step 2",
      );
      w.unmount();
      wrapper = mountLayout(defWith([SPAN_1_2, SPAN_1_2]));
      expect(chip(wrapper, 1).exists()).toBe(true);
    });

    it("clicking a chip edits it in the picker; another step replaces it and keeps the range", async () => {
      const w = mountLayout(defWith([SPAN_1_2, { step: { kind: "p", key: "/y" }, a: 2, b: 3 }]));
      await chip(w, 0).trigger("click");
      expect(popoverAround(w, ADD)?.props("open")).toBe(true);
      expect(inPicker(w, "step").text()).toContain("/x");
      const to = w
        .findAllComponents({ name: "OSelect" })
        .find((c) => c.attributes("data-test") === `${PICKER}-to`)!;
      expect(to.props("modelValue")).toBe(2);
      await inPicker(w, "back").trigger("click");
      await pickRow(w, "/web/ingestion");
      await applyPicker(w);
      expect(w.emitted("update:def")).toHaveLength(1);
      expect(lastDef(w)!.x).toEqual([
        { step: { kind: "p", key: "/web/ingestion" }, a: 1, b: 2 },
        { step: { kind: "p", key: "/y" }, a: 2, b: 3 },
      ]);
      expect(picker(w).exists()).toBe(false);
    });

    it("an edit starts from the chip even right after an add was cancelled", async () => {
      const w = mountLayout(defWith([{ step: { kind: "p", key: "/y" }, a: 2, b: 3 }]));
      await w.find(`[data-test="${ADD}"]`).trigger("click");
      await pickRow(w, "/web/ingestion");
      await inPicker(w, "cancel").trigger("click");
      await chip(w, 0).trigger("click");
      expect(inPicker(w, "step").text()).toContain("/y");
      await applyPicker(w);
      expect(lastDef(w)!.x).toEqual([{ step: { kind: "p", key: "/y" }, a: 2, b: 3 }]);
    });

    it("the + after a dropped edit starts a fresh add that appends", async () => {
      const w = mountLayout(defWith([SPAN_1_2]));
      const dropEdit = [
        async () => inPicker(w, "cancel").trigger("click"),
        async () => {
          popoverAround(w, ADD)!.vm.$emit("update:open", false);
          await w.vm.$nextTick();
        },
      ];
      for (const [k, drop] of dropEdit.entries()) {
        await chip(w, 0).trigger("click");
        expect(inPicker(w, "step").text()).toContain("/x");
        await drop();
        expect(picker(w).exists()).toBe(false);
        await w.find(`[data-test="${ADD}"]`).trigger("click");
        expect(picker(w).find(`[data-test="${PICKER}-apply"]`).exists()).toBe(false);
        await pickRow(w, "/web/ingestion");
        await applyPicker(w);
        expect(w.emitted("update:def")).toHaveLength(k + 1);
        expect(lastDef(w)!.x).toEqual([
          SPAN_1_2,
          { step: { kind: "p", key: "/web/ingestion" }, a: 1, b: 3 },
        ]);
      }
    });

    it("the chip's remove control removes it and the removed count still renders", async () => {
      const w = mountLayout(defWith([SPAN_1_2, { step: { kind: "p", key: "/y" }, a: 2, b: 3 }]), {
        result: resultOf([100, 60, 30]),
        state: OK,
        removed: [12, null],
      });
      expect(w.find('[data-test="rum-analytics-funnel-exclusion-0-removed"]').text()).toBe(
        "12 removed at step 2",
      );
      expect(w.find('[data-test="rum-analytics-funnel-exclusion-1-removed"]').exists()).toBe(false);
      await chip(w, 0).find("button").trigger("click");
      expect(w.emitted("update:def")).toHaveLength(1);
      expect(lastDef(w)!.x).toEqual([{ step: { kind: "p", key: "/y" }, a: 2, b: 3 }]);
      expect(picker(w).exists()).toBe(false);
    });

    it("a blocked + stays disabled and never opens the popover", async () => {
      const w = mountLayout(defWith([], steps.slice(0, 1)));
      const add = w.find(`[data-test="${ADD}"]`);
      expect(add.attributes("disabled")).toBeDefined();
      await add.trigger("click");
      expect(picker(w).exists()).toBe(false);
      expect(popoverAround(w, ADD)).toBeDefined();
      expect(popoverAround(w, ADD)!.props("open")).toBe(false);
    });

    it("a chip still edits at the exclusion limit, where the + is blocked", async () => {
      const five = Array.from({ length: 5 }, (_, k) => ({
        step: { kind: "p", key: `/p${k}` },
        a: 1,
        b: 3,
      }));
      const w = mountLayout(defWith(five));
      expect(w.find(`[data-test="${ADD}"]`).attributes("disabled")).toBeDefined();
      await chip(w, 4).trigger("click");
      expect(inPicker(w, "step").text()).toContain("/p4");
      await inPicker(w, "back").trigger("click");
      await pickRow(w, "/web/ingestion");
      await applyPicker(w);
      expect(w.emitted("update:def")).toHaveLength(1);
      expect(lastDef(w)!.x).toEqual([
        ...five.slice(0, 4),
        { step: { kind: "p", key: "/web/ingestion" }, a: 1, b: 3 },
      ]);
      expect(picker(w).exists()).toBe(false);
    });

    it("a step list change while the popover is open closes it", async () => {
      const w = mountLayout(defWith([SPAN_1_2]));
      await chip(w, 0).trigger("click");
      expect(picker(w).exists()).toBe(true);
      await w.setProps({ def: defWith([SPAN_1_2], steps.slice(0, 2)) });
      expect(picker(w).exists()).toBe(false);
      expect(popoverAround(w, ADD)?.props("open")).toBe(false);
    });
  });
});
