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

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastSpy }));

import SessionFieldPicker from "./SessionFieldPicker.vue";
import FunnelFilterBar from "./FunnelFilterBar.vue";
import StepConditionPopover from "./StepConditionPopover.vue";
import FunnelStepsTable from "./FunnelStepsTable.vue";
import { filterNoticeOf, type PickerGroup } from "./funnelFilters";
import WhyEnteredPopover from "./WhyEnteredPopover.vue";
import useStepLabels from "./useStepLabels";
import { whyLines } from "./whyEntered";
import type { FilterValuesState } from "./funnelFilters";
import type { FunnelDef, StepRef } from "@/utils/rum/productAnalyticsQueries";

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
const stubs = { OPopover: popoverStub };
const dt = (id: string) => `[data-test="${id}"]`;
const COUNTRIES: FilterValuesState = {
  field: "geo_info_country",
  status: "ok",
  rows: [
    { value: "India", sessions: 212 },
    { value: "Brazil", sessions: 31 },
  ],
};
const DEF: FunnelDef = {
  steps: [
    { kind: "p", key: "/a" },
    { kind: "p", key: "/b" },
  ],
  unit: "sessions",
  window: "session",
  breakdown: null,
};

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("SessionFieldPicker", () => {
  const mountPicker = (props: Record<string, unknown> = {}) => {
    wrapper = mount(SessionFieldPicker, {
      props: {
        fields: ["geo_info_country", "usr_email", "resource_url"],
        values: { field: null, status: "idle", rows: [] },
        ...props,
      },
      attachTo: document.body,
    });
    return wrapper;
  };
  const field = (w: VueWrapper, name: string) =>
    w.find(dt(`rum-analytics-funnel-field-picker-field-${name}`));
  const typeValue = async (w: VueWrapper, value: string) => {
    const input = w.find(`${dt("rum-analytics-funnel-field-picker-typed")} input`);
    await input.setValue(value);
    await input.trigger("keydown", { key: "Enter" });
  };
  const country = { field: "geo_info_country", op: "in", values: [] };

  it("lists every stream field in the Logs field list, built-in names readable, and picking one asks for its values", async () => {
    const w = mountPicker();
    expect(field(w, "geo_info_country").text()).toBe("Country");
    expect(field(w, "resource_url").text()).toBe("resource_url");
    await field(w, "geo_info_country").trigger("click");
    expect(w.emitted("load")).toEqual([["geo_info_country"]]);
    expect(w.find(dt("rum-analytics-funnel-field-picker-condition")).text()).toContain("is one of");
  });

  it("the field search matches readable names too, narrows the list and says when nothing matches", async () => {
    const w = mountPicker();
    expect(w.text()).toMatch(/key fields/i);
    const search = w.find(`${dt("o-field-list-search")} input`);
    await search.setValue("resource");
    expect(field(w, "resource_url").exists()).toBe(true);
    expect(field(w, "usr_email").exists()).toBe(false);
    await search.setValue("user email");
    expect(field(w, "usr_email").exists()).toBe(true);
    await field(w, "usr_email").trigger("click");
    expect(w.emitted("load")).toEqual([["usr_email"]]);
    await w.find(dt("rum-analytics-funnel-field-picker-back")).trigger("click");
    // The list remounts after Back, with the search cleared.
    expect(field(w, "resource_url").exists()).toBe(true);
    await w.find(`${dt("o-field-list-search")} input`).setValue("nothing-like-it");
    expect(w.find(dt("rum-analytics-funnel-field-picker-no-field")).exists()).toBe(true);
  });

  it("shows values with session counts, none ticked, and Apply stays disabled until one is", async () => {
    const w = mountPicker({ values: COUNTRIES, initial: country });
    const row0 = w.find(dt("rum-analytics-funnel-field-picker-value-0"));
    expect(row0.text()).toContain("India");
    expect(row0.text()).toContain("212");
    expect(
      w.findAll('[role="checkbox"][data-state="checked"], input[type="checkbox"]:checked'),
    ).toHaveLength(0);
    const apply = () => w.find(dt("rum-analytics-funnel-field-picker-apply"));
    expect(apply().attributes("disabled")).toBeDefined();
    await row0.find('[role="checkbox"], input[type="checkbox"]').trigger("click");
    expect(apply().attributes("disabled")).toBeUndefined();
    expect(w.find(dt("rum-analytics-funnel-field-picker-count")).text()).toBe("1 selected");
    await apply().trigger("click");
    expect(w.emitted("apply")).toEqual([
      [{ field: "geo_info_country", op: "in", values: ["India"] }],
    ]);
  });

  it("the value search filters the list, and Enter adds a value no row carries", async () => {
    const w = mountPicker({ values: COUNTRIES, initial: country });
    await w.find(`${dt("rum-analytics-funnel-field-picker-typed")} input`).setValue("bra");
    expect(w.find(dt("rum-analytics-funnel-field-picker-value-0")).text()).toContain("Brazil");
    expect(w.find(dt("rum-analytics-funnel-field-picker-value-1")).exists()).toBe(false);
    await typeValue(w, "Peru");
    expect(w.find(dt("rum-analytics-funnel-field-picker-value-0")).text()).toContain("Peru");
    expect(w.find(dt("rum-analytics-funnel-field-picker-count")).text()).toBe("1 selected");
    await w.find(dt("rum-analytics-funnel-field-picker-clear")).trigger("click");
    expect(w.find(dt("rum-analytics-funnel-field-picker-count")).text()).toBe("0 selected");
  });

  it("never offers another field's values", () => {
    const w = mountPicker({
      values: COUNTRIES,
      initial: { field: "usr_email", op: "in", values: [] },
    });
    expect(w.find(dt("rum-analytics-funnel-field-picker-value-0")).exists()).toBe(false);
  });

  it("a negated condition applies the picked values with not", async () => {
    const w = mountPicker({ values: COUNTRIES, initial: country });
    w.findComponent({ name: "OSelect" }).vm.$emit("update:modelValue", "notContains");
    await w.vm.$nextTick();
    await typeValue(w, "Ind");
    await w.find(dt("rum-analytics-funnel-field-picker-apply")).trigger("click");
    expect(w.emitted("apply")).toEqual([
      [{ field: "geo_info_country", op: "contains", values: ["Ind"], not: true }],
    ]);
  });

  it("an edited filter opens on its own condition and values", () => {
    const w = mountPicker({
      initial: { field: "usr_email", op: "suffix", values: ["@qa.io"], not: true },
      lockField: true,
    });
    expect(w.findComponent({ name: "OSelect" }).props("modelValue")).toBe("notSuffix");
    const row0 = w.find(dt("rum-analytics-funnel-field-picker-value-0"));
    expect(row0.text()).toContain("@qa.io");
    expect(row0.find('[role="checkbox"][data-state="checked"], input:checked').exists()).toBe(true);
    expect(w.find(dt("rum-analytics-funnel-field-picker-back")).exists()).toBe(false);
  });

  it("offers Retry when the values fail", async () => {
    const w = mountPicker({
      values: { field: "geo_info_country", status: "error", rows: [] },
      initial: country,
    });
    await w.find(dt("rum-analytics-funnel-field-picker-retry")).trigger("click");
    expect(w.emitted("load")?.at(-1)).toEqual(["geo_info_country"]);
  });
});

