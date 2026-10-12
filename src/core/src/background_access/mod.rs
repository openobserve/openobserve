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

pub mod placeholders;

use std::collections::HashMap;
#[cfg(feature = "enterprise")]
use std::collections::HashSet;

use config::meta::{
    alerts::{QueryCondition, QueryType, alert::Alert},
    slo::{CountSource, QueryLanguage as SloLanguage, SliConfig, Slo},
    stream::StreamType,
};
use placeholders::{QueryLanguage, panel_query_sources};
#[cfg(feature = "enterprise")]
use {
    axum::response::Response,
    config::meta::{
        dashboards::{Dashboard, reports::Report, v8::Panel},
        pipeline::Pipeline,
    },
    serde_json::Value,
};

use crate::authz::QuerySource;
#[cfg(feature = "enterprise")]
use crate::authz::{StreamAccessChecker, WriteCheck};

/// The stream check a save runs through its write hook, after every check of the save's own.
#[cfg(feature = "enterprise")]
pub struct StreamReadCheck<'a> {
    pub org_id: &'a str,
    pub user_id: &'a str,
}

#[cfg(feature = "enterprise")]
#[async_trait::async_trait]
impl WriteCheck<Pipeline> for StreamReadCheck<'_> {
    async fn check(&self, pipeline: &Pipeline) -> Result<(), Response> {
        let sources = async { pipeline_sources(pipeline).await.map(Some) };
        guard_loaded(&pipeline.org, self.user_id, sources).await
    }
}

#[cfg(feature = "enterprise")]
#[async_trait::async_trait]
impl WriteCheck<Slo> for StreamReadCheck<'_> {
    async fn check(&self, slo: &Slo) -> Result<(), Response> {
        guard_write(&slo.org, self.user_id, &slo_sources(slo)).await
    }
}

#[cfg(feature = "enterprise")]
#[async_trait::async_trait]
impl WriteCheck<config::meta::function::Transform> for StreamReadCheck<'_> {
    async fn check(&self, transform: &config::meta::function::Transform) -> Result<(), Response> {
        if transform.is_js() {
            return Ok(());
        }
        guard_vrl_function(self.org_id, self.user_id, &transform.function).await
    }
}

/// Why a report save, enable or run was refused.
#[cfg(feature = "enterprise")]
pub enum ReportRefusal {
    Forbidden(Response),
    /// A dashboard the report renders could not be read; the caller answers as its own read would.
    DashboardLoad(anyhow::Error),
}

/// One enabled report's view of a dashboard: the tab it asks for and its variable values.
#[cfg(feature = "enterprise")]
struct RenderingReport {
    tab: Option<String>,
    variables: Vec<(String, String)>,
}

/// What an edit changed that a report could read differently; panels are keyed `(tab, panel)`.
#[cfg(feature = "enterprise")]
#[derive(Default)]
struct QueryEdits {
    panels: HashSet<(String, String)>,
    tabs: bool,
    variables: bool,
}

#[cfg(feature = "enterprise")]
impl QueryEdits {
    fn between(stored: &Value, edited: &Value) -> Self {
        let before = panels_by_key(stored);
        let panels = panels_by_key(edited)
            .into_iter()
            .filter(|(key, panel)| {
                let reads = panel_reads(panel);
                !reads.is_null() && before.get(key).map(|old| panel_reads(old)) != Some(reads)
            })
            .map(|(key, _)| key)
            .collect();
        Self {
            panels,
            tabs: tab_ids(stored) != tab_ids(edited),
            variables: stored.get("variables") != edited.get("variables"),
        }
    }

    fn is_empty(&self) -> bool {
        self.panels.is_empty() && !self.tabs && !self.variables
    }
}

pub fn alert_sources(org_id: &str, alert: &Alert) -> Vec<QuerySource> {
    let mut sources = Vec::new();
    if !alert.stream_name.is_empty() {
        sources.push(QuerySource::Stream {
            org_id: org_id.to_string(),
            stream_type: alert.stream_type,
            name: alert.stream_name.clone(),
        });
    }
    sources.extend(query_condition_sources(
        org_id,
        alert.stream_type,
        &alert.query_condition,
    ));
    sources
}

pub fn anomaly_sources(
    org_id: &str,
    stream_type: &str,
    stream_name: &str,
    custom_sql: Option<&str>,
) -> Vec<QuerySource> {
    let stream_type = StreamType::from(stream_type);
    let mut sources = vec![QuerySource::Stream {
        org_id: org_id.to_string(),
        stream_type,
        name: stream_name.to_string(),
    }];
    if let Some(sql) = custom_sql.filter(|sql| !sql.trim().is_empty()) {
        sources.push(QuerySource::Sql {
            org_id: org_id.to_string(),
            sql: sql.to_string(),
            default_type: stream_type,
        });
    }
    sources
}

/// Built from the job's own query plan so the check reads exactly what the job runs.
pub fn slo_sources(slo: &Slo) -> Vec<QuerySource> {
    use crate::slo::query::{PlanRange, SliQueryPlan, plan};

    let org_id = slo.org.as_str();
    let slice = slo.definition.slice_interval_secs.max(60);
    let range = PlanRange {
        start_secs: 0,
        end_secs: slice,
        slice_interval_secs: slice,
    };
    let group_by = slo.definition.group_by.clone().unwrap_or_default();
    let stream = |name: &str, stream_type: &str| QuerySource::Stream {
        org_id: org_id.to_string(),
        stream_type: StreamType::from(stream_type),
        name: name.to_string(),
    };
    let sql = |sql: &str, stream_type: &str| QuerySource::Sql {
        org_id: org_id.to_string(),
        sql: sql.to_string(),
        default_type: StreamType::from(stream_type),
    };
    let promql = |query: &str| QuerySource::PromQl {
        org_id: org_id.to_string(),
        query: query.to_string(),
    };

    let sli = &slo.definition.sli_config;
    let mut sources = Vec::new();
    match (sli, plan(sli, &group_by, range)) {
        (
            SliConfig::Count {
                source:
                    CountSource::SingleQuery {
                        stream: name,
                        stream_type,
                        ..
                    },
            }
            | SliConfig::TimeSlice {
                stream: name,
                stream_type,
                query_language: SloLanguage::Sql,
                ..
            },
            SliQueryPlan::Single(query),
        ) => {
            sources.push(stream(name, stream_type));
            sources.push(sql(&query.sql, stream_type));
        }
        (
            SliConfig::Count {
                source: CountSource::DualQuery { good, total },
            },
            _,
        ) => {
            for count in [good, total] {
                sources.push(stream(&count.stream, &count.stream_type));
                sources.push(sql(&count.sql, &count.stream_type));
            }
        }
        (
            SliConfig::Count {
                source: CountSource::PromQl { good, total },
            },
            _,
        ) => {
            sources.push(promql(good));
            sources.push(promql(total));
        }
        (
            SliConfig::TimeSlice {
                stream: name,
                stream_type,
                query,
                ..
            },
            _,
        ) => {
            sources.push(stream(name, stream_type));
            sources.push(promql(query));
        }
        _ => {}
    }
    sources
}

