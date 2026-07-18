// Copyright 2026 OpenObserve Inc.
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

use std::time::Duration;

use bytes::Bytes;
use config::get_config;
use infra::table::org_storage_providers::{
    AwsCredentials, AwsRoleArn, AzureCredentials, GcpCredentials,
};
use object_store::{ObjectStore, ObjectStoreExt};

const TEST_FILE: &str = "o2_test/check.txt";

pub fn get_aws(config: AwsCredentials) -> object_store::Result<object_store::aws::AmazonS3> {
    let cfg = get_config();
    let mut opts = object_store::ClientOptions::default()
        .with_connect_timeout(std::time::Duration::from_secs(cfg.s3.connect_timeout))
        .with_timeout(std::time::Duration::from_secs(cfg.s3.request_timeout))
        .with_allow_invalid_certificates(cfg.s3.allow_invalid_certificates)
        .with_http2_keep_alive_timeout(Duration::from_secs(cfg.s3.keepalive_timeout))
        .with_allow_http(true);
    if cfg.s3.feature_http1_only {
        opts = opts.with_http1_only();
    }
    if cfg.s3.feature_http2_only {
        opts = opts.with_http2_only();
    }
    if cfg.s3.max_idle_per_host > 0 {
        opts = opts.with_pool_max_idle_per_host(cfg.s3.max_idle_per_host)
    }
    let force_hosted_style = cfg.s3.feature_force_hosted_style;
    let retry_config = object_store::RetryConfig {
        max_retries: cfg.s3.max_retries,
        // this value is from the default arrow-rs object
        // https://github.com/apache/arrow-rs/blob/678517018ddfd21b202a94df13b06dfa1ab8a378/object_store/src/client/retry.rs#L171-L179
        retry_timeout: Duration::from_secs(3 * 60),
        backoff: object_store::BackoffConfig::default(),
    };
    let mut builder = object_store::aws::AmazonS3Builder::from_env()
        .with_client_options(opts)
        .with_bucket_name(&config.bucket_name)
        .with_retry(retry_config)
        .with_virtual_hosted_style_request(force_hosted_style)
        .with_access_key_id(&config.access_key)
        .with_secret_access_key(&config.secret_key);
    if !config.server_url.is_empty() {
        builder = builder.with_endpoint(&config.server_url);
    }
    if !config.region.is_empty() {
        builder = builder.with_region(&config.region);
    }
    builder.build()
}

pub fn get_azure(
    config: AzureCredentials,
) -> object_store::Result<object_store::azure::MicrosoftAzure> {
    let cfg = get_config();
    let mut builder = object_store::azure::MicrosoftAzureBuilder::from_env()
        .with_client_options(
            object_store::ClientOptions::default()
                .with_connect_timeout(std::time::Duration::from_secs(cfg.s3.connect_timeout))
                .with_timeout(std::time::Duration::from_secs(cfg.s3.request_timeout))
                .with_allow_invalid_certificates(cfg.s3.allow_invalid_certificates),
        )
        .with_container_name(&config.bucket_name)
        .with_account(&config.storage_account)
        .with_access_key(&config.secret_key);
    if !config.server_url.is_empty() {
        builder = builder.with_endpoint(config.server_url.clone());
    }
    builder.build()
}

pub fn get_gcp(
    config: GcpCredentials,
) -> object_store::Result<object_store::gcp::GoogleCloudStorage> {
    let cfg = get_config();
    let mut builder = object_store::gcp::GoogleCloudStorageBuilder::from_env()
        .with_client_options(
            object_store::ClientOptions::default()
                .with_connect_timeout(std::time::Duration::from_secs(cfg.s3.connect_timeout))
                .with_timeout(std::time::Duration::from_secs(cfg.s3.request_timeout))
                .with_allow_invalid_certificates(cfg.s3.allow_invalid_certificates),
        )
        .with_bucket_name(&config.bucket_name)
        .with_service_account_path(&config.access_key);

    if !config.server_url.is_empty() {
        builder = builder.with_url(&config.server_url);
    }

    builder.build()
}

pub async fn test_provider(provider: &dyn ObjectStore) -> Result<(), anyhow::Error> {
    // Test upload
    let path = object_store::path::Path::parse(TEST_FILE)?;
    let data = Bytes::from("Hello, OpenObserve!");
    if let Err(e) = provider.put(&path, data.into()).await {
        return Err(anyhow::anyhow!("upload test failed: {e}"));
    }

    // Test download
    match provider.get(&path).await {
        Ok(_) => {
            return Ok(());
        }
        Err(e) => match e {
            object_store::Error::NotFound { .. } => {}
            object_store::Error::PermissionDenied { path: _, source }
                if source.to_string().contains("ListBucket") => {}
            _ => {
                return Err(anyhow::anyhow!("download test failed: {e}"));
            }
        },
    };

    Ok(())
}

pub fn _merge_aws_credentials(existing: &str, new: &str) -> Result<String, anyhow::Error> {
    let mut existing: AwsCredentials = serde_json::from_str(existing)?;
    let new: AwsCredentials = serde_json::from_str(new)?;
    if !new.access_key.is_empty() {
        existing.access_key = new.access_key;
    }
    if !new.secret_key.is_empty() {
        existing.secret_key = new.secret_key;
    }
    Ok(serde_json::to_string(&existing)?)
}

pub fn _merge_gcp_credentials(existing: &str, new: &str) -> Result<String, anyhow::Error> {
    let mut existing: GcpCredentials = serde_json::from_str(existing)?;
    let new: GcpCredentials = serde_json::from_str(new)?;
    if !new.access_key.is_empty() {
        existing.access_key = new.access_key;
    }
    Ok(serde_json::to_string(&existing)?)
}

pub fn _merge_azure_credentials(existing: &str, new: &str) -> Result<String, anyhow::Error> {
    let mut existing: AzureCredentials = serde_json::from_str(existing)?;
    let new: AzureCredentials = serde_json::from_str(new)?;
    if !new.secret_key.is_empty() {
        existing.secret_key = new.secret_key;
    }
    Ok(serde_json::to_string(&existing)?)
}

pub fn _merge_aws_role_arn(existing: &str, new: &str) -> Result<String, anyhow::Error> {
    let mut existing: AwsRoleArn = serde_json::from_str(existing)?;
    let new: AwsRoleArn = serde_json::from_str(new)?;
    if !new.role_arn.is_empty() {
        existing.role_arn = new.role_arn;
    }
    if !new.external_id.is_empty() {
        existing.external_id = new.external_id;
    }
    Ok(serde_json::to_string(&existing)?)
}
