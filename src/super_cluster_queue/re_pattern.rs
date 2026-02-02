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

use config::meta::stream::{PatternAssociation, UpdateSettingsWrapper};
use infra::{
    coordinator::get_coordinator,
    errors::{DbError, Error, Result},
    table::re_pattern_stream_map::{ApplyPolicy, PatternAssociationEntry, PatternPolicy},
};
use o2_enterprise::enterprise::{
    re_patterns::get_pattern_manager,
    super_cluster::queue::{Message, MessageType, RePatternsMessage},
};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::RePatternsTable => {
            let v = match msg.value {
                Some(v) => v,
                None => {
                    log::error!(
                        "expected value with re patterns message, found none, message : key : {}, src clusters : {:?}",
                        msg.key,
                        msg.source_cluster
                    );
                    return Err(anyhow::anyhow!("missing value in re pattern message").into());
                }
            };
            let actual_message: RePatternsMessage = serde_json::from_slice(&v)?;
            match actual_message {
                RePatternsMessage::Delete { id } => {
                    log::info!("[SUPER_CLUSTER:DB] deleting pattern with id {id}");
                    infra::table::re_pattern::remove(&id).await?;
                    let mgr = get_pattern_manager().await?;
                    mgr.remove_pattern(&id);

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

                    let mgr = get_pattern_manager().await?;
                    mgr.insert_pattern(entry.clone());

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

                    let mgr = get_pattern_manager().await?;
                    mgr.update_pattern(id.clone(), pattern)?;

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
                RePatternsMessage::AssociationUpdate {
                    org,
                    stype,
                    stream,
                    updates,
                } => {
                    log::info!(
                        "[SUPER_CLUSTER:DB] updating associations for {org}/{stype}/{stream}"
                    );

                    let update: UpdateSettingsWrapper<PatternAssociation> =
                        serde_json::from_slice(&updates)?;

                    if update.add.is_empty() && update.remove.is_empty() {
                        return Ok(());
                    }

                    let added = update
                        .add
                        .clone()
                        .into_iter()
                        .map(|item| PatternAssociationEntry {
                            id: 0,
                            org: org.to_string(),
                            stream: stream.to_string(),
                            stream_type: stype,
                            field: item.field,
                            pattern_id: item.pattern_id,
                            policy: PatternPolicy::from(item.policy),
                            apply_at: ApplyPolicy::from(item.apply_at),
                        })
                        .collect();
                    let removed = update
                        .remove
                        .clone()
                        .into_iter()
                        .map(|item| PatternAssociationEntry {
                            id: 0,
                            org: org.to_string(),
                            stream: stream.to_string(),
                            stream_type: stype,
                            field: item.field,
                            pattern_id: item.pattern_id,
                            policy: PatternPolicy::from(item.policy),
                            apply_at: ApplyPolicy::from(item.apply_at),
                        })
                        .collect();

                    let mgr = get_pattern_manager().await?;
                    mgr.update_associations(&org, stype, &stream, update.remove, update.add)?;
                    infra::table::re_pattern_stream_map::batch_process(added, removed).await?;

                    let cluster_coordinator = get_coordinator().await;
                    cluster_coordinator
                        .put(
                            &format!("/re_pattern_associations/{org}/{stype}/{stream}"),
                            bytes::Bytes::from_owner(updates.clone()),
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
