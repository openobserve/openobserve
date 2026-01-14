// Copyright (c) 2025. OpenObserve Inc.
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

use axum::{extract::Path, response::Response};
#[cfg(feature = "enterprise")]
use {
    crate::{
        common::utils::{
            auth::{UserEmail, check_permissions},
            http::get_or_create_trace_id,
        },
        handler::http::{extractors::Headers, models::action::TestActionRequest},
    },
    axum::Json,
    itertools::Itertools,
    o2_enterprise::enterprise::actions::{action_manager::trigger_action, meta::TriggerSource},
    tracing::{Level, span},
};

#[cfg(feature = "enterprise")]
/// Test Action
#[utoipa::path(
    post,
    path = "/{org_id}/actions/test/{action_id}",
    context_path = "/api",
    tag = "Actions",
    operation_id = "InvokeAction",
    summary = "Test action execution with sample data",
    description = "Executes an action with test data to validate its configuration and behavior",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("action_id" = String, Path, description = "Action ID"),
    ),
    request_body(content = inline(config::meta::destinations::Template), description = "Template data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    )
)]
pub async fn test_action(
    Path((org_id, action_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<TestActionRequest>,
) -> Response {
    let mut req = req;
    let inputs = req.inputs.drain(..).collect_vec();

    if !check_permissions(
        &action_id,
        &org_id,
        &user_email.user_id,
        "actions",
        "POST",
        None,
    )
    .await
    {
        return crate::common::meta::http::HttpResponse::forbidden("Unauthorized Access");
    }

    let trace_id = get_or_create_trace_id(
        &axum::http::HeaderMap::new(),
        &span!(Level::TRACE, "action_test"),
    );
    match trigger_action(
        &trace_id,
        &org_id,
        &action_id,
        inputs,
        TriggerSource::Manual,
    )
    .await
    {
        Ok(action) => crate::common::meta::http::HttpResponse::json(action),
        Err(e) => crate::common::meta::http::HttpResponse::bad_request(e),
    }
}

/// Pause Action
#[utoipa::path(
    get,
    path = "/{org_id}/actions/pause/{action_id}",
    context_path = "/api",
    tag = "Actions",
    operation_id = "PauseAction",
    summary = "Pause action execution",
    description = "Temporarily pauses the execution of an automated action",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("action_id" = String, Path, description = "Action ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    )
)]
pub async fn pause_action(_path: Path<(String, String)>) -> Response {
    unimplemented!()
}

/// Resume Action
#[utoipa::path(
    get,
    path = "/{org_id}/actions/resume/{action_id}",
    context_path = "/api",
    tag = "Actions",
    operation_id = "ResumeAction",
    summary = "Resume action execution",
    description = "Resumes a previously paused action to continue its execution",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("action_id" = String, Path, description = "Action ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Error",   content_type = "application/json", body = ()),
    )
)]
pub async fn resume_action(_path: Path<(String, String)>) -> Response {
    unimplemented!()
}
