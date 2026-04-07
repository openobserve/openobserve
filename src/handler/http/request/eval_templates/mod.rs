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

use axum::{
    extract::{Json, Path},
    http::StatusCode,
    response::IntoResponse,
};
#[cfg(feature = "enterprise")]
use infra::table::eval_templates as db_eval_templates;
use serde::{Deserialize, Serialize};
use svix_ksuid::KsuidLike;

use crate::common::meta::http::HttpResponse;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CreateTemplateRequest {
    pub response_type: String,
    pub name: String,
    pub description: Option<String>,
    pub content: String,
    pub dimensions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TemplateResponse {
    pub id: String,
    pub org_id: String,
    pub response_type: String,
    pub name: String,
    pub description: Option<String>,
    pub content: String,
    pub dimensions: Vec<String>,
    pub version: i32,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TemplateStats {
    pub template_id: String,
    pub org_id: String,
    pub response_type: String,
    pub name: String,
    pub version: i32,
    pub total_evaluations: i64,
    pub avg_quality_score: f64,
    pub last_used: i64,
}

/// List all templates for an organization
pub async fn list(Path(org_id): Path<String>) -> impl IntoResponse {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::ai::evaluation::prompt_manager_singleton;

        if let Some(manager) = prompt_manager_singleton::get() {
            let templates = manager.get_templates_by_org(&org_id).await;
            let response: Vec<TemplateResponse> = templates
                .into_iter()
                .map(|t| TemplateResponse {
                    id: t.id,
                    org_id: t.org_id,
                    response_type: t.response_type,
                    name: t.name,
                    description: t.description,
                    content: t.content,
                    dimensions: t.dimensions,
                    version: t.version,
                    is_active: t.is_active,
                    created_at: t.created_at,
                    updated_at: t.updated_at,
                })
                .collect();
            (StatusCode::OK, Json(response)).into_response()
        } else {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(HttpResponse::error(
                    500u16,
                    "Template manager not initialized",
                )),
            )
                .into_response()
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        (StatusCode::OK, Json(Vec::<TemplateResponse>::new())).into_response()
    }
}

/// Get a specific template by UUID
pub async fn get(Path((org_id, template_id)): Path<(String, String)>) -> impl IntoResponse {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::ai::evaluation::prompt_manager_singleton;

        if let Some(manager) = prompt_manager_singleton::get() {
            match manager
                .get_template_by_id_async(&org_id, &template_id)
                .await
            {
                Ok(t) => {
                    let response = TemplateResponse {
                        id: t.id,
                        org_id: t.org_id,
                        response_type: t.response_type,
                        name: t.name,
                        description: t.description,
                        content: t.content,
                        dimensions: t.dimensions,
                        version: t.version,
                        is_active: t.is_active,
                        created_at: t.created_at,
                        updated_at: t.updated_at,
                    };
                    (StatusCode::OK, Json(response)).into_response()
                }
                Err(_) => (
                    StatusCode::NOT_FOUND,
                    Json(HttpResponse::error(404u16, "Template not found")),
                )
                    .into_response(),
            }
        } else {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(HttpResponse::error(
                    500u16,
                    "Template manager not initialized",
                )),
            )
                .into_response()
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        (
            StatusCode::NOT_FOUND,
            Json(HttpResponse::error(404u16, "Template not found")),
        )
            .into_response()
    }
}

