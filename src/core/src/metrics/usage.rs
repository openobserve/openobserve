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

//! Where a metric is used: a scan of an org's dashboards, alerts, SLOs and pipelines.

use std::collections::{HashMap, HashSet};

use config::meta::{
    alerts::{
        QueryType,
        alert::{Alert, ListAlertsParams},
    },
    dashboards::{Dashboard, ListDashboardsParams},
    folder::Folder,
    pipeline::{Pipeline, components::PipelineSource},
    slo::{CountSource, QueryLanguage, SliConfig, Slo},
    sql::resolve_stream_names,
    stream::StreamType,
};
use promql::{ast::visitor::walk_expr, utils::metric_name};
use promql_parser::{parser::Expr, util::ExprVisitor};
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;

use crate::{
    alerts::alert::is_alert_permitted, dashboards::is_dashboard_permitted,
    pipeline::is_user_pipeline_visible,
};

/// Stands in for a template token in a range, where only a duration parses.
const RANGE_PLACEHOLDER: &str = "1m";
const VALUE_PLACEHOLDER: &str = "__o2_var__";
const SCALAR_PLACEHOLDER: &str = "1";

/// How an object was matched when no query referencing the metric could be parsed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MatchKind {
    Text,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct DashboardUsage {
    pub id: String,
    pub title: String,
    pub folder_id: String,
    #[serde(rename = "match", skip_serializing_if = "Option::is_none")]
    pub match_kind: Option<MatchKind>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct AlertUsage {
    pub id: String,
    pub name: String,
    pub folder_id: String,
    #[serde(rename = "match", skip_serializing_if = "Option::is_none")]
    pub match_kind: Option<MatchKind>,
}

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ObjectUsage {
    pub id: String,
    pub name: String,
    #[serde(rename = "match", skip_serializing_if = "Option::is_none")]
    pub match_kind: Option<MatchKind>,
}

/// The objects that use a metric, and how many of their queries could not be parsed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, ToSchema)]
pub struct MetricUsage {
    pub dashboards: Vec<DashboardUsage>,
    pub alerts: Vec<AlertUsage>,
    pub slos: Vec<ObjectUsage>,
    pub pipelines: Vec<ObjectUsage>,
    pub unparsed: usize,
}

#[derive(Default)]
struct UsageSources {
    dashboards: Vec<(Folder, Dashboard)>,
    alerts: Vec<(Folder, Alert)>,
    slos: Vec<Slo>,
    pipelines: Vec<Pipeline>,
}

impl UsageSources {
    fn dashboard_folders(&self) -> HashSet<String> {
        self.dashboards
            .iter()
            .map(|(folder, _)| folder.folder_id.clone())
            .collect()
    }

    /// SLOs live in alert folders.
    fn alert_folders(&self) -> HashSet<String> {
        self.alerts
            .iter()
            .map(|(folder, _)| folder.folder_id.clone())
            .chain(self.slos.iter().map(|slo| slo.folder_id.clone()))
            .collect()
    }
}

/// A folder as the list endpoints see it: `list` gates it, `get` admits all it holds.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct FolderAccess {
    list: bool,
    get: bool,
}

/// What the caller may list, gathered once per request; `None` grants mean no per-object filter.
#[derive(Debug, Default)]
struct Access {
    dashboard_folders: HashMap<String, FolderAccess>,
    alert_folders: HashMap<String, FolderAccess>,
    dashboards: Option<Vec<String>>,
    alerts: Option<Vec<String>>,
    pipelines_listable: bool,
    pipelines: Option<Vec<String>>,
}

impl Access {
    fn dashboard_folder(&self, folder_id: &str) -> FolderAccess {
        self.dashboard_folders
            .get(folder_id)
            .copied()
            .unwrap_or_default()
    }

    fn alert_folder(&self, folder_id: &str) -> FolderAccess {
        self.alert_folders
            .get(folder_id)
            .copied()
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Match,
    NoMatch,
    Unparsed { text: bool },
}

#[derive(Debug, Default)]
struct Hits {
    parsed: bool,
    text: bool,
    unparsed: usize,
}

impl Hits {
    fn add(&mut self, outcome: Outcome) {
        match outcome {
            Outcome::Match => self.parsed = true,
            Outcome::NoMatch => {}
            Outcome::Unparsed { text: true } => {
                self.unparsed += 1;
                self.text = true;
            }
            Outcome::Unparsed { text: false } => {}
        }
    }

    /// `None` when the object is not listed; otherwise how it is listed.
    fn listing(&self) -> Option<Option<MatchKind>> {
        if self.parsed {
            Some(None)
        } else if self.text {
            Some(Some(MatchKind::Text))
        } else {
            None
        }
    }
}

/// Collects the exact metric names a query selects; selectors without one are skipped.
#[derive(Default)]
struct SelectedNames(HashSet<String>);

impl ExprVisitor for SelectedNames {
    type Error = &'static str;

