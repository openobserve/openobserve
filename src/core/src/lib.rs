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
pub use openobserve_alerts::anomaly_detection;
pub use openobserve_organization::{auth, authz};
pub mod bootstrap;
pub mod cluster_info;
pub mod dashboards;
pub mod db;
pub use openobserve_enrichment::{enrichment, enrichment_table};
pub mod file_downloader;
pub use openobserve_dashboards::folders;
pub use openobserve_search_service::file_list;
pub use openobserve_transform::management as functions;
pub mod grpc {
    pub use openobserve_ingestion::internal::get_ingester_channel;
}
pub mod http;
pub mod ingestion;
pub mod ingestion_tokens {
    pub use openobserve_ingestion::tokens::*;
}
pub mod ingestion_types {
    pub use openobserve_ingestion::types::*;
}
pub use ::common::kv;
pub use openobserve_ingestion::{logs, metadata, metrics};
pub mod node;
#[cfg(feature = "enterprise")]
pub use openobserve_organization::ofga;
#[cfg(feature = "enterprise")]
pub use openobserve_organization::org_storage_providers;
#[cfg(feature = "cloud")]
pub use openobserve_organization::org_usage;
pub use openobserve_organization::{org_cleanup, organization};
pub mod pipeline {
    pub use openobserve_pipeline::management::*;

    pub use crate::pipeline_adapter::install_record_sink;
}
mod pipeline_adapter;
pub use openobserve_search_service::promql;
#[cfg(feature = "enterprise")]
pub mod ratelimit;
pub mod runtime_metrics;
pub use openobserve_ingestion::schema;
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
            openobserve_search_service::grpc_search::grpc_search(
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
            openobserve_search_service::grpc_search::grpc_search_partition(
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
pub use openobserve_self_reporting as self_reporting;
mod self_reporting_adapter;
mod service;
pub use openobserve_organization::session;
pub mod short_url {
    pub use common::short_url::*;
}
pub use openobserve_catalog::stream;
pub use openobserve_search_service::{sourcemaps, stream_utils};
pub mod tls;
pub use openobserve_ingestion::traces;
#[cfg(feature = "cloud")]
pub use openobserve_organization::trial_quota;
pub use openobserve_organization::users;
mod organization_adapter;
mod transform_adapter;

/// Private import namespace retained while core's remaining composition modules are migrated to
/// their owning crates. It is intentionally not part of the public API.
mod common {
    pub mod meta {
        pub use ::common::meta::*;
    }

    pub mod infra {
        pub mod config {
            pub use ::common::infra::config::*;
        }
    }
}