/// Create a new evaluation template
pub async fn create(
    Path(org_id): Path<String>,
    Json(req): Json<CreateTemplateRequest>,
) -> impl IntoResponse {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::ai::evaluation::prompt_manager_singleton;

        if let Some(manager) = prompt_manager_singleton::get() {
            let now = chrono::Utc::now().timestamp_millis();
            let template_id = svix_ksuid::Ksuid::new(None, None).to_string();

            let template = o2_enterprise::enterprise::ai::evaluation::prompt_manager::EvalPrompt {
                id: template_id,
                org_id: org_id.clone(),
                response_type: req.response_type,
                name: req.name,
                description: req.description,
                content: req.content,
                dimensions: req.dimensions,
                version: 1,
                is_active: true,
                created_at: now,
                updated_at: now,
            };

            // Save to database
            let db_template = db_eval_templates::EvalTemplate {
                id: template.id.clone(),
                org_id: template.org_id.clone(),
                response_type: template.response_type.clone(),
                name: template.name.clone(),
                description: template.description.clone(),
                content: template.content.clone(),
                dimensions: template.dimensions.clone(),
                version: template.version,
                is_active: template.is_active,
                created_by: None,
                created_at: template.created_at,
                updated_by: None,
                updated_at: template.updated_at,
            };

            // Update manager first; only persist to DB on success to avoid orphaned records
            if let Err(e) = manager.update_template(template.clone()).await {
                log::error!("Failed to update template in manager: {}", e);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(HttpResponse::error(
                        500u16,
                        format!("Failed to create template: {}", e),
                    )),
                )
                    .into_response();
            }

            match db_eval_templates::add(&db_template).await {
                Ok(_) => {
                    let response = TemplateResponse {
                        id: template.id,
                        org_id: template.org_id,
                        response_type: template.response_type,
                        name: template.name,
                        description: template.description,
                        content: template.content,
                        dimensions: template.dimensions,
                        version: template.version,
                        is_active: template.is_active,
                        created_at: template.created_at,
                        updated_at: template.updated_at,
                    };
                    (StatusCode::CREATED, Json(response)).into_response()
                }
                Err(e) => {
                    log::error!("Failed to save template to database: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(HttpResponse::error(
                            500u16,
                            format!("Failed to save template: {}", e),
                        )),
                    )
                        .into_response()
                }
            }
        } else {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(HttpResponse::error(
                    500u16,
                    "Template manager not initialized",
                )),
            )
                .into_response()
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        (
            StatusCode::BAD_REQUEST,
            Json(HttpResponse::error(
                400u16,
                "Enterprise feature not available",
            )),
        )
            .into_response()
    }
}

/// Update an existing template by UUID
pub async fn update(
    Path((org_id, template_id)): Path<(String, String)>,
    Json(req): Json<CreateTemplateRequest>,
) -> impl IntoResponse {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::ai::evaluation::prompt_manager_singleton;

        if let Some(manager) = prompt_manager_singleton::get() {
            // Get existing template by UUID to increment version and preserve created_at
            match manager
                .get_template_by_id_async(&org_id, &template_id)
                .await
            {
                Ok(existing) => {
                    let now = chrono::Utc::now().timestamp_millis();
                    let new_version = existing.version + 1;

                    let template =
                        o2_enterprise::enterprise::ai::evaluation::prompt_manager::EvalPrompt {
                            id: existing.id,
                            org_id: org_id.clone(),
                            response_type: req.response_type,
                            name: req.name,
                            description: req.description,
                            content: req.content,
                            dimensions: req.dimensions,
                            version: new_version,
                            is_active: true,
                            created_at: existing.created_at,
                            updated_at: now,
                        };

                    // Save to database
                    let db_template = db_eval_templates::EvalTemplate {
                        id: template.id.clone(),
                        org_id: template.org_id.clone(),
                        response_type: template.response_type.clone(),
                        name: template.name.clone(),
                        description: template.description.clone(),
                        content: template.content.clone(),
                        dimensions: template.dimensions.clone(),
                        version: template.version,
                        is_active: template.is_active,
                        created_by: None,
                        created_at: template.created_at,
                        updated_by: None,
                        updated_at: template.updated_at,
                    };

                    if let Err(e) = db_eval_templates::update(&db_template).await {
                        log::error!("Failed to save template to database: {}", e);
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(HttpResponse::error(
                                500u16,
                                format!("Failed to save template: {}", e),
                            )),
                        )
                            .into_response();
                    }

                    match manager.update_template(template.clone()).await {
                        Ok(_) => {
                            let response = TemplateResponse {
                                id: template.id,
                                org_id: template.org_id,
                                response_type: template.response_type,
                                name: template.name,
                                description: template.description,
                                content: template.content,
                                dimensions: template.dimensions,
                                version: template.version,
                                is_active: template.is_active,
                                created_at: template.created_at,
                                updated_at: template.updated_at,
                            };
                            (StatusCode::OK, Json(response)).into_response()
                        }
                        Err(e) => {
                            log::error!("Failed to update template in manager: {}", e);
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(HttpResponse::error(
                                    500u16,
                                    format!("Failed to update template: {}", e),
                                )),
                            )
                                .into_response()
                        }
                    }
                }
                Err(_) => (
                    StatusCode::NOT_FOUND,
                    Json(HttpResponse::error(404u16, "Template not found")),
                )
                    .into_response(),
            }
        } else {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(HttpResponse::error(
                    500u16,
                    "Template manager not initialized",
                )),
            )
                .into_response()
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        (
            StatusCode::BAD_REQUEST,
            Json(HttpResponse::error(
                400u16,
                "Enterprise feature not available",
            )),
        )
            .into_response()
    }
}