describe("FunnelFilterBar", () => {
  const mountBar = (def: FunnelDef = DEF) => {
    wrapper = mount(FunnelFilterBar, {
      props: { def, fields: ["geo_info_country", "usr_email"], values: COUNTRIES },
      global: { stubs },
      attachTo: document.body,
    });
    return wrapper;
  };

  it("marks the add button active while its popover is open, and opens the rail's beside it", async () => {
    const w = mountBar();
    const btn = () => w.findComponent({ name: "OButton" });
    expect(btn().props("active")).toBe(false);
    expect(w.findComponent(popoverStub).attributes("side")).toBe("bottom");
    await w.find(dt("rum-analytics-funnel-add-filter-btn")).trigger("click");
    expect(btn().props("active")).toBe(true);
    w.findComponent(popoverStub).vm.$emit("update:open", false);
    await w.vm.$nextTick();
    expect(btn().props("active")).toBe(false);
    await w.setProps({ stacked: true });
    expect(w.findComponent(popoverStub).attributes("side")).toBe("right");
  });

  it("adds a filter through the picker", async () => {
    const w = mountBar();
    expect(w.text()).toContain("Filter all steps");
    await w.find(dt("rum-analytics-funnel-add-filter-btn")).trigger("click");
    await w.find(dt("rum-analytics-funnel-field-picker-field-geo_info_country")).trigger("click");
    expect(w.emitted("filter-values")).toEqual([["geo_info_country"]]);
    await w
      .find(dt("rum-analytics-funnel-field-picker-value-1"))
      .find('[role="checkbox"], input[type="checkbox"]')
      .trigger("click");
    await w.find(dt("rum-analytics-funnel-field-picker-apply")).trigger("click");
    const [[next]] = w.emitted("update:def") as [FunnelDef][];
    expect(next.f).toEqual([{ field: "geo_info_country", op: "in", values: ["Brazil"] }]);
  });

  it("a refused edit says why and keeps the picker open with nothing applied", async () => {
    toastSpy.mockClear();
    const w = mountBar();
    await w.find(dt("rum-analytics-funnel-add-filter-btn")).trigger("click");
    await w.find(dt("rum-analytics-funnel-field-picker-field-usr_email")).trigger("click");
    const typed = w.find(`${dt("rum-analytics-funnel-field-picker-typed")} input`);
    await typed.setValue("a".repeat(1025));
    await typed.trigger("keydown", { key: "Enter" });
    await w.find(dt("rum-analytics-funnel-field-picker-apply")).trigger("click");
    expect(w.emitted("update:def")).toBeUndefined();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("cannot be used as a filter") }),
    );
    expect(w.find(dt("rum-analytics-funnel-field-picker-apply")).exists()).toBe(true);
  });

  it("reads as where / and rows, one chip per filter", () => {
    const w = mountBar({
      ...DEF,
      f: [
        { field: "geo_info_country", op: "in", values: ["India"] },
        { field: "resource_url", op: "contains", values: ["/api"] },
      ],
    });
    const text = w.find(dt("rum-analytics-funnel-filter-all")).text();
    expect(text).toMatch(/where\s*Country is one of India\s*and\s*resource_url contains \/api/);
    const chip = w.find(dt("rum-analytics-funnel-filter-resource_url"));
    expect(chip.classes()).toContain("max-w-full");
    expect(chip.find("span.truncate").exists()).toBe(true);
  });

  it("shows a chip per filter that removes it", async () => {
    const w = mountBar({ ...DEF, f: [{ field: "geo_info_country", op: "in", values: ["India"] }] });
    const chip = w.find(dt("rum-analytics-funnel-filter-geo_info_country"));
    expect(chip.text()).toContain("Country is one of India");
    await chip.find("button").trigger("click");
    const [[next]] = w.emitted("update:def") as [FunnelDef][];
    expect(next).not.toHaveProperty("f");
  });

  it("a chip names the attribute and its condition, negation included", () => {
    const w = mountBar({
      ...DEF,
      f: [{ field: "context_plan", op: "contains", values: ["pro", "max"], not: true }],
    });
    expect(w.find(dt("rum-analytics-funnel-filter-context_plan")).text()).toContain(
      "context_plan does not contain pro, max",
    );
  });
});

