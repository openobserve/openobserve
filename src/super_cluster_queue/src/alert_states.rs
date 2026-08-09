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

//! Applies alert run-state writes replicated from the region that evaluated.
//!
//! Everything here goes through `infra::table` on purpose. The publishing
//! wrapper is one layer up, in the `db` crate's alert-state module, and it
//! exposes the very same function names — so routing an apply through it would
//! look identical at the call site and re-broadcast every write, leaving the
//! regions handing each one around forever.
//!
//! Applies are idempotent because the queue redelivers: the state upsert is
//! last-write-wins by primary key, transitions are identified by
//! `(alert_id, group_key, at)`, and the deletes are deletes.

use infra::{
    errors::{Error, Result},
    table,
};
use o2_enterprise::enterprise::super_cluster::queue::{AlertStateMessage, Message, MessageType};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::AlertStatesTable => {
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

async fn process_msg(msg: AlertStateMessage) -> Result<()> {
    match msg {
        AlertStateMessage::Persist { update } => {
            table::alert_states::persist(&update).await?;
        }
        AlertStateMessage::PersistGroupPlan { alert_id, plan } => {
            // The plan re-reads the alert's `multi_alert` opt-in against THIS
            // region's `alerts` table, so a plan that outran its alert row is
            // dropped rather than stranding group rows under an alert this
            // region has never heard of. It converges on the next evaluation.
            table::alert_states::persist_group_plan(&plan, &alert_id).await?;
        }
        AlertStateMessage::AdvanceDeliveryState {
            alert_id,
            group_key,
            episode,
            outcome,
        } => {
            // The return value says whether the episode guard still matched.
            // `false` is not an error here: it means this region's row had
            // already moved on, which is exactly what the guard is for.
            table::alert_states::advance_delivery_state(&alert_id, &group_key, episode, outcome)
                .await?;
        }
        AlertStateMessage::DeleteGroups {
            alert_id,
            group_keys,
        } => {
            table::alert_states::delete_groups(&alert_id, &group_keys).await?;
        }
        AlertStateMessage::DeleteAllGroups { alert_id } => {
            table::alert_states::delete_all_groups(&alert_id).await?;
        }
        AlertStateMessage::DeleteByAlert { alert_id } => {
            table::alert_states::delete_by_alert(&alert_id).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::super_cluster::queue::{
        AlertStateMessage, Message, MessageType,
    };

    use super::*;

    #[tokio::test]
    async fn a_message_from_another_table_is_rejected() {
        // Unlike `alerts.rs` there is no legacy `meta` fallback to hand a
        // stranger to: a message that reaches this processor with the wrong
        // type is a routing bug and must be surfaced, not swallowed.
        //
        // The payload is a perfectly good alert-state write, so only the type
        // check can reject it — a processor that decoded first and asked
        // questions later would apply it.
        let payload = config::utils::json::to_vec(&AlertStateMessage::DeleteByAlert {
            alert_id: "alert-1".to_string(),
        })
        .unwrap();
        let msg = Message::new(
            "/alert_states/".to_string(),
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
            "/alert_states/".to_string(),
            Some(b"not json".to_vec().into()),
            None,
            false,
            MessageType::AlertStatesTable,
        );
        assert!(process(msg).await.is_err());
    }

    #[tokio::test]
    async fn a_payload_less_message_is_an_error_not_a_panic() {
        let msg = Message::new(
            "/alert_states/".to_string(),
            None,
            None,
            false,
            MessageType::AlertStatesTable,
        );
        assert!(process(msg).await.is_err());
    }

    /// The one hazard this file exists to avoid.
    ///
    /// The publish lives one layer up, in `db`, because `infra` cannot reach
    /// the enterprise crate at all (`o2_enterprise` depends on `infra`, so the
    /// reverse edge would be a cycle). Applying a replicated write through that
    /// upper layer would publish it straight back out and the clusters would
    /// hand the same write around forever. The two layers expose the same
    /// function names, so the mistake is invisible at the call site — hence
    /// this guard.
    #[test]
    fn the_processor_applies_below_the_publishing_layer() {
        let source = include_str!("alert_states.rs");
        // Assembled at runtime; spelling these out as literals would put them
        // in this file and make the assertions fail on themselves.
        let db_layer = ["db", "alerts"].join("::");
        let publish_fn = ["queue", "alert_states"].join("::");

        assert!(
            !source.contains(&db_layer),
            "{db_layer} publishes what it writes; applying through it loops"
        );
        assert!(
            !source.contains(&publish_fn),
            "the processor must never publish: applying a replicated write \
             would re-broadcast it"
        );
    }
}
