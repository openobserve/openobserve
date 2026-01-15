// Copyright 2025 OpenObserve Inc.
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
    fs::{File, create_dir_all},
    io::{BufRead, BufReader},
    path::PathBuf,
    sync::Arc,
};

use config::{
    get_config, metrics,
    utils::{async_walkdir::WalkDir, schema::infer_json_schema_from_values, schema_ext::SchemaExt},
};
use futures::StreamExt;
use hashbrown::HashMap;
use snafu::ResultExt;

use crate::{errors::*, immutable, memtable, writer::WriterKey};

// check uncompleted parquet files
// the wal file process have 4 steps:
// 1. write the memory file into disk with .par file extension
// 2. create a lock file with those file names
// 3. delete the wal file
// 4. rename the .par files to .parquet
// 5. delete the lock file
//
// so, there are some cases that the process is not completed:
// 1. the process is killed before step 2, so there are some .par files and have no lock file, need
//    delete those files
// 2. the process is killed before step 3, so there are some .par files and have lock file, the
//    files actually wrote to disk completely, need to continue step 3, 4 and 5
// 3. the process is killed before step 4, so there are some .par files and have lock file, the
//    files actually wrote to disk completely, need to continue step 4 and 5
// 4. the process is killed before step 5, so there are some .parquet files and have lock file, the
//    files actually wrote to disk completely, need to continue step 5
pub(crate) async fn check_uncompleted_parquet_files() -> Result<()> {
    let cfg = config::get_config();
    // 1. get all .lock files
    let wal_dir = PathBuf::from(&cfg.common.data_wal_dir).join(crate::WAL_DIR_DEFAULT_PREFIX);
    // create wal dir if not exists
    create_dir_all(&wal_dir).context(OpenDirSnafu {
        path: wal_dir.clone(),
    })?;
    let lock_files = wal_scan_files(wal_dir, "lock").await.unwrap_or_default();

    // 2. check if there is a .wal file with same name, delete it and rename the .par to .parquet
    for lock_file in lock_files.iter() {
        log::warn!("found uncompleted wal file: {lock_file:?}");
        let wal_file = lock_file.with_extension("wal");
        if wal_file.exists() {
            // delete the .wal file
            log::warn!("delete processed wal file: {wal_file:?}");
            std::fs::remove_file(&wal_file).context(DeleteFileSnafu { path: wal_file })?;
        }
        // read all the .par files
        let mut file = File::open(lock_file).context(OpenFileSnafu { path: lock_file })?;
        let mut par_files = Vec::new();
        for line in BufReader::new(&mut file).lines() {
            let line = line.context(ReadFileSnafu { path: lock_file })?;
            par_files.push(line);
        }
        // rename the .par file to .parquet
        for par_file in par_files.iter() {
            let par_file = PathBuf::from(par_file);
            let parquet_file = par_file.with_extension("parquet");
            log::warn!("rename par file: {par_file:?} to parquet");
            if par_file.exists() {
                std::fs::rename(&par_file, &parquet_file)
                    .context(RenameFileSnafu { path: par_file })?;
            }
        }
        // delete the .lock file
        log::warn!("delete lock file: {lock_file:?}");
        std::fs::remove_file(lock_file).context(DeleteFileSnafu {
            path: lock_file.clone(),
        })?;
    }

    // 4. delete all the .par files
    let parquet_dir = PathBuf::from(&cfg.common.data_wal_dir).join("files");
    // create wal dir if not exists
    create_dir_all(&parquet_dir).context(OpenDirSnafu {
        path: parquet_dir.clone(),
    })?;
    let par_files = wal_scan_files(parquet_dir, "par").await.unwrap_or_default();
    for par_file in par_files.iter() {
        log::warn!("delete uncompleted par file: {par_file:?}");
        std::fs::remove_file(par_file).context(DeleteFileSnafu { path: par_file })?;
    }
    Ok(())
}

