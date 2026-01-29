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
    extract::{FromRequestParts, Request},
    http::header,
    middleware::Next,
    response::{IntoResponse, Response},
};

use super::validator::{AuthError, AuthValidationResult, RequestData};
use crate::common::utils::auth::AuthExtractor;

/// Validator for script server authentication
pub async fn validator(
    req_data: &RequestData,
    auth_info: &AuthExtractor,
) -> Result<AuthValidationResult, AuthError> {
    // Use the standard validator for script server authentication
    // Script server uses the same authentication mechanism as the main API
    super::validator::oo_validator(req_data, auth_info).await
}

/// Authentication middleware for script server routes
pub async fn auth_middleware(request: Request, next: Next) -> Response {
    // Extract request data
    let req_data = RequestData {
        uri: request.uri().clone(),
        method: request.method().clone(),
        headers: request.headers().clone(),
    };

    // Extract auth info
    let (mut parts, body) = request.into_parts();
    let auth_info = match AuthExtractor::from_request_parts(&mut parts, &()).await {
        Ok(info) => info,
        Err(e) => return e.into_response(),
    };

    // Validate authentication
    match validator(&req_data, &auth_info).await {
        Ok(result) => {
            parts.headers.insert(
                header::HeaderName::from_static("user_id"),
                header::HeaderValue::from_str(&result.user_email)
                    .unwrap_or_else(|_| header::HeaderValue::from_static("")),
            );
            next.run(Request::from_parts(parts, body)).await
        }
        Err(e) => e.into_response(),
    }
}
