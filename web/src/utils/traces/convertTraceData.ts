import { toZonedTime } from "date-fns-tz";
export const convertTraceData = (props: any, timezone: string) => {
  const options: any = {
    backgroundColor: "transparent",
    grid: {
      containLabel: true,
      left: "20",
      right: "20",
      top: "30",
      bottom: "0",
    },
    tooltip: {
      show: true,
      trigger: "axis",
      textStyle: {
        fontSize: 12,
      },
      axisPointer: {
        type: "cross",
        label: {
          show: true,
          fontsize: 12,
          formatter: (name: any) => {
            if (name.axisDimension == "x")
              return `${formatDate(new Date(name.value))}`;
            else return `${name?.value?.toFixed(2)}ms`;
          },
        },
      },
      formatter: function (name: any) {
        if (name.length == 0) return "";
        const date = new Date(name[0].data[0]);

        const options: any = {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          hourCycle: "h23", // Use a 24-hour cycle format without a day period.
          minute: "2-digit",
          second: "2-digit",
        };

        const formatter = new Intl.DateTimeFormat("en-US", options);
        const formattedDate = formatter.format(new Date(date));
        return `(${formattedDate} ${timezone}, <b>${name[0].value[1]}</b>)`;
      },
    },
    xAxis: {
      type: "time",
    },
    yAxis: {
      type: "value",
      axisLine: {
        show: true,
      },
      axisLabel: {
        formatter: function (name: any) {
          return `${name} ms`;
        },
      },
    },
    toolbox: {
      orient: "vertical",
      show: true,
      showTitle: false,
      tooltip: {
        show: false,
      },
      itemSize: 0,
      itemGap: 0,
      // it is used to hide toolbox buttons
      bottom: "100%",
      feature: {
        dataZoom: {
          show: true,
          yAxisIndex: "none",
        },
      },
    },
    series: [
      {
        data: [...(props.data[0]?.x || [])]?.map((it: any, index: any) => [
          timezone != "UTC" ? toZonedTime(it, timezone) : it,
          props.data[0]?.y[index] || 0,
        ]),
        type: "scatter",
        emphasis: { focus: "series" },
        symbolSize: 5,
        itemStyle: {
          color: "#7A80C2",
        },
      },
    ],
  };
  return { options };
};

export const convertTimelineData = (props: any) => {
  const options = {
    dataZoom: [
      {
        type: "slider",
        xAxisIndex: 0,
        filterMode: "none",
        height: 20,
        bottom: 20,
        showDetail: false,
      },
    ],
    grid: {
      containLabel: true,
      left: "20",
      right: "20",
      top: "30",
      bottom: "40",
    },
    yAxis: {
      type: "category",
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
    },
    xAxis: {
      type: "value",
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        formatter: (params: any) => {
          return params + "ms";
        },
      },
    },
    series: [
      {
        type: "bar",
        stack: "Total",
        silent: true,
        itemStyle: {
          borderColor: "transparent",
          color: "transparent",
        },
        emphasis: {
          itemStyle: {
            borderColor: "transparent",
            color: "transparent",
          },
        },
        data: props.value.data.map((it: any) => it.x0),
      },
      {
        type: "bar",
        stack: "Total",
        barWidth: "100%",
        barCategoryGap: "0%",
        data: props.value.data.map((it: any) => ({
          value: it.x1 - it.x0,
          itemStyle: { color: it.fillcolor },
        })),
      },
    ],
  };
  return { options };
};

export const convertTraceServiceMapData = (
  data: any,
  treeDepth: number = 3,
) => {
  const options = {
    tooltip: {
      show: false,
    },
    series: [
      {
        type: "tree",
        data: data,
        symbolSize: 30,
        initialTreeDepth: treeDepth,
        roam: true,
        expandAndCollapse: false,
        label: {
          position: "bottom",
          verticalAlign: "bottom",
          distance: 26,
          fontSize: 12,
        },
      },
    ],
  };
  return { options };
};

/**
 * Convert service graph data (nodes/edges) to ECharts tree format
 * @param graphData - Object containing nodes and edges arrays
 * @param layoutType - Layout orientation: 'horizontal' | 'vertical'
 * @param isDarkMode - Whether dark mode is active
 * @returns ECharts tree options
 */