    fn pre_visit(&mut self, expr: &Expr) -> Result<bool, Self::Error> {
        let selector = match expr {
            Expr::VectorSelector(selector) => selector,
            Expr::MatrixSelector(matrix) => &matrix.vs,
            _ => return Ok(true),
        };
        if let Some(name) = metric_name(selector) {
            self.0.insert(name);
        }
        Ok(true)
    }
}

/// Scans everything in `org_id` that `user_id` can list for queries that use `metric`.
pub async fn metric_usage(
    org_id: &str,
    user_id: &str,
    metric: &str,
) -> Result<MetricUsage, anyhow::Error> {
    let conn = infra::db::get_orm_client_ro().await;
    let sources = UsageSources {
        dashboards: infra::table::dashboards::list_skipping_invalid(ListDashboardsParams::new(
            org_id,
        ))
        .await?,
        alerts: db::alerts::alert::list_with_folders(conn, ListAlertsParams::new(org_id)).await?,
        slos: infra::table::slos::list(conn, org_id, None).await?,
        pipelines: crate::pipeline::db::list_by_org(org_id).await?,
    };
    let access = load_access(org_id, user_id, &sources).await?;
    Ok(scan(metric, visible(org_id, sources, &access)))
}

/// Everything is visible without fine-grained permissions, as in the OSS list endpoints.
#[cfg(not(feature = "enterprise"))]
async fn load_access(
    _org_id: &str,
    _user_id: &str,
    sources: &UsageSources,
) -> Result<Access, anyhow::Error> {
    let open = |folders: HashSet<String>| {
        folders
            .into_iter()
            .map(|folder| {
                (
                    folder,
                    FolderAccess {
                        list: true,
                        get: true,
                    },
                )
            })
            .collect()
    };
    Ok(Access {
        dashboard_folders: open(sources.dashboard_folders()),
        alert_folders: open(sources.alert_folders()),
        dashboards: None,
        alerts: None,
        pipelines_listable: true,
        pipelines: None,
    })
}

/// The checks the list endpoints make: the route's LIST, then their per-object filters.
#[cfg(feature = "enterprise")]
async fn load_access(
    org_id: &str,
    user_id: &str,
    sources: &UsageSources,
) -> Result<Access, anyhow::Error> {
    use o2_openfga::meta::mapping::OFGA_MODELS;

    let role = match db::user::get(Some(org_id), user_id).await {
        Ok(Some(user)) => user.role,
        _ => anyhow::bail!("user {user_id} not found in {org_id}"),
    };
    let model = |name: &str| OFGA_MODELS.get(name).map_or("", |m| m.key).to_string();
    let mut dashboard_folders = HashMap::new();
    for folder in sources.dashboard_folders() {
        let list = route_allows(org_id, user_id, &role, &[org_id, "dashboards"], &folder).await;
        let get = list && folder_get(org_id, user_id, &role, &model("folders"), &folder).await;
        dashboard_folders.insert(folder, FolderAccess { list, get });
    }
    let mut alert_folders = HashMap::new();
    for folder in sources.alert_folders() {
        let list = route_allows(org_id, user_id, &role, &["v2", org_id, "alerts"], &folder).await;
        let get =
            list && folder_get(org_id, user_id, &role, &model("alert_folders"), &folder).await;
        alert_folders.insert(folder, FolderAccess { list, get });
    }
    let individual = |permission: &'static str, object_type: String| async move {
        crate::authz::list_objects_for_user(org_id, user_id, permission, &object_type).await
    };
    let alerts = if o2_openfga::config::get_config().list_only_permitted {
        individual("GET_INDIVIDUAL_FROM_ROLE", model("alerts")).await?
    } else {
        None
    };
    Ok(Access {
        dashboard_folders,
        alert_folders,
        dashboards: individual("GET_INDIVIDUAL_FROM_ROLE", "dashboard".to_string()).await?,
        alerts,
        pipelines_listable: route_allows(org_id, user_id, &role, &[org_id, "pipelines"], "").await,
        pipelines: individual("GET", model("pipelines")).await?,
    })
}

/// The LIST check the auth middleware makes for a GET on `path`.
#[cfg(feature = "enterprise")]
async fn route_allows(
    org_id: &str,
    user_id: &str,
    role: &config::meta::user::UserRole,
    path: &[&str],
    folder: &str,
) -> bool {
    let Some(route) =
        o2_openfga::meta::route_permissions::resolve_permission(path, "GET", org_id, folder, None)
    else {
        return false;
    };
    crate::authz::check_permissions(
        user_id,
        crate::auth::AuthExtractor {
            auth: String::new(),
            method: route.method,
            o2_type: route.o2_type,
            org_id: route.org_id,
            bypass_check: route.bypass_check,
            parent_id: route.parent_id,
            use_all_org: route.use_all_org,
            use_self_context: route.use_self_context,
            use_self_parent: route.use_self_parent,
        },
        role.clone(),
        false,
    )
    .await
}

