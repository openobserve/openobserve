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

pub const DASHBOARDS_WATCH_PREFIX: &str = "/dashboards/";

/// Builds the watch key for a dashboard in a given org. The org is part of the key so a
/// `Delete` event carries enough information to invalidate the id->org cache without an
/// extra DB read.
pub fn key(org_id: &str, dashboard_id: &str) -> String {
    format!("{DASHBOARDS_WATCH_PREFIX}{org_id}/{dashboard_id}")
}

/// Sends event to the cluster coordinator indicating that a dashboard has been put
/// into the database.
pub async fn emit_put_event(org_id: &str, dashboard_id: &str) -> Result<(), Error> {
    let key = key(org_id, dashboard_id);
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator
        .put(&key, bytes::Bytes::from(""), true, None)
        .await?;
    Ok(())
}

/// Sends event to the cluster coordinator indicating that a dashboard has been
/// deleted from the database.
pub async fn emit_delete_event(org_id: &str, dashboard_id: &str) -> Result<(), Error> {
    let key = key(org_id, dashboard_id);
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator.delete(&key, false, true, None).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dashboards_watch_prefix_value() {
        assert_eq!(DASHBOARDS_WATCH_PREFIX, "/dashboards/");
    }

    #[test]
    fn test_dashboards_key_format() {
        let key = key("my-org", "dash-123");
        assert_eq!(key, "/dashboards/my-org/dash-123");
    }
}