/// What a report renders: the panels of `tab` (else the first tab) and the variable queries.
pub fn dashboard_sources(
    org_id: &str,
    dashboard: &serde_json::Value,
    tab: Option<&str>,
    variables: &[(String, String)],
) -> Vec<QuerySource> {
    let values = variable_values(dashboard, variables);
    let (_, panels) = rendered_tab(dashboard, tab);
    let mut sources = Vec::new();
    for panel in panels {
        sources.extend(panel_sources(org_id, panel, &values));
    }
    sources.extend(variable_sources(org_id, dashboard, &values));
    sources
}

pub fn panel_sources(
    org_id: &str,
    panel: &serde_json::Value,
    values: &HashMap<String, String>,
) -> Vec<QuerySource> {
    let promql = panel
        .get("queryType")
        .and_then(|t| t.as_str())
        .is_some_and(|t| t.eq_ignore_ascii_case("promql"));
    let (lang, fallback_type) = if promql {
        (QueryLanguage::PromQl, StreamType::Metrics)
    } else {
        (QueryLanguage::Sql, StreamType::Logs)
    };
    let mut sources = Vec::new();
    let queries = panel
        .get("queries")
        .and_then(|q| q.as_array())
        .into_iter()
        .flatten();
    for query in queries {
        let fields = query.get("fields");
        let stream_type = fields.map_or(fallback_type, |f| json_stream_type(f, fallback_type));
        if let Some(text) = query.get("query").and_then(|q| q.as_str()) {
            sources.extend(panel_query_sources(org_id, text, lang, stream_type, values));
        }
        let vrl = query.get("vrlFunctionQuery").and_then(|v| v.as_str());
        if let Some(vrl) = vrl.map(str::trim).filter(|v| !v.is_empty()) {
            sources.push(QuerySource::Vrl {
                org_id: org_id.to_string(),
                source: vrl.to_string(),
            });
        }
        if let Some(source) =
            fields.and_then(|f| named_stream_source(org_id, f, stream_type, values))
        {
            sources.push(source);
        }
        let joins = query
            .get("joins")
            .and_then(|j| j.as_array())
            .into_iter()
            .flatten();
        for join in joins {
            if let Some(source) = named_stream_source(org_id, join, stream_type, values) {
                sources.push(source);
            }
        }
    }
    sources
}

pub fn eval_job_sources(org_id: &str, stream_type: &str, stream: &str) -> Vec<QuerySource> {
    vec![QuerySource::Stream {
        org_id: org_id.to_string(),
        stream_type: StreamType::from(stream_type),
        name: stream.to_string(),
    }]
}

pub fn anomaly_config_sources(org_id: &str, config: &serde_json::Value) -> Vec<QuerySource> {
    let field = |name: &str| config.get(name).and_then(|v| v.as_str()).unwrap_or("");
    anomaly_sources(
        org_id,
        field("stream_type"),
        field("stream_name"),
        Some(field("custom_sql")),
    )
}

/// A report value wins over the dashboard default; an empty value counts as none.
pub fn variable_values(
    dashboard: &serde_json::Value,
    variables: &[(String, String)],
) -> HashMap<String, String> {
    let mut values = HashMap::new();
    let defaults = dashboard
        .pointer("/variables/list")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten();
    for variable in defaults {
        if let (Some(name), Some(value)) = (
            variable.get("name").and_then(|n| n.as_str()),
            variable.get("value").and_then(|v| v.as_str()),
        ) && !value.is_empty()
        {
            values.insert(name.to_string(), value.to_string());
        }
    }
    for (name, value) in variables {
        if !value.is_empty() {
            values.insert(name.clone(), value.clone());
        }
    }
    values
}

#[cfg(feature = "enterprise")]
pub fn dashboard_json(
    dashboard: &config::meta::dashboards::Dashboard,
) -> Option<serde_json::Value> {
    let mut all = serde_json::to_value(dashboard).ok()?;
    all.get_mut(format!("v{}", dashboard.version))
        .map(serde_json::Value::take)
        .filter(|body| !body.is_null())
}

/// Checks the dashboards before their queries, so an unreadable one names nothing it holds.
#[cfg(feature = "enterprise")]
pub async fn guard_report(
    org_id: &str,
    user_id: &str,
    report: &Report,
) -> Result<(), ReportRefusal> {
    if !rbac_enforced().await {
        return Ok(());
    }
    let dashboards: Vec<QuerySource> = report
        .dashboards
        .iter()
        .map(|dashboard| QuerySource::Dashboard {
            org_id: org_id.to_string(),
            folder: dashboard.folder.clone(),
            dashboard_id: dashboard.dashboard.clone(),
        })
        .collect();
    guard_write(org_id, user_id, &dashboards)
        .await
        .map_err(ReportRefusal::Forbidden)?;
    let mut sources = Vec::new();
    for dashboard in &report.dashboards {
        let stored = infra::table::dashboards::get_from_folder(
            org_id,
            &dashboard.folder,
            &dashboard.dashboard,
        )
        .await
        .map_err(|e| ReportRefusal::DashboardLoad(e.into()))?;
        // a missing dashboard renders nothing, and the save answers it as it always has
        let Some(json) = stored.as_ref().and_then(dashboard_json) else {
            continue;
        };
        let variables: Vec<(String, String)> = dashboard
            .variables
            .iter()
            .map(|v| (v.key.clone(), v.value.clone()))
            .collect();
        let tab = dashboard.tabs.first().map(String::as_str);
        sources.extend(dashboard_sources(org_id, &json, tab, &variables));
    }
    guard_write(org_id, user_id, &sources)
        .await
        .map_err(ReportRefusal::Forbidden)
}

