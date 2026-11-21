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

use async_trait::async_trait;
use bytes::Bytes;
use config::{get_config, metrics};
use futures::{StreamExt, stream::BoxStream};
use object_store::{
    CopyOptions, Error, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta,
    ObjectStore, PutMultipartOptions, PutOptions, PutPayload, PutResult, Result, limit::LimitStore,
    path::Path,
};

use crate::storage::CONCURRENT_REQUESTS;

// test only
const TEST_FILE: &str = "o2_test/check.txt";

pub struct StorageConfig {
    pub name: String,          // ZO_S3_ACCOUNTS
    pub provider: String,      // ZO_S3_PROVIDER
    pub server_url: String,    // ZO_S3_SERVER_URL
    pub region_name: String,   // ZO_S3_REGION_NAME
    pub access_key: String,    // ZO_S3_ACCESS_KEY
    pub secret_key: String,    // ZO_S3_SECRET_KEY
    pub bucket_name: String,   // ZO_S3_BUCKET_NAME
    pub bucket_prefix: String, // ZO_S3_BUCKET_PREFIX
}

impl std::fmt::Debug for StorageConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StorageConfig")
            .field("name", &self.name)
            .field("provider", &self.provider)
            .field("server_url", &self.server_url)
            .field("region_name", &self.region_name)
            .field("access_key", &"[REDACTED]")
            .field("secret_key", &"[REDACTED]")
            .field("bucket_name", &self.bucket_name)
            .field("bucket_prefix", &self.bucket_prefix)
            .finish()
    }
}

pub struct Remote {
    client: LimitStore<Box<dyn object_store::ObjectStore>>,
    bucket_prefix: String,
}

impl Remote {
    pub fn name() -> &'static str {
        "remote"
    }

    pub fn new(config: StorageConfig) -> Self {
        let bucket_prefix = config.bucket_prefix.clone();
        Self {
            client: LimitStore::new(init_client(config), CONCURRENT_REQUESTS),
            bucket_prefix,
        }
    }

    /// Format the key with the bucket prefix for this specific Remote instance
    fn format_key(&self, key: &str) -> String {
        if !self.bucket_prefix.is_empty() && !key.starts_with(&self.bucket_prefix) {
            format!("{}{}", self.bucket_prefix, key)
        } else {
            key.to_string()
        }
    }
}

impl std::fmt::Debug for Remote {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("storage for remote")
    }
}

impl std::fmt::Display for Remote {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("storage for remote")
    }
}

#[async_trait]
impl ObjectStore for Remote {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let data_size = payload.content_length();
        match self
            .client
            .put_opts(&(self.format_key(&file).into()), payload, opts)
            .await
        {
            Ok(_) => {
                // metrics
                let columns = file.split('/').collect::<Vec<&str>>();
                if columns[0] == "files" {
                    metrics::STORAGE_WRITE_BYTES
                        .with_label_values(&[columns[1], columns[2], "remote"])
                        .inc_by(data_size as u64);
                    metrics::STORAGE_WRITE_REQUESTS
                        .with_label_values(&[columns[1], columns[2], "remote"])
                        .inc();
                    let time = start.elapsed().as_secs_f64();
                    metrics::STORAGE_TIME
                        .with_label_values(&[columns[1], columns[2], "put", "remote"])
                        .inc_by(time);
                }
                Ok(PutResult {
                    e_tag: None,
                    version: None,
                })
            }
            Err(err) => {
                log::error!("[STORAGE] put_opts remote file: {file}, error: {err:?}");
                Err(err)
            }
        }
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        let file = location.to_string();
        match self
            .client
            .put_multipart_opts(&(self.format_key(&file).into()), opts)
            .await
        {
            Ok(r) => Ok(r),
            Err(err) => {
                log::error!("[STORAGE] put_multipart_opts remote file: {file}, error: {err:?}");
                Err(err)
            }
        }
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let start = std::time::Instant::now();
        let file = location.to_string();
        let result = self
            .client
            .get_opts(&(self.format_key(&file).into()), options)
            .await
            .map_err(|e| {
                // NotFound is a normal probe outcome (optional blobs, head checks), not a fault.
                if matches!(e, object_store::Error::NotFound { .. }) {
                    log::debug!("[STORAGE] get_opts remote file: {file}, error: {e:?}");
                } else {
                    log::error!("[STORAGE] get_opts remote file: {file}, error: {e:?}");
                }
                e
            })?;

