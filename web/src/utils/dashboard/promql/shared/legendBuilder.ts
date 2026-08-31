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

import { buildFieldToGroupIdMap } from "@/utils/telemetryCorrelation";
import type { FieldAlias } from "@/services/service_streams";

/**
 * Semantic groups that identify WHAT a series is about, best-first. A legend
 * has room for an identity, not a label dump: namespace and service say which
 * workload, pod and node say which instance of it. Ids are the org's semantic
 * group ids — the same ones the metrics subject buttons select on.
 */
const PREFERRED_GROUP_IDS = [
  "k8s-namespace",
  "service-name",
  "k8s-pod-name",
  "k8s-node-name",
  "host",
];

/**
 * The label keys whose value actually differs across a result set.
 *
 * A PromQL response repeats the labels the query selected on in every series
 * (`__name__`, `container`, `aggregation_temporality`…), so a name built from
 * the whole label set is near-identical for every series and discriminates
 * nothing. Only the keys that vary carry information.
 *
 * A key missing from some series counts as varying — its absence is itself the
 * difference. Fewer than two series have nothing to compare, so nothing varies.
 */
export const getDiscriminatingLabels = (metrics: any[]): string[] => {
  const list = (metrics ?? []).filter((m: any) => m && typeof m === "object");
  if (list.length < 2) return [];

  const keys = new Set<string>();
  for (const metric of list) for (const key of Object.keys(metric)) keys.add(key);

  return [...keys].filter((key) => list.some((m: any) => m[key] !== list[0][key]));
};

/**
 * Identity labels by their own names, best-first. PromQL label sets are not
 * governed by any org config, and the semantic-group API is enterprise-only, so
 * the names themselves have to be recognised — separators differ (`k8s.pod.name`
 * / `k8s_pod_name` / `pod`) but the vocabulary does not.
 *
 * Matching is on the WHOLE normalised name, never a substring: `k8s_pod_uid`
 * contains "pod" but identifies nothing a reader can use, and must not be
 * mistaken for one.
 */
const IDENTITY_LABELS: string[][] = [
  ["namespace", "namespacename", "k8snamespace", "k8snamespacename", "kubernetesnamespacename"],
  ["service", "servicename", "k8sservice", "k8sservicename", "kubernetesservicename"],
  ["pod", "podname", "k8spod", "k8spodname", "kubernetespod", "kubernetespodname"],
  [
    "host",
    "hostname",
    "instance",
    "node",
    "nodename",
    "k8snode",
    "k8snodename",
    "kubernetesnode",
    "kubernetesnodename",
  ],
];

/**
 * Labels that change without the thing they describe changing — a restart mints
 * a new uid, a new start time, a new hash. They tell two series apart while
 * naming neither, so they are the last resort for disambiguation, never a name.
 */
const CHURN_LABEL = /(uid|id|starttime|timestamp|createdat|hash|revision)$/;

const normaliseLabel = (key: string) => key.toLowerCase().replace(/[._-]/g, "");

/**
 * Of the labels that vary, the ones worth naming a series by: identities,
 * best-first (namespace → service → pod → host).
 *
 * `semanticGroups` REFINES this when the org's rules happen to be loaded — it
 * can veto a label whose group is marked `is_stable: false` (correlation's own
 * marker for pod uid / start time) and can promote a label the static
 * vocabulary does not know. Nothing here fetches them: with none loaded the
 * static vocabulary stands on its own.
 */
export const getPreferredLabels = (
  varyingKeys: string[],
  semanticGroups: FieldAlias[] = [],
): string[] => {
  if (!varyingKeys?.length) return [];

  const groupById = new Map(semanticGroups.map((group) => [group.id, group]));
  const fieldToGroupId = semanticGroups.length ? buildFieldToGroupIdMap(semanticGroups) : null;

  const ranked: { key: string; rank: number }[] = [];
  for (const key of varyingKeys) {
    const groupId = fieldToGroupId?.get(key.toLowerCase());
    if (groupId && groupById.get(groupId)?.is_stable === false) continue;

    let rank = IDENTITY_LABELS.findIndex((names) => names.includes(normaliseLabel(key)));
    if (rank === -1 && groupId) rank = PREFERRED_GROUP_IDS.indexOf(groupId);
    if (rank !== -1) ranked.push({ key, rank });
  }

  return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.key);
};

