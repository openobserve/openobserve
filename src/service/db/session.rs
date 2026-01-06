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

use bytes::Bytes;
use infra::db::{delete_from_db_coordinator, put_into_db_coordinator};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

use crate::common::infra::config::{USER_SESSIONS, USER_SESSIONS_EXPIRY};

// Key prefix for session events in coordinator
pub const USER_SESSION_KEY: &str = "/user_sessions/";

pub async fn get(session_id: &str) -> Result<String, anyhow::Error> {
    // Check cache first for performance
    if let Some(token) = USER_SESSIONS.get(session_id) {
        let token_value = token.to_string();
        drop(token); // Drop reference before checking expiry

        // Check if we have expiry info cached
        if let Some(expires_at_ref) = USER_SESSIONS_EXPIRY.get(session_id) {
            let expires_at = *expires_at_ref;
            drop(expires_at_ref); // Drop reference before any operations

            let now = chrono::Utc::now().timestamp();
            log::debug!(
                "Session expiry check (cached): session={}, now={}, expires_at={}, expired={}",
                session_id,
                now,
                expires_at,
                now > expires_at
            );
            if now > expires_at {
                // Session expired - remove from cache and DB
                log::warn!(
                    "Session expired (cached): {} (expired at {})",
                    session_id,
                    expires_at
                );
                USER_SESSIONS.remove(session_id);
                USER_SESSIONS_EXPIRY.remove(session_id);
                if let Err(e) = delete(session_id).await {
                    log::error!("Failed to delete expired session {}: {}", session_id, e);
                } else {
                    log::debug!("Deleted expired session: {}", session_id);
                }
                return Err(anyhow::anyhow!("Session expired"));
            }
        } else {
            log::debug!(
                "Session found in cache but NO EXPIRY INFO cached: {}",
                session_id
            );
        }
        // Token is valid and not expired
        return Ok(token_value);
    }

    // Cache miss - fetch from DB
    log::debug!(
        "Cache miss for user session, reading from db: {}",
        session_id
    );
    let session = infra::table::sessions::get(session_id).await?;

    match session {
        Some(session) => {
            // Check if session has expired
            let expires_at = session.expires_at;
            let now = chrono::Utc::now().timestamp();
            if now > expires_at {
                log::warn!(
                    "Session expired (db): {} (expired at {})",
                    session_id,
                    expires_at
                );
                // Delete expired session from DB
                if let Err(e) = delete(session_id).await {
                    log::error!("Failed to delete expired session {}: {}", session_id, e);
                } else {
                    log::debug!("Deleted expired session: {}", session_id);
                }
                return Err(anyhow::anyhow!("Session expired"));
            }
            // Cache the expiry time
            USER_SESSIONS_EXPIRY.insert(session_id.to_string(), expires_at);

            let access_token = session.access_token.clone();
            // Cache the token
            if !access_token.is_empty() {
                USER_SESSIONS.insert(session_id.to_string(), access_token.clone());
            }
            Ok(access_token)
        }
        None => {
            // Remove from cache if it was there
            USER_SESSIONS.remove(session_id);
            USER_SESSIONS_EXPIRY.remove(session_id);
            Err(anyhow::anyhow!("Session not found: {}", session_id))
        }
    }
}

/// Creates or updates a session with expiration
///
/// # Arguments
/// * `session_id` - Unique session identifier
/// * `val` - Access token to store
/// * `expires_at` - Expiration timestamp (seconds since epoch) All sessions must have an expiry -
///   either from JWT or default 24 hours
pub async fn set_with_expiry(
    session_id: &str,
    val: &str,
    expires_at: i64,
) -> Result<(), anyhow::Error> {
    infra::table::sessions::set_with_expiry(session_id, val, expires_at).await?;
    let key = format!("{USER_SESSION_KEY}{session_id}");
    if let Err(e) = put_into_db_coordinator(&key, Bytes::new(), true, None).await {
        log::error!("[SESSION] Failed to sync session to coordinator: {key} - {e}");
    }

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let _ =
            o2_enterprise::enterprise::super_cluster::queue::put(&key, Bytes::new(), true, None)
                .await
                .inspect_err(|e| {
                    log::error!("[SESSION] put to super cluster failed: {key} - {e}");
                });
    }

    USER_SESSIONS.insert(session_id.to_string(), val.to_string());
    // Cache the expiry time
    USER_SESSIONS_EXPIRY.insert(session_id.to_string(), expires_at);

    Ok(())
}

