use async_once::AsyncOnce;
use async_trait::async_trait;
use aws_config::{default_provider::credentials::DefaultCredentialsChain, SdkConfig};
use aws_sdk_s3::{Client, Credentials, Endpoint, Region};
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

    async fn del(&self, file: &str) -> Result<(), anyhow::Error> {
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
                log::info!("s3 File delete success: {}", file);
                Ok(())
            }
            Err(err) => {
                log::error!("s3 File delete error: {:?}", err);
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
        s3config = s3config.endpoint_resolver(Endpoint::immutable(
            CONFIG
                .s3
                .server_url
                .parse()
                .expect("invalid ZIOX_S3_SERVER_URL"),
        ));
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
        let creds = DefaultCredentialsChain::builder()
            .load_timeout(Duration::from_secs(10))
            .build()
            .await;
        s3config = s3config.credentials_provider(creds);
    }

    let s3config = s3config.load().await;
    Some(Arc::new(s3config))
}
