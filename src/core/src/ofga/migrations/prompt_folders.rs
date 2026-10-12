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

//! Migrate prompt-folder permissions in OpenFGA.
//!
//! Three phases:
//!
//! 1. Ownership for every prompt folder, so the `pfolder` type is represented.
//!
//! 2. A `parent` relation from each prompt to the folder it lives in.
//!
//! 3. For every role in every org, the org-level `prompt:_all_<org>` grant is *copied* to
//!    `pfolder:_all_<org>`. Listing and creating prompts is now authorized on the folder, so a
//!    grant left only on the item type would stop authorizing either. Individual `prompt:<id>`
//!    grants are left alone — the prompt routes still check the prompt itself.
//!
//! Nothing is ever removed, so an interrupted run over-grants briefly rather than locking anyone
//! out of prompts they could previously see.

use std::collections::{HashMap, HashSet};

use o2_openfga::{authorizer, config::get_config as get_ofga_config, meta::mapping::OFGA_MODELS};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};

/// Folder type discriminator for prompts in the `folders` table.
const PROMPTS_FOLDER_TYPE: i16 = 5;

pub async fn migrate_prompt_folders<C: ConnectionTrait>(db: &C) -> Result<(), anyhow::Error> {
    log::info!("Migrating prompt folders");
    if !get_ofga_config().enabled {
        return Ok(());
    }

    let mut orgs: HashSet<String> = HashSet::new();
    // Prompt rows store the folder's primary key, but tuples name folders by slug.
    let mut folder_slugs: HashMap<String, String> = HashMap::new();

    // 1. Ownership for every prompt folder.
    let mut folder_pages = folders::Entity::find()
        .filter(folders::Column::Type.eq(PROMPTS_FOLDER_TYPE))
        .order_by_asc(folders::Column::Id)
        .paginate(db, 100);

    while let Some(page) = folder_pages.fetch_and_next().await? {
        let mut tuples = vec![];
        for folder in page {
            orgs.insert(folder.org.clone());
            authorizer::authz::get_ownership_tuple(
                &folder.org,
                "prompt_folders",
                &folder.folder_id,
                &mut tuples,
            );
            folder_slugs.insert(folder.id, folder.folder_id);
        }
        if !tuples.is_empty()
            && let Err(e) = authorizer::authz::update_tuples(tuples, vec![]).await
        {
            log::error!("Error migrating prompt folders in openfga: {e}");
        }
    }
    log::info!(
        "Processed {} prompt folders for ofga migrations",
        folder_slugs.len()
    );

    let prompt_folders_type = OFGA_MODELS
        .get("prompt_folders")
        .map_or("pfolder", |m| m.key);
    let prompts_type = OFGA_MODELS.get("prompts").map_or("prompt", |m| m.key);

    // 2. Parent relation for every prompt.
    let mut prompt_len = 0;
    let mut prompt_pages = llm_prompts::Entity::find()
        .order_by_asc(llm_prompts::Column::EntityId)
        .paginate(db, 100);

    while let Some(page) = prompt_pages.fetch_and_next().await? {
        prompt_len += page.len();
        let mut tuples = vec![];
        for prompt in page {
            orgs.insert(prompt.org_id.clone());
            let object = authorizer::authz::get_ownership_tuple(
                &prompt.org_id,
                "prompts",
                &prompt.entity_id,
                &mut tuples,
            );
            let Some(folder_slug) = folder_slugs.get(&prompt.folder_id) else {
                log::error!(
                    "Prompt {} points at unknown folder {}",
                    prompt.entity_id,
                    prompt.folder_id
                );
                continue;
            };
            authorizer::authz::get_parent_tuple(
                folder_slug,
                prompt_folders_type,
                &object,
                &mut tuples,
            );
        }
        if !tuples.is_empty()
            && let Err(e) = authorizer::authz::update_tuples(tuples, vec![]).await
        {
            log::error!("Error migrating prompts in openfga: {e}");
        }
    }
    log::info!("Processed {prompt_len} prompts for ofga migrations");

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
            let prompt_perms =
                match authorizer::roles::get_role_permissions(org, role, prompts_type).await {
                    Ok(perms) => perms,
                    Err(e) => {
                        log::error!("Error getting openfga prompt permissions for {role}: {e}");
                        continue;
                    }
                };

            let mut add_roles = vec![];
            for perm in prompt_perms.iter() {
                let Some(entity) = perm.object.split(':').next_back() else {
                    log::error!("Unexpected openfga object format: {}", perm.object);
                    continue;
                };
                if entity.starts_with("_all_") {
                    let mut new_perm = perm.clone();
                    new_perm.object = format!("{prompt_folders_type}:{entity}");
                    add_roles.push(new_perm);
                }
            }

            if !add_roles.is_empty() {
                let count = add_roles.len();
                match authorizer::roles::update_role(org, role, add_roles, vec![], None, None).await
                {
                    Ok(_) => log::debug!(
                        "{count} prompt-folder role tuples added for role {role} in org {org}"
                    ),
                    Err(e) => {
                        log::error!("Error adding prompt-folder role tuples for {role}: {e}")
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

mod llm_prompts {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "llm_prompts")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub entity_id: String,
        pub org_id: String,
        pub name: String,
        pub folder_id: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