describe("StepConditionPopover, Only when", () => {
  const mountPopover = (step: StepRef = { kind: "p", key: "/a" }) => {
    wrapper = mount(StepConditionPopover, {
      props: { step, index: 0 },
      global: { stubs },
      attachTo: document.body,
    });
    return wrapper;
  };
  const open = async (w: VueWrapper) =>
    w.find(dt("rum-analytics-funnel-step-0-filters")).trigger("click");

  it("starts empty, and a complete row applies a URL parameter condition", async () => {
    const w = mountPopover();
    await open(w);
    expect(w.find(dt("rum-analytics-funnel-step-0-only-when")).text()).toContain("Only when");
    expect(w.find(dt("rum-analytics-funnel-step-0-cond-0")).exists()).toBe(false);
    await w.find(dt("rum-analytics-funnel-step-0-cond-add")).trigger("click");
    expect(w.find(dt("rum-analytics-funnel-step-0-cond-0")).exists()).toBe(true);
    await w.find(`${dt("rum-analytics-funnel-step-0-cond-0-key")} input`).setValue("utm_source");
    expect(w.emitted("update")).toBeUndefined();
    await w.find(`${dt("rum-analytics-funnel-step-0-cond-0-values")} input`).setValue("ads");
    const [[step]] = w.emitted("update") as [StepRef][];
    expect(step.f?.vc).toEqual([{ t: "param", key: "utm_source", op: "eq", values: ["ads"] }]);
  });

  it("a row's × removes its condition", async () => {
    const c = { t: "ref" as const, op: "eq" as const, values: ["google.com"] };
    const w = mountPopover({ kind: "p", key: "/a", f: { errored: true, vc: [c] } });
    await open(w);
    await w.find(dt("rum-analytics-funnel-step-0-cond-0-remove")).trigger("click");
    const [[step]] = w.emitted("update") as [StepRef][];
    expect(step).toEqual({ kind: "p", key: "/a", f: { errored: true } });
  });

  it("refuses a credential parameter with a reason and applies nothing", async () => {
    const w = mountPopover();
    await open(w);
    await w.find(dt("rum-analytics-funnel-step-0-cond-add")).trigger("click");
    await w.find(`${dt("rum-analytics-funnel-step-0-cond-0-key")} input`).setValue("token");
    await w.find(`${dt("rum-analytics-funnel-step-0-cond-0-values")} input`).setValue("x");
    expect(w.emitted("update")).toBeUndefined();
    expect(w.text()).toContain("cannot select on the token parameter");
  });

  it("other step filters keep the conditions", async () => {
    const c = { t: "ref" as const, op: "eq" as const, values: ["a.io"] };
    const w = mountPopover({ kind: "p", key: "/a", f: { vc: [c] } });
    await open(w);
    await w
      .find(dt("rum-analytics-funnel-step-0-filter-errored"))
      .find('[role="checkbox"], input[type="checkbox"]')
      .trigger("click");
    const [[step]] = w.emitted("update") as [StepRef][];
    expect(step.f).toEqual({ errored: true, vc: [c] });
  });

  it("other step filters keep a property condition from a link", async () => {
    const pc = [{ field: "context_payment_method", op: "in" as const, values: ["upi"] }];
    const w = mountPopover({ kind: "p", key: "/a", f: { pc } });
    await open(w);
    await w
      .find(dt("rum-analytics-funnel-step-0-filter-errored"))
      .find('[role="checkbox"], input[type="checkbox"]')
      .trigger("click");
    const [[step]] = w.emitted("update") as [StepRef][];
    expect(step.f).toEqual({ errored: true, pc });
  });
});

