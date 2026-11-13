import http from "./http";

export type Signal = "traces" | "rum";
export type Verdict =
  | "ok"
  | "watch"
  | "regressed"
  | "insufficient"
  | "first_version"
  | "pre_existing"
  | "not_serving"
  | "capped"
  | "restricted"
  | "rollback_recovered"
  | "rollback_still_worse";
export interface Bounds {
  start_time: number;
  end_time: number;
}
export interface Place {
  kind: string;
  k8s_cluster: string;
  k8s_namespace: string;
}
export interface Environment {
  where_key: string;
  where?: Place;
  env: string;
  envs?: string[];
  env_source: string;
  env_source_value?: string;
  env_inferred?: string;
  env_inferred_source?: string;
  override_key?: string | null;
  // True when no env was reported; `env` then keeps its stored text and the UI shows "No env".
  no_env?: boolean;
  env_is_inferred?: boolean;
}
/** The image fields every version-shaped row carries. */
export interface ImageFields {
  image?: string | null;
  image_ref?: string | null;
  version_images?: number;
}
/** Compare is disabled for a version known only from K8s container data. */
export interface CompareGate {
  compare_disabled?: boolean;
  compare_disabled_reason?: string | null;
}
export interface ActiveVersionRow extends ImageFields, CompareGate {
  version: string;
  version_key: string;
}
export interface MetricDelta {
  a: number | null;
  b: number | null;
  delta: number | null;
  lo: number | null;
  hi: number | null;
  ci_kind: string;
  insufficient: boolean;
  straddles_zero?: boolean;
}
export interface VerdictMetric {
  metric: string;
  new_value: number | null;
  base_value: number | null;
  delta: number | null;
  lo: number | null;
  hi: number | null;
  ci_kind: string;
  badge: string;
  n_new: number;
  n_base: number;
  band_new?: string | null;
  band_base?: string | null;
  updated_at?: number;
}
export type RollbackOutcome = "recovered" | "not_recovered" | "pending";
export interface NotServingPod {
  k8s_cluster: string;
  k8s_namespace: string;
  k8s_pod: string;
  k8s_workload?: string;
  k8s_container?: string;
  since: number;
  status?: string;
  ready?: boolean;
}
export interface VerdictSummary {
  verdict_key: string;
  version_key: string;
  service: string;
  where_key: string;
  version: string;
  verdict: Verdict;
  state?: string;
  reason?: string;
  reason_code?: string;
  restricted?: boolean;
  signal?: Signal;
  headline?: {
    metric: string | null;
    new: number | null;
    base: number | null;
    lo: number | null;
    hi: number | null;
    ci_kind: string | null;
    unit: string;
  };
  second?: { metric: string | null; new: number | null; base: number | null; unit: string };
  sample?: { n_new: number; n_base: number; since: number };
  image?: string | null;
  version_images?: number;
  baseline?: {
    version: string;
    image?: string | null;
    version_images?: number;
    rule: string;
    initial_rule?: string;
    switched_at?: number | null;
    initial_version?: string | null;
    initial_image?: string | null;
    where_key?: string;
    env?: string;
    traffic_share?: number | null;
  };
  checks_done?: number;
  frozen_at?: number | null;
  new_error_types?: number;
  needs?: { metric: string | null; have: number | null; need: number | null } | null;
  metrics?: VerdictMetric[];
  regions?: (string | { cluster: string; verdict: Verdict })[];
  deploy_key?: string;
  deploy?: { kind: string; at: number; from_version: string | null };
  rollback_outcome?: RollbackOutcome | null;
  pods?: NotServingPod[];
  pods_total?: number;
  env?: string;
  windows?: { a: VerdictWindow; b: VerdictWindow | null } | null;
}
export interface VerdictWindow {
  start_time: number;
  end_time: number;
}
export interface DeployMarker extends Environment {
  version: string;
  image?: string | null;
  image_ref?: string | null;
  at: number;
  deploy_key?: string;
  kind?: string;
  from_version?: string;
  from_image?: string | null;
  provisional: boolean;
  regions?: string[];
  verdict?: VerdictSummary | null;
  badge?: string;
  metrics?: Record<string, Pick<VerdictMetric, "delta" | "lo" | "hi" | "badge">>;
}
export interface Version extends Environment, ImageFields, CompareGate {
  version_key: string;
  scope_key: string;
  service_name: string;
  version: string;
  raw_version?: string;
  as_name?: string;
  version_source: string;
  first_seen: number;
  last_seen: number;
  active: boolean;
  status: string;
  restricted?: boolean;
  previous_version?: string | null;
  previous_image?: string | null;
  overlaps?: string[];
  signals: Partial<Record<Signal, { first_seen: number; last_seen: number } | null>>;
  deploys?: DeployMarker[];
  // False until the scope has a stored deploy transition, i.e. before deploy tracking covers it.
  tracking_started?: boolean;
}
export interface Scope extends Environment {
  service: string;
  scope_key: string;
  newest_version?: string | null;
  newest_version_key?: string | null;
  active_version_keys?: Record<string, string>;
  newest_first_seen?: number;
  signals: Signal[];
  active_versions: string[];
  current_version?: string | null;
  previous_version?: string | null;
  last_good_version?: string | null;
  last_good_image?: string | null;
  newest_verdict?: VerdictSummary | null;
  verdict_counts?: Partial<Record<Verdict, number>>;
  // False until the scope has a stored deploy transition, i.e. before deploy tracking covers it.
  tracking_started?: boolean;
  newest_image?: string | null;
  newest_image_ref?: string | null;
  newest_version_images?: number;
  newest_version_source?: string | null;
  newest_compare_disabled?: boolean;
  newest_compare_disabled_reason?: string | null;
  current_image?: string | null;
  current_image_ref?: string | null;
  current_version_images?: number;
  current_version_source?: string | null;
  current_compare_disabled?: boolean;
  current_compare_disabled_reason?: string | null;
  active_version_rows?: ActiveVersionRow[];
}
export interface Tracking {
  epoch: number | null;
  warmup_ends_at: number | null;
}
export interface VersionsResponse {
  service: string;
  aliases_applied: string[];
  versions: Version[];
  total: number;
  purged_versions?: number;
  tracking?: Tracking;
}
export interface ServicesResponse {
  services: Scope[];
  envs: { env: string; where_keys: string[]; no_env?: boolean }[];
  registry_status?: "ok" | "unavailable";
  verdict_status?: "ok" | "unavailable";
  verdict_counts?: Partial<Record<Verdict, number>>;
  tracking?: Tracking;
  stripped_versions?: number;
}
export interface CompareArm extends Bounds {
  version: string;
  image?: string | null;
  image_ref?: string | null;
  version_key?: string;
  deploy_key?: string | null;
  where_key?: string;
  first_seen?: number;
  last_seen?: number;
  coverage?: "ok" | "partial" | "aged_out" | "empty";
  traffic_share?: number;
  signals?: Signal[];
  // False when no rollup row covers the arm's window yet; null or absent when unknown.
  has_rollup?: boolean | null;
  // "hourly" once the arm starts over a day back: its series are read at whole-hour steps.
  basis?: "fine" | "hourly";
}
export interface CompareRequest {
  service: string;
  where: string;
  a: {
    version: string;
    image?: string;
    deploy_key?: string;
    start_time?: number;
    end_time?: number;
  };
  b?: { version: string; image?: string; start_time?: number; end_time?: number };
  baseline?: "auto" | "canary" | "previous";
  mode?: "sequential" | "concurrent";
  signals: Signal[];
  window?: Bounds;
  max_span_secs?: number;
  ci_level?: number;
  endpoints_limit?: number;
}
export interface Endpoint {
  operation: string;
  source_stream: string;
  status?: string;
  requests_a: number;
  requests_b: number;
  errors_a?: number;
  errors_b?: number;
  introduced?: boolean;
  early?: boolean;
  error_rate?: MetricDelta | null;
  p95?: MetricDelta | null;
  baseline_p95_us?: number;
}
export interface ErrorEvidence {
  error_type?: string;
  error_message?: string;
  sample_error_id?: string;
  sample_ts?: number;
  sample_stack_top?: string;
  page?: string;
}
export interface ErrorTypeCount extends ErrorEvidence {
  fingerprint: string;
  count: number;
}
export interface SharedErrorType extends ErrorEvidence {
  fingerprint: string;
  count_a: number;
  count_b: number;
  delta?: number;
}
export interface DetailCoverage {
  status: "ok" | "insufficient";
  reason?: string | null;
}
export interface Section {
  status: "ok" | "complete" | "insufficient" | "error" | "timeout";
  error?: string | null;
  reason?: string | null;
  insufficient?: boolean;
}
export interface TracesSection extends Section {
  requests?: { a: number; b: number; rate_a: number; rate_b: number };
  error_rate?: MetricDelta;
  p50?: MetricDelta;
  p95?: MetricDelta;
  p99?: MetricDelta;
  endpoints?: Endpoint[];
  endpoint_detail?: DetailCoverage;
}
// The producer flattens the vital delta beside its bands.
export type RumSampledMetric = "lcp_p75" | "inp_p75" | "cls_p75" | "loading_time_p75";
export type RumVital = MetricDelta & { band_a?: string; band_b?: string; band_crossed?: boolean };
export interface RumSection extends Section {
  views?: { a: number; b: number };
  session_windows?: { a: number; b: number };
  errors?: { a: number; b: number };
  samples?: Partial<Record<RumSampledMetric, { a: number; b: number }>>;
  error_view_rate?: MetricDelta;
  lcp_p75?: RumVital;
  inp_p75?: RumVital;
  cls_p75?: RumVital;
  loading_time_p75?: MetricDelta;
  error_types?: {
    introduced: ErrorTypeCount[];
    fixed: ErrorTypeCount[];
    shared: SharedErrorType[];
    insufficient?: boolean;
    early?: boolean;
  };
  error_detail?: DetailCoverage;
}
export type DrillStatus = "ok" | "insufficient" | "error" | "timeout";
export interface DrillSection {
  status: DrillStatus;
  reason: string | null;
  error: string | null;
}
export interface InpTargetRow {
  target: string;
  page: string;
  a: { p75_ms: number; n: number };
  b: { p75_ms: number; n: number } | null;
}
export interface InpTargetsSection extends DrillSection {
  truncated?: boolean;
  rows?: InpTargetRow[];
}
export interface BreakdownValue {
  value: string;
  a: { views: number; error_views: number };
  b: { views: number; error_views: number };
  lcp_p75: MetricDelta;
  inp_p75: MetricDelta;
  cls_p75: MetricDelta;
}
export type BreakdownDimName = "browser" | "device" | "country";
export interface BreakdownDim {
  status: DrillStatus;
  reason: string | null;
  values?: BreakdownValue[];
}
export interface RumBreakdownSection extends DrillSection {
  truncated?: boolean;
  dims?: Partial<Record<BreakdownDimName, BreakdownDim>>;
}
export interface PageRow {
  page: string;
  views: { a: number; b: number };
  new_error_types: number;
  lcp_p75: MetricDelta;
  inp_p75: MetricDelta;
  cls_p75: MetricDelta;
  worst: { metric: string; delta: number } | null;
}
export interface PagesSection extends DrillSection {
  rows?: PageRow[];
}
export type RumSeriesMetric = "lcp_p75" | "inp_p75" | "cls_p75";
export interface RumSeriesPoint {
  t: number;
  value: number | null;
  n: number;
}
export interface RumMetricSeries {
  status: "ok" | "insufficient";
  reason: "below_min_count" | "no_data" | null;
  n: number;
  floor: number;
  value: number | null;
  points: RumSeriesPoint[];
}
export interface RumArmSeries extends Bounds {
  version: string;
  where_key: string;
  lcp_p75: RumMetricSeries;
  inp_p75: RumMetricSeries;
  cls_p75: RumMetricSeries;
}
export interface RumSeriesSection extends DrillSection {
  interval_secs: number | null;
  units: Record<RumSeriesMetric, "s" | "ms" | "unitless">;
  a: RumArmSeries | null;
  b: RumArmSeries | null;
}
export interface CompareResponse {
  service: string;
  where_key: string;
  env: string;
  no_env?: boolean;
  mode: string;
  aliases_applied: string[];
  arms: { a: CompareArm; b: CompareArm };
  baseline_rule: string;
  baseline_reason?: Record<string, unknown>;
  deploy_key?: string | null;
  stored_verdict?: VerdictSummary | null;
  live_verdict?: VerdictSummary | null;
  traces?: TracesSection;
  rum?: RumSection;
  inp_targets?: InpTargetsSection;
  rum_breakdown?: RumBreakdownSection;
  pages?: PagesSection;
  rum_series?: RumSeriesSection;
  notes: string[];
}
export interface IncidentRequest {
  title: string;
  severity: string;
  service: string;
  where_key: string;
  env: string;
  version: string;
  baseline_version: string;
  verdict_key: string;
  summary: string;
  link: string;
}
export interface OverrideAffected {
  services: number;
  versions: number;
}
export interface IdentityOverride {
  rule_key: string;
  org_id: string;
  rule_type: string;
  scope: "service" | "where" | "cluster";
  k8s_cluster: string;
  where_key: string;
  service_name: string;
  value: string;
  inferred_value: string;
  inferred_source: string;
  created_by: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  writer_cluster: string;
  affected?: OverrideAffected;
}
export interface IdentityEnv {
  env: string;
  services: number;
  wheres: number;
  sources: string[];
  versions?: number;
  no_env?: boolean;
  inferred?: boolean;
}
export interface ScopeCounts {
  where: number;
  service?: number;
  cluster?: number;
}
export interface IdentityEnvsResponse {
  envs: IdentityEnv[];
  scope_counts?: ScopeCounts;
  scope_versions?: ScopeCounts;
  can_edit: boolean;
}
export interface OverrideWrite {
  scope: IdentityOverride["scope"];
  where_key: string;
  k8s_cluster: string;
  service_name: string;
  value: string;
}
export interface PutOverrideResponse {
  override: IdentityOverride | null;
  previous: IdentityOverride | null;
  removed: boolean;
  affected: OverrideAffected;
}
export interface UnresolvedResponse {
  no_version: { service: string; where_key: string; env: string; signals: Signal[] }[];
  placeholder_names: { service: string; last_seen: number }[];
}
export type ListParams = Record<string, string | number | boolean | undefined>;
export interface ServicesParams extends ListParams {
  signal?: Signal;
  service?: string;
}
export type AliasKind = "rename" | "k8s_workload" | "rum_service";
export type AliasStatus = "proposed" | "active" | "rejected";
export type AliasConfidence = "high" | "medium" | "low";
export interface Alias {
  alias_key: string;
  org_id: string;
  kind: AliasKind;
  scope: string;
  alias: string;
  canonical: string;
  status: AliasStatus;
  origin: "manual" | "learned";
  evidence: Record<string, unknown> | null;
  confidence: AliasConfidence;
  accepted_by?: string | null;
  accepted_at?: number | null;
  batch_id?: string | null;
  prev_status?: string | null;
  first_seen?: number | null;
  last_seen?: number | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  writer_cluster?: string;
}
export interface AliasListParams extends ListParams {
  kind?: AliasKind;
  status?: AliasStatus | "accepted";
  confidence?: AliasConfidence;
  q?: string;
  limit?: number;
  offset?: number;
}
export interface CollisionScope {
  service_key: string;
  env: string;
  scope: string;
}
export interface Collision {
  alias_key: string;
  display_name: string;
  existing: CollisionScope[];
  suggested_qualifier?: string | null;
}
export interface AliasCollisionError {
  error: "alias_collision";
  collisions: Collision[];
}
export interface AliasCreate {
  kind: AliasKind;
  scope: string;
  alias: string;
  canonical: string;
  allow_collisions?: boolean;
}
export interface AliasUpdate {
  status: "active" | "rejected";
  canonical?: string;
  allow_collisions?: boolean;
}
export interface BulkAliasRequest {
  action: "accept" | "reject";
  alias_keys: string[] | null;
  filter: { status: "proposed"; confidence?: AliasConfidence } | null;
  allow_collisions: boolean;
}
export interface BulkAliasResponse {
  changed: number;
  batch_id: string;
  skipped_collisions: number;
  collisions: Collision[];
  env_separation: boolean;
  truncated?: boolean;
}
const root = (org: string) => `/api/${encodeURIComponent(org)}/service_versions`;
const aliasRoot = (org: string) => `/api/${encodeURIComponent(org)}/service_identity/aliases`;
const config = (params?: ListParams, signal?: AbortSignal) => ({
  params,
  signal,
  skipAccessToast: true,
});
export default {
  identityOverrides: (org: string, params: ListParams = {}, signal?: AbortSignal) =>
    http().get<{ overrides: IdentityOverride[]; total: number }>(
      `/api/${encodeURIComponent(org)}/service_identity/overrides`,
      config(params, signal),
    ),
  identityEnvs: (org: string, params: ListParams = {}, signal?: AbortSignal) =>
    http().get<IdentityEnvsResponse>(
      `/api/${encodeURIComponent(org)}/service_identity/envs`,
      config(params, signal),
    ),
  identityUnresolved: (org: string, params: ListParams = {}, signal?: AbortSignal) =>
    http().get<UnresolvedResponse>(
      `/api/${encodeURIComponent(org)}/service_identity/unresolved`,
      config(params, signal),
    ),
  putIdentityOverride: (org: string, body: OverrideWrite) =>
    http().put<PutOverrideResponse>(
      `/api/${encodeURIComponent(org)}/service_identity/overrides`,
      body,
      config(),
    ),
  deleteIdentityOverride: (org: string, ruleKey: string) =>
    http().delete<{ removed: IdentityOverride }>(
      `/api/${encodeURIComponent(org)}/service_identity/overrides/${encodeURIComponent(ruleKey)}`,
      config(),
    ),
  aliases: (org: string, params: AliasListParams = {}, signal?: AbortSignal) =>
    http().get<{ aliases: Alias[]; total: number }>(aliasRoot(org), config(params, signal)),
  createAlias: (org: string, body: AliasCreate) =>
    http().post<Alias>(aliasRoot(org), body, config()),
  updateAlias: (org: string, aliasKey: string, body: AliasUpdate) =>
    http().put<Alias>(`${aliasRoot(org)}/${encodeURIComponent(aliasKey)}`, body, config()),
  deleteAlias: (org: string, aliasKey: string) =>
    http().delete(`${aliasRoot(org)}/${encodeURIComponent(aliasKey)}`, config()),
  bulkAliases: (org: string, body: BulkAliasRequest) =>
    http().post<BulkAliasResponse>(`${aliasRoot(org)}/_bulk`, body, config()),
  undoAliases: (org: string, batchId: string) =>
    http().post<{ restored: number }>(`${aliasRoot(org)}/_undo`, { batch_id: batchId }, config()),
  versions: (org: string, params: ListParams, signal?: AbortSignal) =>
    http().get<VersionsResponse>(root(org), config(params, signal)),
  services: (org: string, params: ServicesParams = {}, signal?: AbortSignal) =>
    http().get<ServicesResponse>(`${root(org)}/_services`, config(params, signal)),
  deploys: (org: string, params: ListParams, signal?: AbortSignal) =>
    http().get<{ deploys: DeployMarker[] }>(`${root(org)}/deploys`, config(params, signal)),
  verdicts: (org: string, params: ListParams, signal?: AbortSignal) =>
    http().get<{ verdicts: VerdictSummary[] }>(`${root(org)}/verdicts`, config(params, signal)),
  compare: (org: string, body: CompareRequest, signal?: AbortSignal) =>
    http().post<CompareResponse>(`${root(org)}/compare`, body, config(undefined, signal)),
  removeVersion: (org: string, key: string) =>
    http().delete<{ deleted: boolean }>(`${root(org)}/${encodeURIComponent(key)}`, config()),
  openIncident: (org: string, body: IncidentRequest) =>
    http().post<{ incident_id: string; created: boolean }>(
      `/api/v2/${encodeURIComponent(org)}/alerts/incidents`,
      body,
      config(),
    ),
};
