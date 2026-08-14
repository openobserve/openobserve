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
    AwsCredentials, AwsRoleArn, AzureCredentials, GcpCredentials, ProviderType,
};

pub struct StorageProviderPolicy<'a> {
    pub check_enabled: bool,
    pub allowed_providers: &'a str,
    pub region: &'a str,
    pub server_url: &'a str,
}

pub fn enforce_checks(
    provider: ProviderType,
    data: String,
    policy: &StorageProviderPolicy<'_>,
) -> Result<String, anyhow::Error> {
    if !policy.check_enabled {
        return Ok(data);
    }

    let pstring = provider.to_string();
    let found = policy.allowed_providers.split(',').find(|p| pstring == *p);
    if found.is_none() {
        return Err(anyhow::anyhow!(
            "provider {} is not supported in this installation, only {} are supported",
            provider,
            policy.allowed_providers
        ));
    }

    match provider {
        ProviderType::AwsCredentials => {
            let mut creds: AwsCredentials = serde_json::from_str(&data)?;
            if creds.region != policy.region {
                return Err(anyhow::anyhow!(
                    "region {} not supported, this installation only supports {} region",
                    creds.region,
                    policy.region
                ));
            }
            creds.server_url = policy.server_url.to_string();
            Ok(serde_json::to_string(&creds)?)
        }
        ProviderType::AwsRoleArn => {
            let creds: AwsRoleArn = serde_json::from_str(&data)?;
            if creds.region != policy.region {
                return Err(anyhow::anyhow!(
                    "region {} not supported, this installation only supports {} region",
                    creds.region,
                    policy.region
                ));
            }
            Ok(serde_json::to_string(&creds)?)
        }
        ProviderType::GcpCredentials => {
            let mut creds: GcpCredentials = serde_json::from_str(&data)?;
            creds.server_url = policy.server_url.to_string();
            Ok(serde_json::to_string(&creds)?)
        }
        ProviderType::AzureCredentials => {
            let mut creds: AzureCredentials = serde_json::from_str(&data)?;
            creds.server_url = policy.server_url.to_string();
            Ok(serde_json::to_string(&creds)?)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy<'a>(allowed_providers: &'a str) -> StorageProviderPolicy<'a> {
        StorageProviderPolicy {
            check_enabled: true,
            allowed_providers,
            region: "us-east-1",
            server_url: "https://storage.example.com",
        }
    }

    #[test]
    fn disabled_policy_leaves_data_unchanged() {
        let data = "not-json".to_string();
        let policy = StorageProviderPolicy {
            check_enabled: false,
            ..policy("")
        };

        assert_eq!(
            enforce_checks(ProviderType::AwsCredentials, data.clone(), &policy).unwrap(),
            data
        );
    }

    #[test]
    fn rejects_provider_outside_allowlist() {
        let error = enforce_checks(
            ProviderType::GcpCredentials,
            "{}".to_string(),
            &policy("AwsCredentials"),
        )
        .unwrap_err();

        assert!(error.to_string().contains("provider GcpCredentials"));
    }

    #[test]
    fn applies_configured_endpoint_to_aws_credentials() {
        let credentials = AwsCredentials {
            bucket_name: "bucket".to_string(),
            server_url: "https://user.example.com".to_string(),
            region: "us-east-1".to_string(),
            access_key: "access".to_string(),
            secret_key: "secret".to_string(),
        };

        let checked = enforce_checks(
            ProviderType::AwsCredentials,
            serde_json::to_string(&credentials).unwrap(),
            &policy("AwsCredentials"),
        )
        .unwrap();
        let checked: AwsCredentials = serde_json::from_str(&checked).unwrap();

        assert_eq!(checked.server_url, "https://storage.example.com");
    }

    #[test]
    fn rejects_aws_credentials_from_another_region() {
        let credentials = AwsCredentials {
            bucket_name: "bucket".to_string(),
            server_url: String::new(),
            region: "eu-west-1".to_string(),
            access_key: "access".to_string(),
            secret_key: "secret".to_string(),
        };

        let error = enforce_checks(
            ProviderType::AwsCredentials,
            serde_json::to_string(&credentials).unwrap(),
            &policy("AwsCredentials"),
        )
        .unwrap_err();

        assert!(error.to_string().contains("eu-west-1"));
        assert!(error.to_string().contains("us-east-1"));
    }
}
