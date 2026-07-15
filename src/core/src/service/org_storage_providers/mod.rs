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

use infra::table::org_storage_providers::{
    AwsCredentials, AwsRoleArn, AzureCredentials, GcpCredentials, OrgStorageProvider, ProviderType,
};
use object_store::ObjectStore;

use super::db::org_storage_providers;
use crate::service::org_storage_providers::utils::_merge_aws_role_arn;
mod aws_role_utils;
mod checks;
mod utils;

pub use checks::enforce_checks;
use utils::{
    _merge_aws_credentials, _merge_azure_credentials, _merge_gcp_credentials, get_aws, get_azure,
    get_gcp, test_provider,
};

pub(super) async fn get_provider(
    org_id: &str,
    typ: ProviderType,
    data: &str,
) -> Result<Box<dyn ObjectStore>, anyhow::Error> {
    let ret: Box<dyn ObjectStore>;
    match typ {
        ProviderType::AwsCredentials => {
            let creds: AwsCredentials = serde_json::from_str(data)?;
            let store = get_aws(creds)?;
            ret = Box::new(store);
        }
        ProviderType::AwsRoleArn => {
            let creds: AwsRoleArn = serde_json::from_str(data)?;
            let store = aws_role_utils::get_aws_from_role(org_id, creds).await?;
            ret = Box::new(store);
        }
        ProviderType::GcpCredentials => {
            let creds: GcpCredentials = serde_json::from_str(data)?;
            let store = get_gcp(creds)?;
            ret = Box::new(store);
        }
        ProviderType::AzureCredentials => {
            let creds: AzureCredentials = serde_json::from_str(data)?;
            let store = get_azure(creds)?;
            ret = Box::new(store);
        }
    }
    Ok(ret)
}

pub async fn get_provider_list() -> Result<Vec<(String, Box<dyn ObjectStore>)>, anyhow::Error> {
    let list = org_storage_providers::list_all()
        .await
        .inspect_err(|e| log::error!("error listing object store providers from db : {e}"))?;

    let mut ret: Vec<(String, Box<dyn ObjectStore>)> = Vec::with_capacity(list.len());

    for provider in list {
        match get_provider(&provider.org_id, provider.provider_type, &provider.data).await {
            Ok(v) => ret.push((provider.org_id, Box::new(v))),
            Err(e) => {
                log::error!(
                    "error in getting storage provider for org {}, skipping : {e}",
                    provider.org_id
                );
                continue;
            }
        }
    }

    Ok(ret)
}

#[inline]
fn redact(v: &str) -> String {
    let s = v.len();
    let e1 = s.min(3);
    let e2 = s.saturating_sub(3);
    format!(
        "{}***{}",
        v.get(0..e1).unwrap_or_default(),
        v.get(e2..s).unwrap_or_default()
    )
}

// NOTE : what we redact here matters for updating the creds in merge_configs, as that
// uses response from this for baseline. Be careful when redacting new things
pub async fn get_redacted_config(
    org_id: &str,
) -> Result<Option<OrgStorageProvider>, anyhow::Error> {
    let mut provider = org_storage_providers::get_for_org(org_id).await?;

    if let Some(config) = provider.as_mut() {
        match config.provider_type {
            ProviderType::AwsCredentials => {
                let mut creds: AwsCredentials = serde_json::from_str(&config.data)?;
                creds.access_key = redact(&creds.access_key);
                creds.secret_key = redact(&creds.secret_key);
                config.data = serde_json::to_string(&creds).unwrap();
            }
            ProviderType::AwsRoleArn => {
                // nothing to redact here
            }
            ProviderType::GcpCredentials => {
                let mut creds: GcpCredentials = serde_json::from_str(&config.data)?;
                creds.access_key = redact(&creds.access_key);
                config.data = serde_json::to_string(&creds).unwrap();
            }
            ProviderType::AzureCredentials => {
                let mut creds: AzureCredentials = serde_json::from_str(&config.data)?;
                creds.secret_key = redact(&creds.secret_key);
                config.data = serde_json::to_string(&creds).unwrap();
            }
        }
    };
    Ok(provider)
}

pub async fn set_storage(
    org_id: &str,
    provider_data: OrgStorageProvider,
) -> Result<(), anyhow::Error> {
    let provider = get_provider(org_id, provider_data.provider_type, &provider_data.data).await?;

    test_provider(&provider).await?;

    super::db::org_storage_providers::add(provider_data.clone()).await?;

    infra::table::org_storage_providers::update_cache(org_id, provider_data);
    infra::storage::add_account(org_id, provider).await;
    Ok(())
}

pub async fn validate_provider(provider: &OrgStorageProvider) -> Result<(), anyhow::Error> {
    let provider = get_provider(&provider.org_id, provider.provider_type, &provider.data).await?;
    test_provider(&provider).await?;
    Ok(())
}

// what is redacted in get_redacted_config above matters, as we use its response here as existing
pub fn merge_configs(
    provider_type: ProviderType,
    existing: &str,
    new: &str,
) -> Result<String, anyhow::Error> {
    match provider_type {
        ProviderType::AwsCredentials => _merge_aws_credentials(existing, new),
        ProviderType::GcpCredentials => _merge_gcp_credentials(existing, new),
        ProviderType::AzureCredentials => _merge_azure_credentials(existing, new),
        ProviderType::AwsRoleArn => _merge_aws_role_arn(existing, new),
    }
}
