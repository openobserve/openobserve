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

use config::cluster::LOCAL_NODE;
use wal::ReadFrom;

use crate::service::pipeline::{
    pipeline_offset_manager::PipelineOffsetManager, pipeline_receiver::PipelineReceiver,
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
    wal_file_iter.extend(tmp_wal_file_iter);
    for wal_file in wal_file_iter.iter() {
        match PipelineReceiver::new(wal_file.clone(), ReadFrom::Beginning) {
            Ok(fw) => {
                // todo: every stream has its own retention policy, cache it or select every time?
                if fw.should_delete_on_data_retention() {
                    log::debug!("[PIPELINE] Deleting wal file: {:?}", wal_file);
                    if let Err(e) = tokio::fs::remove_file(wal_file).await {
                        log::error!(
                            "[PIPELINE] Failed to delete wal file: {:?}, error: {:?}",
                            wal_file,
                            e
                        );
                    }
                }
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

    Ok(())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn test_cleanup() {
        super::cleanup().await.unwrap();
    }
}
