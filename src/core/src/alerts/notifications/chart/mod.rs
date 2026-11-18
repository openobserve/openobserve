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

//! Chart images for alert notifications — stateless, send-and-forget.
//!
//! The notification carries a signed URL whose query string *is* the chart
//! (see [`payload`]); the unauthenticated render endpoint reconstructs the
//! PNG from the URL alone. Nothing is stored anywhere. Design + live PoC:
//! docs/___alert_templates/plans/2026-08-04-alert-chart-image-design.md
//!
//! This module owns the pieces both sides share:
//! - signing-key resolution (fail-closed),
//! - the per-node render semaphore + send-side query rate cap,
//! - the send-time builder: history query → downsample → signed URL.

pub mod payload;
pub mod render;

use std::{
    collections::{BTreeMap, HashMap},
    sync::{
        LazyLock,
        atomic::{AtomicU32, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use config::meta::{cluster::RoleGroup, search as meta_search, stream::StreamType};
use parking_lot::Mutex;
use tokio::sync::{OnceCell, Semaphore};

use self::payload::ChartPayload;

/// How far back the chart looks: max(6h, 20 evaluation periods), capped at
/// 24h. ~20 points minimum gives the line shape; 6h is the readable default.
const MIN_LOOKBACK_SECS: u64 = 6 * 3600;
const MAX_LOOKBACK_SECS: u64 = 24 * 3600;
const LOOKBACK_PERIODS: u64 = 20;

const ANOMALY_STREAM: &str = "_anomalies";
/// Each destination of one run reuses the chart instead of querying again.
const ANOMALY_CHART_TTL: Duration = Duration::from_secs(60);
const ANOMALY_BUILD_TIMEOUT: Duration = Duration::from_secs(5);
/// An anomaly send waits this long for a render permit, then goes out without the chart.
const ANOMALY_RENDER_WAIT: Duration = Duration::from_secs(2);
/// A 24 h lookback of 1-minute buckets is 1,440 rows; this leaves room for event rows.
const ANOMALY_SERIES_ROWS: i64 = 5000;

/// Built anomaly charts keyed by (org, anomaly id, window end, judged end).
static ANOMALY_CHARTS: LazyLock<Mutex<HashMap<AnomalyChartKey, CachedChart>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Signing key, cached on first SUCCESSFUL resolution. Failure (no key
/// material, or a transient DB error fetching the root user) is NOT cached —
/// each call fails closed for now and retries next time, so one DB hiccup at
/// first use can't disable charts for the process lifetime. A deployment
/// with genuinely no material pays one cheap lookup per chart attempt.
static SIGNING_KEY: OnceCell<Vec<u8>> = OnceCell::const_new();

/// One bucket of an anomaly chart: a stored judgment or a point of the current run.
#[derive(Debug, Clone, PartialEq)]
pub struct AnomalySeriesPoint {
    pub ts_us: i64,
    pub value: f64,
    pub lower: Option<f64>,
    pub upper: Option<f64>,
    pub is_anomaly: bool,
    pub is_absence: bool,
    pub is_partial_drop: bool,
}

/// Inputs of one anomaly chart, built once per run and shared by its destinations.
pub struct AnomalyChartRequest<'a> {
    pub org_id: &'a str,
    pub anomaly_id: &'a str,
    pub anomaly_name: &'a str,
    pub stream_name: &'a str,
    /// History reads only points of this model; None reads every model.
    pub model_version: Option<i64>,
    /// Data time of the fire; the chart ends here, not at wall-clock now.
    pub window_end_us: i64,
    pub judged_end_us: i64,
    pub bucket_seconds: i64,
    /// The run's scored points, which can be not yet searchable.
    pub current: &'a [AnomalySeriesPoint],
}

type AnomalyChartKey = (String, String, i64, i64);

struct CachedChart {
    built_at: Instant,
    url: String,
    payload: ChartPayload,
}

/// Optional `_anomalies` columns: a query naming a column the stream never saw fails whole.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct AnomalyColumns {
    values: bool,
    bounds: bool,
    absence: bool,
    partial_drop: bool,
    judged_end: bool,
    model_version: bool,
}

impl AnomalyColumns {
    fn from_schema(schema: &arrow_schema::Schema) -> Self {
        let has = |name: &str| schema.field_with_name(name).is_ok();
        Self {
            values: has("actual_value") && has("is_anomaly") && has("created_at"),
            bounds: has("expected_lower") && has("expected_upper"),
            absence: has("is_absence"),
            partial_drop: has("is_partial_drop"),
            judged_end: has("judged_end_us"),
            model_version: has("model_version"),
        }
    }
}

/// A stored bucket judgment with the query end of the run that wrote it (None before the field).
#[derive(Debug, Clone, PartialEq)]
struct StoredPoint {
    point: AnomalySeriesPoint,
    judged_end_us: Option<i64>,
}

pub async fn signing_key() -> Option<&'static [u8]> {
    SIGNING_KEY
        .get_or_try_init(|| async {
            let cfg = config::get_config();
            let salt = &config::get_ext_auth_salt();
            if !cfg.auth.alert_chart_signing_key.is_empty() {
                return Ok(payload::derive_signing_key(
                    &cfg.auth.alert_chart_signing_key,
                    salt,
                ));
            }
            // Fallback IKM: the root user's stored password hash — secret,
            // per-instance, and identical on every node because it lives in
            // the shared meta DB (so routers verify what schedulers sign).
            match infra::table::users::get_root_user().await {
                Ok(root) if !root.password.is_empty() => {
                    Ok(payload::derive_signing_key(&root.password, salt))
                }
                _ => {
                    log::warn!(
                        "[ALERT_CHART] no signing key material available (set ZO_ALERT_CHART_SIGNING_KEY); chart disabled for this attempt"
                    );
                    Err(())
                }
            }
        })
        .await
        .ok()
        .map(|v| v.as_slice())
}

/// Lifetime of a signed chart URL. The expiry is embedded in the URL itself
/// (nothing is stored anywhere); after it, fetches return 404. Responses are
/// served cache-immutable, but chat clients/CDNs (live-verified: Slack's
/// image proxy) can still re-fetch when a channel is reopened — so this must
/// cover the realistic VIEWING window of a notification, not just delivery.
/// A constant, not a config knob: 24h fits every chat surface we deliver to,
/// and nobody should have to discover the Slack-re-fetch failure mode by
/// tuning it down.
pub const URL_TTL_SECS: u64 = 86_400;

/// Per-node cap on concurrent chart PNG renders (fetch-time renders on the
/// HTTP node and send-time renders for email/discord). At the cap, fetches
/// 404 and sends go out chartless — pages are never delayed by charts.
/// Sized to the node rather than configured: renders are CPU-bound
/// (plotters rasterization), so a couple of cores' worth is the right cap
/// everywhere.
fn max_concurrent_renders() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().min(4))
        .unwrap_or(2)
}

