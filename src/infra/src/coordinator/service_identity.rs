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

//! Coordinator events that make every node reload one org's service identity overrides.

use crate::errors::Error;

pub const SERVICE_IDENTITY_WATCH_PREFIX: &str = "/service_identity/";

/// Tells every node to reload `org_id`'s overrides; the key is `/service_identity/{org_id}`.
pub async fn emit_reload_event(org_id: &str) -> Result<(), Error> {
    let cluster_coordinator = super::get_coordinator().await;
    cluster_coordinator
        .put(&event_key(org_id), bytes::Bytes::new(), true, None)
        .await
}

/// The org an event key names; `None` for a key outside the prefix or without an org.
pub fn org_from_key(key: &str) -> Option<&str> {
    key.strip_prefix(SERVICE_IDENTITY_WATCH_PREFIX)
        .and_then(|rest| rest.split('/').next())
        .filter(|org| !org.is_empty())
}

fn event_key(org_id: &str) -> String {
    format!("{SERVICE_IDENTITY_WATCH_PREFIX}{org_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_key_round_trips_to_its_org() {
        let key = event_key("acme");
        assert_eq!(key, "/service_identity/acme");
        assert_eq!(org_from_key(&key), Some("acme"));
        assert_eq!(org_from_key("/service_identity/acme/extra"), Some("acme"));
        assert_eq!(org_from_key("/service_identity/"), None);
        assert_eq!(org_from_key("/service_streams/acme"), None);
    }
}
