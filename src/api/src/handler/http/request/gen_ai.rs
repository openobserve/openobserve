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
use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, Query},
    response::Response,
};
use config::meta::gen_ai::GenAiAgentMappingConfig;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::llm_evaluations::agents;
#[cfg(feature = "enterprise")]
pub use o2_enterprise::enterprise::llm_evaluations::agents::{
    AgentListQuery, ClearAgentRegistryQuery, ClearAgentRegistryResponse, GenAiAgentListItem,
    GenAiAgentListResponse,
};
use openobserve_core::auth::UserEmail;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::check_permissions;
#[cfg(not(feature = "enterprise"))]
use serde::{Deserialize, Serialize};
#[cfg(not(feature = "enterprise"))]
use utoipa::{IntoParams, ToSchema};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse, handler::http::extractors::Headers,
};

#[cfg(not(feature = "enterprise"))]
#[derive(Debug, Deserialize, IntoParams)]
pub struct AgentListQuery {
    #[serde(default)]
    pub start_time: Option<i64>,
    #[serde(default)]
    pub end_time: Option<i64>,
    #[serde(default)]
    pub from: usize,
    #[serde(default = "default_agent_list_size")]
    pub size: usize,
    #[serde(default)]
    pub source_stream: Option<String>,
    #[serde(default)]
    pub source_stream_type: Option<String>,
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
    pub total: usize,
}

#[cfg(not(feature = "enterprise"))]
fn default_agent_list_size() -> usize {
    10_000
}

#[cfg(not(feature = "enterprise"))]
#[derive(Debug, Deserialize, IntoParams)]
pub struct ClearAgentRegistryQuery {
    #[serde(default)]
    pub source_stream: Option<String>,
    #[serde(default)]
    pub source_stream_type: Option<String>,
}

#[cfg(not(feature = "enterprise"))]
#[derive(Debug, Serialize, ToSchema)]
pub struct ClearAgentRegistryResponse {
    pub source_stream: Option<String>,
    pub source_stream_type: Option<String>,
    pub deleted_count: u64,
    pub cleared_buffer_count: usize,
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

        let config = db::system_settings::get_gen_ai_agent_mapping_config(&org_id).await;
        MetaHttpResponse::json(config)
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

        match db::system_settings::set_gen_ai_agent_mapping_config(
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
    operation_id = "ListGenAiAgents",
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        AgentListQuery,
    ),
    responses(
        (status = 200, description = "Discovered Gen-AI agents", body = GenAiAgentListResponse),
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
        if let Err(e) = agents::validate_agent_list_query(&query) {
            return MetaHttpResponse::bad_request(e);
        }

        if let (Some(source_stream), Some(source_stream_type)) =
            (&query.source_stream, &query.source_stream_type)
            && !can_read_stream(
                &org_id,
                &user_email.user_id,
                source_stream,
                source_stream_type,
            )
            .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }

        match load_agent_list(&org_id, &user_email.user_id, &query).await {
            Ok(response) => MetaHttpResponse::json(response),
            Err(e) => {
                log::error!("Failed to load Gen-AI agents for org {org_id}: {e}");
                MetaHttpResponse::internal_error("Failed to load agents")
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (&org_id, &user_email, &query);
        MetaHttpResponse::not_found("Gen-AI agents are an enterprise feature")
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/settings/gen_ai/agent_registry",
    tag = "GenAI Settings",
    operation_id = "ClearGenAiAgentRegistry",
    params(
        ("org_id" = String, Path, description = "Organization ID"),
        ClearAgentRegistryQuery,
    ),
    responses(
        (status = 200, description = "Cleared Gen-AI agent registry rows", body = ClearAgentRegistryResponse),
        (status = 400, description = "Invalid query"),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error")
    ),
    security(("Authorization" = []))
)]
pub async fn clear_agent_registry(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(query): Query<ClearAgentRegistryQuery>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if !check_permissions(
            &org_id,
            &org_id,
            &user_email.user_id,
            "settings",
            "DELETE",
            None,
            true,
            false,
            false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }

        if let Err(e) = agents::validate_clear_agent_registry_query(&query) {
            return MetaHttpResponse::bad_request(e);
        }

        let (deleted_count, cleared_buffer_count) =
            match o2_enterprise::enterprise::llm_evaluations::agent_registry::clear_registry(
                &org_id,
                query.source_stream.as_deref(),
                query.source_stream_type.as_deref(),
            )
            .await
            {
                Ok(count) => count,
                Err(e) => {
                    log::error!("Failed to clear Gen-AI agent registry for org {org_id}: {e}");
                    return MetaHttpResponse::internal_error("Failed to clear agent registry");
                }
            };

        MetaHttpResponse::json(ClearAgentRegistryResponse {
            source_stream: query.source_stream,
            source_stream_type: query.source_stream_type,
            deleted_count,
            cleared_buffer_count,
        })
    }

    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (&org_id, &user_email, &query);
        MetaHttpResponse::not_found("Gen-AI agent registry is an enterprise feature")
    }
}

#[cfg(feature = "enterprise")]
async fn load_agent_list(
    org_id: &str,
    user_id: &str,
    query: &AgentListQuery,
) -> anyhow::Result<GenAiAgentListResponse> {
    let rows = infra::table::gen_ai_agents::list(
        org_id,
        &infra::table::gen_ai_agents::AgentListFilter {
            start_time: query.start_time,
            end_time: query.end_time,
            source_stream: query.source_stream.clone(),
            source_stream_type: query.source_stream_type.clone(),
        },
    )
    .await?;

    let mut permission_cache: HashMap<(String, String), bool> = HashMap::new();
    let mut items = Vec::with_capacity(rows.len());

    for row in rows {
        let permission_key = (row.stream_type.clone(), row.stream_name.clone());
        let allowed = match permission_cache.get(&permission_key) {
            Some(allowed) => *allowed,
            None => {
                let allowed =
                    can_read_stream(org_id, user_id, &row.stream_name, &row.stream_type).await;
                permission_cache.insert(permission_key, allowed);
                allowed
            }
        };
        if !allowed {
            continue;
        }
        if let Some(item) = agent_item_from_registry_row(row) {
            items.push(item);
        }
    }

    let total = items.len();
    let size = query.size.min(
        o2_enterprise::enterprise::common::config::get_config()
            .gen_ai_agent_registry
            .api_max_page_size,
    );
    let agents = items
        .into_iter()
        .skip(query.from)
        .take(size)
        .collect::<Vec<_>>();

    Ok(GenAiAgentListResponse { agents, total })
}

#[cfg(feature = "enterprise")]
async fn can_read_stream(
    org_id: &str,
    user_id: &str,
    source_stream: &str,
    source_stream_type: &str,
) -> bool {
    check_permissions(
        source_stream,
        org_id,
        user_id,
        source_stream_type,
        "GET",
        None,
        false,
        false,
        true,
    )
    .await
}

#[cfg(feature = "enterprise")]
fn agent_item_from_registry_row(
    row: infra::table::entity::gen_ai_agents::Model,
) -> Option<GenAiAgentListItem> {
    let name = row.agent_name.clone().or_else(|| row.agent_id.clone())?;

    Some(GenAiAgentListItem {
        name,
        id: row.agent_id,
        source_stream: row.stream_name,
        source_stream_type: row.stream_type,
    })
}
