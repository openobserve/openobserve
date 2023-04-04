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

use async_once::AsyncOnce;
use async_trait::async_trait;
use aws_config::default_provider::credentials::DefaultCredentialsChain;
use aws_config::retry::RetryConfig;
use aws_config::timeout::TimeoutConfig;
use aws_sdk_s3::model::{Delete, ObjectIdentifier};
use aws_sdk_s3::{Client, Config, Credentials, Region};
use std::{time::Duration, time::Instant};

use super::FileStorage;
use crate::common::utils::is_local_disk_storage;
use crate::infra::config::CONFIG;
use crate::infra::metrics;

lazy_static! {
    static ref S3CLIENT: AsyncOnce<Option<Client>> =
        AsyncOnce::new(async { init_s3_client().await });
}

pub struct S3 {}

#[async_trait]
impl FileStorage for S3 {
    async fn list(&self, prefix: &str) -> Result<Vec<String>, anyhow::Error> {
        if CONFIG.s3.feature_list_objects_v2 {
            self.list_objects_v2(prefix).await
        } else {
            self.list_objects(prefix).await
        }
    }

    async fn get(&self, file: &str) -> Result<bytes::Bytes, anyhow::Error> {
        let start = Instant::now();
        let key =
            if !CONFIG.s3.bucket_prefix.is_empty() && !file.starts_with(&CONFIG.s3.bucket_prefix) {
                format!("{}{}", CONFIG.s3.bucket_prefix, file)
            } else {
                file.to_string()
            };
        let client = S3CLIENT.get().await.clone().unwrap();
        let object = match client
            .get_object()
            .bucket(&CONFIG.s3.bucket_name)
            .key(key)
            .send()
            .await
        {
            Ok(object) => object,
            Err(e) => {
                log::error!("s3 get object {} error: {:?}", file, e);
                return Err(anyhow::anyhow!("s3 get object error"));
            }
        };
        let data = object.body.collect().await.unwrap().into_bytes();

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
        let client = S3CLIENT.get().await.clone().unwrap();
        let data_size = data.len();
        match client
            .put_object()
            .bucket(&CONFIG.s3.bucket_name)
            .key(key)
            .body(data.into())
            .send()
            .await
        {
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

        if CONFIG.s3.feature_delete_objects {
            self.delete_objects(files).await?;
        } else {
            for file in files {
                self.delete_object(file).await?;
                tokio::task::yield_now().await; // yield to other tasks
            }
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

impl S3 {
    async fn list_objects(&self, prefix: &str) -> Result<Vec<String>, anyhow::Error> {
        let prefix = if !CONFIG.s3.bucket_prefix.is_empty()
            && !prefix.starts_with(&CONFIG.s3.bucket_prefix)
        {
            format!("{}{}", CONFIG.s3.bucket_prefix, prefix)
        } else {
            prefix.to_string()
        };
        let prefix = prefix.as_str();
        let mut files = Vec::new();
        let client = S3CLIENT.get().await.clone().unwrap();
        let mut start_after: String = "".to_string();
        loop {
            let objects = match client
                .list_objects()
                .bucket(&CONFIG.s3.bucket_name)
                .marker(&start_after)
                .prefix(prefix)
                .send()
                .await
            {
                Ok(objects) => objects,
                Err(e) => {
                    log::error!("s3 list objects {} error: {:?}", prefix, e);
                    return Err(anyhow::anyhow!("s3 list objects error"));
                }
            };
            for obj in objects.contents().unwrap_or_default() {
                start_after = obj.key().unwrap().to_string();
                files.push(start_after.clone());
            }
            if objects.contents().unwrap_or_default().len() < 1000 {
                break;
            }
        }
        Ok(files)
    }

    async fn list_objects_v2(&self, prefix: &str) -> Result<Vec<String>, anyhow::Error> {
        let prefix = if !CONFIG.s3.bucket_prefix.is_empty()
            && !prefix.starts_with(&CONFIG.s3.bucket_prefix)
        {
            format!("{}{}", CONFIG.s3.bucket_prefix, prefix)
        } else {
            prefix.to_string()
        };
        let prefix = prefix.as_str();
        let mut files = Vec::new();
        let client = S3CLIENT.get().await.clone().unwrap();
        let mut start_after: String = "".to_string();
        loop {
            let objects = match client
                .list_objects_v2()
                .bucket(&CONFIG.s3.bucket_name)
                .prefix(prefix)
                .start_after(&start_after)
                .send()
                .await
            {
                Ok(objects) => objects,
                Err(e) => {
                    log::error!("s3 list objects v2 {} error: {:?}", prefix, e);
                    return Err(anyhow::anyhow!("s3 list objects v2 error"));
                }
            };
            for obj in objects.contents().unwrap_or_default() {
                start_after = obj.key().unwrap().to_string();
                files.push(start_after.clone());
            }
            if objects.key_count < 1000 {
                break;
            }
        }
        Ok(files)
    }

    async fn delete_object(&self, file: &str) -> Result<(), anyhow::Error> {
        let key =
            if !CONFIG.s3.bucket_prefix.is_empty() && !file.starts_with(&CONFIG.s3.bucket_prefix) {
                format!("{}{}", CONFIG.s3.bucket_prefix, file)
            } else {
                file.to_string()
            };
        let client = S3CLIENT.get().await.clone().unwrap();
        let result = client
            .delete_object()
            .bucket(&CONFIG.s3.bucket_name)
            .key(key)
            .send()
            .await;
        match result {
            Ok(_output) => {
                log::info!("s3 File delete succeeded: {}", file);
                Ok(())
            }
            Err(err) => {
                log::error!("s3 File delete error: {:?}", err);
                Err(anyhow::anyhow!("s3 delete object error"))
            }
        }
    }

    async fn delete_objects(&self, files: &[&str]) -> Result<(), anyhow::Error> {
        let client = S3CLIENT.get().await.clone().unwrap();
        let step = 100;
        let mut start = 0;
        let files_len = files.len();
        while start < files_len {
            let result = client
                .delete_objects()
                .bucket(&CONFIG.s3.bucket_name)
                .delete(
                    Delete::builder()
                        .set_objects(Some(
                            files[start..(start + step).min(files_len)]
                                .iter()
                                .map(|file| {
                                    let key = if !CONFIG.s3.bucket_prefix.is_empty()
                                        && !file.starts_with(&CONFIG.s3.bucket_prefix)
                                    {
                                        format!("{}{}", CONFIG.s3.bucket_prefix, file)
                                    } else {
                                        file.to_string()
                                    };
                                    ObjectIdentifier::builder().set_key(Some(key)).build()
                                })
                                .collect::<Vec<_>>(),
                        ))
                        .build(),
                )
                .send()
                .await;
            match result {
                Ok(_output) => {
                    log::info!("s3 File delete succeeded: {}", files.len());
                }
                Err(err) => {
                    log::error!("s3 File delete error: {:?}", err);
                    return Err(anyhow::anyhow!("s3 delete object error"));
                }
            }
            start += step;
            tokio::task::yield_now().await; // yield to other tasks
        }
        Ok(())
    }
}

async fn init_s3_config() -> Option<Config> {
    let mut s3config = aws_sdk_s3::config::Builder::new();
    if !CONFIG.s3.server_url.is_empty() {
        s3config = s3config.endpoint_url(&CONFIG.s3.server_url);
        if CONFIG.s3.feature_force_path_style {
            s3config = s3config.force_path_style(true);
        }
    }
    if !CONFIG.s3.region_name.is_empty() {
        s3config = s3config.region(Region::new(&CONFIG.s3.region_name));
    }
    if !CONFIG.s3.access_key.is_empty() {
        let creds = Credentials::new(
            &CONFIG.s3.access_key,
            &CONFIG.s3.secret_key,
            None,
            None,
            "s3",
        );
        s3config = s3config.credentials_provider(creds);
    } else {
        s3config = s3config.credentials_provider(DefaultCredentialsChain::builder().build().await);
    }

    s3config = s3config
        .retry_config(RetryConfig::standard().with_max_attempts(5))
        .sleep_impl(aws_smithy_async::rt::sleep::default_async_sleep().unwrap())
        .timeout_config(
            TimeoutConfig::builder()
                .connect_timeout(Duration::from_secs(10))
                .build(),
        );
    let s3config = s3config.build();
    Some(s3config)
}

async fn init_s3_client() -> Option<Client> {
    if is_local_disk_storage() {
        return None;
    }
    if CONFIG.common.print_key_config {
        log::info!("s3 init config: {:?}", CONFIG.s3);
    }

    let client = if CONFIG.s3.provider.eq("aws") {
        let s3config = aws_config::from_env()
            .credentials_provider(DefaultCredentialsChain::builder().build().await)
            .retry_config(RetryConfig::standard().with_max_attempts(5))
            .sleep_impl(aws_smithy_async::rt::sleep::default_async_sleep().unwrap())
            .timeout_config(
                TimeoutConfig::builder()
                    .connect_timeout(Duration::from_secs(10))
                    .build(),
            )
            .load()
            .await;
        Client::new(&s3config)
    } else {
        let s3config = init_s3_config().await.unwrap();
        Client::from_conf(s3config)
    };
    Some(client)
}