/// Per-node cap on send-side history queries per minute — a DoS backstop
/// bounding triggers-stream load during alert storms, not a tuning surface.
/// At 100k firing alerts/min, ~600 get charts and the rest degrade to
/// chartless notifications.
const QUERIES_PER_MINUTE: u32 = 600;

/// Per-node cap on concurrent PNG renders (fetch-side and send-side).
pub fn render_semaphore() -> &'static Semaphore {
    static SEM: std::sync::OnceLock<Semaphore> = std::sync::OnceLock::new();
    SEM.get_or_init(|| Semaphore::new(max_concurrent_renders()))
}

/// Send-side history-query rate cap: at most [`QUERIES_PER_MINUTE`] per
/// node, skip (never queue) beyond it. Storms degrade to chartless
/// notifications.
fn query_budget_available() -> bool {
    static WINDOW_MINUTE: AtomicU64 = AtomicU64::new(0);
    static COUNT: AtomicU32 = AtomicU32::new(0);
    let minute = (config::utils::time::now_micros() / 60_000_000) as u64;
    let prev = WINDOW_MINUTE.swap(minute, Ordering::Relaxed);
    if prev != minute {
        COUNT.store(0, Ordering::Relaxed);
    }
    COUNT.fetch_add(1, Ordering::Relaxed) < QUERIES_PER_MINUTE
}

/// Query the alert's evaluation history from the self-reporting triggers
/// stream: every evaluation (fired or not) records `actual_value`
/// (usage.rs), which is exactly the chart's Y series. Runs on the background
/// query pool like the alert evaluation itself.
async fn fetch_series(org_id: &str, alert_id: &str, lookback_secs: u64) -> Option<Vec<(u64, f64)>> {
    use config::meta::self_reporting::usage::TRIGGERS_STREAM;

    if !ids_are_safe(org_id, alert_id) {
        return None;
    }

    if !may_hold_values(
        org_id,
        crate::self_reporting::triggers_schema::get(org_id).await,
    ) {
        return None;
    }

    let end_time = config::utils::time::now_micros();
    let start_time = end_time - (lookback_secs as i64) * 1_000_000;
    let sql = format!(
        "SELECT _timestamp, actual_value FROM \"{TRIGGERS_STREAM}\" \
         WHERE module = 'alert' AND org = '{org_id}' AND key LIKE '%{alert_id}' \
         AND actual_value IS NOT NULL \
         ORDER BY _timestamp ASC"
    );
    let req = meta_search::Request {
        query: meta_search::Query {
            sql,
            start_time,
            end_time,
            from: 0,
            size: 5000,
            track_total_hits: false,
            ..Default::default()
        },
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        use_cache: false,
        ..Default::default()
    };

    let trace_id = config::ider::generate_trace_id();
    let resp = search_service::grpc_search::grpc_search(
        &trace_id,
        org_id,
        StreamType::Logs,
        None,
        &req,
        Some(RoleGroup::Background),
    )
    .await
    .ok()?;

    let mut points: Vec<(u64, f64)> = resp
        .hits
        .iter()
        .filter_map(|hit| {
            let ts = hit.get("_timestamp")?.as_i64()?;
            let v = hit.get("actual_value")?.as_f64()?;
            Some(((ts / 1_000_000) as u64, v))
        })
        .collect();
    points.sort_unstable_by_key(|(t, _)| *t);
    Some(points)
}

/// Inputs the send pipeline already has when a notification fires.
pub struct ChartRequest<'a> {
    pub org_id: &'a str,
    pub alert_id: &'a str,
    pub alert_name: &'a str,
    pub stream_name: &'a str,
    /// Evaluation period in seconds (drives the lookback window).
    pub period_secs: u64,
    /// Trigger evaluation time, unix seconds.
    pub trigger_ts: u64,
    /// The FIRING evaluation's observed value. The triggers stream only
    /// receives this evaluation's row AFTER the notification send completes,
    /// so the history query alone can never contain the breach itself — the
    /// single most important point on the chart. Appended explicitly.
    pub current_value: Option<f64>,
    pub crit_threshold: Option<f64>,
    pub warn_threshold: Option<f64>,
}

