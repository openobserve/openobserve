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

//! Public dashboard links: CRUD with compare-and-set revisions and soft delete, validation, and
//! the panel build that runs each saved query server-side, checked against the publisher's access.

mod defaults;
mod variables;

use std::collections::{BTreeMap, BTreeSet};

use config::{
    get_config, ider,
    meta::{
        dashboards::Dashboard,
        public_dashboards::{
            MAX_REFRESH_SECS, MIN_REFRESH_SECS, NotAvailableReason, PanelResult, PanelState,
            PublicDashboardConfig, PublicLinkState, PublicLinkStatus, PublicVariable, ResultBody,
            TimeRange, TimeRangePolicy, Window,
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
use defaults::{Defaults, ValuesQuery};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::{
        dashboards,
        entity::{
            public_dashboard_org_settings::Model as OrgSettings,
            public_dashboards::Model as PublicDashboard,
        },
        public_dashboards::{self as pd_table, CreateOutcome},
    },
};
use variables::{PanelVars, QueryVars};

const MAX_RANGES: usize = 10;
const MIN_RANGE_SECS: i64 = 60;
const MAX_RANGE_SECS: i64 = 365 * 86_400;
const MAX_FROZEN_VARIABLES_BYTES: usize = 64 * 1024;
/// A lost compare-and-set re-reads and re-applies the edit at most this many times.
const EDIT_ATTEMPTS: usize = 5;
/// Refusal for a dashboard the build can't render; the admin API maps it to 400.
pub const OLDER_FORMAT_ERROR: &str =
    "This dashboard uses an older format. Open it and save it once, then publish.";
pub const LINK_NOT_FOUND: &str = "public link not found";

/// Search-response fields the renderer reads; SQL, VRL errors and trace ids stay private.
const PUBLIC_META_FIELDS: [&str; 6] = [
    "histogram_interval",
    "total",
    "is_partial",
    "order_by",
    "new_start_time",
    "new_end_time",
];

/// A request the admin API refuses with 400 and this message.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct Invalid(pub String);

/// Identifiers returned after publishing.
pub struct PublishResult {
    pub id: String,
    pub slug: String,
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
    pub refresh_secs: i32,
    pub expires_at: Option<i64>,
    pub published_by: String,
    pub updated_by: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_accessed_at: Option<i64>,
    pub access_count: i64,
}

/// Builds one range's panels from the captured link and dashboard; nothing is stored here.
pub async fn build_one(
    link: &PublicDashboard,
    dash: &Dashboard,
    range: &TimeRange,
    now: i64,
) -> ResultBody {
    let scrape = db::organization::get_org_setting(&link.org_id)
        .await
        .ok()
        .map(|s| f64::from(s.scrape_interval));
    let (start, end) = range.window(now);
    let mut authorized: BTreeSet<String> = BTreeSet::new();
    let mut unauthorized: BTreeSet<String> = BTreeSet::new();
    let values = fill_defaults(
        &link.org_id,
        &link.published_by,
        dash,
        parse_frozen_vars(link.frozen_variables.as_deref()),
        start,
        end,
        &mut authorized,
        &mut unauthorized,
    )
    .await;
    let variables = PublicVariable::list(dash, &values);
    let vars = QueryVars::new(dash, values, scrape);
    let mut panels = build_panels(
        &link.org_id,
        &link.published_by,
        dash,
        &vars,
        start,
        end,
        &mut authorized,
        &mut unauthorized,
    )
    .await;
    for panel in panels.values_mut() {
        if matches!(panel.state, PanelState::Ok { .. }) {
            panel.built_at = Some(now);
        }
    }
    ResultBody { panels, variables }
}

/// Publish a link; it runs no query until someone opens it.
pub async fn create(
    org: &str,
    dashboard_id: &str,
    cfg: PublicDashboardConfig,
    publisher: &str,
) -> Result<PublishResult, anyhow::Error> {
    let Some((folder, dash)) = dashboards::get_by_id(org, dashboard_id).await? else {
        return Err(anyhow::anyhow!("dashboard not found"));
    };
    check_format(&dash)?;
    let now = now_micros();
    validate_dashboard(&dash, &cfg.frozen_variables, now).map_err(Invalid)?;

    let db = get_orm_client_rw().await;
    let org_max = org_link_limit(pd_table::get_settings(db, org).await?.as_ref());
    let dashboard_max = get_config().public_dashboards.max_links_per_dashboard;
    let id = ider::uuid();
    let slug = gen_unique_slug().await?;
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
        refresh_secs: cfg.refresh_secs,
        dashboard_version: dash.version,
        published_by: publisher.to_string(),
        enabled: true,
        expires_at: cfg.expires_at,
        created_by: publisher.to_string(),
        updated_by: None,
        created_at: now,
        updated_at: now,
        rev: now,
        deleted_at: None,
        last_accessed_at: None,
        access_count: 0,
    };
    match pd_table::insert_capped(db, &model, org_max, dashboard_max).await? {
        CreateOutcome::Created => Ok(PublishResult { id, slug }),
        CreateOutcome::OrgFull => Err(Invalid(format!(
            "This organization has reached its limit of {org_max} public links. Revoke one to add another."
        ))
        .into()),
        CreateOutcome::DashboardFull => Err(Invalid(format!(
            "This dashboard has reached its limit of {dashboard_max} public links. Revoke one to add another."
        ))
        .into()),
    }
}

pub async fn list(org: &str) -> Result<Vec<PublicDashboard>, anyhow::Error> {
    Ok(pd_table::list(get_orm_client_ro().await, org).await?)
}

pub async fn list_for_dashboard(
    org: &str,
    dashboard_id: &str,
) -> Result<Vec<PublicDashboard>, anyhow::Error> {
    Ok(pd_table::list_by_dashboard(get_orm_client_ro().await, org, dashboard_id).await?)
}

/// Attach each link's dashboard title, current folder and lifecycle status, with one dashboard
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
            let status = PublicLinkStatus::derive(
                &PublicLinkState {
                    dashboard_exists: label.is_some(),
                    enabled: link.enabled,
                    expires_at: link.expires_at,
                    access_count: link.access_count,
                },
                now,
            );
            PublicLinkView {
                dashboard_title: label.map(|l| l.title.clone()),
                folder_id: label.map(|l| l.folder_id.clone()),
                folder_name: label.map(|l| l.folder_name.clone()),
                status,
                enabled: link.enabled,
                time_range: time_ranges(&link),
                frozen_variables: parse_frozen_vars(link.frozen_variables.as_deref()),
                refresh_secs: link.refresh_secs,
                expires_at: link.expires_at,
                published_by: link.published_by,
                updated_by: link.updated_by,
                created_at: link.created_at,
                updated_at: link.updated_at,
                last_accessed_at: link.last_accessed_at,
                access_count: link.access_count,
                id: link.id,
                name: link.name,
                slug: link.slug,
                dashboard_id: link.dashboard_id,
            }
        })
        .collect())
}

