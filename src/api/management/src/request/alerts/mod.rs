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

use std::str::FromStr;

use axum::{
    Json,
    extract::{OriginalUri, Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use axum_extra::extract::Query as ExtraQuery;
use config::meta::{
    alerts::alert::{Alert as MetaAlert, AlertTypeFilter},
    triggers::{Trigger, TriggerModule},
};
use db::scheduler;
use hashbrown::HashMap;
use infra::db::{get_orm_client_ro, get_orm_client_rw};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    alerts::{
        ConditionListExt,
        alert::{self, AlertError},
        build_sql,
    },
    auth::UserEmail,
};
use svix_ksuid::Ksuid;
#[cfg(feature = "enterprise")]
use {
    openobserve_core::auth::check_permissions,
    openobserve_core::authz::{StreamPermissionResourceType, check_stream_permissions},
};

#[cfg(feature = "enterprise")]
use crate::models::alerts::requests::UpdateAnomalyAlertFields;
#[cfg(feature = "enterprise")]
use crate::models::alerts::responses::anomaly_config_to_list_item;
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::alerts::{
        requests::{
            AlertBulkEnableRequest, CloneAlertRequestBody, CreateAlertRequestBody,
            EnableAlertQuery, GenerateSqlRequestBody, ListAlertsQuery, MoveAlertsRequestBody,
            UpdateAlertRequestBody, ValidateCompositeRequestBody,
        },
        responses::{
            AlertBulkEnableResponse, AlertGroupLabel, AlertGroupResponseItem,
            AlertGroupTransitionItem, BulkDeleteAlertResponse, CompositeTimelineLane,
            CompositeTimelineResponse, CompositeTimelineTransition, EnableAlertResponseBody,
            GenerateSqlMetadata, GenerateSqlResponseBody, GetAlertResponseBody,
            ListAlertGroupTransitionsResponseBody, ListAlertGroupsResponseBody,
            ListAlertsResponseBody, ListAlertsResponseBodyItem,
        },
    },
    request::{
        BulkDeleteRequest,
        dashboards::{get_folder, is_overwrite},
    },
};

pub mod chart_render;
pub mod dedup_stats;
pub mod deduplication;
pub mod destinations;
pub mod external_events;
pub mod history;
pub mod incident_integrations;
pub mod incidents;
pub mod templates;

/// CreateAlert
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "CreateAlert",
    summary = "Create new alert",
    description = "Creates a new alert with specified conditions, triggers, and notifications. Users can define custom queries, thresholds, and notification destinations to monitor their data and receive timely alerts when conditions are met.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if alert folder is not the default folder)"),
      ),
    request_body(content = inline(CreateAlertRequestBody), description = "Alert data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create a new alert rule with flexible query options. IMPORTANT: Alert name must use snake_case (no spaces/special chars like :,#,?,&,%,/,quotes), destinations array is required with valid destination names. QueryCondition supports 3 query types: (1) Custom - uses conditions, aggregation, vrl_function, search_event_type, multi_time_range; (2) SQL - uses sql, vrl_function, search_event_type; (3) PromQL - uses promql, promql_condition, multi_time_range", "category": "alerts"}))
    )
)]
pub async fn create_alert(
    Path(org_id): Path<String>,
    OriginalUri(uri): OriginalUri,
    Headers(user_email): Headers<UserEmail>,
    Json(req_body): Json<CreateAlertRequestBody>,
) -> Response {
    let query_str = uri.query().unwrap_or("");
    let folder_id = get_folder(query_str);

    // Anomaly detection path: delegate to anomaly config creation (enterprise only).
    #[cfg(feature = "enterprise")]
    if req_body.alert_type == Some(AlertTypeFilter::AnomalyDetection) {
        return create_anomaly_alert(&org_id, user_email.user_id, req_body, &folder_id).await;
    }
    if req_body.alert_type == Some(AlertTypeFilter::Composite) {
        return create_composite_alert(&org_id, &folder_id, user_email.user_id, req_body).await;
    }
    let overwrite = is_overwrite(query_str);
    let mut alert: MetaAlert = req_body.into();
    if alert.owner.clone().filter(|o| !o.is_empty()).is_none() {
        alert.owner = Some(user_email.user_id.clone());
    }
    alert.last_edited_by = Some(user_email.user_id);

    let client = get_orm_client_rw().await;
    match alert::create(client, &org_id, &folder_id, alert, overwrite).await {
        Ok(v) => MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Alert saved")
                .with_id(v.id.map(|id| id.to_string()).unwrap_or_default())
                .with_name(v.name),
        ),
        Err(e) => e.into(),
    }
}

async fn create_composite_alert(
    org_id: &str,
    folder_id: &str,
    user_id: String,
    req: CreateAlertRequestBody,
) -> Response {
    if let Some(field) = req.composite_unsupported_field() {
        return composite_field_error(
            StatusCode::BAD_REQUEST,
            "composite_unsupported_field",
            field,
            "field is not supported for composite alerts",
        );
    }
    let Some(condition) = req.composite_condition.clone() else {
        return composite_machine_error(
            StatusCode::BAD_REQUEST,
            "composite_condition_required",
            "composite_condition is required",
        );
    };
    #[cfg(feature = "enterprise")]
    if let Some(children) =
        composite_unauthorized_children(org_id, &user_id, &condition.expression).await
    {
        return composite_access_error(children);
    }
    let input = composite_input(None, org_id, folder_id, user_id, req.alert, condition);
    match openobserve_core::alerts::composite::create_composite(input).await {
        Ok(definition) => MetaHttpResponse::json(
            MetaHttpResponse::message(StatusCode::OK, "Alert saved")
                .with_id(definition.id)
                .with_name(definition.name),
        ),
        Err(error) => composite_error_response(error),
    }
}

async fn update_composite_alert(
    org_id: &str,
    id: &str,
    user_id: String,
    req: UpdateAlertRequestBody,
) -> Response {
    if let Some(field) = req.composite_unsupported_field() {
        return composite_field_error(
            StatusCode::BAD_REQUEST,
            "composite_unsupported_field",
            field,
            "field is not supported for composite alerts",
        );
    }
    let Some(condition) = req.composite_condition.clone() else {
        return composite_machine_error(
            StatusCode::BAD_REQUEST,
            "composite_condition_required",
            "composite_condition is required",
        );
    };
    #[cfg(feature = "enterprise")]
    if let Some(children) =
        composite_unauthorized_children(org_id, &user_id, &condition.expression).await
    {
        return composite_access_error(children);
    }
    let current = openobserve_core::alerts::composite::get_composite(org_id, id)
        .await
        .ok()
        .flatten();
    #[cfg(feature = "enterprise")]
    if let Some(current) = &current
        && composite_subject_unauthorized(&current.definition, &user_id, "PUT").await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    let folder_id = current
        .map(|current| current.definition.folder_id)
        .unwrap_or_else(|| "default".to_string());
    let input = composite_input(
        Some(id.to_string()),
        org_id,
        &folder_id,
        user_id,
        req.alert,
        condition,
    );
    match openobserve_core::alerts::composite::update_composite(id, input).await {
        Ok(_) => MetaHttpResponse::ok("Alert Updated"),
        Err(error) => composite_error_response(error),
    }
}

#[cfg(feature = "enterprise")]
async fn composite_unauthorized_children(
    org_id: &str,
    user_id: &str,
    expression: &str,
) -> Option<Vec<String>> {
    use config::meta::alerts::composite::{collect_references, parse_expr};
    let Ok(parsed) = parse_expr(expression) else {
        return None;
    };
    let Ok(references) = collect_references(&parsed) else {
        return None;
    };
    let mut unauthorized = Vec::new();
    for id in references {
        if !check_permissions(
            &id, org_id, user_id, "alerts", "GET", None, false, true, false,
        )
        .await
        {
            unauthorized.push(id);
        }
    }
    (!unauthorized.is_empty()).then_some(unauthorized)
}

/// Authorize the composite itself (not just its children) for a read/mutation.
/// Returns `true` when the caller may not access the composite, so callers can
/// short-circuit with a 403. Mirrors `move_composite`'s subject check.
#[cfg(feature = "enterprise")]
async fn composite_subject_unauthorized(
    definition: &infra::table::entity::alert_composites::Model,
    user_id: &str,
    method: &str,
) -> bool {
    !check_permissions(
        &definition.id,
        &definition.org,
        user_id,
        "alerts",
        method,
        Some(&definition.folder_id),
        false,
        true,
        false,
    )
    .await
}

fn composite_input(
    id: Option<String>,
    org_id: &str,
    folder_id: &str,
    user_id: String,
    alert: crate::models::alerts::Alert,
    condition: crate::models::alerts::requests::CompositeCondition,
) -> openobserve_core::alerts::composite::CompositeCreate {
    openobserve_core::alerts::composite::CompositeCreate {
        id,
        org: org_id.to_string(),
        folder_id: folder_id.to_string(),
        name: alert.name,
        description: Some(alert.description).filter(|value| !value.is_empty()),
        expression: condition.expression,
        warning_counts_as_firing: condition.warning_counts_as_firing,
        stale_child_policy: condition.stale_child_policy.storage_id(),
        destinations: alert.destinations,
        template: alert.template,
        context_attributes: alert
            .context_attributes
            .map(|value| serde_json::json!(value)),
        enabled: alert.enabled,
        silence_seconds: alert.trigger_condition.silence_minutes * 60,
        creates_incident: alert.creates_incident,
        workflows: alert.workflows,
        priority: alert.priority.map(|value| value.to_i32()),
        tags: alert.tags,
        owner: alert.owner.or_else(|| Some(user_id.clone())),
        last_edited_by: Some(user_id),
    }
}

async fn composite_detail_response(
    composite: infra::table::alert_composites::CompositeWithChildren,
    _user_id: Option<&str>,
) -> Response {
    let definition = composite.definition;
    #[cfg(feature = "enterprise")]
    if let Some(user_id) = _user_id
        && composite_subject_unauthorized(&definition, user_id, "GET").await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    let scheduler_job_present = infra::scheduler::get(
        &definition.org,
        TriggerModule::CompositeAlert,
        &definition.id,
    )
    .await
    .is_ok();
    let db = get_orm_client_ro().await;

    // Evaluate exactly as the scheduler would (system context, no child query).
    // Inaccessible children are masked below; a failed evaluation degrades to
    // nulls rather than failing the whole read.
    let evaluation = openobserve_core::alerts::composite::evaluate_definition(
        db,
        &definition,
        &composite.children,
    )
    .await
    .ok();
    let evaluated_by_id = evaluation
        .as_ref()
        .map(|evaluation| {
            evaluation
                .children
                .iter()
                .map(|child| (child.alert_id.clone(), child.clone()))
                .collect::<std::collections::HashMap<_, _>>()
        })
        .unwrap_or_default();
    let composite_state = infra::table::alert_states::get(
        &definition.id,
        config::meta::alerts::state::ROLLUP_GROUP_KEY,
    )
    .await
    .ok()
    .flatten();

    // Resolve every child in a fixed pair of queries (`resolve_many`) instead of
    // one `resolve_by_id` per child on the hot detail read path.
    let child_ids: Vec<String> = composite
        .children
        .iter()
        .map(|child| child.child_alert_id.clone())
        .collect();
    let resolutions = infra::table::alert_composites::resolve_many(db, &definition.org, &child_ids)
        .await
        .unwrap_or_default();

    let mut children = Vec::with_capacity(composite.children.len());
    for child in composite.children {
        #[cfg(feature = "enterprise")]
        let child_authorized = match _user_id {
            Some(user_id) => {
                check_permissions(
                    &child.child_alert_id,
                    &definition.org,
                    user_id,
                    "alerts",
                    "GET",
                    None,
                    false,
                    true,
                    false,
                )
                .await
            }
            None => false,
        };
        #[cfg(not(feature = "enterprise"))]
        let child_authorized = true;
        if !child_authorized {
            // Redact the KSUID: an inaccessible child must not leak its stable
            // alert_id to a caller who cannot read it.
            children.push(serde_json::json!({
                "alert_id": null,
                "accessible": false,
            }));
            continue;
        }
        let (name, alert_type, folder_id, enabled) = match resolutions.get(&child.child_alert_id) {
            Some(infra::table::alert_composites::Resolution::Alert(alert)) => (
                Some(alert.name.clone()),
                Some(if alert.slo_id.is_some() {
                    "slo"
                } else {
                    "scheduled"
                }),
                Some(alert.folder_id.clone()),
                Some(alert.enabled),
            ),
            Some(infra::table::alert_composites::Resolution::Composite(composite)) => (
                Some(composite.name.clone()),
                Some("composite"),
                Some(composite.folder_id.clone()),
                Some(composite.enabled),
            ),
            _ => (None, None, None, None),
        };
        let evaluated = evaluated_by_id.get(&child.child_alert_id);
        children.push(serde_json::json!({
            "alert_id": child.child_alert_id,
            "accessible": name.is_some(),
            "name": name,
            "alert_type": alert_type,
            "folder_id": folder_id,
            "enabled": enabled,
            "level": evaluated.and_then(|child| child.level).map(|level| level.to_string()),
            "level_at": evaluated.and_then(|child| child.level_at),
            "effective_cadence_seconds": null,
            "stale_deadline": evaluated.map(|child| child.stale_deadline),
            "stale": evaluated.map(|child| child.stale).unwrap_or(true),
            "truth": evaluated.map(|child| child.truth).unwrap_or(false),
        }));
    }
    let evaluation_json = evaluation.map(|evaluation| {
        serde_json::json!({
            "result": evaluation.result,
            "level": evaluation.level.to_string(),
            "evaluated_at": composite_state.and_then(|state| state.level_at),
        })
    });
    MetaHttpResponse::json(serde_json::json!({
        "id": definition.id,
        "alert_type": "composite",
        "folderId": definition.folder_id,
        "name": definition.name,
        "description": definition.description,
        "enabled": definition.enabled,
        "destinations": definition.destinations,
        "template": definition.template,
        "context_attributes": definition.context_attributes,
        "trigger_condition": { "silence": definition.silence_seconds / 60 },
        "creates_incident": definition.creates_incident,
        "workflows": definition.workflows,
        "priority": definition.priority,
        "tags": definition.tags,
        "scheduler_job_present": scheduler_job_present,
        "composite_condition": {
            "expression": definition.expression,
            "warning_counts_as_firing": definition.warning_counts_as_firing,
            "stale_child_policy": stale_policy_name(definition.stale_child_policy),
        },
        "children": children,
        "evaluation": evaluation_json,
    }))
}

