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

import { getServiceColorHex } from '@/utils/traces/traceColors'

/**
 * Tree node interface for tree visualization with coordinate support
 */
export interface TreeNode {
  id: string
  name: string
  label?: string
  value: number // Primary metric (requests/duration)
  errorRate?: number
  children?: TreeNode[]
  metadata?: Record<string, any> // Context-specific data
  x?: number // Node position for coordinate-based hit detection
  y?: number // Node position for coordinate-based hit detection
}

/**
 * Configuration for tree visualization rendering
 */
export interface TreeVisualizationConfig {
  layoutType: 'horizontal' | 'vertical'
  isDarkMode: boolean
  nodeSize: 'fixed' | 'dynamic'
  symbolSize?: number
}

/**
 * Data interface for tree visualization
 */
export interface TreeVisualizationData {
  treeData: TreeNode[]
  getNodeLabel: (node: TreeNode) => string
  getNodeTooltip: (node: TreeNode) => string
  getNodeErrorRate: (node: TreeNode) => number
  getNodeServiceColor?: (node: TreeNode) => string
}

/**
 * Create shared tree visualization engine
 * Provides consistent ECharts tree configuration across ServiceGraph and TraceDetails
 */
export function createTreeVisualizationEngine() {
  /**
   * Generate ECharts tree options with shared styling and behavior
   * Reuses the proven patterns from ServiceGraph.vue tree view
   */
  const generateEChartsOptions = (
    data: TreeVisualizationData,
    config: TreeVisualizationConfig
  ): any => {
    // Generate ECharts tree configuration from provided tree data
    const { treeData, getNodeLabel, getNodeErrorRate } = data
    const { layoutType, isDarkMode, nodeSize, symbolSize = 30 } = config

    /**
     * Create a simple circle SVG data URL with a colored border.
     * The border is baked into the SVG so it's always visible — ECharts tree
     * series doesn't reliably render itemStyle.borderColor on default symbols.
     * Pattern matches ServiceGraph's getServiceIconSvg in convertTraceData.ts.
     */
    const getCircleSvg = (fillColor: string, strokeColor: string, strokeWidth: number): string => {
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56">` +
        `<circle cx="28" cy="28" r="22" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>` +
        `</svg>`
      return `image://data:image/svg+xml;base64,${btoa(encodeURIComponent(svg).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))))}`
    }

    // Convert TreeNode format to ECharts tree format
    const convertToEChartsFormat = (nodes: TreeNode[]): any[] => {
      return nodes.map(node => {
        const errorCount = getNodeErrorRate(node)
        const serviceColor = data.getNodeServiceColor?.(node)
          || getServiceColorHex(node.name, isDarkMode ? 'dark' : 'light')
        const borderColor = errorCount > 0
          ? (isDarkMode ? '#ef4444' : '#dc2626') // Red for error spans
          : serviceColor
        const edgeColor = isDarkMode ? "#4a5568" : "#b0b7c3"
        const fillColor = isDarkMode ? "#1a1f2e" : "#ffffff"

        return {
          name: node.name,
          value: node.value,
          symbol: getCircleSvg(fillColor, borderColor, 4),
          symbolSize: nodeSize === 'dynamic' ?
            Math.max(20, Math.min(50, Math.log10((node.value || 0) + 1) * 8)) :
            symbolSize,
          lineStyle: {
            color: edgeColor,
            width: 2,
          },
          itemStyle: {
            color: isDarkMode ? "#1a1f2e" : "#ffffff",
            borderColor: borderColor,
            borderWidth: 4, // Service-color border always visible
            borderType: "solid",
            shadowBlur: 10,
            shadowColor: isDarkMode ? "rgba(0, 0, 0, 0.3)" : "rgba(0, 0, 0, 0.1)",
            shadowOffsetX: 0,
            shadowOffsetY: 0,
            opacity: 1, // Ensure full opacity
          },
          emphasis: {
            scale: true,
            scaleSize: 1.15,
            itemStyle: {
              borderColor: borderColor, // Maintain service/error color on hover
              borderWidth: 5, // Slightly thicker on hover
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
            itemStyle: {
              borderColor: borderColor, // Keep service/error color
              borderWidth: 6, // Thicker border when selected
              borderType: "solid",
              shadowBlur: 45,
              shadowColor: "rgba(59, 130, 246, 0.9)", // Prominent blue glow for selection
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              opacity: 1,
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
            formatter: () => getNodeLabel(node),
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
              duration: {
                fontSize: 10,
                fontWeight: "normal",
                color: isDarkMode ? "#9ca3af" : "#6b7280",
                lineHeight: 14,
              },
            },
          },
          children: node.children ? convertToEChartsFormat(node.children) : undefined,
        }
      })
    }

    // Handle multiple root nodes - create virtual root if needed
    const echartsData = treeData.length > 1 ? [
      {
        name: "",
        symbolSize: 1,
        itemStyle: { opacity: 0 },
        label: { show: false },
        lineStyle: { opacity: 0 },
        children: convertToEChartsFormat(treeData),
      }
    ] : convertToEChartsFormat(treeData)

    // Generate ECharts options with consistent configuration
    const chartOptions = {
      backgroundColor: "transparent",
      tooltip: {
        show: false, // Custom tooltips handled by parent components
      },
      series: [
        {
          type: "tree",
          data: echartsData,
          layout: "orthogonal",
          orient: layoutType === "vertical" ? "TB" : "LR",
          // Consistent spacing configuration from ServiceGraph
          left: layoutType === "vertical" ? "2%" : "3%",
          right: layoutType === "vertical" ? "2%" : "20%",
          top: layoutType === "vertical" ? "8%" : "2%",
          bottom: layoutType === "vertical" ? "8%" : "2%",
          initialTreeDepth: -1,
          symbolSize: symbolSize,
          roam: true, // Enable panning and zooming
          selectedMode: "single", // Enable single node selection
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
            focus: "relative", // Dims nodes not connected to hovered node
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
    }

    // Return the complete ECharts configuration

    return chartOptions
  }

  /**
   * Get health-based color using the same thresholds as ServiceGraph
   * Reuses exact color logic from convertServiceGraphToTree
   */
  const getHealthColor = (errorRate: number, isDarkMode: boolean): string => {
    // Use more contrasting colors for better visibility
    if (errorRate > 10) return isDarkMode ? "#ef4444" : "#dc2626" // Red — critical
    if (errorRate > 5) return isDarkMode ? "#f97316" : "#ea580c"  // Orange — warning
    if (errorRate > 1) return isDarkMode ? "#fbbf24" : "#d97706"  // Yellow — degraded

    // Healthy nodes - use more contrasting green
    return isDarkMode ? "#10b981" : "#16a34a" // Green — healthy (more contrasting)
  }

  /**
   * Find chart node at screen coordinates using ECharts hit detection
   */
  const findNodeAtPoint = (chart: any, point: [number, number], treeData: TreeNode[]): TreeNode | null => {
    try {

      // Use ECharts' built-in hit detection for accurate node detection
      const zr = chart.getZr()
      if (!zr || !zr.handler) {
        return null;
      }

      // Get the element at the mouse position
      const hoveredElements = zr.handler.findHover(point[0], point[1])

      if (!hoveredElements || !hoveredElements.target) return null

      // Check if we hit a tree node symbol
      const target = hoveredElements.target
      const dataIndex = target.dataIndex

      if (dataIndex === undefined || dataIndex === null) return null

      // Find the corresponding tree node using the data index
      const foundNode = findNodeByIndex(treeData, dataIndex);
      return foundNode;
    } catch (error) {
      console.warn('Error in findNodeAtPoint:', error)
      return null
    }
  }

  /**
   * Helper to find tree node by name (more reliable than index)
   * Traverses the tree data to find the node with matching name
   */
  const findNodeByName = (nodes: TreeNode[], targetName: string): TreeNode | null => {
    const traverse = (nodeList: TreeNode[]): TreeNode | null => {
      for (const node of nodeList) {
        if (node.name === targetName || node.id === targetName) {
          return node
        }

        if (node.children && node.children.length > 0) {
          const found = traverse(node.children)
          if (found) return found
        }
      }
      return null
    }

    return traverse(nodes)
  }

  /**
   * Helper to find tree node by ECharts data index (fallback method)
   * Traverses the tree data to find the node at the given index
   */
  const findNodeByIndex = (nodes: TreeNode[], targetIndex: number): TreeNode | null => {
    let currentIndex = 0

    const traverse = (nodeList: TreeNode[]): TreeNode | null => {
      for (const node of nodeList) {
        if (currentIndex === targetIndex) {
          return node
        }
        currentIndex++

        if (node.children && node.children.length > 0) {
          const found = traverse(node.children)
          if (found) return found
        }
      }
      return null
    }

    return traverse(nodes)
  }

  /**
   * Setup custom DOM tooltips for trace graph nodes
   * Follows exact Service Graph tooltip patterns for consistency
   */
  const setupTraceNodeTooltips = (chart: any, data: TreeVisualizationData, isDarkMode: boolean): (() => void) => {

    const chartDom = chart.getDom()

    // Create tooltip element with Service Graph styling
    const tooltipEl = document.createElement("div")

    // Exact styling from Service Graph implementation
    tooltipEl.style.cssText = `
      position: absolute; pointer-events: none; z-index: 9999;
      background: ${isDarkMode ? "rgba(22, 22, 26, 0.90)" : "rgba(255, 255, 255, 0.88)"};
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid ${isDarkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)"};
      border-radius: 8px; padding: 9px 13px; font-size: 12px; line-height: 1.5;
      font-family: var(--font-sans);
      letter-spacing: 0.01em; white-space: nowrap; display: none;
      color: ${isDarkMode ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.82)"};
    `

    if (!chartDom.style.position || chartDom.style.position === "static") {
      chartDom.style.position = "relative"
    }
    chartDom.appendChild(tooltipEl)

    let hideTimer: ReturnType<typeof setTimeout> | null = null
    let activeNodeId: string | null = null

    // Positioning logic from Service Graph with proper dimension measurement
    const positionTooltip = (mouseX: number, mouseY: number) => {
      const cw = chartDom.clientWidth
      const ch = chartDom.clientHeight
      let left = mouseX + 15
      let top = mouseY + 15

      // Make visible but positioned off-screen to measure dimensions
      tooltipEl.style.visibility = 'hidden'
      tooltipEl.style.display = 'block'
      tooltipEl.style.left = '0px'
      tooltipEl.style.top = '0px'

      // Now we can get accurate dimensions
      const tooltipWidth = tooltipEl.offsetWidth
      const tooltipHeight = tooltipEl.offsetHeight

      // Adjust position if tooltip would go off-screen
      if (left + tooltipWidth > cw) {
        left = mouseX - tooltipWidth - 10
      }
      if (top + tooltipHeight > ch) {
        top = mouseY - tooltipHeight - 10
      }

      // Ensure tooltip doesn't go negative
      left = Math.max(5, left)
      top = Math.max(5, top)

      // Position and make visible
      tooltipEl.style.left = left + "px"
      tooltipEl.style.top = top + "px"
      tooltipEl.style.visibility = 'visible'
    }

    const showNodeTooltip = (mouseX: number, mouseY: number, node: TreeNode) => {

      const tooltipContent = data.getNodeTooltip(node)

      tooltipEl.innerHTML = tooltipContent
      positionTooltip(mouseX, mouseY)
    }

    const hideTooltip = () => {
      tooltipEl.style.display = "none"
      activeNodeId = null
    }

    // ECharts event handling - use built-in hover events directly on chart elements
    const onNodeMouseOver = (params: any) => {
      if (!params || !params.data) return;

      // Use node name to find matching TreeNode instead of unreliable dataIndex
      const hoveredNode = findNodeByName(data.treeData, params.data.name);
      if (hoveredNode && hoveredNode.id !== activeNodeId) {

        // Clear any existing timer to prevent race conditions
        if (hideTimer) {
          clearTimeout(hideTimer)
          hideTimer = null
        }

        activeNodeId = hoveredNode.id

        // Use event pixel coordinates if available, otherwise use chart center
        const mouseX = params.event?.offsetX || chartDom.clientWidth / 2;
        const mouseY = params.event?.offsetY || chartDom.clientHeight / 2;

        showNodeTooltip(mouseX, mouseY, hoveredNode)
      }
    }

    const onNodeMouseOut = (params: any) => {

      if (activeNodeId) {
        // Clear existing timer before setting new one
        if (hideTimer) {
          clearTimeout(hideTimer)
        }
        hideTimer = setTimeout(() => {
          hideTimer = null
          hideTooltip()
        }, 150)
      }
    }

    const onChartMouseLeave = () => {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
      hideTooltip()
    }

    // Register ECharts events directly on chart elements
    chart.on('mouseover', onNodeMouseOver)
    chart.on('mouseout', onNodeMouseOut)
    chart.on('globalout', onChartMouseLeave)

    // Cleanup function
    return () => {
      if (hideTimer) clearTimeout(hideTimer)
      chart.off('mouseover', onNodeMouseOver)
      chart.off('mouseout', onNodeMouseOut)
      chart.off('globalout', onChartMouseLeave)
      tooltipEl.remove()
    }
  }

  return {
    generateEChartsOptions,
    setupTraceNodeTooltips,
    findNodeAtPoint, // Export for testing
    findNodeByName, // Export helper for testing
    findNodeByIndex, // Export helper for testing
    getHealthColor
  }
}

/**
 * Placeholder tree-options API for ServiceGraph.vue — not yet implemented.
 */
export const createLegacyTreeOptions = (
  graphData: { nodes: any[]; edges: any[] },
  layoutType: string = "horizontal",
  isDarkMode: boolean = true
) => {
  throw new Error('Legacy tree options not yet implemented - use convertServiceGraphToTree for now')
}