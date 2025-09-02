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
    fs::{File, Metadata, metadata},
    io::{Read, Seek, Write},
    ops::Range,
    path::{Path, PathBuf},
};

use async_recursion::async_recursion;
use async_walkdir::WalkDir;
use chrono::{DateTime, Datelike, TimeZone, Timelike, Utc};
use futures::StreamExt;

#[inline(always)]
pub fn get_file_meta(path: impl AsRef<Path>) -> Result<Metadata, std::io::Error> {
    metadata(path)
}

#[inline(always)]
pub fn get_file_size(path: impl AsRef<Path>) -> Result<u64, std::io::Error> {
    metadata(path).map(|f| f.len())
}

#[inline(always)]
pub fn is_exists(file: &str) -> bool {
    std::fs::metadata(file).is_ok()
}

#[inline(always)]
pub fn get_file_contents(file: &str, range: Option<Range<u64>>) -> Result<Vec<u8>, std::io::Error> {
    let mut file = File::open(file)?;
    let data = if let Some(range) = range {
        if range.start > range.end {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Invalid range: start > end",
            ));
        }
        let to_read = range.end - range.start;
        let mut buf = Vec::with_capacity(to_read as usize);
        file.seek(std::io::SeekFrom::Start(range.start))?;
        let read = file.take(to_read).read_to_end(&mut buf)?;
        if read != to_read as usize {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                format!("Expected to read {to_read} bytes, but read {read} bytes"),
            ));
        }
        buf
    } else {
        let mut buf: Vec<u8> = Vec::new();
        file.read_to_end(&mut buf)?;
        buf
    };
    Ok(data)
}

#[inline(always)]
pub fn put_file_contents(file: &str, contents: &[u8]) -> Result<(), std::io::Error> {
    // Create a temporary file in the same directory
    let temp_file = format!("{file}.tmp");

    // Write to temporary file first
    let mut file_handle = File::create(&temp_file)?;
    file_handle.write_all(contents)?;

    // Atomically rename the temp file to the target file
    // This ensures we either have the old file or the new file, never a partially written file
    std::fs::rename(temp_file, file)?;

    Ok(())
}