fn composite_list_item(
    definition: infra::table::entity::alert_composites::Model,
    folder_name: &str,
) -> Option<ListAlertsResponseBodyItem> {
    let alert_id = Ksuid::from_str(&definition.id).ok()?;
    let tags = definition
        .tags
        .and_then(|tags| serde_json::from_value(tags).ok())
        .unwrap_or_default();
    Some(ListAlertsResponseBodyItem {
        alert_id,
        folder_id: definition.folder_id.clone(),
        folder_name: folder_name.to_string(),
        name: definition.name,
        owner: definition.owner,
        description: definition.description,
        alert_type: "composite".to_string(),
        condition: None,
        trigger_condition: None,
        enabled: definition.enabled,
        last_triggered_at: None,
        last_satisfied_at: None,
        is_real_time: false,
        last_trained_at: None,
        status: None,
        last_error: None,
        last_outcome: None,
        last_outcome_at: None,
        last_outcome_since: None,
        level: None,
        level_since: None,
        priority: definition.priority.map(|value| value as u8),
        tags,
        destinations: Vec::new(),
        template: None,
        groups_observed: None,
        groups_firing: None,
        groups_observed_is_lower_bound: None,
        groups_firing_is_lower_bound: None,
        child_count: None,
        referenced_by_composite_count: None,
    })
}

fn stale_policy_name(value: i16) -> &'static str {
    match value {
        1 => "treat_as_false",
        2 => "treat_as_true",
        _ => "use_last_state",
    }
}

fn composite_error_response(
    error: openobserve_core::alerts::composite::CompositeServiceError,
) -> Response {
    use openobserve_core::alerts::composite::CompositeServiceError;
    match error {
        CompositeServiceError::ClientSuppliedId => composite_machine_error(
            StatusCode::BAD_REQUEST,
            "composite_unsupported_field",
            error,
        ),
        CompositeServiceError::InvalidExpression(_) => composite_machine_error(
            StatusCode::BAD_REQUEST,
            "composite_invalid_expression",
            error,
        ),
        CompositeServiceError::ChildNotAccessible(children) => composite_access_error(children),
        CompositeServiceError::ChildNotEligible(_) => {
            composite_machine_error(StatusCode::BAD_REQUEST, "child_not_eligible", error)
        }
        CompositeServiceError::Cycle => {
            composite_machine_error(StatusCode::CONFLICT, "composite_cycle", error)
        }
        CompositeServiceError::TooDeep => {
            composite_machine_error(StatusCode::CONFLICT, "composite_too_deep", error)
        }
        CompositeServiceError::NotFound => {
            composite_machine_error(StatusCode::NOT_FOUND, "composite_not_found", error)
        }
        CompositeServiceError::FolderNotFound => {
            composite_machine_error(StatusCode::NOT_FOUND, "composite_folder_not_found", error)
        }
        CompositeServiceError::ChildReferenced(_) => {
            composite_machine_error(StatusCode::CONFLICT, "child_referenced", error)
        }
        CompositeServiceError::Lock(_) => composite_machine_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "composite_graph_lock_unavailable",
            error,
        ),
        CompositeServiceError::WritesDisabled => composite_machine_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "composite_writes_disabled",
            error,
        ),
        CompositeServiceError::SuperClusterUnsupported => composite_machine_error(
            StatusCode::CONFLICT,
            "composite_super_cluster_unsupported",
            error,
        ),
        CompositeServiceError::PermissionDenied => {
            composite_machine_error(StatusCode::FORBIDDEN, "permission_denied", error)
        }
        CompositeServiceError::Database(_) | CompositeServiceError::Scheduler(_) => {
            composite_machine_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "composite_internal_error",
                error,
            )
        }
    }
}

fn composite_machine_error(status: StatusCode, code: &str, message: impl ToString) -> Response {
    (
        status,
        Json(serde_json::json!({
            "code": code,
            "message": message.to_string(),
        })),
    )
        .into_response()
}

fn composite_access_error(children: Vec<String>) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({
            "code": "child_not_accessible",
            "message": "one or more child alerts are not accessible",
            "children": children.into_iter().map(|alert_id| serde_json::json!({
                "alert_id": alert_id,
                "accessible": false,
            })).collect::<Vec<_>>(),
        })),
    )
        .into_response()
}

fn composite_field_error(
    status: StatusCode,
    code: &str,
    field: &str,
    message: impl ToString,
) -> Response {
    (
        status,
        Json(serde_json::json!({
            "code": code,
            "message": message.to_string(),
            "field": field,
        })),
    )
        .into_response()
}

#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/composites/validate",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ValidateCompositeAlert",
    summary = "Validate a composite alert condition",
    description = "Parses and validates a composite alert's boolean expression over child alert IDs and returns the canonical form, resolved children, and an advisory result without persisting anything.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(ValidateCompositeRequestBody), content_type = "application/json"),
    responses((status = 200, body = crate::models::alerts::responses::CompositeValidationResponse))
)]
pub async fn validate_composite_alert(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(request): Json<ValidateCompositeRequestBody>,
) -> Response {
    use config::meta::alerts::composite::{collect_references, parse_expr};
    let parsed = match parse_expr(&request.composite_condition.expression) {
        Ok(parsed) => parsed,
        Err(error) => {
            return composite_machine_error(
                StatusCode::BAD_REQUEST,
                "composite_invalid_expression",
                error,
            );
        }
    };
    let references = match collect_references(&parsed) {
        Ok(references) => references,
        Err(error) => {
            return composite_machine_error(
                StatusCode::BAD_REQUEST,
                "composite_invalid_expression",
                error,
            );
        }
    };
    #[cfg(feature = "enterprise")]
    let mut inaccessible = Vec::new();
    #[cfg(not(feature = "enterprise"))]
    let mut inaccessible = Vec::new();
    #[cfg(feature = "enterprise")]
    for id in &references {
        if !check_permissions(
            id,
            &org_id,
            &user_email.user_id,
            "alerts",
            "GET",
            None,
            false,
            true,
            false,
        )
        .await
        {
            inaccessible.push(id.clone());
        }
    }
    let db = get_orm_client_ro().await;
    // Resolve every reference in one batched query instead of per-ID round trips.
    let resolutions = infra::table::alert_composites::resolve_many(db, &org_id, &references)
        .await
        .unwrap_or_default();
    let mut children = Vec::with_capacity(references.len());
    for id in references {
        if inaccessible.contains(&id) {
            continue;
        }
        match resolutions.get(&id) {
            Some(infra::table::alert_composites::Resolution::Alert(alert))
                if !alert.is_real_time =>
            {
                children.push(serde_json::json!({
                    "alert_id": id,
                    "accessible": true,
                    "name": alert.name.clone(),
                    "alert_type": if alert.slo_id.is_some() { "slo" } else { "scheduled" },
                    "folder_id": alert.folder_id.clone(),
                    "enabled": alert.enabled,
                }));
            }
            Some(infra::table::alert_composites::Resolution::Alert(_)) => {
                // A realtime alert is ineligible as a composite child: report it
                // as a 400 `child_not_eligible` rather than masking it as 403
                // `child_not_accessible`.
                return composite_machine_error(
                    StatusCode::BAD_REQUEST,
                    "child_not_eligible",
                    format!("child alert {id} is not eligible for composite evaluation"),
                );
            }
            Some(infra::table::alert_composites::Resolution::Composite(composite)) => {
                children.push(serde_json::json!({
                    "alert_id": id,
                    "accessible": true,
                    "name": composite.name.clone(),
                    "alert_type": "composite",
                    "folder_id": composite.folder_id.clone(),
                    "enabled": composite.enabled,
                }));
            }
            _ => inaccessible.push(id),
        }
    }
    if !inaccessible.is_empty() {
        return composite_access_error(inaccessible);
    }
    let canonical_expression = match openobserve_core::alerts::composite::validate_composite_graph(
        &org_id,
        request.composite_id.as_deref(),
        &request.composite_condition.expression,
    )
    .await
    {
        Ok(expression) => expression,
        Err(error) => return composite_error_response(error),
    };

    // Current truth/result for the advisory preview. Degrades to nulls rather
    // than failing the whole validation when a child cannot be evaluated.
    let evaluation = openobserve_core::alerts::composite::evaluate_expression(
        db,
        &org_id,
        &request.composite_condition.expression,
        request.composite_condition.warning_counts_as_firing,
        request.composite_condition.stale_child_policy.storage_id(),
    )
    .await
    .ok();
    let evaluated_by_id = evaluation
        .as_ref()
        .map(|evaluation| {
            evaluation
                .children
                .iter()
                .map(|child| (child.alert_id.clone(), child.clone()))
                .collect::<std::collections::HashMap<_, _>>()
        })
        .unwrap_or_default();

    let mut warnings = Vec::new();
    for child in &mut children {
        let id = child["alert_id"].as_str().unwrap_or_default().to_string();
        let evaluated = evaluated_by_id.get(&id);
        child["level"] = evaluated
            .and_then(|child| child.level)
            .map(|level| serde_json::json!(level.to_string()))
            .unwrap_or(serde_json::Value::Null);
        child["level_at"] = evaluated
            .and_then(|child| child.level_at)
            .map(|level_at| serde_json::json!(level_at))
            .unwrap_or(serde_json::Value::Null);
        child["stale_deadline"] = evaluated
            .map(|child| serde_json::json!(child.stale_deadline))
            .unwrap_or(serde_json::Value::Null);
        child["stale"] = serde_json::json!(evaluated.map(|child| child.stale).unwrap_or(true));
        child["truth"] = serde_json::json!(evaluated.map(|child| child.truth).unwrap_or(false));

        if child["enabled"].as_bool() == Some(false) {
            warnings.push(serde_json::json!({"code": "child_disabled", "alert_id": id}));
        }
        if evaluated.and_then(|child| child.level_at).is_none() {
            warnings.push(serde_json::json!({"code": "child_never_evaluated", "alert_id": id}));
        }
    }

    let (result, result_level) = match evaluation.as_ref() {
        Some(evaluation) => (Some(evaluation.result), Some(evaluation.level.to_string())),
        None => (None, None),
    };

    MetaHttpResponse::json(serde_json::json!({
        "valid": true,
        "canonical_expression": canonical_expression,
        "children": children,
        "result": result,
        "result_level": result_level,
        "warnings": warnings,
    }))
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/{alert_id}/composite-references",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetCompositeReferences",
    summary = "List composite alerts referencing an alert",
    description = "Returns the composite alerts that reference the given alert as a child, plus the count of references hidden from the caller by permissions.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert or composite alert ID"),
    ),
    responses((status = 200, body = crate::models::alerts::responses::CompositeReferencesResponse))
)]
pub async fn get_composite_references(
    Path((org_id, alert_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    let db = get_orm_client_ro().await;
    let subject = openobserve_core::alerts::composite::get_composite(&org_id, &alert_id)
        .await
        .ok()
        .flatten();
    #[cfg(feature = "enterprise")]
    if let Some(_composite) = &subject
        && composite_subject_unauthorized(&_composite.definition, &user_email.user_id, "GET").await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    #[cfg(feature = "enterprise")]
    if subject.is_none() {
        // The subject is a regular alert (or missing): authorize it too, so a
        // caller who cannot read it doesn't learn which composites reference it.
        if let Ok(infra::table::alert_composites::Resolution::Alert(alert)) =
            infra::table::alert_composites::resolve_by_id(db, &org_id, &alert_id).await
            && !check_permissions(
                &alert_id,
                &org_id,
                &user_email.user_id,
                "alerts",
                "GET",
                Some(&alert.folder_id),
                false,
                true,
                false,
            )
            .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }
    let kind = if subject.is_some() {
        infra::table::alert_composites::ChildKind::Composite
    } else {
        infra::table::alert_composites::ChildKind::Alert
    };
    match infra::table::alert_composites::list_parents(db, &org_id, kind, &alert_id).await {
        Ok(parents) => {
            let mut references = Vec::new();
            #[cfg(feature = "enterprise")]
            let mut hidden_reference_count = 0;
            #[cfg(not(feature = "enterprise"))]
            let hidden_reference_count = 0;
            for parent in parents {
                #[cfg(feature = "enterprise")]
                if !check_permissions(
                    &parent.id,
                    &org_id,
                    &user_email.user_id,
                    "alerts",
                    "GET",
                    Some(&parent.folder_id),
                    false,
                    true,
                    false,
                )
                .await
                {
                    hidden_reference_count += 1;
                    continue;
                }
                references.push(serde_json::json!({
                    "alert_id": parent.id,
                    "name": parent.name,
                    "folder_id": parent.folder_id,
                }));
            }
            MetaHttpResponse::json(serde_json::json!({
                "references": references,
                "hidden_reference_count": hidden_reference_count,
            }))
        }
        Err(error) => MetaHttpResponse::internal_error(error),
    }
}

/// Max transitions returned per lane. Bounds the timeline payload; the lane
/// renderer buckets to a fixed segment count regardless.
const COMPOSITE_TIMELINE_LIMIT: u64 = 1000;
/// Default timeline window when the caller omits `from`: the last 4 hours.
const COMPOSITE_TIMELINE_DEFAULT_WINDOW_MICROS: i64 = 14_400_000_000;

#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/{alert_id}/composite-timeline",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetCompositeTimeline",
    summary = "Per-child status history for a composite alert",
    description = "Returns one status lane per child (plus the composite's own result) over a time window, read from each alert's durable level transitions. Children are ordered by display order (A/B/C).",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Composite alert ID"),
        ("from" = Option<i64>, Query, description = "Window start (micros). Defaults to 4h before `to`."),
        ("to" = Option<i64>, Query, description = "Window end (micros). Defaults to now."),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(CompositeTimelineResponse)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Composite alert per-child status timeline", "category": "alerts"}))
    )
)]
pub async fn get_composite_timeline(
    Path((org_id, alert_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    let db = get_orm_client_ro().await;
    let Some(composite) = openobserve_core::alerts::composite::get_composite(&org_id, &alert_id)
        .await
        .ok()
        .flatten()
    else {
        return MetaHttpResponse::not_found(format!("composite alert not found: {alert_id}"));
    };
    #[cfg(feature = "enterprise")]
    if composite_subject_unauthorized(&composite.definition, &user_email.user_id, "GET").await {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }

    let to = query
        .get("to")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_micros());
    let from = query
        .get("from")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or_else(|| to - COMPOSITE_TIMELINE_DEFAULT_WINDOW_MICROS);
    if from >= to {
        return MetaHttpResponse::bad_request("from must be earlier than to");
    }

    let rollup = config::meta::alerts::state::ROLLUP_GROUP_KEY;
    let child_ids: Vec<String> = composite
        .children
        .iter()
        .map(|child| child.child_alert_id.clone())
        .collect();
    let current = infra::table::alert_states::get_rollups(&child_ids)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|state| (state.alert_id.clone(), state))
        .collect::<HashMap<_, _>>();

    // Resolve child identities and fetch their transitions in one round trip
    // each, instead of one `resolve_by_id` + `list_transitions_between` per child.
    let resolutions = infra::table::alert_composites::resolve_many(db, &org_id, &child_ids)
        .await
        .unwrap_or_default();
    let mut transitions_by_alert = infra::table::alert_states::list_transitions_between_many(
        &child_ids,
        Some(rollup),
        from,
        to,
        COMPOSITE_TIMELINE_LIMIT,
    )
    .await
    .unwrap_or_default();

    let mut children = Vec::with_capacity(composite.children.len());
    for (slot, child) in composite.children.into_iter().enumerate() {
        let id = child.child_alert_id;
        #[cfg(feature = "enterprise")]
        let authorized = check_permissions(
            &id,
            &org_id,
            &user_email.user_id,
            "alerts",
            "GET",
            None,
            false,
            true,
            false,
        )
        .await;
        #[cfg(not(feature = "enterprise"))]
        let authorized = true;
        let name = if !authorized {
            None
        } else {
            match resolutions.get(&id) {
                Some(infra::table::alert_composites::Resolution::Alert(alert)) => {
                    Some(alert.name.clone())
                }
                Some(infra::table::alert_composites::Resolution::Composite(composite)) => {
                    Some(composite.name.clone())
                }
                _ => None,
            }
        };
        let state = if name.is_some() {
            current.get(&id)
        } else {
            None
        };
        let transitions = if name.is_some() {
            transitions_by_alert.remove(&id).unwrap_or_default()
        } else {
            Vec::new()
        };
        children.push(CompositeTimelineLane {
            alert_id: name.is_some().then_some(id),
            slot: Some(slot),
            name: name.clone(),
            accessible: name.is_some(),
            current_level: state
                .and_then(|state| state.level)
                .map(|level| level.to_string()),
            level_since: state.and_then(|state| state.level_since),
            transitions: transitions
                .into_iter()
                .map(|t| CompositeTimelineTransition {
                    from_level: t.from_level.map(|level| level.to_string()),
                    to_level: t.to_level.map(|level| level.to_string()),
                    at: t.at,
                })
                .collect(),
        });
    }

    let composite_state = infra::table::alert_states::get(&alert_id, rollup)
        .await
        .ok()
        .flatten();
    let result = CompositeTimelineLane {
        alert_id: Some(alert_id.clone()),
        slot: None,
        name: Some(composite.definition.name),
        accessible: true,
        current_level: composite_state
            .as_ref()
            .and_then(|state| state.level)
            .map(|level| level.to_string()),
        level_since: composite_state.as_ref().and_then(|state| state.level_since),
        transitions: infra::table::alert_states::list_transitions_between(
            &alert_id,
            Some(rollup),
            from,
            to,
            COMPOSITE_TIMELINE_LIMIT,
        )
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|t| CompositeTimelineTransition {
            from_level: t.from_level.map(|level| level.to_string()),
            to_level: t.to_level.map(|level| level.to_string()),
            at: t.at,
        })
        .collect(),
    };

    MetaHttpResponse::json(CompositeTimelineResponse {
        from,
        to,
        children,
        result,
    })
}

