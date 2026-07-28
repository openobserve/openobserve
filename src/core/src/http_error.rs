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

//! Rendering an [`infra::errors::Error`] as an HTTP response.
//!
//! This is the domain-agnostic half of [`crate::http`]: it only needs the error type itself, so it
//! sits at the bottom of the crate where any service can reach it. The per-domain
//! `From<SomeError> for Response` impls have to stay next to the error types they convert (the
//! orphan rule), and those live in [`crate::http`].

use axum::{
    Json,
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use infra::errors;

use crate::common::meta::http::{ERROR_HEADER, HttpResponse as MetaHttpResponse};

pub fn map_error_to_http_response(err: &errors::Error, trace_id: Option<String>) -> Response {
    // the status code mapping lives on `infra::errors::Error` so that other
    // consumers (e.g. audit logging) stay consistent with the HTTP responses
    let status =
        StatusCode::from_u16(err.http_status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    match err {
        errors::Error::ErrorCode(code) => {
            let mut body = MetaHttpResponse::error_code_with_trace_id(code, trace_id);
            // attach hint/did-you-mean suggestions where the code carries
            // enough information (no-op for the rest)
            crate::error_suggest::enrich(&mut body, code);
            (
                status,
                [(ERROR_HEADER, HeaderValue::from(code.get_code()))],
                Json(body),
            )
                .into_response()
        }
        // These errors don't carry a structured error code, so we don't set the
        // `X-Error-Message` header (it should only carry error codes). The full
        // message is still returned in the JSON response body.
        _ => (status, Json(MetaHttpResponse::error(status, err))).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    #[test]
    fn test_error_code_response_sets_numeric_code_header() {
        // Error-code responses carry only the numeric error code in the header
        // (e.g. 20002 for SearchStreamNotFound), never the message.
        let err = errors::Error::ErrorCode(errors::ErrorCodes::SearchStreamNotFound(
            "nginx".to_string(),
        ));
        let resp = map_error_to_http_response(&err, None);
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert_eq!(resp.headers().get(ERROR_HEADER).unwrap(), "20002");
    }

    #[test]
    fn test_non_code_error_omits_header() {
        // Errors without a structured code don't set the header at all; the
        // message is surfaced only in the JSON body.
        let err = errors::Error::SerdeJsonError(
            serde_json::from_str::<serde_json::Value>("{").unwrap_err(),
        );
        let resp = map_error_to_http_response(&err, None);
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert!(resp.headers().get(ERROR_HEADER).is_none());
    }
}
