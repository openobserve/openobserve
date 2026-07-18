// Copyright 2026 OpenObserve Inc.

use std::time::Duration;

use config::{get_config, meta::stream::StreamType};

pub async fn flush_cache_for_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<(), anyhow::Error> {
    let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
    if config::cluster::LOCAL_NODE.is_ingester() {
        let max_memtable_id = ingester::get_max_writer_seq_id().await;
        ingester::flush_all().await?;
        let ttl = get_config().limit.mem_persist_interval;
        for _ in 0..10 {
            let new_max_id = ingester::get_max_writer_seq_id().await;
            if new_max_id > max_memtable_id {
                break;
            }
            tokio::time::sleep(Duration::from_secs(ttl)).await;
        }
        for _ in 0..10 {
            if ingester::check_persist_done(max_memtable_id).await {
                break;
            }
            tokio::time::sleep(Duration::from_secs(ttl)).await;
        }
        let wal_dir = &get_config().common.data_wal_dir;
        let stream_dir = format!("{wal_dir}files/{stream_key}");
        if let Err(error) = tokio::fs::remove_dir_all(&stream_dir).await
            && error.kind() != std::io::ErrorKind::NotFound
        {
            return Err(anyhow::anyhow!(
                "Failed to delete parquet files from wal: {stream_dir}, error: {error}"
            ));
        }
    }

    if config::cluster::LOCAL_NODE.is_ingester() || config::cluster::LOCAL_NODE.is_querier() {
        let cache_dir = &get_config().common.data_cache_dir;
        for path in [
            format!("{cache_dir}results/{stream_key}"),
            format!("{cache_dir}aggregations/{stream_key}"),
            format!("{cache_dir}files/{stream_key}"),
        ] {
            if let Err(error) = tokio::fs::remove_dir_all(&path).await
                && error.kind() != std::io::ErrorKind::NotFound
            {
                return Err(anyhow::anyhow!(
                    "Failed to delete stream cache: {path}, error: {error}"
                ));
            }
        }
    }
    Ok(())
}
