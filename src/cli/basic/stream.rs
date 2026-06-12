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

use chrono::{DateTime, Utc};
use config::{
    meta::stream::{ALL_STREAM_TYPES, StreamType},
    utils::json,
};
use infra::schema::unwrap_stream_settings;

use crate::service::db;

/// Reset the `index_updated_at` field in stream settings.
///
/// - `stream`: optional, format `org/stream_type/stream_name`. When empty, all streams across all
///   organizations are processed.
/// - `time`: optional microseconds timestamp to set. When `None`, the stream's earliest data date
///   (from file_list) is used, converted to microseconds.
pub async fn reset_index_updated_at(stream: &str, time: Option<i64>) -> Result<(), anyhow::Error> {
    let streams = if stream.trim().is_empty() {
        // load the schema cache so we can enumerate all streams from it
        db::schema::cache().await?;
        let mut all = Vec::new();
        for org_id in db::schema::list_organizations_from_cache().await {
            for stream_type in ALL_STREAM_TYPES {
                for stream_name in db::schema::list_streams_from_cache(&org_id, stream_type).await {
                    all.push((org_id.clone(), stream_type, stream_name));
                }
            }
        }
        all
    } else {
        let parts = stream.splitn(3, '/').collect::<Vec<&str>>();
        if parts.len() != 3 {
            return Err(anyhow::anyhow!(
                "invalid stream [{stream}], expected format: org/stream_type/stream_name"
            ));
        }
        vec![(
            parts[0].to_string(),
            StreamType::from(parts[1]),
            parts[2].to_string(),
        )]
    };

    println!("found {} stream(s) to reset", streams.len());

    for (org_id, stream_type, stream_name) in streams {
        let updated_at = match time {
            Some(t) => t,
            None => match min_date_micros(&org_id, stream_type, &stream_name).await? {
                Some(ts) => ts,
                None => {
                    println!("skip {org_id}/{stream_type}/{stream_name}: no data in file_list");
                    continue;
                }
            },
        };

        let Ok(schema) = infra::schema::get(&org_id, &stream_name, stream_type).await else {
            println!("skip {org_id}/{stream_type}/{stream_name}: schema not found");
            continue;
        };
        let mut settings = unwrap_stream_settings(&schema).unwrap_or_default();
        settings.index_updated_at = updated_at;
        settings.index_fields_updated_at.clear();

        let mut metadata = schema.metadata().clone();
        metadata.insert("settings".to_string(), json::to_string(&settings)?);
        db::schema::update_setting(&org_id, &stream_name, stream_type, metadata).await?;

        println!("reset index_updated_at to {updated_at} for {org_id}/{stream_type}/{stream_name}");
    }

    Ok(())
}

/// Resolve a stream's earliest data date from file_list and convert it to a
/// microseconds timestamp. Returns `None` when the stream has no data.
async fn min_date_micros(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<Option<i64>, anyhow::Error> {
    let min_date = infra::file_list::get_min_date(org_id, stream_type, stream_name, None).await?;
    if min_date.is_empty() {
        return Ok(None);
    }
    let min_date = format!("{min_date}/00/00+0000");
    let ts = DateTime::parse_from_str(&min_date, "%Y/%m/%d/%H/%M/%S%z")?
        .with_timezone(&Utc)
        .timestamp_micros();
    Ok(Some(ts))
}
