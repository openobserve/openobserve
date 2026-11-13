import type { Scope, ServicesResponse, Tracking, Verdict } from "@/services/service_versions";
import type { I18nKey, TranslateFn } from "@/types/i18n";
import type { LocationQuery } from "vue-router";
import { inEnv, NO_ENV } from "@/services/service_versions.envs";
import { verdictCode } from "@/enterprise/components/ServiceVersions/verdictText";
import { serviceHealthFromErrorRate, type ServiceHealthStatus } from "@/utils/traces/serviceHealth";
import {
  isOutsideK8s,
  sameBuild,
  trackingNotStarted,
  versionImageLabel,
  whereSentence,
} from "@/utils/serviceVersionsCopy";

export const catalogVerdictOptions = [
  "ok",
  "watch",
  "regressed",
  "insufficient",
  "not_serving",
  "no_version",
] as const;
export const catalogExtraVerdictOptions = [
  "first_version",
  "pre_existing",
  "capped",
  "restricted",
] as const;
export type CatalogVerdictFilter = Verdict | "no_version";

// Labels in catalogVerdictRank order, highest first, from the same keys the verdict chips use.
const SORTED_VERDICT_LABELS: I18nKey[] = [
  "serviceVersions.verdict.regressed",
  "serviceVersions.verdict.rollbackStillWorse",
  "serviceVersions.verdict.notServing",
  "serviceVersions.verdict.watch",
  "serviceVersions.verdict.insufficient",
  "serviceVersions.verdict.rollbackRecovered",
  "serviceVersions.verdict.ok",
  "serviceVersions.verdict.firstVersion",
  "serviceVersions.verdict.preExisting",
  "serviceVersions.catalog.noVersion",
];

export const CATALOG_COLUMN_SIZES = {
  service_name: 132,
  version_env: 130,
  version_where: 134,
  version_verdict: 169,
  service_versions: 179,
  status: 98,
  version_deployed: 80,
  total_requests: 90,
  error_count: 72,
  error_rate: 92,
  p95_latency_ns: 72,
  p99_latency_ns: 72,
} as const;
const CATALOG_ENV_PICKED_SIZE = 157;
export const CATALOG_SERVICE_MIN_SIZE = 112;
export const CATALOG_ROW_HEIGHT = 54;
const CATALOG_DEFAULT_HIDDEN = [
  "p50_latency_ns",
  "p99_latency_ns",
  "avg_duration_ns",
  "max_duration_ns",
  "version_deployed",
];

/** The Env column header names the dimension under All envs, so its chips drop their env word. */
export function catalogEnvColumn(env: string) {
  return env
    ? { size: CATALOG_ENV_PICKED_SIZE, hideKey: false }
    : { size: CATALOG_COLUMN_SIZES.version_env, hideKey: true };
}

/** Default column visibility; a choice saved from the column picker wins. */
export function catalogColumnVisibility(versionsEnabled: boolean, saved: Record<string, boolean>) {
  if (!versionsEnabled) return saved;
  return { ...Object.fromEntries(CATALOG_DEFAULT_HIDDEN.map((id) => [id, false])), ...saved };
}

export interface CatalogPlace {
  cluster: string;
  namespace: string;
  flat?: boolean;
  // A default where has no place to print; its cell shows a reasoned dash instead.
  none?: boolean;
}

const severity: Partial<Record<Verdict, number>> = {
  regressed: 7,
  rollback_still_worse: 6.5,
  not_serving: 6,
  watch: 5,
  insufficient: 4,
  rollback_recovered: 3.5,
  ok: 3,
};

/** Requests and errors of one version of one catalog row, from the serving-health read. */
export interface VersionTraffic {
  requests: number;
  errors: number;
}

export function mergeCatalogVersions<
  T extends { service_name: string; where_key?: string; infer_service_name?: string },
>(rows: T[], scopes: Scope[]) {
  const byIdentity = new Map(
    scopes.map((scope) => [JSON.stringify([scope.service, scope.where_key]), scope]),
  );
  return rows.map((row) => {
    const versionScope = row.infer_service_name
      ? undefined
      : byIdentity.get(JSON.stringify([row.service_name, row.where_key || ""]));
    return {
      ...row,
      versionScope,
      place: row.where_key ? catalogPlace(row.where_key, versionScope) : undefined,
    };
  });
}
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
export function environmentPredicate(response: ServicesResponse, env: string) {
  if (!env) return { sql: "", postfilter: false };
  const keys =
    response.envs.find((item) => (env === NO_ENV ? item.no_env : item.env === env && !item.no_env))
      ?.where_keys || [];
  // No env has no label to match in SQL, so a long key list leaves the narrowing to the registry rows.
  if (env === NO_ENV && keys.length > 200) return { sql: "", postfilter: true };
  return keys.length <= 200
    ? {
        sql: keys.length ? `o2_service_where IN (${keys.map(literal).join(",")})` : "1=0",
        postfilter: false,
      }
    : { sql: `o2_service_env = ${literal(env)}`, postfilter: true };
}

