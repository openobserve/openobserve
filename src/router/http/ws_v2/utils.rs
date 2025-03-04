use actix_ws::Message;
use tokio_tungstenite::tungstenite;

/// Convert tungstenite WebSocket message to actix-web message format
pub fn from_tungstenite_msg_to_actix_msg(msg: tungstenite::protocol::Message) -> Message {
    match msg {
        tungstenite::protocol::Message::Text(text) => {
            log_frame_details("Converting Text ->", &text, false);
            Message::Text(text.into())
        }
        tungstenite::protocol::Message::Binary(bin) => Message::Binary(bin.into()),
        tungstenite::protocol::Message::Ping(msg) => Message::Ping(msg.into()),
        tungstenite::protocol::Message::Pong(msg) => Message::Pong(msg.into()),
        tungstenite::protocol::Message::Close(reason) => {
            if let Some(r) = &reason {
                log_frame_details("Converting Close ->", &r.reason, true);
            }
            Message::Close(reason.map(|r| actix_ws::CloseReason {
                code: u16::from(r.code).into(),
                description: if r.reason.is_empty() {
                    None
                } else {
                    Some(r.reason.to_string())
                },
            }))
        }
        _ => {
            log::info!("[WS_PROXY] Unsupported message type {:?}", msg);
            Message::Close(None)
        }
    }
}

/// Convert actix-web WebSocket message to tungstenite message format
pub fn from_actix_message(msg: Message) -> tungstenite::protocol::Message {
    match msg {
        Message::Text(text) => tungstenite::protocol::Message::Text(text.to_string()),
        Message::Binary(bin) => tungstenite::protocol::Message::Binary(bin.to_vec()),
        Message::Ping(msg) => tungstenite::protocol::Message::Ping(msg.to_vec()),
        Message::Pong(msg) => tungstenite::protocol::Message::Pong(msg.to_vec()),
        Message::Close(reason) => {
            log::info!(
                "[WS_PROXY] Received a Message::Close with reason: {:#?}, closing connection to proxied server",
                reason
            );
            tungstenite::protocol::Message::Close(reason.map(|r| {
                tungstenite::protocol::CloseFrame {
                    code: u16::from(r.code).into(),
                    reason: r.description.unwrap_or_default().into(),
                }
            }))
        }
        _ => {
            log::info!("[WS_PROXY] Unsupported message type {:?}", msg);
            tungstenite::protocol::Message::Close(None)
        }
    }
}

/// Add this helper function
pub fn log_frame_details(prefix: &str, text: &str, is_close: bool) {
    // 7b is '{' in JSON
    log::debug!(
        "[WS_FRAME] {} Length: {}, First 50 bytes: {}, Is close: {}",
        prefix,
        text.len(),
        hex::encode(&text.as_bytes()[..std::cmp::min(50, text.len())]),
        is_close
    );
}

// Add helper function to debug frame details
pub fn debug_ws_message(prefix: &str, msg: &Message) {
    match msg {
        Message::Text(text) => {
            log::debug!(
                "[WS_PROXY] {} Text frame: len={}, content_start='{}'",
                prefix,
                text.len(),
                &text[..text.len().min(50)]
            );
        }
        Message::Close(reason) => {
            if let Some(r) = reason {
                log::debug!(
                    "[WS_PROXY] {} Close frame: code={:?}, desc={:?}, desc_len={}",
                    prefix,
                    r.code,
                    r.description,
                    r.description.as_ref().map(|d| d.len()).unwrap_or(0)
                );
            } else {
                log::debug!("[WS_PROXY] {} Close frame: no reason", prefix);
            }
        }
        _ => log::debug!("[WS_PROXY] {} Other frame type: {:?}", prefix, msg),
    }
}