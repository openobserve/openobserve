// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use chrono::{DateTime, TimeZone, Utc};

use crate::infra::cache;
use crate::meta::StreamType;
use crate::service::db;

pub async fn delete_by_stream(
    lifecycle_end: &str,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    // get schema
    let stats = cache::stats::get_stream_stats(org_id, stream_name, stream_type);
    let created_at = stats.doc_time_min;
    if created_at == 0 {
        return Ok(()); // no data, just skip
    }
    let created_at: DateTime<Utc> = Utc.timestamp_nanos(created_at * 1000);
    let lifecycle_start = created_at.format("%Y-%m-%d").to_string();
    let lifecycle_start = lifecycle_start.as_str();
    if lifecycle_start.ge(lifecycle_end) {
        return Ok(()); // created_at is after lifecycle_end, just skip
    }

    // delete files
    db::compact::retention::delete_stream(
        org_id,
        stream_name,
        stream_type,
        Some((lifecycle_start, lifecycle_end)),
    )
    .await
}
