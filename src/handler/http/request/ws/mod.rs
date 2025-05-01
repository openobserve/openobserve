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

pub mod session;

use std::sync::Arc;

use actix_web::{Error, HttpRequest, HttpResponse, get, web};
use config::{cluster::LOCAL_NODE, get_config};
use tokio::sync::RwLock;

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::extract_auth_expiry_and_user_id;
use crate::{
    handler::http::request::ws::session::WsSession, service::websocket_events::sessions_cache_utils,
};

#[get("{org_id}/ws/v2/{router_id}")]
pub async fn websocket(
    path_params: web::Path<(String, String)>,
    req: HttpRequest,
    stream: web::Payload,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let cfg = get_config();

    if !cfg.websocket.enabled {
        log::info!(
            "[WS_HANDLER]: Node Role: {} Websocket is disabled",
            cfg.common.node_role
        );
        return Ok(HttpResponse::NotFound().body("WebSocket is disabled"));
    }

    let (_, router_id) = path_params.into_inner();

    let prefix = format!("{}/api/", get_config().common.base_uri);
    let path = req.path().strip_prefix(&prefix).unwrap().to_string();

    let user_id = in_req
        .headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    #[cfg(feature = "enterprise")]
    let cookie_expiry = if cfg.common.local_mode {
        let (cookie_expiry, _) = extract_auth_expiry_and_user_id(&req).await;
        cookie_expiry.map(|expiry| expiry.timestamp_micros())
    } else {
        None
    };

    #[cfg(not(feature = "enterprise"))]
    let cookie_expiry = None;

    let (res, session, msg_stream) = actix_ws::handle(&req, stream)?;

    // increase the maximum allowed frame size to 1MB actix-ws and
    // aggregate continuation frames
    let msg_stream = msg_stream
        .max_frame_size(cfg.websocket.max_frame_size * 1024 * 1024)
        .aggregate_continuations()
        .max_continuation_size(cfg.websocket.max_continuation_size * 1024 * 1024);

    let ws_session = WsSession::new(session, cookie_expiry);
    sessions_cache_utils::insert_session(&router_id, Arc::new(RwLock::new(ws_session))).await;
    log::info!(
        "[WS_HANDLER]: Node Role: {} Got websocket request for router_id: {}, querier: {}",
        cfg.common.node_role,
        router_id,
        cfg.common.instance_name
    );

    // Spawn the handler
    actix_web::rt::spawn(session::run(msg_stream, user_id, router_id.clone(), path));

    // Spawn the health check task
    tokio::spawn(session::health_check(router_id));

    Ok(res)
}

/// Initialize the job init for websocket
pub async fn init() -> Result<(), anyhow::Error> {
    // Run the garbage collector for websocket sessions
    if LOCAL_NODE.is_querier() {
        sessions_cache_utils::run_gc_ws_sessions().await;
    }
    Ok(())
}
