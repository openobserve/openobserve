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

//! Applies status-page metadata replicated from the region a user edited in.
//!
//! Everything here goes through the RAW `infra::table::status_pages` layer on
//! purpose — never the enterprise service layer, which re-publishes and would
//! loop the message between regions forever (the same anti-loop rule the
//! synthetics applier follows).
//!
//! `password_hash` is applied verbatim: an Argon2id PHC string is a one-way,
//! self-contained KDF output with no region-local key, so — unlike the
//! synthetics `secrets` column — it needs no re-encryption on apply.
//!
//! Snapshots are NOT replicated; each region's rebuilder recomputes them from
//! this replicated metadata, so nothing here touches `status_page_snapshots`.
//!
//! Applies are idempotent (the queue redelivers): upsert is last-write-wins by
//! primary key, delete is a delete, component-replace is wholesale.

use infra::{
    errors::{Error, Result},
    table::status_pages as table,
};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType, StatusPagesMessage};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::StatusPagesTable => process_msg(msg.try_into()?).await,
        _ => {
            log::error!(
                "[SUPER_CLUSTER:DB] status_pages: invalid message type {:?} key {}",
                msg.message_type,
                msg.key
            );
            Err(Error::Message("Invalid message type".to_string()))
        }
    }
}

async fn process_msg(msg: StatusPagesMessage) -> Result<()> {
    match msg {
        StatusPagesMessage::Upsert {
            org_id,
            table: tbl,
            json,
        } => table::apply_upsert(&org_id, &tbl, &json).await,
        StatusPagesMessage::Delete {
            org_id,
            table: tbl,
            id,
        } => table::apply_delete(&org_id, &tbl, &id).await,
        StatusPagesMessage::ReplaceComponents {
            org_id,
            page_id,
            json,
        } => table::apply_replace_components(&org_id, &page_id, &json).await,
    }
}
