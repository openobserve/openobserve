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

use config::RwAHashMap;

use super::{
    connection::{Connection, QuerierConnection},
    error::*,
    get_ws_handler,
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
        let r = self.connections.read().await;
        if let Some(conn) = r.get(querier_name) {
            log::info!(
                "[WS::ConnectionPool] returning existing connection to querier {querier_name}"
            );
            let conn = conn.clone();
            drop(r);
            return Ok(conn);
        }
        drop(r);

        // Create new connection
        let conn = super::connection::create_connection(querier_name).await?;

        let mut w = self.connections.write().await;
        w.insert(querier_name.to_string(), conn.clone());
        drop(w);

        log::info!("[WS::ConnectionPool] created new connection to querier {querier_name}");
        Ok(conn)
    }

    pub async fn remove_querier_connection(&self, querier_name: &str) {
        let mut w = self.connections.write().await;
        let conn = w.remove(querier_name);
        drop(w);
        if let Some(conn) = conn {
            log::warn!("[WS::ConnectionPool] removing connection to querier {querier_name}");
            conn.disconnect().await;
        }
    }

    pub async fn _shutdown(&self) {
        let mut writer_guard = self.connections.write().await;
        let conns = writer_guard.drain().collect::<Vec<_>>();
        drop(writer_guard);
        for (querier_name, conn) in conns {
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
        let conn = read_guard.get(querier_name).cloned();
        drop(read_guard);
        conn
    }

    pub async fn clean_up(querier_name: &QuerierName) {
        let ws_handler = get_ws_handler().await;
        ws_handler
            .connection_pool
            .remove_querier_connection(querier_name)
            .await;
    }

    pub async fn _print_all_connections(helper_txt: &str) {
        let ws_handler = get_ws_handler().await;
        let ws_handler_clone = ws_handler.clone();
        let r = ws_handler_clone.connection_pool.connections.read().await;
        let conns = r
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect::<Vec<_>>();
        drop(r);
        for (querier_name, _) in conns {
            log::info!("[WS::ConnectionPool]   {helper_txt}: {querier_name}");
        }
    }
}
