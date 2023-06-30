// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use crate::infra::config::{CONFIG, INSTANCE_ID, SYSLOG_ENABLED};
use crate::infra::{cluster, ider};
use crate::meta::organization::DEFAULT_ORG;
use crate::meta::user::UserRequest;
use crate::service::{db, users};
use regex::Regex;

mod alert_manager;
mod compact;
mod file_list;
mod files;
mod metrics;
mod prom;
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
            panic!("Please set root user email-id & password using ZO_ROOT_USER_EMAIL & ZO_ROOT_USER_PASSWORD environment variables. This can also indicate an invalid email ID. Email ID must comply with ([a-z0-9_+]([a-z0-9_+.-]*[a-z0-9_+])?)@([a-z0-9]+([\\-\\.]{{1}}[a-z0-9]+)*\\.[a-z]{{2,6}})");
        }
        let _ = users::post_user(
            DEFAULT_ORG,
            UserRequest {
                email: CONFIG.auth.root_user_email.clone(),
                password: CONFIG.auth.root_user_password.clone(),
                role: crate::meta::user::UserRole::Root,
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
            },
        )
        .await;
    }
    // cache users
    tokio::task::spawn(async move { db::user::watch().await });
    db::user::cache().await.expect("user cache failed");

    //set instance id
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
    if CONFIG.common.telemetry_enabled {
        tokio::task::spawn(async move { telemetry::run().await });
    }

    // initialize metadata
    tokio::task::spawn(async move { db::functions::watch().await });
    tokio::task::spawn(async move { db::schema::watch().await });
    tokio::task::spawn(async move { db::compact::retention::watch().await });
    tokio::task::spawn(async move { db::metrics::watch_prom_cluster_leader().await });
    tokio::task::spawn(async move { db::alerts::watch().await });
    tokio::task::spawn(async move { db::triggers::watch().await });
    tokio::task::spawn(async move { db::alerts::templates::watch().await });
    tokio::task::spawn(async move { db::alerts::destinations::watch().await });
    tokio::task::spawn(async move { db::syslog::watch().await });
    tokio::task::spawn(async move { db::syslog::watch_syslog_settings().await });
    tokio::task::yield_now().await; // yield let other tasks run

    db::functions::cache()
        .await
        .expect("functions cache failed");
    db::compact::retention::cache()
        .await
        .expect("compact delete cache failed");
    db::metrics::cache_prom_cluster_leader()
        .await
        .expect("prom cluster leader cache failed");
    db::alerts::cache().await.expect("alerts cache failed");
    db::triggers::cache()
        .await
        .expect("alerts triggers cache failed");
    db::alerts::templates::cache()
        .await
        .expect("alerts templates cache failed");
    db::alerts::destinations::cache()
        .await
        .expect("alerts destinations cache failed");
    db::syslog::cache().await.expect("syslog cache failed");
    db::syslog::cache_syslog_settings()
        .await
        .expect("syslog settings cache failed");

    // cache file list
    db::file_list::local::cache()
        .await
        .expect("file list local cache failed");
    db::file_list::remote::cache("")
        .await
        .expect("file list remote cache failed");

    // Shouldn't serve request until initialization finishes
    log::info!("Start job");

    // compactor run
    tokio::task::spawn(async move { compact::run().await });

    // alert manager run
    tokio::task::spawn(async move { alert_manager::run().await });

    // ingester run
    tokio::task::spawn(async move { files::disk::run().await });
    tokio::task::spawn(async move { files::memory::run().await });
    tokio::task::spawn(async move { file_list::run().await });
    tokio::task::spawn(async move { prom::run().await });
    tokio::task::spawn(async move { metrics::run().await });

    // Syslog server start
    let start_syslog = *SYSLOG_ENABLED.read();
    if start_syslog {
        syslog_server::run(start_syslog, true)
            .await
            .expect("syslog server run failed");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::env;

    use super::*;

    #[actix_web::test]
    #[ignore]
    async fn test_init() {
        env::set_var("ZO_LOCAL_MODE", "true");
        env::set_var("ZO_NODE_ROLE", "all");
        let _ = init().await;
        //assert_eq!(fs::metadata(&CONFIG.common.data_wal_dir).is_ok(), true)
    }
}
