import { toZonedTime, format } from "date-fns-tz";
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, forceX, forceY } from "d3-force";
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
  treeDepth: number = 3
) => {
  const options = {
    tooltip: {
      show: false,
    },
    series: [
      {
        type: "tree",
        data: data,
        symbolSize: 20,
        initialTreeDepth: treeDepth,
        label: {
          position: "bottom",
          verticalAlign: "bottom",
          distance: 25,
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
 * @param layoutType - Layout orientation: 'horizontal' | 'vertical' | 'radial'
 * @returns ECharts tree options
 */
export const convertServiceGraphToTree = (
  graphData: { nodes: any[]; edges: any[] },
  layoutType: string = 'horizontal'
) => {
  console.log('[convertServiceGraphToTree] Called with:', {
    nodeCount: graphData.nodes.length,
    edgeCount: graphData.edges.length,
    layoutType
  });

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
  const rootNodes = graphData.nodes.filter((n: any) => !nodesWithIncoming.has(n.id));

  // Track all visited nodes across all trees to find orphaned components
  const globalVisited = new Set<string>();

  // Helper to build tree recursively
  const buildTree = (nodeId: string, visited = new Set<string>()): any => {
    if (visited.has(nodeId)) return null; // Prevent cycles
    visited.add(nodeId);
    globalVisited.add(nodeId);

    const node = graphData.nodes.find((n: any) => n.id === nodeId);
    if (!node) return null;

    const outgoingEdges = edgesMap.get(nodeId) || [];
    const children = outgoingEdges
      .map((edge: any) => buildTree(edge.to, new Set(visited)))
      .filter((child: any) => child !== null);

    // Calculate node metrics - use node's own request count, not just outgoing edges
    // This ensures leaf nodes show their actual traffic instead of 0
    const totalRequests = node.requests || 0;
    const failedRequests = node.errors || 0;
    const errorRate = node.error_rate || 0;

    // Determine node color based on error rate
    let nodeColor = "#4CAF50"; // Green for healthy
    if (errorRate > 10) nodeColor = "#F44336"; // Red
    else if (errorRate > 5) nodeColor = "#FF9800"; // Orange
    else if (errorRate > 1) nodeColor = "#FFC107"; // Yellow

    return {
      name: node.label || node.id,
      value: totalRequests,
      symbolSize: Math.max(20, Math.min(60, Math.log10(totalRequests + 1) * 15)),
      itemStyle: {
        color: nodeColor,
        borderColor: nodeColor,
        borderWidth: 2,
      },
      label: {
        show: true,
        position: layoutType === 'vertical' ? 'bottom' : 'right',
        formatter: (params: any) => {
          return `${params.name}\n${formatNumber(totalRequests)} req`;
        },
      },
      tooltip: {
        formatter: (params: any) => {
          return `
            <strong>${params.name}</strong><br/>
            Requests: ${formatNumber(totalRequests)}<br/>
            Errors: ${failedRequests}<br/>
            Error Rate: ${errorRate.toFixed(2)}%
          `;
        },
      },
      children: children.length > 0 ? children : undefined,
    };
  };

  // Start with root nodes
  console.log('[convertServiceGraphToTree] Root nodes:', rootNodes.map((n: any) => n.id));
  let treeData = rootNodes.map((node: any) => buildTree(node.id)).filter((n: any) => n !== null);
  console.log('[convertServiceGraphToTree] Trees from roots:', treeData.length);

  // Find unvisited nodes (disconnected components or cycles)
  const unvisitedNodes = graphData.nodes.filter((n: any) => !globalVisited.has(n.id));
  console.log('[convertServiceGraphToTree] Unvisited nodes:', unvisitedNodes.map((n: any) => n.id));

  // Add unvisited nodes as separate root trees
  if (unvisitedNodes.length > 0) {
    const additionalTrees = unvisitedNodes
      .map((node: any) => buildTree(node.id))
      .filter((n: any) => n !== null);
    treeData = [...treeData, ...additionalTrees];
    console.log('[convertServiceGraphToTree] Total trees after adding unvisited:', treeData.length);
  }

  // If still no tree data, create a flat structure
  if (treeData.length === 0 && graphData.nodes.length > 0) {
    return {
      tooltip: { show: true, trigger: 'item' },
      series: [{
        type: 'tree',
        data: graphData.nodes.map((node: any) => ({
          name: node.label || node.id,
          value: 0,
          symbolSize: 20,
          itemStyle: { color: '#9E9E9E' },
        })),
        layout: 'orthogonal',
        orient: layoutType === 'vertical' ? 'TB' : 'LR',
        initialTreeDepth: -1,
        symbolSize: 20,
        label: {
          position: layoutType === 'vertical' ? 'bottom' : 'right',
          verticalAlign: layoutType === 'vertical' ? 'top' : 'middle',
          distance: 15,
          fontSize: 12,
        },
      }],
    };
  }

  // ECharts tree needs a single root - create virtual root if multiple trees
  const finalTreeData = treeData.length > 1
    ? [{
        name: 'Services',
        symbolSize: 1,
        itemStyle: { opacity: 0 },
        label: { show: false },
        children: treeData,
      }]
    : treeData;

  const options = {
    tooltip: {
      show: true,
      trigger: 'item',
      triggerOn: 'mousemove',
    },
    series: [
      {
        type: 'tree',
        data: finalTreeData,
        layout: layoutType === 'radial' ? 'radial' : 'orthogonal',
        orient: layoutType === 'vertical' ? 'TB' : 'LR',
        initialTreeDepth: -1,
        symbol: 'circle',
        symbolSize: 20,
        label: {
          position: layoutType === 'vertical' ? 'bottom' : 'right',
          verticalAlign: layoutType === 'vertical' ? 'top' : 'middle',
          distance: 15,
          fontSize: 12,
          rotate: 0, // Keep text horizontal, no rotation
        },
        leaves: {
          label: {
            position: layoutType === 'vertical' ? 'bottom' : 'right',
            verticalAlign: layoutType === 'vertical' ? 'top' : 'middle',
            distance: 15,
            rotate: 0, // Keep text horizontal, no rotation
          },
        },
        expandAndCollapse: true,
        animationDuration: 550,
        animationDurationUpdate: 750,
      },
    ],
  };

  return { options };
};

// D3-Force simulation physics parameters
const FORCE_PHYSICS_PARAMS = {
  // Many-Body Force (Repulsion)
  chargeStrength: -3000,       // Lower repulsion to tighten clusters
  chargeDistanceMax: 1200,     // Limit long-range repulsion

  // Link Force
  linkDistance: 250,           // Shorter links for tighter grouping
  linkStrength: 0.6,           // Stronger link pull to hold structure
  linkIterations: 3,           // Fewer passes, less "rubberiness"

  // Center Force
  centerStrength: 0.05,        // Stronger centering keeps it compact

  // Position Forces
  forceXStrength: 0.08,        // Gentle horizontal correction
  forceYStrength: 0.08,        // Gentle vertical correction

  // Collision Force
  collisionPadding: 80,        // Reasonable padding without huge gaps
  collisionStrength: 1.0,      // Full collision enforcement
  collisionIterations: 2,      // Enough to resolve overlaps

  // Simulation
  velocityDecay: 0.35,         // Slightly more friction for faster settle
  totalTicks: 5000,            // Iterations for stabilization
};

/**
 * Compute force-directed layout using D3-force simulation
 * @param nodes - Array of nodes
 * @param edges - Array of edges
 * @param width - Container width
 * @param height - Container height
 * @returns Nodes with computed x, y positions
 */
const computeForceLayout = (
  nodes: any[],
  edges: any[],
  width: number = 800,
  height: number = 600
) => {
  // Create a copy of nodes to avoid mutation
  const nodesCopy = nodes.map(n => ({ ...n }));

  // Prepare edges with proper source/target references
  const edgesCopy = edges.map(e => ({
    source: e.from,
    target: e.to,
    ...e,
  }));

  // Create simulation and compute layout using physics params
  const simulation = forceSimulation(nodesCopy)
    .force('charge', forceManyBody()
      .strength(FORCE_PHYSICS_PARAMS.chargeStrength)
      .distanceMax(FORCE_PHYSICS_PARAMS.chargeDistanceMax)
    )
    .force('link', forceLink(edgesCopy)
      .id((d: any) => d.id)
      .distance(FORCE_PHYSICS_PARAMS.linkDistance)
      .strength(FORCE_PHYSICS_PARAMS.linkStrength)
      .iterations(FORCE_PHYSICS_PARAMS.linkIterations)
    )
    .force('center', forceCenter(width / 2, height / 2)
      .strength(FORCE_PHYSICS_PARAMS.centerStrength)
    )
    .force('x', forceX(width / 2).strength(FORCE_PHYSICS_PARAMS.forceXStrength))
    .force('y', forceY(height / 2).strength(FORCE_PHYSICS_PARAMS.forceYStrength))
    .force('collision', forceCollide()
      .radius((d: any) => (d.symbolSize || 60) / 2 + FORCE_PHYSICS_PARAMS.collisionPadding)
      .strength(FORCE_PHYSICS_PARAMS.collisionStrength)
      .iterations(FORCE_PHYSICS_PARAMS.collisionIterations)
    )
    .velocityDecay(FORCE_PHYSICS_PARAMS.velocityDecay)
    .stop();

  // Run simulation for specified iterations to stabilize layout
  for (let i = 0; i < FORCE_PHYSICS_PARAMS.totalTicks; i++) {
    simulation.tick();
  }

  // Return nodes with computed positions
  return simulation.nodes().map(n => ({ ...n }));
};

/**
 * Convert service graph data to ECharts Graph format (force-directed/circular network)
 */
export const convertServiceGraphToNetwork = (
  graphData: { nodes: any[]; edges: any[] },
  layoutType: string = "force",
  cachedPositions?: Map<string, { x: number; y: number }>
) => {
  // Validate layout type - graph view only supports 'force' and 'circular'
  // Tree layouts ('horizontal', 'vertical', 'radial') should use convertServiceGraphToTree instead
  const validLayouts = ['force', 'circular'];
  const normalizedLayoutType = validLayouts.includes(layoutType) ? layoutType : 'force';

  if (layoutType !== normalizedLayoutType) {
    console.warn(`[convertServiceGraphToNetwork] Invalid layout '${layoutType}' for graph view, defaulting to 'force'`);
  }

  console.log('[convertServiceGraphToNetwork] VERSION: 2025-11-26-v4 - Fixed bidirectional edge overlap');
  console.log('[convertServiceGraphToNetwork] Input:', {
    nodeCount: graphData.nodes?.length || 0,
    edgeCount: graphData.edges?.length || 0,
    layoutType: normalizedLayoutType
  });
  // Build node metrics map (requests, errors, connections)
  const nodeMetrics = new Map<string, { requests: number; errors: number; connections: number }>();

  // Count connections for each node
  const connectionCount = new Map<string, number>();
  graphData.nodes.forEach((node: any) => {
    connectionCount.set(node.id, 0);
  });

  graphData.edges.forEach((edge: any) => {
    connectionCount.set(edge.from, (connectionCount.get(edge.from) || 0) + 1);
    connectionCount.set(edge.to, (connectionCount.get(edge.to) || 0) + 1);

    // Update metrics for both source and target nodes
    [edge.from, edge.to].forEach((nodeId: string) => {
      if (!nodeMetrics.has(nodeId)) {
        nodeMetrics.set(nodeId, { requests: 0, errors: 0, connections: 0 });
      }
      const metrics = nodeMetrics.get(nodeId)!;
      metrics.requests += edge.total_requests || 0;
      metrics.errors += edge.failed_requests || 0;
    });
  });

  // Update connection counts in metrics
  connectionCount.forEach((count, nodeId) => {
    if (nodeMetrics.has(nodeId)) {
      nodeMetrics.get(nodeId)!.connections = count;
    } else {
      nodeMetrics.set(nodeId, { requests: 0, errors: 0, connections: count });
    }
  });

  // Validate that all nodes have valid IDs
  const validNodes = graphData.nodes.filter((node: any) => {
    if (!node || !node.id) {
      console.warn('[convertServiceGraphToNetwork] Skipping node with invalid ID:', node);
      return false;
    }
    return true;
  });

  const nodes = validNodes.map((node: any) => {
    const metrics = nodeMetrics.get(node.id) || { requests: 0, errors: 0 };
    const errorRate = metrics.requests > 0 ? (metrics.errors / metrics.requests) * 100 : 0;

    // Border color based on error rate
    let borderColor = "#52c41a"; // Green (healthy)
    if (errorRate > 10) borderColor = "#f5222d"; // Red (critical)
    else if (errorRate > 5) borderColor = "#fa8c16"; // Orange (high)
    else if (errorRate > 1) borderColor = "#faad14"; // Yellow (warning)

    // Size based on request volume - much smaller nodes
    const symbolSize = Math.max(40, Math.min(80, Math.log10(metrics.requests + 1) * 20));

    // Use cached position if available
    const cachedPos = cachedPositions?.get(node.id);
    const nodeData: any = {
      id: node.id,
      name: node.label || node.id,
      value: metrics.requests,
      errors: metrics.errors,
      symbolSize: symbolSize,
      itemStyle: {
        color: '#ffffff', // White background
        borderColor: borderColor,
        borderWidth: 4,
        shadowBlur: 10,
        shadowColor: 'rgba(0, 0, 0, 0.3)',
      },
      label: {
        show: true,
      },
      emphasis: {
        label: {
          show: true,
          fontSize: 12,
          fontWeight: 'bold',
        },
      },
      tooltip: {
        formatter: `
          <strong>${node.label || node.id}</strong><br/>
          Requests: ${formatNumber(metrics.requests)}<br/>
          Errors: ${formatNumber(metrics.errors)}<br/>
          Error Rate: ${errorRate.toFixed(2)}%<br/>
          Connections: ${connectionCount.get(node.id) || 0}
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

  console.log('[convertServiceGraphToNetwork] Valid node IDs:', Array.from(validNodeIds));

  // Prepare edges with arrows showing flow direction
  // For circular layout, use curved lines; for force layout, use straight lines
  // Filter out any invalid edges and ensure all required fields are present
  const edgeMap = new Map<string, any>(); // Deduplicate edges by source-target pair

  graphData.edges.forEach((edge: any) => {
    // Validate edge structure and node references
    if (!edge || !edge.from || !edge.to) {
      console.warn('[convertServiceGraphToNetwork] Skipping edge with missing from/to:', edge);
      return;
    }

    if (!validNodeIds.has(edge.from)) {
      console.warn('[convertServiceGraphToNetwork] Skipping edge - source node not found:', edge.from);
      return;
    }

    if (!validNodeIds.has(edge.to)) {
      console.warn('[convertServiceGraphToNetwork] Skipping edge - target node not found:', edge.to);
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

  console.log('[convertServiceGraphToNetwork] Valid edges after dedup:', edgeMap.size);

  // Detect bidirectional edges and assign curvature direction
  // For bidirectional edges, one edge curves left, the other curves right
  const edgeCurvature = new Map<string, number>();
  const processedPairs = new Set<string>();

  edgeMap.forEach((edge, key) => {
    const reverseKey = `${edge.to}|||${edge.from}`;
    const pairKey = [edge.from, edge.to].sort().join('|||');

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

  console.log('[convertServiceGraphToNetwork] Bidirectional pairs:', processedPairs.size);

  const edges = Array.from(edgeMap.entries()).map(([edgeKey, edge]: [string, any], edgeIndex: number) => {
    const errorRate = edge.total_requests > 0 ? (edge.failed_requests / edge.total_requests) * 100 : 0;

    // Get the assigned curvature for this edge
    let curveness = edgeCurvature.get(edgeKey) || 0;

    // For circular layout, override with circular-specific curveness
    if (normalizedLayoutType === 'circular') {
      // Vary curveness based on edge index to create visual separation
      // Range from 0.3 to 0.6 (positive values should curve inward)
      curveness = 0.3 + (edgeIndex % 4) * 0.1;
    }

    // Format latency values
    const formatLatency = (ns: number) => {
      if (!ns || ns === 0) return 'N/A';
      const ms = ns / 1000000;
      return ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms.toFixed(2) + 'ms';
    };

    const p50 = formatLatency(edge.p50_latency_ns || 0);
    const p95 = formatLatency(edge.p95_latency_ns || 0);
    const p99 = formatLatency(edge.p99_latency_ns || 0);

    // Determine color based on error rate AND latency (P95)
    // Priority: errors first, then latency
    const p95Ms = (edge.p95_latency_ns || 0) / 1000000;
    let edgeColor;
    if (errorRate > 5) {
      edgeColor = "#f5222d"; // Red for high errors
    } else if (errorRate > 1) {
      edgeColor = "#faad14"; // Orange for medium errors
    } else if (p95Ms > 1000) {
      edgeColor = "#ff7875"; // Light red for high latency (>1s)
    } else if (p95Ms > 500) {
      edgeColor = "#ffc069"; // Light orange for medium latency (>500ms)
    } else {
      edgeColor = "#52c41a"; // Green for healthy
    }

    return {
      source: edge.from,
      target: edge.to,
      value: edge.total_requests || 0,
      tooltip: {
        formatter: edge.from + ' → ' + edge.to + '<br/>' +
          'Requests: ' + (edge.total_requests || 0) + '<br/>' +
          'Errors: ' + (edge.failed_requests || 0) + ' (' + errorRate.toFixed(2) + '%)<br/>' +
          'P50: ' + p50 + '<br/>' +
          'P95: ' + p95 + '<br/>' +
          'P99: ' + p99
      },
      symbol: ['none', 'arrow'], // Arrow at target end
      symbolSize: [0, 12], // Smaller arrows for cleaner look
      lineStyle: {
        width: Math.max(1, Math.min(4, 1 + (edge.total_requests || 0) / 150)),
        color: edgeColor,
        curveness: curveness,
        opacity: 0.5, // More transparent for less visual clutter
      },
      label: {
        show: false,
      },
      emphasis: {
        lineStyle: {
          width: 5,
          opacity: 0.9,
        },
      },
    };
  });

  // Determine if we should use force layout, circular layout, or fixed positions
  const hasPositions = cachedPositions && cachedPositions.size > 0;

  // For force layout without cached positions, compute layout with D3-force
  if (normalizedLayoutType === 'force' && !hasPositions) {
    console.log('[convertServiceGraphToNetwork] Computing force layout with D3-force');
    const positionedNodes = computeForceLayout(nodes, graphData.edges, 800, 600);

    // Apply computed positions to nodes and mark them as fixed
    positionedNodes.forEach((positioned: any) => {
      const node = nodes.find((n: any) => n.id === positioned.id);
      if (node) {
        node.x = positioned.x;
        node.y = positioned.y;
        node.fixed = true; // Lock positions so ECharts doesn't re-layout
      }
    });

    console.log('[convertServiceGraphToNetwork] Applied D3-force positions to', positionedNodes.length, 'nodes');
  }

  // For circular layout, calculate positions manually on the periphery
  if (normalizedLayoutType === 'circular' && !hasPositions) {
    const nodeCount = nodes.length;
    const nodeSize = 15; // Node diameter
    const radius = 280; // Radius where node centers are positioned
    const centerX = 0;
    const centerY = 0;

    nodes.forEach((node: any, index: number) => {
      const angle = (2 * Math.PI * index) / nodeCount - Math.PI / 2; // Start from top
      node.x = centerX + radius * Math.cos(angle);
      node.y = centerY + radius * Math.sin(angle);
      node.fixed = true;

      // For circular layout, use small uniform nodes (chord diagram style)
      node.symbolSize = nodeSize;

      // Simplify styling for chord diagram - use solid colors without gradients
      node.itemStyle = {
        color: node.itemStyle.borderColor, // Use the border color as fill
        borderColor: '#ffffff',
        borderWidth: 2,
        shadowBlur: 5,
        shadowColor: 'rgba(0, 0, 0, 0.2)',
      };
    });

    console.log('[convertServiceGraphToNetwork] Using circular layout with', nodeCount, 'nodes on periphery');
  } else if (hasPositions) {
    console.log('[convertServiceGraphToNetwork] Using cached positions for', cachedPositions.size, 'nodes');
  }

  // Use "none" layout when we have fixed positions (D3-force computed, circular, or cached)
  // Always use "none" since we compute positions manually or use cached ones
  const layoutMode = "none";

  const options = {
    tooltip: {
      trigger: "item",
      triggerOn: "mousemove",
      backgroundColor: 'rgba(50, 50, 50, 0.95)',
      borderColor: '#777',
      borderWidth: 1,
      textStyle: {
        color: '#fff',
      },
    },
    animation: hasPositions ? false : true, // Disable animation when using cached positions
    series: [
      {
        type: "graph",
        layout: layoutMode,
        data: nodes,
        links: edges,
        roam: true,
        draggable: true, // Enable dragging to allow manual position adjustments
        focusNodeAdjacency: true,
        scaleLimit: {
          min: 0.4,
          max: 3,
        },
        label: normalizedLayoutType === 'circular' ? {
          show: true,
          position: 'top',
          formatter: (params: any) => params.data.name,
          fontSize: 11,
          color: '#333',
        } : {
          show: true,
          formatter: (params: any) => {
            const requests = params.data.value || 0;
            const errors = params.data.errors || 0;
            const errorRate = requests > 0 ? (errors / requests) : 0;
            const reqPerSec = (requests / 60).toFixed(2);
            const errorDisplay = (errorRate * 100).toFixed(2);
            const serviceName = params.data.name;

            // Display metrics inside, name below using rich text
            return `{metrics|${errorDisplay} ms/r}\n{metrics|${reqPerSec} r/sec}\n{spacer|}\n{name|${serviceName}}`;
          },
          rich: {
            metrics: {
              fontSize: 10,
              color: '#333',
              lineHeight: 14,
              align: 'center',
            },
            spacer: {
              height: 40,
              lineHeight: 40,
            },
            name: {
              fontSize: 11,
              fontWeight: 'normal',
              color: '#333',
              align: 'center',
              lineHeight: 16,
            },
          },
        },
        emphasis: {
          focus: "adjacency",
          label: {
            show: true,
            fontSize: 13,
            fontWeight: 'bold',
          },
          itemStyle: {
            shadowBlur: 15,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
        lineStyle: {
          opacity: normalizedLayoutType === 'circular' ? 0.5 : 0.7,
          curveness: 'auto', // Let individual edges control curveness
        },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [0, normalizedLayoutType === 'circular' ? 10 : 15],
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