/// Runs after the update's own existence and hash checks, which answer first as they always have.
#[cfg(feature = "enterprise")]
pub async fn guard_dashboard_update(
    org_id: &str,
    user_id: &str,
    folder_id: &str,
    dashboard_id: &str,
    edited: &Dashboard,
    hash: Option<&str>,
) -> Result<(), Response> {
    if !rbac_enforced().await {
        return Ok(());
    }
    let stored = stored_dashboard(org_id, folder_id, dashboard_id).await?;
    crate::dashboards::check_update_hash(&stored, hash).map_err(Response::from)?;
    crate::dashboards::checked_title(edited).map_err(Response::from)?;
    guard_stored_edit(org_id, user_id, dashboard_id, &stored, edited).await
}

#[cfg(feature = "enterprise")]
pub async fn guard_panel_add(
    org_id: &str,
    user_id: &str,
    folder_id: &str,
    dashboard_id: &str,
    hash: &str,
    tab_id: Option<&str>,
    panel: &Panel,
) -> Result<(), Response> {
    if !rbac_enforced().await {
        return Ok(());
    }
    let stored = stored_dashboard(org_id, folder_id, dashboard_id).await?;
    let mut edited = stored.clone();
    crate::dashboards::insert_panel(&mut edited, tab_id, panel.clone()).map_err(Response::from)?;
    crate::dashboards::check_update_hash(&stored, Some(hash)).map_err(Response::from)?;
    crate::dashboards::checked_title(&edited).map_err(Response::from)?;
    guard_stored_edit(org_id, user_id, dashboard_id, &stored, &edited).await
}

#[cfg(feature = "enterprise")]
#[allow(clippy::too_many_arguments)]
pub async fn guard_panel_update(
    org_id: &str,
    user_id: &str,
    folder_id: &str,
    dashboard_id: &str,
    panel_id: &str,
    hash: &str,
    tab_id: Option<&str>,
    panel: &Panel,
) -> Result<(), Response> {
    if !rbac_enforced().await {
        return Ok(());
    }
    let stored = stored_dashboard(org_id, folder_id, dashboard_id).await?;
    let mut edited = stored.clone();
    crate::dashboards::replace_panel(&mut edited, panel_id, tab_id, panel.clone())
        .map_err(Response::from)?;
    crate::dashboards::check_update_hash(&stored, Some(hash)).map_err(Response::from)?;
    crate::dashboards::checked_title(&edited).map_err(Response::from)?;
    guard_stored_edit(org_id, user_id, dashboard_id, &stored, &edited).await
}

/// The source is the first node, as `Pipeline::validate` rebuilds it; the body's own is discarded.
#[cfg(feature = "enterprise")]
pub async fn pipeline_sources(pipeline: &Pipeline) -> Result<Vec<QuerySource>, anyhow::Error> {
    use config::meta::pipeline::components::{NodeData, PipelineSource};

    let org = pipeline.org.as_str();
    let mut sources = Vec::new();
    match pipeline.nodes.first().map(|first| &first.data) {
        Some(NodeData::Stream(stream)) => sources.push(realtime_source(org, stream)),
        Some(NodeData::Query(_)) => {}
        _ => match &pipeline.source {
            PipelineSource::Realtime(stream) => sources.push(realtime_source(org, stream)),
            PipelineSource::Scheduled(derived) => sources.extend(query_condition_sources(
                org,
                derived.stream_type,
                &derived.query_condition,
            )),
        },
    }
    for node in &pipeline.nodes {
        match &node.data {
            NodeData::Query(derived) => sources.extend(query_condition_sources(
                org,
                derived.stream_type,
                &derived.query_condition,
            )),
            NodeData::Function(function) if !function.name.is_empty() => {
                if let Some(transform) = stored_function(org, &function.name).await?
                    && !transform.is_js()
                {
                    sources.push(QuerySource::Vrl {
                        org_id: org.to_string(),
                        source: transform.function,
                    });
                }
            }
            _ => {}
        }
    }
    Ok(sources)
}

/// `None` when no alert, composite or anomaly config has this id; a failed read is an error.
#[cfg(feature = "enterprise")]
pub async fn stored_alert_sources(
    org_id: &str,
    id: &str,
) -> Result<Option<Vec<QuerySource>>, anyhow::Error> {
    use std::str::FromStr;

    use crate::alerts::alert::AlertError;

    let client = infra::db::get_orm_client_ro().await;
    if let Ok(ksuid) = svix_ksuid::Ksuid::from_str(id) {
        match crate::alerts::alert::get_by_id(client, org_id, ksuid).await {
            Ok((_, alert)) => return Ok(Some(alert_sources(org_id, &alert))),
            Err(AlertError::AlertNotFound) => {}
            Err(e) => return Err(anyhow::anyhow!(e.to_string())),
        }
    }
    // a composite reads only its children's rollups, which are checked at their own save
    if infra::table::alert_composites::get_by_id(client, org_id, id)
        .await?
        .is_some()
    {
        return Ok(Some(Vec::new()));
    }
    Ok(crate::anomaly_detection::get_config(org_id, id)
        .await?
        .map(|config| anomaly_config_sources(org_id, &config)))
}

/// `None` for a missing or disabled config, which training and detection refuse on their own.
#[cfg(feature = "enterprise")]
pub async fn runnable_anomaly_sources(
    org_id: &str,
    anomaly_id: &str,
) -> Result<Option<Vec<QuerySource>>, anyhow::Error> {
    let Some(config) = crate::anomaly_detection::get_config(org_id, anomaly_id).await? else {
        return Ok(None);
    };
    if config.get("enabled").and_then(serde_json::Value::as_bool) == Some(false) {
        return Ok(None);
    }
    Ok(Some(anomaly_config_sources(org_id, &config)))
}

/// `custom_sql` replaces the stored one, as the update about to run would.
#[cfg(feature = "enterprise")]
pub async fn anomaly_update_sources(
    org_id: &str,
    anomaly_id: &str,
    custom_sql: Option<&str>,
) -> Result<Option<Vec<QuerySource>>, anyhow::Error> {
    let Some(config) = crate::anomaly_detection::get_config(org_id, anomaly_id).await? else {
        return Ok(None);
    };
    let field = |name: &str| config.get(name).and_then(|v| v.as_str()).unwrap_or("");
    let sql = custom_sql.unwrap_or_else(|| field("custom_sql"));
    Ok(Some(anomaly_sources(
        org_id,
        field("stream_type"),
        field("stream_name"),
        Some(sql),
    )))
}

