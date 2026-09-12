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

use std::{
    sync::{
        Arc,
        atomic::{AtomicI64, Ordering},
    },
    time::Duration,
};

use infra::table::org_storage_providers::GcpServiceAccount;
use object_store::gcp::GcpCredential;
use serde::Deserialize;
use tokio::sync::RwLock;

// we buffer and reset session by 1 min
const EXPIRY_BUFFER_SEC: i64 = 60;

const SELF_TOKEN_BASE_URL: &str =
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

const SA_TOKEN_BASE_URL: &str =
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts";

// 1hr in sec
const SA_TOKEN_LIFETIME_STR: &str = "3600s";

#[allow(unused)]
#[derive(Debug)]
pub struct CredentialProvider {
    org_id: String,
    bucket_name: String,
    project_name: String,
    service_account_name: String,
    expiry: AtomicI64,
    cache: RwLock<Arc<GcpCredential>>,
}

#[allow(unused)]
#[derive(Deserialize)]
struct SelfTokenResponse {
    access_token: String,
    expires_in: usize,
    token_type: String,
}

#[derive(Deserialize)]
struct SaTokenResponse {
    #[serde(alias = "accessToken")]
    access_token: String,
    #[serde(alias = "expireTime")]
    expire_time: String,
}

// NOTE FOR THIS MODULE
// sts provides temporary credentials which expires after certain time. So we have two ways we can
// keep them updated
// 1. run a background job which will periodically call the sts update, get new creds, create a new
//    object store, and update the existing instance with this new one.
// 2. use the credential provider, keep a track of when the credentials will expire and auto-refresh
//    when near expiry
// we use the second approach here to prevent the need to creating and tracking another job. However
// that means we need to create a struct and impl the trait , which is what we do below.
// see the individual comments below to see the specifics of the implementation way

#[async_trait::async_trait]
impl object_store::CredentialProvider for CredentialProvider {
    type Credential = object_store::gcp::GcpCredential;
    async fn get_credential(&self) -> object_store::Result<std::sync::Arc<Self::Credential>> {
        let expiry = self.expiry.load(Ordering::Relaxed);
        let now = chrono::Utc::now().timestamp();

        // if already expired or almost near expiry, do a refresh, get new
        // credentials, update the cache with them
        if expiry <= now || expiry - now <= EXPIRY_BUFFER_SEC {
            // acquire a lock
            let mut lock = self.cache.write().await;
            // re-load the expiry, in case some other thread has already updated it
            let expiry = self.expiry.load(Ordering::Relaxed);
            let now = chrono::Utc::now().timestamp();
            if expiry <= now || expiry - now <= EXPIRY_BUFFER_SEC {
                // if the expiry condition still holds, do the sts call
                // and update the credentials and expiry
                log::info!(
                    "attempting to refresh credentials via sts for org {}",
                    self.org_id
                );
                let (expiry, token) = get_sa_credentials(&self.org_id,&self.service_account_name)
                .await
                .map_err(|e| {
                    log::info!(
                        "error in refreshing gcp credentials via service account for org {} : {e}",
                        self.org_id
                    );
                    object_store::Error::Generic {
                        store: "org_level_storage_gcp_sa",
                        source: Box::new(std::io::Error::other(e)),
                    }
                })?;
                *lock = Arc::new(GcpCredential { bearer: token });
                self.expiry.store(expiry, Ordering::Relaxed);
                log::info!(
                    "successfully updated gcp sa credentials via service account for org {}",
                    self.org_id
                );
            } else {
                log::info!(
                    "some other thread already updated gcp credentials via service account for org {}",
                    self.org_id
                );
            }
            // if expiry condition does not hold after we got the lock, i.e.
            // some thread had already acquired it before us and updated the creds,
            // simply drop the lock and use the new credentials
            drop(lock);
        }

        // in both expiry and non-expiry path, we simply get a read lock and clone the creds
        // in case of cred expiry, the above if-block would have updated the cache,
        // so we will get refreshed credentials
        let lock = self.cache.read().await;
        let creds = lock.clone();
        drop(lock);
        Ok(creds)
    }
}

// function to do assume role with sts and get temporary credentials and expiry
async fn get_sa_credentials(
    org_id: &str,
    service_account: &str,
) -> Result<(i64, String), anyhow::Error> {
    // need the specific header, otherwise it does not allow request
    let self_token_request = reqwest::Client::default()
        .get(SELF_TOKEN_BASE_URL)
        .header("Metadata-Flavor", "Google")
        .send()
        .await?;
    let self_token: SelfTokenResponse = self_token_request.json().await?;

    let sa_token_request = reqwest::Client::default()
    .post(format!("{SA_TOKEN_BASE_URL}/{}:generateAccessToken",service_account))
    .header("Authorization", format!("Bearer {}",self_token.access_token))
    .header("Content-Type", "Content-Type")
    .json(&serde_json::json!({"scope": ["https://www.googleapis.com/auth/devstorage.read_write"],"lifetime": SA_TOKEN_LIFETIME_STR}))
    .send()
    .await?;

    let sa_token: SaTokenResponse = sa_token_request.json().await?;

    let expiry = match chrono::DateTime::parse_from_rfc3339(&sa_token.expire_time) {
        Ok(v) => v.timestamp(),
        Err(e) => {
            log::error!(
                "error parsing expiry time for gcp sa for org id {org_id} : got {}  error {e}",
                sa_token.expire_time
            );
            chrono::Utc::now().timestamp() + (60 * 60)
        }
    };
    Ok((expiry, sa_token.access_token))
}

pub async fn get_gcp_from_service_account(
    org_id: &str,
    config: GcpServiceAccount,
) -> object_store::Result<object_store::gcp::GoogleCloudStorage> {
    let opts = object_store::ClientOptions::default()
        .with_connect_timeout(std::time::Duration::from_secs(30))
        .with_timeout(std::time::Duration::from_secs(30))
        .with_http2_keep_alive_timeout(Duration::from_secs(30))
        .with_allow_http(true);
    let retry_config = object_store::RetryConfig {
        max_retries: 10,
        // this value is from the default arrow-rs object
        // https://github.com/apache/arrow-rs/blob/678517018ddfd21b202a94df13b06dfa1ab8a378/object_store/src/client/retry.rs#L171-L179
        retry_timeout: Duration::from_secs(3 * 60),
        backoff: object_store::BackoffConfig::default(),
    };

    let (exp, token) = get_sa_credentials(org_id, &config.service_account_name)
        .await
        .map_err(|e| object_store::Error::Generic {
            store: "gcp_from_service_account",
            source: Box::new(std::io::Error::other(e)),
        })?;

    let creds = GcpCredential { bearer: token };

    let credential_provider = CredentialProvider {
        org_id: org_id.to_string(),
        bucket_name: config.bucket_name.clone(),
        project_name: config.project_name.clone(),
        service_account_name: config.service_account_name.clone(),
        expiry: AtomicI64::new(exp),
        cache: RwLock::new(Arc::new(creds)),
    };

    let builder = object_store::gcp::GoogleCloudStorageBuilder::new()
        .with_client_options(opts)
        .with_bucket_name(&config.bucket_name)
        .with_credentials(Arc::new(credential_provider))
        .with_retry(retry_config);

    builder.build()
}
