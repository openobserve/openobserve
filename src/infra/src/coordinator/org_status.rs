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

pub const ORG_DELETING_KEY_PREFIX: &str = "/organization/status/deleting/";
pub const ORG_PENDING_KEY_PREFIX: &str = "/organization/status/pending/";
pub const ORG_EVICT_KEY_PREFIX: &str = "/organization/status/evict/";

/// Sends a coordinator event indicating that an org has been marked for deletion.
pub async fn emit_deleting_event(org_id: &str) -> Result<(), Error> {
    let coordinator = super::get_coordinator().await;
    let key = format!("{ORG_DELETING_KEY_PREFIX}{org_id}");
    coordinator
        .put(&key, bytes::Bytes::from(""), true, None)
        .await
}

/// Sends a coordinator event indicating that an org has entered pending_deletion (soft delete).
pub async fn emit_pending_event(org_id: &str) -> Result<(), Error> {
    let coordinator = super::get_coordinator().await;
    let key = format!("{ORG_PENDING_KEY_PREFIX}{org_id}");
    coordinator
        .put(&key, bytes::Bytes::from(""), true, None)
        .await
}

/// Sends a coordinator event to evict an org from the status cache on all nodes.
pub async fn emit_evict_event(org_id: &str) -> Result<(), Error> {
    let coordinator = super::get_coordinator().await;
    let key = format!("{ORG_EVICT_KEY_PREFIX}{org_id}");
    coordinator.delete(&key, false, true, None).await
}
