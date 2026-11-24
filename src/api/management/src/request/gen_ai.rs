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
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    future::Future,
};

use axum::{
    Json,
    extract::{Path, Query},
    response::Response,
};
use config::meta::gen_ai::{GenAiAgentMappingConfig, HarnessStripRequest, HarnessStripResponse};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::llm_evaluations::agents;
#[cfg(feature = "enterprise")]
pub use o2_enterprise::enterprise::llm_evaluations::agents::{
    AgentListQuery, ClearAgentRegistryQuery, ClearAgentRegistryResponse, GenAiAgentListItem,
    GenAiAgentListResponse,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::check_permissions;
#[cfg(feature = "enterprise")]
use openobserve_core::authz::{
    StreamAccessChecker,
    list::{
        AuthzUnavailable, Bypass, Identity, LegacyChecks, ObjectRef, ObjectsQuery, SITE_GEN_AI,
        TodayChecks, authz_unavailable_response, listable_stream_type, objects_in_mode,
    },
};
#[cfg(not(feature = "enterprise"))]
use serde::{Deserialize, Serialize};
#[cfg(not(feature = "enterprise"))]
use utoipa::{IntoParams, ToSchema};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

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
    pub env: Option<String>,
    pub version: Option<String>,
    pub first_seen: Option<i64>,
    pub last_seen: Option<i64>,
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
    context_path = "/api",
    tag = "GenAI Settings",
    operation_id = "GetGenAiAgentMapping",
    params(("org_id" = String, Path, description = "Organization ID")),
    responses(
        (status = 200, description = "Gen-AI agent mapping config", body = GenAiAgentMappingConfig),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Internal server error")
    ),
    security(("Authorization" = [])),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "GenAI Settings", "operation": "list"}))
    )
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

        // Settings editor shows the user's SAVED config (empty when none) — not
        // the effective defaults; "Apply defaults" fetches the template separately.
        let config = db::system_settings::get_saved_gen_ai_agent_mapping_config(&org_id).await;
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
    context_path = "/api",
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
    security(("Authorization" = [])),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "GenAI Settings", "operation": "update"}))
    )
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

