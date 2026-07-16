// Copyright 2026 OpenObserve Inc.
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

use crate::errors::Error;

/// Single watched prefix for all org status changes. The new status is carried in
/// the event VALUE ("deleting" / "pending_deletion"); a Delete event on this key
/// means "evict" (org is active/gone). Watchers switch on the value rather than
/// having to subscribe to a separate prefix per status.
pub const ORG_STATUS_KEY_PREFIX: &str = "/organization/status/";

/// Status values carried in the coordinator event value.
pub const STATUS_DELETING: &str = "deleting";
pub const STATUS_PENDING_DELETION: &str = "pending_deletion";
pub const STATUS_ACTIVE: &str = "active";

/// Sends a coordinator event indicating that an org has been marked for deletion.
pub async fn emit_deleting_event(org_id: &str) -> Result<(), Error> {
    emit_status_event(org_id, STATUS_DELETING).await
}

/// Sends a coordinator event indicating that an org has entered pending_deletion (soft delete).
pub async fn emit_pending_event(org_id: &str) -> Result<(), Error> {
    emit_status_event(org_id, STATUS_PENDING_DELETION).await
}

async fn emit_status_event(org_id: &str, status: &str) -> Result<(), Error> {
    let coordinator = super::get_coordinator().await;
    let key = format!("{ORG_STATUS_KEY_PREFIX}{org_id}");
    coordinator
        .put(&key, bytes::Bytes::from(status.to_string()), true, None)
        .await
}

/// Sends a coordinator event to evict an org from the status cache on all nodes.
/// Modeled as a Delete on the org's status key (no status = not blocked).
pub async fn emit_evict_event(org_id: &str) -> Result<(), Error> {
    let coordinator = super::get_coordinator().await;
    let key = format!("{ORG_STATUS_KEY_PREFIX}{org_id}");
    coordinator.delete(&key, false, true, None).await
}
