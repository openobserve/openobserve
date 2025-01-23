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

use std::collections::BinaryHeap;

use config::cluster::LOCAL_NODE;
use wal::ReadFrom;

use crate::service::pipeline::{
    pipeline_offset_manager::PipelineOffsetManager, pipeline_receiver::PipelineReceiver,
    pipeline_wal_writer::get_metadata_motified,
};

pub async fn run() -> Result<(), anyhow::Error> {
    if !LOCAL_NODE.is_ingester() || !LOCAL_NODE.is_alert_manager() {
        return Ok(());
    }

    tokio::task::spawn(async move { cleanup_expired_remote_wal_files().await });

    Ok(())
}

async fn cleanup_expired_remote_wal_files() {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(600)).await; // 10 min interval
        log::debug!("[PIPELINE] Running data retention");
        let _ = cleanup().await;
    }
}

async fn cleanup() -> Result<(), anyhow::Error> {
    let mut wal_file_iter = PipelineOffsetManager::get_all_remote_wal_file().await;
    let tmp_wal_file_iter = PipelineOffsetManager::get_all_remote_tmp_wal_file().await;
    let mut total_size = 0;
    let mut files_donot_delete: BinaryHeap<(u64, u64, String)> = BinaryHeap::new();
    wal_file_iter.extend(tmp_wal_file_iter);
    for wal_file in wal_file_iter.iter() {
        match PipelineReceiver::new(wal_file.clone(), ReadFrom::Beginning) {
            Ok(fw) => {
                // todo: every stream has its own retention policy, cache it or select every time?
                if fw.should_delete_on_data_retention().await {
                    log::debug!("[PIPELINE] Deleting wal file: {:?}", wal_file);
                    if let Err(e) = tokio::fs::remove_file(wal_file).await {
                        log::error!(
                            "[PIPELINE] Failed to delete wal file: {:?}, error: {:?}",
                            wal_file,
                            e
                        );
                    }
                }

                let metadata = match tokio::fs::metadata(wal_file).await {
                    Ok(m) => m,
                    Err(e) => {
                        log::error!(
                            "[PIPELINE] Failed to get metadata for {}: {}",
                            wal_file.display(),
                            e
                        );
                        continue;
                    }
                };

                let file_size = metadata.len();
                total_size += file_size;
                let mod_time = get_metadata_motified(&metadata).elapsed().as_secs();
                files_donot_delete.push((
                    mod_time,
                    file_size,
                    fw.path.to_string_lossy().to_string(),
                ));
            }
            Err(e) => {
                log::error!(
                    "[PIPELINE] wal file is incorrect: {:?}, error: {:?}",
                    wal_file,
                    e
                );
                if let Err(e) = tokio::fs::remove_file(wal_file).await {
                    log::error!(
                        "[PIPELINE] Failed to delete wal file: {:?}, error: {:?}",
                        wal_file,
                        e
                    );
                }
            }
        }
    }

    // clean up by size limit
    let wal_size_limit = config::get_config().pipeline.wal_size_limit;
    while total_size > wal_size_limit {
        if let Some((_, size, file_path)) = files_donot_delete.pop() {
            log::debug!("[PIPELINE] cleanup deleting: {}", file_path);
            if let Err(e) = tokio::fs::remove_file(&file_path).await {
                log::error!(
                    "[PIPELINE] cleanup failed to delete: {}, error: {e}",
                    file_path
                );
            }
            // always decrease total_size, if delete above failed, next time we retry again
            total_size -= size;
        } else {
            break;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use crate::service::pipeline::pipeline_wal_writer::get_metadata_motified;

    #[tokio::test]
    async fn test_cleanup() {
        super::cleanup().await.unwrap();
    }

    #[tokio::test]
    async fn test_cleanup_size_limit() {
        use std::collections::BinaryHeap;
        let dir = tempfile::tempdir().unwrap();
        let file_path1 = dir.path().join("file1.txt");
        let file_path2 = dir.path().join("file2.txt");

        create_temp_file(&file_path1, 600_000).unwrap(); // 600 KB
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        create_temp_file(&file_path2, 600_000).unwrap(); // 600 KB

        let wal_files = vec![
            file_path1.to_string_lossy().to_string(),
            file_path2.to_string_lossy().to_string(),
        ];

        // 1 MB
        let size_limit = 1_000_000;

        let mut total_size = 0;
        let mut files_donot_delete: BinaryHeap<(u128, u64, String)> = BinaryHeap::new();

        for wal_file in wal_files.iter() {
            if let Ok(metadata) = tokio::fs::metadata(wal_file).await {
                total_size += metadata.len();
                let mod_time = get_metadata_motified(&metadata).elapsed().as_micros();
                files_donot_delete.push((mod_time, metadata.len(), wal_file.clone()));
            }
        }

        while total_size > size_limit {
            if let Some((_, size, file_path)) = files_donot_delete.pop() {
                println!("pipeline cleanup deleting: {}", file_path);
                if tokio::fs::remove_file(&file_path).await.is_ok() {
                    total_size -= size;
                }
            } else {
                break;
            }
        }

        let mut remaining_files_count = 0;
        let mut dir_entries = tokio::fs::read_dir(dir.path()).await.unwrap();
        while let Some(entry) = dir_entries.next_entry().await.unwrap() {
            if entry.file_type().await.unwrap().is_file() {
                remaining_files_count += 1;
            }
        }

        assert!(remaining_files_count <= 1);
    }

    fn create_temp_file(path: &std::path::Path, size: usize) -> std::io::Result<()> {
        let mut file = std::fs::File::create(path)?;
        file.write_all(&vec![0; size])?;
        Ok(())
    }
}
