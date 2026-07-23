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

//! Garbage collect stale stream files from remote object storage.
//!
//! Sometimes the compactor retention job marks files as deleted in the
//! `file_list` table but fails to remove the physical objects from remote
//! storage (s3/gcs/azure), leaving orphaned files behind. This command walks
//! every stream, computes its data retention cutoff and deletes any date
//! directory on remote storage whose data is entirely older than the cutoff.
//!
//! The deletion decision mirrors the compactor retention logic
//! ([`openobserve_core::compact::retention`]): a stream's effective retention is
//! `stream_settings.data_retention` (falling back to
//! `ZO_COMPACT_DATA_RETENTION_DAYS`), and any day overlapping an
//! `extended_retention_days` range is preserved.

use chrono::{DateTime, Duration, TimeZone, Utc};
use config::{
    get_config, is_local_disk_storage,
    meta::stream::{ALL_STREAM_TYPES, StreamType, TimeRange},
    utils::time::now,
};
use db;

/// Entry point for the `gc-file-list` command.
///
/// * `account_override` - force this storage account for listing/deleting instead of resolving it
///   per stream. Required for `file_hash` multi-account setups where a single stream's files are
///   spread across accounts.
/// * `stream_filter` - only process this stream, given as a full stream key
///   `org/stream_type/stream_name`. Processes all streams when `None`/empty.
/// * `dry_run` - only print what would be deleted, don't touch storage.
pub async fn run(
    account_override: Option<&str>,
    stream_filter: Option<&str>,
    dry_run: bool,
) -> Result<(), anyhow::Error> {
    if is_local_disk_storage() {
        return Err(anyhow::anyhow!(
            "gc-file-list only works with remote object storage (s3/gcs/azure)"
        ));
    }

    infra::init().await?;

    let cfg = get_config();
    let now = now();
    let default_retention_days = cfg.compact.data_retention_days;
    let stream_filter = stream_filter.filter(|s| !s.is_empty());

    let mut total_dirs = 0usize;
    let mut total_files = 0usize;

    if let Some(stream_key) = stream_filter {
        // a specific stream was requested: process it directly, no need to scan
        // the whole schema cache
        let parts: Vec<&str> = stream_key.split('/').collect();
        if parts.len() != 3 || parts.iter().any(|p| p.is_empty()) {
            return Err(anyhow::anyhow!(
                "invalid stream key {stream_key:?}, expected org/stream_type/stream_name"
            ));
        }
        let (org_id, stream_type, stream_name) = (parts[0], StreamType::from(parts[1]), parts[2]);
        let (dirs, files) = gc_stream(
            org_id,
            stream_type,
            stream_name,
            default_retention_days,
            now,
            account_override,
            dry_run,
        )
        .await?;
        total_dirs += dirs;
        total_files += files;
    } else {
        // process every stream: load schema cache to enumerate orgs/streams
        db::schema::cache().await?;
        let orgs = db::schema::list_organizations_from_cache().await;
        for org_id in orgs {
            for stream_type in ALL_STREAM_TYPES {
                // enrichment tables and file_list streams are not subject to data
                // retention, skip them (same as compactor retention::generate_jobs)
                if stream_type == StreamType::EnrichmentTables
                    || stream_type == StreamType::Filelist
                {
                    continue;
                }
                let streams = db::schema::list_streams_from_cache(&org_id, stream_type).await;
                for stream_name in streams {
                    let (dirs, files) = gc_stream(
                        &org_id,
                        stream_type,
                        &stream_name,
                        default_retention_days,
                        now,
                        account_override,
                        dry_run,
                    )
                    .await?;
                    total_dirs += dirs;
                    total_files += files;
                }
            }
        }
    }

    println!(
        "[GC] done, {} {total_dirs} stale date dir(s) / {total_files} file(s)",
        if dry_run { "would delete" } else { "deleted" },
    );

    Ok(())
}

