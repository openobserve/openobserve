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
use config::meta::stream::StreamType;
use infra::errors;
use o2_openfga::meta::mapping::OFGA_MODELS;

use crate::common::{
    infra::config::USERS,
    meta::{self, http::HttpResponse as MetaHttpResponse},
    utils::auth::{AuthExtractor, is_root_user},
};

// Check permissions on stream
pub async fn check_stream_permissions(
    stream_name: &str,
    org_id: &str,
    user_id: &str,
    stream_type: &StreamType,
) -> Option<HttpResponse> {
    if !is_root_user(user_id) {
        let user: meta::user::User = USERS.get(&format!("{org_id}/{}", user_id)).unwrap().clone();
        let stream_type_str = stream_type.as_str();

        if !crate::handler::http::auth::validator::check_permissions(
            user_id,
            AuthExtractor {
                auth: "".to_string(),
                method: "GET".to_string(),
                o2_type: format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(stream_type_str)
                        .map_or(stream_type_str, |model| model.key),
                    stream_name
                ),
                org_id: org_id.to_string(),
                bypass_check: false,
                parent_id: "".to_string(),
            },
            user.role,
            user.is_external,
        )
        .await
        {
            return Some(MetaHttpResponse::forbidden("Unauthorized Access"));
        }
    }
    None
}

pub fn map_error_to_http_response(err: errors::Error, trace_id: String) -> HttpResponse {
    match err {
        errors::Error::ErrorCode(code) => match code {
            errors::ErrorCodes::SearchCancelQuery(_) => HttpResponse::TooManyRequests().json(
                meta::http::HttpResponse::error_code_with_trace_id(code, Some(trace_id)),
            ),
            errors::ErrorCodes::SearchTimeout(_) => HttpResponse::RequestTimeout().json(
                meta::http::HttpResponse::error_code_with_trace_id(code, Some(trace_id)),
            ),
            errors::ErrorCodes::InvalidParams(_)
            | errors::ErrorCodes::SearchSQLExecuteError(_)
            | errors::ErrorCodes::SearchFieldHasNoCompatibleDataType(_)
            | errors::ErrorCodes::SearchFunctionNotDefined(_)
            | errors::ErrorCodes::FullTextSearchFieldNotFound
            | errors::ErrorCodes::SearchFieldNotFound(_)
            | errors::ErrorCodes::SearchSQLNotValid(_)
            | errors::ErrorCodes::SearchStreamNotFound(_) => HttpResponse::BadRequest().json(
                meta::http::HttpResponse::error_code_with_trace_id(code, Some(trace_id)),
            ),

            errors::ErrorCodes::ServerInternalError(_)
            | errors::ErrorCodes::SearchParquetFileNotFound => {
                HttpResponse::InternalServerError().json(
                    meta::http::HttpResponse::error_code_with_trace_id(code, Some(trace_id)),
                )
            }
        },
        _ => HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
            StatusCode::INTERNAL_SERVER_ERROR.into(),
            err.to_string(),
        )),
    }
}
