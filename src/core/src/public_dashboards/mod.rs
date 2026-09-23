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

//! The public-dashboard rebuilder: runs each panel's saved query server-side
//! **as the publisher** (RBAC-checked), materializing one snapshot per allowed
//! preset for the anonymous plane to point-read. The anonymous plane never runs
//! a query — all query execution lives here, in a trusted background job.

use std::collections::{BTreeMap, BTreeSet};

use config::{
    ider,
    meta::{
        dashboards::Dashboard,
        public_dashboards::{PanelSnapshot, PanelState, PublicDashboardConfig, SnapshotData},
        search,
        stream::StreamType,
    },
    utils::{rand::generate_random_string, time::now_micros},
};
use infra::table::{
    dashboards, entity::public_dashboards::Model as PublicDashboard, public_dashboards as pd_table,
};
use regex::Regex;

const REBUILD_STATE_OK: i32 = 1;
const REBUILD_STATE_ERROR: i32 = 2;

/// Rebuild every preset snapshot for one public dashboard. Reads the LIVE
/// dashboard config (edits auto-sync), executes each panel query as the
/// publisher, and upserts a snapshot per allowed preset.
pub async fn rebuild_one(pd: &PublicDashboard) -> Result<(), anyhow::Error> {
    let conn = infra::db::get_orm_client_rw().await;
    let now = now_micros();

    let Some((_folder, dash)) = dashboards::get_by_id(&pd.org_id, &pd.dashboard_id).await? else {
        pd_table::mark_rebuilt(conn, &pd.id, REBUILD_STATE_ERROR, None, None, now).await?;
        return Ok(());
    };

    let mut presets = parse_i64_list(pd.allowed_presets_secs.as_deref());
    if let Some(default) = pd.default_range_secs {
        presets.push(default);
    }
    presets.sort_unstable();
    presets.dedup();

    let vars = parse_frozen_vars(pd.frozen_variables.as_deref());
    let mut authorized: BTreeSet<String> = BTreeSet::new();
    let mut unauthorized: BTreeSet<String> = BTreeSet::new();

    for preset in &presets {
        let start = now - preset * 1_000_000;
        let panels = build_panels(
            &pd.org_id,
            &pd.published_by,
            &dash,
            &vars,
            start,
            now,
            &mut authorized,
            &mut unauthorized,
        )
        .await;
        let json = serde_json::to_string(&SnapshotData {
            panels,
            built_at: now,
        })?;
        pd_table::upsert_snapshot(conn, &pd.id, *preset, &json, now).await?;
    }

    let auth_json =
        (!authorized.is_empty()).then(|| serde_json::to_string(&authorized).unwrap_or_default());
    let unauth_json = (!unauthorized.is_empty())
        .then(|| serde_json::to_string(&unauthorized).unwrap_or_default());
    pd_table::mark_rebuilt(
        conn,
        &pd.id,
        REBUILD_STATE_OK,
        auth_json.as_deref(),
        unauth_json.as_deref(),
        now,
    )
    .await?;
    Ok(())
}

