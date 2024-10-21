// Copyright 2024 OpenObserve Inc.
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

use chrono::Utc;
use config::{meta::stream::StreamType, utils::json};
use datafusion::arrow::datatypes::Schema;
use infra::{
    db::{self as infra_db, NO_NEED_WATCH},
    dist_lock,
    errors::{DbError, Error},
    scheduler,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::get_config as get_o2_config;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::openfga::add_init_ofga_tuples;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::openfga::authorizer::authz::get_ownership_tuple;

use crate::{
    common::{
        infra::config::VERSION,
        meta::{
            alerts::{alert::Alert, destinations::Destination, templates::Template},
            dashboards::reports::Report,
        },
        utils::auth::{into_ofga_supported_format, is_ofga_unsupported},
    },
    service::db,
};

const SCHEMA_MIGRATION_KEY: &str = "/migration/schema_versions/status";
const META_MIGRATION_VERSION_KEY: &str = "/migration/meta/version";

pub async fn run() -> Result<(), anyhow::Error> {
    match upgrade_schema_row_per_version().await {
        std::result::Result::Ok(true) => {
            log::info!("[Schema:Migration]: Starting schema migration");
        }
        std::result::Result::Ok(false) => {
            log::info!("[Schema:Migration]: Schema migration already done");
            return Ok(());
        }
        Err(err) => {
            log::error!(
                "[Schema:Migration]: Error checking schema migration status: {}",
                err
            );
            return Err(err);
        }
    };

    // get lock
    let locker = infra::dist_lock::lock(SCHEMA_MIGRATION_KEY, 0, None).await?;

    // after get lock, need check again
    match upgrade_schema_row_per_version().await {
        std::result::Result::Ok(true) => {
            log::info!("[Schema:Migration]: Starting schema migration");
        }
        std::result::Result::Ok(false) => {
            log::info!("[Schema:Migration]: Schema migration already done");
            dist_lock::unlock(&locker).await?;
            return Ok(());
        }
        Err(err) => {
            log::error!(
                "[Schema:Migration]: Error checking schema migration status: {}",
                err
            );
            dist_lock::unlock(&locker).await?;
            return Err(err);
        }
    };

    // upgrade meta
    if let Err(e) = upgrade_meta().await {
        dist_lock::unlock(&locker).await?;
        return Err(e);
    }

    // upgrade triggers
    if let Err(e) = upgrade_trigger().await {
        dist_lock::unlock(&locker).await?;
        return Err(e);
    }

    // set migration status
    let db = infra_db::get_db().await;
    if let Err(e) = db
        .put(
            SCHEMA_MIGRATION_KEY,
            Utc::now().timestamp_micros().to_string().into(),
            NO_NEED_WATCH,
            None,
        )
        .await
    {
        // unlock the lock
        dist_lock::unlock(&locker).await?;
        return Err(e.into());
    }

    // unlock the lock
    dist_lock::unlock(&locker).await?;

    Ok(())
}

async fn upgrade_meta() -> Result<(), anyhow::Error> {
    let default_end_dt = "0".to_string();
    let cc = infra_db::get_coordinator().await;
    if let Err(e) = cc.add_start_dt_column().await {
        return Err(e.into());
    }

    let db = infra_db::get_db().await;
    if let Err(e) = db.add_start_dt_column().await {
        return Err(e.into());
    }

    log::info!("[Schema:Migration]: Migrating schemas");
    let db_key = "/schema/".to_string();
    log::info!("[Schema:Migration]: Listing all schemas");
    let data = db.list(&db_key).await?;
    for (key, val) in data {
        log::info!("[Schema:Migration]: Start migrating schema: {}", key);
        let schemas: Vec<Schema> = json::from_slice(&val).unwrap();
        let versions_count = schemas.len();
        let mut prev_end_dt: i64 = 0;

        for schema in schemas {
            if schema.fields().is_empty() && versions_count > 1 {
                continue; // Skip empty schema when there are multiple versions
            }
            let meta = schema.metadata();
            let start_dt: i64 = match meta.get("start_dt") {
                Some(val) => val.clone().parse().unwrap(),
                None => {
                    if prev_end_dt == 0 {
                        meta.get("created_at").unwrap().clone().parse().unwrap()
                    } else {
                        prev_end_dt
                    }
                }
            };
            prev_end_dt = meta
                .get("end_dt")
                .unwrap_or(&default_end_dt)
                .clone()
                .parse()
                .unwrap();
            if let Err(e) = db
                .put(
                    &key,
                    json::to_vec(&vec![schema]).unwrap().into(),
                    NO_NEED_WATCH,
                    Some(start_dt),
                )
                .await
            {
                return Err(e.into());
            }
        }
        log::info!(
            "[Schema:Migration]: Done creating row per version of schema: {}",
            key
        );
        if let Err(e) = db.delete(&key, false, infra_db::NEED_WATCH, Some(0)).await {
            return Err(e.into());
        }
        log::info!("[Schema:Migration]: Done migrating schema: {}", key);
    }

    Ok(())
}

async fn upgrade_trigger() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    log::info!("[Trigger:Migration]: Migrating triggers");
    let db_key_prefix = "/trigger/".to_string();
    log::info!("[Trigger:Migration]: Listing all triggers");
    let data = db.list(&db_key_prefix).await?;
    for (key, val) in data {
        let db_key = key;
        let key = db_key.strip_prefix(&db_key_prefix).unwrap();
        log::info!("[Trigger:Migration]: Start migrating trigger: {}", key);
        let (org_id, module_key) = match key.split_once('/') {
            Some(columns) => columns,
            None => {
                // Corrupted data, delete the trigger
                _ = db.delete(&db_key, false, infra_db::NEED_WATCH, None).await;
                continue;
            }
        };
        let data: json::Value = json::from_slice(&val).unwrap();
        let data = data.as_object().unwrap();
        scheduler::push(scheduler::Trigger {
            org: org_id.to_string(),
            module: scheduler::TriggerModule::Alert,
            module_key: module_key.to_string(),
            next_run_at: data.get("next_run_at").unwrap().as_i64().unwrap(),
            is_realtime: data.get("is_realtime").unwrap().as_bool().unwrap(),
            is_silenced: data.get("is_silenced").unwrap().as_bool().unwrap(),
            status: scheduler::TriggerStatus::Waiting,
            ..Default::default()
        })
        .await?;
        log::info!("[Schema:Migration]: Done migrating trigger: {}", key);
    }

    Ok(())
}

