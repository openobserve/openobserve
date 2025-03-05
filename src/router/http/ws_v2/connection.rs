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

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use async_trait::async_trait;
use config::utils::json;
use futures_util::{SinkExt, StreamExt, stream::SplitSink};
use tokio::{
    net::TcpStream,
    sync::{
        Mutex,
        mpsc::{Sender, channel},
    },
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{self, protocol::Message as WsMessage},
};

use crate::router::http::ws_v2::{error::*, types::*};

type WsStreamType = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[async_trait]
pub trait Connection: Send + Sync {
    async fn connect(&self) -> WsResult<()>;
    async fn disconnect(&self);
    async fn send_message(&self, message: Message) -> WsResult<()>;
    async fn is_connected(&self) -> bool;
    fn get_name(&self) -> &QuerierName;
}

pub struct QuerierConnection {
    querier_name: QuerierName,
    url: String,
    write: Arc<Mutex<Option<SplitSink<WsStreamType, WsMessage>>>>,
    shutdown_tx: Sender<()>,
    is_connected: Arc<AtomicBool>,
    last_active: std::sync::atomic::AtomicI64,
}

impl QuerierConnection {
    pub async fn establish_connection(
        querier_name: QuerierName,
        url: String,
        response_tx: Sender<Message>,
    ) -> WsResult<Arc<Self>> {
        // Connect to querier
        let (ws_stream, _) = connect_async(&url)
            .await
            .map_err(|e| WsError::ConnectionError(e.to_string()))?;
        let (write, mut read) = ws_stream.split();
        let write = Arc::new(Mutex::new(Some(write)));

        // Signal to shutdown
        let (shutdown_tx, mut shutdown_rx) = channel::<()>(1);

        let is_connected = Arc::new(AtomicBool::new(true));
        let is_connected_health_task = is_connected.clone();

        let conn = Arc::new(Self {
            querier_name,
            url,
            write: write.clone(),
            shutdown_tx,
            is_connected: is_connected.clone(),
            last_active: std::sync::atomic::AtomicI64::new(chrono::Utc::now().timestamp_micros()),
        });

        // Spawn read handler
        // Router -> Querier connection
        // Task to receive messages from the querier
        tokio::spawn(async move {
            tokio::select! {
                Some(msg) = read.next() => {
                    match msg {
                        Ok(msg) => {
                            // Send the message to mpsc channel to be sent to the client
                            if let Err(e) = response_tx.send(msg.into()).await {
                                log::error!("[WS] Failed to forward message: {}", e);
                                // TODO: cleanup resource
                            }
                        }
                        Err(e) => {
                            log::error!("[WS] Read error: {}", e);
                            // mark the connection disconnected
                            is_connected.store(false, Ordering::SeqCst);
                            // TODO: cleanup resource
                        }
                    }
                }
                _ = shutdown_rx.recv() => {
                    log::info!("[WS::QuerierConnection] shutting down. Stop listening from the querier");
                    // mark the connection disconnected
                    is_connected.store(false, Ordering::SeqCst);
                    // TODO: cleanup resource?
                }
            }
        });

        // Spawn health check task
        tokio::spawn(async move {
            // TODO: configurable duration interval
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));

            loop {
                interval.tick().await;
                let mut write_guard = write.lock().await;
                match write_guard.as_mut() {
                    None => {
                        is_connected_health_task.store(false, Ordering::SeqCst);
                        break;
                    }
                    Some(w) => {
                        if w.send(WsMessage::Ping(vec![])).await.is_err() {
                            is_connected_health_task.store(false, Ordering::SeqCst);
                            break;
                        }
                    }
                }
            }

            log::warn!(
                "[WS:QuerierConnection] connection health check failed, marked disconnected"
            );
        });

        Ok(conn)
    }

    // async fn

    fn update_last_active(&self) {
        self.last_active.store(
            chrono::Utc::now().timestamp_micros(),
            std::sync::atomic::Ordering::SeqCst,
        );
    }
}

// need protocol exchange from our Message -> tungstenite::protocol::Message
impl From<Message> for tungstenite::protocol::Message {
    fn from(value: Message) -> Self {
        tungstenite::protocol::Message::Text("TODO".to_string());
        todo!("protocol exchange needed")
    }
}

impl From<tungstenite::protocol::Message> for Message {
    fn from(value: tungstenite::protocol::Message) -> Self {
        Message::new(
            "trace_id".to_string(),
            MessageType::SearchResponse,
            json::Value::default(),
        );
        todo!("protocol exchange needed")
    }
}

#[async_trait]
impl Connection for QuerierConnection {
    async fn connect(&self) -> WsResult<()> {
        let mut write_guard = self.write.lock().await;
        if write_guard.is_none() {
            let (ws_stream, _) = connect_async(&self.url)
                .await
                .map_err(|e| WsError::ConnectionError(e.to_string()))?;
            let (write, _) = ws_stream.split();
            *write_guard = Some(write);
        }
        Ok(())
    }

    async fn disconnect(&self) {
        let mut write_guard = self.write.lock().await;
        if let Some(write) = write_guard.as_mut() {
            // TODO: when closing a websocket connection, is it okay to just close the sink side of
            // the connection? or we need to send close frame?

            // no need to concern/handle close error since it's being removed
            _ = write.close().await;
            *write_guard = None;
        }
        _ = self.shutdown_tx.send(()).await;
    }

    async fn send_message(&self, message: Message) -> WsResult<()> {
        let mut write_guard = self.write.lock().await;
        if let Some(write) = write_guard.as_mut() {
            let trace_id = message.trace_id.clone();
            match write.send(message.into()).await {
                Ok(_) => {
                    log::debug!(
                        "[WS:QuerierConnection] request w/ trace_id {} successfully forwarded to querier {}",
                        trace_id,
                        self.querier_name
                    );
                    self.update_last_active();
                    Ok(())
                }
                Err(e) => {
                    log::error!(
                        "[WS::QuerierConnection] error sending messages via connection {e}. Mark the connection disconnected"
                    );
                    self.is_connected.store(false, Ordering::SeqCst);
                    Err(WsError::ConnectionError(format!(
                        "[WS::QuerierConnection] error sending messages via connection {e}"
                    )))
                }
            }
        } else {
            Err(WsError::ConnectionError("Not connected".into()))
        }
    }

    async fn is_connected(&self) -> bool {
        self.is_connected.load(Ordering::SeqCst) && self.write.lock().await.is_some()
    }

    fn get_name(&self) -> &QuerierName {
        &self.querier_name
    }
}