        // metrics — use the actual returned range size, not the full file
        // size. For range / suffix GETs `result.meta.size` is the total file
        // length, which would over-count bytes by ~the file size each call.
        let mut data_len = result.range.end - result.range.start;
        if data_len == 0 {
            data_len = result.meta.size;
        }
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::STORAGE_READ_BYTES
                .with_label_values(&[columns[1], columns[2], "get_opts", "remote"])
                .inc_by(data_len);
            metrics::STORAGE_READ_REQUESTS
                .with_label_values(&[columns[1], columns[2], "get_opts", "remote"])
                .inc();
            let time = start.elapsed().as_secs_f64();
            metrics::STORAGE_TIME
                .with_label_values(&[columns[1], columns[2], "get_opts", "remote"])
                .inc_by(time);
        }

        Ok(result)
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, Result<Path>>,
    ) -> BoxStream<'static, Result<Path>> {
        let prefix = self.bucket_prefix.clone();
        let formatted = locations
            .map(move |result| {
                result.map(|path| {
                    let key = path.as_ref().to_string();
                    if !prefix.is_empty() && !key.starts_with(&prefix) {
                        Path::from(format!("{}{}", prefix, key))
                    } else {
                        path
                    }
                })
            })
            .boxed();
        self.client.delete_stream(formatted)
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        let key = prefix.map(|p| p.as_ref());
        let prefix = self.format_key(key.unwrap_or(""));
        self.client.list(Some(&prefix.into()))
    }

    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        let key = prefix.map(|p| p.as_ref());
        let prefix = self.format_key(key.unwrap_or(""));
        self.client.list_with_delimiter(Some(&prefix.into())).await
    }

    async fn copy_opts(&self, _from: &Path, _to: &Path, _options: CopyOptions) -> Result<()> {
        Err(Error::NotImplemented {
            operation: "copy_opts".to_string(),
            implementer: Self::name().to_string(),
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AzureAuth {
    AccountKey,
    ManagedIdentity,
    WorkloadIdentity,
}

impl AzureAuth {
    fn as_str(self) -> &'static str {
        match self {
            Self::AccountKey => "account_key",
            Self::ManagedIdentity => "managed_identity",
            Self::WorkloadIdentity => "workload_identity",
        }
    }
}

struct AzureSetting {
    env_var: String,
    key: object_store::azure::AzureConfigKey,
    value: String,
}

fn init_aws_config(config: StorageConfig) -> object_store::Result<object_store::aws::AmazonS3> {
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
        .with_disable_bulk_delete(!cfg.s3.feature_bulk_delete);
    if !config.server_url.is_empty() {
        builder = builder.with_endpoint(&config.server_url);
    }
    if !config.region_name.is_empty() {
        builder = builder.with_region(&config.region_name);
    }
    if !config.access_key.is_empty() {
        builder = builder.with_access_key_id(&config.access_key);
    }
    if !config.secret_key.is_empty() {
        builder = builder.with_secret_access_key(&config.secret_key);
    }
    builder.build()
}

fn init_azure_config(
    config: StorageConfig,
) -> object_store::Result<object_store::azure::MicrosoftAzure> {
    let generic = |source: anyhow::Error| object_store::Error::Generic {
        store: "MicrosoftAzure",
        source: source.into(),
    };
    let auth = parse_azure_auth(&get_config().s3.azure_auth).map_err(generic)?;
    azure_builder(&config, auth, std::env::vars_os())
        .map_err(generic)?
        .build()
}

fn parse_azure_auth(value: &str) -> anyhow::Result<Option<AzureAuth>> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" => Ok(None),
        "account_key" => Ok(Some(AzureAuth::AccountKey)),
        "managed_identity" => Ok(Some(AzureAuth::ManagedIdentity)),
        "workload_identity" => Ok(Some(AzureAuth::WorkloadIdentity)),
        other => anyhow::bail!(
            "invalid ZO_S3_AZURE_AUTH '{other}', expected one of: account_key, managed_identity, workload_identity"
        ),
    }
}