describe("useStepLabels, property conditions", () => {
  it("names each property condition on the step", () => {
    let chips: string[] = [];
    const Probe = defineComponent({
      setup() {
        const { filterChips } = useStepLabels(() => []);
        chips = filterChips({
          kind: "c",
          key: "payment_info_submitted",
          f: {
            pc: [
              { field: "context_payment_method", op: "in", values: ["upi", "card"] },
              { field: "context_plan", op: "contains", values: ["pro"], not: true },
            ],
          },
        }).map(String);
        return () => h("div");
      },
    });
    wrapper = mount(Probe);
    expect(chips).toEqual([
      "context_payment_method is upi, card",
      "context_plan does not contain pro",
    ]);
  });
});

describe("WhyEnteredPopover", () => {
  const LINES = whyLines({
    total: 1195,
    synthetic: 20,
    builtinKept: 471,
    kept: 433,
    opened: 423,
    inFilter: 212,
    entered: 212,
    removed: [4],
    atStep1: [false],
    hasFilters: true,
  });
  const mountWhy = (props: Record<string, unknown> = {}) => {
    wrapper = mount(WhyEnteredPopover, {
      props: {
        count: 212,
        app: "shop-web",
        step1: "/",
        state: "ok",
        lines: LINES,
        estimated: false,
        ...props,
      },
      global: { stubs },
      attachTo: document.body,
    });
    return wrapper;
  };

  it("asks for its counts only when opened", async () => {
    const w = mountWhy();
    expect(w.emitted("open")).toBeUndefined();
    expect(w.find(dt("rum-analytics-funnel-why-btn")).text()).toBe("Why 212?");
    await w.find(dt("rum-analytics-funnel-why-btn")).trigger("click");
    expect(w.emitted("open")).toEqual([[true]]);
  });

  it("lists each line with its count in SQL order", async () => {
    const w = mountWhy();
    await w.find(dt("rum-analytics-funnel-why-btn")).trigger("click");
    const row = (id: string) => w.find(dt(`rum-analytics-funnel-why-${id}`)).text();
    expect(row("app")).toBe("Sessions in shop-web1,215");
    expect(row("synthetic")).toContain("−20");
    expect(row("bots")).toContain("−724");
    expect(row("appFilters")).toContain("−38");
    expect(row("step1")).toBe("Did not open step 1 (/)−10");
    expect(row("filters")).toContain("−211");
    expect(row("entered")).toBe("Entered212");
    expect(row("excluded")).toBe("Later removed by exclusion steps4");
    expect(w.find(dt("rum-analytics-funnel-why-estimated")).exists()).toBe(false);
  });

  it("labels the numbers estimated on a sampled funnel, and offers Retry on failure", async () => {
    const w = mountWhy({ estimated: true });
    await w.find(dt("rum-analytics-funnel-why-btn")).trigger("click");
    expect(w.find(dt("rum-analytics-funnel-why-estimated")).text()).toContain("Estimated");
    await w.setProps({ state: "error", lines: null });
    await w.find(dt("rum-analytics-funnel-why-retry")).trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
  });
});

