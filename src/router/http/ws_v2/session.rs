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

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use config::RwAHashMap;

use super::{
    error::*,
    handler::{ClientId, QuerierName, TraceId},
};

#[derive(Debug, Default)]
pub struct SessionManager {
    sessions: RwAHashMap<ClientId, SessionInfo>,
    mapped_queriers: RwAHashMap<QuerierName, Vec<TraceId>>,
}

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub querier_mappings: HashMap<TraceId, QuerierName>,
    pub cookie_expiry: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl SessionManager {
    pub async fn register_client(
        &self,
        client_id: &ClientId,
        cookie_expiry: Option<DateTime<Utc>>,
    ) {
        if self.sessions.read().await.get(client_id).is_some() {
            return;
        }

        let now = Utc::now();
        let session_info = SessionInfo {
            querier_mappings: HashMap::default(),
            cookie_expiry,
            created_at: now,
        };

        let mut write_guard = self.sessions.write().await;
        if !write_guard.contains_key(client_id) {
            write_guard.insert(client_id.clone(), session_info.clone());
        }
    }

    pub async fn unregister_client(&self, client_id: &ClientId) {
        if let Some(session_info) = self.sessions.write().await.remove(client_id) {
            let mut mapped_querier_write = self.mapped_queriers.write().await;

            for (trace_id, querier_name) in session_info.querier_mappings {
                if let Some(trace_ids) = mapped_querier_write.get_mut(&querier_name) {
                    trace_ids.retain(|tid| tid != &trace_id);
                }
            }
        }
    }

    pub async fn is_client_cookie_valid(&self, client_id: &ClientId) -> bool {
        match self.sessions.read().await.get(client_id) {
            Some(session_info) => session_info
                .cookie_expiry
                .is_none_or(|expiry| expiry > Utc::now()),
            None => false, // not set is treated as unauthenticated
        }
    }

    pub async fn remove_querier_connection(&self, querier_name: &QuerierName) {
        let client_ids = {
            let (mapped_read, sessions_read) =
                tokio::join!(self.mapped_queriers.read(), self.sessions.read());

            match mapped_read.get(querier_name) {
                Some(_) => sessions_read.keys().cloned().collect::<Vec<_>>(),
                None => return,
            }
        };

        // Remove from mapped_querier
        let trace_ids = self
            .mapped_queriers
            .write()
            .await
            .remove(querier_name)
            .map(|ids| ids.into_iter().collect::<HashSet<_>>())
            .unwrap(); // existence validated

        // Batch update sessions
        let mut session_write = self.sessions.write().await;
        for client_id in client_ids {
            if let Some(session_info) = session_write.get_mut(&client_id) {
                session_info
                    .querier_mappings
                    .retain(|tid, _| !trace_ids.contains(tid));
                session_info.querier_mappings.shrink_to_fit();
            }
        }
    }

    pub async fn set_querier_for_trace(
        &self,
        client_id: &ClientId,
        trace_id: &TraceId,
        querier_name: &QuerierName,
    ) -> WsResult<()> {
        // sessions
        // let mut write_guard = self.sessions.write().await;
        self.sessions
            .write()
            .await
            .get_mut(client_id)
            .ok_or(WsError::SessionNotFound(format!(
                "[WS::SessionManager]: client_id {} not found",
                client_id
            )))?
            .querier_mappings
            .insert(trace_id.clone(), querier_name.clone());

        // mapped_queriers
        self.mapped_queriers
            .write()
            .await
            .entry(querier_name.clone())
            .or_insert_with(Vec::new)
            .push(trace_id.clone());
        Ok(())
    }

    pub async fn get_querier_for_trace(
        &self,
        client_id: &ClientId,
        trace_id: &TraceId,
    ) -> WsResult<Option<QuerierName>> {
        Ok(self
            .sessions
            .read()
            .await
            .get(client_id)
            .ok_or(WsError::SessionNotFound(format!(
                "[WS::SessionManager]: client_id {} not found",
                client_id
            )))?
            .querier_mappings
            .get(trace_id)
            .cloned())
    }
}
