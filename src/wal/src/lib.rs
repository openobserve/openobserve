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

mod errors;
mod reader;
mod writer;

use std::path::PathBuf;

pub use errors::*;
pub use reader::Reader;
pub use writer::Writer;

const SOFT_MAX_BUFFER_LEN: usize = 1024 * 128; // 128KB

pub const FILE_TYPE_IDENTIFIER_LEN: usize = 13;
type FileTypeIdentifier = [u8; FILE_TYPE_IDENTIFIER_LEN];
const FILE_TYPE_IDENTIFIER: &FileTypeIdentifier = b"OPENOBSERVEV2";
/// File extension for segment files.
const FILE_EXTENSION: &str = "wal";

pub fn build_file_path(
    root_dir: impl Into<PathBuf>,
    org_id: &str,
    stream_type: &str,
    id: u64,
) -> PathBuf {
    let mut path = root_dir.into();
    path.push(org_id);
    path.push(stream_type);
    path.push(id.to_string());
    path.set_extension(FILE_EXTENSION);
    path
}