describe("SessionFieldPicker with fixed bands", () => {
  const GROUPS = [
    {
      id: "steps",
      label: "On these steps" as never,
      fields: [
        {
          id: "field-context_payment_method",
          name: "context_payment_method",
          hint: "Step 5 · card" as never,
        },
      ],
    },
    { id: "key", label: "Key fields" as never, fields: [{ id: "dim-browser", name: "Browser" }] },
    {
      id: "user",
      label: "User" as never,
      fields: [{ id: "field-usr_id", name: "usr_id", reason: "For filters only" as never }],
    },
    { id: "empty", label: "Nothing" as never, fields: [] },
  ] as PickerGroup[];
  const mountBands = () => {
    wrapper = mount(SessionFieldPicker, {
      props: { fields: [], values: { field: null, status: "idle", rows: [] }, groups: GROUPS },
      attachTo: document.body,
    });
    return wrapper;
  };
  const row = (w: VueWrapper, id: string) => w.find(dt(`rum-analytics-funnel-field-picker-${id}`));

  it("lists each band with its count, skips an empty one, and shows a field's step hint", () => {
    const w = mountBands();
    expect(w.text()).toContain("On these steps (1)");
    expect(w.text()).toContain("Key fields (1)");
    expect(w.text()).toContain("User (1)");
    expect(w.text()).not.toContain("Nothing");
    expect(row(w, "field-context_payment_method").text()).toContain("Step 5 · card");
  });

  it("search narrows the bands to matching fields", async () => {
    const w = mountBands();
    await w.find(`${dt("o-field-list-search")} input`).setValue("pay");
    expect(row(w, "field-context_payment_method").exists()).toBe(true);
    expect(row(w, "dim-browser").exists()).toBe(false);
  });

  it("a row click picks its id; a disabled row picks nothing", async () => {
    const w = mountBands();
    await row(w, "field-usr_id").trigger("click");
    expect(w.emitted("pick")).toBeUndefined();
    await row(w, "field-context_payment_method").trigger("click");
    await row(w, "dim-browser").trigger("click");
    expect(w.emitted("pick")).toEqual([["field-context_payment_method"], ["dim-browser"]]);
    expect(w.emitted("load")).toBeUndefined();
  });
});

