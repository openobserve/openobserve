// Copyright 2025 OpenObserve Inc.
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

use std::{
    fs::Metadata,
    ops::Range,
    path::{Path, PathBuf},
    time::SystemTime,
};

use async_walkdir::WalkDir;
use futures::StreamExt;
use tokio::{
    fs::{File, metadata, read_dir, remove_dir},
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
};

#[inline(always)]
pub async fn get_file_meta(path: impl AsRef<Path>) -> Result<Metadata, std::io::Error> {
    metadata(path).await
}

#[inline(always)]
pub async fn get_file_size(path: impl AsRef<Path>) -> Result<u64, std::io::Error> {
    metadata(path).await.map(|f| f.len())
}

#[inline(always)]
pub async fn is_exists(path: impl AsRef<Path>) -> bool {
    tokio::fs::metadata(path).await.is_ok()
}

#[inline(always)]
pub async fn get_file_contents(
    path: impl AsRef<Path>,
    range: Option<Range<usize>>,
) -> Result<Vec<u8>, std::io::Error> {
    let mut file = File::open(path).await?;
    let data = if let Some(range) = range {
        let to_read = range.end - range.start;
        let mut buf = Vec::with_capacity(to_read);
        file.seek(std::io::SeekFrom::Start(range.start as u64))
            .await?;
        let read = file.take(to_read as u64).read_to_end(&mut buf).await?;
        if read != to_read {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                format!("Expected to read {to_read} bytes, but read {read} bytes"),
            ));
        }
        buf
    } else {
        let mut buf: Vec<u8> = Vec::new();
        file.read_to_end(&mut buf).await?;
        buf
    };
    Ok(data)
}

#[inline(always)]
pub async fn put_file_contents(
    path: impl AsRef<Path>,
    contents: &[u8],
) -> Result<(), std::io::Error> {
    let Some(path) = path.as_ref().to_str() else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Path is not a valid string",
        ));
    };

    // Create a temporary file in the same directory
    let temp_file = format!("{path}.tmp");

    // Write to temporary file first
    let mut file_handle = File::create(&temp_file).await?;
    file_handle.write_all(contents).await?;

    // Atomically rename the temp file to the target file
    // This ensures we either have the old file or the new file, never a partially written file
    tokio::fs::rename(temp_file, path).await?;

    Ok(())
}

pub async fn clean_empty_dirs(
    dir: &str,
    last_updated: Option<SystemTime>,
) -> Result<(), std::io::Error> {
    let mut dirs = Vec::new();
    let mut entries = WalkDir::new(dir);
    loop {
        match entries.next().await {
            Some(Ok(entry)) => {
                if entry.path().display().to_string() == dir {
                    continue;
                }
                if let Ok(f) = entry.file_type().await
                    && f.is_dir()
                {
                    match last_updated {
                        None => {
                            dirs.push(entry.path().to_str().unwrap().to_string());
                        }
                        Some(last_updated) => {
                            if let Ok(meta) = entry.metadata().await
                                && meta.modified().unwrap() < last_updated
                            {
                                dirs.push(entry.path().to_str().unwrap().to_string());
                            }
                        }
                    }
                }
            }
            Some(Err(e)) => {
                log::error!("clean_empty_dirs, err: {e}");
                break;
            }
            None => break,
        }
    }
    dirs.sort_by_key(|b| std::cmp::Reverse(b.len()));
    for dir in dirs {
        if let Ok(mut entries) = read_dir(&dir).await
            && let Ok(None) = entries.next_entry().await
            && let Err(e) = remove_dir(&dir).await
        {
            log::error!("Failed to remove empty dir: {dir}, err: {e}");
        }
    }
    Ok(())
}

/// Asynchronously scans a directory tree and returns a vector of canonicalized file paths
/// that match a given filter.
///
/// This function walks the directory starting from `root`, applying a filter to each
/// entry. It uses `async_walkdir` for efficient, non-blocking directory traversal.
/// The filter logic determines whether to continue the walk, ignore a directory,
/// or ignore a file.
///
/// For entries that pass the filter and are files, their paths are canonicalized
/// to produce absolute paths.
///
/// # Type Parameters
///
/// * `P` - A type that can be referenced as a `Path`, e.g., `&str` or `PathBuf`.
/// * `F` - A closure that takes a `PathBuf` and returns a boolean.
///
/// # Arguments
///
/// * `root` - The path to the root directory to start the scan from.
/// * `filter` - An asynchronous closure that is called for each entry in the directory. It should
///   return `true` to keep an entry or `false` to discard it. If a directory is discarded, its
///   contents will not be visited.
/// * `limit` - An optional `usize` to limit the number of file paths collected.
///
/// # Returns
///
/// A `Result` containing either:
/// - `Ok(Vec<String>)`: A vector of canonicalized file path strings.
/// - `Err(std::io::Error)`: An I/O error that occurred during scanning.
pub async fn scan_files_filtered<P, F>(
    root: P,
    filter: F,
    limit: Option<usize>,
) -> Result<Vec<String>, std::io::Error>
where
    P: AsRef<Path>,
    F: Fn(PathBuf) -> bool + Send + Clone + 'static,
{
    let walker = WalkDir::new(root).filter(move |entry| {
        let path = entry.path();
        let filter = filter.clone();
        async move {
            let is_dir = path.is_dir();
            if filter(path) {
                async_walkdir::Filtering::Continue
            } else if is_dir {
                async_walkdir::Filtering::IgnoreDir
            } else {
                async_walkdir::Filtering::Ignore
            }
        }
    });

    let walker = walker.filter_map(|item| async {
        item.ok().and_then(|dir_entry| {
            let pb = dir_entry.path();

            if !pb.is_file() {
                None
            } else {
                pb.canonicalize()
                    .ok()
                    .and_then(|cpath| cpath.to_str().map(String::from))
            }
        })
    });

    let files = if let Some(limit_count) = limit {
        walker.take(limit_count).collect().await
    } else {
        walker.collect().await
    };

    Ok(files)
}

