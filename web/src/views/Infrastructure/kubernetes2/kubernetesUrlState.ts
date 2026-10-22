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

import type { LocationQuery, LocationQueryRaw } from "vue-router";
import {
  DETAIL_KINDS,
  VIEWS,
  type BuiltinGroup,
  type DetailKind,
  type MapEntity,
  type MapGroup,
  type View,
} from "./kubernetesQueries";

export type MapFill =
  "cpuReq" | "cpuLim" | "memReq" | "memLim" | "restarts" | "cpu" | "memory" | "status";

export interface DetailsRef {
  kind: DetailKind;
  cluster: string;
  namespace: string;
  name: string;
}

export interface K8sUrlState {
  view: View;
  cluster: string | null;
  namespaces: string[];
  search: string;
  sort: string | null;
  desc: boolean;
  entity: MapEntity;
  fill: MapFill;
  group: MapGroup;
  filter: string[];
  details: DetailsRef | null;
}

type Query = LocationQuery | LocationQueryRaw;

// Every param this page owns, including the MVP's removed ones so an old link is cleaned up.
const PAGE_PARAMS = [
  "view",
  "cluster",
  "namespace",
  "search",
  "sort",
  "desc",
  "entity",
  "fill",
  "group",
  "filter",
  "details",
  "kind",
  "name",
  "issue",
  "onNode",
  "workload",
  "page",
  "pod",
] as const;

export const ENTITY_FILLS: Record<MapEntity, readonly MapFill[]> = {
  pods: ["cpuReq", "cpuLim", "memReq", "memLim", "restarts", "status"],
  nodes: ["cpu", "memory", "status"],
};

export const MAP_GROUPS: Record<MapEntity, readonly BuiltinGroup[]> = {
  pods: ["node", "namespace", "workload", "none"],
  nodes: ["none"],
};

export const DEFAULT_GROUP: Record<MapEntity, BuiltinGroup> = { pods: "node", nodes: "none" };

const LABEL_GROUP = "label.";

const first = (value: unknown): string | null => {
  const flat = [value].flat();
  return flat[0] != null && flat[0] !== "" ? String(flat[0]) : null;
};

export const encodeCompound = (parts: readonly string[]) =>
  parts.map((part) => encodeURIComponent(part)).join("/");

export const decodeCompound = (value: string | null, segments: number): string[] | null => {
  if (value == null) return null;
  const parts = value.split("/");
  if (parts.length !== segments) return null;
  try {
    return parts.map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
};

export const encodeDetails = (d: DetailsRef) =>
  `${d.kind}/${encodeCompound([d.cluster, d.namespace, d.name])}`;

export const parseDetails = (value: string | null): DetailsRef | null => {
  const parts = decodeCompound(value, 4);
  if (!parts || !DETAIL_KINDS.includes(parts[0] as DetailKind) || !parts[3]) return null;
  return { kind: parts[0] as DetailKind, cluster: parts[1], namespace: parts[2], name: parts[3] };
};

export const isLabelGroup = (group: MapGroup): group is `label.${string}` =>
  group.startsWith(LABEL_GROUP);

export const labelGroupKey = (group: MapGroup) =>
  isLabelGroup(group) ? group.slice(LABEL_GROUP.length) : null;

// Label keys and values cannot contain "," or ":", so terms need no encoding of their own.
const parseFilter = (value: string | null): string[] => {
  const terms = (value ?? "").split(",").filter((term) => {
    const at = term.indexOf(":");
    return at > 0 && at < term.length - 1;
  });
  return [...new Set(terms)];
};

const parseGroup = (entity: MapEntity, value: string | null): MapGroup => {
  if (value && value.length > LABEL_GROUP.length && value.startsWith(LABEL_GROUP)) {
    return value as MapGroup;
  }
  return MAP_GROUPS[entity].includes(value as BuiltinGroup)
    ? (value as BuiltinGroup)
    : DEFAULT_GROUP[entity];
};

export const parseUrlState = (query: Query): K8sUrlState => {
  const viewParam = first(query.view);
  const view: View = VIEWS.includes(viewParam as View) ? (viewParam as View) : "cluster";
  const entity: MapEntity = first(query.entity) === "nodes" ? "nodes" : "pods";
  const fillParam = first(query.fill) as MapFill | null;
  const details = parseDetails(first(query.details));
  const clusterParam = first(query.cluster);
  return {
    view,
    // A shared drawer link opens in its own cluster.
    cluster: details?.cluster || (clusterParam === "*" ? null : clusterParam),
    namespaces: (first(query.namespace) ?? "").split(",").filter(Boolean),
    search: first(query.search) ?? "",
    sort: first(query.sort),
    desc: first(query.sort) != null && first(query.desc) === "true",
    entity,
    fill:
      fillParam && ENTITY_FILLS[entity].includes(fillParam) ? fillParam : ENTITY_FILLS[entity][0],
    group: parseGroup(entity, first(query.group)),
    filter: parseFilter(first(query.filter)),
    details,
  };
};

export const stripPageParams = (query: Query): LocationQueryRaw => {
  const out: LocationQueryRaw = { ...query };
  for (const key of PAGE_PARAMS) delete out[key];
  return out;
};

export const toQuery = (state: K8sUrlState, base: Query): LocationQueryRaw => {
  const out = stripPageParams(base);
  if (state.view !== "cluster") out.view = state.view;
  if (state.cluster) out.cluster = state.cluster;
  if (state.namespaces.length) out.namespace = state.namespaces.join(",");
  if (state.search) out.search = state.search;
  if (state.sort) {
    out.sort = state.sort;
    if (state.desc) out.desc = "true";
  }
  if (state.view === "map") {
    if (state.entity !== "pods") out.entity = state.entity;
    if (state.fill !== ENTITY_FILLS[state.entity][0]) out.fill = state.fill;
    if (state.group !== DEFAULT_GROUP[state.entity]) out.group = state.group;
    if (state.filter.length) out.filter = state.filter.join(",");
  }
  if (state.details) out.details = encodeDetails(state.details);
  return out;
};

export const isCanonical = (query: Query) => {
  const canonical = toQuery(parseUrlState(query), query);
  return PAGE_PARAMS.every((key) => (query[key] ?? null) === (canonical[key] ?? null));
};

// The drawer belongs to the view it was opened from, so a view change closes it.
export const withView = (state: K8sUrlState, view: View): K8sUrlState => ({
  ...state,
  view,
  search: "",
  sort: null,
  desc: false,
  entity: "pods",
  fill: ENTITY_FILLS.pods[0],
  group: DEFAULT_GROUP.pods,
  filter: [],
  details: null,
});

export const withDetails = (state: K8sUrlState, details: DetailsRef | null): K8sUrlState => ({
  ...state,
  cluster: details?.cluster || state.cluster,
  details,
});
