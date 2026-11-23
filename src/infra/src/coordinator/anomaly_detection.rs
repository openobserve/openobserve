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

pub const ANOMALY_CONFIG_WATCH_PREFIX: &str = "/anomaly_detection/config/";

pub fn key(org_id: &str, anomaly_id: &str) -> String {
    format!("{ANOMALY_CONFIG_WATCH_PREFIX}{org_id}/{anomaly_id}")
}

/// An anomaly detection config was created or changed.
pub async fn emit_put_event(org_id: &str, anomaly_id: &str) -> Result<(), Error> {
    super::emit_put(&key(org_id, anomaly_id)).await
}

/// An anomaly detection config was deleted; also removes the key a put left in the coordinator.
pub async fn emit_delete_event(org_id: &str, anomaly_id: &str) -> Result<(), Error> {
    super::emit_delete(&key(org_id, anomaly_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_stays_apart_from_write_intents() {
        assert_eq!(key("acme", "a1"), "/anomaly_detection/config/acme/a1");
        assert!(!key("acme", "a1").starts_with("/anomaly_detection/write_intent/"));
    }
}
