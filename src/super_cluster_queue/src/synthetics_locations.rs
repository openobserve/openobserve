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

//! Applies `synthetics_locations` rows replicated from the region a user (or an
//! agent's first register) created them in.
//!
//! A region that has never seen a location cannot render it, and its scheduler
//! cannot resolve the pool a job for it routes into — so the registry has to be
//! the same everywhere even though only one region schedules.
//!
//! Everything here goes through `infra::table::synthetics_locations` on purpose.
//! The publishing wrapper is one layer up, in the enterprise synthetics service,
//! and `infra` cannot reach the enterprise crate at all — so applying below it is
//! what stops a region re-broadcasting what it just applied. The
//! `source_cluster` check in `subscribe()` does not cover this: it stops a
//! region re-consuming its *own* message, not region A republishing what it
//! applied from region B. A test greps this file for the upper layer.
//!
//! The runtime-column guarantee is inherited rather than restated. `update`
//! writes label/enabled/updated_at and nothing else, so this region's claim on
//! the right to send one "location down" notification keeps its value. Two
//! regions each winning that claim would notify twice for one outage; a test in
//! the table module asserts the generated `UPDATE` cannot name the column, and
//! one below asserts this file cannot name either function that writes it.
//!
//! Every apply also invalidates this region's locations cache and emits the
//! coordinator event that clears it on every other node here, because the table
//! module's write functions do that themselves.

use infra::{
    errors::{Error, Result},
    table::synthetics_locations,
};
use o2_enterprise::enterprise::super_cluster::queue::{
    Message, MessageType, SyntheticsLocationsMessage,
};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::SyntheticsLocationsTable => {
            process_msg(msg.try_into()?).await?;
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:DB] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}

async fn process_msg(msg: SyntheticsLocationsMessage) -> Result<()> {
    match msg {
        SyntheticsLocationsMessage::Create { payload } => {
            let record = payload.into_record();
            if synthetics_locations::get(&record.id).await?.is_some() {
                // Redelivery, or a create that raced its own update. The row is
                // here and overwriting it could undo a later edit.
                return Ok(());
            }
            // `pool` is UNIQUE, and two agents declaring the same location name
            // in two regions before either message crossed will each have
            // minted a row for it under a different uuid. Inserting would fail
            // the constraint forever, so the message would redeliver until it
            // dead-lettered. Keep this region's row instead: it already routes
            // the pool correctly, and the two ids only diverge for locations
            // nobody has assigned a check to yet.
            if let Some(existing) = synthetics_locations::find_by_pool(&record.pool).await? {
                log::warn!(
                    "[SUPER_CLUSTER:DB] synthetics location {} arrived for pool {} which is already served locally by {}; keeping the local row",
                    record.id,
                    record.pool,
                    existing.id
                );
                return Ok(());
            }
            synthetics_locations::add(&record).await?;
        }
        SyntheticsLocationsMessage::Update { id, label, enabled } => {
            // `update` reports "no such row" as success, so an edit that outran
            // its create would be acked and lost — and `enabled` decides
            // whether checks can be assigned to the location at all. Error
            // instead, and let the redelivery land after the create.
            if synthetics_locations::get(&id).await?.is_none() {
                return Err(Error::Message(format!(
                    "synthetics location {id} not found for update"
                )));
            }
            synthetics_locations::update(&id, &label, enabled).await?;
        }
        SyntheticsLocationsMessage::Delete { id } => {
            // Idempotent — deleting a row that is already gone is the state the
            // message asked for.
            synthetics_locations::remove(&id).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::super_cluster::queue::{
        Message, MessageType, SyntheticsLocationsMessage,
    };

    use super::*;

    #[tokio::test]
    async fn a_message_from_another_table_is_rejected() {
        // The payload is a perfectly good locations write, so only the type
        // check can reject it — a processor that decoded first and asked
        // questions later would apply it.
        let payload = config::utils::json::to_vec(&SyntheticsLocationsMessage::Delete {
            id: "loc-1".to_string(),
        })
        .unwrap();
        let msg = Message::new(
            "/synthetics_locations/".to_string(),
            Some(payload.into()),
            None,
            false,
            MessageType::SyntheticsTable,
        );
        let err = process(msg).await.unwrap_err();
        assert!(
            err.to_string().contains("Invalid message type"),
            "expected the type check to reject it, got: {err}"
        );
    }

    #[tokio::test]
    async fn a_malformed_payload_is_an_error_not_a_panic() {
        let msg = Message::new(
            "/synthetics_locations/".to_string(),
            Some(b"not json".to_vec().into()),
            None,
            false,
            MessageType::SyntheticsLocationsTable,
        );
        assert!(process(msg).await.is_err());
    }

    #[tokio::test]
    async fn a_payload_less_message_is_an_error_not_a_panic() {
        let msg = Message::new(
            "/synthetics_locations/".to_string(),
            None,
            None,
            false,
            MessageType::SyntheticsLocationsTable,
        );
        assert!(process(msg).await.is_err());
    }

    /// The one hazard this file exists to avoid.
    ///
    /// The publishes live one layer up — the enterprise synthetics service for
    /// the CRUD API, the enterprise agent module for an agent's first register —
    /// because `infra` cannot reach the enterprise crate (`o2_enterprise`
    /// depends on `infra`, so the reverse edge would be a cycle). Applying a
    /// replicated write through either would publish it straight back out and
    /// the regions would hand the same edit around forever.
    #[test]
    fn the_processor_applies_below_the_publishing_layer() {
        let source = include_str!("synthetics_locations.rs");
        // Assembled at runtime; spelling these out as literals would put them
        // in this file and make the assertions fail on themselves.
        for layer in [
            ["synthetics", "service"].join("::"),
            ["synthetics", "agent"].join("::"),
            ["queue", "synthetics_location_"].join("::"),
            // The crate the service now lives in, not just the module path.
            // `openobserve-synthetics` is deliberately absent from this crate's
            // dependencies, so this can only ever fire if someone adds it — at
            // which point the loop-prevention guarantee has stopped being a
            // property of the crate graph and become a convention.
            ["openobserve", "synthetics"].join("_"),
        ] {
            assert!(
                !source.contains(&layer),
                "{layer} publishes what it writes; applying through it loops"
            );
        }
    }

    /// The runtime tables are region-owned, and so is this table's claim on the
    /// right to send one "location down" notification. That claim is the
    /// compare-and-swap that makes exactly one staleness watcher notify for an
    /// outage; calling either of its functions from here would let a second
    /// region notify for the same one.
    ///
    /// The searched names are assembled at runtime so this test does not put
    /// them in the file it is searching.
    #[test]
    fn the_processor_never_writes_runtime_state() {
        let source = include_str!("synthetics_locations.rs");
        for table in ["jobs", "runs", "agents"] {
            let path = ["table", &["synthetics_", table].concat()].join("::");
            assert!(
                !source.contains(&path),
                "{path} is region-owned and must never be applied from a message"
            );
        }
        for name in [
            ["try", "claim", "down", "notification"].join("_"),
            ["clear", "down", "notification"].join("_"),
            ["down", "notified", "at"].join("_"),
        ] {
            assert!(
                !source.contains(&name),
                "{name} is region-owned: a replicated edit must not be able to reach it"
            );
        }
    }
}
