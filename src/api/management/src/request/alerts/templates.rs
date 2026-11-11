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
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::Response,
};
use config::meta::destinations::TemplateKind;
use db::user::is_root_user;
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::check_permissions;
use openobserve_core::{
    alerts::{
        notifications::preview::{PreviewError, PreviewRequest, preview},
        templates,
    },
    auth::UserEmail,
    http::template_error_response,
};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::destinations::{Template, TemplateWithUsage},
    request::{BulkDeleteRequest, BulkDeleteResponse},
};

/// CreateTemplate
#[utoipa::path(
    post,
    path = "/{org_id}/alerts/templates",
    context_path = "/api",
    tag = "Templates",
    operation_id = "CreateTemplate",
    summary = "Create alert template",
    description = "Creates a new alert notification template for an organization. Templates define the format and content \
                   of alert notifications, including message structure, variable substitutions, and styling options. \
                   Templates can be reused across multiple alert destinations to maintain consistent notification formatting \
                   and branding across different channels.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    request_body(content = inline(Template), description = "Template data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MetaHttpResponse),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Templates", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create alert template", "category": "alerts"}))
    )
)]
pub async fn save_template(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(tmpl): Json<Template>,
) -> Response {
    let requested_kind = match tmpl.kind.as_deref() {
        None => None,
        Some("custom") => Some(TemplateKind::Custom),
        Some("content") => Some(TemplateKind::Content),
        Some(other) => {
            return template_error_response(db::alerts::templates::TemplateError::InvalidKind(
                other.to_string(),
            ));
        }
    };
    let applies_to = match tmpl.applies_to.as_deref().map(templates::parse_applies_to) {
        None => None,
        Some(Ok(kinds)) => Some(kinds),
        Some(Err(e)) => return template_error_response(e),
    };
    let tmpl = tmpl.into(&org_id);
    match templates::save(
        "",
        tmpl,
        requested_kind,
        applies_to,
        true,
        is_root_user(&user_email.user_id),
    )
    .await
    {
        Ok(v) => MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Template saved")
                .with_id(v.id.map(|id| id.to_string()).unwrap_or_default())
                .with_name(v.name),
        ),
        Err(e) => template_error_response(e),
    }
}

/// UpdateTemplate
#[utoipa::path(
    put,
    path = "/{org_id}/alerts/templates/{template_name}",
    context_path = "/api",
    tag = "Templates",
    operation_id = "UpdateTemplate",
    summary = "Update alert template",
    description = "Updates an existing alert notification template. Allows modification of template content, formatting, \
                   variable placeholders, and styling options. Changes to templates will apply to all future alert \
                   notifications that use this template, providing a centralized way to update notification formats across \
                   multiple alerts and destinations.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("template_name" = String, Path, description = "Template name"),
      ),
    request_body(content = inline(Template), description = "Template data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MetaHttpResponse),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Templates", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update alert template", "category": "alerts"}))
    )
)]
pub async fn update_template(
    Path((org_id, name)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(tmpl): Json<Template>,
) -> Response {
    let requested_kind = match tmpl.kind.as_deref() {
        None => None,
        Some("custom") => Some(TemplateKind::Custom),
        Some("content") => Some(TemplateKind::Content),
        Some(other) => {
            return template_error_response(db::alerts::templates::TemplateError::InvalidKind(
                other.to_string(),
            ));
        }
    };
    let applies_to = match tmpl.applies_to.as_deref().map(templates::parse_applies_to) {
        None => None,
        Some(Ok(kinds)) => Some(kinds),
        Some(Err(e)) => return template_error_response(e),
    };
    let tmpl = tmpl.into(&org_id);
    match templates::save(
        &name,
        tmpl,
        requested_kind,
        applies_to,
        false,
        is_root_user(&user_email.user_id),
    )
    .await
    {
        Ok(_) => MetaHttpResponse::ok("Template updated"),
        Err(e) => template_error_response(e),
    }
}

/// GetTemplateByName
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/templates/{template_name}",
    context_path = "/api",
    tag = "Templates",
    operation_id = "GetTemplate",
    summary = "Get alert template",
    description = "Retrieves the configuration and content of a specific alert notification template. Returns the template \
                   structure including message format, variable definitions, styling options, and other formatting \
                   parameters. Used for reviewing existing templates and understanding notification formats before making \
                   modifications.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("template_name" = String, Path, description = "Template name"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = inline(TemplateWithUsage)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Templates", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get template details", "category": "alerts"}))
    )
)]
pub async fn get_template(Path((org_id, name)): Path<(String, String)>) -> Response {
    let data = match templates::get(&org_id, &name).await {
        Ok(data) => data,
        Err(e) => return template_error_response(e),
    };
    match templates::used_by(&data.org_id, &data.name).await {
        Ok(used_by) => MetaHttpResponse::json(TemplateWithUsage {
            template: Template::from(data),
            used_by,
        }),
        Err(e) => template_error_response(e),
    }
}

