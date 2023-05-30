// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::infra::{cache, config::CONFIG};
use crate::meta::StreamType;
use crate::service::db;

pub(crate) mod delete;
mod file_list;
mod lifecycle;
mod merge;

pub(crate) static QUEUE_LOCKER: Lazy<Arc<Mutex<bool>>> =
    Lazy::new(|| Arc::new(Mutex::const_new(false)));

/// compactor delete run steps:
pub async fn run_delete() -> Result<(), anyhow::Error> {
    // check data lifecyle date
    if CONFIG.compact.data_retention_enabled {
        let now = chrono::Utc::now();
        let date = now - chrono::Duration::days(CONFIG.compact.data_retention_days);
        let data_lifecycle_end = date.format("%Y-%m-%d").to_string();

        let orgs = cache::file_list::get_all_organization()?;
        let stream_types = [
            StreamType::Logs,
            StreamType::Metrics,
            StreamType::Traces,
            StreamType::LookUpTable,
        ];
        for org_id in orgs {
            for stream_type in stream_types {
                let streams = cache::file_list::get_all_stream(&org_id, stream_type)?;
                for stream_name in streams {
                    let schema = db::schema::get(&org_id, &stream_name, Some(stream_type)).await?;
                    let stream = super::stream::stream_res(&stream_name, stream_type, schema, None);
                    let stream_data_lifecycle_end = if stream.settings.data_retention > 0 {
                        let date = now - chrono::Duration::days(stream.settings.data_retention);
                        date.format("%Y-%m-%d").to_string()
                    } else {
                        data_lifecycle_end.clone()
                    };
                    if let Err(e) = lifecycle::delete_by_stream(
                        &stream_data_lifecycle_end,
                        &org_id,
                        &stream_name,
                        stream_type,
                    )
                    .await
                    {
                        log::error!(
                            "[COMPACTOR] lifecycle: delete_by_stream [{}/{}/{}] error: {}",
                            org_id,
                            stream_type,
                            stream_name,
                            e
                        );
                    }
                }
            }
        }
    }

    // delete files
    let jobs = db::compact::delete::list().await?;
    for job in jobs {
        let columns = job.split('/').collect::<Vec<&str>>();
        let org_id = columns[0];
        let stream_type = StreamType::from(columns[1]);
        let stream_name = columns[2];
        let retention = columns[3];
        tokio::task::yield_now().await; // yield to other tasks

        let ret = if retention.eq("all") {
            delete::delete_all(org_id, stream_name, stream_type).await
        } else {
            let date_range = retention.split(',').collect::<Vec<&str>>();
            delete::delete_by_date(
                org_id,
                stream_name,
                stream_type,
                (date_range[0], date_range[1]),
            )
            .await
        };

        if let Err(e) = ret {
            log::error!(
                "[COMPACTOR] delete: delete [{}/{}/{}] error: {}",
                org_id,
                stream_type,
                stream_name,
                e
            );
        }
    }

    Ok(())
}

/// compactor merge run steps:
/// 1. get all organization
/// 2. range streams by organization & stream_type
/// 3. get a cluster lock for compactor stream
/// 4. read last compacted offset: year/month/day/hour
/// 5. read current hour all files
/// 6. compact small files to big files -> COMPACTOR_MAX_FILE_SIZE
/// 7. write to storage
/// 8. delete small files keys & write big files keys, use transaction
/// 9. delete small files from storage
/// 10. update last compacted offset
/// 11. release cluster lock
/// 12. compact file list from storage
pub async fn run_merge() -> Result<(), anyhow::Error> {
    // get last file_list compact offset
    let last_file_list_offset = db::compact::file_list::get_offset().await?;

    let orgs = cache::file_list::get_all_organization()?;
    let stream_types = [
        StreamType::Logs,
        StreamType::Metrics,
        StreamType::Traces,
        StreamType::LookUpTable,
    ];
    for org_id in orgs {
        for stream_type in stream_types {
            let streams = cache::file_list::get_all_stream(&org_id, stream_type)?;
            for stream_name in streams {
                // check if we are allowed to merge or just skip
                if db::compact::delete::is_deleting_stream(&org_id, &stream_name, stream_type, None)
                {
                    log::info!(
                        "[COMPACTOR] the stream [{}/{}/{}] is deleting, just skip",
                        &org_id,
                        stream_type,
                        &stream_name,
                    );
                }

                tokio::task::yield_now().await; // yield to other tasks
                if let Err(e) = merge::merge_by_stream(
                    last_file_list_offset,
                    &org_id,
                    &stream_name,
                    stream_type,
                )
                .await
                {
                    log::error!(
                        "[COMPACTOR] merge_by_stream [{}:{}:{}] error: {}",
                        org_id,
                        stream_type,
                        stream_name,
                        e
                    );
                }
            }
        }
    }

    // after compact, compact file list from storage
    if let Err(e) = file_list::run(last_file_list_offset).await {
        log::error!("[COMPACTOR] output file list error: {}", e);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[actix_web::test]
    async fn test_files() {
        let meta = crate::meta::common::FileMeta {
            min_ts: 100,
            max_ts: 200,
            records: 10000,
            original_size: 1024,
            compressed_size: 1,
        };
        let _ret = cache::file_list::set_file_to_cache(
            "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet",
            meta,
        )
        .unwrap();
        let resp = run_merge().await;
        assert!(resp.is_ok());
    }
}
