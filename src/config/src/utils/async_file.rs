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

use std::{fs::Metadata, ops::Range, path::Path, time::SystemTime};

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
                format!(
                    "Expected to read {} bytes, but read {} bytes",
                    to_read, read
                ),
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
    let temp_file = format!("{}.tmp", path);

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
                if let Ok(f) = entry.file_type().await {
                    if f.is_dir() {
                        match last_updated {
                            None => {
                                dirs.push(entry.path().to_str().unwrap().to_string());
                            }
                            Some(last_updated) => {
                                if let Ok(meta) = entry.metadata().await {
                                    if meta.modified().unwrap() < last_updated {
                                        dirs.push(entry.path().to_str().unwrap().to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Some(Err(e)) => {
                log::error!("clean_empty_dirs, err: {}", e);
                break;
            }
            None => break,
        }
    }
    dirs.sort_by_key(|b| std::cmp::Reverse(b.len()));
    for dir in dirs {
        if let Ok(mut entries) = read_dir(&dir).await {
            if let Ok(None) = entries.next_entry().await {
                if let Err(e) = remove_dir(&dir).await {
                    log::error!("Failed to remove empty dir: {}, err: {}", dir, e);
                }
            }
        }
    }
    Ok(())
}

#[inline(always)]
pub async fn scan_files<P: AsRef<Path>>(
    root: P,
    ext: &str,
    limit: Option<usize>,
) -> Result<Vec<String>, std::io::Error> {
    let limit = limit.unwrap_or_default();
    let mut files = Vec::with_capacity(std::cmp::max(16, limit));
    let mut dir = tokio::fs::read_dir(root).await?;
    while let Some(entry) = dir.next_entry().await? {
        let path = entry.path();
        let metadata = entry.metadata().await?;
        if metadata.is_file() {
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
        } else if metadata.is_dir() {
            let fl = if limit > 0 { limit - files.len() } else { 0 };
            let ff = Box::pin(scan_files(path, ext, Some(fl))).await?;
            if !ff.is_empty() {
                files.extend(ff);
            };
            if limit > 0 && files.len() >= limit {
                return Ok(files);
            }
        }
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    async fn test_get_file_meta() {
        let content = b"Test content for metadata";
        let file_name = "meta_test_async.txt";

        put_file_contents(file_name, content).await.unwrap();

        let meta = get_file_meta(file_name).await.unwrap();
        assert!(meta.is_file());
        assert_eq!(meta.len(), content.len() as u64);

        std::fs::remove_file(file_name).unwrap();

        // Test non-existent file
        assert!(get_file_meta("non_existent_file.txt").await.is_err());
    }

    #[tokio::test]
    async fn test_get_file_size() {
        let content = b"Test content for size check";
        let file_name = "size_test_async.txt";

        put_file_contents(file_name, content).await.unwrap();

        let size = get_file_size(file_name).await.unwrap();
        assert_eq!(size, content.len() as u64);

        std::fs::remove_file(file_name).unwrap();

        // Test non-existent file
        assert!(get_file_size("non_existent_file.txt").await.is_err());
    }

    #[tokio::test]
    async fn test_is_exists() {
        let content = b"Test content for existence check";
        let file_name = "exists_test_async.txt";

        // File doesn't exist yet
        assert!(!is_exists(file_name).await);

        put_file_contents(file_name, content).await.unwrap();

        // File exists now
        assert!(is_exists(file_name).await);

        std::fs::remove_file(file_name).unwrap();

        // File doesn't exist again
        assert!(!is_exists(file_name).await);
    }

    #[tokio::test]
    async fn test_put_file_contents() {
        let content1 = b"First content";
        let content2 = b"Second content with different length";
        let file_name = "put_test_async.txt";

        // Test creating new file
        put_file_contents(file_name, content1).await.unwrap();
        let read_content = get_file_contents(file_name, None).await.unwrap();
        assert_eq!(read_content, content1);

        // Test overwriting existing file
        put_file_contents(file_name, content2).await.unwrap();
        let read_content = get_file_contents(file_name, None).await.unwrap();
        assert_eq!(read_content, content2);

        std::fs::remove_file(file_name).unwrap();
    }

    #[tokio::test]
    async fn test_clean_empty_dirs() {
        let test_dir = "test_clean_dirs";
        let empty_dir1 = format!("{}/empty1", test_dir);
        let empty_dir2 = format!("{}/empty2", test_dir);
        let non_empty_dir = format!("{}/nonempty", test_dir);
        let test_file = format!("{}/test.txt", non_empty_dir);

        // Create directory structure
        tokio::fs::create_dir_all(&empty_dir1).await.unwrap();
        tokio::fs::create_dir_all(&empty_dir2).await.unwrap();
        tokio::fs::create_dir_all(&non_empty_dir).await.unwrap();
        put_file_contents(&test_file, b"test content")
            .await
            .unwrap();

        // Verify directories exist
        assert!(is_exists(&empty_dir1).await);
        assert!(is_exists(&empty_dir2).await);
        assert!(is_exists(&non_empty_dir).await);
        assert!(is_exists(&test_file).await);

        // Clean empty directories
        clean_empty_dirs(test_dir, None).await.unwrap();

        // Empty directories should be removed, non-empty should remain
        assert!(!is_exists(&empty_dir1).await);
        assert!(!is_exists(&empty_dir2).await);
        assert!(is_exists(&non_empty_dir).await);
        assert!(is_exists(&test_file).await);

        // Cleanup
        std::fs::remove_file(&test_file).unwrap();
        std::fs::remove_dir_all(test_dir).unwrap();
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

    #[tokio::test]
    async fn test_get_file_contents_without_range() {
        let content = b"Complete file content without range";
        let file_name = "complete_test_async.txt";

        put_file_contents(file_name, content).await.unwrap();

        let read_content = get_file_contents(file_name, None).await.unwrap();
        assert_eq!(read_content, content);

        std::fs::remove_file(file_name).unwrap();
    }
}
