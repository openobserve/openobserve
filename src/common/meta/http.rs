// Copyright 2025 OpenObserve Inc.
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

use actix_web::{HttpResponse as ActixHttpResponse, http::StatusCode};
use infra::errors;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// HTTP response
/// code 200 is success
/// code 400 is error
/// code 404 is not found
/// code 500 is internal server error
/// code 503 is service unavailable
/// code >= 1000 is custom error code
/// message is the message or error message
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct HttpResponse {
    pub code: u16,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ESResponse {
    pub took: u16,
    pub errors: bool,
    // pub items: Vec<Item>
}

impl HttpResponse {
    pub fn message(code: impl Into<u16>, message: impl ToString) -> Self {
        HttpResponse {
            code: code.into(),
            message: message.to_string(),
            id: None,
            name: None,
            error_detail: None,
            trace_id: None,
        }
    }

    pub fn error(code: impl Into<u16>, error: impl ToString) -> Self {
        HttpResponse {
            code: code.into(),
            message: error.to_string(),
            id: None,
            name: None,
            error_detail: None,
            trace_id: None,
        }
    }

    pub fn error_code(err: errors::ErrorCodes) -> Self {
        HttpResponse {
            code: err.get_code(),
            message: err.get_message(),
            id: None,
            name: None,
            error_detail: Some(err.get_error_detail()),
            trace_id: None,
        }
    }

    pub fn error_code_with_trace_id(err: &errors::ErrorCodes, trace_id: Option<String>) -> Self {
        HttpResponse {
            code: err.get_code(),
            message: err.get_message(),
            id: None,
            name: None,
            error_detail: Some(err.get_error_detail()),
            trace_id,
        }
    }

    pub fn with_trace_id(&mut self, trace_id: String) -> &mut Self {
        self.trace_id = Some(trace_id);
        self
    }

    pub fn with_id(&mut self, id: String) -> &mut Self {
        self.id = Some(id);
        self
    }

    pub fn with_name(&mut self, name: String) -> &mut Self {
        self.name = Some(name);
        self
    }

    /// Send a normal response in json format and associate the
    /// provided message as `message` field.
    pub fn ok(msg: impl ToString) -> ActixHttpResponse {
        ActixHttpResponse::Ok().json(Self::message(StatusCode::OK, msg.to_string()))
    }

    /// Send a BadRequest response in json format and associate the
    /// provided error as `error` field.
    pub fn bad_request(error: impl ToString) -> ActixHttpResponse {
        ActixHttpResponse::BadRequest()
            .json(Self::error(StatusCode::BAD_REQUEST, error.to_string()))
    }

    /// Send an Unauthorized response in json format and sets the
    /// provided error as the `error` field.
    pub fn unauthorized(error: impl ToString) -> ActixHttpResponse {
        ActixHttpResponse::Forbidden()
            .json(Self::error(StatusCode::UNAUTHORIZED, error.to_string()))
    }

    /// Send a Forbidden response in json format and associate the
    /// provided error as `error` field.
    pub fn forbidden(error: impl ToString) -> ActixHttpResponse {
        ActixHttpResponse::Forbidden().json(Self::error(StatusCode::FORBIDDEN, error.to_string()))
    }

    /// Send a Forbidden response in json format and associate the
    /// provided error as `error` field.
    pub fn conflict(error: impl ToString) -> ActixHttpResponse {
        ActixHttpResponse::Conflict().json(Self::error(StatusCode::CONFLICT, error.to_string()))
    }

    /// Send a NotFound response in json format and associate the
    /// provided error as `error` field.
    pub fn not_found(error: impl ToString) -> ActixHttpResponse {
        ActixHttpResponse::NotFound().json(Self::error(StatusCode::NOT_FOUND, error.to_string()))
    }

    /// Send a InternalServerError response in json format and associate the
    /// provided error as `error` field.
    pub fn internal_error(error: impl ToString) -> ActixHttpResponse {
        ActixHttpResponse::InternalServerError().json(Self::error(
            StatusCode::INTERNAL_SERVER_ERROR,
            error.to_string(),
        ))
    }

    /// Send a response in json format, status code is 200.
    /// The payload should be serde-serializable.
    pub fn json(payload: impl Serialize) -> ActixHttpResponse {
        ActixHttpResponse::Ok().json(payload)
    }
}

#[cfg(test)]
mod tests {
    use actix_web::http;

    use super::*;

    #[test]
    fn test_http_response() {
        let msg = "This is an error response";
        let err = HttpResponse::message(http::StatusCode::OK, msg.to_string());
        assert_eq!(err.code, http::StatusCode::OK);
        assert_eq!(err.message, msg);

        let err = HttpResponse::error(http::StatusCode::INTERNAL_SERVER_ERROR, msg.to_string());
        assert_eq!(err.code, http::StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(err.message, msg);

        let errcode = errors::ErrorCodes::ServerInternalError(msg.to_string());
        let err =
            HttpResponse::error_code(errors::ErrorCodes::ServerInternalError(msg.to_string()));
        assert_eq!(err.code, errcode.get_code());
        assert_eq!(err.message, errcode.get_message());
    }

    #[test]
    fn test_http_response_with_trace_id() {
        let mut response = HttpResponse::message(http::StatusCode::OK, "test");
        response.with_trace_id("trace-123".to_string());
        assert_eq!(response.trace_id, Some("trace-123".to_string()));
    }

    #[test]
    fn test_http_response_with_id() {
        let mut response = HttpResponse::message(http::StatusCode::OK, "test");
        response.with_id("id-123".to_string());
        assert_eq!(response.id, Some("id-123".to_string()));
    }

    #[test]
    fn test_http_response_with_name() {
        let mut response = HttpResponse::message(http::StatusCode::OK, "test");
        response.with_name("test-name".to_string());
        assert_eq!(response.name, Some("test-name".to_string()));
    }

    #[test]
    fn test_http_response_error_code_with_trace_id() {
        let errcode = errors::ErrorCodes::ServerInternalError("test error".to_string());
        let response =
            HttpResponse::error_code_with_trace_id(&errcode, Some("trace-123".to_string()));
        assert_eq!(response.code, errcode.get_code());
        assert_eq!(response.message, errcode.get_message());
        assert_eq!(response.error_detail, Some(errcode.get_error_detail()));
        assert_eq!(response.trace_id, Some("trace-123".to_string()));
    }

    #[test]
    fn test_http_response_serialization() {
        let response = HttpResponse {
            code: 200,
            message: "success".to_string(),
            id: Some("id-123".to_string()),
            name: Some("test".to_string()),
            error_detail: None,
            trace_id: Some("trace-123".to_string()),
        };

        let serialized = serde_json::to_string(&response).unwrap();
        let deserialized: HttpResponse = serde_json::from_str(&serialized).unwrap();

        assert_eq!(response.code, deserialized.code);
        assert_eq!(response.message, deserialized.message);
        assert_eq!(response.id, deserialized.id);
        assert_eq!(response.name, deserialized.name);
        assert_eq!(response.error_detail, deserialized.error_detail);
        assert_eq!(response.trace_id, deserialized.trace_id);
    }

    #[test]
    fn test_es_response() {
        let response = ESResponse {
            took: 100,
            errors: false,
        };

        assert_eq!(response.took, 100);
        assert!(!response.errors);
    }

    #[test]
    fn test_es_response_serialization() {
        let response = ESResponse {
            took: 100,
            errors: false,
        };

        let serialized = serde_json::to_string(&response).unwrap();
        let deserialized: ESResponse = serde_json::from_str(&serialized).unwrap();

        assert_eq!(response.took, deserialized.took);
        assert_eq!(response.errors, deserialized.errors);
    }

    #[test]
    fn test_http_response_ok() {
        let response = HttpResponse::ok("success");
        assert_eq!(response.status(), http::StatusCode::OK);
    }

    #[test]
    fn test_http_response_bad_request() {
        let response = HttpResponse::bad_request("bad request");
        assert_eq!(response.status(), http::StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_http_response_unauthorized() {
        let response = HttpResponse::unauthorized("unauthorized");
        assert_eq!(response.status(), http::StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_http_response_forbidden() {
        let response = HttpResponse::forbidden("forbidden");
        assert_eq!(response.status(), http::StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_http_response_conflict() {
        let response = HttpResponse::conflict("conflict");
        assert_eq!(response.status(), http::StatusCode::CONFLICT);
    }

    #[test]
    fn test_http_response_not_found() {
        let response = HttpResponse::not_found("not found");
        assert_eq!(response.status(), http::StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_http_response_internal_error() {
        let response = HttpResponse::internal_error("internal error");
        assert_eq!(response.status(), http::StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_http_response_json() {
        let payload = vec![1, 2, 3];
        let response = HttpResponse::json(payload);
        assert_eq!(response.status(), http::StatusCode::OK);
    }

    #[test]
    fn test_optional_fields_not_serialized_when_none() {
        let response = HttpResponse {
            code: 200,
            message: "ok".to_string(),
            id: None,
            name: None,
            error_detail: None,
            trace_id: None,
        };
        let serialized = serde_json::to_string(&response).unwrap();
        assert!(!serialized.contains("id"));
        assert!(!serialized.contains("name"));
        assert!(!serialized.contains("error_detail"));
        assert!(!serialized.contains("trace_id"));
    }

    #[test]
    fn test_http_response_builder_chaining() {
        let mut response = HttpResponse::message(http::StatusCode::OK, "test");
        response
            .with_id("id-1".into())
            .with_name("name-1".into())
            .with_trace_id("trace-1".into());

        assert_eq!(response.id, Some("id-1".into()));
        assert_eq!(response.name, Some("name-1".into()));
        assert_eq!(response.trace_id, Some("trace-1".into()));
    }
}
