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

//! Migrate workflow-folder permissions in OpenFGA.
//!
//! Three phases:
//!
//! 1. Ownership for every workflow folder, so the `workflow_folder` type is represented.
//!
//! 2. A `parent` relation from each workflow to the folder its row names.
//!
//! 3. For every role in every org, the org-level `workflows:_all_<org>` grant is *copied* to
//!    `workflow_folder:_all_<org>`. Permission now flows through `parent`, so a grant left only on
//!    the item type would stop authorizing anything. Individual `workflows:<id>` grants are left
//!    alone — they keep resolving through `selfContext`.
//!
//! Nothing is ever removed, so an interrupted run over-grants briefly rather than locking anyone
//! out of workflows they could previously see.

use std::collections::{HashMap, HashSet};

use config::meta::folder::DEFAULT_FOLDER;
use o2_openfga::{authorizer, config::get_config as get_ofga_config, meta::mapping::OFGA_MODELS};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};

/// Folder type discriminator for workflows in the `folders` table.
const WORKFLOWS_FOLDER_TYPE: i16 = 4;

pub async fn migrate_workflow_folders<C: ConnectionTrait>(db: &C) -> Result<(), anyhow::Error> {
    log::info!("Migrating workflow folders");
    if !get_ofga_config().enabled {
        return Ok(());
    }

    let mut orgs: HashSet<String> = HashSet::new();
    // Maps a folder's primary key to its slug: rows store the key, tuples name
    // the slug.
    let mut folder_slugs: HashMap<String, String> = HashMap::new();

    // 1. Ownership for every workflow folder.
    let mut folder_len = 0;
    let mut folder_pages = folders::Entity::find()
        .filter(folders::Column::Type.eq(WORKFLOWS_FOLDER_TYPE))
        .order_by_asc(folders::Column::Id)
        .paginate(db, 100);

    while let Some(page) = folder_pages.fetch_and_next().await? {
        folder_len += page.len();
        let mut tuples = vec![];
        let mut seen: HashSet<(String, String)> = HashSet::new();
        for folder in page {
            orgs.insert(folder.org.clone());
            folder_slugs.insert(folder.id.clone(), folder.folder_id.clone());
            if seen.insert((folder.folder_id.clone(), folder.org.clone())) {
                authorizer::authz::get_ownership_tuple(
                    &folder.org,
                    "workflow_folder",
                    &folder.folder_id,
                    &mut tuples,
                );
            }
        }
        if !tuples.is_empty()
            && let Err(e) = authorizer::authz::update_tuples(tuples, vec![]).await
        {
            log::error!("Error migrating workflow folders in openfga: {e}");
        }
    }
    log::info!("Processed {folder_len} workflow folders for ofga migrations");

    let workflow_folders_type = OFGA_MODELS
        .get("workflow_folder")
        .map_or("workflow_folder", |m| m.key);
    let workflows_type = OFGA_MODELS.get("workflows").map_or("workflows", |m| m.key);

    // 2. Parent relation for every workflow.
    let mut workflow_len = 0;
    let mut workflow_pages = workflows::Entity::find()
        .order_by_asc(workflows::Column::Id)
        .paginate(db, 100);

    while let Some(page) = workflow_pages.fetch_and_next().await? {
        workflow_len += page.len();
        let mut tuples = vec![];
        for workflow in page {
            orgs.insert(workflow.org_id.clone());
            let object = authorizer::authz::get_ownership_tuple(
                &workflow.org_id,
                "workflows",
                &workflow.id,
                &mut tuples,
            );
            // Point at the folder the row actually names. Assuming "default"
            // holds only if the OFGA migration runs in the same startup as the
            // column backfill; when OpenFGA is enabled later the workflows have
            // already been organised, and a hardcoded default would both grant
            // the wrong folder's roles and leave a second stale parent behind.
            let slug = folder_slugs
                .get(&workflow.folder_id)
                .map(|s| s.as_str())
                .unwrap_or(DEFAULT_FOLDER);
            authorizer::authz::get_parent_tuple(slug, workflow_folders_type, &object, &mut tuples);
        }
        if !tuples.is_empty()
            && let Err(e) = authorizer::authz::update_tuples(tuples, vec![]).await
        {
            log::error!("Error migrating workflows in openfga: {e}");
        }
    }
    log::info!("Processed {workflow_len} workflows for ofga migrations");

    // 3. Copy org-level grants onto the folder type.
    for org in orgs.iter() {
        let roles = match authorizer::roles::get_all_roles(org, None).await {
            Ok(roles) => roles,
            Err(e) => {
                log::error!("Error getting openfga roles for org {org}: {e}");
                continue;
            }
        };

        for role in roles.iter() {
            let workflow_perms =
                match authorizer::roles::get_role_permissions(org, role, workflows_type).await {
                    Ok(perms) => perms,
                    Err(e) => {
                        log::error!("Error getting openfga workflow permissions for {role}: {e}");
                        continue;
                    }
                };

            let mut add_roles = vec![];
            for perm in workflow_perms.iter() {
                let Some(entity) = perm.object.split(':').next_back() else {
                    log::error!("Unexpected openfga object format: {}", perm.object);
                    continue;
                };
                // Only the org-level wildcard moves; individual grants still
                // resolve through selfContext.
                if entity.starts_with("_all_") {
                    let mut new_perm = perm.clone();
                    new_perm.object = format!("{workflow_folders_type}:{entity}");
                    add_roles.push(new_perm);
                }
            }

            if !add_roles.is_empty() {
                let count = add_roles.len();
                match authorizer::roles::update_role(org, role, add_roles, vec![], None, None).await
                {
                    Ok(_) => log::debug!(
                        "{count} workflow-folder role tuples added for role {role} in org {org}"
                    ),
                    Err(e) => {
                        log::error!("Error adding workflow-folder role tuples for {role}: {e}")
                    }
                }
            }
        }
    }

    Ok(())
}

// Snapshots of the tables as they exist when this migration runs, so a later
// schema change cannot retroactively break it.

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

mod workflows {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "workflows")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub org_id: String,
        pub folder_id: String,
        pub name: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