/// A live link only when it belongs to both this org and this dashboard, so an id from another
/// dashboard can't be reached by editing the URL. Read from the primary, as every edit starts here.
pub async fn get_link(
    org: &str,
    dashboard_id: &str,
    id: &str,
) -> Result<Option<PublicDashboard>, anyhow::Error> {
    Ok(pd_table::get_on_dashboard(get_orm_client_rw().await, org, dashboard_id, id).await?)
}

/// Replace a link's settings in place; its slug never changes.
pub async fn update_link(
    link: PublicDashboard,
    cfg: PublicDashboardConfig,
    user_id: &str,
) -> Result<PublicDashboard, anyhow::Error> {
    let dash = current_dashboard(&link.org_id, &link.dashboard_id).await?;
    let now = now_micros();
    validate_dashboard(&dash, &cfg.frozen_variables, now).map_err(Invalid)?;
    // The Enterprise editor stream check for changed frozen variables (design 6.3) belongs here.
    let ranges = serde_json::to_string(&cfg.time_range.ranges)?;
    let frozen = serde_json::to_string(&cfg.frozen_variables)?;
    edit(&link.org_id, &link.id, |l| {
        l.updated_by = Some(user_id.to_string());
        l.name = cfg.name.trim().to_string();
        l.visibility = cfg.visibility.to_i32();
        l.time_ranges = Some(ranges.clone());
        l.default_range_key = Some(cfg.time_range.default.key());
        l.frozen_variables = Some(frozen.clone());
        l.refresh_secs = cfg.refresh_secs;
        l.expires_at = cfg.expires_at;
        l.updated_at = now;
        Ok(())
    })
    .await
}

/// Stop serving; the slug and settings are kept.
pub async fn pause_link(
    link: PublicDashboard,
    user_id: &str,
) -> Result<PublicDashboard, anyhow::Error> {
    set_paused(&link, Some(user_id.to_string())).await
}

/// Whether the publisher has left the link's org; a failed lookup isn't treated as leaving.
pub async fn publisher_left(link: &PublicDashboard) -> bool {
    if db::user::is_root_user(&link.published_by) {
        return false;
    }
    matches!(
        infra::table::org_users::get_optional(&link.org_id, &link.published_by).await,
        Ok(None)
    )
}

/// Pause a link whose publisher left the org; the queries ran with that person's access.
pub async fn pause_for_departed_publisher(link: PublicDashboard) -> Result<(), anyhow::Error> {
    let updated_by = link.updated_by.clone();
    set_paused(&link, updated_by).await.map(|_| ())
}

