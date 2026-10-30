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
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::{UserEmail, is_ofga_object_visible},
    llm_evaluations::annotations::{self, AnnotationError},
    self_reporting::llm_scores_writer,
};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::annotations::{AnnotateRequestBody, AnnotateResponseBody},
};

fn annotation_error_response(value: AnnotationError) -> Response {
    match value {
        AnnotationError::Database(err) => {
            log::error!("[Annotation] internal error: {err}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        error => MetaHttpResponse::bad_request(error),
    }
}

/// AnnotateTarget
#[utoipa::path(
    post,
    path = "/{org_id}/annotations",
    context_path = "/api",
    tag = "Annotations",
    operation_id = "AnnotateTarget",
    summary = "Annotate a span, trace, or session",
    description = "Validates values against immutable Score Config versions and writes one annotation-source event per Score to the _llm_scores stream.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(AnnotateRequestBody), description = "Target and typed Score values"),
    responses(
        (status = 200, body = inline(AnnotateResponseBody)),
        (status = 400, description = "Invalid target, Score Config, or Score value", body = ()),
        (status = 403, description = "A selected Score Config is not visible", body = ()),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "Annotations", "operation": "create"}))),
)]
pub async fn annotate_target(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<AnnotateRequestBody>,
) -> Response {
    let prepared = match annotations::prepare(&org_id, &user.user_id, body.into()).await {
        Ok(prepared) => prepared,
        Err(err) => return annotation_error_response(err),
    };

    let permitted_objects = match openobserve_api_common::auth::validator::list_objects_for_user(
        &org_id,
        &user.user_id,
        "GET",
        "score_config",
    )
    .await
    {
        Ok(list) => list,
        Err(err) => return MetaHttpResponse::forbidden(err.to_string()),
    };
    if prepared.records.iter().any(|record| {
        record.score_config_id.as_deref().is_none_or(|config_id| {
            !is_ofga_object_visible(
                &org_id,
                "score_config",
                config_id,
                permitted_objects.as_deref(),
            )
        })
    }) {
        return MetaHttpResponse::forbidden(
            "One or more selected Score Configs are not accessible",
        );
    }

    let response = AnnotateResponseBody::from(&prepared);
    if let Err(err) = llm_scores_writer::publish(&org_id, &prepared.records).await {
        log::error!("[Annotation] failed to publish Scores for {org_id}: {err}");
        return MetaHttpResponse::internal_error("Failed to publish annotation Scores");
    }

    MetaHttpResponse::json(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_errors_are_bad_requests() {
        let response = annotation_error_response(AnnotationError::MissingTargetId);
        assert_eq!(response.status().as_u16(), 400);
    }
}
