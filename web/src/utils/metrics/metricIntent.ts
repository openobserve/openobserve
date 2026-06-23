// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { StreamInfo } from "@/services/service_streams";
import { NETWORK_PATTERNS } from "@/utils/metrics/metricGrouping";
import { resolveSetId } from "@/composables/useMetricSubjectButtons";

/**
 * Intent-based metric organization.
 *
 * Replaces the legacy Network/Infra/Others taxonomy with question-shaped pills
 * (Essentials, Compute, Memory, Storage, Network, All). Each pill except
 * Essentials and All is a pattern filter on the metric stream name; Essentials
 * is a workload-specific curated whitelist; All is pass-through.
 *
 * Scope filtering (Pod / Node) is handled by `useMetricSubjectButtons` and
 * applied to the stream pool *before* an intent filter is applied.
 */

export type IntentId =
  | "essentials"
  | "compute"
  | "memory"
  | "storage"
  | "network"
  | "all";

export interface IntentDefinition {
  id: IntentId;
  label: string;
  icon?: string;
}

export const INTENT_DEFINITIONS: IntentDefinition[] = [
  { id: "essentials", label: "Essentials", icon: "star" },
  { id: "compute",    label: "Compute",    icon: "memory" },
  { id: "memory",     label: "Memory",     icon: "dns" },
  { id: "storage",    label: "Storage",    icon: "storage" },
  { id: "network",    label: "Network",    icon: "wifi" },
  { id: "all",        label: "All",        icon: "apps" },
];

/**
 * Pattern-based intent classifiers. Stream names are tested case-insensitively;
 * first match wins when used in a "primary intent" context (not used today —
 * pills are independent filters, a stream can satisfy multiple).
 */
const INTENT_PATTERNS: Record<
  Exclude<IntentId, "essentials" | "all">,
  RegExp[]
> = {
  compute: [
    /cpu/i,
    /\bprocess\b/i,
    /\bruntime\b/i,
    /thread/i,
    /goroutine/i,
  ],
  memory: [
    /memory/i,
    /\bmem_/i,
    /\bheap\b/i,
    /\brss\b/i,
    /\bgc\b/i,
    /page_fault/i,
    /\boom\b/i,
    /alloc/i,
  ],
  storage: [
    /disk/i,
    /filesystem/i,
    /\bfs_/i,
    /volume/i,
    /inode/i,
    /\bio_/i,
    /storage/i,
  ],
  // Reuse the canonical Network pattern list from metricGrouping so the two
  // taxonomies stay in lockstep when the list evolves.
  network: NETWORK_PATTERNS,
};

/**
 * Curated stream names per workload (matched_set_id). Used when no active
 * subject is known, or as a fallback when the active subject doesn't have a
 * dedicated curation list.
 */
export const ESSENTIALS_BY_WORKLOAD: Record<string, string[]> = {
  kubernetes: [
    "k8s_pod_cpu_usage",
    "k8s_pod_memory_usage",
    "k8s_pod_filesystem_usage",
    "k8s_pod_network_io",
  ],
  // aws, gcp, azure — left empty for v1.
};

/**
 * Subject-aware Essentials curation. When the active subject (Pod, Node, …)
 * is known, this map provides a more relevant set of streams for that lens.
 * Key format: `${matchedSetId}:${subjectId}` (subject id from
 * SUBJECT_BUTTONS_BY_SET, e.g. "pod" or "node").
 *
 * Falls back to ESSENTIALS_BY_WORKLOAD[matchedSetId] when no entry exists.
 */
