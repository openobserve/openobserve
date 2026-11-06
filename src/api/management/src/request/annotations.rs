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

use std::{sync::LazyLock, time::Duration};

use axum::{
    Extension,
    body::Bytes,
    extract::{Path, Query},
    response::Response,
};
use chrono::Utc;
use config::{
    axum::middlewares::RealIp,
    meta::{self_reporting::llm_scores::LlmScoreTargetScope, stream::StreamType},
};
use db::authz::set_ownership;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::{UserEmail, is_ofga_object_visible},
    llm_evaluations::{
        annotations::{self, AnnotationError},
        feedback::{self, FeedbackClaims},
        score_configs::EnsureOutcome,
    },
    self_reporting::llm_scores_writer,
};

use crate::{
    common::meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    models::annotations::{
        AnnotateRequestBody, AnnotateResponseBody, FeedbackTokenRequestBody,
        FeedbackTokenResponseBody, FeedbackVoteQuery, FeedbackVoteRequestBody,
        FeedbackVoteResponseBody,
    },
    request::public_rate_limit::{Counters, client_ip, too_many_requests},
};

/// A vote is a few short fields; the comment cap is enforced after parsing.
pub const FEEDBACK_MAX_BODY_BYTES: usize = 8 * 1024;
const VOTE_WINDOW: Duration = Duration::from_secs(60);
/// Per client IP. One person does not vote once a second; a script replaying
/// a token stops here before it reaches the write path.
const VOTES_PER_WINDOW: u32 = 60;
static VOTES: LazyLock<Counters> = LazyLock::new(Counters::default);

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
    extensions(("x-o2-mcp" = json!({"enabled": false})), ("x-o2-ratelimit" = json!({"module": "Annotations", "operation": "create"}))),
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

    match score_configs_visible(
        &org_id,
        &user.user_id,
        prepared
            .records
            .iter()
            .map(|record| record.score_config_id.as_deref()),
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => {
            return MetaHttpResponse::forbidden(
                "One or more selected Score Configs are not accessible",
            );
        }
        Err(response) => return response,
    }

    let response = AnnotateResponseBody::from(&prepared);
    if let Err(err) = llm_scores_writer::publish(&org_id, &prepared.records).await {
        log::error!("[Annotation] failed to publish Scores for {org_id}: {err}");
        return MetaHttpResponse::internal_error("Failed to publish annotation Scores");
    }

    MetaHttpResponse::json(response)
}

/// Whether the user may see every one of these Score Config entities.
async fn score_configs_visible<'a>(
    org_id: &str,
    user_id: &str,
    config_ids: impl IntoIterator<Item = Option<&'a str>>,
) -> Result<bool, Response> {
    let permitted_objects = openobserve_api_common::auth::validator::list_objects_for_user(
        org_id,
        user_id,
        "GET",
        "score_config",
    )
    .await
    .map_err(|err| MetaHttpResponse::forbidden(err.to_string()))?;
    Ok(config_ids.into_iter().all(|config_id| {
        config_id.is_some_and(|config_id| {
            is_ofga_object_visible(
                org_id,
                "score_config",
                config_id,
                permitted_objects.as_deref(),
            )
        })
    }))
}

