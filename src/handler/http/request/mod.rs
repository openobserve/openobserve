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

pub mod actions;
#[cfg(feature = "enterprise")]
pub mod ai;
pub mod alerts;
pub mod authz;
#[cfg(feature = "cloud")]
pub mod cloud;
pub mod clusters;
pub mod dashboards;
#[cfg(feature = "enterprise")]
pub mod domain_management;
pub mod enrichment_table;
#[allow(deprecated)]
pub mod folders;
pub mod functions;
pub mod keys;
pub mod kv;
#[cfg(feature = "enterprise")]
pub mod license;
pub mod logs;
pub mod mcp;
pub mod metrics;
pub mod organization;
#[cfg(feature = "enterprise")]
pub mod patterns;
pub mod pipeline;
pub mod pipelines;
pub mod promql;
pub mod ratelimit;
#[cfg(feature = "enterprise")]
pub mod re_pattern;
pub mod rum;
pub mod saml;
#[cfg(feature = "enterprise")]
pub mod script_server;
pub mod search;
pub mod service_accounts;
pub mod short_url;
pub mod status;
pub mod stream;
pub mod traces;
pub mod users;

pub const CONTENT_TYPE_JSON: &str = "application/json";
pub const CONTENT_TYPE_PROTO: &str = "application/x-protobuf";