/// `None` when no SLO has this id.
#[cfg(feature = "enterprise")]
pub async fn stored_slo_sources(
    org_id: &str,
    slo_id: &str,
) -> Result<Option<Vec<QuerySource>>, anyhow::Error> {
    let client = infra::db::get_orm_client_ro().await;
    Ok(infra::table::slos::get(client, org_id, slo_id)
        .await?
        .map(|slo| slo_sources(&slo)))
}

/// Off or lifted RBAC skips every save-time check, so no source is ever loaded for it.
#[cfg(feature = "enterprise")]
pub async fn rbac_enforced() -> bool {
    crate::authz::active_checker().enforces_rbac().await
}

#[cfg(feature = "enterprise")]
pub async fn guard_write(
    org_id: &str,
    user_id: &str,
    sources: &[QuerySource],
) -> Result<(), Response> {
    if sources.is_empty() {
        return Ok(());
    }
    crate::authz::authorize_query_sources(user_id, sources)
        .await
        .map_err(|denied| crate::authz::stream_access_forbidden(org_id, &denied))
}

/// `load` runs only under RBAC; a failed load checks nothing, so the action's own read answers.
#[cfg(feature = "enterprise")]
pub async fn guard_loaded(
    org_id: &str,
    user_id: &str,
    load: impl Future<Output = Result<Option<Vec<QuerySource>>, anyhow::Error>>,
) -> Result<(), Response> {
    guard_loaded_with(
        crate::authz::active_checker().as_ref(),
        org_id,
        user_id,
        load,
    )
    .await
}

/// The bulk form of [`guard_loaded`].
#[cfg(feature = "enterprise")]
pub async fn loaded_denial_message(
    org_id: &str,
    user_id: &str,
    load: impl Future<Output = Result<Option<Vec<QuerySource>>, anyhow::Error>>,
) -> Option<String> {
    if !rbac_enforced().await {
        return None;
    }
    match load.await {
        Ok(Some(sources)) => denial_message(org_id, user_id, &sources).await,
        Ok(None) => None,
        Err(e) => {
            log::warn!("[background_access] {org_id}: source load failed, left to the action: {e}");
            None
        }
    }
}

#[cfg(feature = "enterprise")]
pub async fn denial_message(
    org_id: &str,
    user_id: &str,
    sources: &[QuerySource],
) -> Option<String> {
    if sources.is_empty() {
        return None;
    }
    crate::authz::authorize_query_sources(user_id, sources)
        .await
        .err()
        .map(|denied| crate::authz::stream_access_message(org_id, &denied))
}

/// A body whose tables cannot be read is left to the function save, which answers it.
#[cfg(feature = "enterprise")]
pub async fn guard_vrl_function(org_id: &str, user_id: &str, source: &str) -> Result<(), Response> {
    if !rbac_enforced().await {
        return Ok(());
    }
    let Ok(tables) = transform::enrichment_tables_read(source, org_id) else {
        return Ok(());
    };
    let sources: Vec<QuerySource> = tables
        .into_iter()
        .map(|(table_org, name)| QuerySource::Stream {
            org_id: table_org,
            stream_type: StreamType::EnrichmentTables,
            name,
        })
        .collect();
    guard_write(org_id, user_id, &sources).await
}

fn query_condition_sources(
    org_id: &str,
    stream_type: StreamType,
    condition: &QueryCondition,
) -> Vec<QuerySource> {
    let mut sources = Vec::new();
    let non_empty = |text: &Option<String>| text.clone().filter(|t| !t.trim().is_empty());
    match condition.query_type {
        QueryType::SQL => {
            if let Some(sql) = non_empty(&condition.sql) {
                sources.push(QuerySource::Sql {
                    org_id: org_id.to_string(),
                    sql,
                    default_type: stream_type,
                });
            }
        }
        QueryType::PromQL => {
            if let Some(query) = non_empty(&condition.promql) {
                sources.push(QuerySource::PromQl {
                    org_id: org_id.to_string(),
                    query,
                });
            }
        }
        _ => {}
    }
    if let Some(encoded) = non_empty(&condition.vrl_function) {
        match config::utils::base64::decode_url(&encoded) {
            Ok(source) if source.trim().is_empty() => {}
            Ok(source) => sources.push(QuerySource::Vrl {
                org_id: org_id.to_string(),
                source,
            }),
            // undecodable VRL runs nowhere, so it reads nothing; the save answers its 400
            Err(_) => {}
        }
    }
    sources
}

#[cfg(feature = "enterprise")]
fn realtime_source(pipeline_org: &str, stream: &config::meta::stream::StreamParams) -> QuerySource {
    let org_id = if stream.org_id.is_empty() {
        pipeline_org.to_string()
    } else {
        stream.org_id.to_string()
    };
    QuerySource::Stream {
        org_id,
        stream_type: stream.stream_type,
        name: stream.stream_name.to_string(),
    }
}

/// `None` for a missing function, which has nothing to read; any other failure is an error.
#[cfg(feature = "enterprise")]
async fn stored_function(
    org_id: &str,
    name: &str,
) -> Result<Option<config::meta::function::Transform>, anyhow::Error> {
    use infra::errors::{DbError, Error};

    match db::functions::get(org_id, name).await {
        Ok(transform) => Ok(Some(transform)),
        Err(e)
            if matches!(
                e.downcast_ref::<Error>(),
                Some(Error::DbError(DbError::KeyNotExists(_)))
            ) =>
        {
            Ok(None)
        }
        Err(e) => Err(e),
    }
}

#[cfg(feature = "enterprise")]
async fn guard_loaded_with(
    checker: &dyn StreamAccessChecker,
    org_id: &str,
    user_id: &str,
    load: impl Future<Output = Result<Option<Vec<QuerySource>>, anyhow::Error>>,
) -> Result<(), Response> {
    if !checker.enforces_rbac().await {
        return Ok(());
    }
    match load.await {
        Ok(Some(sources)) => crate::authz::authorize_with(checker, user_id, &sources)
            .await
            .map_err(|denied| crate::authz::stream_access_forbidden(org_id, &denied)),
        Ok(None) => Ok(()),
        Err(e) => {
            log::warn!("[background_access] {org_id}: source load failed, left to the action: {e}");
            Ok(())
        }
    }
}

/// Read as the edit's own first read does, so a failure answers what that read would.
#[cfg(feature = "enterprise")]
async fn stored_dashboard(
    org_id: &str,
    folder_id: &str,
    dashboard_id: &str,
) -> Result<Dashboard, Response> {
    use crate::dashboards::DashboardError;

    infra::table::dashboards::get_from_folder(org_id, folder_id, dashboard_id)
        .await
        .map_err(|e| Response::from(DashboardError::from(e)))?
        .ok_or_else(|| Response::from(DashboardError::DashboardNotFound))
}

