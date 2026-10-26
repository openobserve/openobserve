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

use infra::errors::Result;
use o2_enterprise::enterprise::super_cluster::queue::{DestinationMessage, Message};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let event_key = msg.key.to_owned();
    // A newer region may send a destination this binary cannot decode; retrying it never succeeds.
    let Ok(dest_msg) = DestinationMessage::try_from(msg) else {
        log::warn!("[SUPER_CLUSTER:DESTINATION] skipping undecodable message, key: {event_key}");
        return Ok(());
    };
    match dest_msg {
        DestinationMessage::Put { dest } => {
            infra::table::destinations::put(dest).await?;
            infra::coordinator::emit_put(&event_key).await?;
        }
        DestinationMessage::Delete { org_id, dest_name } => {
            infra::table::destinations::delete(&org_id, &dest_name).await?;
            infra::coordinator::emit_delete(&event_key).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::destinations::{Destination, DestinationType, Endpoint, Module};
    use o2_enterprise::enterprise::super_cluster::queue::MessageType;

    use super::*;

    fn message_with_unknown_destination_type() -> Message {
        let dest = Destination {
            id: None,
            org_id: "org1".to_string(),
            name: "dest1".to_string(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::Http(Endpoint::default()),
            },
        };
        let mut value = serde_json::to_value(DestinationMessage::Put { dest }).unwrap();
        value["Put"]["dest"]["module"]["alert"]["destination_type"]["type"] =
            serde_json::json!("slack_app");
        Message {
            key: "/destinations/org1/dest1".to_string(),
            value: Some(serde_json::to_vec(&value).unwrap().into()),
            start_dt: None,
            need_watch: false,
            message_type: MessageType::DestinationTable,
            source_cluster: None,
        }
    }

    #[tokio::test]
    async fn undecodable_message_is_acknowledged() {
        assert!(DestinationMessage::try_from(message_with_unknown_destination_type()).is_err());
        assert!(
            process(message_with_unknown_destination_type())
                .await
                .is_ok()
        );
    }
}
