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

use o2_openfga::{authorizer, config::get_config as get_ofga_config};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};

/// Backfills the `selfParent` tuple (folder -> org blanket) for every
/// synthetic folder that already existed before folder creation started
/// writing that link. Existing folders already have `owningOrg` from when
/// they were created; `set_ownership()` is idempotent, so re-running it here
/// just adds the missing `selfParent` tuple, letting a Type-level "Synthetic
/// Folders" role grant cascade to individual checks in these folders, same
/// as newly created ones.
pub async fn migrate_synthetic_folders<C: ConnectionTrait>(db: &C) -> Result<(), anyhow::Error> {
    log::info!("Migrating synthetic folders");
    if !get_ofga_config().enabled {
        return Ok(());
    }

    let mut len = 0;
    let mut folder_pages = folders::Entity::find()
        .filter(folders::Column::Type.eq(3)) // FolderType::Synthetics = 3
        .order_by_asc(folders::Column::Id)
        .paginate(db, 100);

    while let Some(page) = folder_pages.fetch_and_next().await? {
        len += page.len();
        log::debug!("Processing {} synthetic folder records", page.len());
        for folder in page {
            log::debug!(
                "Processing synthetic folder -> id: {}, org: {}",
                folder.id,
                folder.org,
            );
            let obj = format!("synthetic_folder:{}", folder.folder_id);
            authorizer::authz::set_ownership(&folder.org, &obj, "", "").await;
        }
    }
    log::info!("Processed {len} synthetic folders for ofga migrations");

    Ok(())
}

/// Representation of the meta table at the time this migration executes.
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