export const ESSENTIALS_BY_WORKLOAD_SUBJECT: Record<string, string[]> = {
  "kubernetes:pod": [
    "k8s_pod_memory_usage",
    "k8s_pod_cpu_usage",
    "k8s_pod_network_io",
    "k8s_pod_cpu_request_utilization",
    "k8s_pod_cpu_limit_utilization",
    "k8s_pod_memory_request_utilization",
    "k8s_pod_memory_limit_utilization",
    "k8s_node_allocatable_cpu",
  ],
  // Streams derived from the "Kubernetes / Nodes" preset dashboard's panels.
  // Covers: memory (rss + utilization %), CPU (raw + utilization %), network
  // (receive + transmit), and storage (IOPS + throughput).
  "kubernetes:node": [
    "k8s_node_memory_rss",
    "k8s_node_cpu_usage",
    "k8s_node_network_io",
    "k8s_node_memory_usage",
    "k8s_node_allocatable_cpu",
    "k8s_node_allocatable_memory",
    "system_disk_operations",
    "system_disk_io",
  ],
};

function curatedFor(
  matchedSetId: string | undefined | null,
  subjectId?: string | null,
): string[] {
  if (!matchedSetId) return [];
  const canonical = resolveSetId(matchedSetId) ?? matchedSetId;
  if (subjectId) {
    const subjectKey = `${canonical}:${subjectId}`;
    if (ESSENTIALS_BY_WORKLOAD_SUBJECT[subjectKey])
      return ESSENTIALS_BY_WORKLOAD_SUBJECT[subjectKey];
  }
  return ESSENTIALS_BY_WORKLOAD[canonical] ?? [];
}

// Patterns may or may not carry the /i flag — metricGrouping uses
// case-sensitive patterns against a lowercased input. Mirror that contract by
// lowercasing here so reused pattern lists behave identically.
function matchesAnyPattern(name: string, patterns: RegExp[]): boolean {
  const lower = name.toLowerCase();
  return patterns.some((p) => p.test(lower));
}

/**
 * Filter a stream pool by the given intent.
 *
 * - "all"        → pass-through
 * - "essentials" → exact name intersection with ESSENTIALS_BY_WORKLOAD[matchedSetId]
 * - others       → pattern match against INTENT_PATTERNS
 *
 * The caller is responsible for applying any scope filter (Pod / Node) to
 * `streams` before passing them in. This keeps intent filtering pure.
 */
export function filterByIntent(
  streams: StreamInfo[],
  intent: IntentId,
  matchedSetId: string | undefined | null,
  subjectId?: string | null,
): StreamInfo[] {
  if (intent === "all") return streams;
  if (intent === "essentials") {
    const curated = curatedFor(matchedSetId, subjectId);
    if (curated.length === 0) return streams;
    const allowed = new Set(curated);
    const matched = streams.filter((s) => allowed.has(s.stream_name));
    if (matched.length === 0) return streams;
    // Prefer curated streams that have data in the selected time range.
    // Fall back to the full curated match only when none have overlap.
    const withData = matched.filter((s) => (s as any).overlap === "yes");
    return withData.length > 0 ? withData : matched;
  }
  const patterns = INTENT_PATTERNS[intent];
  return streams.filter((s) => matchesAnyPattern(s.stream_name, patterns));
}

/**
 * Return the subset of `streams` that are curated essentials for the active
 * workload + subject. Used to render an "essential" tag on chart cells
 * regardless of which pill is active.
 */
export function getEssentialStreams(
  streams: StreamInfo[],
  matchedSetId: string | undefined | null,
  subjectId?: string | null,
): StreamInfo[] {
  const curated = curatedFor(matchedSetId, subjectId);
  if (curated.length === 0) return [];
  const allowed = new Set(curated);
  return streams.filter((s) => allowed.has(s.stream_name));
}

/**
 * Check whether the Essentials pill should be enabled.
 */
export function hasEssentials(
  streams: StreamInfo[],
  matchedSetId: string | undefined | null,
  subjectId?: string | null,
): boolean {
  return getEssentialStreams(streams, matchedSetId, subjectId).length > 0;
}

/**
 * Choose the default pill on initial load.
 */
export function pickDefaultIntent(
  streams: StreamInfo[],
  matchedSetId: string | undefined | null,
  subjectId?: string | null,
): IntentId {
  if (hasEssentials(streams, matchedSetId, subjectId)) return "essentials";
  if (filterByIntent(streams, "compute", matchedSetId, subjectId).length > 0)
    return "compute";
  return "all";
}