/// Hide harness text in messages with the same code the Sessions list uses.
#[utoipa::path(
    post,
    path = "/{org_id}/settings/gen_ai/harness_strip",
    context_path = "/api",
    tag = "GenAI Settings",
    operation_id = "StripGenAiHarnessText",
    params(("org_id" = String, Path, description = "Organization ID")),
    request_body(content = HarnessStripRequest, description = "Harness patterns and the messages to hide them in"),
    responses(
        (status = 200, description = "Each message with its harness text hidden", body = HarnessStripResponse),
        (status = 400, description = "Invalid pattern or too many messages"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden")
    ),
    security(("Authorization" = [])),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false})),
        ("x-o2-ratelimit" = json!({"module": "GenAI Settings", "operation": "get"}))
    )
)]
pub async fn strip_harness_text(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(body): Json<HarnessStripRequest>,
) -> Response {
    // Reading the saved patterns needs settings read access; trying them needs the same.
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
    }
    #[cfg(not(feature = "enterprise"))]
    let _ = (&org_id, &user_email);

    match body.strip() {
        Ok(response) => MetaHttpResponse::json(response),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/gen_ai/agents",
    context_path = "/api",
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
        (status = 500, description = "Internal server error"),
        (status = 503, description = "Permission service unavailable")
    ),
    security(("Authorization" = [])),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true})),
        ("x-o2-ratelimit" = json!({"module": "GenAI Settings", "operation": "list"}))
    )
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
            Err(e) => agent_list_error_response(&org_id, e),
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
    context_path = "/api",
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
    security(("Authorization" = [])),
    extensions(
        ("x-o2-mcp" = json!({"enabled": true, "requires_confirmation": true})),
        ("x-o2-ratelimit" = json!({"module": "GenAI Settings", "operation": "delete"}))
    )
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
fn agent_list_error_response(org_id: &str, error: anyhow::Error) -> Response {
    if let Some(error) = error.downcast_ref::<AuthzUnavailable>() {
        return authz_unavailable_response(*error);
    }
    log::error!("Failed to load Gen-AI agents for org {org_id}: {error}");
    MetaHttpResponse::internal_error("Failed to load agents")
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

    let pairs: Vec<_> = rows
        .iter()
        .map(|row| (row.stream_type.clone(), row.stream_name.clone()))
        .collect();
    let checker = openobserve_core::authz::active_checker();
    let permission_cache = agent_stream_permissions_with(
        checker.as_ref(),
        &TodayChecks,
        org_id,
        user_id,
        &pairs,
        |stream_type, name| can_read_stream(org_id, user_id, name, stream_type),
    )
    .await?;
    let mut items = Vec::with_capacity(rows.len());

    for row in rows {
        let permission_key = (row.stream_type.clone(), row.stream_name.clone());
        if permission_cache.get(&permission_key) != Some(&true) {
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
fn agent_stream_query<'a>(org_id: &'a str, user_id: &'a str) -> ObjectsQuery<'a> {
    ObjectsQuery {
        site: SITE_GEN_AI,
        org_id,
        user_id,
        stream_types: &[],
        permission: "GET",
        use_all_org: false,
        use_self_parent: true,
        use_self_context: false,
        parent_id: "",
        bypass: Bypass::RbacOffOrRoot,
        identity: Identity::StoredEmail,
        prelude: None,
    }
}

#[cfg(feature = "enterprise")]
fn agent_stream_object<'a>(stream_type: &str, name: &'a str) -> Option<ObjectRef<'a>> {
    Some(ObjectRef {
        id: name,
        stream_type: listable_stream_type(stream_type)?,
        ofga_id: Cow::Borrowed(name),
    })
}

#[cfg(feature = "enterprise")]
async fn agent_stream_permissions_with<'a, F, Fut>(
    checker: &dyn StreamAccessChecker,
    legacy: &dyn LegacyChecks,
    org_id: &str,
    user_id: &str,
    pairs: &'a [(String, String)],
    fallback: F,
) -> Result<HashMap<(String, String), bool>, AuthzUnavailable>
where
    F: Fn(&'a str, &'a str) -> Fut + Send + Sync,
    Fut: Future<Output = bool> + Send,
{
    let query = agent_stream_query(org_id, user_id);
    let mut seen = HashSet::new();
    let objects: Vec<_> = pairs
        .iter()
        .filter(|pair| seen.insert(*pair))
        .filter_map(|(stream_type, name)| agent_stream_object(stream_type, name))
        .collect();
    let mut permission_cache = HashMap::new();
    let readable = objects_in_mode(checker, &query, &objects, || async {
        permission_cache = legacy_agent_stream_permissions(legacy, &query, pairs, &fallback).await;
        Some(
            objects
                .iter()
                .filter(|object| {
                    permission_cache.get(&(object.stream_type.to_string(), object.id.to_string()))
                        == Some(&true)
                })
                .map(|object| (object.stream_type, object.id.to_string()))
                .collect(),
        )
    })
    .await?;
    for (stream_type, name) in pairs {
        let key = (stream_type.clone(), name.clone());
        if permission_cache.contains_key(&key) {
            continue;
        }
        let allowed = match agent_stream_object(stream_type, name) {
            Some(object) => readable.as_ref().is_none_or(|streams| {
                streams.contains(&(object.stream_type, object.id.to_string()))
            }),
            None => fallback_agent_stream(&fallback, stream_type, name).await,
        };
        permission_cache.insert(key, allowed);
    }
    Ok(permission_cache)
}

#[cfg(feature = "enterprise")]
async fn legacy_agent_stream_permissions<'a, F, Fut>(
    checks: &dyn LegacyChecks,
    query: &ObjectsQuery<'_>,
    pairs: &'a [(String, String)],
    fallback: &F,
) -> HashMap<(String, String), bool>
where
    F: Fn(&'a str, &'a str) -> Fut + Sync,
    Fut: Future<Output = bool> + Send,
{
    let mut permission_cache = HashMap::new();
    for (stream_type, name) in pairs {
        let key = (stream_type.clone(), name.clone());
        if permission_cache.contains_key(&key) {
            continue;
        }
        let allowed = match agent_stream_object(stream_type, name) {
            Some(object) => {
                checks
                    .object(query.org_id, query.user_id, query, &object)
                    .await
            }
            None => fallback_agent_stream(fallback, stream_type, name).await,
        };
        permission_cache.insert(key, allowed);
    }
    permission_cache
}

