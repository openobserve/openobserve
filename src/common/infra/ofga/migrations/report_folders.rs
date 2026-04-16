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
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};

/// Migrate report-folder permissions in OpenFGA.
///
/// This migration does three things:
///
/// 1. Establishes ownership tuples for every report folder that exists in the
///    database, so that the `rfolder` type is properly represented in OpenFGA.
///
/// 2. For every existing report, establishes a `parent` relation between
///    `report:{report_id}` and `rfolder:{folder_id}`.  Before this migration
///    all reports lived in the default folder, so this effectively links every
///    report to `rfolder:default`.
///
/// 3. For every role in every organisation: replaces the org-level
///    `report:_all_<org_id>` permission with the equivalent
///    `rfolder:_all_<org_id>` permission.  Individual
///    `report:<report_name>` role permissions are intentionally left alone.
pub async fn migrate_report_folders<C: ConnectionTrait>(db: &C) -> Result<(), anyhow::Error> {
    log::info!("Migrating report folders");
    if !get_ofga_config().enabled {
        return Ok(());
    }

    let report_folders_ofga_type = OFGA_MODELS.get("report_folders").unwrap().key;
    let reports_ofga_type = OFGA_MODELS.get("reports").unwrap().key;

    // ------------------------------------------------------------------
    // 1. Establish ownership for every report folder (folder type = 2).
    // ------------------------------------------------------------------
    let mut folder_len = 0;
    let mut orgs: HashSet<String> = HashSet::new();

    let mut folder_pages = folders::Entity::find()
        .filter(folders::Column::Type.eq(2)) // FolderType::Reports = 2
        .order_by_asc(folders::Column::Id)
        .paginate(db, 100);

    while let Some(page) = folder_pages.fetch_and_next().await? {
        folder_len += page.len();
        log::debug!("Processing {} report folder records", page.len());
        for folder in page {
            log::debug!(
                "Processing report folder -> id: {}, org: {}",
                folder.id,
                folder.org,
            );
            orgs.insert(folder.org.clone());
            let obj_str = format!("{report_folders_ofga_type}:{}", folder.folder_id);
            authorizer::authz::set_ownership(&folder.org, &obj_str, "", "").await;
        }
    }
    log::info!("Processed {folder_len} report folders for ofga migrations");

    // ------------------------------------------------------------------
    // 2. For every existing report, add a parent relation to its folder.
    //    Before this migration all reports were in the default folder, so
    //    folder_id will almost always be "default".
    // ------------------------------------------------------------------
    let mut report_len = 0;

    let mut report_pages = reports::Entity::find()
        .order_by_asc(reports::Column::Id)
        .paginate(db, 100);

    while let Some(page) = report_pages.fetch_and_next().await? {
        report_len += page.len();
        log::debug!("Processing {} report records", page.len());
        let mut tuples = vec![];
        for report in page {
            orgs.insert(report.org.clone());
            let object = authorizer::authz::get_ownership_tuple(
                &report.org,
                "reports",
                &report.id,
                &mut tuples,
            );
            authorizer::authz::get_parent_tuple(
                &report.folder_id,
                report_folders_ofga_type,
                &object,
                &mut tuples,
            );
        }
        if !tuples.is_empty() {
            match authorizer::authz::update_tuples(tuples, vec![]).await {
                Ok(_) => {
                    log::debug!("{report_len} reports migrated to openfga");
                }
                Err(e) => {
                    log::error!("Error migrating reports in openfga: {e}");
                }
            }
        }
    }
    log::info!("Processed {report_len} reports for ofga migrations");

    // ------------------------------------------------------------------
    // 3. Migrate org-level role assignments:
    //    report:_all_<org_id>  →  rfolder:_all_<org_id>
    //
    // Individual report:<name> role tuples are intentionally skipped.
    // ------------------------------------------------------------------
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

            let report_perms = match authorizer::roles::get_role_permissions(
                org,
                role,
                reports_ofga_type,
            )
            .await
            {
                Ok(perms) => perms,
                Err(e) => {
                    log::error!("Error getting openfga report permissions for role {role}: {e}");
                    continue;
                }
            };

            for perm in report_perms.iter() {
                // Object is of the form  "report:<entity>"
                let entity = match perm.object.split(':').next_back() {
                    Some(e) => e,
                    None => {
                        log::error!(
                            "Unexpected openfga object format (no ':'): {}",
                            perm.object
                        );
                        continue;
                    }
                };

                // Only migrate the org-level wildcard; skip individual reports.
                if entity.starts_with("_all_") {
                    let mut new_perm = perm.clone();
                    new_perm.object = format!("{report_folders_ofga_type}:{entity}");
                    add_roles.push(new_perm);
                }
            }

            if !add_roles.is_empty() {
                let count = add_roles.len();
                match authorizer::roles::update_role(org, role, add_roles, vec![], None, None)
                    .await
                {
                    Ok(_) => {
                        log::debug!(
                            "{count} report-folder role tuples added for role {role} in org {org}"
                        );
                    }
                    Err(e) => {
                        log::error!(
                            "Error adding report-folder role tuples for role {role}: {e}"
                        );
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

mod reports {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "reports")]
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
