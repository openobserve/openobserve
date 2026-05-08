use infra::table::org_storage_providers::{
    AwsCredentials, AwsRoleArn, AzureCredentials, GcpCredentials, ProviderType,
};
use o2_enterprise::enterprise::common::config::get_config;

pub fn enforce_checks(provider: ProviderType, data: String) -> Result<String, anyhow::Error> {
    let cfg = get_config();

    if !cfg.org_storage.check_enabled {
        return Ok(data);
    }

    let pstring = provider.to_string();
    let found = cfg
        .org_storage
        .allowed_providers
        .split(',')
        .find(|p| pstring == *p);
    if found.is_none() {
        return Err(anyhow::anyhow!(
            "provider {} is not supported in this installation, only {} are supported",
            provider,
            cfg.org_storage.allowed_providers
        ));
    }

    match provider {
        ProviderType::AwsCredentials => {
            let mut creds: AwsCredentials = serde_json::from_str(&data)?;
            if creds.region != cfg.org_storage.region {
                return Err(anyhow::anyhow!(
                    "region {} not supported, this installation only supports {} region",
                    creds.region,
                    cfg.org_storage.region
                ));
            }
            creds.server_url = cfg.org_storage.server_url.clone();
            Ok(serde_json::to_string(&creds)?)
        }
        ProviderType::AwsRoleArn => {
            let creds: AwsRoleArn = serde_json::from_str(&data)?;
            if creds.region != cfg.org_storage.region {
                return Err(anyhow::anyhow!(
                    "region {} not supported, this installation only supports {} region",
                    creds.region,
                    cfg.org_storage.region
                ));
            }
            Ok(serde_json::to_string(&creds)?)
        }
        ProviderType::GcpCredentials => {
            let mut creds: GcpCredentials = serde_json::from_str(&data)?;
            creds.server_url = cfg.org_storage.server_url.clone();
            Ok(serde_json::to_string(&creds)?)
        }
        ProviderType::AzureCredentials => {
            let mut creds: AzureCredentials = serde_json::from_str(&data)?;
            creds.server_url = cfg.org_storage.server_url.clone();
            Ok(serde_json::to_string(&creds)?)
        }
    }
}
