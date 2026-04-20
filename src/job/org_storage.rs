pub async fn run() -> Result<(), anyhow::Error> {
    log::info!("setting up org level storages");

    if let Err(e) = infra::table::org_storage_providers::prime_cache().await {
        log::error!(
            "Error in setting up infra level org storage info cache : {e}. Aborting infra level storage setup"
        );
        return Err(e);
    }

    let providers = match crate::service::org_storage_providers::get_provider_list().await {
        Ok(v) => v,
        Err(e) => {
            log::error!("Error in setting up org level storage providers : {e}");
            return Err(e);
        }
    };

    for (org, provider) in providers {
        log::info!("adding storage for org {org}");
        infra::storage::add_account(&org, provider).await;
        log::info!("successfully added storage provider for org {org}");
    }
    log::info!("successfully setup all storage providers");
    Ok(())
}