#[cfg(feature = "enterprise")]
async fn create_anomaly_alert(
    org_id: &str,
    user_id: String,
    req_body: CreateAlertRequestBody,
    query_folder_id: &str,
) -> Response {
    use openobserve_core::anomaly_detection::CreateAnomalyConfigRequest;

    let Some(anomaly_fields) = req_body.anomaly_fields() else {
        return MetaHttpResponse::bad_request(
            "detection_function is required when alert_type is anomaly_detection",
        );
    };

    let owner = if req_body.alert.owner.as_deref().unwrap_or("").is_empty() {
        Some(user_id)
    } else {
        req_body.alert.owner
    };

    let req = CreateAnomalyConfigRequest {
        name: req_body.alert.name,
        description: Some(req_body.alert.description).filter(|d| !d.is_empty()),
        stream_name: req_body.alert.stream_name,
        stream_type: config::meta::stream::StreamType::from(req_body.alert.stream_type).to_string(),
        query_mode: anomaly_fields.query_mode,
        filters: anomaly_fields.filters,
        custom_sql: anomaly_fields.custom_sql,
        // detection_function is already in combined form "avg(field)" from anomaly_fields()
        detection_function: anomaly_fields.detection_function,
        detection_function_field: None,
        histogram_interval: anomaly_fields.histogram_interval,
        schedule_interval: anomaly_fields.schedule_interval,
        detection_window_seconds: anomaly_fields.detection_window_seconds,
        training_window_days: anomaly_fields.training_window_days,
        retrain_interval_days: anomaly_fields.retrain_interval_days,
        percentile: anomaly_fields.percentile,
        rcf_num_trees: anomaly_fields.rcf_num_trees,
        rcf_tree_size: anomaly_fields.rcf_tree_size,
        rcf_shingle_size: anomaly_fields.rcf_shingle_size,
        alert_enabled: anomaly_fields.alert_enabled,
        alert_destinations: req_body.alert.destinations,
        enabled: Some(req_body.alert.enabled),
        // Prefer explicit folder_id in JSON body; fall back to the ?folder= query param
        // (same mechanism regular alerts use — the UI sends folder as a query param).
        folder_id: req_body
            .folder_id
            .filter(|f| !f.is_empty())
            .or_else(|| Some(query_folder_id.to_string()).filter(|f| !f.is_empty())),
        owner,
        // Feature 2: anomaly configs take the same triage metadata as
        // alerts, threaded from the shared request body.
        priority: req_body.alert.priority,
        tags: req_body.alert.tags,
    };

    match openobserve_core::anomaly_detection::create_config(org_id, req).await {
        Ok(v) => MetaHttpResponse::json(v),
        // A bad tag is user input: the same 400 the alert save path gives.
        Err(e)
            if e.downcast_ref::<config::meta::alerts::tags::TagError>()
                .is_some() =>
        {
            MetaHttpResponse::bad_request(e.to_string())
        }
        Err(e) => MetaHttpResponse::internal_error(e.to_string()),
    }
}

/// Split a rendered `k=v,k=v` label string back into pairs.
///
/// Rendering is lossy where a value contains the separators, which is exactly
/// why `group_key` — not this — is the identity. Splitting on the first `=`
/// keeps `path=/a=b` intact, the common case; anything genuinely ambiguous
/// still displays, it just may split oddly.
fn parse_group_labels(rendered: Option<&str>) -> Vec<AlertGroupLabel> {
    rendered
        .unwrap_or("")
        .split(',')
        .filter(|s| !s.is_empty())
        .filter_map(|pair| {
            pair.split_once('=').map(|(name, value)| AlertGroupLabel {
                name: name.to_string(),
                value: value.to_string(),
            })
        })
        .collect()
}

/// ListAlertGroups
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/{alert_id}/groups",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListAlertGroups",
    summary = "List a multi-alert's tracked groups",
    description = "Returns the per-group state rows of a multi-alert, most severe first, with the pre-cap group counts needed to render 'N of M groups firing'. Empty for alerts that have not opted in to per-group evaluation.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = inline(ListAlertGroupsResponseBody)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "List the per-group states of a multi-alert", "category": "alerts"}))
    )
)]
pub async fn list_alert_groups(Path((org_id, alert_id)): Path<(String, String)>) -> Response {
    let Ok(ksuid) = Ksuid::from_str(&alert_id) else {
        return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
    };
    let client = get_orm_client_ro().await;
    // Resolve through the alert itself so this endpoint inherits the same
    // org scoping and not-found behaviour as every other alert read — a raw
    // state-table query would happily serve another org's group labels, which
    // carry host and service names.
    if let Err(e) = alert::get_by_id(client, &org_id, ksuid).await {
        return e.into();
    }

    let mut groups = match infra::table::alert_states::list_groups(&alert_id).await {
        Ok(g) => g,
        Err(e) => return MetaHttpResponse::internal_error(e.to_string()),
    };
    // Most severe first (§5.4), then by key so equal levels keep a stable
    // order across polls instead of shuffling on every refresh.
    groups.sort_by(|a, b| {
        let rank = |s: &config::meta::alerts::state::AlertState| {
            s.level.map(|l| l.severity_rank()).unwrap_or(0)
        };
        rank(b)
            .cmp(&rank(a))
            .then_with(|| a.group_key.cmp(&b.group_key))
    });

    let rollup = infra::table::alert_states::get_rollups(std::slice::from_ref(&alert_id))
        .await
        .ok()
        .and_then(|mut r| r.pop());
    let groups_observed = rollup
        .as_ref()
        .and_then(|r| r.groups_observed)
        .and_then(|n| i32::try_from(n).ok());
    let group_cap = config::get_config().limit.alert_max_groups;

    let list: Vec<AlertGroupResponseItem> = groups
        .into_iter()
        .map(|g| AlertGroupResponseItem {
            labels: parse_group_labels(g.group_labels.as_deref()),
            group_key: g.group_key,
            group_labels: g.group_labels,
            level: g.level.map(|l| l.to_string()),
            level_since: g.level_since,
            last_outcome: g.last_outcome.map(|o| o.to_string()),
            last_outcome_at: g.last_outcome_at,
            last_seen: g.last_seen,
            silenced_until: g.silenced_until,
            last_notified_level: g.last_notified_level.map(|l| l.to_string()),
        })
        .collect();

    // Compare the PRE-cap observed total against the cap, not the length of
    // `list`: the retained rows are post-cap, so they would report "cap of
    // cap" and an overflowing alert would look identical to one that fit.
    let capped =
        group_cap > 0 && groups_observed.is_some_and(|observed| observed as usize > group_cap);

    MetaHttpResponse::json(ListAlertGroupsResponseBody {
        list,
        groups_observed,
        groups_firing: rollup
            .as_ref()
            .and_then(|r| r.groups_firing)
            .and_then(|n| i32::try_from(n).ok()),
        groups_observed_is_lower_bound: rollup
            .as_ref()
            .and_then(|r| r.groups_observed_is_lower_bound),
        groups_firing_is_lower_bound: rollup.as_ref().and_then(|r| r.groups_firing_is_lower_bound),
        capped,
        group_cap,
    })
}

