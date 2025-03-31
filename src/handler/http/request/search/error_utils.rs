use actix_web::{HttpResponse, http::StatusCode};
use infra::errors;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

pub fn map_error_to_http_response(err: errors::Error, trace_id: String) -> HttpResponse {
    match err {
        errors::Error::ErrorCode(code) => match code {
            errors::ErrorCodes::SearchCancelQuery(_) => HttpResponse::TooManyRequests().json(
                MetaHttpResponse::error_code_with_trace_id(code, Some(trace_id)),
            ),
            errors::ErrorCodes::SearchTimeout(_) => HttpResponse::RequestTimeout().json(
                MetaHttpResponse::error_code_with_trace_id(code, Some(trace_id)),
            ),
            errors::ErrorCodes::InvalidParams(_)
            | errors::ErrorCodes::SearchSQLExecuteError(_)
            | errors::ErrorCodes::SearchFieldHasNoCompatibleDataType(_)
            | errors::ErrorCodes::SearchFunctionNotDefined(_)
            | errors::ErrorCodes::FullTextSearchFieldNotFound
            | errors::ErrorCodes::SearchFieldNotFound(_)
            | errors::ErrorCodes::SearchSQLNotValid(_)
            | errors::ErrorCodes::SearchStreamNotFound(_) => HttpResponse::BadRequest().json(
                MetaHttpResponse::error_code_with_trace_id(code, Some(trace_id)),
            ),

            errors::ErrorCodes::ServerInternalError(_)
            | errors::ErrorCodes::SearchParquetFileNotFound => {
                HttpResponse::InternalServerError().json(
                    MetaHttpResponse::error_code_with_trace_id(code, Some(trace_id)),
                )
            }
        },
        _ => HttpResponse::InternalServerError().json(MetaHttpResponse::error(
            StatusCode::INTERNAL_SERVER_ERROR.into(),
            err.to_string(),
        )),
    }
}
