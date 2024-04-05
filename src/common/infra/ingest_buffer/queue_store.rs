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
    fs::{create_dir_all, remove_file, File, OpenOptions},
    io::{BufReader, Read, Write},
    path::PathBuf,
};

use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use config::CONFIG;
use ingester::scan_files;

use super::entry::IngestEntry;

/// File extension for segment files.
const FILE_EXTENSION: &str = "wal";

pub(super) fn persist_tasks(
    stream_name: &str,
    worker_id: &str,
    tasks: &Vec<IngestEntry>,
) -> Result<(), anyhow::Error> {
    let arr: Vec<Vec<u8>> = tasks.iter().map(|t| t.into_bytes().unwrap()).collect();

    let path = build_file_path(stream_name, worker_id);
    // remove if already exists
    if path.exists() {
        remove_file(&path)?;
    }

    let _ = create_dir_all(path.parent().unwrap());
    let mut f = OpenOptions::new()
        .write(true)
        .create(true)
        .append(true)
        .open(&path)
        .unwrap();

    for data in arr {
        let data_len = data.len();
        f.write_u16::<BigEndian>(data_len as u16)?;
        f.write_all(&data)?;
    }
    f.sync_all()?;

    Ok(())
}

pub(super) async fn send_persisted_tasks() -> Result<(), anyhow::Error> {
    let wal_dir = PathBuf::from(&CONFIG.common.data_wal_dir).join("ingest_buffer");
    create_dir_all(&wal_dir)?;
    let wal_files = scan_files(wal_dir, FILE_EXTENSION);
    if wal_files.is_empty() {
        return Ok(());
    }
    let mut entry_size_buf = [0; std::mem::size_of::<u16>()];

    for wal_file in wal_files.iter() {
        let f = File::open(wal_file)?;
        let mut f = BufReader::new(f);

        loop {
            match f.read_exact(&mut entry_size_buf) {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break, // end of file
                Err(_) => return Err(anyhow::anyhow!("Error reading file when repalying")),
            }
            let mut entry = vec![0; entry_size_buf.len() as usize];
            f.read_exact(&mut entry)?;
            let entry = IngestEntry::from_bytes(&entry)?;
            entry.ingest().await?;
        }
    }

    Ok(())
}

fn build_file_path(stream_name: &str, worker_id: &str) -> PathBuf {
    let mut path = PathBuf::from(&CONFIG.common.data_wal_dir);
    path.push("ingest_buffer");
    path.push(stream_name);
    path.push(worker_id);
    path.set_extension(FILE_EXTENSION);
    path
}
