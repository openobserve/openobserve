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

//! Applies public dashboard link rows replicated from the region a publisher edited in.
//!
//! The apply never goes through the link service, which would publish again and loop between
//! regions; the one exception is a local write that wins a tie of equal revisions, which is sent
//! once more under a new revision so both regions converge. Result files are region-local.

use infra::errors::{Error, Result};
use o2_enterprise::enterprise::super_cluster::queue::{
    Message, MessageType, PublicDashboardsMessage,
};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::PublicDashboardsTable => process_msg(msg.try_into()?).await,
        _ => {
            log::error!(
                "[SUPER_CLUSTER:DB] public_dashboards: invalid message type {:?} key {}",
                msg.message_type,
                msg.key
            );
            Err(Error::Message("Invalid message type".to_string()))
        }
    }
}

async fn process_msg(msg: PublicDashboardsMessage) -> Result<()> {
    match msg {
        PublicDashboardsMessage::Put {
            org_id,
            origin,
            json,
        } => openobserve_core::public_dashboards::replication::apply(&json, &origin)
            .await
            .map_err(|e| Error::Message(format!("public dashboard link of org {org_id}: {e}"))),
    }
}