#[cfg(feature = "enterprise")]
async fn fallback_agent_stream<'a, F, Fut>(
    fallback: &F,
    stream_type: &'a str,
    name: &'a str,
) -> bool
where
    F: Fn(&'a str, &'a str) -> Fut + Sync,
    Fut: Future<Output = bool> + Send,
{
    config::metrics::authz::AUTHZ_FALLBACK_CHECKS_TOTAL
        .with_label_values(&[SITE_GEN_AI])
        .inc();
    fallback(stream_type, name).await
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
        env: row.env,
        version: row.agent_version,
        first_seen: Some(row.first_seen),
        last_seen: Some(row.last_seen),
    })
}

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use std::{future::ready, sync::Mutex};

    use config::meta::stream::StreamType;
    use openobserve_core::authz::{
        FakeStreamChecker, TypedStream,
        list::{CheckerChecks, ListMode, UnavailableReason},
        within_budget,
    };

    use super::*;

    const ORG: &str = "gen_ai_list_org";

    fn stream_pairs(entries: &[(&str, &str)]) -> Vec<(String, String)> {
        entries
            .iter()
            .map(|(stream_type, name)| (stream_type.to_string(), name.to_string()))
            .collect()
    }

    fn grant(fake: &FakeStreamChecker, user: &str, stream_type: StreamType, name: &str) {
        fake.grant_read(
            user,
            &TypedStream {
                org_id: ORG.to_string(),
                stream_type,
                name: name.to_string(),
            },
        );
    }

    fn deny_fallback(_: &str, _: &str) -> std::future::Ready<bool> {
        ready(false)
    }

    #[tokio::test]
    async fn on_matches_legacy_for_user_custom_editor_and_admin_with_org_id() {
        let pairs = stream_pairs(&[
            ("logs", "allowed"),
            ("logs", "denied"),
            ("metrics", "allowed"),
            ("metrics", "denied"),
            ("logs", "allowed"),
        ]);
        for (user, role) in [
            ("gen-ai-user@example.com", "user"),
            ("gen-ai-custom@example.com", "custom"),
            ("gen-ai-editor@example.com", "editor"),
            (ORG, "admin"),
        ] {
            let fake = FakeStreamChecker::default();
            fake.set_role(ORG, user, role);
            if matches!(role, "user" | "custom") {
                grant(&fake, user, StreamType::Logs, "allowed");
                grant(&fake, user, StreamType::Metrics, "allowed");
            }
            let legacy = within_budget(
                4,
                legacy_agent_stream_permissions(
                    &CheckerChecks(&fake),
                    &agent_stream_query(ORG, user),
                    &pairs,
                    &deny_fallback,
                ),
            )
            .await;
            fake.set_list_mode(user, ListMode::On);
            let actual = within_budget(
                7,
                agent_stream_permissions_with(
                    &fake,
                    &CheckerChecks(&fake),
                    ORG,
                    user,
                    &pairs,
                    deny_fallback,
                ),
            )
            .await
            .unwrap();
            assert_eq!(actual, legacy, "{role}");
            let allowed = actual.values().filter(|allowed| **allowed).count();
            let expected = match role {
                "editor" => 4,
                "admin" => 0,
                _ => 2,
            };
            assert_eq!(allowed, expected, "{role}");
        }
    }

    #[tokio::test]
    async fn off_and_shadow_keep_legacy_answers_and_deduplicate_checks() {
        let user = "gen-ai-legacy@example.com";
        let pairs = stream_pairs(&[
            ("logs", "first"),
            ("foo", "fallback"),
            ("logs", "second"),
            ("logs", "first"),
            ("foo", "fallback"),
        ]);
        for mode in [ListMode::Off, ListMode::Shadow] {
            let fake = FakeStreamChecker::default();
            grant(&fake, user, StreamType::Logs, "first");
            grant(&fake, user, StreamType::Logs, "second");
            fake.fail_object_check_once(user, UnavailableReason::Timeout);
            let expected = legacy_agent_stream_permissions(
                &CheckerChecks(&fake),
                &agent_stream_query(ORG, user),
                &pairs,
                &deny_fallback,
            )
            .await;
            fake.fail_object_check_once(user, UnavailableReason::Timeout);
            fake.fail_types_access_once(user, UnavailableReason::Timeout);
            fake.set_list_mode(user, mode);
            fake.set_shadow_sample(user, 1.0);
            let fallbacks = Mutex::new(Vec::new());
            let actual = within_budget(
                3,
                agent_stream_permissions_with(
                    &fake,
                    &CheckerChecks(&fake),
                    ORG,
                    user,
                    &pairs,
                    |stream_type, name| {
                        assert_eq!(fake.calls(user).object_checks, 3);
                        fallbacks
                            .lock()
                            .unwrap()
                            .push((stream_type.to_string(), name.to_string()));
                        ready(false)
                    },
                ),
            )
            .await
            .unwrap();
            assert_eq!(actual, expected, "{mode:?}");
            assert!(!actual[&("logs".to_string(), "first".to_string())]);
            assert!(actual[&("logs".to_string(), "second".to_string())]);
            assert_eq!(
                *fallbacks.lock().unwrap(),
                stream_pairs(&[("foo", "fallback")])
            );
            assert_eq!(fake.calls(user).object_checks, 4);
            if mode == ListMode::Off {
                assert_eq!(fake.calls(user).types_access, 0);
            }
        }
    }

    #[tokio::test]
    async fn non_listable_types_use_the_raw_helper_once_and_count_fallbacks() {
        let fake = FakeStreamChecker::default();
        let user = "gen-ai-raw-types@example.com";
        fake.set_list_mode(user, ListMode::On);
        grant(&fake, user, StreamType::Logs, "allowed");
        let pairs = stream_pairs(&[
            ("logs", "allowed"),
            ("Logs", "allowed"),
            ("foo", "allowed"),
            ("enrichment_tables", "allowed"),
            ("Logs", "allowed"),
            ("foo", "allowed"),
            ("enrichment_tables", "allowed"),
            ("logs", "denied"),
        ]);
        let counter =
            config::metrics::authz::AUTHZ_FALLBACK_CHECKS_TOTAL.with_label_values(&[SITE_GEN_AI]);
        let before = counter.get();
        let fallbacks = Mutex::new(Vec::new());
        let actual = within_budget(
            7,
            agent_stream_permissions_with(
                &fake,
                &CheckerChecks(&fake),
                ORG,
                user,
                &pairs,
                |stream_type, name| {
                    fallbacks
                        .lock()
                        .unwrap()
                        .push((stream_type.to_string(), name.to_string()));
                    ready(stream_type == "enrichment_tables")
                },
            ),
        )
        .await
        .unwrap();
        let expected_fallbacks = stream_pairs(&[
            ("Logs", "allowed"),
            ("foo", "allowed"),
            ("enrichment_tables", "allowed"),
        ]);
        assert_eq!(*fallbacks.lock().unwrap(), expected_fallbacks);
        for (stream_type, name) in &pairs {
            let allowed =
                (stream_type == "logs" && name == "allowed") || stream_type == "enrichment_tables";
            assert_eq!(actual[&(stream_type.clone(), name.clone())], allowed);
        }
        assert!(counter.get() >= before + 3);
        let calls = fake.calls(user);
        assert_eq!((calls.types_access, calls.stored_email_types), (1, 1));
        assert_eq!((calls.probe_c, calls.probe_b, calls.lists), (1, 2, 1));
        assert_eq!(calls.object_checks, 0);
    }

    #[tokio::test]
    async fn raw_object_ids_match_legacy_without_sanitizing() {
        let pairs = stream_pairs(&[("logs", "foo:bar"), ("logs", "foo.bar")]);
        for (user, role) in [
            ("gen-ai-raw-custom@example.com", "custom"),
            ("gen-ai-raw-editor@example.com", "editor"),
        ] {
            let fake = FakeStreamChecker::default();
            fake.set_role(ORG, user, role);
            fake.grant_read_all(user, ORG, StreamType::Logs);
            let expected = legacy_agent_stream_permissions(
                &CheckerChecks(&fake),
                &agent_stream_query(ORG, user),
                &pairs,
                &deny_fallback,
            )
            .await;
            fake.set_list_mode(user, ListMode::On);
            let actual = within_budget(
                4,
                agent_stream_permissions_with(
                    &fake,
                    &CheckerChecks(&fake),
                    ORG,
                    user,
                    &pairs,
                    deny_fallback,
                ),
            )
            .await
            .unwrap();
            assert_eq!(actual, expected, "{role}");
            assert_eq!(
                actual[&("logs".to_string(), "foo:bar".to_string())],
                role == "editor"
            );
            assert!(actual[&("logs".to_string(), "foo.bar".to_string())]);
            assert_eq!(fake.calls(user).object_checks, 3);
        }
    }

    #[tokio::test]
    async fn list_path_uses_one_c_probe_plus_three_calls_per_type() {
        let fake = FakeStreamChecker::default();
        let user = "gen-ai-budget@example.com";
        fake.set_list_mode(user, ListMode::On);
        let types = [StreamType::Logs, StreamType::Metrics, StreamType::Traces];
        let mut pairs = Vec::new();
        for stream_type in types {
            for i in 0..200 {
                let name = format!("stream_{i}");
                if i % 5 == 0 {
                    grant(&fake, user, stream_type, &name);
                }
                pairs.push((stream_type.to_string(), name));
            }
        }
        pairs.extend(stream_pairs(&[
            ("Logs", "raw"),
            ("foo", "raw"),
            ("enrichment_tables", "raw"),
        ]));
        pairs.push(pairs[0].clone());
        let fallbacks = Mutex::new(0);
        let budget = 1 + 3 * types.len() + 3;
        let actual = within_budget(
            budget as u32,
            agent_stream_permissions_with(
                &fake,
                &CheckerChecks(&fake),
                ORG,
                user,
                &pairs,
                |_, _| {
                    *fallbacks.lock().unwrap() += 1;
                    ready(false)
                },
            ),
        )
        .await
        .unwrap();
        assert_eq!(actual.values().filter(|allowed| **allowed).count(), 120);
        assert_eq!(actual.len(), 603);
        let calls = fake.calls(user);
        assert_eq!(
            (
                calls.types_access,
                calls.probe_c,
                calls.probe_b,
                calls.lists
            ),
            (1, 1, 6, 3)
        );
        assert_eq!(calls.total() + *fallbacks.lock().unwrap(), budget);
    }

    #[tokio::test]
    async fn on_failures_return_errors_and_the_handler_answers_typed_503() {
        let user = "gen-ai-failure@example.com";
        for failure in ["probe", "list", "object"] {
            let fake = FakeStreamChecker::default();
            fake.set_list_mode(user, ListMode::On);
            let name = match failure {
                "probe" => {
                    fake.fail_types_access_once(user, UnavailableReason::Timeout);
                    "allowed"
                }
                "list" => {
                    fake.fail_list_once(user, UnavailableReason::Timeout);
                    "allowed"
                }
                _ => {
                    fake.fail_object_check_once(user, UnavailableReason::Timeout);
                    "foo:bar"
                }
            };
            let pairs = stream_pairs(&[("logs", name)]);
            let error = within_budget(
                5,
                agent_stream_permissions_with(
                    &fake,
                    &CheckerChecks(&fake),
                    ORG,
                    user,
                    &pairs,
                    deny_fallback,
                ),
            )
            .await
            .unwrap_err();
            assert_eq!(error.reason, UnavailableReason::Timeout, "{failure}");
            let response = agent_list_error_response(ORG, error.into());
            assert_eq!(
                response.status(),
                axum::http::StatusCode::SERVICE_UNAVAILABLE
            );
            assert_eq!(response.headers()["retry-after"], "3");
            assert_eq!(response.headers()["x-o2-authz"], "unavailable");
            let body = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(
                body,
                serde_json::json!({
                    "code": 503,
                    "error_code": "authz_unavailable",
                    "message": "Permission service unavailable, try again",
                })
            );
        }
    }
}
