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

use config::meta::self_reporting::error::{ErrorData, ErrorSource, OrgStorageError};

const CHECK_JOB_INTERVAL_MIN: u64 = 30;

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
    tokio::task::spawn(test_storage_validity());
    log::info!("successfully spawned storage config test job");
    Ok(())
}

async fn test_storage_validity() {
    let mut interval =
        tokio::time::interval(tokio::time::Duration::from_mins(CHECK_JOB_INTERVAL_MIN));

    log::info!("starting storage test job");
    // we skip the first tick, as on startup, we anyways validate the providers,
    // so we can skip the first half hour anc continue from next
    interval.tick().await;
    loop {
        interval.tick().await;
        let providers = match infra::table::org_storage_providers::list_all().await {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "error while listing org storage provider for check job, skipping iteration : {e}"
                );
                continue;
            }
        };

        for provider in providers {
            log::info!(
                "checking storage provider validity for org {}",
                provider.org_id
            );
            if let Err(e) =
                crate::service::org_storage_providers::validate_provider(&provider).await
            {
                // todo: bring error up to ui somehow
                log::error!(
                    "error when validating provider for org {}, falling back to default storage : {e}",
                    provider.org_id
                );
                infra::table::org_storage_providers::remove_from_cache(&provider.org_id);
                log::warn!(
                    "org {} has been removed from org storage cache, and will use default storage",
                    provider.org_id
                );
                crate::service::self_reporting::publish_error(ErrorData {
                    _timestamp: chrono::Utc::now().timestamp_micros(),
                    stream_params: Default::default(),
                    error_source: ErrorSource::OrgStorage(OrgStorageError {
                        org_id: provider.org_id.clone(),
                        error: e.to_string(),
                    }),
                })
                .await;
            } else {
                log::info!(
                    "successfully validated org storage config for org {}",
                    provider.org_id
                );
            }
        }
    }
}
