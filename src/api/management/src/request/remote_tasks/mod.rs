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

use axum::{extract::Path, response::Response};
use db::authz::{remove_ownership, set_ownership};
#[cfg(feature = "enterprise")]
use openobserve_api_common::extractors::Headers;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::{UserEmail, is_ofga_object_visible};
use openobserve_core::llm_evaluations::remote_tasks::{PublishOutcome, RenderContext};

use crate::{
    common::meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    models::remote_tasks::{
        ListRemoteTasksResponseBody, PublishRemoteTaskResponseBody, RemoteTaskRequestBody,
        RemoteTaskResponseBody, TestConnectionRequestBody,
    },
    service::llm_evaluations::remote_tasks::{self, RemoteTaskError},
};

fn remote_task_error_response(value: RemoteTaskError) -> Response {
    match value {
        RemoteTaskError::Database(err) => {
            log::error!("[RemoteTask] internal error: {err}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        RemoteTaskError::Malformed(err) => {
            log::error!("[RemoteTask] malformed stored row: {err}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        RemoteTaskError::NotFound => MetaHttpResponse::not_found("Remote task not found"),
        RemoteTaskError::NoDraft => MetaHttpResponse::not_found(value),
        RemoteTaskError::DuplicateName => MetaHttpResponse::conflict(value),
        RemoteTaskError::NotReferenceable(_) => MetaHttpResponse::conflict(value),
        RemoteTaskError::MissingName
        | RemoteTaskError::UnpinnedReference(_)
        | RemoteTaskError::Invalid(_) => MetaHttpResponse::bad_request(value),
    }
}

/// The sample a test connection sends when the operator entered none.
fn sample_context(body: TestConnectionRequestBody) -> RenderContext {
    RenderContext {
        input: body
            .input
            .unwrap_or_else(|| serde_json::json!("sample input")),
        metadata: body.metadata.unwrap_or_else(|| serde_json::json!({})),
        context: serde_json::json!({
            "experiment_id": "test-connection",
            "experiment_name": "Test connection",
            "dataset": serde_json::Value::Null,
            "snapshot_version": serde_json::Value::Null,
            "row_id": "test-connection",
            "trial_index": 0,
        }),
    }
}

/// ListRemoteTasks
#[utoipa::path(
    get,
    path = "/{org_id}/remote_tasks",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "ListRemoteTasks",
    summary = "List remote tasks",
    description = "Lists each remote task head at its newest row.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, body = inline(ListRemoteTasksResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "list"})),
    ),
)]
pub async fn list_remote_tasks(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    let permitted_objects = {
        match openobserve_api_common::auth::validator::list_objects_for_user(
            &org_id,
            &user_email.user_id,
            "GET",
            "remote_task",
        )
        .await
        {
            Ok(list) => list,
            Err(e) => return MetaHttpResponse::forbidden(e.to_string()),
        }
    };
    match remote_tasks::list(&org_id).await {
        Ok(list) => {
            #[cfg(feature = "enterprise")]
            let list = list
                .into_iter()
                .filter(|task| {
                    is_ofga_object_visible(
                        &org_id,
                        "remote_task",
                        &task.entity_id,
                        permitted_objects.as_deref(),
                    )
                })
                .collect::<Vec<_>>();
            let body: ListRemoteTasksResponseBody = list.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => remote_task_error_response(err),
    }
}

/// CreateRemoteTask
#[utoipa::path(
    post,
    path = "/{org_id}/remote_tasks",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "CreateRemoteTask",
    summary = "Register a remote task",
    description = "Registers a remote task as an unverified draft. No Experiment can \
                   reference it until a test connection publishes a version.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(RemoteTaskRequestBody), description = "Remote task payload"),
    responses(
        (status = 200, body = inline(RemoteTaskResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "create"})),
    ),
)]
pub async fn create_remote_task(
    Path(org_id): Path<String>,
    axum::Json(body): axum::Json<RemoteTaskRequestBody>,
) -> Response {
    let description = body.description.clone();
    match remote_tasks::create(&org_id, body.into_spec(), description).await {
        Ok(task) => {
            set_ownership(&org_id, "remote_tasks", Authz::new(&task.entity_id)).await;
            let body: RemoteTaskResponseBody = task.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => remote_task_error_response(err),
    }
}

/// GetRemoteTask
#[utoipa::path(
    get,
    path = "/{org_id}/remote_tasks/{entity_id}",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "GetRemoteTask",
    summary = "Get a remote task",
    description = "Returns the head's newest published version, or its draft when it \
                   has never published one.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, body = inline(RemoteTaskResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "get"})),
    ),
)]
pub async fn get_remote_task(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match remote_tasks::get(&org_id, &entity_id).await {
        Ok(task) => {
            let body: RemoteTaskResponseBody = task.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => remote_task_error_response(err),
    }
}

/// ListRemoteTaskVersions
#[utoipa::path(
    get,
    path = "/{org_id}/remote_tasks/{entity_id}/versions",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "ListRemoteTaskVersions",
    summary = "List remote task versions",
    description = "Returns every version of the head, newest first, including its draft.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, body = inline(ListRemoteTasksResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "list"})),
    ),
)]
pub async fn list_remote_task_versions(
    Path((org_id, entity_id)): Path<(String, String)>,
) -> Response {
    match remote_tasks::get_versions(&org_id, &entity_id).await {
        Ok(versions) => {
            let body: ListRemoteTasksResponseBody = versions.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => remote_task_error_response(err),
    }
}

/// SaveRemoteTaskDraft
#[utoipa::path(
    put,
    path = "/{org_id}/remote_tasks/{entity_id}",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "SaveRemoteTaskDraft",
    summary = "Save the remote task draft",
    description = "Writes the head's single draft, copying the selected published version \
                   first when no draft exists. Published versions are untouched.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    request_body(content = inline(RemoteTaskRequestBody), description = "Remote task payload"),
    responses(
        (status = 200, body = inline(RemoteTaskResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "update"})),
    ),
)]
pub async fn save_remote_task_draft(
    Path((org_id, entity_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<RemoteTaskRequestBody>,
) -> Response {
    let description = body.description.clone();
    let from_version = body.from_version;
    match remote_tasks::save_draft(
        &org_id,
        &entity_id,
        from_version,
        body.into_spec(),
        description,
    )
    .await
    {
        Ok(task) => {
            let body: RemoteTaskResponseBody = task.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => remote_task_error_response(err),
    }
}

/// GetRemoteTaskDraft
#[utoipa::path(
    get,
    path = "/{org_id}/remote_tasks/{entity_id}/draft",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "GetRemoteTaskDraft",
    summary = "Get the remote task draft",
    description = "Returns the head's unpublished draft, if it has one.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, body = inline(RemoteTaskResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "get"})),
    ),
)]
pub async fn get_remote_task_draft(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match remote_tasks::get_draft(&org_id, &entity_id).await {
        Ok(Some(task)) => {
            let body: RemoteTaskResponseBody = task.into();
            MetaHttpResponse::json(body)
        }
        Ok(None) => MetaHttpResponse::not_found("Remote task has no draft"),
        Err(err) => remote_task_error_response(err),
    }
}

