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

#[cfg(feature = "enterprise")]
pub mod audit;
pub mod placeholders;

use std::collections::HashMap;

use config::meta::{
    alerts::{QueryCondition, QueryType, alert::Alert},
    slo::{CountSource, QueryLanguage as SloLanguage, SliConfig, Slo},
    stream::StreamType,
};
use placeholders::{QueryLanguage, panel_query_sources};
#[cfg(feature = "enterprise")]
use {axum::response::Response, config::meta::pipeline::Pipeline};

use crate::authz::QuerySource;

#[cfg(feature = "enterprise")]
#[derive(Debug, thiserror::Error)]
pub enum ReportSourceError {
    #[error("dashboard {folder}/{dashboard_id} of the report not found")]
    DashboardMissing {
        folder: String,
        dashboard_id: String,
    },
    #[error(transparent)]
    Load(#[from] anyhow::Error),
}

#[cfg(feature = "enterprise")]
impl From<ReportSourceError> for Response {
    fn from(error: ReportSourceError) -> Self {
        use common::meta::http::HttpResponse as MetaHttpResponse;

        match error {
            ReportSourceError::DashboardMissing { .. } => {
                MetaHttpResponse::not_found(error.to_string())
            }
            ReportSourceError::Load(e) => MetaHttpResponse::internal_error(e.to_string()),
        }
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

pub fn dashboard_sources(
    org_id: &str,
    dashboard: &serde_json::Value,
    variables: &[(String, String)],
) -> Vec<QuerySource> {
    let values = variable_values(dashboard, variables);
    let mut sources = Vec::new();
    for panel in dashboard_panels(dashboard) {
        sources.extend(panel_sources(org_id, panel, &values));
    }
    let list = dashboard
        .pointer("/variables/list")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten();
    for variable in list {
        if variable.get("type").and_then(|t| t.as_str()) != Some("query_values") {
            continue;
        }
        let Some(data) = variable.get("query_data") else {
            continue;
        };
        let stream_type = json_stream_type(data, StreamType::Logs);
        if let Some(source) = named_stream_source(org_id, data, stream_type, &values) {
            sources.push(source);
        }
    }
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

#[cfg(feature = "enterprise")]
pub async fn report_sources(
    org_id: &str,
    report: &config::meta::dashboards::reports::Report,
) -> Result<Vec<QuerySource>, ReportSourceError> {
    let mut sources = Vec::new();
    for dashboard in &report.dashboards {
        sources.push(QuerySource::Dashboard {
            org_id: org_id.to_string(),
            folder: dashboard.folder.clone(),
            dashboard_id: dashboard.dashboard.clone(),
        });
        let variables: Vec<(String, String)> = dashboard
            .variables
            .iter()
            .map(|v| (v.key.clone(), v.value.clone()))
            .collect();
        let stored = infra::table::dashboards::get_from_folder_rw(
            org_id,
            &dashboard.folder,
            &dashboard.dashboard,
        )
        .await
        .map_err(anyhow::Error::from)?
        .ok_or_else(|| ReportSourceError::DashboardMissing {
            folder: dashboard.folder.clone(),
            dashboard_id: dashboard.dashboard.clone(),
        })?;
        let json = dashboard_json(&stored).ok_or_else(|| unusable_dashboard(&stored))?;
        sources.extend(dashboard_sources(org_id, &json, &variables));
    }
    Ok(sources)
}

#[cfg(feature = "enterprise")]
pub async fn enabled_report_variables(
    org_id: &str,
    dashboard_id: &str,
) -> Result<Vec<Vec<(String, String)>>, anyhow::Error> {
    use config::meta::dashboards::reports::ReportListFilters;

    let filters = ReportListFilters {
        dashboard: Some(dashboard_id.to_string()),
        folder: None,
        destination_less: None,
        name_substring: None,
    };
    let rows = crate::dashboards::reports::list(org_id, filters, None)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows.into_iter().filter(|row| row.report_enabled) {
        let (_, report) = crate::dashboards::reports::get_by_id_rw(org_id, &row.report_id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        for dashboard in report
            .dashboards
            .iter()
            .filter(|d| d.dashboard == dashboard_id)
        {
            out.push(
                dashboard
                    .variables
                    .iter()
                    .map(|v| (v.key.clone(), v.value.clone()))
                    .collect(),
            );
        }
    }
    Ok(out)
}

/// Free when no enabled report renders the dashboard; `edited` is one panel unless whole.
#[cfg(feature = "enterprise")]
pub async fn guard_dashboard_edit(
    org_id: &str,
    user_id: &str,
    dashboard_id: &str,
    edited: &serde_json::Value,
    whole_dashboard: bool,
) -> Result<(), Response> {
    use common::meta::http::HttpResponse as MetaHttpResponse;

    let reports = enabled_report_variables(org_id, dashboard_id)
        .await
        .map_err(|e| MetaHttpResponse::internal_error(e.to_string()))?;
    if reports.is_empty() {
        return Ok(());
    }
    let stored = if whole_dashboard {
        serde_json::Value::Null
    } else {
        let Some((_, dashboard)) = infra::table::dashboards::get_by_id_rw(org_id, dashboard_id)
            .await
            .map_err(|e| MetaHttpResponse::internal_error(e.to_string()))?
        else {
            return Err(MetaHttpResponse::not_found("Dashboard not found"));
        };
        dashboard_json(&dashboard)
            .ok_or_else(|| MetaHttpResponse::internal_error(unusable_dashboard(&dashboard)))?
    };
    let mut sources = Vec::new();
    for variables in &reports {
        if whole_dashboard {
            sources.extend(dashboard_sources(org_id, edited, variables));
        } else {
            let values = variable_values(&stored, variables);
            sources.extend(panel_sources(org_id, edited, &values));
        }
    }
    guard_write(org_id, user_id, &sources).await
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

    let client = infra::db::get_orm_client_rw().await;
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

/// Reads the primary, which the enable or update about to run writes to.
#[cfg(feature = "enterprise")]
pub async fn stored_slo(org_id: &str, slo_id: &str) -> Result<Option<Slo>, anyhow::Error> {
    let client = infra::db::get_orm_client_rw().await;
    Ok(infra::table::slos::get(client, org_id, slo_id).await?)
}

#[cfg(feature = "enterprise")]
pub async fn is_org_admin(org_id: &str, user_id: &str) -> bool {
    let checker = crate::authz::active_checker();
    checker.is_root(user_id).await || checker.is_root_or_admin(org_id, user_id).await
}

/// Only a Root or Admin caller may give a new object an owner other than themself.
#[cfg(feature = "enterprise")]
pub async fn create_owner(org_id: &str, caller: &str, body_owner: Option<&str>) -> String {
    match body_owner.filter(|owner| !owner.is_empty()) {
        Some(owner) if owner != caller && is_org_admin(org_id, caller).await => owner.to_string(),
        _ => caller.to_string(),
    }
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

/// A failed load refuses the write: an unread object must never skip its check.
#[cfg(feature = "enterprise")]
pub async fn guard_loaded(
    org_id: &str,
    user_id: &str,
    loaded: Result<Option<Vec<QuerySource>>, anyhow::Error>,
) -> Result<(), Response> {
    use common::meta::http::HttpResponse as MetaHttpResponse;

    match loaded {
        Ok(Some(sources)) => guard_write(org_id, user_id, &sources).await,
        Ok(None) => Ok(()),
        Err(e) => Err(MetaHttpResponse::internal_error(e.to_string())),
    }
}

/// The bulk form of [`guard_loaded`]: a failed load is reported as that id's error.
#[cfg(feature = "enterprise")]
pub async fn loaded_denial_message(
    org_id: &str,
    user_id: &str,
    loaded: Result<Option<Vec<QuerySource>>, anyhow::Error>,
) -> Option<String> {
    match loaded {
        Ok(Some(sources)) => denial_message(org_id, user_id, &sources).await,
        Ok(None) => None,
        Err(e) => Some(e.to_string()),
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

/// A body that does not compile is left to the function save's own 400.
#[cfg(feature = "enterprise")]
pub async fn guard_vrl_function(org_id: &str, user_id: &str, source: &str) -> Result<(), Response> {
    use common::meta::http::HttpResponse as MetaHttpResponse;

    let tables = match transform::enrichment_tables_read(source, org_id) {
        Ok(tables) => tables,
        Err(_) if transform::compile_vrl_function(source, org_id).is_err() => return Ok(()),
        Err(e) => return Err(MetaHttpResponse::internal_error(e.to_string())),
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
            Err(e) => sources.push(QuerySource::Unparseable {
                source: "vrl_function".to_string(),
                error: e.to_string(),
            }),
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
fn unusable_dashboard(dashboard: &config::meta::dashboards::Dashboard) -> anyhow::Error {
    anyhow::anyhow!(
        "dashboard {} has no v{} body",
        dashboard.dashboard_id().unwrap_or_default(),
        dashboard.version
    )
}

fn dashboard_panels(dashboard: &serde_json::Value) -> Vec<&serde_json::Value> {
    let tabbed = dashboard
        .get("tabs")
        .and_then(|t| t.as_array())
        .into_iter()
        .flatten()
        .filter_map(|tab| tab.get("panels").and_then(|p| p.as_array()))
        .flatten();
    let flat = dashboard
        .get("panels")
        .and_then(|p| p.as_array())
        .into_iter()
        .flatten();
    tabbed.chain(flat).collect()
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
    use crate::authz::{Denial, resolve_query_sources};

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
    fn alert_vrl_that_is_not_base64_is_unparseable() {
        let mut alert = alert(QueryType::Custom);
        alert.query_condition.vrl_function = Some("%%%".to_string());
        let resolved = resolve_query_sources(&alert_sources("o1", &alert));
        assert!(matches!(
            resolved.unparseable.as_slice(),
            [Denial::Unparseable { .. }]
        ));
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

        let with_defaults = dashboard_sources("o1", &dashboard, &[]);
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
    fn v1_dashboards_keep_panels_at_the_top_level() {
        let dashboard = json!({"panels": [{"queries": [{"query": "SELECT * FROM flat"}]}]});
        assert_eq!(
            resolved_names(&dashboard_sources("o1", &dashboard, &[])),
            vec!["o1/logs/flat"]
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_failed_load_refuses_and_a_missing_object_checks_nothing() {
        let failed = || Err(anyhow::anyhow!("replica unavailable"));
        let resp = guard_loaded("o1", "u@example.com", failed())
            .await
            .unwrap_err();
        assert_eq!(resp.status(), axum::http::StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            loaded_denial_message("o1", "u@example.com", failed()).await,
            Some("replica unavailable".to_string())
        );
        assert!(guard_loaded("o1", "u@example.com", Ok(None)).await.is_ok());
        assert_eq!(
            loaded_denial_message("o1", "u@example.com", Ok(None)).await,
            None
        );
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn a_missing_report_dashboard_answers_404_and_a_failed_load_500() {
        use axum::http::StatusCode;

        let missing = ReportSourceError::DashboardMissing {
            folder: "f1".to_string(),
            dashboard_id: "d1".to_string(),
        };
        assert_eq!(
            missing.to_string(),
            "dashboard f1/d1 of the report not found"
        );
        assert_eq!(Response::from(missing).status(), StatusCode::NOT_FOUND);
        let failed = ReportSourceError::Load(anyhow::anyhow!("primary unavailable"));
        assert_eq!(
            Response::from(failed).status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
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