describe("StepConditionPopover, Property", () => {
  const PAY = "context_payment_method";
  const VALUES: FilterValuesState = {
    field: PAY,
    status: "ok",
    rows: [
      { value: "upi", sessions: 8 },
      { value: "card", sessions: 17 },
    ],
  };
  const mountClick = (step: StepRef = { kind: "c", key: "payment_info_submitted" }) => {
    wrapper = mount(StepConditionPopover, {
      props: { step, index: 4, fields: [PAY], fieldsState: "ok", values: VALUES },
      global: { stubs },
      attachTo: document.body,
    });
    return wrapper;
  };
  const select = (w: VueWrapper, id: string) =>
    w.findAllComponents({ name: "OSelect" }).find((c) => c.attributes("data-test") === id)!;
  const lastStep = (w: VueWrapper) => (w.emitted("update") as [StepRef][]).at(-1)![0];

  it("a click step offers only the Property row, and picking a field then a value writes pc at once", async () => {
    const w = mountClick();
    await w.find(dt("rum-analytics-funnel-step-4-filters")).trigger("click");
    expect(w.emitted("load-fields")).toHaveLength(1);
    expect(w.find(dt("rum-analytics-funnel-step-4-filter-min")).exists()).toBe(false);
    expect(w.find(dt("rum-analytics-funnel-step-4-property")).text()).toContain("Property");
    select(w, "rum-analytics-funnel-step-4-prop-0-field").vm.$emit("update:modelValue", PAY);
    await w.vm.$nextTick();
    expect(w.emitted("update")).toBeUndefined();
    select(w, "rum-analytics-funnel-step-4-prop-0-add-value").vm.$emit("open");
    expect(w.emitted("filter-values")).toEqual([[PAY]]);
    select(w, "rum-analytics-funnel-step-4-prop-0-add-value").vm.$emit("update:modelValue", "upi");
    await w.vm.$nextTick();
    expect(lastStep(w)).toEqual({
      kind: "c",
      key: "payment_info_submitted",
      f: { pc: [{ field: PAY, op: "in", values: ["upi"] }] },
    });
    expect(w.find(dt("rum-analytics-funnel-step-4-prop-0-value-upi")).text()).toBe("upi · 8");
  });

  it("is not and matches rewrite the rule, and removing its last value drops pc", async () => {
    const w = mountClick({
      kind: "c",
      key: "payment_info_submitted",
      f: { pc: [{ field: PAY, op: "in", values: ["upi"] }] },
    });
    await w.find(dt("rum-analytics-funnel-step-4-filters")).trigger("click");
    select(w, "rum-analytics-funnel-step-4-prop-0-op").vm.$emit("update:modelValue", "notIn");
    await w.vm.$nextTick();
    expect(lastStep(w).f?.pc).toEqual([{ field: PAY, op: "in", values: ["upi"], not: true }]);
    select(w, "rum-analytics-funnel-step-4-prop-0-op").vm.$emit("update:modelValue", "regex");
    await w.vm.$nextTick();
    expect(lastStep(w).f?.pc).toEqual([{ field: PAY, op: "regex", values: ["upi"] }]);
    await w.find(`${dt("rum-analytics-funnel-step-4-prop-0-value-upi")} button`).trigger("click");
    await w.vm.$nextTick();
    expect(lastStep(w)).toEqual({ kind: "c", key: "payment_info_submitted" });
  });

  it("keeps a linked negated contains rule as it is while another row is edited", async () => {
    const plan = {
      field: "context_plan",
      op: "contains" as const,
      values: ["pro"],
      not: true as const,
    };
    const w = mountClick({ kind: "c", key: "payment_info_submitted", f: { pc: [plan] } });
    await w.find(dt("rum-analytics-funnel-step-4-filters")).trigger("click");
    const op = select(w, "rum-analytics-funnel-step-4-prop-0-op");
    const ops = op.props("options") as { value: string }[];
    expect(ops.map((o) => o.value)).toEqual(["in", "notIn", "contains", "notContains", "regex"]);
    expect(op.props("modelValue")).toBe("notContains");
    await w.find(dt("rum-analytics-funnel-step-4-prop-add")).trigger("click");
    select(w, "rum-analytics-funnel-step-4-prop-1-field").vm.$emit("update:modelValue", PAY);
    await w.vm.$nextTick();
    select(w, "rum-analytics-funnel-step-4-prop-1-add-value").vm.$emit("update:modelValue", "upi");
    await w.vm.$nextTick();
    expect(lastStep(w).f?.pc).toEqual([plan, { field: PAY, op: "in", values: ["upi"] }]);
  });

  it("a step whose property rule is removed elsewhere goes back to one blank row", async () => {
    const w = mountClick({
      kind: "c",
      key: "payment_info_submitted",
      f: { pc: [{ field: PAY, op: "in", values: ["upi"] }] },
    });
    await w.find(dt("rum-analytics-funnel-step-4-filters")).trigger("click");
    await w.setProps({ step: { kind: "c", key: "payment_info_submitted" } });
    expect(w.find(dt("rum-analytics-funnel-step-4-prop-0")).exists()).toBe(true);
    expect(w.find(dt("rum-analytics-funnel-step-4-prop-1")).exists()).toBe(false);
    expect(select(w, "rum-analytics-funnel-step-4-prop-0-field").props("modelValue")).toBeNull();
  });

  it("says when the sample saw no field on this step", async () => {
    wrapper = mount(StepConditionPopover, {
      props: { step: { kind: "c", key: "x" }, index: 0, fields: [], fieldsState: "ok" },
      global: { stubs },
      attachTo: document.body,
    });
    await wrapper.find(dt("rum-analytics-funnel-step-0-filters")).trigger("click");
    expect(wrapper.find(dt("rum-analytics-funnel-step-0-prop-fields-note")).text()).toBe(
      "No fields seen on this step",
    );
  });
});