async fn upgrade_schema_row_per_version() -> Result<bool, anyhow::Error> {
    let db = infra_db::get_db().await;
    match db.get(SCHEMA_MIGRATION_KEY).await {
        std::result::Result::Ok(val) => {
            let val_str = std::str::from_utf8(&val).unwrap();
            let val = val_str.parse::<i64>().unwrap_or(0);
            if val > 0 { Ok(false) } else { Ok(true) }
        }
        Err(_) => Ok(true),
    }
}

/// Migrate alerts, reports, templates, destination names with ofga compatible format
pub async fn migrate_resource_names() -> Result<(), anyhow::Error> {
    let locker = infra::dist_lock::lock(META_MIGRATION_VERSION_KEY, 0, None).await?;
    match need_meta_resource_name_migration().await {
        Ok(true) => {
            log::info!("Starting migration of unsupported resource names");
        }
        Ok(false) => {
            log::info!("Resource name migration already done");
            dist_lock::unlock(&locker).await?;
            return Ok(());
        }
        Err(e) => {
            log::error!("Error when checking migration version");
            dist_lock::unlock(&locker).await?;
            return Err(e);
        }
    }

    if let Err(e) = migrate_alert_template_names().await {
        dist_lock::unlock(&locker).await?;
        return Err(e);
    }
    if let Err(e) = migrate_alert_destination_names().await {
        dist_lock::unlock(&locker).await?;
        return Err(e);
    }
    if let Err(e) = migrate_alert_names().await {
        dist_lock::unlock(&locker).await?;
        return Err(e);
    }
    if let Err(e) = migrate_report_names().await {
        dist_lock::unlock(&locker).await?;
        return Err(e);
    }

    // set migration status
    let db = infra_db::get_db().await;
    if let Err(e) = db
        .put(
            META_MIGRATION_VERSION_KEY,
            VERSION.to_string().into(),
            NO_NEED_WATCH,
            None,
        )
        .await
    {
        // unlock the lock
        dist_lock::unlock(&locker).await?;
        return Err(e.into());
    }

    // unlock the lock
    dist_lock::unlock(&locker).await?;
    Ok(())
}

async fn need_meta_resource_name_migration() -> Result<bool, anyhow::Error> {
    let db = infra_db::get_db().await;
    match db.get(META_MIGRATION_VERSION_KEY).await {
        std::result::Result::Ok(_val) => {
            // Key is present meaning the migration is done
            Ok(false)
        }
        Err(e) => {
            if let Error::DbError(DbError::KeyNotExists(_)) = e {
                Ok(true)
            } else {
                Err(anyhow::anyhow!("Error checking migration version: {e}"))
            }
        }
    }
}

