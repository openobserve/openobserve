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

//! Closed metrics window under a downsampling rule: every file is aggregated in one batch.

use config::meta::{promql::DownsamplingRule, stream::FileKey};
use search::merge::MergeMode;

use super::RoundPlan;

/// Downsampling aggregates the whole window, full-sized files included.
pub(super) const READS_WHOLE_WINDOW: bool = true;

pub(super) fn plan(files: Vec<FileKey>, rule: &DownsamplingRule) -> RoundPlan {
    RoundPlan::last(vec![(files, MergeMode::Downsampling(rule.clone()))])
}
