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
    extract::Request,
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use config::get_config;

/// Validates the action server token from Basic auth header.
/// Expected format: Basic {base64(token + ":")}
fn validate_action_server_token(auth_header: Option<&str>) -> bool {
    let Some(auth_str) = auth_header else {
        return false;
    };

    let Some(encoded) = auth_str.strip_prefix("Basic ") else {
        return false;
    };

    let Ok(decoded) = STANDARD.decode(encoded.trim()) else {
        return false;
    };

    let Ok(decoded_str) = String::from_utf8(decoded) else {
        return false;
    };

    let cfg = get_config();
    let expected_token = format!("{}:", cfg.auth.action_server_token);
    decoded_str == expected_token
}

/// Authentication middleware for action server routes.
/// Validates requests using O2_ACTION_SERVER_TOKEN.
pub async fn auth_middleware(request: Request, next: Next) -> Response {
    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());

    if validate_action_server_token(auth_header) {
        next.run(request).await
    } else {
        (StatusCode::UNAUTHORIZED, "Unauthorized Access").into_response()
    }
}
