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
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import K8sResourceTree from "./K8sResourceTree.vue";
import type { NodeSummary, TreeGroup } from "./k8sTree";

enableAutoUnmount(afterEach);

const groups: TreeGroup[] = [
  {
    id: "cluster",
    label: "infra.k8s2.groupCluster",
    items: [
      { view: "cluster", label: "infra.k8s2.treeOverview", icon: "dashboard", count: null, bad: 0 },
      { view: "nodes", label: "infra.k8s2.viewNodes", icon: "dns", count: 6, bad: 1 },
    ],
  },
  {
    id: "workloads",
    label: "infra.k8s2.groupWorkloads",
    items: [{ view: "pods", label: "infra.k8s2.viewPods", icon: "widgets", count: 40, bad: 0 }],
  },
];

const nodes: NodeSummary = {
  total: 6,
  ready: 5,
  provider: "AWS",
  region: "us-east-1",
  version: "v1.30.2",
};

const mountTree = (props: Record<string, unknown> = {}) =>
  mount(K8sResourceTree, {
    props: { groups, active: "cluster", nodes, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });

const KEY = "k8s2.tree.collapsed";

describe("K8sResourceTree", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("emits select once with the view when an item is clicked", async () => {
    const wrapper = mountTree();
    const rail = wrapper.find('[data-test="k8s2-rail-pods"]');
    await rail.trigger("mousedown", { button: 0 });
    await rail.trigger("click");
    expect(wrapper.emitted("select")).toEqual([["pods"]]);
  });

  it("emits select when the tab strip reports a change, as arrow-key navigation does", async () => {
    const wrapper = mountTree();
    wrapper.findComponent({ name: "OTabs" }).vm.$emit("change", "nodes");
    await flushPromises();
    expect(wrapper.emitted("select")).toEqual([["nodes"]]);
  });

  it("selects the focused item with the keyboard", async () => {
    const wrapper = mountTree();
    await wrapper.find('[data-test="k8s2-rail-pods"]').trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")).toEqual([["pods"]]);
  });

  it("shows counts only when known and the bad badge only when above zero", () => {
    const wrapper = mountTree();
    expect(wrapper.find('[data-test="k8s2-tree-count-nodes"]').text()).toBe("6");
    expect(wrapper.find('[data-test="k8s2-tree-count-cluster"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="k8s2-tree-bad-nodes"]').text()).toBe("1");
    expect(wrapper.find('[data-test="k8s2-tree-bad-pods"]').exists()).toBe(false);
  });

  it("summarises node readiness in amber when some nodes are not ready", () => {
    const subtitle = mountTree().find('[data-test="k8s2-tree-subtitle"]');
    expect(subtitle.text()).toBe("5 of 6 nodes ready");
    expect(subtitle.classes()).toContain("text-status-warning-text");
  });

  it("drops the amber tint when every node is ready and hides the summary without nodes", () => {
    const healthy = mountTree({ nodes: { ...nodes, ready: 6 } });
    expect(healthy.find('[data-test="k8s2-tree-subtitle"]').classes()).not.toContain(
      "text-status-warning-text",
    );
    const none = mountTree({ nodes: null });
    expect(none.find('[data-test="k8s2-tree-subtitle"]').exists()).toBe(false);
    expect(none.find('[data-test="k8s2-tree-context"]').exists()).toBe(false);
  });

  it("joins provider, region and version in the context line", () => {
    expect(mountTree().find('[data-test="k8s2-tree-context"]').text()).toBe(
      "AWS · us-east-1 · v1.30.2",
    );
  });

  it("narrows the items with the filter", async () => {
    const wrapper = mountTree();
    await wrapper
      .find('[data-test="k8s2-tree-filter"] input, input[data-test="k8s2-tree-filter"]')
      .setValue("pod");
    await flushPromises();
    expect(wrapper.find('[data-test="k8s2-rail-pods"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="k8s2-rail-nodes"]').exists()).toBe(false);
  });

  it("persists a collapsed group and restores it on a fresh mount", async () => {
    const first = mountTree();
    const group = first.findComponent('[data-test="k8s2-tree-group-workloads"]');
    group.vm.$emit("update:modelValue", false);
    await flushPromises();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ workloads: true });
    first.unmount();

    const second = mountTree();
    expect(
      second.findComponent('[data-test="k8s2-tree-group-workloads"]').props("modelValue"),
    ).toBe(false);
    expect(second.findComponent('[data-test="k8s2-tree-group-cluster"]').props("modelValue")).toBe(
      true,
    );
  });

  it("does not crash when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const wrapper = mountTree();
    wrapper
      .findComponent('[data-test="k8s2-tree-group-workloads"]')
      .vm.$emit("update:modelValue", false);
    await flushPromises();
    expect(wrapper.find('[data-test="k8s2-tree"]').exists()).toBe(true);
  });
});
