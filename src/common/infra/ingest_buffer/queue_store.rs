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

use anyhow::{Context, Result};
use async_channel::Receiver;
use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use config::CONFIG;
use ingester::scan_files;

use super::{entry::IngestEntry, workers::process_tasks_with_retries};

/// File extension for segment files.
const FILE_EXTENSION: &str = "wal";

/// Writes the given array of IngestEntries to disk at direcotry formatted by
/// pattern {data_wal_dir}/ingest_buffer/{stream_name}/{worker_id}.wal.
///
/// Overwrites if previously persisted.
///
/// Bytes of IngestEntries are written to wal file one by one following pattern
/// {entry_len, entry, entry_len, entry}.
///
/// <entry_len> written in u16 ordered by BigEndian.
pub(super) async fn persist_job(
    tq_index: usize,
    worker_id: String,
    store_sig_r: Receiver<Option<Vec<IngestEntry>>>,
) -> Result<()> {
    let path = build_file_path(tq_index, &worker_id);
    create_dir_all(path.parent().unwrap()).context("Failed to create directory")?;

    while let Ok(tasks) = store_sig_r.recv().await {
        log::info!("TaskQueue({tq_index})-worker({worker_id}) persist job starts");

        match persist_job_inner(&path, tasks) {
            Err(e) => {
                log::error!(
                    "TaskQueue({tq_index})-worker({worker_id}) failed to persist tasks: {:?} ",
                    e
                );
            }
            Ok(_) => {
                log::info!("TaskQueue({tq_index})-worker({worker_id}) persist job done");
            }
        }
    }
    Ok(())
}

pub(super) fn persist_job_inner(path: &PathBuf, tasks: Option<Vec<IngestEntry>>) -> Result<()> {
    if let Some(tasks) = tasks {
        let mut f = OpenOptions::new()
                    .write(true)
                    .create(true)
                    .truncate(true) // always overwrite
                    .open(path)
                    .context("Failed to open file")?;

        for task in tasks {
            let bytes = task.into_bytes()?;
            let len = bytes.len();
            f.write_u16::<BigEndian>(len as u16)?;
            f.write_all(&bytes)?;
        }

        f.sync_all().context("Failed to sync file")?;
    } else {
        remove_file(path)?;
    }

    Ok(())
}

/// Finds all existing .wal files from {data_wal_dir}/ingest_buffer/* directory.
/// Reads and decodes each wal file into Vec<IngestEntry> and ingests them.
///
/// Only called in application init process.
pub(super) async fn replay_persisted_tasks() -> Result<()> {
    let wal_dir = PathBuf::from(&CONFIG.common.data_wal_dir).join("ingest_buffer");
    create_dir_all(&wal_dir).context("Failed to open wal/ingest_buffer directory")?;
    let wal_files = scan_files(wal_dir, FILE_EXTENSION).await;
    if wal_files.is_empty() {
        return Ok(());
    }

    for wal_file in wal_files.iter() {
        log::warn!("Start replaying wal file: {:?}", wal_file);
        let f = match File::open(wal_file) {
            Ok(f) => f,
            Err(e) => {
                log::error!(
                    "Unable to open the wal file err: {}. Remove and skip file",
                    e
                );
                remove_file(wal_file)?;
                continue;
            }
        };
        let mut f = BufReader::new(f);
        let mut entries = vec![];
        while let Ok(entry_size) = f.read_u16::<BigEndian>() {
            let mut entry = vec![0; entry_size as usize];
            f.read_exact(&mut entry)?;
            let entry = IngestEntry::from_bytes(&entry)?;
            entries.push(entry);
        }
        if !entries.is_empty() {
            log::info!(
                "Decoded {} IngestEntries from wal file: {:?}. Ingesting",
                entries.len(),
                wal_file
            );
            // Hack (stream_name = 0, worker_id=0)
            process_tasks_with_retries(0, "0", &entries, 1).await;
        }
        remove_file(wal_file)?;
    }
    Ok(())
}

/// Builds file path for TaskQueue workers to persist their pending tasks to disk.
pub(super) fn build_file_path(tq_index: usize, worker_id: &str) -> PathBuf {
    let tq_folder = format!("task_queue_{tq_index}");
    let mut path = PathBuf::from(&CONFIG.common.data_wal_dir);
    path.push("ingest_buffer");
    path.push(tq_folder);
    path.push(worker_id);
    path.set_extension(FILE_EXTENSION);
    path
}
