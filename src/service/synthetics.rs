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

//! Service layer for reading from the `synthetics_results` OO stream.
//! All functions here are OSS — they query the stream via the search service
//! and require no enterprise dependencies.

use std::collections::HashMap;

use config::{
    ider,
    meta::{
        search::{Query, Request, Response as SearchResponse},
        stream::StreamType,
        synthetics::{
            BucketStatus, CheckResult, CheckStatus, ListResultsParams, ListResultsResponse,
            ScreenshotRef, StatusBucket, SyntheticStatus, SyntheticSummary,
        },
    },
};

const STREAM: &str = "synthetics_results";
const DEFAULT_PAGE_SIZE: u64 = 50;
const SEVEN_DAYS_US: i64 = 7 * 24 * 3_600 * 1_000_000;
const ONE_DAY_US: i64 = 24 * 3_600 * 1_000_000;
const ONE_HOUR_US: i64 = 3_600 * 1_000_000;

fn build_req(sql: String, start_time: i64, end_time: i64, size: i64, from: i64) -> Request {
    Request {
        query: Query {
            sql,
            start_time,
            end_time,
            from,
            size,
            track_total_hits: size < 1000, // only pay for total on small result sets
            ..Default::default()
        },
        timeout: 30,
        ..Default::default()
    }
}

async fn run_search(org_id: &str, req: &Request) -> anyhow::Result<SearchResponse> {
    let trace_id = ider::generate_trace_id();
    match crate::service::search::search(&trace_id, org_id, StreamType::Logs, None, req).await {
        Ok(resp) => Ok(resp),
        Err(e) => Err(anyhow::anyhow!(e)),
    }
}

fn parse_result(h: &serde_json::Value) -> Option<CheckResult> {
    Some(CheckResult {
        job_id: h.get("job_id")?.as_str()?.to_string(),
        synthetics_id: h.get("synthetics_id")?.as_str()?.to_string(),
        location: h.get("location")?.as_str()?.to_string(),
        pool: String::new(),
        status: match h.get("status").and_then(|v| v.as_str()).unwrap_or("error") {
            "up" => CheckStatus::Up,
            "warning" => CheckStatus::Warning,
            "down" => CheckStatus::Down,
            _ => CheckStatus::Error,
        },
        response_time_ms: h
            .get("response_time_ms")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
        error: h
            .get("error")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from),
        browser_engine: h
            .get("browser_engine")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from),
        device: h
            .get("device")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from),
        trigger_type: match h
            .get("trigger_type")
            .and_then(|v| v.as_str())
            .unwrap_or("scheduled")
        {
            "manual" => config::meta::synthetics::TriggerType::Manual,
            _ => config::meta::synthetics::TriggerType::Scheduled,
        },
        checked_at: h.get("_timestamp").and_then(|v| v.as_i64()).unwrap_or(0),
        screenshot_refs: h
            .get("screenshot_refs")
            .and_then(|v| {
                if v.is_array() {
                    serde_json::from_value(v.clone()).ok()
                } else {
                    v.as_str().and_then(|s| serde_json::from_str(s).ok())
                }
            })
            .unwrap_or_default(),
        trace_ref: h
            .get("trace_ref")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from),
        rum_session_id: h
            .get("rum_session_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from),
    })
}

fn safe_ident(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(128)
        .collect()
}