export const convertServiceGraphToTree = (
  graphData: { nodes: any[]; edges: any[] },
  layoutType: string = "horizontal",
  isDarkMode: boolean = true,
) => {
  // Build adjacency map for edges
  const edgesMap = new Map<string, any[]>();
  graphData.edges.forEach((edge: any) => {
    if (!edgesMap.has(edge.from)) {
      edgesMap.set(edge.from, []);
    }
    edgesMap.get(edge.from)!.push(edge);
  });

  // Build reverse adjacency map (incoming edges)
  const incomingEdgesMap = new Map<string, any[]>();
  graphData.edges.forEach((edge: any) => {
    if (!incomingEdgesMap.has(edge.to)) {
      incomingEdgesMap.set(edge.to, []);
    }
    incomingEdgesMap.get(edge.to)!.push(edge);
  });

  // Find all root nodes (nodes with no incoming edges)
  const nodesWithIncoming = new Set(graphData.edges.map((e: any) => e.to));
  const rootNodes = graphData.nodes.filter(
    (n: any) => !nodesWithIncoming.has(n.id),
  );

  const green = isDarkMode ? "#10b981" : "#52c41a";

  // Node color: same absolute thresholds as Graph View so color matches tooltip error rate
  const getNodeColor = (errRate: number): string => {
    if (errRate > 10) return isDarkMode ? "#ef4444" : "#f5222d"; // Red — critical
    if (errRate > 5) return isDarkMode ? "#f97316" : "#fa8c16"; // Orange — warning
    if (errRate > 1) return isDarkMode ? "#fbbf24" : "#faad14"; // Yellow — degraded
    return green;
  };

  // Track all visited nodes across all trees to find orphaned components
  const globalVisited = new Set<string>();

  // Helper to build tree recursively
  // incomingEdge: the edge that led to this node (for direction-aware metrics)
  const buildTree = (
    nodeId: string,
    visited = new Set<string>(),
    incomingEdge: any = null,
  ): any => {
    if (visited.has(nodeId)) return null; // Prevent cycles
    visited.add(nodeId);
    globalVisited.add(nodeId);

    const node = graphData.nodes.find((n: any) => n.id === nodeId);
    if (!node) return null;

    const outgoingEdges = edgesMap.get(nodeId) || [];
    const children = outgoingEdges
      .map((edge: any) => buildTree(edge.to, new Set(visited), edge))
      .filter((child: any) => child !== null);

    // Direction-aware request count based on tree position
    let totalRequests: number;

    if (incomingEdge) {
      // Non-root: show traffic via this specific edge from parent
      totalRequests = incomingEdge.total_requests ?? 0;
    } else {
      // Root: sum of outgoing edges
      totalRequests = outgoingEdges.reduce(
        (sum: number, edge: any) => sum + (edge.total_requests ?? 0),
        0,
      );

      // If no edges, fall back to node's own metrics
      if (totalRequests === 0 && node.requests !== undefined) {
        totalRequests = node.requests;
      }
    }

    // Node border: colored by this node's error rate relative to baseline
    const nodeErrorRate =
      node.error_rate ??
      (node.requests > 0 ? (node.errors / node.requests) * 100 : 0);
    const borderColor = getNodeColor(nodeErrorRate);

    // Tree edges are always neutral gray — color belongs on node borders only
    const edgeColor = isDarkMode ? "#4a5568" : "#b0b7c3";

    // Reuse the same SVG icon as graph view (circle + service-type icon)
    const iconDataUrl = getServiceIconSvg(node.id, isDarkMode, borderColor);

    return {
      name: node.label || node.id,
      value: totalRequests,
      symbol: iconDataUrl,
      symbolSize: 30, // Fixed size so ECharts tree layout spaces nodes consistently
      lineStyle: {
        color: edgeColor,
        width: 2,
      },
      itemStyle: {
        color: isDarkMode ? "#1a1f2e" : "#ffffff",
        borderColor: borderColor,
        borderWidth: 4,
        shadowBlur: 10,
        shadowColor: isDarkMode ? "rgba(0, 0, 0, 0.3)" : "rgba(0, 0, 0, 0.1)",
        shadowOffsetX: 0,
        shadowOffsetY: 0,
      },
      emphasis: {
        scale: true,
        scaleSize: 1.15,
        itemStyle: {
          shadowBlur: 20,
          shadowColor: isDarkMode ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.3)",
        },
        label: {
          show: true,
          fontSize: 12,
          fontWeight: "bold",
        },
      },
      select: {
        // Persistent selection styling - matches graph view
        itemStyle: {
          borderColor: borderColor,
          borderWidth: 5,
          shadowBlur: 45,
          shadowColor: "rgba(59, 130, 246, 0.9)", // Prominent blue glow for selected
          shadowOffsetX: 0,
          shadowOffsetY: 0,
        },
        label: {
          show: true,
          fontSize: 12,
          fontWeight: "bold",
        },
      },
      label: {
        show: true,
        position: layoutType === "vertical" ? "bottom" : "right",
        distance: 6,
        formatter: (params: any) => {
          return `{name|${params.name}}\n{requests|${formatNumber(totalRequests)} req}`;
        },
        rich: {
          name: {
            fontSize: 12,
            fontWeight: "600",
            color: isDarkMode ? "#e4e7eb" : "#1f2937",
            lineHeight: 16,
          },
          requests: {
            fontSize: 10,
            fontWeight: "normal",
            color: isDarkMode ? "#9ca3af" : "#6b7280",
            lineHeight: 14,
          },
        },
      },
      children: children.length > 0 ? children : undefined,
    };
  };

  // Start with root nodes
  let treeData = rootNodes
    .map((node: any) => buildTree(node.id))
    .filter((n: any) => n !== null);

  // Find unvisited nodes (disconnected components or cycles)
  const unvisitedNodes = graphData.nodes.filter(
    (n: any) => !globalVisited.has(n.id),
  );

  // Add unvisited nodes as separate root trees
  if (unvisitedNodes.length > 0) {
    const additionalTrees = unvisitedNodes
      .map((node: any) => buildTree(node.id))
      .filter((n: any) => n !== null);
    treeData = [...treeData, ...additionalTrees];
  }

  // If still no tree data, create a flat structure
  if (treeData.length === 0 && graphData.nodes.length > 0) {
    return {
      backgroundColor: "transparent", // Make chart background transparent to match graph view
      tooltip: { show: true, trigger: "item", hideDelay: 0, enterable: false },
      series: [
        {
          type: "tree",
          data: graphData.nodes.map((node: any) => ({
            name: node.label || node.id,
            value: 0,
            symbolSize: Math.max(
              40,
              Math.min(80, Math.log10((node.requests || 0) + 1) * 20),
            ),
            itemStyle: {
              color: isDarkMode ? "#1a1f2e" : "#ffffff",
              borderColor: "#9E9E9E",
              borderWidth: 4,
              shadowBlur: 10,
              shadowColor: isDarkMode
                ? "rgba(0, 0, 0, 0.3)"
                : "rgba(0, 0, 0, 0.1)",
            },
          })),
          layout: "orthogonal",
          orient: layoutType === "vertical" ? "TB" : "LR",
          initialTreeDepth: -1,
          symbolSize: 50,
          roam: true, // Enable panning and zooming
          selectedMode: "single", // Enable single node selection
          label: {
            position: "inside",
            fontSize: 11,
          },
        },
      ],
    };
  }

  // ECharts tree needs a single root - create virtual root if multiple trees
  const finalTreeData =
    treeData.length > 1
      ? [
          {
            name: "Services",
            symbolSize: 1,
            itemStyle: { opacity: 0 },
            label: { show: false },
            children: treeData,
          },
        ]
      : treeData;

  const options = {
    backgroundColor: "transparent", // Make chart background transparent to match graph view
    tooltip: {
      show: false, // Disabled — custom edge tooltips in ServiceGraph.vue handle this
    },
    series: [
      {
        type: "tree",
        data: finalTreeData,
        layout: "orthogonal",
        orient: layoutType === "vertical" ? "TB" : "LR",
        // Maximize layout space so siblings spread further apart
        left: layoutType === "vertical" ? "2%" : "3%",
        right: layoutType === "vertical" ? "2%" : "20%",
        top: layoutType === "vertical" ? "8%" : "2%",
        bottom: layoutType === "vertical" ? "8%" : "2%",
        initialTreeDepth: -1,
        symbolSize: 30,
        roam: true,
        selectedMode: "single",
        label: {
          position: layoutType === "vertical" ? "bottom" : "right",
          distance: 6,
          fontSize: 12,
          rotate: 0,
        },
        leaves: {
          label: {
            position: layoutType === "vertical" ? "bottom" : "right",
            distance: 6,
            fontSize: 12,
            rotate: 0,
          },
        },
        emphasis: {
          focus: "relative", // dims nodes not connected to the hovered node
        },
        blur: {
          itemStyle: { opacity: 0.15 },
          label: { opacity: 0.15 },
          lineStyle: { opacity: 0.08 },
        },
        expandAndCollapse: false,
        animationDuration: 550,
        animationDurationUpdate: 750,
      },
    ],
  };

  return { options, positions: null };
};

