// Copyright 2026 OpenObserve Inc.

import type { RouteLocationRaw } from "vue-router";
import { b64EncodeUnicode, escapeSingleQuotes } from "@/utils/zincutils";
import { escapeLabel, regexEscape } from "./kubernetesQueries";
import type { DetailsRef } from "./kubernetesUrlState";

export interface NavContext {
  orgId: string;
  // µs
  start: number;
  end: number;
}

export interface TracesContext extends NavContext {
  stream: string;
}

export interface MetricsTarget {
  stream: string;
  promql: string;
}

const NAMESPACE_LABEL = "k8s_namespace_name";

// Pod names a controller generates: a Deployment adds a ReplicaSet hash and a pod suffix, a StatefulSet an ordinal, a CronJob the scheduled minute.
const POD_SUFFIX: Record<string, string> = {
  deployment: "-[a-z0-9]+-[a-z0-9]{5}",
  replicaset: "-[a-z0-9]{5}",
  daemonset: "-[a-z0-9]{5}",
  statefulset: "-[0-9]+",
  job: "-[a-z0-9]{5}",
  cronjob: "-[0-9]+-[a-z0-9]{5}",
};
const DEFAULT_POD_SUFFIX = "-[a-z0-9]+";

// The pod usage series carry only the pod and namespace, so workloads match their pods by generated name.
export function metricsTarget(ref: DetailsRef): MetricsTarget {
  const name = escapeLabel(ref.name);
  const ns = escapeLabel(ref.namespace);
  if (ref.kind === "node") {
    return {
      stream: "k8s_node_cpu_usage",
      promql: `k8s_node_cpu_usage{k8s_node_name="${name}"}`,
    };
  }
  if (ref.kind === "pod") {
    return {
      stream: "k8s_pod_cpu_usage",
      promql: `k8s_pod_cpu_usage{k8s_pod_name="${name}", ${NAMESPACE_LABEL}="${ns}"}`,
    };
  }
  if (ref.kind === "namespace") {
    return {
      stream: "k8s_pod_cpu_usage",
      promql: `sum(k8s_pod_cpu_usage{${NAMESPACE_LABEL}="${name}"})`,
    };
  }
  const pattern = escapeLabel(regexEscape(ref.name)) + (POD_SUFFIX[ref.kind] ?? DEFAULT_POD_SUFFIX);
  return {
    stream: "k8s_pod_cpu_usage",
    promql: `sum(k8s_pod_cpu_usage{k8s_pod_name=~"${pattern}", ${NAMESPACE_LABEL}="${ns}"})`,
  };
}

export function metricsRoute(ref: DetailsRef, ctx: NavContext): RouteLocationRaw {
  const { stream, promql } = metricsTarget(ref);
  return {
    name: "metrics",
    query: {
      org_identifier: ctx.orgId,
      query_type: "promql",
      stream_name: stream,
      query: b64EncodeUnicode(promql) ?? "",
      from: String(ctx.start),
      to: String(ctx.end),
    },
  };
}

// The same pod-name field Logs uses, so a pod's spans and logs are found by one name.
export function tracesFilter(ref: DetailsRef): string {
  const terms = [`k8s_pod_name='${escapeSingleQuotes(ref.name)}'`];
  if (ref.namespace) terms.push(`${NAMESPACE_LABEL}='${escapeSingleQuotes(ref.namespace)}'`);
  return terms.join(" AND ");
}

// Prefers the conventional stream, else the first by name; null when the org has no trace streams.
export function pickTracesStream(names: string[]): string | null {
  if (names.includes("default")) return "default";
  return [...names].sort()[0] ?? null;
}

export function tracesRoute(ref: DetailsRef, ctx: TracesContext): RouteLocationRaw {
  return {
    name: "traces",
    query: {
      org_identifier: ctx.orgId,
      stream: ctx.stream,
      filter: tracesFilter(ref),
      from: String(ctx.start),
      to: String(ctx.end),
    },
  };
}
