use std::time::Duration;

use config::get_config;
use infra::table::org_storage_providers::{
    AwsCredentials, AzureCredentials, GcpCredentials, OrgStorageProvider, ProviderType,
};
use object_store::ObjectStore;

use super::db::org_storage_providers;

fn get_aws(config: AwsCredentials) -> object_store::Result<object_store::aws::AmazonS3> {
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
        .with_virtual_hosted_style_request(force_hosted_style);
    if !config.server_url.is_empty() {
        builder = builder.with_endpoint(&config.server_url);
    }
    if !config.region.is_empty() {
        builder = builder.with_region(&config.region);
    }
    if !config.access_key.is_empty() {
        builder = builder.with_access_key_id(&config.access_key);
    }
    if !config.secret_key.is_empty() {
        builder = builder.with_secret_access_key(&config.secret_key);
    }
    builder.build()
}

fn get_azure(
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
        .with_container_name(&config.bucket_name);
    if !config.access_key.is_empty() {
        builder = builder.with_account(&config.access_key);
    }
    if !config.secret_key.is_empty() {
        builder = builder.with_access_key(&config.secret_key);
    }
    if !config.server_url.is_empty() {
        builder = builder.with_endpoint(config.server_url.clone());
    }
    builder.build()
}

fn get_gcp(config: GcpCredentials) -> object_store::Result<object_store::gcp::GoogleCloudStorage> {
    let cfg = get_config();
    let mut builder = object_store::gcp::GoogleCloudStorageBuilder::from_env()
        .with_client_options(
            object_store::ClientOptions::default()
                .with_connect_timeout(std::time::Duration::from_secs(cfg.s3.connect_timeout))
                .with_timeout(std::time::Duration::from_secs(cfg.s3.request_timeout))
                .with_allow_invalid_certificates(cfg.s3.allow_invalid_certificates),
        )
        .with_url(&config.server_url)
        .with_bucket_name(&config.bucket_name);
    if !config.access_key.is_empty() {
        builder = builder.with_service_account_path(&config.access_key);
    }
    builder.build()
}

pub async fn get_provider_list() -> Result<Vec<(String, Box<dyn ObjectStore>)>, anyhow::Error> {
    let list = org_storage_providers::list_all()
        .await
        .inspect_err(|e| log::error!("error listing object store providers from db : {e}"))?;

    let mut ret: Vec<(String, Box<dyn ObjectStore>)> = Vec::with_capacity(list.len());

    for provider in list {
        match provider.provider_type {
            ProviderType::AwsCredential => {
                let creds: AwsCredentials = serde_json::from_str(&provider.data)?;
                let store = get_aws(creds)?;
                ret.push((provider.org_id, Box::new(store)))
            }
            ProviderType::GcpCredentials => {
                let creds: GcpCredentials = serde_json::from_str(&provider.data)?;
                let store = get_gcp(creds)?;
                ret.push((provider.org_id, Box::new(store)))
            }
            ProviderType::AzureCredentials => {
                let creds: AzureCredentials = serde_json::from_str(&provider.data)?;
                let store = get_azure(creds)?;
                ret.push((provider.org_id, Box::new(store)))
            }
        }
    }
    Ok(ret)
}

#[inline]
fn redact(v: &str) -> String {
    let s = v.len();
    let e1 = s.max(3);
    let e2 = s.saturating_sub(3);
    format!(
        "{}***{}",
        v.get(0..e1).unwrap_or_default(),
        v.get(s..e2).unwrap_or_default()
    )
}

pub async fn get_redacted_config(
    org_id: &str,
) -> Result<Option<OrgStorageProvider>, anyhow::Error> {
    let mut provider = org_storage_providers::get_for_org(org_id).await?;

    if let Some(config) = provider.as_mut() {
        match config.provider_type {
            ProviderType::AwsCredential => {
                let mut creds: AwsCredentials = serde_json::from_str(&config.data)?;
                creds.access_key = redact(&creds.access_key);
                creds.secret_key = redact(&creds.secret_key);
                config.data = serde_json::to_string(&creds).unwrap();
            }
            ProviderType::GcpCredentials => {
                let mut creds: GcpCredentials = serde_json::from_str(&config.data)?;
                creds.access_key = redact(&creds.access_key);
                config.data = serde_json::to_string(&creds).unwrap();
            }
            ProviderType::AzureCredentials => {
                let mut creds: AzureCredentials = serde_json::from_str(&config.data)?;
                creds.access_key = redact(&creds.access_key);
                creds.secret_key = redact(&creds.secret_key);
                config.data = serde_json::to_string(&creds).unwrap();
            }
        }
    };
    Ok(provider)
}
