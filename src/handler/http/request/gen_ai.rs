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
use std::collections::{BTreeMap, HashSet};

use axum::{
    Json,
    extract::{Path, Query},
    response::Response,
};
use config::meta::gen_ai::GenAiAgentMappingConfig;
#[cfg(feature = "enterprise")]
use config::meta::stream::StreamType;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::llm_evaluations::agents;
#[cfg(feature = "enterprise")]
pub use o2_enterprise::enterprise::llm_evaluations::agents::{
    AgentListQuery, GenAiAgentListItem, GenAiAgentListResponse,
};
#[cfg(not(feature = "enterprise"))]
use serde::{Deserialize, Serialize};
#[cfg(not(feature = "enterprise"))]
use utoipa::{IntoParams, ToSchema};

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::check_permissions;
use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::extractors::Headers,
};

#[cfg(not(feature = "enterprise"))]
#[derive(Debug, Deserialize, IntoParams)]
pub struct AgentListQuery {
    pub start_time: i64,
    pub end_time: i64,
    #[serde(default)]
    pub source_lookback_micros: Option<i64>,
}

#[cfg(not(feature = "enterprise"))]
#[derive(Debug, Clone, Serialize, ToSchema, PartialEq, Eq)]
pub struct GenAiAgentListItem {
    pub name: String,
    pub id: Option<String>,
    pub source_stream: String,
    pub source_stream_type: String,
}

#[cfg(not(feature = "enterprise"))]
#[derive(Debug, Serialize, ToSchema)]
pub struct GenAiAgentListResponse {
    pub agents: Vec<GenAiAgentListItem>,
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
    {
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

        let config =
            crate::service::db::system_settings::get_gen_ai_agent_mapping_config(&org_id).await;
        return MetaHttpResponse::json(config);
    }

    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (&org_id, &user_email);
        MetaHttpResponse::not_found("Gen-AI agent mapping is an enterprise feature")
    }
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
    {
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

        let config = match agents::validate_agent_mapping_config(body) {
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

    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (&org_id, &user_email, &body);
        MetaHttpResponse::not_found("Gen-AI agent mapping is an enterprise feature")
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
    {
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

        if let Err(e) = agents::validate_agent_list_query(&query) {
            return MetaHttpResponse::bad_request(e);
        }

        match load_scored_agent_list(&org_id, &query).await {
            Ok(response) => MetaHttpResponse::json(response),
            Err(e) => MetaHttpResponse::internal_error(format!("Failed to load agents: {e}")),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (&org_id, &user_email, &query);
        MetaHttpResponse::not_found("Gen-AI agents are an enterprise feature")
    }
}

#[cfg(feature = "enterprise")]
async fn load_scored_agent_list(
    org_id: &str,
    query: &AgentListQuery,
) -> anyhow::Result<GenAiAgentListResponse> {
    let scored_span_keys = load_scored_span_keys(org_id, query).await?;

    if scored_span_keys.is_empty() {
        return Ok(GenAiAgentListResponse { agents: vec![] });
    }

    let mapping =
        crate::service::db::system_settings::get_gen_ai_agent_mapping_config(org_id).await;
    let name_fields =
        agents::mapped_storage_fields("gen_ai_agent_name", &mapping.agent_name_fields);
    let id_fields = agents::mapped_storage_fields("gen_ai_agent_id", &mapping.agent_id_fields);
    let source_start = agents::source_start_time(query);
    let mut agent_items: BTreeMap<agents::AgentIdentityKey, GenAiAgentListItem> = BTreeMap::new();

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
        let available_name_fields = agents::available_fields(&name_fields, &schema_fields);
        let available_id_fields = agents::available_fields(&id_fields, &schema_fields);
        if available_name_fields.is_empty() && available_id_fields.is_empty() {
            continue;
        }

        let Some(agent_sql) = agents::build_agent_source_sql(
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
            agents::MAX_AGENT_ROWS_PER_STREAM,
        )
        .await?;

        for row in result.hits {
            let item = agents::agent_list_item_from_row(&source, &row);
            let key = agents::agent_identity_key(
                &item.name,
                item.id.as_deref(),
                &item.source_stream,
                &item.source_stream_type,
            );
            agent_items.entry(key).or_insert(item);
        }
    }

    Ok(GenAiAgentListResponse {
        agents: agent_items.into_values().collect(),
    })
}

#[cfg(feature = "enterprise")]
async fn load_scored_span_keys(
    org_id: &str,
    query: &AgentListQuery,
) -> anyhow::Result<BTreeMap<agents::SourceKey, agents::ScoredSourceIds>> {
    let result = run_search(
        org_id,
        StreamType::Logs,
        agents::scored_span_keys_sql(),
        query.start_time,
        query.end_time,
        agents::MAX_SCORED_SPAN_KEYS as i64,
    )
    .await?;

    Ok(agents::collect_scored_span_keys(result.hits))
}

#[cfg(feature = "enterprise")]
async fn run_search(
    org_id: &str,
    stream_type: StreamType,
    sql: String,
    start_time: i64,
    end_time: i64,
    size: i64,
) -> anyhow::Result<config::meta::search::Response> {
    let trace_id = config::ider::generate_trace_id();
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
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
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        search_type: Some(config::meta::search::SearchEventType::UI),
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
