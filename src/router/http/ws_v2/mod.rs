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

//! WebSocket v2 Implementation for Router-Querier Communication
//!
//! This module implements a WebSocket-based communication system between clients, routers, and
//! queriers. It provides connection pooling, session management, and reliable message routing.
//!
//! # Architecture
//!
//! The system consists of several key components:
//!
//! * `WsHandler`: Main handler for client WebSocket connections
//! * `QuerierConnectionPool`: Manages persistent WebSocket connections to querier nodes
//! * `SessionManager`: Tracks client sessions and their querier mappings
//! * `QuerierConnection`: Handles individual WebSocket connections to querier nodes
//!
//! # Flow
//!
//! 1. Client establishes WebSocket connection with Router
//! 2. Router creates session and validates authentication
//! 3. Client sends requests with trace_ids
//! 4. Router maps trace_ids to querier nodes using consistent hashing
//! 5. Router maintains persistent connections to queriers
//! 6. Responses are routed back to clients using trace_ids
//!
//! # Features
//!
//! * Connection pooling for querier connections
//! * Session management with idle timeout
//! * Health checking of querier connections
//! * Graceful session draining on disconnects
//! * Request/response routing using trace_ids
//! * Support for enterprise authentication
//!
//! # Components
//!
//! ## Handler
//! Handles the main WebSocket lifecycle and message routing
//!
//! ## Connection Pool
//! Maintains and reuses WebSocket connections to querier nodes
//!
//! ## Session Manager
//! Tracks client sessions, querier mappings, and handles cleanup
//!
//! ## Connection
//! Implements the low-level WebSocket connection handling

use std::sync::Arc;

use handler::WsHandler;
use once_cell::sync::OnceCell;
use pool::QuerierConnectionPool;
use session::SessionManager;

mod connection;
mod error;
mod handler;
mod pool;
mod session;

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

pub async fn remove_querier_from_handler(querier_name: &str) {
    get_ws_handler()
        .await
        .remove_querier_connection(querier_name)
        .await;
}

async fn init() -> Arc<WsHandler> {
    let session_manager = Arc::new(SessionManager::default());
    let connection_pool = Arc::new(QuerierConnectionPool::new());
    Arc::new(WsHandler::new(session_manager, connection_pool.clone()))
}
