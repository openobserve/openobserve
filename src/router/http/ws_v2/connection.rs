use std::sync::Arc;

use async_trait::async_trait;
use config::utils::json;
use futures_util::{SinkExt, StreamExt, stream::SplitSink};
use tokio::{
    net::TcpStream,
    sync::{Mutex, mpsc::Sender},
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
    async fn disconnect(&self) -> WsResult<()>;
    async fn send_message(&self, message: Message) -> WsResult<()>;
    async fn is_connected(&self) -> bool;
    fn get_name(&self) -> &QuerierName;
}

pub struct QuerierConnection {
    querier_name: QuerierName,
    url: String,
    write: Arc<Mutex<Option<SplitSink<WsStreamType, WsMessage>>>>,
    last_active: std::sync::atomic::AtomicI64,
}

impl QuerierConnection {
    pub async fn establish_connection(
        querier_name: QuerierName,
        url: String,
        response_tx: Sender<Message>,
    ) -> WsResult<Arc<Self>> {
        let (ws_stream, _) = connect_async(&url)
            .await
            .map_err(|e| WsError::ConnectionError(e.to_string()))?;

        let (write, mut read) = ws_stream.split();

        // Spawn read handler
        tokio::spawn(async move {
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(msg) => {
                        if let Ok(message) = Message::try_from(msg) {
                            if let Err(e) = response_tx.send(message).await {
                                log::error!("[WS] Failed to forward message: {}", e);
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("[WS] Read error: {}", e);
                        break;
                    }
                }
            }
            log::info!("[WS] Read loop ended");
        });

        let conn = Arc::new(Self {
            querier_name,
            url,
            write: Arc::new(Mutex::new(Some(write))),
            last_active: std::sync::atomic::AtomicI64::new(chrono::Utc::now().timestamp_micros()),
        });

        Ok(conn)
    }

    fn update_last_active(&self) {
        self.last_active.store(
            chrono::Utc::now().timestamp_micros(),
            std::sync::atomic::Ordering::SeqCst,
        );
    }

    pub async fn is_connected(&self) -> bool {
        let write_guard = self.write.lock().await;
        write_guard.is_some()
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

    async fn disconnect(&self) -> WsResult<()> {
        let mut write_guard = self.write.lock().await;
        if let Some(write) = write_guard.as_mut() {
            write
                .close()
                .await
                .map_err(|e| WsError::ConnectionError(e.to_string()))?;
            *write_guard = None;
        }
        Ok(())
    }

    async fn send_message(&self, message: Message) -> WsResult<()> {
        let mut write_guard = self.write.lock().await;
        if let Some(write) = write_guard.as_mut() {
            let ws_message =
                WsMessage::try_from(message).map_err(|e| WsError::MessageError(e.to_string()))?;
            write
                .send(ws_message)
                .await
                .map_err(|e| WsError::MessageError(e.to_string()))?;
            self.update_last_active();
            Ok(())
        } else {
            Err(WsError::ConnectionError("Not connected".into()))
        }
    }

    async fn is_connected(&self) -> bool {
        self.is_connected().await
    }

    fn get_name(&self) -> &QuerierName {
        &self.querier_name
    }
}