/// Alert ids are KSUIDs and org ids allow `_`/`-`; both are interpolated into SQL, so
/// anything outside those alphabets is refused rather than escaped.
fn ids_are_safe(org_id: &str, id: &str) -> bool {
    !id.is_empty()
        && id.chars().all(|c| c.is_ascii_alphanumeric())
        && !org_id.is_empty()
        && org_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A stream re-created after a delete lacks `actual_value` until a row carried it.
fn may_hold_values(org_id: &str, schema: infra::errors::Result<arrow_schema::Schema>) -> bool {
    match schema {
        Ok(schema) => schema.field_with_name("actual_value").is_ok(),
        Err(e) => {
            log::warn!(
                "[ALERT_CHART] triggers schema read failed for {org_id}, querying anyway: {e}"
            );
            true
        }
    }
}

/// Build the signed chart payload for one firing. Returns `None` whenever a
/// chart cannot or should not be produced — the caller always degrades to a
/// chartless notification, never an error.
pub async fn build_payload(req: &ChartRequest<'_>) -> Option<ChartPayload> {
    let cfg = config::get_config();
    if !cfg.limit.alert_chart_enabled {
        return None;
    }
    if !query_budget_available() {
        config::metrics::ALERT_CHART_EVENTS_TOTAL
            .with_label_values(&["send_rate_capped"])
            .inc();
        return None;
    }

    let lookback = (req.period_secs.saturating_mul(LOOKBACK_PERIODS))
        .clamp(MIN_LOOKBACK_SECS, MAX_LOOKBACK_SECS);
    let mut series = fetch_series(req.org_id, req.alert_id, lookback).await?;
    // Append the firing evaluation's own point (not yet in the stream — see
    // ChartRequest::current_value) so the breach is always on the chart and
    // the trigger marker lands on it.
    if let Some(v) = req.current_value
        && series.last().is_none_or(|(t, _)| *t < req.trigger_ts)
    {
        series.push((req.trigger_ts, v));
    }
    if series.len() < 2 {
        return None;
    }

    Some(ChartPayload {
        v: 1,
        exp: (config::utils::time::now_micros() / 1_000_000) as u64 + URL_TTL_SECS,
        title: format!("{} · {}", req.alert_name, req.stream_name),
        points: payload::downsample(&series),
        crit: req.crit_threshold,
        warn: req.warn_threshold,
        trigger_ts: req.trigger_ts,
        band: None,
        marks: Vec::new(),
    })
}

/// The signed URL and payload of an anomaly chart, cached 60 s per run, with a 5 s build cap.
pub async fn build_anomaly_chart(req: &AnomalyChartRequest<'_>) -> Option<(String, ChartPayload)> {
    if !config::get_config().limit.alert_chart_enabled {
        log::debug!(
            "[ALERT_CHART] charts are off; anomaly {} sends without one",
            req.anomaly_id
        );
        chart_event("disabled");
        return None;
    }
    let key = (
        req.org_id.to_string(),
        req.anomaly_id.to_string(),
        req.window_end_us,
        req.judged_end_us,
    );
    if let Some(hit) = cached_chart(&key, Instant::now()) {
        return Some(hit);
    }
    let Ok(built) =
        tokio::time::timeout(ANOMALY_BUILD_TIMEOUT, build_anomaly_chart_uncached(req)).await
    else {
        log::warn!(
            "[ALERT_CHART] anomaly chart for {}/{} timed out, sending without it",
            req.org_id,
            req.anomaly_id
        );
        chart_event("build_timeout");
        return None;
    };
    let (url, payload) = built?;
    ANOMALY_CHARTS.lock().insert(
        key,
        CachedChart {
            built_at: Instant::now(),
            url: url.clone(),
            payload: payload.clone(),
        },
    );
    Some((url, payload))
}

/// Latest judgment per bucket from `_anomalies`, ending at `window_end_us`, oldest first.
pub async fn fetch_anomaly_series(
    org_id: &str,
    anomaly_id: &str,
    model_version: Option<i64>,
    window_end_us: i64,
    lookback_secs: u64,
) -> Option<Vec<AnomalySeriesPoint>> {
    let rows = fetch_anomaly_rows(
        org_id,
        anomaly_id,
        model_version,
        window_end_us,
        lookback_secs,
    )
    .await?;
    Some(rows.into_iter().map(|r| r.point).collect())
}

/// The absolute render-endpoint URL for a signed payload.
pub async fn build_chart_url(org_id: &str, p: &ChartPayload) -> Option<String> {
    let key = signing_key().await?;
    let (d, s) = payload::encode(p, key, org_id)?;
    let cfg = config::get_config();
    let web_url = cfg.common.web_url.trim_end_matches('/');
    let base_uri = cfg.common.base_uri.trim_end_matches('/');
    Some(format!(
        "{web_url}{base_uri}/api/v2/{org_id}/alerts/charts/render?d={d}&s={s}"
    ))
}

/// D20 rule 12: no receiver can load an image from this `ZO_WEB_URL`, so URL sends drop it.
pub fn web_url_is_local() -> bool {
    base_is_local(&config::get_config().common.web_url)
}

/// A host name gets no check; a base with no host counts as local. [pure]
pub fn base_is_local(base: &str) -> bool {
    use std::net::IpAddr;
    let Ok(url) = url::Url::parse(base.trim()) else {
        return true;
    };
    let ip = match url.host() {
        None => return true,
        Some(url::Host::Domain(d)) => {
            let d = d.trim_end_matches('.').to_ascii_lowercase();
            return d == "localhost" || d.ends_with(".localhost");
        }
        Some(url::Host::Ipv4(v4)) => IpAddr::V4(v4),
        Some(url::Host::Ipv6(v6)) => v6.to_ipv4_mapped().map_or(IpAddr::V6(v6), IpAddr::V4),
    };
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || (o[0] == 100 && (o[1] & 0xc0) == 64)
        }
        IpAddr::V6(v6) => {
            let s = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || (s & 0xfe00) == 0xfc00
                || (s & 0xffc0) == 0xfe80
        }
    }
}

