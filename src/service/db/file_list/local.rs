use chrono::{TimeZone, Utc};
use std::fs::File;
use std::io::{BufRead, BufReader};

use crate::common::file::scan_files;
use crate::common::json;
use crate::infra::config::CONFIG;
use crate::infra::file_lock;
use crate::meta::common::{FileKey, FileMeta};
use crate::meta::StreamType;

pub async fn set(key: &str, meta: FileMeta, deleted: bool) -> Result<(), anyhow::Error> {
    let file_data = FileKey {
        key: key.to_string(),
        meta,
        deleted,
    };
    let mut write_buf = json::to_vec(&file_data)?;
    write_buf.push(b'\n');
    let hour_key = Utc
        .timestamp_nanos(meta.min_ts * 1000)
        .format("%Y_%m_%d_%H")
        .to_string();
    let file = file_lock::get_or_create(0, "", "", StreamType::Filelist, &hour_key);
    file.write(write_buf.as_ref());

    super::progress(key, meta, deleted).await?;
    super::broadcast::send(&[file_data]).await
}

pub async fn get_all() -> Result<Vec<FileKey>, anyhow::Error> {
    let mut result = Vec::new();
    let pattern = format!("{}/file_list/*.json", &CONFIG.common.data_wal_dir);
    let files = scan_files(&pattern);
    for file in files {
        let file = File::open(file)?;
        let reader = BufReader::new(file);
        // parse file list
        for line in reader.lines() {
            let line = line?;
            if line.is_empty() {
                continue;
            }
            let item: FileKey = json::from_slice(line.as_bytes())?;
            result.push(item);
        }
    }
    Ok(result)
}

#[inline]
pub async fn cache() -> Result<(), anyhow::Error> {
    let files = get_all().await?;
    for file in files {
        super::progress(&file.key, file.meta, false).await?;
    }
    Ok(())
}

#[inline]
pub async fn broadcast_cache() -> Result<(), anyhow::Error> {
    let files = get_all().await?;
    if files.is_empty() {
        return Ok(());
    }
    super::broadcast::send(&files).await
}
