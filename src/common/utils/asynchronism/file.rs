// Copyright 2023 Zinc Labs Inc.
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