export function hasVersion(scope?: Scope) {
  return Boolean(scope?.newest_version);
}

/** The version a catalog row names: the one serving now, else the newest seen. */
export function shownVersion(scope?: Scope) {
  return scope?.current_version || scope?.newest_version || "";
}

/** The image, source and compare gate of the version a catalog row names, from the same arm as shownVersion. */
export function shownVersionDetail(scope?: Scope) {
  const current = Boolean(scope?.current_version);
  return {
    image: (current ? scope?.current_image : scope?.newest_image) ?? null,
    imageRef: (current ? scope?.current_image_ref : scope?.newest_image_ref) ?? null,
    versionImages: (current ? scope?.current_version_images : scope?.newest_version_images) ?? 0,
    source: (current ? scope?.current_version_source : scope?.newest_version_source) ?? null,
    compare_disabled: Boolean(
      current ? scope?.current_compare_disabled : scope?.newest_compare_disabled,
    ),
    compare_disabled_reason:
      (current ? scope?.current_compare_disabled_reason : scope?.newest_compare_disabled_reason) ??
      null,
  };
}

/** A scope the processor has not reached yet: no verdict of any kind can be shown for it. */
export function preTracking(scope?: Scope) {
  return Boolean(scope) && trackingNotStarted(undefined, scope?.tracking_started);
}

/** A version with no earlier one in its scope and no verdict row; the drawer calls it First version. */
export function isFirstVersion(scope?: Scope) {
  return (
    hasVersion(scope) && !scope?.newest_verdict && !scope?.previous_version && !preTracking(scope)
  );
}

/** A deploy recorded after tracking started that the processor has not judged yet: Not enough data. */
export function deployUnjudged(scope?: Scope) {
  return (
    hasVersion(scope) &&
    !scope?.newest_verdict &&
    Boolean(scope?.previous_version) &&
    scope?.tracking_started === true
  );
}

export function catalogVerdictRank(scope?: Scope) {
  if (!hasVersion(scope)) return 0;
  const verdict = scope?.newest_verdict;
  if (!verdict) {
    if (deployUnjudged(scope)) return severity.insufficient || 1;
    return isFirstVersion(scope) ? 2 : 1;
  }
  if (verdict.restricted || verdict.state === "pre_existing") return 2;
  return severity[verdictCode(verdict)] || 2;
}

export function catalogVerdictValue(scope?: Scope): CatalogVerdictFilter | undefined {
  if (!scope) return undefined;
  if (!hasVersion(scope)) return "no_version";
  const summary = scope.newest_verdict;
  if (!summary) {
    if (deployUnjudged(scope)) return "insufficient";
    return isFirstVersion(scope) ? "first_version" : undefined;
  }
  if (summary.restricted) return "restricted";
  if (summary.state === "pre_existing") return "pre_existing";
  // The filter files a verdict under the state its chip reads, so a pick never lists a row named otherwise.
  if (verdictCode(summary) === "first_version") return "first_version";
  return summary.verdict || undefined;
}

export function catalogMatches(
  row: { versionScope?: Scope; infer_service_name?: string },
  env: string,
  verdict: string,
  state: string,
  unavailable: boolean,
) {
  if (state !== "ready") return true;
  const scope = row.versionScope;
  if (env && (!scope || !inEnv(scope, env))) return false;
  if (!verdict || unavailable) return true;
  if (row.infer_service_name || !scope) return false;
  return catalogVerdictValue(scope) === verdict;
}

/** True when a row has no Health to show: no requests, or a shown version that is not serving. */
export function healthWithheld(row: {
  total_requests?: number;
  versionScope?: Scope;
  servingIdle?: boolean;
}) {
  const scope = row.versionScope;
  // A Not serving verdict of another build says nothing about the build the row shows.
  const verdict = scope?.newest_verdict;
  const shownNotServing =
    catalogVerdictValue(scope) === "not_serving" &&
    Boolean(
      verdict &&
      sameBuild(verdict, { version: shownVersion(scope), image: shownVersionDetail(scope).image }),
    );
  return row.total_requests === 0 || Boolean(row.servingIdle) || shownNotServing;
}

/** The shown version sent no requests in the window, read from a complete serving-health search. */
export function servingIdle(
  row: { service_name: string; where_key?: string; versionScope?: Scope },
  traffic: Map<string, VersionTraffic>,
  complete: boolean,
) {
  const scope = row.versionScope;
  const version = scope?.current_version;
  if (!complete || !version || !scope?.signals?.includes("traces")) return false;
  return !traffic.get(
    versionTrafficKey(row.service_name, row.where_key || "", version, scope.current_image),
  )?.requests;
}

