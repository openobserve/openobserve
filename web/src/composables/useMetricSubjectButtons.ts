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

import type { FieldAlias, StreamInfo } from "@/services/service_streams";

/**
 * Metric subject buttons — quick-select chips that sit alongside the existing
 * per-group All / None controls in the metrics correlation tab.
 *
 * The buttons are derived from the org's semantic groups so the metric-name
 * vocabulary aligns with the backend's identity-set matcher. For a given
 * `matched_set_id` (e.g. "k8s"), the registry below declares which semantic
 * groups become buttons (e.g. "k8s-pod-name" → "Pod"). Match patterns are
 * built at runtime from each semantic group's `fields` array.
 *
 * Adding a new workload (e.g. "redis"):
 *   1. Register a custom IdentitySet on the backend so correlate returns
 *      matched_set_id = "redis".
 *   2. Ensure the semantic groups for that workload (e.g. "redis-instance-name")
 *      exist in the org's semantic-groups config.
 *   3. Add an entry below referencing those semantic group ids.
 */

export type SubjectButtonSpec = {
  /**
   * Semantic group id(s) used for the WHERE clause. These drive the actual
   * SQL filter applied when this subject is active (e.g. "k8s-node-name"
   * for the Node subject → `WHERE k8s_node_name = '<node>'`).
   */
  semanticIds: string[];
  /**
   * Semantic group id(s) used for the **stream pool** filter (which metric
   * streams are visible/selectable when this subject is active). Optional;
   * defaults to `semanticIds`. Useful when a subject wants to include
   * streams beyond its own naming convention — e.g. Node should also show
   * pod-level metrics (`k8s_pod_*`) because they're all running on that
   * node, so `poolSemanticIds: ["k8s-node-name", "k8s-pod-name"]`.
   */
  poolSemanticIds?: string[];
  /** Stable identifier for the button (used as a Vue key). */
  id: string;
  /** Display label rendered on the chip, e.g. "Pod". */
  label: string;
  /** When true, this button's matching streams are pre-selected on load. */
  defaultActive?: boolean;
};

export type SubjectButton = SubjectButtonSpec & {
  /** Regexes built from `semanticIds` — used to match metric stream names
   *  when this subject is active. */
  patterns: RegExp[];
  /** Regexes built from `poolSemanticIds` (or `semanticIds` if unset) — used
   *  to filter the visible stream pool when this subject is active. */
  poolPatterns: RegExp[];
};

/**
 * Per matched_set_id, the ordered list of subject buttons to render.
 * Ordering controls left-to-right display order.
 *
 * Keys are canonical slugs. Use `resolveSubjectButtonSpecs` to look up by
 * any alias (e.g. "k8s" → kubernetes, "Amazon Web Services" → aws).
 */
export const SUBJECT_BUTTONS_BY_SET: Record<string, SubjectButtonSpec[]> = {
  // matched_set_id is `normalize_category_to_id(group)` on the backend, so for
  // semantic groups whose `group` field is "Kubernetes" the id is "kubernetes".
  kubernetes: [
    { id: "pod",  semanticIds: ["k8s-pod-name"],  label: "Pod", defaultActive: true },
    {
      id: "node",
      semanticIds: ["k8s-node-name"],
      // Also pool pod-level metrics — they run on this node.
      poolSemanticIds: ["k8s-node-name", "k8s-pod-name"],
      label: "Node",
    },
  ],
  aws: [
    { id: "ecs-task", semanticIds: ["aws-ecs-task"], label: "ECS Task", defaultActive: true },
    { id: "function", semanticIds: ["faas-name"],    label: "Function" },
    { id: "host",     semanticIds: ["host"],         label: "Host" },
  ],
  gcp: [
    { id: "instance",  semanticIds: ["gcp-instance"],  label: "Instance", defaultActive: true },
    { id: "cloud-run", semanticIds: ["gcp-cloud-run"], label: "Cloud Run" },
    { id: "function",  semanticIds: ["faas-name"],     label: "Function" },
  ],
  azure: [
    { id: "resource-group", semanticIds: ["azure-resource-group"], label: "Resource Group", defaultActive: true },
    { id: "role",           semanticIds: ["azure-cloud-role"],     label: "Role" },
    { id: "function",       semanticIds: ["faas-name"],            label: "Function" },
  ],
};

// Common aliases → canonical key in SUBJECT_BUTTONS_BY_SET
const SET_ID_ALIASES: Record<string, string> = {
  k8s: "kubernetes",
  kube: "kubernetes",
  "amazon web services": "aws",
  "google cloud": "gcp",
  "google cloud platform": "gcp",
  "microsoft azure": "azure",
};

