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

import { describe, expect, it, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import QueryPlanNode from "./QueryPlanNode.vue";
import type { OperatorNode } from "@/utils/queryPlanParser";

installQuasar();

function makeNode(overrides: Partial<OperatorNode> = {}): OperatorNode {
  return {
    name: "ProjectionExec",
    fullText: "ProjectionExec: expr=[a, b, c]",
    depth: 0,
    metrics: {},
    children: [],
    isRepartitionExec: false,
    ...overrides,
  };
}

function mountNode(
  node: OperatorNode,
  props: Record<string, unknown> = {},
) {
  return mount(QueryPlanNode, {
    props: {
      node,
      isLast: false,
      isAnalyze: false,
      parentPrefix: "",
      ...props,
    },
  });
}

describe("QueryPlanNode", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mountNode(makeNode());
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the operator name", () => {
      wrapper = mountNode(makeNode({ name: "SortExec" }));
      expect(wrapper.find(".operator-name").text()).toBe("SortExec");
    });

    it("should render inline details when colon present in fullText", () => {
      wrapper = mountNode(
        makeNode({ fullText: "FilterExec: expression=[x > 0]" }),
      );
      expect(wrapper.find(".inline-details").exists()).toBe(true);
      expect(wrapper.find(".inline-details").text()).toContain(
        "expression=[x > 0]",
      );
    });

    it("should not render inline details when no colon in fullText", () => {
      wrapper = mountNode(makeNode({ name: "CoalesceExec", fullText: "CoalesceExec" }));
      expect(wrapper.find(".inline-details").exists()).toBe(false);
    });
  });

  describe("tree connector", () => {
    it("should show └─ connector when isLast is true", () => {
      wrapper = mountNode(makeNode(), { isLast: true });
      expect(wrapper.find(".tree-connector").text()).toBe("└─");
    });

    it("should show ├─ connector when isLast is false", () => {
      wrapper = mountNode(makeNode(), { isLast: false });
      expect(wrapper.find(".tree-connector").text()).toBe("├─");
    });
  });

  describe("parent prefix indentation", () => {
    it("should render parentPrefix as tree-indent when provided", () => {
      wrapper = mountNode(makeNode(), { parentPrefix: "│ " });
      expect(wrapper.find(".tree-indent").exists()).toBe(true);
      // .text() trims whitespace, so check the raw innerHTML instead
      expect(wrapper.find(".tree-indent").element.textContent).toContain("│");
    });

    it("should not render tree-indent when parentPrefix is empty", () => {
      wrapper = mountNode(makeNode(), { parentPrefix: "" });
      expect(wrapper.find(".tree-indent").exists()).toBe(false);
    });
  });

  describe("expand/collapse children", () => {
    const childNode = makeNode({ name: "ChildExec", fullText: "ChildExec" });
    const nodeWithChildren = makeNode({
      name: "ParentExec",
      children: [childNode],
    });

    it("should show expand icon when node has children", () => {
      wrapper = mountNode(nodeWithChildren);
      expect(wrapper.find(".expand-icon").exists()).toBe(true);
    });

    it("should show spacer instead of expand icon for leaf nodes", () => {
      wrapper = mountNode(makeNode());
      expect(wrapper.find(".expand-icon-spacer").exists()).toBe(true);
      expect(wrapper.find(".expand-icon").exists()).toBe(false);
    });

    it("should show ▼ icon initially (children expanded by default)", () => {
      wrapper = mountNode(nodeWithChildren);
      expect(wrapper.find(".expand-icon").text()).toBe("▼");
    });

    it("should collapse children when expand icon is clicked", async () => {
      wrapper = mountNode(nodeWithChildren);
      await wrapper.find(".expand-icon").trigger("click");
      expect(wrapper.find(".expand-icon").text()).toBe("▶");
    });

    it("should hide children section after collapse", async () => {
      wrapper = mountNode(nodeWithChildren);
      expect(wrapper.find(".children").exists()).toBe(true);
      await wrapper.find(".expand-icon").trigger("click");
      expect(wrapper.find(".children").exists()).toBe(false);
    });

    it("should re-expand children when icon clicked again", async () => {
      wrapper = mountNode(nodeWithChildren);
      await wrapper.find(".expand-icon").trigger("click");
      await wrapper.find(".expand-icon").trigger("click");
      expect(wrapper.find(".children").exists()).toBe(true);
      expect(wrapper.find(".expand-icon").text()).toBe("▼");
    });
  });

  describe("long details expand/collapse", () => {
    const longDetail = "a".repeat(81);
    const nodeWithLongDetails = makeNode({
      fullText: `SomeExec: ${longDetail}`,
    });

    it("should mark details as truncated and clickable when details exceed 80 chars", () => {
      wrapper = mountNode(nodeWithLongDetails);
      expect(wrapper.find(".inline-details.truncated").exists()).toBe(true);
      expect(wrapper.find(".inline-details.clickable").exists()).toBe(true);
    });

    it("should expand details on click when details are long", async () => {
      wrapper = mountNode(nodeWithLongDetails);
      await wrapper.find(".inline-details").trigger("click");
      expect(wrapper.find(".node-details").exists()).toBe(true);
    });

    it("should not show node-details section before clicking when details are long", () => {
      wrapper = mountNode(nodeWithLongDetails);
      expect(wrapper.find(".node-details").exists()).toBe(false);
    });

    it("should not make details clickable when details are short", () => {
      wrapper = mountNode(makeNode({ fullText: "SomeExec: short detail" }));
      expect(wrapper.find(".inline-details.clickable").exists()).toBe(false);
    });
  });

  describe("metrics (isAnalyze mode)", () => {
    const nodeWithMetrics = makeNode({
      metrics: {
        output_rows: 1234,
        elapsed_compute: "5.67ms",
      },
    });

    it("should show metrics section when isAnalyze is true and metrics present", () => {
      wrapper = mountNode(nodeWithMetrics, { isAnalyze: true });
      expect(wrapper.find(".metrics-inline").exists()).toBe(true);
    });

    it("should not show metrics section when isAnalyze is false", () => {
      wrapper = mountNode(nodeWithMetrics, { isAnalyze: false });
      expect(wrapper.find(".metrics-inline").exists()).toBe(false);
    });

    it("should display output_rows badge", () => {
      wrapper = mountNode(nodeWithMetrics, { isAnalyze: true });
      const badges = wrapper.findAll(".metric-badge");
      expect(badges.some((b) => b.text().includes("1,234"))).toBe(true);
    });

    it("should display elapsed_compute badge", () => {
      wrapper = mountNode(nodeWithMetrics, { isAnalyze: true });
      const badges = wrapper.findAll(".metric-badge");
      expect(badges.some((b) => b.text().includes("5.67ms"))).toBe(true);
    });

    it("should show separator between details and metrics when both present", () => {
      wrapper = mountNode(nodeWithMetrics, { isAnalyze: true });
      expect(wrapper.find(".separator").exists()).toBe(true);
    });

    it("should not show metrics section when node has no metrics", () => {
      wrapper = mountNode(makeNode({ metrics: {} }), { isAnalyze: true });
      expect(wrapper.find(".metrics-inline").exists()).toBe(false);
    });

    it("should strip metrics section from inline details in analyze mode", () => {
      const nodeWithMetricsInText = makeNode({
        fullText:
          "FilterExec: expression=[x > 0], metrics=[elapsed_compute=5ms, output_rows=100]",
        metrics: { elapsed_compute: "5ms", output_rows: 100 },
      });
      wrapper = mountNode(nodeWithMetricsInText, { isAnalyze: true });
      expect(wrapper.find(".inline-details").text()).not.toContain("metrics=");
    });
  });

  describe("formatNumber", () => {
    it("should format numbers with locale separators", () => {
      wrapper = mountNode(
        makeNode({
          metrics: { output_rows: 1000000 },
        }),
        { isAnalyze: true },
      );
      const badges = wrapper.findAll(".metric-badge");
      expect(badges.some((b) => b.text().includes("1,000,000"))).toBe(true);
    });
  });

  describe("recursive child rendering", () => {
    it("should render child QueryPlanNode components", () => {
      const child1 = makeNode({ name: "Child1Exec", fullText: "Child1Exec" });
      const child2 = makeNode({ name: "Child2Exec", fullText: "Child2Exec" });
      const parent = makeNode({
        name: "ParentExec",
        children: [child1, child2],
      });
      wrapper = mountNode(parent);
      // children container should exist and contain two plan-node divs
      const children = wrapper.find(".children");
      expect(children.exists()).toBe(true);
      expect(children.findAll(".plan-node")).toHaveLength(2);
    });

    it("should pass isLast=true only to the last child", () => {
      const child1 = makeNode({ name: "A", fullText: "A" });
      const child2 = makeNode({ name: "B", fullText: "B" });
      const parent = makeNode({ children: [child1, child2] });
      wrapper = mountNode(parent);
      const connectors = wrapper.find(".children").findAll(".tree-connector");
      // first child → ├─, last child → └─
      expect(connectors[0].text()).toBe("├─");
      expect(connectors[1].text()).toBe("└─");
    });
  });
});