/// The folder GET check the dashboard and alert list filters make.
#[cfg(feature = "enterprise")]
async fn folder_get(
    org_id: &str,
    user_id: &str,
    role: &config::meta::user::UserRole,
    folder_type: &str,
    folder: &str,
) -> bool {
    crate::authz::check_permissions(
        user_id,
        crate::auth::AuthExtractor {
            auth: String::new(),
            method: "GET".to_string(),
            o2_type: format!("{folder_type}:{folder}"),
            org_id: org_id.to_string(),
            bypass_check: false,
            parent_id: String::new(),
            use_all_org: false,
            use_self_context: false,
            use_self_parent: true,
        },
        role.clone(),
        false,
    )
    .await
}

/// Keeps what `access` lets the caller list.
fn visible(org_id: &str, sources: UsageSources, access: &Access) -> UsageSources {
    let alls = format!("alert:_all_{org_id}");
    UsageSources {
        dashboards: sources
            .dashboards
            .into_iter()
            .filter(|(folder, dashboard)| {
                let folder_access = access.dashboard_folder(&folder.folder_id);
                folder_access.list
                    && (folder_access.get
                        || is_dashboard_permitted(
                            org_id,
                            folder,
                            dashboard,
                            access.dashboards.as_deref(),
                        ))
            })
            .collect(),
        alerts: sources
            .alerts
            .into_iter()
            .filter(|(folder, alert)| {
                let folder_access = access.alert_folder(&folder.folder_id);
                folder_access.list
                    && (folder_access.get
                        || access.alerts.as_ref().is_none_or(|permitted| {
                            permitted.contains(&alls)
                                || is_alert_permitted(folder, alert, permitted)
                        }))
            })
            .collect(),
        slos: sources
            .slos
            .into_iter()
            .filter(|slo| access.alert_folder(&slo.folder_id).list)
            .collect(),
        pipelines: sources
            .pipelines
            .into_iter()
            .filter(|pipeline| {
                access.pipelines_listable
                    && is_user_pipeline_visible(pipeline, org_id, access.pipelines.as_ref())
            })
            .collect(),
    }
}

fn scan(metric: &str, sources: UsageSources) -> MetricUsage {
    let mut usage = MetricUsage::default();
    for (folder, dashboard) in &sources.dashboards {
        let hits = dashboard_hits(metric, dashboard);
        usage.unparsed += hits.unparsed;
        if let Some(match_kind) = hits.listing() {
            usage.dashboards.push(DashboardUsage {
                id: dashboard.dashboard_id().unwrap_or_default().to_string(),
                title: dashboard.title().unwrap_or_default().to_string(),
                folder_id: folder.folder_id.clone(),
                match_kind,
            });
        }
    }
    for (folder, alert) in &sources.alerts {
        let mut hits = Hits::default();
        hits.add(alert_outcome(metric, alert));
        usage.unparsed += hits.unparsed;
        if let Some(match_kind) = hits.listing() {
            usage.alerts.push(AlertUsage {
                id: alert.id.map(|id| id.to_string()).unwrap_or_default(),
                name: alert.name.clone(),
                folder_id: folder.folder_id.clone(),
                match_kind,
            });
        }
    }
    for slo in &sources.slos {
        let hits = slo_hits(metric, slo);
        usage.unparsed += hits.unparsed;
        push_object(&mut usage.slos, &hits, &slo.id, &slo.name);
    }
    for pipeline in &sources.pipelines {
        let mut hits = Hits::default();
        hits.add(pipeline_outcome(metric, pipeline));
        usage.unparsed += hits.unparsed;
        push_object(&mut usage.pipelines, &hits, &pipeline.id, &pipeline.name);
    }
    usage
}

fn push_object(list: &mut Vec<ObjectUsage>, hits: &Hits, id: &str, name: &str) {
    if let Some(match_kind) = hits.listing() {
        list.push(ObjectUsage {
            id: id.to_string(),
            name: name.to_string(),
            match_kind,
        });
    }
}

fn is_ident_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == ':'
}

/// Swaps `$var` / `${var}` tokens for a duration in a range or after `offset`, else `value`.
fn neutralise_tokens(query: &str, value: &str) -> String {
    let chars: Vec<char> = query.chars().collect();
    let mut out = String::with_capacity(query.len());
    let mut quote: Option<char> = None;
    let mut bracket_depth = 0usize;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '$' {
            let end = token_end(&chars, i);
            if end > i + 1 {
                let duration = quote.is_none() && (bracket_depth > 0 || ends_with_offset(&out));
                out.push_str(if duration { RANGE_PLACEHOLDER } else { value });
                i = end;
                continue;
            }
        }
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), '\\') => {
                out.push(ch);
                i += 1;
                if let Some(next) = chars.get(i) {
                    out.push(*next);
                }
                i += 1;
                continue;
            }
            (None, '"' | '\'' | '`') => quote = Some(ch),
            (None, '[') => bracket_depth += 1,
            (None, ']') => bracket_depth = bracket_depth.saturating_sub(1),
            _ => {}
        }
        out.push(ch);
        i += 1;
    }
    out
}

