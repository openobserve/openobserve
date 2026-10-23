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

// Kept apart from the layouts so the curated page can pick a target without loading the Kubernetes explorer's queries.

import type { KubernetesDashboardKey } from "./kubernetes.dashboards";

export interface KubernetesDashboardTarget {
  key: KubernetesDashboardKey;
  /** Tab id inside that dashboard. */
  tabId: string;
  /** Variables that dashboard declares; a pick for any other name has nowhere to land. */
  variables: readonly string[];
}

const CLUSTER_VARIABLES = ["cluster", "namespace"] as const;

const clusterTab = (tabId: string): KubernetesDashboardTarget => ({
  key: "cluster",
  tabId,
  variables: CLUSTER_VARIABLES,
});

/** By curated-page tab id; the layouts spec holds this to the real layouts. */
const TARGET_BY_PAGE_TAB: Readonly<Record<string, KubernetesDashboardTarget>> = {
  // The fleet bars of the page's Overview live on the Cluster copy's Inventory tab.
  overview: clusterTab("inventory"),
  inventory: clusterTab("inventory"),
  health: clusterTab("health"),
  utilization: clusterTab("utilization"),
  nodes: { key: "node", tabId: "nodes", variables: ["cluster", "node"] },
  workloads: { key: "pod", tabId: "pods", variables: ["cluster", "namespace", "pod"] },
};

/** The ready-made dashboard and tab that mirror a tab of Infrastructure → Kubernetes. */
export function kubernetesDashboardForPageTab(
  pageTabId: string | null | undefined,
): KubernetesDashboardTarget {
  return TARGET_BY_PAGE_TAB[pageTabId ?? ""] ?? TARGET_BY_PAGE_TAB.inventory;
}