/**
 * Resolve a matched_set_id (which may be a user-defined slug like "k8s" or
 * "prod-kubernetes") to the canonical SUBJECT_BUTTONS_BY_SET key.
 * Tries exact match first, then alias lookup, then prefix/substring match.
 */
export function resolveSetId(matchedSetId: string | undefined | null): string | undefined {
  if (!matchedSetId) return undefined;
  const lower = matchedSetId.toLowerCase();
  if (lower in SUBJECT_BUTTONS_BY_SET) return lower;
  if (lower in SET_ID_ALIASES) return SET_ID_ALIASES[lower];
  // prefix match: "k8s-prod" → "kubernetes", "aws-east" → "aws"
  for (const canonical of Object.keys(SUBJECT_BUTTONS_BY_SET)) {
    if (lower.startsWith(canonical) || lower.includes(canonical)) return canonical;
  }
  // alias prefix match
  for (const [alias, canonical] of Object.entries(SET_ID_ALIASES)) {
    if (lower.startsWith(alias) || lower.includes(alias)) return canonical;
  }
  return undefined;
}

// Semantic group field names carry OTel/Prometheus envelopes and identifier
// suffixes that don't appear in metric stream names. Strip them so we can
// match e.g. `k8s_pod_cpu_usage` against the `pod`/`k8s_pod` tokens derived
// from the `k8s-pod-name` field list (`k8s_pod_name`, `pod_name`, …).
const STRIP_PREFIXES =
  /^(attributes_|resource_|resource_attributes_|service_|kubernetes_node_labels_|kubernetes_labels_|k8s_labels_)/i;
const STRIP_SUFFIXES = /(_name|_id|_uid|_arn|_ip|_start_time)$/i;

const MIN_TOKEN_LENGTH = 3;

/**
 * Derive metric-name match tokens from a semantic group's `fields` array.
 * Returns lowercase, deduped tokens at least MIN_TOKEN_LENGTH chars long.
 */
export function extractMetricTokens(fields: string[]): string[] {
  const tokens = new Set<string>();
  for (const raw of fields) {
    const stripped = raw
      .replace(STRIP_PREFIXES, "")
      .replace(STRIP_SUFFIXES, "")
      .toLowerCase();
    if (stripped.length >= MIN_TOKEN_LENGTH) tokens.add(stripped);
  }
  return [...tokens];
}

/**
 * Build the regex patterns used to match metric stream names for a token.
 * Two flavors: anchored-prefix (`^pod[_.]`) and word-bounded (`\bpod\b`).
 */
export function tokenToPatterns(token: string): RegExp[] {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`^${escaped}[_.]`, "i"),
    new RegExp(`\\b${escaped}\\b`, "i"),
  ];
}

function patternsForSemanticGroups(
  semanticIds: string[],
  semanticGroups: FieldAlias[],
): RegExp[] {
  const tokens = new Set<string>();
  for (const semanticId of semanticIds) {
    const group = semanticGroups.find((g) => g.id === semanticId);
    if (!group) continue;
    for (const t of extractMetricTokens(group.fields)) tokens.add(t);
  }
  return [...tokens].flatMap(tokenToPatterns);
}

/**
 * Build the ordered subject-button list for a given matched_set_id.
 *
 * Returns an empty array when:
 * - matched_set_id is missing or not registered in SUBJECT_BUTTONS_BY_SET, or
 * - none of the registered semantic groups for this set produced any patterns
 *   (e.g. the org hasn't configured those semantic groups).
 *
 * Buttons whose patterns are empty (semantic group missing) are filtered out so
 * the header doesn't render dead chips.
 */
export function buildSubjectButtons(
  matchedSetId: string | undefined | null,
  semanticGroups: FieldAlias[],
): SubjectButton[] {
  if (!matchedSetId) return [];
  const canonical = resolveSetId(matchedSetId);
  const specs = canonical ? SUBJECT_BUTTONS_BY_SET[canonical] : undefined;
  if (!specs?.length) return [];
  return specs
    .map((spec) => {
      const patterns = patternsForSemanticGroups(
        spec.semanticIds,
        semanticGroups,
      );
      const poolPatterns = spec.poolSemanticIds
        ? patternsForSemanticGroups(spec.poolSemanticIds, semanticGroups)
        : patterns;
      return { ...spec, patterns, poolPatterns };
    })
    .filter((b) => b.patterns.length > 0);
}