/**
 * Generates a legend name for a PromQL metric using a template.
 *
 * @param metric - The metric object containing label key-value pairs
 * @param label - The legend template (e.g., "{job} - {instance}"). If null/empty, returns JSON stringified metric.
 * @returns The legend name with placeholders replaced by actual values
 *
 * @example
 * getPromqlLegendName({ job: "api", instance: "server1" }, "{job} on {instance}")
 * // Returns: "api on server1"
 *
 * getPromqlLegendName({ job: "api" }, "")
 * // Returns: '{"job":"api"}'
 *
 * getPromqlLegendName({}, "", "Value")
 * // Returns: "Value" — a query that aggregates every label away has nothing
 * // to stringify, and "{}" in a legend tells the reader nothing at all.
 *
 * getPromqlLegendName({ __name__: "up", pod: "api-1" }, "", undefined, ["pod"])
 * // Returns: "api-1" — see `discriminating`.
 */
export const getPromqlLegendName = (
  metric: any,
  label: string,
  fallback?: string,
  discriminating?: string[],
  preferred?: string[],
): string => {
  if (label) {
    let template = label || "";
    const placeholders = template.match(/\{([^}]+)\}/g);

    // Iterate through each placeholder
    placeholders?.forEach(function (placeholder: any) {
      // Extract the key from the placeholder
      const key = placeholder.replace("{", "").replace("}", "");

      // Retrieve the corresponding value from the metric object
      const value = metric[key];

      // Replace the placeholder with the value in the template
      if (value) {
        template = template.replace(placeholder, value);
      }
    });
    return template;
  } else {
    // An aggregating query (`count(...)`, `sum(...)`) strips every label, so
    // `metric` is `{}` and stringifying it produces a legend entry that names
    // nothing. Callers that know what the series represents pass a fallback;
    // without one the previous output is preserved.
    if (fallback && metric && typeof metric === "object" && Object.keys(metric).length === 0) {
      return fallback;
    }

    // Prefer the labels that say WHICH workload this is (see getPreferredLabels)
    // over whatever merely happens to differ. Joined namespace-first, so a name
    // reads like a path: "prod/api-1".
    //
    // Two identity labels often carry the SAME value — a DaemonSet names its pod
    // after itself, so service and pod both read "node-exporter-drhf7". Repeating
    // it says nothing twice, so the value is what gets deduplicated, not the key.
    if (preferred?.length && metric && typeof metric === "object") {
      const seen = new Set<string>();
      for (const key of preferred) {
        const value = metric[key];
        // A label present but empty names nothing; keeping it yields "prod/" or "".
        if (value === undefined || value === null || value === "") continue;
        seen.add(String(value));
      }
      if (seen.size) return [...seen].join("/");
    }

    // With no template, name the series by what tells it apart from its siblings
    // (see getDiscriminatingLabels) instead of dumping the whole label set. One
    // varying label reads best bare; several keep Prometheus' `{k="v"}` form.
    // A lone series has no siblings, so it keeps the full label set — there is
    // no noise to strip and the labels are all the reader has.
    //
    // Churny labels are excluded here even when they are all that differs: a uid
    // tells two series apart while naming neither. Where one is genuinely the
    // only difference, the collision pass appends it to a real name instead.
    if (discriminating?.length && metric && typeof metric === "object") {
      const present = discriminating.filter(
        (key) => metric[key] !== undefined && !CHURN_LABEL.test(normaliseLabel(key)),
      );
      if (present.length === 1) return String(metric[present[0]]);
      if (present.length > 1) {
        return `{${present.map((key) => `${key}="${metric[key]}"`).join(", ")}}`;
      }

      // Its siblings ARE told apart by something, and this series carries none of
      // it — the pod-level series beside per-container ones. It still has a name;
      // the whole label set dumped into the legend is not it. Its own identity
      // labels first (an aggregated query has no `__name__` and dashboards set no
      // fallback, so those two alone left it dumping JSON). Scoped to this branch:
      // a lone series has no siblings and keeps its labels.
      if (fallback) return fallback;
      if (metric.__name__) return String(metric.__name__);
      // Last resort before the label dump: an aggregated query has no `__name__`
      // and dashboards set no fallback, so those two alone still left this case
      // rendering raw JSON. Its own identity labels at least say what it is.
      const own = getPreferredLabels(Object.keys(metric), []);
      const identity = [...new Set(own.map((key) => String(metric[key])).filter(Boolean))];
      if (identity.length) return identity.join("/");
    }

    return JSON.stringify(metric);
  }
};

