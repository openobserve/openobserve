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

use std::{
    fs::{create_dir_all, remove_file, File, OpenOptions},
    io::{self, Seek, SeekFrom, Write},
    path::PathBuf,
};

// use byteorder::{BigEndian, WriteBytesExt};
use config::CONFIG;
use tokio::io::AsyncWriteExt;

use super::entry::IngestEntry;

/// File extension for segment files.
const FILE_EXTENSION: &str = "wal";

pub async fn persist_pending_tasks(stream_name: &str, worker_id: &str, task: IngestEntry) {
    let path = build_file_path(stream_name, worker_id);
    create_dir_all(path.parent().unwrap());
    let mut f = OpenOptions::new()
        .write(true)
        .create(true)
        .append(false)
        .open(&path)
        .unwrap();

    // let mut writer = Vec::new();
    // let x = writer.write_u64::<BigEndian>(0);
}

fn build_file_path(stream_name: &str, worker_id: &str) -> PathBuf {
    let mut path = PathBuf::from(&CONFIG.common.data_wal_dir);
    path.push("ingest_buffer");
    path.push(stream_name);
    path.push(worker_id);
    path.set_extension(FILE_EXTENSION);
    path
}
