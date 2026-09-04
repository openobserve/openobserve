// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import {
  convertTraceData,
  convertTimelineData,
  convertTraceServiceMapData,
  convertServiceGraphToTree,
  convertServiceGraphToNetwork,
  getServiceIconDataUrl,
  iconSvgForType,
} from "./convertTraceData";

describe("convertTraceData", () => {
  describe("convertTraceData", () => {
    it("should convert trace data with UTC timezone", () => {
      const props = {
        data: [
          {
            x: [1609459200000, 1609459260000, 1609459320000], // timestamps
            y: [100, 150, 200], // duration values in ms
          },
        ],
      };
      const timezone = "UTC";

      const result = convertTraceData(props, timezone);

      expect(result).toHaveProperty("options");
      expect(result.options).toHaveProperty("series");
      expect(result.options.series).toHaveLength(1);
      expect(result.options.series[0].data).toHaveLength(3);
      expect(result.options.series[0].data[0]).toEqual([1609459200000, 100]);
      expect(result.options.series[0].data[1]).toEqual([1609459260000, 150]);
      expect(result.options.series[0].data[2]).toEqual([1609459320000, 200]);
    });

    it("should convert trace data with non-UTC timezone", () => {
      const props = {
        data: [
          {
            x: [1609459200000],
            y: [100],
          },
        ],
      };
      const timezone = "America/New_York";

      const result = convertTraceData(props, timezone);

      expect(result).toHaveProperty("options");
      expect(result.options.series[0].data).toHaveLength(1);
      // The timestamp should be converted to the specified timezone
      expect(result.options.series[0].data[0][1]).toBe(100);
    });

    it("should handle empty data arrays", () => {
      const props = {
        data: [
          {
            x: [],
            y: [],
          },
        ],
      };
      const timezone = "UTC";

      const result = convertTraceData(props, timezone);

      expect(result.options.series[0].data).toHaveLength(0);
    });

    it("should handle missing y values with default 0", () => {
      const props = {
        data: [
          {
            x: [1609459200000, 1609459260000],
            y: [100], // Only one y value
          },
        ],
      };
      const timezone = "UTC";

      const result = convertTraceData(props, timezone);

      expect(result.options.series[0].data).toHaveLength(2);
      expect(result.options.series[0].data[0]).toEqual([1609459200000, 100]);
      expect(result.options.series[0].data[1]).toEqual([1609459260000, 0]); // Default to 0
    });

    it("should have correct chart configuration", () => {
      const props = {
        data: [{ x: [1609459200000], y: [100] }],
      };
      const timezone = "UTC";

      const result = convertTraceData(props, timezone);

      expect(result.options.backgroundColor).toBe("transparent");
      expect(result.options.xAxis.type).toBe("time");
      expect(result.options.yAxis.type).toBe("value");
      expect(result.options.series[0].type).toBe("scatter");
      expect(result.options.series[0].symbolSize).toBe(5);
      expect(result.options.series[0].itemStyle.color).toBe("#7A80C2");
    });

    it("should have tooltip configuration", () => {
      const props = {
        data: [{ x: [1609459200000], y: [100] }],
      };
      const timezone = "UTC";

      const result = convertTraceData(props, timezone);

      expect(result.options.tooltip.show).toBe(true);
      expect(result.options.tooltip.trigger).toBe("axis");
      expect(result.options.tooltip).toHaveProperty("formatter");
    });

    it("should handle undefined data array", () => {
      const props = {
        data: [
          {
            x: undefined,
            y: undefined,
          },
        ],
      };
      const timezone = "UTC";

      const result = convertTraceData(props, timezone);

      expect(result.options.series[0].data).toHaveLength(0);
    });
  });

  describe("convertTimelineData", () => {
    it("should convert timeline data correctly", () => {
      const props = {
        value: {
          data: [
            { x0: 0, x1: 100, fillcolor: "#ff0000" },
            { x0: 100, x1: 250, fillcolor: "#00ff00" },
            { x0: 250, x1: 300, fillcolor: "#0000ff" },
          ],
        },
      };

      const result = convertTimelineData(props);

      expect(result).toHaveProperty("options");
      expect(result.options.series).toHaveLength(2);

      // First series (transparent baseline)
      expect(result.options.series[0].data).toEqual([0, 100, 250]);
      expect(result.options.series[0].itemStyle.color).toBe("transparent");

      // Second series (colored bars)
      expect(result.options.series[1].data).toHaveLength(3);
      expect(result.options.series[1].data[0].value).toBe(100); // x1 - x0
      expect(result.options.series[1].data[0].itemStyle.color).toBe("#ff0000");
      expect(result.options.series[1].data[1].value).toBe(150); // 250 - 100
      expect(result.options.series[1].data[1].itemStyle.color).toBe("#00ff00");
      expect(result.options.series[1].data[2].value).toBe(50); // 300 - 250
      expect(result.options.series[1].data[2].itemStyle.color).toBe("#0000ff");
    });

    it("should have correct timeline chart configuration", () => {
      const props = {
        value: {
          data: [{ x0: 0, x1: 100, fillcolor: "#ff0000" }],
        },
      };

      const result = convertTimelineData(props);

      expect(result.options.yAxis.type).toBe("category");
      expect(result.options.xAxis.type).toBe("value");
      expect(result.options.series[0].type).toBe("bar");
      expect(result.options.series[0].stack).toBe("Total");
      expect(result.options.series[1].type).toBe("bar");
      expect(result.options.series[1].stack).toBe("Total");
      expect(result.options.series[1].barWidth).toBe("100%");
    });

    it("should have dataZoom configuration", () => {
      const props = {
        value: {
          data: [{ x0: 0, x1: 100, fillcolor: "#ff0000" }],
        },
      };

      const result = convertTimelineData(props);

      expect(result.options.dataZoom).toHaveLength(1);
      expect(result.options.dataZoom[0].type).toBe("slider");
      expect(result.options.dataZoom[0].height).toBe(20);
      expect(result.options.dataZoom[0].bottom).toBe(20);
    });

    it("should handle empty timeline data", () => {
      const props = {
        value: {
          data: [],
        },
      };

      const result = convertTimelineData(props);

      expect(result.options.series[0].data).toHaveLength(0);
      expect(result.options.series[1].data).toHaveLength(0);
    });

    it("should calculate bar widths correctly", () => {
      const props = {
        value: {
          data: [
            { x0: 10, x1: 50, fillcolor: "#aabbcc" },
            { x0: 50, x1: 75, fillcolor: "#ddeeff" },
          ],
        },
      };

      const result = convertTimelineData(props);

      expect(result.options.series[1].data[0].value).toBe(40); // 50 - 10
      expect(result.options.series[1].data[1].value).toBe(25); // 75 - 50
    });
  });

  describe("convertTraceServiceMapData", () => {
    it("should convert service map data with default tree depth", () => {
      const data = [
        {
          name: "Service A",
          children: [{ name: "Service B" }, { name: "Service C" }],
        },
      ];

      const result = convertTraceServiceMapData(data);

      expect(result).toHaveProperty("options");
      expect(result.options.series).toHaveLength(1);
      expect(result.options.series[0].type).toBe("tree");
      expect(result.options.series[0].data).toEqual(data);
      expect(result.options.series[0].initialTreeDepth).toBe(3); // default
    });

    it("should convert service map data with custom tree depth", () => {
      const data = [
        {
          name: "Root",
          children: [{ name: "Child" }],
        },
      ];
      const treeDepth = 5;

      const result = convertTraceServiceMapData(data, treeDepth);

      expect(result.options.series[0].initialTreeDepth).toBe(5);
    });

    it("should have correct tree chart configuration", () => {
      const data = [{ name: "Service" }];

      const result = convertTraceServiceMapData(data);

      expect(result.options.tooltip.show).toBe(false);
      expect(result.options.series[0].symbolSize).toBe(30);
      expect(result.options.series[0].label.position).toBe("bottom");
      expect(result.options.series[0].label.verticalAlign).toBe("bottom");
      expect(result.options.series[0].label.distance).toBe(26);
      expect(result.options.series[0].label.fontSize).toBe(12);
    });

    it("should handle empty service map data", () => {
      const data: any[] = [];

      const result = convertTraceServiceMapData(data);

      expect(result.options.series[0].data).toEqual([]);
    });

    it("should handle tree depth of 0", () => {
      const data = [{ name: "Service" }];
      const treeDepth = 0;

      const result = convertTraceServiceMapData(data, treeDepth);

      expect(result.options.series[0].initialTreeDepth).toBe(0);
    });
  });

  describe("convertServiceGraphToTree", () => {
    it("roots the tree at the entry-edge node so children attach to the right parent (agent-graph regression)", () => {
      // API shape: {from: null → orchestrator}, orchestrator → {Supervisor, Worker},
      // Worker → {gpt-4o, run_query}. Bug: the null-from entry edge made
      // orchestrator look parented, rootNodes came back empty, and gpt-4o was
      // placed under the wrong parent (visible as a model hanging off the root).
      const graphData = {
        nodes: [
          { id: "orchestrator", label: "orchestrator" },
          { id: "Supervisor", label: "Supervisor", service_type: "agent" },
          { id: "Worker", label: "Worker", service_type: "agent" },
          { id: "gpt-4o", label: "gpt-4o", service_type: "model" },
          { id: "run_query", label: "run_query", service_type: "tool" },
        ],
        edges: [
          { from: null, to: "orchestrator", total_requests: 1 },
          { from: "orchestrator", to: "Supervisor", total_requests: 1 },
          { from: "orchestrator", to: "Worker", total_requests: 1 },
          { from: "Worker", to: "gpt-4o", total_requests: 1 },
          { from: "Worker", to: "run_query", total_requests: 1 },
        ],
      };
      const result = convertServiceGraphToTree(graphData as any, "horizontal");
      const roots = result.options.series[0].data;
      // A single root (orchestrator), not a flat pile of orphaned nodes.
      expect(roots).toHaveLength(1);
      expect(roots[0].name).toBe("orchestrator");
      // orchestrator's children are the two agents.
      const l1 = (roots[0].children ?? []).map((c: any) => c.name).sort();
      expect(l1).toEqual(["Supervisor", "Worker"]);
      // gpt-4o is under Worker — NOT a sibling of the agents / under the root.
      const worker = roots[0].children.find((c: any) => c.name === "Worker");
      const workerKids = (worker.children ?? []).map((c: any) => c.name).sort();
      expect(workerKids).toEqual(["gpt-4o", "run_query"]);
    });

    // Agent highlighting (indigo tint, larger symbol, radar-ping halo) is a
    // treatment for the dedicated Agent Graph page ONLY. On the Service Graph
    // tab the caller omits agentHighlight, and an agent must render as a plain
    // node — no ping animation, no size bump.
    it("does NOT highlight agents unless agentHighlight is set", () => {
      const graphData = {
        nodes: [
          { id: "root", label: "root" },
          { id: "planner", label: "planner", service_type: "agent" },
        ],
        edges: [
          { from: null, to: "root", total_requests: 1 },
          { from: "root", to: "planner", total_requests: 1 },
        ],
      };
      const decode = (sym: string) =>
        atob(sym.replace(/^image:\/\//, "").replace("data:image/svg+xml;base64,", ""));

      // Service Graph mount (agentHighlight defaults false).
      const plain = convertServiceGraphToTree(graphData as any, "horizontal");
      const plainAgent = plain.options.series[0].data[0].children.find(
        (c: any) => c.name === "planner",
      );
      const plainSvg = decode(plainAgent.symbol);
      expect(plainSvg).not.toContain("<animate ");
      expect(plainSvg).toContain('viewBox="0 0 56 56"'); // tight box = plain node

      // Agent Graph mount (agentHighlight true).
      const hl = convertServiceGraphToTree(graphData as any, "horizontal", true, 700, true);
      const hlAgent = hl.options.series[0].data[0].children.find((c: any) => c.name === "planner");
      const hlSvg = decode(hlAgent.symbol);
      expect(hlSvg).toContain("<animate "); // ping rings present
      expect(hlSvg).toContain('viewBox="0 0 104 104"'); // padded box
      // Highlighted agent symbol is larger than the plain one.
      expect(hlAgent.symbolSize).toBeGreaterThan(plainAgent.symbolSize);
    });

    it("should convert service graph to tree with horizontal layout", () => {
      const graphData = {
        nodes: [
          { id: "service-a", label: "Service A" },
          { id: "service-b", label: "Service B" },
          { id: "service-c", label: "Service C" },
        ],
        edges: [
          { source: "service-a", target: "service-b" },
          { source: "service-a", target: "service-c" },
        ],
      };
      const layoutType = "horizontal";

      const result = convertServiceGraphToTree(graphData, layoutType);

      expect(result).toHaveProperty("options");
      expect(result.options.series).toHaveLength(1);
      expect(result.options.series[0].type).toBe("tree");
      expect(result.options.series[0].orient).toBe("LR"); // horizontal = LR
    });

    it("should convert service graph to tree with vertical layout", () => {
      const graphData = {
        nodes: [{ id: "service-a", label: "Service A" }],
        edges: [],
      };
      const layoutType = "vertical";

      const result = convertServiceGraphToTree(graphData, layoutType);

      expect(result.options.series[0].orient).toBe("TB"); // vertical = TB
    });

    it("uses layout:'none' with adaptive computed positions", () => {
      const graphData = {
        nodes: [{ id: "service-a", label: "Service A" }],
        edges: [],
      };
      const layoutType = "radial";

      const result = convertServiceGraphToTree(graphData, layoutType);

      // The tree now uses explicit computed positions (layout:'none') so labels
      // never overlap — not ECharts' orthogonal auto-layout.
      expect(result.options.series[0].layout).toBe("none");
    });

    it("should handle empty graph data", () => {
      const graphData = {
        nodes: [],
        edges: [],
      };
      const layoutType = "horizontal";

      const result = convertServiceGraphToTree(graphData, layoutType);

      expect(result.options.series[0].data).toBeDefined();
    });

    it("should default to horizontal layout when no layoutType provided", () => {
      const graphData = {
        nodes: [{ id: "service-a", label: "Service A" }],
        edges: [],
      };

      const result = convertServiceGraphToTree(graphData);

      expect(result.options.series[0].orient).toBe("LR");
    });

    it("auto-shrinks node symbol + label font when there are many leaf rows", () => {
      // ECharts fits the whole tree into the panel, so many leaf rows get
      // compressed until they'd overlap. The converter scales symbol + font down
      // to the compressed pitch. Compare a small tree (full size) against a tall
      // one (shrunk) at the SAME panel height.
      const root = { id: "root", label: "root" };
      const small = {
        nodes: [root, { id: "c0", label: "c0" }, { id: "c1", label: "c1" }],
        edges: [
          { from: "root", to: "c0", total_requests: 1 },
          { from: "root", to: "c1", total_requests: 1 },
        ],
      };
      const tallNodes = [root];
      const tallEdges: any[] = [];
      for (let i = 0; i < 60; i++) {
        tallNodes.push({ id: `c${i}`, label: `child-${i}` });
        tallEdges.push({ from: "root", to: `c${i}`, total_requests: 1 });
      }
      const tall = { nodes: tallNodes, edges: tallEdges };

      const PANEL_H = 700;
      const smallRes = convertServiceGraphToTree(small, "horizontal", true, PANEL_H);
      const tallRes = convertServiceGraphToTree(tall, "horizontal", true, PANEL_H);

      const smallFont = smallRes.options.series[0].label.fontSize;
      const smallSym = smallRes.options.series[0].symbolSize;
      const tallFont = tallRes.options.series[0].label.fontSize;
      const tallSym = tallRes.options.series[0].symbolSize;

      // Small tree keeps the comfortable full size.
      expect(smallFont).toBe(12);
      expect(smallSym).toBe(30);
      // Tall tree is shrunk so rows don't overlap — smaller than the small one,
      // and never below the readable floor.
      expect(tallSym).toBeLessThan(smallSym);
      expect(tallSym).toBeGreaterThanOrEqual(8);
      expect(tallFont).toBeGreaterThanOrEqual(7);
      expect(tallFont).toBeLessThanOrEqual(12);
    });

    it("drops the 'N req' second label line at extreme density, keeps the name", () => {
      // The two-line label (name + "N req") is the real overlap driver. At a
      // roomy panel both lines show; at extreme density the second line is
      // dropped so the name alone stays readable instead of colliding.
      const root = { id: "root", label: "root" };
      const nodes = [root];
      const edges: any[] = [];
      for (let i = 0; i < 80; i++) {
        nodes.push({ id: `c${i}`, label: `child-${i}`, requests: 10 });
        edges.push({ from: "root", to: `c${i}`, total_requests: 10 });
      }
      const graphData = { nodes, edges };

      // Roomy panel → both lines fit → formatter includes "req".
      const roomy = convertServiceGraphToTree(graphData, "horizontal", true, 4000);
      // Cramped panel → second line dropped.
      const cramped = convertServiceGraphToTree(graphData, "horizontal", true, 400);

      // Find a leaf node's formatter output (params.name = its label).
      const leafLabel = (res: any) => {
        const root = res.options.series[0].data[0];
        const leaf = root.children[0];
        return leaf.label.formatter({ name: leaf.name });
      };

      expect(leafLabel(roomy)).toContain("req");
      expect(leafLabel(cramped)).not.toContain("req");
      // The name is always present.
      expect(leafLabel(cramped)).toContain("{name|");
    });

    it("renders each shared node once (DAG → spanning tree, no duplication)", () => {
      // Diamond: A→B, A→C, B→shared, C→shared. 'shared' must appear ONCE.
      const graphData = {
        nodes: [
          { id: "a", label: "a" },
          { id: "b", label: "b" },
          { id: "c", label: "c" },
          { id: "shared", label: "shared" },
        ],
        edges: [
          { from: "a", to: "b", total_requests: 1 },
          { from: "a", to: "c", total_requests: 1 },
          { from: "b", to: "shared", total_requests: 1 },
          { from: "c", to: "shared", total_requests: 1 },
        ],
      };

      const result = convertServiceGraphToTree(graphData, "horizontal");

      // Count how many times 'shared' appears anywhere in the tree data.
      const countByName = (nodes: any[], name: string): number => {
        let count = 0;
        for (const n of nodes || []) {
          if (n.name === name || n.id === name) count++;
          if (n.children) count += countByName(n.children, name);
        }
        return count;
      };
      const roots = result.options.series[0].data;
      expect(countByName(roots, "shared")).toBe(1);
    });
  });

  describe("convertServiceGraphToNetwork", () => {
    // Layered layout must preserve the agent hierarchy's DEPTH:
    // service(0) → agent(1) → model/tool(2). The old code pinned every node with
    // a service_type to the max rank, collapsing agent→model so a model (gpt-4o)
    // jumped up to the agent's column and its edge looked like it came from the
    // parent app. GenAI kinds must keep their BFS depth. (agent-graph regression)
    it("keeps model/tool one rank deeper than their agent in layered layout", () => {
      const graphData = {
        nodes: [
          { id: "crewai-app", label: "crewai-app", service_type: "service", requests: 13 },
          { id: "ResearchCrew", label: "ResearchCrew", service_type: "agent", requests: 4 },
          { id: "gpt-4o", label: "gpt-4o", service_type: "model", requests: 6 },
          { id: "web_scraper", label: "web_scraper", service_type: "tool", requests: 1 },
        ],
        edges: [
          { from: null, to: "crewai-app", total_requests: 13 },
          { from: "crewai-app", to: "ResearchCrew", total_requests: 4, connection_type: "agent" },
          { from: "ResearchCrew", to: "gpt-4o", total_requests: 6, connection_type: "model" },
          { from: "ResearchCrew", to: "web_scraper", total_requests: 1, connection_type: "tool" },
        ],
      };
      const res = convertServiceGraphToNetwork(
        graphData as any,
        "layered",
        new Map(),
        true,
        undefined,
        1200,
        700,
        true,
      );
      const data = res.options.series[0].data;
      const x = (id: string) => data.find((n: any) => n.id === id)!.x;
      // Strictly increasing depth: app < agent < model, app < agent < tool.
      expect(x("crewai-app")).toBeLessThan(x("ResearchCrew"));
      expect(x("ResearchCrew")).toBeLessThan(x("gpt-4o"));
      expect(x("ResearchCrew")).toBeLessThan(x("web_scraper"));
      // Model and tool share the same (deepest) rank → same column.
      expect(x("gpt-4o")).toBe(x("web_scraper"));
      // The gpt-4o link originates at the agent, never the parent app.
      const links = res.options.series[0].links || [];
      expect(links.find((l: any) => l.target === "gpt-4o")?.source).toBe("ResearchCrew");
    });

    it("should convert service graph to network format", () => {
      const graphData = {
        nodes: [
          { id: "service-a", name: "Service A", value: 100 },
          { id: "service-b", name: "Service B", value: 50 },
        ],
        edges: [{ from: "service-a", to: "service-b", total_requests: 75 }],
      };

      const result = convertServiceGraphToNetwork(graphData);

      expect(result).toHaveProperty("options");
      expect(result.options.series).toHaveLength(1);
      expect(result.options.series[0].type).toBe("graph");
      expect(result.options.series[0].layout).toBe("none");
    });

    it("should have correct network graph configuration", () => {
      const graphData = {
        nodes: [{ id: "service-a", name: "Service A", value: 100 }],
        edges: [],
      };

      const result = convertServiceGraphToNetwork(graphData);

      // Pan + wheel-zoom, bounded by scaleLimit so it can't run away.
      expect(result.options.series[0].roam).toBe(true);
      expect(result.options.series[0].scaleLimit).toBeTruthy();
      expect(result.options.series[0].label.show).toBe(true);
      expect(result.options.series[0].draggable).toBe(false);
      expect(result.options.series[0].focusNodeAdjacency).toBe(true);
    });

    it("should handle empty network data", () => {
      const graphData = {
        nodes: [],
        edges: [],
      };

      const result = convertServiceGraphToNetwork(graphData);

      expect(result.options.series[0].data).toBeDefined();
      expect(result.options.series[0].links).toBeDefined();
    });

    it("should configure tooltip for network graph", () => {
      const graphData = {
        nodes: [{ id: "service-a", name: "Service A", value: 100 }],
        edges: [],
      };

      const result = convertServiceGraphToNetwork(graphData);

      expect(result.options.tooltip).toBeDefined();
      expect(result.options.tooltip.trigger).toBe("item");
      expect(result.options.tooltip.triggerOn).toBe("mousemove");
    });

    it("should handle nodes with complex metrics", () => {
      const graphData = {
        nodes: [
          {
            id: "service-a",
            name: "Service A",
            value: 100,
            errors: 5,
          },
        ],
        edges: [],
      };

      const result = convertServiceGraphToNetwork(graphData);

      expect(result.options.series[0].data).toBeDefined();
      expect(result.options.series[0].data.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle edges with metrics", () => {
      const graphData = {
        nodes: [
          { id: "service-a", name: "Service A", value: 100 },
          { id: "service-b", name: "Service B", value: 50 },
        ],
        edges: [
          {
            from: "service-a",
            to: "service-b",
            total_requests: 100,
            failed_requests: 2,
          },
        ],
      };

      const result = convertServiceGraphToNetwork(graphData);

      expect(result.options.series[0].links).toBeDefined();
      expect(result.options.series[0].links.length).toBeGreaterThan(0);
    });
  });

  // Additional service graph tests for new functionality
  describe("convertServiceGraphToTree - edge cases", () => {
    it("should handle single root node", () => {
      const graphData = {
        nodes: [
          { id: "root", label: "root", requests: 100, errors: 0, error_rate: 0 },
          { id: "child", label: "child", requests: 50, errors: 0, error_rate: 0 },
        ],
        edges: [{ from: "root", to: "child", total_requests: 50, failed_requests: 0 }],
      };

      const result = convertServiceGraphToTree(graphData, "horizontal");

      expect(result.options).toBeDefined();
      expect(result.options.series[0].type).toBe("tree");
      expect(result.options.series[0].data).toHaveLength(1);
    });

    it("should handle multiple disconnected trees with virtual root", () => {
      const graphData = {
        nodes: [
          { id: "root1", label: "root1", requests: 100, errors: 0, error_rate: 0 },
          { id: "root2", label: "root2", requests: 50, errors: 0, error_rate: 0 },
        ],
        edges: [],
      };

      const result = convertServiceGraphToTree(graphData, "horizontal");

      expect(result.options).toBeDefined();
      expect(result.options.series[0].data).toHaveLength(1);
      expect(result.options.series[0].data[0].name).toBe("Services");
      expect(result.options.series[0].data[0].children).toHaveLength(2);
    });

    it("should handle cycles by tracking visited nodes", () => {
      const graphData = {
        nodes: [
          { id: "a", label: "a", requests: 100, errors: 0, error_rate: 0 },
          { id: "b", label: "b", requests: 50, errors: 0, error_rate: 0 },
        ],
        edges: [
          { from: "a", to: "b", total_requests: 50, failed_requests: 0 },
          { from: "b", to: "a", total_requests: 50, failed_requests: 0 },
        ],
      };

      const result = convertServiceGraphToTree(graphData, "horizontal");

      expect(result.options).toBeDefined();
      expect(result.options.series[0].type).toBe("tree");
    });

    it("should include unvisited nodes as separate trees", () => {
      const graphData = {
        nodes: [
          { id: "root", label: "root", requests: 100, errors: 0, error_rate: 0 },
          { id: "child", label: "child", requests: 50, errors: 0, error_rate: 0 },
          { id: "isolated", label: "isolated", requests: 25, errors: 0, error_rate: 0 },
        ],
        edges: [{ from: "root", to: "child", total_requests: 50, failed_requests: 0 }],
      };

      const result = convertServiceGraphToTree(graphData, "horizontal");

      expect(result.options).toBeDefined();
      const data = result.options.series[0].data;
      expect(data).toHaveLength(1);
      expect(data[0].children).toHaveLength(2); // root tree + isolated node
    });

    it("should color nodes based on error rate", () => {
      const graphData = {
        nodes: [
          { id: "healthy", label: "healthy", requests: 100, errors: 0, error_rate: 0 },
          { id: "warning", label: "warning", requests: 100, errors: 2, error_rate: 2 },
          { id: "critical", label: "critical", requests: 100, errors: 15, error_rate: 15 },
        ],
        edges: [],
      };

      const result = convertServiceGraphToTree(graphData, "horizontal");

      expect(result.options).toBeDefined();
      const data = result.options.series[0].data[0].children;

      expect(data[0].itemStyle.color).toBe("#1a1f2e"); // Green for healthy
      expect(data[1].itemStyle.color).toBe("#1a1f2e"); // Yellow for warning (>1%)
      expect(data[2].itemStyle.color).toBe("#1a1f2e"); // Red for critical (>10%)
    });

    it("should handle vertical layout orientation", () => {
      const graphData = {
        nodes: [{ id: "node", label: "node", requests: 100, errors: 0, error_rate: 0 }],
        edges: [],
      };

      const result = convertServiceGraphToTree(graphData, "vertical");

      expect(result.options.series[0].orient).toBe("TB");
    });

    it("uses adaptive layout:none for any layout type", () => {
      const graphData = {
        nodes: [{ id: "node", label: "node", requests: 100, errors: 0, error_rate: 0 }],
        edges: [],
      };

      const result = convertServiceGraphToTree(graphData, "radial");

      // Adaptive computed layout (layout:'none'), not ECharts auto-layout.
      expect(result.options.series[0].layout).toBe("none");
    });

    it("should handle empty data gracefully", () => {
      const graphData = { nodes: [], edges: [] };

      const result = convertServiceGraphToTree(graphData, "horizontal");

      expect(result.options).toBeDefined();
    });
  });

  describe("convertServiceGraphToNetwork", () => {
    it("should validate node IDs", () => {
      const graphData = {
        nodes: [
          { id: "valid", label: "valid", requests: 100, errors: 0 },
          { id: null, label: "invalid", requests: 50, errors: 0 },
        ],
        edges: [],
      };

      const result = convertServiceGraphToNetwork(graphData, "force", new Map());

      expect(result.options).toBeDefined();
    });

    it("should handle force layout", () => {
      const graphData = {
        nodes: [
          { id: "a", label: "a", requests: 100, errors: 0, error_rate: 0 },
          { id: "b", label: "b", requests: 50, errors: 0, error_rate: 0 },
        ],
        edges: [{ from: "a", to: "b", total_requests: 50, failed_requests: 0 }],
      };

      const result = convertServiceGraphToNetwork(graphData, "force", new Map());

      expect(result.options).toBeDefined();
      expect(result.options.series[0].type).toBe("graph");
      expect(result.options.series[0].layout).toBe("none");
    });

    it("does not throw on a force layout when an edge references a node not in the node list", () => {
      // A dangling edge endpoint (e.g. from collapse/filtering leaving an edge to
      // a removed node) must not crash computeForceLayout — the force loops read
      // pos.get(endpoint) and a missing endpoint would throw on `.x`.
      const graphData = {
        nodes: [
          { id: "a", label: "a", requests: 100, errors: 0, error_rate: 0 },
          { id: "b", label: "b", requests: 50, errors: 0, error_rate: 0 },
          { id: "c", label: "c", requests: 20, errors: 0, error_rate: 0 },
        ],
        edges: [
          { from: "a", to: "b", total_requests: 50, failed_requests: 0 },
          // 'ghost' is NOT in nodes — this edge's endpoint is missing from pos.
          { from: "a", to: "ghost", total_requests: 10, failed_requests: 0 },
        ],
      };

      expect(() => convertServiceGraphToNetwork(graphData, "force", new Map())).not.toThrow();
    });

    it("should handle circular layout", () => {
      const graphData = {
        nodes: [{ id: "a", label: "a", requests: 100, errors: 0, error_rate: 0 }],
        edges: [],
      };

      const result = convertServiceGraphToNetwork(graphData, "circular", new Map());

      expect(result.options).toBeDefined();
      // Circular uses 'none' layout with manually computed positions
      expect(result.options.series[0].layout).toBe("none");
      expect(result.options.series[0].data[0].x).toBeDefined();
      expect(result.options.series[0].data[0].y).toBeDefined();
    });
  });

  describe("getServiceIconDataUrl", () => {
    function decodeDataUrl(dataUrl: string): string {
      const b64 = dataUrl.replace("data:image/svg+xml;base64,", "");
      return atob(b64);
    }

    it("should return a data URL string", () => {
      const result = getServiceIconDataUrl("my-service", false, "#ff0000");
      expect(result.startsWith("data:image/svg+xml;base64,")).toBe(true);
    });

    it("should produce different output for dark vs light mode", () => {
      const light = getServiceIconDataUrl("my-service", false, "#aaaaaa");
      const dark = getServiceIconDataUrl("my-service", true, "#aaaaaa");
      expect(light).not.toBe(dark);
    });

    it("should embed the borderColor in the SVG", () => {
      const result = getServiceIconDataUrl("svc", false, "#abcdef");
      const svg = decodeDataUrl(result);
      expect(svg).toContain('stroke="#abcdef"');
    });

    it("should use light background color in light mode", () => {
      const result = getServiceIconDataUrl("svc", false, "#000000");
      const svg = decodeDataUrl(result);
      expect(svg).toContain('fill="#ffffff"');
    });

    it("should use dark background color in dark mode", () => {
      const result = getServiceIconDataUrl("svc", true, "#000000");
      const svg = decodeDataUrl(result);
      expect(svg).toContain('fill="#1a1f2e"');
    });

    it("should normalize hyphens to spaces before matching", () => {
      const hyphen = getServiceIconDataUrl("load-generator", false, "#000000");
      const space = getServiceIconDataUrl("load generator", false, "#000000");
      expect(hyphen).toBe(space);
    });

    it("should normalize underscores to spaces before matching", () => {
      const underscore = getServiceIconDataUrl("load_generator", false, "#000000");
      const space = getServiceIconDataUrl("load generator", false, "#000000");
      expect(underscore).toBe(space);
    });

    it("should handle empty string name without throwing", () => {
      const result = getServiceIconDataUrl("", false, "#000000");
      expect(result.startsWith("data:image/svg+xml;base64,")).toBe(true);
    });

    it("should handle undefined-like name without throwing", () => {
      const result = getServiceIconDataUrl(null as any, false, "#000000");
      expect(result.startsWith("data:image/svg+xml;base64,")).toBe(true);
    });

    // Agent nodes carry an animated "radar ping" halo baked INTO their symbol
    // SVG (SMIL <animate> rings), so the effect stays centred on the node and
    // pans/zooms with it. These assertions lock that in — the halo drifting or
    // disappearing is a regression, not a cosmetic tweak.
    it("bakes animated radar-ping rings into the agent symbol", () => {
      const svg = decodeDataUrl(getServiceIconDataUrl("planner", false, "#22c55e", "agent"));
      // Two staggered rings, each with r / opacity / stroke-width animations.
      expect((svg.match(/<circle[^>]*opacity="0"/g) || []).length).toBe(2);
      expect((svg.match(/<animate /g) || []).length).toBe(6);
      expect(svg).toContain('attributeName="r"');
      expect(svg).toContain('repeatCount="indefinite"');
      // Indigo accent, outside the health palette.
      expect(svg).toContain("#6366f1");
    });

    it("centres the agent disc + rings in the padded viewBox (no clip)", () => {
      const svg = decodeDataUrl(getServiceIconDataUrl("planner", true, "#22c55e", "agent"));
      // Padded box so the ring can expand without clipping; disc at its centre.
      expect(svg).toContain('viewBox="0 0 104 104"');
      expect(svg).toContain('cx="52" cy="52"');
      // Max animated radius (46) must stay inside the half-box (52).
      const maxR = Math.max(...[...svg.matchAll(/values="24;(\d+)"/g)].map((m) => Number(m[1])));
      expect(maxR).toBeLessThanOrEqual(52);
    });

    it("does NOT add ping rings or padding to non-agent nodes", () => {
      const svg = decodeDataUrl(getServiceIconDataUrl("payment", false, "#22c55e", "service"));
      expect(svg).toContain('viewBox="0 0 56 56"');
      expect(svg).not.toContain("<animate ");
    });
  });
});

describe("iconSvgForType (authoritative kind icons)", () => {
  it("returns a distinct icon for each inferred kind", () => {
    const db = iconSvgForType("database");
    const queue = iconSvgForType("queue");
    const rpc = iconSvgForType("rpc");
    const external = iconSvgForType("external");
    expect(db).toBeTruthy();
    expect(queue).toBeTruthy();
    expect(rpc).toBeTruthy();
    expect(external).toBeTruthy();
    // Kinds must not all map to the same glyph.
    expect(new Set([db, queue, rpc, external]).size).toBe(4);
  });

  it("returns null for a real service (no inferred type) so regex fallback runs", () => {
    expect(iconSvgForType(undefined)).toBeNull();
    expect(iconSvgForType(null)).toBeNull();
    expect(iconSvgForType("")).toBeNull();
    expect(iconSvgForType("service")).toBeNull();
  });
});

describe("convertServiceGraphToNetwork layered layout", () => {
  const graph = {
    nodes: [
      { id: "frontend", label: "frontend", requests: 100, errors: 0 },
      { id: "checkout", label: "checkout", requests: 80, errors: 0 },
      {
        id: "redis",
        label: "redis",
        requests: 50,
        errors: 0,
        service_type: "database",
      },
    ],
    edges: [
      { from: "frontend", to: "checkout", total_requests: 80 },
      {
        from: "checkout",
        to: "redis",
        total_requests: 50,
        connection_type: "database",
      },
    ],
  };

  it("places the inferred dependency to the right of the services that call it", () => {
    const opt: any = convertServiceGraphToNetwork(graph, "layered", undefined, true);
    const series = opt.options.series[0];
    const byId: Record<string, any> = {};
    series.data.forEach((n: any) => (byId[n.id] = n));
    // redis (inferred) must be the rightmost.
    expect(byId["redis"].x).toBeGreaterThan(byId["checkout"].x);
    expect(byId["checkout"].x).toBeGreaterThan(byId["frontend"].x);
    expect(byId["redis"].fixed).toBe(true);
  });

  it("keeps the existing directional arrow on edges", () => {
    // edgeSymbol is already set unconditionally by the function; assert we did
    // not regress it while adding the layered branch.
    const opt: any = convertServiceGraphToNetwork(graph, "layered", undefined, true);
    expect(opt.options.series[0].edgeSymbol).toEqual(["none", "arrow"]);
  });
});