/// Query of `GET templates`: `applies_to` keeps user templates of one kind, `type` one transport.
#[derive(Debug, Default, serde::Deserialize, utoipa::IntoParams)]
pub struct ListTemplatesQuery {
    pub applies_to: Option<String>,
    #[serde(rename = "type")]
    pub template_type: Option<String>,
    /// When true, each template includes `used_by` reference counts.
    pub include_usage: Option<bool>,
}

impl ListTemplatesQuery {
    fn filter(&self) -> Result<templates::ListFilter, String> {
        let applies_to = match self.applies_to.as_deref().filter(|k| !k.is_empty()) {
            None => None,
            Some(k) => Some(
                config::meta::alerts::notification_kind::NotificationKind::parse(k).ok_or_else(
                    || {
                        format!(
                            "applies_to: unknown kind '{k}'; allowed: alert, incident, anomaly, synthetics, downtime, on_call"
                        )
                    },
                )?,
            ),
        };
        let template_type = match self.template_type.as_deref().filter(|t| !t.is_empty()) {
            None => None,
            Some(t) => Some(
                templates::TemplateTypeFilter::parse(t)
                    .ok_or_else(|| format!("type: unknown '{t}'; allowed: http, email, sns"))?,
            ),
        };
        Ok(templates::ListFilter {
            applies_to,
            template_type,
        })
    }
}

/// ListTemplates
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/templates",
    context_path = "/api",
    tag = "Templates",
    operation_id = "ListTemplates",
    summary = "List alert templates",
    description = "Retrieves a list of all alert notification templates configured for an organization. Returns template \
                   names, types, and basic metadata to help administrators manage notification formatting options. \
                   Templates provide reusable formatting configurations that ensure consistent alert notifications across \
                   different channels and destinations. With `include_usage=true`, each template also carries \
                   `used_by` counts; `binding_names` is empty in the list.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ListTemplatesQuery,
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<Template>)),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Templates", "operation": "list"})),
        ("x-o2-mcp" = json!({
            "description": "List all alert templates",
            "category": "alerts",
            "summary_fields": ["name", "type", "isDefault", "title"]
        }))
    )
)]
pub async fn list_templates(
    Path(org_id): Path<String>,
    Query(query): Query<ListTemplatesQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    let filter = match query.filter() {
        Ok(filter) => filter,
        Err(e) => return MetaHttpResponse::bad_request(e.as_str()),
    };
    let mut _permitted = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;
        match openobserve_api_common::auth::validator::list_objects_for_user(
            &org_id, user_id, "GET", "template",
        )
        .await
        {
            Ok(list) => {
                _permitted = list;
            }
            Err(e) => {
                return common::meta::http::HttpResponse::forbidden(e.to_string());
            }
        }
        // Get List of allowed objects ends
    }

    let data = match templates::list(&org_id, _permitted, filter).await {
        Ok(data) => data,
        Err(e) => return template_error_response(e),
    };
    if !query.include_usage.unwrap_or(false) {
        return MetaHttpResponse::json(data.into_iter().map(Template::from).collect::<Vec<_>>());
    }
    // The same counts GET template returns, scoped by each template's owner org, with one
    // query per consumer table and owner for the whole list.
    match templates::list_used_by(&org_id, &data).await {
        Ok(used) => MetaHttpResponse::json(
            data.into_iter()
                .zip(used)
                .map(|(t, used_by)| TemplateWithUsage {
                    template: Template::from(t),
                    used_by,
                })
                .collect::<Vec<_>>(),
        ),
        Err(e) => template_error_response(e),
    }
}

