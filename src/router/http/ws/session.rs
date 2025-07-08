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

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, atomic::AtomicBool},
};

use chrono::{DateTime, Utc};
use config::RwAHashMap;

use super::{
    error::*,
    handler::{ClientId, QuerierName, TraceId},
};

#[derive(Debug, Default)]
pub struct SessionManager {
    sessions: RwAHashMap<ClientId, SessionInfo>,
}

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub trace_id_map: HashMap<TraceId, QuerierName>,
    pub cookie_expiry: Option<DateTime<Utc>>,
    pub last_active: DateTime<Utc>,
    pub is_session_drain_state: Arc<AtomicBool>,
    // Used to lookup trace_ids for a given querier
    pub querier_map: HashMap<QuerierName, HashSet<TraceId>>,
}

impl SessionManager {
    pub async fn register_client(
        &self,
        client_id: &ClientId,
        cookie_expiry: Option<DateTime<Utc>>,
    ) {
        let r = self.sessions.read().await;
        if r.get(client_id).is_some() {
            drop(r);
            return;
        }
        drop(r);

        let session_info = SessionInfo {
            trace_id_map: HashMap::default(),
            cookie_expiry,
            last_active: Utc::now(),
            is_session_drain_state: Arc::new(AtomicBool::new(false)),
            querier_map: HashMap::default(),
        };

        let mut write_guard = self.sessions.write().await;
        if !write_guard.contains_key(client_id) {
            write_guard.insert(client_id.clone(), session_info.clone());
        }
        drop(write_guard);
    }

    pub async fn update_session_activity(&self, client_id: &ClientId) {
        let mut write_guard = self.sessions.write().await;
        if let Some(session_info) = write_guard.get_mut(client_id) {
            session_info.last_active = chrono::Utc::now();
        }
        drop(write_guard);
    }

    pub async fn remove_trace_id(&self, client_id: &str, trace_id: &str) {
        let mut session_write = self.sessions.write().await;
        let session_info = session_write.get_mut(client_id);
        if let Some(session_info) = session_info {
            let querier_name = session_info
                .trace_id_map
                .remove(trace_id)
                .unwrap_or_default();
            session_info.querier_map.remove(&querier_name);
        }
        drop(session_write);
    }

    pub async fn unregister_client(&self, client_id: &ClientId) {
        let mut session_write = self.sessions.write().await;
        session_write.remove(client_id);
        drop(session_write);
    }

    pub async fn is_client_cookie_valid(&self, client_id: &ClientId) -> bool {
        let r = self.sessions.read().await;
        let session_info = r.get(client_id).cloned();
        drop(r);
        match session_info {
            Some(session_info) => session_info
                .cookie_expiry
                .is_none_or(|expiry| expiry > Utc::now()),
            None => false, // not set is treated as unauthenticated
        }
    }

    pub async fn remove_querier_connection(&self, querier_name: &str) {
        let client_ids = {
            let session_read = self.sessions.read().await;
            let client_ids = session_read.keys().cloned().collect::<Vec<_>>();
            drop(session_read);
            client_ids
        };

        // Batch update sessions
        let mut session_write = self.sessions.write().await;
        for client_id in client_ids {
            if let Some(session_info) = session_write.get_mut(&client_id) {
                let trace_ids = session_info
                    .querier_map
                    .remove(querier_name)
                    .unwrap_or_default();
                for trace_id in trace_ids {
                    session_info.trace_id_map.remove(&trace_id);
                }
                session_info.trace_id_map.shrink_to_fit();
                session_info.querier_map.shrink_to_fit();
            }
        }
        drop(session_write);
    }

    pub async fn set_querier_for_trace(
        &self,
        client_id: &ClientId,
        trace_id: &TraceId,
        querier_name: &QuerierName,
    ) -> WsResult<()> {
        let mut w = self.sessions.write().await;
        let session_info = w
            .get_mut(client_id)
            .ok_or(WsError::SessionNotFound(format!("client_id {client_id}")))?;
        session_info
            .trace_id_map
            .insert(trace_id.clone(), querier_name.clone());
        session_info
            .querier_map
            .entry(querier_name.clone())
            .or_insert_with(HashSet::new)
            .insert(trace_id.clone());
        drop(w);

        Ok(())
    }

    pub async fn get_querier_for_trace(
        &self,
        client_id: &ClientId,
        trace_id: &TraceId,
    ) -> WsResult<Option<QuerierName>> {
        let r = self.sessions.read().await;
        let querier_name = r
            .get(client_id)
            .ok_or(WsError::SessionNotFound(format!("client_id {client_id}")))?
            .trace_id_map
            .get(trace_id)
            .cloned();
        drop(r);
        Ok(querier_name)
    }

    pub async fn get_querier_connections(&self, client_id: &ClientId) -> Vec<QuerierName> {
        let r = self.sessions.read().await;
        let querier_names = r
            .get(client_id)
            .map(|session_info| session_info.trace_id_map.values().cloned().collect())
            .unwrap_or_default();
        drop(r);
        querier_names
    }

    pub async fn get_trace_ids(&self, client_id: &ClientId) -> Vec<TraceId> {
        let r = self.sessions.read().await;
        let trace_ids = r
            .get(client_id)
            .map(|session_info| session_info.trace_id_map.keys().cloned().collect())
            .unwrap_or_default();
        drop(r);
        trace_ids
    }

    pub async fn is_session_drain_state(&self, client_id: &ClientId) -> Arc<AtomicBool> {
        let r = self.sessions.read().await;
        let is_session_drain_state = r
            .get(client_id)
            .map(|session_info| session_info.is_session_drain_state.clone())
            .unwrap_or(Arc::new(AtomicBool::new(false)));
        drop(r);
        is_session_drain_state
    }
}