/**
 * Fruchterman-Reingold force-directed layout.
 *
 * Produces the organic, well-spread graph layout used by tools like DataDog.
 * No external dependencies — runs as a pure-JS physics simulation.
 *
 * Algorithm:
 *  1. Initialise nodes in a circle (avoids singularities).
 *  2. Iterate: repel all node pairs, attract connected pairs.
 *  3. Clamp each step by a temperature that cools each iteration.
 *  4. Normalise final bounding box → canvas with padding.
 */
const computeForceLayout = (
  nodes: any[],
  edges: any[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> => {
  const PAD_LEFT = 110;
  const PAD_RIGHT = 220; // extra right padding for label text overflow
  const PAD_TOP = 110;
  const PAD_BOTTOM = 200; // extra bottom padding so bottom-positioned labels don't clip
  const W = width - PAD_LEFT - PAD_RIGHT;
  const H = height - PAD_TOP - PAD_BOTTOM;
  const n = nodes.length;

  if (n === 0) return new Map();
  if (n === 1) return new Map([[nodes[0].id, { x: width / 2, y: height / 2 }]]);

  // Optimal spring length: scales with canvas area / node count
  const k = Math.sqrt((W * H) / n) * 1.0;

  // ── 1. Initialise on a circle to avoid singularities ─────────────────────
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n;
    const r = Math.min(W, H) * 0.32;
    pos.set(node.id, {
      x: W / 2 + r * Math.cos(angle),
      y: H / 2 + r * Math.sin(angle),
    });
  });

  // Deduplicate edges (undirected for layout purposes)
  const seen = new Set<string>();
  const layoutEdges: { u: string; v: string }[] = [];
  edges.forEach((e: any) => {
    const key = [e.from, e.to].sort().join("→");
    if (!seen.has(key)) {
      seen.add(key);
      layoutEdges.push({ u: e.from, v: e.to });
    }
  });

  const ids = nodes.map((nd: any) => nd.id);

  // ── 2. Simulation ─────────────────────────────────────────────────────────
  const ITERATIONS = 350;
  let temp = Math.min(W, H) * 0.3; // initial max displacement
  const cooling = temp / (ITERATIONS + 1);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const disp = new Map<string, { x: number; y: number }>();
    ids.forEach((id: string) => disp.set(id, { x: 0, y: 0 }));

    // Repulsive forces — O(n²), fast enough for typical service graphs (<200 nodes)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const u = ids[i],
          v = ids[j];
        const pu = pos.get(u)!,
          pv = pos.get(v)!;
        const dx = pu.x - pv.x;
        const dy = pu.y - pv.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const fr = (k * k) / dist;
        const nx = (dx / dist) * fr;
        const ny = (dy / dist) * fr;
        const du = disp.get(u)!;
        du.x += nx;
        du.y += ny;
        const dv = disp.get(v)!;
        dv.x -= nx;
        dv.y -= ny;
      }
    }

    // Node-on-edge repulsion: push nodes away from edges they are not endpoints of
    const edgeRepelDist = k * 1.2; // min clearance between a node and a passing edge
    ids.forEach((id: string) => {
      const p = pos.get(id)!;
      layoutEdges.forEach(({ u, v }) => {
        if (id === u || id === v) return;
        const pu = pos.get(u)!,
          pv = pos.get(v)!;
        const ex = pv.x - pu.x,
          ey = pv.y - pu.y;
        const len2 = ex * ex + ey * ey;
        if (len2 < 1) return;
        const t = Math.max(
          0,
          Math.min(1, ((p.x - pu.x) * ex + (p.y - pu.y) * ey) / len2),
        );
        const cx = pu.x + t * ex,
          cy = pu.y + t * ey;
        const dx = p.x - cx,
          dy = p.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        if (dist < edgeRepelDist) {
          const force = ((edgeRepelDist - dist) / dist) * k * 0.8;
          const d = disp.get(id)!;
          d.x += (dx / dist) * force;
          d.y += (dy / dist) * force;
        }
      });
    });

    // Attractive forces — along edges only
    layoutEdges.forEach(({ u, v }) => {
      if (!pos.has(u) || !pos.has(v)) return;
      const pu = pos.get(u)!,
        pv = pos.get(v)!;
      const dx = pu.x - pv.x;
      const dy = pu.y - pv.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const fa = (dist * dist) / k;
      const nx = (dx / dist) * fa;
      const ny = (dy / dist) * fa;
      const du = disp.get(u)!;
      du.x -= nx;
      du.y -= ny;
      const dv = disp.get(v)!;
      dv.x += nx;
      dv.y += ny;
    });

    // Apply displacements clamped by temperature, keep within working area
    ids.forEach((id: string) => {
      const p = pos.get(id)!;
      const d = disp.get(id)!;
      const dlen = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      const scale = Math.min(dlen, temp) / dlen;
      p.x = Math.max(0, Math.min(W, p.x + d.x * scale));
      p.y = Math.max(0, Math.min(H, p.y + d.y * scale));
    });

    temp = Math.max(0, temp - cooling);
  }

  // ── 3. Normalise bounding box → full canvas with padding ─────────────────
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  pos.forEach((p) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  // Scale uniformly so the layout fills without distortion, then centre
  const scale = Math.min(W / rangeX, H / rangeY);
  const offsetX = PAD_LEFT + (W - rangeX * scale) / 2;
  const offsetY = PAD_TOP + (H - rangeY * scale) / 2;

  const result = new Map<string, { x: number; y: number }>();
  pos.forEach((p, id) => {
    result.set(id, {
      x: offsetX + (p.x - minX) * scale,
      y: offsetY + (p.y - minY) * scale,
    });
  });
  return result;
};

