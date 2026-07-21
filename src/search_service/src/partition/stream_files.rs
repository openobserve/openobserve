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

use std::cmp::max;

use chrono::Utc;
use config::{
    get_config,
    meta::{sql::TableReferenceExt, stream::StreamSettings},
};
use infra::{cache::stats, errors::Error, file_list::FileId, schema::unwrap_stream_settings};

use crate::{hooks::get_settings_max_query_range, partition::sql_context::PartitionSqlContext};

/// Result of collecting stream file information across all streams in a query.
pub struct StreamFiles {
    pub files: Vec<FileId>,
    pub records: i64,
    pub original_size: i64,
    pub max_query_range: i64,
    pub max_query_range_in_hour: i64,
}

/// For each stream in the query, either queries the actual file list or
/// estimates file metadata from stream statistics (when using single partition
/// or using approximate partitioning).
pub async fn collect_stream_files(
    trace_id: &str,
    user_id: Option<&str>,
    ctx: &PartitionSqlContext,
) -> Result<StreamFiles, Error> {
    let start = std::time::Instant::now();
    let cfg = get_config();
    let sql = &ctx.sql;
    let use_single_partition = ctx.use_single_partition;
    let org_id = &sql.org_id;
    let stream_type = sql.stream_type;
    let schemas = &sql.schemas;
    let time_range = sql.time_range;
    let query_duration_secs = (time_range.1 - time_range.0) / 1000 / 1000;

    let mut files = Vec::with_capacity(schemas.len() * 10);
    let mut max_query_range = 0;
    let mut max_query_range_in_hour = 0;

    for (stream, schema) in schemas.iter() {
        let stream_type = stream.get_stream_type(stream_type);
        let stream_name = stream.stream_name();
        let stream_settings = unwrap_stream_settings(schema.schema()).unwrap_or_default();
        let stats = stats::get_stream_stats(org_id, &stream_name, stream_type);
        let use_stream_stats_for_partition = if stream_settings == StreamSettings::default() {
            cfg.common.use_stream_settings_for_partitions_enabled
        } else {
            stream_settings.approx_partition
        };

        if !use_single_partition && !use_stream_stats_for_partition {
            let stream_files = crate::file_list::query_ids(
                trace_id,
                org_id,
                stream_type,
                &stream_name,
                time_range,
            )
            .await?;
            let settings_max_query_range =
                get_settings_max_query_range(stream_settings.max_query_range, org_id, user_id)
                    .await;
            max_query_range = max(max_query_range, settings_max_query_range * 3600 * 1_000_000);
            max_query_range_in_hour = max(max_query_range_in_hour, settings_max_query_range);
            files.extend(stream_files);
        } else {
            let data_retention = if stream_settings.data_retention > 0 {
                stream_settings.data_retention
            } else {
                cfg.compact.data_retention_days
            };
            let mut data_retention = data_retention * 24 * 60 * 60;

            // if stats.doc_time_max is 0, handle the case by using current time
            let data_end_time = if stats.doc_time_max == 0 {
                Utc::now().timestamp_micros()
            } else {
                std::cmp::min(Utc::now().timestamp_micros(), stats.doc_time_max)
            };

            let data_retention_based_on_stats = (data_end_time - stats.doc_time_min) / 1000 / 1000;

            if data_retention_based_on_stats > 0 {
                data_retention = std::cmp::min(data_retention, data_retention_based_on_stats);
            };
            if data_retention == 0 {
                log::warn!("Data retention is zero, setting to 1 to prevent division by zero");
                data_retention = 1;
            }
            let records = (stats.doc_num as i64 / data_retention) * query_duration_secs;
            let file_original_size =
                (stats.storage_size as i64 / data_retention) * query_duration_secs;
            log::info!(
                "[trace_id {trace_id}] using approximation: stream: {stream_name}, records: {records}, original_size: {file_original_size}, data_retention in seconds: {data_retention}",
            );
            files.push(FileId {
                id: Utc::now().timestamp_micros(),
                records,
                original_size: file_original_size,
                deleted: false,
            });
        }
    }

    let (records, original_size) = files.iter().fold((0, 0), |(records, original_size), f| {
        (records + f.records, original_size + f.original_size)
    });

    log::info!(
        "[trace_id {trace_id}] search_partition: get file_list time_range: {:?}, files: {}, max_query_range: {}, took: {} ms",
        time_range,
        files.len(),
        max_query_range,
        start.elapsed().as_millis() as usize,
    );
    Ok(StreamFiles {
        files,
        records,
        original_size,
        max_query_range,
        max_query_range_in_hour,
    })
}