/// Garbage collect a single stream: resolve its effective retention and clean
/// both its data and index directories on remote storage.
///
/// Returns the number of (date dirs, files) deleted (or that would be deleted in
/// dry-run mode).
async fn gc_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    default_retention_days: i64,
    now: DateTime<Utc>,
    account_override: Option<&str>,
    dry_run: bool,
) -> Result<(usize, usize), anyhow::Error> {
    let stream_settings = infra::schema::get_settings(org_id, stream_name, stream_type)
        .await
        .unwrap_or_default();

    // effective retention: stream override wins over global config
    let mut retention_days = default_retention_days;
    if stream_settings.data_retention > 0 {
        retention_days = stream_settings.data_retention;
    }
    if retention_days <= 1 {
        // retention disabled (0) or 1 day: skip as a safety guard so this tool
        // never deletes near-current data
        return Ok((0, 0));
    }

    let lifecycle_end = now - Duration::try_days(retention_days).unwrap();

    // data dir + derived index dir (see retention::generate_local_dirs)
    let prefixes = [
        format!("files/{org_id}/{stream_type}/{stream_name}/"),
        format!("files/{org_id}/index/{stream_name}_{stream_type}/"),
        format!("files/{org_id}/bloom/{stream_name}_{stream_type}/"),
    ];
    let mut total_dirs = 0usize;
    let mut total_files = 0usize;
    for prefix in prefixes {
        match gc_prefix(
            org_id,
            &prefix,
            account_override,
            lifecycle_end,
            &stream_settings.extended_retention_days,
            dry_run,
        )
        .await
        {
            Ok((dirs, files)) => {
                total_dirs += dirs;
                total_files += files;
            }
            Err(e) => {
                log::error!("[GC] failed to process prefix {prefix}: {e}");
            }
        }
    }

    Ok((total_dirs, total_files))
}

/// Process a single `files/{org}/.../` prefix.
///
/// Rather than listing every object under the prefix (which can be billions of
/// files / TBs for a large stream and would blow up memory), this walks the
/// `year/month/day` directory tree using delimiter listings (which only return
/// directory names) and only does a full object listing for the day directories
/// that are actually past retention and about to be deleted.
///
/// Returns the number of (date dirs, files) deleted (or that would be deleted
/// in dry-run mode).
async fn gc_prefix(
    org_id: &str,
    prefix: &str,
    account_override: Option<&str>,
    lifecycle_end: DateTime<Utc>,
    extended_retentions: &[TimeRange],
    dry_run: bool,
) -> Result<(usize, usize), anyhow::Error> {
    let account = match account_override {
        Some(a) if !a.is_empty() => a.to_string(),
        _ => infra::storage::get_account(org_id, prefix).unwrap_or_default(),
    };

    let mut deleted_dirs = 0usize;
    let mut deleted_files = 0usize;

    // level 1: year directories, e.g. `files/{org}/{type}/{stream}/2025`
    for year_dir in infra::storage::list_dirs(&account, prefix).await? {
        let Some(year) = last_segment(&year_dir).and_then(|s| s.parse::<i32>().ok()) else {
            continue;
        };
        // prune: the whole year is newer than the cutoff, nothing to delete
        if let Some(year_start) = month_start(year, 1)
            && year_start > lifecycle_end
        {
            continue;
        }

        // level 2: month directories
        for month_dir in infra::storage::list_dirs(&account, &format!("{year_dir}/")).await? {
            let Some(month) = last_segment(&month_dir).and_then(|s| s.parse::<u32>().ok()) else {
                continue;
            };
            if let Some(month_start) = month_start(year, month)
                && month_start > lifecycle_end
            {
                continue;
            }

            // level 3: day directories
            for day_dir in infra::storage::list_dirs(&account, &format!("{month_dir}/")).await? {
                let Some(day) = last_segment(&day_dir).and_then(|s| s.parse::<u32>().ok()) else {
                    continue;
                };
                let Some((day_start, day_end)) = day_bounds(year, month, day) else {
                    log::warn!("[GC] skip non-date dir: {day_dir}");
                    continue;
                };

                // only delete a day directory when the whole day is past retention
                if day_end > lifecycle_end {
                    continue;
                }

                // preserve days that overlap an extended retention ("red day") range
                let day_range =
                    TimeRange::new(day_start.timestamp_micros(), day_end.timestamp_micros());
                if extended_retentions.iter().any(|r| r.intersects(&day_range)) {
                    log::info!("[GC] keep {day_dir}: within extended retention");
                    continue;
                }

                // this day is past retention: list just this day and delete it
                let files = infra::storage::list(&account, &format!("{day_dir}/")).await?;
                if files.is_empty() {
                    continue;
                }
                log::info!(
                    "[GC] {} {day_dir} ({} file(s))",
                    if dry_run { "would delete" } else { "delete" },
                    files.len(),
                );
                deleted_dirs += 1;
                deleted_files += files.len();

                if !dry_run {
                    let del_list = files
                        .iter()
                        .map(|f| (account.as_str(), f.as_str()))
                        .collect::<Vec<_>>();
                    infra::storage::del(del_list).await?;
                }
            }
        }
    }

    Ok((deleted_dirs, deleted_files))
}

