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

use std::collections::{BTreeMap, BTreeSet, HashSet};

use axum::{
    Json,
    extract::{Path, Query},
    response::Response,
};
use config::meta::{
    gen_ai::GenAiAgentMappingConfig, search, self_reporting::llm_scores::LLM_SCORES_STREAM,
    stream::StreamType,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::check_permissions;
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::extractors::Headers,
};

const DEFAULT_SOURCE_LOOKBACK_MICROS: i64 = 24 * 60 * 60 * 1_000_000;
const MAX_SCORED_SPAN_KEYS: usize = 10_000;
const MAX_AGENT_ROWS_PER_STREAM: i64 = 1_000;

#[derive(Debug, Deserialize, IntoParams)]
pub struct AgentListQuery {
    pub start_time: i64,
    pub end_time: i64,
    #[serde(default)]
    pub source_lookback_micros: Option<i64>,
}

#[derive(Debug, Clone, Serialize, ToSchema, PartialEq, Eq)]
pub struct GenAiAgentListItem {
    pub name: String,
    pub id: Option<String>,
    pub source_stream: String,
    pub source_stream_type: String,
}

#[derive(Debug, Clone, Serialize, ToSchema, PartialEq, Eq)]
pub struct GenAiSourceStreamItem {
    pub name: String,
    pub stream_type: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GenAiAgentListResponse {
    pub agents: Vec<GenAiAgentListItem>,
    pub source_streams: Vec<GenAiSourceStreamItem>,
}

#[utoipa::path(
    get,
    path = "/{org_id}/settings/gen_ai/agent_mapping",
    tag = "GenAI Settings",
    operation_id = "GetGenAiAgentMapping",
    params(("org_id" = String, Path, description = "Organization ID")),
    responses(
        (status = 200, description = "Gen-AI agent mapping config", body = GenAiAgentMappingConfig),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error")
    ),
    security(("Authorization" = []))
)]
pub async fn get_agent_mapping(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &org_id,
        &org_id,
        &user_email.user_id,
        "settings",
        "GET",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }

    #[cfg(not(feature = "enterprise"))]
    let _ = &user_email;

    let config =
        crate::service::db::system_settings::get_gen_ai_agent_mapping_config(&org_id).await;
    MetaHttpResponse::json(config)
}

