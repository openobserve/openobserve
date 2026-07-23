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

use config::{
    meta::stream::{FileKey, PartitionTimeLevel, StreamType},
    utils::file::get_file_meta as util_get_file_meta,
};
use infra::{errors::Result, file_list as infra_file_list, storage};
use rayon::slice::ParallelSliceMut;

use crate::file_list_dump;

#[tracing::instrument(
    name = "service::file_list::query",
    skip_all,
    fields(org_id = org_id, stream_name = stream_name)
)]
pub async fn query(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_level: PartitionTimeLevel,
    time_min: i64,
    time_max: i64,
) -> Result<Vec<FileKey>> {
    let mut files = infra_file_list::query(
        org_id,
        stream_type,
        stream_name,
        time_level,
        (time_min, time_max),
        None,
    )
    .await?;
    let dumped_files = file_list_dump::query(
        trace_id,
        org_id,
        stream_type,
        stream_name,
        (time_min, time_max),
        &[],
    )
    .await?;

    files.extend(dumped_files.iter().map(|f| f.into()));
    files.par_sort_unstable_by(|a, b| a.key.cmp(&b.key));
    files.dedup_by(|a, b| a.key == b.key);
    Ok(files)
}

/// NOTE: This will not query the files from file_dump. If you also want files from the dump, use
/// query function instead. Currently this is used only when compacting on stream, and we do not
/// support re-compaction of already dumped files, so this function completely ignores the files
/// from dump
#[tracing::instrument(
    name = "service::file_list::query_for_merge",
    skip_all,
    fields(org_id = org_id, stream_name = stream_name)
)]
pub async fn query_for_merge(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_start: &str,
    date_end: &str,
) -> Result<Vec<FileKey>> {
    let files = infra_file_list::query_for_merge(
        org_id,
        stream_type,
        stream_name,
        (date_start.to_string(), date_end.to_string()),
    )
    .await?;
    // we don't need to query from dump here, because
    // we expected all dumped files to be already compacted,
    // and the compaction marks old files as deleted, which is not possible with dump
    Ok(files)
}

#[inline]
pub fn calculate_local_files_size(files: &[String]) -> Result<u64> {
    let mut size = 0;
    for file in files {
        let file_size = match util_get_file_meta(file) {
            Ok(resp) => resp.len(),
            Err(_) => 0,
        };
        size += file_size;
    }
    Ok(size)
}

// Delete one parquet file and update the file list
pub async fn delete_parquet_file(account: &str, key: &str, file_list_only: bool) -> Result<()> {
    // delete from file list in metastore
    infra_file_list::batch_process(&[FileKey::new(
        0,
        account.to_string(),
        key.to_string(),
        Default::default(),
        true,
    )])
    .await?;

    // delete the parquet whaterever the file is exists or not
    if !file_list_only {
        _ = storage::del(vec![(account, key)]).await;
    }
    Ok(())
}

