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

use crate::infra::cache;
use crate::meta::StreamType;
use crate::service::db;

mod file_list;
mod merge;

/// compactor run steps:
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
pub async fn run() -> Result<(), anyhow::Error> {
    // get last file_list compact offset
    let last_file_list_offset = db::compact::file_list::get_offset().await?;

    let orgs = cache::file_list::get_all_organization()?;
    let stream_types = [
        StreamType::Logs,
        StreamType::Metrics,
        StreamType::Traces,
        StreamType::Metadata,
    ];
    for org_id in orgs {
        for stream_type in stream_types {
            let streams = cache::file_list::get_all_stream(&org_id, stream_type)?;
            for stream_name in streams {
                // check if we are allowed to ingest or just skip
                if db::compact::delete::is_deleting_stream(&org_id, &stream_name, stream_type) {
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
            Some(meta),
            false,
        )
        .unwrap();
        let resp = run().await;
        assert!(resp.is_ok());
    }
}
