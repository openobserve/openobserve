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

use bytes::Bytes;
use config::utils::json;
use infra::{
    db::{delete_from_db_coordinator, put_into_db_coordinator},
    errors::{Error, Result},
    table::org_ingestion_tokens::{self, OrgIngestionTokenRecord},
};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType};

const ORG_INGESTION_TOKENS_KEY_PREFIX: &str = "/org_ingestion_tokens/";

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::OrgIngestionTokenPut => {
            put(msg).await?;
        }
        MessageType::OrgIngestionTokenDelete => {
            delete(msg).await?;
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

async fn put(msg: Message) -> Result<()> {
    let value = msg
        .value
        .ok_or_else(|| Error::Message("Missing org ingestion token payload".to_string()))?;
    let record: OrgIngestionTokenRecord = json::from_slice(&value)?;

    if let Err(e) = org_ingestion_tokens::upsert(&record).await {
        log::error!(
            "[SUPER_CLUSTER:sync] Failed to upsert org ingestion token: {}/{}, error: {e}",
            record.org_id,
            record.name,
        );
        return Err(e);
    }

    // Mirror the originating cluster's coordinator event so local watchers
    // refresh their cache: enabled tokens are cached, disabled ones evicted.
    if record.enabled {
        let _ = put_into_db_coordinator(&msg.key, Bytes::new(), msg.need_watch, None).await;
    } else {
        let _ = delete_from_db_coordinator(&msg.key, false, true, None).await;
    }
    Ok(())
}

async fn delete(msg: Message) -> Result<()> {
    let item_key = msg
        .key
        .strip_prefix(ORG_INGESTION_TOKENS_KEY_PREFIX)
        .ok_or_else(|| Error::Message("Invalid org ingestion token key".to_string()))?;
    let (org_id, token) = item_key
        .split_once('/')
        .ok_or_else(|| Error::Message("Invalid org ingestion token key".to_string()))?;

    if let Err(e) = org_ingestion_tokens::remove_by_token(org_id, token).await {
        log::error!(
            "[SUPER_CLUSTER:sync] Failed to delete org ingestion token: {org_id}/{token}, error: {e}"
        );
        return Err(e);
    }

    let _ = delete_from_db_coordinator(&msg.key, false, true, None).await;
    Ok(())
}
