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

import { Ref, ref } from "vue";
import { useTreeVisualization, TreeNode } from "@/composables/useTreeVisualization";
import { CallPattern } from "@/utils/traces/patternDetection";

/**
 * Composable for TraceDetails pattern tree visualization
 * Transforms consolidated call patterns into tree format for visualization
 */
export function useTracePatternTree(
  patterns: Ref<Map<string, CallPattern>>,
  isDarkMode: Ref<boolean> = ref(false),
) {
  /**
   * Transform simplified service relationships to TreeNode format
   * Creates a hierarchical tree structure from service-to-service calls
   */
  const transformPatternsToTree = (patternMap: Map<string, CallPattern>): TreeNode[] => {
    if (!patternMap || patternMap.size === 0) {
      return [];
    }

    // Build service relationship map
    const serviceMap = new Map<
      string,
      {
        children: CallPattern[];
        parents: string[];
      }
    >();

    // Initialize service map and find relationships
    patternMap.forEach((pattern) => {
      const services = pattern.pathSignature.split("→");
      if (services.length === 2) {
        const [fromService, toService] = services;

        // Initialize services in map if they don't exist
        if (!serviceMap.has(fromService)) {
          serviceMap.set(fromService, { children: [], parents: [] });
        }
        if (!serviceMap.has(toService)) {
          serviceMap.set(toService, { children: [], parents: [] });
        }

        // Add relationship
        serviceMap.get(fromService)!.children.push(pattern);
        serviceMap.get(toService)!.parents.push(fromService);
      } else if (services.length === 1 && services[0]) {
        // Self-pattern — register standalone services so they still get a
        // node when they have no cross-service relationships (e.g. traces
        // whose root spans all belong to the same service)
        if (!serviceMap.has(services[0])) {
          serviceMap.set(services[0], { children: [], parents: [] });
        }
      }
    });

    // Find root services (services with no parents)
    const rootServices = Array.from(serviceMap.keys()).filter(
      (service) => serviceMap.get(service)!.parents.length === 0,
    );

    // Track every service reached from a root so services that are
    // unreachable (cyclic relationships between root services) can be
    // promoted to roots afterwards instead of disappearing from the graph
    const globalVisited = new Set<string>();

    // Build tree recursively from root services
    const buildServiceTree = (
      serviceName: string,
      visited = new Set<string>(),
    ): TreeNode | null => {
      if (visited.has(serviceName)) return null; // Prevent cycles
      visited.add(serviceName);

      const serviceInfo = serviceMap.get(serviceName);
      if (!serviceInfo) return null;

      globalVisited.add(serviceName);

      // Create children from outgoing relationships
      const children: TreeNode[] = [];
      serviceInfo.children.forEach((pattern) => {
        const targetService = pattern.pathSignature.split("→")[1];
        const childNode = buildServiceTree(targetService, new Set(visited));
        if (childNode) {
          // Preserve child's own metrics (already set by its buildServiceTree call).
          // Only add edge-specific info — don't override with pattern.metrics spread.
          childNode.metadata = {
            ...childNode.metadata,
            pathSignature: pattern.pathSignature,
            spanIds: pattern.spanIds,
            instances: pattern.instances,
          };
          children.push(childNode);
        }
      });

      // Use the service's own self-pattern for its metrics (own span durationMs).
      // Falls back to children aggregation only if no self-pattern exists.
      const selfPattern = patternMap.get(serviceName);
      const totalCalls =
        selfPattern?.metrics?.count ||
        serviceInfo.children.reduce((sum, p) => sum + p.metrics.count, 0);
      const avgDuration =
        selfPattern?.metrics?.avg ||
        (serviceInfo.children.length > 0
          ? serviceInfo.children.reduce((sum, p) => sum + p.metrics.avg * p.metrics.count, 0) /
            Math.max(totalCalls, 1)
          : 0);
      const avgErrorRate =
        selfPattern?.metrics?.errorRate ??
        (serviceInfo.children.length > 0
          ? serviceInfo.children.reduce(
              (sum, p) => sum + p.metrics.errorRate * p.metrics.count,
              0,
            ) / Math.max(totalCalls, 1)
          : 0);

      return {
        id: serviceName,
        name: serviceName,
        value: avgDuration,
        errorRate: avgErrorRate,
        children: children.length > 0 ? children : undefined,
        metadata: {
          ...selfPattern?.metrics,
          serviceName,
          count: totalCalls,
          avg: Math.round(avgDuration * 100) / 100,
          errorRate: Math.round(avgErrorRate * 100) / 100,
          isLeaf: children.length === 0,
        },
      };
    };

    // Build tree from all root services
    const treeNodes: TreeNode[] = rootServices
      .map((serviceName) => buildServiceTree(serviceName))
      .filter((node): node is TreeNode => node !== null);

    // Services unreachable from any parentless root — e.g. two root spans
    // whose services call each other (A→B and B→A) leave no parentless
    // service at all. Promote one uncovered service at a time to a root;
    // each promotion marks everything it reaches as visited
    serviceMap.forEach((_info, serviceName) => {
      if (!globalVisited.has(serviceName)) {
        const node = buildServiceTree(serviceName);
        if (node) treeNodes.push(node);
      }
    });

    return treeNodes;
  };

  // Use the base tree visualization composable with pattern context
  return useTreeVisualization(patterns, transformPatternsToTree, {
    nodeType: "pattern",
    isDarkMode: isDarkMode.value,
  });
}
