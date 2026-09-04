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
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QuerySelect, TransactionTrait,
    sea_query::{Expr, Func, OnConflict},
};

use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::entity::trial_quota_usage,
};

/// Batch increment quota records by delta. Each tuple is (org_id, feature, delta).
/// Upserts: if the row exists, adds delta to usage_count; otherwise inserts with
/// usage_count = delta. Uses sea_orm's on_conflict for atomic upserts.
pub async fn batch_increment(records: Vec<(String, String, i64)>) -> Result<(), sea_orm::DbErr> {
    if records.is_empty() {
        return Ok(());
    }
    let db = get_orm_client_rw().await;
    // one transaction for the whole batch so the write lock is held for a
    // single commit instead of one autocommit round-trip per record
    let txn = db.begin().await?;
    let now = config::utils::time::now_micros();

    for (org_id, feature, delta) in records {
        let active_model = trial_quota_usage::ActiveModel {
            org_id: sea_orm::ActiveValue::Set(org_id),
            feature: sea_orm::ActiveValue::Set(feature),
            usage_count: sea_orm::ActiveValue::Set(delta),
            usage_limit: sea_orm::ActiveValue::NotSet,
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
                    Expr::col((
                        trial_quota_usage::Entity,
                        trial_quota_usage::Column::UsageCount,
                    ))
                    .add(delta),
                )
                .value(trial_quota_usage::Column::UpdatedAt, Expr::value(now))
                .to_owned(),
            )
            .exec(&txn)
            .await?;
    }
    txn.commit().await?;
    Ok(())
}

/// Load all quota records (all features, all orgs).
/// Called once on node startup to populate the in-memory DashMap.
pub async fn load_all() -> Result<Vec<trial_quota_usage::Model>, sea_orm::DbErr> {
    let db = get_orm_client_ro().await;
    trial_quota_usage::Entity::find().all(db).await
}