/** The read behind Health: request and error counts per (where, service, version, image) of instrumented spans. */
export function servingHealthSql(
  stream: string,
  requestPredicate: string,
  hasInferColumns: boolean,
  hasImageColumn: boolean,
) {
  const own = hasInferColumns ? " AND (infer_service_name IS NULL OR infer_service_name = '')" : "";
  const image = hasImageColumn ? "NULLIF(o2_service_image, '')" : "";
  return `SELECT o2_service_where AS where_key, service_name, o2_service_version AS version,
  ${image || "CAST(NULL AS VARCHAR)"} AS image,
  COUNT(*) FILTER (WHERE ${requestPredicate}) AS total_requests,
  COUNT(*) FILTER (WHERE ${requestPredicate} AND span_status = 'ERROR') AS error_count
FROM "${stream}"
WHERE o2_service_version IS NOT NULL AND o2_service_version <> ''${own}
GROUP BY o2_service_where, service_name, o2_service_version${image ? `, ${image}` : ""}`;
}

/** One build's traffic key; an empty image is the imageless build, as the backend reads it. */
export function versionTrafficKey(
  service: string,
  whereKey: string,
  version: string,
  image?: string | null,
) {
  return JSON.stringify([service, whereKey, version, image || null]);
}

/** Health of the version serving now, so a recovered rollback reads Healthy; else the row's whole-range health. */
export function servingStatus(
  row: {
    service_name: string;
    where_key?: string;
    status: ServiceHealthStatus;
    versionScope?: Scope;
  },
  traffic: Map<string, VersionTraffic>,
): ServiceHealthStatus {
  const version = row.versionScope?.current_version;
  if (!version) return row.status;
  const bucket = traffic.get(
    versionTrafficKey(
      row.service_name,
      row.where_key || "",
      version,
      row.versionScope?.current_image,
    ),
  );
  if (!bucket?.requests) return row.status;
  return serviceHealthFromErrorRate((bucket.errors / bucket.requests) * 100);
}

/** Catalog rows inside the Env filter, joined to their version scopes; every page count reads these. */
export function envCatalogRows<
  T extends { service_name: string; where_key?: string; infer_service_name?: string },
>(rows: T[], scopes: Scope[], env: string, state: string, unavailable: boolean) {
  return mergeCatalogVersions(rows, scopes).filter((row) =>
    catalogMatches(row, env, "", state, unavailable),
  );
}

/** The env a row's chip shows: the one that matched the Env filter, else the scope's pinned env. */
export function chipEnv(scope: Scope, env: string) {
  return env && env !== NO_ENV && inEnv(scope, env) ? env : scope.env;
}

/** The Env column shows with no env picked, or when a scope matched the pick through an env it is not pinned to. */
export function showsEnvColumn(scopes: Scope[], env: string) {
  return !env || scopes.some((scope) => inEnv(scope, env) && scope.env !== env);
}

/** The distinct version scopes behind catalog rows, so counts describe what the table shows. */
export function rowScopes(rows: { versionScope?: Scope }[]): Scope[] {
  const seen = new Set<string>();
  const scopes: Scope[] = [];
  for (const { versionScope } of rows) {
    if (!versionScope || seen.has(versionScope.scope_key)) continue;
    seen.add(versionScope.scope_key);
    scopes.push(versionScope);
  }
  return scopes;
}

export function catalogSummary(data: ServicesResponse | undefined, env: string, shown?: Scope[]) {
  const scopes = shown ?? (data?.services || []).filter((scope) => !env || inEnv(scope, env));
  const counts: Partial<Record<CatalogVerdictFilter, number>> = {};
  for (const scope of scopes) {
    const value = catalogVerdictValue(scope);
    if (value) counts[value] = (counts[value] || 0) + 1;
  }
  // Launch day is the org's tracking state, so the notice never comes and goes with the Env filter.
  const versioned = (data?.services || []).filter(hasVersion);
  const untracked = versioned.filter((scope) => preTracking(scope));
  // Response-level counts cover every scope, not just the returned page, so they win when no env narrows them.
  if (!env && !shown) Object.assign(counts, data?.verdict_counts);
  return {
    counts,
    total: scopes.length,
    noVersion: counts.no_version || 0,
    launchDay:
      versioned.length > 0 &&
      versioned.every(
        (scope) => preTracking(scope) || scope.newest_verdict?.state === "pre_existing",
      ),
    preTracking: versioned.length > 0 && untracked.length === versioned.length,
  };
}

