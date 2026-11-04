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
import { ref } from "vue";
import { useTracePatternTree } from "@/composables/useTracePatternTree";
import { buildPathPatterns, buildPatternConsolidatedTree } from "@/utils/traces/patternDetection";
import { patternTraceTrees } from "@/test/unit/mockData/traces";

// Runs the same pipeline TraceDetails uses for the Trace Graph tab.
const getTreeData = (traceTree: any[]) => {
  const patterns = ref(buildPatternConsolidatedTree(traceTree));
  const { treeData } = useTracePatternTree(patterns, ref(false), ref(buildPathPatterns(traceTree)));
  return treeData.value;
};

describe("useTracePatternTree", () => {
  describe("treeData transformation", () => {
    it("should build a single root tree when the trace has one root span calling another service", () => {
      const treeData = getTreeData(patternTraceTrees.singleRoot);

      expect(treeData.length).toBe(1);
      expect(treeData[0].name).toBe("scheduler");
      expect(treeData[0].children?.map((c) => c.name)).toEqual(["querier"]);
    });

    it("should build one tree per root service when root spans have distinct services", () => {
      const treeData = getTreeData(patternTraceTrees.multiRootDistinctServices);

      expect(treeData.map((n) => n.name).sort()).toEqual(["ingester", "scheduler"]);
      expect(treeData.find((n) => n.name === "scheduler")?.children?.map((c) => c.name)).toEqual([
        "querier",
      ]);
      expect(treeData.find((n) => n.name === "ingester")?.children?.map((c) => c.name)).toEqual([
        "compactor",
      ]);
    });

    it("should render a service node when all root spans belong to the same service", () => {
      const treeData = getTreeData(patternTraceTrees.multiRootSameService);

      expect(treeData.length).toBe(1);
      expect(treeData[0].name).toBe("scheduler");
      // Metrics come from the service's self-pattern (2 spans, avg 75ms)
      expect(treeData[0].metadata?.count).toBe(2);
      expect(treeData[0].metadata?.avg).toBe(75);
    });

    it("should render a service node when the trace has a single span and single service", () => {
      const treeData = getTreeData(patternTraceTrees.singleServiceOnly);

      expect(treeData.length).toBe(1);
      expect(treeData[0].name).toBe("scheduler");
      expect(treeData[0].metadata?.count).toBe(1);
    });

    it("should build a tree when root services call each other cyclically", () => {
      const treeData = getTreeData(patternTraceTrees.multiRootCyclicServices);

      // Cycle scheduler→querier / querier→scheduler: no parentless
      // service exists, but both services must still be represented.
      expect(treeData.length).toBe(1);
      expect(treeData[0].name).toBe("scheduler");
      expect(treeData[0].children?.map((c) => c.name)).toEqual(["querier"]);
    });

    it("should not promote a service to root when it already appears as a child of another root", () => {
      const treeData = getTreeData(patternTraceTrees.multiRootOrphanChildService);

      expect(treeData.length).toBe(1);
      expect(treeData[0].name).toBe("scheduler");
      expect(treeData[0].children?.map((c) => c.name)).toEqual(["querier"]);
    });

    it("should give a service called by two parents each parent's own latency and errors", () => {
      const [root] = getTreeData(patternTraceTrees.sharedChildTwoParents);
      const databaseUnder = (parent: string) =>
        root.children?.find((c) => c.name === parent)?.children?.find((c) => c.name === "database");

      const viaOrder = databaseUnder("order-service");
      expect(viaOrder?.value).toBe(15);
      expect(viaOrder?.metadata?.avg).toBe(15);
      expect(viaOrder?.errorRate).toBe(0);
      expect(viaOrder?.metadata?.errorCount).toBe(0);

      const viaInventory = databaseUnder("inventory-service");
      expect(viaInventory?.value).toBe(10);
      expect(viaInventory?.metadata?.avg).toBe(10);
      expect(viaInventory?.errorRate).toBe(100);
      expect(viaInventory?.metadata?.errorCount).toBe(1);
    });

    it("should give a leaf reached along two branches each branch's own metrics", () => {
      const [root] = getTreeData(patternTraceTrees.sharedLeafTwoBranches);
      const child = (node: any, name: string) => node?.children?.find((c: any) => c.name === name);

      const leafViaFrontend = child(child(root, "catalog-rpc"), "product-catalog");
      expect(leafViaFrontend?.value).toBe(3);
      expect(leafViaFrontend?.metadata?.count).toBe(1);
      expect(leafViaFrontend?.metadata?.errorCount).toBe(0);
      expect(leafViaFrontend?.errorRate).toBe(0);

      const leafViaCheckout = child(
        child(child(root, "checkout"), "catalog-rpc"),
        "product-catalog",
      );
      expect(leafViaCheckout?.value).toBe(1.5);
      expect(leafViaCheckout?.metadata?.count).toBe(2);
      expect(leafViaCheckout?.metadata?.errorCount).toBe(1);
      expect(leafViaCheckout?.errorRate).toBe(50);
    });

    it("should keep the self-pattern metrics on a root service", () => {
      const [root] = getTreeData(patternTraceTrees.sharedChildTwoParents);
      expect(root.name).toBe("frontend");
      expect(root.value).toBe(100);
      expect(root.metadata?.errorCount).toBe(0);
    });

    it("should show a measured average of 0 on a node instead of its children's average", () => {
      const [root] = getTreeData(patternTraceTrees.zeroDurationRoot);

      expect(root.name).toBe("scheduler");
      expect(root.value).toBe(0);
      expect(root.metadata?.avg).toBe(0);
    });

    it("should return an empty tree when the pattern map is empty", () => {
      const { treeData } = useTracePatternTree(ref(new Map()), ref(false), ref(new Map()));

      expect(treeData.value).toEqual([]);
    });
  });
});
