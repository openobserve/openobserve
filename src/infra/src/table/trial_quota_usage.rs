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

use chrono::Datelike;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QuerySelect, TransactionTrait,
    sea_query::{CaseStatement, Expr, Func, OnConflict},
};

use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::entity::trial_quota_usage,
};

/// The `feature` key of the one MONTHLY synthetics allowance; every other key is lifetime.
pub const SYNTHETICS_STATUS_FEATURE: &str = "synthetics_status_protocol";

pub const SYNTHETICS_BROWSER_FEATURE: &str = "synthetics_browser_steps";
pub const SYNTHETICS_PROTOCOL_FEATURE: &str = "synthetics_protocol_steps";

/// One settled window's free steps per pool, and the `YYYYMM` its window STARTS in.
pub struct SyntheticsDeltas {
    pub browser: i64,
    pub protocol: i64,
    pub status: i64,
    pub month: i32,
}

/// Additively upsert one `(org_id, feature, delta)` triple per record.
pub async fn batch_increment(records: Vec<(String, String, i64)>) -> Result<(), sea_orm::DbErr> {
    // Ahead of `get_orm_client_rw`, which blocks on pool initialisation an idle tick never needs.
    if records.is_empty() {
        return Ok(());
    }
    batch_increment_in(get_orm_client_rw().await, records).await
}

/// [`batch_increment`] against a caller-supplied connection.
async fn batch_increment_in<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    records: Vec<(String, String, i64)>,
) -> Result<(), sea_orm::DbErr> {
    if records.is_empty() {
        return Ok(());
    }
    // One transaction for the whole batch: N autocommits take the write lock N times.
    let txn = conn.begin().await?;
    let now = config::utils::time::now_micros();

    for (org_id, feature, delta) in records {
        increment_lifetime_row(&txn, &org_id, &feature, delta, now).await?;
    }
    txn.commit().await
}

/// Load all quota records (all features, all orgs).
/// Called once on node startup to populate the in-memory DashMap.
pub async fn load_all() -> Result<Vec<trial_quota_usage::Model>, sea_orm::DbErr> {
    let db = get_orm_client_ro().await;
    trial_quota_usage::Entity::find().all(db).await
}

/// Total usage for an org across the given pool's feature rows. `features`
/// scopes the sum to ONE pool, or synthetics steps report as AI credits used;
/// `month` scopes it to one `YYYYMM`, or a monthly pool reports a stale month's spend.
pub async fn get_total_usage_for_org(
    org_id: &str,
    features: &[&str],
    month: Option<i32>,
) -> Result<i64, sea_orm::DbErr> {
    get_total_usage_for_org_in(get_orm_client_ro().await, org_id, features, month).await
}

/// [`get_total_usage_for_org`] against a caller-supplied connection.
///
/// Note: PostgreSQL SUM(bigint) returns NUMERIC, so we cast to BIGINT for Rust i64 compat.
async fn get_total_usage_for_org_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    features: &[&str],
    month: Option<i32>,
) -> Result<i64, sea_orm::DbErr> {
    let mut query = trial_quota_usage::Entity::find()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .filter(trial_quota_usage::Column::Feature.is_in(features.iter().copied()));
    if let Some(month) = month {
        query = query.filter(trial_quota_usage::Column::Period.eq(month));
    }
    let result: Option<Option<i64>> = query
        .select_only()
        .column_as(
            Expr::expr(Func::cast_as(
                trial_quota_usage::Column::UsageCount.sum(),
                sea_orm::sea_query::Alias::new("BIGINT"),
            )),
            "total_usage",
        )
        .into_tuple()
        .one(conn)
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
    set_usage_limit_for_org_in(
        get_orm_client_rw().await,
        org_id,
        seed_feature,
        features,
        usage_limit,
    )
    .await
}

/// [`set_usage_limit_for_org`] against a caller-supplied connection.
async fn set_usage_limit_for_org_in<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    seed_feature: &str,
    features: &[&str],
    usage_limit: i64,
) -> Result<(), sea_orm::DbErr> {
    // Spec §7.4: a crash between the seed and the fan-out leaves the pool on two limits.
    let txn = conn.begin().await?;
    let now = config::utils::time::now_micros();
    let active_model = trial_quota_usage::ActiveModel {
        org_id: sea_orm::ActiveValue::Set(org_id.to_string()),
        feature: sea_orm::ActiveValue::Set(seed_feature.to_string()),
        usage_count: sea_orm::ActiveValue::Set(0),
        usage_limit: sea_orm::ActiveValue::Set(Some(usage_limit)),
        updated_at: sea_orm::ActiveValue::Set(now),
        notified_checkpoint: sea_orm::ActiveValue::Set(0),
        // A raised limit carries no month, and the entity schema has no column default.
        period: sea_orm::ActiveValue::Set(0),
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

    // `is_in(&[])` is not a reliable "match nothing": an unfiltered fan-out would raise the
    // limit on every row of the org, across pools.
    if !features.is_empty() {
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
    }
    txn.commit().await
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

/// Stamp ONE pool's notification watermark, and only where it rises; `features` bounds the
/// `UPDATE`, or one pool's notification silences every other pool the org has (spec §11.1).
pub async fn update_notified_checkpoint(
    org_id: &str,
    checkpoint: i16,
    features: &[&str],
) -> Result<bool, sea_orm::DbErr> {
    update_notified_checkpoint_in(get_orm_client_rw().await, org_id, checkpoint, features).await
}

/// [`update_notified_checkpoint`] against a caller-supplied connection.
async fn update_notified_checkpoint_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    checkpoint: i16,
    features: &[&str],
) -> Result<bool, sea_orm::DbErr> {
    // No keys, nothing to stamp: consistency with the siblings, not correctness.
    if features.is_empty() {
        return Ok(false);
    }
    let result = trial_quota_usage::Entity::update_many()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .filter(trial_quota_usage::Column::Feature.is_in(features.iter().copied()))
        .filter(trial_quota_usage::Column::NotifiedCheckpoint.lt(checkpoint))
        .col_expr(
            trial_quota_usage::Column::NotifiedCheckpoint,
            sea_orm::sea_query::Expr::value(checkpoint),
        )
        .exec(conn)
        .await?;
    // If rows_affected > 0, this pod won the update (no other pod set it first)
    Ok(result.rows_affected > 0)
}

/// Re-arm ONE pool's notification watermark; `features` bounds the `UPDATE`, or raising one
/// grant re-arms every other pool the org has (spec §11.1).
pub async fn reset_notified_checkpoint(
    org_id: &str,
    features: &[&str],
) -> Result<(), sea_orm::DbErr> {
    reset_notified_checkpoint_in(get_orm_client_rw().await, org_id, features).await
}

/// [`reset_notified_checkpoint`] against a caller-supplied connection.
async fn reset_notified_checkpoint_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    features: &[&str],
) -> Result<(), sea_orm::DbErr> {
    // No keys, nothing to clear: consistency with the siblings, not correctness.
    if features.is_empty() {
        return Ok(());
    }
    trial_quota_usage::Entity::update_many()
        .filter(trial_quota_usage::Column::OrgId.eq(org_id))
        .filter(trial_quota_usage::Column::Feature.is_in(features.iter().copied()))
        .col_expr(
            trial_quota_usage::Column::NotifiedCheckpoint,
            Expr::value(0),
        )
        .exec(conn)
        .await?;
    Ok(())
}

