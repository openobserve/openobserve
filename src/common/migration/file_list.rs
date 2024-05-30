// Copyright 2024 Zinc Labs Inc.
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

use config::{
    get_config,
    meta::stream::{FileKey, PartitionTimeLevel, StreamType},
    utils::{file::get_file_meta, time::BASE_TIME},
};
use infra::file_list as infra_file_list;

use crate::{
    job::file_list,
    service::{compact::stats::update_stats_from_file_list, db},
};

pub async fn run(prefix: &str, from: &str, to: &str) -> Result<(), anyhow::Error> {
    if get_file_meta(&get_config().common.data_wal_dir).is_err() {
        // there is no local wal files, no need upgrade
        return Ok(());
    }

    // load stream list
    let mut from_storage = false;
    let src: Box<dyn infra_file_list::FileList> = match from.to_lowercase().as_str().trim() {
        "local" | "s3" | "sled" | "etcd" => {
            // load file list to db
            db::file_list::remote::cache(prefix, false)
                .await
                .expect("file list migration failed");
            from_storage = true;
            Box::<infra_file_list::sqlite::SqliteFileList>::default()
        }
        "sqlite" => Box::<infra_file_list::sqlite::SqliteFileList>::default(),
        "mysql" => Box::<infra_file_list::mysql::MysqlFileList>::default(),
        "postgres" | "postgresql" => Box::<infra_file_list::postgres::PostgresFileList>::default(),
        _ => panic!("invalid source"),
    };

    let dest: Box<dyn infra_file_list::FileList> = match to.to_lowercase().as_str().trim() {
        "sqlite" => Box::<infra_file_list::sqlite::SqliteFileList>::default(),
        "mysql" => Box::<infra_file_list::mysql::MysqlFileList>::default(),
        "postgres" | "postgresql" => Box::<infra_file_list::postgres::PostgresFileList>::default(),
        _ => panic!("invalid destination"),
    };
    dest.create_table().await?;
    db::schema::cache().await?;

    // move file_list from wal for disk
    if let Err(e) = file_list::move_file_list_to_storage(false).await {
        log::error!("Error moving disk files to remote: {}", e);
    }

    // load stream list
    let stream_types = [
        StreamType::Logs,
        StreamType::Metrics,
        StreamType::Traces,
        StreamType::EnrichmentTables,
        StreamType::Metadata,
    ];
    let start_time = BASE_TIME.timestamp_micros();
    let end_time = chrono::Utc::now().timestamp_micros();
    let orgs = db::schema::list_organizations_from_cache().await;
    for org_id in orgs.iter() {
        for stream_type in stream_types {
            let streams = db::schema::list_streams_from_cache(org_id, stream_type).await;
            for stream_name in streams.iter() {
                // load file_list from source
                let files = src
                    .query(
                        org_id,
                        stream_type,
                        stream_name,
                        PartitionTimeLevel::Unset,
                        Some((start_time, end_time)),
                        None,
                    )
                    .await
                    .expect("load file_list failed");
                let put_items = files
                    .into_iter()
                    .map(|(file_key, file_meta)| FileKey::new(&file_key, file_meta, false))
                    .collect::<Vec<_>>();
                dest.batch_add(&put_items)
                    .await
                    .expect("load list_list into db failed");
            }
        }

        // load file_list_deleted from storage
        if from_storage {
            let files =
                crate::service::compact::file_list_deleted::load_prefix_from_s3(org_id).await?;
            if !files.is_empty() {
                let files = files
                    .values()
                    .flatten()
                    .map(|file| file.0.to_owned())
                    .collect::<Vec<_>>();
                if let Err(e) = dest
                    .batch_add_deleted(org_id, false, end_time, &files)
                    .await
                {
                    log::error!("load file_list_deleted into db err: {}", e);
                }
            }
        }

        // load file_list_deleted from source
        let files = src
            .query_deleted(org_id, end_time, 1_000_000)
            .await
            .expect("load file_list_deleted failed");
        let files_need_flatten = files
            .iter()
            .filter_map(|(file, flattened)| {
                if *flattened {
                    Some(file.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        let files_noneed_flatten = files
            .iter()
            .filter_map(|(file, flattened)| {
                if !*flattened {
                    Some(file.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        if !files_need_flatten.is_empty() {
            if let Err(e) = dest
                .batch_add_deleted(org_id, true, end_time, &files_need_flatten)
                .await
            {
                log::error!("load file_list_deleted into db err: {}", e);
                continue;
            }
        }
        if !files_noneed_flatten.is_empty() {
            if let Err(e) = dest
                .batch_add_deleted(org_id, false, end_time, &files_noneed_flatten)
                .await
            {
                log::error!("load file_list_deleted into db err: {}", e);
                continue;
            }
        }
    }

    // update stream stats
    update_stats_from_file_list()
        .await
        .expect("file list migration stats failed");
    Ok(())
}