// replay wal files to create immutable
pub(crate) async fn replay_wal_files(wal_dir: PathBuf, wal_files: Vec<PathBuf>) -> Result<()> {
    if wal_files.is_empty() {
        return Ok(());
    }
    for wal_file in wal_files.iter() {
        log::warn!("replay wal file: {wal_file:?} starting...");
        let file_str = wal_file
            .strip_prefix(&wal_dir)
            .unwrap()
            .to_str()
            .unwrap()
            .replace('\\', "/")
            .to_string();
        let file_columns = file_str.split('/').collect::<Vec<_>>();
        let stream_type = file_columns[file_columns.len() - 2];
        let org_id = file_columns[file_columns.len() - 3];
        let idx: usize = file_columns[file_columns.len() - 4]
            .parse()
            .unwrap_or_default();
        let key = WriterKey::new_replay(org_id, stream_type);
        let mut memtable = memtable::MemTable::new();
        let mut reader = match wal::Reader::from_path(wal_file) {
            Ok(v) => v,
            Err(e) => {
                log::error!("Unable to open the wal file err: {e}, skip");
                continue;
            }
        };
        let mut total = 0;
        let mut i = 0;
        loop {
            if i > 0 && i % 1000 == 0 {
                log::warn!("replay wal file: {wal_file:?}, entries: {i}, records: {total}");
            }
            let entry = match reader.read_entry() {
                Ok(entry) => entry,
                Err(wal::Error::UnableToReadData { source }) => {
                    log::error!("Unable to read entry from: {source}, skip the entry");
                    continue;
                }
                Err(wal::Error::LengthMismatch { expected, actual }) => {
                    log::error!(
                        "Unable to read entry: Length mismatch: expected {expected}, actual {actual}, skip the entry"
                    );
                    continue;
                }
                Err(wal::Error::ChecksumMismatch { expected, actual }) => {
                    log::error!(
                        "Unable to read entry: Checksum mismatch: expected {expected}, actual {actual}, skip the entry"
                    );
                    continue;
                }
                Err(e) => {
                    return Err(Error::WalError { source: e });
                }
            };
            let Some(entry_bytes) = entry else {
                break;
            };
            let mut entry = match super::Entry::from_bytes(&entry_bytes) {
                Ok(v) => v,
                Err(Error::ReadDataError { source }) => {
                    log::error!("Unable to read entry from: {source}, skip the entry");
                    continue;
                }
                Err(e) => {
                    return Err(e);
                }
            };
            i += 1;
            total += entry.data.len();

            // Use Entry org_id if available, otherwise fall back to file path
            let org_id = if !entry.org_id.is_empty() {
                entry.org_id.as_ref()
            } else {
                org_id
            };

            let infer_schema =
                infer_json_schema_from_values(entry.data.iter().cloned(), stream_type)
                    .context(InferJsonSchemaSnafu)?;
            let latest_schema = infra::schema::get_cache(org_id, &entry.stream, stream_type.into())
                .await
                .map_err(|e| Error::ExternalError {
                    source: Box::new(e),
                })?;
            entry.schema_key = latest_schema.hash_key().into();
            let infer_schema = Arc::new(infer_schema.cloned_from(latest_schema.schema()));
            let batch = entry.into_batch(key.stream_type.clone(), infer_schema.clone())?;
            memtable.write(infer_schema, entry, batch)?;
        }

        // directly dump the memtable to disk
        let start = std::time::Instant::now();
        let wal_path = wal_file.to_owned();
        let immutable = immutable::Immutable::new(idx, key, memtable);
        let stat = match immutable.persist(&wal_path).await {
            Ok(v) => v,
            Err(e) => {
                log::error!("persist wal file: {wal_file:?} to disk error: {e}");
                continue;
            }
        };

        // update metrics
        metrics::INGEST_MEMTABLE_BYTES
            .with_label_values::<&str>(&[])
            .sub(stat.json_size);
        metrics::INGEST_MEMTABLE_ARROW_BYTES
            .with_label_values::<&str>(&[])
            .sub(stat.arrow_size as i64);
        metrics::INGEST_MEMTABLE_FILES
            .with_label_values::<&str>(&[])
            .dec();

        log::warn!(
            "replay wal file: {:?} done, json_size: {}, arrow_size: {}, file_num: {} batch_num: {}, took: {} ms",
            wal_path.to_string_lossy(),
            stat.json_size,
            stat.arrow_size,
            stat.file_num,
            stat.batch_num,
            start.elapsed().as_millis(),
        );
    }

    Ok(())
}

pub(crate) async fn wal_scan_files(
    root_dir: impl Into<PathBuf>,
    ext: &str,
) -> Result<Vec<PathBuf>> {
    Ok(WalkDir::new(root_dir.into())
        .filter_map(|entry| async move {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.is_file() {
                let path_ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default();
                if path_ext == ext { Some(path) } else { None }
            } else {
                None
            }
        })
        .collect()
        .await)
}

/// Collect parquet file metrics from the files directory
/// Counts parquet files that are pending upload to object store
pub async fn collect_wal_parquet_metrics() -> Result<()> {
    let cfg = get_config();
    let parquet_dir = PathBuf::from(&cfg.common.data_wal_dir).join("files");

    // Get all parquet files
    let parquet_files = match wal_scan_files(parquet_dir, "parquet").await {
        Ok(files) => files,
        Err(_) => return Ok(()), // Directory doesn't exist or no files
    };

    // Count parquet files by org_id and stream_type
    let mut parquet_counts: HashMap<(String, String), i64> = HashMap::new();

    for file_path in parquet_files {
        // Parse the file path to extract org_id and stream_type
        // Path format: files/org_id/stream_type/stream_name/...
        let path_str = file_path.to_string_lossy();
        let parts: Vec<&str> = path_str.split('/').collect();

        // Find the "files" directory and extract org_id and stream_type from there
        if let Some(files_idx) = parts.iter().position(|&p| p == "files")
            && parts.len() > files_idx + 2
        {
            let org_id = parts[files_idx + 1];
            let stream_type = parts[files_idx + 2];

            if !org_id.is_empty() && !stream_type.is_empty() {
                let key = (org_id.to_string(), stream_type.to_string());
                *parquet_counts.entry(key).or_insert(0) += 1;
            }
        }
    }

    // Update metrics with current counts
    for ((org_id, stream_type), count) in parquet_counts {
        metrics::INGEST_PARQUET_FILES
            .with_label_values(&[&org_id, &stream_type])
            .set(count);
    }

    Ok(())
}