/// Each org's notified watermark for ONE pool; `features` bounds the `MAX`, or another pool's
/// watermark answers for this one and the org is never warned again (spec §11.1).
pub async fn load_all_checkpoints(features: &[&str]) -> Result<Vec<(String, i16)>, sea_orm::DbErr> {
    load_all_checkpoints_in(get_orm_client_ro().await, features).await
}

/// [`load_all_checkpoints`] against a caller-supplied connection.
async fn load_all_checkpoints_in<C: ConnectionTrait>(
    conn: &C,
    features: &[&str],
) -> Result<Vec<(String, i16)>, sea_orm::DbErr> {
    // No keys, nothing to read: consistency with the siblings, not correctness.
    if features.is_empty() {
        return Ok(Vec::new());
    }
    let results: Vec<(String, Option<i16>)> = trial_quota_usage::Entity::find()
        .select_only()
        .column(trial_quota_usage::Column::OrgId)
        .column_as(
            trial_quota_usage::Column::NotifiedCheckpoint.max(),
            "max_checkpoint",
        )
        .filter(trial_quota_usage::Column::Feature.is_in(features.iter().copied()))
        .group_by(trial_quota_usage::Column::OrgId)
        .into_tuple()
        .all(conn)
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

/// The ONE `YYYYMM` encoding, UTC: `period == month` holds only while every side uses it.
pub fn month_of(micros: i64) -> i32 {
    let at = chrono::DateTime::from_timestamp_micros(micros).unwrap_or_default();
    at.year() * 100 + at.month() as i32
}

/// Advance one org's synthetics counters — the CALLER wraps these in the offset's transaction.
pub async fn apply_synthetics_deltas_in<C: ConnectionTrait>(
    txn: &C,
    org_id: &str,
    deltas: &SyntheticsDeltas,
    now: i64,
) -> Result<(), sea_orm::DbErr> {
    for (feature, delta) in [
        (SYNTHETICS_BROWSER_FEATURE, deltas.browser),
        (SYNTHETICS_PROTOCOL_FEATURE, deltas.protocol),
    ] {
        // Write amplification: an org that never touched the pool must not acquire a row.
        if delta != 0 {
            increment_lifetime_row(txn, org_id, feature, delta, now).await?;
        }
    }
    if deltas.status != 0 {
        upsert_status_row(txn, org_id, deltas.status, deltas.month, now).await?;
    }
    Ok(())
}

/// The additive upsert of a LIFETIME pool: `period` is 0 on insert, untouched on conflict.
async fn increment_lifetime_row<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    feature: &str,
    delta: i64,
    now: i64,
) -> Result<(), sea_orm::DbErr> {
    let active_model = trial_quota_usage::ActiveModel {
        org_id: sea_orm::ActiveValue::Set(org_id.to_string()),
        feature: sea_orm::ActiveValue::Set(feature.to_string()),
        usage_count: sea_orm::ActiveValue::Set(delta),
        usage_limit: sea_orm::ActiveValue::NotSet,
        updated_at: sea_orm::ActiveValue::Set(now),
        notified_checkpoint: sea_orm::ActiveValue::Set(0),
        period: sea_orm::ActiveValue::Set(0),
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
        .exec(conn)
        .await?;
    Ok(())
}

/// Spec §7.3: the reset rides the increment, so no state adds this window then zeroes it.
async fn upsert_status_row<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    grant: i64,
    month: i32,
    now: i64,
) -> Result<(), sea_orm::DbErr> {
    let period = Expr::col((trial_quota_usage::Entity, trial_quota_usage::Column::Period));
    let stale = period.clone().lt(month);
    let usage_count = CaseStatement::new().case(stale.clone(), grant).finally(
        Expr::col((
            trial_quota_usage::Entity,
            trial_quota_usage::Column::UsageCount,
        ))
        .add(grant),
    );
    // Stands in for `GREATEST`, which SQLite lacks; `MAX(a, b)` is an aggregate on Postgres.
    let advance = CaseStatement::new().case(stale, month).finally(period);

    let active_model = trial_quota_usage::ActiveModel {
        org_id: sea_orm::ActiveValue::Set(org_id.to_string()),
        feature: sea_orm::ActiveValue::Set(SYNTHETICS_STATUS_FEATURE.to_string()),
        usage_count: sea_orm::ActiveValue::Set(grant),
        // Left unset so the deployment default applies until an admin overrides it.
        usage_limit: sea_orm::ActiveValue::NotSet,
        updated_at: sea_orm::ActiveValue::Set(now),
        notified_checkpoint: sea_orm::ActiveValue::Set(0),
        period: sea_orm::ActiveValue::Set(month),
    };

    trial_quota_usage::Entity::insert(active_model)
        .on_conflict(
            OnConflict::columns([
                trial_quota_usage::Column::OrgId,
                trial_quota_usage::Column::Feature,
            ])
            .value(trial_quota_usage::Column::UsageCount, usage_count)
            .value(trial_quota_usage::Column::Period, advance)
            .value(trial_quota_usage::Column::UpdatedAt, Expr::value(now))
            .to_owned(),
        )
        .exec(conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{
        ActiveModelTrait, ActiveValue, ConnectOptions, ConnectionTrait, Database, DatabaseBackend,
        DatabaseConnection, MockDatabase, MockExecResult, Schema, Transaction,
    };

    use super::*;

    const AI: &str = "ai_chat";
    const BROWSER: &str = "synthetics_browser_steps";
    const PROTOCOL: &str = "synthetics_protocol_steps";
    const STATUS: &str = SYNTHETICS_STATUS_FEATURE;
    const SYNTHETICS: &[&str] = &[BROWSER, PROTOCOL, STATUS];
    const AI_FEATURES: &[&str] = &[AI, "new_incident", "incident_reanalysis"];
    /// The pre-split key the protocol pool still counts into, so a reset must name it as well.
    const LEGACY_STEPS: &str = "synthetics_steps";
    const PROTOCOL_POOL: &[&str] = &[PROTOCOL, LEGACY_STEPS];

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
        seed_row(db, org_id, feature, usage_count, None, 0).await;
    }

    fn usage_row(
        org_id: &str,
        feature: &str,
        usage_count: i64,
        usage_limit: Option<i64>,
        period: i32,
        notified_checkpoint: i16,
    ) -> trial_quota_usage::ActiveModel {
        trial_quota_usage::ActiveModel {
            org_id: ActiveValue::Set(org_id.to_string()),
            feature: ActiveValue::Set(feature.to_string()),
            usage_count: ActiveValue::Set(usage_count),
            usage_limit: ActiveValue::Set(usage_limit),
            updated_at: ActiveValue::Set(0),
            notified_checkpoint: ActiveValue::Set(notified_checkpoint),
            period: ActiveValue::Set(period),
        }
    }

    async fn seed_row(
        db: &DatabaseConnection,
        org_id: &str,
        feature: &str,
        usage_count: i64,
        usage_limit: Option<i64>,
        period: i32,
    ) {
        usage_row(org_id, feature, usage_count, usage_limit, period, 0)
            .insert(db)
            .await
            .unwrap();
    }

    async fn seed_checkpoint(
        db: &DatabaseConnection,
        org_id: &str,
        feature: &str,
        notified_checkpoint: i16,
    ) {
        usage_row(org_id, feature, 0, None, 0, notified_checkpoint)
            .insert(db)
            .await
            .unwrap();
    }

    fn deltas(browser: i64, protocol: i64, status: i64, month: i32) -> SyntheticsDeltas {
        SyntheticsDeltas {
            browser,
            protocol,
            status,
            month,
        }
    }

    async fn apply(db: &DatabaseConnection, org_id: &str, d: SyntheticsDeltas, now: i64) {
        apply_synthetics_deltas_in(db, org_id, &d, now)
            .await
            .unwrap();
    }

    async fn row_of(
        db: &DatabaseConnection,
        org_id: &str,
        feature: &str,
    ) -> trial_quota_usage::Model {
        trial_quota_usage::Entity::find()
            .filter(trial_quota_usage::Column::OrgId.eq(org_id))
            .filter(trial_quota_usage::Column::Feature.eq(feature))
            .one(db)
            .await
            .unwrap()
            .expect("the upsert must leave a row behind")
    }

    /// `(usage_count, period)` — the pair the whole monthly design turns on.
    async fn counter(db: &DatabaseConnection, org_id: &str, feature: &str) -> (i64, i32) {
        let row = row_of(db, org_id, feature).await;
        (row.usage_count, row.period)
    }

    async fn checkpoint_of(db: &DatabaseConnection, org_id: &str, feature: &str) -> i16 {
        row_of(db, org_id, feature).await.notified_checkpoint
    }

    /// `period` rides along: a read that drops it lets October spend September's count.
    fn pairs(rows: &[trial_quota_usage::Model]) -> Vec<(String, String, i64, i32)> {
        let mut out: Vec<(String, String, i64, i32)> = rows
            .iter()
            .map(|r| (r.org_id.clone(), r.feature.clone(), r.usage_count, r.period))
            .collect();
        out.sort();
        out
    }

    /// CODE only: a comment naming what a scan forbids would trip that scan on its own text.
    fn code_only_source() -> String {
        include_str!("trial_quota_usage.rs")
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// The body of the first `fn name` defined in this file, up to its closing brace.
    fn fn_body<'a>(source: &'a str, name: &str) -> &'a str {
        let needle = format!("fn {name}");
        // `<` as well as `(`: a generic entry point is still the entry point, not a missing one.
        let at = source
            .match_indices(&needle)
            .find(|(at, _)| matches!(source[at + needle.len()..].chars().next(), Some('(' | '<')))
            .expect("the function must live in this file")
            .0;
        let body = &source[at..];
        let end = body.find("\n}\n").expect("end of the function");
        &body[..end]
    }

    /// The `_in` split is what these tests can reach, so the pub entry point must run it too.
    fn assert_entry_point_delegates(entry_point: &str, inner: &str) {
        let source = code_only_source();
        assert!(
            fn_body(&source, entry_point).contains(&format!("{inner}(")),
            "the write under test is not the one `{entry_point}` runs",
        );
    }

    fn mock_db(backend: DatabaseBackend, writes: usize) -> DatabaseConnection {
        MockDatabase::new(backend)
            .append_exec_results(vec![
                MockExecResult {
                    last_insert_id: 0,
                    rows_affected: 1,
                };
                writes
            ])
            .into_connection()
    }

    /// `ConnectionTrait` has no `begin`, so a wrapper that only forwards the pool autocommits.
    fn assert_one_transaction(log: &[Transaction], writes: usize, what: &str) {
        assert_eq!(log.len(), 1, "{what} must open ONE transaction: {log:?}");
        let sql: Vec<&str> = log[0].statements().iter().map(|s| s.sql.as_str()).collect();
        assert_eq!(sql.first().copied(), Some("BEGIN"), "{what}: {sql:?}");
        assert_eq!(sql.last().copied(), Some("COMMIT"), "{what}: {sql:?}");
        assert_eq!(
            sql.len() - 2,
            writes,
            "{what} must hold all {writes} writes inside that one transaction: {sql:?}",
        );
    }

    async fn has_no_row(db: &DatabaseConnection, org_id: &str, feature: &str) -> bool {
        trial_quota_usage::Entity::find()
            .filter(trial_quota_usage::Column::OrgId.eq(org_id))
            .filter(trial_quota_usage::Column::Feature.eq(feature))
            .one(db)
            .await
            .unwrap()
            .is_none()
    }

    async fn status_upsert_log(backend: DatabaseBackend) -> Vec<Transaction> {
        let db = mock_db(backend, 4);
        apply_synthetics_deltas_in(&db, "acme", &deltas(0, 0, 90, 202610), 5)
            .await
            .unwrap();
        db.into_transaction_log()
    }

    /// Every `period` literal below is a YYYYMM the metering side must derive from an instant,
    /// and `period == month` is true only while both sides encode it identically.
    #[test]
    fn month_of_encodes_the_utc_year_and_month() {
        let at = |rfc3339: &str| {
            chrono::DateTime::parse_from_rfc3339(rfc3339)
                .unwrap()
                .timestamp_micros()
        };

        // Spec §7.3: the window starting 30 Sep 23:10 is September's, 1 Oct 01:10 is October's.
        assert_eq!(month_of(at("2026-09-30T23:10:00Z")), 202609);
        assert_eq!(month_of(at("2026-10-01T01:10:00Z")), 202610);
        // UTC, not local: under any fixed offset one of these two lands in the wrong month.
        assert_eq!(month_of(at("2026-09-30T23:59:59.999999Z")), 202609);
        assert_eq!(month_of(at("2026-10-01T00:00:00Z")), 202610);
        // `year * 100 + month`, so a single-digit month is zero-padded, never `year * 12`.
        assert_eq!(month_of(at("2026-01-01T00:00:00Z")), 202601);
        assert_eq!(month_of(at("2026-12-31T23:59:59Z")), 202612);
        assert_eq!(month_of(at("2027-01-01T00:00:00Z")), 202701);
    }

    /// A leaked org or a leaked feature is a grant spent against the wrong pool.
    #[tokio::test]
    async fn get_for_orgs_returns_only_requested_orgs_and_features() {
        let db = db().await;
        seed(&db, "acme", BROWSER, 100).await;
        seed(&db, "acme", PROTOCOL, 200).await;
        seed(&db, "acme", AI, 5).await;
        seed_row(&db, "acme", STATUS, 12_480, None, 202609).await;
        seed(&db, "beta", BROWSER, 7).await;
        seed_row(&db, "beta", STATUS, 40, None, 202610).await;
        seed(&db, "gamma", BROWSER, 9).await;

        let orgs = vec!["acme".to_string(), "beta".to_string()];
        let rows = get_for_orgs(&db, &orgs, SYNTHETICS).await.unwrap();
        assert_eq!(
            pairs(&rows),
            vec![
                ("acme".to_string(), BROWSER.to_string(), 100, 0),
                ("acme".to_string(), PROTOCOL.to_string(), 200, 0),
                ("acme".to_string(), STATUS.to_string(), 12_480, 202609),
                ("beta".to_string(), BROWSER.to_string(), 7, 0),
                ("beta".to_string(), STATUS.to_string(), 40, 202610),
            ],
            "an unrequested org or an AI-credit row must never reach the synthetics gate, and a \
             period the read drops leaves the gate unable to tell a stale count from a live one",
        );

        let rows = get_for_orgs(&db, &orgs, &[BROWSER]).await.unwrap();
        assert_eq!(
            pairs(&rows),
            vec![
                ("acme".to_string(), BROWSER.to_string(), 100, 0),
                ("beta".to_string(), BROWSER.to_string(), 7, 0),
            ],
        );

        assert!(
            get_for_orgs(&db, &[], SYNTHETICS).await.unwrap().is_empty(),
            "a tick that claimed nothing must not read the whole table",
        );
    }

    /// Spec §7.3: the admin API reports `used` from this sum, so an unscoped one bills an org
    /// for a month it has already left.
    #[tokio::test]
    async fn the_total_is_scoped_to_the_month_when_one_is_given() {
        let db = db().await;
        seed_row(&db, "bigcorp", STATUS, 81_000, Some(150_000), 202609).await;
        seed(&db, "bigcorp", AI, 340).await;
        seed_row(&db, "acme", STATUS, 12_480, None, 202609).await;

        assert_eq!(
            get_total_usage_for_org_in(&db, "bigcorp", &[STATUS], Some(202610))
                .await
                .unwrap(),
            0,
            "September's row is unspent in October, or the admin API reports last month's spend",
        );
        assert_eq!(
            get_total_usage_for_org_in(&db, "bigcorp", &[STATUS], Some(202609))
                .await
                .unwrap(),
            81_000,
        );
        assert_eq!(
            get_total_usage_for_org_in(&db, "bigcorp", &[AI], None)
                .await
                .unwrap(),
            340,
            "a lifetime pool passes no month, and `period = 0` must not filter it out",
        );

        assert_entry_point_delegates("get_total_usage_for_org", "get_total_usage_for_org_in");
    }

    /// Spec §7.3, `30 Sep 23:10`.
    #[tokio::test]
    async fn status_upsert_adds_within_month() {
        let db = db().await;
        seed_row(&db, "acme", STATUS, 12_480, None, 202609).await;

        apply(&db, "acme", deltas(0, 0, 410, 202609), 77).await;

        assert_eq!(counter(&db, "acme", STATUS).await, (12_890, 202609));
        assert_eq!(row_of(&db, "acme", STATUS).await.updated_at, 77);
    }

    /// Spec §7.3, `1 Oct 01:10` — the reset and the first October increment are ONE write,
    /// so the row must hold this window's grant, never a zero another write has to fill.
    #[tokio::test]
    async fn status_upsert_resets_on_a_newer_month() {
        let db = db().await;
        seed_row(&db, "acme", STATUS, 12_890, None, 202609).await;

        apply(&db, "acme", deltas(0, 0, 90, 202610), 5).await;

        assert_eq!(
            counter(&db, "acme", STATUS).await,
            (90, 202610),
            "0 here means the reset dropped this window's steps; 12,980 means it never fired",
        );
        assert_eq!(row_of(&db, "acme", STATUS).await.updated_at, 5);
    }

    /// A September window settling after October already reset the row carries an OLDER month.
    #[tokio::test]
    async fn status_upsert_ignores_an_older_month() {
        let db = db().await;
        seed_row(&db, "acme", STATUS, 90, None, 202610).await;

        apply(&db, "acme", deltas(0, 0, 5, 202609), 5).await;

        assert_eq!(
            counter(&db, "acme", STATUS).await,
            (95, 202610),
            "a late replay that rewinds period re-opens October's grant a second time",
        );
    }

    /// Spec §7.5 ④ — a status check first attached in October must not read as a stale
    /// September row.
    #[tokio::test]
    async fn status_upsert_inserts_with_the_month() {
        let db = db().await;

        apply(&db, "acme", deltas(0, 0, 40, 202610), 5).await;

        assert_eq!(counter(&db, "acme", STATUS).await, (40, 202610));
        assert_eq!(row_of(&db, "acme", STATUS).await.updated_at, 5);
    }

    /// The override is the whole reason `period` is out of the primary key (spec §7.2).
    #[tokio::test]
    async fn status_upsert_never_touches_usage_limit() {
        let db = db().await;
        seed_row(&db, "bigcorp", STATUS, 81_000, Some(150_000), 202609).await;

        for (grant, month, expected) in [
            (1_200, 202609, (82_200, 202609)),
            (260, 202610, (260, 202610)),
            (5, 202609, (265, 202610)),
        ] {
            apply(&db, "bigcorp", deltas(0, 0, grant, month), 5).await;
            assert_eq!(counter(&db, "bigcorp", STATUS).await, expected);
            assert_eq!(
                row_of(&db, "bigcorp", STATUS).await.usage_limit,
                Some(150_000),
                "the override survives every reset, or an admin re-enters it every month",
            );
        }

        apply(&db, "acme", deltas(0, 0, 40, 202610), 5).await;
        assert_eq!(
            row_of(&db, "acme", STATUS).await.usage_limit,
            None,
            "the insert half must leave the limit unset so the env default applies",
        );
    }

    /// No state may exist in which an October increment is applied and then zeroed, so the
    /// reset cannot be a statement of its own.
    #[tokio::test]
    async fn the_reset_and_the_increment_are_one_write() {
        for backend in [DatabaseBackend::Sqlite, DatabaseBackend::Postgres] {
            let log = status_upsert_log(backend).await;
            // Counted over the status row's OWN statements: a log length would be satisfied by
            // the fixture's zero browser and protocol deltas rather than by this property.
            let touching_status = log
                .iter()
                .flat_map(|txn| txn.statements())
                .filter(|statement| format!("{statement:?}").contains(SYNTHETICS_STATUS_FEATURE))
                .count();
            assert_eq!(
                touching_status, 1,
                "the reset rides the increment: ONE statement touches the status row, or a \
                 crash between two leaves the month half-turned ({backend:?}): {log:?}",
            );
        }
    }

    /// SQLite has no `GREATEST` and Postgres no two-argument `MAX`, so the guard must render as
    /// a `CASE`; the loop is here only to catch a `get_database_backend()` branch.
    #[tokio::test]
    async fn the_period_guard_renders_for_every_backend() {
        for backend in [DatabaseBackend::Sqlite, DatabaseBackend::Postgres] {
            let log = status_upsert_log(backend).await;
            assert!(
                !log.is_empty(),
                "an empty log renders as `[]`, which every ban below is happy with ({backend:?})",
            );

            let sql = format!("{log:?}").to_uppercase();
            assert!(
                sql.matches("CASE").count() >= 2,
                "usage_count's reset and period's GREATEST replacement are TWO guards; one CASE \
                 means period is written unguarded on {backend:?}: {sql}",
            );
            for unportable in ["GREATEST", "MAX("] {
                assert!(
                    !sql.contains(unportable),
                    "`{unportable}` on {backend:?}: the period guard must compile to a CASE: \
                     {sql}",
                );
            }
        }
    }

    /// The one-time pools are lifetime. A month on their rows would reset them every month.
    #[tokio::test]
    async fn batch_increment_leaves_period_at_zero() {
        let db = db().await;
        seed_row(&db, "acme", STATUS, 90, None, 202610).await;

        batch_increment_in(
            &db,
            vec![
                ("acme".to_string(), BROWSER.to_string(), 40),
                ("acme".to_string(), STATUS.to_string(), 5),
            ],
        )
        .await
        .unwrap();

        assert_eq!(counter(&db, "acme", BROWSER).await, (40, 0));
        assert_eq!(
            counter(&db, "acme", STATUS).await,
            (95, 202610),
            "the conflict clause must not write period, or this path rewinds the month",
        );

        assert_entry_point_delegates("batch_increment", "batch_increment_in");
    }

    /// A flush tick that coalesced to nothing must answer without waiting on the write pool.
    #[test]
    fn an_empty_batch_returns_before_the_write_pool_is_touched() {
        let source = code_only_source();
        let body = fn_body(&source, "batch_increment");
        let guard = body
            .find("records.is_empty()")
            .expect("the empty batch must be answered here, not by the callee");
        let pool = body
            .find("get_orm_client_rw")
            .expect("the wrapper is what reaches for the write pool");
        assert!(
            guard < pool,
            "an empty batch blocks on pool initialisation once the guard moves into the callee",
        );
    }

    /// N autocommits hold the write lock N times and leave a crash mid-batch half applied.
    #[tokio::test]
    async fn the_batch_is_one_transaction() {
        let db = mock_db(DatabaseBackend::Sqlite, 3);

        batch_increment_in(
            &db,
            vec![
                ("acme".to_string(), BROWSER.to_string(), 40),
                ("acme".to_string(), PROTOCOL.to_string(), 10),
                ("beta".to_string(), STATUS.to_string(), 5),
            ],
        )
        .await
        .unwrap();

        assert_one_transaction(&db.into_transaction_log(), 3, "batch_increment_in");
    }

    /// The seed-insert must `Set(0)`: the ENT `ALTER` carries `DEFAULT 0`, but the schema built
    /// from the entity does not, so `NotSet` is a NOT NULL violation the moment it is tested.
    #[tokio::test]
    async fn setting_a_limit_never_writes_a_month() {
        let db = db().await;
        seed_row(&db, "acme", PROTOCOL, 100, None, 0).await;

        set_usage_limit_for_org_in(&db, "acme", BROWSER, &[BROWSER, PROTOCOL], 5_000)
            .await
            .unwrap();

        let row = row_of(&db, "acme", BROWSER).await;
        assert_eq!(row.usage_limit, Some(5_000));
        assert_eq!(
            row.period, 0,
            "the call has no month input, so the seed insert must stamp the lifetime 0",
        );
        assert_eq!(
            row_of(&db, "acme", PROTOCOL).await.usage_limit,
            Some(5_000),
            "the seed insert reaches ONE feature; the pool's other rows need the fan-out UPDATE",
        );
        assert_eq!(
            counter(&db, "acme", PROTOCOL).await,
            (100, 0),
            "the fan-out raises the limit only — a count or a month written here is a reset",
        );

        seed_row(&db, "bigcorp", STATUS, 12_480, None, 202610).await;
        set_usage_limit_for_org_in(&db, "bigcorp", STATUS, &[STATUS], 150_000)
            .await
            .unwrap();

        assert_eq!(
            counter(&db, "bigcorp", STATUS).await,
            (12_480, 202610),
            "raising a limit mid-month must not rewind the month and re-open the grant",
        );
        assert_eq!(
            row_of(&db, "bigcorp", STATUS).await.usage_limit,
            Some(150_000),
        );

        assert_entry_point_delegates("set_usage_limit_for_org", "set_usage_limit_for_org_in");
    }

    /// `is_in(&[])` is not a reliable "match nothing", and on an `update_many` degrading to an
    /// unfiltered write raises every pool's limit at once.
    #[tokio::test]
    async fn an_empty_feature_set_reaches_no_other_pool() {
        let db = db().await;
        seed_row(&db, "acme", AI, 340, Some(10_000), 0).await;
        seed_row(&db, "acme", PROTOCOL, 100, None, 0).await;

        set_usage_limit_for_org_in(&db, "acme", BROWSER, &[], 5_000)
            .await
            .unwrap();

        assert_eq!(
            row_of(&db, "acme", AI).await.usage_limit,
            Some(10_000),
            "an unfiltered fan-out hands the AI pool the synthetics limit",
        );
        assert_eq!(
            row_of(&db, "acme", PROTOCOL).await.usage_limit,
            None,
            "the other synthetics pools are not in the set either",
        );
        assert_eq!(
            row_of(&db, "acme", BROWSER).await.usage_limit,
            Some(5_000),
            "the seed insert is unconditional — only the fan-out is guarded",
        );
    }

    /// Spec §7.4 — a crash between the seed and the fan-out leaves the pool on two limits.
    #[tokio::test]
    async fn setting_a_limit_is_one_transaction() {
        let db = mock_db(DatabaseBackend::Sqlite, 2);

        set_usage_limit_for_org_in(&db, "acme", BROWSER, &[BROWSER, PROTOCOL], 5_000)
            .await
            .unwrap();

        assert_one_transaction(&db.into_transaction_log(), 2, "set_usage_limit_for_org_in");
    }

    /// Spec §11.1: an org at 96% of its AI credits carries `notified_checkpoint = 95` on EVERY
    /// row, so an admin raising ONE synthetics grant re-emails 80 → 90 → 95 on the next tick
    /// unless this reset is bounded by the pool whose limit actually moved.
    #[tokio::test]
    async fn resetting_one_pool_leaves_every_other_watermark_standing() {
        let db = db().await;
        for feature in [AI, "new_incident", BROWSER, PROTOCOL, LEGACY_STEPS, STATUS] {
            seed_checkpoint(&db, "acme", feature, 95).await;
        }
        seed_checkpoint(&db, "beta", PROTOCOL, 90).await;

        reset_notified_checkpoint_in(&db, "acme", PROTOCOL_POOL)
            .await
            .unwrap();

        assert_eq!(
            checkpoint_of(&db, "acme", AI).await,
            95,
            "the AI watermark is gone, so the next 900 s tick re-emails 80, 90 and 95",
        );
        assert_eq!(checkpoint_of(&db, "acme", "new_incident").await, 95);
        for feature in [BROWSER, STATUS] {
            assert_eq!(
                checkpoint_of(&db, "acme", feature).await,
                95,
                "{feature}: a pool whose limit never moved is re-armed for notifications it has \
                 already sent",
            );
        }
        for feature in PROTOCOL_POOL {
            assert_eq!(
                checkpoint_of(&db, "acme", feature).await,
                0,
                "{feature}: every feature key of the pool whose limit moved must be re-armed",
            );
        }
        assert_eq!(
            checkpoint_of(&db, "beta", PROTOCOL).await,
            90,
            "the org filter is still the outer bound",
        );

        assert_entry_point_delegates("reset_notified_checkpoint", "reset_notified_checkpoint_in");
    }

    /// The working case: raising the AI limit re-arms the AI pool's own rows.
    #[tokio::test]
    async fn resetting_the_ai_pool_still_clears_its_own_rows() {
        let db = db().await;
        for feature in AI_FEATURES.iter().copied().chain([BROWSER]) {
            seed_checkpoint(&db, "acme", feature, 95).await;
        }

        reset_notified_checkpoint_in(&db, "acme", AI_FEATURES)
            .await
            .unwrap();

        for feature in AI_FEATURES {
            assert_eq!(
                checkpoint_of(&db, "acme", feature).await,
                0,
                "{feature}: the reset covers every feature key of the pool, not just the one \
                 that is named",
            );
        }
        assert_eq!(checkpoint_of(&db, "acme", BROWSER).await, 95);
    }

    /// An empty slice clears nothing, whether the guard runs or sea-query renders `1 = 2`.
    #[tokio::test]
    async fn resetting_no_features_touches_no_row() {
        let db = db().await;
        seed_checkpoint(&db, "acme", AI, 95).await;

        reset_notified_checkpoint_in(&db, "acme", &[])
            .await
            .unwrap();

        assert_eq!(checkpoint_of(&db, "acme", AI).await, 95);
    }

    /// Spec §11.1: the watermark is read back as a MAX over the org's rows, so an AI
    /// notification stamping the synthetics rows answers for the synthetics pool ever after.
    #[tokio::test]
    async fn stamping_one_pool_leaves_every_other_watermark_standing() {
        let db = db().await;
        for feature in AI_FEATURES
            .iter()
            .copied()
            .chain(SYNTHETICS.iter().copied())
        {
            seed_checkpoint(&db, "acme", feature, 0).await;
        }
        seed_checkpoint(&db, "beta", AI, 0).await;

        assert!(
            update_notified_checkpoint_in(&db, "acme", 95, AI_FEATURES)
                .await
                .unwrap(),
            "the pod that moves the watermark is the one that sends the email",
        );

        for feature in AI_FEATURES {
            assert_eq!(checkpoint_of(&db, "acme", feature).await, 95);
        }
        for feature in SYNTHETICS {
            assert_eq!(
                checkpoint_of(&db, "acme", feature).await,
                0,
                "{feature}: a pool nobody notified is left claiming it warned the org at 95",
            );
        }
        assert_eq!(
            checkpoint_of(&db, "beta", AI).await,
            0,
            "the org filter is still the outer bound",
        );

        assert_entry_point_delegates(
            "update_notified_checkpoint",
            "update_notified_checkpoint_in",
        );
    }

    /// The AI job's `already_notified` is this MAX, and `pending_checkpoint_from` returns
    /// `None` for every checkpoint at or below it.
    #[tokio::test]
    async fn loading_one_pools_checkpoints_ignores_another_pools_rows() {
        let db = db().await;
        seed_checkpoint(&db, "acme", BROWSER, 95).await;
        seed_checkpoint(&db, "acme", AI, 0).await;
        seed_checkpoint(&db, "beta", AI, 80).await;

        let loaded = load_all_checkpoints_in(&db, AI_FEATURES).await.unwrap();

        assert_eq!(
            loaded,
            vec![("beta".to_string(), 80)],
            "acme's AI pool is unnotified: only a synthetics watermark, or its own zero, can \
             put it in this answer",
        );

        assert_entry_point_delegates("load_all_checkpoints", "load_all_checkpoints_in");
    }

    /// Spec §11.1 end to end: production rows carry 95 on EVERY feature, so an AI grant raised
    /// after the fix must still leave the AI job seeing an org it can warn again.
    #[tokio::test]
    async fn raising_the_ai_grant_re_arms_the_job_a_synthetics_row_would_pin() {
        let db = db().await;
        for feature in AI_FEATURES
            .iter()
            .copied()
            .chain(SYNTHETICS.iter().copied())
        {
            seed_checkpoint(&db, "acme", feature, 95).await;
        }

        reset_notified_checkpoint_in(&db, "acme", AI_FEATURES)
            .await
            .unwrap();

        assert!(
            load_all_checkpoints_in(&db, AI_FEATURES)
                .await
                .unwrap()
                .is_empty(),
            "a synthetics row still at 95 would hold the org's MAX at 95, and the raised AI \
             grant would never be warned about again",
        );
        for feature in SYNTHETICS {
            assert_eq!(
                checkpoint_of(&db, "acme", feature).await,
                95,
                "{feature}: the synthetics watermark is not the AI reset's to clear",
            );
        }
    }

    /// An empty slice touches nothing, whether the guard runs or sea-query renders `1 = 2`.
    #[tokio::test]
    async fn no_features_stamps_no_row_and_reads_nothing() {
        let db = db().await;
        seed_checkpoint(&db, "acme", AI, 80).await;

        assert!(
            !update_notified_checkpoint_in(&db, "acme", 95, &[])
                .await
                .unwrap(),
            "a write that reached no row must not report itself as the winning claim",
        );

        assert_eq!(checkpoint_of(&db, "acme", AI).await, 80);
        assert!(load_all_checkpoints_in(&db, &[]).await.unwrap().is_empty(),);
    }

    #[tokio::test]
    async fn the_one_time_rows_never_acquire_a_month() {
        let db = db().await;
        seed_row(&db, "acme", PROTOCOL, 100, None, 0).await;

        apply(&db, "acme", deltas(30, 20, 0, 202610), 5).await;

        assert_eq!(counter(&db, "acme", BROWSER).await, (30, 0));
        assert_eq!(counter(&db, "acme", PROTOCOL).await, (120, 0));
        assert_eq!(row_of(&db, "acme", BROWSER).await.updated_at, 5);
        assert_eq!(row_of(&db, "acme", PROTOCOL).await.updated_at, 5);
        assert!(
            has_no_row(&db, "acme", STATUS).await,
            "a zero delta must write no row, or every org acquires one for a pool it has \
             never touched",
        );
    }

    /// Write amplification: an org that never touched the pool must not acquire a row for it.
    #[tokio::test]
    async fn a_zero_one_time_delta_writes_no_row() {
        let db = db().await;

        apply(&db, "acme", deltas(0, 0, 40, 202610), 5).await;

        assert!(has_no_row(&db, "acme", BROWSER).await, "browser");
        assert!(has_no_row(&db, "acme", PROTOCOL).await, "protocol");
        assert_eq!(counter(&db, "acme", STATUS).await, (40, 202610));
    }

    /// Spec §7.5 — each org resets itself on the first window that STARTS in October, and a
    /// window that starts in September still meets September's counter.
    #[tokio::test]
    async fn the_month_boundary_settles_four_orgs_independently() {
        let db = db().await;
        seed_row(&db, "acme", STATUS, 12_480, None, 202609).await;
        seed_row(&db, "bigcorp", STATUS, 81_000, Some(150_000), 202609).await;
        seed_row(&db, "startup", STATUS, 6_100, None, 202609).await;
        seed_row(&db, "contract-co", STATUS, 33_000, None, 202609).await;

        for (org, grant) in [("acme", 410), ("bigcorp", 1_200), ("contract-co", 900)] {
            apply(&db, org, deltas(0, 0, grant, 202609), 5).await;
        }
        for (org, grant) in [("acme", 90), ("bigcorp", 260), ("contract-co", 400)] {
            apply(&db, org, deltas(0, 0, grant, 202609), 6).await;
        }
        assert_eq!(counter(&db, "acme", STATUS).await, (12_980, 202609));
        assert_eq!(counter(&db, "bigcorp", STATUS).await, (82_460, 202609));
        assert_eq!(counter(&db, "contract-co", STATUS).await, (34_300, 202609));

        apply(&db, "acme", deltas(0, 0, 40, 202610), 7).await;
        apply(&db, "bigcorp", deltas(0, 0, 260, 202610), 7).await;
        apply(&db, "acme", deltas(0, 0, 70, 202610), 8).await;
        apply(&db, "contract-co", deltas(0, 0, 1_300, 202610), 8).await;

        assert_eq!(counter(&db, "acme", STATUS).await, (110, 202610));
        assert_eq!(counter(&db, "bigcorp", STATUS).await, (260, 202610));
        assert_eq!(
            row_of(&db, "bigcorp", STATUS).await.usage_limit,
            Some(150_000),
        );
        assert_eq!(
            counter(&db, "contract-co", STATUS).await,
            (1_300, 202610),
            "a failed post delays only its own org's reset, and the retry still resets",
        );
        assert_eq!(
            counter(&db, "startup", STATUS).await,
            (6_100, 202609),
            "an org the loop never iterates keeps September's row untouched (U-23)",
        );
    }

    /// Spec §7.9: the reset rides each org's own upsert, so no write may be scoped to a `feature`
    /// alone.
    #[test]
    fn reset_is_per_row() {
        let marker = ["#[cfg(", "test)]"].concat();
        let source = code_only_source();
        let source = &source[..source.find(&marker).unwrap_or(source.len())];

        // Case-insensitive: `execute_unprepared("update trial_quota_usage set …")` walks through.
        let update = ["update", " "].concat();
        assert!(
            !source.to_lowercase().contains(&update),
            "a raw statement bypasses the per-org filters the query builder makes visible",
        );
        for (at, _) in source.match_indices("update_many()") {
            let chain = &source[at..];
            let end = chain.find(".exec").expect("an update that never executes");
            assert!(
                chain[..end].contains("Column::OrgId"),
                "this update is not scoped to one org: {}",
                &chain[..end],
            );
        }
    }
}
