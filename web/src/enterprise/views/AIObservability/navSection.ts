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

// Which rail item is lit for the route we are on.
//
// Matched by PREFIX, not by an exact list: every section grows drill-down routes
// (`aiExperimentDetail`, `aiDatasetDetail`, `aiQueueWorkbench`) and an exact list
// silently unlights the rail the day one is added. Prefixes make a new sub-route
// inherit its parent's highlight by default.

/** No entry here may be a prefix of another, or the earlier one always wins. */
const SECTION_BY_ROUTE_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ["aiLLMInsights", "llmInsights"],
  ["aiSession", "sessions"],
  ["aiAgentGraph", "agentGraph"],
  ["aiAgentBehavior", "agentBehavior"],
  ["aiDiscovery", "discovery"],
  ["aiQueue", "queues"],
  ["aiDataset", "datasets"],
  ["aiPlayground", "playground"],
  ["aiExperiment", "experiments"],
  ["aiRemoteTask", "remoteTasks"],
];

/**
 * The Evaluations pages all share one route name and are told apart by `?tab=`,
 * so that section maps down to the rail's per-tab keys instead of a prefix.
 */
const EVALUATIONS_ROUTE = "aiEvaluations";
const DEFAULT_EVALUATIONS_TAB = "quality";

export function navSection(routeName: unknown, tab?: unknown): string {
  const name = typeof routeName === "string" ? routeName : "";
  if (name === EVALUATIONS_ROUTE) {
    return typeof tab === "string" && tab ? tab : DEFAULT_EVALUATIONS_TAB;
  }
  return SECTION_BY_ROUTE_PREFIX.find(([prefix]) => name.startsWith(prefix))?.[1] ?? "";
}
