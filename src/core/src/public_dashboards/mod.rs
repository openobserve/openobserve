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
        public_dashboards::{
            PanelSnapshot, PanelState, PublicDashboardConfig, PublicLinkState, PublicLinkStatus,
            SnapshotData, TimeRange, TimeRangePolicy,
        },
        search,
        sql::{TableReferenceExt, resolve_stream_names_with_type},
        stream::StreamType,
    },
    utils::{
        query_select_utils::replace_o2_custom_patterns, rand::generate_random_string,
        time::now_micros,
    },
};
use infra::table::{
    dashboards, entity::public_dashboards::Model as PublicDashboard, public_dashboards as pd_table,
};
use regex::Regex;

const REBUILD_STATE_OK: i32 = 1;
const REBUILD_STATE_ERROR: i32 = 2;
const MAX_RANGES: usize = 10;
const MIN_RANGE_SECS: i64 = 60;
const MAX_RANGE_SECS: i64 = 365 * 86_400;
/// A relative range longer than this re-queries a lot of data, so it needs a slow refresh.
const LONG_RANGE_SECS: i64 = 30 * 86_400;
const LONG_RANGE_MIN_REFRESH_SECS: i32 = 3600;
/// How often a link of only absolute ranges is checked for expiry and a departed publisher.
const ABSOLUTE_CHECK_SECS: i64 = 86_400;
const MAX_FROZEN_VARIABLES_BYTES: usize = 64 * 1024;

/// Search-response fields the renderer reads; SQL, VRL errors and trace ids stay private.
const PUBLIC_META_FIELDS: [&str; 6] = [
    "histogram_interval",
    "total",
    "is_partial",
    "order_by",
    "new_start_time",
    "new_end_time",
];

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

    // An absolute range is built once, then again only after the link changes.
    let built: BTreeMap<String, i64> = pd_table::list_snapshot_keys(conn, &pd.id)
        .await?
        .into_iter()
        .collect();
    let due: Vec<TimeRange> = time_ranges(pd)
        .ranges
        .into_iter()
        .filter(|r| r.is_relative() || built.get(&r.key()).is_none_or(|at| *at < pd.updated_at))
        .collect();
    if due.is_empty() {
        return Ok(());
    }

    let vars = parse_frozen_vars(pd.frozen_variables.as_deref());
    let mut authorized: BTreeSet<String> = BTreeSet::new();
    let mut unauthorized: BTreeSet<String> = BTreeSet::new();

    for range in &due {
        let (start, end) = range.window(now);
        let panels = build_panels(
            &pd.org_id,
            &pd.published_by,
            &dash,
            &vars,
            start,
            end,
            &mut authorized,
            &mut unauthorized,
        )
        .await;
        let json = serde_json::to_string(&SnapshotData {
            panels,
            built_at: now,
        })?;
        pd_table::upsert_snapshot(conn, &pd.id, &range.key(), &json, now).await?;
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

/// A link's ranges and default; a default no range matches falls back to the first range.
pub fn time_ranges(link: &PublicDashboard) -> TimeRangePolicy {
    let ranges: Vec<TimeRange> = link
        .time_ranges
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let default = ranges
        .iter()
        .find(|r| link.default_range_key.as_deref() == Some(r.key().as_str()))
        .or(ranges.first())
        .copied()
        .unwrap_or(TimeRange::Relative { secs: 3600 });
    TimeRangePolicy { ranges, default }
}

/// When a link of only absolute ranges is next checked: daily, or at expiry if that is sooner.
pub fn next_absolute_check(expires_at: Option<i64>, now: i64) -> i64 {
    let daily = now + ABSOLUTE_CHECK_SECS * 1_000_000;
    expires_at.map_or(daily, |exp| daily.min(exp.max(now)))
}

/// Enumerate v8 panels → queries and materialize each. Non-v8 dashboards are
/// not supported in this cut (they yield an empty panel set).
#[allow(clippy::too_many_arguments)]
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
    for panel in v8.tabs.iter().flat_map(|tab| &tab.panels) {
        // A custom chart runs the author's JavaScript in the viewer's origin, so it is never
        // public.
        if panel.typ == "custom_chart" {
            let snapshot = panel_snapshot(
                &panel.query_type,
                start,
                end,
                Vec::new(),
                Some("unsupported".to_string()),
            );
            out.insert(panel.id.clone(), snapshot);
            continue;
        }
        let is_promql = panel.query_type == "promql";
        let mut results = Vec::with_capacity(panel.queries.len());
        let mut failure = None;
        for q in &panel.queries {
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
                Ok(result) => results.push(Some(result)),
                // As on the live dashboard: SQL is one request, PromQL queries are independent.
                Err(reason) => {
                    failure = Some(reason);
                    if !is_promql {
                        break;
                    }
                    results.push(None);
                }
            }
        }
        let snapshot = panel_snapshot(&panel.query_type, start, end, results, failure);
        out.insert(panel.id.clone(), snapshot);
    }
    out
}

