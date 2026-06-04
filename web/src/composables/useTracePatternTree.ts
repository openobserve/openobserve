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
import { CallPattern } from '@/utils/traces/patternDetection'

/**
 * Composable for TraceDetails pattern tree visualization
 * Transforms consolidated call patterns into tree format for visualization
 */
export function useTracePatternTree(
  patterns: Ref<Map<string, CallPattern>>,
  isDarkMode: Ref<boolean> = ref(false)
) {
  /**
   * Transform simplified service relationships to TreeNode format
   * Creates a hierarchical tree structure from service-to-service calls
   */
  const transformPatternsToTree = (patternMap: Map<string, CallPattern>): TreeNode[] => {
    if (!patternMap || patternMap.size === 0) {
      return []
    }

    // Build service relationship map
    const serviceMap = new Map<string, {
      children: CallPattern[],
      parents: string[]
    }>()

    // Initialize service map and find relationships
    patternMap.forEach(pattern => {
      const services = pattern.pathSignature.split('→')

      if (services.length === 1) {
        // Standalone service (single service trace or isolated service)
        const serviceName = services[0]
        if (!serviceMap.has(serviceName)) {
          serviceMap.set(serviceName, { children: [], parents: [] })
        }
        // Standalone services have no relationships, just track them
      } else if (services.length === 2) {
        // Service relationship
        const [fromService, toService] = services

        // Initialize services in map if they don't exist
        if (!serviceMap.has(fromService)) {
          serviceMap.set(fromService, { children: [], parents: [] })
        }
        if (!serviceMap.has(toService)) {
          serviceMap.set(toService, { children: [], parents: [] })
        }

        // Add relationship
        serviceMap.get(fromService)!.children.push(pattern)
        serviceMap.get(toService)!.parents.push(fromService)
      }
    })

    // Find root services (services with no parents)
    const rootServices = Array.from(serviceMap.keys()).filter(
      service => serviceMap.get(service)!.parents.length === 0
    )

    // Build tree recursively from root services
    const buildServiceTree = (serviceName: string, visited = new Set<string>()): TreeNode | null => {
      if (visited.has(serviceName)) return null // Prevent cycles
      visited.add(serviceName)

      const serviceInfo = serviceMap.get(serviceName)
      if (!serviceInfo) return null

      // Create children from outgoing relationships
      const children: TreeNode[] = []
      serviceInfo.children.forEach(pattern => {
        const targetService = pattern.pathSignature.split('→')[1]
        const childNode = buildServiceTree(targetService, new Set(visited))
        if (childNode) {
          // Update child node with aggregated metrics from this relationship
          childNode.value = pattern.metrics.avg
          childNode.errorRate = pattern.metrics.errorRate
          childNode.metadata = {
            ...childNode.metadata,
            ...pattern.metrics,
            pathSignature: pattern.pathSignature,
            spanIds: pattern.spanIds,
            instances: pattern.instances
          }
          children.push(childNode)
        }
      })

      // Calculate aggregated metrics for this service
      let totalCalls, avgDuration, avgErrorRate

      if (serviceInfo.children.length > 0) {
        // Service with relationships - aggregate from children
        totalCalls = serviceInfo.children.reduce((sum, p) => sum + p.metrics.count, 0)
        avgDuration = serviceInfo.children.reduce((sum, p) => sum + p.metrics.avg * p.metrics.count, 0) / Math.max(totalCalls, 1)
        avgErrorRate = serviceInfo.children.reduce((sum, p) => sum + p.metrics.errorRate * p.metrics.count, 0) / Math.max(totalCalls, 1)
      } else {
        // Standalone service - get metrics from the service's own pattern
        const standalonePattern = Array.from(patternMap.values()).find(p => p.pathSignature === serviceName)
        if (standalonePattern) {
          totalCalls = standalonePattern.metrics.count
          avgDuration = standalonePattern.metrics.avg
          avgErrorRate = standalonePattern.metrics.errorRate
        } else {
          // Fallback values
          totalCalls = 0
          avgDuration = 0
          avgErrorRate = 0
        }
      }

      return {
        id: serviceName,
        name: serviceName,
        value: avgDuration,
        errorRate: avgErrorRate,
        children: children.length > 0 ? children : undefined,
        metadata: {
          serviceName,
          count: totalCalls,
          avg: Math.round(avgDuration * 100) / 100,
          errorRate: Math.round(avgErrorRate * 100) / 100,
          isLeaf: children.length === 0
        }
      }
    }

    // Build tree from all root services
    const treeNodes: TreeNode[] = rootServices
      .map(serviceName => buildServiceTree(serviceName))
      .filter((node): node is TreeNode => node !== null)

    return treeNodes
  }

  /**
   * Create a TreeNode for a call pattern
   */
  const createPatternNode = (
    pattern: CallPattern,
    displayName: string,
    isLeaf: boolean
  ): TreeNode => {
    return {
      id: pattern.pathSignature,
      name: displayName,
      value: pattern.metrics.avg, // Use average duration as primary value
      errorRate: pattern.metrics.errorRate,
      metadata: {
        pathSignature: pattern.pathSignature,
        count: pattern.metrics.count,
        avg: Math.round(pattern.metrics.avg * 100) / 100, // Round to 2 decimal places
        min: pattern.metrics.min,
        max: pattern.metrics.max,
        p75: Math.round(pattern.metrics.p75 * 100) / 100,
        p95: Math.round(pattern.metrics.p95 * 100) / 100,
        p99: Math.round(pattern.metrics.p99 * 100) / 100,
        errorRate: Math.round(pattern.metrics.errorRate * 100) / 100,
        traceTimePercent: Math.round(pattern.metrics.traceTimePercent * 100) / 100,
        totalDuration: pattern.metrics.totalDuration,
        spanIds: pattern.spanIds,
        instances: pattern.instances,
        isLeaf
      }
    }
  }

  /**
   * Create a TreeNode for a root service that has multiple pattern children
   */
  const createRootServiceNode = (
    serviceName: string,
    patterns: CallPattern[]
  ): TreeNode => {
    // Aggregate metrics from all patterns under this service
    const totalCalls = patterns.reduce((sum, p) => sum + p.metrics.count, 0)
    const totalDuration = patterns.reduce((sum, p) => sum + p.metrics.totalDuration, 0)
    const totalErrors = patterns.reduce((sum, p) =>
      sum + (p.instances.filter(i => i.isError).length), 0)

    const avgDuration = totalCalls > 0 ? totalDuration / totalCalls : 0
    const errorRate = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0

    // Calculate aggregated trace time percentage
    const traceTimePercent = patterns.reduce((sum, p) => sum + p.metrics.traceTimePercent, 0)

    return {
      id: serviceName,
      name: serviceName,
      value: avgDuration,
      errorRate,
      metadata: {
        pathSignature: serviceName,
        count: totalCalls,
        avg: Math.round(avgDuration * 100) / 100,
        min: Math.min(...patterns.map(p => p.metrics.min)),
        max: Math.max(...patterns.map(p => p.metrics.max)),
        p75: calculateAggregatePercentile(patterns, 75),
        p95: calculateAggregatePercentile(patterns, 95),
        p99: calculateAggregatePercentile(patterns, 99),
        errorRate: Math.round(errorRate * 100) / 100,
        traceTimePercent: Math.round(traceTimePercent * 100) / 100,
        totalDuration,
        spanIds: patterns.flatMap(p => p.spanIds),
        instances: patterns.flatMap(p => p.instances),
        isLeaf: false
      }
    }
  }

  /**
   * Calculate aggregate percentile across multiple patterns
   */
  const calculateAggregatePercentile = (patterns: CallPattern[], percentile: number): number => {
    const allDurations = patterns.flatMap(p => p.instances.map(i => i.duration))
    if (allDurations.length === 0) return 0

    const sorted = allDurations.sort((a, b) => a - b)
    const index = (percentile / 100) * (sorted.length - 1)

    if (Math.floor(index) === index) {
      return Math.round(sorted[index] * 100) / 100
    } else {
      const lower = sorted[Math.floor(index)]
      const upper = sorted[Math.ceil(index)]
      const weight = index - Math.floor(index)
      return Math.round((lower * (1 - weight) + upper * weight) * 100) / 100
    }
  }

  // Use the base tree visualization composable with pattern context
  return useTreeVisualization(
    patterns,
    transformPatternsToTree,
    { nodeType: 'pattern', isDarkMode: isDarkMode.value }
  )
}