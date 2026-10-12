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
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";

const store = createStore({
  state: { selectedOrganization: { identifier: "org1" }, timezone: "UTC", zoConfig: {} },
});
const popoverStub = {
  data: () => ({ shown: false }),
  template:
    '<div><div @click="shown = true"><slot name="trigger" /></div><slot v-if="shown" /></div>',
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
          VueDraggableNext: { template: "<div><slot /></div>" },
          OPopover: popoverStub,
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
    expect(w.find('[data-test="rum-analytics-funnel-rail-step-1"]').text()).toContain(
      "No conditions",
    );
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

  it("clicking a page step opens the shared condition popover and emits update:def", async () => {
    const w = mountRail();
    await w.find('[data-test="rum-analytics-funnel-rail-step-0"]').trigger("click");
    const popover = w.find('[data-test="rum-analytics-funnel-step-0-filters-popover"]');
    expect(popover.text()).toMatch(/time on page/i);
    popover.findAllComponents({ name: "OCheckbox" }).at(0)!.vm.$emit("update:modelValue", true);
    await w.vm.$nextTick();
    const def = w.emitted("update:def")!.at(-1)![0] as FunnelDef;
    expect(def.steps[0].f).toEqual({ frustrated: true, errored: true });
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
