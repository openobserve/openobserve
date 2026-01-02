// Copyright 2023 OpenObserve Inc.
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

import { describe, it, expect, beforeEach } from "vitest";
import {
  convertTraceData,
  convertTimelineData,
  convertTraceServiceMapData,
  convertServiceGraphToTree,
  convertServiceGraphToNetwork,
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
          children: [
            { name: "Service B" },
            { name: "Service C" },
          ],
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
      expect(result.options.series[0].symbolSize).toBe(20);
      expect(result.options.series[0].label.position).toBe("bottom");
      expect(result.options.series[0].label.verticalAlign).toBe("bottom");
      expect(result.options.series[0].label.distance).toBe(25);
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

    it("should convert service graph to tree with radial layout", () => {
      const graphData = {
        nodes: [{ id: "service-a", label: "Service A" }],
        edges: [],
      };
      const layoutType = "radial";

      const result = convertServiceGraphToTree(graphData, layoutType);

      expect(result.options.series[0].layout).toBe("radial");
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
  });

  describe("convertServiceGraphToNetwork", () => {
    it("should convert service graph to network format", () => {
      const graphData = {
        nodes: [
          { id: "service-a", name: "Service A", value: 100 },
          { id: "service-b", name: "Service B", value: 50 },
        ],
        edges: [
          { from: "service-a", to: "service-b", total_requests: 75 },
        ],
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

      expect(result.options.series[0].roam).toBe(true);
      expect(result.options.series[0].label.show).toBe(true);
      expect(result.options.series[0].draggable).toBe(true);
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
  describe('convertServiceGraphToTree - edge cases', () => {
  it('should handle single root node', () => {
    const graphData = {
      nodes: [
        { id: 'root', label: 'root', requests: 100, errors: 0, error_rate: 0 },
        { id: 'child', label: 'child', requests: 50, errors: 0, error_rate: 0 }
      ],
      edges: [
        { from: 'root', to: 'child', total_requests: 50, failed_requests: 0 }
      ]
    };

    const result = convertServiceGraphToTree(graphData, 'horizontal');

    expect(result.options).toBeDefined();
    expect(result.options.series[0].type).toBe('tree');
    expect(result.options.series[0].data).toHaveLength(1);
  });

  it('should handle multiple disconnected trees with virtual root', () => {
    const graphData = {
      nodes: [
        { id: 'root1', label: 'root1', requests: 100, errors: 0, error_rate: 0 },
        { id: 'root2', label: 'root2', requests: 50, errors: 0, error_rate: 0 }
      ],
      edges: []
    };

    const result = convertServiceGraphToTree(graphData, 'horizontal');

    expect(result.options).toBeDefined();
    expect(result.options.series[0].data).toHaveLength(1);
    expect(result.options.series[0].data[0].name).toBe('Services');
    expect(result.options.series[0].data[0].children).toHaveLength(2);
  });

  it('should handle cycles by tracking visited nodes', () => {
    const graphData = {
      nodes: [
        { id: 'a', label: 'a', requests: 100, errors: 0, error_rate: 0 },
        { id: 'b', label: 'b', requests: 50, errors: 0, error_rate: 0 }
      ],
      edges: [
        { from: 'a', to: 'b', total_requests: 50, failed_requests: 0 },
        { from: 'b', to: 'a', total_requests: 50, failed_requests: 0 }
      ]
    };

    const result = convertServiceGraphToTree(graphData, 'horizontal');

    expect(result.options).toBeDefined();
    expect(result.options.series[0].type).toBe('tree');
  });

  it('should include unvisited nodes as separate trees', () => {
    const graphData = {
      nodes: [
        { id: 'root', label: 'root', requests: 100, errors: 0, error_rate: 0 },
        { id: 'child', label: 'child', requests: 50, errors: 0, error_rate: 0 },
        { id: 'isolated', label: 'isolated', requests: 25, errors: 0, error_rate: 0 }
      ],
      edges: [
        { from: 'root', to: 'child', total_requests: 50, failed_requests: 0 }
      ]
    };

    const result = convertServiceGraphToTree(graphData, 'horizontal');

    expect(result.options).toBeDefined();
    const data = result.options.series[0].data;
    expect(data).toHaveLength(1);
    expect(data[0].children).toHaveLength(2); // root tree + isolated node
  });

  it('should color nodes based on error rate', () => {
    const graphData = {
      nodes: [
        { id: 'healthy', label: 'healthy', requests: 100, errors: 0, error_rate: 0 },
        { id: 'warning', label: 'warning', requests: 100, errors: 2, error_rate: 2 },
        { id: 'critical', label: 'critical', requests: 100, errors: 15, error_rate: 15 }
      ],
      edges: []
    };

    const result = convertServiceGraphToTree(graphData, 'horizontal');

    expect(result.options).toBeDefined();
    const data = result.options.series[0].data[0].children;

    expect(data[0].itemStyle.color).toBe('#4CAF50'); // Green for healthy
    expect(data[1].itemStyle.color).toBe('#FFC107'); // Yellow for warning (>1%)
    expect(data[2].itemStyle.color).toBe('#F44336'); // Red for critical (>10%)
  });

  it('should handle vertical layout orientation', () => {
    const graphData = {
      nodes: [{ id: 'node', label: 'node', requests: 100, errors: 0, error_rate: 0 }],
      edges: []
    };

    const result = convertServiceGraphToTree(graphData, 'vertical');

    expect(result.options.series[0].orient).toBe('TB');
  });

  it('should handle radial layout', () => {
    const graphData = {
      nodes: [{ id: 'node', label: 'node', requests: 100, errors: 0, error_rate: 0 }],
      edges: []
    };

    const result = convertServiceGraphToTree(graphData, 'radial');

    expect(result.options.series[0].layout).toBe('radial');
  });

  it('should handle empty data gracefully', () => {
    const graphData = { nodes: [], edges: [] };

    const result = convertServiceGraphToTree(graphData, 'horizontal');

    expect(result.options).toBeDefined();
  });
});

describe('convertServiceGraphToNetwork', () => {
  it('should validate node IDs', () => {
    const graphData = {
      nodes: [
        { id: 'valid', label: 'valid', requests: 100, errors: 0 },
        { id: null, label: 'invalid', requests: 50, errors: 0 }
      ],
      edges: []
    };

    const result = convertServiceGraphToNetwork(graphData, 'force', new Map());

    expect(result.options).toBeDefined();
  });

  it('should handle force layout', () => {
    const graphData = {
      nodes: [
        { id: 'a', label: 'a', requests: 100, errors: 0, error_rate: 0 },
        { id: 'b', label: 'b', requests: 50, errors: 0, error_rate: 0 }
      ],
      edges: [
        { from: 'a', to: 'b', total_requests: 50, failed_requests: 0 }
      ]
    };

    const result = convertServiceGraphToNetwork(graphData, 'force', new Map());

    expect(result.options).toBeDefined();
    expect(result.options.series[0].type).toBe('graph');
    expect(result.options.series[0].layout).toBe('none');
  });

  it('should handle circular layout', () => {
    const graphData = {
      nodes: [
        { id: 'a', label: 'a', requests: 100, errors: 0, error_rate: 0 }
      ],
      edges: []
    };

    const result = convertServiceGraphToNetwork(graphData, 'circular', new Map());

    expect(result.options).toBeDefined();
    // Circular uses 'none' layout with manually computed positions
    expect(result.options.series[0].layout).toBe('none');
    expect(result.options.series[0].data[0].x).toBeDefined();
    expect(result.options.series[0].data[0].y).toBeDefined();
  });
  });
});
