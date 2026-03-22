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
import QueryPlanTree from "./QueryPlanTree.vue";
import type { OperatorNode } from "@/utils/queryPlanParser";

installQuasar();

function makeNode(
  name: string,
  children: OperatorNode[] = [],
): OperatorNode {
  return {
    name,
    fullText: name,
    depth: 0,
    metrics: {},
    children,
    isRepartitionExec: false,
  };
}

function makeRootNode(children: OperatorNode[]): OperatorNode {
  return {
    name: "Root",
    fullText: "",
    depth: -1,
    metrics: {},
    children,
    isRepartitionExec: false,
  };
}

function mountTree(
  tree: OperatorNode,
  props: Record<string, unknown> = {},
) {
  return mount(QueryPlanTree, {
    props: {
      tree,
      isAnalyze: false,
      ...props,
    },
  });
}

describe("QueryPlanTree", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mountTree(makeRootNode([]));
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the container with query-plan-tree class", () => {
      wrapper = mountTree(makeRootNode([]));
      expect(wrapper.find(".query-plan-tree").exists()).toBe(true);
    });
  });

  describe("empty tree", () => {
    it("should render no tree-node elements for empty root children", () => {
      wrapper = mountTree(makeRootNode([]));
      expect(wrapper.findAll(".tree-node")).toHaveLength(0);
    });
  });

  describe("single child", () => {
    it("should render one tree-node for a single child", () => {
      const tree = makeRootNode([makeNode("SortExec")]);
      wrapper = mountTree(tree);
      expect(wrapper.findAll(".tree-node")).toHaveLength(1);
    });

    it("should render the operator name of the single child", () => {
      const tree = makeRootNode([makeNode("FilterExec")]);
      wrapper = mountTree(tree);
      expect(wrapper.find(".operator-name").text()).toBe("FilterExec");
    });
  });

  describe("multiple children", () => {
    it("should render correct number of tree-node elements", () => {
      const tree = makeRootNode([
        makeNode("ProjectionExec"),
        makeNode("FilterExec"),
        makeNode("SortExec"),
      ]);
      wrapper = mountTree(tree);
      expect(wrapper.findAll(".tree-node")).toHaveLength(3);
    });

    it("should render operator names for all children", () => {
      const tree = makeRootNode([
        makeNode("ProjectionExec"),
        makeNode("FilterExec"),
      ]);
      wrapper = mountTree(tree);
      const names = wrapper.findAll(".operator-name");
      expect(names[0].text()).toBe("ProjectionExec");
      expect(names[1].text()).toBe("FilterExec");
    });

    it("should give isLast=true only to the last root child", () => {
      const tree = makeRootNode([
        makeNode("FirstExec"),
        makeNode("MiddleExec"),
        makeNode("LastExec"),
      ]);
      wrapper = mountTree(tree);
      const connectors = wrapper.findAll(".tree-connector");
      // first two → ├─, last one → └─
      expect(connectors[0].text()).toBe("├─");
      expect(connectors[1].text()).toBe("├─");
      expect(connectors[2].text()).toBe("└─");
    });
  });

  describe("isAnalyze prop", () => {
    it("should pass isAnalyze=false to child nodes by default", () => {
      const nodeWithMetrics = makeNode("FilterExec");
      nodeWithMetrics.metrics = { output_rows: 100, elapsed_compute: "1ms" };
      const tree = makeRootNode([nodeWithMetrics]);
      wrapper = mountTree(tree, { isAnalyze: false });
      // Metrics section should not show when isAnalyze=false
      expect(wrapper.find(".metrics-inline").exists()).toBe(false);
    });

    it("should pass isAnalyze=true to child nodes when set", () => {
      const nodeWithMetrics = makeNode("FilterExec");
      nodeWithMetrics.metrics = { output_rows: 100, elapsed_compute: "1ms" };
      const tree = makeRootNode([nodeWithMetrics]);
      wrapper = mountTree(tree, { isAnalyze: true });
      // Metrics section should show when isAnalyze=true
      expect(wrapper.find(".metrics-inline").exists()).toBe(true);
    });
  });

  describe("nested children propagation", () => {
    it("should render nested children via QueryPlanNode recursion", () => {
      const grandchild = makeNode("GrandchildExec");
      const child = makeNode("ChildExec", [grandchild]);
      const tree = makeRootNode([child]);
      wrapper = mountTree(tree);
      // The grandchild should be rendered inside the child's children container
      expect(wrapper.find(".children .plan-node .operator-name").text()).toBe(
        "GrandchildExec",
      );
    });
  });

  describe("parentPrefix passed as empty string to root children", () => {
    it("should not render tree-indent for root-level nodes", () => {
      const tree = makeRootNode([makeNode("RootChild")]);
      wrapper = mountTree(tree);
      // Root children get parentPrefix="" so no tree-indent span should appear at top level
      expect(wrapper.find(".tree-node > .plan-node > .node-line > .tree-indent").exists()).toBe(false);
    });
  });
});