/// Delete a template by UUID
pub async fn delete(Path((org_id, template_id)): Path<(String, String)>) -> impl IntoResponse {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::ai::evaluation::prompt_manager_singleton;

        use crate::service::pipeline;

        if let Some(manager) = prompt_manager_singleton::get() {
            // Get template by UUID
            match manager
                .get_template_by_id_async(&org_id, &template_id)
                .await
            {
                Ok(template) => {
                    // Check if template is being used in any pipeline
                    match pipeline::list_pipelines(&org_id, None).await {
                        Ok(pipelines) => {
                            let using_pipelines: Vec<String> = pipelines
                                .iter()
                                .filter_map(|p| {
                                    let uses_template = p.nodes.iter().any(|node| {
                                        if let config::meta::pipeline::components::NodeData::LlmEvaluation(eval_params) = &node.data {
                                            eval_params.eval_template.as_deref() == Some(&template_id)
                                        } else {
                                            false
                                        }
                                    });
                                    if uses_template {
                                        Some(p.name.clone())
                                    } else {
                                        None
                                    }
                                })
                                .collect();

                            if !using_pipelines.is_empty() {
                                let pipeline_list = using_pipelines.join(", ");
                                return (
                                    StatusCode::CONFLICT,
                                    Json(HttpResponse::error(
                                        409u16,
                                        format!(
                                            "Cannot delete template '{}' as it is being used in the following pipeline(s): {}. Please update or remove those pipelines first.",
                                            template.name, pipeline_list
                                        ),
                                    )),
                                )
                                    .into_response();
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to check if template is in use: {}", e);
                            // Continue with deletion even if we can't check (graceful degradation)
                        }
                    }

                    // Remove from in-memory manager first; only delete from DB on success
                    // to avoid DB/in-memory state divergence
                    if let Err(e) = manager.remove_template_by_id(&org_id, &template_id).await {
                        log::error!("Failed to remove template from manager: {}", e);
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(HttpResponse::error(
                                500u16,
                                format!("Failed to delete template: {}", e),
                            )),
                        )
                            .into_response();
                    }

                    // Delete from database
                    match db_eval_templates::delete(&template.id).await {
                        Ok(_) => (
                            StatusCode::OK,
                            Json(serde_json::json!({"message": "Template deleted successfully"})),
                        )
                            .into_response(),
                        Err(e) => {
                            log::error!("Failed to delete template from database: {}", e);
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(HttpResponse::error(
                                    500u16,
                                    format!("Failed to delete template: {}", e),
                                )),
                            )
                                .into_response()
                        }
                    }
                }
                Err(_) => (
                    StatusCode::NOT_FOUND,
                    Json(HttpResponse::error(404u16, "Template not found")),
                )
                    .into_response(),
            }
        } else {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(HttpResponse::error(
                    500u16,
                    "Template manager not initialized",
                )),
            )
                .into_response()
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        (
            StatusCode::BAD_REQUEST,
            Json(HttpResponse::error(
                400u16,
                "Enterprise feature not available",
            )),
        )
            .into_response()
    }
}

/// Get usage statistics for a template by UUID
pub async fn get_stats(Path((org_id, template_id)): Path<(String, String)>) -> impl IntoResponse {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::ai::evaluation::prompt_manager_singleton;

        if let Some(manager) = prompt_manager_singleton::get() {
            match manager
                .get_template_by_id_async(&org_id, &template_id)
                .await
            {
                Ok(template) => {
                    match manager.get_usage_stats_by_id(&org_id, &template_id).await {
                        Some(stats) => {
                            let response = TemplateStats {
                                template_id: template.id,
                                org_id: template.org_id,
                                response_type: template.response_type,
                                name: template.name,
                                version: template.version,
                                total_evaluations: stats.total_evals as i64,
                                avg_quality_score: stats.avg_score,
                                last_used: stats.last_used,
                            };
                            (StatusCode::OK, Json(response)).into_response()
                        }
                        None => {
                            // Template exists but no usage stats yet
                            let response = TemplateStats {
                                template_id: template.id,
                                org_id: template.org_id,
                                response_type: template.response_type,
                                name: template.name,
                                version: template.version,
                                total_evaluations: 0,
                                avg_quality_score: 0.0,
                                last_used: 0,
                            };
                            (StatusCode::OK, Json(response)).into_response()
                        }
                    }
                }
                Err(_) => (
                    StatusCode::NOT_FOUND,
                    Json(HttpResponse::error(404u16, "Template not found")),
                )
                    .into_response(),
            }
        } else {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(HttpResponse::error(
                    500u16,
                    "Template manager not initialized",
                )),
            )
                .into_response()
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        (
            StatusCode::NOT_FOUND,
            Json(HttpResponse::error(404u16, "Template not found")),
        )
            .into_response()
    }
}
