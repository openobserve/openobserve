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

//! The trusted recovery probe (D'4, D'5). Before a verdict may page quieter, OO reads the
//! affected services' entry spans itself: the agent's own recovery claim never counts.

use config::meta::{
    oncall::{
        agent::PageAction,
        confidence::GradeTrust,
        rca_run::{
            Num, RcaSubmit, RecoveryProbe, RunEndTrust, ServiceRecovery, TimeWindow, TrafficSample,
            baseline_window, judge, recent_window,
        },
    },
    search,
    stream::StreamType,
};
use infra::table::rca_runs::{self as runs_table, Model as RunRow};
use o2_enterprise::enterprise::{alerts::rca_service, common::config::get_config as get_o2_config};
use serde_json::Value;

/// The trace stream the probe reads.
const TRACES_STREAM: &str = "default";
/// Entry spans: the OTLP server kind, as the ingester writes it.
const SERVER_SPAN_KIND: &str = "2";
/// Most services one probe reads; the rest leave the run `unknown`.
const MAX_PROBED_SERVICES: usize = 5;
/// Seconds one probe query may run.
const PROBE_TIMEOUT_SECS: i64 = 20;

/// The services and onset the probe trusts: the persisted context, else the incident's own.
struct TrustedSubject {
    services: Vec<String>,
    onset_us: Option<i64>,
}

/// The trusted state for `record_run_end_with`. The probe runs only for a quieter recommendation.
pub(super) async fn run_end_trust(
    org_id: &str,
    run: &RunRow,
    submit: &RcaSubmit,
    now_us: i64,
) -> RunEndTrust {
    let used = runs_table::decode::<Value>(run.context_used.as_deref()).unwrap_or(Value::Null);
    // Missing capabilities on a super-cluster node mean region coverage is unknown.
    let super_cluster = used
        .pointer("/capabilities/super_cluster")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| get_o2_config().super_cluster.enabled);
    let serving_region = super::super::rca_capabilities::stored_serving_region(Some(&used));
    let quieter = submit
        .verdict
        .as_ref()
        .is_some_and(|v| v.page_recommendation.action != PageAction::Page);
    let recovery_probe = if quieter {
        let subject = trusted_subject(org_id, run, &used).await;
        Some(probe(org_id, &subject, now_us).await)
    } else {
        None
    };
    RunEndTrust {
        grade: GradeTrust {
            super_cluster,
            serving_region,
        },
        recovery_probe,
    }
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .collect()
}

async fn trusted_subject(org_id: &str, run: &RunRow, used: &Value) -> TrustedSubject {
    let mut services = strings(used.get("affected_services"));
    let mut onset_us = used.get("first_alert_at_us").and_then(Value::as_i64);
    // An incident's server-built context names its services and first alert.
    if (services.is_empty() || onset_us.is_none()) && run.subject_type == "incident" {
        let context =
            rca_service::build_incident_context(org_id, &run.subject_id, None, None).await;
        let context = rca_service::rca_context_json(&context);
        if services.is_empty() {
            services = strings(context.get("affected_services"));
        }
        onset_us = onset_us.or_else(|| context.get("first_alert_at_us").and_then(Value::as_i64));
    }
    TrustedSubject { services, onset_us }
}

/// `'` doubled, so a service name stays one SQL string.
fn sql_string(s: &str) -> String {
    s.replace('\'', "''")
}

/// The probe SQL for one service; `{service}` in the persisted query.
fn probe_sql(service: &str) -> String {
    format!(
        "SELECT COUNT(*) AS requests, COUNT(*) FILTER (WHERE span_status = 'ERROR') AS errors, \
         CAST(approx_percentile_cont(end_time - start_time, 0.95) AS BIGINT) AS p95_ns \
         FROM \"{TRACES_STREAM}\" WHERE service_name = '{}' AND span_kind = '{SERVER_SPAN_KIND}'",
        sql_string(service)
    )
}

async fn sample(org_id: &str, service: &str, window: TimeWindow) -> Option<TrafficSample> {
    let req = search::Request {
        query: search::Query {
            sql: probe_sql(service),
            size: 1,
            start_time: window.start,
            end_time: window.end,
            ..Default::default()
        },
        encoding: search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: PROBE_TIMEOUT_SECS,
        search_type: Some(search::SearchEventType::Other),
        search_event_context: None,
        use_cache: false,
        use_index: true,
        clear_cache: false,
        local_mode: Some(false),
        agent_options: None,
    };
    let trace_id = config::ider::generate();
    let resp = match crate::search::search(&trace_id, org_id, StreamType::Traces, None, &req).await
    {
        Ok(resp) => resp,
        Err(e) => {
            log::warn!("[RCA_TURN] recovery probe of {service} in {org_id} failed: {e}");
            return None;
        }
    };
    let row = resp.hits.first();
    let count = |key: &str| {
        row.and_then(|r| r.get(key))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    let requests = count("requests");
    Some(TrafficSample {
        requests,
        errors: count("errors"),
        p95_us: row
            .and_then(|r| r.get("p95_ns"))
            .and_then(Value::as_f64)
            .filter(|_| requests > 0)
            .map(|ns| Num(ns / 1000.0)),
        complete: !resp.is_partial,
    })
}

/// One bounded probe per trusted service: the last 15 minutes against the 30 before onset.
async fn probe(org_id: &str, trusted: &TrustedSubject, now_us: i64) -> RecoveryProbe {
    let Some(onset_us) = trusted.onset_us else {
        return RecoveryProbe::unknown(now_us, "no trusted onset");
    };
    if trusted.services.is_empty() {
        return RecoveryProbe::unknown(now_us, "no trusted affected services");
    }
    let recent = recent_window(now_us);
    let baseline = baseline_window(onset_us);
    let mut services = Vec::new();
    for (i, service) in trusted.services.iter().enumerate() {
        if i >= MAX_PROBED_SERVICES {
            services.push(ServiceRecovery {
                service: service.clone(),
                verdict: judge(None, None),
                recent: None,
                baseline: None,
            });
            continue;
        }
        let now = sample(org_id, service, recent).await;
        let before = sample(org_id, service, baseline).await;
        services.push(ServiceRecovery {
            service: service.clone(),
            verdict: judge(now.as_ref(), before.as_ref()),
            recent: now,
            baseline: before,
        });
    }
    RecoveryProbe::of(
        now_us,
        Some(baseline),
        Some(TRACES_STREAM.to_string()),
        probe_sql("{service}"),
        services,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_probe_reads_entry_spans_of_one_quoted_service() {
        let sql = probe_sql("pay'ments");
        assert!(sql.contains("service_name = 'pay''ments'"), "{sql}");
        assert!(sql.contains("span_kind = '2'"), "{sql}");
        assert!(sql.contains("FROM \"default\""), "{sql}");
    }
}
