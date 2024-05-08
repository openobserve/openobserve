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
    io::{Read, Write},
    path::PathBuf,
};

use anyhow::{Context, Result};
use async_channel::Receiver;
use byteorder::WriteBytesExt;
use config::CONFIG;
use ingester::scan_files;

use super::{entry::IngestEntry, workers::process_tasks_with_retries};

/// File extension for segment files.
const FILE_EXTENSION: &str = "wal";
/// Delimiter for writing and reading IngestEntries to/from wal files
const DELIMITER: u8 = b'|';

/// Writes the given array of IngestEntries to disk at directory formatted by
/// pattern {data_wal_dir}/ingest_buffer/{stream_name}/{worker_id}.wal.
///
/// Overwrites if previously persisted.
///
/// Bytes of IngestEntries are written to wal file one by one separated by delimiter (|)
///
/// `entry|entry|entry|...`
pub(super) async fn persist_job(
    tq_index: usize,
    worker_id: String,
    store_sig_r: Receiver<Option<Vec<IngestEntry>>>,
) -> Result<()> {
    let path = build_file_path(tq_index, &worker_id);

    while let Ok(tasks) = store_sig_r.recv().await {
        if let Err(e) = persist_job_inner(&path, tasks) {
            log::error!(
                "TaskQueue({tq_index})-worker({worker_id}) failed to persist tasks: {:?} ",
                e
            );
        }
    }
    Ok(())
}

pub(super) fn persist_job_inner(path: &PathBuf, tasks: Option<Vec<IngestEntry>>) -> Result<()> {
    create_dir_all(path.parent().unwrap()).context("Failed to create directory")?;
    if let Some(tasks) = tasks {
        let f = OpenOptions::new()
                    .write(true)
                    .create(true)
                    .truncate(true) // always overwrite
                    .open(path)
                    .context("Failed to open file")?;

        let mut buf = zstd::Encoder::new(f, 3)?;

        for task in tasks {
            let bytes = task.into_bytes()?;
            buf.write_all(&bytes)?;
            buf.write_u8(DELIMITER)?;
        }
        buf.finish().context("Failed to sync file")?;
    } else {
        _ = remove_file(path);
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
    let wal_files = scan_files(wal_dir, FILE_EXTENSION).await?;
    if wal_files.is_empty() {
        return Ok(());
    }

    for wal_file in wal_files.iter() {
        log::warn!("Start replaying wal file: {:?}", wal_file);
        match decode_from_wal_file(wal_file) {
            Ok(Some(entries)) => {
                log::info!(
                    "Ingesting {} entries decoded from wal file: {:?}.",
                    entries.len(),
                    wal_file
                );
                // Hack temp tq_index & worker_id and max 1 retry
                process_tasks_with_retries(0, "0", &entries, 1).await;
            }
            _ => {
                log::error!("Failed to decode from wal file. Skip");
            }
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

fn decode_from_wal_file(wal_file: &PathBuf) -> Result<Option<Vec<IngestEntry>>> {
    let f = File::open(wal_file)?;
    let mut f = zstd::Decoder::new(f)?;
    let mut entries = vec![];
    let mut buffer = Vec::new();

    f.read_to_end(&mut buffer)?;
    let entries_bytes = buffer.split(|&b| b == DELIMITER);
    for entry_bytes in entries_bytes {
        if !entry_bytes.is_empty() {
            let entry = IngestEntry::from_bytes(entry_bytes)?;
            entries.push(entry);
        }
    }
    Ok(if entries.is_empty() {
        None
    } else {
        Some(entries)
    })
}