/// Serve again at the same address; the next view builds.
pub async fn resume_link(
    link: PublicDashboard,
    user_id: &str,
) -> Result<PublicDashboard, anyhow::Error> {
    let now = now_micros();
    if is_expired(link.expires_at, now) {
        return Err(Invalid(
            "this link has expired; extend its expiry date to bring it back".to_string(),
        )
        .into());
    }
    current_dashboard(&link.org_id, &link.dashboard_id).await?;
    edit(&link.org_id, &link.id, |l| {
        l.enabled = true;
        l.updated_by = Some(user_id.to_string());
        l.updated_at = now;
        Ok(())
    })
    .await
}

/// Make every result of the link due on its next view; runs no query.
pub async fn refresh_now(link: PublicDashboard) -> Result<PublicDashboard, anyhow::Error> {
    if !link.enabled {
        return Err(Invalid("resume this link before refreshing it".to_string()).into());
    }
    if is_expired(link.expires_at, now_micros()) {
        return Err(Invalid(
            "this link has expired; extend its expiry date to bring it back".to_string(),
        )
        .into());
    }
    edit(&link.org_id, &link.id, |_| Ok(())).await
}

/// Revoke: soft-delete the link, so its slug stays reserved and replicas cannot revive it.
pub async fn delete(org: &str, id: &str) -> Result<bool, anyhow::Error> {
    let now = now_micros();
    match edit(org, id, |l| {
        l.deleted_at = Some(now);
        Ok(())
    })
    .await
    {
        Ok(_) => Ok(true),
        Err(e) if e.to_string() == LINK_NOT_FOUND => Ok(false),
        Err(e) => Err(e),
    }
}

/// Revoke every link on a dashboard; called when the dashboard is deleted.
pub async fn revoke_all_for_dashboard(org: &str, dashboard_id: &str) -> Result<(), anyhow::Error> {
    for link in pd_table::list_by_dashboard(get_orm_client_rw().await, org, dashboard_id).await? {
        delete(org, &link.id).await?;
    }
    Ok(())
}

/// Revoke every link in an org; called by org cleanup.
pub async fn revoke_all_for_org(org: &str) -> Result<(), anyhow::Error> {
    for link in pd_table::list(get_orm_client_rw().await, org).await? {
        delete(org, &link.id).await?;
    }
    Ok(())
}

