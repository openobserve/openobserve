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

// Host dependency map from the Linux agent's network flows. Each agent labels a flow's ends with
// the names in its own --network-flows list (src_cidr, dst_cidr), so a box is a name, not an address.

import type { Series } from "./kubernetes2/kubernetesModel";
import {
  FLOW_STREAM,
  layoutColumns,
  pairEnds,
  type FlowEdge,
  type GraphNode,
} from "./kubernetes2/dependencyGraph";

// "host" is a name equal to a host's host_name; "unnamed" is an address no entry contains.
export type HostEndKind = "host" | "network" | "unnamed";

export interface HostEnd {
  id: string;
  kind: HostEndKind;
  name: string;
}

export type HostFlowEdge = FlowEdge<HostEnd>;

// Parentheses are not allowed in a --network-flows name, so this id cannot be one.
const UNNAMED_ID = "(unnamed)";

// Per reporting host, since both hosts report traffic between two agents; pairEnds keeps one host's count.
// Kubernetes rows share the stream; an empty match keeps the series that carry no cluster label.
export const hostFlowQuery = (windowS: number) =>
  `sum by (src_cidr, dst_cidr, direction, host_name) (rate(${FLOW_STREAM}{k8s_cluster=""}[${windowS}s]))`;

// A name is a host when a reporting agent or the hosts list uses it as a host_name. Traffic inside one
// name, such as loopback, is not a dependency.
export function pairHostFlows(series: Series[], knownHosts: string[] = []): HostFlowEdge[] {
  const hosts = new Set([...knownHosts, ...series.map((s) => s.metric.host_name)].filter(Boolean));
  const endOf = (metric: Record<string, string>, side: "src" | "dst"): HostEnd => {
    const name = metric[`${side}_cidr`] ?? "";
    const kind = !name ? "unnamed" : hosts.has(name) ? "host" : "network";
    return { id: name || UNNAMED_ID, kind, name };
  };
  return pairEnds(series, endOf, "host_name").filter((e) => e.source.id !== e.target.id);
}

const ORDER: Record<HostEndKind, number> = { host: 0, network: 1, unnamed: 2 };

// Hosts first, then networks, then unnamed addresses, by name in every column.
export const layoutHostGraph = (nodes: GraphNode<HostEnd>[]) =>
  layoutColumns(nodes, (x, y) => ORDER[x.kind] - ORDER[y.kind] || x.name.localeCompare(y.name));
