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
    async fn receive_message(&self) -> WsResult<Option<Message>>;
}

pub struct QuerierConnection {
    pub querier_name: QuerierName,
    pub write: Arc<Mutex<SplitSink<WsStreamType, tungstenite::protocol::Message>>>,
    pub last_active: std::sync::atomic::AtomicI64,
}

impl QuerierConnection {
    pub async fn establish_connection(
        querier_name: QuerierName,
        url: String,
        response_tx: Sender<Message>,
    ) -> WsResult<Arc<Self>> {
        let (ws_stream, response) = connect_async(&url)
            .await
            .map_err(|e| WsError::ConnectionError(e.to_string()))?;

        let (write, mut read) = ws_stream.split();

        // Spawn task for listening to querier
        // TODO: maybe this handler needs to be included in struct and waited?
        let listen_handler = tokio::spawn(async move {
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(msg) => {
                        // forward back to thread that's handling conn between router and client
                        // directly forwarding the same `Message` type. client handles the parse
                        response_tx.send(msg.into());
                    }
                    Err(e) => {
                        // TODO: error handling
                    }
                }
            }
        });

        let conn = Self {
            querier_name,
            write: Arc::new(Mutex::new(write)),
            last_active: std::sync::atomic::AtomicI64::new(chrono::Utc::now().timestamp_micros()),
        };
        conn.connect().await?;

        Ok(Arc::new(conn))
    }

    // pub async fn new(querier_name: QuerierName, url: String) -> WsResult<Self> {
    //     let conn = Self {
    //         querier_name,
    //         stream: Arc::new(Mutex::new(None)),
    //         last_active:
    // std::sync::atomic::AtomicI64::new(chrono::Utc::now().timestamp_micros()),     };
    //     conn.connect().await?;
    //     Ok(conn)
    // }

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
        let mut stream_guard = self.stream.lock().await;
        if stream_guard.is_none() {
            let (ws_stream, _) = connect_async(&self.url)
                .await
                .map_err(|e| WsError::ConnectionError(e.to_string()))?;
            let (write, read) = ws_stream.split();
            *stream_guard = Some(ws_stream);
        }
        Ok(())
    }

    async fn disconnect(&self) -> WsResult<()> {
        let mut stream_guard = self.stream.lock().await;
        if let Some(stream) = stream_guard.as_mut() {
            stream
                .close(None)
                .await
                .map_err(|e| WsError::ConnectionError(e.to_string()))?;
            *stream_guard = None;
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

    // fn get_name(&self) -> &QuerierName {
    //     &self.name
    // }

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