/// End (exclusive) of the template token starting at `start`, or `start + 1` if there is none.
fn token_end(chars: &[char], start: usize) -> usize {
    if chars.get(start + 1) == Some(&'{') {
        return chars[start..]
            .iter()
            .position(|c| *c == '}')
            .map_or(start + 1, |offset| start + offset + 1);
    }
    let mut end = start + 1;
    while end < chars.len() && (chars[end].is_ascii_alphanumeric() || chars[end] == '_') {
        end += 1;
    }
    end
}

fn ends_with_offset(text: &str) -> bool {
    let text = text.trim_end();
    text.len() >= 6
        && text[text.len() - 6..].eq_ignore_ascii_case("offset")
        && !text[..text.len() - 6]
            .chars()
            .next_back()
            .is_some_and(is_ident_char)
}

/// Whether `text` contains `metric` as a whole identifier.
fn mentions(text: &str, metric: &str) -> bool {
    text.match_indices(metric).any(|(at, _)| {
        let before = text[..at].chars().next_back();
        let after = text[at + metric.len()..].chars().next();
        !before.is_some_and(is_ident_char) && !after.is_some_and(is_ident_char)
    })
}

/// A token where a scalar is expected only parses as a number, so that is tried second.
fn selected_names(query: &str) -> Option<HashSet<String>> {
    [VALUE_PLACEHOLDER, SCALAR_PLACEHOLDER]
        .into_iter()
        .find_map(|value| promql_parser::parser::parse(&neutralise_tokens(query, value)).ok())
        .and_then(|ast| {
            let mut names = SelectedNames::default();
            walk_expr(&mut names, &ast).ok()?;
            Some(names.0)
        })
}

fn promql_outcome(metric: &str, query: Option<&str>) -> Outcome {
    let Some(query) = query.map(str::trim).filter(|query| !query.is_empty()) else {
        return Outcome::NoMatch;
    };
    match selected_names(query) {
        Some(names) => outcome_of(names.contains(metric)),
        None => Outcome::Unparsed {
            text: mentions(query, metric),
        },
    }
}

fn sql_outcome(metric: &str, sql: &str) -> Outcome {
    match resolve_stream_names(sql) {
        Ok(streams) => outcome_of(streams.iter().any(|stream| stream == metric)),
        Err(_) => Outcome::Unparsed {
            text: mentions(sql, metric),
        },
    }
}

fn outcome_of(matched: bool) -> Outcome {
    if matched {
        Outcome::Match
    } else {
        Outcome::NoMatch
    }
}

fn is_metric_stream(stream_type: &Value, stream: &Value, metric: &str) -> bool {
    stream_type.as_str() == Some("metrics") && stream.as_str() == Some(metric)
}

/// Walks the stored JSON, so every dashboard version is read the same way.
fn dashboard_hits(metric: &str, dashboard: &Dashboard) -> Hits {
    let value = serde_json::to_value(dashboard).unwrap_or_default();
    let inner = &value[format!("v{}", dashboard.version)];
    let tab_panels = inner["tabs"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|tab| tab["panels"].as_array().into_iter().flatten());
    let top_panels = inner["panels"].as_array().into_iter().flatten();
    let mut hits = Hits::default();
    for panel in tab_panels.chain(top_panels) {
        let promql = panel["queryType"].as_str() == Some("promql");
        // A v1 panel is its own single query.
        let queries = match panel["queries"].as_array() {
            Some(queries) => queries.iter().collect(),
            None => vec![panel],
        };
        for query in queries {
            hits.add(dashboard_query_outcome(metric, query, promql));
        }
    }
    for variable in inner["variables"]["list"].as_array().into_iter().flatten() {
        let query_data = &variable["query_data"];
        hits.add(outcome_of(is_metric_stream(
            &query_data["stream_type"],
            &query_data["stream"],
            metric,
        )));
    }
    hits
}

fn dashboard_query_outcome(metric: &str, query: &Value, promql: bool) -> Outcome {
    // A formula's inputs are scanned in their own right.
    if query["config"]["formula"].is_string() {
        return Outcome::NoMatch;
    }
    if query["customQuery"].as_bool() != Some(true) {
        let fields = &query["fields"];
        return outcome_of(is_metric_stream(
            &fields["stream_type"],
            &fields["stream"],
            metric,
        ));
    }
    let text = query["query"].as_str().unwrap_or_default().trim();
    if text.is_empty() {
        Outcome::NoMatch
    } else if promql {
        promql_outcome(metric, Some(text))
    } else {
        sql_outcome(metric, text)
    }
}

