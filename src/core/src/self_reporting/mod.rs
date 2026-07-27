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

#[cfg(feature = "cloud")]
pub mod cloud_events;
#[cfg(feature = "enterprise")]
pub mod evaluator_schema;
mod ingestion;
#[cfg(feature = "enterprise")]
pub mod llm_scores_schema;
pub(crate) mod persistence;
pub mod search;
mod triggers_schema;
mod usage_schema;

#[cfg(feature = "cloud")]
pub use ingestion::ingest_data_retention_usages;

#[cfg(feature = "enterprise")]
pub struct CoreAuditPublisher;

#[cfg(feature = "enterprise")]
#[async_trait::async_trait]
impl audit::AuditPublisher for CoreAuditPublisher {
    async fn publish(
        &self,
        request: proto::cluster_rpc::IngestionRequest,
    ) -> Result<proto::cluster_rpc::IngestionResponse, anyhow::Error> {
        crate::ingestion::ingestion_service::ingest(request)
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))
    }
}
