pub async fn run() -> Result<(), anyhow::Error> {
    log::info!("setting up org level storages");
    let providers = match crate::service::org_storage_providers::get_provider_list().await {
        Ok(v) => v,
        Err(e) => {
            log::error!("Error in setting up org level storage providers : {e}");
            return Err(e);
        }
    };

    for (org, provider) in providers {
        let storage_key = infra::storage::get_org_storage_key(&org);
        log::info!("adding storage for org {org} : {storage_key}");
        infra::storage::add_account(storage_key, provider).await;
        log::info!("successfully added storage provider for org {org}");
    }
    log::info!("successfully setup all storage providers");
    Ok(())
}
