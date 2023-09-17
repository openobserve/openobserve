// Copyright 2023 Zinc Labs Inc.
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

use crate::common::{
    infra::{config::CONFIG, file_list as infra_file_list},
    meta::{common::FileKey, stream::PartitionTimeLevel, StreamType},
    utils::{file::get_file_meta, time::BASE_TIME},
};
use crate::job::{file_list, files};
use crate::service::{compact::stats::update_stats_from_file_list, db};

pub async fn run(prefix: &str) -> Result<(), anyhow::Error> {
    if get_file_meta(&CONFIG.common.data_wal_dir).is_err() {
        // there is no local wal files, no need upgrade
        return Ok(());
    }

    // move files from wal for disk
    if let Err(e) = files::disk::move_files_to_storage().await {
        log::error!("Error moving disk files to remote: {}", e);
    }

    // move file_list from wal for disk
    if let Err(e) = file_list::move_file_list_to_storage(false).await {
        log::error!("Error moving disk files to remote: {}", e);
    }

    if get_file_meta(&CONFIG.common.data_stream_dir).is_err() {
        // there is no local stream files, no need upgrade
        return Ok(());
    }

    // load stream list
    db::schema::cache().await?;
    // load file list to db
    db::file_list::remote::cache(prefix, false)
        .await
        .expect("file list migration failed");
    // update stream stats
    update_stats_from_file_list()
        .await
        .expect("file list migration stats failed");
    Ok(())
}

/// Run the file list migration for DynamoDB to add new fields `created_at` and `org`.
pub async fn run_for_dynamo() -> Result<(), anyhow::Error> {
    // load stream list
    db::schema::cache().await?;
    // load file list from DynamoDB
    let stream_types = [StreamType::Logs, StreamType::Metrics, StreamType::Traces];
    let start_time = BASE_TIME.timestamp_micros();
    let end_time = chrono::Utc::now().timestamp_micros();
    let orgs = db::schema::list_organizations_from_cache();
    for org_id in orgs.iter() {
        for stream_type in stream_types {
            let streams = db::schema::list_streams_from_cache(org_id, stream_type);
            for stream_name in streams.iter() {
                let files = infra_file_list::query(
                    org_id,
                    stream_type,
                    stream_name,
                    PartitionTimeLevel::Unset,
                    (start_time, end_time),
                )
                .await
                .expect("file list get failed");
                let put_items = files
                    .into_iter()
                    .map(|(file_key, file_meta)| FileKey::new(&file_key, file_meta, false))
                    .collect::<Vec<_>>();
                infra_file_list::batch_add(&put_items)
                    .await
                    .expect("file list put failed");
            }
        }
    }
    // create secondary index
    infra_file_list::dynamo::create_table_file_list_org_crated_at_index()
        .await
        .expect("file list migration create index failed");
    Ok(())
}