/// ListAlertGroupTransitions
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/{alert_id}/groups/transitions",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListAlertGroupTransitions",
    summary = "Per-group state history for a multi-alert",
    description = "Returns level/outcome transitions for a multi-alert, newest first, optionally scoped to one group (M-8). Reads the durable transitions table rather than the triggers stream, so history survives group reaping.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("group_key" = Option<String>, Query, description = "Restrict to one group. Omit for every group."),
        ("limit" = Option<u64>, Query, description = "Max rows (default 100, max 1000)"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = inline(ListAlertGroupTransitionsResponseBody)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Per-group alert state history", "category": "alerts"}))
    )
)]
pub async fn list_alert_group_transitions(
    Path((org_id, alert_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let Ok(ksuid) = Ksuid::from_str(&alert_id) else {
        return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
    };
    let client = get_orm_client_ro().await;
    if let Err(e) = alert::get_by_id(client, &org_id, ksuid).await {
        return e.into();
    }

    // `None` means every group, which is NOT `Some("")` — that is the rollup
    // row's own key. An empty query value therefore has to mean "unset".
    let group_key = query
        .get("group_key")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let limit = query
        .get("limit")
        .and_then(|l| l.parse::<u64>().ok())
        .unwrap_or(100)
        .clamp(1, 1000);

    match infra::table::alert_states::list_transitions_filtered(&alert_id, group_key, limit).await {
        Ok(transitions) => MetaHttpResponse::json(ListAlertGroupTransitionsResponseBody {
            list: transitions
                .into_iter()
                .map(|t| AlertGroupTransitionItem {
                    group_key: t.group_key,
                    group_labels: t.group_labels,
                    from_level: t.from_level.map(|l| l.to_string()),
                    to_level: t.to_level.map(|l| l.to_string()),
                    from_outcome: t.from_outcome.map(|o| o.to_string()),
                    to_outcome: t.to_outcome.to_string(),
                    at: t.at,
                    value: t.value,
                })
                .collect(),
        }),
        Err(e) => MetaHttpResponse::internal_error(e.to_string()),
    }
}

/// GetAlert
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts/{alert_id}",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetAlert",
    summary = "Get alert details",
    description = "Retrieves detailed information about a specific alert including its configuration, conditions, triggers, notification settings, and current status. Useful for viewing and understanding existing alert setups. Composite alerts return a composite-shaped body (alert_type=\"composite\", composite_condition, children, evaluation) rather than GetAlertResponseBody.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if RBAC enabled)"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = inline(GetAlertResponseBody)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get alert details by ID", "category": "alerts"}))
    )
)]
pub async fn get_alert(
    Path((org_id, alert_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    let detail_user_id = Some(user_email.user_id.as_str());
    #[cfg(not(feature = "enterprise"))]
    let detail_user_id = None;
    let alert_id_str = alert_id.clone();
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = get_orm_client_rw().await;
    match alert::get_by_id(client, &org_id, alert_id).await {
        Ok((_, alert)) => {
            let key = alert.get_unique_key();
            let scheduled_job = scheduler::get(&org_id, TriggerModule::Alert, &key)
                .await
                .ok();
            let resp_body: GetAlertResponseBody = (alert, scheduled_job).into();
            MetaHttpResponse::json(resp_body)
        }
        Err(AlertError::AlertNotFound) => {
            if let Ok(Some(composite)) =
                openobserve_core::alerts::composite::get_composite(&org_id, &alert_id_str).await
            {
                return composite_detail_response(composite, detail_user_id).await;
            }
            #[cfg(not(feature = "enterprise"))]
            {
                MetaHttpResponse::not_found(format!("alert {alert_id_str} not found"))
            }
            #[cfg(feature = "enterprise")]
            {
                // Fall back to anomaly detection config lookup.
                match openobserve_core::anomaly_detection::get_config(&org_id, &alert_id_str).await
                {
                    Ok(Some(mut v)) => {
                        // Tag with alert_type so the caller can discriminate.
                        if let Some(obj) = v.as_object_mut() {
                            obj.insert(
                                "alert_type".to_string(),
                                serde_json::Value::String("anomaly_detection".to_string()),
                            );
                        }
                        MetaHttpResponse::json(v)
                    }
                    Ok(None) => {
                        MetaHttpResponse::not_found(format!("alert {alert_id_str} not found"))
                    }
                    Err(e) => MetaHttpResponse::internal_error(e.to_string()),
                }
            }
        }
        Err(e) => e.into(),
    }
}

/// ExportAlert
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/{alert_id}/export",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ExportAlert",
    summary = "Export alert configuration",
    description = "Exports the complete configuration of a specific alert in a format suitable for backup, sharing, or importing into other environments. Includes all alert settings, conditions, and notification configurations.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if RBAC enabled)"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = inline(GetAlertResponseBody)),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Export alert as JSON", "category": "alerts"}))
    )
)]
pub async fn export_alert(Path((org_id, alert_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    let alert_id_str = alert_id.clone();
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = get_orm_client_rw().await;
    match alert::get_by_id(client, &org_id, alert_id).await {
        Ok((_, alert)) => {
            let key = alert.get_unique_key();
            let scheduled_job = scheduler::get(&org_id, TriggerModule::Alert, &key)
                .await
                .ok();
            let resp_body: GetAlertResponseBody = (alert, scheduled_job).into();
            MetaHttpResponse::json(resp_body)
        }
        Err(AlertError::AlertNotFound) => {
            #[cfg(not(feature = "enterprise"))]
            {
                MetaHttpResponse::not_found("alert not found")
            }
            #[cfg(feature = "enterprise")]
            {
                // Fall back to anomaly detection config export
                match openobserve_core::anomaly_detection::get_config(&org_id, &alert_id_str).await
                {
                    Ok(Some(mut v)) => {
                        // Inject alert_type so consumers know what kind this is
                        if let Some(obj) = v.as_object_mut() {
                            obj.insert(
                                "alert_type".to_string(),
                                serde_json::Value::String("anomaly_detection".to_string()),
                            );
                            // Strip runtime/training state from the export payload
                            for key in &[
                                "is_trained",
                                "training_started_at",
                                "training_completed_at",
                                "last_processed_timestamp",
                                "current_model_version",
                                "status",
                                "last_error",
                                "retries",
                            ] {
                                obj.remove(*key);
                            }
                        }
                        MetaHttpResponse::json(v)
                    }
                    Ok(None) => MetaHttpResponse::not_found("alert not found"),
                    Err(e) => {
                        let msg = e.to_string().to_lowercase();
                        if msg.contains("not found") {
                            MetaHttpResponse::not_found(e.to_string())
                        } else {
                            MetaHttpResponse::internal_error(e.to_string())
                        }
                    }
                }
            }
        }
        Err(e) => e.into(),
    }
}

/// CloneAlert
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/{alert_id}/clone",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "CloneAlert",
    summary = "Clone an alert or anomaly detection config",
    description = "Creates a copy of an existing alert or anomaly detection config. For anomaly configs, the clone starts untrained with counters reset. Provide an optional name and folder_id in the request body.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Source alert or anomaly config ID"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if RBAC enabled)"),
    ),
    request_body(content = inline(CloneAlertRequestBody), description = "Clone options", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "create"})),
    )
)]
pub async fn clone_alert(
    Path((org_id, alert_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(req_body): Json<CloneAlertRequestBody>,
) -> Response {
    let alert_id_str = alert_id.clone();
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = get_orm_client_rw().await;

    // Check if this is a regular alert first
    match alert::get_by_id(client, &org_id, alert_id).await {
        Ok((folder, mut src_alert)) => {
            // Clone the alert: copy fields, generate new name
            let new_name = req_body
                .name
                .unwrap_or_else(|| format!("{}_copy", src_alert.name));
            let dst_folder = req_body
                .folder_id
                .unwrap_or_else(|| folder.folder_id.clone());
            src_alert.name = new_name;
            // Clear the ID so a new one is assigned on insert
            src_alert.id = None;
            match alert::create(client, &org_id, &dst_folder, src_alert, false).await {
                Ok(saved) => MetaHttpResponse::json(saved),
                Err(e) => e.into(),
            }
        }
        Err(AlertError::AlertNotFound) => {
            if let Some(_composite) =
                openobserve_core::alerts::composite::get_composite(&org_id, &alert_id_str)
                    .await
                    .ok()
                    .flatten()
            {
                #[cfg(feature = "enterprise")]
                if composite_subject_unauthorized(
                    &_composite.definition,
                    &user_email.user_id,
                    "GET",
                )
                .await
                {
                    return MetaHttpResponse::forbidden("Unauthorized Access");
                }
                return match openobserve_core::alerts::composite::clone_composite(
                    &org_id,
                    &alert_id_str,
                    req_body.name,
                    req_body.folder_id,
                    "api".to_string(),
                )
                .await
                {
                    Ok(saved) => MetaHttpResponse::json(serde_json::json!({
                        "id": saved.id,
                        "name": saved.name,
                        "alert_type": "composite",
                    })),
                    Err(error) => composite_error_response(error),
                };
            }
            #[cfg(not(feature = "enterprise"))]
            {
                MetaHttpResponse::not_found(format!("alert {alert_id_str} not found"))
            }
            #[cfg(feature = "enterprise")]
            {
                // Fall back to anomaly detection config clone
                match openobserve_core::anomaly_detection::clone_config(
                    &org_id,
                    &alert_id_str,
                    req_body.name,
                    req_body.folder_id,
                )
                .await
                {
                    Ok(v) => MetaHttpResponse::json(v),
                    Err(e) => {
                        let msg = e.to_string().to_lowercase();
                        if msg.contains("not found") {
                            MetaHttpResponse::not_found(e.to_string())
                        } else {
                            MetaHttpResponse::internal_error(e.to_string())
                        }
                    }
                }
            }
        }
        Err(e) => e.into(),
    }
}

/// UpdateAlert
#[utoipa::path(
    put,
    path = "/v2/{org_id}/alerts/{alert_id}",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "UpdateAlert",
    summary = "Update alert configuration",
    description = "Updates an existing alert's configuration including conditions, queries, thresholds, notification destinations, and scheduling. Allows users to modify alert behavior and settings as monitoring requirements change.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if RBAC enabled)"),
      ),
    request_body(content = inline(UpdateAlertRequestBody), description = "Alert data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update an existing alert", "category": "alerts"}))
    )
)]
pub async fn update_alert(
    Path((org_id, alert_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(req_body): Json<UpdateAlertRequestBody>,
) -> Response {
    let alert_id_str = alert_id.clone();
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };

    // Explicit anomaly detection path (enterprise only).
    #[cfg(feature = "enterprise")]
    if req_body.alert_type == Some(AlertTypeFilter::AnomalyDetection) {
        let alert = req_body.alert.clone();
        let anomaly_fields = req_body.anomaly_fields();
        return build_and_run_anomaly_update(
            &org_id,
            &alert_id_str,
            user_email.user_id,
            anomaly_fields,
            alert,
        )
        .await;
    }
    if req_body.alert_type == Some(AlertTypeFilter::Composite) {
        return update_composite_alert(&org_id, &alert_id_str, user_email.user_id, req_body).await;
    }

    // Save anomaly fields before req_body is consumed, in case we need the fallback.
    #[cfg(feature = "enterprise")]
    let anomaly_config = req_body.anomaly_fields();
    #[cfg(feature = "enterprise")]
    let alert_fields_for_fallback = req_body.alert.clone();

    let mut alert: MetaAlert = req_body.into();
    alert.last_edited_by = Some(user_email.user_id.clone());
    alert.id = Some(alert_id);

    let client = get_orm_client_rw().await;
    match alert::update(client, &org_id, None, alert).await {
        Ok(_) => MetaHttpResponse::ok("Alert Updated"),
        Err(AlertError::AlertNotFound) => {
            #[cfg(not(feature = "enterprise"))]
            {
                MetaHttpResponse::not_found(format!("alert {alert_id_str} not found"))
            }
            #[cfg(feature = "enterprise")]
            {
                // ID not in alerts table — try anomaly config.
                build_and_run_anomaly_update(
                    &org_id,
                    &alert_id_str,
                    user_email.user_id,
                    anomaly_config,
                    alert_fields_for_fallback,
                )
                .await
            }
        }
        Err(e) => e.into(),
    }
}

#[cfg(feature = "enterprise")]
async fn build_and_run_anomaly_update(
    org_id: &str,
    anomaly_id: &str,
    user_id: String,
    fields: UpdateAnomalyAlertFields,
    alert: crate::models::alerts::Alert,
) -> Response {
    use openobserve_core::anomaly_detection::UpdateAnomalyConfigRequest;

    let owner = fields
        .owner
        .or_else(|| alert.owner.clone())
        .or(Some(user_id));
    let name = fields
        .name
        .or_else(|| Some(alert.name).filter(|n| !n.is_empty()));
    let description = fields
        .description
        .or_else(|| Some(alert.description).filter(|d| !d.is_empty()));

    let req = UpdateAnomalyConfigRequest {
        name,
        description,
        query_mode: fields.query_mode,
        filters: fields.filters,
        custom_sql: fields.custom_sql,
        detection_function: fields.detection_function,
        detection_function_field: None, /* already combined into detection_function by
                                         * anomaly_fields() */
        histogram_interval: fields.histogram_interval,
        schedule_interval: fields.schedule_interval,
        detection_window_seconds: fields.detection_window_seconds,
        training_window_days: fields.training_window_days,
        percentile: fields.percentile,
        retrain_interval_days: fields.retrain_interval_days,
        alert_enabled: fields.alert_enabled,
        alert_destinations: Some(alert.destinations),
        enabled: fields.enabled,
        folder_id: fields.folder_id,
        owner,
        // The v2 PUT carries the FULL alert body, so this is replace
        // semantics: wrapping in `Some` means an omitted priority clears it,
        // matching how tags behave one line down.
        priority: Some(alert.priority),
        // `Some(vec![])` clears; the shared body always supplies a Vec,
        // so an edit that removes every tag does clear them.
        tags: Some(alert.tags),
    };

    match openobserve_core::anomaly_detection::update_config(org_id, anomaly_id, req).await {
        Ok(v) => MetaHttpResponse::json(v),
        // Same 400 as create: an invalid tag is the caller's to fix.
        Err(e)
            if e.downcast_ref::<config::meta::alerts::tags::TagError>()
                .is_some() =>
        {
            MetaHttpResponse::bad_request(e.to_string())
        }
        Err(e) => MetaHttpResponse::internal_error(e.to_string()),
    }
}

/// DeleteAlert
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/alerts/{alert_id}",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteAlert",
    summary = "Delete alert",
    description = "Permanently removes an alert and all its configurations including conditions, triggers, and notification settings. This action cannot be undone and will stop all monitoring and notifications for the deleted alert. Also deletes composite alerts; returns 409 when the alert is referenced by one or more composite alerts.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if RBAC enabled)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 409, description = "Referenced by composite alerts", content_type = "application/json", body = Object),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete an alert by ID", "category": "alerts", "requires_confirmation": true}))
    )
)]
pub async fn delete_alert(
    Path((org_id, alert_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let alert_id_str = alert_id.clone();
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = get_orm_client_rw().await;

    // Check whether this ID belongs to a regular alert before attempting delete.
    // delete_by_id silently returns Ok(()) when the record is not found (required
    // for super-cluster sync idempotency), so we must check existence explicitly.
    let is_regular_alert = alert::get_by_id(client, &org_id, alert_id).await.is_ok();

    if is_regular_alert {
        return match alert::delete_by_id_user(client, &org_id, alert_id).await {
            Ok(_) => MetaHttpResponse::ok("Alert deleted"),
            Err(AlertError::AlertReferencedByComposites { parents }) => {
                reference_conflict_response(
                    &org_id,
                    &user_email.user_id,
                    parents
                        .into_iter()
                        .map(|parent| (parent.alert_id, parent.name, parent.folder_id))
                        .collect(),
                )
                .await
            }
            Err(e) => e.into(),
        };
    }

    if let Some(_composite) =
        openobserve_core::alerts::composite::get_composite(&org_id, &alert_id_str)
            .await
            .ok()
            .flatten()
    {
        #[cfg(feature = "enterprise")]
        if composite_subject_unauthorized(&_composite.definition, &user_email.user_id, "DELETE")
            .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
        return match openobserve_core::alerts::composite::delete_composite(&org_id, &alert_id_str)
            .await
        {
            Ok(()) => MetaHttpResponse::ok("Alert deleted"),
            Err(openobserve_core::alerts::composite::CompositeServiceError::ChildReferenced(
                parents,
            )) => {
                reference_conflict_response(
                    &org_id,
                    &user_email.user_id,
                    parents
                        .into_iter()
                        .map(|parent| (parent.id, parent.name, parent.folder_id))
                        .collect(),
                )
                .await
            }
            Err(error) => composite_error_response(error),
        };
    }

    // Not a regular alert — try anomaly detection config (enterprise only).
    #[cfg(feature = "enterprise")]
    {
        match openobserve_core::anomaly_detection::delete_config(&org_id, &alert_id_str).await {
            Ok(_) => MetaHttpResponse::ok("Alert deleted"),
            Err(e) => {
                let msg = e.to_string().to_lowercase();
                if msg.contains("not found") {
                    MetaHttpResponse::not_found(e.to_string())
                } else {
                    MetaHttpResponse::internal_error(e.to_string())
                }
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    MetaHttpResponse::not_found(format!("alert {alert_id_str} not found"))
}

async fn readable_parent_snapshot(
    org_id: &str,
    user_id: &str,
    parents: Vec<(String, String, String)>,
) -> (Vec<serde_json::Value>, usize) {
    #[cfg(not(feature = "enterprise"))]
    let _ = (org_id, user_id);
    let mut references = Vec::new();
    #[cfg(feature = "enterprise")]
    let mut hidden = 0;
    #[cfg(not(feature = "enterprise"))]
    let hidden = 0;
    for (alert_id, name, folder_id) in parents {
        #[cfg(feature = "enterprise")]
        if !check_permissions(
            &alert_id,
            org_id,
            user_id,
            "alerts",
            "GET",
            Some(&folder_id),
            false,
            true,
            false,
        )
        .await
        {
            hidden += 1;
            continue;
        }
        references.push(serde_json::json!({
            "alert_id": alert_id,
            "name": name,
            "folder_id": folder_id,
        }));
    }
    (references, hidden)
}

async fn reference_conflict_response(
    org_id: &str,
    user_id: &str,
    parents: Vec<(String, String, String)>,
) -> Response {
    let (references, hidden_reference_count) =
        readable_parent_snapshot(org_id, user_id, parents).await;
    (
        StatusCode::CONFLICT,
        Json(serde_json::json!({
            "code": "child_referenced",
            "message": "this alert is referenced by one or more composite alerts",
            "references": references,
            "hidden_reference_count": hidden_reference_count,
        })),
    )
        .into_response()
}

/// DeleteAlertBulk
#[utoipa::path(
    delete,
    path = "/v2/{org_id}/alerts/bulk",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "DeleteAlertBulk",
    summary = "Delete multiple alerts",
    description = "Permanently removes multiple alerts and all their configurations including conditions, triggers, and notification settings. This action cannot be undone and will stop all monitoring and notifications for the deleted alerts.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization id"),
    ),
    request_body(content = BulkDeleteRequest, description = "Alert ids", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkDeleteAlertResponse),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_alert_bulk(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<BulkDeleteRequest>,
) -> Response {
    let _user_id = user_email.user_id;
    let _folder_id = common::utils::http::get_folder(&query);

    #[cfg(feature = "enterprise")]
    for id in &req.ids {
        if Ksuid::from_str(id).is_err() {
            return MetaHttpResponse::bad_request(format!("invalid alert id {id}"));
        };
        if !check_permissions(
            id,
            &org_id,
            &_user_id,
            "alerts",
            "DELETE",
            Some(&_folder_id),
            false,
            true,
            false,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;
    let mut conflicts = Vec::new();

    let client = get_orm_client_rw().await;
    for id in req.ids {
        // already checked this is valid, so ok to unwrap
        let alert_id = Ksuid::from_str(&id).unwrap();
        let is_regular_alert = alert::get_by_id(client, &org_id, alert_id).await.is_ok();
        let result = if is_regular_alert {
            match alert::delete_by_id_user(client, &org_id, alert_id).await {
                Ok(()) => Ok(()),
                Err(AlertError::AlertReferencedByComposites { parents }) => {
                    let (references, hidden_reference_count) = readable_parent_snapshot(
                        &org_id,
                        &_user_id,
                        parents
                            .into_iter()
                            .map(|parent| (parent.alert_id, parent.name, parent.folder_id))
                            .collect(),
                    )
                    .await;
                    conflicts.push(serde_json::json!({
                        "alert_id": id,
                        "code": "child_referenced",
                        "references": references,
                        "hidden_reference_count": hidden_reference_count,
                    }));
                    Err("child_referenced".to_string())
                }
                Err(error) => Err(error.to_string()),
            }
        } else if let Some(_composite) =
            openobserve_core::alerts::composite::get_composite(&org_id, &id)
                .await
                .ok()
                .flatten()
        {
            #[cfg(feature = "enterprise")]
            if composite_subject_unauthorized(&_composite.definition, &_user_id, "DELETE").await {
                return MetaHttpResponse::forbidden("Unauthorized Access");
            }
            match openobserve_core::alerts::composite::delete_composite(&org_id, &id).await {
                Ok(()) => Ok(()),
                Err(
                    openobserve_core::alerts::composite::CompositeServiceError::ChildReferenced(
                        parents,
                    ),
                ) => {
                    let (references, hidden_reference_count) = readable_parent_snapshot(
                        &org_id,
                        &_user_id,
                        parents
                            .into_iter()
                            .map(|parent| (parent.id, parent.name, parent.folder_id))
                            .collect(),
                    )
                    .await;
                    conflicts.push(serde_json::json!({
                        "alert_id": id,
                        "code": "child_referenced",
                        "references": references,
                        "hidden_reference_count": hidden_reference_count,
                    }));
                    Err("child_referenced".to_string())
                }
                Err(error) => Err(error.to_string()),
            }
        } else {
            // Not a regular alert — fall back to anomaly config delete (enterprise only).
            #[cfg(not(feature = "enterprise"))]
            {
                Err(format!("alert {id} not found"))
            }
            #[cfg(feature = "enterprise")]
            openobserve_core::anomaly_detection::delete_config(&org_id, &id)
                .await
                .map_err(|e: anyhow::Error| e.to_string())
        };
        match result {
            Ok(_) => successful.push(id),
            Err(e) => {
                log::error!("error deleting alert {org_id}/{id} : {e}");
                unsuccessful.push(id);
                err = Some(e);
            }
        }
    }

    MetaHttpResponse::json(serde_json::json!({
        "successful": successful,
        "unsuccessful": unsuccessful,
        "err": err,
        "conflicts": conflicts,
    }))
}

/// Query parameters for the tag facet endpoint (PT-8b).
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(style = Form, parameter_in = Query)]
#[serde(rename_all = "snake_case")]
pub struct ListAlertTagsQuery {
    /// Optional case-insensitive prefix filter for autocomplete.
    pub prefix: Option<String>,
    /// Maximum tags to return. Defaults to 100, capped at 1000.
    pub limit: Option<usize>,
    /// Restrict to one folder, matching the list endpoint's scope.
    pub folder: Option<String>,
}

/// One tag and how many visible alerts carry it.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct AlertTagCount {
    pub tag: String,
    pub count: u64,
}

/// ListAlertTags
///
/// Distinct alert tags for autocomplete and facets (PT-8b).
///
/// **Authorization is load-bearing, not incidental (D23):** tag values leak
/// service, environment, team and customer names, so this returns only tags
/// carried by alerts the caller may actually list. It reuses the list
/// endpoint's permission path rather than scanning the org-wide cache.
#[utoipa::path(
    get,
    path = "/{org_id}/alerts/tags",
    context_path = "/api/v2",
    tag = "Alerts",
    operation_id = "ListAlertTags",
    summary = "List distinct alert tags",
    description = "Returns distinct tags across the alerts the caller can see, with occurrence counts, for autocomplete and filter facets.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), ListAlertTagsQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<AlertTagCount>),
        (status = 403, description = "Forbidden", content_type = "application/json"),
    ),
)]
pub async fn list_alert_tags(
    Path(org_id): Path<String>,
    Query(query): Query<ListAlertTagsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    let user_id = None;
    #[cfg(feature = "enterprise")]
    let user_id = Some(user_email.user_id.as_str());

    // Bounded (PT-8b): 1,000 alerts x 64 tags is 64,000 values, so "return
    // everything" is not an option the response size can afford.
    const DEFAULT_LIMIT: usize = 100;
    const MAX_LIMIT: usize = 1000;
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    // Resolve the caller's VISIBLE alerts through the same permission path the
    // list endpoint uses — this is what keeps the facet from leaking tags off
    // alerts the caller cannot see.
    let mut params = config::meta::alerts::alert::ListAlertsParams::new(&org_id);
    if let Some(folder) = query.folder.clone() {
        params = params.in_folder(&folder);
    }
    let client = get_orm_client_ro().await;
    let visible_ids: Vec<String> = match alert::list_v2(client, user_id, params).await {
        Ok(list) => list
            .into_iter()
            .filter_map(|(_, a)| a.id.map(|id| id.to_string()))
            .collect(),
        Err(e) => return e.into(),
    };

    let counts = db::alerts::alert::tag_counts_for_alerts(&org_id, &visible_ids).await;

    // Resolve composite visibility in bulk (one query), mirroring the
    // regular-alert `visible_ids` path, rather than a per-composite
    // `check_permissions` call.
    #[cfg(feature = "enterprise")]
    let visibility = permitted_alert_visibility(&org_id, user_email.user_id.as_str()).await;

    let mut composite_counts = std::collections::BTreeMap::<String, u64>::new();
    if let Ok(composites) = infra::table::alert_composites::list_by_org(client, &org_id).await {
        for composite in composites.into_iter().filter(|composite| {
            query
                .folder
                .as_ref()
                .is_none_or(|folder| &composite.folder_id == folder)
        }) {
            #[cfg(feature = "enterprise")]
            if !visible_alert(
                &visibility,
                &composite.id,
                &composite.folder_id,
                &composite.name,
            ) {
                continue;
            }
            let tags: Vec<String> = composite
                .tags
                .and_then(|tags| serde_json::from_value(tags).ok())
                .unwrap_or_default();
            for tag in tags {
                *composite_counts.entry(tag).or_default() += 1;
            }
        }
    }
    // Index the alert tag counts by tag so the composite merge is O(1) per tag
    // instead of a linear scan over every existing tag.
    let mut count_map: std::collections::HashMap<String, u64> = counts.iter().cloned().collect();
    for (tag, count) in composite_counts {
        *count_map.entry(tag).or_default() += count;
    }
    let mut counts: Vec<(String, u64)> = count_map.into_iter().collect();

    if let Some(prefix) = query.prefix.as_deref() {
        let prefix = prefix.trim().to_lowercase();
        if !prefix.is_empty() {
            counts.retain(|(tag, _)| tag.starts_with(&prefix));
        }
    }

    // Deterministic order: most-used first, then lexicographic so the tail is
    // stable rather than hash-ordered.
    counts.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    counts.truncate(limit);

    let body: Vec<AlertTagCount> = counts
        .into_iter()
        .map(|(tag, count)| AlertTagCount { tag, count })
        .collect();
    MetaHttpResponse::json(body)
}