/**
 * Result of walking the source row for workload subjects. For each semantic
 * id we record both the value and the field name we found it under, so
 * downstream consumers (e.g. WHERE-clause builders) know which column to
 * filter on.
 */
export type WorkloadChipEntry = {
  value: string;
  fieldName: string;
};

/**
 * Build a semantic-id keyed map of `{ value, fieldName }` from a source row.
 *
 * For each subject button registered for `matchedSetId`, walk its
 * `semanticIds` → look up each semantic group → walk its `fields[]` aliases
 * → find the first one present on `sourceRow` → emit it under the semantic
 * id key.
 *
 * Used to populate Pod / Node / Container etc. chips when the backend's
 * correlate response omits them (because they aren't service-identifying).
 *
 * @param matchedSetId   IdentitySet slug ("kubernetes", "aws", "gcp", "azure")
 * @param semanticGroups Org's semantic groups (provides `fields[]` aliases)
 * @param sourceRow      The source log row / span as a flat key→value record
 */
export function buildWorkloadChipEntries(
  matchedSetId: string | undefined | null,
  semanticGroups: FieldAlias[],
  sourceRow: Record<string, any> | undefined | null,
): Record<string, WorkloadChipEntry> {
  if (!matchedSetId || !sourceRow) return {};
  const canonical = resolveSetId(matchedSetId);
  const specs = canonical ? SUBJECT_BUTTONS_BY_SET[canonical] : undefined;
  if (!specs?.length) return {};
  const out: Record<string, WorkloadChipEntry> = {};
  for (const spec of specs) {
    for (const semanticId of spec.semanticIds) {
      const group = semanticGroups.find((g) => g.id === semanticId);
      if (!group) continue;
      const hit = group.fields.find(
        (f) =>
          sourceRow[f] !== undefined &&
          sourceRow[f] !== null &&
          String(sourceRow[f]) !== "",
      );
      if (hit) {
        out[semanticId] = {
          value: String(sourceRow[hit]),
          fieldName: hit,
        };
        break; // first semantic group with a value wins for this button
      }
    }
  }
  return out;
}

/**
 * Legacy thin wrapper returning just the value map (semanticId → value),
 * for callers that don't yet need the field names. Prefer
 * `buildWorkloadChipEntries` for new code.
 */
export function buildWorkloadChipDimensions(
  matchedSetId: string | undefined | null,
  semanticGroups: FieldAlias[],
  sourceRow: Record<string, any> | undefined | null,
): Record<string, string> {
  const entries = buildWorkloadChipEntries(matchedSetId, semanticGroups, sourceRow);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) out[k] = v.value;
  return out;
}

/**
 * Test whether a stream name matches any of the patterns.
 */
export function streamMatchesPatterns(
  streamName: string,
  patterns: RegExp[],
): boolean {
  return patterns.some((p) => p.test(streamName));
}

export type SubjectSelectionState = "all" | "partial" | "none";

/**
 * Compute the selection state of a subject button within a given pool of
 * streams (typically the streams in one Network/Infra/Others group). The
 * relevant pool is the subset of `groupStreams` whose names match the
 * button's patterns; the state then reflects how many of those relevant
 * streams are currently selected.
 *
 * Returns:
 *  - "all"     — every relevant stream is selected
 *  - "partial" — some relevant streams are selected
 *  - "none"    — no relevant stream is selected, OR no relevant stream exists
 *
 * A "none" state with no relevant streams should be rendered as disabled by
 * the caller (use `relevantCount === 0` to disambiguate).
 */
export function getSubjectSelectionState(
  button: SubjectButton,
  groupStreams: StreamInfo[],
  selectedStreams: StreamInfo[],
): { state: SubjectSelectionState; relevantCount: number } {
  const selectedNames = new Set(selectedStreams.map((s) => s.stream_name));
  const relevant = groupStreams.filter((s) =>
    streamMatchesPatterns(s.stream_name, button.patterns),
  );
  if (relevant.length === 0) return { state: "none", relevantCount: 0 };
  const selectedCount = relevant.reduce(
    (acc, s) => acc + (selectedNames.has(s.stream_name) ? 1 : 0),
    0,
  );
  if (selectedCount === 0)
    return { state: "none", relevantCount: relevant.length };
  if (selectedCount === relevant.length)
    return { state: "all", relevantCount: relevant.length };
  return { state: "partial", relevantCount: relevant.length };
}