/// Enumerate v8 panels → queries and materialize each. Non-v8 dashboards are
/// not supported in this cut (they yield an empty panel set).
async fn build_panels(
    org: &str,
    publisher: &str,
    dash: &Dashboard,
    vars: &BTreeMap<String, serde_json::Value>,
    start: i64,
    end: i64,
    authorized: &mut BTreeSet<String>,
    unauthorized: &mut BTreeSet<String>,
) -> BTreeMap<String, PanelSnapshot> {
    let mut out = BTreeMap::new();
    let Some(v8) = dash.v8.as_ref() else {
        return out;
    };
    for tab in &v8.tabs {
        for panel in &tab.panels {
            let mut data = Vec::new();
            let mut result_meta_data = Vec::new();
            let mut queries_meta = Vec::new();
            let mut any_ok = false;
            let mut reason = "no_query".to_string();
            for (qi, q) in panel.queries.iter().enumerate() {
                // Same per-query metadata the live loader builds for an unshifted query.
                queries_meta.push(serde_json::json!({
                    "startTime": start,
                    "endTime": end,
                    "queryType": panel.query_type,
                    "timeRangeGap": { "seconds": 0, "periodAsStr": "" },
                    "panelQueryIndex": qi,
                }));
                match run_query(
                    org,
                    publisher,
                    &panel.query_type,
                    q,
                    vars,
                    start,
                    end,
                    authorized,
                    unauthorized,
                )
                .await
                {
                    Ok((resp, meta)) => {
                        any_ok = true;
                        data.push(resp);
                        result_meta_data.push(meta);
                    }
                    Err(r) => {
                        reason = r;
                        data.push(serde_json::Value::Null);
                        result_meta_data.push(serde_json::Value::Null);
                    }
                }
            }
            let state = if any_ok {
                PanelState::Ok
            } else {
                PanelState::NotAvailable { reason }
            };
            out.insert(
                panel.id.clone(),
                PanelSnapshot {
                    state,
                    data,
                    result_meta_data,
                    metadata: serde_json::json!({ "queries": queries_meta }),
                },
            );
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
async fn run_query(
    org: &str,
    publisher: &str,
    query_type: &str,
    q: &config::meta::dashboards::v8::Query,
    vars: &BTreeMap<String, serde_json::Value>,
    start: i64,
    end: i64,
    authorized: &mut BTreeSet<String>,
    unauthorized: &mut BTreeSet<String>,
) -> Result<(serde_json::Value, serde_json::Value), String> {
    if query_type == "promql" {
        run_promql(
            org,
            publisher,
            q,
            vars,
            start,
            end,
            authorized,
            unauthorized,
        )
        .await
    } else {
        run_sql(
            org,
            publisher,
            q,
            vars,
            start,
            end,
            authorized,
            unauthorized,
        )
        .await
    }
}

#[allow(clippy::too_many_arguments)]
#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
async fn run_sql(
    org: &str,
    publisher: &str,
    q: &config::meta::dashboards::v8::Query,
    vars: &BTreeMap<String, serde_json::Value>,
    start: i64,
    end: i64,
    authorized: &mut BTreeSet<String>,
    unauthorized: &mut BTreeSet<String>,
) -> Result<(serde_json::Value, serde_json::Value), String> {
    let Some(sql_tmpl) = q.query.as_ref() else {
        return Err("no_query".to_string());
    };
    let sql = substitute_vars(sql_tmpl, vars);
    let stream = q.fields.stream.clone();
    let stream_type = q.fields.stream_type;

    // Explicit per-stream RBAC — `search_service::search` does not enforce it.
    // Enterprise only; OSS has no fine-grained stream perms (org membership is
    // the boundary), so the check is a no-op there.
    #[cfg(feature = "enterprise")]
    {
        use crate::authz::{StreamPermissionResourceType, check_stream_permissions};
        if check_stream_permissions(
            &stream,
            org,
            publisher,
            &stream_type,
            StreamPermissionResourceType::Search,
        )
        .await
        .is_some()
        {
            unauthorized.insert(stream);
            return Err("unauthorized".to_string());
        }
    }
    authorized.insert(stream);

    let req = search::Request {
        query: search::Query {
            sql,
            start_time: start,
            end_time: end,
            // Same as the live panel loader; the default (10) truncated every panel's result.
            size: -1,
            track_total_hits: false,
            ..Default::default()
        },
        use_cache: false,
        ..Default::default()
    };
    match search_service::search(
        &config::ider::generate_trace_id(),
        org,
        stream_type,
        Some(publisher.to_string()),
        &req,
    )
    .await
    {
        Ok(resp) => {
            // Mirror the live loader's shapes: `data[i]` is the hits array and
            // `resultMetaData[i]` is a per-partition array of the response minus hits.
            let mut meta = serde_json::to_value(&resp).unwrap_or_default();
            let hits = meta
                .as_object_mut()
                .and_then(|obj| obj.remove("hits"))
                .unwrap_or_else(|| serde_json::Value::Array(vec![]));
            Ok((hits, serde_json::Value::Array(vec![meta])))
        }
        Err(e) => {
            log::warn!("public dashboard rebuild query failed: {e}");
            Err("query_error".to_string())
        }
    }
}

#[allow(clippy::too_many_arguments)]
#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
async fn run_promql(
    org: &str,
    publisher: &str,
    q: &config::meta::dashboards::v8::Query,
    vars: &BTreeMap<String, serde_json::Value>,
    start: i64,
    end: i64,
    authorized: &mut BTreeSet<String>,
    unauthorized: &mut BTreeSet<String>,
) -> Result<(serde_json::Value, serde_json::Value), String> {
    let Some(expr_tmpl) = q.query.as_ref() else {
        return Err("no_query".to_string());
    };
    let expr = substitute_vars(
        &substitute_vars(expr_tmpl, &promql_fixed_vars(start, end)),
        vars,
    );
    let stream = q.fields.stream.clone();

    // Best-effort RBAC on the declared metric (a PromQL expr may span several
    // metrics; the publisher's own read perms still bound execution).
    #[cfg(feature = "enterprise")]
    if !stream.is_empty() {
        use crate::authz::{StreamPermissionResourceType, check_stream_permissions};
        if check_stream_permissions(
            &stream,
            org,
            publisher,
            &StreamType::Metrics,
            StreamPermissionResourceType::Search,
        )
        .await
        .is_some()
        {
            unauthorized.insert(stream);
            return Err("unauthorized".to_string());
        }
    }
    if !stream.is_empty() {
        authorized.insert(stream);
    }

    let step = ((end - start) / 400).max(1_000_000);
    let req = promql_service::MetricsQueryRequest {
        query: expr,
        start,
        end,
        step,
        query_exemplars: false,
        use_cache: Some(false),
        search_type: Some(config::meta::search::SearchEventType::DerivedStream),
        search_event_context: None,
        regions: vec![],
        clusters: vec![],
    };
    #[cfg(not(feature = "enterprise"))]
    let is_super_cluster = false;
    #[cfg(feature = "enterprise")]
    let is_super_cluster = o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled;
    match promql_service::search::search(
        &config::ider::generate_trace_id(),
        org,
        &req,
        publisher,
        0,
        is_super_cluster,
    )
    .await
    {
        Ok(value) => {
            let data = serde_json::json!({
                "resultType": value.get_type().to_string(),
                "result": value,
            });
            Ok((data, serde_json::Value::Null))
        }
        Err(e) => {
            log::warn!("public dashboard promql rebuild failed: {e}");
            Err("query_error".to_string())
        }
    }
}

/// The Grafana-style `$__interval`/`$__range`/`$__rate_interval` family, so a
/// PromQL panel that uses them still parses. Values are range-derived (no chart
/// width server-side), approximating the client's `replaceQueryValue`.
fn promql_fixed_vars(start: i64, end: i64) -> BTreeMap<String, serde_json::Value> {
    let range_secs = ((end - start) / 1_000_000).max(1);
    let scrape = 15i64;
    let step_secs = (range_secs / 400).max(scrape);
    let rate = (4 * scrape).max(step_secs + scrape);
    let mut m = BTreeMap::new();
    m.insert(
        "__interval".to_string(),
        serde_json::json!(format!("{step_secs}s")),
    );
    m.insert(
        "__interval_ms".to_string(),
        serde_json::json!(format!("{}ms", step_secs * 1000)),
    );
    m.insert(
        "__rate_interval".to_string(),
        serde_json::json!(format!("{rate}s")),
    );
    m.insert(
        "__percentile_interval".to_string(),
        serde_json::json!(format!("{rate}s")),
    );
    m.insert(
        "__range".to_string(),
        serde_json::json!(format!("{range_secs}s")),
    );
    m.insert(
        "__range_s".to_string(),
        serde_json::json!(range_secs.to_string()),
    );
    m.insert(
        "__range_ms".to_string(),
        serde_json::json!((range_secs * 1000).to_string()),
    );
    m
}

/// Substitute captured variables into a saved query. Handles the three dashboard
/// syntaxes (`$name`, `${name}`, `{{name}}`); the bare form is boundary-anchored
/// so `$env` never clobbers `$environment`. List values join comma-separated.
fn substitute_vars(query: &str, vars: &BTreeMap<String, serde_json::Value>) -> String {
    let mut out = query.to_string();
    for (name, value) in vars {
        out = replace_var(out, name, &var_value_to_string(value));
    }
    out
}

fn replace_var(input: String, name: &str, value: &str) -> String {
    let out = input
        .replace(&format!("${{{name}}}"), value)
        .replace(&format!("{{{{{name}}}}}"), value);
    // `\b` (the regex crate has no lookahead) anchors the right edge so `$env`
    // never eats the prefix of `$environment`.
    match Regex::new(&format!(r"\${}\b", regex::escape(name))) {
        Ok(re) => re.replace_all(&out, regex::NoExpand(value)).into_owned(),
        Err(_) => out,
    }
}

fn var_value_to_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .map(var_value_to_string)
            .collect::<Vec<_>>()
            .join(","),
        other => other.to_string(),
    }
}

fn parse_i64_list(json: Option<&str>) -> Vec<i64> {
    json.and_then(|s| serde_json::from_str::<Vec<i64>>(s).ok())
        .unwrap_or_default()
}

fn parse_frozen_vars(json: Option<&str>) -> BTreeMap<String, serde_json::Value> {
    json.and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default()
}

/// Identifiers returned after publishing.
pub struct PublishResult {
    pub id: String,
    pub slug: String,
}

/// Publish a public link for a dashboard: extract its streams, authorize the
/// publisher on each, capture the config, insert the row, register the rebuild
/// trigger, and build the first snapshots synchronously so the link works now.
pub async fn create(
    org: &str,
    dashboard_id: &str,
    cfg: PublicDashboardConfig,
    publisher: &str,
) -> Result<PublishResult, anyhow::Error> {
    let Some((folder, dash)) = dashboards::get_by_id(org, dashboard_id).await? else {
        return Err(anyhow::anyhow!("dashboard not found"));
    };

    // Publish-time authz gate: the publisher must read every referenced stream.
    // Enterprise only; OSS has no fine-grained stream perms (org membership is
    // the boundary).
    #[cfg(feature = "enterprise")]
    {
        use crate::authz::{StreamPermissionResourceType, check_stream_permissions};
        for (stream, stream_type) in extract_streams(&dash) {
            if check_stream_permissions(
                &stream,
                org,
                publisher,
                &stream_type,
                StreamPermissionResourceType::Search,
            )
            .await
            .is_some()
            {
                return Err(anyhow::anyhow!(
                    "publisher lacks read permission on stream {stream}"
                ));
            }
        }
    }

    let id = ider::uuid();
    let slug = gen_unique_slug().await?;
    let now = now_micros();
    let model = PublicDashboard {
        id: id.clone(),
        org_id: org.to_string(),
        folder_id: folder.folder_id.clone(),
        dashboard_id: dashboard_id.to_string(),
        slug: slug.clone(),
        visibility: cfg.visibility.to_i32(),
        time_range_editable: cfg.time_range.editable,
        default_range_secs: cfg.time_range.default_range_secs,
        allowed_presets_secs: Some(serde_json::to_string(&cfg.time_range.allowed_presets_secs)?),
        frozen_variables: Some(serde_json::to_string(&cfg.frozen_variables)?),
        rebuild_secs: cfg.rebuild_secs,
        last_rebuilt_at: None,
        rebuild_state: 0,
        unauthorized_streams: None,
        dashboard_version: dash.version,
        published_by: publisher.to_string(),
        last_authorized_streams: None,
        enabled: true,
        expires_at: cfg.expires_at,
        created_by: publisher.to_string(),
        created_at: now,
        updated_at: now,
        last_accessed_at: None,
        access_count: 0,
    };
    pd_table::insert(&model).await?;
    register_trigger(org, &id, now).await?;
    if let Err(e) = rebuild_one(&model).await {
        log::warn!("public dashboard initial build failed for {id}: {e}");
    }
    Ok(PublishResult { id, slug })
}

pub async fn list(org: &str) -> Result<Vec<PublicDashboard>, anyhow::Error> {
    Ok(pd_table::list(org).await?)
}

pub async fn get(org: &str, dashboard_id: &str) -> Result<Option<PublicDashboard>, anyhow::Error> {
    Ok(pd_table::get_by_dashboard(org, dashboard_id).await?)
}

/// Revoke: delete the share, its snapshots, and its rebuild trigger.
pub async fn delete(org: &str, id: &str) -> Result<bool, anyhow::Error> {
    let existed = pd_table::delete(org, id).await?;
    if existed {
        let _ = db::scheduler::delete(org, db::scheduler::TriggerModule::PublicDashboard, id).await;
    }
    Ok(existed)
}

async fn register_trigger(org: &str, id: &str, next_run_at: i64) -> Result<(), anyhow::Error> {
    let trigger = db::scheduler::Trigger {
        org: org.to_string(),
        module: db::scheduler::TriggerModule::PublicDashboard,
        module_key: id.to_string(),
        next_run_at,
        ..Default::default()
    };
    db::scheduler::push(trigger)
        .await
        .map_err(|e| anyhow::anyhow!("failed to register rebuild trigger: {e}"))
}

/// Reject a publish request the server would otherwise have to rewrite, so the
/// author learns the real cadence instead of it being silently raised.
pub fn validate_config(cfg: &PublicDashboardConfig) -> Result<(), String> {
    check_rebuild_secs(
        cfg.rebuild_secs,
        config::get_config().public_dashboards.min_rebuild_secs,
    )
}

fn check_rebuild_secs(secs: i32, floor: u64) -> Result<(), String> {
    if i64::from(secs) < floor.max(1) as i64 {
        return Err(format!(
            "rebuild_secs must be at least {} seconds",
            floor.max(1)
        ));
    }
    Ok(())
}

async fn gen_unique_slug() -> Result<String, anyhow::Error> {
    for _ in 0..5 {
        let slug = generate_random_string(22);
        if pd_table::get_by_slug_any(&slug).await?.is_none() {
            return Ok(slug);
        }
    }
    Err(anyhow::anyhow!("could not generate a unique slug"))
}

/// The (stream, stream_type) pairs a v8 dashboard's panel queries read.
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
fn extract_streams(dash: &Dashboard) -> Vec<(String, StreamType)> {
    let mut out: Vec<(String, StreamType)> = Vec::new();
    if let Some(v8) = dash.v8.as_ref() {
        for tab in &v8.tabs {
            for panel in &tab.panels {
                for q in &panel.queries {
                    let pair = (q.fields.stream.clone(), q.fields.stream_type);
                    if !q.fields.stream.is_empty() && !out.contains(&pair) {
                        out.push(pair);
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn vars(pairs: &[(&str, serde_json::Value)]) -> BTreeMap<String, serde_json::Value> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn rebuild_secs_below_floor_is_rejected_not_raised() {
        assert!(check_rebuild_secs(10, 10).is_ok());
        assert!(check_rebuild_secs(60, 10).is_ok());
        let err = check_rebuild_secs(5, 10).unwrap_err();
        assert_eq!(err, "rebuild_secs must be at least 10 seconds");
        // A zero floor still refuses a non-positive cadence.
        assert!(check_rebuild_secs(0, 0).is_err());
    }

    #[test]
    fn substitutes_all_three_syntaxes() {
        let v = vars(&[("svc", json!("api"))]);
        assert_eq!(
            substitute_vars("a=$svc b=${svc} c={{svc}}", &v),
            "a=api b=api c=api"
        );
    }

    #[test]
    fn bare_form_respects_word_boundary() {
        let v = vars(&[("env", json!("prod"))]);
        // $env must not eat the prefix of $environment.
        assert_eq!(
            substitute_vars("$env $environment", &v),
            "prod $environment"
        );
    }

    #[test]
    fn bracketed_form_is_not_affected_by_boundary() {
        let v = vars(&[("env", json!("prod"))]);
        assert_eq!(substitute_vars("${env}x ${env}", &v), "prodx prod");
    }

    #[test]
    fn list_value_joins_comma_separated() {
        let v = vars(&[("hosts", json!(["a", "b", "c"]))]);
        assert_eq!(substitute_vars("in (${hosts})", &v), "in (a,b,c)");
    }

    #[test]
    fn dollar_in_value_is_literal_not_capture_reference() {
        // NoExpand: a `$1` inside the replacement must stay literal.
        let v = vars(&[("x", json!("a$1b"))]);
        assert_eq!(substitute_vars("k=$x", &v), "k=a$1b");
    }

    #[test]
    fn missing_variable_is_left_untouched() {
        let v = vars(&[("a", json!("1"))]);
        assert_eq!(
            substitute_vars("$b + ${c} + {{d}}", &v),
            "$b + ${c} + {{d}}"
        );
    }

    #[test]
    fn empty_vars_returns_query_unchanged() {
        let v = BTreeMap::new();
        assert_eq!(
            substitute_vars("select * from t where a=$x", &v),
            "select * from t where a=$x"
        );
    }

    #[test]
    fn var_value_to_string_covers_scalar_null_and_list() {
        assert_eq!(var_value_to_string(&json!("s")), "s");
        assert_eq!(var_value_to_string(&json!(42)), "42");
        assert_eq!(var_value_to_string(&json!(true)), "true");
        assert_eq!(var_value_to_string(&serde_json::Value::Null), "");
        assert_eq!(var_value_to_string(&json!(["a", "b"])), "a,b");
        assert_eq!(var_value_to_string(&json!([1, 2])), "1,2");
    }

    #[test]
    fn parse_i64_list_handles_valid_invalid_and_none() {
        assert_eq!(parse_i64_list(Some("[900,3600]")), vec![900, 3600]);
        assert!(parse_i64_list(Some("not json")).is_empty());
        assert!(parse_i64_list(None).is_empty());
    }

    #[test]
    fn parse_frozen_vars_handles_valid_invalid_and_none() {
        let m = parse_frozen_vars(Some(r#"{"a":"b"}"#));
        assert_eq!(m.get("a").unwrap(), &json!("b"));
        assert!(parse_frozen_vars(Some("garbage")).is_empty());
        assert!(parse_frozen_vars(None).is_empty());
    }

    #[test]
    fn promql_fixed_vars_has_full_family_as_durations() {
        let m = promql_fixed_vars(0, 3600 * 1_000_000);
        for k in [
            "__interval",
            "__interval_ms",
            "__rate_interval",
            "__percentile_interval",
            "__range",
            "__range_s",
            "__range_ms",
        ] {
            assert!(m.contains_key(k), "missing {k}");
        }
        assert!(m["__interval"].as_str().unwrap().ends_with('s'));
    }

    #[test]
    fn promql_fixed_vars_short_range_floors_step_to_scrape() {
        // A 200s range (< 400 * scrape) floors the step to the 15s scrape interval.
        let m = promql_fixed_vars(0, 200 * 1_000_000);
        assert_eq!(m["__interval"], json!("15s"));
        assert_eq!(m["__range_s"], json!("200"));
        assert_eq!(m["__range_ms"], json!("200000"));
    }
}
