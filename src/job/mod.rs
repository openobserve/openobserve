// Copyright 2023 Zinc Labs Inc.
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

use config::{cluster, ider, utils::file::clean_empty_dirs, CONFIG, INSTANCE_ID};
use infra::file_list as infra_file_list;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::O2_CONFIG;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::openfga::authorizer::authz::{
    get_org_creation_tuples, get_user_role_tuple, update_tuples,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::openfga::meta::mapping::{NON_OWNING_ORG, OFGA_MODELS};
use regex::Regex;

#[cfg(feature = "enterprise")]
use crate::common::infra::config::{STREAM_SCHEMAS, USERS};
use crate::{
    common::{
        infra::config::SYSLOG_ENABLED,
        meta::{organization::DEFAULT_ORG, user::UserRequest},
    },
    service::{compact::stats::update_stats_from_file_list, db, users},
};

mod alert_manager;
mod compact;
pub(crate) mod file_list;
pub(crate) mod files;
mod metrics;
mod mmdb_downloader;
mod prom;
mod stats;
pub(crate) mod syslog_server;
mod telemetry;

pub async fn init() -> Result<(), anyhow::Error> {
    let email_regex = Regex::new(
        r"^([a-z0-9_+]([a-z0-9_+.-]*[a-z0-9_+])?)@([a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,6})",
    )
    .expect("Email regex is valid");

    // init root user
    if !db::user::root_user_exists().await {
        if CONFIG.auth.root_user_email.is_empty()
            || !email_regex.is_match(&CONFIG.auth.root_user_email)
            || CONFIG.auth.root_user_password.is_empty()
        {
            panic!(
                "Please set root user email-id & password using ZO_ROOT_USER_EMAIL & ZO_ROOT_USER_PASSWORD environment variables. This can also indicate an invalid email ID. Email ID must comply with ([a-z0-9_+]([a-z0-9_+.-]*[a-z0-9_+])?)@([a-z0-9]+([\\-\\.]{{1}}[a-z0-9]+)*\\.[a-z]{{2,6}})"
            );
        }
        let _ = users::create_root_user(
            DEFAULT_ORG,
            UserRequest {
                email: CONFIG.auth.root_user_email.clone(),
                password: CONFIG.auth.root_user_password.clone(),
                role: crate::common::meta::user::UserRole::Root,
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                is_external: false,
            },
        )
        .await;
    }

    if !CONFIG.common.mmdb_disable_download {
        // Try to download the mmdb files, if its not disabled.
        tokio::task::spawn(async move { mmdb_downloader::run().await });
    }
    // cache users
    tokio::task::spawn(async move { db::user::watch().await });
    db::user::cache().await.expect("user cache failed");

    db::organization::cache()
        .await
        .expect("organization cache sync failed");

    // set instance id
    let instance_id = match db::get_instance().await {
        Ok(Some(instance)) => instance,
        Ok(None) | Err(_) => {
            let id = ider::generate();
            let _ = db::set_instance(&id).await;
            id
        }
    };
    INSTANCE_ID.insert("instance_id".to_owned(), instance_id);

    // check version
    db::version::set().await.expect("db version set failed");

    // Router doesn't need to initialize job
    if cluster::is_router(&cluster::LOCAL_NODE_ROLE) {
        return Ok(());
    }

    // telemetry run
    if CONFIG.common.telemetry_enabled && cluster::is_querier(&cluster::LOCAL_NODE_ROLE) {
        tokio::task::spawn(async move { telemetry::run().await });
    }

    // initialize metadata watcher
    tokio::task::spawn(async move { db::schema::watch().await });
    tokio::task::spawn(async move { db::functions::watch().await });
    tokio::task::spawn(async move { db::compact::retention::watch().await });
    tokio::task::spawn(async move { db::metrics::watch_prom_cluster_leader().await });
    tokio::task::spawn(async move { db::alerts::templates::watch().await });
    tokio::task::spawn(async move { db::alerts::destinations::watch().await });
    tokio::task::spawn(async move { db::alerts::watch().await });
    tokio::task::spawn(async move { db::alerts::triggers::watch().await });
    tokio::task::spawn(async move { db::organization::watch().await });
    tokio::task::yield_now().await; // yield let other tasks run

    // cache core metadata
    db::schema::cache().await.expect("stream cache failed");
    db::functions::cache()
        .await
        .expect("functions cache failed");
    db::compact::retention::cache()
        .await
        .expect("compact delete cache failed");
    db::metrics::cache_prom_cluster_leader()
        .await
        .expect("prom cluster leader cache failed");

    // cache alerts
    db::alerts::templates::cache()
        .await
        .expect("alerts templates cache failed");
    db::alerts::destinations::cache()
        .await
        .expect("alerts destinations cache failed");
    db::alerts::cache().await.expect("alerts cache failed");
    db::alerts::triggers::cache()
        .await
        .expect("alerts triggers cache failed");
    db::syslog::cache().await.expect("syslog cache failed");
    db::syslog::cache_syslog_settings()
        .await
        .expect("syslog settings cache failed");

    // cache file list
    if !CONFIG.common.meta_store_external {
        if cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
            // load the wal file_list into memory
            db::file_list::local::load_wal_in_cache()
                .await
                .expect("load wal file list failed");
        }
        if cluster::is_querier(&cluster::LOCAL_NODE_ROLE)
            || cluster::is_compactor(&cluster::LOCAL_NODE_ROLE)
        {
            db::file_list::remote::cache("", false)
                .await
                .expect("file list remote cache failed");
            infra_file_list::create_table_index()
                .await
                .expect("file list create table index failed");
            update_stats_from_file_list()
                .await
                .expect("file list remote calculate stats failed");
        }
    }

    infra_file_list::create_table_index().await?;
    db::file_list::remote::cache_stats()
        .await
        .expect("Load stream stats failed");

    // check wal directory
    if cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        // create wal dir
        if let Err(e) = std::fs::create_dir_all(&CONFIG.common.data_wal_dir) {
            log::error!("Failed to create wal dir: {}", e);
        }
        // clean empty sub dirs
        _ = clean_empty_dirs(&CONFIG.common.data_wal_dir);
    }

    tokio::task::spawn(async move { files::run().await });
    tokio::task::spawn(async move { file_list::run().await });
    tokio::task::spawn(async move { stats::run().await });
    tokio::task::spawn(async move { compact::run().await });
    tokio::task::spawn(async move { metrics::run().await });
    tokio::task::spawn(async move { prom::run().await });
    tokio::task::spawn(async move { alert_manager::run().await });

    #[cfg(feature = "enterprise")]
    o2_enterprise::enterprise::openfga::authorizer::authz::init_open_fga().await;

    // RBAC model
    #[cfg(feature = "enterprise")]
    if O2_CONFIG.openfga.enabled {
        let mut migrate_native_objects = false;
        let existing_meta = match db::get_ofga_model().await {
            Ok(Some(model)) => Some(model),
            Ok(None) | Err(_) => {
                migrate_native_objects = true;
                None
            }
        };
        match db::set_ofga_model(existing_meta).await {
            Ok(store_id) => {
                if store_id.is_empty() {
                    log::error!("OFGA store id is empty");
                }
                o2_enterprise::enterprise::common::infra::config::OFGA_STORE_ID
                    .insert("store_id".to_owned(), store_id);

                if migrate_native_objects {
                    let mut tuples = vec![];
                    let r = STREAM_SCHEMAS.read().await;
                    for key in r.keys() {
                        if !key.contains('/') {
                            continue;
                        }
                        let org_name = key.split('/').collect::<Vec<&str>>()[0];
                        get_org_creation_tuples(
                            org_name,
                            &mut tuples,
                            OFGA_MODELS
                                .iter()
                                .map(|(_, fga_entity)| fga_entity.key)
                                .collect(),
                            NON_OWNING_ORG.to_vec(),
                        )
                        .await;
                    }
                    drop(r);

                    for user_key_val in USERS.iter() {
                        let user = user_key_val.value();
                        if user.is_external {
                            continue;
                        } else {
                            get_user_role_tuple(
                                &user.role.to_string(),
                                &user.email,
                                &user.org,
                                &mut tuples,
                            );
                        }
                    }

                    if tuples.is_empty() {
                        log::info!("No orgs to update to the openfga");
                    } else {
                        match update_tuples(tuples, vec![]).await {
                            Ok(_) => {
                                log::info!("Orgs updated to the openfga");
                            }
                            Err(e) => {
                                log::error!("Error updating orgs to the openfga: {}", e);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("Error setting OFGA model: {:?}", e);
            }
        }
    }

    // Shouldn't serve request until initialization finishes
    log::info!("Job initialization complete");

    // Syslog server start
    tokio::task::spawn(async move { db::syslog::watch().await });
    tokio::task::spawn(async move { db::syslog::watch_syslog_settings().await });

    let start_syslog = *SYSLOG_ENABLED.read();
    if start_syslog {
        syslog_server::run(start_syslog, true)
            .await
            .expect("syslog server run failed");
    }

    Ok(())
}
