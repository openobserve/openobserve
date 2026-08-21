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

//! Database Monitoring read API — service layer.
//!
//! Every read this feature performs: SQL construction, the searches themselves,
//! the merge/fold/envelope math, and the authorization gates that guard them.
//! No axum extractor and no route appears here — [`super::handler`] owns that
//! boundary and delegates into these `read_*` bodies.
//!
//! What lives in `openobserve-core` instead is the code the INGEST path and the
//! rollup job need without an HTTP request: span enrichment
//! (`openobserve_core::db_monitoring`), the rollup SQL (`::rollup`) and the
//! server-vantage canonicalizers (`::server_vantage`). This module reads what
//! those write.
//!
//! ## Layout
//!
//! One module per endpoint family, the same shape `request/alerts/` and
//! `request/organization/` use, plus two that are not endpoints:
//!
//! - [`common`] — the gates, escaping, range math, the three search harnesses and the merge/fold
//!   helpers every feature below builds on;
//! - [`source`] — the source-scraping corpus the structural tests read, whose layer ORDER is
//!   load-bearing (see [`source::LAYERS`]).
//!
//! Each feature module owns its production code AND the tests that assert on
//! it. Tests that span areas live with the area they primarily assert on;
//! genuinely cross-cutting ones (the partial-guard wiring sweep) live in
//! [`common`].
//!
//! Items are `pub(super)` when a sibling feature module needs them and
//! `pub(crate)` only where [`super::handler`] does. The re-exports below are
//! what keeps `use super::service::*` working for the handler layer.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    future::Future,
};

use ::common::meta::http::HttpResponse as MetaHttpResponse;
use axum::response::Response as HttpResponse;
use config::{meta::stream::StreamType, utils::time::now_micros};
use futures::{StreamExt, future::join_all};
#[cfg(feature = "enterprise")]
use o2_openfga::config::get_config as get_openfga_config;
#[cfg(feature = "enterprise")]
use openobserve_core::auth::check_permissions;
#[cfg(feature = "enterprise")]
use openobserve_core::db_monitoring::chains;
use openobserve_core::db_monitoring::{
    rollup::{self, O2_DB_STATS_STREAM, get_i64, get_str, get_str_ref},
    server_vantage,
};
use serde_json::{Value, json};

mod activity;
mod badges;
mod blocking;
mod common;
mod databases;
mod deadlocks;
mod endpoints;
mod insights;
mod instance_metrics;
mod instances;
mod plans;
mod queries;
mod query_history;
mod samples;
mod server_metrics;
mod server_queries;
mod server_samples;
#[cfg(test)]
mod source;
mod table_health;
#[cfg(test)]
mod testutil;

pub(crate) use activity::*;
pub(crate) use badges::*;
pub(crate) use blocking::*;
pub(crate) use common::*;
pub(crate) use databases::*;
pub(crate) use deadlocks::*;
pub(crate) use endpoints::*;
pub(crate) use insights::*;
pub(crate) use instance_metrics::*;
pub(crate) use instances::*;
pub(crate) use plans::*;
pub(crate) use queries::*;
pub(crate) use query_history::*;
pub(crate) use samples::*;
pub(crate) use server_metrics::*;
pub(crate) use server_queries::*;
pub(crate) use server_samples::*;
#[cfg(test)]
pub(crate) use source::*;
// Unlike blocking/deadlocks -- which keep RawBlockingFallback/RawDeadlockFallback
// ungated because build_dbm_events_sql names them -- table_health exports nothing
// outside its enterprise gate, so on OSS this re-export is empty.
#[cfg(feature = "enterprise")]
pub(crate) use table_health::*;
