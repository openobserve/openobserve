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
    http::StatusCode,
    response::{IntoResponse, Response},
};
use infra::errors;

use crate::common::meta::http::{ERROR_HEADER, HttpResponse as MetaHttpResponse};
#[cfg(feature = "enterprise")]
use crate::{
    llm_evaluations::eval_jobs::EvalJobError, providers::ProviderError,
    ratelimit::rule::RatelimitError,
};

pub fn map_error_to_http_response(err: &errors::Error, trace_id: Option<String>) -> Response {
    match err {
        errors::Error::ErrorCode(code) => match code {
            errors::ErrorCodes::SearchCancelQuery(_) | errors::ErrorCodes::RatelimitExceeded(_) => {
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    [(ERROR_HEADER, code.to_json())],
                    Json(MetaHttpResponse::error_code_with_trace_id(code, trace_id)),
                )
                    .into_response()
            }
            errors::ErrorCodes::SearchTimeout(_) => (
                StatusCode::REQUEST_TIMEOUT,
                [(ERROR_HEADER, code.to_json())],
                Json(MetaHttpResponse::error_code_with_trace_id(code, trace_id)),
            )
                .into_response(),
            errors::ErrorCodes::InvalidParams(_)
            | errors::ErrorCodes::SearchSQLExecuteError(_)
            | errors::ErrorCodes::SearchFieldHasNoCompatibleDataType(_)
            | errors::ErrorCodes::SearchFunctionNotDefined(_)
            | errors::ErrorCodes::FullTextSearchFieldNotFound
            | errors::ErrorCodes::SearchFieldNotFound(_)
            | errors::ErrorCodes::SearchSQLNotValid(_)
            | errors::ErrorCodes::SearchStreamNotFound(_)
            | errors::ErrorCodes::SearchHistogramNotAvailable(_) => (
                StatusCode::BAD_REQUEST,
                [(ERROR_HEADER, code.to_json())],
                Json(MetaHttpResponse::error_code_with_trace_id(code, trace_id)),
            )
                .into_response(),
            errors::ErrorCodes::ServerInternalError(_)
            | errors::ErrorCodes::SearchParquetFileNotFound => (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(ERROR_HEADER, code.to_json())],
                Json(MetaHttpResponse::error_code_with_trace_id(code, trace_id)),
            )
                .into_response(),
        },
        errors::Error::ResourceError(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            [(ERROR_HEADER, err.to_string())],
            Json(MetaHttpResponse::error(
                StatusCode::SERVICE_UNAVAILABLE,
                err,
            )),
        )
            .into_response(),
        // A JSON deserialization failure means the client sent a malformed
        // request body, so surface it as 400 rather than a 500 server error.
        errors::Error::SerdeJsonError(_) => (
            StatusCode::BAD_REQUEST,
            [(ERROR_HEADER, err.to_string())],
            Json(MetaHttpResponse::error(StatusCode::BAD_REQUEST, err)),
        )
            .into_response(),
        _ => (
            StatusCode::BAD_REQUEST,
            [(ERROR_HEADER, err.to_string())],
            Json(MetaHttpResponse::error(StatusCode::BAD_REQUEST, err)),
        )
            .into_response(),
    }
}

#[cfg(feature = "enterprise")]
impl From<EvalJobError> for Response {
    fn from(value: EvalJobError) -> Self {
        match value {
            EvalJobError::InfraError(err) => {
                log::error!("[EvalJob] internal error: {err}");
                MetaHttpResponse::internal_error("Internal server error")
            }
            EvalJobError::NotFound => MetaHttpResponse::not_found(value),
            EvalJobError::ReconcilerError(err) => {
                log::error!("[EvalJob] reconciler error: {err}");
                MetaHttpResponse::internal_error("Internal server error")
            }
            EvalJobError::InvalidStatus(_) | EvalJobError::InvalidStatusTransition { .. } => {
                MetaHttpResponse::bad_request(value)
            }
        }
    }
}

#[cfg(feature = "enterprise")]
impl From<ProviderError> for Response {
    fn from(value: ProviderError) -> Self {
        match value {
            ProviderError::InfraError(err) => {
                log::error!("[Provider] internal error: {err}");
                MetaHttpResponse::internal_error("Internal server error")
            }
            ProviderError::MissingName => {
                MetaHttpResponse::bad_request("Provider name cannot be empty")
            }
            ProviderError::ProviderNameAlreadyExists => MetaHttpResponse::bad_request(
                "Provider with this name already exists in this organization",
            ),
            ProviderError::NotFound => MetaHttpResponse::not_found("Provider not found"),
            ProviderError::InvalidConfig(err) => MetaHttpResponse::bad_request(err),
            ProviderError::ProviderInUse(scorers) => MetaHttpResponse::conflict(format!(
                "Provider is used by active scorers: {scorers}. Unlink or replace the provider before deleting it."
            )),
        }
    }
}

#[cfg(feature = "enterprise")]
impl From<RatelimitError> for Response {
    fn from(value: RatelimitError) -> Self {
        match value {
            RatelimitError::NotFound(_) => MetaHttpResponse::not_found(value),
            error => MetaHttpResponse::bad_request(error),
        }
    }
}
