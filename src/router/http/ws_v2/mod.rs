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

use config::WsConfig;
use handler::WsHandler;
use once_cell::sync::OnceCell;
use pool::QuerierConnectionPool;
use session::SessionManager;

mod config;
mod connection;
mod error;
mod handler;
mod pool;
mod session;
mod types;

// Initialize WsHandler global instance
static WS_HANDLER: OnceCell<Arc<WsHandler>> = OnceCell::new();

// Helper function to get or initialize the WsHandler
pub async fn get_ws_handler() -> Arc<WsHandler> {
    if let Some(handler) = WS_HANDLER.get() {
        return handler.clone();
    }

    // Initialize if not already done
    let handler = init().await;

    // This may fail if another thread initialized it first, which is fine
    let _ = WS_HANDLER.set(handler.clone());

    handler
}

pub async fn remove_querier_from_handler(querier_name: &String) {
    get_ws_handler()
        .await
        .remove_querier_connection(querier_name)
        .await;
}

async fn init() -> Arc<WsHandler> {
    let config = WsConfig::default();
    let session_manager = Arc::new(SessionManager::default());
    let connection_pool = Arc::new(QuerierConnectionPool::new(config));
    let handler = Arc::new(WsHandler::new(session_manager, connection_pool.clone()));

    // Start connection maintenance task
    tokio::spawn(async move {
        connection_pool.maintain_connections().await;
    });

    handler
}