fn azure_builder(
    config: &StorageConfig,
    auth: Option<AzureAuth>,
    env: impl IntoIterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
) -> anyhow::Result<object_store::azure::MicrosoftAzureBuilder> {
    let mut settings = azure_env_settings(env);
    if let Some(auth) = auth {
        settings = azure_auth_settings(auth, &config.secret_key, settings)?;
    }
    let cfg = get_config();
    let mut builder = settings
        .into_iter()
        .fold(
            object_store::azure::MicrosoftAzureBuilder::new(),
            |builder, setting| builder.with_config(setting.key, setting.value),
        )
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
    Ok(builder)
}

fn azure_env_settings(
    env: impl IntoIterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
) -> Vec<AzureSetting> {
    let mut settings = Vec::new();
    let mut identity_endpoint = None;
    for (name, value) in env {
        let (Ok(name), Ok(value)) = (name.into_string(), value.into_string()) else {
            continue;
        };
        if name == "IDENTITY_ENDPOINT" {
            identity_endpoint = Some(value);
        } else if name.starts_with("AZURE_")
            && let Ok(key) = name.to_ascii_lowercase().parse()
        {
            settings.push(AzureSetting {
                env_var: name,
                key,
                value,
            });
        }
    }
    if let Some(value) = identity_endpoint {
        settings.push(AzureSetting {
            env_var: "IDENTITY_ENDPOINT".to_string(),
            key: object_store::azure::AzureConfigKey::MsiEndpoint,
            value,
        });
    }
    settings
}

fn azure_auth_settings(
    auth: AzureAuth,
    secret_key: &str,
    settings: Vec<AzureSetting>,
) -> anyhow::Result<Vec<AzureSetting>> {
    use object_store::azure::AzureConfigKey as Key;
    let settings: Vec<_> = settings
        .into_iter()
        .filter(|s| !s.value.is_empty())
        .collect();
    let has = |wanted: Key| settings.iter().any(|s| s.key == wanted);
    if auth == AzureAuth::AccountKey {
        anyhow::ensure!(
            !secret_key.is_empty() || has(Key::AccessKey),
            "ZO_S3_AZURE_AUTH=account_key needs ZO_S3_SECRET_KEY or AZURE_STORAGE_ACCOUNT_KEY"
        );
    } else {
        let secrets: Vec<&str> = (!secret_key.is_empty())
            .then_some("ZO_S3_SECRET_KEY")
            .into_iter()
            .chain(settings.iter().filter_map(|s| {
                matches!(
                    s.key,
                    Key::AccessKey | Key::SasKey | Key::Token | Key::ClientSecret
                )
                .then_some(s.env_var.as_str())
            }))
            .collect();
        anyhow::ensure!(
            secrets.is_empty(),
            "ZO_S3_AZURE_AUTH={} does not use secrets, unset: {}",
            auth.as_str(),
            secrets.join(", ")
        );
    }
    if auth == AzureAuth::WorkloadIdentity {
        let missing: Vec<&str> = [
            (Key::ClientId, "AZURE_CLIENT_ID"),
            (Key::AuthorityId, "AZURE_TENANT_ID"),
            (Key::FederatedTokenFile, "AZURE_FEDERATED_TOKEN_FILE"),
        ]
        .into_iter()
        .filter_map(|(key, name)| (!has(key)).then_some(name))
        .collect();
        anyhow::ensure!(
            missing.is_empty(),
            "ZO_S3_AZURE_AUTH=workload_identity is missing {}; on AKS the pod needs the label azure.workload.identity/use: \"true\"",
            missing.join(", ")
        );
    }
    Ok(settings
        .into_iter()
        .filter(|s| azure_key_allowed(auth, s.key))
        .collect())
}

fn azure_key_allowed(auth: AzureAuth, key: object_store::azure::AzureConfigKey) -> bool {
    use object_store::azure::AzureConfigKey as Key;
    match key {
        Key::AccountName
        | Key::Endpoint
        | Key::UseFabricEndpoint
        | Key::AuthorityHost
        | Key::ContainerName
        | Key::DisableTagging
        | Key::Client(_) => true,
        Key::AccessKey => auth == AzureAuth::AccountKey,
        Key::ClientId => auth != AzureAuth::AccountKey,
        Key::ObjectId | Key::MsiResourceId | Key::MsiEndpoint => auth == AzureAuth::ManagedIdentity,
        Key::AuthorityId | Key::FederatedTokenFile => auth == AzureAuth::WorkloadIdentity,
        // Secrets, SAS, tokens, CLI, emulator, skip-signature, Fabric and future keys fail closed.
        _ => false,
    }
}

