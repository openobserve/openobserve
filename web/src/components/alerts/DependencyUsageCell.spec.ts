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

import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import DependencyUsageCell from "./DependencyUsageCell.vue";
import DependencyImpactDialog from "./DependencyImpactDialog.vue";
import { useDependencyGraph } from "@/composables/alerts/useDependencyGraph";
import type { DepFocus, DepGraph } from "@/composables/alerts/useDependencyGraph";
import router from "@/test/unit/helpers/router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

const { buildGraph } = useDependencyGraph();

// slack: used by cpu + mem, uses tpl-http. lonely: no alerts (orphan).
const graph: DepGraph = buildGraph(
  [
    { alert_id: "a1", name: "cpu", destinations: ["slack"], enabled: true },
    { alert_id: "a2", name: "mem", destinations: ["slack"], enabled: false },
  ],
  [
    { name: "slack", type: "http", template: "tpl-http" },
    { name: "lonely", type: "email" },
  ],
  [{ name: "tpl-http", type: "http" }],
);

const emptyGraph: DepGraph = buildGraph([], [], []);

const mountCell = (g: DepGraph, focus: DepFocus) =>
  mount(DependencyUsageCell, {
    props: { graph: g, focus },
    global: { provide: { store }, plugins: [i18n, router] },
  });

describe("DependencyUsageCell", () => {
  it("a destination shows only its alert count (downstream), not its template", async () => {
    const wrapper = mountCell(graph, { kind: "destination", name: "slack" });
    await flushPromises();
    expect(wrapper.find('[data-test="used-by-slack-alert"]').text()).toContain("2");
    // Upstream template is not what the destination is "used by".
    expect(wrapper.find('[data-test="used-by-slack-template"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="used-by-slack-destination"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("a template shows its destinations and alerts (downstream)", async () => {
    const wrapper = mountCell(graph, { kind: "template", name: "tpl-http" });
    await flushPromises();
    expect(wrapper.find('[data-test="used-by-tpl-http-destination"]').text()).toContain("1");
    expect(wrapper.find('[data-test="used-by-tpl-http-alert"]').text()).toContain("2");
    wrapper.unmount();
  });

  it("shows the Unused chip for an orphan entity", async () => {
    const wrapper = mountCell(graph, { kind: "destination", name: "lonely" });
    await flushPromises();
    expect(wrapper.find('[data-test="used-by-lonely-unused"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="used-by-lonely-alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows a neutral placeholder before the graph has loaded", async () => {
    const wrapper = mountCell(emptyGraph, { kind: "destination", name: "slack" });
    await flushPromises();
    expect(wrapper.find('[data-test="used-by-slack-unused"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="used-by-slack-alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("opens the impact dialog on click", async () => {
    const wrapper = mountCell(graph, { kind: "destination", name: "slack" });
    await flushPromises();
    expect(wrapper.findComponent(DependencyImpactDialog).props("open")).toBe(false);
    await wrapper.find('[data-test="used-by-slack"]').trigger("click");
    expect(wrapper.findComponent(DependencyImpactDialog).props("open")).toBe(true);
    wrapper.unmount();
  });
});
