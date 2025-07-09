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

use std::collections::HashSet;

use config::meta::folder::DEFAULT_FOLDER;
use o2_openfga::{authorizer, config::get_config as get_ofga_config, meta::mapping::OFGA_MODELS};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};

pub async fn migrate_alert_folders<C: ConnectionTrait>(db: &C) -> Result<(), anyhow::Error> {
    log::info!("Migrating alert folders");
    if !get_ofga_config().enabled {
        return Ok(());
    }

    // Migrate pages of 100 records at a time to avoid loading too many
    // records into memory.
    let mut len = 0;
    let mut alert_pages = alerts::Entity::find()
        .order_by_asc(alerts::Column::Id)
        .paginate(db, 100);

    // First migrate the alert folders of every organizations
    let mut folder_pages = folders::Entity::find()
        .filter(folders::Column::Type.eq(1))
        .order_by_asc(folders::Column::Id)
        .paginate(db, 100);

    let alert_folders_ofga_type = OFGA_MODELS.get("alert_folders").unwrap().key;
    let alerts_ofga_type = OFGA_MODELS.get("alerts").unwrap().key;

    while let Some(folders) = folder_pages.fetch_and_next().await? {
        let folders_len = folders.len();
        len += folders_len;
        log::debug!("Processing {folders_len} records");
        for folder in folders {
            log::debug!(
                "Processing record -> id: {}, org: {}",
                folder.id,
                folder.org,
            );
            let org_id = folder.org;
            let folder_id = folder.folder_id;
            let obj_str = format!("{alert_folders_ofga_type}:{folder_id}");
            authorizer::authz::set_ownership(&org_id, &obj_str, "", "").await;
        }
    }
    log::info!("Processed {len} folders for ofga migrations");

    // Next migrate all the alerts of every organizations
    len = 0;

    let mut orgs = HashSet::new();
    while let Some(alerts) = alert_pages.fetch_and_next().await? {
        let alerts_len = alerts.len();
        len += alerts_len;
        log::debug!("Processing {alerts_len} records");
        let mut tuples = vec![];
        for alert in alerts {
            let org_id = alert.org;
            orgs.insert(org_id.clone());
            // Use the alert id
            let alert_id = alert.id;
            // All the alerts are in the default folder only
            let alert_folder_id = DEFAULT_FOLDER;
            let object =
                authorizer::authz::get_ownership_tuple(&org_id, "alerts", &alert_id, &mut tuples);
            authorizer::authz::get_parent_tuple(
                alert_folder_id,
                alert_folders_ofga_type,
                &object,
                &mut tuples,
            );
        }
        if !tuples.is_empty() {
            match authorizer::authz::update_tuples(tuples, vec![]).await {
                Ok(_) => {
                    log::debug!("{alerts_len} alerts migrated to openfga");
                }
                Err(e) => {
                    log::error!("Error migrating alerts in openfga: {e}");
                }
            }
        }
    }

    log::info!("Processed {len} alerts for ofga migrations");

    // 1. Get all the roles for every org
    for org in orgs.iter() {
        let roles = match authorizer::roles::get_all_roles(org, None).await {
            Ok(roles) => roles,
            Err(e) => {
                log::error!("Error openfga getting roles for org: {e}");
                continue;
            }
        };
        // 2. Get all the alerts assigned to the roles
        for role in roles.iter() {
            let mut add_roles = vec![];
            let alerts =
                match authorizer::roles::get_role_permissions(org, role, alerts_ofga_type).await {
                    Ok(alerts) => alerts,
                    Err(e) => {
                        log::error!("Error openfga getting alerts for role: {e}");
                        continue;
                    }
                };
            // 3. Add the role assignment tuples for the alerts
            for alert in alerts.iter() {
                // Get the alert id from the alert name
                // TODO: Optimize this workflow

                let alert_name = match alert.object.split(':').next_back() {
                    Some(alert_name) => alert_name,
                    None => {
                        log::error!("Error openfga getting alert id from alert name");
                        continue;
                    }
                };
                if alert_name.starts_with("_all_") {
                    let mut alert = alert.clone();
                    alert.object = format!("{alert_folders_ofga_type}:{alert_name}");
                    add_roles.push(alert);
                    continue;
                }

                // Get the alert id from the alert name.
                // There could be multiple alerts with the same name.
                // Since we don't have a way to uniquely identify the alert,
                // we are using all the alerts with the same name.
                // TODO: Think of a better solution if possible.
                let db_alerts = alerts::Entity::find()
                    .filter(alerts::Column::Name.eq(alert_name))
                    .filter(alerts::Column::Org.eq(org))
                    .all(db)
                    .await?;

                for db_alert in db_alerts {
                    let mut alert = alert.clone();
                    alert.object = format!("{alerts_ofga_type}:{}", db_alert.id);
                    add_roles.push(alert);
                }
            }
            if !add_roles.is_empty() {
                let add_roles_len = add_roles.len();
                match authorizer::roles::update_role(org, role, add_roles, vec![], None, None).await
                {
                    Ok(_) => {
                        log::debug!("{add_roles_len} roles added to openfga");
                    }
                    Err(e) => {
                        log::error!("Error adding roles in openfga: {e}");
                    }
                }
            }
        }
    }

    Ok(())
}

/// Representation of the meta table at the time this migration executes.
mod alerts {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "alerts")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub org: String,
        pub folder_id: String,
        pub name: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

mod folders {

    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "folders")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub org: String,
        pub folder_id: String,
        pub name: String,
        pub r#type: i16,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
