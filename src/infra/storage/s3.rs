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
use aws_config::{timeout::TimeoutConfig, SdkConfig};
use aws_sdk_s3::model::{Delete, ObjectIdentifier};
use aws_sdk_s3::{Client, Credentials, Region};
use std::{sync::Arc, time::Duration};

use super::FileStorage;
use crate::common::utils::is_local_disk_storage;
use crate::infra::config::CONFIG;

lazy_static! {
    static ref S3CONFIG: AsyncOnce<Option<Arc<SdkConfig>>> =
        AsyncOnce::new(async { init_s3config().await });
}

pub struct S3 {}

#[async_trait]
impl FileStorage for S3 {
    async fn list(&self, prefix: &str) -> Result<Vec<String>, anyhow::Error> {
        let mut files = Vec::new();
        let s3config = S3CONFIG.get().await.clone().unwrap().clone();
        let client = Client::new(&s3config);
        let mut start_after: String = "".to_string();
        loop {
            let objects = client
                .list_objects_v2()
                .bucket(&CONFIG.s3.bucket_name)
                .prefix(prefix)
                .start_after(&start_after)
                .send()
                .await;
            if objects.is_err() {
                return Err(anyhow::anyhow!("{}", objects.err().unwrap()));
            }
            let objects = objects.unwrap();

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

    async fn get(&self, file: &str) -> Result<bytes::Bytes, anyhow::Error> {
        let s3config = S3CONFIG.get().await.clone().unwrap();
        let client = Client::new(&s3config);
        let object = match client
            .get_object()
            .bucket(&CONFIG.s3.bucket_name)
            .key(file)
            .send()
            .await
        {
            Ok(object) => object,
            Err(e) => {
                log::error!("s3 get object {} error: {:?}", file, e);
                return Err(anyhow::anyhow!("s3 get object {} error: {:?}", file, e));
            }
        };
        Ok(object.body.collect().await.unwrap().into_bytes())
    }

    async fn put(&self, file: &str, data: bytes::Bytes) -> Result<(), anyhow::Error> {
        let s3config = S3CONFIG.get().await.clone().unwrap();
        let client = Client::new(&s3config);
        let result = client
            .put_object()
            .bucket(&CONFIG.s3.bucket_name)
            .key(file)
            .body(data.into())
            .send()
            .await;
        match result {
            Ok(_output) => {
                log::info!("s3 File upload success: {}", file);
                Ok(())
            }
            Err(err) => {
                log::error!("s3 File upload error: {:?}", err);
                Err(anyhow::anyhow!(err))
            }
        }
    }

    async fn del(&self, files: &[&str]) -> Result<(), anyhow::Error> {
        if files.is_empty() {
            return Ok(());
        }

        // Hack for GCS
        if CONFIG.s3.provider.eq("gcs") {
            for file in files {
                if let Err(e) = self.del_for_gcs(file).await {
                    return Err(anyhow::anyhow!(e));
                }
                tokio::task::yield_now().await; // yield to other tasks
            }
            return Ok(());
        }

        let step = 100;
        let mut start = 0;
        let files_len = files.len();
        while start < files_len {
            let s3config = S3CONFIG.get().await.clone().unwrap();
            let client = Client::new(&s3config);
            let result = client
                .delete_objects()
                .bucket(&CONFIG.s3.bucket_name)
                .delete(
                    Delete::builder()
                        .set_objects(Some(
                            files[start..(start + step).min(files_len)]
                                .iter()
                                .map(|file| {
                                    ObjectIdentifier::builder()
                                        .set_key(Some(file.to_string()))
                                        .build()
                                })
                                .collect::<Vec<_>>(),
                        ))
                        .build(),
                )
                .send()
                .await;
            match result {
                Ok(_output) => {
                    log::info!("s3 File delete success: {:?}", files);
                }
                Err(err) => {
                    log::error!("s3 File delete error: {:?}", err);
                    return Err(anyhow::anyhow!(err));
                }
            }
            start += step;
            tokio::task::yield_now().await; // yield to other tasks
        }
        Ok(())
    }
}

impl S3 {
    async fn del_for_gcs(&self, file: &str) -> Result<(), anyhow::Error> {
        let s3config = S3CONFIG.get().await.clone().unwrap();
        let client = Client::new(&s3config);
        let result = client
            .delete_object()
            .bucket(&CONFIG.s3.bucket_name)
            .key(file)
            .send()
            .await;
        match result {
            Ok(_output) => {
                log::info!("s3[GCS] File delete success: {}", file);
                Ok(())
            }
            Err(err) => {
                log::error!("s3[GCS] File delete error: {:?}", err);
                Err(anyhow::anyhow!(err))
            }
        }
    }
}

async fn init_s3config() -> Option<Arc<SdkConfig>> {
    if is_local_disk_storage() {
        return None;
    }

    let mut s3config = aws_config::from_env();

    if !CONFIG.s3.server_url.is_empty() {
        s3config = s3config.endpoint_url(&CONFIG.s3.server_url);
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
        let creds = DefaultCredentialsChain::builder().build().await;
        s3config = s3config.credentials_provider(creds);
    }

    s3config = s3config.timeout_config(
        TimeoutConfig::builder()
            .connect_timeout(Duration::from_secs(10))
            .build(),
    );
    let s3config = s3config.load().await;
    Some(Arc::new(s3config))
}