async fn migrate_report_names() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    log::info!("[Report:Migration]: Migrating reports");
    let db_key_prefix = "/reports/".to_string();
    log::info!("[Report:Migration]: Listing all reports");
    let data = db.list(&db_key_prefix).await?;
    #[cfg(feature = "enterprise")]
    let mut write_tuples = vec![];
    for (key, val) in data {
        let db_key = key;
        let key = db_key.strip_prefix(&db_key_prefix).unwrap();
        log::info!("[Report:Migration]: Start migrating report: {}", key);
        let keys: Vec<&str> = key.split('/').collect();
        let report_name = keys[keys.len() - 1];
        if is_ofga_unsupported(report_name) && keys.len() == 2 {
            let mut report: Report = json::from_slice(&val).unwrap();
            report.name = into_ofga_supported_format(report_name);
            #[cfg(feature = "enterprise")]
            get_ownership_tuple(keys[0], "reports", &report.name, &mut write_tuples);
            // First create an report copy with formatted report name
            match db::dashboards::reports::set(keys[0], &report, true).await {
                // Delete report with unsupported report name
                Ok(_) => {
                    if let Err(e) = db::dashboards::reports::delete(keys[0], report_name).await {
                        log::error!(
                            "[Report:Migration]: Error deleting report with unsupported report name: {report_name}: {e}"
                        );
                    }
                }
                Err(e) => {
                    log::error!(
                        "[Report:Migration]: error updating unsupported report name {report_name}: {e}"
                    );
                }
            }
        }
        log::info!("[Report:Migration]: Done migrating report: {}", key);
    }
    #[cfg(feature = "enterprise")]
    if !write_tuples.is_empty() && get_o2_config().openfga.enabled {
        add_init_ofga_tuples(write_tuples).await;
    }
    Ok(())
}

async fn migrate_alert_template_names() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    log::info!("[Template:Migration]: Migrating templates");
    let db_key_prefix = "/templates/".to_string();
    log::info!("[Template:Migration]: Listing all templates");
    let data = db.list(&db_key_prefix).await?;
    #[cfg(feature = "enterprise")]
    let mut write_tuples = vec![];
    for (key, val) in data {
        let db_key = key;
        let key = db_key.strip_prefix(&db_key_prefix).unwrap();
        log::info!("[Template:Migration]: Start migrating template: {}", key);
        let keys: Vec<&str> = key.split('/').collect();
        let temp_name = keys[keys.len() - 1];
        if is_ofga_unsupported(temp_name) && keys.len() == 2 {
            let mut temp: Template = json::from_slice(&val).unwrap();
            temp.name = into_ofga_supported_format(temp_name);
            #[cfg(feature = "enterprise")]
            get_ownership_tuple(keys[0], "templates", &temp.name, &mut write_tuples);
            // First create an alert copy with formatted template name
            match db::alerts::templates::set(keys[0], &mut temp).await {
                // Delete template with unsupported template name
                Ok(_) => {
                    if let Err(e) = db::alerts::templates::delete(keys[0], temp_name).await {
                        log::error!(
                            "[Template:Migration]: Error deleting unsupported template name {temp_name}: {e}"
                        );
                    }
                }
                Err(e) => {
                    log::error!(
                        "[Template:Migration]: Error updating unsupported template name {temp_name}: {e}"
                    );
                }
            }
        }
        log::info!("[Template:Migration]: Done migrating template: {}", key);
    }
    #[cfg(feature = "enterprise")]
    if !write_tuples.is_empty() && get_o2_config().openfga.enabled {
        add_init_ofga_tuples(write_tuples).await;
    }
    Ok(())
}