/// MintFeedbackToken
#[utoipa::path(
    post,
    path = "/{org_id}/annotations/token",
    context_path = "/api",
    tag = "Annotations",
    operation_id = "MintFeedbackToken",
    summary = "Mint an end-user feedback token",
    description = "Server to server. Returns a token, valid for 15 minutes, that lets a browser post one end-user vote on one trace, for one Score Config and one user, to the public feedback endpoint without holding a credential.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(FeedbackTokenRequestBody), description = "Trace, Score Config name and end user the token is for"),
    responses(
        (status = 200, body = inline(FeedbackTokenResponseBody)),
        (status = 400, description = "Unsupported scope, an id that is empty or too long, or a trace stream the org does not have", body = ()),
        (status = 403, description = "The Score Config is not visible", body = ()),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})), ("x-o2-ratelimit" = json!({"module": "Annotations", "operation": "create"}))),
)]
pub async fn mint_feedback_token(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    axum::Json(body): axum::Json<FeedbackTokenRequestBody>,
) -> Response {
    if body.scope != LlmScoreTargetScope::Trace {
        return MetaHttpResponse::bad_request("Feedback tokens support scope \"trace\" only");
    }
    let trimmed = |value: Option<String>| {
        value
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let claims = FeedbackClaims {
        org_id: org_id.clone(),
        trace_id: body.trace_id.trim().to_string(),
        score_config: body.score_config.trim().to_string(),
        user_id: body.user_id.trim().to_string(),
        session_id: trimmed(body.session_id),
        stream: trimmed(body.stream).unwrap_or_else(|| "default".to_string()),
        test: body.test,
        expires_at: Utc::now().timestamp() + feedback::TOKEN_TTL_SECS,
    };
    if let Err(err) = feedback::validate_claims(&claims) {
        return MetaHttpResponse::bad_request(err);
    }
    // Discovery reads the vote's trace from this stream, so it must exist. A test vote
    // rates a synthetic trace that lives in no stream, so it works in an org with none.
    if !claims.test {
        match infra::schema::get_cache(&org_id, &claims.stream, StreamType::Traces).await {
            Ok(schema) if !schema.schema().fields().is_empty() => {}
            Ok(_) => {
                return MetaHttpResponse::bad_request(format!(
                    "Trace stream '{}' not found",
                    claims.stream
                ));
            }
            Err(err) => {
                log::error!(
                    "[Feedback] trace stream lookup failed for {org_id}/{}: {err}",
                    claims.stream
                );
                return MetaHttpResponse::internal_error("Internal server error");
            }
        }
    }

    // An existing config must be visible to the minter, as for a direct
    // annotation. An unknown name is fine: the first vote creates it.
    match infra::table::score_configs::get_by_active_name(&org_id, &claims.score_config).await {
        Ok(Some(config)) => {
            match score_configs_visible(&org_id, &user.user_id, [Some(config.entity_id.as_str())])
                .await
            {
                Ok(true) => {}
                Ok(false) => {
                    return MetaHttpResponse::forbidden("The Score Config is not accessible");
                }
                Err(response) => return response,
            }
        }
        Ok(None) => {}
        Err(err) => {
            log::error!("[Feedback] Score Config lookup failed for {org_id}: {err}");
            return MetaHttpResponse::internal_error("Internal server error");
        }
    }

    match feedback::issue(&claims).await {
        Ok(token) => MetaHttpResponse::json(FeedbackTokenResponseBody {
            token,
            expires_in: feedback::TOKEN_TTL_SECS,
        }),
        Err(err) => {
            log::error!("[Feedback] cannot mint a token for {org_id}: {err}");
            MetaHttpResponse::internal_error("Failed to mint a feedback token")
        }
    }
}

/// PostFeedbackVote
#[utoipa::path(
    post,
    path = "/v2/{org_id}/annotations/public",
    context_path = "/api",
    tag = "Annotations",
    operation_id = "PostFeedbackVote",
    summary = "Record an end-user feedback vote",
    description = "Unauthenticated: the token from MintFeedbackToken is the credential. Writes one feedback Score for the token's trace, Score Config and user; a later vote for the same three replaces it. A browser may send it from any origin, without credentials. The body is JSON and may be sent as text/plain, so a browser needs no CORS preflight.",
    security(),
    params(("org_id" = String, Path, description = "Organization name"), FeedbackVoteQuery),
    request_body(content = inline(FeedbackVoteRequestBody), description = "The vote"),
    responses(
        (status = 200, body = inline(FeedbackVoteResponseBody)),
        (status = 400, description = "Malformed vote, a value the Score Config refuses, or a comment over 1000 characters", body = ()),
        (status = 403, description = "Invalid, expired or another organization's token", body = ()),
        (status = 429, description = "Too many votes from this client", body = ()),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false}))),
)]
pub async fn post_feedback_vote(
    ip: Option<Extension<RealIp>>,
    Path(org_id): Path<String>,
    Query(query): Query<FeedbackVoteQuery>,
    body: Bytes,
) -> Response {
    if VOTES.over_budget(&client_ip(ip.map(|ip| ip.0)), VOTE_WINDOW, VOTES_PER_WINDOW) {
        return too_many_requests(VOTE_WINDOW);
    }
    let claims = match feedback::verify(&query.token, &org_id, Utc::now().timestamp()).await {
        Ok(claims) => claims,
        Err(err) if err.is_client_error() => return MetaHttpResponse::forbidden(err),
        Err(err) => {
            log::error!("[Feedback] cannot verify a token for {org_id}: {err}");
            return MetaHttpResponse::internal_error("Feedback could not be recorded");
        }
    };
    let vote: FeedbackVoteRequestBody = match serde_json::from_slice(&body) {
        Ok(vote) => vote,
        Err(err) => return MetaHttpResponse::bad_request(format!("Invalid vote: {err}")),
    };
    let config = match feedback::resolve_score_config(&org_id, &claims.score_config).await {
        Ok(ensured) => {
            // As the Score Config handlers do, so OpenFGA grants cover a config a vote created.
            if ensured.outcome == EnsureOutcome::Created {
                set_ownership(
                    &org_id,
                    "score_configs",
                    Authz::new(&ensured.config.entity_id),
                )
                .await;
            }
            ensured.config
        }
        Err(err) => {
            log::error!("[Feedback] cannot resolve Score Config for {org_id}: {err}");
            return MetaHttpResponse::internal_error("Feedback could not be recorded");
        }
    };
    let input = match feedback::vote_annotation(
        &claims,
        &config,
        vote.value,
        vote.comment,
        Utc::now().timestamp_micros(),
    ) {
        Ok(input) => input,
        Err(err) => return MetaHttpResponse::bad_request(err),
    };
    let prepared = match annotations::prepare(&org_id, &claims.user_id, input).await {
        Ok(prepared) => prepared,
        Err(err) => return annotation_error_response(err),
    };
    // Through the ingest path, so org quota and ingester back-pressure apply as to any write.
    if let Err(err) = llm_scores_writer::publish(&org_id, &prepared.records).await {
        log::error!("[Feedback] failed to publish a vote for {org_id}: {err}");
        return MetaHttpResponse::service_unavailable("Feedback could not be recorded");
    }
    MetaHttpResponse::json(FeedbackVoteResponseBody {
        score_id: prepared
            .records
            .first()
            .map(|record| record.id.clone())
            .unwrap_or_default(),
    })
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
