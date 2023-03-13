// Copyright 2022 Zinc Labs Inc. and Contributors
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
    file.write_all(contents)?;
    Ok(())
}

#[inline(always)]
pub fn scan_files(pattern: &str) -> Vec<String> {
    glob::glob(pattern)
        .unwrap()
        .map(|m| m.unwrap().to_str().unwrap().to_string())
        .collect()
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
        assert!(!scan_files(file_name).is_empty());
        std::fs::remove_file(file_name).unwrap();
    }
}
