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

pub mod mcp;
pub mod ratelimit;

pub use openobserve_api_ingest::request::{
    CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO, clusters, logs, metrics, rum,
};
#[cfg(feature = "cloud")]
pub use openobserve_api_management::request::cloud;
#[cfg(feature = "profiling")]
pub use openobserve_api_management::request::profiling;
#[cfg(feature = "enterprise")]
pub use openobserve_api_management::request::{
    action_server, domain_management, eval_jobs, license, providers, score_configs, scorers,
};
pub use openobserve_api_management::request::{
    actions, gen_ai, keys, kv, model_pricing, service_accounts, service_streams, short_url,
    sourcemaps, status, stream, synthetics,
};
#[cfg(feature = "enterprise")]
pub use openobserve_api_management::request::{ai, anomaly_detection, workflows};
#[cfg(feature = "enterprise")]
pub use openobserve_api_pipelines::request::re_pattern;
pub use openobserve_api_pipelines::request::{enrichment_table, functions, pipeline, pipelines};
pub use openobserve_api_search::search::patterns;
