pub mod session;

use actix_web::{Error, HttpRequest, HttpResponse, get, web};
use config::{cluster::LOCAL_NODE, get_config};

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::extract_auth_expiry_and_user_id;
use crate::{
    handler::http::request::ws_v2::session::WsSession,
    service::websocket_events::sessions_cache_utils,
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
    let cookie_expiry = if cfg.websocket.check_cookie_expiry && cfg.common.local_mode {
        let (cookie_expiry, _) = extract_auth_expiry_and_user_id(&req).await;
        cookie_expiry.map(|expiry| expiry.timestamp_micros())
    } else {
        None
    };

    #[cfg(not(feature = "enterprise"))]
    let cookie_expiry = None;

    let (res, session, msg_stream) = actix_ws::handle(&req, stream)?;

    let ws_session = WsSession::new(session, cookie_expiry);
    sessions_cache_utils::insert_session(&router_id, ws_session);
    log::info!(
        "[WS_HANDLER]: Node Role: {} Got websocket request for router_id: {}",
        cfg.common.node_role,
        router_id,
    );

    // Spawn the handler
    actix_web::rt::spawn(session::run(msg_stream, user_id, router_id, path));

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