/// Total usage for an org across the given pool's feature rows. `features`
/// scopes the sum to ONE pool, or synthetics steps report as AI credits used.
///
/// Note: PostgreSQL SUM(bigint) returns NUMERIC, so we cast to BIGINT for Rust i64 compat.
pub async fn get_total_usage_for_org(
    org_id: &str,
    features: &[&str],
) -> Result<i64, sea_orm::DbErr> {
    let db = get_orm_client_ro().await;
    let result: Option<Option<i64>> = trial_quota_usage::Entity::find()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .filter(trial_quota_usage::Column::Feature.is_in(features.iter().copied()))
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

/// Get the explicitly configured shared usage limit for an organization.
/// A missing value means the deployment-wide default still applies.
pub async fn get_usage_limit_for_org(org_id: &str) -> Result<Option<i64>, sea_orm::DbErr> {
    let db = get_orm_client_ro().await;
    let result = trial_quota_usage::Entity::find()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .select_only()
        .column_as(trial_quota_usage::Column::UsageLimit.max(), "usage_limit")
        .into_tuple::<Option<i64>>()
        .one(db)
        .await?;
    Ok(result.flatten())
}

/// Every explicit `(org_id, feature, usage_limit)` triple — per FEATURE, not a
/// per-org maximum: `MAX(usage_limit) GROUP BY org_id` would let a raised AI
/// credit limit silently raise the one-time synthetics grant.
pub async fn load_all_usage_limits() -> Result<Vec<(String, String, i64)>, sea_orm::DbErr> {
    let db = get_orm_client_ro().await;
    let results: Vec<(String, String, Option<i64>)> = trial_quota_usage::Entity::find()
        .select_only()
        .column(trial_quota_usage::Column::OrgId)
        .column(trial_quota_usage::Column::Feature)
        .column(trial_quota_usage::Column::UsageLimit)
        .filter(trial_quota_usage::Column::UsageLimit.is_not_null())
        .into_tuple()
        .all(db)
        .await?;
    Ok(results
        .into_iter()
        .filter_map(|(org_id, feature, limit)| limit.map(|limit| (org_id, feature, limit)))
        .collect())
}

/// Set one limit on every feature row of ONE POOL for an organization.
/// `seed_feature` is upserted first so orgs with no prior usage can be
/// configured; `features` bounds the `UPDATE` so the two pools stay independent.
pub async fn set_usage_limit_for_org(
    org_id: &str,
    seed_feature: &str,
    features: &[&str],
    usage_limit: i64,
) -> Result<(), sea_orm::DbErr> {
    let db = get_orm_client_rw().await;
    let txn = db.begin().await?;
    let now = config::utils::time::now_micros();
    let active_model = trial_quota_usage::ActiveModel {
        org_id: sea_orm::ActiveValue::Set(org_id.to_string()),
        feature: sea_orm::ActiveValue::Set(seed_feature.to_string()),
        usage_count: sea_orm::ActiveValue::Set(0),
        usage_limit: sea_orm::ActiveValue::Set(Some(usage_limit)),
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
                trial_quota_usage::Column::UsageLimit,
                Expr::value(usage_limit),
            )
            .value(trial_quota_usage::Column::UpdatedAt, Expr::value(now))
            .to_owned(),
        )
        .exec(&txn)
        .await?;

    trial_quota_usage::Entity::update_many()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .filter(trial_quota_usage::Column::Feature.is_in(features.iter().copied()))
        .col_expr(
            trial_quota_usage::Column::UsageLimit,
            Expr::value(usage_limit),
        )
        .col_expr(trial_quota_usage::Column::UpdatedAt, Expr::value(now))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

/// Get quota record for a specific org and feature.
/// Used by the usage API endpoint.
pub async fn get_for_org_feature(
    org_id: &str,
    feature: &str,
) -> Result<Option<trial_quota_usage::Model>, sea_orm::DbErr> {
    let db = get_orm_client_ro().await;
    trial_quota_usage::Entity::find()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .filter(trial_quota_usage::Column::Feature.eq(feature))
        .one(db)
        .await
}

/// Get the highest notified checkpoint for an org (across all feature rows).
pub async fn get_notified_checkpoint(org_id: &str) -> Result<i16, sea_orm::DbErr> {
    let db = get_orm_client_ro().await;
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
    let db = get_orm_client_rw().await;
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

pub async fn reset_notified_checkpoint(org_id: &str) -> Result<(), sea_orm::DbErr> {
    let db = get_orm_client_rw().await;
    trial_quota_usage::Entity::update_many()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .col_expr(
            trial_quota_usage::Column::NotifiedCheckpoint,
            Expr::value(0),
        )
        .exec(db)
        .await?;
    Ok(())
}

/// Load all notified checkpoints (one per org, max across features).
pub async fn load_all_checkpoints() -> Result<Vec<(String, i16)>, sea_orm::DbErr> {
    let db = get_orm_client_ro().await;
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

/// Deletes all trial quota usage entries for the given org.
pub async fn delete_by_org(org_id: &str) -> Result<(), sea_orm::DbErr> {
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
    let db = get_orm_client_rw().await;
    trial_quota_usage::Entity::delete_many()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .exec(db)
        .await?;
    Ok(())
}

/// One batched read of several orgs' counters, for the features of one pool set.
///
/// Both filters early-return on an empty slice: `is_in(&[])` is not a reliable
/// "match nothing" here, and degrading to an unfiltered read would hand the
/// caller the whole table.
pub async fn get_for_orgs<C: ConnectionTrait>(
    conn: &C,
    org_ids: &[String],
    features: &[&str],
) -> Result<Vec<trial_quota_usage::Model>, sea_orm::DbErr> {
    if org_ids.is_empty() || features.is_empty() {
        return Ok(Vec::new());
    }
    trial_quota_usage::Entity::find()
        .filter(trial_quota_usage::Column::OrgId.is_in(org_ids.iter().map(String::as_str)))
        .filter(trial_quota_usage::Column::Feature.is_in(features.iter().copied()))
        .all(conn)
        .await
}

#[cfg(test)]
mod tests {
    use sea_orm::{
        ActiveModelTrait, ActiveValue, ConnectOptions, ConnectionTrait, Database,
        DatabaseConnection, Schema,
    };

    use super::*;

    const AI: &str = "ai_chat";
    const BROWSER: &str = "synthetics_browser_steps";
    const PROTOCOL: &str = "synthetics_protocol_steps";
    const SYNTHETICS: &[&str] = &[BROWSER, PROTOCOL];

    /// One connection, not a pool: two connections to `sqlite::memory:` are two databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        db.execute(backend.build(&schema.create_table_from_entity(trial_quota_usage::Entity)))
            .await
            .unwrap();
        db
    }

    async fn seed(db: &DatabaseConnection, org_id: &str, feature: &str, usage_count: i64) {
        trial_quota_usage::ActiveModel {
            org_id: ActiveValue::Set(org_id.to_string()),
            feature: ActiveValue::Set(feature.to_string()),
            usage_count: ActiveValue::Set(usage_count),
            usage_limit: ActiveValue::Set(None),
            updated_at: ActiveValue::Set(0),
            notified_checkpoint: ActiveValue::Set(0),
        }
        .insert(db)
        .await
        .unwrap();
    }

    fn pairs(rows: &[trial_quota_usage::Model]) -> Vec<(String, String, i64)> {
        let mut out: Vec<(String, String, i64)> = rows
            .iter()
            .map(|r| (r.org_id.clone(), r.feature.clone(), r.usage_count))
            .collect();
        out.sort();
        out
    }

    /// A leaked org or a leaked feature is a grant spent against the wrong pool.
    #[tokio::test]
    async fn get_for_orgs_returns_only_requested_orgs_and_features() {
        let db = db().await;
        seed(&db, "acme", BROWSER, 100).await;
        seed(&db, "acme", PROTOCOL, 200).await;
        seed(&db, "acme", AI, 5).await;
        seed(&db, "beta", BROWSER, 7).await;
        seed(&db, "gamma", BROWSER, 9).await;

        let orgs = vec!["acme".to_string(), "beta".to_string()];
        let rows = get_for_orgs(&db, &orgs, SYNTHETICS).await.unwrap();
        assert_eq!(
            pairs(&rows),
            vec![
                ("acme".to_string(), BROWSER.to_string(), 100),
                ("acme".to_string(), PROTOCOL.to_string(), 200),
                ("beta".to_string(), BROWSER.to_string(), 7),
            ],
            "an unrequested org or an AI-credit row must never reach the synthetics gate",
        );

        let rows = get_for_orgs(&db, &orgs, &[BROWSER]).await.unwrap();
        assert_eq!(
            pairs(&rows),
            vec![
                ("acme".to_string(), BROWSER.to_string(), 100),
                ("beta".to_string(), BROWSER.to_string(), 7),
            ],
        );

        assert!(
            get_for_orgs(&db, &[], SYNTHETICS).await.unwrap().is_empty(),
            "a tick that claimed nothing must not read the whole table",
        );
    }
}
