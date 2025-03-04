use std::sync::Arc;

use config::RwAHashMap;
use tokio::sync::mpsc::Sender;

use super::{
    config::*,
    connection::{Connection, QuerierConnection},
    error::*,
    types::*,
};
use crate::common::infra::cluster;

pub struct QuerierConnectionPool {
    connections: RwAHashMap<QuerierName, Arc<QuerierConnection>>,
    config: WsConfig,
}

impl QuerierConnectionPool {
    pub fn new(config: WsConfig) -> Self {
        Self {
            connections: RwAHashMap::default(),
            config,
        }
    }

    // pub async fn establish_connection(&self) -> WsResult<Arc<>>/

    pub async fn get_or_create_connection(
        &self,
        querier_name: &QuerierName,
        response_tx: &Sender<Message>,
    ) -> WsResult<Arc<QuerierConnection>> {
        if let Some(conn) = self.connections.read().await.get(querier_name) {
            return Ok(conn.clone());
        }

        // Create new connection
        let conn = self.create_connection(querier_name, response_tx).await?;
        self.connections
            .write()
            .await
            .insert(querier_name.to_string(), conn.clone());
        Ok(conn)
    }

    async fn create_connection(
        &self,
        querier_name: &QuerierName,
        response_tx: &Sender<Message>,
    ) -> WsResult<Arc<QuerierConnection>> {
        // Get querier info from cluster
        let node = cluster::get_cached_node_by_name(querier_name)
            .await
            .ok_or_else(|| WsError::QuerierNotAvailable(querier_name.clone()))?;

        // Convert HTTP URL to WebSocket URL
        let ws_url = crate::router::http::ws::convert_to_websocket_url(&node.http_addr)
            .map_err(|e| WsError::ConnectionError(e))?;

        let conn = QuerierConnection::establish_connection(
            querier_name.clone(),
            ws_url,
            response_tx.clone(),
        )
        .await?;
        Ok(conn)
    }

    pub async fn remove_connection(&self, querier_name: &QuerierName) -> WsResult<()> {
        if let Some(conn) = self.connections.write().await.remove(querier_name) {
            conn.disconnect().await?;
        }
        Ok(())
    }

    pub async fn maintain_connections(&self) {
        loop {
            let mut to_remove = Vec::new();

            let read_guard = self.connections.read().await;
            for (querier_name, conn) in read_guard.iter() {
                if !conn.is_connected().await {
                    // Try to reconnect
                    if let Err(e) = conn.connect().await {
                        log::error!("Failed to reconnect to querier {}: {}", conn.get_name(), e);
                        to_remove.push(querier_name.clone());
                    }
                }
            }
            drop(read_guard);

            // Remove connections that failed to reconnect
            for querier in to_remove {
                log::warn!("Removing disconnected connection to querier: {}", querier);
                if let Err(e) = self.remove_connection(&querier).await {
                    log::error!(
                        "[WS::ConnectionPoll]: failed to remove disconnected connection to querier {} caused by: {}",
                        querier,
                        e
                    );
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(
                self.config.health_check_config.interval_secs,
            ))
            .await;
        }
    }
}
