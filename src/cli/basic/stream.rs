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
    meta::stream::{StreamStats, StreamType},
    utils::json,
};
use db;
use infra::schema::unwrap_stream_settings;

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
        for (org_id, stream_types) in db::schema::list_all_streams_grouped().await {
            for (stream_type, stream_names) in stream_types {
                for stream_name in stream_names {
                    all.push((org_id.clone(), stream_type, stream_name));
                }
            }
        }
        all
    } else {
        let [org_id, stream_type, stream_name] = split_stream_key(stream)?;
        vec![(
            org_id.to_string(),
            StreamType::from(stream_type),
            stream_name.to_string(),
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

/// Recompute a stream's `stream_stats` rows from `file_list`; never touches the compactor offset.
pub async fn reset_stream_stats(stream: &str) -> Result<(), anyhow::Error> {
    let (org_id, stream_type, stream_name) = parse_stream_stats_key(stream)?;
    if !infra::schema::exists(org_id, stream_type, stream_name).await {
        return Err(anyhow::anyhow!(
            "stream not found: {org_id}/{stream_type}/{stream_name}"
        ));
    }

    // Summarise what was written; a read-back would go through CLIENT_RO and can lag the primary
    let mut stats = StreamStats::default();
    for (date_range, is_recent) in compaction::stats::stats_date_ranges() {
        let range_stats = compaction::stats::update_stats_from_file_list_for_stream(
            org_id,
            stream_type,
            stream_name,
            date_range,
            is_recent,
        )
        .await?;
        stats.merge(&range_stats);
    }
    println!(
        "reset stream stats for {org_id}/{stream_type}/{stream_name}: file_num={}, doc_num={}, storage_size={}, compressed_size={}, index_size={}, doc_time_min={}, doc_time_max={}",
        stats.file_num,
        stats.doc_num,
        stats.storage_size,
        stats.compressed_size,
        stats.index_size,
        stats.doc_time_min,
        stats.doc_time_max
    );

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

fn split_stream_key(stream: &str) -> Result<[&str; 3], anyhow::Error> {
    let parts = stream.splitn(3, '/').collect::<Vec<&str>>();
    if parts.len() != 3 {
        return Err(anyhow::anyhow!(
            "invalid stream [{stream}], expected format: org/stream_type/stream_name"
        ));
    }
    Ok([parts[0], parts[1], parts[2]])
}

fn parse_stream_stats_key(stream: &str) -> Result<(&str, StreamType, &str), anyhow::Error> {
    let parts = split_stream_key(stream)?;
    if parts.iter().any(|p| p.is_empty()) {
        return Err(anyhow::anyhow!(
            "invalid stream [{stream}], expected format: org/stream_type/stream_name"
        ));
    }
    let [org_id, type_name, stream_name] = parts;
    let stream_type = StreamType::from(type_name);
    // `From<&str>` maps unknown names to the default type, so the fallback has to be detected here
    if stream_type == StreamType::default()
        && !type_name.eq_ignore_ascii_case(StreamType::default().as_str())
    {
        return Err(anyhow::anyhow!(
            "unknown stream_type [{type_name}] in stream [{stream}]"
        ));
    }
    if matches!(stream_type, StreamType::Index | StreamType::Filelist) {
        return Err(anyhow::anyhow!(
            "stream_type [{stream_type}] has no stream stats"
        ));
    }
    Ok((org_id, stream_type, stream_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_stream_stats_key_valid() {
        let (org_id, stream_type, stream_name) =
            parse_stream_stats_key("default/logs/app").unwrap();
        assert_eq!(org_id, "default");
        assert_eq!(stream_type, StreamType::Logs);
        assert_eq!(stream_name, "app");
    }

    #[test]
    fn test_parse_stream_stats_key_maps_known_types() {
        for (name, expected) in [
            ("logs", StreamType::Logs),
            ("metrics", StreamType::Metrics),
            ("traces", StreamType::Traces),
        ] {
            let key = format!("org/{name}/s1");
            let (_, stream_type, _) = parse_stream_stats_key(&key).unwrap();
            assert_eq!(stream_type, expected, "{key}");
        }
    }

    #[test]
    fn test_parse_stream_stats_key_rejects_two_parts() {
        let err = parse_stream_stats_key("org/logs").unwrap_err().to_string();
        assert!(err.contains("expected format"), "{err}");
    }

    #[test]
    fn test_parse_stream_stats_key_rejects_empty_segment() {
        for key in ["/logs/s1", "org//s1", "org/logs/"] {
            let err = parse_stream_stats_key(key).unwrap_err().to_string();
            assert!(err.contains("expected format"), "{key}: {err}");
        }
    }

    #[test]
    fn test_parse_stream_stats_key_rejects_unknown_type() {
        let err = parse_stream_stats_key("org/bogus/s1")
            .unwrap_err()
            .to_string();
        assert!(err.contains("unknown stream_type [bogus]"), "{err}");
    }

    #[test]
    fn test_parse_stream_stats_key_rejects_index_and_file_list() {
        for name in ["index", "file_list"] {
            let key = format!("org/{name}/s1");
            let err = parse_stream_stats_key(&key).unwrap_err().to_string();
            assert!(err.contains("has no stream stats"), "{key}: {err}");
        }
    }
}
