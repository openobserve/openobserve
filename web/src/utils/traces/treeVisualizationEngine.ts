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

import { useStore } from 'vuex'
import { generateTracePatternTooltipContent } from './treeTooltipHelpers'

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

    // Convert TreeNode format to ECharts tree format
    const convertToEChartsFormat = (nodes: TreeNode[]): any[] => {
      return nodes.map(node => {
        const borderColor = getHealthColor(getNodeErrorRate(node), isDarkMode)
        const edgeColor = isDarkMode ? "#4a5568" : "#b0b7c3"

        return {
          name: node.name,
          value: node.value,
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
            borderWidth: 3, // Slightly thinner for default state
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
              borderColor: borderColor, // Maintain health color on hover
              borderWidth: 4, // Slightly thicker on hover
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
              borderColor: borderColor, // Keep health color
              borderWidth: 5, // Thicker border when selected
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
    // Use ECharts coordinate conversion for accurate hit testing
    const series = chart.getModel().getSeries()[0]
    if (!series) return null

    // Hit radius similar to Service Graph (20px for tree view)
    const HIT_RADIUS = 20
    let closestNode: TreeNode | null = null
    let closestDistance = Infinity

    const searchNodes = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        // Get node screen position from ECharts
        const nodePosition = chart.convertToPixel({ seriesIndex: 0 }, [node.x || 0, node.y || 0])
        if (!nodePosition) return

        const distance = Math.sqrt(
          Math.pow(point[0] - nodePosition[0], 2) +
          Math.pow(point[1] - nodePosition[1], 2)
        )

        if (distance < HIT_RADIUS && distance < closestDistance) {
          closestDistance = distance
          closestNode = node
        }

        if (node.children) {
          searchNodes(node.children)
        }
      })
    }

    searchNodes(treeData)
    return closestNode
  }

  /**
   * Setup custom DOM tooltips for trace graph nodes
   * Follows exact Service Graph tooltip patterns for consistency
   */
  const setupTraceNodeTooltips = (chart: any, data: TreeVisualizationData): (() => void) => {
    const chartDom = chart.getDom()
    const store = useStore()

    // Create tooltip element with Service Graph styling
    const tooltipEl = document.createElement("div")
    const isDarkMode = store.state.theme === 'dark'

    // Exact styling from Service Graph implementation
    tooltipEl.style.cssText = `
      position: absolute; pointer-events: none; z-index: 9999;
      background: ${isDarkMode ? "rgba(22, 22, 26, 0.90)" : "rgba(255, 255, 255, 0.88)"};
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid ${isDarkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)"};
      border-radius: 8px; padding: 9px 13px; font-size: 12px; line-height: 1.5;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      letter-spacing: 0.01em; white-space: nowrap; display: none;
      color: ${isDarkMode ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.82)"};
    `

    if (!chartDom.style.position || chartDom.style.position === "static") {
      chartDom.style.position = "relative"
    }
    chartDom.appendChild(tooltipEl)

    let hideTimer: ReturnType<typeof setTimeout> | null = null
    let activeNodeId: string | null = null

    // Positioning logic from Service Graph
    const positionTooltip = (mouseX: number, mouseY: number) => {
      const cw = chartDom.clientWidth
      const ch = chartDom.clientHeight
      let left = mouseX + 15
      let top = mouseY + 15

      tooltipEl.style.display = "block"

      if (left + tooltipEl.offsetWidth > cw) {
        left = mouseX - tooltipEl.offsetWidth - 10
      }
      if (top + tooltipEl.offsetHeight > ch) {
        top = mouseY - tooltipEl.offsetHeight - 10
      }

      tooltipEl.style.left = left + "px"
      tooltipEl.style.top = top + "px"
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

    // Mouse event handling with Service Graph timing
    const onMouseMove = (e: any) => {
      const hoveredNode = findNodeAtPoint(chart, [e.offsetX, e.offsetY], data.treeData)

      if (hoveredNode && hoveredNode.id !== activeNodeId) {
        if (hideTimer) {
          clearTimeout(hideTimer)
          hideTimer = null
        }
        activeNodeId = hoveredNode.id
        showNodeTooltip(e.offsetX, e.offsetY, hoveredNode)
      } else if (!hoveredNode && activeNodeId) {
        if (!hideTimer) {
          hideTimer = setTimeout(() => {
            hideTimer = null
            hideTooltip()
          }, 150)
        }
      }
    }

    const onMouseLeave = () => {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
      hideTooltip()
    }

    // Register mouse events
    const zr = chart.getZr()
    zr.on("mousemove", onMouseMove)
    zr.on("globalout", onMouseLeave)

    // Cleanup function
    return () => {
      if (hideTimer) clearTimeout(hideTimer)
      zr.off("mousemove", onMouseMove)
      zr.off("globalout", onMouseLeave)
      tooltipEl.remove()
    }
  }

  return {
    generateEChartsOptions,
    setupTraceNodeTooltips,
    findNodeAtPoint, // Export for testing
    getHealthColor
  }
}

/**
 * Legacy wrapper for backward compatibility with existing ServiceGraph.vue
 * This ensures zero breaking changes during the migration
 */
export const createLegacyTreeOptions = (
  graphData: { nodes: any[]; edges: any[] },
  layoutType: string = "horizontal",
  isDarkMode: boolean = true
) => {
  // This will be implemented when we migrate ServiceGraph.vue
  // For now, this is a placeholder to maintain the existing API
  throw new Error('Legacy tree options not yet implemented - use convertServiceGraphToTree for now')
}