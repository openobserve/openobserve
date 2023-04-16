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

use async_trait::async_trait;
use futures::TryStreamExt;
use once_cell::sync::Lazy;
use std::sync::Arc;
use std::time::Instant;

use super::FileStorage;
use crate::infra::config::CONFIG;
use crate::infra::metrics;

static CLIENT: Lazy<Arc<Box<dyn object_store::ObjectStore>>> =
    Lazy::new(|| Arc::new(init_client()));

#[derive(Default)]
pub struct Remote {}

#[async_trait]
impl FileStorage for Remote {
    async fn list(&self, prefix: &str) -> Result<Vec<String>, anyhow::Error> {
        let prefix = if !CONFIG.s3.bucket_prefix.is_empty()
            && !prefix.starts_with(&CONFIG.s3.bucket_prefix)
        {
            format!("{}{}", CONFIG.s3.bucket_prefix, prefix)
        } else {
            prefix.to_string()
        };
        let client = CLIENT.clone();
        let list_stream = client
            .list(Some(&(prefix.into())))
            .await
            .expect("Error listing files");
        let files = list_stream
            .map_ok(|meta| meta.location.to_string())
            .try_collect::<Vec<String>>()
            .await
            .expect("Error listing files");
        Ok(files)
    }

    async fn get(&self, file: &str) -> Result<bytes::Bytes, anyhow::Error> {
        let start = Instant::now();
        let key =
            if !CONFIG.s3.bucket_prefix.is_empty() && !file.starts_with(&CONFIG.s3.bucket_prefix) {
                format!("{}{}", CONFIG.s3.bucket_prefix, file)
            } else {
                file.to_string()
            };
        let object = match CLIENT.clone().get(&(key.into())).await {
            Ok(ret) => ret,
            Err(e) => {
                log::error!("s3 get object {} error: {:?}", file, e);
                return Err(anyhow::anyhow!("s3 get object error"));
            }
        };
        let data = object.bytes().await?;

        // metrics
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[3], columns[2]])
                .inc_by(data.len() as u64);

            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[3], columns[2], "get"])
                .inc_by(time);
        }

        Ok(data)
    }

    async fn put(&self, file: &str, data: bytes::Bytes) -> Result<(), anyhow::Error> {
        let start = Instant::now();
        let key =
            if !CONFIG.s3.bucket_prefix.is_empty() && !file.starts_with(&CONFIG.s3.bucket_prefix) {
                format!("{}{}", CONFIG.s3.bucket_prefix, file)
            } else {
                file.to_string()
            };
        let data_size = data.len();
        match CLIENT.clone().put(&(key.into()), data).await {
            Ok(_output) => {
                // metrics
                let columns = file.split('/').collect::<Vec<&str>>();
                if columns[0] == "files" {
                    metrics::STORAGE_WRITE_BYTES
                        .with_label_values(&[columns[1], columns[3], columns[2]])
                        .inc_by(data_size as u64);

                    let time = start.elapsed().as_secs_f64();
                    metrics::STORAGE_TIME
                        .with_label_values(&[columns[1], columns[3], columns[2], "put"])
                        .inc_by(time);
                }
                log::info!("s3 File upload succeeded: {}", file);
                Ok(())
            }
            Err(err) => {
                log::error!("s3 File upload error: {:?}", err);
                Err(anyhow::anyhow!("s3 put object error"))
            }
        }
    }

    async fn del(&self, files: &[&str]) -> Result<(), anyhow::Error> {
        if files.is_empty() {
            return Ok(());
        }

        let start_time = Instant::now();
        let columns = files[0].split('/').collect::<Vec<&str>>();

        let client = CLIENT.clone();
        for file in files {
            let key = if !CONFIG.s3.bucket_prefix.is_empty()
                && !file.starts_with(&CONFIG.s3.bucket_prefix)
            {
                format!("{}{}", CONFIG.s3.bucket_prefix, file)
            } else {
                file.to_string()
            };
            client.delete(&(key.into())).await?;
            tokio::task::yield_now().await; // yield to other tasks
        }

        if columns[0] == "files" {
            let time = start_time.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[3], columns[2], "del"])
                .inc_by(time);
        }

        Ok(())
    }
}

fn init_aws_config() -> object_store::Result<object_store::aws::AmazonS3> {
    let mut builder = object_store::aws::AmazonS3Builder::from_env()
        .with_client_options(
            object_store::ClientOptions::default()
                .with_connect_timeout(std::time::Duration::from_secs(CONFIG.s3.connect_timeout))
                .with_allow_http(true),
        )
        .with_profile("default")
        .with_bucket_name(&CONFIG.s3.bucket_name)
        .with_virtual_hosted_style_request(CONFIG.s3.feature_force_path_style);
    if !CONFIG.s3.server_url.is_empty() {
        builder = builder.with_endpoint(&CONFIG.s3.server_url);
    }
    if !CONFIG.s3.region_name.is_empty() {
        builder = builder.with_region(&CONFIG.s3.region_name);
    }
    if !CONFIG.s3.access_key.is_empty() {
        builder = builder.with_access_key_id(&CONFIG.s3.access_key);
    }
    if !CONFIG.s3.secret_key.is_empty() {
        builder = builder.with_secret_access_key(&CONFIG.s3.secret_key);
    }
    builder.build()
}

fn init_azure_config() -> object_store::Result<object_store::azure::MicrosoftAzure> {
    object_store::azure::MicrosoftAzureBuilder::new()
        .with_client_options(
            object_store::ClientOptions::default()
                .with_connect_timeout(std::time::Duration::from_secs(CONFIG.s3.connect_timeout)),
        )
        .with_account(&CONFIG.s3.access_key)
        .with_access_key(&CONFIG.s3.secret_key)
        .with_container_name(&CONFIG.s3.bucket_name)
        .build()
}

fn init_gcp_config() -> object_store::Result<object_store::gcp::GoogleCloudStorage> {
    object_store::gcp::GoogleCloudStorageBuilder::new()
        .with_client_options(
            object_store::ClientOptions::default()
                .with_connect_timeout(std::time::Duration::from_secs(CONFIG.s3.connect_timeout)),
        )
        .with_service_account_key(
            r#"{
    "gcs_base_url": "https://localhost:4443",
    "disable_oauth": true,
    "client_email": "",
    "private_key": ""
 }"#,
        )
        .with_bucket_name(&CONFIG.s3.bucket_name)
        .build()
}

fn init_client() -> Box<dyn object_store::ObjectStore> {
    if CONFIG.common.print_key_config {
        log::info!("s3 init config: {:?}", CONFIG.s3);
    }

    match CONFIG.s3.provider.as_str() {
        "aws" | "s3" => match init_aws_config() {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("s3 init config error: {:?}", e);
            }
        },
        "azure" => match init_azure_config() {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("azure init config error: {:?}", e);
            }
        },
        "gcs" => match init_gcp_config() {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("gcp init config error: {:?}", e);
            }
        },
        _ => match init_aws_config() {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("{} init config error: {:?}", CONFIG.s3.provider, e);
            }
        },
    }
}
