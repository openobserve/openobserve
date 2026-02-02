// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Super-cluster queue processor for service discovery synchronization.
//!
//! Synchronizes discovered services and their telemetry streams across regions:
//! - Service metadata (dimensions, correlation keys)
//! - Associated log/metric/trace streams
//! - Service topology information
//!
//! Enables complete service discovery view across all regions.

use infra::{errors::Result, table::service_streams};
use o2_enterprise::enterprise::super_cluster::queue::{Message, ServiceStreamsMessage};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let msg = msg.try_into().map_err(|e| {
        infra::errors::Error::Message(format!("[SERVICE_STREAMS] Failed to deserialize: {}", e))
    })?;
    process_msg(msg).await
}

pub(crate) async fn process_msg(msg: ServiceStreamsMessage) -> Result<()> {
    match msg {
        ServiceStreamsMessage::Put { record } => {
            log::debug!(
                "[SUPER_CLUSTER:service_streams] Put service org={} key={}",
                record.org_id,
                record.service_key
            );
            let org_id = record.org_id.clone();
            service_streams::put(record).await?;
            infra::coordinator::service_streams::emit_put_event(&org_id).await?;
        }
        ServiceStreamsMessage::Delete {
            org_id,
            service_key,
        } => {
            log::debug!(
                "[SUPER_CLUSTER:service_streams] Delete service org={} key={}",
                org_id,
                service_key
            );
            service_streams::delete(&org_id, &service_key).await?;
            infra::coordinator::service_streams::emit_delete_event(&org_id, &service_key).await?;
        }
    }
    Ok(())
}
