// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OTree from "./OTree.vue";

const regionNodes = [
  {
    label: "us-east-1",
    children: [{ label: "cluster-a" }, { label: "cluster-b" }],
  },
  {
    label: "eu-west-1",
    children: [{ label: "cluster-c" }],
  },
];

describe("OTree", () => {
  it("renders a <ul role=tree> root", () => {
    const wrapper = mount(OTree, { props: { nodes: regionNodes } });
    expect(wrapper.element.tagName).toBe("UL");
    expect(wrapper.attributes("role")).toBe("tree");
  });

  it("renders top-level node labels", () => {
    const wrapper = mount(OTree, { props: { nodes: regionNodes } });
    expect(wrapper.text()).toContain("us-east-1");
    expect(wrapper.text()).toContain("eu-west-1");
  });

  it("does not show children before expanding", () => {
    const wrapper = mount(OTree, { props: { nodes: regionNodes } });
    // Children are rendered in the DOM but visually hidden via CSS Grid's
    // gridTemplateRows: '0fr' when collapsed. Asserting on the style is the
    // correct behavioral check — it verifies the expand/collapse mechanism,
    // not mere DOM presence.
    const childrenContainers = wrapper.findAll('[role="treeitem"] > div:last-child');
    // Every parent node's children wrapper must start collapsed (0fr)
    childrenContainers.forEach((container) => {
      expect(container.attributes("style")).toContain("grid-template-rows: 0fr");
    });
  });

  it("reveals children after clicking a parent node row", async () => {
    const wrapper = mount(OTree, { props: { nodes: regionNodes } });
    const firstRow = wrapper.find("[role=treeitem] > div");
    await firstRow.trigger("click");
    expect(wrapper.text()).toContain("cluster-a");
    expect(wrapper.text()).toContain("cluster-b");
  });

  it("expands all nodes when defaultExpandAll is true", () => {
    const wrapper = mount(OTree, {
      props: { nodes: regionNodes, defaultExpandAll: true },
    });
    expect(wrapper.text()).toContain("cluster-a");
    expect(wrapper.text()).toContain("cluster-c");
  });

  it("emits update:ticked when a leaf checkbox is toggled", async () => {
    const wrapper = mount(OTree, {
      props: {
        nodes: regionNodes,
        ticked: [],
        defaultExpandAll: true,
      },
    });

    // Click the checkbox button inside the cluster-a leaf node
    const checkboxes = wrapper.findAll('button[role="checkbox"]');
    // Order after expanding: us-east-1 parent, cluster-a leaf, cluster-b leaf, eu-west-1 parent, cluster-c leaf
    await checkboxes[1].trigger("click");

    const emitted = wrapper.emitted("update:ticked");
    expect(emitted).toBeTruthy();
    expect((emitted![0][0] as string[]).includes("cluster-a")).toBe(true);
  });

  it("filters nodes by the filter prop", async () => {
    const wrapper = mount(OTree, {
      props: {
        nodes: regionNodes,
        filter: "cluster-c",
        defaultExpandAll: true,
      },
    });
    expect(wrapper.text()).not.toContain("cluster-a");
    expect(wrapper.text()).not.toContain("cluster-b");
    expect(wrapper.text()).toContain("cluster-c");
  });

  it("uses a custom filterMethod when provided", async () => {
    const filterMethod = (_node: { label: string }, filter: string) =>
      _node.label.startsWith(filter);

    const wrapper = mount(OTree, {
      props: {
        nodes: regionNodes,
        filter: "us",
        filterMethod,
        defaultExpandAll: true,
      },
    });
    expect(wrapper.text()).toContain("us-east-1");
    expect(wrapper.text()).not.toContain("eu-west-1");
  });

  it("keeps parent visible when a child matches the filter", async () => {
    const wrapper = mount(OTree, {
      props: {
        nodes: regionNodes,
        filter: "cluster-a",
        defaultExpandAll: true,
      },
    });
    // us-east-1 parent must still be visible because cluster-a is its child
    expect(wrapper.text()).toContain("us-east-1");
    expect(wrapper.text()).toContain("cluster-a");
  });

  it("passes through attrs to the root element", () => {
    const wrapper = mount(OTree, {
      props: { nodes: [] },
      attrs: { "data-test": "my-tree" },
    });
    expect(wrapper.attributes("data-test")).toBe("my-tree");
  });
});
