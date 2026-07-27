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
import { buildPatternConsolidatedTree } from "@/utils/traces/patternDetection";
import { patternTraceTrees } from "@/test/unit/mockData/traces";

// Runs the same pipeline TraceDetails uses for the Trace Graph tab:
// traceTree → buildPatternConsolidatedTree → useTracePatternTree.treeData
const getTreeData = (traceTree: any[]) => {
  const patterns = ref(buildPatternConsolidatedTree(traceTree));
  const { treeData } = useTracePatternTree(patterns, ref(false));
  return treeData.value;
};

describe("useTracePatternTree", () => {
  describe("treeData transformation", () => {
    it("should build a single root tree when the trace has one root span calling another service", () => {
      const treeData = getTreeData(patternTraceTrees.singleRoot);

      expect(treeData.length).toBe(1);
      expect(treeData[0].name).toBe("alertmanager");
      expect(treeData[0].children?.map((c) => c.name)).toEqual(["querier"]);
    });

    it("should build one tree per root service when root spans have distinct services", () => {
      const treeData = getTreeData(patternTraceTrees.multiRootDistinctServices);

      expect(treeData.map((n) => n.name).sort()).toEqual(["alertmanager", "ingester"]);
      expect(treeData.find((n) => n.name === "alertmanager")?.children?.map((c) => c.name)).toEqual(
        ["querier"],
      );
      expect(treeData.find((n) => n.name === "ingester")?.children?.map((c) => c.name)).toEqual([
        "compactor",
      ]);
    });

    it("should render a service node when all root spans belong to the same service", () => {
      const treeData = getTreeData(patternTraceTrees.multiRootSameService);

      expect(treeData.length).toBe(1);
      expect(treeData[0].name).toBe("alertmanager");
      // Metrics come from the service's self-pattern (2 spans, avg 75ms)
      expect(treeData[0].metadata?.count).toBe(2);
      expect(treeData[0].metadata?.avg).toBe(75);
    });

    it("should render a service node when the trace has a single span and single service", () => {
      const treeData = getTreeData(patternTraceTrees.singleServiceOnly);

      expect(treeData.length).toBe(1);
      expect(treeData[0].name).toBe("alertmanager");
      expect(treeData[0].metadata?.count).toBe(1);
    });

    it("should build a tree when root services call each other cyclically", () => {
      const treeData = getTreeData(patternTraceTrees.multiRootCyclicServices);

      // Cycle alertmanager→querier / querier→alertmanager: no parentless
      // service exists, but both services must still be represented.
      expect(treeData.length).toBe(1);
      expect(treeData[0].name).toBe("alertmanager");
      expect(treeData[0].children?.map((c) => c.name)).toEqual(["querier"]);
    });

    it("should not promote a service to root when it already appears as a child of another root", () => {
      const treeData = getTreeData(patternTraceTrees.multiRootOrphanChildService);

      expect(treeData.length).toBe(1);
      expect(treeData[0].name).toBe("alertmanager");
      expect(treeData[0].children?.map((c) => c.name)).toEqual(["querier"]);
    });

    it("should return an empty tree when the pattern map is empty", () => {
      const { treeData } = useTracePatternTree(ref(new Map()), ref(false));

      expect(treeData.value).toEqual([]);
    });
  });
});