/// DeleteTemplate
#[utoipa::path(
    delete,
    path = "/{org_id}/alerts/templates/{template_name}",
    context_path = "/api",
    tag = "Templates",
    operation_id = "DeleteAlertTemplate",
    summary = "Delete alert template",
    description = "Removes an alert notification template from the organization. The template must not be in use by any \
                   active destinations before deletion. Once deleted, any destinations previously using this template \
                   will need to be updated with alternative templates to continue formatting notifications properly.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("template_name" = String, Path, description = "Template name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = MetaHttpResponse),
        (status = 409, description = "Conflict", content_type = "application/json", body = ()),
        (status = 404, description = "NotFound",  content_type = "application/json", body = ()),
        (status = 500, description = "Failure",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Templates", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete alert template", "category": "alerts", "requires_confirmation": true}))
    )
)]
pub async fn delete_template(
    Path((org_id, name)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    match templates::delete(&org_id, &name, is_root_user(&user_email.user_id)).await {
        Ok(_) => MetaHttpResponse::ok("Template deleted"),
        Err(e) => template_error_response(e),
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/alerts/templates/bulk",
    context_path = "/api",
    tag = "Templates",
    operation_id = "DeleteAlertTemplateBulk",
    summary = "Delete multiple alert template",
    description = "Removes multiple alert notification template from the organization. The templates must not be in use by any \
                   active destinations before deletion. Once deleted, any destinations previously using these templates \
                   will need to be updated with alternative templates to continue formatting notifications properly.",
    security(
        ("Authorization"= [])
    ),
    request_body(content = BulkDeleteRequest, description = "Template names", content_type = "application/json"),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkDeleteResponse),
        (status = 500, description = "Failure",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Templates", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_template_bulk(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<BulkDeleteRequest>,
) -> Response {
    let user_id = user_email.user_id;
    let root = is_root_user(&user_id);

    #[cfg(feature = "enterprise")]
    for name in &req.ids {
        if !check_permissions(
            name,
            &org_id,
            &user_id,
            "templates",
            "DELETE",
            None,
            false,
            false,
            true,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for name in req.ids {
        match templates::delete(&org_id, &name, root).await {
            Ok(_) => {
                successful.push(name);
            }
            Err(e) => {
                log::error!("error while deleting template {org_id}/{name} : {e}");
                unsuccessful.push(name);
                err = Some(e.to_string());
            }
        }
    }

    MetaHttpResponse::json(BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    })
}

/// GetSystemTemplates
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/templates/system/prebuilt",
    context_path = "/api",
    tag = "Templates",
    operation_id = "GetSystemTemplates",
    summary = "Get system prebuilt templates",
    description = "Retrieves all system-defined prebuilt templates. These templates are provided by OpenObserve for common \
                   notification destinations like Slack, Microsoft Teams, Email, PagerDuty, etc. System templates are read-only \
                   and serve as the foundation for prebuilt alert destinations. This endpoint returns the complete template \
                   configurations including body, type, and metadata. Requires LIST permission on templates.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(Vec<Template>)),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 500, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Templates", "operation": "list"})),
        ("x-o2-mcp" = json!({
            "description": "Get system prebuilt templates",
            "category": "alerts",
            "summary_fields": ["name", "type", "isDefault", "title"]
        }))
    )
)]
pub async fn get_system_templates(Path(org_id): Path<String>) -> Response {
    use config::prebuilt_loader::get_prebuilt_template;

    let prebuilt_types = vec![
        "slack",
        "msteams",
        "pagerduty",
        "discord",
        "webhook",
        "opsgenie",
        "servicenow",
        "jira",
        "email",
    ];

    let mut templates = Vec::new();
    for prebuilt_type in prebuilt_types {
        if let Some(mut template) = get_prebuilt_template(prebuilt_type) {
            // Set org_id for the template
            template.org_id = org_id.clone();
            templates.push(Template::from(template));
        }
    }

    MetaHttpResponse::json(templates)
}

