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

pub mod cache;
pub mod execution;
mod service;
pub mod sorting;
pub mod utils;

use config::meta::{
    search::{SearchPartitionRequest, SearchPartitionResponse},
    stream::StreamType,
};
use infra::errors::Error;
pub use service::{process_search_stream_request, process_search_stream_request_multi};

use crate::cache::CacheRuntime;

/// Application capability required by streaming execution to plan query partitions.
#[async_trait::async_trait]
pub trait StreamingRuntime: CacheRuntime {
    async fn max_query_range(
        &self,
        stream_names: &[String],
        org_id: &str,
        user_id: &str,
        stream_type: StreamType,
    ) -> i64;

    async fn search_partition(
        &self,
        trace_id: &str,
        org_id: &str,
        user_id: Option<&str>,
        stream_type: StreamType,
        req: &SearchPartitionRequest,
        skip_max_query_range: bool,
        use_cache: bool,
    ) -> Result<SearchPartitionResponse, Error>;

    #[cfg(feature = "enterprise")]
    fn search_error_status(&self, error: &Error) -> u16;

    #[cfg(feature = "enterprise")]
    async fn audit(&self, message: o2_enterprise::enterprise::common::auditor::AuditMessage);
}