#[cfg(feature = "enterprise")]
async fn guard_stored_edit(
    org_id: &str,
    user_id: &str,
    dashboard_id: &str,
    stored: &Dashboard,
    edited: &Dashboard,
) -> Result<(), Response> {
    let Some(edited) = dashboard_json(edited) else {
        return Ok(());
    };
    let stored = dashboard_json(stored).unwrap_or(Value::Null);
    guard_edit(org_id, user_id, &stored, &edited, || {
        rendering_reports(org_id, dashboard_id)
    })
    .await
}

/// `reports` runs only when the edit changed something a report could read differently.
#[cfg(feature = "enterprise")]
async fn guard_edit<F, Fut>(
    org_id: &str,
    user_id: &str,
    stored: &Value,
    edited: &Value,
    reports: F,
) -> Result<(), Response>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Vec<RenderingReport>>,
{
    let edits = QueryEdits::between(stored, edited);
    if edits.is_empty() {
        return Ok(());
    }
    let reports = reports().await;
    let sources = edit_sources(org_id, stored, edited, &edits, &reports);
    guard_write(org_id, user_id, &sources).await
}

/// A failed lookup checks nothing: the edit itself reads no report.
#[cfg(feature = "enterprise")]
async fn rendering_reports(org_id: &str, dashboard_id: &str) -> Vec<RenderingReport> {
    use config::meta::dashboards::reports::ReportListFilters;

    let filters = ReportListFilters {
        dashboard: Some(dashboard_id.to_string()),
        folder: None,
        destination_less: None,
        name_substring: None,
    };
    let rows = match crate::dashboards::reports::list(org_id, filters, None).await {
        Ok(rows) => rows,
        Err(e) => {
            log::warn!("[background_access] {org_id}/{dashboard_id}: report lookup failed: {e}");
            return Vec::new();
        }
    };
    let mut out = Vec::new();
    for row in rows.into_iter().filter(|row| row.report_enabled) {
        let report = match crate::dashboards::reports::get_by_id(org_id, &row.report_id).await {
            Ok((_, report)) => report,
            Err(e) => {
                log::warn!(
                    "[background_access] {org_id}/{}: report read failed: {e}",
                    row.report_id
                );
                continue;
            }
        };
        for dashboard in report
            .dashboards
            .into_iter()
            .filter(|d| d.dashboard == dashboard_id)
        {
            out.push(RenderingReport {
                tab: dashboard.tabs.into_iter().next(),
                variables: dashboard
                    .variables
                    .into_iter()
                    .map(|v| (v.key, v.value))
                    .collect(),
            });
        }
    }
    out
}

/// Only what each report renders after the edit and reads differently than before it.
#[cfg(feature = "enterprise")]
fn edit_sources(
    org_id: &str,
    stored: &Value,
    edited: &Value,
    edits: &QueryEdits,
    reports: &[RenderingReport],
) -> Vec<QuerySource> {
    let before = panels_by_key(stored);
    let mut sources = Vec::new();
    for report in reports {
        let tab = report.tab.as_deref();
        let new_values = variable_values(edited, &report.variables);
        let old_values = variable_values(stored, &report.variables);
        let (new_tab, panels) = rendered_tab(edited, tab);
        let moved = new_tab != rendered_tab(stored, tab).0;
        for panel in panels {
            let key = (new_tab.clone(), panel_id(panel));
            let reads = panel_sources(org_id, panel, &new_values);
            let changed = moved
                || edits.panels.contains(&key)
                || (edits.variables
                    && before
                        .get(&key)
                        .map(|old| panel_sources(org_id, old, &old_values))
                        != Some(reads.clone()));
            if changed {
                sources.extend(reads);
            }
        }
        if edits.variables {
            let old = variable_sources(org_id, stored, &old_values);
            sources.extend(
                variable_sources(org_id, edited, &new_values)
                    .into_iter()
                    .filter(|source| !old.contains(source)),
            );
        }
    }
    sources
}

/// The tab a report shows: the one it names, else the first, as the dashboard page falls back.
fn rendered_tab<'a>(
    dashboard: &'a serde_json::Value,
    tab: Option<&str>,
) -> (String, Vec<&'a serde_json::Value>) {
    let panels_of = |holder: &'a serde_json::Value| -> Vec<&'a serde_json::Value> {
        holder
            .get("panels")
            .and_then(|p| p.as_array())
            .map(|p| p.iter().collect())
            .unwrap_or_default()
    };
    let tabs = dashboard
        .get("tabs")
        .and_then(|t| t.as_array())
        .filter(|tabs| !tabs.is_empty());
    let Some(tabs) = tabs else {
        return (String::new(), panels_of(dashboard));
    };
    let chosen = tab
        .and_then(|id| tabs.iter().find(|t| tab_id(t) == id))
        .unwrap_or(&tabs[0]);
    (tab_id(chosen), panels_of(chosen))
}

fn variable_sources(
    org_id: &str,
    dashboard: &serde_json::Value,
    values: &HashMap<String, String>,
) -> Vec<QuerySource> {
    let list = dashboard
        .pointer("/variables/list")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten();
    let mut sources = Vec::new();
    for variable in list {
        if variable.get("type").and_then(|t| t.as_str()) != Some("query_values") {
            continue;
        }
        let Some(data) = variable.get("query_data") else {
            continue;
        };
        let stream_type = json_stream_type(data, StreamType::Logs);
        if let Some(source) = named_stream_source(org_id, data, stream_type, values) {
            sources.push(source);
        }
    }
    sources
}

#[cfg(feature = "enterprise")]
fn panels_by_key(dashboard: &Value) -> HashMap<(String, String), &Value> {
    let mut out = HashMap::new();
    let tabs = dashboard
        .get("tabs")
        .and_then(|t| t.as_array())
        .into_iter()
        .flatten();
    for tab in tabs {
        let id = tab_id(tab);
        let panels = tab
            .get("panels")
            .and_then(|p| p.as_array())
            .into_iter()
            .flatten();
        for panel in panels {
            out.insert((id.clone(), panel_id(panel)), panel);
        }
    }
    let flat = dashboard
        .get("panels")
        .and_then(|p| p.as_array())
        .into_iter()
        .flatten();
    for panel in flat {
        out.insert((String::new(), panel_id(panel)), panel);
    }
    out
}

