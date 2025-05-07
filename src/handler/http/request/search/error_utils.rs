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

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse, handler::http::router::ERROR_HEADER,
};

pub fn map_error_to_http_response(err: &errors::Error, trace_id: String) -> HttpResponse {
    let trace_id = if trace_id.is_empty() {
        None
    } else {
        Some(trace_id)
    };
    match err {
        errors::Error::ErrorCode(code) => match code {
            errors::ErrorCodes::RatelimitExceeded(_) => HttpResponse::TooManyRequests()
                .append_header((ERROR_HEADER, code.to_json()))
                .json(MetaHttpResponse::error_code_with_trace_id(
                    code,
                    Some(trace_id),
                )),
            errors::ErrorCodes::SearchTimeout(_) => HttpResponse::RequestTimeout()
                .append_header((ERROR_HEADER, code.to_json()))
                .json(MetaHttpResponse::error_code_with_trace_id(code, trace_id)),
            errors::ErrorCodes::InvalidParams(_)
            | errors::ErrorCodes::SearchSQLExecuteError(_)
            | errors::ErrorCodes::SearchFieldHasNoCompatibleDataType(_)
            | errors::ErrorCodes::SearchFunctionNotDefined(_)
            | errors::ErrorCodes::FullTextSearchFieldNotFound
            | errors::ErrorCodes::SearchFieldNotFound(_)
            | errors::ErrorCodes::SearchSQLNotValid(_)
            | errors::ErrorCodes::SearchStreamNotFound(_)
            | errors::ErrorCodes::SearchCancelQuery(_) => HttpResponse::BadRequest()
                .append_header((ERROR_HEADER, code.to_json()))
                .json(MetaHttpResponse::error_code_with_trace_id(code, trace_id)),

            errors::ErrorCodes::ServerInternalError(_)
            | errors::ErrorCodes::SearchParquetFileNotFound => HttpResponse::InternalServerError()
                .append_header((ERROR_HEADER, code.to_json()))
                .json(MetaHttpResponse::error_code_with_trace_id(code, trace_id)),
        },
        _ => HttpResponse::InternalServerError()
            .append_header((ERROR_HEADER, err.to_string()))
            .json(MetaHttpResponse::error(
                StatusCode::INTERNAL_SERVER_ERROR.into(),
                err.to_string(),
            )),
    }
}