describe("FunnelStepsTable step menu", () => {
  const PAY = "context_payment_method";
  const def: FunnelDef = {
    steps: [
      { kind: "c", key: "product_viewed" },
      { kind: "c", key: "payment_info_submitted" },
    ],
    unit: "sessions",
    window: "session",
    breakdown: null,
  };
  const mountTable = (state: "ok" | "loading") => {
    wrapper = mount(FunnelStepsTable, {
      props: {
        def,
        result: null,
        removedAt: [],
        state: { status: "idle", rows: [], error: null, partial: null, key: null, sampled: 1 },
        sampled: 1,
        events: [],
        eventsStatus: "ready",
        unitLabel: "Sessions" as never,
        unitNoun: "sessions" as never,
        hideTime: true,
        fieldSample: {
          fields: [{ field: PAY, steps: [2], top: ["card", "upi"], more: 0, many: false }],
        },
        fieldSampleState: state,
      },
      global: {
        stubs: {
          ...stubs,
          VueDraggableNext: { template: "<div><slot /></div>" },
          ODropdown: {
            emits: ["update:open"],
            template: `<div><div @click="$emit('update:open', true)"><slot name="trigger" /></div><slot /></div>`,
          },
          ODropdownSub: { template: '<div><slot name="trigger" /><slot /></div>' },
          ODropdownItem: {
            props: ["disabled"],
            emits: ["select"],
            template: '<button :disabled="disabled" @click="$emit(\'select\')"><slot /></button>',
          },
        },
      },
      attachTo: document.body,
    });
    return wrapper;
  };

  it("its entry asks the page to open the picker for that step, after loading the fields", async () => {
    const w = mountTable("ok");
    await w.find(dt("rum-analytics-funnel-step-1-menu")).trigger("click");
    expect(w.emitted("load-fields")).toHaveLength(1);
    expect(w.find(dt("rum-analytics-funnel-step-1-break-down")).text()).toBe(
      "Break down by a property of this step",
    );
    await w.find(dt("rum-analytics-funnel-step-1-break-down")).trigger("click");
    expect(w.emitted("break-down-step")).toEqual([[2]]);
  });

  it("offers Show conversion trend from this step on every step but the last, and asks for that step's trend", async () => {
    const w = mountTable("ok");
    const item = w.find(dt("rum-analytics-funnel-step-0-trend-from"));
    expect(item.text()).toBe("Show conversion trend from this step");
    expect(w.find(dt("rum-analytics-funnel-step-1-trend-from")).exists()).toBe(false);
    await item.trigger("click");
    expect(w.emitted("trend-from-step")).toEqual([[1]]);
  });

  it("pins each row's actions cell to the end on wide screens, so ⋮ stays in view when the table scrolls", () => {
    const w = mountTable("ok");
    for (const i of [0, 1]) {
      const row = w.find(dt(`rum-analytics-funnel-step-${i}`)).element;
      let cell = w.find(dt(`rum-analytics-funnel-step-${i}-menu`)).element as HTMLElement;
      while (cell.parentElement && cell.parentElement !== row) cell = cell.parentElement;
      expect(cell.parentElement).toBe(row);
      const classes = [...cell.classList];
      expect(classes).toContain("md:sticky");
      expect(classes.some((c) => /^(md:)?end-0$/.test(c))).toBe(true);
      expect(classes.some((c) => /^(md:)?bg-/.test(c))).toBe(true);
    }
  });
});

