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

mod histogram;
mod regular_partition;
pub mod settings;

use config::meta::sql::OrderBy;
use histogram::generate_partitions_aligned_with_histogram_interval;
use regular_partition::generate_partitions_with_mini_partition;
pub use settings::{PartitionSettings, PartitionSettingsInput, calculate_partition_settings};

pub struct PartitionSpec {
    pub start_time: i64,
    pub end_time: i64,
    pub histogram_interval: Option<i64>,
    pub is_complex_query: bool,
    pub order_by: OrderBy,
}

pub fn generate_partitions(
    spec: &PartitionSpec,
    settings: &PartitionSettings,
    mini_partition_duration_secs: u64,
) -> Vec<[i64; 2]> {
    if spec.histogram_interval.is_some() {
        generate_partitions_aligned_with_histogram_interval(
            spec.start_time,
            spec.end_time,
            settings.step,
            spec.order_by,
            settings.min_step,
        )
    } else if spec.is_complex_query {
        vec![[spec.start_time, spec.end_time]]
    } else {
        generate_partitions_with_mini_partition(
            spec.start_time,
            spec.end_time,
            settings.step,
            spec.order_by,
            mini_partition_duration_secs,
        )
    }
}