/// Creates a closure that filters file paths based on a datetime range extracted
/// from the directory structure.
///
/// This function is designed to work with a directory hierarchy where dates are
/// embedded in the path, such as `/skippable/base/path/YYYY/MM/DD/HH/`. It constructs
/// a filter that checks if the date derived from a path falls within the
/// specified `start_time` and `end_time`.
///
/// The filter also ensures that if the path points to a file, its extension
/// matches the provided `extension_pattern`.
///
/// # Arguments
///
/// * `start_time` - The inclusive start of the datetime range for the filter.
/// * `end_time` - The inclusive end of the datetime range for the filter.
/// * `extension_pattern` - The file extension to match (e.g., "json").
/// * `skip_count` - The number of initial path components to skip before starting to parse the date
///   parts (year, month, etc.).
///
/// # Returns
///
/// A closure that takes a `PathBuf` and returns `true` if the path matches the
/// criteria, and `false` otherwise. This closure is `Send`, `Clone`, and
/// `'static`.
pub fn wal_dir_datetime_filter_builder(
    start_time: DateTime<Utc>,
    end_time: DateTime<Utc>,
    extension_pattern: String,
    skip_count: usize,
) -> impl Fn(PathBuf) -> bool + Send + Clone + 'static {
    move |path: PathBuf| {
        let mut components = path
            .components()
            .skip(skip_count)
            .map(|c| c.as_os_str())
            .filter_map(|osc| osc.to_str());

        let year = match components.next().map(|c| c.parse::<i32>()) {
            Some(Ok(y @ 1901..=9999)) => y, // A plausible year
            Some(_) => return false,        // Parsed, but not a plausible year
            None => return true,            /* Not present or failed to parse, could be a
                                              * skippable path */
        };

        let month = match components.next().map(|c| c.parse::<u32>()) {
            Some(Ok(m @ 1..=12)) => m,
            Some(_) => return false,    // Parsed, but invalid month number
            None => start_time.month(), // Not present or failed to parse
        };

        let month_days = [31u32, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let days = month_days[month as usize] + if month == 2 && year % 4 == 0 { 1 } else { 0 };
        let day = match components.next().map(|c| c.parse::<u32>()) {
            Some(Ok(day)) => {
                if 1 <= day && day <= days {
                    day
                } else {
                    return false;
                }
            }
            Some(_) => return false,
            None => start_time.day(),
        };

        let hour = match components.next().map(|c| c.parse::<u32>()) {
            Some(Ok(hour @ 0..24)) => hour,
            Some(_) => return false,
            None => start_time.hour(),
        };

        let date_range_check =
            if let Some(datetime) = Utc.with_ymd_and_hms(year, month, day, hour, 0, 0).single() {
                datetime >= start_time && datetime <= end_time
            } else {
                false
            };

        date_range_check
            && (!path.is_file()
                || path
                    .extension()
                    .and_then(|extension| extension.to_str().map(|s| s == extension_pattern))
                    .unwrap_or_default())
    }
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
pub fn scan_files<P: AsRef<Path>>(
    root: P,
    ext: &str,
    limit: Option<usize>,
) -> Result<Vec<String>, std::io::Error> {
    let limit = limit.unwrap_or_default();
    let mut files = Vec::with_capacity(std::cmp::max(16, limit));
    let dir = std::fs::read_dir(root)?;
    for entry in dir {
        let path = entry?.path();
        if path.is_file() {
            let path_ext = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            if path_ext == ext {
                files.push(path.to_str().unwrap().to_string());
                if limit > 0 && files.len() >= limit {
                    return Ok(files);
                }
            }
        } else {
            // Only recurse if we haven't hit the limit yet
            if limit == 0 || files.len() < limit {
                let remaining_limit = if limit > 0 { limit - files.len() } else { 0 };
                let ff = scan_files(path, ext, Some(remaining_limit))?;
                if !ff.is_empty() {
                    files.extend(ff);
                    if limit > 0 && files.len() >= limit {
                        return Ok(files);
                    }
                }
            }
        }
    }
    Ok(files)
}

#[async_recursion]
pub async fn scan_files_with_channel(
    root: &Path,
    ext: &str,
    limit: Option<usize>,
    tx: tokio::sync::mpsc::Sender<Vec<String>>,
) -> Result<(), std::io::Error> {
    let limit = limit.unwrap_or_default();
    let mut files = Vec::with_capacity(std::cmp::max(16, limit));
    let dir = std::fs::read_dir(root).map_err(|e| {
        std::io::Error::other(format!(
            "Error reading directory: {}, err: {}",
            root.display(),
            e
        ))
    })?;
    for entry in dir {
        let path = entry?.path();
        if !path.is_file() {
            scan_files_with_channel(&path, ext, Some(limit), tx.clone()).await?;
        } else {
            let path_ext = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            if path_ext == ext {
                files.push(path.to_str().unwrap().to_string());
                if limit > 0 && files.len() >= limit {
                    tx.send(files.clone())
                        .await
                        .map_err(|e| std::io::Error::other(e.to_string()))?;
                    files.clear();
                }
            }
        }
    }
    if !files.is_empty() {
        tx.send(files)
            .await
            .map_err(|e| std::io::Error::other(e.to_string()))?;
    }
    Ok(())
}

#[cfg(unix)]
pub fn set_permission<P: AsRef<std::path::Path>>(path: P, mode: u32) -> Result<(), std::io::Error> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(path.as_ref())?;
    std::fs::set_permissions(path.as_ref(), std::fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
pub fn set_permission<P: AsRef<std::path::Path>>(
    path: P,
    _mode: u32,
) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(path.as_ref())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use chrono::{TimeZone, Utc};
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn test_scan_files() {
        let content = b"Some Text";
        let file_name = "sample.parquet";
        let dir_name = "./scan_dir/";
        std::fs::create_dir(dir_name).unwrap();

        let file_name = dir_name.to_string() + file_name;
        put_file_contents(&file_name, content).unwrap();
        assert_eq!(get_file_contents(&file_name, None).unwrap(), content);
        assert!(get_file_meta(&file_name).unwrap().is_file());
        assert!(
            !scan_files("./scan_dir/", "parquet", None)
                .unwrap()
                .is_empty()
        );

        std::fs::remove_file(&file_name).unwrap();
        std::fs::remove_dir(dir_name).unwrap();
    }

    #[test]
    fn test_get_file_contents_with_range() {
        let content = b"Hello World";
        let file_name = "range_test.txt";

        put_file_contents(file_name, content).unwrap();

        // Test valid range
        assert_eq!(get_file_contents(file_name, Some(0..5)).unwrap(), b"Hello");

        // Test invalid range should error
        assert!(get_file_contents(file_name, Some(3..5)).is_ok());

        // Test out of bounds should error
        assert!(get_file_contents(file_name, Some(0..100)).is_err());

        std::fs::remove_file(file_name).unwrap();
    }

    // Additional comprehensive tests for better coverage
    #[test]
    fn test_file_metadata_functions() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test_file.txt");
        let content = b"Test content for metadata";

        // Create test file
        fs::write(&file_path, content).unwrap();

        // Test get_file_meta
        let metadata = get_file_meta(&file_path).unwrap();
        assert!(metadata.is_file());
        assert_eq!(metadata.len(), content.len() as u64);

        // Test get_file_size
        let size = get_file_size(&file_path).unwrap();
        assert_eq!(size, content.len() as u64);

        // Test is_exists
        assert!(is_exists(file_path.to_str().unwrap()));

        // Test non-existent file
        let non_existent = temp_dir.path().join("non_existent.txt");
        assert!(!is_exists(non_existent.to_str().unwrap()));
        assert!(get_file_meta(&non_existent).is_err());
        assert!(get_file_size(&non_existent).is_err());
    }

    #[test]
    fn test_put_file_contents_atomic_write() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("atomic_test.txt");
        let content = b"Atomic write test content";

        // Test atomic write
        put_file_contents(file_path.to_str().unwrap(), content).unwrap();

        // Verify content was written correctly
        let read_content = fs::read(&file_path).unwrap();
        assert_eq!(&read_content, content);

        // Test overwriting existing file
        let new_content = b"New content after overwrite";
        put_file_contents(file_path.to_str().unwrap(), new_content).unwrap();

        let read_content = fs::read(&file_path).unwrap();
        assert_eq!(&read_content, new_content);
    }

    #[test]
    fn test_scan_files_with_limit() {
        let temp_dir = TempDir::new().unwrap();

        // Create multiple test files
        for i in 0..3 {
            let file_path = temp_dir.path().join(format!("test_{}.txt", i));
            fs::write(file_path, format!("Content {}", i)).unwrap();
        }

        // Test scanning without limit
        let all_files = scan_files(temp_dir.path(), "txt", None).unwrap();
        assert_eq!(all_files.len(), 3);

        // Test scanning with limit
        let limited_files = scan_files(temp_dir.path(), "txt", Some(2)).unwrap();
        assert_eq!(limited_files.len(), 2);

        // Test scanning with zero limit - this should return all files since limit 0 means no limit
        let zero_files = scan_files(temp_dir.path(), "txt", Some(0)).unwrap();
        assert_eq!(zero_files.len(), 3);
    }

    #[test]
    fn test_scan_files_recursive() {
        let temp_dir = TempDir::new().unwrap();

        // Create nested directory structure
        let sub_dir = temp_dir.path().join("subdir");
        fs::create_dir(&sub_dir).unwrap();

        // Create files in root and subdir
        let root_file = temp_dir.path().join("root.txt");
        let sub_file = sub_dir.join("sub.txt");

        fs::write(root_file, "root content").unwrap();
        fs::write(sub_file, "sub content").unwrap();

        // Test recursive scanning
        let all_files = scan_files(temp_dir.path(), "txt", None).unwrap();
        assert_eq!(all_files.len(), 2);

        // Verify both files are found
        let file_names: Vec<_> = all_files
            .iter()
            .map(|f| {
                std::path::Path::new(f)
                    .file_name()
                    .unwrap()
                    .to_str()
                    .unwrap()
            })
            .collect();
        assert!(file_names.contains(&"root.txt"));
        assert!(file_names.contains(&"sub.txt"));
    }

    #[test]
    fn test_scan_files_extension_filtering() {
        let temp_dir = TempDir::new().unwrap();

        // Create files with different extensions
        let txt_file = temp_dir.path().join("test.txt");
        let json_file = temp_dir.path().join("test.json");
        let parquet_file = temp_dir.path().join("test.parquet");

        fs::write(txt_file, "txt content").unwrap();
        fs::write(json_file, "json content").unwrap();
        fs::write(parquet_file, "parquet content").unwrap();

        // Test filtering by txt extension
        let txt_files = scan_files(temp_dir.path(), "txt", None).unwrap();
        assert_eq!(txt_files.len(), 1);
        assert!(txt_files[0].ends_with("test.txt"));

        // Test filtering by json extension
        let json_files = scan_files(temp_dir.path(), "json", None).unwrap();
        assert_eq!(json_files.len(), 1);
        assert!(json_files[0].ends_with("test.json"));

        // Test filtering by non-existent extension
        let non_existent_files = scan_files(temp_dir.path(), "xyz", None).unwrap();
        assert_eq!(non_existent_files.len(), 0);
    }

    #[test]
    fn test_get_file_contents_edge_cases() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("edge_case.txt");
        let content = b"Edge case content for testing";

        fs::write(&file_path, content).unwrap();

        // Test reading entire file
        let full_content = get_file_contents(file_path.to_str().unwrap(), None).unwrap();
        assert_eq!(full_content, content);

        // Test reading with exact range
        let range_content =
            get_file_contents(file_path.to_str().unwrap(), Some(0..content.len() as u64)).unwrap();
        assert_eq!(range_content, content);

        // Test reading with partial range (5..10 gives "case " with space)
        let partial_content = get_file_contents(file_path.to_str().unwrap(), Some(5..10)).unwrap();
        assert_eq!(partial_content, b"case ");

        // Test reading with zero-length range
        let zero_content = get_file_contents(file_path.to_str().unwrap(), Some(5..5)).unwrap();
        assert_eq!(zero_content, b"");

        // Test reading with range starting at end
        let end_content = get_file_contents(
            file_path.to_str().unwrap(),
            Some(content.len() as u64..content.len() as u64),
        )
        .unwrap();
        assert_eq!(end_content, b"");
    }

    #[test]
    fn test_file_operations_error_handling() {
        // Test reading non-existent file
        let result = get_file_contents("non_existent_file.txt", None);
        assert!(result.is_err());

        // Test reading file with invalid range
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, b"test").unwrap();

        // Test range extending beyond file size
        let result = get_file_contents(file_path.to_str().unwrap(), Some(0..100));
        assert!(result.is_err());

        // Test range where start > end (this should not cause overflow)
        let result = get_file_contents(file_path.to_str().unwrap(), Some(5..3));
        assert!(result.is_err());
    }

    #[test]
    fn test_scan_files_empty_directory() {
        let temp_dir = TempDir::new().unwrap();

        // Test scanning empty directory
        let files = scan_files(temp_dir.path(), "txt", None).unwrap();
        assert_eq!(files.len(), 0);

        // Test scanning with limit on empty directory
        let files = scan_files(temp_dir.path(), "txt", Some(10)).unwrap();
        assert_eq!(files.len(), 0);
    }

    #[test]
    fn test_scan_files_symlink_handling() {
        let temp_dir = TempDir::new().unwrap();

        // Create a regular file
        let target_file = temp_dir.path().join("target.txt");
        fs::write(&target_file, "target content").unwrap();

        // Create a symlink (this test will be skipped on Windows)
        #[cfg(unix)]
        {
            use std::os::unix::fs;
            let symlink_file = temp_dir.path().join("symlink.txt");
            fs::symlink(&target_file, &symlink_file).unwrap();

            // Test that symlinks are followed
            let files = scan_files(temp_dir.path(), "txt", None).unwrap();
            assert_eq!(files.len(), 2); // Both target and symlink

            // Verify symlink is included
            let has_symlink = files.iter().any(|f| f.ends_with("symlink.txt"));
            assert!(has_symlink);
        }
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

        let temp_dir = tempfile::tempdir().expect("Temp dir");

        let root = temp_dir.path();

        for thread in threads {
            for year in &years {
                for month in &months {
                    for day in &days {
                        for hour in &hours {
                            tokio::fs::create_dir_all(format!(
                                "{}/{}/{}/{}/{}/{}",
                                root.display(),
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
                                        root.display(),
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
            PathBuf::from(root).components().count() + 1,
        );
        let files = scan_files_filtered(root, filter, None)
            .await
            .expect("Basic Test Failure");

        assert_eq!(files.len(), 12);
    }
}
