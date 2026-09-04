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

use std::collections::HashSet;

use o2_openfga::{authorizer, config::get_config as get_ofga_config, meta::mapping::OFGA_MODELS};
use sea_orm::{ConnectionTrait, EntityTrait, PaginatorTrait, QueryOrder};

/// Migrate anomaly detection configs into OpenFGA.
///
/// Anomaly detection configs reuse the alert OFGA types (`alert` / `afolder`).
/// Configs created before RBAC was wired do not have ownership tuples, so this
/// migration walks the `anomaly_detection_config` table and creates them.
///
/// For each config:
/// - Resolves the folder PK (`folder_id`) → folder name via the `folders` table.
/// - Creates the `alert:{anomaly_id}` ownership tuple, parented to `afolder:{folder_name}`.
pub async fn migrate_anomaly_detection<C: ConnectionTrait>(db: &C) -> Result<(), anyhow::Error> {
    log::info!("Migrating anomaly detection configs");
    if !get_ofga_config().enabled {
        return Ok(());
    }

    let alert_folders_ofga_type = OFGA_MODELS.get("alert_folders").unwrap().key;
    let alerts_ofga_type = OFGA_MODELS.get("alerts").unwrap().key;

    let mut len = 0;
    let mut orgs: HashSet<String> = HashSet::new();

    let mut config_pages = anomaly_config::Entity::find()
        .order_by_asc(anomaly_config::Column::AnomalyId)
        .paginate(db, 100);

    while let Some(page) = config_pages.fetch_and_next().await? {
        let page_len = page.len();
        len += page_len;
        log::debug!("Processing {page_len} anomaly detection configs");
        let mut tuples = vec![];
        for config in page {
            log::debug!(
                "Processing anomaly config -> id: {}, org: {}",
                config.anomaly_id,
                config.org_id,
            );
            orgs.insert(config.org_id.clone());

            // Resolve folder PK → folder name for OFGA.
            let folder_name = match folders::Entity::find_by_id(&config.folder_id)
                .one(db)
                .await?
            {
                Some(f) => f.folder_id,
                None => {
                    log::warn!(
                        "Folder PK {} not found for anomaly config {}, skipping",
                        config.folder_id,
                        config.anomaly_id
                    );
                    continue;
                }
            };

            let object = authorizer::authz::get_ownership_tuple(
                &config.org_id,
                "alerts",
                &config.anomaly_id,
                &mut tuples,
            );
            authorizer::authz::get_parent_tuple(
                &folder_name,
                alert_folders_ofga_type,
                &object,
                &mut tuples,
            );
        }
        if !tuples.is_empty() {
            match authorizer::authz::update_tuples(tuples, vec![]).await {
                Ok(_) => {
                    log::debug!("{page_len} anomaly configs migrated to openfga");
                }
                Err(e) => {
                    log::error!("Error migrating anomaly configs in openfga: {e}");
                }
            }
        }
    }

    log::info!("Processed {len} anomaly detection configs for ofga migrations");

    // Migrate org-level role assignments: alert:_all_<org_id>  →  afolder:_all_<org_id>
    // (same logic as the alert_folders migration — anomaly configs share the alert type)
    for org in orgs.iter() {
        let roles = match authorizer::roles::get_all_roles(org, None).await {
            Ok(roles) => roles,
            Err(e) => {
                log::error!("Error getting openfga roles for org {org}: {e}");
                continue;
            }
        };

        for role in roles.iter() {
            let mut add_roles = vec![];

            let alert_perms =
                match authorizer::roles::get_role_permissions(org, role, alerts_ofga_type).await {
                    Ok(perms) => perms,
                    Err(e) => {
                        log::error!("Error getting openfga alert permissions for role {role}: {e}");
                        continue;
                    }
                };

            for perm in alert_perms.iter() {
                let entity = match perm.object.split(':').next_back() {
                    Some(e) => e,
                    None => {
                        log::error!("Unexpected openfga object format (no ':'): {}", perm.object);
                        continue;
                    }
                };

                // Only migrate the org-level wildcard; skip individual alerts.
                if entity.starts_with("_all_") {
                    let mut new_perm = perm.clone();
                    new_perm.object = format!("{alert_folders_ofga_type}:{entity}");
                    add_roles.push(new_perm);
                }
            }

            if !add_roles.is_empty() {
                let count = add_roles.len();
                match authorizer::roles::update_role(org, role, add_roles, vec![], None, None).await
                {
                    Ok(_) => {
                        log::debug!(
                            "{count} alert-folder role tuples added for role {role} in org {org}"
                        );
                    }
                    Err(e) => {
                        log::error!("Error adding alert-folder role tuples for role {role}: {e}");
                    }
                }
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Local entity definitions — snapshots of the relevant DB tables at the time
// this migration executes.
// ---------------------------------------------------------------------------

mod anomaly_config {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "anomaly_detection_config")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub anomaly_id: String,
        pub org_id: String,
        pub folder_id: String,
        pub name: String,
        pub owner: Option<String>,
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