/// ListAlerts
#[utoipa::path(
    get,
    path = "/v2/{org_id}/alerts",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListAlerts",
    summary = "List organization alerts",
    description = "Retrieves a list of all alerts in the organization with filtering and pagination options. Shows alert summaries including names, status, folder organization, and basic configuration details for monitoring and management purposes.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ListAlertsQuery,
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(ListAlertsResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "list"})),
        ("x-o2-mcp" = json!({
            "description": "List all alerts",
            "category": "alerts",
            "summary_fields": ["name", "stream_name", "stream_type", "enabled", "is_real_time", "folder_id", "folder_name"]
        }))
    )
)]
pub async fn list_alerts(
    Path(org_id): Path<String>,
    // `axum_extra`'s Query (serde_html_form) rather than axum's
    // (serde_urlencoded): only the former deserializes REPEATED keys into a
    // `Vec`, which PT-3 requires for `?priority=1&priority=2`. axum's Query
    // errors with "invalid type: string, expected a sequence".
    ExtraQuery(query): ExtraQuery<ListAlertsQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(not(feature = "enterprise"))]
    let user_id = None;
    #[cfg(feature = "enterprise")]
    let user_id = Some(user_email.user_id.as_str());

    // Resolve the caller's visible object set once per request; it gates both
    // the composite merge below and the `referenced_by_composite_count`
    // enrichment, so we don't run per-row or duplicate permission lookups.
    let visibility = match user_id {
        Some(user_id) => permitted_alert_visibility(&org_id, user_id).await,
        None => None,
    };

    let folder_slug = query.folder.clone();
    let name_substring = query.alert_name_substring.clone();
    let enabled_filter = query.enabled;
    let page_size_and_idx = query.page_size.map(|s| (s, query.page_idx.unwrap_or(0)));

    // Resolve the tag filter to an alert-ID set BEFORE building the query
    // (PT-8): the tags column is JSON, and the filter must enter the SQL as an
    // ID predicate so pagination and sorting stay correct rather than
    // post-filtering an already-fetched page.
    let requested_tags = query.requested_tags();

    // Opt-in (dependency view only): destinations/template ride the response only
    // when asked for. Captured before `query` is moved into `params` below.
    let include_dependencies = query.include_dependencies.unwrap_or(false);

    #[cfg(not(feature = "enterprise"))]
    let mut params = query.into(&org_id);
    #[cfg(feature = "enterprise")]
    let mut params = query.into(&org_id);

    if !requested_tags.is_empty() {
        // `Some(empty)` is meaningful: no alert carries these tags, so the
        // result must be empty. Leaving it `None` would match everything.
        params = params.with_tag_alert_ids(
            db::alerts::alert::resolve_alert_ids_by_tags(&org_id, &requested_tags).await,
        );
    }

    let alert_type = params.alert_type;
    // Anomaly configs are merged in AFTER the SQL query, so the priority/tag
    // filters in the query never touch them — they must be applied in Rust to
    // the merged rows instead (see below). Captured before `params` is moved.
    // (enterprise-only consumers; OSS builds merge no anomaly configs)
    #[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
    let priority_filter = params.priority.clone();
    #[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
    let tag_filter = requested_tags.clone();
    // Anomaly rows bypass the SQL ORDER BY too, so a merged list must be
    // re-sorted in memory.
    #[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
    let requested_sort = (params.sort_by, params.sort_desc);

    // Composite definitions are fetched once here — used both to decide whether
    // the `All` filter must merge (and so drop SQL pagination) and to build the
    // merged rows below.
    let db = get_orm_client_ro().await;
    let composite_definitions = if matches!(
        alert_type,
        AlertTypeFilter::All | AlertTypeFilter::Composite
    ) {
        infra::table::alert_composites::list_by_org(db, &org_id)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    // Only force a full fetch when an extra kind is actually being merged in.
    // A single-kind list keeps SQL LIMIT/OFFSET so we don't fetch and sort
    // every row in memory. `All` merges composites (and, in enterprise, anomaly
    // configs) only when they exist.
    let merges_extra = match alert_type {
        AlertTypeFilter::Composite | AlertTypeFilter::AnomalyDetection => true,
        AlertTypeFilter::All => {
            !composite_definitions.is_empty() || {
                #[cfg(feature = "enterprise")]
                {
                    openobserve_core::anomaly_detection::list_configs(&org_id, None, None)
                        .await
                        .map(|configs| !configs.is_empty())
                        .unwrap_or(false)
                }
                #[cfg(not(feature = "enterprise"))]
                {
                    false
                }
            }
        }
        _ => false,
    };
    if merges_extra {
        // Bound the regular-alert fetch to the prefix that could fall inside the
        // requested page rather than fetching every row. Composites/anomalies
        // only push regular alerts down the merged order, so the regular rows in
        // any page are a subset of the first `(page_idx + 1) * page_size` regular
        // rows. Unpaginated requests (no page_size) still fetch everything.
        params.page_size_and_idx = page_size_and_idx
            .map(|(page_size, page_idx)| (page_idx.saturating_add(1).saturating_mul(page_size), 0));
    }

    // Fetch regular (scheduled / realtime) alerts unless the filter is anomaly-only.
    let mut list: Vec<ListAlertsResponseBodyItem> = if !matches!(
        alert_type,
        AlertTypeFilter::AnomalyDetection | AlertTypeFilter::Composite
    ) {
        let client = get_orm_client_ro().await;
        let mut scheduled_jobs: HashMap<String, Trigger> =
            scheduler::list_by_org(&org_id, Some(TriggerModule::Alert))
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|t| (t.module_key.clone(), t))
                .collect();

        let folders_and_alerts = match alert::list_v2(client, user_id, params).await {
            Ok(v) => v,
            Err(e) => return e.into(),
        };

        folders_and_alerts
                .into_iter()
                // Apply is_real_time filter when a specific type is requested.
                .filter(|(_, a)| match alert_type {
                    AlertTypeFilter::Scheduled => {
                        !a.is_real_time && a.query_condition.slo_condition.is_none()
                    }
                    AlertTypeFilter::Realtime => {
                        a.is_real_time && a.query_condition.slo_condition.is_none()
                    }
                    AlertTypeFilter::Slo => a.query_condition.slo_condition.is_some(),
                    _ => true,
                })
                .map(|(folder, alert)| {
                    let key = alert.get_unique_key();
                    (folder, alert, scheduled_jobs.remove(&key))
                })
                .filter_map(|item| ListAlertsResponseBodyItem::try_from(item).ok())
                .collect()
    } else {
        vec![]
    };
    // Merge composite rows. Folder display names are resolved once (like the
    // regular-alert folder join) rather than one lookup per row.
    if matches!(
        alert_type,
        AlertTypeFilter::All | AlertTypeFilter::Composite
    ) && !composite_definitions.is_empty()
    {
        let folder_names: HashMap<String, String> =
            infra::table::folders::list_folders(&org_id, config::meta::folder::FolderType::Alerts)
                .await
                .map(|folders| {
                    folders
                        .into_iter()
                        .map(|folder| (folder.folder_id, folder.name))
                        .collect()
                })
                .unwrap_or_default();

        for definition in composite_definitions {
            if !folder_slug
                .as_ref()
                .is_none_or(|folder| &definition.folder_id == folder)
                || !name_substring.as_ref().is_none_or(|name| {
                    definition
                        .name
                        .to_lowercase()
                        .contains(&name.to_lowercase())
                })
                || !enabled_filter.is_none_or(|enabled| definition.enabled == enabled)
            {
                continue;
            }
            if !visible_alert(
                &visibility,
                &definition.id,
                &definition.folder_id,
                &definition.name,
            ) {
                continue;
            }
            let folder_name = folder_names
                .get(&definition.folder_id)
                .cloned()
                .unwrap_or_else(|| definition.folder_id.clone());
            let Some(item) = composite_list_item(definition, &folder_name) else {
                continue;
            };
            let priority_matches = match &priority_filter {
                None => true,
                Some(wanted) => item.priority.is_some_and(|priority| {
                    wanted.iter().any(|value| value.to_i32() as u8 == priority)
                }),
            };
            if priority_matches
                && config::meta::alerts::tags::matches_all_tags(&item.tags, &tag_filter)
            {
                list.push(item);
            }
        }
    }

    // Fetch anomaly detection configs and merge when the filter includes them (enterprise only).
    #[cfg(feature = "enterprise")]
    if matches!(
        alert_type,
        AlertTypeFilter::All | AlertTypeFilter::AnomalyDetection
    ) && let Ok(configs) = openobserve_core::anomaly_detection::list_configs(
        &org_id,
        folder_slug.as_deref(),
        name_substring.as_deref(),
    )
    .await
    {
        // Apply the Feature-2 filters here, because these rows bypassed the
        // SQL WHERE clause entirely. Without this a priority or tag filter
        // would return every anomaly config alongside the matching alerts.
        let before = list.len();
        list.extend(
            configs
                .iter()
                .filter_map(anomaly_config_to_list_item)
                .filter(|item| enabled_filter.is_none_or(|enabled| item.enabled == enabled))
                .filter(|item| match &priority_filter {
                    None => true,
                    // An empty set means "asked for priorities, none valid" —
                    // matches nothing, same as the SQL side.
                    Some(wanted) => item
                        .priority
                        .is_some_and(|p| wanted.iter().any(|w| w.to_i32() as u8 == p)),
                })
                .filter(|item| {
                    config::meta::alerts::tags::matches_all_tags(&item.tags, &tag_filter)
                }),
        );
        // Without this the appended rows pin to the tail whatever order was
        // requested, and the pagination below cuts the combined list in the
        // wrong places. Only when something merged — an untouched list keeps
        // the database's own collation.
        if list.len() > before {
            sort_merged_alert_list(&mut list, requested_sort.0, requested_sort.1);
        }
    }

    sort_merged_alert_list(&mut list, requested_sort.0, requested_sort.1);

    // Apply pagination to the combined list. Single-kind lists were already
    // paginated by the SQL query, so only re-paginate when extra kinds were
    // merged in after it.
    let list = if merges_extra {
        if let Some((page_size, page_idx)) = page_size_and_idx {
            // Use saturating_mul to prevent u64 overflow before casting to usize.
            let start = page_idx.saturating_mul(page_size) as usize;
            list.into_iter()
                .skip(start)
                .take(page_size as usize)
                .collect()
        } else {
            list
        }
    } else {
        list
    };

    // Enrich with durable run state (Part IV of alerts.md). One batched query
    // over the page that is actually being returned — not per alert.
    let mut list = list;
    enrich_with_run_state(&mut list).await;
    enrich_with_composite_metadata(&org_id, &visibility, &mut list).await;

    // Feature-scoped fields: keep destinations/template off the default list path
    // (bytes + module-scoped names) unless the dependency view explicitly opted in.
    if !include_dependencies {
        for item in &mut list {
            item.destinations = Vec::new();
            item.template = None;
        }
    }

    MetaHttpResponse::json(ListAlertsResponseBody { list })
}

