// Copyright 2025 OpenObserve Inc.
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

mod migrations;

use std::cmp::Ordering;

use config::meta::{folder::DEFAULT_FOLDER, user::UserRole};
use hashbrown::HashSet;
use infra::dist_lock;
#[cfg(feature = "cloud")]
use o2_enterprise::enterprise::cloud::is_ofga_migrations_done;
use o2_enterprise::enterprise::{
    common::config::get_config as get_o2_config,
    super_cluster::kv::ofga::{get_model, set_model},
};
use o2_openfga::{
    authorizer::authz::{
        add_tuple_for_pipeline, get_add_user_to_org_tuples, get_org_creation_tuples,
        get_ownership_all_org_tuple, get_ownership_tuple, update_tuples,
    },
    meta::mapping::{
        LOGS_INSIGHTS_KEY, LOGS_PATTERN_KEY, NON_OWNING_ORG, OFGA_MODELS, OFGAModel,
        RESULT_LOGS_CACHE_KEY,
    },
};

use crate::{
    common::{
        infra::config::{ORG_USERS, ORGANIZATIONS, USERS},
        meta::organization::DEFAULT_ORG,
    },
    service::db,
};

pub async fn init() -> Result<(), anyhow::Error> {
    use o2_openfga::get_all_init_tuples;

    // this is not supposed to be processed by every node
    // only one region (in super cluster) and only one node (in that region)
    // should move forward with this. This is because, openfga db is supposed
    // to be shared across all regions. Hence, since the db is common for all,
    // we don't need all node to do same changes again and again to the same db.

    let mut init_tuples = vec![];
    let mut migrate_native_objects = false;
    let mut need_pipeline_migration = false;
    let mut need_cipher_keys_migration = false;
    let mut need_action_scripts_migration = false;
    let mut need_alert_folders_migration = false;
    let mut need_ratelimit_migration = false;
    let mut need_service_accounts_migration = false;
    let mut need_ai_chat_permissions_migration = false;
    let mut need_re_pattern_permission_migration = false;
    let mut need_license_permission_migration = false;
    let mut need_logs_pattern_insights_migration = false;

    let existing_meta: Option<o2_openfga::meta::mapping::OFGAModel> =
        match db::ofga::get_ofga_model().await {
            Ok(Some(model)) => Some(model),
            Ok(None) | Err(_) => {
                migrate_native_objects = true;
                None
            }
        };

    let meta = o2_openfga::model::read_ofga_model().await;
    get_all_init_tuples(&mut init_tuples).await;
    if let Some(existing_model) = &existing_meta
        && meta.version == existing_model.version
    {
        log::info!("[OFGA:Local] model already exists & no changes required");
        if !init_tuples.is_empty() {
            match update_tuples(init_tuples, vec![]).await {
                Ok(_) => {
                    log::info!("[OFGA:Local] Data migrated to openfga");
                }
                Err(e) => {
                    log::error!(
                        "Error writing init ofga tuples to the openfga during migration: {e}"
                    );
                }
            }
        }
        return Ok(());
    }

    // 1. create a cluster lock
    let locker = dist_lock::lock("/ofga/model/", 0)
        .await
        .expect("Failed to acquire lock for openFGA");

    // check again, if ofga model is already updated by other node
    let mut existing_meta = match db::ofga::get_ofga_model().await {
        Ok(meta) => meta,
        Err(e) => {
            log::warn!("[OFGA] Error getting OFGA model from local: {e}");
            None
        }
    };
    if get_o2_config().super_cluster.enabled {
        // Compare super cluster model and local meta model
        let meta_in_super = match get_model().await {
            Ok(meta) => meta,
            Err(e) => {
                log::error!("[OFGA:SuperCluster] Error getting OFGA model from super cluster: {e}");
                dist_lock::unlock(&locker)
                    .await
                    .expect("Failed to release lock");
                return Err(e.into());
            }
        };
        match (meta_in_super, &existing_meta) {
            // Do not set model to super cluster here, we are doing that anyway after saving the
            // model in the local. This is to set the latest model version and store id
            // on super cluster only after the local save is done (the ofga table is
            // already updated)
            (Some(model), None) => {
                // set to local
                log::info!(
                    "[OFGA:SuperCluster] local model is empty, got model from super cluster with version: {}",
                    model.version
                );
                existing_meta = Some(model.clone());
                migrate_native_objects = false;
                if let Err(e) = db::ofga::set_ofga_model_to_db(model).await {
                    log::error!("[OFGA] Error setting OFGA model to local db: {e}");
                    dist_lock::unlock(&locker)
                        .await
                        .expect("Failed to release lock");
                    return Err(e);
                }
            }
            (Some(model), Some(existing_model))
                if model.version.cmp(&existing_model.version) == Ordering::Greater =>
            {
                log::info!(
                    "[OFGA:SuperCluster] model version changed: {} -> {}, needs to update local",
                    existing_model.version,
                    model.version
                );
                // update version in local
                existing_meta = Some(model.clone());
                migrate_native_objects = false;
                if let Err(e) = db::ofga::set_ofga_model_to_db(model).await {
                    log::error!("[OFGA] Error setting OFGA model to local db: {e}");
                    dist_lock::unlock(&locker)
                        .await
                        .expect("Failed to release lock");
                    return Err(e);
                }
            }
            _ => {}
        }
    }

    let existing_model_version = existing_meta
        .as_ref()
        .map(|existing_meta_model| existing_meta_model.version.clone());

    match db::ofga::set_ofga_model(existing_meta).await {
        Ok((store_id, latest_model_version, matched)) => {
            if store_id.is_empty() {
                log::error!("[OFGA:Local] OFGA store id is empty");
            }
            o2_openfga::config::OFGA_STORE_ID.insert("store_id".to_owned(), store_id.clone());

            if get_o2_config().super_cluster.enabled {
                // Set the model version in the super cluster, only version and store_id is
                // important
                if let Err(e) = set_model(Some(OFGAModel {
                    version: latest_model_version.clone(),
                    store_id,
                    model_id: "".to_string(),
                    model: None,
                }))
                .await
                {
                    log::error!(
                        "[OFGA:SuperCluster] Error setting OFGA model to super cluster: {e}"
                    );
                    dist_lock::unlock(&locker)
                        .await
                        .expect("Failed to release lock");
                    return Err(e.into());
                }
            }

            if matched {
                // No further openfga init required, as the meta table version was already updated
                // by some other node. Hence simply unlock and return from here.
                dist_lock::unlock(&locker)
                    .await
                    .expect("Failed to release lock");
                return Ok(());
            }

            #[cfg(feature = "cloud")]
            if !is_ofga_migrations_done().await.unwrap() {
                log::info!("[OFGA:Local] OFGA migrations are not done yet");
                // release lock
                dist_lock::unlock(&locker)
                    .await
                    .expect("Failed to release lock");
                return Ok(());
            }

            if let Some(existing_model_version) = existing_model_version {
                log::info!(
                    "[OFGA:Local] model version changed: {} -> {}",
                    existing_model_version,
                    latest_model_version
                );
                // Check if ofga migration of index streams are needed
                let meta_version = version_compare::Version::from(&latest_model_version).unwrap();
                let existing_model_version =
                    version_compare::Version::from(&existing_model_version).unwrap();
                let v0_0_5 = version_compare::Version::from("0.0.5").unwrap();
                let v0_0_6 = version_compare::Version::from("0.0.6").unwrap();
                let v0_0_8 = version_compare::Version::from("0.0.8").unwrap();
                let v0_0_9 = version_compare::Version::from("0.0.9").unwrap();
                let v0_0_10 = version_compare::Version::from("0.0.10").unwrap();
                let v0_0_12 = version_compare::Version::from("0.0.12").unwrap();
                let v0_0_13 = version_compare::Version::from("0.0.13").unwrap();
                let v0_0_15 = version_compare::Version::from("0.0.15").unwrap();
                let v0_0_16 = version_compare::Version::from("0.0.16").unwrap();
                let v0_0_17 = version_compare::Version::from("0.0.17").unwrap();
                let v0_0_18 = version_compare::Version::from("0.0.18").unwrap();
                let v0_0_20 = version_compare::Version::from("0.0.20").unwrap();
                let v0_0_21 = version_compare::Version::from("0.0.21").unwrap();
                let v0_0_25 = version_compare::Version::from("0.0.25").unwrap();

                if meta_version > v0_0_5 && existing_model_version < v0_0_6 {
                    need_pipeline_migration = true;
                }
                if meta_version > v0_0_8 && existing_model_version < v0_0_9 {
                    need_cipher_keys_migration = true;
                }
                if meta_version > v0_0_9 && existing_model_version < v0_0_10 {
                    need_action_scripts_migration = true;
                }
                if meta_version > v0_0_12 && existing_model_version < v0_0_13 {
                    log::info!("[OFGA:Local] Alert folders migration needed");
                    need_alert_folders_migration = true;
                }

                if meta_version > v0_0_15 && existing_model_version < v0_0_16 {
                    log::info!("[OFGA:Local] Ratelimit migration needed");
                    need_ratelimit_migration = true;
                    need_service_accounts_migration = true;
                }
                if meta_version > v0_0_17 && existing_model_version < v0_0_18 {
                    log::info!("[OFGA:Local] AI chat permissions migration needed");
                    need_ai_chat_permissions_migration = true;
                }
                if existing_model_version < v0_0_20 {
                    log::info!("[OFGA:Local] re_patterns permissions migration needed");
                    need_re_pattern_permission_migration = true;
                }

                if existing_model_version < v0_0_21 {
                    log::info!("[OFGA:Local] license permissions migration needed");
                    need_license_permission_migration = true;
                }

                if existing_model_version < v0_0_25 {
                    log::info!(
                        "[OFGA:Local] logs patterns, insights, cache delete permissions migration needed"
                    );
                    need_logs_pattern_insights_migration = true;
                }
            }

            let mut tuples = vec![];
            let r = ORGANIZATIONS.read().await;
            let mut orgs = HashSet::new();
            for org_name in r.keys() {
                orgs.insert(org_name.to_owned());
            }
            log::info!("[OFGA:Local] Migrating native objects");
            if migrate_native_objects {
                for org_name in orgs.iter() {
                    get_org_creation_tuples(
                        org_name,
                        &mut tuples,
                        OFGA_MODELS
                            .values()
                            .map(|fga_entity| fga_entity.key)
                            .collect(),
                        NON_OWNING_ORG.to_vec(),
                    )
                    .await;
                }
                // No Data Ingested hence STREAM_SCHEMAS is empty , so we need to create at
                // least default org
                if tuples.is_empty() {
                    get_org_creation_tuples(
                        DEFAULT_ORG,
                        &mut tuples,
                        OFGA_MODELS
                            .values()
                            .map(|fga_entity| fga_entity.key)
                            .collect(),
                        NON_OWNING_ORG.to_vec(),
                    )
                    .await;
                }

                for user_key_val in ORG_USERS.iter() {
                    let org_user = user_key_val.value();
                    let user = USERS.get(org_user.email.as_str()).unwrap();
                    if user.user_type.is_external() {
                        continue;
                    } else {
                        let role = if user.is_root {
                            UserRole::Admin.to_string()
                        } else {
                            org_user.role.to_string()
                        };
                        get_add_user_to_org_tuples(
                            &org_user.org_id,
                            &org_user.email,
                            &role,
                            &mut tuples,
                        );
                    }
                }
            } else {
                log::info!("[OFGA:Local] Migrating index streams");
                for org_name in orgs.iter() {
                    if need_cipher_keys_migration {
                        get_ownership_all_org_tuple(org_name, "cipher_keys", &mut tuples);
                    }
                    if need_action_scripts_migration {
                        get_ownership_all_org_tuple(org_name, "actions", &mut tuples);
                    }
                    if need_pipeline_migration {
                        get_ownership_all_org_tuple(org_name, "pipelines", &mut tuples);
                        match db::pipeline::list_by_org(org_name).await {
                            Ok(pipelines) => {
                                for pipeline in pipelines {
                                    add_tuple_for_pipeline(org_name, &pipeline.id, &mut tuples);
                                }
                            }
                            Err(e) => {
                                log::error!(
                                    "Failed to migrate RBAC for org {org_name} pipelines: {e}"
                                );
                            }
                        }
                    }
                    if need_alert_folders_migration {
                        get_ownership_all_org_tuple(org_name, "alert_folders", &mut tuples);
                        get_ownership_tuple(org_name, "alert_folders", DEFAULT_FOLDER, &mut tuples);
                    }
                    if need_ratelimit_migration {
                        get_ownership_all_org_tuple(org_name, "ratelimit", &mut tuples);
                    }
                    if need_service_accounts_migration {
                        get_ownership_all_org_tuple(org_name, "service_accounts", &mut tuples);
                    }
                    if need_ai_chat_permissions_migration {
                        get_ownership_all_org_tuple(org_name, "ai", &mut tuples);
                    }
                    if need_re_pattern_permission_migration {
                        get_ownership_all_org_tuple(org_name, "re_patterns", &mut tuples);
                    }
                    if need_license_permission_migration {
                        get_ownership_all_org_tuple(org_name, "license", &mut tuples);
                    }
                    if need_logs_pattern_insights_migration {
                        get_ownership_all_org_tuple(org_name, LOGS_INSIGHTS_KEY, &mut tuples);
                        get_ownership_all_org_tuple(org_name, LOGS_PATTERN_KEY, &mut tuples);
                        get_ownership_all_org_tuple(org_name, RESULT_LOGS_CACHE_KEY, &mut tuples);
                    }
                }
                if need_alert_folders_migration {
                    match migrations::migrate_alert_folders().await {
                        Ok(_) => {
                            log::info!("[OFGA:Local] Alert folders migrated to openfga");
                        }
                        Err(e) => {
                            log::error!(
                                "[OFGA:Local] Error migrating alert folders to openfga: {e}"
                            );
                        }
                    }
                }
            }

            // Check if there are init ofga tuples that needs to be added now
            for tuple in init_tuples {
                tuples.push(tuple);
            }

            if tuples.is_empty() {
                log::info!("[OFGA:Local] No orgs to update to the openfga");
            } else {
                log::debug!("[OFGA:Local] tuples not empty: {tuples:#?}");
                match update_tuples(tuples, vec![]).await {
                    Ok(_) => {
                        log::info!("[OFGA:Local] Data migrated to openfga");
                    }
                    Err(e) => {
                        log::error!(
                            "Error updating orgs & users to the openfga during migration: {e}"
                        );
                    }
                }
            }
        }
        Err(e) => {
            log::error!("Error setting OFGA model: {e}");
        }
    }
    // release lock
    dist_lock::unlock(&locker)
        .await
        .expect("Failed to release lock");

    Ok(())
}