/// Return the last `/`-separated segment of a directory key, e.g.
/// `files/default/logs/default/2025` -> `2025`. Returns `None` if empty.
fn last_segment(path: &str) -> Option<&str> {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
}

/// Midnight UTC at the first day of the given `year/month`.
fn month_start(year: i32, month: u32) -> Option<DateTime<Utc>> {
    Utc.with_ymd_and_hms(year, month, 1, 0, 0, 0).single()
}

/// The `[day_start, day_end)` UTC range for a `year/month/day`.
fn day_bounds(year: i32, month: u32, day: u32) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    let day_start = Utc.with_ymd_and_hms(year, month, day, 0, 0, 0).single()?;
    Some((day_start, day_start + Duration::days(1)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_last_segment() {
        assert_eq!(
            last_segment("files/default/logs/default/2025"),
            Some("2025")
        );
        assert_eq!(
            last_segment("my-bucket-prefix/files/default/logs/default/2025/01"),
            Some("01")
        );
        // trailing slash is tolerated
        assert_eq!(
            last_segment("files/default/index/default_logs/15/"),
            Some("15")
        );
        assert_eq!(last_segment(""), None);
    }

    #[test]
    fn test_day_bounds() {
        let (start, end) = day_bounds(2025, 1, 2).unwrap();
        assert_eq!(
            start,
            Utc.with_ymd_and_hms(2025, 1, 2, 0, 0, 0).single().unwrap()
        );
        assert_eq!(
            end,
            Utc.with_ymd_and_hms(2025, 1, 3, 0, 0, 0).single().unwrap()
        );
    }

    #[test]
    fn test_day_bounds_invalid() {
        assert!(day_bounds(2025, 13, 2).is_none()); // bad month
        assert!(day_bounds(2025, 2, 30).is_none()); // bad day
    }

    #[test]
    fn test_month_start() {
        assert_eq!(
            month_start(2025, 6),
            Utc.with_ymd_and_hms(2025, 6, 1, 0, 0, 0).single()
        );
    }

    /// A full day older than the cutoff and outside any extended range should be
    /// eligible for deletion.
    #[test]
    fn test_retention_decision_deletes_old_day() {
        let now = Utc
            .with_ymd_and_hms(2026, 5, 25, 12, 0, 0)
            .single()
            .unwrap();
        let lifecycle_end = now - Duration::days(3); // keep last 3 days
        let (_, day_end) = day_bounds(2026, 5, 15).unwrap();
        assert!(day_end <= lifecycle_end, "10-day-old dir is past retention");
    }

    /// The boundary day must be preserved: its data is partly within retention,
    /// so the whole-directory rule (`day_end <= lifecycle_end`) keeps it.
    #[test]
    fn test_retention_decision_keeps_boundary_day() {
        let now = Utc
            .with_ymd_and_hms(2026, 5, 25, 12, 0, 0)
            .single()
            .unwrap();
        let lifecycle_end = now - Duration::days(3); // 2026-05-22 12:00
        let (_, day_end) = day_bounds(2026, 5, 22).unwrap(); // ends 05-23 00:00
        assert!(day_end > lifecycle_end, "boundary day must be kept");
    }

    /// A day overlapping an extended retention range must be preserved even when
    /// it is past the data retention cutoff.
    #[test]
    fn test_retention_decision_keeps_extended_retention_day() {
        let (day_start, day_end) = day_bounds(2026, 5, 15).unwrap();
        let day_range = TimeRange::new(day_start.timestamp_micros(), day_end.timestamp_micros());
        let extended = [TimeRange::new(
            Utc.with_ymd_and_hms(2026, 5, 14, 0, 0, 0)
                .single()
                .unwrap()
                .timestamp_micros(),
            Utc.with_ymd_and_hms(2026, 5, 16, 0, 0, 0)
                .single()
                .unwrap()
                .timestamp_micros(),
        )];
        assert!(extended.iter().any(|r| r.intersects(&day_range)));
    }
}