/// Send-time render (email CID / discord upload): bounded by the same
/// per-node semaphore as fetch-side renders; at capacity the send proceeds
/// chartless.
pub fn try_render_png(p: &ChartPayload) -> Option<Vec<u8>> {
    let Ok(_permit) = render_semaphore().try_acquire() else {
        return render_busy();
    };
    render_send_png(p)
}

/// The anomaly send's render: it waits up to [`ANOMALY_RENDER_WAIT`] for a permit.
pub async fn render_png_waiting(p: &ChartPayload) -> Option<Vec<u8>> {
    let Ok(Ok(_permit)) =
        tokio::time::timeout(ANOMALY_RENDER_WAIT, render_semaphore().acquire()).await
    else {
        return render_busy();
    };
    render_send_png(p)
}

pub(crate) fn chart_event(event: &str) {
    config::metrics::ALERT_CHART_EVENTS_TOTAL
        .with_label_values(&[event])
        .inc();
}

fn render_busy() -> Option<Vec<u8>> {
    log::warn!("[ALERT_CHART] render busy, sending without chart");
    chart_event("render_busy");
    None
}

fn render_send_png(p: &ChartPayload) -> Option<Vec<u8>> {
    match render::render_png(p) {
        Ok(png) => {
            config::metrics::ALERT_CHART_EVENTS_TOTAL
                .with_label_values(&["rendered_send"])
                .inc();
            Some(png)
        }
        Err(e) => {
            log::warn!("[ALERT_CHART] send-time render failed: {e}");
            chart_event("render_failed");
            None
        }
    }
}

fn cached_chart(key: &AnomalyChartKey, now: Instant) -> Option<(String, ChartPayload)> {
    let mut cache = ANOMALY_CHARTS.lock();
    cache.retain(|_, c| now.saturating_duration_since(c.built_at) < ANOMALY_CHART_TTL);
    cache.get(key).map(|c| (c.url.clone(), c.payload.clone()))
}

async fn build_anomaly_chart_uncached(
    req: &AnomalyChartRequest<'_>,
) -> Option<(String, ChartPayload)> {
    if !ids_are_safe(req.org_id, req.anomaly_id) || req.window_end_us <= 0 {
        log::warn!(
            "[ALERT_CHART] anomaly {} has no chart: unsafe id or window end {}",
            req.anomaly_id,
            req.window_end_us
        );
        chart_event("bad_request");
        return None;
    }
    if !query_budget_available() {
        log::warn!(
            "[ALERT_CHART] chart query budget spent, anomaly {} sends without chart",
            req.anomaly_id
        );
        chart_event("send_rate_capped");
        return None;
    }
    let lookback = anomaly_lookback_secs(req.bucket_seconds);
    // A failed history read still charts the run's own points.
    let history = fetch_anomaly_rows(
        req.org_id,
        req.anomaly_id,
        req.model_version,
        req.window_end_us,
        lookback,
    )
    .await
    .unwrap_or_default();
    let start_us = req.window_end_us - (lookback as i64) * 1_000_000;
    let points = merge_current(
        history,
        req.current,
        req.judged_end_us,
        start_us,
        req.window_end_us,
    );
    let run_start_us = req
        .current
        .iter()
        .map(|p| p.ts_us)
        .min()
        .unwrap_or(req.window_end_us - req.bucket_seconds.max(1) * 1_000_000);
    let title = format!("{} · {}", req.anomaly_name, req.stream_name);
    let Some(payload) = anomaly_payload(title, &points, run_start_us, req.window_end_us) else {
        log::warn!(
            "[ALERT_CHART] anomaly {} has no points to chart",
            req.anomaly_id
        );
        chart_event("no_points");
        return None;
    };
    let Some(url) = build_chart_url(req.org_id, &payload).await else {
        log::warn!(
            "[ALERT_CHART] anomaly {} chart URL not signed",
            req.anomaly_id
        );
        chart_event("url_failed");
        return None;
    };
    Some((url, payload))
}

/// max(6 h, 20 buckets), capped at 24 h, as the threshold chart does.
fn anomaly_lookback_secs(bucket_seconds: i64) -> u64 {
    (bucket_seconds.max(0) as u64)
        .saturating_mul(LOOKBACK_PERIODS)
        .clamp(MIN_LOOKBACK_SECS, MAX_LOOKBACK_SECS)
}

async fn fetch_anomaly_rows(
    org_id: &str,
    anomaly_id: &str,
    model_version: Option<i64>,
    window_end_us: i64,
    lookback_secs: u64,
) -> Option<Vec<StoredPoint>> {
    if !ids_are_safe(org_id, anomaly_id) {
        return None;
    }
    let cols = match infra::schema::get(org_id, ANOMALY_STREAM, StreamType::Logs).await {
        Ok(schema) => AnomalyColumns::from_schema(&schema),
        Err(e) => {
            log::warn!("[ALERT_CHART] {ANOMALY_STREAM} schema read failed for {org_id}: {e}");
            return None;
        }
    };
    if !cols.values {
        return Some(Vec::new());
    }
    let req = meta_search::Request {
        query: meta_search::Query {
            sql: anomaly_series_sql(anomaly_id, model_version, cols),
            start_time: window_end_us - (lookback_secs as i64) * 1_000_000,
            end_time: window_end_us,
            from: 0,
            size: ANOMALY_SERIES_ROWS,
            track_total_hits: false,
            ..Default::default()
        },
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        use_cache: false,
        ..Default::default()
    };
    // The full search path, not a local one: in a super cluster the points live where the job ran.
    let trace_id = config::ider::generate_trace_id();
    let resp = search_service::grpc_search::grpc_search(
        &trace_id,
        org_id,
        StreamType::Logs,
        None,
        &req,
        Some(RoleGroup::Background),
    )
    .await
    .map_err(|e| log::warn!("[ALERT_CHART] {ANOMALY_STREAM} read failed for {anomaly_id}: {e}"))
    .ok()?;
    Some(parse_series_hits(&resp.hits))
}

