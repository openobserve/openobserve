// Copyright 2024 Zinc Labs Inc.
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

use config::{meta::destinations::Template, utils::json};
use infra::errors::{Error, Result};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType};

const TEMPLATE_WATCHER_PREFIX: &str = "/templates/";

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::TemplatePut => {
            let bytes = msg
                .value
                .ok_or(Error::Message("Message missing value".to_string()))?;
            let temp: Template = json::from_slice(&bytes).inspect_err(|e| {
                log::error!(
                    "[SUPER_CLUSTER:TEMPLATE] Failed to deserialize message value to a template: {}",
                    e
                );
            })?;
            infra::table::templates::put(temp).await?;
            infra::cluster_coordinator::destinations::emit_put_event(&msg.key).await?;
        }
        MessageType::TemplateDelete => {
            infra::cluster_coordinator::destinations::emit_delete_event(&msg.key).await?;
            let (org_id, name) = parse_event_key(&msg.key)?;
            infra::table::templates::delete(org_id, name).await?;
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:TEMPLATE] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}

fn parse_event_key(event_key: &str) -> Result<(&str, &str)> {
    let item_key = event_key
        .strip_prefix(TEMPLATE_WATCHER_PREFIX)
        .ok_or(Error::Message("event key missing prefix".to_string()))?;
    let mut keys = item_key.split('/');
    let org_id = keys
        .next()
        .ok_or_else(|| Error::Message("Missing org_id in event key".to_string()))?;
    let name = keys
        .next()
        .ok_or_else(|| Error::Message("Missing name in event key".to_string()))?;

    if keys.next().is_some() {
        return Err(Error::Message(
            "Error: event key not formatted correctly. Should be org_id/name".to_string(),
        ));
    }

    Ok((org_id, name))
}
