use std::collections::HashSet;

use dashmap::DashMap;
use sea_orm::prelude::Uuid;

use super::{error::*, types::*};

pub struct RouterSessionManager {
    sessions: DashMap<SessionId, SessionInfo>,
    client_sessions: DashMap<ClientId, HashSet<SessionId>>,
    querier_mappings: DashMap<TraceId, QuerierId>,
}

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub session_id: SessionId,
    pub client_id: ClientId,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_active: chrono::DateTime<chrono::Utc>,
}

impl RouterSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            client_sessions: DashMap::new(),
            querier_mappings: DashMap::new(),
        }
    }

    pub async fn create_session(&self, client_id: ClientId) -> WsResult<SessionInfo> {
        let session_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        let session_info = SessionInfo {
            session_id: session_id.clone(),
            client_id: client_id.clone(),
            created_at: now,
            last_active: now,
        };

        self.sessions
            .insert(session_id.clone(), session_info.clone());

        self.client_sessions
            .entry(client_id)
            .or_insert_with(HashSet::new)
            .insert(session_id);

        Ok(session_info)
    }

    pub async fn get_session(&self, session_id: &SessionId) -> Option<SessionInfo> {
        self.sessions.get(session_id).map(|s| s.clone())
    }

    pub async fn update_session_activity(&self, session_id: &SessionId) -> WsResult<()> {
        if let Some(mut session) = self.sessions.get_mut(session_id) {
            session.last_active = chrono::Utc::now();
        }
        Ok(())
    }

    pub async fn remove_session(&self, session_id: &SessionId) -> WsResult<()> {
        if let Some((_, session)) = self.sessions.remove(session_id) {
            if let Some(mut client_sessions) = self.client_sessions.get_mut(&session.client_id) {
                client_sessions.remove(session_id);
            }
        }
        Ok(())
    }

    pub async fn set_querier_for_trace(
        &self,
        trace_id: TraceId,
        querier_id: QuerierId,
    ) -> WsResult<()> {
        self.querier_mappings.insert(trace_id, querier_id);
        Ok(())
    }

    pub async fn get_querier_for_trace(&self, trace_id: &TraceId) -> Option<QuerierId> {
        self.querier_mappings.get(trace_id).map(|q| q.clone())
    }
}
