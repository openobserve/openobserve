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

pub use openobserve_core::http::map_error_to_http_response;

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use infra::errors;

    use super::*;

    #[test]
    fn test_map_error_to_http_response_search_cancel_query() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::SearchCancelQuery(
            "Query cancelled".to_string(),
        ));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn test_map_error_to_http_response_ratelimit_exceeded() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::RatelimitExceeded(
            "Rate limit exceeded".to_string(),
        ));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn test_map_error_to_http_response_search_timeout() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::SearchTimeout(
            "Search timeout".to_string(),
        ));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::REQUEST_TIMEOUT);
    }

    #[test]
    fn test_map_error_to_http_response_invalid_params() {
        let err =
            errors::Error::ErrorCode(errors::ErrorCodes::InvalidParams("Invalid".to_string()));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_map_error_to_http_response_search_sql_execute_error() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::SearchSQLExecuteError(
            "SQL error".to_string(),
        ));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_map_error_to_http_response_search_field_has_no_compatible_data_type() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::SearchFieldHasNoCompatibleDataType(
            "Field incompatible".to_string(),
        ));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_map_error_to_http_response_search_function_not_defined() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::SearchFunctionNotDefined(
            "Function not defined".to_string(),
        ));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_map_error_to_http_response_fulltext_search_field_not_found() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::FullTextSearchFieldNotFound);
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_map_error_to_http_response_search_field_not_found() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::SearchFieldNotFound(
            "Field not found".to_string(),
        ));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_map_error_to_http_response_search_sql_not_valid() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::SearchSQLNotValid(
            "SQL not valid".to_string(),
        ));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_map_error_to_http_response_search_stream_not_found() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::SearchStreamNotFound(
            "Stream not found".to_string(),
        ));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_map_error_to_http_response_search_histogram_not_available() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::SearchHistogramNotAvailable(
            "Histogram not available".to_string(),
        ));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_map_error_to_http_response_server_internal_error() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::ServerInternalError(
            "Internal error".to_string(),
        ));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_map_error_to_http_response_search_parquet_file_not_found() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::SearchParquetFileNotFound);
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_map_error_to_http_response_resource_error() {
        let err = errors::Error::ResourceError("Resource error".to_string());
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[test]
    fn test_map_error_to_http_response_other_error() {
        let err = errors::Error::Message("Generic error".to_string());
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_map_error_to_http_response_serde_json_error() {
        // A malformed request body should surface as 400, not 500.
        let json_err =
            config::utils::json::from_slice::<config::meta::search::Request>(b"\"\"").unwrap_err();
        let err = errors::Error::SerdeJsonError(json_err);
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_map_error_to_http_response_with_trace_id() {
        let err = errors::Error::ErrorCode(errors::ErrorCodes::SearchCancelQuery(
            "Query cancelled".to_string(),
        ));
        let trace_id = Some("trace-123".to_string());
        let response = map_error_to_http_response(&err, trace_id);
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn test_map_error_to_http_response_without_trace_id() {
        let err =
            errors::Error::ErrorCode(errors::ErrorCodes::InvalidParams("Invalid".to_string()));
        let response = map_error_to_http_response(&err, None);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