describe("Filter all steps notice", () => {
  const PAY = "context_payment_method";
  const def = (f: FunnelDef["f"]): FunnelDef => ({ ...DEF, f });
  const UPI = { field: PAY, op: "in" as const, values: ["upi"] };

  it("flags an attribute filter fewer than half of step 1's sessions carry", () => {
    const row = { opened: 84, kept: 8, carry1: 41 };
    expect(filterNoticeOf(def([UPI]), row)).toEqual({ field: PAY, kept: 8, opened: 84, carry: 41 });
    expect(filterNoticeOf(def([UPI]), { ...row, carry1: 42 })).toBeNull();
  });

  it("indexes carry counts over session filters only, and never flags a built-in field", () => {
    const country = { field: "geo_info_country", op: "in" as const, values: ["IN"] };
    const email = { field: "usr_email", op: "in" as const, values: ["a@b.c"] };
    const row = { opened: 10, kept: 2, carry1: 1, carry2: 2 };
    expect(filterNoticeOf(def([country, email, UPI]), row)).toMatchObject({ field: PAY, carry: 2 });
    expect(filterNoticeOf(def([country]), { opened: 10, kept: 1 })).toBeNull();
    expect(filterNoticeOf(def([UPI]), null)).toBeNull();
    expect(filterNoticeOf(def([UPI]), { opened: 0, kept: 0, carry1: 0 })).toBeNull();
  });

  it("never flags a negated filter, which keeps the sessions that lack the field", () => {
    const row = { opened: 84, kept: 70, carry1: 41 };
    expect(filterNoticeOf(def([{ ...UPI, not: true }]), row)).toBeNull();
  });

  it("shows the kept count with one way out, and the reason behind an info link", async () => {
    wrapper = mount(FunnelFilterBar, {
      props: {
        def: def([UPI]),
        fields: [PAY],
        values: { field: null, status: "idle", rows: [] },
        stacked: true,
        notice: { field: PAY, kept: 8, opened: 84, carry: 36 },
        unitNoun: "sessions" as never,
      },
      global: { stubs },
      attachTo: document.body,
    });
    expect(wrapper.find(dt("rum-analytics-funnel-filter-notice")).text()).toContain(
      "Keeps 8 of 84 sessions.",
    );
    await wrapper.find(dt("rum-analytics-funnel-filter-notice-break-down")).trigger("click");
    expect(wrapper.emitted("break-down")).toEqual([[PAY]]);
    await wrapper.find(dt("rum-analytics-funnel-filter-notice-why")).trigger("click");
    expect(wrapper.find(dt("rum-analytics-funnel-filter-notice-reason")).text()).toContain(
      "48 of the 84 sessions that opened step 1 never set context_payment_method",
    );
  });

  it("the way out reads Break down by, or Replace breakdown with once a breakdown is set", async () => {
    const mountNotice = (breakdown: FunnelDef["breakdown"]) =>
      mount(FunnelFilterBar, {
        props: {
          def: { ...def([UPI]), breakdown },
          fields: [PAY],
          values: { field: null, status: "idle", rows: [] },
          stacked: true,
          notice: { field: PAY, kept: 8, opened: 84, carry: 36 },
          unitNoun: "sessions" as never,
        },
        global: { stubs },
      });
    const action = dt("rum-analytics-funnel-filter-notice-break-down");
    wrapper = mountNotice(null);
    expect(wrapper.find(action).text()).toBe(`Break down by ${PAY}`);
    wrapper.unmount();
    wrapper = mountNotice("browser");
    expect(wrapper.find(action).text()).toBe(`Replace breakdown with ${PAY}`);
    await wrapper.find(action).trigger("click");
    expect(wrapper.emitted("break-down")).toEqual([[PAY]]);
  });

  it("shows no notice without one", () => {
    wrapper = mount(FunnelFilterBar, {
      props: { def: def([UPI]), fields: [PAY], values: { field: null, status: "idle", rows: [] } },
      global: { stubs },
    });
    expect(wrapper.find(dt("rum-analytics-funnel-filter-notice")).exists()).toBe(false);
  });
});
