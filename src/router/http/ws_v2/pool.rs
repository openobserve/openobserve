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

use std::sync::Arc;

use config::{RwAHashMap, get_config};

use super::{
    connection::{Connection, QuerierConnection},
    error::*,
    handler::QuerierName,
};

#[derive(Debug)]
pub struct QuerierConnectionPool {
    connections: RwAHashMap<QuerierName, Arc<QuerierConnection>>,
}

impl QuerierConnectionPool {
    pub fn new() -> Self {
        Self {
            connections: RwAHashMap::default(),
        }
    }

    pub async fn get_or_create_connection(
        &self,
        querier_name: &QuerierName,
    ) -> WsResult<Arc<QuerierConnection>> {
        if let Some(conn) = self.connections.read().await.get(querier_name) {
            // double check if the connection is still connected
            return if conn.is_connected().await {
                Ok(conn.clone())
            } else {
                log::error!("[WS::ConnectionPool] connection to querier {querier_name} is disconnected.");
                Err(WsError::ConnectionDisconnected)
            };
        }

        // Create new connection
        let conn = super::connection::create_connection(querier_name).await?;
        self.connections
            .write()
            .await
            .insert(querier_name.to_string(), conn.clone());
        Ok(conn)
    }

    pub async fn remove_querier_connection(&self, querier_name: &str) {
        if let Some(conn) = self.connections.write().await.remove(querier_name) {
            log::warn!("[WS::ConnectionPool] removing connection to querier {querier_name}");
            conn.disconnect().await;
        }
    }

    pub async fn maintain_connections(&self) {
        let cfg = get_config();
        loop {
            let mut to_remove = Vec::new();

            let read_guard = self.connections.read().await;
            for (querier_name, conn) in read_guard.iter() {
                if !conn.is_connected().await {
                    // Just drop it. A new connection will be made to the querier when chosen again
                    to_remove.push(querier_name.clone());
                }
            }
            drop(read_guard);

            // Remove connections that failed to reconnect
            for querier in to_remove {
                log::warn!(
                    "[WS::ConnectionPool] Removing disconnected connection to querier: {}",
                    querier
                );
                self.remove_querier_connection(&querier).await;
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(
                cfg.websocket.health_check_interval as _,
            ))
            .await;
        }
    }

    pub async fn _shutdown(&self) {
        let mut writer_guard = self.connections.write().await;
        for (querier_name, conn) in writer_guard.drain() {
            log::warn!(
                "[WS::ConnectionPool] error disconnect connection to querier {querier_name} as it's still in use. Force remove."
            );
            conn.disconnect().await;
        }
    }

    pub async fn get_active_connection(
        &self,
        querier_name: &QuerierName,
    ) -> Option<Arc<QuerierConnection>> {
        let read_guard = self.connections.read().await;
        read_guard.get(querier_name).cloned()
    }
}