async fn migrate_alert_destination_names() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    log::info!("[Destination:Migration]: Migrating destinations");
    let db_key_prefix = "/destinations/".to_string();
    log::info!("[Destination:Migration]: Listing all destinations");
    let data = db.list(&db_key_prefix).await?;
    #[cfg(feature = "enterprise")]
    let mut write_tuples = vec![];
    for (key, val) in data {
        let db_key = key;
        let key = db_key.strip_prefix(&db_key_prefix).unwrap();
        log::info!(
            "[Destination:Migration]: Start migrating destination: {}",
            key
        );
        let keys: Vec<&str> = key.split('/').collect();
        let dest_name = keys[keys.len() - 1];
        let mut dest: Destination = json::from_slice(&val).unwrap();
        let mut need_update = false;
        let mut create = false;
        if is_ofga_unsupported(dest_name) && keys.len() == 2 {
            dest.name = into_ofga_supported_format(dest_name);
            #[cfg(feature = "enterprise")]
            get_ownership_tuple(keys[0], "destinations", &dest.name, &mut write_tuples);
            need_update = true;
            create = true;
        }
        if is_ofga_unsupported(&dest.template) {
            dest.template = into_ofga_supported_format(&dest.template);
            need_update = true;
        }

        if need_update {
            // Create a new destination copy with formatted destination name
            match db::alerts::destinations::set(keys[0], &dest).await {
                // Delete destination with unsupported destination name
                Ok(_) => {
                    // New destination created, delete the old one
                    if create {
                        if let Err(e) = db::alerts::destinations::delete(keys[0], dest_name).await {
                            log::error!(
                                "Destination:Migration]: Error updating unsupported destination name {dest_name}: {e}"
                            );
                        }
                    }
                }
                Err(e) => {
                    log::error!(
                        "[Destination:Migration]: Error updating unsupported destination name {dest_name}: {e}"
                    );
                }
            }
        }
        log::info!(
            "[Destination:Migration]: Done migrating destination: {}",
            key
        );
    }
    #[cfg(feature = "enterprise")]
    if !write_tuples.is_empty() && get_o2_config().openfga.enabled {
        add_init_ofga_tuples(write_tuples).await;
    }
    Ok(())
}

async fn migrate_alert_names() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    log::info!("[Alert:Migration]: Migrating alerts");
    let db_key_prefix = "/alerts/".to_string();
    log::info!("[Alert:Migration]: Listing all alerts");
    let data = db.list(&db_key_prefix).await?;
    #[cfg(feature = "enterprise")]
    let mut write_tuples = vec![];
    for (key, val) in data {
        let db_key = key;
        let key = db_key.strip_prefix(&db_key_prefix).unwrap();
        log::info!("[Alert:Migration]: Start migrating alert: {}", key);
        let keys: Vec<&str> = key.split('/').collect();
        let alert_name = keys[keys.len() - 1];
        let mut need_update = false;
        let mut create = false;
        let mut alert: Alert = match json::from_slice(&val) {
            Ok(alert) => alert,
            Err(_) => {
                log::error!("[Alert:Migration]: Failed to deserialize alert {alert_name}");
                continue;
            }
        };
        if is_ofga_unsupported(alert_name) && keys.len() == 4 {
            alert.name = into_ofga_supported_format(alert_name);
            #[cfg(feature = "enterprise")]
            {
                get_ownership_tuple(keys[0], "alerts", &alert.name, &mut write_tuples);
            }
            need_update = true;
            create = true;
        }

        let mut destinations = vec![];
        for dest in alert.destinations.iter() {
            if is_ofga_unsupported(dest) {
                need_update = true;
            }
            destinations.push(into_ofga_supported_format(dest));
        }

        if need_update {
            // Format the associated destinations as well. In case there were some errors while
            // formatting destination names in the last migration, this destinations list contain
            // wrong destination names which don't exist. This needs to be manually resolved by
            // updating the destinations of the alert.
            alert.destinations = destinations;
            // First create an alert copy with formatted alert name
            match db::alerts::alert::set(
                keys[0],
                StreamType::from(keys[1]),
                keys[2],
                &alert,
                create,
            )
            .await
            {
                // Delete alert with unsupported alert name
                Ok(_) => {
                    if create
                        && db::alerts::alert::delete(
                            keys[0],
                            StreamType::from(keys[1]),
                            keys[2],
                            alert_name,
                        )
                        .await
                        .is_err()
                    {
                        log::error!(
                            "[Alert:Migration]: Error deleting alerts with unsupported alert name: {alert_name}"
                        );
                    }
                }
                Err(e) => {
                    log::error!(
                        "[Alert:Migration]: Error updating unsupported alert name {alert_name}: {e}"
                    );
                }
            }
        }
        log::info!("[Alert:Migration]: Done migrating alert: {}", key);
    }

    #[cfg(feature = "enterprise")]
    if !write_tuples.is_empty() && get_o2_config().openfga.enabled {
        add_init_ofga_tuples(write_tuples).await;
    }
    Ok(())
}
