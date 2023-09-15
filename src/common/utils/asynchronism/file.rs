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

use std::fs::Metadata;
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncWriteExt},
};

#[inline(always)]
pub async fn get_file_meta(file: &str) -> Result<Metadata, std::io::Error> {
    let file = File::open(file).await?;
    file.metadata().await
}

#[inline(always)]
pub async fn get_file_contents(file: &str) -> Result<Vec<u8>, std::io::Error> {
    let mut file = File::open(file).await?;
    let mut contents: Vec<u8> = Vec::new();
    file.read_to_end(&mut contents).await?;
    Ok(contents)
}

#[inline(always)]
pub async fn put_file_contents(file: &str, contents: &[u8]) -> Result<(), std::io::Error> {
    let mut file = File::create(file).await?;
    file.write_all(contents).await
}
