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

use actix_web::{Error, HttpRequest, HttpResponse, post, web};
#[cfg(feature = "enterprise")]
use o2_dex::{config::get_config as get_dex_config, service::auth::get_dex_jwks};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::auditor::{AuditMessage, HttpMeta, Protocol};

#[cfg(feature = "enterprise")]
use crate::service::self_reporting::audit;
#[cfg(feature = "enterprise")]
use crate::{common::utils::jwt::verify_decode_token, handler::http::auth::jwt::process_token};

#[cfg(feature = "enterprise")]
#[post("/token")]
pub async fn exchange_token(
    req: HttpRequest,
    body: web::Json<o2_dex::meta::auth::TokenExchangeRequest>,
) -> Result<HttpResponse, Error> {
    let result = o2_dex::service::token_exchange::exchange_token(&body.into_inner()).await;

    let mut audit_message = AuditMessage {
        user_email: "".to_string(),
        org_id: "".to_string(),
        _timestamp: chrono::Utc::now().timestamp_micros(),
        protocol: Protocol::Http(HttpMeta {
            method: req.method().to_string(),
            path: req.path().to_string(),
            body: "".to_string(),
            query_params: req.query_string().to_string(),
            response_code: 200,
        }),
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
            )
            .await;
            match token_ver {
                Ok(res) => {
                    audit_message.user_email = res.0.user_email.clone();
                    process_token(res).await
                }
                Err(e) => {
                    if let Protocol::Http(http_meta) = &mut audit_message.protocol {
                        http_meta.response_code = 401;
                    }
                    audit_message._timestamp = chrono::Utc::now().timestamp_micros();
                    audit(audit_message).await;
                    return Ok(HttpResponse::Unauthorized().json(e.to_string()));
                }
            }
            audit_message._timestamp = chrono::Utc::now().timestamp_micros();
            audit(audit_message).await;
            Ok(HttpResponse::Ok().json(response))
        }
        Err(e) => {
            log::error!("Error: {}", e);
            if let Protocol::Http(http_meta) = &mut audit_message.protocol {
                http_meta.response_code = 401;
            }
            audit_message._timestamp = chrono::Utc::now().timestamp_micros();
            audit(audit_message).await;
            Ok(HttpResponse::Unauthorized().json(e.to_string()))
        }
    }
}

#[cfg(not(feature = "enterprise"))]
#[post("/token")]
pub async fn exchange_token(
    _req: HttpRequest,
    _body: web::Json<String>,
) -> Result<HttpResponse, Error> {
    use actix_web::error::ErrorForbidden;
    Err(ErrorForbidden("Not allowed"))
}
