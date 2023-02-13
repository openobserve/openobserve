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

pub fn get_file_meta(file: &str) -> Result<Metadata, std::io::Error> {
    let file = File::open(file)?;
    file.metadata()
}

pub fn get_file_contents(file: &str) -> Result<Vec<u8>, std::io::Error> {
    let mut file = File::open(file)?;
    let mut contents: Vec<u8> = Vec::new();
    file.read_to_end(&mut contents)?;
    Ok(contents)
}

pub fn put_file_contents(file: &str, contents: &[u8]) -> Result<(), std::io::Error> {
    let mut file = File::create(file)?;
    file.write_all(contents)?;
    Ok(())
}

pub fn delete_file(file: &str) -> Result<(), std::io::Error> {
    std::fs::remove_file(file)?;
    Ok(())
}

pub fn scan_files(pattern: &str) -> Vec<String> {
    let files: Vec<String> = glob::glob(pattern)
        .unwrap()
        .map(|m| m.unwrap().to_str().unwrap().to_string())
        .collect();
    files
}