/// Resolve the caller's visible alert/composite object set in one bulk query,
/// mirroring `alert::list_v2`'s `permitted_alerts` path. `None` means "no
/// filtering" (root user, OpenFGA disabled, or list-only-off), which is also the
/// only result in OSS builds.
async fn permitted_alert_visibility(
    org_id: &str,
    user_id: &str,
) -> Option<(bool, hashbrown::HashSet<String>)> {
    let permitted = alert::permitted_alerts(org_id, Some(user_id), None)
        .await
        .ok()
        .flatten()?;
    let is_all_permitted = permitted
        .iter()
        .any(|object| object == &format!("alert:_all_{org_id}"));
    Some((is_all_permitted, permitted.into_iter().collect()))
}

fn visible_alert(
    visibility: &Option<(bool, hashbrown::HashSet<String>)>,
    id: &str,
    folder_id: &str,
    name: &str,
) -> bool {
    match visibility {
        None => true,
        Some((is_all_permitted, permitted)) => {
            *is_all_permitted
                || permitted.contains(&format!("alert:{}", name))
                || permitted.contains(&format!("alert:{}/{}", folder_id, id))
                || permitted.contains(&format!("alert:{}", id))
        }
    }
}

async fn enrich_with_composite_metadata(
    org_id: &str,
    visibility: &Option<(bool, hashbrown::HashSet<String>)>,
    list: &mut [ListAlertsResponseBodyItem],
) {
    let db = get_orm_client_ro().await;

    // Split the page by kind and resolve everything in bulk: one child-count
    // query for composites and two reverse-reference queries, instead of a
    // per-row `get_by_id` + `list_parents`.
    let mut composite_ids = Vec::new();
    let mut alert_ids = Vec::new();
    for item in list.iter() {
        if !matches!(item.alert_type.as_str(), "scheduled" | "slo" | "composite") {
            continue;
        }
        let id = item.alert_id.to_string();
        if item.alert_type == "composite" {
            composite_ids.push(id);
        } else {
            alert_ids.push(id);
        }
    }

    let child_counts = infra::table::alert_composites::children_count_for_many(db, &composite_ids)
        .await
        .unwrap_or_default();
    let parents_for_composites = infra::table::alert_composites::list_parents_for_many(
        db,
        org_id,
        infra::table::alert_composites::ChildKind::Composite,
        &composite_ids,
    )
    .await
    .unwrap_or_default();
    let parents_for_alerts = infra::table::alert_composites::list_parents_for_many(
        db,
        org_id,
        infra::table::alert_composites::ChildKind::Alert,
        &alert_ids,
    )
    .await
    .unwrap_or_default();

    for item in list.iter_mut() {
        if !matches!(item.alert_type.as_str(), "scheduled" | "slo" | "composite") {
            continue;
        }
        let id = item.alert_id.to_string();
        if item.alert_type == "composite" {
            // Every listed composite exists; a composite with no child rows
            // still reports zero, matching the old per-row `children.len()`.
            item.child_count = Some(child_counts.get(&id).copied().unwrap_or(0));
        }
        let parents = if item.alert_type == "composite" {
            &parents_for_composites
        } else {
            &parents_for_alerts
        };
        let readable = parents
            .get(&id)
            .map(|parents| {
                parents
                    .iter()
                    .filter(|parent| {
                        visible_alert(visibility, &parent.id, &parent.folder_id, &parent.name)
                    })
                    .count()
            })
            .unwrap_or(0);
        item.referenced_by_composite_count = Some(readable);
    }
}

