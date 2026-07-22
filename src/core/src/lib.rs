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
pub mod cache;
pub mod cluster_info;
pub mod compact;
pub mod dashboards;
pub mod db;
pub mod enrichment;
pub mod enrichment_table;
pub mod file_downloader;
pub mod file_list;
pub mod file_list_dump;
pub mod folders;
pub mod functions;
pub mod github;
pub mod grpc;
pub mod http;
#[cfg(feature = "enterprise")]
pub mod incidents;
pub mod ingestion;
pub mod ingestion_tokens;
pub mod ingestion_types;
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
pub mod search_jobs;
pub mod self_reporting;
pub mod service;
pub mod session;
pub mod short_url;
pub mod sourcemaps;
pub mod stream;
pub mod stream_utils;
pub mod synthetics;
pub mod tantivy;
pub mod tls;
pub mod traces;
#[cfg(feature = "cloud")]
pub mod trial_quota;
pub mod users;
#[cfg(feature = "enterprise")]
pub mod workflows;

/// Compatibility namespace for the common crate. Authentication and stream-query helpers remain
/// available at their historical paths while their service-backed implementations live in the
/// service layer.
pub mod common {
    pub mod meta {
        pub use ::common::meta::*;

        pub use crate::service::ingestion_types as ingestion;

        /// Lives here rather than in the `common` crate so that `common` does not
        /// depend on the `search` crate.
        pub mod search {
            pub use ::search::{
                AuditContext, CAPPED_RESULTS_MSG, CacheQueryRequest, CachedQueryResponse,
                MultiCachedQueryResponse, QueryDelta, ResultCacheSelectionStrategy,
                SearchResultType, SortStrategy,
            };
        }
    }

    pub mod infra {
        pub use ::common::infra::{cluster, wal};

        pub mod config {
            pub use ::common::infra::config::*;

            pub use crate::service::cache::{REALTIME_ALERT_TRIGGERS, STREAM_EXECUTABLE_PIPELINES};
        }

        #[cfg(feature = "enterprise")]
        pub use crate::service::ofga;
    }

    pub mod utils {
        pub use ::common::utils::*;

        pub use crate::service::{auth, stream_utils as stream};
    }
}