/// One row per bucket: the latest judgment, scored rows above event rows, NULL `judged_end_us`
/// first because DataFusion sorts NULL last and `last_value` would pick a pre-feature row.
fn anomaly_series_sql(
    anomaly_id: &str,
    model_version: Option<i64>,
    cols: AnomalyColumns,
) -> String {
    let flags: Vec<&str> = [
        (cols.absence, "is_absence"),
        (cols.partial_drop, "is_partial_drop"),
    ]
    .into_iter()
    .filter_map(|(on, flag)| on.then_some(flag))
    .collect();
    let rank = (!flags.is_empty()).then(|| {
        let scored: Vec<String> = flags.iter().map(|f| format!("{f} IS NOT TRUE")).collect();
        format!("CASE WHEN {} THEN 1 ELSE 0 END", scored.join(" AND "))
    });
    let mut order: Vec<String> = rank.iter().cloned().collect();
    if cols.judged_end {
        order.push("judged_end_us ASC NULLS FIRST".to_string());
    }
    order.push("created_at".to_string());
    let order = order.join(", ");
    let latest = |col: &str| format!("last_value({col} ORDER BY {order})");
    let scored = |expr: String| match &rank {
        Some(r) => format!("CASE WHEN max({r}) = 1 THEN {expr} END"),
        None => expr,
    };
    let verdict = match &rank {
        Some(r) => format!("max({r}) = 1 AND {}", latest("is_anomaly")),
        None => latest("is_anomaly"),
    };
    let mut select = vec![
        "_timestamp AS zo_sql_key".to_string(),
        format!("{} AS value", scored(latest("actual_value"))),
        format!("CASE WHEN {verdict} THEN 1 ELSE 0 END AS flagged"),
    ];
    if cols.bounds {
        select.push(format!("{} AS lower", scored(latest("expected_lower"))));
        select.push(format!("{} AS upper", scored(latest("expected_upper"))));
    }
    if cols.judged_end {
        select.push(format!("{} AS judged_end", latest("judged_end_us")));
    }
    for (flag, alias) in [
        ("is_absence", "absence_value"),
        ("is_partial_drop", "partial_drop_value"),
    ] {
        if flags.contains(&flag) {
            // The latest event row of the bucket, with its own query end for the merge.
            let event = format!("CASE WHEN {flag} IS TRUE THEN 1 ELSE 0 END");
            let mut by = vec![event.clone()];
            if cols.judged_end {
                by.push("judged_end_us ASC NULLS FIRST".to_string());
            }
            by.push("created_at".to_string());
            let by = by.join(", ");
            let of = |col: &str| {
                format!("CASE WHEN max({event}) = 1 THEN last_value({col} ORDER BY {by}) END")
            };
            select.push(format!("{} AS {alias}", of("actual_value")));
            if cols.judged_end {
                select.push(format!("{} AS {alias}_judged", of("judged_end_us")));
            }
        }
    }
    let model = match model_version {
        Some(v) if cols.model_version => format!(" AND model_version = {v}"),
        _ => String::new(),
    };
    format!(
        "SELECT {} FROM \"{ANOMALY_STREAM}\" WHERE anomaly_id = '{anomaly_id}'{model} \
         GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
        select.join(", ")
    )
}

fn parse_series_hits(hits: &[serde_json::Value]) -> Vec<StoredPoint> {
    let num = |hit: &serde_json::Value, key: &str| -> Option<f64> {
        let v = hit.get(key)?;
        v.as_f64()
            .or_else(|| v.as_bool().map(f64::from))
            .or_else(|| v.as_str()?.parse().ok())
            .filter(|v| v.is_finite())
    };
    let mut out = Vec::new();
    for hit in hits {
        let Some(ts_us) = hit.get("zo_sql_key").and_then(|v| v.as_i64()) else {
            continue;
        };
        let judged_end_us = hit.get("judged_end").and_then(|v| v.as_i64());
        let base = AnomalySeriesPoint {
            ts_us,
            value: 0.0,
            lower: None,
            upper: None,
            is_anomaly: false,
            is_absence: false,
            is_partial_drop: false,
        };
        if let Some(value) = num(hit, "value") {
            let point = AnomalySeriesPoint {
                value,
                lower: num(hit, "lower"),
                upper: num(hit, "upper"),
                is_anomaly: num(hit, "flagged").is_some_and(|f| f > 0.0),
                ..base.clone()
            };
            out.push(StoredPoint {
                point,
                judged_end_us,
            });
        }
        let judged_of = |alias: &str| {
            hit.get(format!("{alias}_judged").as_str())
                .and_then(|v| v.as_i64())
                .or(judged_end_us)
        };
        if let Some(value) = num(hit, "absence_value") {
            let point = AnomalySeriesPoint {
                value,
                is_anomaly: true,
                is_absence: true,
                ..base.clone()
            };
            out.push(StoredPoint {
                point,
                judged_end_us: judged_of("absence_value"),
            });
        }
        if let Some(value) = num(hit, "partial_drop_value") {
            let point = AnomalySeriesPoint {
                value,
                is_anomaly: true,
                is_partial_drop: true,
                ..base
            };
            out.push(StoredPoint {
                point,
                judged_end_us: judged_of("partial_drop_value"),
            });
        }
    }
    out
}

