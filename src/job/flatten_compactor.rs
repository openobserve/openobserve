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

use std::sync::Arc;

use config::{cluster::LOCAL_NODE, get_config, meta::stream::FileKey, spawn_pausable_job};
use tokio::sync::{Mutex, mpsc};

use crate::service::compact;

pub async fn run() -> Result<(), anyhow::Error> {
    if !LOCAL_NODE.is_flatten_compactor() {
        return Ok(());
    }

    let cfg = get_config();
    if !cfg.compact.enabled {
        return Ok(());
    }

    let (tx, rx) = mpsc::channel::<FileKey>(1);
    let rx = Arc::new(Mutex::new(rx));
    // start merge workers
    for _ in 0..cfg.limit.file_merge_thread_num {
        let rx = rx.clone();
        tokio::spawn(async move {
            loop {
                let ret = rx.lock().await.recv().await;
                match ret {
                    None => {
                        log::debug!("[FLATTEN_COMPACTOR:JOB] Receiving files channel is closed");
                        break;
                    }
                    Some(file) => match compact::flatten::generate_file(&file).await {
                        Ok(_) => {}
                        Err(e) => {
                            log::error!(
                                "[FLATTEN_COMPACTOR:JOB] Error generate flatten file: {}, err: {}",
                                file.key,
                                e
                            );
                        }
                    },
                }
            }
        });
    }

    spawn_pausable_job!(
        "flatten_compactor_generate",
        get_config().compact.interval,
        {
            log::debug!("[COMPACTOR] Running parquet file data flatten");
            let ret = compact::flatten::run_generate(tx.clone()).await;
            if ret.is_err() {
                log::error!(
                    "[COMPACTOR] run parquet file data flatten error: {}",
                    ret.err().unwrap()
                );
            }
        }
    );
    Ok(())
}
