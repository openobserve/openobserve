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

use o2_openfga::{authorizer, config::get_config as get_ofga_config};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QuerySelect,
};

use crate::common::utils::auth::{into_ofga_supported_format, is_ofga_unsupported};

/// Backfill OpenFGA ownership tuples for streams whose names contain characters
/// that OpenFGA object ids cannot represent (e.g. metric names with `:`).
///
/// OpenFGA objects are `type:id`, so an id like `k8s:container:cpu` is rejected
/// and the ownership tuple written at ingestion time never landed. Auth checks
/// now sanitize the stream name via [`into_ofga_supported_format`] before
/// looking it up (`k8s.container.cpu`), so those streams need a matching
/// ownership tuple written under the sanitized id — otherwise no non-root user
/// can ever be granted access to them.
///
/// This migration walks every stream schema in the `meta` table (`module =
/// "schema"`, key `/schema/{org}/{stream_type}/{stream_name}`) and, for each
/// stream whose name is not OpenFGA-safe, writes an `{ofga_type}:{sanitized}`
/// ownership tuple owned by its org. Writes are idempotent (OpenFGA ignores
/// duplicates), so re-running is safe.
pub async fn migrate_stream_names<C: ConnectionTrait>(db: &C) -> Result<(), anyhow::Error> {
    log::info!("Migrating stream names with colon to openfga supported name format");
    if !get_ofga_config().enabled {
        return Ok(());
    }

    let mut len = 0;
    // Dedupe across schema history: a stream can have many `meta` rows (one per
    // schema version / start_dt), but they all map to the same ownership tuple.
    let mut seen: HashSet<String> = HashSet::new();

    // Only pull the key columns — schema `value` blobs can be large and we never
    // need them here.
    let mut schema_pages = schema_meta::Entity::find()
        .filter(schema_meta::Column::Module.eq("schema"))
        .select_only()
        .column(schema_meta::Column::Key1)
        .column(schema_meta::Column::Key2)
        .into_tuple::<(String, String)>()
        .paginate(db, 1000);

    let mut tuples = vec![];
    while let Some(page) = schema_pages.fetch_and_next().await? {
        for (org_id, key2) in page {
            // key2 is `{stream_type}/{stream_name}`; the stream name is
            // everything after the first `/` (names may themselves contain `/`).
            let Some((stream_type, stream_name)) = key2.split_once('/') else {
                log::warn!("Unexpected schema key format (no '/'): {}/{}", org_id, key2);
                continue;
            };

            if !is_ofga_unsupported(stream_name) {
                continue;
            }

            let sanitized = into_ofga_supported_format(stream_name);
            let dedupe_key = format!("{}/{}/{}", org_id, stream_type, sanitized);
            if !seen.insert(dedupe_key) {
                continue;
            }

            log::debug!(
                "Migrating stream ownership tuple -> org: {}, type: {}, name: {} -> {}",
                org_id,
                stream_type,
                stream_name,
                sanitized
            );
            authorizer::authz::get_ownership_tuple(&org_id, stream_type, &sanitized, &mut tuples);
            len += 1;
        }

        // Flush per page to keep the tuple buffer bounded.
        if !tuples.is_empty() {
            let batch = std::mem::take(&mut tuples);
            match authorizer::authz::update_tuples(batch, vec![]).await {
                Ok(_) => log::debug!("Stream name ownership tuples migrated to openfga"),
                Err(e) => log::error!("Error migrating stream name tuples to openfga: {e}"),
            }
        }
    }

    log::info!("Processed {len} stream(s) with unsupported names for ofga migration");

    Ok(())
}

// ---------------------------------------------------------------------------
// Local entity definitions — snapshots of the relevant DB tables at the time
// this migration executes.
// ---------------------------------------------------------------------------

/// Representation of the `meta` table. Stream schemas are stored here under
/// `module = "schema"` with `key1 = org_id` and `key2 = "{stream_type}/{stream_name}"`.
mod schema_meta {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "meta")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub module: String,
        pub key1: String,
        pub key2: String,
        pub start_dt: i64,
        pub value: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
