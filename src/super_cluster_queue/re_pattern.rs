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

use infra::{
    cluster_coordinator::get_coordinator,
    errors::{DbError, Error, Result},
};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType, RePatternsMessage};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::RePatternsTable => {
            let actual_message: RePatternsMessage = serde_json::from_slice(&msg.value.unwrap())?;
            match actual_message {
                RePatternsMessage::Delete { id } => {
                    log::info!("[SUPER_CLUSTER:DB] deleting pattern with id {id}");
                    infra::table::re_pattern::remove(&id).await?;
                    let cluster_coordinator = get_coordinator().await;
                    cluster_coordinator
                        .delete(&format!("/re_patterns/{id}"), false, true, None)
                        .await?;
                }
                RePatternsMessage::Put { entry } => {
                    log::info!(
                        "[SUPER_CLUSTER:DB] adding pattern {}/{}:{}",
                        entry.org,
                        entry.name,
                        entry.id
                    );
                    let id = entry.id.clone();
                    match infra::table::re_pattern::add(entry).await {
                        Ok(_) => {}
                        // this is the case when the cluster sending the message also receives
                        // and processes it. Because message will be delivered to all clients,
                        // clients in the sending cluster will also get this, and we want to ignore
                        // that case.
                        Err(Error::DbError(DbError::UniqueViolation)) => {}
                        Err(e) => return Err(e),
                    };
                    let cluster_coordinator = get_coordinator().await;
                    cluster_coordinator
                        .put(
                            &format!("/re_patterns/{id}"),
                            bytes::Bytes::new(), // no actual data, the receiver can query the db
                            true,
                            None,
                        )
                        .await?;
                }
                RePatternsMessage::Update { id, pattern } => {
                    log::info!("[SUPER_CLUSTER:DB] updating pattern {id}",);
                    infra::table::re_pattern::update_pattern(&id, &pattern).await?;
                    let cluster_coordinator = get_coordinator().await;
                    cluster_coordinator
                        .put(
                            &format!("/re_patterns/{id}"),
                            bytes::Bytes::new(), // no actual data, the receiver can query the db
                            true,
                            None,
                        )
                        .await?;
                }
            }
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:DB] Invalid message for pattern handler: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}
