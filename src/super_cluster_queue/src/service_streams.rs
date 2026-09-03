// Copyright 2026 OpenObserve Inc.
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
//! - Service metadata (service name, disambiguation fields)
//! - Associated log/metric/trace streams
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
                "[SUPER_CLUSTER:service_streams] Put service org={} name={}",
                record.org_id,
                record.service_name
            );
            let org_id = record.org_id.clone();
            // Orphan disambiguations are irrelevant here: the put event below makes this
            // cluster's nodes reload the org's services wholesale (F19).
            let outcome = service_streams::put(
                &org_id,
                *record,
                service_streams::DEFAULT_MAX_STREAMS_PER_TYPE,
            )
            .await?;
            // A no-op put must not make every node re-read the org's whole table.
            if outcome.changed {
                // Never propagate: a redelivered apply re-derives changed=false, losing the emit.
                for attempt in 1..=3u8 {
                    match infra::coordinator::service_streams::emit_put_event(&org_id).await {
                        Ok(()) => break,
                        Err(e) if attempt == 3 => log::error!(
                            "[SUPER_CLUSTER:service_streams] emit_put_event failed after {attempt} attempts: org={org_id} error={e}"
                        ),
                        Err(_) => tokio::time::sleep(std::time::Duration::from_millis(500)).await,
                    }
                }
            }
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
            service_streams::delete_all(&org_id).await?;
            // Org-scope reload: the delete wiped the whole org's rows, so a per-service
            // delete event would evict only one cache key on this cluster's nodes (F6).
            infra::coordinator::service_streams::emit_reload_event(&org_id).await?;
        }
    }
    Ok(())
}