/// SQL needs every query; PromQL needs one, with the rest stored as empty results.
fn panel_snapshot(
    query_type: &str,
    start: i64,
    end: i64,
    results: Vec<Option<(serde_json::Value, serde_json::Value)>>,
    failure: Option<String>,
) -> PanelSnapshot {
    let is_promql = query_type == "promql";
    let any_ok = results.iter().any(Option::is_some);
    if !any_ok || (!is_promql && failure.is_some()) {
        return PanelSnapshot {
            state: PanelState::NotAvailable {
                reason: failure.unwrap_or_else(|| "no_query".to_string()),
            },
            data: Vec::new(),
            result_meta_data: Vec::new(),
            metadata: serde_json::Value::Null,
        };
    }
    // Same per-query metadata the live loader builds for an unshifted query.
    let queries_meta = (0..results.len())
        .map(|qi| {
            serde_json::json!({
                "startTime": start,
                "endTime": end,
                "queryType": query_type,
                "timeRangeGap": { "seconds": 0, "periodAsStr": "" },
                "panelQueryIndex": qi,
            })
        })
        .collect::<Vec<_>>();
    // An empty matrix, not null, since the PromQL converter reads `.result` on every entry.
    let (data, result_meta_data) = results
        .into_iter()
        .map(|r| {
            r.unwrap_or_else(|| {
                (
                    serde_json::json!({ "resultType": "matrix", "result": [] }),
                    serde_json::Value::Null,
                )
            })
        })
        .unzip();
    PanelSnapshot {
        state: PanelState::Ok,
        data,
        result_meta_data,
        metadata: serde_json::json!({ "queries": queries_meta }),
    }
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
    let stream_type = q.fields.stream_type;
    authorize_query(org, publisher, "sql", &sql, q, authorized, unauthorized).await?;

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
            let mut full = serde_json::to_value(&resp).unwrap_or_default();
            let hits = full
                .as_object_mut()
                .and_then(|obj| obj.remove("hits"))
                .unwrap_or_else(|| serde_json::Value::Array(vec![]));
            Ok((hits, serde_json::Value::Array(vec![public_meta(&full)])))
        }
        Err(e) => {
            log::warn!("public dashboard rebuild query failed: {e}");
            Err("query_error".to_string())
        }
    }
}

