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

use crate::common::infra::cluster::is_ingester;
use crate::common::infra::config::{CONFIG, MAXMIND_DB_CLIENT};
use crate::common::meta::maxmind::MaxmindClient;
use futures::stream::StreamExt;
use reqwest::Client;
use sha256::try_digest;
use std::cmp::min;
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio::time;

pub async fn is_digest_different(
    local_file_path: &str,
    remote_sha256sum_path: &str,
) -> Result<bool, anyhow::Error> {
    let response = reqwest::get(remote_sha256sum_path).await?;
    let remote_file_sha = response.text().await?;
    let local_file_sha = try_digest(Path::new(local_file_path)).unwrap_or_default();
    Ok(remote_file_sha.trim() != local_file_sha.trim())
}

pub async fn download_file(client: &Client, url: &str, path: &str) -> Result<(), String> {
    // Reqwest setup
    let res = client
        .get(url)
        .send()
        .await
        .or(Err(format!("Failed to GET from '{}'", &url)))?;
    let total_size = res
        .content_length()
        .ok_or(format!("Failed to get content length from '{}'", &url))?;

    // download chunks
    let mut file = File::create(path)
        .await
        .or(Err(format!("Failed to create file '{}'", path)))?;
    let mut downloaded: u64 = 0;
    let mut stream = res.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item.or(Err("Error while downloading file".to_string()))?;
        file.write_all(&chunk)
            .await
            .or(Err("Error while writing to file".to_string()))?;
        let new = min(downloaded + (chunk.len() as u64), total_size);
        downloaded = new;
    }

    Ok(())
}

async fn run_download_files() {
    // send request and await response
    let client = reqwest::ClientBuilder::default().build().unwrap();
    let fname = format!("{}/GeoLite2-City.mmdb", &CONFIG.common.mmdb_data_dir);

    let download_files =
        match is_digest_different(&fname, &CONFIG.common.mmdb_geolite_citydb_sha256_url).await {
            Ok(is_different) => is_different,
            Err(e) => {
                log::error!("Well something broke. {e}");
                false
            }
        };

    if download_files {
        match download_file(&client, &CONFIG.common.mmdb_geolite_citydb_url, &fname).await {
            Ok(()) => {
                let maxminddb_client = MaxmindClient::new_with_path(fname);
                let mut client = MAXMIND_DB_CLIENT.write().await;
                *client = maxminddb_client.ok();
                log::info!("Updated geo-json data")
            }
            Err(e) => log::error!("failed to download the files {}", e),
        }
    }
}

pub async fn run() -> Result<(), anyhow::Error> {
    log::info!("spawned");
    if !is_ingester(&super::cluster::LOCAL_NODE_ROLE) {
        return Ok(());
    }

    std::fs::create_dir_all(&CONFIG.common.mmdb_data_dir)?;
    // should run it every 24 hours
    let mut interval = time::interval(time::Duration::from_secs(
        CONFIG.common.mmdb_update_duration,
    ));

    loop {
        interval.tick().await;
        run_download_files().await;
    }
}

// #[cfg(test)]
// mod tests {
//     use super::*;

//     #[tokio::test]
//     async fn test_run() {
//         run().await.unwrap();
//         assert!(true);
//     }
// }
