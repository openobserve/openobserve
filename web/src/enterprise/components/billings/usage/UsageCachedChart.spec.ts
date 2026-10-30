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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/locales";

vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "PanelSchemaRendererStub",
      emits: ["error", "loading-state-change"],
      setup: () => () => h("div"),
    }),
  };
});

const { default: UsageCachedChart } = await import("./UsageCachedChart.vue");

enableAutoUnmount(afterEach);

describe("UsageCachedChart", () => {
  const mountChart = () =>
    mount(UsageCachedChart, {
      props: {
        panelSchema: {},
        selectedTimeObj: { start_time: new Date(0), end_time: new Date(1) },
      },
      global: { plugins: [i18n] },
    });

  const waiting = '[data-test="billings-usagechart-waiting"]';

  it("says usage is on its way while the org's usage stream does not exist yet", async () => {
    const wrapper = mountChart();
    const renderer = wrapper.findComponent({ name: "PanelSchemaRendererStub" });

    renderer.vm.$emit("error", { message: "Search stream not found: usage", code: 404 });
    await flushPromises();
    expect(wrapper.find(waiting).text()).toContain("Waiting for usage data");

    // The renderer clears its error once the first usage lands.
    renderer.vm.$emit("error", { message: "", code: "" });
    await flushPromises();
    expect(wrapper.find(waiting).exists()).toBe(false);
  });

  it("leaves any other error to the renderer", async () => {
    const wrapper = mountChart();
    wrapper
      .findComponent({ name: "PanelSchemaRendererStub" })
      .vm.$emit("error", { message: "Query timed out", code: 500 });
    await flushPromises();
    expect(wrapper.find(waiting).exists()).toBe(false);
  });
});
