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

pub mod aggregate;
pub mod cpu_cores;
pub mod histogram;
pub mod regular_partition;
pub mod settings;
pub mod sql_context;
pub mod stream_files;

use config::get_config;

use crate::partition::{
    histogram::generate_partitions_aligned_with_histogram_interval,
    regular_partition::generate_partitions_with_mini_partition, settings::PartitionSettings,
    sql_context::PartitionSqlContext,
};

/// Generate partitions for a time range derived from the SQL context.
///
/// # Returns
/// Vector of [start, end] time ranges in microseconds
pub fn generate_partitions(
    ctx: &PartitionSqlContext,
    partition_settings: &PartitionSettings,
) -> Vec<[i64; 2]> {
    let (start_time, end_time) = ctx.sql.time_range;
    let order_by = ctx.sql_order_by;
    let step = partition_settings.step;
    let min_step = partition_settings.min_step;

    if ctx.sql.histogram_interval.is_some() {
        generate_partitions_aligned_with_histogram_interval(
            start_time, end_time, step, order_by, min_step,
        )
    } else if ctx.is_complex_query {
        vec![[start_time, end_time]]
    } else {
        let mini_partition_duration_secs = get_config().limit.search_mini_partition_duration_secs;
        generate_partitions_with_mini_partition(
            start_time,
            end_time,
            step,
            order_by,
            mini_partition_duration_secs,
        )
    }
}
