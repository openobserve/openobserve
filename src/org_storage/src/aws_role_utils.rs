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
        Arc, LazyLock as Lazy,
        atomic::{AtomicI64, Ordering},
    },
    time::{Duration, UNIX_EPOCH},
};

use aws_config::{BehaviorVersion, Region};
use aws_credential_types::{Credentials, provider::ProvideCredentials};
use hashbrown::HashMap;
use infra::table::org_storage_providers::AwsRoleArn;
use object_store::aws::AwsCredential;
use tokio::sync::{Mutex, RwLock};

// The sts setup takes only 'static string as region name, and we need it to be dynamic-ish
// thus we keep a map of those, and use them so we don't have to keep creating 'static from
// non-statics
static STATIC_REGION_MAP: Lazy<Mutex<HashMap<String, &'static str>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// by default the minimum aws session expiry is 1hr, so we use that. Technically we can require it
// to have more expiry, at which point the following call will fail if the aws configured expiry <
// required, but then users will have to go and update it etc etc, so we just use the default 1 hour
// as of now
const SESSION_DURATION_HR: u64 = 1;
// we buffer and reset session by 1 min
const EXPIRY_BUFFER_SEC: i64 = 60;

#[derive(Debug)]
pub struct CredentialProvider {
    org_id: String,
    role_arn: String,
    external_id: String,
    region: &'static str,
    expiry: AtomicI64,
    cache: RwLock<Arc<AwsCredential>>,
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
    type Credential = object_store::aws::AwsCredential;
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
                let (expiry, credentials) = get_sts_credentials(
                    &self.org_id,
                    self.region,
                    &self.external_id,
                    &self.role_arn,
                )
                .await
                .map_err(|e| {
                    log::info!(
                        "error in refreshing credentials via sts for org {} : {e}",
                        self.org_id
                    );
                    object_store::Error::Generic {
                        store: "org_level_storage_sts",
                        source: Box::new(std::io::Error::other(e)),
                    }
                })?;
                *lock = Arc::new(AwsCredential {
                    key_id: credentials.access_key_id().to_string(),
                    secret_key: credentials.secret_access_key().to_string(),
                    token: credentials.session_token().map(|v| v.to_string()),
                });
                self.expiry.store(expiry, Ordering::Relaxed);
                log::info!(
                    "successfully updated credentials via sts for org {}",
                    self.org_id
                );
            } else {
                log::info!(
                    "some other thread already updated credentials via sts for org {}",
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
async fn get_sts_credentials(
    org_id: &str,
    region: &'static str,
    external_id: &str,
    role_arn: &str,
) -> Result<(i64, Credentials), anyhow::Error> {
    let cfg = aws_config::load_defaults(BehaviorVersion::latest()).await;

    // FOR SOME REASON, the region must be 'static string. hence we take region as static string,
    // and have to do the mess with STATIC_REGION_MAP etc.
    let provider = aws_config::sts::AssumeRoleProvider::builder(role_arn)
        .session_name(format!("openobserve-cloud-{org_id}"))
        .session_length(std::time::Duration::from_hours(SESSION_DURATION_HR))
        .configure(&cfg)
        .external_id(external_id)
        .region(Region::from_static(region))
        .build()
        .await;

    let creds = provider.provide_credentials().await?;

    // Not entirely sure why this returns systemtime instead of a timestamp,
    // but we have to convert it nonetheless. if it is present, we convert it to
    // TS using the epoch. If not present, we default to now+1hr as we requested for 1hr
    let expiry = if let Some(time) = creds.expiry()
        && let Ok(v) = time.duration_since(UNIX_EPOCH)
    {
        v.as_secs() as i64
    } else {
        chrono::Utc::now().timestamp() + (60 * 60)
    };
    Ok((expiry, creds))
}

pub async fn get_aws_from_role(
    org_id: &str,
    config: AwsRoleArn,
) -> object_store::Result<object_store::aws::AmazonS3> {
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

    // because we must provide the region as 'static string, and we will get region always as
    // non-static we have to make it static. So we need to leak it via box. However, to make
    // sure we don't keep leaking memory here STATIC_REGION_MAP is used, where at first use, we
    // leak and store the 'static pointer in map, and for rest of the uses, we just use the same
    // 'static pointer because the section is very short and not on hot path, we don't expect a
    // lot of contention
    let mut wlock = STATIC_REGION_MAP.lock().await;
    let region = if let Some(v) = wlock.get(&config.region) {
        *v
    } else {
        let r: &'static str = Box::leak(Box::new(config.region.clone()));
        wlock.insert(config.region.clone(), r);
        r
    };
    drop(wlock);

    let (exp, creds) = get_sts_credentials(org_id, region, &config.external_id, &config.role_arn)
        .await
        .map_err(|e| object_store::Error::Generic {
            store: "aws_from_role",
            source: Box::new(std::io::Error::other(e)),
        })?;

    let creds = AwsCredential {
        key_id: creds.access_key_id().to_string(),
        secret_key: creds.secret_access_key().to_string(),
        token: creds.session_token().map(|v| v.to_string()),
    };

    let credential_provider = CredentialProvider {
        org_id: org_id.to_string(),
        role_arn: config.role_arn,
        external_id: config.external_id,
        region,
        expiry: AtomicI64::new(exp),
        cache: RwLock::new(Arc::new(creds)),
    };

    let builder = object_store::aws::AmazonS3Builder::new()
        .with_client_options(opts)
        .with_bucket_name(&config.bucket_name)
        .with_region(&config.region)
        .with_credentials(Arc::new(credential_provider))
        .with_retry(retry_config);

    builder.build()
}