// ── Service-type icon helper ──────────────────────────────────────────────────

/**
 * Returns an ECharts image:// data URL containing a full SVG node:
 *   outer circle (health-based border) + monochrome Feather-style icon.
 * The icon type is inferred from the service name via keyword matching.
 */
// Ordered icon rules: first match wins. Priority: infra → data → domain → UI → default.
// Each SVG path is a 24×24 Feather-style stroke icon (no fill).
const SERVICE_ICON_RULES: { regex: RegExp; svg: string }[] = [
  // ── Infrastructure / networking ──────────────────────────────────────────
  {
    // Globe — API gateway, reverse proxy, ingress, router
    regex: /gateway|proxy|ingress|nginx|envoy|router/,
    svg:
      `<circle cx="12" cy="12" r="10"/>` +
      `<line x1="2" y1="12" x2="22" y2="12"/>` +
      `<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
  },
  {
    // Phone — gRPC, RPC, Thrift, Connect RPC
    regex: /\bgrpc\b|\brpc\b|thrift|connect/,
    svg: `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.86 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.77 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>`,
  },
  {
    // Globe — outbound HTTP/REST/API call (span attribute "http", "https", "rest")
    regex: /\bhttp\b|\bhttps\b|\brest\b/,
    svg:
      `<circle cx="12" cy="12" r="10"/>` +
      `<line x1="2" y1="12" x2="22" y2="12"/>` +
      `<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
  },
  {
    // Wifi — websocket / realtime / streaming
    regex: /websocket|realtime|streaming|socket/,
    svg:
      `<path d="M5 12.55a11 11 0 0 1 14.08 0"/>` +
      `<path d="M1.42 9a16 16 0 0 1 21.16 0"/>` +
      `<path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>` +
      `<line x1="12" y1="20" x2="12.01" y2="20"/>`,
  },
  {
    // Share network — message broker, queue, pubsub
    regex: /queue|kafka|rabbit|broker|mq|pubsub|event/,
    svg:
      `<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>` +
      `<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>` +
      `<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>`,
  },
  {
    // Clock / cog — scheduler, cron, background worker, job, consumer
    regex: /schedul|cron|worker|job|consumer|processor/,
    svg:
      `<circle cx="12" cy="12" r="10"/>` +
      `<polyline points="12 6 12 12 16 14"/>`,
  },
  {
    // Sliders — config, consul, etcd, feature flag, feature toggle
    regex: /config|consul|etcd|flag|feature/,
    svg:
      `<line x1="4" y1="21" x2="4" y2="14"/>` +
      `<line x1="4" y1="10" x2="4" y2="3"/>` +
      `<line x1="12" y1="21" x2="12" y2="12"/>` +
      `<line x1="12" y1="8" x2="12" y2="3"/>` +
      `<line x1="20" y1="21" x2="20" y2="16"/>` +
      `<line x1="20" y1="12" x2="20" y2="3"/>` +
      `<line x1="1" y1="14" x2="7" y2="14"/>` +
      `<line x1="9" y1="8" x2="15" y2="8"/>` +
      `<line x1="17" y1="16" x2="23" y2="16"/>`,
  },
  {
    // Activity pulse — load generator, traffic simulator, telemetry, monitoring
    regex:
      /load|generator|traffic|benchmark|prometheus|grafana|otel|telemetry|monitor/,
    svg: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
  },
  {
    // Bell — alert manager, alarm, incident
    regex: /alert|alarm|incident|pagerduty/,
    svg:
      `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>` +
      `<path d="M13.73 21a2 2 0 0 1-3.46 0"/>`,
  },
  // ── Data / storage ───────────────────────────────────────────────────────
  {
    // Database cylinder — any SQL/NoSQL/search engine
    regex:
      /database|elastic|opensearch|mongo|mysql|postgres|sqlite|oracle|cassandra|dynamo|\bdb\b/,
    svg:
      `<ellipse cx="12" cy="5" rx="9" ry="3"/>` +
      `<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>` +
      `<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>`,
  },
  {
    // Layers — in-memory cache
    regex: /cache|redis|memcache/,
    svg:
      `<polygon points="12 2 2 7 12 12 22 7 12 2"/>` +
      `<polyline points="2 17 12 22 22 17"/>` +
      `<polyline points="2 12 12 17 22 12"/>`,
  },
  {
    // Download arrow — data ingestion, pipeline, ETL, collector
    regex: /ingest|pipeline|etl|collector/,
    svg:
      `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>` +
      `<polyline points="7 10 12 15 17 10"/>` +
      `<line x1="12" y1="15" x2="12" y2="3"/>`,
  },
  {
    // Minimize arrows — compactor, compressor, archiver (data compaction)
    regex: /compact|compress|archiv/,
    svg:
      `<polyline points="4 14 10 14 10 20"/>` +
      `<polyline points="20 10 14 10 14 4"/>` +
      `<line x1="10" y1="14" x2="3" y2="21"/>` +
      `<line x1="21" y1="3" x2="14" y2="10"/>`,
  },
  {
    // Image frame — image, media, asset, object storage
    regex: /image|photo|media|asset|storage|blob/,
    svg:
      `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>` +
      `<circle cx="8.5" cy="8.5" r="1.5"/>` +
      `<polyline points="21 15 16 10 5 21"/>`,
  },
  // ── Auth / security ──────────────────────────────────────────────────────
  {
    // Shield — authentication, identity, SSO
    regex: /auth|sso|identity|login|oauth|keycloak/,
    svg: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
  },
  // ── Search ───────────────────────────────────────────────────────────────
  {
    // Magnifier — search and query services
    regex: /search|quer/,
    svg:
      `<circle cx="11" cy="11" r="8"/>` +
      `<line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
  },
  // ── AI / ML ──────────────────────────────────────────────────────────────
  {
    // CPU chip — ML, AI, inference, recommendation
    regex: /\bml\b|\bai\b|model|inference|predict|recommend|suggest/,
    svg:
      `<rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>` +
      `<rect x="9" y="9" width="6" height="6"/>` +
      `<line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>` +
      `<line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>` +
      `<line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>` +
      `<line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>`,
  },
  // ── Domain / business ────────────────────────────────────────────────────
  {
    // Envelope — email, mail, notification, newsletter tools (listmonk etc.)
    regex: /email|mail|smtp|notification|notify|newsletter|listmonk/,
    svg:
      `<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>` +
      `<polyline points="22,6 12,13 2,6"/>`,
  },
  {
    // Credit card — payment, billing, invoice
    regex: /payment|\bpay\b|billing|invoice|stripe|paypal/,
    svg:
      `<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>` +
      `<line x1="1" y1="10" x2="23" y2="10"/>`,
  },
  {
    // Shopping cart — cart, basket, checkout, order
    regex: /cart|basket|checkout|order/,
    svg:
      `<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>` +
      `<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>`,
  },
  {
    // Truck — shipping, delivery, logistics
    regex: /ship|delivery|courier|logistic/,
    svg:
      `<rect x="1" y="3" width="15" height="13"/>` +
      `<polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>` +
      `<circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>`,
  },
  {
    // Dollar sign — currency, accounting, finance, exchange
    regex: /currency|exchange|forex|accounting|finance|ledger/,
    svg:
      `<line x1="12" y1="1" x2="12" y2="23"/>` +
      `<path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`,
  },
  {
    // File list — product catalog, inventory
    regex: /catalog|inventory|product|listing/,
    svg:
      `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>` +
      `<polyline points="14 2 14 8 20 8"/>` +
      `<line x1="16" y1="13" x2="8" y2="13"/>` +
      `<line x1="16" y1="17" x2="8" y2="17"/>`,
  },
  {
    // Megaphone — ad, advertising, marketing
    regex: /\bad\b|\bads\b|advert|marketing/,
    svg:
      `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>` +
      `<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>` +
      `<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>`,
  },
  {
    // Document with plus — quote, pricing service
    regex: /quote|pricing/,
    svg:
      `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>` +
      `<polyline points="14 2 14 8 20 8"/>` +
      `<line x1="12" y1="18" x2="12" y2="12"/>` +
      `<line x1="9" y1="15" x2="15" y2="15"/>`,
  },
  {
    // Bot/person — SRE agent, automation agent, bot
    regex: /\bagent\b|\bbot\b|sre|automation/,
    svg:
      `<path d="M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>` +
      `<path d="M16 8v1a4 4 0 0 1-8 0V8"/>` +
      `<line x1="8" y1="13" x2="16" y2="13"/>` +
      `<rect x="8" y="13" width="8" height="8" rx="1"/>` +
      `<line x1="10" y1="17" x2="10.01" y2="17"/>` +
      `<line x1="14" y1="17" x2="14.01" y2="17"/>`,
  },
  // ── UI / client ──────────────────────────────────────────────────────────
  {
    // Monitor — web frontend, client app, browser
    regex: /frontend|\bweb\b|\bui\b|\bapp\b|client|browser/,
    svg:
      `<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>` +
      `<line x1="8" y1="21" x2="16" y2="21"/>` +
      `<line x1="12" y1="17" x2="12" y2="21"/>`,
  },
];

