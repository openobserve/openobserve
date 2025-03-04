use std::sync::Arc;

use async_trait::async_trait;
use futures::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use tokio::{
    net::TcpStream,
    sync::{Mutex, mpsc},
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async, tungstenite::protocol::Message as WsMessage,
};

use crate::router::http::ws_v2::{error::*, types::*, utils::from_tungstenite_msg_to_actix_msg};

type WsStreamType = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[async_trait]
pub trait Connection: Send + Sync {
    async fn connect(&self) -> WsResult<()>;
    async fn disconnect(&self) -> WsResult<()>;
    async fn receive_messages(&self, sender: &mut mpsc::Sender<Message>) -> WsResult<()>;
    async fn send_message(&self, message: Message) -> WsResult<()>;
    async fn is_connected(&self) -> bool;
    async fn receive_message(&self) -> WsResult<Option<Message>>;
    fn get_name(&self) -> &QuerierName;
}

pub struct QuerierConnection {
    name: QuerierName,
    r2q_sink: Arc<Mutex<Option<SplitSink<WsStreamType, WsMessage>>>>,
    r2q_stream: Arc<Mutex<Option<SplitStream<WsStreamType>>>>,
    url: String,
    last_active: std::sync::atomic::AtomicI64,
}

impl QuerierConnection {
    pub async fn new(name: QuerierName, url: String) -> WsResult<Self> {
        let conn = Self {
            name,
            r2q_sink: Arc::new(Mutex::new(None)),
            r2q_stream: Arc::new(Mutex::new(None)),
            url,
            last_active: std::sync::atomic::AtomicI64::new(chrono::Utc::now().timestamp_micros()),
        };
        conn.connect().await?;
        Ok(conn)
    }

    fn update_last_active(&self) {
        self.last_active.store(
            chrono::Utc::now().timestamp_micros(),
            std::sync::atomic::Ordering::SeqCst,
        );
    }

    pub fn get_name(&self) -> QuerierName {
        self.name.clone()
    }
}

#[async_trait]
impl Connection for QuerierConnection {
    async fn connect(&self) -> WsResult<()> {
        let (ws_stream, _) = connect_async(&self.url)
            .await
            .map_err(|e| WsError::ConnectionError(e.to_string()))?;
        let (r2q_sink, r2q_stream) = ws_stream.split();
        *self.r2q_sink.lock().await = Some(r2q_sink);
        *self.r2q_stream.lock().await = Some(r2q_stream);
        Ok(())
    }

    async fn disconnect(&self) -> WsResult<()> {
        let mut r2q_sink_guard = self.r2q_sink.lock().await;
        let mut r2q_stream_guard = self.r2q_stream.lock().await;
        if let Some(sink) = r2q_sink_guard.as_mut() {
            sink.close()
                .await
                .map_err(|e| WsError::ConnectionError(e.to_string()))?;
            *r2q_sink_guard = None;
        }
        if let Some(stream) = r2q_stream_guard.as_mut() {
            stream
                .close()
                .await
                .map_err(|e| WsError::ConnectionError(e.to_string()))?;
            *r2q_stream_guard = None;
        }
        Ok(())
    }

    async fn receive_messages(&self, sender: &mut mpsc::Sender<Message>) -> WsResult<()> {
        let r2q_stream = Arc::clone(&self.r2q_stream);
        let sender = sender.clone();
        let r2q_task = tokio::spawn(async move {
            let mut r2q = r2q_stream.lock().await;
            if let Some(r2q) = r2q.as_mut() {
                while let Some(msg_result) = r2q.next().await {
                    match msg_result {
                        Ok(msg) => {
                            // FIXME: implement from_tungstenite_msg_to_actix_msg
                            let msg = from_tungstenite_msg_to_actix_msg(msg);
                            let msg = match Message::from_server_event_actix_msg(msg) {
                                Some(msg) => msg,
                                None => continue,
                            };
                            if let Err(e) = sender.send(msg).await {
                                log::error!("[WS_PROXY] Error sending message to client: {:?}", e);
                                break;
                            }
                        }
                        Err(e) => {
                            log::error!("[WS_PROXY] Backend error: {:?}", e);
                            break;
                        }
                    }
                }
            }
            log::info!("[WS_PROXY] Backend->Client task completed");
        });

        let (task_result,) = tokio::join!(r2q_task);

        if let Err(e) = task_result {
            log::error!("Error receiving messages from querier: {}", e);
        }

        Ok(())
    }

    async fn send_message(&self, message: Message) -> WsResult<()> {
        let mut stream_guard = self.stream.lock().await;
        if let Some(stream) = stream_guard.as_mut() {
            let ws_message = WsMessage::Text(
                serde_json::to_string(&message)
                    .map_err(|e| WsError::MessageError(e.to_string()))?,
            );
            stream
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
        let stream_guard = self.stream.lock().await;
        stream_guard.is_some()
    }

    fn get_name(&self) -> &QuerierName {
        &self.name
    }

    async fn receive_message(&self) -> WsResult<Option<Message>> {
        let mut stream_guard = self.stream.lock().await;
        if let Some(stream) = stream_guard.as_mut() {
            match stream.next().await {
                Some(Ok(WsMessage::Text(text))) => serde_json::from_str(&text)
                    .map(Some)
                    .map_err(|e| WsError::MessageError(e.to_string())),
                Some(Ok(WsMessage::Close(_))) => Ok(None),
                Some(Err(e)) => Err(WsError::MessageError(e.to_string())),
                _ => Ok(None),
            }
        } else {
            Err(WsError::ConnectionError("Not connected".into()))
        }
    }
}
