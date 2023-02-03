use bytes::Buf;
use dashmap::DashMap;
use std::io::{BufRead, BufReader};
use tokio::sync::Semaphore;

use crate::common::json;
use crate::infra::config::CONFIG;
use crate::infra::storage;
use crate::meta::common::{FileKey, FileMeta};

lazy_static! {
    static ref DELETED_FILES: DashMap<String, FileMeta> = DashMap::with_capacity(64);
}

pub async fn cache() -> Result<(), anyhow::Error> {
    log::info!("[TRACE] Load file_list begin");
    let storage = &storage::DEFAULT;
    let prefix = "file_list/";
    let files = storage.list(prefix).await?;
    let mut tasks = Vec::new();
    let semaphore = std::sync::Arc::new(Semaphore::new(CONFIG.limit.query_thread_num));
    for file in files.iter() {
        let file = file.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: tokio::task::JoinHandle<Result<usize, anyhow::Error>> =
            tokio::task::spawn(async move {
                let count = proccess_file(storage.as_ref(), &file).await?;
                drop(permit);
                Ok(count)
            });
        tasks.push(task);
    }

    let mut count = 0;
    for task in tasks {
        match task.await {
            Ok(ret) => match ret {
                Ok(v) => {
                    count += v;
                }
                Err(e) => {
                    return Err(anyhow::anyhow!("[TRACE] Load file_list err: {:?}", e));
                }
            },
            Err(e) => {
                return Err(anyhow::anyhow!(e));
            }
        };
    }

    // delete files
    for item in DELETED_FILES.iter() {
        super::progress(item.key(), item.value().to_owned(), true).await?;
    }

    log::info!("[TRACE] Load file_list done[{}:{}]", files.len(), count);

    // clean deleted files
    DELETED_FILES.clear();

    Ok(())
}

async fn proccess_file(
    client: &dyn storage::FileStorage,
    file: &str,
) -> Result<usize, anyhow::Error> {
    // download file list from storage
    let data = client.get(file).await?;
    // uncompress file
    let uncompress = zstd::decode_all(data.reader())?;
    let uncompress_reader = BufReader::new(uncompress.reader());
    // parse file list
    let mut count = 0;
    for line in uncompress_reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        count += 1;
        let item: FileKey = json::from_slice(line.as_bytes())?;
        // check deleted files
        if item.deleted {
            DELETED_FILES.insert(item.key, item.meta.to_owned());
            continue;
        }
        super::progress(&item.key, item.meta, item.deleted).await?;
    }
    Ok(count)
}
