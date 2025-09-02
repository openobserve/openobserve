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

use infra::errors::{Error, Result};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType};

use crate::service::db::enrichment_table::{ENRICHMENT_TABLE_META_STREAM_STATS_KEY, notify_update};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let db = infra::db::get_db().await;
    match msg.message_type {
        MessageType::Put => {
            db.put(&msg.key, msg.value.unwrap(), msg.need_watch, None)
                .await?;
            // hack: notify the nodes to update the meta table stats
            if msg.key.starts_with(ENRICHMENT_TABLE_META_STREAM_STATS_KEY) {
                log::debug!("enrichment table meta stream stats key: {}", msg.key);
                let key_parts = msg.key.split('/').collect::<Vec<&str>>();
                if key_parts.len() != 4 {
                    log::error!(
                        "enrichment table meta stream stats key is not valid: {}",
                        msg.key
                    );
                    return Ok(());
                }
                // Format is /enrichment_table_meta_stream_stats/{org_id}/{name}
                let org_id = key_parts[2];
                let name = key_parts[3];
                if let Err(e) = notify_update(org_id, name).await {
                    log::error!(
                        "super cluster meta queue enrichment table notify_update error: {e:?}"
                    );
                }
            }
        }
        MessageType::Delete(with_prefix) => {
            db.delete(&msg.key, with_prefix, msg.need_watch, None)
                .await?;
            if msg.key.starts_with(ENRICHMENT_TABLE_META_STREAM_STATS_KEY) {
                log::debug!("enrichment table meta stream stats key: {}", msg.key);
                let key_parts = msg.key.split('/').collect::<Vec<&str>>();
                if key_parts.len() != 4 {
                    log::error!(
                        "enrichment table meta stream stats delete key is not valid: {}",
                        msg.key
                    );
                    return Ok(());
                }
                // Format is /enrichment_table_meta_stream_stats/{org_id}/{name}
                // We need to delete the db data for enrichment table because it is deleted
                let org_id = key_parts[2];
                let name = key_parts[3];
                if let Err(e) =
                    crate::service::enrichment::storage::database::delete(org_id, name).await
                {
                    log::error!("delete enrichment table db data error: {e:?}");
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
