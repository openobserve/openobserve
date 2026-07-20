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

//! Query-service planning, result processing, and asynchronous search jobs.
//!
//! The DataFusion query engine remains in `search`; application composition
//! stays in `openobserve-core` and is injected through narrow ports.

use std::sync::{Arc, LazyLock, OnceLock};

use config::meta::{search, stream::StreamType};
use infra::errors::Error;

pub mod cache;
pub mod cardinality;
pub mod cluster;
pub mod grpc;
pub mod grpc_search;
pub mod grpc_server;
#[cfg(feature = "enterprise")]
pub mod jobs;
pub mod partition;
pub mod promql;
pub mod query_utils;
pub mod repository;
mod searcher;
pub mod service;
pub mod streaming;
#[cfg(feature = "enterprise")]
pub mod super_cluster;
pub mod work_group;

pub use searcher::Searcher;

pub static SEARCH_SERVER: LazyLock<Searcher> = LazyLock::new(Searcher::new);

#[async_trait::async_trait]
pub trait GrpcRuntime:
    partition::PartitionRuntime + streaming::StreamingRuntime + Send + Sync
{
    async fn enrichment_table_start_time(&self, org_id: &str, stream_name: &str) -> i64;

    async fn query_file_keys_by_ids(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        time_range: Option<(i64, i64)>,
        ids: &[i64],
    ) -> Result<Vec<config::meta::stream::FileKey>, Error>;

    async fn calculate_files_size(
        &self,
        files: &[config::meta::stream::FileKey],
    ) -> Result<search::ScanStats, Error>;

    async fn tantivy_index_updated_at(&self) -> i64;

    async fn tantivy_secondary_index_updated_at(&self) -> i64;

    async fn cached_search(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        user_id: Option<String>,
        req: &search::Request,
    ) -> Result<search::Response, Error>;

    async fn search_multi(
        &self,
        trace_id: &str,
        org_id: &str,
        stream_type: StreamType,
        user_id: Option<String>,
        req: &search::MultiStreamRequest,
    ) -> Result<search::Response, Error>;

    async fn cancel_query(
        &self,
        org_id: &str,
        trace_id: &str,
    ) -> Result<search::CancelQueryResponse, Error>;

    #[cfg(feature = "enterprise")]
    async fn enrich_query_status(&self, status: &mut [proto::cluster_rpc::QueryStatus]);
}

static GRPC_RUNTIME: OnceLock<Arc<dyn GrpcRuntime>> = OnceLock::new();

pub fn install_grpc_runtime(runtime: Arc<dyn GrpcRuntime>) -> Result<(), &'static str> {
    GRPC_RUNTIME
        .set(runtime)
        .map_err(|_| "search gRPC runtime is already installed")
}

fn grpc_runtime() -> Result<&'static Arc<dyn GrpcRuntime>, tonic::Status> {
    GRPC_RUNTIME
        .get()
        .ok_or_else(|| tonic::Status::failed_precondition("search gRPC runtime is not installed"))
}
