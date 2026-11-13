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

//! Request and response shapes of the service versions routes, for OpenAPI; times are Unix
//! microseconds.

use std::collections::BTreeMap;

use config::meta::service_identity::{EnvSource, NotServingPod};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

/// `GET /service_versions`.
#[derive(Serialize, ToSchema)]
pub struct ServiceVersionList {
    pub service: String,
    /// Other names of the service whose versions are merged in.
    pub aliases_applied: Vec<String>,
    pub versions: Vec<ServiceVersion>,
    /// Matching versions before `limit` and `offset`.
    pub total: usize,
    pub purged_versions: Option<i64>,
    pub tracking: Tracking,
}

/// One registry version with its environment label.
#[derive(Serialize, ToSchema)]
pub struct ServiceVersion {
    pub version_key: String,
    pub service_name: String,
    pub where_key: String,
    pub scope_key: String,
    pub version: String,
    pub image: Option<String>,
    pub image_ref: Option<String>,
    pub env: String,
    pub first_seen: i64,
    pub last_seen: i64,
    /// Seen in the last 15 minutes.
    pub active: bool,
    /// `active` or `inactive`.
    pub status: String,
    pub compare_disabled: bool,
    pub compare_disabled_reason: Option<String>,
    pub previous_version: Option<String>,
    pub previous_image: Option<String>,
    /// Other versions of the scope whose seen windows overlap this one.
    pub overlaps: Vec<String>,
    /// The name the version was seen under, when it is an alias of the requested service.
    pub as_name: Option<String>,
    /// Number of images seen for this version in the scope.
    pub version_images: usize,
    /// First and last seen per signal, `traces` and `rum`.
    #[schema(value_type = Object)]
    pub signals: Value,
    pub tracking_started: bool,
    /// The newest five deploys to this version.
    pub deploys: Vec<VersionDeploy>,
    /// Some deploy is in a stream the caller cannot read.
    pub restricted: bool,
}

#[derive(Serialize, ToSchema)]
pub struct VersionDeploy {
    pub at: i64,
    pub kind: String,
    pub from_version: Option<String>,
    pub from_image: Option<String>,
    pub cluster: String,
    pub deploy_key: String,
}

/// When version tracking started for the org, and when its warm-up ends.
#[derive(Serialize, ToSchema)]
pub struct Tracking {
    pub epoch: Option<i64>,
    pub warmup_ends_at: Option<i64>,
}

/// `GET /service_versions/_services`.
#[derive(Serialize, ToSchema)]
pub struct ServiceCatalog {
    /// Always `ok`.
    pub registry_status: String,
    /// `ok`, or `unavailable` when verdicts could not be read and scopes are listed without them.
    pub verdict_status: String,
    /// Listed scopes per newest verdict code, restricted verdicts left out.
    pub verdict_counts: BTreeMap<String, usize>,
    pub services: Vec<CatalogService>,
    /// Environment groups for the Env filter.
    pub envs: Vec<CatalogEnv>,
    /// Distinct version labels whose raw value lost a git hash when normalised.
    pub stripped_versions: usize,
    pub tracking: Tracking,
}