fn init_gcp_config(
    config: StorageConfig,
) -> object_store::Result<object_store::gcp::GoogleCloudStorage> {
    let cfg = get_config();
    let mut builder = object_store::gcp::GoogleCloudStorageBuilder::from_env()
        .with_client_options(
            object_store::ClientOptions::default()
                .with_connect_timeout(std::time::Duration::from_secs(cfg.s3.connect_timeout))
                .with_timeout(std::time::Duration::from_secs(cfg.s3.request_timeout))
                .with_allow_invalid_certificates(cfg.s3.allow_invalid_certificates),
        )
        .with_bucket_name(&config.bucket_name);
    if !config.access_key.is_empty() {
        builder = builder.with_service_account_path(&config.access_key);
    }
    builder.build()
}

pub fn build_signer(
    config: StorageConfig,
) -> object_store::Result<Box<dyn object_store::signer::Signer + Send + Sync>> {
    let provider = config.provider.to_lowercase();
    match provider.as_str() {
        "aws" | "s3" | "" => init_aws_config(config)
            .map(|s| Box::new(s) as Box<dyn object_store::signer::Signer + Send + Sync>),
        "gcs" | "gcp" => init_gcp_config(config)
            .map(|s| Box::new(s) as Box<dyn object_store::signer::Signer + Send + Sync>),
        "azure" => init_azure_config(config)
            .map(|s| Box::new(s) as Box<dyn object_store::signer::Signer + Send + Sync>),
        _ => init_aws_config(config)
            .map(|s| Box::new(s) as Box<dyn object_store::signer::Signer + Send + Sync>),
    }
}

fn init_client(config: StorageConfig) -> Box<dyn object_store::ObjectStore> {
    if get_config().common.print_key_config {
        log::info!("s3 init config: {config:?}");
    }

    let provider = config.provider.to_string();
    match provider.as_str() {
        "aws" | "s3" => match init_aws_config(config) {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("s3 init config error: {e}");
            }
        },
        "azure" => match init_azure_config(config) {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("azure init config error: {e}");
            }
        },
        "gcs" | "gcp" => match init_gcp_config(config) {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("gcp init config error: {e}");
            }
        },
        _ => match init_aws_config(config) {
            Ok(client) => Box::new(client),
            Err(e) => {
                panic!("{provider} init config error: {e:?}");
            }
        },
    }
}