fn point_kind(p: &AnomalySeriesPoint) -> u8 {
    match (p.is_absence, p.is_partial_drop) {
        (true, _) => 1,
        (_, true) => 2,
        _ => 0,
    }
}

/// An older run can finish after a newer one, so a current point replaces a stored judgment
/// only when the run judged the bucket at the same or a later query end.
fn merge_current(
    history: Vec<StoredPoint>,
    current: &[AnomalySeriesPoint],
    judged_end_us: i64,
    start_us: i64,
    end_us: i64,
) -> Vec<AnomalySeriesPoint> {
    let mut by_bucket: BTreeMap<(i64, u8), StoredPoint> = history
        .into_iter()
        .map(|s| ((s.point.ts_us, point_kind(&s.point)), s))
        .collect();
    for c in current {
        let key = (c.ts_us, point_kind(c));
        let stored_is_newer = by_bucket
            .get(&key)
            .and_then(|s| s.judged_end_us)
            .is_some_and(|stored| stored > judged_end_us);
        if !stored_is_newer {
            by_bucket.insert(
                key,
                StoredPoint {
                    point: c.clone(),
                    judged_end_us: Some(judged_end_us),
                },
            );
        }
    }
    by_bucket
        .into_values()
        .map(|s| s.point)
        .filter(|p| p.ts_us >= start_us && p.ts_us < end_us)
        .collect()
}

/// How far a point sits outside its band, in band widths; events rank above every value.
fn severity(p: &AnomalySeriesPoint) -> f64 {
    if p.is_absence || p.is_partial_drop {
        return f64::INFINITY;
    }
    match (p.lower, p.upper) {
        (Some(l), Some(u)) => {
            let excess = (l - p.value).max(p.value - u).max(0.0);
            excess / (u - l).abs().max(f64::EPSILON)
        }
        _ => 0.0,
    }
}

