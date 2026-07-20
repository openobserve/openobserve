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

pub mod cache;
#[cfg(feature = "enterprise")]
pub mod jobs;
pub mod partition;
pub mod promql;
pub mod repository;
pub mod streaming;
