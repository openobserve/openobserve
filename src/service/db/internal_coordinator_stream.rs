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

use config::cluster::LOCAL_NODE;
use infra::cluster_coordinator::events::InternalCoordinatorEvent;

pub async fn handle_internal_coordinator_event(payload: Vec<u8>) -> Result<(), anyhow::Error> {
    let event: InternalCoordinatorEvent = match serde_json::from_slice(&payload) {
        Ok(event) => event,
        Err(e) => {
            log::error!("Error deserializing internal coordinator event: {}", e);
            return Err(anyhow::anyhow!(
                "Error deserializing internal coordinator event: {}",
                e
            ));
        }
    };
    match event {
        InternalCoordinatorEvent::EnrichmentTable(event) => {
            if LOCAL_NODE.is_ingester() || LOCAL_NODE.is_querier() || LOCAL_NODE.is_alert_manager()
            {
                super::enrichment_table::handle_enrichment_table_event(event).await
            } else {
                Ok(())
            }
        }
        InternalCoordinatorEvent::Schema(event) => {
            if LOCAL_NODE.is_ingester() || LOCAL_NODE.is_querier() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_SCHEMA_EVENT] handling schema event: {:?}",
                    event
                );
                super::schema::handle_schema_event(event).await
            } else {
                Ok(())
            }
        }
    }
}