/// Attach `last_outcome` / `last_outcome_at` / `last_outcome_since` to a page of
/// alerts from the `alert_states` rollup rows.
///
/// Best-effort: if the lookup fails the list is still returned, just without run
/// state. A state table problem must not take down the alerts page.
/// Re-sort a merged (regular + anomaly) list the way the SQL ORDER BY sorts
/// the regular one (PT-3): unset priority LAST in both directions, ties broken
/// on (name, folder name, id) so pagination stays a total order.
fn sort_merged_alert_list(
    list: &mut [ListAlertsResponseBodyItem],
    sort_by: Option<config::meta::alerts::alert::AlertSortField>,
    sort_desc: bool,
) {
    use std::cmp::Ordering;

    use config::meta::alerts::alert::AlertSortField;

    let tail = |a: &ListAlertsResponseBodyItem, b: &ListAlertsResponseBodyItem| {
        a.name
            .cmp(&b.name)
            .then_with(|| a.folder_name.cmp(&b.folder_name))
            .then_with(|| a.alert_id.to_string().cmp(&b.alert_id.to_string()))
    };
    match sort_by {
        Some(AlertSortField::Priority) => list.sort_by(|a, b| {
            // NULL priority sorts last regardless of direction, matching the
            // SQL's explicit CASE.
            let nulls = (a.priority.is_none() as u8).cmp(&(b.priority.is_none() as u8));
            let pri = match (a.priority, b.priority) {
                (Some(x), Some(y)) if sort_desc => y.cmp(&x),
                (Some(x), Some(y)) => x.cmp(&y),
                _ => Ordering::Equal,
            };
            nulls.then(pri).then_with(|| tail(a, b))
        }),
        Some(AlertSortField::Name) => list.sort_by(|a, b| {
            let name = if sort_desc {
                b.name.cmp(&a.name)
            } else {
                a.name.cmp(&b.name)
            };
            name.then_with(|| a.folder_name.cmp(&b.folder_name))
                .then_with(|| a.alert_id.to_string().cmp(&b.alert_id.to_string()))
        }),
        // Historical default, matching the SQL arm.
        None => list.sort_by(|a, b| {
            a.name
                .cmp(&b.name)
                .then_with(|| a.folder_name.cmp(&b.folder_name))
        }),
    }
}

async fn enrich_with_run_state(list: &mut [ListAlertsResponseBodyItem]) {
    if list.is_empty() {
        return;
    }
    let ids: Vec<String> = list.iter().map(|i| i.alert_id.to_string()).collect();
    let states = match infra::table::alert_states::get_rollups(&ids).await {
        Ok(s) => s,
        Err(e) => {
            log::warn!("failed to load alert run state for list: {e}");
            return;
        }
    };
    if states.is_empty() {
        return;
    }
    let by_id: std::collections::HashMap<_, _> = states
        .into_iter()
        .map(|s| (s.alert_id.clone(), s))
        .collect();
    for item in list.iter_mut() {
        if let Some(state) = by_id.get(&item.alert_id.to_string()) {
            item.last_outcome = state.last_outcome.as_ref().map(|o| o.to_string());
            item.last_outcome_at = state.last_outcome_at;
            item.last_outcome_since = state.since;
            item.level = state.level.map(|l| l.to_string());
            item.level_since = state.level_since;
            // §5.4: the group counts live on the rollup row and are the only
            // source for the "N of M groups firing" chip — they are computed
            // pre-cap, so they cannot be reconstructed by counting the
            // retained state rows. The exactness markers ride along because
            // exactness likewise cannot be re-derived from the counts and a
            // mutable cap setting.
            item.groups_observed = state.groups_observed.and_then(|n| i32::try_from(n).ok());
            item.groups_firing = state.groups_firing.and_then(|n| i32::try_from(n).ok());
            item.groups_observed_is_lower_bound = state.groups_observed_is_lower_bound;
            item.groups_firing_is_lower_bound = state.groups_firing_is_lower_bound;
        }
    }
}

/// EnableAlert
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/{alert_id}/enable",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "EnableAlert",
    summary = "Enable or disable alert",
    description = "Toggles the active status of an alert to enable or disable its monitoring and notification functionality. When disabled, the alert will stop evaluating conditions and sending notifications until re-enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        EnableAlertQuery,
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Enable or disable an alert", "category": "alerts"}))
    )
)]
pub async fn enable_alert(
    Path((org_id, alert_id)): Path<(String, String)>,
    Query(query): Query<EnableAlertQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let should_enable = query.value;
    let client = get_orm_client_rw().await;
    match alert::enable_by_id(client, &org_id, alert_id, should_enable).await {
        Ok(_) => {
            let resp_body = EnableAlertResponseBody {
                enabled: should_enable,
            };
            MetaHttpResponse::json(resp_body)
        }
        Err(AlertError::AlertNotFound) => {
            if let Some(_composite) =
                openobserve_core::alerts::composite::get_composite(&org_id, &alert_id.to_string())
                    .await
                    .ok()
                    .flatten()
            {
                #[cfg(feature = "enterprise")]
                if composite_subject_unauthorized(
                    &_composite.definition,
                    &user_email.user_id,
                    "PUT",
                )
                .await
                {
                    return MetaHttpResponse::forbidden("Unauthorized Access");
                }
                return match openobserve_core::alerts::composite::set_composite_enabled(
                    &org_id,
                    &alert_id.to_string(),
                    should_enable,
                )
                .await
                {
                    Ok(()) => MetaHttpResponse::json(EnableAlertResponseBody {
                        enabled: should_enable,
                    }),
                    Err(error) => composite_error_response(error),
                };
            }
            #[cfg(not(feature = "enterprise"))]
            {
                MetaHttpResponse::not_found(format!("alert {alert_id} not found"))
            }
            #[cfg(feature = "enterprise")]
            {
                // Fall back to anomaly detection config
                use openobserve_core::anomaly_detection::UpdateAnomalyConfigRequest;
                let req = UpdateAnomalyConfigRequest {
                    enabled: Some(should_enable),
                    ..Default::default()
                };
                match openobserve_core::anomaly_detection::update_config(
                    &org_id,
                    &alert_id.to_string(),
                    req,
                )
                .await
                {
                    Ok(_) => MetaHttpResponse::json(EnableAlertResponseBody {
                        enabled: should_enable,
                    }),
                    Err(e) => {
                        let msg = e.to_string().to_lowercase();
                        if msg.contains("not found") {
                            MetaHttpResponse::not_found(e.to_string())
                        } else {
                            MetaHttpResponse::internal_error(e.to_string())
                        }
                    }
                }
            }
        }
        Err(e) => e.into(),
    }
}

/// EnableAlertBulk
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/bulk/enable",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "EnableAlertBulk",
    summary = "Enable or disable alert in bulk",
    description = "Toggles the active status of alerts to enable or disable its monitoring and notification functionality in bulk. When disabled, the alert will stop evaluating conditions and sending notifications until re-enabled.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        EnableAlertQuery,
    ),
    request_body(content = inline(AlertBulkEnableRequest), description = "Alert id list", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn enable_alert_bulk(
    Path(org_id): Path<String>,
    Query(query): Query<EnableAlertQuery>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(req): Json<AlertBulkEnableRequest>,
) -> Response {
    let should_enable = query.value;
    let _folder_id = query.folder;

    #[cfg(feature = "enterprise")]
    {
        let user_id = &user_email.user_id;

        for id in &req.ids {
            if !check_permissions(
                &id.to_string(),
                &org_id,
                user_id,
                "alerts",
                "PUT",
                _folder_id.as_deref(),
                false,
                true,
                false,
            )
            .await
            {
                return MetaHttpResponse::forbidden("Unauthorized Access");
            }
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    let client = get_orm_client_rw().await;
    for id in req.ids {
        match alert::enable_by_id(client, &org_id, id, should_enable).await {
            Ok(_) => {
                successful.push(id);
            }
            Err(AlertError::AlertNotFound) => {
                if let Some(_composite) =
                    openobserve_core::alerts::composite::get_composite(&org_id, &id.to_string())
                        .await
                        .ok()
                        .flatten()
                {
                    #[cfg(feature = "enterprise")]
                    if composite_subject_unauthorized(
                        &_composite.definition,
                        &user_email.user_id,
                        "PUT",
                    )
                    .await
                    {
                        return MetaHttpResponse::forbidden("Unauthorized Access");
                    }
                    match openobserve_core::alerts::composite::set_composite_enabled(
                        &org_id,
                        &id.to_string(),
                        should_enable,
                    )
                    .await
                    {
                        Ok(()) => successful.push(id),
                        Err(error) => {
                            unsuccessful.push(id);
                            err = Some(error.to_string());
                        }
                    }
                    continue;
                }
                #[cfg(not(feature = "enterprise"))]
                {
                    unsuccessful.push(id);
                    err = Some(format!("alert {id} not found"));
                }
                #[cfg(feature = "enterprise")]
                {
                    // Fall back to anomaly detection config
                    use openobserve_core::anomaly_detection::UpdateAnomalyConfigRequest;
                    let req = UpdateAnomalyConfigRequest {
                        enabled: Some(should_enable),
                        ..Default::default()
                    };
                    match openobserve_core::anomaly_detection::update_config(
                        &org_id,
                        &id.to_string(),
                        req,
                    )
                    .await
                    {
                        Ok(_) => successful.push(id),
                        Err(e) => {
                            log::error!("error in enabling anomaly config {id} : {e}");
                            unsuccessful.push(id);
                            err = Some(e.to_string());
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("error in enabling alert {id} : {e}");
                unsuccessful.push(id);
                err = Some(e.to_string());
            }
        }
    }
    MetaHttpResponse::json(AlertBulkEnableResponse {
        successful,
        unsuccessful,
        err,
    })
}

/// TriggerAlert
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/{alert_id}/trigger",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "TriggerAlert",
    summary = "Manually trigger alert",
    description = "Manually triggers an alert to test its functionality and notification delivery. Useful for testing alert configurations, verifying notification channels, and ensuring alerts work as expected before relying on them for monitoring.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Alert ID"),
        ("folder" = Option<String>, Query, description = "Folder ID (Required if RBAC enabled)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Manually trigger an alert", "category": "alerts"}))
    )
)]
pub async fn trigger_alert(
    Path((org_id, alert_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = get_orm_client_ro().await;
    match alert::trigger_by_id(client, &org_id, alert_id).await {
        Ok(_) => MetaHttpResponse::ok("Alert triggered"),
        Err(AlertError::AlertNotFound) => {
            if let Some(_composite) =
                openobserve_core::alerts::composite::get_composite(&org_id, &alert_id.to_string())
                    .await
                    .ok()
                    .flatten()
            {
                #[cfg(feature = "enterprise")]
                if composite_subject_unauthorized(
                    &_composite.definition,
                    &user_email.user_id,
                    "PUT",
                )
                .await
                {
                    return MetaHttpResponse::forbidden("Unauthorized Access");
                }
                return match openobserve_core::alerts::composite::trigger_composite(
                    &org_id,
                    &alert_id.to_string(),
                )
                .await
                {
                    Ok(()) => MetaHttpResponse::ok("Alert triggered"),
                    Err(error) => composite_error_response(error),
                };
            }
            #[cfg(not(feature = "enterprise"))]
            {
                MetaHttpResponse::not_found(format!("alert {alert_id} not found"))
            }
            #[cfg(feature = "enterprise")]
            {
                // Fall back to anomaly detection — trigger a detection run
                match openobserve_core::anomaly_detection::detect_anomalies(
                    &org_id,
                    &alert_id.to_string(),
                )
                .await
                {
                    Ok(_) => MetaHttpResponse::ok("Detection triggered"),
                    Err(e) => {
                        let msg = e.to_string().to_lowercase();
                        if msg.contains("not found") {
                            MetaHttpResponse::not_found(e.to_string())
                        } else {
                            MetaHttpResponse::internal_error(e.to_string())
                        }
                    }
                }
            }
        }
        Err(e) => e.into(),
    }
}

/// RetrainAlert
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/{alert_id}/retrain",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "RetrainAlert",
    summary = "Trigger retraining for an anomaly detection alert",
    description = "Triggers a model retrain for an anomaly detection alert. Returns 400 if called on a non-anomaly alert type.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("alert_id" = String, Path, description = "Anomaly detection alert ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Not an anomaly detection alert", content_type = "application/json", body = ()),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
    )
)]
pub async fn retrain_alert(Path((org_id, alert_id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    let alert_id_str = alert_id.clone();
    let alert_id = match Ksuid::from_str(&alert_id) {
        Ok(id) => id,
        Err(_) => {
            return MetaHttpResponse::not_found(format!("invalid alert id {alert_id}"));
        }
    };
    let client = get_orm_client_ro().await;
    // Check if this is a regular alert — if so, return 400
    match alert::get_by_id(client, &org_id, alert_id).await {
        Ok(_) => {
            return MetaHttpResponse::bad_request(
                "retrain is only supported for anomaly detection alerts",
            );
        }
        Err(AlertError::AlertNotFound) => {
            // Expected — fall through to anomaly detection
        }
        Err(e) => return e.into(),
    }
    #[cfg(not(feature = "enterprise"))]
    {
        MetaHttpResponse::bad_request("retrain is only supported for anomaly detection alerts")
    }
    #[cfg(feature = "enterprise")]
    match openobserve_core::anomaly_detection::train_model(&org_id, &alert_id_str).await {
        Ok(_) => MetaHttpResponse::ok("Retraining triggered"),
        Err(e) => {
            let msg = e.to_string().to_lowercase();
            if msg.contains("not found") {
                MetaHttpResponse::not_found(e.to_string())
            } else {
                MetaHttpResponse::internal_error(e.to_string())
            }
        }
    }
}

/// MoveAlerts
#[utoipa::path(
    patch,
    path = "/v2/{org_id}/alerts/move",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "MoveAlerts",
    summary = "Move alerts between folders",
    description = "Moves one or more alerts from their current folder to a specified destination folder. Helps organize alerts into logical groups and manage access permissions when using role-based access control.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("folder" = Option<String>, Query, description = "From Folder ID (Required if RBAC enabled)"),
    ),
    request_body(content = inline(MoveAlertsRequestBody), description = "Identifies alerts and the destination folder", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure",  content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Move alerts to another folder", "category": "alerts"}))
    )
)]
pub async fn move_alerts(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req_body): Json<MoveAlertsRequestBody>,
) -> Response {
    let client = get_orm_client_rw().await;
    let total_ids = req_body.alert_ids.len() + req_body.anomaly_config_ids.len();

    // anomaly_config_ids is now a required Vec (defaults to empty), so no
    // per-ID DB lookups are needed to classify those. Composite IDs are
    // resolved once into a set so the bulk move doesn't pay a per-ID
    // `get_composite` lookup.
    let composite_id_set: std::collections::HashSet<String> =
        infra::table::alert_composites::list_by_org(client, &org_id)
            .await
            .map(|definitions| {
                definitions
                    .into_iter()
                    .map(|definition| definition.id)
                    .collect()
            })
            .unwrap_or_default();
    let mut alert_ids: Vec<Ksuid> = Vec::new();
    let mut composite_ids = Vec::new();
    for id in req_body.alert_ids {
        if composite_id_set.contains(&id.to_string()) {
            composite_ids.push(id);
        } else {
            alert_ids.push(id);
        }
    }
    #[cfg(feature = "enterprise")]
    let anomaly_ids: Vec<Ksuid> = req_body.anomaly_config_ids;

    // Move anomaly configs first (enterprise only) so that if this fails,
    // regular alerts have not yet been relocated (reduces partial-move risk).
    #[cfg(feature = "enterprise")]
    for id in anomaly_ids {
        use openobserve_core::anomaly_detection::UpdateAnomalyConfigRequest;
        let req = UpdateAnomalyConfigRequest {
            folder_id: Some(req_body.dst_folder_id.clone()),
            ..Default::default()
        };
        if let Err(e) =
            openobserve_core::anomaly_detection::update_config(&org_id, &id.to_string(), req).await
        {
            let msg = e.to_string().to_lowercase();
            if msg.contains("not found") {
                return MetaHttpResponse::not_found(e.to_string());
            } else {
                return MetaHttpResponse::internal_error(e.to_string());
            }
        }
    }

    // Move regular alerts in one batch
    if !alert_ids.is_empty()
        && let Err(e) = alert::move_to_folder(
            client,
            &org_id,
            &alert_ids,
            &req_body.dst_folder_id,
            &user_email.user_id,
        )
        .await
    {
        return e.into();
    }
    for id in composite_ids {
        if let Err(error) = openobserve_core::alerts::composite::move_composite(
            &org_id,
            &id.to_string(),
            &req_body.dst_folder_id,
            &user_email.user_id,
        )
        .await
        {
            return composite_error_response(error);
        }
    }

    let message = if total_ids == 1 {
        "Alert moved"
    } else {
        "Alerts moved"
    };
    MetaHttpResponse::ok(message)
}