#[utoipa::path(
    put,
    path = "/{org_id}/settings/gen_ai/agent_mapping",
    tag = "GenAI Settings",
    operation_id = "SaveGenAiAgentMapping",
    params(("org_id" = String, Path, description = "Organization ID")),
    request_body(content = GenAiAgentMappingConfig, description = "Gen-AI agent mapping config"),
    responses(
        (status = 200, description = "Gen-AI agent mapping config saved", body = GenAiAgentMappingConfig),
        (status = 400, description = "Invalid config"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error")
    ),
    security(("Authorization" = []))
)]
pub async fn save_agent_mapping(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<GenAiAgentMappingConfig>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &org_id,
        &org_id,
        &user_email.user_id,
        "settings",
        "PUT",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }

    let config = match body.normalize_and_validate() {
        Ok(config) => config,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };

    match crate::service::db::system_settings::set_gen_ai_agent_mapping_config(
        &org_id,
        &user_email.user_id,
        config.clone(),
    )
    .await
    {
        Ok(_) => MetaHttpResponse::json(config),
        Err(e) => MetaHttpResponse::internal_error(format!("Failed to save config: {e}")),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/gen_ai/agents",
    tag = "GenAI Settings",
    operation_id = "ListScoredGenAiAgents",
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        AgentListQuery,
    ),
    responses(
        (status = 200, description = "Agents referenced by LLM score records", body = GenAiAgentListResponse),
        (status = 400, description = "Invalid time range"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error")
    ),
    security(("Authorization" = []))
)]
pub async fn list_scored_agents(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(query): Query<AgentListQuery>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &org_id,
        &org_id,
        &user_email.user_id,
        "traces",
        "GET",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }

    #[cfg(not(feature = "enterprise"))]
    let _ = &user_email;

    if query.start_time <= 0 || query.end_time <= query.start_time {
        return MetaHttpResponse::bad_request("Invalid time range");
    }

    match load_scored_agent_list(&org_id, &query).await {
        Ok(response) => MetaHttpResponse::json(response),
        Err(e) => MetaHttpResponse::internal_error(format!("Failed to load agents: {e}")),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct SourceKey {
    stream: String,
    stream_type: String,
}

#[derive(Debug, Default)]
struct ScoredSourceIds {
    trace_ids: BTreeSet<String>,
}

async fn load_scored_agent_list(
    org_id: &str,
    query: &AgentListQuery,
) -> anyhow::Result<GenAiAgentListResponse> {
    let scored_span_keys = load_scored_span_keys(org_id, query).await?;
    let source_streams = source_stream_items(&scored_span_keys);

    if scored_span_keys.is_empty() {
        return Ok(GenAiAgentListResponse {
            agents: vec![],
            source_streams,
        });
    }

    let mapping =
        crate::service::db::system_settings::get_gen_ai_agent_mapping_config(org_id).await;
    let name_fields = mapped_storage_fields("gen_ai_agent_name", &mapping.agent_name_fields);
    let id_fields = mapped_storage_fields("gen_ai_agent_id", &mapping.agent_id_fields);

    let source_start = query.start_time.saturating_sub(
        query
            .source_lookback_micros
            .unwrap_or(DEFAULT_SOURCE_LOOKBACK_MICROS)
            .max(0),
    );
    let mut agents = BTreeSet::new();

    for (source, source_ids) in scored_span_keys {
        let source_stream_type = StreamType::from(source.stream_type.as_str());
        let Ok(schema) = infra::schema::get(org_id, &source.stream, source_stream_type).await
        else {
            continue;
        };
        let schema_fields: HashSet<String> = schema
            .fields()
            .iter()
            .map(|field| field.name().to_string())
            .collect();
        let available_name_fields = available_fields(&name_fields, &schema_fields);
        let available_id_fields = available_fields(&id_fields, &schema_fields);
        if available_name_fields.is_empty() && available_id_fields.is_empty() {
            continue;
        }

        let Some(agent_sql) = build_agent_source_sql(
            &source.stream,
            &source_ids.trace_ids,
            &available_name_fields,
            &available_id_fields,
        ) else {
            continue;
        };
        let result = run_search(
            org_id,
            source_stream_type,
            agent_sql,
            source_start,
            query.end_time,
            MAX_AGENT_ROWS_PER_STREAM,
        )
        .await?;

        for row in result.hits {
            let name =
                string_field(&row, "agent_name").unwrap_or_else(|| "Unknown Agent".to_string());
            let id = string_field(&row, "agent_id");
            agents.insert((name, id, source.stream.clone(), source.stream_type.clone()));
        }
    }

    Ok(GenAiAgentListResponse {
        agents: agents
            .into_iter()
            .map(
                |(name, id, source_stream, source_stream_type)| GenAiAgentListItem {
                    name,
                    id,
                    source_stream,
                    source_stream_type,
                },
            )
            .collect(),
        source_streams,
    })
}

fn source_stream_items(
    scored_span_keys: &BTreeMap<SourceKey, ScoredSourceIds>,
) -> Vec<GenAiSourceStreamItem> {
    scored_span_keys
        .keys()
        .map(|source| GenAiSourceStreamItem {
            name: source.stream.clone(),
            stream_type: source.stream_type.clone(),
        })
        .collect()
}

async fn load_scored_span_keys(
    org_id: &str,
    query: &AgentListQuery,
) -> anyhow::Result<BTreeMap<SourceKey, ScoredSourceIds>> {
    let sql = format!(
        "SELECT source_stream, source_stream_type, trace_id, span_id FROM \"{}\" \
         WHERE source_stream IS NOT NULL AND source_stream != '' \
         AND ((trace_id IS NOT NULL AND trace_id != '') OR (span_id IS NOT NULL AND span_id != '')) \
         GROUP BY source_stream, source_stream_type, trace_id, span_id LIMIT {}",
        LLM_SCORES_STREAM, MAX_SCORED_SPAN_KEYS
    );
    let result = run_search(
        org_id,
        StreamType::Logs,
        sql,
        query.start_time,
        query.end_time,
        MAX_SCORED_SPAN_KEYS as i64,
    )
    .await?;

    let mut sources: BTreeMap<SourceKey, ScoredSourceIds> = BTreeMap::new();
    for row in result.hits {
        let Some(stream) = string_field(&row, "source_stream") else {
            continue;
        };
        let stream_type = string_field(&row, "source_stream_type")
            .unwrap_or_else(|| StreamType::Traces.as_str().to_string());
        let source_ids = sources
            .entry(SourceKey {
                stream,
                stream_type,
            })
            .or_default();
        if let Some(trace_id) = string_field(&row, "trace_id") {
            source_ids.trace_ids.insert(trace_id);
        }
    }

    Ok(sources)
}

async fn run_search(
    org_id: &str,
    stream_type: StreamType,
    sql: String,
    start_time: i64,
    end_time: i64,
    size: i64,
) -> anyhow::Result<search::Response> {
    let trace_id = config::ider::generate_trace_id();
    let req = search::Request {
        query: search::Query {
            sql,
            from: 0,
            size,
            start_time,
            end_time,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            action_id: None,
            skip_wal: false,
            sampling_config: None,
            sampling_ratio: None,
            streaming_output: false,
            streaming_id: None,
            histogram_interval: 0,
            timezone: None,
        },
        encoding: search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        search_type: Some(search::SearchEventType::UI),
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: None,
    };

    crate::service::search::cache::search(
        &trace_id,
        org_id,
        stream_type,
        None,
        &req,
        "".to_string(),
        false,
        None,
        false,
    )
    .await
    .map_err(|e| anyhow::anyhow!(e.to_string()))
}

fn mapped_storage_fields(
    standard_storage_field: &str,
    configured_fields: &[String],
) -> Vec<String> {
    let mut fields = vec![standard_storage_field.to_string()];
    for field in configured_fields {
        let storage_field = field.replace('.', "_");
        if !storage_field.is_empty() && !fields.contains(&storage_field) {
            fields.push(storage_field);
        }
    }
    fields
}

fn available_fields(fields: &[String], schema_fields: &HashSet<String>) -> Vec<String> {
    fields
        .iter()
        .filter(|field| schema_fields.contains(field.as_str()))
        .cloned()
        .collect()
}

fn build_agent_source_sql(
    stream: &str,
    trace_ids: &BTreeSet<String>,
    name_fields: &[String],
    id_fields: &[String],
) -> Option<String> {
    if trace_ids.is_empty() {
        return None;
    }

    let name_expr = coalesce_expr(name_fields).unwrap_or_else(|| "NULL".to_string());
    let id_expr = coalesce_expr(id_fields).unwrap_or_else(|| "NULL".to_string());
    let trace_filter = format!("trace_id IN ({})", quoted_string_list(trace_ids));

    Some(format!(
        "SELECT {name_expr} AS agent_name, {id_expr} AS agent_id FROM \"{}\" \
         WHERE {trace_filter} GROUP BY agent_name, agent_id LIMIT {MAX_AGENT_ROWS_PER_STREAM}",
        escape_sql_identifier(stream),
    ))
}

fn quoted_string_list(values: &BTreeSet<String>) -> String {
    values
        .iter()
        .map(|value| format!("'{}'", escape_sql_string(value)))
        .collect::<Vec<_>>()
        .join(", ")
}

fn coalesce_expr(fields: &[String]) -> Option<String> {
    if fields.is_empty() {
        return None;
    }
    Some(format!(
        "COALESCE({})",
        fields
            .iter()
            .map(|field| format!(
                "NULLIF(CAST(\"{}\" AS VARCHAR), '')",
                escape_sql_identifier(field)
            ))
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn string_field(row: &serde_json::Value, field: &str) -> Option<String> {
    let value = row.get(field)?.as_str()?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn escape_sql_identifier(value: &str) -> String {
    value.replace('"', "\"\"")
}

fn escape_sql_string(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mapped_storage_fields_converts_mapping_fields() {
        let fields = mapped_storage_fields(
            "gen_ai_agent_name",
            &["agent.name".to_string(), "custom_agent".to_string()],
        );

        assert_eq!(
            fields,
            vec!["gen_ai_agent_name", "agent_name", "custom_agent"]
        );
    }

    #[test]
    fn test_build_agent_source_sql_escapes_inputs() {
        let sql = build_agent_source_sql(
            "trace\"stream",
            &BTreeSet::from(["trace'1".to_string()]),
            &["gen_ai_agent_name".to_string()],
            &[],
        )
        .unwrap();

        assert!(sql.contains("\"trace\"\"stream\""));
        assert!(sql.contains("trace_id IN ('trace''1')"));
        assert!(!sql.contains("span_id IN"));
        assert!(sql.contains("agent_name"));
    }

    #[test]
    fn test_build_agent_source_sql_requires_trace_ids() {
        let sql = build_agent_source_sql(
            "default",
            &BTreeSet::new(),
            &["gen_ai_agent_name".to_string()],
            &[],
        );

        assert!(sql.is_none());
    }

    #[test]
    fn test_source_stream_items_are_derived_from_scored_span_sources() {
        let scored_span_keys = BTreeMap::from([(
            SourceKey {
                stream: "default".to_string(),
                stream_type: "traces".to_string(),
            },
            ScoredSourceIds {
                trace_ids: BTreeSet::from(["trace-1".to_string()]),
            },
        )]);

        let source_streams = source_stream_items(&scored_span_keys);

        assert_eq!(
            source_streams,
            vec![GenAiSourceStreamItem {
                name: "default".to_string(),
                stream_type: "traces".to_string(),
            }]
        );
    }

    #[test]
    fn test_agent_item_serializes_missing_id_as_null() {
        let item = GenAiAgentListItem {
            name: "agent-a".to_string(),
            id: None,
            source_stream: "default".to_string(),
            source_stream_type: "traces".to_string(),
        };

        let value = serde_json::to_value(item).unwrap();

        assert_eq!(value["id"], serde_json::Value::Null);
    }
}