/// `points` sorted by bucket. One index set picks values, band and marks together; sentinel
/// points are marks at their own value and never join the line.
fn anomaly_payload(
    title: String,
    points: &[AnomalySeriesPoint],
    run_start_us: i64,
    window_end_us: i64,
) -> Option<ChartPayload> {
    let mut reserved: Vec<usize> = (0..points.len())
        .filter(|&i| {
            let p = &points[i];
            p.ts_us >= run_start_us && (p.is_anomaly || p.is_absence || p.is_partial_drop)
        })
        .collect();
    reserved.sort_by(|&a, &b| {
        severity(&points[b])
            .total_cmp(&severity(&points[a]))
            .then(b.cmp(&a))
    });
    let mut values = Vec::new();
    let mut band = Vec::new();
    let mut marks = Vec::new();
    for i in payload::pick_indices(points.len(), payload::MAX_BAND_POINTS, &reserved) {
        let p = &points[i];
        let at = ((p.ts_us / 1_000_000) as u64, payload::quantize(p.value));
        if p.is_absence || p.is_partial_drop {
            marks.push(at);
            continue;
        }
        values.push(at);
        band.push(match (p.lower, p.upper) {
            (Some(l), Some(u)) => Some((payload::quantize(l), payload::quantize(u))),
            _ => None,
        });
        if p.is_anomaly {
            marks.push(at);
        }
    }
    if values.is_empty() && marks.is_empty() {
        return None;
    }
    Some(ChartPayload {
        v: 1,
        exp: (config::utils::time::now_micros() / 1_000_000) as u64 + URL_TTL_SECS,
        title,
        points: values,
        crit: None,
        warn: None,
        trigger_ts: (window_end_us / 1_000_000) as u64,
        // Always present, even all None, so the renderer treats the chart as an anomaly chart.
        band: Some(band),
        marks,
    })
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};

    use super::*;

    const B: i64 = 300_000_000;
    const T0: i64 = 1_700_000_000_000_000;

    /// The permit tests share the node semaphore, and a fair queue would deadlock two of them.
    static PERMIT_TESTS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[test]
    fn only_a_stream_without_actual_value_skips_the_chart() {
        let with = Schema::new(vec![Field::new("actual_value", DataType::Float64, true)]);
        assert!(may_hold_values("org1", Ok(with)));
        assert!(!may_hold_values("org1", Ok(Schema::empty())));
        let failed = Err(infra::errors::Error::Message("db down".to_string()));
        assert!(may_hold_values("org1", failed));
    }

    fn pt(i: i64, value: f64) -> AnomalySeriesPoint {
        AnomalySeriesPoint {
            ts_us: T0 + i * B,
            value,
            lower: Some(value - 10.0),
            upper: Some(value + 10.0),
            is_anomaly: false,
            is_absence: false,
            is_partial_drop: false,
        }
    }

    fn anomalous(i: i64, value: f64) -> AnomalySeriesPoint {
        AnomalySeriesPoint {
            lower: Some(90.0),
            upper: Some(110.0),
            is_anomaly: true,
            ..pt(i, value)
        }
    }

    fn all_columns() -> AnomalyColumns {
        AnomalyColumns {
            values: true,
            bounds: true,
            absence: true,
            partial_drop: true,
            judged_end: true,
            model_version: true,
        }
    }

    #[test]
    fn series_sql_orders_by_judged_end_nulls_first_when_the_column_exists() {
        let sql = anomaly_series_sql("2abcXYZ", Some(42), all_columns());
        assert!(sql.contains(
            "last_value(actual_value ORDER BY CASE WHEN is_absence IS NOT TRUE AND \
             is_partial_drop IS NOT TRUE THEN 1 ELSE 0 END, judged_end_us ASC NULLS FIRST, \
             created_at)"
        ));
        assert!(
            sql.contains(
                "FROM \"_anomalies\" WHERE anomaly_id = '2abcXYZ' AND model_version = 42 "
            )
        );
        assert!(sql.contains(" AS lower") && sql.contains(" AS upper"));
        assert!(sql.contains(" AS judged_end"));
        assert!(sql.contains(
            "CASE WHEN max(CASE WHEN is_partial_drop IS TRUE THEN 1 ELSE 0 END) = 1 THEN \
             last_value(actual_value ORDER BY CASE WHEN is_partial_drop IS TRUE THEN 1 ELSE 0 \
             END, judged_end_us ASC NULLS FIRST, created_at) END AS partial_drop_value"
        ));
        assert!(sql.contains(" AS absence_value_judged"));
        assert!(sql.ends_with("GROUP BY zo_sql_key ORDER BY zo_sql_key ASC"));
    }

    #[test]
    fn series_sql_on_an_old_stream_orders_by_created_at_only() {
        let cols = AnomalyColumns {
            values: true,
            ..Default::default()
        };
        let sql = anomaly_series_sql("2abcXYZ", Some(42), cols);
        assert!(sql.contains("last_value(actual_value ORDER BY created_at) AS value"));
        for absent in [
            "judged_end_us",
            "expected_lower",
            "is_absence",
            "is_partial_drop",
            "model_version",
        ] {
            assert!(!sql.contains(absent), "{absent} in {sql}");
        }
        let with_judged = AnomalyColumns {
            judged_end: true,
            ..cols
        };
        assert!(
            anomaly_series_sql("x", None, with_judged)
                .contains("ORDER BY judged_end_us ASC NULLS FIRST, created_at)")
        );
    }

    #[test]
    fn unsafe_ids_are_refused() {
        assert!(ids_are_safe("org_1-a", "2abc"));
        assert!(!ids_are_safe("org", "x' OR '1'='1"));
        assert!(!ids_are_safe("org'", "2abc"));
        assert!(!ids_are_safe("", "2abc"));
        assert!(!ids_are_safe("org", ""));
    }

    #[test]
    fn hits_split_into_value_and_event_points() {
        let hits = vec![
            serde_json::json!({"zo_sql_key": T0, "value": 100.0, "flagged": 1, "lower": 90.0, "upper": 110.0, "judged_end": T0 + B}),
            serde_json::json!({"zo_sql_key": T0 + B, "value": null, "flagged": 0, "absence_value": 0.0}),
        ];
        let rows = parse_series_hits(&hits);
        assert_eq!(rows.len(), 2);
        assert!(rows[0].point.is_anomaly && !rows[0].point.is_absence);
        assert_eq!(rows[0].point.upper, Some(110.0));
        assert_eq!(rows[0].judged_end_us, Some(T0 + B));
        assert!(rows[1].point.is_absence && rows[1].point.is_anomaly);
        assert_eq!(rows[1].judged_end_us, None);
    }

    #[test]
    fn an_event_point_keeps_its_own_query_end() {
        let hits = vec![serde_json::json!({
            "zo_sql_key": T0, "value": 100.0, "flagged": 0, "judged_end": T0 + 3 * B,
            "partial_drop_value": 20.0, "partial_drop_value_judged": T0 + 2 * B
        })];
        let rows = parse_series_hits(&hits);
        assert_eq!(rows[0].judged_end_us, Some(T0 + 3 * B));
        assert!(rows[1].point.is_partial_drop);
        assert_eq!(
            (rows[1].point.value, rows[1].judged_end_us),
            (20.0, Some(T0 + 2 * B))
        );
    }

    #[test]
    fn an_older_run_does_not_replace_a_newer_stored_judgment() {
        let stored = |value: f64, judged: Option<i64>| StoredPoint {
            point: pt(0, value),
            judged_end_us: judged,
        };
        let current = [pt(0, 500.0), pt(1, 7.0)];
        let end = T0 + 10 * B;
        let kept = merge_current(
            vec![stored(100.0, Some(T0 + 9 * B))],
            &current,
            T0 + 5 * B,
            T0,
            end,
        );
        assert_eq!(kept[0].value, 100.0);
        assert_eq!(kept[1].value, 7.0);
        let replaced = merge_current(
            vec![stored(100.0, Some(T0 + 5 * B))],
            &current,
            T0 + 5 * B,
            T0,
            end,
        );
        assert_eq!(replaced[0].value, 500.0);
        let legacy = merge_current(vec![stored(100.0, None)], &current, T0 + 5 * B, T0, end);
        assert_eq!(legacy[0].value, 500.0);
        assert_eq!(merge_current(Vec::new(), &current, 0, T0 + B, end).len(), 1);
    }

    #[test]
    fn lookback_is_twenty_buckets_between_six_and_twenty_four_hours() {
        assert_eq!(anomaly_lookback_secs(3600), 20 * 3600);
        assert_eq!(anomaly_lookback_secs(60), MIN_LOOKBACK_SECS);
        assert_eq!(anomaly_lookback_secs(86_400), MAX_LOOKBACK_SECS);
        assert_eq!(anomaly_lookback_secs(-5), MIN_LOOKBACK_SECS);
    }

    #[test]
    fn payload_keeps_an_isolated_anomaly_and_marks_only_anomalies() {
        let mut points: Vec<AnomalySeriesPoint> = (0..1000).map(|i| pt(i, 100.0)).collect();
        points[7] = anomalous(7, 300.0);
        let p = anomaly_payload("t".into(), &points, T0, T0 + 1000 * B).unwrap();
        assert_eq!(p.points.len(), payload::MAX_BAND_POINTS);
        assert_eq!(p.band.as_ref().map(Vec::len), Some(p.points.len()));
        let at = ((T0 + 7 * B) / 1_000_000) as u64;
        assert_eq!(p.marks, vec![(at, 300.0)]);
        assert!(p.points.contains(&(at, 300.0)));
    }

    #[test]
    fn a_recovery_or_trailing_normal_chart_has_no_marks() {
        let points: Vec<AnomalySeriesPoint> = (0..30).map(|i| pt(i, 100.0)).collect();
        let p = anomaly_payload("t".into(), &points, T0 + 25 * B, T0 + 30 * B).unwrap();
        assert!(p.marks.is_empty());
        assert!(p.is_anomaly());
    }

    #[test]
    fn sentinel_points_are_marked_at_their_value_off_the_line() {
        let mut points: Vec<AnomalySeriesPoint> = (0..5).map(|i| pt(i, 100.0)).collect();
        points.push(AnomalySeriesPoint {
            value: 0.0,
            lower: None,
            upper: None,
            is_anomaly: true,
            is_absence: true,
            ..pt(5, 0.0)
        });
        points.push(AnomalySeriesPoint {
            value: 40.0,
            lower: None,
            upper: None,
            is_anomaly: true,
            is_partial_drop: true,
            ..pt(6, 0.0)
        });
        let p = anomaly_payload("t".into(), &points, T0, T0 + 7 * B).unwrap();
        assert_eq!(p.points.len(), 5);
        assert_eq!(
            p.marks,
            vec![
                (((T0 + 5 * B) / 1_000_000) as u64, 0.0),
                (((T0 + 6 * B) / 1_000_000) as u64, 40.0)
            ]
        );
        let only_absence = anomaly_payload("t".into(), &points[5..6], T0, T0 + 7 * B).unwrap();
        assert!(only_absence.points.is_empty());
        assert_eq!(only_absence.marks.len(), 1);
        assert!(anomaly_payload("t".into(), &[], T0, T0 + B).is_none());
    }

    #[test]
    fn a_bucket_without_bounds_is_a_gap_in_the_band() {
        let mut points: Vec<AnomalySeriesPoint> = (0..4).map(|i| pt(i, 100.0)).collect();
        points[2].lower = None;
        points[2].upper = None;
        let band = anomaly_payload("t".into(), &points, T0, T0 + 4 * B)
            .unwrap()
            .band
            .unwrap();
        assert_eq!(band.len(), 4);
        assert_eq!(band[2], None);
        assert_eq!(band[3], Some((90.0, 110.0)));
    }

    #[tokio::test]
    async fn an_anomaly_send_waits_for_a_render_permit_and_a_scheduled_one_does_not() {
        let _serial = PERMIT_TESTS.lock().await;
        let points: Vec<AnomalySeriesPoint> = (0..9).map(|i| anomalous(i, 300.0)).collect();
        let p = anomaly_payload("t".into(), &points, T0, T0 + 9 * B).unwrap();
        assert_eq!(
            (p.points.len(), p.marks.len()),
            (9, 9),
            "a run with no normal point charts"
        );
        let held = render_semaphore()
            .acquire_many(max_concurrent_renders() as u32)
            .await
            .unwrap();
        let started = Instant::now();
        assert!(try_render_png(&p).is_none());
        // It never waits: a wait would last the whole ANOMALY_RENDER_WAIT.
        assert!(started.elapsed() < ANOMALY_RENDER_WAIT);
        let release = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            drop(held);
        });
        let png = render_png_waiting(&p)
            .await
            .expect("a PNG once a permit frees");
        assert!(png.starts_with(b"\x89PNG"));
        release.await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn two_anomaly_sends_on_one_permit_both_get_a_png() {
        let _serial = PERMIT_TESTS.lock().await;
        let points: Vec<AnomalySeriesPoint> = (0..9).map(|i| anomalous(i, 300.0)).collect();
        let p = anomaly_payload("t".into(), &points, T0, T0 + 9 * B).unwrap();
        let others = (max_concurrent_renders() - 1) as u32;
        let _held = render_semaphore().acquire_many(others).await.unwrap();
        let send = |p: ChartPayload| tokio::spawn(async move { render_png_waiting(&p).await });
        let (a, b) = tokio::join!(send(p.clone()), send(p));
        assert!(
            a.unwrap().is_some() && b.unwrap().is_some(),
            "the second send waits"
        );
    }

    #[test]
    fn a_local_or_private_base_has_no_reachable_image() {
        for base in [
            "http://localhost:5080",
            "http://app.localhost",
            "http://127.0.0.1:5080/",
            "http://10.2.3.4",
            "http://172.20.0.1",
            "https://192.168.1.10",
            "http://169.254.1.1",
            "http://100.64.0.1",
            "http://0.0.0.0:5080",
            "http://[::1]:5080",
            "http://[fd00::1]",
            "http://[fe80::1]",
            "http://[::ffff:10.0.0.1]",
            "",
            "not a url",
        ] {
            assert!(base_is_local(base), "{base}");
        }
        for base in [
            "https://o2.acme.com",
            "http://o2-internal.svc.cluster.local:5080",
            "http://8.8.8.8",
            "http://[2001:4860::8888]",
        ] {
            assert!(!base_is_local(base), "{base}");
        }
    }
}