/// GenerateSql
#[utoipa::path(
    post,
    path = "/v2/{org_id}/alerts/generate_sql",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GenerateSql",
    summary = "Generate SQL from alert query parameters",
    description = "Generates a SQL query string based on alert query parameters including stream, aggregations, and conditions. This endpoint is useful for testing alert queries and understanding the SQL that will be executed.",
    security(("Authorization"= [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(
        content = inline(GenerateSqlRequestBody),
        description = "SQL generation parameters",
        content_type = "application/json"
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(GenerateSqlResponseBody)),
        (status = 400, description = "Bad request - invalid parameters", content_type = "application/json", body = Object),
        (status = 500, description = "Internal server error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "generate_sql"})),
        ("x-o2-mcp" = json!({"description": "Generate SQL from natural language", "category": "alerts"}))
    )
)]
pub async fn generate_sql(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    #[cfg(not(feature = "enterprise"))] Headers(_user_email): Headers<UserEmail>,
    Json(req_body): Json<GenerateSqlRequestBody>,
) -> Response {
    // Convert HTTP models to internal types
    let stream_type: config::meta::stream::StreamType = req_body.stream_type.into();
    let query_condition: config::meta::alerts::QueryCondition = req_body.query_condition.into();

    #[cfg(feature = "enterprise")]
    {
        // Check stream permissions for enterprise builds
        if let Some(response) = check_stream_permissions(
            &req_body.stream_name,
            &org_id,
            &user_email.user_id,
            &stream_type,
            StreamPermissionResourceType::Search,
        )
        .await
        {
            return response;
        }
    }

    // Validate that the stream exists
    match infra::schema::get(&org_id, &req_body.stream_name, stream_type).await {
        Err(e) => {
            log::warn!(
                "Stream validation failed for org {} stream {} ({}): {}",
                org_id,
                req_body.stream_name,
                stream_type,
                e
            );
            return MetaHttpResponse::bad_request(format!(
                "Stream '{}' of type '{}' does not exist",
                req_body.stream_name, stream_type
            ));
        }
        Ok(schema) if schema.fields().is_empty() => {
            log::warn!(
                "Stream '{}' of type '{}' in org {} has no schema (does not exist)",
                req_body.stream_name,
                stream_type,
                org_id
            );
            return MetaHttpResponse::bad_request(format!(
                "Stream '{}' of type '{}' does not exist",
                req_body.stream_name, stream_type
            ));
        }
        Ok(_) => {
            // Stream exists and has a schema, continue
        }
    }

    // Extract conditions from query_condition or use default empty conditions
    let conditions = query_condition.conditions.clone().unwrap_or(
        config::meta::alerts::AlertConditionParams::V1(
            config::meta::alerts::ConditionList::LegacyConditions(vec![]),
        ),
    );

    // Call the existing build_sql function from service layer
    match build_sql(
        &org_id,
        &req_body.stream_name,
        stream_type,
        &query_condition,
        &conditions,
    )
    .await
    {
        Ok(sql) => {
            // Calculate metadata
            let has_agg = query_condition.aggregation.is_some();
            let has_conds = conditions.len().await > 0;
            let has_group = has_agg
                && query_condition
                    .aggregation
                    .as_ref()
                    .map(|a| a.group_by.is_some() && !a.group_by.as_ref().unwrap().is_empty())
                    .unwrap_or(false);

            let response = GenerateSqlResponseBody {
                sql,
                metadata: Some(GenerateSqlMetadata {
                    has_aggregation: has_agg,
                    has_conditions: has_conds,
                    has_group_by: has_group,
                }),
            };
            MetaHttpResponse::json(response)
        }
        Err(e) => {
            let error_msg = e.to_string();
            log::warn!(
                "Failed to generate SQL for org {} stream {}: {}",
                org_id,
                req_body.stream_name,
                error_msg
            );
            MetaHttpResponse::bad_request(format!("Failed to generate SQL: {}", error_msg))
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::{http::StatusCode, response::Response};
    use openobserve_core::alerts::alert::AlertError;

    fn status(err: AlertError) -> StatusCode {
        Response::from(err).status()
    }

    // 400 Bad Request
    #[test]
    fn test_alert_name_missing_is_bad_request() {
        assert_eq!(
            status(AlertError::AlertNameMissing),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_alert_name_contains_forward_slash_is_bad_request() {
        assert_eq!(
            status(AlertError::AlertNameContainsForwardSlash),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_alert_name_ofga_unsupported_is_bad_request() {
        assert_eq!(
            status(AlertError::AlertNameOfgaUnsupported),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_alert_destination_missing_is_bad_request() {
        assert_eq!(
            status(AlertError::AlertDestinationMissing),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_alert_id_missing_is_bad_request() {
        assert_eq!(status(AlertError::AlertIdMissing), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_sql_missing_query_is_bad_request() {
        assert_eq!(status(AlertError::SqlMissingQuery), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_sql_contains_select_star_is_bad_request() {
        assert_eq!(
            status(AlertError::SqlContainsSelectStar),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_promql_missing_query_is_bad_request() {
        assert_eq!(
            status(AlertError::PromqlMissingQuery),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_realtime_missing_custom_query_is_bad_request() {
        assert_eq!(
            status(AlertError::RealtimeMissingCustomQuery),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_template_not_configured_is_bad_request() {
        assert_eq!(
            status(AlertError::TemplateNotConfigured {
                dest: "slack".to_string()
            }),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_period_exceeds_max_query_range_is_bad_request() {
        assert_eq!(
            status(AlertError::PeriodExceedsMaxQueryRange {
                max_query_range_hours: 24,
                stream_name: "logs".to_string(),
            }),
            StatusCode::BAD_REQUEST
        );
    }

    // 404 Not Found
    #[test]
    fn test_alert_not_found_is_not_found() {
        assert_eq!(status(AlertError::AlertNotFound), StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_create_folder_not_found_is_not_found() {
        assert_eq!(
            status(AlertError::CreateFolderNotFound),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_move_destination_folder_not_found_is_not_found() {
        assert_eq!(
            status(AlertError::MoveDestinationFolderNotFound),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_alert_destination_not_found_is_not_found() {
        assert_eq!(
            status(AlertError::AlertDestinationNotFound {
                dest: "pagerduty".to_string()
            }),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_stream_not_found_is_not_found() {
        assert_eq!(
            status(AlertError::StreamNotFound {
                stream_name: "events".to_string()
            }),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn test_alert_template_not_found_is_not_found() {
        assert_eq!(
            status(AlertError::AlertTemplateNotFound {
                template: "default".to_string()
            }),
            StatusCode::NOT_FOUND
        );
    }

    // 409 Conflict
    #[test]
    fn test_create_already_exists_is_conflict() {
        assert_eq!(
            status(AlertError::CreateAlreadyExists),
            StatusCode::CONFLICT
        );
    }

    // 403 Forbidden
    #[test]
    fn test_permitted_alerts_missing_user_is_forbidden() {
        assert_eq!(
            status(AlertError::PermittedAlertsMissingUser),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn test_permission_denied_is_forbidden() {
        assert_eq!(status(AlertError::PermissionDenied), StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_user_not_found_is_forbidden() {
        assert_eq!(status(AlertError::UserNotFound), StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_permitted_alerts_validator_is_forbidden() {
        assert_eq!(
            status(AlertError::PermittedAlertsValidator("err".to_string())),
            StatusCode::FORBIDDEN
        );
    }

    // 500 Internal Server Error
    #[test]
    fn test_create_default_folder_error_is_internal_error() {
        assert_eq!(
            status(AlertError::CreateDefaultFolderError),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_send_notification_error_is_internal_error() {
        assert_eq!(
            status(AlertError::SendNotificationError {
                error_message: "timeout".to_string()
            }),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_resolve_stream_name_error_is_internal_error() {
        assert_eq!(
            status(AlertError::ResolveStreamNameError(anyhow::anyhow!("err"))),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_infra_error_is_internal_server_error() {
        let err = infra::errors::Error::DbError(infra::errors::DbError::SeaORMError(
            "db unavailable".to_string(),
        ));
        assert_eq!(
            status(AlertError::InfraError(err)),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn test_decode_vrl_is_bad_request() {
        let io_err = std::io::Error::new(std::io::ErrorKind::InvalidData, "bad vrl");
        assert_eq!(
            status(AlertError::DecodeVrl(io_err)),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_parse_cron_is_bad_request() {
        use std::str::FromStr as _;
        let cron_err = cron::Schedule::from_str("not-a-cron").unwrap_err();
        assert_eq!(
            status(AlertError::ParseCron(cron_err)),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn test_get_destination_with_template_error_is_internal_server_error() {
        use db::alerts::destinations::DestinationError;
        assert_eq!(
            status(AlertError::GetDestinationWithTemplateError(
                DestinationError::NotFound
            )),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