/// DiscardRemoteTaskDraft
#[utoipa::path(
    delete,
    path = "/{org_id}/remote_tasks/{entity_id}/draft",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "DiscardRemoteTaskDraft",
    summary = "Discard the remote task draft",
    description = "Drops the head's unpublished draft. Published versions are untouched.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, description = "Success", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "delete"})),
    ),
)]
pub async fn discard_remote_task_draft(
    Path((org_id, entity_id)): Path<(String, String)>,
) -> Response {
    match remote_tasks::discard_draft(&org_id, &entity_id).await {
        Ok(()) => MetaHttpResponse::ok("Draft discarded"),
        Err(err) => remote_task_error_response(err),
    }
}

/// PublishRemoteTask
#[utoipa::path(
    post,
    path = "/{org_id}/remote_tasks/{entity_id}/test_connection",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "PublishRemoteTask",
    summary = "Test connection and publish",
    description = "Calls the endpoint using the draft's own contract. A failure records \
                   why and publishes nothing; a success publishes the next immutable \
                   version, which becomes referenceable. This is the only way a version \
                   is published.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    request_body(
        content = inline(TestConnectionRequestBody),
        description = "Sample sent to the configured endpoint",
    ),
    responses(
        (status = 200, body = inline(PublishRemoteTaskResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "update"})),
    ),
)]
pub async fn publish_remote_task(
    Path((org_id, entity_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<TestConnectionRequestBody>,
) -> Response {
    let sample = sample_context(body);
    match remote_tasks::publish(&org_id, &entity_id, &sample).await {
        Ok(PublishOutcome::Published { task, plan, report }) => {
            MetaHttpResponse::json(PublishRemoteTaskResponseBody {
                published: true,
                version_bumped: plan.bumps_version(),
                error: None,
                task: task.into(),
                report: report.into(),
            })
        }
        Ok(PublishOutcome::TestFailed {
            draft,
            error,
            report,
        }) => MetaHttpResponse::json(PublishRemoteTaskResponseBody {
            published: false,
            version_bumped: false,
            error: Some(error),
            task: draft.into(),
            report: report.into(),
        }),
        Err(err) => remote_task_error_response(err),
    }
}

/// DeleteRemoteTask
#[utoipa::path(
    delete,
    path = "/{org_id}/remote_tasks/{entity_id}",
    context_path = "/api",
    tag = "RemoteTasks",
    operation_id = "DeleteRemoteTask",
    summary = "Delete a remote task",
    description = "Retires the head. Its published versions stay for history but stop \
                   being referenceable.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Remote task head id"),
    ),
    responses(
        (status = 200, description = "Success", body = ()),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "RemoteTasks", "operation": "delete"})),
    ),
)]
pub async fn delete_remote_task(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match remote_tasks::delete(&org_id, &entity_id).await {
        Ok(()) => {
            remove_ownership(&org_id, "remote_tasks", Authz::new(&entity_id)).await;
            MetaHttpResponse::ok("Remote task deleted")
        }
        Err(err) => remote_task_error_response(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_test_connection_without_a_sample_still_sends_a_usable_one() {
        let ctx = sample_context(TestConnectionRequestBody::default());
        assert_eq!(ctx.input, serde_json::json!("sample input"));
        assert_eq!(ctx.metadata, serde_json::json!({}));
    }

    #[test]
    fn a_hand_entered_sample_is_what_gets_sent() {
        let ctx = sample_context(TestConnectionRequestBody {
            input: Some(serde_json::json!({"q": "2 + 2"})),
            metadata: Some(serde_json::json!({"lang": "en"})),
        });
        assert_eq!(ctx.input, serde_json::json!({"q": "2 + 2"}));
        assert_eq!(ctx.metadata["lang"], serde_json::json!("en"));
    }

    #[test]
    fn the_test_connection_context_carries_no_reference_answer() {
        let ctx = sample_context(TestConnectionRequestBody::default());
        let rendered = serde_json::to_string(&ctx.context).unwrap();
        assert!(!rendered.contains("expected"));
    }
}