// Server SVG — used as fallback when no rule matches
const SERVER_ICON_SVG =
  `<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>` +
  `<rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>` +
  `<line x1="6" y1="6" x2="6.01" y2="6"/>` +
  `<line x1="6" y1="18" x2="6.01" y2="18"/>`;

/**
 * Builds a `data:image/svg+xml;base64,...` URL for use in `<img src>` or CSS.
 * The circle border uses `borderColor`; the icon stroke adapts to `isDark`.
 */
export function getServiceIconDataUrl(
  name: string,
  isDark: boolean,
  borderColor: string,
): string {
  const iconColor = isDark ? "#e4e7eb" : "#374151";
  const bgColor = isDark ? "#1a1f2e" : "#ffffff";

  // Normalize: lowercase and collapse hyphens/underscores to spaces so
  // "load-generator" and "load_generator" both match /load/ or /generator/.
  const n = (name || "").toLowerCase().replace(/[-_]/g, " ");

  const matched = SERVICE_ICON_RULES.find(({ regex }) => regex.test(n));
  const icon = matched ? matched.svg : SERVER_ICON_SVG;

  // 56×56 viewBox: circle r=24 centered at (28,28); icon 24×24 translated to (16,16)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56">` +
    `<circle cx="28" cy="28" r="24" fill="${bgColor}" stroke="${borderColor}" stroke-width="4"/>` +
    `<g transform="translate(16,16)" fill="none" stroke="${iconColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
    icon +
    `</g></svg>`;

  return `data:image/svg+xml;base64,${btoa(encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))))}`;
}

function getServiceIconSvg(
  name: string,
  isDark: boolean,
  borderColor: string,
): string {
  return `image://${getServiceIconDataUrl(name, isDark, borderColor)}`;
}

