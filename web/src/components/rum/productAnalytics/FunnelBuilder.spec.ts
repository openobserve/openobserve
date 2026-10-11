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
import FunnelBuilder from "./FunnelBuilder.vue";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";

const store = createStore({
  state: { selectedOrganization: { identifier: "org1" }, timezone: "UTC", zoConfig: {} },
});
// Content renders only after its trigger is clicked, so a test must open one step's options to see them.
const popoverStub = {
  data: () => ({ shown: false }),
  template:
    '<div><div @click="shown = true"><slot name="trigger" /></div><slot v-if="shown" /></div>',
};

const IDLE = { status: "idle", rows: [], error: null } as never;
const steps = [
  { kind: "p", key: "/web" },
  { kind: "p", key: "/web/logs" },
  { kind: "p", key: "/web/billings" },
];
const defWith = (x: unknown[]): FunnelDef =>
  ({ steps, unit: "sessions", window: "session", breakdown: null, x }) as unknown as FunnelDef;

describe("pa gap fixes: FunnelBuilder exclusions and step filters", () => {
  let wrapper: VueWrapper | null = null;

  const mountBuilder = (def: FunnelDef) => {
    wrapper = mount(FunnelBuilder, {
      props: {
        def,
        result: null,
        suggestions: [],
        suggestionsState: IDLE,
        state: IDLE,
        sampled: 1 as never,
        events: [],
        eventsStatus: "ready",
        unitLabel: "Sessions" as never,
        unitNoun: "sessions" as never,
        hideTime: false,
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

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("P7-R12: offers Add exclusion", () => {
    const w = mountBuilder(defWith([]));
    expect(w.findAll("button").some((b) => b.text().includes("Add exclusion"))).toBe(true);
  });

  it("P7-R12: shows a between-steps exclusion row naming its excluded page", () => {
    const w = mountBuilder(defWith([{ step: { kind: "p", key: "/web/ingestion" }, a: 2, b: 3 }]));
    expect(w.text()).toContain("/web/ingestion");
    expect(w.text()).toContain("between step 2 and step 3");
  });

  it("P7-R12: Add exclusion emits a def with one exclusion row holding a and exactly one of b or withinMs", async () => {
    const w = mountBuilder(defWith([]));
    const add = w.findAll("button").find((b) => b.text().includes("Add exclusion"));
    expect(add).toBeDefined();
    await add!.trigger("click");
    // The row may ask for its excluded step first, through a picker other than the add-step one.
    if (!w.emitted("update:def")) {
      const picker = w
        .findAllComponents({ name: "StepPicker" })
        .filter((c) => c.attributes("data-test") !== "rum-analytics-funnel-add-step-select")
        .at(-1);
      picker?.vm.$emit("update:modelValue", { kind: "p", key: "/web/ingestion" });
      await w.vm.$nextTick();
    }
    const def = w.emitted("update:def")!.at(-1)![0] as {
      x: { a: unknown; b?: unknown; withinMs?: unknown }[];
    };
    expect(def.x).toHaveLength(1);
    const [row] = def.x;
    expect(typeof row.a).toBe("number");
    expect([row.b, row.withinMs].filter((v) => typeof v === "number")).toHaveLength(1);
  });

  it("P7-R12: shows a within-N-seconds exclusion row with its page and its seconds", () => {
    const w = mountBuilder(
      defWith([{ step: { kind: "p", key: "/web/ingestion" }, a: 2, withinMs: 5000 }]),
    );
    expect(w.text()).toContain("/web/ingestion");
    expect(w.text()).toMatch(/\b5\s?s\b/);
  });

  it("P7-R12: a page step's options offer time on page, frustrated and errored; a click step has none", async () => {
    const w = mountBuilder({
      steps: [
        { kind: "p", key: "/web" },
        { kind: "c", key: "save-btn" },
      ],
      unit: "sessions",
      window: "session",
      breakdown: null,
    } as FunnelDef);
    const fixed = /-(move-up|move-down|remove)$/;
    const openOptions = async (i: number) => {
      const row = w.find(`[data-test="rum-analytics-funnel-step-${i}"]`);
      for (const b of row.findAll("button")) {
        if (!fixed.test(b.attributes("data-test") ?? "")) await b.trigger("click");
      }
      return w.find(`[data-test="rum-analytics-funnel-step-${i}"]`);
    };
    const page = (await openOptions(0)).text();
    expect(page).toMatch(/time on page/i);
    expect(page).toMatch(/frustrat/i);
    expect(page).toMatch(/error/i);
    const click = (await openOptions(1)).text();
    expect(click).not.toMatch(/time on page/i);
  });

  it("P7-R12: choosing the frustrated filter on a page step emits a def whose step carries it", async () => {
    const w = mountBuilder({
      steps: [
        { kind: "p", key: "/web" },
        { kind: "p", key: "/web/logs" },
      ],
      unit: "sessions",
      window: "session",
      breakdown: null,
    } as FunnelDef);
    const fixed = /-(move-up|move-down|remove)$/;
    const rowOf = () => w.find('[data-test="rum-analytics-funnel-step-0"]');
    for (const b of rowOf().findAll("button")) {
      if (!fixed.test(b.attributes("data-test") ?? "")) await b.trigger("click");
    }
    const leaf = rowOf()
      .findAll("*")
      .filter((e) => /frustrat/i.test(e.text()))
      .find((e) => !e.findAll("*").some((c) => /frustrat/i.test(c.text())));
    expect(leaf).toBeDefined();
    const control =
      leaf!.element.closest('label, button, [role="switch"], [role="checkbox"]') ??
      leaf!.element.parentElement?.querySelector(
        'input, button, [role="switch"], [role="checkbox"]',
      );
    expect(control).toBeTruthy();
    (control as HTMLElement).click();
    await w.vm.$nextTick();
    const def = w.emitted("update:def")!.at(-1)![0] as {
      steps: { key: string; f?: { frustrated?: unknown } }[];
    };
    expect(def.steps[0].f?.frustrated).toBe(true);
    expect(def.steps[1].f?.frustrated).toBeUndefined();
  });
});