pub async fn update_compressed_size(key: &str, size: i64) -> Result<()> {
    infra_file_list::update_compressed_size(key, size).await?;
    infra_file_list::LOCAL_CACHE
        .update_compressed_size(key, size)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::{
        search::ScanStats,
        stream::{FileKey, FileMeta},
    };
    use infra::file_list::calculate_files_size;

    use super::*;

    fn create_test_file_key(
        id: i64,
        key: &str,
        records: i64,
        original_size: i64,
        compressed_size: i64,
        index_size: i64,
    ) -> FileKey {
        FileKey {
            id,
            account: "test_account".to_string(),
            key: key.to_string(),
            meta: FileMeta {
                min_ts: 1000,
                max_ts: 2000,
                records,
                original_size,
                compressed_size,
                index_size,
                flattened: false,
                bloom_ver: 0,
            },
            deleted: false,
            selection: None,
            row_group_size: None,
        }
    }

    #[tokio::test]
    async fn test_calculate_files_size_empty() {
        let files: Vec<FileKey> = vec![];
        let result = calculate_files_size(&files).await;

        assert!(result.is_ok());
        let stats = result.unwrap();
        assert_eq!(stats.files, 0);
        assert_eq!(stats.records, 0);
        assert_eq!(stats.original_size, 0);
        assert_eq!(stats.compressed_size, 0);
        assert_eq!(stats.idx_scan_size, 0);
    }

    #[tokio::test]
    async fn test_calculate_files_size_single_file() {
        let files = vec![create_test_file_key(
            1,
            "file1.parquet",
            100,
            10000,
            5000,
            500,
        )];

        let result = calculate_files_size(&files).await;

        assert!(result.is_ok());
        let stats = result.unwrap();
        assert_eq!(stats.files, 1);
        assert_eq!(stats.records, 100);
        assert_eq!(stats.original_size, 10000);
        assert_eq!(stats.compressed_size, 5000);
        assert_eq!(stats.idx_scan_size, 500);
    }

    #[tokio::test]
    async fn test_calculate_files_size_multiple_files() {
        let files = vec![
            create_test_file_key(1, "file1.parquet", 100, 10000, 5000, 500),
            create_test_file_key(2, "file2.parquet", 200, 20000, 10000, 1000),
            create_test_file_key(3, "file3.parquet", 300, 30000, 15000, 1500),
        ];

        let result = calculate_files_size(&files).await;

        assert!(result.is_ok());
        let stats = result.unwrap();
        assert_eq!(stats.files, 3);
        assert_eq!(stats.records, 600); // 100 + 200 + 300
        assert_eq!(stats.original_size, 60000); // 10000 + 20000 + 30000
        assert_eq!(stats.compressed_size, 30000); // 5000 + 10000 + 15000
        assert_eq!(stats.idx_scan_size, 3000); // 500 + 1000 + 1500
    }

    #[tokio::test]
    async fn test_calculate_files_size_with_zero_values() {
        let files = vec![
            create_test_file_key(1, "file1.parquet", 0, 0, 0, 0),
            create_test_file_key(2, "file2.parquet", 100, 10000, 5000, 500),
        ];

        let result = calculate_files_size(&files).await;

        assert!(result.is_ok());
        let stats = result.unwrap();
        assert_eq!(stats.files, 2);
        assert_eq!(stats.records, 100);
        assert_eq!(stats.original_size, 10000);
        assert_eq!(stats.compressed_size, 5000);
        assert_eq!(stats.idx_scan_size, 500);
    }

    #[tokio::test]
    async fn test_calculate_files_size_large_values() {
        let files = vec![create_test_file_key(
            1,
            "large_file.parquet",
            1000000,
            10000000000,
            5000000000,
            500000000,
        )];

        let result = calculate_files_size(&files).await;

        assert!(result.is_ok());
        let stats = result.unwrap();
        assert_eq!(stats.files, 1);
        assert_eq!(stats.records, 1000000);
        assert_eq!(stats.original_size, 10000000000);
        assert_eq!(stats.compressed_size, 5000000000);
        assert_eq!(stats.idx_scan_size, 500000000);
    }

    #[tokio::test]
    async fn test_calculate_local_files_size_empty() {
        let files: Vec<String> = vec![];
        let result = calculate_local_files_size(&files);

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
    }

    #[tokio::test]
    async fn test_calculate_local_files_size_nonexistent_files() {
        let files = vec![
            "/nonexistent/file1.parquet".to_string(),
            "/nonexistent/file2.parquet".to_string(),
        ];

        let result = calculate_local_files_size(&files);

        // Should return 0 for nonexistent files
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
    }

    #[test]
    fn test_scan_stats_creation() {
        let stats = ScanStats::new();

        // Verify default values
        assert_eq!(stats.files, 0);
        assert_eq!(stats.records, 0);
        assert_eq!(stats.original_size, 0);
        assert_eq!(stats.compressed_size, 0);
    }

    #[test]
    fn test_file_key_creation() {
        let file_key = create_test_file_key(1, "test.parquet", 100, 1000, 500, 50);

        assert_eq!(file_key.id, 1);
        assert_eq!(file_key.key, "test.parquet");
        assert_eq!(file_key.meta.records, 100);
        assert_eq!(file_key.meta.original_size, 1000);
        assert_eq!(file_key.meta.compressed_size, 500);
        assert_eq!(file_key.meta.index_size, 50);
        assert!(!file_key.deleted);
        assert!(!file_key.meta.flattened);
    }

    #[tokio::test]
    async fn test_calculate_files_size_preserves_stats_type() {
        let files = vec![create_test_file_key(1, "file.parquet", 100, 1000, 500, 50)];

        let result = calculate_files_size(&files).await;

        assert!(result.is_ok());
        let stats = result.unwrap();

        // Verify types are correct (all should be i64)
        let _files: i64 = stats.files;
        let _records: i64 = stats.records;
        let _original: i64 = stats.original_size;
        let _compressed: i64 = stats.compressed_size;
        let _idx: i64 = stats.idx_scan_size;
    }

    #[tokio::test]
    async fn test_calculate_files_size_aggregation() {
        let files = vec![
            create_test_file_key(1, "file1.parquet", 50, 5000, 2500, 250),
            create_test_file_key(2, "file2.parquet", 50, 5000, 2500, 250),
        ];

        let result = calculate_files_size(&files).await;

        assert!(result.is_ok());
        let stats = result.unwrap();

        // Verify aggregation is correct
        assert_eq!(stats.files, 2);
        assert_eq!(stats.records, 100); // 50 + 50
        assert_eq!(stats.original_size, 10000); // 5000 + 5000
        assert_eq!(stats.compressed_size, 5000); // 2500 + 2500
        assert_eq!(stats.idx_scan_size, 500); // 250 + 250
    }
}
