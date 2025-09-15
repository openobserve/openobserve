// Copyright 2025 OpenObserve Inc.
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
    coordinator::get_coordinator,
    errors::{DbError, Error, Result},
    table::cipher::EntryKind,
};
use o2_enterprise::enterprise::super_cluster::queue::{KeysMessage, Message, MessageType};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::KeysTable => {
            let actual_message: KeysMessage = serde_json::from_slice(&msg.value.unwrap())?;
            match actual_message {
                KeysMessage::Delete { name, org } => {
                    log::info!("[SUPER_CLUSTER:DB] deleting key {org}/{name}");
                    infra::table::cipher::remove(&org, EntryKind::CipherKey, &name).await?;
                    let cluster_coordinator = get_coordinator().await;
                    cluster_coordinator
                        .delete(&format!("/cipher_keys/{org}/{name}"), false, true, None)
                        .await?;
                }
                KeysMessage::Put { entry } => {
                    log::info!("[SUPER_CLUSTER:DB] adding key {}/{}", entry.org, entry.name);
                    let org = entry.org.clone();
                    let name = entry.name.clone();
                    match infra::table::cipher::add(entry).await {
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
                            &format!("/cipher_keys/{org}/{name}"),
                            bytes::Bytes::new(), // no actual data, the receiver can query the db
                            true,
                            None,
                        )
                        .await?;
                }
                KeysMessage::Update { entry } => {
                    log::info!(
                        "[SUPER_CLUSTER:DB] updating key {}/{}",
                        entry.org,
                        entry.name
                    );
                    let org = entry.org.clone();
                    let name = entry.name.clone();
                    infra::table::cipher::update(entry).await?;
                    let cluster_coordinator = get_coordinator().await;
                    cluster_coordinator
                        .put(
                            &format!("/cipher_keys/{org}/{name}"),
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
                "[SUPER_CLUSTER:DB] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}
