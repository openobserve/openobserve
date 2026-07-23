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

pub mod alerts;
#[cfg(feature = "enterprise")]
pub mod anomaly_detection;
pub mod auth;
pub mod authz;
pub mod bootstrap;
pub mod cache;
pub mod cluster_info;
pub mod dashboards;
use ::common;
use ::db;
pub mod error_suggest;
use ::db::folders;
pub mod functions;
pub mod functions_cache;
pub mod github;
pub mod grpc;
pub mod http;
pub mod ingestion;
pub mod ingestion_tokens;
pub mod kv;
#[cfg(feature = "enterprise")]
pub mod llm_evaluations;
pub mod logs;
pub mod metadata;
pub mod metrics;
pub mod model_pricing;
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
#[cfg(feature = "enterprise")]
pub mod providers;
#[cfg(feature = "enterprise")]
pub mod ratelimit;
pub mod runtime_metrics;
pub mod schema_watcher;
use search_service as search;
pub mod self_reporting;
pub mod service;
pub mod session;
pub mod short_url;
pub mod sourcemaps;
pub mod stream;
pub mod stream_utils;
pub mod synthetics;
pub mod system_settings;
pub use tantivy_utils::index_builder as tantivy;
pub mod tls;
pub mod traces;
#[cfg(feature = "cloud")]
pub mod trial_quota;
pub mod users;
#[cfg(feature = "enterprise")]
pub mod workflows;