pub async fn list_results(
    org_id: &str,
    monitor_id: &str,
    params: &ListResultsParams,
) -> anyhow::Result<ListResultsResponse> {
    let now = config::utils::time::now_micros();
    let end_time = params.end_time.unwrap_or(now);
    let start_time = params.start_time.unwrap_or(end_time - ONE_DAY_US);
    let page = params.page.unwrap_or(0);
    let page_size = params.page_size.unwrap_or(DEFAULT_PAGE_SIZE).min(1000);

    let mut where_extra = String::new();
    if let Some(loc) = &params.location {
        let loc = safe_ident(loc);
        where_extra.push_str(&format!(" AND location = '{loc}'"));
    }
    if let Some(st) = &params.status {
        let st = safe_ident(st);
        where_extra.push_str(&format!(" AND status = '{st}'"));
    }

    let mid = safe_ident(monitor_id);
    let sql = format!(
        "SELECT job_id, synthetics_id, location, status, response_time_ms, \
                error, browser_engine, device, _timestamp, screenshot_refs, trace_ref \
         FROM \"{STREAM}\" \
         WHERE _timestamp >= {start_time} AND _timestamp <= {end_time} \
           AND synthetics_id = '{mid}'{where_extra} \
         ORDER BY _timestamp DESC"
    );

    let req = build_req(
        sql,
        start_time,
        end_time,
        page_size as i64,
        (page * page_size) as i64,
    );
    let resp = run_search(org_id, &req).await?;
    Ok(ListResultsResponse {
        total: resp.total as i64,
        results: resp.hits.iter().filter_map(parse_result).collect(),
    })
}

