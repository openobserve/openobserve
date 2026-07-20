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

//! Compaction-owned repositories and write-side helpers.
//!
//! Merge/search orchestration remains in the composition layer until its
//! schema and query dependencies are expressed as explicit ports.

pub mod deleted;
pub mod dump;
pub mod file_list_dump;
pub mod flatten;
mod flatten_key;
pub mod incremental;
mod metadata;
pub mod repository;
pub mod retention;
pub mod stats;
pub mod worker;

pub(crate) fn is_past_hour(offset: i64) -> bool {
    use chrono::{DateTime, Datelike, Duration, TimeZone, Timelike, Utc};

    let time_now: DateTime<Utc> = Utc::now();
    let time_now_hour = Utc
        .with_ymd_and_hms(
            time_now.year(),
            time_now.month(),
            time_now.day(),
            time_now.hour(),
            0,
            0,
        )
        .unwrap()
        .timestamp_micros();
    offset < time_now_hour
        && time_now.timestamp_micros() - offset
            > Duration::try_seconds(config::get_config().limit.max_file_retention_time as i64)
                .unwrap()
                .num_microseconds()
                .unwrap()
                * 3
}
