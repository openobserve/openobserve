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

import { Ref, ref } from 'vue'
import { useTreeVisualization, TreeNode } from '@/composables/useTreeVisualization'
import { getServiceIconDataUrl } from '@/utils/traces/convertTraceData'

/**
 * Service graph data structure
 */
export interface ServiceGraphData {
  nodes: ServiceGraphNode[]
  edges: ServiceGraphEdge[]
}

export interface ServiceGraphNode {
  id: string
  label?: string
  requests?: number
  errors?: number
  error_rate?: number
}

export interface ServiceGraphEdge {
  from: string
  to: string
  total_requests?: number
  failed_requests?: number
  error_rate?: number
}

/**
 * Composable for ServiceGraph tree visualization
 */
export function useServiceGraphTree(
  graphData: Ref<ServiceGraphData>,
  isDarkMode: Ref<boolean> = ref(false)
) {
  /**
   * Transform service graph data (nodes + edges) to TreeNode format
   */
  const transformServiceGraphToTree = (data: ServiceGraphData): TreeNode[] => {
    if (!data || !data.nodes || !data.edges) {
      return []
    }

    // Build adjacency maps for edges
    const edgesMap = new Map<string, ServiceGraphEdge[]>()
    data.edges.forEach((edge: ServiceGraphEdge) => {
      if (!edgesMap.has(edge.from)) {
        edgesMap.set(edge.from, [])
      }
      edgesMap.get(edge.from)!.push(edge)
    })

    // Build reverse adjacency map (incoming edges)
    const incomingEdgesMap = new Map<string, ServiceGraphEdge[]>()
    data.edges.forEach((edge: ServiceGraphEdge) => {
      if (!incomingEdgesMap.has(edge.to)) {
        incomingEdgesMap.set(edge.to, [])
      }
      incomingEdgesMap.get(edge.to)!.push(edge)
    })

    // Find all root nodes (nodes with no incoming edges)
    const nodesWithIncoming = new Set(data.edges.map((e: ServiceGraphEdge) => e.to))
    const rootNodes = data.nodes.filter(
      (n: ServiceGraphNode) => !nodesWithIncoming.has(n.id)
    )

    // Track all visited nodes across all trees to find orphaned components
    const globalVisited = new Set<string>()

    // Helper to build tree recursively
    const buildTree = (
      nodeId: string,
      visited = new Set<string>(),
      incomingEdge: ServiceGraphEdge | null = null
    ): TreeNode | null => {
      if (visited.has(nodeId)) return null // Prevent cycles
      visited.add(nodeId)
      globalVisited.add(nodeId)

      const node = data.nodes.find((n: ServiceGraphNode) => n.id === nodeId)
      if (!node) return null

      const outgoingEdges = edgesMap.get(nodeId) || []
      const children = outgoingEdges
        .map((edge: ServiceGraphEdge) => buildTree(edge.to, visited, edge))
        .filter((child: TreeNode | null) => child !== null) as TreeNode[]

      // Direction-aware request count based on tree position
      let totalRequests: number
      if (incomingEdge) {
        // Non-root: show traffic via this specific edge from parent
        totalRequests = incomingEdge.total_requests ?? 0
      } else {
        // Root: sum of outgoing edges
        totalRequests = outgoingEdges.reduce(
          (sum: number, edge: ServiceGraphEdge) => sum + (edge.total_requests ?? 0),
          0
        )

        // If no edges, fall back to node's own metrics
        if (totalRequests === 0 && node.requests !== undefined) {
          totalRequests = node.requests
        }
      }

      // Node error rate calculation
      const nodeErrorRate =
        node.error_rate ??
        (node.requests && node.requests > 0 ? ((node.errors || 0) / node.requests) * 100 : 0)

      return {
        id: node.id,
        name: node.label || node.id,
        value: totalRequests,
        errorRate: nodeErrorRate,
        children: children.length > 0 ? children : undefined,
        metadata: {
          serviceName: node.label || node.id,
          requests: totalRequests,
          errors: node.errors || 0,
          errorRate: nodeErrorRate,
          // Store icon data URL for ECharts
          iconDataUrl: getServiceIconDataUrl(node.id, isDarkMode.value, getHealthColor(nodeErrorRate, isDarkMode.value))
        }
      }
    }

    // Start with root nodes
    let treeData = rootNodes
      .map((node: ServiceGraphNode) => buildTree(node.id))
      .filter((n: TreeNode | null) => n !== null) as TreeNode[]

    // Find unvisited nodes (disconnected components or cycles)
    const unvisitedNodes = data.nodes.filter(
      (n: ServiceGraphNode) => !globalVisited.has(n.id)
    )

    // Add unvisited nodes as separate root trees
    if (unvisitedNodes.length > 0) {
      const additionalTrees = unvisitedNodes
        .map((node: ServiceGraphNode) => buildTree(node.id))
        .filter((n: TreeNode | null) => n !== null) as TreeNode[]
      treeData = [...treeData, ...additionalTrees]
    }

    // If still no tree data, create a flat structure
    if (treeData.length === 0 && data.nodes.length > 0) {
      return data.nodes.map((node: ServiceGraphNode) => ({
        id: node.id,
        name: node.label || node.id,
        value: node.requests || 0,
        errorRate: node.error_rate || 0,
        metadata: {
          serviceName: node.label || node.id,
          requests: node.requests || 0,
          errors: node.errors || 0,
          errorRate: node.error_rate || 0
        }
      }))
    }

    return treeData
  }

  /**
   * Get health-based color
   */
  const getHealthColor = (errorRate: number, isDarkMode: boolean): string => {
    const green = isDarkMode ? "#10b981" : "#52c41a"

    if (errorRate > 10) return isDarkMode ? "#ef4444" : "#f5222d" // Red — critical
    if (errorRate > 5) return isDarkMode ? "#f97316" : "#fa8c16"  // Orange — warning
    if (errorRate > 1) return isDarkMode ? "#fbbf24" : "#faad14"  // Yellow — degraded
    return green // Green — healthy
  }

  // Use the base tree visualization composable with service context
  return useTreeVisualization(
    graphData,
    transformServiceGraphToTree,
    { nodeType: 'service', isDarkMode: isDarkMode.value }
  )
}