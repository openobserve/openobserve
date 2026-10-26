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
import { enableAutoUnmount, mount } from "@vue/test-utils";
import i18n from "@/locales";
import K8sClusterHotbar, { type HotbarCluster } from "./K8sClusterHotbar.vue";

enableAutoUnmount(afterEach);

const clusters: HotbarCluster[] = [
  { name: "prod-east", code: "PE", tone: "success", nodes: { ready: 3, total: 3 } },
  { name: "stage", code: "ST", tone: "warning", nodes: null },
  { name: "dev", code: "DV", tone: "error", nodes: null },
  { name: "quiet", code: "QU", tone: "neutral", nodes: null },
];

const mountBar = (active: string | null = null) =>
  mount(K8sClusterHotbar, { props: { clusters, active }, global: { plugins: [i18n] } });

describe("K8sClusterHotbar", () => {
  it("renders one tile per cluster showing its code", () => {
    const wrapper = mountBar();
    for (const cluster of clusters) {
      const tile = wrapper.find(`[data-test="k8s2-hotbar-${cluster.name}"]`);
      expect(tile.exists()).toBe(true);
      expect(tile.text()).toContain(cluster.code);
    }
    expect(wrapper.findAll('[data-test="k8s2-hotbar-list"] > button')).toHaveLength(4);
  });

  it.each([
    ["prod-east", "bg-status-success-text"],
    ["stage", "bg-status-warning-text"],
    ["dev", "bg-status-error-text"],
    ["quiet", "bg-status-neutral-text"],
  ])("colours the %s dot with %s", (name, cls) => {
    const dot = mountBar().find(`[data-test="k8s2-hotbar-dot-${name}"]`);
    expect(dot.classes()).toContain(cls);
  });

  it("marks only the active tile as current", () => {
    const wrapper = mountBar("stage");
    expect(wrapper.find('[data-test="k8s2-hotbar-stage"]').attributes("aria-current")).toBe("true");
    expect(
      wrapper.find('[data-test="k8s2-hotbar-dev"]').attributes("aria-current"),
    ).toBeUndefined();
  });

  it("emits select with the cluster name on click", async () => {
    const wrapper = mountBar();
    await wrapper.find('[data-test="k8s2-hotbar-dev"]').trigger("click");
    expect(wrapper.emitted("select")).toEqual([["dev"]]);
  });

  it("emits all from the all-clusters button and offers no add button", async () => {
    const wrapper = mountBar();
    await wrapper.find('[data-test="k8s2-hotbar-all"]').trigger("click");
    expect(wrapper.emitted("all")).toHaveLength(1);
    expect(wrapper.findAll("button")).toHaveLength(clusters.length + 1);
    expect(wrapper.find('[data-test="k8s2-hotbar-add"]').exists()).toBe(false);
  });

  it("offers the all-clusters tile only when there is more than one cluster", () => {
    const wrapper = mount(K8sClusterHotbar, {
      props: { clusters: clusters.slice(0, 1), active: null },
      global: { plugins: [i18n] },
    });
    expect(wrapper.find('[data-test="k8s2-hotbar-all"]').exists()).toBe(false);
  });

  it("does not dim inactive tiles", () => {
    const tile = mountBar("stage").find('[data-test="k8s2-hotbar-dev"]');
    expect(tile.classes().some((c) => c.startsWith("opacity"))).toBe(false);
  });

  it("names each tile with its health, so the dot is not the only signal", () => {
    const wrapper = mountBar();
    const label = wrapper.find('[data-test="k8s2-hotbar-prod-east"]').attributes("aria-label");
    expect(label).toContain("prod-east");
    expect(label).toMatch(/Healthy|Warning|Critical|Not reporting/);
  });
});
