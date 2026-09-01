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

//! Fused evaluation of `agg(range_func(...))`: range-function values fold
//! straight into dense per-group accumulators, skipping the generic
//! evaluator's intermediate per-series materialization.

mod accumulator;
mod eval;
mod op;
mod streaming;

pub(crate) use eval::fused_range_agg;
pub(crate) use op::FusedAggOp;
pub(crate) use streaming::{FusedShape, StreamingSelector, streaming_fused_agg};
