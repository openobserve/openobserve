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

//! SLO measurement — Feature 5 (`alerts_2.md` §6b).
//!
//! The shape of this module follows from one decision: slices publish
//! **at-least-once**, like every other stream in the product (D64). There is
//! no publication protocol, no commit barrier and no manifest. What makes that
//! safe is three things that each earn their place for reasons unrelated to
//! torn batches — a forward-only watermark, latest-revision dedupe, and
//! coverage gating — plus reconciliation, which rebuilds the running aggregate
//! from the slices that are the source of truth.
//!
//! The pass logic is deliberately split so the arithmetic can be tested
//! without a search cluster:
//!
//! * [`query`] builds the bucketed SQL — one aggregate per pass, never one per slice;
//! * [`ingest`] turns query rows into slices and status deltas, and is pure;
//! * [`job`] is the IO shell: load, search, write, commit, reschedule.

pub mod backfill;
pub mod evaluate;
pub mod ingest;
pub mod job;
pub mod query;
pub mod reconcile;
pub mod service;
pub mod writer;
