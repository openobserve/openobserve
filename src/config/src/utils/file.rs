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
    collections::HashMap,
    fs::{File, Metadata, metadata},
    io::{Read, Seek, Write},
    ops::Range,
    path::{Path, PathBuf},
};

use async_recursion::async_recursion;

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

#[allow(dead_code)]
struct FilteredDirWalker {
    backlog: Vec<(usize, PathBuf)>,
    depth_filters: HashMap<usize, fn(&PathBuf) -> bool>,
}

impl FilteredDirWalker {
    fn new(mut root: Vec<PathBuf>) -> Self {
        root.sort();
        Self {
            backlog: root.into_iter().map(|i| (0, i)).collect(),
            depth_filters: HashMap::new(),
        }
    }

    fn add_depth_filter(&mut self, depth: usize, filter: fn(&PathBuf) -> bool) {
        self.depth_filters.insert(depth, filter);
    }
}

impl Iterator for FilteredDirWalker {
    type Item = PathBuf;

    fn next(&mut self) -> Option<Self::Item> {
        // Assuming there won't be random special non-file paths here
        while let Some((depth, latest)) = self.backlog.pop() {
            if !self
                .depth_filters
                .get(&depth)
                .map(|filter| filter(&latest))
                .unwrap_or(true)
            {
                continue;
            }

            if latest.is_dir() {
                if let Ok(dir_contents) = std::fs::read_dir(latest) {
                    let mut dir_paths = dir_contents
                        .filter_map(|entry| entry.ok())
                        .filter_map(|entry| entry.path().canonicalize().ok())
                        .map(|entry| entry)
                        .collect::<Vec<PathBuf>>();

                    // Sorted in ascending order - Gets latest first
                    dir_paths.sort();

                    self.backlog.extend(dir_paths.into_iter().map(|entry| (depth + 1, entry)));
                }
            } else if latest.is_file() {
                return Some(latest);
            } else {
                continue
            }
        }

        None
    }
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
            let fl = if limit > 0 { limit - files.len() } else { 0 };
            let ff = scan_files(path, ext, Some(fl))?;
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

    #[test]
    fn test_sorted_deep_file_walker() {
        for day in 28..=31 {
            for hour in 22..24 {
                std::fs::create_dir_all(format!("./test_path/2025/12/{day}/{hour}")).unwrap();
                std::fs::create_dir_all(format!("./test_path/2025/12/{day}/{hour}/ignored")).unwrap();
                for file in 1..5 {
                    std::fs::File::create(format!("./test_path/2025/12/{day}/{hour}/{file}"))
                        .unwrap();
                }
            }
        }

        let mut walker = FilteredDirWalker::new(vec![PathBuf::from("./test_path")]);
        walker.add_depth_filter(2, |path| path.ends_with("12"));
        walker.add_depth_filter(3, |path| path.ends_with("28") || path.ends_with("30"));
        walker.add_depth_filter(5, |path| path.ends_with("3") || path.ends_with("2"));

        assert!(std::path::Path::new("./test_path/2025/12/31/23/4").exists());
        assert!(std::path::Path::new("./test_path/2025/12/31/23/3").exists());
        assert!(std::path::Path::new("./test_path/2025/12/31/22/4").exists());
        assert!(std::path::Path::new("./test_path/2025/12/31/22/3").exists());


        assert!(std::path::Path::new("./test_path/2025/12/30/23/4").exists());
        assert_eq!(
            walker.next(),
            PathBuf::from("./test_path/2025/12/30/23/3")
                .canonicalize()
                .ok()
        );
        assert_eq!(
            walker.next(),
            PathBuf::from("./test_path/2025/12/30/23/2")
                .canonicalize()
                .ok()
        );
        assert!(std::path::Path::new("./test_path/2025/12/30/23/1").exists());

        assert!(std::path::Path::new("./test_path/2025/12/30/22/4").exists());
        assert_eq!(
            walker.next(),
            PathBuf::from("./test_path/2025/12/30/22/3")
                .canonicalize()
                .ok()
        );
        assert_eq!(
            walker.next(),
            PathBuf::from("./test_path/2025/12/30/22/2")
                .canonicalize()
                .ok()
        );
        assert!(std::path::Path::new("./test_path/2025/12/30/22/1").exists());

        assert_eq!(
            walker.next(),
            PathBuf::from("./test_path/2025/12/28/23/3")
                .canonicalize()
                .ok()
        );
        assert_eq!(
            walker.next(),
            PathBuf::from("./test_path/2025/12/28/23/2")
                .canonicalize()
                .ok()
        );

        std::fs::remove_dir_all("./test_path").unwrap();
    }
}
