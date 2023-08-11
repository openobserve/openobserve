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

use crate::common::infra::cluster;
use crate::common::meta::StreamType;

mod disk;
mod memory;

pub async fn run() -> Result<(), anyhow::Error> {
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(()); // not an ingester, no need to init job
    }

    tokio::task::spawn(async move { disk::run().await });
    tokio::task::spawn(async move { memory::run().await });

    Ok(())
}

pub fn generate_storage_file_name(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    wal_file_name: &str,
) -> String {
    let mut file_columns = wal_file_name.split('_').collect::<Vec<&str>>();
    let stream_key = format!("{}/{}/{}", org_id, stream_type, stream_name);
    let file_date = format!(
        "{}/{}/{}/{}",
        file_columns[1], file_columns[2], file_columns[3], file_columns[4]
    );
    let file_name = file_columns.last().unwrap().to_string();
    let file_name = file_name.replace(".json", ".parquet");
    file_columns.retain(|&x| x.contains('='));
    let mut partition_key = String::from("");
    for key in file_columns {
        let key = key.replace('.', "_");
        partition_key.push_str(&key);
        partition_key.push('/');
    }

    if partition_key.eq("") {
        format!("files/{stream_key}/{file_date}/{file_name}")
    } else {
        format!("files/{stream_key}/{file_date}/{partition_key}{file_name}")
    }
}