/// One service scope with its environment label, versions and newest verdict; the verdict
/// fields are absent when `verdict_status` is `unavailable`.
#[derive(Serialize, ToSchema)]
pub struct CatalogService {
    pub service: String,
    pub scope_key: String,
    pub where_key: String,
    #[serde(rename = "where")]
    pub where_identity: CatalogWhere,
    pub env: String,
    /// `override` when an env override applies, else the inference step of `env`.
    pub env_source: String,
    pub env_source_value: String,
    /// The env inference gave before any override.
    pub env_inferred: String,
    pub env_inferred_source: EnvSource,
    pub override_key: Option<String>,
    /// The scope reported no real environment.
    pub no_env: bool,
    pub env_is_inferred: bool,
    /// Every env the scope was seen in, its own first.
    pub envs: Option<Vec<String>>,
    pub newest_version: Option<String>,
    pub newest_image: Option<String>,
    pub newest_image_ref: Option<String>,
    pub newest_version_key: Option<String>,
    pub newest_first_seen: Option<i64>,
    pub newest_version_images: usize,
    pub newest_version_source: Option<String>,
    pub newest_compare_disabled: bool,
    pub newest_compare_disabled_reason: Option<String>,
    /// The version the newest deploy moved to, or the serving one.
    pub current_version: Option<String>,
    pub current_image: Option<String>,
    pub current_image_ref: Option<String>,
    pub current_version_images: usize,
    pub current_version_source: Option<String>,
    pub current_compare_disabled: bool,
    pub current_compare_disabled_reason: Option<String>,
    /// The version the newest deploy replaced.
    pub previous_version: Option<String>,
    pub previous_image: Option<String>,
    /// The newest version, other than `newest_version`, with a frozen `ok` verdict.
    pub last_good_version: Option<String>,
    pub last_good_image: Option<String>,
    pub tracking_started: Option<bool>,
    /// Version keys of the scope per verdict code.
    pub verdict_counts: Option<BTreeMap<String, usize>>,
    pub newest_verdict: Option<VersionVerdict>,
    /// `traces` and/or `rum`.
    pub signals: Vec<String>,
    pub active_versions: Vec<String>,
    /// Serving version to its version key.
    pub active_version_keys: std::collections::BTreeMap<String, String>,
    pub active_version_rows: Vec<ActiveVersion>,
}

