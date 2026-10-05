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
    extract::{Path, Query},
    response::Response,
};
use infra::table::score_configs::ScoreConfig;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::{UserEmail, is_ofga_object_visible},
    http::map_error_to_http_response,
    llm_evaluations::quality::{self, QualityConfigList, QualityError, QualityScorePage},
};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::quality::{ListQualityQuery, ListQualityScoresQuery},
};

fn quality_error_response(error: QualityError) -> Response {
    match error {
        QualityError::NotFound(_) => MetaHttpResponse::not_found(error),
        error @ (QualityError::InvalidTimeRange
        | QualityError::InvalidPageSize
        | QualityError::UnsupportedScope
        | QualityError::InvalidValueFilter(_)) => MetaHttpResponse::bad_request(error),
        QualityError::Infra(error) => {
            log::error!("[Quality] score-config database error: {error}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        QualityError::Search(error) => {
            log::error!("[Quality] {error}");
            match error.downcast_ref::<infra::errors::Error>() {
                Some(error) => map_error_to_http_response(error, None),
                None => MetaHttpResponse::internal_error("Quality query failed"),
            }
        }
        error @ QualityError::MalformedSearchResponse(_) => {
            log::error!("[Quality] {error}");
            MetaHttpResponse::internal_error("Quality query failed")
        }
    }
}

/// ListScoreConfigQuality
#[utoipa::path(
    get,
    path = "/{org_id}/score_configs/quality",
    context_path = "/api",
    tag = "ScoreConfigs",
    operation_id = "ListScoreConfigQuality",
    summary = "Quality summary for every Score Config",
    description = "Reads the latest Score per evaluation for each active Score Config the caller can see, in the time window, and returns its health status, totals, average, per-scope counts and most frequent value. The scope filter applies to everything except the per-scope counts.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ListQualityQuery,
    ),
    responses(
        (status = 200, body = inline(QualityConfigList)),
        (status = 400, description = "Invalid request or search query", content_type = "application/json", body = MetaHttpResponse),
        (status = 403, description = "Forbidden", content_type = "application/json", body = MetaHttpResponse),
        (status = 500, description = "Quality query failed", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "ScoreConfigs", "operation": "list"}))),
)]
pub async fn list_quality_summaries(
    Path(org_id): Path<String>,
    Query(query): Query<ListQualityQuery>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    // Same visibility as ListScoreConfigs, so the page never names a config
    // the caller cannot open.
    let permitted_objects = match openobserve_api_common::auth::validator::list_objects_for_user(
        &org_id,
        &user_email.user_id,
        "GET",
        "score_config",
    )
    .await
    {
        Ok(list) => list,
        Err(error) => return MetaHttpResponse::forbidden(error.to_string()),
    };
    let is_visible = |config: &ScoreConfig| {
        is_ofga_object_visible(
            &org_id,
            "score_config",
            &config.entity_id,
            permitted_objects.as_deref(),
        )
    };
    match quality::list_summaries(&org_id, query.into(), is_visible).await {
        Ok(list) => MetaHttpResponse::json(list),
        Err(error) => quality_error_response(error),
    }
}

/// ListScoreConfigQualityScores
#[utoipa::path(
    get,
    path = "/{org_id}/score_configs/{entity_id}/quality",
    context_path = "/api",
    tag = "ScoreConfigs",
    operation_id = "ListScoreConfigQualityScores",
    summary = "Value distribution and latest Scores for one Score Config",
    description = "Pages the latest Score per evaluation for the config, newest first. Filters by scope, agent, health, numeric distribution bucket or exact value. The total counts every Score that matches the filters. The value distribution follows only the scope and agent filters, so it stays the same while the page drills into one bucket or value.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Score Config entity ID"),
        ListQualityScoresQuery,
    ),
    responses(
        (status = 200, body = inline(QualityScorePage)),
        (status = 400, description = "Invalid request or search query", content_type = "application/json", body = MetaHttpResponse),
        (status = 404, description = "Score Config not found", content_type = "application/json", body = MetaHttpResponse),
        (status = 500, description = "Quality query failed", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(("x-o2-ratelimit" = json!({"module": "ScoreConfigs", "operation": "list"}))),
)]
pub async fn list_quality_scores(
    Path((org_id, entity_id)): Path<(String, String)>,
    Query(query): Query<ListQualityScoresQuery>,
) -> Response {
    match quality::list_scores(&org_id, &entity_id, query.into()).await {
        Ok(page) => MetaHttpResponse::json(page),
        Err(error) => quality_error_response(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_client_errors() {
        let status = |error| quality_error_response(error).status().as_u16();
        assert_eq!(status(QualityError::NotFound("cfg".to_string())), 404);
        assert_eq!(status(QualityError::InvalidTimeRange), 400);
        assert_eq!(
            status(QualityError::InvalidValueFilter("x".to_string())),
            400
        );
        assert_eq!(
            status(QualityError::Search(anyhow::anyhow!("private details"))),
            500
        );
    }
}
