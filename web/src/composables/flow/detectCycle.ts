/* Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

// Shared cycle detection for the flow canvases (Pipelines + Workflows). Given
// the current edges and a proposed new connection, returns true if adding it
// would create a directed cycle.
//
// Edge endpoints are read from either the plain `source`/`target` strings or
// VueFlow's runtime-enriched `sourceNode.id`/`targetNode.id` — so it works
// whether the caller passes raw edges or VueFlow graph edges.

const edgeSource = (e: any): string | undefined => e?.source ?? e?.sourceNode?.id;
const edgeTarget = (e: any): string | undefined => e?.target ?? e?.targetNode?.id;

export const detectCycle = (edges: any[], connection: any): boolean => {
  // Build the adjacency list from existing edges + the proposed connection.
  const graph: Record<string, string[]> = {};
  (edges || []).forEach((e: any) => {
    const s = edgeSource(e);
    const t = edgeTarget(e);
    if (s == null || t == null) return;
    (graph[s] ||= []).push(t);
  });
  const cs = connection?.source;
  const ct = connection?.target;
  if (cs == null || ct == null) return false;
  (graph[cs] ||= []).push(ct);

  const dfs = (node: string, visited: Set<string>, stack: Set<string>): boolean => {
    if (!visited.has(node)) {
      visited.add(node);
      stack.add(node);
      for (const next of graph[node] || []) {
        if (!visited.has(next) && dfs(next, visited, stack)) return true;
        if (stack.has(next)) return true;
      }
    }
    stack.delete(node);
    return false;
  };

  return dfs(cs, new Set(), new Set());
};

export default detectCycle;
