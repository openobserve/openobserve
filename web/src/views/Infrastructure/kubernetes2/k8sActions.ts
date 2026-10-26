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

import type { DetailKind } from "./kubernetesQueries";
import type { DetailsRef } from "./kubernetesUrlState";

export type K8sAction =
  "details" | "yaml" | "logs" | "metrics" | "traces" | "explain" | "scale" | "restart" | "delete";

export type K8sWriteAction = Extract<K8sAction, "scale" | "restart" | "delete">;

export type K8sActionEvent = [type: K8sAction, ref: DetailsRef];

const WRITE_ACTIONS: Record<DetailKind, K8sWriteAction[]> = {
  pod: ["delete"],
  node: [],
  deployment: ["scale", "restart", "delete"],
  statefulset: ["scale", "restart", "delete"],
  daemonset: ["restart", "delete"],
  replicaset: ["scale", "delete"],
  job: ["delete"],
  cronjob: ["delete"],
  pvc: ["delete"],
  hpa: ["delete"],
  namespace: [],
};

export const writeActionsFor = (kind: DetailKind): K8sWriteAction[] => WRITE_ACTIONS[kind];

export const readActionsFor = (kind: DetailKind): Exclude<K8sAction, "explain">[] => {
  const out: Exclude<K8sAction, "explain">[] = ["details", "yaml"];
  if (kind === "pod") out.push("logs", "traces");
  out.push("metrics");
  return out;
};
