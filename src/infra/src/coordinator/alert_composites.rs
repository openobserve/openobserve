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

pub const ALERT_COMPOSITES_WATCH_PREFIX: &str = "/alert_composites/";

pub fn key(org_id: &str, composite_id: &str) -> String {
    format!("{ALERT_COMPOSITES_WATCH_PREFIX}{org_id}/{composite_id}")
}

/// A composite definition was created or changed.
pub async fn emit_put_event(org_id: &str, composite_id: &str) -> Result<(), Error> {
    super::emit_put(&key(org_id, composite_id)).await
}

/// A composite definition was deleted; also removes the key a put left in the coordinator.
pub async fn emit_delete_event(org_id: &str, composite_id: &str) -> Result<(), Error> {
    super::emit_delete(&key(org_id, composite_id)).await
}

/// Removes every key of the org; teardown runs it on each attempt, clearing keys a failed delete
/// left.
pub async fn purge_org(org_id: &str) -> Result<(), Error> {
    super::purge_prefix(&format!("{ALERT_COMPOSITES_WATCH_PREFIX}{org_id}/")).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_names_org_and_composite() {
        assert_eq!(key("acme", "c1"), "/alert_composites/acme/c1");
        assert!(key("acme", "c1").starts_with(ALERT_COMPOSITES_WATCH_PREFIX));
    }
}
