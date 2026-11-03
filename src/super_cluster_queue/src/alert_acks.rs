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

//! Applies ack rows replicated from another region; the newer `updated_at` wins (R-125).

use infra::errors::{Error, Result};
use o2_enterprise::enterprise::super_cluster::queue::{AlertAckMessage, Message, MessageType};

pub(crate) async fn process(msg: Message) -> Result<()> {
    if msg.message_type != MessageType::AlertAcksTable {
        log::error!(
            "[SUPER_CLUSTER:DB] Invalid message: type: {:?}, key: {}",
            msg.message_type,
            msg.key
        );
        return Err(Error::Message("Invalid message type".to_string()));
    }
    match AlertAckMessage::try_from(msg)? {
        AlertAckMessage::Put { ack } => {
            // Through `infra`, not `db`: the `db` wrapper would broadcast the row again.
            if infra::table::alert_acks::apply_replicated(&ack).await? {
                openobserve_core::alerts::ack::after_replicated(&ack).await;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::ack::{AckSource, AlertAck};
    use o2_enterprise::enterprise::super_cluster::queue::{AlertAckMessage, Message, MessageType};

    use super::*;

    fn ack() -> AlertAck {
        AlertAck {
            org_id: "acme".into(),
            alert_id: "a1".into(),
            group_key: "g".into(),
            firing_started_at: 100,
            acked_by: "dana@acme.com".into(),
            acked_at: 105,
            ack_source: AckSource::Slack,
            taken_over_from: None,
            unacked_at: None,
            unacked_by: None,
            updated_at: 105,
        }
    }

    #[tokio::test]
    async fn a_message_of_another_table_is_rejected_before_it_is_decoded() {
        let payload = config::utils::json::to_vec(&AlertAckMessage::Put { ack: ack() }).unwrap();
        let msg = Message::new(
            "/alert_acks/acme/a1/g".to_string(),
            Some(payload.into()),
            None,
            false,
            MessageType::AlertStatesTable,
        );
        assert!(process(msg).await.is_err());
    }

    #[test]
    fn an_ack_survives_the_wire_round_trip() {
        let payload = config::utils::json::to_vec(&AlertAckMessage::Put { ack: ack() }).unwrap();
        let msg = Message::new(
            "/alert_acks/acme/a1/g".to_string(),
            Some(payload.into()),
            None,
            false,
            MessageType::AlertAcksTable,
        );
        let bytes = bytes::Bytes::try_from(&msg).unwrap();
        let decoded = Message::try_from(&bytes).unwrap();
        assert_eq!(decoded.message_type, MessageType::AlertAcksTable);
        assert_eq!(decoded.key.split('/').nth(1), Some("alert_acks"));
        let AlertAckMessage::Put { ack: back } = AlertAckMessage::try_from(decoded).unwrap();
        assert_eq!(back, ack());
    }
}
