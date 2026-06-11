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
import {
  useTreeVisualization,
  type TreeNode,
} from "@/composables/useTreeVisualization";

const makeNode = (name: string, metadata: Record<string, any> = {}): TreeNode => ({
  id: name,
  name,
  value: 29.3,
  errorRate: 0,
  metadata,
});

const getLabelFn = (nodeType: "service" | "pattern") =>
  useTreeVisualization(ref(null), () => [], { nodeType }).getNodeLabel;

describe("useTreeVisualization", () => {
  describe("getNodeLabel", () => {
    it("should truncate the name with an ellipsis when it exceeds the label limit", () => {
      const label = getLabelFn("pattern")(
        makeNode("oteldemo.RecommendationService"),
      );

      expect(label).toContain("{name|oteldemo.Recommendation…}");
      expect(label).not.toContain("RecommendationService");
    });

    it("should keep short names unchanged when within the label limit", () => {
      const label = getLabelFn("pattern")(makeNode("frontend"));

      expect(label).toContain("{name|frontend}");
      expect(label).not.toContain("…");
    });

    it("should truncate long names when node type is service", () => {
      const label = getLabelFn("service")(
        makeNode("oteldemo.ProductCatalogService"),
      );

      expect(label).toContain("{name|oteldemo.ProductCatalog…}");
    });

    it("should keep the duration line when the name is truncated", () => {
      const label = getLabelFn("pattern")(
        makeNode("oteldemo.RecommendationService", { count: 3, avg: 39.49 }),
      );

      expect(label).toContain("{duration|39.49ms (avg) }");
    });
  });
});