/** The verdict count chips, worst first; a zero count keeps its chip while `reserve` still holds it. */
export function catalogCountChips(
  summary: ReturnType<typeof catalogSummary>,
  reserve: Partial<Record<string, number>> | undefined,
  available: boolean,
) {
  if (!available) return [];
  return (["regressed", "not_serving", "watch"] as const)
    .filter((value) => summary.counts[value] || reserve?.[value])
    .map((value) => ({ value, count: summary.counts[value] || 0 }));
}

/** A count chip's text, "2 Regressed" or "3 Critical", for the chip and for the "+N more" list alike. */
export function countChipLabel(label: string, count: number, t: TranslateFn) {
  return t("serviceVersions.catalog.severityCount", { verdict: label, count });
}

export function verdictCountLabel(
  value: "regressed" | "not_serving" | "watch",
  count: number,
  t: TranslateFn,
) {
  const key = value === "not_serving" ? "notServing" : value;
  return countChipLabel(t(`serviceVersions.verdict.${key}`), count, t);
}

/** The catalog footer: the verdict sort order, or nothing while a notice above already explains the view. */
export function catalogFooterNote(
  summary: ReturnType<typeof catalogSummary>,
  view: { verdict?: string; env: string; byVerdict: boolean; locale: string },
  t: TranslateFn,
): string {
  // The No version notice and the launch-day or warm-up banner already say it; the view says it once.
  if (view.verdict === "no_version" || summary.launchDay) return "";
  if (!view.byVerdict) return "";
  const verdicts = new Intl.ListFormat(view.locale || "en", {
    type: "unit",
    style: "short",
  }).format(SORTED_VERDICT_LABELS.map((key) => t(key)));
  return t("serviceVersions.catalog.sortedByVerdict", { verdicts });
}

/** The warm-up end while deploy tracking still warms up, else null. */
export function warmingUntil(tracking: Tracking | undefined, now = Date.now() * 1000) {
  const end = tracking?.warmup_ends_at;
  return end && now < end ? end : null;
}

export function catalogPlace(whereKey: string, scope?: Scope): CatalogPlace {
  const where = scope?.where;
  if (isOutsideK8s(whereKey, where)) return { cluster: "", namespace: "", flat: true, none: true };
  if (where?.kind === "k8s")
    return { cluster: where.k8s_cluster || "", namespace: where.k8s_namespace || "" };
  const k8s = /^k8s:([^/]*)\/(.*)$/.exec(whereKey);
  if (k8s) return { cluster: k8s[1], namespace: k8s[2] };
  return { cluster: "", namespace: whereKey.replace(/^[a-z_]+:/, ""), flat: true };
}

export function placeLabel(whereKey: string) {
  const place = catalogPlace(whereKey);
  return place.cluster ? `${place.cluster} · ${place.namespace}` : place.namespace;
}

export function verdictSubline(scope: Scope, t: TranslateFn) {
  const summary = scope.newest_verdict;
  const base = summary?.baseline;
  if (!summary || !base?.version || summary.restricted || summary.state === "pre_existing")
    return "";
  const baseline = versionImageLabel(base.version, base.image, base.version_images, t);
  const code = verdictCode(summary);
  if (code === "rollback_recovered" || code === "rollback_still_worse")
    return t("serviceVersions.catalog.vsServingBefore", { version: baseline });
  const where = summary.baseline?.where_key;
  if (where && where !== scope.where_key)
    return whereSentence(
      {
        in: "serviceVersions.catalog.vsBaselineIn",
        outside: "serviceVersions.catalog.vsBaselineOutside",
      },
      where,
      null,
      { version: baseline },
      t,
    );
  return t("serviceVersions.catalog.vsBaseline", { version: baseline });
}

export function rolledBackFrom(scope: Scope) {
  const current = scope.current_version;
  return current &&
    scope.newest_version &&
    current !== scope.newest_version &&
    scope.previous_version === scope.newest_version
    ? scope.newest_version
    : "";
}

export function formatAgoUs(us: number, t: TranslateFn, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - us / 1000) / 1000));
  if (seconds < 60) return t("serviceVersions.catalog.secondsAgo", { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("serviceVersions.catalog.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("serviceVersions.catalog.hoursAgo", { count: hours });
  return t("serviceVersions.catalog.daysAgo", { count: Math.floor(hours / 24) });
}

/** The route query with the catalog's time range in it, so a reload or a copied link opens the same range. */
export function catalogRangeQuery(
  query: LocationQuery,
  datetime: {
    type?: string;
    relativeTimePeriod?: string | null;
    startTime?: number | string;
    endTime?: number | string;
  },
) {
  const next: LocationQuery = { ...query };
  delete next.period;
  delete next.from;
  delete next.to;
  if (datetime.type === "relative" && datetime.relativeTimePeriod)
    next.period = String(datetime.relativeTimePeriod);
  else if (datetime.startTime && datetime.endTime) {
    next.from = String(datetime.startTime);
    next.to = String(datetime.endTime);
  }
  return next;
}
