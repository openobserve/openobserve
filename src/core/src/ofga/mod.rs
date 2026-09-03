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

mod migrations;

use std::cmp::Ordering;

use config::{
    DEFAULT_ORG,
    meta::{folder::DEFAULT_FOLDER, user::UserRole},
};
use db;
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

use crate::common::infra::config::{ORG_USERS, ORGANIZATIONS, USERS};

/// Which version-gated permission migrations one model upgrade needs.
#[derive(Default)]
struct MigrationFlags {
    need_pipeline_migration: bool,
    need_cipher_keys_migration: bool,
    need_alert_folders_migration: bool,
    need_ratelimit_migration: bool,
    need_service_accounts_migration: bool,
    need_ai_chat_permissions_migration: bool,
    need_re_pattern_permission_migration: bool,
    need_license_permission_migration: bool,
    need_sourcemap_permission_migration: bool,
    need_logs_pattern_insights_migration: bool,
    need_service_streams_migration: bool,
    need_ai_toolsets_migration: bool,
    need_report_folders_migration: bool,
    need_incidents_migration: bool,
    need_model_pricing_migration: bool,
    need_anomaly_detection_migration: bool,
    need_online_eval_migration: bool,
    need_billing_group_migration: bool,
    need_workflows_migration: bool,
    need_synthetics_migration: bool,
    need_stream_names_migration: bool,
    need_annotation_queues_datasets_migration: bool,
    need_llm_workbench_migration: bool,
    need_synthetics_umbrella_migration: bool,
}

