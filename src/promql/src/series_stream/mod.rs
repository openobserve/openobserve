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

//! Sources that deliver a query's series one at a time, so a consumer can
//! evaluate and drop each series without holding the full set: the matrix
//! producer adapts an already-materialized matrix, and ordered-scan producers
//! plug in behind the same contract.

pub(crate) mod matrix;

use config::meta::promql::value::{Labels, Sample};
use datafusion::error::Result;

/// One partition's series, delivered whole and grouped under a signature.
///
/// Protocol per series: `advance` yields the group signature, `labels` may be
/// read while the series is current, `consume` takes its samples and moves on.
pub(crate) trait SeriesSource: Send {
    fn advance(&mut self) -> impl Future<Output = Result<Option<u64>>> + Send;
    /// Group labels of the current series; valid only before `consume`.
    fn labels(&self) -> Labels;
    /// Time-ordered samples of the current series.
    fn consume(&mut self) -> impl Future<Output = Result<&[Sample]>> + Send;
}