pub async fn test_config() -> Result<(), anyhow::Error> {
    // Test download
    match super::get("", TEST_FILE).await {
        Ok(_) => {
            return Ok(());
        }
        Err(e) => match e {
            object_store::Error::NotFound { .. } => {}
            object_store::Error::PermissionDenied { path: _, source }
                if source.to_string().contains("ListBucket") => {}
            _ => {
                return Err(anyhow::anyhow!("S3 download test failed: {e}"));
            }
        },
    };

    // Test upload
    let data = Bytes::from("Hello, OpenObserve!");
    if let Err(e) = super::put("", TEST_FILE, data).await {
        return Err(anyhow::anyhow!("S3 upload test failed: {e}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use object_store::local::LocalFileSystem;

    use super::*;

    #[test]
    fn storage_config_debug_redacts_keys() {
        let config = StorageConfig {
            name: "acct".to_string(),
            provider: "s3".to_string(),
            server_url: "http://minio".to_string(),
            region_name: "us-east-1".to_string(),
            access_key: "AKIA-ACCESS-SECRET".to_string(),
            secret_key: "SECRET-KEY-VALUE".to_string(),
            bucket_name: "bucket".to_string(),
            bucket_prefix: "prefix/".to_string(),
        };
        let printed = format!("{config:?}");
        assert!(!printed.contains("AKIA-ACCESS-SECRET"), "{printed}");
        assert!(!printed.contains("SECRET-KEY-VALUE"), "{printed}");
        assert!(printed.contains("bucket") && printed.contains("http://minio"));
    }

    fn azure_config(secret_key: &str) -> StorageConfig {
        StorageConfig {
            name: String::new(),
            provider: "azure".to_string(),
            server_url: String::new(),
            region_name: String::new(),
            access_key: String::new(),
            secret_key: secret_key.to_string(),
            bucket_name: "o2container".to_string(),
            bucket_prefix: String::new(),
        }
    }

    fn azure_env(vars: &[(&str, &str)]) -> Vec<(std::ffi::OsString, std::ffi::OsString)> {
        [("AZURE_STORAGE_ACCOUNT_NAME", "o2account")]
            .iter()
            .chain(vars)
            .map(|(k, v)| (k.into(), v.into()))
            .collect()
    }

    #[test]
    fn parse_azure_auth_values() {
        let cases = [
            ("", None),
            ("account_key", Some(AzureAuth::AccountKey)),
            (" Managed_Identity ", Some(AzureAuth::ManagedIdentity)),
            ("WORKLOAD_IDENTITY", Some(AzureAuth::WorkloadIdentity)),
        ];
        for (input, expected) in cases {
            assert_eq!(parse_azure_auth(input).unwrap(), expected, "{input:?}");
        }
        let err = parse_azure_auth("azure_cli").unwrap_err().to_string();
        assert!(
            err.contains("account_key, managed_identity, workload_identity"),
            "{err}"
        );
    }

    #[test]
    fn azure_builder_by_auth_mode() {
        use AzureAuth::*;
        use object_store::azure::AzureConfigKey::*;
        let base64_key = "c2VjcmV0";
        let imds = "http://169.254.169.254/msi";
        let wi = [
            ("AZURE_CLIENT_ID", "cid"),
            ("AZURE_TENANT_ID", "tid"),
            ("AZURE_FEDERATED_TOKEN_FILE", "/t"),
        ];
        let cases = [
            (
                "R1 unset: secret key",
                None,
                base64_key,
                vec![],
                vec![(AccessKey, Some(base64_key))],
            ),
            (
                "R1 unset: blank env key kept as on main",
                None,
                "",
                vec![("AZURE_STORAGE_ACCOUNT_KEY", "")],
                vec![(AccessKey, Some(""))],
            ),
            (
                "R7 account_key: secret, identity dropped",
                Some(AccountKey),
                base64_key,
                vec![("AZURE_CLIENT_ID", "cid")],
                vec![(AccessKey, Some(base64_key)), (ClientId, None)],
            ),
            (
                "R7 account_key: env key",
                Some(AccountKey),
                "",
                vec![("AZURE_STORAGE_ACCOUNT_KEY", base64_key)],
                vec![(AccessKey, Some(base64_key))],
            ),
            (
                "R3 managed_identity: Helm blank key",
                Some(ManagedIdentity),
                "",
                vec![
                    ("AZURE_STORAGE_ACCOUNT_KEY", ""),
                    ("AZURE_CLIENT_ID", "cid"),
                ],
                vec![
                    (AccessKey, None),
                    (ClientId, Some("cid")),
                    (AccountName, Some("o2account")),
                ],
            ),
            (
                "R5 managed_identity: selectors and endpoint",
                Some(ManagedIdentity),
                "",
                vec![
                    ("IDENTITY_ENDPOINT", imds),
                    ("AZURE_OBJECT_ID", "oid"),
                    ("AZURE_MSI_RESOURCE_ID", "rid"),
                ],
                vec![
                    (MsiEndpoint, Some(imds)),
                    (ObjectId, Some("oid")),
                    (MsiResourceId, Some("rid")),
                ],
            ),
            (
                "R9 managed_identity: workload identity vars ignored",
                Some(ManagedIdentity),
                "",
                wi.to_vec(),
                vec![
                    (ClientId, Some("cid")),
                    (AuthorityId, None),
                    (FederatedTokenFile, None),
                ],
            ),
            (
                "R4 managed_identity: CLI and emulator dropped",
                Some(ManagedIdentity),
                "",
                vec![
                    ("AZURE_USE_AZURE_CLI", "true"),
                    ("AZURE_STORAGE_USE_EMULATOR", "true"),
                ],
                vec![(UseAzureCli, Some("false")), (UseEmulator, Some("false"))],
            ),
            (
                "R6 workload_identity: injected vars",
                Some(WorkloadIdentity),
                "",
                [
                    wi.as_slice(),
                    [
                        ("AZURE_AUTHORITY_HOST", "https://login.microsoftonline.us/"),
                        ("IDENTITY_ENDPOINT", imds),
                    ]
                    .as_slice(),
                ]
                .concat(),
                vec![
                    (ClientId, Some("cid")),
                    (AuthorityId, Some("tid")),
                    (FederatedTokenFile, Some("/t")),
                    (AuthorityHost, Some("https://login.microsoftonline.us/")),
                    (MsiEndpoint, None),
                ],
            ),
        ];
        for (case, auth, secret, vars, expected) in cases {
            let builder = azure_builder(&azure_config(secret), auth, azure_env(&vars))
                .unwrap_or_else(|e| panic!("{case}: {e}"));
            for (key, value) in expected {
                assert_eq!(
                    builder.get_config_value(&key).as_deref(),
                    value,
                    "{case}: {key:?}"
                );
            }
            assert!(builder.build().is_ok(), "{case}");
        }
    }

    #[test]
    fn azure_builder_rejects_invalid_auth_config() {
        use AzureAuth::*;
        let base64_key = "c2VjcmV0";
        let cases = [
            (
                "R7 account_key: no key",
                AccountKey,
                "",
                vec![],
                vec!["AZURE_STORAGE_ACCOUNT_KEY"],
            ),
            (
                "R8 managed_identity: ZO_S3_SECRET_KEY",
                ManagedIdentity,
                base64_key,
                vec![],
                vec!["ZO_S3_SECRET_KEY"],
            ),
            (
                "R8 managed_identity: SAS key",
                ManagedIdentity,
                "",
                vec![("AZURE_STORAGE_SAS_KEY", "sv=x")],
                vec!["AZURE_STORAGE_SAS_KEY"],
            ),
            (
                "R8 workload_identity: env account key",
                WorkloadIdentity,
                "",
                vec![
                    ("AZURE_CLIENT_ID", "cid"),
                    ("AZURE_TENANT_ID", "tid"),
                    ("AZURE_FEDERATED_TOKEN_FILE", "/t"),
                    ("AZURE_STORAGE_ACCESS_KEY", base64_key),
                ],
                vec!["AZURE_STORAGE_ACCESS_KEY"],
            ),
            (
                "R6 workload_identity: missing token file",
                WorkloadIdentity,
                "",
                vec![("AZURE_CLIENT_ID", "cid"), ("AZURE_TENANT_ID", "tid")],
                vec!["AZURE_FEDERATED_TOKEN_FILE", "azure.workload.identity/use"],
            ),
            (
                "R6 workload_identity: nothing injected",
                WorkloadIdentity,
                "",
                vec![],
                vec![
                    "AZURE_CLIENT_ID",
                    "AZURE_TENANT_ID",
                    "AZURE_FEDERATED_TOKEN_FILE",
                ],
            ),
        ];
        for (case, auth, secret, vars, expected) in cases {
            let err = azure_builder(&azure_config(secret), Some(auth), azure_env(&vars))
                .err()
                .unwrap_or_else(|| panic!("{case}: expected an error"))
                .to_string();
            for text in expected {
                assert!(err.contains(text), "{case}: {err}");
            }
            assert!(
                !err.contains(base64_key) && !err.contains("sv=x"),
                "{case}: leaks a secret: {err}"
            );
        }
    }

    fn make_remote(prefix: &str) -> Remote {
        Remote {
            client: LimitStore::new(
                Box::new(
                    LocalFileSystem::new_with_prefix("/tmp")
                        .expect("LocalFileSystem creation failed"),
                ),
                CONCURRENT_REQUESTS,
            ),
            bucket_prefix: prefix.to_string(),
        }
    }

    #[test]
    fn test_name_returns_remote() {
        assert_eq!(Remote::name(), "remote");
    }

    #[test]
    fn test_display_formats_to_storage_for_remote() {
        let r = make_remote("");
        assert_eq!(format!("{r}"), "storage for remote");
    }

    #[test]
    fn test_debug_contains_storage_for_remote() {
        let r = make_remote("");
        let s = format!("{r:?}");
        assert!(s.contains("storage for remote"));
    }

    #[test]
    fn test_format_key_empty_prefix_is_passthrough() {
        let r = make_remote("");
        assert_eq!(
            r.format_key("files/default/logs/foo.parquet"),
            "files/default/logs/foo.parquet"
        );
    }

    #[test]
    fn test_format_key_with_prefix_prepends() {
        let r = make_remote("my-bucket/");
        assert_eq!(
            r.format_key("files/foo.parquet"),
            "my-bucket/files/foo.parquet"
        );
    }

    #[test]
    fn test_format_key_already_has_prefix_no_double_prefix() {
        let r = make_remote("my-bucket/");
        assert_eq!(
            r.format_key("my-bucket/files/foo.parquet"),
            "my-bucket/files/foo.parquet"
        );
    }
}
