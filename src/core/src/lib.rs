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

//! Core application services extracted from the production frontend crate.

#![recursion_limit = "256"]

#[cfg(feature = "enterprise")]
pub use ::search::cipher;

pub mod alerts;
#[cfg(feature = "enterprise")]
pub mod anomaly_detection;
pub mod auth;
pub mod authz;
pub mod bootstrap;
pub mod cluster_info;
pub mod dashboards;
pub mod db;
pub mod enrichment;
pub mod enrichment_table;
pub mod file_downloader;
pub mod file_list;
pub mod folders;
pub mod functions;
pub mod github;
pub mod grpc;
pub mod http;
pub mod ingestion;
pub mod ingestion_tokens {
    pub use openobserve_ingestion::tokens::*;
}
pub mod ingestion_types {
    pub use openobserve_ingestion::types::*;
}
pub mod kv;
#[cfg(feature = "enterprise")]
pub mod llm_evaluations;
pub mod logs;
pub mod metadata;
pub mod metrics;
pub mod node;
#[cfg(feature = "enterprise")]
pub mod ofga;
pub mod org_cleanup;
#[cfg(feature = "enterprise")]
pub mod org_storage_providers;
#[cfg(feature = "cloud")]
pub mod org_usage;
pub mod organization;
pub mod pipeline;
pub mod promql;
#[cfg(feature = "enterprise")]
pub mod providers;
#[cfg(feature = "enterprise")]
pub mod ratelimit;
pub mod runtime_metrics;
pub mod schema;
pub mod search;
#[cfg(feature = "enterprise")]
pub mod search_jobs {
    use async_trait::async_trait;
    use config::meta::{
        cluster::RoleGroup,
        search::{Request, Response, SearchPartitionRequest, SearchPartitionResponse},
        stream::StreamType,
    };
    use infra::errors::Error;
    use openobserve_search_service::jobs::SearchExecutor;

    struct CoreSearchExecutor;

    #[async_trait]
    impl SearchExecutor for CoreSearchExecutor {
        async fn search(
            &self,
            trace_id: &str,
            org_id: &str,
            stream_type: StreamType,
            user_id: Option<String>,
            req: &Request,
            role_group: Option<RoleGroup>,
        ) -> Result<Response, Error> {
            crate::search::grpc_search::grpc_search(
                trace_id,
                org_id,
                stream_type,
                user_id,
                req,
                role_group,
            )
            .await
        }

        async fn search_partition(
            &self,
            trace_id: &str,
            org_id: &str,
            stream_type: StreamType,
            req: &SearchPartitionRequest,
            role_group: Option<RoleGroup>,
            skip_max_query_range: bool,
        ) -> Result<SearchPartitionResponse, Error> {
            crate::search::grpc_search::grpc_search_partition(
                trace_id,
                org_id,
                stream_type,
                req,
                role_group,
                skip_max_query_range,
            )
            .await
        }
    }

    pub async fn run(id: i64) -> Result<(), anyhow::Error> {
        openobserve_search_service::jobs::run(id, &CoreSearchExecutor).await
    }

    pub use openobserve_search_service::jobs::{
        delete_jobs, delete_org_result_files, delete_result, get_result, merge_response,
    };
}
pub mod self_reporting;
mod service;
pub mod session;
pub mod short_url {
    pub use common::short_url::*;
}
pub mod sourcemaps;
pub mod stream;
pub mod stream_utils;
pub mod synthetics;
pub mod tls;
pub mod traces;
#[cfg(feature = "cloud")]
pub mod trial_quota;
pub mod users;

/// Private import namespace retained while core's remaining composition modules are migrated to
/// their owning crates. It is intentionally not part of the public API.
mod common {
    pub mod meta {
        pub use ::common::meta::*;
        pub use openobserve_ingestion::types as ingestion;

        /// Lives here rather than in the `common` crate so that `common` does not
        /// depend on the `search` crate.
        pub mod search {
            pub use ::search::{
                AuditContext, CachedQueryResponse, MultiCachedQueryResponse, QueryDelta,
                SearchResultType,
            };
        }
    }

    pub mod infra {
        pub use ::common::infra::wal;

        pub mod config {
            pub use ::common::infra::config::*;
            pub use openobserve_alerts::REALTIME_ALERT_TRIGGERS;
        }

        #[cfg(feature = "enterprise")]
        pub use crate::ofga;
    }

    pub mod utils {
        pub use ::common::utils::*;

        pub use crate::{auth, stream_utils as stream};
    }
}