pub async fn delete(session_id: &str) -> Result<(), anyhow::Error> {
    infra::table::sessions::delete(session_id).await?;
    let key = format!("{USER_SESSION_KEY}{session_id}");
    if let Err(e) = delete_from_db_coordinator(&key, false, true, None).await {
        log::error!("[SESSION] Failed to delete session from coordinator: {key} - {e}");
    }

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let _ = o2_enterprise::enterprise::super_cluster::queue::delete(&key, false, true, None)
            .await
            .inspect_err(|e| {
                log::error!("[SESSION] delete to super cluster failed: {key} - {e}");
            });
    }

    USER_SESSIONS.remove(session_id);
    USER_SESSIONS_EXPIRY.remove(session_id);

    Ok(())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = USER_SESSION_KEY;
    let cluster_coordinator = infra::db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching user sessions");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_sessions: event channel closed");
                return Ok(());
            }
        };
        match ev {
            infra::db::Event::Put(ev) => {
                let session_id = ev.key.strip_prefix(key).unwrap();
                match infra::table::sessions::get(session_id).await {
                    Ok(Some(session)) => {
                        if !session.access_token.is_empty() {
                            USER_SESSIONS.insert(session_id.to_string(), session.access_token);
                            // Cache expiry time
                            USER_SESSIONS_EXPIRY.insert(session_id.to_string(), session.expires_at);
                            log::debug!("Session added to cache: {}", session_id);
                        }
                    }
                    Ok(None) => {
                        log::warn!(
                            "Got coordinator message, but session id not found in DB: {}",
                            session_id
                        );
                    }
                    Err(e) => {
                        log::error!(
                            "Error fetching session after coordinator message {}: {}",
                            session_id,
                            e
                        );
                    }
                }
            }
            infra::db::Event::Delete(ev) => {
                let session_id = ev.key.strip_prefix(key).unwrap();
                USER_SESSIONS.remove(session_id);
                USER_SESSIONS_EXPIRY.remove(session_id);
                log::debug!("Session removed from cache: {}", session_id);
            }
            infra::db::Event::Empty => {}
        }
    }
}

pub async fn cache() -> Result<(), anyhow::Error> {
    // Clean up expired sessions first
    match cleanup_expired().await {
        Ok(count) if count > 0 => {
            log::info!(
                "Cleaned up {} expired sessions during cache initialization",
                count
            );
        }
        Err(e) => {
            log::error!(
                "Failed to cleanup expired sessions during initialization: {}",
                e
            );
        }
        _ => {}
    }

    let sessions_list = infra::table::sessions::list().await?;

    for session in sessions_list {
        if !session.access_token.is_empty() {
            USER_SESSIONS.insert(session.session_id.clone(), session.access_token);
            // Cache expiry time
            USER_SESSIONS_EXPIRY.insert(session.session_id, session.expires_at);
        }
    }

    log::info!(
        "User Sessions Cached: {} sessions loaded",
        USER_SESSIONS.len()
    );
    Ok(())
}

/// Cleans up all expired sessions from database and cache
/// This is called periodically or on-demand to remove expired sessions in bulk
pub async fn cleanup_expired() -> Result<u64, anyhow::Error> {
    // Delete from database
    let deleted_count = infra::table::sessions::delete_expired().await?;

    if deleted_count > 0 {
        log::info!(
            "Cleaned up {} expired sessions from database",
            deleted_count
        );

        // Clean up cache - check all cached sessions for expiry
        let now = chrono::Utc::now().timestamp();
        let mut expired_sessions = Vec::new();

        // Collect expired session IDs
        for entry in USER_SESSIONS_EXPIRY.iter() {
            let session_id = entry.key();
            let expires_at = *entry.value();
            if now > expires_at {
                expired_sessions.push(session_id.clone());
            }
        }

        // Remove expired sessions from both caches
        for session_id in &expired_sessions {
            USER_SESSIONS.remove(session_id);
            USER_SESSIONS_EXPIRY.remove(session_id);
        }

        if !expired_sessions.is_empty() {
            log::info!(
                "Removed {} expired sessions from cache",
                expired_sessions.len()
            );
        }
    }

    Ok(deleted_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_user_session_key_format() {
        assert_eq!(USER_SESSION_KEY, "/user_sessions/");
        let session_id = "test_session_123";
        let key = format!("{}{}", USER_SESSION_KEY, session_id);
        assert_eq!(key, "/user_sessions/test_session_123");
    }

    #[test]
    fn test_user_session_key_prefix() {
        // Verify the key format is correct for coordinator operations
        let session_id = "abc-def-123";
        let key = format!("{}{}", USER_SESSION_KEY, session_id);
        assert!(key.starts_with("/user_sessions/"));
        assert!(key.ends_with("abc-def-123"));
    }

    #[test]
    fn test_user_session_key_multiple_formats() {
        let test_cases = vec![
            "simple_id",
            "uuid-with-dashes",
            "id_with_underscores",
            "123456789",
        ];

        for session_id in test_cases {
            let key = format!("{}{}", USER_SESSION_KEY, session_id);
            assert_eq!(key, format!("/user_sessions/{}", session_id));
            assert!(key.starts_with(USER_SESSION_KEY));
        }
    }
}
