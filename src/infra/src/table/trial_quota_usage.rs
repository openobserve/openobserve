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

use sea_orm::{
    ColumnTrait, EntityTrait, QueryFilter, QuerySelect,
    sea_query::{Expr, Func, OnConflict},
};

use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    table::entity::trial_quota_usage,
};

/// Batch increment quota records by delta. Each tuple is (org_id, feature, delta).
/// Upserts: if the row exists, adds delta to usage_count; otherwise inserts with
/// usage_count = delta. Uses sea_orm's on_conflict for atomic upserts.
pub async fn batch_increment(records: Vec<(String, String, i64)>) -> Result<(), sea_orm::DbErr> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = config::utils::time::now_micros();

    for (org_id, feature, delta) in records {
        let active_model = trial_quota_usage::ActiveModel {
            org_id: sea_orm::ActiveValue::Set(org_id),
            feature: sea_orm::ActiveValue::Set(feature),
            usage_count: sea_orm::ActiveValue::Set(delta),
            updated_at: sea_orm::ActiveValue::Set(now),
            notified_checkpoint: sea_orm::ActiveValue::Set(0),
        };

        trial_quota_usage::Entity::insert(active_model)
            .on_conflict(
                OnConflict::columns([
                    trial_quota_usage::Column::OrgId,
                    trial_quota_usage::Column::Feature,
                ])
                .value(
                    trial_quota_usage::Column::UsageCount,
                    Expr::col(trial_quota_usage::Column::UsageCount).add(delta),
                )
                .value(
                    trial_quota_usage::Column::UpdatedAt,
                    Expr::value(now),
                )
                .to_owned(),
            )
            .exec(db)
            .await?;
    }
    Ok(())
}

/// Load all quota records (all features, all orgs).
/// Called once on node startup to populate the in-memory DashMap.
pub async fn load_all() -> Result<Vec<trial_quota_usage::Model>, sea_orm::DbErr> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    trial_quota_usage::Entity::find().all(db).await
}

/// Get total usage across all features for an org (sum of usage_count).
/// Note: PostgreSQL SUM(bigint) returns NUMERIC, so we cast to BIGINT for Rust i64 compat.
pub async fn get_total_usage_for_org(org_id: &str) -> Result<i64, sea_orm::DbErr> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let result: Option<Option<i64>> = trial_quota_usage::Entity::find()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .select_only()
        .column_as(
            Expr::expr(Func::cast_as(
                trial_quota_usage::Column::UsageCount.sum(),
                sea_orm::sea_query::Alias::new("BIGINT"),
            )),
            "total_usage",
        )
        .into_tuple()
        .one(db)
        .await?;
    Ok(result.flatten().unwrap_or(0))
}

/// Get quota record for a specific org and feature.
/// Used by the usage API endpoint.
pub async fn get_for_org_feature(
    org_id: &str,
    feature: &str,
) -> Result<Option<trial_quota_usage::Model>, sea_orm::DbErr> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    trial_quota_usage::Entity::find()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .filter(trial_quota_usage::Column::Feature.eq(feature))
        .one(db)
        .await
}

/// Get the highest notified checkpoint for an org (across all feature rows).
pub async fn get_notified_checkpoint(org_id: &str) -> Result<i16, sea_orm::DbErr> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let result = trial_quota_usage::Entity::find()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .column_as(
            trial_quota_usage::Column::NotifiedCheckpoint.max(),
            "max_checkpoint",
        )
        .into_tuple::<Option<i16>>()
        .one(db)
        .await?;
    Ok(result.flatten().unwrap_or(0))
}

/// Atomically update the notified checkpoint for an org.
/// Only updates rows where the current checkpoint is lower (prevents duplicates
/// across pods).
pub async fn update_notified_checkpoint(
    org_id: &str,
    checkpoint: i16,
) -> Result<bool, sea_orm::DbErr> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let result = trial_quota_usage::Entity::update_many()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .filter(trial_quota_usage::Column::NotifiedCheckpoint.lt(checkpoint))
        .col_expr(
            trial_quota_usage::Column::NotifiedCheckpoint,
            sea_orm::sea_query::Expr::value(checkpoint),
        )
        .exec(db)
        .await?;
    // If rows_affected > 0, this pod won the update (no other pod set it first)
    Ok(result.rows_affected > 0)
}

/// Load all notified checkpoints (one per org, max across features).
pub async fn load_all_checkpoints() -> Result<Vec<(String, i16)>, sea_orm::DbErr> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let results: Vec<(String, Option<i16>)> = trial_quota_usage::Entity::find()
        .select_only()
        .column(trial_quota_usage::Column::OrgId)
        .column_as(
            trial_quota_usage::Column::NotifiedCheckpoint.max(),
            "max_checkpoint",
        )
        .group_by(trial_quota_usage::Column::OrgId)
        .into_tuple()
        .all(db)
        .await?;
    Ok(results
        .into_iter()
        .map(|(org_id, cp)| (org_id, cp.unwrap_or(0)))
        .filter(|(_, cp)| *cp > 0)
        .collect())
}
