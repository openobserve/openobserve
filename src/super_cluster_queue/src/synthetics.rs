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

//! Applies synthetic check *config* replicated from the region a user edited in.
//!
//! Everything here goes through `infra::table::synthetics_checks` on purpose.
//! The publishing wrapper is one layer up, in the enterprise synthetics
//! service, and it exposes the same operations under similar names — so
//! routing an apply through it would look reasonable at the call site and
//! re-broadcast every write, leaving the regions handing each one around
//! forever.
//!
//! The column-selectivity guarantee is inherited rather than restated:
//! `synthetics_checks::update` rebuilds its `ActiveModel` from the row already
//! in this region and only writes the columns a user can edit, so `next_run_at`
//! and the alerting counters keep this region's values. Hand-listing them here
//! would duplicate that list and let the two drift.
//!
//! Applies are idempotent because the queue redelivers: `Create` is a no-op
//! when the row is already here, `Update` and `SetEnabled` are last-write-wins,
//! and `Delete` is a delete.

use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{Error, Result},
    table,
};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType, SyntheticsMessage};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::SyntheticsTable => {
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

async fn process_msg(msg: SyntheticsMessage) -> Result<()> {
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match msg {
        SyntheticsMessage::Create { org_id, payload } => {
            let check = payload.into_check();
            if table::synthetics_checks::get(conn, &org_id, &check.id)
                .await?
                .is_some()
            {
                // Redelivery, or a create that raced its own update. Either way
                // the row is here and overwriting it could undo a later edit.
                return Ok(());
            }
            // `use_given_id` — the origin region's primary key is the identity
            // every other region has to agree on.
            //
            // `folder_id` is the folders KSUID PK. If that folder has not
            // replicated yet the FK rejects the insert, which surfaces as an
            // error here, the message goes unacked, and the redelivery lands
            // after the folder. That is the same ordering behaviour alerts has.
            table::synthetics_checks::create(conn, &org_id, check, true).await?;
        }
        SyntheticsMessage::Update {
            org_id,
            id,
            payload,
        } => {
            // Errors if the row is missing rather than creating it: an update
            // that outran its create is redelivered, and one that arrives after
            // a delete must not resurrect the check.
            table::synthetics_checks::update(conn, &org_id, &id, payload.into_check()).await?;
        }
        SyntheticsMessage::Delete { org_id, id } => {
            table::synthetics_checks::delete(conn, &org_id, &id).await?;
        }
        SyntheticsMessage::SetEnabled {
            org_id,
            id,
            enabled,
        } => {
            // `set_enabled` reports "no such row" as `false`, not an error, so
            // a pause that outran its create would be acked and lost — and
            // `enabled` is the column that decides whether the check runs at
            // all. Fail instead, and let the redelivery land after the create.
            if !table::synthetics_checks::set_enabled(conn, &org_id, &id, enabled).await? {
                return Err(Error::Message(format!(
                    "synthetics check {org_id}/{id} not found for enable/pause"
                )));
            }
        }
        SyntheticsMessage::MoveToFolder {
            org_id,
            ids,
            dst_folder_id,
        } => {
            // Deliberately tolerant of a partial move, unlike the branch above.
            // A bulk move can legitimately race a delete of one of its ids, and
            // erroring would retry that message until it dead-lettered. A check
            // left in its old folder is cosmetic and the next edit to it carries
            // `folder_id` anyway.
            let moved =
                table::synthetics_checks::move_to_folder(conn, &org_id, &ids, &dst_folder_id)
                    .await?;
            if moved != ids.len() as u64 {
                log::warn!(
                    "[SUPER_CLUSTER:DB] moved {moved} of {} synthetics checks into folder {dst_folder_id}; the rest are not in this region",
                    ids.len()
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::super_cluster::queue::{
        Message, MessageType, SyntheticsMessage,
    };

    use super::*;

    #[tokio::test]
    async fn a_message_from_another_table_is_rejected() {
        // The payload is a perfectly good synthetics write, so only the type
        // check can reject it — a processor that decoded first and asked
        // questions later would apply it. Unlike `alerts.rs` there is no legacy
        // `meta` fallback to hand a stranger to.
        let payload = config::utils::json::to_vec(&SyntheticsMessage::Delete {
            org_id: "org1".to_string(),
            id: "check-1".to_string(),
        })
        .unwrap();
        let msg = Message::new(
            "/synthetics/".to_string(),
            Some(payload.into()),
            None,
            false,
            MessageType::Put,
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
            "/synthetics/".to_string(),
            Some(b"not json".to_vec().into()),
            None,
            false,
            MessageType::SyntheticsTable,
        );
        assert!(process(msg).await.is_err());
    }

    #[tokio::test]
    async fn a_payload_less_message_is_an_error_not_a_panic() {
        let msg = Message::new(
            "/synthetics/".to_string(),
            None,
            None,
            false,
            MessageType::SyntheticsTable,
        );
        assert!(process(msg).await.is_err());
    }

    /// The one hazard this file exists to avoid.
    ///
    /// The publish lives one layer up, in the enterprise synthetics service,
    /// because `infra` cannot reach the enterprise crate at all (`o2_enterprise`
    /// depends on `infra`, so the reverse edge would be a cycle). Applying a
    /// replicated write through that upper layer would publish it straight back
    /// out and the regions would hand the same edit around forever. The
    /// `source_cluster` check in `subscribe()` does not save us: it only stops a
    /// region re-consuming its *own* message, not region A re-publishing what it
    /// applied from region B.
    #[test]
    fn the_processor_applies_below_the_publishing_layer() {
        let source = include_str!("synthetics.rs");
        // Assembled at runtime; spelling these out as literals would put them
        // in this file and make the assertions fail on themselves.
        for layer in [
            ["synthetics", "service"].join("::"),
            ["queue", "synthetics_check"].join("::"),
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

    /// The runtime tables are region-owned (`synthetics_jobs` is a lease queue,
    /// `synthetics_runs` holds a counter, `synthetics_agents` is liveness for
    /// agents that long-poll one region). Two regions holding copies is a
    /// correctness failure, not a cost one — so this processor must not be able
    /// to write them even if a message somehow asked it to.
    #[test]
    fn the_processor_never_writes_a_runtime_table() {
        let source = include_str!("synthetics.rs");
        for table in ["jobs", "runs", "agents"] {
            let path = ["table", &["synthetics_", table].concat()].join("::");
            assert!(
                !source.contains(&path),
                "{path} is region-owned and must never be applied from a message"
            );
        }
    }
}
