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

//! Compatibility facade for compactor statistics orchestration.

use async_trait::async_trait;
use config::meta::stream::StreamType;
pub use openobserve_compactor::stats::{
    StreamCatalog, get_yesterday_boundary, update_stats_from_file_list_for_stream,
};

struct CoreStreamCatalog;

#[async_trait]
impl StreamCatalog for CoreStreamCatalog {
    async fn list_organizations(&self) -> Vec<String> {
        crate::service::db::schema::list_organizations_from_cache().await
    }

    async fn list_streams(&self, org_id: &str, stream_type: StreamType) -> Vec<String> {
        crate::service::db::schema::list_streams_from_cache(org_id, stream_type).await
    }
}

pub async fn update_stats_from_file_list() -> Result<(), anyhow::Error> {
    openobserve_compactor::stats::update_stats_from_file_list(&CoreStreamCatalog).await
}
