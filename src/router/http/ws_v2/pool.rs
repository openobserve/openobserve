use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::Mutex;

use super::{
    config::*,
    connection::{Connection, QuerierConnection},
    error::*,
    types::*,
};
use crate::common::infra::cluster;

pub struct QuerierConnectionPool {
    connections: DashMap<QuerierId, Arc<QuerierConnection>>,
    config: WsConfig,
}

impl QuerierConnectionPool {
    pub fn new(config: WsConfig) -> Self {
        Self {
            connections: DashMap::new(),
            config,
        }
    }

    pub async fn get_connection(&self, querier_id: &QuerierId) -> WsResult<Arc<QuerierConnection>> {
        if let Some(conn) = self.connections.get(querier_id) {
            return Ok(conn.clone());
        }

        // Create new connection
        let conn = self.create_connection(querier_id).await?;
        self.connections.insert(querier_id.clone(), conn.clone());
        Ok(conn)
    }

    async fn create_connection(&self, querier_id: &QuerierId) -> WsResult<Arc<QuerierConnection>> {
        // Get querier info from cluster
        let node = cluster::get_cached_node_by_name(querier_id)
            .await
            .ok_or_else(|| WsError::QuerierNotAvailable(querier_id.clone()))?;

        // Convert HTTP URL to WebSocket URL
        let ws_url = crate::router::http::ws::convert_to_websocket_url(&node.http_addr)
            .map_err(|e| WsError::ConnectionError(e))?;

        let conn = QuerierConnection::new(querier_id.clone(), ws_url).await?;
        Ok(Arc::new(conn))
    }

    pub async fn remove_connection(&self, querier_id: &QuerierId) -> WsResult<()> {
        if let Some((_, conn)) = self.connections.remove(querier_id) {
            conn.disconnect().await?;
        }
        Ok(())
    }

    pub async fn maintain_connections(&self) {
        loop {
            for conn_ref in self.connections.iter() {
                let conn = conn_ref.value();
                if !conn.is_connected().await {
                    if let Err(e) = conn.connect().await {
                        log::error!("Failed to reconnect to querier {}: {}", conn.get_id(), e);
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(
                self.config.health_check_config.interval_secs,
            ))
            .await;
        }
    }
}
