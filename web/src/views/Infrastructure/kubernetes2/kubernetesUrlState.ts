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
import { ISSUE_KIND, type IssueKey, type K8sKind } from "./kubernetesQueries";

export interface K8sListState {
  kind: K8sKind;
  name: string;
  cluster: string | null;
  namespace: string | null;
  issue: IssueKey | null;
  onNode: [string, string] | null;
  workload: [string, string, string, string] | null;
  sort: string | null;
  desc: boolean;
  page: number;
  pod: [string, string, string] | null;
}

const LIST_PARAMS = [
  "kind",
  "name",
  "cluster",
  "namespace",
  "issue",
  "onNode",
  "workload",
  "sort",
  "desc",
  "page",
  "pod",
] as const;

const KINDS: readonly K8sKind[] = ["pods", "nodes", "deployments"];

const first = (value: unknown): string | null => {
  const flat = [value].flat();
  return flat[0] != null && flat[0] !== "" ? String(flat[0]) : null;
};

const isIssue = (value: string | null): value is IssueKey =>
  value != null && Object.prototype.hasOwnProperty.call(ISSUE_KIND, value);

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

export const parseListState = (query: LocationQuery | LocationQueryRaw): K8sListState => {
  const kindParam = first(query.kind);
  let kind: K8sKind = KINDS.includes(kindParam as K8sKind) ? (kindParam as K8sKind) : "pods";
  const issueParam = first(query.issue);
  let issue = isIssue(issueParam) ? issueParam : null;
  if (issue) kind = ISSUE_KIND[issue];
  const pod = decodeCompound(first(query.pod), 3) as K8sListState["pod"];
  // The drawer needs the Pods-tab queries behind it.
  if (pod) {
    kind = "pods";
    if (issue && ISSUE_KIND[issue] !== "pods") issue = null;
  }
  const page = Number(first(query.page));
  return {
    kind,
    name: first(query.name) ?? "",
    cluster: first(query.cluster),
    namespace: first(query.namespace),
    issue,
    onNode: decodeCompound(first(query.onNode), 2) as K8sListState["onNode"],
    workload: decodeCompound(first(query.workload), 4) as K8sListState["workload"],
    sort: first(query.sort),
    desc: first(query.desc) === "true",
    page: Number.isInteger(page) && page > 1 ? page : 1,
    pod,
  };
};

export const stripListParams = (query: LocationQuery | LocationQueryRaw): LocationQueryRaw => {
  const out: LocationQueryRaw = { ...query };
  for (const key of LIST_PARAMS) delete out[key];
  return out;
};

export const toQuery = (
  state: K8sListState,
  base: LocationQuery | LocationQueryRaw,
): LocationQueryRaw => {
  const out = stripListParams(base);
  if (state.kind !== "pods") out.kind = state.kind;
  if (state.name) out.name = state.name;
  if (state.cluster) out.cluster = state.cluster;
  if (state.namespace) out.namespace = state.namespace;
  if (state.issue) out.issue = state.issue;
  if (state.onNode) out.onNode = encodeCompound(state.onNode);
  if (state.workload) out.workload = encodeCompound(state.workload);
  if (state.sort) {
    out.sort = state.sort;
    if (state.desc) out.desc = "true";
  }
  if (state.page > 1) out.page = String(state.page);
  if (state.pod) out.pod = encodeCompound(state.pod);
  return out;
};

export const isCanonical = (query: LocationQuery | LocationQueryRaw) => {
  const canonical = toQuery(parseListState(query), query);
  return LIST_PARAMS.every((key) => {
    const current = query[key];
    return (current ?? null) === (canonical[key] ?? null);
  });
};

export const withFilter = (state: K8sListState, patch: Partial<K8sListState>): K8sListState => ({
  ...state,
  ...patch,
  page: 1,
});

export const withKind = (state: K8sListState, kind: K8sKind): K8sListState => ({
  ...state,
  kind,
  issue: state.issue && ISSUE_KIND[state.issue] === kind ? state.issue : null,
  onNode: kind === "pods" ? state.onNode : null,
  workload: kind === "pods" ? state.workload : null,
  sort: null,
  desc: false,
  page: 1,
});

// A cross-link is a new question about one node or workload, so it replaces the list filters it would otherwise stack on.
export const withNodeLink = (state: K8sListState, onNode: [string, string]): K8sListState => ({
  ...withKind(state, "pods"),
  issue: null,
  onNode,
  workload: null,
  pod: null,
});

export const withWorkloadLink = (
  state: K8sListState,
  workload: [string, string, string, string],
): K8sListState => ({
  ...withKind(state, "pods"),
  issue: null,
  onNode: null,
  workload,
  pod: null,
});

// The list then shows exactly what the tile counted, which uses only the scope facets.
export const withTile = (state: K8sListState, key: IssueKey | "all"): K8sListState => {
  if (key === "all") return withFilter(state, { issue: null });
  const moved = ISSUE_KIND[key] === state.kind ? state : withKind(state, ISSUE_KIND[key]);
  return { ...moved, issue: key, name: "", onNode: null, workload: null, page: 1 };
};
