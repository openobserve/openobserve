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

//! Database Monitoring read HTTP API (design: `db-monitoring/dbm-design-doc.md` §6).
//!
//! Split along the crate's handler / service / model layering, the same shape
//! `request/alerts/`, `request/organization/` and every other multi-file feature
//! in this crate uses:
//!
//! - [`handler`] — the 17 axum handlers, each a config guard plus a delegation (three are
//!   cfg-dual-implemented, so the file holds 20 fn definitions);
//! - [`service`] — every read: SQL construction, the searches, the merge and envelope math, and the
//!   authorization gates;
//! - [`models`] — the 17 `*Query` structs the routes deserialize into.
//!
//! `db-monitoring/*.md` citations throughout DBM refer to the internal design
//! repository, not to a path in this tree.
//!
//! The handlers live here, in the API layer, rather than beside the enrichment
//! and rollup code in `openobserve-core`. Every other HTTP handler in the
//! codebase is in an `openobserve-api-*` crate, and only from here can they use
//! the standard [`openobserve_api_common::extractors::Headers`]`<UserEmail>`
//! extractor — `openobserve-api-common` depends on `openobserve-core`, so a
//! handler inside core cannot import it without inverting the layering.
//!
//! What stays in core is everything that is not HTTP: span enrichment
//! (`openobserve_core::db_monitoring`), the rollup job's SQL
//! (`::db_monitoring::rollup`) and the server-vantage canonicalizers
//! (`::db_monitoring::server_vantage`), all of which the ingest path and the
//! rollup job use without going through a handler.

pub mod handler;
pub mod models;
pub mod service;
