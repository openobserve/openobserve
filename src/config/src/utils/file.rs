// Copyright 2024 Zinc Labs Inc.
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
    fs::{File, Metadata},
    io::{Read, Write},
    path::Path,
};

use async_walkdir::WalkDir;
use futures::StreamExt;

#[inline(always)]
pub fn get_file_meta(file: &str) -> Result<Metadata, std::io::Error> {
    let file = File::open(file)?;
    file.metadata()
}

#[inline(always)]
pub fn get_file_contents(file: &str) -> Result<Vec<u8>, std::io::Error> {
    let mut file = File::open(file)?;
    let mut contents: Vec<u8> = Vec::new();
    file.read_to_end(&mut contents)?;
    Ok(contents)
}

#[inline(always)]
pub fn put_file_contents(file: &str, contents: &[u8]) -> Result<(), std::io::Error> {
    let mut file = File::create(file)?;
    file.write_all(contents)
}

#[inline(always)]
pub async fn scan_files<P: AsRef<Path>>(root: P, ext: &str, limit: Option<usize>) -> Vec<String> {
    let iter = WalkDir::new(root).filter_map(|entry| async move {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.is_file() {
            let path_ext = path.extension()?.to_str()?;
            if path_ext == ext {
                Some(path.to_str().unwrap().to_string())
            } else {
                None
            }
        } else {
            None
        }
    });
    if let Some(limit) = limit {
        iter.take(limit).collect().await
    } else {
        iter.collect().await
    }
}

pub async fn clean_empty_dirs(dir: &str) -> Result<(), std::io::Error> {
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
                        dirs.push(entry.path().to_str().unwrap().to_string());
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
        if let Ok(entries) = std::fs::read_dir(&dir) {
            if entries.count() == 0 {
                std::fs::remove_dir(&dir)?;
            }
        }
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

    #[tokio::test]
    async fn test_file() {
        let content = b"Some Text";
        let file_name = "sample.parquet";

        put_file_contents(file_name, content).unwrap();
        assert_eq!(get_file_contents(file_name).unwrap(), content);
        assert!(get_file_meta(file_name).unwrap().is_file());
        assert!(!scan_files(".", "parquet", None).await.is_empty());
        std::fs::remove_file(file_name).unwrap();
    }
}
