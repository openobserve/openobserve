use crate::infra::cache;
use crate::infra::cluster;
use crate::infra::config::CONFIG;
use crate::meta::common::FileMeta;

pub mod broadcast;
pub mod local;
pub mod remote;

#[inline]
pub async fn progress(key: &str, data: FileMeta, delete: bool) -> Result<(), anyhow::Error> {
    let old_data = cache::file_list::get_file_from_cache(key);
    match delete {
        true => {
            let data = match old_data {
                Ok(meta) => meta,
                Err(_e) => {
                    return Ok(());
                }
            };
            match cache::file_list::set_file_to_cache(key, None, true) {
                Ok(_) => {}
                Err(e) => {
                    log::error!(
                        "service:db:file_list: delete {}, set_file_to_cache error: {}",
                        key,
                        e
                    );
                }
            }
            match cache::stats::decr_stream_stats(key, data) {
                Ok(_) => {}
                Err(e) => {
                    log::error!(
                        "service:db:file_list: delete {}, incr_stream_stats error: {}",
                        key,
                        e
                    );
                }
            }
        }
        false => {
            match cache::file_list::set_file_to_cache(key, Some(data), false) {
                Ok(_) => {}
                Err(e) => {
                    log::error!(
                        "service:db:file_list: add {}, set_file_to_cache error: {}",
                        key,
                        e
                    );
                }
            }
            if CONFIG.memory_cache.cache_latest_files
                && cluster::is_querier(&cluster::LOCAL_NODE_ROLE)
            {
                match cache::file_data::download(key).await {
                    Ok(_) => {}
                    Err(e) => {
                        log::error!("service:db:file_list: add {}, download error: {}", key, e);
                    }
                }
            }
            if old_data.is_ok() {
                return Ok(()); // already exists, skip increase stats
            };
            match cache::stats::incr_stream_stats(key, data) {
                Ok(_) => {}
                Err(e) => {
                    log::error!(
                        "service:db:file_list: add {}, incr_stream_stats error: {}",
                        key,
                        e
                    );
                }
            }
        }
    }

    Ok(())
}