/// Every field [`panel_sources`] reads, so equal values read the same streams.
#[cfg(feature = "enterprise")]
fn panel_reads(panel: &Value) -> Value {
    let queries: Vec<Value> = panel
        .get("queries")
        .and_then(|q| q.as_array())
        .into_iter()
        .flatten()
        .map(|query| {
            serde_json::json!([
                query.get("query"),
                query.get("vrlFunctionQuery"),
                query.pointer("/fields/stream"),
                query.pointer("/fields/stream_type"),
                query.get("joins"),
            ])
        })
        .collect();
    if queries.is_empty() {
        return Value::Null;
    }
    serde_json::json!([panel.get("queryType"), queries])
}

#[cfg(feature = "enterprise")]
fn tab_ids(dashboard: &Value) -> Vec<String> {
    dashboard
        .get("tabs")
        .and_then(|t| t.as_array())
        .into_iter()
        .flatten()
        .map(tab_id)
        .collect()
}

fn tab_id(tab: &serde_json::Value) -> String {
    tab.get("tabId")
        .and_then(|t| t.as_str())
        .unwrap_or_default()
        .to_string()
}

#[cfg(feature = "enterprise")]
fn panel_id(panel: &Value) -> String {
    panel
        .get("id")
        .and_then(|t| t.as_str())
        .unwrap_or_default()
        .to_string()
}

fn json_stream_type(value: &serde_json::Value, fallback: StreamType) -> StreamType {
    value
        .get("stream_type")
        .and_then(|t| t.as_str())
        .filter(|t| !t.is_empty())
        .map_or(fallback, StreamType::from)
}

fn named_stream_source(
    org_id: &str,
    value: &serde_json::Value,
    stream_type: StreamType,
    values: &HashMap<String, String>,
) -> Option<QuerySource> {
    let name = value.get("stream").and_then(|s| s.as_str())?;
    if name.is_empty() {
        return None;
    }
    Some(match placeholders::fill_stream_name(name, values) {
        Ok(name) => QuerySource::Stream {
            org_id: org_id.to_string(),
            stream_type,
            name,
        },
        Err(variable) => QuerySource::Unparseable {
            org_id: org_id.to_string(),
            source: name.to_string(),
            error: format!("unresolved variable {variable} in stream position"),
        },
    })
}

#[cfg(test)]
mod tests {
    use config::meta::slo::{CountQuery, SloDefinition};
    use serde_json::json;

    use super::*;
    use crate::authz::resolve_query_sources;

    fn resolved_names(sources: &[QuerySource]) -> Vec<String> {
        resolve_query_sources(sources)
            .streams
            .iter()
            .map(|s| format!("{}/{}/{}", s.org_id, s.stream_type, s.name))
            .collect()
    }

    fn alert(query_type: QueryType) -> Alert {
        let mut alert = Alert::default();
        alert.stream_name = "app".to_string();
        alert.stream_type = StreamType::Logs;
        alert.query_condition.query_type = query_type;
        alert
    }

    fn slo(sli_config: SliConfig) -> Slo {
        Slo {
            id: "s1".to_string(),
            org: "o1".to_string(),
            folder_id: "default".to_string(),
            name: "slo".to_string(),
            description: String::new(),
            definition: SloDefinition {
                sli_config,
                group_by: None,
                window_secs: 86_400,
                slice_interval_secs: 300,
            },
            target: 0.99,
            tags: Vec::new(),
            enabled: true,
            owner: None,
            definition_generation: 0,
            groups_estimate: None,
            groups_reserved: 0,
        }
    }

    #[test]
    fn custom_alert_reads_its_stream() {
        let sources = alert_sources("o1", &alert(QueryType::Custom));
        assert_eq!(resolved_names(&sources), vec!["o1/logs/app"]);
    }

    #[test]
    fn sql_alert_reads_its_stream_and_every_sql_stream() {
        let mut alert = alert(QueryType::SQL);
        alert.query_condition.sql =
            Some("SELECT * FROM app JOIN audit ON true JOIN \"metrics\".cpu ON true".to_string());
        assert_eq!(
            resolved_names(&alert_sources("o1", &alert)),
            vec!["o1/logs/app", "o1/logs/audit", "o1/metrics/cpu"]
        );
    }

    #[test]
    fn promql_alert_reads_its_metrics() {
        let mut alert = alert(QueryType::PromQL);
        alert.stream_name = "up".to_string();
        alert.stream_type = StreamType::Metrics;
        alert.query_condition.promql = Some("up + down".to_string());
        assert_eq!(
            resolved_names(&alert_sources("o1", &alert)),
            vec!["o1/metrics/up", "o1/metrics/down"]
        );
    }

    #[test]
    fn alert_vrl_that_is_not_base64_reads_nothing() {
        let mut alert = alert(QueryType::Custom);
        let plain = alert_sources("o1", &alert);
        alert.query_condition.vrl_function = Some("%%%".to_string());
        assert_eq!(alert_sources("o1", &alert), plain);
    }

    #[test]
    fn slo_alert_reads_nothing() {
        let mut alert = alert(QueryType::Slo);
        alert.stream_name = String::new();
        assert!(alert_sources("o1", &alert).is_empty());
    }

    #[test]
    fn anomaly_reads_its_stream_and_custom_sql() {
        let sources = anomaly_sources("o1", "logs", "app", Some("SELECT * FROM other"));
        assert_eq!(
            resolved_names(&sources),
            vec!["o1/logs/app", "o1/logs/other"]
        );
        assert_eq!(
            resolved_names(&anomaly_sources("o1", "metrics", "cpu", Some("  "))),
            vec!["o1/metrics/cpu"]
        );
    }