/// PreviewTemplate
#[utoipa::path(
    post,
    path = "/{org_id}/alerts/templates/preview",
    context_path = "/api",
    tag = "Templates",
    operation_id = "PreviewTemplate",
    summary = "Preview an alert template",
    description = "Renders a draft content-template definition for a chosen channel against a deterministic synthetic \
                   sample, returning both the real wire payload the send path would produce and a normalized preview \
                   model for card rendering. Uses the exact same resolve/render code path as sending a live \
                   notification, so the preview is guaranteed to match production output for the same input.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(PreviewRequest), description = "Preview request", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = openobserve_core::alerts::notifications::preview::PreviewResponse),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Templates", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn preview_template(
    Path(_org_id): Path<String>,
    Json(req): Json<PreviewRequest>,
) -> Response {
    match preview(&req) {
        Ok(resp) => MetaHttpResponse::json(resp),
        Err(e @ PreviewError::UnknownChannel(_))
        | Err(e @ PreviewError::UnknownSeverity(_))
        // The draft fails the same validation `save` applies — the client sent
        // content it could not have saved, so this is a 400 like the others.
        | Err(e @ PreviewError::InvalidContent(_)) => {
            MetaHttpResponse::bad_request(e.to_string())
        }
        // Unreachable today (the webhook fallback is total), but a render
        // failure is a server-side fault, not a malformed request.
        Err(e @ PreviewError::RenderFailed(_)) => MetaHttpResponse::internal_error(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use db::alerts::templates::TemplateError;
    use openobserve_core::http::template_error_response;

    fn status(err: TemplateError) -> StatusCode {
        template_error_response(err).status()
    }

    #[test]
    fn test_list_query_reads_include_usage() {
        use axum::extract::Query;
        let parse = |uri: &str| {
            Query::<super::ListTemplatesQuery>::try_from_uri(&uri.parse().unwrap())
                .unwrap()
                .0
        };
        let q = parse("/t?include_usage=true&applies_to=alert");
        assert_eq!(q.include_usage, Some(true));
        assert_eq!(q.applies_to.as_deref(), Some("alert"));
        assert_eq!(parse("/t").include_usage, None);
    }

    // 404 Not Found
    #[test]
    fn test_not_found_is_not_found() {
        assert_eq!(status(TemplateError::NotFound), StatusCode::NOT_FOUND);
    }

    // 409 Conflict
    #[test]
    fn test_delete_with_destination_is_conflict() {
        assert_eq!(
            status(TemplateError::DeleteWithDestination("slack".to_string())),
            StatusCode::CONFLICT
        );
    }

    // 400 Bad Request
    #[test]
    fn test_empty_name_is_bad_request() {
        assert_eq!(status(TemplateError::EmptyName), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_invalid_name_is_bad_request() {
        assert_eq!(status(TemplateError::InvalidName), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_empty_title_is_bad_request() {
        assert_eq!(status(TemplateError::EmptyTitle), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_empty_body_is_bad_request() {
        assert_eq!(status(TemplateError::EmptyBody), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_already_exists_is_bad_request() {
        assert_eq!(
            status(TemplateError::AlreadyExists),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_delete_with_alert_is_bad_request() {
        assert_eq!(
            status(TemplateError::DeleteWithAlert("my-alert".to_string())),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_infra_error_is_internal_server_error() {
        let infra_err = infra::errors::Error::DbError(infra::errors::DbError::SeaORMError(
            "db unavailable".to_string(),
        ));
        assert_eq!(
            status(TemplateError::InfraError(infra_err)),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_prebuilt_read_only_is_forbidden() {
        assert_eq!(
            status(TemplateError::PrebuiltReadOnly(
                "prebuilt_slack".to_string()
            )),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn test_reserved_name_is_bad_request() {
        assert_eq!(
            status(TemplateError::ReservedName("prebuilt_slack".to_string())),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_invalid_kind_is_bad_request() {
        assert_eq!(
            status(TemplateError::InvalidKind("bogus".to_string())),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_invalid_content_spec_is_bad_request() {
        assert_eq!(
            status(TemplateError::InvalidContentSpec("bad json".to_string())),
            StatusCode::BAD_REQUEST
        );
    }
}