pub async fn get_summary(
    org_id: &str,
    monitor_id: &str,
    start_time: Option<i64>,
    end_time: Option<i64>,
) -> anyhow::Result<SyntheticSummary> {
    let now = config::utils::time::now_micros();
    let end_time = end_time.unwrap_or(now);
    let start_time = start_time.unwrap_or(end_time - SEVEN_DAYS_US);
    let bucket_start = end_time - ONE_DAY_US;

    let mid = safe_ident(monitor_id);

    let agg_sql = format!(
        "SELECT COUNT(*) as total, \
                SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as up_count, \
                AVG(response_time_ms) as avg_ms, \
                MAX(_timestamp) as last_check_at \
         FROM \"{STREAM}\" \
         WHERE _timestamp >= {start_time} AND _timestamp <= {end_time} \
           AND synthetics_id = '{mid}'"
    );

    let bucket_sql = format!(
        "SELECT (_timestamp / {ONE_HOUR_US}) as hour_bucket, \
                SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as up_count, \
                COUNT(*) as total \
         FROM \"{STREAM}\" \
         WHERE _timestamp >= {bucket_start} AND _timestamp <= {end_time} \
           AND synthetics_id = '{mid}' \
         GROUP BY hour_bucket \
         ORDER BY hour_bucket"
    );

    let latest_sql = format!(
        "SELECT status, response_time_ms, _timestamp \
         FROM \"{STREAM}\" \
         WHERE _timestamp >= {start_time} AND _timestamp <= {end_time} \
           AND synthetics_id = '{mid}' \
         ORDER BY _timestamp DESC"
    );

    let agg_req = build_req(agg_sql, start_time, end_time, 1, 0);
    let bucket_req = build_req(bucket_sql, bucket_start, end_time, 10000, 0);
    let latest_req = build_req(latest_sql, start_time, end_time, 1, 0);

    let (agg_res, bucket_res, latest_res) = tokio::join!(
        run_search(org_id, &agg_req),
        run_search(org_id, &bucket_req),
        run_search(org_id, &latest_req),
    );
    let agg_resp = agg_res?;
    let bucket_resp = bucket_res?;
    let latest_resp = latest_res?;

    let agg = agg_resp.hits.first();
    let total = agg
        .and_then(|h| h.get("total"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let up_count = agg
        .and_then(|h| h.get("up_count"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let last_check_at = agg
        .and_then(|h| h.get("last_check_at"))
        .and_then(|v| v.as_i64());
    let uptime_7d_pct = (total > 0).then(|| up_count as f64 / total as f64 * 100.0);

    let latest = latest_resp.hits.first();
    let status = match latest
        .and_then(|h| h.get("status"))
        .and_then(|v| v.as_str())
    {
        Some("up") => SyntheticStatus::Up,
        Some("warning") => SyntheticStatus::Warning,
        Some("down") => SyntheticStatus::Down,
        _ => SyntheticStatus::Unknown,
    };
    let last_response_ms = latest
        .and_then(|h| h.get("response_time_ms"))
        .and_then(|v| v.as_f64());

    let bucket_map: HashMap<i64, (i64, i64)> = bucket_resp
        .hits
        .iter()
        .filter_map(|h| {
            let bkt = h.get("hour_bucket")?.as_i64()?;
            let up = h.get("up_count")?.as_i64().unwrap_or(0);
            let tot = h.get("total")?.as_i64().unwrap_or(0);
            Some((bkt, (up, tot)))
        })
        .collect();

    let now_bucket = end_time / ONE_HOUR_US;
    let status_24h = (0..24i64)
        .map(|i| {
            let key = now_bucket - 23 + i;
            let ts = key * ONE_HOUR_US;
            let bucket_status = match bucket_map.get(&key) {
                None => BucketStatus::NoData,
                Some((_, 0)) => BucketStatus::NoData,
                Some((up, tot)) if up == tot => BucketStatus::Up,
                Some((0, _)) => BucketStatus::Down,
                _ => BucketStatus::Warning,
            };
            StatusBucket {
                ts,
                status: bucket_status,
            }
        })
        .collect();

    Ok(SyntheticSummary {
        status,
        last_check_at,
        last_response_ms,
        uptime_7d_pct,
        status_24h,
        by_location: vec![],
    })
}

pub async fn batch_synthetic_summary(
    org_id: &str,
    monitor_ids: &[&str],
) -> anyhow::Result<HashMap<String, SyntheticSummary>> {
    if monitor_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let now = config::utils::time::now_micros();
    let seven_d_ago = now - SEVEN_DAYS_US;
    let one_h_ago = now - ONE_HOUR_US;

    let ids_sql = monitor_ids
        .iter()
        .map(|id| format!("'{}'", safe_ident(id)))
        .collect::<Vec<_>>()
        .join(", ");

    // last_check_at + avg response time over last 7 days
    let agg_sql = format!(
        "SELECT synthetics_id, MAX(_timestamp) as last_check_at, AVG(response_time_ms) as avg_ms \
         FROM \"{STREAM}\" \
         WHERE _timestamp >= {seven_d_ago} AND _timestamp <= {now} \
           AND synthetics_id IN ({ids_sql}) \
         GROUP BY synthetics_id"
    );

    // most recent status + response time within last hour
    let latest_sql = format!(
        "SELECT synthetics_id, status, response_time_ms \
         FROM \"{STREAM}\" \
         WHERE _timestamp >= {one_h_ago} AND _timestamp <= {now} \
           AND synthetics_id IN ({ids_sql}) \
         ORDER BY _timestamp DESC"
    );

    let agg_req = build_req(agg_sql, seven_d_ago, now, 10000, 0);
    let latest_req = build_req(latest_sql, one_h_ago, now, 10000, 0);

    let (agg_res, latest_res) = tokio::join!(
        run_search(org_id, &agg_req),
        run_search(org_id, &latest_req)
    );
    let agg_resp = agg_res?;
    let latest_resp = latest_res?;

    let agg_map: HashMap<String, (Option<i64>, Option<f64>)> = agg_resp
        .hits
        .iter()
        .filter_map(|h| {
            let mid = h.get("synthetics_id")?.as_str()?.to_string();
            let last_check_at = h.get("last_check_at").and_then(|v| v.as_i64());
            let avg_ms = h.get("avg_ms").and_then(|v| v.as_f64());
            Some((mid, (last_check_at, avg_ms)))
        })
        .collect();

    // ordered DESC — first hit per synthetics_id is the most recent
    let mut latest_map: HashMap<String, (String, f64)> = HashMap::new();
    for h in &latest_resp.hits {
        if let Some(mid) = h.get("synthetics_id").and_then(|v| v.as_str()) {
            if !latest_map.contains_key(mid) {
                let st = h
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();
                let ms = h
                    .get("response_time_ms")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                latest_map.insert(mid.to_string(), (st, ms));
            }
        }
    }

    let result = monitor_ids
        .iter()
        .map(|&id| {
            let agg = agg_map.get(id);
            let last_check_at = agg.and_then(|(ts, _)| *ts);
            let avg_ms = agg.and_then(|(_, ms)| *ms);

            let (status, last_response_ms) = match latest_map.get(id) {
                Some((s, ms)) => (
                    match s.as_str() {
                        "up" => SyntheticStatus::Up,
                        "warning" => SyntheticStatus::Warning,
                        "down" => SyntheticStatus::Down,
                        _ => SyntheticStatus::Unknown,
                    },
                    Some(*ms),
                ),
                None => (SyntheticStatus::Unknown, avg_ms),
            };

            (
                id.to_string(),
                SyntheticSummary {
                    status,
                    last_check_at,
                    last_response_ms,
                    uptime_7d_pct: None,
                    status_24h: vec![],
                    by_location: vec![],
                },
            )
        })
        .collect();

    Ok(result)
}

// ── Notifications ─────────────────────────────────────────────────────────────

/// Sends a check result notification to each configured alert destination.
///
/// Only fires when the check did NOT pass (status != "up"). Passing runs are
/// intentionally suppressed — operators want alerts, not confirmations.
///
/// Uses the destination's configured template for body rendering when present,
/// falling back to a plain-text Slack/webhook-compatible payload. Template
/// variables: `{{monitor_name}}`, `{{monitor_id}}`, `{{monitor_type}}`,
/// `{{target}}`, `{{location}}`, `{{status}}`, `{{response_time_ms}}`,
/// `{{error}}`, `{{checked_at}}`.
#[cfg(feature = "enterprise")]
pub async fn notify_check_result(
    org_id: &str,
    monitor_name: &str,
    monitor_id: &str,
    monitor_type: &str,
    target: &str,
    destinations: &[String],
    location: &str,
    status: &str,
    response_time_ms: f64,
    error: Option<&str>,
    checked_at: i64,
) {
    // Suppress notifications for passing runs — only alert on failure/error.
    if status == "up" {
        return;
    }

    // TODO: enforce alert_if_fails (consecutive failure count) and cooldown_mins (silence period).
    // Requires a persistent state store keyed by (org_id, synthetics_id) tracking consecutive
    // failure count and last-notified-at timestamp. Until then every failed run fires a
    // notification.

    use config::meta::destinations::Module;

    for dest_name in destinations {
        match crate::service::alerts::destinations::get_with_template(org_id, dest_name).await {
            Ok((dest, tpl)) => {
                let Module::Alert {
                    destination_type, ..
                } = &dest.module
                else {
                    continue;
                };

                // Alert-system templates use single-brace vars ({alert_name}, {alert_url})
                // that are not defined in the synthetics context. Slack rejects payloads
                // with unreplaced {alert_url} in button elements (invalid URI). Until
                // synthetics has its own template system, always use the built-in payload.
                // TODO: support synthetics-specific templates with {{monitor_name}} vars.
                let _ = tpl;
                let msg = default_notification_payload(
                    monitor_name,
                    monitor_id,
                    monitor_type,
                    target,
                    location,
                    status,
                    response_time_ms,
                    error,
                    checked_at,
                );

                let subject = format!("Synthetics: {monitor_name} [{location}] is {status}");
                if let Err(e) = crate::service::alerts::alert::dispatch_notification(
                    destination_type,
                    &subject,
                    msg,
                )
                .await
                {
                    log::error!("[synthetics] notify dest={dest_name} monitor={monitor_id}: {e}");
                }
            }
            Err(e) => {
                log::error!("[synthetics] load dest={dest_name} org={org_id}: {e}");
            }
        }
    }
}

/// Default fallback payload when the destination has no template configured.
/// Wraps in `{"text":"..."}` so Slack (and most generic webhooks) accept it
/// without requiring a custom template. If the destination has a template,
/// `render_template` is used instead and this function is never called.
#[cfg(feature = "enterprise")]
fn default_notification_payload(
    monitor_name: &str,
    _monitor_id: &str,
    _monitor_type: &str,
    target: &str,
    location: &str,
    status: &str,
    response_time_ms: f64,
    error: Option<&str>,
    _checked_at: i64,
) -> String {
    let error_line = match error {
        Some(e) if !e.is_empty() => format!("\nError: {e}"),
        _ => String::new(),
    };
    let text = format!(
        "Synthetic monitor *{monitor_name}* [{location}] is *{status}*\nTarget: {target}\nDuration: {response_time_ms:.0} ms{error_line}"
    );
    serde_json::json!({ "text": text }).to_string()
}
