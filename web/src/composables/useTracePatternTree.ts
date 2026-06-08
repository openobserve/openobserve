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

    // Separate service-level patterns from relationship patterns
    // Service patterns: key = service name (no '→'), metrics = service's own exclusive time
    // Relationship patterns: key = "from→to" (contains '→'), metrics = downstream call metrics
    const servicePatterns = new Map<string, CallPattern>()
    const relationshipPatterns = new Map<string, CallPattern>()

    patternMap.forEach((pattern, key) => {
      if (key.includes('→')) {
        relationshipPatterns.set(key, pattern)
      } else {
        servicePatterns.set(key, pattern)
      }
    })

    // Build service relationship map from relationship patterns only
    // (for tree structure — who calls whom)
    const serviceMap = new Map<string, {
      children: CallPattern[],
      parents: string[]
    }>()

    relationshipPatterns.forEach(pattern => {
      const services = pattern.pathSignature.split('→')
      if (services.length === 2) {
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

    // Add standalone services from service patterns that aren't in the relationship map
    servicePatterns.forEach((_, serviceName) => {
      if (!serviceMap.has(serviceName)) {
        serviceMap.set(serviceName, { children: [], parents: [] })
      }
    })

    // Find root services: skip the virtual 'root' node and treat services
    // whose only parent is 'root' as the actual tree roots
    const rootServices = Array.from(serviceMap.keys()).filter(
      service => {
        if (service === 'root') return false
        const parents = serviceMap.get(service)!.parents
        return parents.length === 0 ||
               (parents.length === 1 && parents[0] === 'root')
      }
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
          // Preserve the child node's own metrics — do NOT overwrite with relationship metrics.
          // Instead, attach relationship data to child's metadata for tooltip display.
          childNode.metadata = {
            ...childNode.metadata,
            parentRelationship: {
              pathSignature: pattern.pathSignature,
              callCount: pattern.metrics.count,
              avgLatency: pattern.metrics.avg,
              errorRate: pattern.metrics.errorRate,
              minLatency: pattern.metrics.min,
              maxLatency: pattern.metrics.max,
              p75Latency: pattern.metrics.p75,
              p95Latency: pattern.metrics.p95,
              p99Latency: pattern.metrics.p99
            }
          }
          children.push(childNode)
        }
      })

      // Get node-level metrics from the service's own pattern
      // This reflects the service's OWN execution time (exclusive), not downstream time
      const svcPattern = servicePatterns.get(serviceName)

      const count = svcPattern?.metrics.count ?? 0
      const avgDuration = svcPattern?.metrics.avg ?? 0
      const avgErrorRate = svcPattern?.metrics.errorRate ?? 0

      return {
        id: serviceName,
        name: serviceName,
        value: avgDuration,
        errorRate: avgErrorRate,
        children: children.length > 0 ? children : undefined,
        metadata: {
          pathSignature: serviceName,
          serviceName,
          count,
          avg: Math.round(avgDuration * 100) / 100,
          errorRate: Math.round(avgErrorRate * 100) / 100,
          // Inclusive time metrics
          min: svcPattern?.metrics.min ?? 0,
          max: svcPattern?.metrics.max ?? 0,
          p75: svcPattern?.metrics.p75 ?? 0,
          p95: svcPattern?.metrics.p95 ?? 0,
          p99: svcPattern?.metrics.p99 ?? 0,
          traceTimePercent: Math.round((svcPattern?.metrics.traceTimePercent ?? 0) * 100) / 100,
          totalDuration: svcPattern?.metrics.totalDuration ?? 0,
          exclusiveTimePercent: Math.round((svcPattern?.metrics.exclusiveTimePercent ?? 0) * 100) / 100,
          exclusiveTime: svcPattern?.metrics.exclusiveTime,
          selfTimeRatio: svcPattern?.metrics.selfTimeRatio ?? 0,
          // Span drill-down
          spanIds: svcPattern?.spanIds ?? [],
          instances: svcPattern?.instances ?? [],
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