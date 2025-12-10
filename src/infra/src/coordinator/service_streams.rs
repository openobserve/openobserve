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

//! Coordinator module for service streams cache synchronization.
//!
//! This module provides event emission for service streams updates,
//! allowing queriers to watch for changes and keep their caches synchronized.

use crate::errors::Error;

/// Prefix for service streams watcher events
pub const SERVICE_STREAMS_WATCH_PREFIX: &str = "/service_streams/";

/// Sends event to the cluster coordinator indicating that services have been
/// updated for an organization.
///
/// The event key format is: /service_streams/{org_id}
/// Watchers receive this event and reload the org's services from DB.
pub async fn emit_put_event(org_id: &str) -> Result<(), Error> {
    let key = format!("{}{}", SERVICE_STREAMS_WATCH_PREFIX, org_id);
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator
        .put(&key, bytes::Bytes::from(""), true, None)
        .await?;
    Ok(())
}

/// Sends event to the cluster coordinator indicating that a specific service
/// has been deleted.
///
/// The event key format is: /service_streams/{org_id}/{service_key}
pub async fn emit_delete_event(org_id: &str, service_key: &str) -> Result<(), Error> {
    let key = format!("{}{}/{}", SERVICE_STREAMS_WATCH_PREFIX, org_id, service_key);
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator.delete(&key, false, true, None).await
}

/// Sends event to indicate that all services for an org should be reloaded.
/// This is useful after bulk operations.
pub async fn emit_reload_event(org_id: &str) -> Result<(), Error> {
    emit_put_event(org_id).await
}