fn alert_outcome(metric: &str, alert: &Alert) -> Outcome {
    let condition = &alert.query_condition;
    if condition.query_type == QueryType::PromQL {
        return promql_outcome(metric, condition.promql.as_deref());
    }
    outcome_of(alert.stream_type == StreamType::Metrics && alert.stream_name == metric)
}

fn slo_hits(metric: &str, slo: &Slo) -> Hits {
    let mut hits = Hits::default();
    match &slo.definition.sli_config {
        SliConfig::Count {
            source: CountSource::PromQl { good, total },
        } => {
            hits.add(promql_outcome(metric, Some(good)));
            hits.add(promql_outcome(metric, Some(total)));
        }
        SliConfig::TimeSlice {
            query_language: QueryLanguage::PromQl,
            query,
            ..
        } => hits.add(promql_outcome(metric, Some(query))),
        _ => {}
    }
    hits
}

fn pipeline_outcome(metric: &str, pipeline: &Pipeline) -> Outcome {
    let PipelineSource::Scheduled(derived) = &pipeline.source else {
        return Outcome::NoMatch;
    };
    let condition = &derived.query_condition;
    if condition.query_type == QueryType::PromQL {
        return promql_outcome(metric, condition.promql.as_deref());
    }
    match condition.sql.as_deref() {
        Some(sql) if derived.stream_type == StreamType::Metrics => sql_outcome(metric, sql),
        _ => Outcome::NoMatch,
    }
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::{QueryType, alert::Alert},
        dashboards::{v1, v8},
    };
    use serde_json::json;

    use super::*;

    const METRIC: &str = "http_requests_total";
    const HOST_METRICS: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../web/src/assets/dashboards/host_metrics.dashboard.json"
    ));

    fn base() -> Value {
        serde_json::from_str(HOST_METRICS).unwrap()
    }

    fn into_dashboard(value: Value) -> Dashboard {
        Dashboard {
            v8: Some(serde_json::from_value::<v8::Dashboard>(value).unwrap()),
            version: 8,
            ..Default::default()
        }
    }

    /// One panel of the given query type holding `queries`, plus `variables`.
    fn dashboard_with(
        id: &str,
        panel_query_type: &str,
        queries: Vec<Value>,
        variables: Value,
    ) -> Dashboard {
        let mut value = base();
        let mut panel = value["tabs"][0]["panels"][0].clone();
        panel["queryType"] = json!(panel_query_type);
        panel["queries"] = json!(queries);
        value["dashboardId"] = json!(id);
        value["tabs"] = json!([{ "tabId": "t", "name": "t", "panels": [panel] }]);
        value["variables"]["list"] = variables;
        into_dashboard(value)
    }

    fn dashboard(panel_query_type: &str, queries: Vec<Value>) -> Dashboard {
        dashboard_with("d", panel_query_type, queries, json!([]))
    }

    fn custom(text: &str) -> Value {
        let mut query = base()["tabs"][0]["panels"][0]["queries"][0].clone();
        query["query"] = json!(text);
        query["customQuery"] = json!(true);
        query
    }

    fn builder(stream: &str, stream_type: &str) -> Value {
        let mut query = custom("");
        query["customQuery"] = json!(false);
        query["fields"]["stream"] = json!(stream);
        query["fields"]["stream_type"] = json!(stream_type);
        query
    }

    fn hits_of(dashboard: &Dashboard) -> (Option<Option<MatchKind>>, usize) {
        let hits = dashboard_hits(METRIC, dashboard);
        (hits.listing(), hits.unparsed)
    }

    fn promql(query: &str) -> Outcome {
        promql_outcome(METRIC, Some(query))
    }

    fn promql_alert(name: &str, promql: &str) -> Alert {
        let mut alert = Alert::default();
        alert.name = name.to_string();
        alert.query_condition.query_type = QueryType::PromQL;
        alert.query_condition.promql = Some(promql.to_string());
        alert
    }

    fn sql_alert(stream_type: StreamType, stream_name: &str) -> Alert {
        let mut alert = Alert::default();
        alert.name = "s".to_string();
        alert.query_condition.query_type = QueryType::SQL;
        alert.stream_type = stream_type;
        alert.stream_name = stream_name.to_string();
        alert
    }

    fn slo(folder_id: &str, sli: Value) -> Slo {
        let mut value = json!({
            "id": "slo1", "name": "slo", "folder_id": folder_id, "target": 99.0,
            "window_secs": 86400, "slice_interval_secs": 300
        });
        value
            .as_object_mut()
            .unwrap()
            .extend(sli.as_object().unwrap().clone());
        serde_json::from_value(value).unwrap()
    }

    fn promql_slo(folder_id: &str) -> Slo {
        slo(
            folder_id,
            json!({"sli_type": "count", "config": {"source": {
                "mode": "prom_ql",
                "query": {"good": "sum(rate(ok[5m]))", "total": "sum(rate(http_requests_total[5m]))"}
            }}}),
        )
    }

    fn pipeline(id: &str, source: Value) -> Pipeline {
        serde_json::from_value(json!({
            "pipeline_id": id, "name": "p", "source": source, "nodes": [], "edges": []
        }))
        .unwrap()
    }

    fn scheduled(id: &str, promql: &str) -> Pipeline {
        pipeline(
            id,
            json!({
                "source_type": "scheduled", "org_id": "o", "stream_type": "metrics",
                "query_condition": {"type": "promql", "promql": promql},
                "trigger_condition": {"period": 5, "frequency": 5}
            }),
        )
    }

    fn folder(id: &str) -> Folder {
        Folder {
            folder_id: id.to_string(),
            ..Default::default()
        }
    }

    fn folders(entries: &[(&str, bool, bool)]) -> HashMap<String, FolderAccess> {
        entries
            .iter()
            .map(|(id, list, get)| {
                (
                    id.to_string(),
                    FolderAccess {
                        list: *list,
                        get: *get,
                    },
                )
            })
            .collect()
    }

    #[test]
    fn neutralises_template_tokens_by_position() {
        assert_eq!(
            neutralise_tokens(
                r#"sum(rate(m{job="$job"}[$__rate_interval]))"#,
                VALUE_PLACEHOLDER
            ),
            r#"sum(rate(m{job="__o2_var__"}[1m]))"#
        );
        assert_eq!(
            neutralise_tokens(
                "max_over_time(m[${__range}:$__interval]) * ${k:csv}",
                VALUE_PLACEHOLDER
            ),
            "max_over_time(m[1m:1m]) * __o2_var__"
        );
        assert_eq!(
            neutralise_tokens("m OFFSET $__interval", VALUE_PLACEHOLDER),
            "m OFFSET 1m"
        );
    }

    #[test]
    fn template_tokens_parse_where_a_duration_or_a_scalar_is_expected() {
        assert_eq!(
            promql("http_requests_total offset $__interval"),
            Outcome::Match
        );
        assert_eq!(promql("topk($k, http_requests_total)"), Outcome::Match);
        assert_eq!(
            promql("quantile_over_time($q, http_requests_total[5m])"),
            Outcome::Match
        );
    }

    #[test]
    fn a_selector_without_an_exact_name_does_not_make_the_query_unparsed() {
        assert_eq!(promql(r#"count({job="api"})"#), Outcome::NoMatch);
        assert_eq!(
            promql(r#"count({job="api"}) + sum(http_requests_total)"#),
            Outcome::Match
        );
    }

    #[test]
    fn a_dashboard_panel_using_the_metric_through_template_tokens_is_listed() {
        let d = dashboard(
            "promql",
            vec![custom("sum(rate(http_requests_total[$__rate_interval]))")],
        );
        assert_eq!(hits_of(&d), (Some(None), 0));
    }

    #[test]
    fn a_longer_metric_with_the_same_prefix_is_not_the_metric() {
        let d = dashboard(
            "promql",
            vec![custom("sum(rate(http_requests_total_bucket[5m]))")],
        );
        assert_eq!(hits_of(&d), (None, 0));
    }

    #[test]
    fn builder_queries_match_on_a_metrics_stream_only() {
        let metrics = dashboard("promql", vec![builder(METRIC, "metrics")]);
        assert_eq!(hits_of(&metrics), (Some(None), 0));
        let sql_builder = dashboard("sql", vec![builder(METRIC, "metrics")]);
        assert_eq!(hits_of(&sql_builder), (Some(None), 0));
        let logs = dashboard("sql", vec![builder(METRIC, "logs")]);
        assert_eq!(hits_of(&logs), (None, 0));
    }

    #[test]
    fn a_custom_sql_panel_matches_its_source_streams_only() {
        let source = dashboard(
            "sql",
            vec![custom(r#"SELECT * FROM "http_requests_total""#)],
        );
        assert_eq!(hits_of(&source), (Some(None), 0));
        let literal = dashboard(
            "sql",
            vec![custom(
                "SELECT * FROM \"other\" WHERE name = 'http_requests_total'",
            )],
        );
        assert_eq!(hits_of(&literal), (None, 0));
    }

    #[test]
    fn only_unparseable_queries_that_name_the_metric_are_counted() {
        let promql = dashboard("promql", vec![custom("sum(http_requests_total[5m]")]);
        assert_eq!(hits_of(&promql), (Some(Some(MatchKind::Text)), 1));
        let sql = dashboard("sql", vec![custom("SELEC x FROM http_requests_total")]);
        assert_eq!(hits_of(&sql), (Some(Some(MatchKind::Text)), 1));
        let other = dashboard("promql", vec![custom("sum(up[5m]")]);
        assert_eq!(hits_of(&other), (None, 0));
    }

    #[test]
    fn a_parsed_match_wins_over_a_text_match_in_the_same_object() {
        let d = dashboard(
            "promql",
            vec![
                custom("http_requests_total"),
                custom("sum(http_requests_total[5m]"),
            ],
        );
        assert_eq!(hits_of(&d), (Some(None), 1));
    }

    #[test]
    fn formula_queries_are_skipped() {
        let mut formula = custom("http_requests_total");
        formula["config"]["formula"] = json!("http_requests_total");
        assert_eq!(hits_of(&dashboard("promql", vec![formula])), (None, 0));
    }

    #[test]
    fn a_variable_reading_the_metric_stream_is_a_use() {
        let variable = json!([{
            "type": "query_values", "name": "job", "label": "Job",
            "query_data": {"stream_type": "metrics", "stream": METRIC, "field": "job"}
        }]);
        let d = dashboard_with("d", "promql", vec![custom("up")], variable);
        assert_eq!(hits_of(&d), (Some(None), 0));
        assert_eq!(hits_of(&dashboard("promql", vec![custom("up")])), (None, 0));
    }

    #[test]
    fn a_v1_dashboard_panel_is_its_own_query() {
        let v1: v1::Dashboard = serde_json::from_value(json!({
            "dashboardId": "old", "title": "Old", "description": "",
            "panels": [{
                "id": "p", "type": "line", "query": "sum(rate(http_requests_total[5m]))",
                "queryType": "promql", "customQuery": true,
                "fields": {"stream": "x", "stream_type": "metrics", "x": [], "y": [], "filter": []},
                "config": {"title": "", "description": "", "show_legends": false}
            }],
            "variables": null
        }))
        .unwrap();
        let d = Dashboard {
            v1: Some(v1),
            version: 1,
            ..Default::default()
        };
        assert_eq!(hits_of(&d), (Some(None), 0));
    }

    #[test]
    fn alerts_match_by_promql_or_by_metrics_stream() {
        assert_eq!(
            alert_outcome(METRIC, &promql_alert("a", "http_requests_total > 0")),
            Outcome::Match
        );
        assert_eq!(
            alert_outcome(METRIC, &promql_alert("a", "up > 0")),
            Outcome::NoMatch
        );
        assert_eq!(
            alert_outcome(METRIC, &sql_alert(StreamType::Metrics, METRIC)),
            Outcome::Match
        );
        assert_eq!(
            alert_outcome(METRIC, &sql_alert(StreamType::Logs, METRIC)),
            Outcome::NoMatch
        );
    }

    #[test]
    fn slos_match_on_their_promql_queries() {
        assert!(slo_hits(METRIC, &promql_slo("f")).listing().is_some());
        let slice = slo(
            "f",
            json!({"sli_type": "time_slice", "config": {
                "stream": "x", "stream_type": "metrics", "query_language": "prom_ql",
                "query": "max(http_requests_total)", "comparator": "<", "threshold": 1.0
            }}),
        );
        assert!(slo_hits(METRIC, &slice).listing().is_some());
        assert!(slo_hits("other", &slice).listing().is_none());
    }

    #[test]
    fn scheduled_pipelines_match_on_their_query() {
        assert_eq!(
            pipeline_outcome(METRIC, &scheduled("p1", "rate(http_requests_total[5m])")),
            Outcome::Match
        );
        assert_eq!(
            pipeline_outcome(METRIC, &scheduled("p1", "   ")),
            Outcome::NoMatch
        );
        let realtime = pipeline(
            "p2",
            json!({
                "source_type": "realtime", "org_id": "o", "stream_name": METRIC, "stream_type": "metrics"
            }),
        );
        assert_eq!(pipeline_outcome(METRIC, &realtime), Outcome::NoMatch);
    }

    #[test]
    fn scan_lists_each_kind_and_omits_match_for_parsed_hits() {
        let usage = scan(
            METRIC,
            UsageSources {
                dashboards: vec![(
                    folder("f1"),
                    dashboard("promql", vec![custom("sum(http_requests_total[5m]")]),
                )],
                alerts: vec![(folder("f2"), promql_alert("a", "http_requests_total > 0"))],
                slos: vec![],
                pipelines: vec![],
            },
        );
        let body = serde_json::to_value(&usage).unwrap();
        assert_eq!(body["unparsed"], json!(1));
        assert_eq!(body["dashboards"][0]["folder_id"], json!("f1"));
        assert_eq!(body["dashboards"][0]["match"], json!("text"));
        assert_eq!(body["alerts"][0]["name"], json!("a"));
        assert_eq!(body["alerts"][0]["folder_id"], json!("f2"));
        assert!(body["alerts"][0].get("match").is_none());
        assert_eq!(body["slos"], json!([]));
        assert_eq!(body["pipelines"], json!([]));
    }

    #[test]
    fn dashboards_follow_the_folder_list_check_then_folder_or_individual_grants() {
        let unparsed = || vec![custom("sum(http_requests_total[5m]")];
        let sources = UsageSources {
            dashboards: vec![
                (
                    folder("hidden"),
                    dashboard_with("d0", "promql", unparsed(), json!([])),
                ),
                (
                    folder("open"),
                    dashboard_with("d1", "promql", unparsed(), json!([])),
                ),
                (
                    folder("shared"),
                    dashboard_with("d2", "promql", unparsed(), json!([])),
                ),
                (
                    folder("shared"),
                    dashboard_with("d3", "promql", unparsed(), json!([])),
                ),
                (
                    folder("shared"),
                    dashboard_with("d4", "promql", unparsed(), json!([])),
                ),
            ],
            ..Default::default()
        };
        let access = Access {
            dashboard_folders: folders(&[
                ("hidden", false, false),
                ("open", true, true),
                ("shared", true, false),
            ]),
            dashboards: Some(vec![
                "dashboard:d0".to_string(),
                "dashboard:d2".to_string(),
                "dashboard:shared/d3".to_string(),
            ]),
            ..Default::default()
        };
        let usage = scan(METRIC, visible("org", sources, &access));
        let ids: Vec<_> = usage.dashboards.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, vec!["d1", "d2", "d3"]);
        assert_eq!(usage.unparsed, 3);
    }

    #[test]
    fn without_individual_grants_a_listable_folder_shows_everything() {
        let sources = UsageSources {
            dashboards: vec![(
                folder("shared"),
                dashboard_with("d1", "promql", vec![custom(METRIC)], json!([])),
            )],
            ..Default::default()
        };
        let access = Access {
            dashboard_folders: folders(&[("shared", true, false)]),
            ..Default::default()
        };
        assert_eq!(visible("org", sources, &access).dashboards.len(), 1);
    }

    #[test]
    fn alerts_follow_the_folder_list_check_then_folder_or_individual_grants() {
        let alert = |name: &str| promql_alert(name, "http_requests_total > 0");
        let sources = UsageSources {
            alerts: vec![
                (folder("hidden"), alert("a0")),
                (folder("open"), alert("a1")),
                (folder("shared"), alert("a2")),
                (folder("shared"), alert("a3")),
            ],
            ..Default::default()
        };
        let mut access = Access {
            alert_folders: folders(&[
                ("hidden", false, false),
                ("open", true, true),
                ("shared", true, false),
            ]),
            alerts: Some(vec!["alert:a0".to_string(), "alert:a2".to_string()]),
            ..Default::default()
        };
        let names = |access: &Access| -> Vec<String> {
            visible(
                "org",
                UsageSources {
                    alerts: sources.alerts.clone(),
                    ..Default::default()
                },
                access,
            )
            .alerts
            .into_iter()
            .map(|(_, a)| a.name)
            .collect()
        };
        assert_eq!(names(&access), vec!["a1", "a2"]);
        access.alerts = Some(vec!["alert:_all_org".to_string()]);
        assert_eq!(names(&access), vec!["a1", "a2", "a3"]);
    }

    #[test]
    fn an_slo_in_a_folder_the_caller_cannot_list_is_not_listed() {
        let sources = UsageSources {
            slos: vec![promql_slo("hidden"), promql_slo("open")],
            ..Default::default()
        };
        let access = Access {
            alert_folders: folders(&[("hidden", false, true), ("open", true, false)]),
            ..Default::default()
        };
        let slos = visible("org", sources, &access).slos;
        assert_eq!(slos.len(), 1);
        assert_eq!(slos[0].folder_id, "open");
    }

    #[test]
    fn pipelines_follow_the_list_route_and_the_individual_grants() {
        let sources = || UsageSources {
            pipelines: vec![
                scheduled("p1", "rate(http_requests_total[5m])"),
                scheduled("p2", "rate(http_requests_total[5m])"),
            ],
            ..Default::default()
        };
        let ids = |access: &Access| -> Vec<String> {
            visible("org", sources(), access)
                .pipelines
                .into_iter()
                .map(|p| p.id)
                .collect()
        };
        let mut access = Access {
            pipelines_listable: true,
            pipelines: Some(vec!["pipeline:p2".to_string()]),
            ..Default::default()
        };
        assert_eq!(ids(&access), vec!["p2"]);
        access.pipelines = None;
        assert_eq!(ids(&access), vec!["p1", "p2"]);
        access.pipelines_listable = false;
        assert!(ids(&access).is_empty());
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn without_fine_grained_permissions_everything_is_visible() {
        let sources = UsageSources {
            dashboards: vec![(folder("f"), dashboard("promql", vec![custom(METRIC)]))],
            alerts: vec![(folder("g"), promql_alert("a", "http_requests_total > 0"))],
            slos: vec![promql_slo("h")],
            pipelines: vec![scheduled("p1", "rate(http_requests_total[5m])")],
        };
        let access = load_access("org", "user", &sources).await.unwrap();
        let usage = scan(METRIC, visible("org", sources, &access));
        assert_eq!(
            (
                usage.dashboards.len(),
                usage.alerts.len(),
                usage.slos.len(),
                usage.pipelines.len()
            ),
            (1, 1, 1, 1)
        );
    }
}
