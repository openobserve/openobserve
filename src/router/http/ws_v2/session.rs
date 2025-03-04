use std::collections::HashMap;

use config::{RwAHashMap, ider};

use super::{error::*, types::*};

pub struct SessionManager {
    sessions: RwAHashMap<ClientId, SessionInfo>,
}

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub session_id: SessionId,
    pub querier_mappings: HashMap<TraceId, QuerierName>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_active: chrono::DateTime<chrono::Utc>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: RwAHashMap::default(),
        }
    }

    pub async fn get_or_create_session(&self, client_id: &ClientId) -> SessionInfo {
        if let Some(session) = self.sessions.read().await.get(client_id) {
            return session.clone();
        }

        let now = chrono::Utc::now();
        let session_info = SessionInfo {
            session_id: ider::uuid(),
            querier_mappings: HashMap::default(),
            created_at: now,
            last_active: now,
        };

        let mut write_guard = self.sessions.write().await;
        if !write_guard.contains_key(client_id) {
            write_guard.insert(client_id.clone(), session_info.clone());
            return session_info;
        }
        drop(write_guard);

        self.sessions.read().await.get(client_id).unwrap().clone()
    }

    pub async fn update_session_activity(&self, client_id: &ClientId) -> WsResult<()> {
        let mut write_guard = self.sessions.write().await;
        write_guard
            .get_mut(client_id)
            .ok_or(WsError::SessionNotFound(format!(
                "[WS::SessionManager]: client_id {} not found",
                client_id
            )))?
            .created_at = chrono::Utc::now();
        Ok(())
    }

    pub async fn remove_session(&self, client_id: &ClientId) {
        self.sessions.write().await.remove(client_id);
    }

    pub async fn set_querier_for_trace(
        &self,
        client_id: &ClientId,
        trace_id: TraceId,
        querier_name: QuerierName,
    ) -> WsResult<()> {
        let mut write_guard = self.sessions.write().await;
        write_guard
            .get_mut(client_id)
            .ok_or(WsError::SessionNotFound(format!(
                "[WS::SessionManager]: client_id {} not found",
                client_id
            )))?
            .querier_mappings
            .insert(trace_id, querier_name);
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