pub async fn init() -> Result<(), anyhow::Error> {
    use o2_openfga::get_all_init_tuples;

    // this is not supposed to be processed by every node
    // only one region (in super cluster) and only one node (in that region)
    // should move forward with this. This is because, openfga db is supposed
    // to be shared across all regions. Hence, since the db is common for all,
    // we don't need all node to do same changes again and again to the same db.

    let mut init_tuples = vec![];
    let mut migrate_native_objects = false;
    let mut flags = MigrationFlags::default();

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
                flags = migration_flags(&latest_model_version, &existing_model_version);
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
                let keys = flagged_ownership_keys(&flags);
                for org_name in orgs.iter() {
                    for key in &keys {
                        get_ownership_all_org_tuple(org_name, key, &mut tuples);
                    }
                    if flags.need_pipeline_migration {
                        match infra::pipeline::list_by_org(org_name).await {
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
                    if flags.need_alert_folders_migration {
                        get_ownership_tuple(org_name, "alert_folders", DEFAULT_FOLDER, &mut tuples);
                    }
                    if flags.need_report_folders_migration {
                        get_ownership_tuple(
                            org_name,
                            "report_folders",
                            DEFAULT_FOLDER,
                            &mut tuples,
                        );
                    }
                }
                run_flagged_table_migrations(&flags).await;
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

/// Flags every version-gated migration between two model versions.
fn migration_flags(latest: &str, existing: &str) -> MigrationFlags {
    let mut flags = MigrationFlags::default();
    let meta_version = version_compare::Version::from(latest).unwrap();
    let existing_model_version = version_compare::Version::from(existing).unwrap();
    let v0_0_5 = version_compare::Version::from("0.0.5").unwrap();
    let v0_0_6 = version_compare::Version::from("0.0.6").unwrap();
    let v0_0_8 = version_compare::Version::from("0.0.8").unwrap();
    let v0_0_9 = version_compare::Version::from("0.0.9").unwrap();
    let v0_0_12 = version_compare::Version::from("0.0.12").unwrap();
    let v0_0_13 = version_compare::Version::from("0.0.13").unwrap();
    let v0_0_15 = version_compare::Version::from("0.0.15").unwrap();
    let v0_0_16 = version_compare::Version::from("0.0.16").unwrap();
    let v0_0_17 = version_compare::Version::from("0.0.17").unwrap();
    let v0_0_18 = version_compare::Version::from("0.0.18").unwrap();
    let v0_0_20 = version_compare::Version::from("0.0.20").unwrap();
    let v0_0_21 = version_compare::Version::from("0.0.21").unwrap();
    let v0_0_25 = version_compare::Version::from("0.0.25").unwrap();
    let v0_0_26 = version_compare::Version::from("0.0.26").unwrap();
    let v0_0_27 = version_compare::Version::from("0.0.27").unwrap();
    let v0_0_29 = version_compare::Version::from("0.0.29").unwrap();
    let v0_0_30 = version_compare::Version::from("0.0.30").unwrap();
    let v0_0_31 = version_compare::Version::from("0.0.31").unwrap();
    let v0_0_33 = version_compare::Version::from("0.0.33").unwrap();
    let v0_0_34 = version_compare::Version::from("0.0.34").unwrap();
    let v0_0_35 = version_compare::Version::from("0.0.35").unwrap();
    let v0_0_36 = version_compare::Version::from("0.0.36").unwrap();
    let v0_0_37 = version_compare::Version::from("0.0.37").unwrap();
    let v0_0_38 = version_compare::Version::from("0.0.38").unwrap();
    let v0_0_39 = version_compare::Version::from("0.0.39").unwrap();
    let v0_0_42 = version_compare::Version::from("0.0.42").unwrap();
    let v0_0_46 = version_compare::Version::from("0.0.46").unwrap();

    if meta_version > v0_0_5 && existing_model_version < v0_0_6 {
        flags.need_pipeline_migration = true;
    }
    if meta_version > v0_0_8 && existing_model_version < v0_0_9 {
        flags.need_cipher_keys_migration = true;
    }
    if meta_version > v0_0_12 && existing_model_version < v0_0_13 {
        log::info!("[OFGA:Local] Alert folders migration needed");
        flags.need_alert_folders_migration = true;
    }
    if meta_version > v0_0_15 && existing_model_version < v0_0_16 {
        log::info!("[OFGA:Local] Ratelimit migration needed");
        flags.need_ratelimit_migration = true;
        flags.need_service_accounts_migration = true;
    }
    if meta_version > v0_0_17 && existing_model_version < v0_0_18 {
        log::info!("[OFGA:Local] AI chat permissions migration needed");
        flags.need_ai_chat_permissions_migration = true;
    }
    if existing_model_version < v0_0_20 {
        log::info!("[OFGA:Local] re_patterns permissions migration needed");
        flags.need_re_pattern_permission_migration = true;
    }
    if existing_model_version < v0_0_21 {
        log::info!("[OFGA:Local] license permissions migration needed");
        flags.need_license_permission_migration = true;
    }
    if existing_model_version < v0_0_25 {
        log::info!(
            "[OFGA:Local] logs patterns, insights, cache delete permissions migration needed"
        );
        flags.need_logs_pattern_insights_migration = true;
    }
    if existing_model_version < v0_0_26 {
        log::info!("[OFGA:Local] sourcemap permissions migration needed");
        flags.need_sourcemap_permission_migration = true;
    }
    if existing_model_version < v0_0_27 {
        log::info!("[OFGA:Local] service_streams permissions migration needed");
        flags.need_service_streams_migration = true;
    }
    if existing_model_version < v0_0_29 {
        log::info!("[OFGA:Local] ai_toolsets permissions migration needed");
        flags.need_ai_toolsets_migration = true;
        log::info!("[OFGA:Local] model_pricing permissions migration needed");
        flags.need_model_pricing_migration = true;
    }
    if existing_model_version < v0_0_30 {
        log::info!("[OFGA:Local] report folders migration needed");
        flags.need_report_folders_migration = true;
    }
    if existing_model_version < v0_0_31 {
        log::info!("[OFGA:Local] incidents permissions migration needed");
        flags.need_incidents_migration = true;
    }
    if existing_model_version < v0_0_33 {
        log::info!("[OFGA:Local] anomaly detection permissions migration needed");
        flags.need_anomaly_detection_migration = true;
    }
    if existing_model_version < v0_0_34 {
        log::info!("[OFGA:Local] billing group migration needed");
        flags.need_billing_group_migration = true;
    }
    if existing_model_version < v0_0_35 {
        log::info!("[OFGA:Local] online eval permissions migration needed");
        flags.need_online_eval_migration = true;
    }
    if existing_model_version < v0_0_36 {
        log::info!("[OFGA:Local] synthetics permissions migration needed");
        flags.need_synthetics_migration = true;
    }
    if existing_model_version < v0_0_37 {
        log::info!("[OFGA:Local] workflows permissions migration needed");
        flags.need_workflows_migration = true;
    }
    if existing_model_version < v0_0_38 {
        log::info!("[OFGA:Local] stream names migration needed");
        flags.need_stream_names_migration = true;
    }
    if existing_model_version < v0_0_39 {
        log::info!("[OFGA:Local] annotation queues and datasets permissions migration needed");
        flags.need_annotation_queues_datasets_migration = true;
    }
    if existing_model_version < v0_0_42 {
        log::info!("[OFGA:Local] LLM workbench permissions migration needed");
        flags.need_llm_workbench_migration = true;
    }
    if existing_model_version < v0_0_46 {
        log::info!("[OFGA:Local] synthetics umbrella permissions migration needed");
        flags.need_synthetics_umbrella_migration = true;
    }
    flags
}

/// Object types whose org-wide `_all_` ownership tuples the flags call for.
///
/// Everything per-org and uniform lives here; the three cases with extra work
/// (pipelines' per-id tuples, the two folder defaults) stay at the call site.
fn flagged_ownership_keys(flags: &MigrationFlags) -> Vec<&'static str> {
    let mut keys = Vec::new();
    if flags.need_cipher_keys_migration {
        keys.push("cipher_keys");
    }
    if flags.need_pipeline_migration {
        keys.push("pipelines");
    }
    if flags.need_alert_folders_migration {
        keys.push("alert_folders");
    }
    if flags.need_report_folders_migration {
        keys.push("report_folders");
    }
    if flags.need_ratelimit_migration {
        keys.push("ratelimit");
    }
    if flags.need_service_accounts_migration {
        keys.push("service_accounts");
    }
    if flags.need_ai_chat_permissions_migration {
        keys.push("ai");
    }
    if flags.need_re_pattern_permission_migration {
        keys.push("re_patterns");
    }
    if flags.need_license_permission_migration {
        keys.push("license");
    }
    if flags.need_sourcemap_permission_migration {
        keys.push("sourcemaps");
    }
    if flags.need_service_streams_migration {
        keys.push("service_streams");
    }
    if flags.need_logs_pattern_insights_migration {
        keys.extend([LOGS_INSIGHTS_KEY, LOGS_PATTERN_KEY, RESULT_LOGS_CACHE_KEY]);
    }
    if flags.need_ai_toolsets_migration {
        keys.push("ai_toolsets");
    }
    if flags.need_incidents_migration {
        keys.push("incidents");
    }
    if flags.need_model_pricing_migration {
        keys.push("model_pricing");
    }
    if flags.need_online_eval_migration {
        keys.extend(["providers", "score_configs", "scorers", "eval_jobs"]);
    }
    if flags.need_llm_workbench_migration {
        // The Playground is new at 0.0.41. The four beside it shipped earlier
        // without a migration branch, so orgs that predate their release never
        // received an `_all_` tuple and custom roles could not be granted those
        // resources at all. Emitting them here is idempotent for orgs that
        // already have them.
        keys.extend([
            "playground",
            "annotation_queues",
            "datasets",
            "experiments",
            "remote_tasks",
        ]);
    }
    if flags.need_billing_group_migration {
        keys.push("billing_group");
    }
    if flags.need_synthetics_migration {
        keys.extend(["synthetic_folder", "synthetics"]);
    }
    if flags.need_workflows_migration {
        keys.push("workflows");
    }
    if flags.need_annotation_queues_datasets_migration {
        keys.extend(["annotation_queues", "datasets"]);
    }
    // The two new types only. `synthetic_folder` gains a parent in the model,
    // but its parent tuples are injected at check time rather than persisted,
    // so there is nothing to backfill and no existing tuple to rewrite.
    if flags.need_synthetics_umbrella_migration {
        keys.extend(["synthetics_module", "synthetic_environment"]);
    }
    keys
}

/// Runs the table-backed migrations the flags call for.
async fn run_flagged_table_migrations(flags: &MigrationFlags) {
    if flags.need_alert_folders_migration {
        match migrations::migrate_alert_folders().await {
            Ok(_) => {
                log::info!("[OFGA:Local] Alert folders migrated to openfga");
            }
            Err(e) => {
                log::error!("[OFGA:Local] Error migrating alert folders to openfga: {e}");
            }
        }
    }
    if flags.need_report_folders_migration {
        match migrations::migrate_report_folders().await {
            Ok(_) => {
                log::info!("[OFGA:Local] Report folders migrated to openfga");
            }
            Err(e) => {
                log::error!("[OFGA:Local] Error migrating report folders to openfga: {e}");
            }
        }
    }
    if flags.need_anomaly_detection_migration {
        match migrations::migrate_anomaly_detection().await {
            Ok(_) => {
                log::info!("[OFGA:Local] Anomaly detection migrated to openfga");
            }
            Err(e) => {
                log::error!("[OFGA:Local] Error migrating anomaly detection to openfga: {e}");
            }
        }
    }
    if flags.need_stream_names_migration {
        match migrations::migrate_stream_names().await {
            Ok(_) => {
                log::info!("[OFGA:Local] Stream names migrated to openfga");
            }
            Err(e) => {
                log::error!("[OFGA:Local] Error migrating stream names to openfga: {e}");
            }
        }
    }
}
