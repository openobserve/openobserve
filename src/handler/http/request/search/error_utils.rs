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