/// Hard-delete links whose 30-day soft-delete memory has run out.
pub async fn purge_deleted() -> Result<u64, anyhow::Error> {
    let before = now_micros() - pd_table::DELETED_RETENTION_MICROS;
    Ok(pd_table::purge_deleted(get_orm_client_rw().await, before).await?)
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

/// The dashboard as a link would show it: at most `MAX_PANELS` panels across every tab, and no
/// SQL panel with an explicit LIMIT above the default row cap.
pub fn validate_dashboard(
    dash: &Dashboard,
    frozen: &BTreeMap<String, serde_json::Value>,
    now: i64,
) -> Result<(), String> {
    let cfg = get_config();
    let Some(v8) = dash.v8.as_ref() else {
        return Ok(());
    };
    let panels: Vec<_> = v8
        .tabs
        .iter()
        .flat_map(|tab| tab.panels.iter().map(move |panel| (tab, panel)))
        .collect();
    let max = cfg.public_dashboards.max_panels as usize;
    if panels.len() > max {
        return Err(format!(
            "This dashboard has {} panels; a public link can show at most {max}.",
            panels.len()
        ));
    }
    let cap = cfg.limit.query_default_limit;
    let vars = QueryVars::new(dash, frozen.clone(), None);
    let (start, end) = (now - 3_600_000_000, now);
    for (tab, panel) in panels {
        if panel.query_type == "promql" || panel.typ == "custom_chart" {
            continue;
        }
        let panel_vars = vars.for_panel(&tab.tab_id, &panel.id);
        let over = panel
            .queries
            .iter()
            .filter_map(|q| q.query.as_deref())
            .filter_map(|sql| explicit_limit(&panel_vars.substitute(sql, "sql", start, end)))
            .find(|n| *n > cap);
        if let Some(n) = over {
            return Err(format!(
                "Panel \"{}\" has LIMIT {n}, above the public cap of {cap} rows. Lower it or aggregate.",
                panel.title
            ));
        }
    }
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

/// Applies `change` to the live row and writes it with a compare-and-set on rev; a lost race
/// re-reads the row and applies the change again.
async fn edit<F>(org: &str, id: &str, mut change: F) -> Result<PublicDashboard, anyhow::Error>
where
    F: FnMut(&mut PublicDashboard) -> Result<(), anyhow::Error>,
{
    let db = get_orm_client_rw().await;
    for _ in 0..EDIT_ATTEMPTS {
        let Some(mut row) = pd_table::get(db, id)
            .await?
            .filter(|l| l.org_id == org && l.deleted_at.is_none())
        else {
            return Err(anyhow::anyhow!(LINK_NOT_FOUND));
        };
        let seen = row.rev;
        change(&mut row)?;
        row.rev = pd_table::next_rev(seen, now_micros());
        if pd_table::update_cas(db, &row, seen).await? {
            return Ok(row);
        }
    }
    Err(anyhow::anyhow!(
        "the public link kept changing while saving; try again"
    ))
}

async fn set_paused(
    link: &PublicDashboard,
    updated_by: Option<String>,
) -> Result<PublicDashboard, anyhow::Error> {
    let now = now_micros();
    edit(&link.org_id, &link.id, |l| {
        l.enabled = false;
        l.updated_by = updated_by.clone();
        l.updated_at = now;
        Ok(())
    })
    .await
}

/// The org's link limit: its settings row's, never above the env limit.
fn org_link_limit(settings: Option<&OrgSettings>) -> u32 {
    let env = get_config().public_dashboards.max_links_per_org;
    settings
        .and_then(|s| s.max_links)
        .map_or(env, |max| u32::try_from(max).unwrap_or(0).min(env))
}

/// The outermost explicit LIMIT of a SQL query; None without one or when it does not parse.
fn explicit_limit(sql: &str) -> Option<i64> {
    use sqlparser::{
        ast::{Expr, LimitClause, Statement, Value, ValueWithSpan},
        dialect::PostgreSqlDialect,
        parser::Parser,
    };
    let sql = replace_o2_custom_patterns(sql).unwrap_or_else(|_| sql.to_string());
    let Statement::Query(query) = Parser::parse_sql(&PostgreSqlDialect {}, &sql).ok()?.pop()?
    else {
        return None;
    };
    let LimitClause::LimitOffset {
        limit:
            Some(Expr::Value(ValueWithSpan {
                value: Value::Number(n, _),
                ..
            })),
        ..
    } = query.limit_clause?
    else {
        return None;
    };
    n.parse().ok()
}

/// Runs every v8 panel's queries for one window; a non-v8 dashboard yields no panels.
#[allow(clippy::too_many_arguments)]
async fn build_panels(
    org: &str,
    publisher: &str,
    dash: &Dashboard,
    vars: &QueryVars,
    start: i64,
    end: i64,
    authorized: &mut BTreeSet<String>,
    unauthorized: &mut BTreeSet<String>,
) -> BTreeMap<String, PanelResult> {
    let mut out = BTreeMap::new();
    let Some(v8) = dash.v8.as_ref() else {
        return out;
    };
    // Collected up front: an iterator adapter held across the awaits below isn't Send.
    let panels: Vec<_> = v8
        .tabs
        .iter()
        .flat_map(|tab| tab.panels.iter().map(move |panel| (tab, panel)))
        .collect();
    for (tab, panel) in panels {
        // A custom chart runs the author's JavaScript in the viewer's origin, so it is never
        // public.
        if panel.typ == "custom_chart" {
            out.insert(
                panel.id.clone(),
                PanelResult::not_available(NotAvailableReason::Unsupported),
            );
            continue;
        }
        let is_promql = panel.query_type == "promql";
        let panel_vars = vars.for_panel(&tab.tab_id, &panel.id);
        let mut results = Vec::with_capacity(panel.queries.len());
        let mut failure = None;
        for q in &panel.queries {
            match run_query(
                org,
                publisher,
                &panel.query_type,
                q,
                &panel_vars,
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
        out.insert(
            panel.id.clone(),
            panel_result(&panel.query_type, start, end, results, failure),
        );
    }
    out
}

/// SQL needs every query; PromQL needs one, with the rest served as empty results.
fn panel_result(
    query_type: &str,
    start: i64,
    end: i64,
    results: Vec<Option<(serde_json::Value, serde_json::Value)>>,
    failure: Option<NotAvailableReason>,
) -> PanelResult {
    let is_promql = query_type == "promql";
    let any_ok = results.iter().any(Option::is_some);
    if !any_ok || (!is_promql && failure.is_some()) {
        return PanelResult::not_available(failure.unwrap_or(NotAvailableReason::NoQuery));
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
    PanelResult {
        state: PanelState::ok(),
        intent: String::new(),
        built_at: None,
        window: Some(Window { start, end }),
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
    vars: &PanelVars,
    start: i64,
    end: i64,
    authorized: &mut BTreeSet<String>,
    unauthorized: &mut BTreeSet<String>,
) -> Result<(serde_json::Value, serde_json::Value), NotAvailableReason> {
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
    vars: &PanelVars,
    start: i64,
    end: i64,
    authorized: &mut BTreeSet<String>,
    unauthorized: &mut BTreeSet<String>,
) -> Result<(serde_json::Value, serde_json::Value), NotAvailableReason> {
    let Some(sql_tmpl) = q.query.as_ref() else {
        return Err(NotAvailableReason::NoQuery);
    };
    let sql = vars.substitute(sql_tmpl, "sql", start, end);
    let stream_type = q.fields.stream_type;
    let target = (q.fields.stream_type, q.fields.stream.as_str());
    authorize_query(
        org,
        publisher,
        "sql",
        &sql,
        target,
        authorized,
        unauthorized,
    )
    .await?;

    let req = sql_request(sql, start, end, q.vrl_function_query.as_deref());
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
            log::warn!("public dashboard panel query failed: {e}");
            Err(NotAvailableReason::BuildError)
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
    vars: &PanelVars,
    start: i64,
    end: i64,
    authorized: &mut BTreeSet<String>,
    unauthorized: &mut BTreeSet<String>,
) -> Result<(serde_json::Value, serde_json::Value), NotAvailableReason> {
    let Some(expr_tmpl) = q.query.as_ref() else {
        return Err(NotAvailableReason::NoQuery);
    };
    let expr = vars.substitute(expr_tmpl, "promql", start, end);
    let target = (q.fields.stream_type, q.fields.stream.as_str());
    authorize_query(
        org,
        publisher,
        "promql",
        &expr,
        target,
        authorized,
        unauthorized,
    )
    .await?;

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
        Ok(resp) => {
            let data = serde_json::json!({
                "resultType": resp.value.get_type().to_string(),
                "result": resp.value,
            });
            Ok((data, serde_json::Value::Null))
        }
        Err(e) => {
            log::warn!("public dashboard promql query failed: {e}");
            Err(NotAvailableReason::BuildError)
        }
    }
}

/// The search a SQL panel query runs, with the panel's VRL function applied as on the live panel.
fn sql_request(sql: String, start: i64, end: i64, vrl: Option<&str>) -> search::Request {
    search::Request {
        query: search::Query {
            sql,
            start_time: start,
            end_time: end,
            // Same as the live panel loader; the default (10) truncated every panel's result.
            size: -1,
            track_total_hits: false,
            // Stored as plain text; search() expects it decoded, unlike the HTTP API.
            query_fn: vrl
                .map(str::trim)
                .filter(|f| !f.is_empty())
                .map(str::to_string),
            ..Default::default()
        },
        use_cache: false,
        ..Default::default()
    }
}

/// The link's values, each missing one picked as the live dashboard would for this window.
#[allow(clippy::too_many_arguments)]
async fn fill_defaults(
    org: &str,
    publisher: &str,
    dash: &Dashboard,
    frozen: BTreeMap<String, serde_json::Value>,
    start: i64,
    end: i64,
    authorized: &mut BTreeSet<String>,
    unauthorized: &mut BTreeSet<String>,
) -> BTreeMap<String, serde_json::Value> {
    let mut defaults = Defaults::new(dash, frozen);
    while let Some(pending) = defaults.next_query() {
        let keys = run_values(
            org,
            publisher,
            &pending.query,
            start,
            end,
            authorized,
            unauthorized,
        )
        .await;
        defaults.settle(pending, keys);
    }
    defaults.into_values()
}

/// A picker's values query run as the publisher; None when it is denied or fails, as on the page.
#[allow(clippy::too_many_arguments)]
async fn run_values(
    org: &str,
    publisher: &str,
    q: &ValuesQuery,
    start: i64,
    end: i64,
    authorized: &mut BTreeSet<String>,
    unauthorized: &mut BTreeSet<String>,
) -> Option<Vec<String>> {
    let target = (q.stream_type, q.stream.as_str());
    authorize_query(
        org,
        publisher,
        "sql",
        &q.sql,
        target,
        authorized,
        unauthorized,
    )
    .await
    .ok()?;
    let req = search::Request {
        query: search::Query {
            sql: q.sql.clone(),
            start_time: start,
            end_time: end,
            size: q.size,
            track_total_hits: false,
            ..Default::default()
        },
        use_cache: false,
        ..Default::default()
    };
    match search_service::search(
        &ider::generate_trace_id(),
        org,
        q.stream_type,
        Some(publisher.to_string()),
        &req,
    )
    .await
    {
        Ok(resp) => Some(
            resp.hits
                .iter()
                .filter_map(|hit| hit.get("zo_sql_key"))
                .filter(|key| !key.is_null())
                .map(variables::js_string)
                .collect(),
        ),
        Err(e) => {
            log::warn!("public dashboard variable values query failed: {e}");
            None
        }
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
    target: (StreamType, &str),
    authorized: &mut BTreeSet<String>,
    unauthorized: &mut BTreeSet<String>,
) -> Result<(), NotAvailableReason> {
    #[cfg(feature = "enterprise")]
    {
        use crate::authz::{
            StreamPermissionResourceType, check_cipher_key_permissions, check_stream_permissions,
        };
        // An unreadable query can't be proven safe, so it is withheld rather than run.
        let streams = query_streams(query_type, text, target.0)
            .map_err(|_| NotAvailableReason::Unauthorized)?;
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
                return Err(NotAvailableReason::Unauthorized);
            }
        }
        if query_type != "promql"
            && check_cipher_key_permissions(org, user_id, text)
                .await
                .is_some()
        {
            return Err(NotAvailableReason::Unauthorized);
        }
        authorized.extend(streams.into_iter().map(|(stream, _)| stream));
    }
    #[cfg(not(feature = "enterprise"))]
    if !target.1.is_empty() {
        authorized.insert(target.1.to_string());
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

async fn current_dashboard(org: &str, dashboard_id: &str) -> Result<Dashboard, anyhow::Error> {
    let Some((_folder, dash)) = dashboards::get_by_id(org, dashboard_id).await? else {
        return Err(anyhow::anyhow!("dashboard not found"));
    };
    check_format(&dash)?;
    Ok(dash)
}

fn validate_limits(cfg: &PublicDashboardConfig, now: i64) -> Result<(), String> {
    check_refresh_secs(cfg.refresh_secs)?;
    let name = cfg.name.trim();
    if name.is_empty() {
        return Err("name is required".to_string());
    }
    if name.chars().count() > 256 {
        return Err("name must be at most 256 characters".to_string());
    }
    check_ranges(&cfg.time_range, now)?;
    let vars_len = serde_json::to_string(&cfg.frozen_variables).map_or(0, |s| s.len());
    if vars_len > MAX_FROZEN_VARIABLES_BYTES {
        return Err("frozen variables must be at most 64 KB".to_string());
    }
    Ok(())
}

fn check_ranges(tr: &TimeRangePolicy, now: i64) -> Result<(), String> {
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
        check_range(range, now)?;
    }
    Ok(())
}

fn check_range(range: &TimeRange, now: i64) -> Result<(), String> {
    match range {
        TimeRange::Relative { secs } if *secs < MIN_RANGE_SECS => {
            return Err("a relative time range must be at least 1 minute".to_string());
        }
        TimeRange::Relative { secs } if *secs % 60 != 0 => {
            return Err("a relative time range must be a whole number of minutes".to_string());
        }
        TimeRange::Absolute { start, .. } if *start < 0 => {
            return Err("an absolute time range can't start before 1970".to_string());
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

// Range floors and the operator minimum apply at read and build time, never at save.
fn check_refresh_secs(secs: i32) -> Result<(), String> {
    if !(MIN_REFRESH_SECS..=MAX_REFRESH_SECS).contains(&secs) {
        return Err("refresh_secs must be between 60 seconds and 30 days".to_string());
    }
    Ok(())
}

fn check_expiry(expires_at: Option<i64>, now: i64) -> Result<(), String> {
    if is_expired(expires_at, now) {
        return Err("expiry must be in the future".to_string());
    }
    Ok(())
}

fn is_expired(expires_at: Option<i64>, now: i64) -> bool {
    expires_at.is_some_and(|exp| exp <= now)
}

// The build only renders v8 panels, so an older dashboard would publish as an empty page.
fn check_format(dash: &Dashboard) -> Result<(), anyhow::Error> {
    if dash.v8.is_none() {
        return Err(Invalid(OLDER_FORMAT_ERROR.to_string()).into());
    }
    Ok(())
}

async fn gen_unique_slug() -> Result<String, anyhow::Error> {
    for _ in 0..5 {
        let slug = generate_random_string(22);
        if pd_table::get_by_slug(get_orm_client_rw().await, &slug)
            .await?
            .is_none()
        {
            return Ok(slug);
        }
    }
    Err(anyhow::anyhow!("could not generate a unique slug"))
}

#[cfg(test)]
mod tests {
    use config::meta::public_dashboards::Visibility;
    use serde_json::json;

    use super::*;

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
    fn a_link_expires_at_its_expiry_instant() {
        assert!(!is_expired(None, 100));
        assert!(!is_expired(Some(101), 100));
        assert!(is_expired(Some(100), 100));
        assert!(is_expired(Some(5), 100));
    }

    #[test]
    fn only_a_v8_dashboard_can_be_published() {
        let old = Dashboard {
            version: 3,
            ..Default::default()
        };
        let err = check_format(&old).unwrap_err();
        assert_eq!(err.to_string(), OLDER_FORMAT_ERROR);
        assert!(err.downcast_ref::<Invalid>().is_some());
        let current = Dashboard {
            version: 8,
            v8: Some(Default::default()),
            ..Default::default()
        };
        assert!(check_format(&current).is_ok());
    }

    #[test]
    fn refresh_secs_is_one_minute_to_thirty_days() {
        assert!(check_refresh_secs(60).is_ok());
        assert!(check_refresh_secs(300).is_ok());
        assert!(check_refresh_secs(30 * 86_400).is_ok());
        assert_eq!(
            check_refresh_secs(59).unwrap_err(),
            "refresh_secs must be between 60 seconds and 30 days"
        );
        assert!(check_refresh_secs(30 * 86_400 + 1).is_err());
        assert!(check_refresh_secs(-5).is_err());
    }

    #[test]
    fn sql_request_carries_the_panel_vrl_function() {
        let req = sql_request("SELECT 1".to_string(), 10, 20, Some("  del(.email)\n "));
        assert_eq!(req.query.query_fn.as_deref(), Some("del(.email)"));
        assert_eq!((req.query.start_time, req.query.end_time), (10, 20));
        assert_eq!(req.query.size, -1);
        assert!(
            sql_request("SELECT 1".to_string(), 0, 1, None)
                .query
                .query_fn
                .is_none()
        );
        assert!(
            sql_request("SELECT 1".to_string(), 0, 1, Some("  "))
                .query
                .query_fn
                .is_none()
        );
    }

    #[test]
    fn parse_frozen_vars_handles_valid_invalid_and_none() {
        let m = parse_frozen_vars(Some(r#"{"a":"b"}"#));
        assert_eq!(m.get("a").unwrap(), &json!("b"));
        assert!(parse_frozen_vars(Some("garbage")).is_empty());
        assert!(parse_frozen_vars(None).is_empty());
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
    fn panel_result_sql_needs_every_query() {
        let ok = |n: i64| Some((json!([{ "n": n }]), json!({ "took": n })));

        let all = panel_result("sql", 1, 2, vec![ok(1), ok(2)], None);
        assert_eq!(all.state, PanelState::ok());
        assert_eq!(all.window, Some(Window { start: 1, end: 2 }));
        assert_eq!(all.data, [json!([{ "n": 1 }]), json!([{ "n": 2 }])]);
        assert_eq!(all.metadata["queries"][1]["panelQueryIndex"], json!(1));

        let denied = panel_result(
            "sql",
            1,
            2,
            vec![ok(1)],
            Some(NotAvailableReason::Unauthorized),
        );
        assert_eq!(
            denied.state,
            PanelState::NotAvailable {
                reason: NotAvailableReason::Unauthorized
            }
        );
        assert!(denied.data.is_empty() && denied.result_meta_data.is_empty());

        let none = panel_result("sql", 1, 2, vec![], None);
        assert_eq!(
            none.state,
            PanelState::NotAvailable {
                reason: NotAvailableReason::NoQuery
            }
        );
    }

    #[test]
    fn panel_result_promql_serves_the_queries_that_ran() {
        let hit = json!({ "resultType": "matrix", "result": [1] });
        let ok = Some((hit.clone(), json!(null)));
        let empty = json!({ "resultType": "matrix", "result": [] });

        let partial = panel_result(
            "promql",
            1,
            2,
            vec![None, ok],
            Some(NotAvailableReason::Unauthorized),
        );
        assert_eq!(partial.state, PanelState::ok());
        assert_eq!(partial.data[0], empty);
        assert_eq!(partial.data[1], hit);
        assert_eq!(partial.metadata["queries"].as_array().unwrap().len(), 2);

        let all_failed = panel_result(
            "promql",
            1,
            2,
            vec![None, None],
            Some(NotAvailableReason::BuildError),
        );
        assert_eq!(
            all_failed.state,
            PanelState::NotAvailable {
                reason: NotAvailableReason::BuildError
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
        assert!(check_ranges(&tr(vec![rel(60), rel(3600)], rel(3600)), 0).is_ok());
        assert!(check_ranges(&tr(vec![], rel(3600)), 0).is_err());
        let eleven = (1..=11).map(|i| rel(i * 60)).collect();
        assert!(check_ranges(&tr(eleven, rel(60)), 0).is_err());
        assert!(check_ranges(&tr(vec![rel(60), rel(60)], rel(60)), 0).is_err());
        assert_eq!(
            check_ranges(&tr(vec![rel(60)], rel(3600)), 0).unwrap_err(),
            "the default time range must be one of the time ranges"
        );
    }

    #[test]
    fn each_range_is_checked_by_type() {
        let now = 1_000 * 86_400 * 1_000_000;
        let abs = |start: i64, end: i64| TimeRange::Absolute { start, end };
        let day = 86_400 * 1_000_000;
        assert!(check_range(&rel(30), now).is_err());
        assert!(check_range(&rel(120), now).is_ok());
        assert_eq!(
            check_range(&rel(61), now).unwrap_err(),
            "a relative time range must be a whole number of minutes"
        );
        assert!(check_range(&rel(365 * 86_400), now).is_ok());
        assert!(check_range(&rel(366 * 86_400), now).is_err());
        assert!(check_range(&rel(90 * 86_400), now).is_ok());
        assert!(check_range(&abs(now - 365 * day, now), now).is_ok());
        assert!(check_range(&abs(now - 366 * day, now), now).is_err());
        assert!(check_range(&abs(now, now - day), now).is_err());
        assert!(check_range(&abs(0, day), now).is_ok());
        assert_eq!(
            check_range(&abs(-1, day), now).unwrap_err(),
            "an absolute time range can't start before 1970"
        );
        assert_eq!(
            check_range(&abs(now - day, now + 1), now).unwrap_err(),
            "an absolute time range must end in the past"
        );
    }

    fn cfg(name: &str, refresh_secs: i32) -> PublicDashboardConfig {
        PublicDashboardConfig {
            name: name.to_string(),
            visibility: Visibility::Public,
            time_range: TimeRangePolicy {
                ranges: vec![rel(3600)],
                default: rel(3600),
            },
            frozen_variables: BTreeMap::new(),
            refresh_secs,
            expires_at: None,
        }
    }

    #[test]
    fn name_is_required_and_capped() {
        assert_eq!(
            validate_limits(&cfg("   ", 300), 0).unwrap_err(),
            "name is required"
        );
        assert!(validate_limits(&cfg(&"x".repeat(257), 300), 0).is_err());
        assert!(validate_limits(&cfg("NOC wall", 300), 0).is_ok());
    }

    #[test]
    fn a_range_floor_above_the_selection_is_not_refused_at_save() {
        let mut long = cfg("wall", 60);
        long.time_range = TimeRangePolicy {
            ranges: vec![rel(30 * 86_400)],
            default: rel(30 * 86_400),
        };
        assert!(validate_limits(&long, 0).is_ok());
        assert!(validate_limits(&cfg("wall", 30), 0).is_err());
    }

    #[test]
    fn the_org_limit_comes_from_settings_but_never_exceeds_the_env() {
        let row = |max_links| OrgSettings {
            org_id: "o".into(),
            rev: 1,
            enabled: true,
            max_links,
            updated_at: 1,
            updated_by: "a".into(),
        };
        assert_eq!(org_link_limit(None), 50);
        assert_eq!(org_link_limit(Some(&row(None))), 50);
        assert_eq!(org_link_limit(Some(&row(Some(3)))), 3);
        assert_eq!(org_link_limit(Some(&row(Some(80)))), 50);
        assert_eq!(org_link_limit(Some(&row(Some(-1)))), 0);
    }

    #[test]
    fn explicit_limit_reads_only_the_outermost_numeric_limit() {
        assert_eq!(explicit_limit("SELECT * FROM t LIMIT 50000"), Some(50_000));
        assert_eq!(
            explicit_limit("SELECT * FROM (SELECT * FROM t LIMIT 9) LIMIT 20 OFFSET 5"),
            Some(20)
        );
        assert_eq!(
            explicit_limit("SELECT * FROM (SELECT * FROM t LIMIT 9)"),
            None
        );
        assert_eq!(explicit_limit("SELECT * FROM t"), None);
        assert_eq!(explicit_limit("SELEC * FRM"), None);
    }

    fn panel(id: &str, sql: Option<&str>) -> serde_json::Value {
        let queries = sql.map_or_else(Vec::new, |sql| {
            vec![json!({
                "query": sql, "customQuery": true,
                "fields": { "stream": "s", "stream_type": "logs", "x": [], "y": [],
                            "filter": { "filterType": "group", "logicalOperator": "AND", "conditions": [] } },
                "config": { "promql_legend": "" }
            })]
        });
        json!({
            "id": id, "type": "table", "title": format!("Panel {id}"), "description": "",
            "config": { "show_legends": false, "legends_position": null },
            "queries": queries
        })
    }

    fn dashboard(tabs: Vec<Vec<serde_json::Value>>) -> Dashboard {
        let tabs: Vec<_> = tabs
            .into_iter()
            .enumerate()
            .map(|(i, panels)| json!({ "tabId": format!("t{i}"), "name": "", "panels": panels }))
            .collect();
        Dashboard {
            version: 8,
            v8: Some(serde_json::from_value(json!({ "tabs": tabs })).unwrap()),
            ..Default::default()
        }
    }

    #[test]
    fn panels_are_counted_across_every_tab() {
        let ten: Vec<_> = (0..10).map(|i| panel(&format!("p{i}"), None)).collect();
        let frozen = BTreeMap::new();
        assert!(validate_dashboard(&dashboard(vec![ten.clone()]), &frozen, 0).is_ok());
        let four: Vec<_> = (10..14).map(|i| panel(&format!("p{i}"), None)).collect();
        assert_eq!(
            validate_dashboard(&dashboard(vec![ten, four]), &frozen, 0).unwrap_err(),
            "This dashboard has 14 panels; a public link can show at most 10."
        );
    }

    #[test]
    fn a_limit_above_the_default_is_refused_naming_the_panel() {
        let frozen = BTreeMap::new();
        let ok = dashboard(vec![vec![panel("a", Some("SELECT * FROM s LIMIT 1000"))]]);
        assert!(validate_dashboard(&ok, &frozen, 0).is_ok());
        let big = dashboard(vec![
            vec![panel("a", Some("SELECT * FROM s"))],
            vec![panel("b", Some("SELECT * FROM s LIMIT 50000"))],
        ]);
        assert_eq!(
            validate_dashboard(&big, &frozen, 0).unwrap_err(),
            "Panel \"Panel b\" has LIMIT 50000, above the public cap of 1000 rows. Lower it or aggregate."
        );
    }
}