/**
 * Returns a `data:image/svg+xml;base64,...` URL for a span's technology icon
 * (e.g. db_system, messaging_system, rpc_system) by running the value through
 * SERVICE_ICON_RULES. Unlike getServiceIconDataUrl, this renders a bare 24×24
 * icon with no circular border — suitable for small inline span badges.
 * Returns null when no rule matches (i.e. no specific tech is identifiable).
 */
export function getSpanTechIconDataUrl(
  name: string,
  isDark: boolean,
): string | null {
  const iconColor = isDark ? "#e4e7eb" : "#374151";
  const n = (name || "").toLowerCase().replace(/[-_]/g, " ");
  const matched = SERVICE_ICON_RULES.find(({ regex }) => regex.test(n));
  if (!matched) return null;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    matched.svg +
    `</svg>`;

  return `data:image/svg+xml;base64,${btoa(encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))))}`;  
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert service graph data to ECharts Graph format (force-directed network)
 */
export const convertServiceGraphToNetwork = (
  graphData: { nodes: any[]; edges: any[] },
  layoutType: string = "force",
  cachedPositions?: Map<string, { x: number; y: number }>,
  isDarkMode: boolean = true,
  selectedNodeId?: string,
  canvasWidth: number = 1200,
  canvasHeight: number = 700,
) => {
  // Graph view only supports force-directed layout
  // Tree layouts ('horizontal', 'vertical') should use convertServiceGraphToTree instead
  const normalizedLayoutType = "force";

  if (layoutType !== normalizedLayoutType) {
    console.warn(
      `[convertServiceGraphToNetwork] Invalid layout '${layoutType}' for graph view, defaulting to 'force'`,
    );
  }

  // Build node metrics map using each node's own data from backend (authoritative source)
  const nodeMetrics = new Map<
    string,
    { requests: number; errors: number; connections: number }
  >();

  // Initialize metrics for all nodes using their own backend data
  graphData.nodes.forEach((node: any) => {
    nodeMetrics.set(node.id, {
      requests: node.requests || 0,
      errors: node.errors || 0,
      connections: 0, // Will be updated below
    });
  });

  // Count connections for each node
  graphData.edges.forEach((edge: any) => {
    const fromMetrics = nodeMetrics.get(edge.from);
    const toMetrics = nodeMetrics.get(edge.to);

    if (fromMetrics) {
      fromMetrics.connections += 1;
    }
    if (toMetrics) {
      toMetrics.connections += 1;
    }
  });

  // Validate that all nodes have valid IDs
  const validNodes = graphData.nodes.filter((node: any) => {
    if (!node || !node.id) {
      console.warn(
        "[convertServiceGraphToNetwork] Skipping node with invalid ID:",
        node,
      );
      return false;
    }
    return true;
  });

  const nodes = validNodes.map((node: any) => {
    const metrics = nodeMetrics.get(node.id) || {
      requests: 0,
      errors: 0,
      connections: 0,
    };
    const errorRate =
      metrics.requests > 0 ? (metrics.errors / metrics.requests) * 100 : 0;

    // Border color based on error rate (theme-aware)
    let borderColor: string;
    if (isDarkMode) {
      // Dark mode colors
      borderColor = "#10b981"; // Green (healthy)
      if (errorRate > 10)
        borderColor = "#ef4444"; // Red (critical)
      else if (errorRate > 5)
        borderColor = "#f97316"; // Orange (warning)
      else if (errorRate > 1) borderColor = "#fbbf24"; // Yellow (degraded)
    } else {
      // Light mode colors
      borderColor = "#52c41a"; // Green (healthy)
      if (errorRate > 10)
        borderColor = "#f5222d"; // Red (critical)
      else if (errorRate > 5)
        borderColor = "#fa8c16"; // Orange (warning)
      else if (errorRate > 1) borderColor = "#faad14"; // Yellow (degraded)
    }

    // Node size: scales with request volume like DataDog (70–110 px range)
    const symbolSize = Math.max(
      70,
      Math.min(110, Math.log10(metrics.requests + 1) * 28),
    );

    // SVG symbol: circle with health-colored border + service-type icon
    const iconDataUrl = getServiceIconSvg(node.id, isDarkMode, borderColor);

    // Use cached position if available
    const cachedPos = cachedPositions?.get(node.id);
    const nodeData: any = {
      id: node.id,
      name: node.label || node.id,
      value: metrics.requests,
      errors: metrics.errors,
      symbol: iconDataUrl,
      symbolSize,
      // itemStyle opacity is needed for emphasis.focus adjacency dimming to work on images
      itemStyle: { opacity: 1 },
      label: { show: true },
      emphasis: {
        scale: true,
        scaleSize: 1.12,
        label: {
          show: true,
          fontWeight: "bold",
          fontSize: 13,
        },
      },
      select: {
        label: {
          show: true,
          fontWeight: "bold",
        },
      },
      tooltip: {
        formatter: `
          <strong>${node.label || node.id}</strong><br/>
          Requests: ${formatNumber(metrics.requests)}<br/>
          Errors: ${formatNumber(metrics.errors)}<br/>
          Error Rate: ${errorRate.toFixed(2)}%
        `,
      },
    };

    // If we have cached positions, use them and set fixed: true
    if (cachedPos) {
      nodeData.x = cachedPos.x;
      nodeData.y = cachedPos.y;
      nodeData.fixed = true;
    } else {
      nodeData.fixed = false;
    }

    return nodeData;
  });

  // Create a set of valid node IDs for edge validation
  const validNodeIds = new Set(nodes.map((n: any) => n.id));

  // Prepare edges with arrows showing flow direction
  // Filter out any invalid edges and ensure all required fields are present
  const edgeMap = new Map<string, any>(); // Deduplicate edges by source-target pair

  graphData.edges.forEach((edge: any) => {
    // Validate edge structure and node references
    if (!edge || !edge.from || !edge.to) {
      console.warn(
        "[convertServiceGraphToNetwork] Skipping edge with missing from/to:",
        edge,
      );
      return;
    }

    if (!validNodeIds.has(edge.from)) {
      console.warn(
        "[convertServiceGraphToNetwork] Skipping edge - source node not found:",
        edge.from,
      );
      return;
    }

    if (!validNodeIds.has(edge.to)) {
      console.warn(
        "[convertServiceGraphToNetwork] Skipping edge - target node not found:",
        edge.to,
      );
      return;
    }

    // Create unique key for deduplication
    const edgeKey = `${edge.from}|||${edge.to}`;

    // If duplicate, keep the one with more requests
    if (edgeMap.has(edgeKey)) {
      const existing = edgeMap.get(edgeKey);
      if ((edge.total_requests || 0) > (existing.total_requests || 0)) {
        edgeMap.set(edgeKey, edge);
      }
    } else {
      edgeMap.set(edgeKey, edge);
    }
  });

  // Detect bidirectional edges and assign curvature direction
  // For bidirectional edges, one edge curves left, the other curves right
  const edgeCurvature = new Map<string, number>();
  const processedPairs = new Set<string>();

  edgeMap.forEach((edge, key) => {
    const reverseKey = `${edge.to}|||${edge.from}`;
    const pairKey = [edge.from, edge.to].sort().join("|||");

    if (edgeMap.has(reverseKey) && !processedPairs.has(pairKey)) {
      // This is a bidirectional edge
      processedPairs.add(pairKey);

      // Assign curvature to both directions
      // Positive curvature for one direction, negative for the other
      edgeCurvature.set(key, 0.2);
      edgeCurvature.set(reverseKey, -0.2);
    } else if (!edgeCurvature.has(key)) {
      // Not bidirectional, no curvature needed
      edgeCurvature.set(key, 0);
    }
  });

  const edges = Array.from(edgeMap.entries()).map(
    ([edgeKey, edge]: [string, any]) => {
      const errorRate =
        edge.total_requests > 0
          ? (edge.failed_requests / edge.total_requests) * 100
          : 0;

      // Get the assigned curvature for this edge
      const curveness = edgeCurvature.get(edgeKey) || 0;

      // Format latency values
      const formatLatency = (ns: number) => {
        if (!ns || ns === 0) return "N/A";
        const ms = ns / 1000000;
        return ms >= 1000 ? (ms / 1000).toFixed(2) + "s" : ms.toFixed(2) + "ms";
      };

      const p50 = formatLatency(edge.p50_latency_ns || 0);
      const p95 = formatLatency(edge.p95_latency_ns || 0);
      const p99 = formatLatency(edge.p99_latency_ns || 0);

      const edgeColor = isDarkMode ? "#4a5568" : "#b0b7c3";

      return {
        source: edge.from,
        target: edge.to,
        value: edge.total_requests || 0,
        // Edge tooltips are handled by the mini chart overlay — disable ECharts native tooltip
        tooltip: { show: false },
        symbol: ["none", "arrow"],
        symbolSize: [0, 10],
        lineStyle: {
          width: 4,
          color: edgeColor,
          curveness: curveness,
          type: "solid", // solid by default — no animation at rest
          opacity: 0.6,
        },
        label: {
          show: false,
        },
        emphasis: {
          lineStyle: {
            type: "solid",
            width: 4,
            opacity: 1,
            color: edgeColor,
          },
        },
      };
    },
  );

  // Determine if we should use force layout or fixed positions
  const hasPositions = cachedPositions && cachedPositions.size > 0;

  // Compute hierarchical layout when no cached positions exist.
  // Columns = call depth from root services; rows = nodes within each column.
  // Positions are mapped directly to canvas pixels so nodes fill the full space.
  if (normalizedLayoutType === "force" && !hasPositions) {
    const positions = computeForceLayout(
      nodes,
      graphData.edges,
      canvasWidth,
      canvasHeight,
    );
    nodes.forEach((node: any) => {
      const pos = positions.get(node.id);
      if (pos) {
        node.x = pos.x;
        node.y = pos.y;
        node.fixed = true;
      }
    });
  }

  // Set per-node label position based on x/y to avoid canvas edge clipping.
  // Must include all styling props since per-node label does not fully inherit series-level label.
  const bottomThreshold = canvasHeight * 0.7;
  const rightThreshold = canvasWidth * 0.72;
  const baseLabelStyle = {
    show: true,
    distance: 8,
    fontSize: 12,
    fontWeight: 500,
    color: isDarkMode ? "#e4e7eb" : "#374151",
    textBorderColor: isDarkMode ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)",
    textBorderWidth: 3,
  };
  nodes.forEach((node: any) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    let position: string;
    if (y >= bottomThreshold) {
      // Bottom nodes: right side has leftover canvas space; bottom-right corner → right avoids bottom clip
      position = "bottom";
    } else if (x >= rightThreshold) {
      // Right-edge nodes: label goes below the node so it doesn't extend past the canvas right edge
      position = "bottom";
    } else {
      position = "right";
    }
    node.label = { ...baseLabelStyle, position };
  });

  // Use "none" layout when we have fixed positions (D3-force computed or cached)
  const layoutMode = "none";

  const options = {
    backgroundColor: "transparent", // Make chart background transparent
    tooltip: {
      trigger: "item",
      triggerOn: "mousemove",
      hideDelay: 0, // Hide immediately when mouse leaves
      enterable: false, // Prevent mouse from entering tooltip
      backgroundColor: "rgba(50, 50, 50, 0.95)",
      borderColor: "#777",
      borderWidth: 1,
      textStyle: {
        color: "#fff",
      },
    },
    animation: false, // Disable animation to prevent position jumping
    animationDuration: 200,
    animationEasing: "cubicOut", // Smooth easing for hover effect
    series: [
      {
        type: "graph",
        layout: layoutMode,
        data: nodes,
        links: edges,
        roam: true,
        draggable: false,
        focusNodeAdjacency: true,
        selectedMode: "single", // Enable single node selection
        scaleLimit: {
          min: 0.4,
          max: 3,
        },
        animationDurationUpdate: 200,
        animationEasingUpdate: "cubicOut",
        label: {
          show: true,
          formatter: (params: any) => params.data.name,
        },
        emphasis: {
          focus: "adjacency",
          scale: true,
          scaleSize: 1.15,
          label: {
            show: true,
            fontSize: 13,
            fontWeight: "bold",
          },
          itemStyle: {
            shadowBlur: 20,
            shadowColor: isDarkMode
              ? "rgba(0, 0, 0, 0.5)"
              : "rgba(0, 0, 0, 0.3)",
          },
        },
        lineStyle: {
          type: "solid",
          opacity: 0.6,
        },
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: [0, 15],
      },
    ],
  };

  return { options };
};

const formatNumber = (num: number) => {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
};

const formatDate = (date: any) => {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};