/**
 * Names every series in a panel at once, so series that would otherwise share a
 * name can be told apart.
 *
 * Not a guarantee of uniqueness: two auto queries returning the same label sets
 * have nothing left to disambiguate on (the query index would, and is not used).
 *
 * Naming per-series cannot see collisions, and a collision is not cosmetic:
 * ECharts keys the legend, the colour and the tooltip row by series name, so
 * two series called "api-1" render as one legend entry that toggles both.
 *
 * A name is its identity labels; when that is not unique — two queries over the
 * same pods, or two containers in one pod — the labels that still differ are
 * appended, churny ones (see CHURN_LABEL) only if nothing else separates them.
 *
 * Returns a Map keyed by the metric object each series was built from.
 */
export const buildPromqlSeriesNames = (
  queries: { metrics: any[]; template?: string; fallback?: string }[],
  semanticGroups: FieldAlias[] = [],
): Map<any, string> => {
  const names = new Map<any, string>();

  // A templated query names itself and takes no part in the shared vocabulary.
  const templated = queries.filter((q) => q.template);
  for (const query of templated) {
    for (const metric of query.metrics) {
      names.set(metric, getPromqlLegendName(metric, query.template!, query.fallback));
    }
  }

  const auto = queries.filter((q) => !q.template);
  const allMetrics = auto.flatMap((q) => q.metrics);
  if (!allMetrics.length) return names;

  // Across every auto-named query, so a metric name constant WITHIN a query but
  // differing BETWEEN two still counts as telling their series apart.
  const varying = getDiscriminatingLabels(allMetrics);

  // A lone series has nothing to differ FROM, but it still has an identity to be
  // named BY: `sum by (node) (...)` returning one node should read as that node,
  // not as the label set wrapped in braces. Its own labels stand in for the
  // varying ones — identity naming below filters them the same way.
  const identityKeys = varying.length
    ? varying
    : [...new Set(allMetrics.flatMap((metric) => Object.keys(metric ?? {})))];
  const preferred = getPreferredLabels(identityKeys, semanticGroups);

  const fallbackFor = new Map<any, string | undefined>();
  for (const query of auto)
    for (const metric of query.metrics) fallbackFor.set(metric, query.fallback);

  for (const metric of allMetrics) {
    names.set(metric, getPromqlLegendName(metric, "", fallbackFor.get(metric), varying, preferred));
  }

  // Disambiguate only what actually collides, and only as far as it takes.
  const byName = new Map<string, any[]>();
  for (const metric of allMetrics) {
    const name = names.get(metric)!;
    (byName.get(name) ?? byName.set(name, []).get(name)!).push(metric);
  }

  const used = new Set(preferred);
  const extras = varying.filter((key) => !used.has(key));
  const valueOf = (metric: any, key: string) =>
    metric?.[key] === undefined || metric[key] === "" ? null : String(metric[key]);
  const suffixOf = (metric: any, keys: string[]) =>
    keys
      .filter((key) => valueOf(metric, key) !== null)
      .map((key) => `${key}="${metric[key]}"`)
      .join(", ");

  for (const [name, clashing] of byName) {
    if (clashing.length < 2) continue;

    // Only labels that differ WITHIN this group can separate it — a node's
    // address repeated on each of its disks separates nothing. Churny ones are
    // the last resort, so a uid is reached for only when nothing else is left.
    const candidates = extras
      .filter((key) => new Set(clashing.map((m) => valueOf(m, key))).size > 1)
      .sort(
        (a, b) =>
          Number(CHURN_LABEL.test(normaliseLabel(a))) - Number(CHURN_LABEL.test(normaliseLabel(b))),
      );

    // Add one at a time and stop the moment the group is unique: every label
    // past that point is noise the reader has to scan through.
    const chosen: string[] = [];
    for (const key of candidates) {
      chosen.push(key);
      if (new Set(clashing.map((m) => suffixOf(m, chosen))).size === clashing.length) break;
    }

    for (const metric of clashing) {
      const suffix = suffixOf(metric, chosen);
      if (suffix) names.set(metric, `${name} {${suffix}}`);
    }
  }

  return names;
};

/**
 * Determines the orientation of the legend based on the legend position.
 *
 * @param legendPosition - The desired position of the legend ("bottom" or "right")
 * @returns "horizontal" for bottom position, "vertical" for right position
 */
export const getLegendPosition = (legendPosition: string): string => {
  switch (legendPosition) {
    case "bottom":
      return "horizontal";
    case "right":
      return "vertical";
    default:
      return "horizontal";
  }
};
