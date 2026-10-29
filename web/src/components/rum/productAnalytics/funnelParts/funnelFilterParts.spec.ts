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
import { mount, type VueWrapper } from "@vue/test-utils";
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastSpy }));

import FunnelFilterBar from "./FunnelFilterBar.vue";
import StepConditionPopover from "./StepConditionPopover.vue";
import WhyEnteredPopover from "./WhyEnteredPopover.vue";
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

describe("FunnelFilterBar", () => {
  const mountBar = (def: FunnelDef = DEF, values: FilterValuesState = COUNTRIES) => {
    wrapper = mount(FunnelFilterBar, {
      props: { def, fields: ["geo_info_country", "usr_email"], values },
      global: { stubs },
      attachTo: document.body,
    });
    return wrapper;
  };
  const builder = (w: VueWrapper) => w.findComponent({ name: "FilterBuilder" });
  const chip = (field: string) => dt(`rum-analytics-funnel-filter-builder-chip-${field}`);

  it("draws Filter all steps in the shared builder with the funnel's rules", () => {
    const w = mountBar();
    expect(w.text()).toContain("Filter all steps");
    expect(builder(w).props("profile")).toBe("rum-funnel");
    expect(builder(w).props("layout")).toBeUndefined();
  });

  it("stacks one rule per line in the rail", async () => {
    const w = mountBar();
    await w.setProps({ stacked: true });
    expect(builder(w).props("layout")).toBe("vertical");
  });

  it("shows a chip per filter, negated ones included", () => {
    const w = mountBar({
      ...DEF,
      f: [
        { field: "geo_info_country", op: "in", values: ["India"] },
        { field: "context_plan", op: "contains", values: ["pro", "max"], not: true },
      ],
    });
    expect(w.find(chip("geo_info_country")).exists()).toBe(true);
    expect(w.find(chip("context_plan")).text()).toContain("pro, max");
  });

  it("removing one chip keeps the other rules exactly as saved, eq and not included", async () => {
    const kept = { field: "usr_email", op: "eq" as const, values: ["a@b.c"], not: true as const };
    const w = mountBar({
      ...DEF,
      f: [{ field: "geo_info_country", op: "in", values: ["India"] }, kept],
    });
    await w
      .find(dt("rum-analytics-funnel-filter-builder-chip-geo_info_country-remove"))
      .trigger("click");
    const [[next]] = w.emitted("update:def") as [FunnelDef][];
    expect(next.f).toEqual([kept]);
    expect(next.f![0]).toBe(kept);
  });

  it("removing the last chip drops the filter list", async () => {
    const w = mountBar({ ...DEF, f: [{ field: "geo_info_country", op: "in", values: ["India"] }] });
    await w
      .find(dt("rum-analytics-funnel-filter-builder-chip-geo_info_country-remove"))
      .trigger("click");
    const [[next]] = w.emitted("update:def") as [FunnelDef][];
    expect(next).not.toHaveProperty("f");
  });

  it("holds back a rule the server would refuse", () => {
    const w = mountBar();
    builder(w).vm.$emit("update:modelValue", [
      { field: "usr_email", op: "regex", values: ["(?=lookahead)"] },
    ]);
    expect(w.emitted("update:def")).toBeUndefined();
    builder(w).vm.$emit("update:modelValue", [
      { field: "usr_email", op: "regex", values: ["^admin@"] },
    ]);
    const [[next]] = w.emitted("update:def") as [FunnelDef][];
    expect(next.f).toEqual([{ field: "usr_email", op: "regex", values: ["^admin@"] }]);
  });

  it("asks the owner for a field's values and answers with the rows it hands down", async () => {
    const w = mountBar(DEF, { field: null, status: "idle", rows: [] });
    const pending = builder(w).props("loadValues")("geo_info_country", "bra");
    expect(w.emitted("filter-values")).toEqual([["geo_info_country"]]);
    await w.setProps({ values: { field: "geo_info_country", status: "loading", rows: [] } });
    await w.setProps({ values: COUNTRIES });
    expect(await pending).toEqual(["Brazil"]);
  });

  it("answers at once from rows already loaded for the field", async () => {
    const w = mountBar();
    expect(await builder(w).props("loadValues")("geo_info_country", "")).toEqual([
      "India",
      "Brazil",
    ]);
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
