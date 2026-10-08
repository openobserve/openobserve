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
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use db::user::is_root_user;

const USER_ID_HEADER: &str = "user_id";

/// Refuses every caller but a root user; layer it inside `auth_middleware`, which sets `user_id`.
pub async fn root_only_middleware(request: Request, next: Next) -> Response {
    let is_root = request
        .headers()
        .get(USER_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .is_some_and(is_root_user);
    if !is_root {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"message": "Only root users can access this resource"})),
        )
            .into_response();
    }
    next.run(request).await
}