#[derive(Serialize, ToSchema)]
pub struct ActiveVersion {
    pub version: String,
    pub version_key: String,
    pub image: Option<String>,
    pub image_ref: Option<String>,
    pub version_images: usize,
    pub compare_disabled: bool,
    pub compare_disabled_reason: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct CatalogWhere {
    /// `k8s`, `env` or `default`.
    pub kind: String,
    pub k8s_cluster: String,
    pub k8s_namespace: String,
}

/// One Env filter option; the no-env group has an empty `env`.
#[derive(Serialize, ToSchema)]
pub struct CatalogEnv {
    pub env: String,
    pub no_env: bool,
    pub where_keys: Vec<String>,
}

/// `GET /service_versions/deploys`.
#[derive(Serialize, ToSchema)]
pub struct DeployList {
    /// Deploy markers in time order, one per deploy merged across regions.
    pub deploys: Vec<DeployMarker>,
}

/// One deploy; a `provisional` marker is a registry version with no recorded deploy yet.
#[derive(Serialize, ToSchema)]
pub struct DeployMarker {
    pub version: String,
    pub image: Option<String>,
    pub image_ref: Option<String>,
    pub kind: String,
    pub from_version: Option<String>,
    pub from_image: Option<String>,
    pub previous_version: Option<String>,
    pub previous_image: Option<String>,
    pub previous_last_seen: Option<i64>,
    /// The replaced version was still seen at or after the deploy.
    pub overlaps_previous: bool,
    pub where_key: String,
    pub env: String,
    pub env_source: String,
    pub no_env: bool,
    pub at: i64,
    pub deploy_key: Option<String>,
    /// Regions whose deploys within ten minutes of each other are merged into this marker.
    pub regions: Vec<String>,
    pub provisional: bool,
    pub signal_first_seen: Option<SignalFirstSeen>,
    pub verdict: Option<VersionVerdict>,
    /// The verdict code, or `restricted`, `capped`, `evaluating`, `not_serving` or `none`.
    pub badge: String,
}

#[derive(Serialize, ToSchema)]
pub struct SignalFirstSeen {
    pub traces: Option<i64>,
    pub rum: Option<i64>,
}

/// `GET /service_versions/verdicts`.
#[derive(Serialize, ToSchema)]
pub struct VerdictList {
    /// One summary per version key, with its windows and checks.
    pub verdicts: Vec<VersionVerdict>,
}

/// A version's verdict summary. One the caller may not read holds only its identity and
/// `restricted`; a `pre_existing` one has no verdict, checks or windows.
#[derive(Serialize, ToSchema)]
pub struct VersionVerdict {
    pub verdict_key: Option<String>,
    pub version_key: Option<String>,
    pub service: Option<String>,
    pub where_key: Option<String>,
    pub version: Option<String>,
    pub image: Option<String>,
    /// `ok`, `watch`, `regressed`, `insufficient` or `not_serving`.
    pub verdict: Option<String>,
    pub state: Option<String>,
    pub reason: Option<String>,
    pub reason_code: Option<String>,
    /// `traces` or `rum`.
    pub signal: Option<String>,
    pub headline: Option<VerdictHeadline>,
    pub second: Option<VerdictSecond>,
    pub new_error_types: Option<i32>,
    pub new_error_sample: Option<String>,
    pub sample: Option<VerdictSample>,
    pub baseline: Option<VerdictBaseline>,
    pub checks_done: Option<i32>,
    pub frozen_at: Option<i64>,
    pub recheck: Option<VerdictRecheck>,
    pub regions: Option<Vec<VerdictRegion>>,
    pub deploy_key: Option<String>,
    pub deploy: Option<VerdictDeploy>,
    pub rollback_outcome: Option<String>,
    pub restricted: bool,
    pub windows: Option<VerdictWindows>,
    pub needs: Option<VerdictNeeds>,
    pub env: Option<String>,
    pub env_source: Option<String>,
    pub metrics: Option<Vec<VerdictMetric>>,
    /// Number of images seen for this version in the scope.
    pub version_images: Option<usize>,
    /// Pods still running a K8s not_serving version, at most 50.
    pub pods: Option<Vec<NotServingPod>>,
    pub pods_total: Option<u64>,
}

/// The metric that decided the verdict, with its interval.
#[derive(Serialize, ToSchema)]
pub struct VerdictHeadline {
    pub metric: Option<String>,
    pub new: Option<f64>,
    pub base: Option<f64>,
    pub lo: Option<f64>,
    pub hi: Option<f64>,
    pub ci_kind: Option<String>,
    /// `ratio`, `us`, `ms`, `score` or `count`.
    pub unit: String,
}

#[derive(Serialize, ToSchema)]
pub struct VerdictSecond {
    pub metric: Option<String>,
    pub new: Option<f64>,
    pub base: Option<f64>,
    pub unit: String,
}

#[derive(Serialize, ToSchema)]
pub struct VerdictSample {
    pub n_new: i64,
    pub n_base: i64,
    pub since: i64,
}

#[derive(Serialize, ToSchema)]
pub struct VerdictBaseline {
    pub version: Option<String>,
    pub image: Option<String>,
    pub rule: String,
    pub initial_rule: String,
    pub initial_version: Option<String>,
    pub initial_image: Option<String>,
    pub switched_at: Option<i64>,
    pub where_key: Option<String>,
    pub env: Option<String>,
    pub traffic_share: Option<f64>,
    pub version_images: usize,
}

#[derive(Serialize, ToSchema)]
pub struct VerdictRecheck {
    pub verdict: Option<String>,
    pub at: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct VerdictRegion {
    pub cluster: String,
    pub verdict: String,
}

#[derive(Serialize, ToSchema)]
pub struct VerdictDeploy {
    pub kind: String,
    pub at: i64,
    pub from_version: Option<String>,
    pub from_image: Option<String>,
}

/// The windows the stored verdict last judged; `b` is null until a baseline window is stored.
#[derive(Serialize, ToSchema)]
pub struct VerdictWindows {
    pub a: VerdictWindow,
    pub b: Option<VerdictWindow>,
}

#[derive(Serialize, ToSchema)]
pub struct VerdictWindow {
    pub start_time: i64,
    pub end_time: i64,
}

/// The sample a verdict still waits for.
#[derive(Serialize, ToSchema)]
pub struct VerdictNeeds {
    pub metric: Option<String>,
    pub have: Option<i64>,
    pub need: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct VerdictMetric {
    pub verdict_key: String,
    pub metric: String,
    pub new_value: Option<f64>,
    pub base_value: Option<f64>,
    pub delta: Option<f64>,
    pub lo: Option<f64>,
    pub hi: Option<f64>,
    pub ci_kind: String,
    pub badge: String,
    pub band_new: Option<String>,
    pub band_base: Option<String>,
    pub n_new: i64,
    pub n_base: i64,
    pub updated_at: i64,
}

/// `DELETE /service_versions/{version_key}`.
#[derive(Serialize, ToSchema)]
pub struct VersionDeleted {
    /// False when no live version had the key.
    pub deleted: bool,
}

/// Body of `POST /service_versions/compare`.
#[derive(Deserialize, ToSchema)]
pub struct VersionCompareRequest {
    pub service: String,
    /// Scope key of the service.
    #[serde(rename = "where")]
    pub where_key: String,
    /// The version under test.
    pub a: VersionCompareArm,
    /// A manual baseline; the automatic baseline is used when omitted.
    pub b: Option<BaselineArm>,
    /// At least one of `traces` and `rum`.
    #[schema(min_items = 1)]
    pub signals: Vec<CompareSignal>,
    pub baseline: Option<CompareBaseline>,
    pub mode: Option<CompareMode>,
    /// Shared window of a concurrent compare; required when `mode` is `concurrent`.
    pub window: Option<CompareWindow>,
    /// Longest arm window in seconds, 1 to 604800 (default 86400).
    pub max_span_secs: Option<i64>,
    /// Confidence level, 0 to below 1 (default 0.9).
    pub ci_level: Option<f64>,
    /// Endpoints to return, at most 1000 (default 50).
    pub endpoints_limit: Option<u64>,
}

#[derive(Deserialize, ToSchema)]
pub struct VersionCompareArm {
    pub version: String,
    pub image: Option<String>,
    /// Compare this deploy transition.
    pub deploy_key: Option<String>,
    /// Arm window, given together with `end_time`, at most 7 days.
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
pub struct BaselineArm {
    pub version: Option<String>,
    pub image: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
pub struct CompareWindow {
    pub start_time: i64,
    pub end_time: i64,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CompareSignal {
    Traces,
    Rum,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CompareBaseline {
    Auto,
    Canary,
    Previous,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CompareMode {
    Sequential,
    Concurrent,
}

/// Result of `POST /service_versions/compare`; only the requested signals are present. The OSS
/// build answers only `traces`, `rum` and `notes`, so the fields it omits are not required.
#[derive(Serialize, ToSchema)]
pub struct CompareResponse {
    #[schema(required = false)]
    pub service: String,
    #[schema(required = false)]
    pub where_key: String,
    #[schema(required = false)]
    pub env: String,
    #[schema(required = false)]
    pub no_env: bool,
    #[schema(required = false)]
    pub mode: CompareMode,
    #[schema(required = false)]
    pub aliases_applied: Vec<String>,
    #[schema(required = false)]
    pub arms: VersionCompareArms,
    /// How the baseline was chosen, `none` when there is no baseline.
    #[schema(required = false)]
    pub baseline_rule: String,
    #[schema(required = false)]
    pub baseline_reason: CompareBaselineReason,
    pub deploy_key: Option<String>,
    pub stored_verdict: Option<VersionVerdict>,
    pub live_verdict: Option<VersionVerdict>,
    pub traces: Option<CompareTraces>,
    pub rum: Option<CompareRum>,
    /// RUM drill-downs, present when `rum` is requested and its evidence is readable.
    pub inp_targets: Option<DrillInpTargets>,
    pub rum_breakdown: Option<DrillBreakdown>,
    pub pages: Option<DrillPages>,
    pub rum_series: Option<DrillSeries>,
    pub notes: Vec<String>,
}

#[derive(Serialize, ToSchema)]
pub struct VersionCompareArms {
    pub a: VersionCompareArmResult,
    pub b: VersionBaselineArmResult,
}

/// The arm under test.
#[derive(Serialize, ToSchema)]
pub struct VersionCompareArmResult {
    pub version: String,
    pub image: Option<String>,
    pub image_ref: Option<String>,
    pub version_key: String,
    pub deploy_key: Option<String>,
    pub first_seen: i64,
    pub last_seen: i64,
    pub start_time: i64,
    pub end_time: i64,
    pub coverage: ArmCoverage,
    pub basis: ArmBasis,
    pub signals: ArmSignalPresence,
    /// Share of the arm's traffic in a concurrent compare, else null.
    pub traffic_share: Option<f64>,
    /// The window holds a rollup row of the version; null when a read failed.
    pub has_rollup: Option<bool>,
}

/// The baseline arm; `version` is empty when there is no baseline.
#[derive(Serialize, ToSchema)]
pub struct VersionBaselineArmResult {
    pub version: String,
    pub image: Option<String>,
    pub image_ref: Option<String>,
    pub where_key: String,
    pub first_seen: Option<i64>,
    pub last_seen: Option<i64>,
    pub start_time: i64,
    pub end_time: i64,
    pub coverage: ArmCoverage,
    pub basis: ArmBasis,
    pub signals: ArmSignalPresence,
    pub traffic_share: Option<f64>,
    pub has_rollup: Option<bool>,
}

/// Whether an arm's window can hold rollup rows.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ArmCoverage {
    Ok,
    AgedOut,
    NotConcurrent,
}

/// `hourly` when the arm was read at whole-hour steps.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ArmBasis {
    Hourly,
    Fine,
}

/// Which signals had traffic in the arm's window.
#[derive(Serialize, ToSchema)]
pub struct ArmSignalPresence {
    pub traces: bool,
    pub rum: bool,
}

#[derive(Serialize, ToSchema)]
pub struct CompareBaselineReason {
    pub deploy_key: Option<String>,
}

/// Error rate, latency percentiles and endpoints of both arms. A section that could not be read
/// holds only `status`, `insufficient`, `reason` and, without a baseline, `observed`.
#[derive(Serialize, ToSchema)]
pub struct CompareTraces {
    /// `complete`, `timeout` or `error`; absent in the OSS build.
    #[schema(required = false)]
    pub status: String,
    pub insufficient: bool,
    pub reason: Option<String>,
    pub observed: Option<CompareObserved>,
    pub requests: Option<CompareRequestCounts>,
    pub error_rate: Option<VersionMetricDelta>,
    pub p50: Option<VersionMetricDelta>,
    pub p95: Option<VersionMetricDelta>,
    pub p99: Option<VersionMetricDelta>,
    pub endpoints: Option<Vec<CompareEndpoint>>,
    pub endpoint_detail: Option<CompareDetailStatus>,
}

/// Error view rate, Web Vitals and error types of both arms; LCP in s, INP and loading time in
/// ms, CLS unitless. A section that could not be read is shaped as in [`CompareTraces`].
#[derive(Serialize, ToSchema)]
pub struct CompareRum {
    #[schema(required = false)]
    pub status: String,
    pub insufficient: bool,
    pub reason: Option<String>,
    pub observed: Option<CompareObserved>,
    pub views: Option<CompareArmCounts>,
    pub session_windows: Option<CompareArmCounts>,
    pub errors: Option<CompareArmCounts>,
    pub error_view_rate: Option<VersionMetricDelta>,
    pub lcp_p75: Option<CompareVital>,
    pub inp_p75: Option<CompareVital>,
    pub cls_p75: Option<CompareVital>,
    pub loading_time_p75: Option<VersionMetricDelta>,
    pub error_types: Option<CompareErrorTypes>,
    pub samples: Option<CompareVitalSamples>,
    pub error_detail: Option<CompareDetailStatus>,
}

/// The judged arm's traffic when there is no baseline to compare it with.
#[derive(Serialize, ToSchema)]
pub struct CompareObserved {
    pub requests: u64,
    pub views: u64,
}

#[derive(Serialize, ToSchema)]
pub struct CompareRequestCounts {
    pub a: u64,
    pub b: u64,
    pub rate_a: f64,
    pub rate_b: f64,
}

#[derive(Serialize, ToSchema)]
pub struct CompareArmCounts {
    pub a: u64,
    pub b: u64,
}

/// `a` minus `b` with its interval; `ci_kind` tells a confidence interval from a sketch band.
#[derive(Serialize, ToSchema)]
pub struct VersionMetricDelta {
    pub a: f64,
    pub b: f64,
    pub delta: f64,
    pub lo: f64,
    pub hi: f64,
    pub straddles_zero: bool,
    pub insufficient: bool,
    /// `variance`, `sketch_band` or `histogram_band`.
    pub ci_kind: String,
}

/// One operation of one trace stream; restricted evidence drops the error fields.
#[derive(Serialize, ToSchema)]
pub struct CompareEndpoint {
    pub operation: String,
    pub source_stream: String,
    /// `both`, `a_only` or `b_only`.
    pub status: String,
    pub requests_a: u64,
    pub requests_b: u64,
    pub errors_a: Option<u64>,
    pub errors_b: Option<u64>,
    /// Errors only the judged version has.
    pub introduced: Option<bool>,
    pub early: Option<bool>,
    pub error_rate: VersionMetricDelta,
    pub p95: VersionMetricDelta,
    /// Baseline p95 in µs, the threshold of the slow-traces link.
    pub baseline_p95_us: Option<f64>,
}

/// Whether the per-endpoint or per-error-type detail was fine enough to claim new or fixed rows.
#[derive(Serialize, ToSchema)]
pub struct CompareDetailStatus {
    /// `ok` or `insufficient`.
    pub status: String,
    pub reason: Option<String>,
}

/// A p75 Web Vital delta with the band each arm falls in.
#[derive(Serialize, ToSchema)]
pub struct CompareVital {
    pub a: f64,
    pub b: f64,
    pub delta: f64,
    pub lo: f64,
    pub hi: f64,
    pub straddles_zero: bool,
    pub insufficient: bool,
    pub ci_kind: String,
    /// `good`, `needs_improvement` or `poor`.
    pub band_a: Option<String>,
    pub band_b: Option<String>,
    /// Absent in the OSS build, whose vitals are plain deltas.
    #[schema(required = false)]
    pub band_crossed: bool,
}

/// Each vital's sample count per arm, so a measured 0 reads apart from a vital never reported.
#[derive(Serialize, ToSchema)]
pub struct CompareVitalSamples {
    pub lcp_p75: CompareArmCounts,
    pub inp_p75: CompareArmCounts,
    pub cls_p75: CompareArmCounts,
    pub loading_time_p75: CompareArmCounts,
}

#[derive(Serialize, ToSchema)]
pub struct CompareErrorTypes {
    /// Seen in the judged version, not in the baseline.
    pub introduced: Vec<CompareErrorType>,
    /// Seen in the baseline, not in the judged version.
    pub fixed: Vec<CompareErrorType>,
    pub shared: Vec<CompareSharedErrorType>,
    pub insufficient: bool,
    /// An arm is below its sample floor: the lists show, verdicts wait.
    pub early: bool,
}

/// One error type; restricted evidence keeps only `fingerprint` and `count`.
#[derive(Serialize, ToSchema)]
pub struct CompareErrorType {
    pub fingerprint: String,
    pub count: u64,
    pub error_type: Option<String>,
    pub error_message: Option<String>,
    pub sample_error_id: Option<String>,
    pub sample_ts: Option<i64>,
    pub sample_stack_top: Option<String>,
    pub page: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct CompareSharedErrorType {
    pub fingerprint: String,
    pub count_a: u64,
    pub count_b: u64,
    /// `count_a` minus `count_b`.
    pub delta: i64,
    pub error_type: Option<String>,
    pub error_message: Option<String>,
    pub sample_error_id: Option<String>,
    pub sample_ts: Option<i64>,
    pub sample_stack_top: Option<String>,
    pub page: Option<String>,
}

/// The slowest INP interaction targets of the judged version, with the baseline's figures.
#[derive(Serialize, ToSchema)]
pub struct DrillInpTargets {
    /// `ok`, `insufficient`, `error` or `timeout`.
    pub status: String,
    pub reason: Option<String>,
    pub error: Option<String>,
    /// A scan hit its row limit.
    pub truncated: bool,
    pub rows: Vec<DrillInpRow>,
}

#[derive(Serialize, ToSchema)]
pub struct DrillInpRow {
    pub target: String,
    pub page: String,
    pub a: DrillInpArm,
    pub b: Option<DrillInpArm>,
}

#[derive(Serialize, ToSchema)]
pub struct DrillInpArm {
    pub p75_ms: Option<f64>,
    pub n: u64,
}

/// Views, error views and vitals per browser, device and country value.
#[derive(Serialize, ToSchema)]
pub struct DrillBreakdown {
    pub status: String,
    pub reason: Option<String>,
    pub error: Option<String>,
    pub truncated: bool,
    /// `browser`, `device` and `country`; a dimension the stream lacks is `insufficient`.
    pub dims: BTreeMap<String, DrillBreakdownDim>,
}

#[derive(Serialize, ToSchema)]
pub struct DrillBreakdownDim {
    pub status: String,
    pub reason: Option<String>,
    /// The five values with the most views in the judged version.
    pub values: Vec<DrillBreakdownValue>,
}

#[derive(Serialize, ToSchema)]
pub struct DrillBreakdownValue {
    pub value: String,
    pub a: DrillViewCounts,
    pub b: DrillViewCounts,
    pub lcp_p75: DrillVital,
    pub inp_p75: DrillVital,
    pub cls_p75: DrillVital,
}

#[derive(Serialize, ToSchema)]
pub struct DrillViewCounts {
    pub views: u64,
    pub error_views: u64,
}

/// A p75 vital delta of a drill row; the values are null when an arm is below its floor.
#[derive(Serialize, ToSchema)]
pub struct DrillVital {
    pub a: Option<f64>,
    pub b: Option<f64>,
    pub delta: Option<f64>,
    pub lo: Option<f64>,
    pub hi: Option<f64>,
    pub ci_kind: Option<String>,
    pub insufficient: bool,
    pub straddles_zero: bool,
    /// `no_data` or `below_min_count` when there is no delta.
    pub reason: Option<String>,
}

/// Pages of the judged version, worst vital regression first.
#[derive(Serialize, ToSchema)]
pub struct DrillPages {
    pub status: String,
    pub reason: Option<String>,
    pub error: Option<String>,
    pub rows: Vec<DrillPageRow>,
}

#[derive(Serialize, ToSchema)]
pub struct DrillPageRow {
    pub page: String,
    pub views: CompareArmCounts,
    /// Introduced error types first seen on this page.
    pub new_error_types: usize,
    pub lcp_p75: DrillVital,
    pub inp_p75: DrillVital,
    pub cls_p75: DrillVital,
    pub worst: Option<DrillPageWorst>,
}

#[derive(Serialize, ToSchema)]
pub struct DrillPageWorst {
    pub metric: String,
    pub delta: f64,
}

/// The p75 vitals of each arm over time.
#[derive(Serialize, ToSchema)]
pub struct DrillSeries {
    pub status: String,
    pub reason: Option<String>,
    pub error: Option<String>,
    pub interval_secs: Option<i64>,
    pub units: DrillSeriesUnits,
    pub a: Option<DrillSeriesArm>,
    pub b: Option<DrillSeriesArm>,
}

#[derive(Serialize, ToSchema)]
pub struct DrillSeriesUnits {
    pub lcp_p75: String,
    pub inp_p75: String,
    pub cls_p75: String,
}

#[derive(Serialize, ToSchema)]
pub struct DrillSeriesArm {
    pub version: String,
    pub where_key: String,
    pub start_time: i64,
    pub end_time: i64,
    pub lcp_p75: DrillVitalSeries,
    pub inp_p75: DrillVitalSeries,
    pub cls_p75: DrillVitalSeries,
}

#[derive(Serialize, ToSchema)]
pub struct DrillVitalSeries {
    pub status: String,
    pub reason: Option<String>,
    pub n: u64,
    /// Samples the arm needs before its p75 is shown.
    pub floor: u64,
    pub value: Option<f64>,
    pub points: Vec<DrillSeriesPoint>,
}

#[derive(Serialize, ToSchema)]
pub struct DrillSeriesPoint {
    pub t: i64,
    pub value: Option<f64>,
    pub n: u64,
}