#[inline(always)]
pub async fn scan_files<P: AsRef<Path>>(
    root: P,
    ext: &str,
    limit: Option<usize>,
) -> Result<Vec<String>, std::io::Error> {
    let ext = ext.to_lowercase();
    scan_files_filtered(
        root,
        move |f| {
            if f.is_dir() {
                true
            } else {
                f.extension()
                    .and_then(|file_ext| file_ext.to_str())
                    .map(|s| s.to_lowercase() == ext)
                    .unwrap_or_default()
            }
        },
        limit,
    )
    .await
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::*;
    use crate::utils::file::wal_dir_datetime_filter_builder;

    #[tokio::test]
    async fn test_get_file_contents_with_range() {
        let content = b"Hello World";
        let file_name = "range_test_async.txt";

        put_file_contents(file_name, content).await.unwrap();

        // Test valid range
        assert_eq!(
            get_file_contents(file_name, Some(0..5)).await.unwrap(),
            b"Hello"
        );

        // Test invalid range should error
        assert!(get_file_contents(file_name, Some(3..5)).await.is_ok());

        // Test out of bounds should error
        assert!(get_file_contents(file_name, Some(0..100)).await.is_err());

        std::fs::remove_file(file_name).unwrap();
    }

    #[tokio::test]
    async fn test_scan_files_filtered_basic() {
        let threads: Vec<_> = (1..2).collect();
        let years = vec![2025];
        let months: Vec<_> = (9..=10).collect();
        let days: Vec<_> = (8..=11).collect();
        let hours: Vec<_> = (1..=5).collect();
        let filenames: Vec<_> = vec!["a", "b", "c", "d"];
        let extensions = vec!["parquet", "blink"];

        let wal_root = tempfile::tempdir().expect("Temp dir");

        let inner_path = wal_root
            .path()
            .join("files")
            .join("<org_id>")
            .join("<stream_type>")
            .join("<stream_name>");

        for thread in threads {
            for year in &years {
                for month in &months {
                    for day in &days {
                        for hour in &hours {
                            tokio::fs::create_dir_all(format!(
                                "{}/{}/{}/{}/{}/{}",
                                inner_path.display(),
                                thread,
                                year,
                                month,
                                day,
                                hour
                            ))
                            .await
                            .expect("Pretest setup failure");

                            for filename in &filenames {
                                for extension in &extensions {
                                    tokio::fs::File::create(format!(
                                        "{}/{}/{}/{}/{}/{}/{}.{}",
                                        inner_path.display(),
                                        thread,
                                        year,
                                        month,
                                        day,
                                        hour,
                                        filename,
                                        extension
                                    ))
                                    .await
                                    .expect("Pretest setup failure");
                                }
                            }
                        }
                    }
                }
            }
        }

        let start_time = Utc.with_ymd_and_hms(2025, 9, 10, 2, 0, 0).single().unwrap();
        let end_time = Utc.with_ymd_and_hms(2025, 9, 10, 4, 0, 0).single().unwrap();
        // 3 hours (2, 3, 4 - inclusive matching) - 4 parquet files per hour -> 12 files in total
        let filter = wal_dir_datetime_filter_builder(
            start_time,
            end_time,
            "parquet".to_string(),
            inner_path.components().count() + 1,
        );
        let files = scan_files_filtered(inner_path, filter, None)
            .await
            .expect("Basic Test Failure");

        assert_eq!(files.len(), 12);
    }

    #[tokio::test]
    async fn test_scan_files() {
        let test_dir = "test_scan_files";
        let sub_dir = format!("{}/subdir", test_dir);

        // Create test directory structure
        tokio::fs::create_dir_all(&sub_dir).await.unwrap();

        // Create test files with different extensions
        put_file_contents(&format!("{}/file1.txt", test_dir), b"content1")
            .await
            .unwrap();
        put_file_contents(&format!("{}/file2.txt", test_dir), b"content2")
            .await
            .unwrap();
        put_file_contents(&format!("{}/file3.log", test_dir), b"log content")
            .await
            .unwrap();
        put_file_contents(&format!("{}/file4.txt", sub_dir), b"sub content")
            .await
            .unwrap();

        // Test scanning for txt files without limit
        let txt_files = scan_files(test_dir, "txt", None).await.unwrap();
        println!("{:?}", txt_files);
        assert_eq!(txt_files.len(), 3);
        assert!(txt_files.iter().all(|f| f.ends_with(".txt")));

        // Test scanning with limit
        let limited_files = scan_files(test_dir, "txt", Some(2)).await.unwrap();
        assert_eq!(limited_files.len(), 2);

        // Test scanning for log files
        let log_files = scan_files(test_dir, "log", None).await.unwrap();
        assert_eq!(log_files.len(), 1);
        assert!(log_files[0].ends_with(".log"));

        // Test scanning for non-existent extension
        let empty_files = scan_files(test_dir, "nonexistent", None).await.unwrap();
        assert!(empty_files.is_empty());

        // Cleanup
        std::fs::remove_dir_all(test_dir).unwrap();
    }
}
