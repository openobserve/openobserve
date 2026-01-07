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
    http::StatusCode,
    response::{IntoResponse, Response},
};
#[cfg(feature = "enterprise")]
use {
    crate::service::self_reporting::audit,
    crate::{common::utils::jwt::verify_decode_token, handler::http::auth::jwt::process_token},
    config::utils::time::now_micros,
    o2_dex::{config::get_config as get_dex_config, service::auth::get_dex_jwks},
    o2_enterprise::enterprise::common::auditor::{AuditMessage, Protocol, ResponseMeta},
};

#[cfg(feature = "enterprise")]
pub async fn exchange_token(
    Json(body): Json<o2_dex::meta::auth::TokenExchangeRequest>,
) -> Response {
    let result = o2_dex::service::token_exchange::exchange_token(&body).await;

    let mut audit_message = AuditMessage {
        user_email: "".to_string(),
        org_id: "".to_string(),
        _timestamp: now_micros(),
        protocol: Protocol::Http,
        response_meta: ResponseMeta {
            http_method: "POST".to_string(),
            http_path: "/token".to_string(),
            http_body: "".to_string(),
            http_query_params: "".to_string(),
            http_response_code: 200,
            error_msg: None,
            trace_id: None,
        },
    };
    match result {
        Ok(response) => {
            let keys = get_dex_jwks().await;
            let token_ver = verify_decode_token(
                &response.access_token,
                &keys,
                &get_dex_config().client_id,
                true,
                false,
            );
            match token_ver {
                Ok(res) => {
                    audit_message.user_email = res.0.user_email.clone();
                    _ = process_token(res).await;
                }
                Err(e) => {
                    audit_message.response_meta.http_response_code = 401;
                    audit_message._timestamp = now_micros();
                    audit(audit_message).await;
                    return (StatusCode::UNAUTHORIZED, Json(e.to_string())).into_response();
                }
            }
            audit_message._timestamp = now_micros();
            audit(audit_message).await;
            (StatusCode::OK, Json(response)).into_response()
        }
        Err(e) => {
            log::error!("Error: {e}");
            audit_message.response_meta.http_response_code = 401;
            audit_message._timestamp = now_micros();
            audit(audit_message).await;
            (StatusCode::UNAUTHORIZED, Json(e.to_string())).into_response()
        }
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn exchange_token(Json(_body): Json<String>) -> Response {
    (StatusCode::FORBIDDEN, Json("Not allowed")).into_response()
}
