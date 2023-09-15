// Copyright 2023 Zinc Labs Inc.
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

use std::{
    fs::{File, Metadata},
    io::{Read, Write},
};

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
pub fn scan_files(root_dir: &str) -> Vec<String> {
    walkdir::WalkDir::new(root_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.path().to_str().unwrap().to_string())
        .collect()
}

pub fn clean_empty_dirs(dir: &str) -> Result<(), std::io::Error> {
    let mut dirs = Vec::new();
    for entry in walkdir::WalkDir::new(dir) {
        let entry = entry?;
        if entry.path().display().to_string() == dir {
            continue;
        }
        if entry.file_type().is_dir() {
            dirs.push(entry.path().to_str().unwrap().to_string());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file() {
        let content = b"Some Text";
        let file_name = "sample.parquet";

        put_file_contents(file_name, content).unwrap();
        assert_eq!(get_file_contents(file_name).unwrap(), content);
        assert!(get_file_meta(file_name).unwrap().is_file());
        assert!(!scan_files(".").is_empty());
        std::fs::remove_file(file_name).unwrap();
    }
}
