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

//! Per-org alert calibration config: one row per org, keyed by a stable id the scheduler can use.

use config::{ider, utils::time::now_micros};
use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, sea_query::OnConflict,
};

use super::entity::alert_calibration_configs::{ActiveModel, Column, Entity, Model};
use crate::errors::{DbError, Error};

pub const DEFAULT_FREQUENCY_MINUTES: i32 = 1440;
pub const DEFAULT_WINDOW_MINUTES: i32 = 43200;

/// A partial config write; `None` keeps the stored value, or the default on the org's first write.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ConfigPatch {
    pub enabled: Option<bool>,
    pub frequency_minutes: Option<i32>,
    pub window_minutes: Option<i32>,
}

/// Scoped by org, so a config id from another org never resolves here.
pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find_by_id(id)
        .filter(Column::Org.eq(org))
        .one(conn)
        .await?)
}

pub async fn get_by_org<C: ConnectionTrait>(conn: &C, org: &str) -> Result<Option<Model>, Error> {
    Ok(Entity::find().filter(Column::Org.eq(org)).one(conn).await?)
}

/// One `ON CONFLICT (org)` statement, so two nodes cannot race a read-then-write.
pub async fn patch_config<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    patch: ConfigPatch,
) -> Result<Model, Error> {
    write_config(conn, org, patch, now_micros()).await
}

pub async fn delete_by_org<C: ConnectionTrait>(conn: &C, org: &str) -> Result<(), Error> {
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(conn)
        .await?;
    Ok(())
}

async fn write_config<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    patch: ConfigPatch,
    now: i64,
) -> Result<Model, Error> {
    upsert_statement(org, &patch, now)
        .exec_without_returning(conn)
        .await?;
    get_by_org(conn, org).await?.ok_or_else(|| {
        Error::DbError(DbError::SeaORMError(
            "alert_calibration config disappeared between its upsert and its read-back".to_string(),
        ))
    })
}

fn upsert_statement(org: &str, patch: &ConfigPatch, now: i64) -> sea_orm::Insert<ActiveModel> {
    let row = ActiveModel {
        id: Set(ider::uuid()),
        org: Set(org.to_string()),
        enabled: Set(patch.enabled.unwrap_or(false)),
        frequency_minutes: Set(patch.frequency_minutes.unwrap_or(DEFAULT_FREQUENCY_MINUTES)),
        window_minutes: Set(patch.window_minutes.unwrap_or(DEFAULT_WINDOW_MINUTES)),
        created_at: Set(now),
        updated_at: Set(now),
    };
    // On conflict only what the patch set moves; the row's id and created_at never do.
    let updated = [
        (patch.enabled.is_some(), Column::Enabled),
        (patch.frequency_minutes.is_some(), Column::FrequencyMinutes),
        (patch.window_minutes.is_some(), Column::WindowMinutes),
        (true, Column::UpdatedAt),
    ]
    .into_iter()
    .filter_map(|(set, column)| set.then_some(column));
    Entity::insert(row).on_conflict(
        // mysql ignores this target and fires on any unique key, which is the same key here.
        OnConflict::column(Column::Org)
            .update_columns(updated)
            .to_owned(),
    )
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection, PaginatorTrait};

    use super::*;
    use crate::table::migration::create_alert_calibration_configs_for_test;

    const ORG: &str = "acme";
    const OTHER_ORG: &str = "globex";
    const NOW: i64 = 1_757_004_000_000_000;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_alert_calibration_configs_for_test(&db)
            .await
            .unwrap();
        db
    }

    fn full(enabled: bool, frequency_minutes: i32, window_minutes: i32) -> ConfigPatch {
        ConfigPatch {
            enabled: Some(enabled),
            frequency_minutes: Some(frequency_minutes),
            window_minutes: Some(window_minutes),
        }
    }

    #[tokio::test]
    async fn a_first_write_takes_the_defaults_for_what_it_leaves_unset() {
        let db = db().await;
        let row = patch_config(
            &db,
            ORG,
            ConfigPatch {
                enabled: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(row.enabled);
        assert_eq!(row.frequency_minutes, DEFAULT_FREQUENCY_MINUTES);
        assert_eq!(row.window_minutes, DEFAULT_WINDOW_MINUTES);
        assert_eq!(row.id.len(), 27);
    }

    #[tokio::test]
    async fn a_patch_moves_only_the_fields_it_sets() {
        let cases = [
            (
                ConfigPatch {
                    enabled: Some(false),
                    ..Default::default()
                },
                (false, 30, 60),
            ),
            (
                ConfigPatch {
                    frequency_minutes: Some(5),
                    ..Default::default()
                },
                (true, 5, 60),
            ),
            (
                ConfigPatch {
                    window_minutes: Some(90),
                    ..Default::default()
                },
                (true, 30, 90),
            ),
            (ConfigPatch::default(), (true, 30, 60)),
        ];
        for (patch, (enabled, frequency_minutes, window_minutes)) in cases {
            let db = db().await;
            let seeded = patch_config(&db, ORG, full(true, 30, 60)).await.unwrap();
            let row = patch_config(&db, ORG, patch.clone()).await.unwrap();
            assert_eq!(
                (row.enabled, row.frequency_minutes, row.window_minutes),
                (enabled, frequency_minutes, window_minutes),
                "{patch:?}"
            );
            assert_eq!(row.id, seeded.id, "{patch:?} gave the row a new identity");
            assert_eq!(Entity::find().count(&db).await.unwrap(), 1);
        }
    }

    #[tokio::test]
    async fn an_update_keeps_created_at_and_moves_updated_at() {
        let db = db().await;
        write_config(&db, ORG, full(true, 30, 60), NOW)
            .await
            .unwrap();
        let row = write_config(&db, ORG, full(false, 30, 60), NOW + 1)
            .await
            .unwrap();
        assert_eq!((row.created_at, row.updated_at), (NOW, NOW + 1));
    }

    #[tokio::test]
    async fn reads_are_scoped_to_the_org() {
        let db = db().await;
        assert!(get_by_org(&db, ORG).await.unwrap().is_none());
        let row = patch_config(&db, ORG, full(true, 30, 60)).await.unwrap();
        assert_eq!(
            get_by_id(&db, ORG, &row.id).await.unwrap(),
            Some(row.clone())
        );
        assert_eq!(get_by_id(&db, OTHER_ORG, &row.id).await.unwrap(), None);
        assert!(get_by_org(&db, OTHER_ORG).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_by_org_removes_only_that_org() {
        let db = db().await;
        patch_config(&db, ORG, full(true, 30, 60)).await.unwrap();
        let kept = patch_config(&db, OTHER_ORG, full(true, 30, 60))
            .await
            .unwrap();
        delete_by_org(&db, ORG).await.unwrap();
        assert!(get_by_org(&db, ORG).await.unwrap().is_none());
        assert_eq!(get_by_org(&db, OTHER_ORG).await.unwrap(), Some(kept));
        // A recreated org starts from the defaults, not from the deleted org's settings.
        let fresh = patch_config(&db, ORG, ConfigPatch::default())
            .await
            .unwrap();
        assert!(!fresh.enabled);
    }
}