fn public_meta(full: &serde_json::Value) -> serde_json::Value {
    let kept = PUBLIC_META_FIELDS
        .iter()
        .filter_map(|&k| full.get(k).map(|v| (k.to_string(), v.clone())))
        .collect();
    serde_json::Value::Object(kept)
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
    authorize_query(org, publisher, "promql", &expr, q, authorized, unauthorized).await?;

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

fn parse_frozen_vars(json: Option<&str>) -> BTreeMap<String, serde_json::Value> {
    json.and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default()
}

/// Checks every stream the final query reads, since SQL and PromQL can read beyond the picked one.
#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
async fn authorize_query(
    org: &str,
    user_id: &str,
    query_type: &str,
    text: &str,
    q: &config::meta::dashboards::v8::Query,
    authorized: &mut BTreeSet<String>,
    unauthorized: &mut BTreeSet<String>,
) -> Result<(), String> {
    #[cfg(feature = "enterprise")]
    {
        use crate::authz::{
            StreamPermissionResourceType, check_cipher_key_permissions, check_stream_permissions,
        };
        // An unreadable query can't be proven safe, so it is withheld rather than run.
        let streams = query_streams(query_type, text, q.fields.stream_type)
            .map_err(|_| "unauthorized".to_string())?;
        for (stream, stream_type) in &streams {
            let denied = check_stream_permissions(
                stream,
                org,
                user_id,
                stream_type,
                StreamPermissionResourceType::Search,
            )
            .await
            .is_some();
            if denied {
                unauthorized.insert(stream.clone());
                return Err("unauthorized".to_string());
            }
        }
        if query_type != "promql"
            && check_cipher_key_permissions(org, user_id, text)
                .await
                .is_some()
        {
            return Err("unauthorized".to_string());
        }
        authorized.extend(streams.into_iter().map(|(stream, _)| stream));
    }
    #[cfg(not(feature = "enterprise"))]
    if !q.fields.stream.is_empty() {
        authorized.insert(q.fields.stream.clone());
    }
    Ok(())
}

/// The distinct streams a SQL or PromQL query reads; an unqualified table takes `default_type`.
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
fn query_streams(
    query_type: &str,
    text: &str,
    default_type: StreamType,
) -> Result<Vec<(String, StreamType)>, String> {
    let mut out: Vec<(String, StreamType)> = Vec::new();
    if query_type == "promql" {
        let ast = promql_parser::parser::parse(text).map_err(|e| e.to_string())?;
        let mut visitor = promql::ast::name_visitor::MetricNameVisitor::default();
        promql::ast::visitor::walk_expr(&mut visitor, &ast).map_err(|e| e.to_string())?;
        let mut names: Vec<String> = visitor.into_names().into_iter().collect();
        names.sort();
        out.extend(names.into_iter().map(|n| (n, StreamType::Metrics)));
        return Ok(out);
    }
    let sql = replace_o2_custom_patterns(text).unwrap_or_else(|_| text.to_string());
    for table in resolve_stream_names_with_type(&sql).map_err(|e| e.to_string())? {
        let pair = (table.stream_name(), table.get_stream_type(default_type));
        if !out.contains(&pair) {
            out.push(pair);
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

/// Identifiers returned after publishing.
pub struct PublishResult {
    pub id: String,
    pub slug: String,
}

/// Publish a link; the rebuild withholds panels on streams the publisher can't read.
pub async fn create(
    org: &str,
    dashboard_id: &str,
    cfg: PublicDashboardConfig,
    publisher: &str,
) -> Result<PublishResult, anyhow::Error> {
    let Some((folder, dash)) = dashboards::get_by_id(org, dashboard_id).await? else {
        return Err(anyhow::anyhow!("dashboard not found"));
    };

    let id = ider::uuid();
    let slug = gen_unique_slug().await?;
    let now = now_micros();
    let model = PublicDashboard {
        id: id.clone(),
        org_id: org.to_string(),
        folder_id: folder.folder_id.clone(),
        dashboard_id: dashboard_id.to_string(),
        slug: slug.clone(),
        name: cfg.name.trim().to_string(),
        visibility: cfg.visibility.to_i32(),
        time_ranges: Some(serde_json::to_string(&cfg.time_range.ranges)?),
        default_range_key: Some(cfg.time_range.default.key()),
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
        updated_by: None,
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

pub async fn list_for_dashboard(
    org: &str,
    dashboard_id: &str,
) -> Result<Vec<PublicDashboard>, anyhow::Error> {
    Ok(pd_table::list_by_dashboard(org, dashboard_id).await?)
}

/// A link as the admin API returns it; the slug is a bearer secret for authenticated routes only.
#[derive(Clone, Debug, serde::Serialize)]
pub struct PublicLinkView {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub dashboard_id: String,
    pub dashboard_title: Option<String>,
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub status: PublicLinkStatus,
    pub enabled: bool,
    pub time_range: TimeRangePolicy,
    pub frozen_variables: BTreeMap<String, serde_json::Value>,
    pub rebuild_secs: i32,
    pub last_rebuilt_at: Option<i64>,
    pub rebuild_state: i32,
    pub expires_at: Option<i64>,
    pub published_by: String,
    pub updated_by: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Attach each link's dashboard title, current folder and derived status, with one dashboard
/// lookup.
pub async fn views(
    org: &str,
    links: Vec<PublicDashboard>,
) -> Result<Vec<PublicLinkView>, anyhow::Error> {
    let ids: Vec<String> = links
        .iter()
        .map(|l| l.dashboard_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let labels = dashboards::labels_by_ids(org, &ids).await?;
    let now = now_micros();
    Ok(links
        .into_iter()
        .map(|link| {
            let label = labels.get(&link.dashboard_id);
            let time_range = time_ranges(&link);
            let status = PublicLinkStatus::derive(
                &PublicLinkState {
                    dashboard_exists: label.is_some(),
                    enabled: link.enabled,
                    expires_at: link.expires_at,
                    last_rebuilt_at: link.last_rebuilt_at,
                    rebuild_failed: link.rebuild_state == REBUILD_STATE_ERROR,
                    rebuild_secs: link.rebuild_secs,
                    has_relative: time_range.has_relative(),
                },
                now,
            );
            PublicLinkView {
                dashboard_title: label.map(|l| l.title.clone()),
                folder_id: label.map(|l| l.folder_id.clone()),
                folder_name: label.map(|l| l.folder_name.clone()),
                status,
                enabled: link.enabled,
                time_range,
                frozen_variables: parse_frozen_vars(link.frozen_variables.as_deref()),
                rebuild_secs: link.rebuild_secs,
                last_rebuilt_at: link.last_rebuilt_at,
                rebuild_state: link.rebuild_state,
                expires_at: link.expires_at,
                published_by: link.published_by,
                updated_by: link.updated_by,
                created_at: link.created_at,
                updated_at: link.updated_at,
                id: link.id,
                name: link.name,
                slug: link.slug,
                dashboard_id: link.dashboard_id,
            }
        })
        .collect())
}

/// A link only when it belongs to both this org and this dashboard, so an id from
/// another dashboard can't be reached by editing the URL.
pub async fn get_link(
    org: &str,
    dashboard_id: &str,
    id: &str,
) -> Result<Option<PublicDashboard>, anyhow::Error> {
    Ok(pd_table::get_on_dashboard(org, dashboard_id, id).await?)
}

/// Replace a link's settings in place; its slug never changes.
pub async fn update_link(
    mut link: PublicDashboard,
    cfg: PublicDashboardConfig,
    user_id: &str,
) -> Result<PublicDashboard, anyhow::Error> {
    link.updated_by = Some(user_id.to_string());
    link.name = cfg.name.trim().to_string();
    link.time_ranges = Some(serde_json::to_string(&cfg.time_range.ranges)?);
    link.default_range_key = Some(cfg.time_range.default.key());
    link.frozen_variables = Some(serde_json::to_string(&cfg.frozen_variables)?);
    link.rebuild_secs = cfg.rebuild_secs;
    link.expires_at = cfg.expires_at;
    link.updated_at = now_micros();
    pd_table::update(&link).await?;

    let keep: Vec<String> = cfg.time_range.ranges.iter().map(TimeRange::key).collect();
    pd_table::prune_snapshots(infra::db::get_orm_client_rw().await, &link.id, &keep).await?;
    if link.enabled {
        restart_rebuilds(&link).await?;
    }
    Ok(link)
}

/// Stop serving and rebuilding; the slug, settings and snapshots are kept.
pub async fn pause_link(
    link: PublicDashboard,
    user_id: &str,
) -> Result<PublicDashboard, anyhow::Error> {
    set_paused(link, Some(user_id.to_string())).await
}

/// Whether the publisher has left the link's org; a failed lookup isn't treated as leaving.
pub async fn publisher_left(link: &PublicDashboard) -> bool {
    if db::user::is_root_user(&link.published_by) {
        return false;
    }
    matches!(
        infra::table::org_users::is_member(&link.org_id, &link.published_by).await,
        Ok(false)
    )
}

/// Pause a link whose publisher left the org; the queries ran with that person's access.
pub async fn pause_for_departed_publisher(link: PublicDashboard) -> Result<(), anyhow::Error> {
    let updated_by = link.updated_by.clone();
    set_paused(link, updated_by).await.map(|_| ())
}

async fn set_paused(
    mut link: PublicDashboard,
    updated_by: Option<String>,
) -> Result<PublicDashboard, anyhow::Error> {
    link.enabled = false;
    link.updated_by = updated_by;
    link.updated_at = now_micros();
    pd_table::update(&link).await?;
    let _ = db::scheduler::delete(
        &link.org_id,
        db::scheduler::TriggerModule::PublicDashboard,
        &link.id,
    )
    .await;
    Ok(link)
}

/// Serve and rebuild again at the same address, with a fresh build straight away.
pub async fn resume_link(
    mut link: PublicDashboard,
    user_id: &str,
) -> Result<PublicDashboard, anyhow::Error> {
    if link.expires_at.is_some_and(|exp| exp <= now_micros()) {
        return Err(anyhow::anyhow!(
            "this link has expired; extend its expiry date to bring it back"
        ));
    }
    link.enabled = true;
    link.updated_by = Some(user_id.to_string());
    link.updated_at = now_micros();
    pd_table::update(&link).await?;
    restart_rebuilds(&link).await?;
    Ok(link)
}

/// Build a link's absolute ranges again, picking up dashboard edits and late data.
pub async fn rebuild_now(
    mut link: PublicDashboard,
    user_id: &str,
) -> Result<PublicDashboard, anyhow::Error> {
    if time_ranges(&link).ranges.iter().all(TimeRange::is_relative) {
        return Err(anyhow::anyhow!(
            "this link has no absolute time range; relative ranges rebuild on their own"
        ));
    }
    if !link.enabled {
        return Err(anyhow::anyhow!("resume this link before rebuilding it"));
    }
    link.updated_by = Some(user_id.to_string());
    link.updated_at = now_micros();
    pd_table::update(&link).await?;
    restart_rebuilds(&link).await?;
    Ok(link)
}

/// Revoke: delete the share, its snapshots, and its rebuild trigger.
pub async fn delete(org: &str, id: &str) -> Result<bool, anyhow::Error> {
    let existed = pd_table::delete(org, id).await?;
    if existed {
        let _ = db::scheduler::delete(org, db::scheduler::TriggerModule::PublicDashboard, id).await;
    }
    Ok(existed)
}

/// Revoke every link on a dashboard; called when the dashboard is deleted.
pub async fn revoke_all_for_dashboard(org: &str, dashboard_id: &str) -> Result<(), anyhow::Error> {
    for link in pd_table::list_by_dashboard(org, dashboard_id).await? {
        delete(org, &link.id).await?;
    }
    Ok(())
}

/// Revoke every link in an org; called by org cleanup.
pub async fn revoke_all_for_org(org: &str) -> Result<(), anyhow::Error> {
    for link in pd_table::list(org).await? {
        delete(org, &link.id).await?;
    }
    Ok(())
}

/// Replace the link's trigger with one due now and build synchronously, so edits and
/// resumes show fresh data at once instead of after the next cadence tick.
async fn restart_rebuilds(link: &PublicDashboard) -> Result<(), anyhow::Error> {
    let _ = db::scheduler::delete(
        &link.org_id,
        db::scheduler::TriggerModule::PublicDashboard,
        &link.id,
    )
    .await;
    let now = now_micros();
    register_trigger(&link.org_id, &link.id, now).await?;
    if let Err(e) = rebuild_one(link).await {
        log::warn!(
            "public dashboard rebuild after change failed for {}: {e}",
            link.id
        );
    }
    Ok(())
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

/// Reject a create request the server would otherwise have to rewrite or store unbounded.
pub fn validate_config(cfg: &PublicDashboardConfig) -> Result<(), String> {
    let now = now_micros();
    check_expiry(cfg.expires_at, now)?;
    validate_limits(cfg, now)
}

/// An edit that keeps an expired link's date is allowed, so only a changed expiry must be in the
/// future.
pub fn validate_edit(cfg: &PublicDashboardConfig, link: &PublicDashboard) -> Result<(), String> {
    let now = now_micros();
    if cfg.expires_at != link.expires_at {
        check_expiry(cfg.expires_at, now)?;
    }
    validate_limits(cfg, now)
}

fn validate_limits(cfg: &PublicDashboardConfig, now: i64) -> Result<(), String> {
    check_rebuild_secs(cfg.rebuild_secs)?;
    let name = cfg.name.trim();
    if name.is_empty() {
        return Err("name is required".to_string());
    }
    if name.chars().count() > 256 {
        return Err("name must be at most 256 characters".to_string());
    }
    check_ranges(&cfg.time_range, cfg.rebuild_secs, now)?;
    let vars_len = serde_json::to_string(&cfg.frozen_variables).map_or(0, |s| s.len());
    if vars_len > MAX_FROZEN_VARIABLES_BYTES {
        return Err("frozen variables must be at most 64 KB".to_string());
    }
    Ok(())
}

fn check_ranges(tr: &TimeRangePolicy, rebuild_secs: i32, now: i64) -> Result<(), String> {
    if tr.ranges.is_empty() {
        return Err("at least one time range is required".to_string());
    }
    if tr.ranges.len() > MAX_RANGES {
        return Err(format!("at most {MAX_RANGES} time ranges are allowed"));
    }
    let keys: BTreeSet<String> = tr.ranges.iter().map(TimeRange::key).collect();
    if keys.len() != tr.ranges.len() {
        return Err("each time range can be listed only once".to_string());
    }
    if !keys.contains(&tr.default.key()) {
        return Err("the default time range must be one of the time ranges".to_string());
    }
    for range in &tr.ranges {
        check_range(range, rebuild_secs, now)?;
    }
    Ok(())
}

fn check_range(range: &TimeRange, rebuild_secs: i32, now: i64) -> Result<(), String> {
    match range {
        TimeRange::Relative { secs } if *secs < MIN_RANGE_SECS => {
            return Err("a relative time range must be at least 1 minute".to_string());
        }
        TimeRange::Relative { secs }
            if *secs > LONG_RANGE_SECS && rebuild_secs < LONG_RANGE_MIN_REFRESH_SECS =>
        {
            return Err(
                "time ranges longer than 30 days need a refresh of at least 1 hour".to_string(),
            );
        }
        TimeRange::Absolute { start, end } if start >= end => {
            return Err("an absolute time range must start before it ends".to_string());
        }
        TimeRange::Absolute { end, .. } if *end > now => {
            return Err("an absolute time range must end in the past".to_string());
        }
        _ => {}
    }
    if range.length_secs() > MAX_RANGE_SECS {
        return Err("time ranges can be at most 365 days".to_string());
    }
    Ok(())
}

// A zero or negative cadence would reschedule the trigger in a tight loop.
fn check_rebuild_secs(secs: i32) -> Result<(), String> {
    if secs < 1 {
        return Err("rebuild_secs must be at least 1 second".to_string());
    }
    Ok(())
}

fn check_expiry(expires_at: Option<i64>, now: i64) -> Result<(), String> {
    if expires_at.is_some_and(|exp| exp <= now) {
        return Err("expiry must be in the future".to_string());
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
    fn expiry_must_be_in_the_future() {
        assert!(check_expiry(None, 100).is_ok());
        assert!(check_expiry(Some(101), 100).is_ok());
        assert_eq!(
            check_expiry(Some(100), 100).unwrap_err(),
            "expiry must be in the future"
        );
    }

    #[test]
    fn rebuild_secs_must_be_positive() {
        assert!(check_rebuild_secs(1).is_ok());
        assert!(check_rebuild_secs(5).is_ok());
        assert_eq!(
            check_rebuild_secs(0).unwrap_err(),
            "rebuild_secs must be at least 1 second"
        );
        assert!(check_rebuild_secs(-5).is_err());
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
    fn next_absolute_check_is_daily_or_at_expiry() {
        let day = ABSOLUTE_CHECK_SECS * 1_000_000;
        assert_eq!(next_absolute_check(None, 10), 10 + day);
        assert_eq!(next_absolute_check(Some(500), 10), 500);
        assert_eq!(next_absolute_check(Some(5), 10), 10);
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

    fn names(streams: Vec<(String, StreamType)>) -> Vec<String> {
        streams.into_iter().map(|(s, _)| s).collect()
    }

    #[test]
    fn query_streams_reads_every_stream_the_sql_touches() {
        let sql = r#"WITH x AS (SELECT * FROM "b") SELECT a.k FROM "a" a JOIN "c" c ON a.k = c.k
            WHERE a.k IN (SELECT k FROM "d") UNION ALL SELECT k FROM x"#;
        let got = names(query_streams("sql", sql, StreamType::Logs).unwrap());
        assert_eq!(got, ["a", "b", "c", "d"]);
    }

    #[test]
    fn query_streams_takes_the_type_from_a_qualified_table() {
        let got = query_streams(
            "sql",
            r#"SELECT * FROM "metrics"."cpu" JOIN "e" ON true"#,
            StreamType::Logs,
        )
        .unwrap();
        assert_eq!(
            got,
            [
                ("cpu".to_string(), StreamType::Metrics),
                ("e".to_string(), StreamType::Logs)
            ]
        );
    }

    #[test]
    fn query_streams_reads_every_promql_metric() {
        let got = query_streams(
            "promql",
            "sum(rate(errors_total[5m])) / sum(rate(requests_total[5m]))",
            StreamType::Logs,
        )
        .unwrap();
        assert_eq!(
            got,
            [
                ("errors_total".to_string(), StreamType::Metrics),
                ("requests_total".to_string(), StreamType::Metrics)
            ]
        );
    }

    #[test]
    fn query_streams_rejects_what_it_cant_tie_to_a_stream() {
        assert!(query_streams("promql", r#"{job="x"}"#, StreamType::Logs).is_err());
        assert!(query_streams("sql", "SELEC * FRM", StreamType::Logs).is_err());
    }

    #[test]
    fn panel_snapshot_sql_needs_every_query() {
        let ok = |n: i64| Some((json!([{ "n": n }]), json!({ "took": n })));

        let all = panel_snapshot("sql", 1, 2, vec![ok(1), ok(2)], None);
        assert_eq!(all.state, PanelState::Ok);
        assert_eq!(all.data, [json!([{ "n": 1 }]), json!([{ "n": 2 }])]);
        assert_eq!(all.metadata["queries"][1]["panelQueryIndex"], json!(1));

        let partial = panel_snapshot("sql", 1, 2, vec![ok(1)], Some("unauthorized".into()));
        assert_eq!(
            partial.state,
            PanelState::NotAvailable {
                reason: "unauthorized".into()
            }
        );
        assert!(partial.data.is_empty() && partial.result_meta_data.is_empty());

        let none = panel_snapshot("sql", 1, 2, vec![], None);
        assert_eq!(
            none.state,
            PanelState::NotAvailable {
                reason: "no_query".into()
            }
        );
    }

    #[test]
    fn panel_snapshot_promql_serves_the_queries_that_ran() {
        let hit = json!({ "resultType": "matrix", "result": [1] });
        let ok = Some((hit.clone(), json!(null)));
        let empty = json!({ "resultType": "matrix", "result": [] });

        let partial = panel_snapshot("promql", 1, 2, vec![None, ok], Some("unauthorized".into()));
        assert_eq!(partial.state, PanelState::Ok);
        assert_eq!(partial.data[0], empty);
        assert_eq!(partial.data[1], hit);
        assert_eq!(partial.metadata["queries"].as_array().unwrap().len(), 2);

        let all_failed = panel_snapshot(
            "promql",
            1,
            2,
            vec![None, None],
            Some("unauthorized".into()),
        );
        assert_eq!(
            all_failed.state,
            PanelState::NotAvailable {
                reason: "unauthorized".into()
            }
        );
    }

    #[test]
    fn public_meta_keeps_only_renderer_fields() {
        let full = json!({
            "histogram_interval": 60,
            "total": 3,
            "converted_histogram_query": "SELECT secret FROM s",
            "function_error": ["vrl leak"],
            "trace_id": "abc",
        });
        assert_eq!(
            public_meta(&full),
            json!({ "histogram_interval": 60, "total": 3 })
        );
    }

    fn rel(secs: i64) -> TimeRange {
        TimeRange::Relative { secs }
    }

    #[test]
    fn ranges_are_capped_in_count_and_unique_with_a_listed_default() {
        let tr = |ranges: Vec<TimeRange>, default: TimeRange| TimeRangePolicy { ranges, default };
        assert!(check_ranges(&tr(vec![rel(60), rel(3600)], rel(3600)), 60, 0).is_ok());
        assert!(check_ranges(&tr(vec![], rel(3600)), 60, 0).is_err());
        let eleven = (1..=11).map(|i| rel(i * 60)).collect();
        assert!(check_ranges(&tr(eleven, rel(60)), 60, 0).is_err());
        assert!(check_ranges(&tr(vec![rel(60), rel(60)], rel(60)), 60, 0).is_err());
        assert_eq!(
            check_ranges(&tr(vec![rel(60)], rel(3600)), 60, 0).unwrap_err(),
            "the default time range must be one of the time ranges"
        );
    }

    #[test]
    fn each_range_is_checked_by_type() {
        let now = 1_000 * 86_400 * 1_000_000;
        let abs = |start: i64, end: i64| TimeRange::Absolute { start, end };
        let day = 86_400 * 1_000_000;
        assert!(check_range(&rel(30), 60, now).is_err());
        assert!(check_range(&rel(365 * 86_400), 3600, now).is_ok());
        assert!(check_range(&rel(366 * 86_400), 3600, now).is_err());
        assert_eq!(
            check_range(&rel(31 * 86_400), 60, now).unwrap_err(),
            "time ranges longer than 30 days need a refresh of at least 1 hour"
        );
        assert!(check_range(&abs(now - 365 * day, now), 60, now).is_ok());
        assert!(check_range(&abs(now - 366 * day, now), 60, now).is_err());
        assert!(check_range(&abs(now, now - day), 60, now).is_err());
        assert_eq!(
            check_range(&abs(now - day, now + 1), 60, now).unwrap_err(),
            "an absolute time range must end in the past"
        );
    }

    #[test]
    fn name_is_required_and_capped() {
        let cfg = |name: &str| PublicDashboardConfig {
            name: name.to_string(),
            visibility: Default::default(),
            time_range: TimeRangePolicy {
                ranges: vec![rel(3600)],
                default: rel(3600),
            },
            frozen_variables: BTreeMap::new(),
            rebuild_secs: 3600,
            expires_at: None,
        };
        assert_eq!(
            validate_limits(&cfg("   "), 0).unwrap_err(),
            "name is required"
        );
        assert!(validate_limits(&cfg(&"x".repeat(257)), 0).is_err());
        assert!(validate_limits(&cfg("NOC wall"), 0).is_ok());
    }
}