    #[test]
    fn slo_reads_every_count_query_stream() {
        let single = slo(SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "app".to_string(),
                stream_type: "logs".to_string(),
                scope: None,
                good_expr: "code < 500".to_string(),
            },
        });
        assert_eq!(resolved_names(&slo_sources(&single)), vec!["o1/logs/app"]);

        let dual = slo(SliConfig::Count {
            source: CountSource::DualQuery {
                good: CountQuery {
                    stream: "good_stream".to_string(),
                    stream_type: "logs".to_string(),
                    sql: "SELECT count(*) AS zo_slo_value FROM good_stream".to_string(),
                },
                total: CountQuery {
                    stream: "total_stream".to_string(),
                    stream_type: "traces".to_string(),
                    sql: "SELECT count(*) AS zo_slo_value FROM total_stream JOIN extra ON true"
                        .to_string(),
                },
            },
        });
        assert_eq!(
            resolved_names(&slo_sources(&dual)),
            vec![
                "o1/logs/good_stream",
                "o1/traces/total_stream",
                "o1/traces/extra",
            ]
        );

        let prom = slo(SliConfig::Count {
            source: CountSource::PromQl {
                good: "increase(ok_total[5m])".to_string(),
                total: "increase(all_total[5m])".to_string(),
            },
        });
        assert_eq!(
            resolved_names(&slo_sources(&prom)),
            vec!["o1/metrics/ok_total", "o1/metrics/all_total"]
        );
    }

    #[test]
    fn eval_job_reads_its_stream() {
        assert_eq!(
            resolved_names(&eval_job_sources("o1", "traces", "llm_spans")),
            vec!["o1/traces/llm_spans"]
        );
    }

    #[test]
    fn dashboard_reads_panels_joins_and_variable_streams_with_report_values() {
        let dashboard = json!({
            "variables": {"list": [
                {"type": "query_values", "name": "svc", "value": "",
                 "query_data": {"stream": "services", "stream_type": "logs", "field": "svc"}},
                {"type": "constant", "name": "target", "value": "fallback_stream"},
            ]},
            "tabs": [{"panels": [
                {"queryType": "sql", "queries": [{
                    "query": "SELECT count(*) FROM \"$target\" WHERE svc = '$svc'",
                    "fields": {"stream": "$target", "stream_type": "logs"},
                    "joins": [{"stream": "joined"}],
                }]},
                {"queryType": "promql", "queries": [{
                    "query": "rate(http_total{svc=\"$svc\"}[$__interval])",
                    "fields": {"stream": "http_total", "stream_type": "metrics"},
                }]},
            ]}],
        });

        let with_defaults = dashboard_sources("o1", &dashboard, None, &[]);
        assert_eq!(
            resolved_names(&with_defaults),
            vec![
                "o1/logs/fallback_stream",
                "o1/logs/joined",
                "o1/metrics/http_total",
                "o1/logs/services",
            ]
        );

        let with_report = dashboard_sources(
            "o1",
            &dashboard,
            None,
            &[("target".to_string(), "report_stream".to_string())],
        );
        assert_eq!(
            resolved_names(&with_report)[0],
            "o1/logs/report_stream".to_string()
        );
    }

    #[test]
    fn panel_stream_variable_without_value_is_unparseable() {
        let panel = json!({"queryType": "sql", "queries": [{
            "query": "SELECT * FROM \"$s\"",
            "fields": {"stream": "$s", "stream_type": "logs"},
        }]});
        let resolved = resolve_query_sources(&panel_sources("o1", &panel, &HashMap::new()));
        assert!(resolved.streams.is_empty());
        assert!(!resolved.unparseable.is_empty());
    }

    #[test]
    fn panel_vrl_reads_tables_global_skipped_then_own_org_then_default() {
        use std::sync::Arc;

        use transform::enrichment::{ENRICHMENT_TABLES, StreamTable};

        let table = |org: &str, name: &str| StreamTable {
            org_id: org.to_string(),
            stream_name: name.to_string(),
            data: Arc::new(vec![]),
        };
        let keys = [
            ("panel_vrl_org", "pv_shared"),
            (config::DEFAULT_ORG, "pv_shared"),
            (config::DEFAULT_ORG, "pv_default_only"),
        ]
        .map(|(org, name)| {
            let key = format!("{org}/enrichment_tables/{name}");
            ENRICHMENT_TABLES.insert(key.clone(), table(org, name));
            key
        });
        transform::register_global_enrichment_table("pv_global", table("global", "pv_global"));
        let vrl = r#"
            a = get_enrichment_table_record!("pv_shared", {"k": .k})
            b = get_enrichment_table_record!("pv_default_only", {"k": .k})
            c = get_enrichment_table_record!("pv_global", {"k": .k})
            .
        "#;
        let panel = json!({"queryType": "sql", "queries": [
            {"query": "SELECT * FROM app", "vrlFunctionQuery": vrl},
            {"query": "SELECT * FROM app", "vrlFunctionQuery": "  "},
        ]});
        let sources = panel_sources("panel_vrl_org", &panel, &HashMap::new());
        let names = resolved_names(&sources);
        transform::remove_global_enrichment_table("pv_global");
        for key in keys {
            ENRICHMENT_TABLES.remove(&key);
        }

        assert_eq!(
            sources
                .iter()
                .filter(|s| matches!(s, QuerySource::Vrl { .. }))
                .count(),
            1
        );
        assert_eq!(
            names,
            vec![
                "panel_vrl_org/logs/app",
                "panel_vrl_org/enrichment_tables/pv_shared",
                "default/enrichment_tables/pv_default_only",
            ]
        );
    }

    #[test]
    fn v1_dashboards_keep_panels_at_the_top_level() {
        let dashboard = json!({"panels": [{"queries": [{"query": "SELECT * FROM flat"}]}]});
        assert_eq!(
            resolved_names(&dashboard_sources("o1", &dashboard, None, &[])),
            vec!["o1/logs/flat"]
        );
    }

    #[test]
    fn a_report_reads_only_its_tab_or_the_first_when_its_tab_is_gone() {
        let dashboard = json!({"tabs": [
            {"tabId": "t1", "panels": [{"queries": [{"query": "SELECT * FROM first"}]}]},
            {"tabId": "t2", "panels": [{"queries": [{"query": "SELECT * FROM second"}]}]},
        ]});
        let names = |tab| resolved_names(&dashboard_sources("o1", &dashboard, tab, &[]));
        assert_eq!(names(Some("t2")), vec!["o1/logs/second"]);
        assert_eq!(names(Some("gone")), vec!["o1/logs/first"]);
        assert_eq!(names(None), vec!["o1/logs/first"]);
    }

    #[cfg(feature = "enterprise")]
    struct RbacOff;

    #[cfg(feature = "enterprise")]
    #[async_trait::async_trait]
    impl crate::authz::StreamAccessChecker for RbacOff {
        async fn enforces_rbac(&self) -> bool {
            false
        }

        async fn is_root(&self, _: &str) -> bool {
            false
        }

        async fn is_root_or_admin(&self, _: &str, _: &str) -> bool {
            false
        }

        async fn can_read_stream(&self, _: &str, _: &crate::authz::TypedStream) -> bool {
            false
        }

        async fn can_use_cipher_key(&self, _: &str, _: &str, _: &str) -> bool {
            false
        }

        async fn can_read_dashboard(&self, _: &str, _: &str, _: &str, _: &str) -> bool {
            false
        }
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn rbac_off_never_loads_the_sources() {
        let load = async { panic!("RBAC off must not load any source") };
        assert!(
            guard_loaded_with(&RbacOff, "o1", "u@example.com", load)
                .await
                .is_ok()
        );
    }

    #[cfg(all(feature = "enterprise", feature = "test-utils"))]
    #[tokio::test]
    async fn a_failed_or_empty_load_is_left_to_the_action() {
        crate::authz::fake_checker();
        let user = format!("{}@example.com", config::ider::uuid());
        let failed = async { Err(anyhow::anyhow!("replica unavailable")) };
        assert!(guard_loaded("o1", &user, failed).await.is_ok());
        let failed = async { Err(anyhow::anyhow!("replica unavailable")) };
        assert_eq!(loaded_denial_message("o1", &user, failed).await, None);
        assert!(guard_loaded("o1", &user, async { Ok(None) }).await.is_ok());

        let secret = vec![QuerySource::Stream {
            org_id: "o1".to_string(),
            stream_type: StreamType::Logs,
            name: "secret".to_string(),
        }];
        let resp = guard_loaded("o1", &user, async { Ok(Some(secret)) })
            .await
            .unwrap_err();
        assert_eq!(resp.status(), axum::http::StatusCode::FORBIDDEN);
    }

    #[cfg(all(feature = "enterprise", feature = "test-utils"))]
    async fn message(resp: Response) -> String {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        body["message"].as_str().unwrap_or_default().to_string()
    }

    #[cfg(feature = "enterprise")]
    fn two_tabs(first: &str, second: &str) -> serde_json::Value {
        json!({
            "title": "d",
            "tabs": [
                {"tabId": "t1", "name": "one", "panels": [
                    {"id": "p1", "title": "a", "queryType": "sql",
                     "queries": [{"query": format!("SELECT * FROM {first}")}]},
                ]},
                {"tabId": "t2", "name": "two", "panels": [
                    {"id": "p2", "title": "b", "queryType": "sql",
                     "queries": [{"query": format!("SELECT * FROM {second}")}]},
                ]},
            ],
        })
    }

    #[cfg(feature = "enterprise")]
    fn rendering(tab: &str) -> Vec<RenderingReport> {
        vec![RenderingReport {
            tab: Some(tab.to_string()),
            variables: Vec::new(),
        }]
    }

    #[cfg(all(feature = "enterprise", feature = "test-utils"))]
    #[tokio::test]
    async fn a_rename_or_layout_edit_looks_up_no_report_and_checks_nothing() {
        crate::authz::fake_checker();
        let user = format!("{}@example.com", config::ider::uuid());
        let stored = two_tabs("secret", "secret");
        let mut edited = stored.clone();
        edited["title"] = json!("renamed");
        edited["tabs"][0]["name"] = json!("renamed tab");
        edited["tabs"][0]["panels"][0]["title"] = json!("renamed panel");
        edited["tabs"][0]["panels"][0]["layout"] = json!({"x": 4, "y": 2, "w": 10, "h": 8, "i": 1});
        let no_lookup =
            || async { panic!("an edit that reads nothing new must not look up reports") };
        assert!(
            guard_edit("o1", &user, &stored, &edited, no_lookup)
                .await
                .is_ok()
        );
    }

    #[cfg(all(feature = "enterprise", feature = "test-utils"))]
    #[tokio::test]
    async fn a_changed_query_counts_only_in_a_tab_some_report_renders() {
        crate::authz::fake_checker();
        let user = format!("{}@example.com", config::ider::uuid());
        let stored = two_tabs("first", "second");

        let hidden_edit = two_tabs("first", "secret");
        let reports = || async { rendering("t1") };
        assert!(
            guard_edit("o1", &user, &stored, &hidden_edit, reports)
                .await
                .is_ok()
        );

        let rendered_edit = two_tabs("secret", "second");
        let reports = || async { rendering("t1") };
        let resp = guard_edit("o1", &user, &stored, &rendered_edit, reports)
            .await
            .unwrap_err();
        assert_eq!(
            message(resp).await,
            "Unauthorized Access: no read permission on logs/secret"
        );
    }

    #[cfg(all(feature = "enterprise", feature = "test-utils"))]
    #[tokio::test]
    async fn an_unreadable_report_dashboard_is_refused_without_its_panels() {
        use config::meta::dashboards::reports::ReportDashboard;

        crate::authz::fake_checker();
        let user = format!("{}@example.com", config::ider::uuid());
        let report = Report {
            dashboards: vec![ReportDashboard {
                dashboard: "d1".to_string(),
                folder: "f1".to_string(),
                tabs: vec!["t1".to_string()],
                variables: Vec::new(),
                timerange: Default::default(),
                report_type: Default::default(),
                email_attachment_type: Default::default(),
                attachment_dimensions: None,
            }],
            ..Default::default()
        };
        let Err(ReportRefusal::Forbidden(resp)) = guard_report("o1", &user, &report).await else {
            panic!("an unreadable dashboard must be refused before it is read");
        };
        assert_eq!(resp.status(), axum::http::StatusCode::FORBIDDEN);
        assert_eq!(
            message(resp).await,
            "Unauthorized Access: dashboards: f1/d1"
        );
    }

    #[cfg(all(feature = "enterprise", feature = "test-utils"))]
    #[tokio::test]
    async fn a_dashboard_edit_answers_main_s_errors_before_the_stream_check() {
        crate::authz::fake_checker();
        let untitled = config::meta::dashboards::Dashboard::default();
        let resp = guard_dashboard_update(
            "o1",
            "denied@example.com",
            "default",
            "missing_dashboard",
            &untitled,
            Some("1"),
        )
        .await
        .unwrap_err();
        assert_ne!(resp.status(), axum::http::StatusCode::FORBIDDEN);
        assert!(matches!(
            crate::dashboards::checked_title(&untitled),
            Err(crate::dashboards::DashboardError::PutMissingTitle)
        ));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_dashboard_without_its_version_body_is_unusable() {
        let dashboard = config::meta::dashboards::Dashboard {
            version: 8,
            ..Default::default()
        };
        assert_eq!(dashboard_json(&dashboard), None);
    }
}
