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

import type { StarterPack } from "./types";

// Placeholder selection until the pack's real alert list is chosen.
export const PLACEHOLDER_KUBERNETES_ALERT_IDS = [
  "k8s/apiserver_high_latency",
  "k8s/cluster_cpu_capacity_high",
  "k8s/cluster_memory_capacity_high",
  "k8s/cluster_pod_count_high",
];

export const KUBERNETES_PACK: StarterPack = {
  id: "kubernetes",
  titleKey: "starterPacks.kubernetes.title",
  descriptionKey: "starterPacks.kubernetes.description",
  folder: { name: "Kubernetes", description: "Installed by the Kubernetes starter pack" },
  dashboards: [
    {
      id: "overview",
      title: "Kubernetes Overview",
      load: async () => ({
        version: 8,
        title: "Kubernetes Overview",
        description: "",
        tabs: [{ tabId: "default", name: "Default", panels: [] }],
      }),
    },
  ],
  alerts: PLACEHOLDER_KUBERNETES_ALERT_IDS,
  savedViews: [
    {
      id: "events",
      name: "Kubernetes events",
      search: {
        meta: {},
        data: {
          stream: { streamType: "logs", selectedStream: ["k8s_events"] },
          query: "",
        },
      },
    },
  ],
};
