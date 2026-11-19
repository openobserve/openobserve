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

//! The last toolset call outcome per org × toolset, written as a turn's tool parts are stored.

use std::collections::HashMap;

use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set, TransactionTrait,
    sea_query::{Expr, OnConflict},
};

pub use super::entity::ai_toolset_health::Model as ToolsetHealth;
use super::entity::ai_toolset_health::*;
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// One finished toolset call: when, and the error when it failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallOutcome<'a> {
    pub org: &'a str,
    pub toolset: &'a str,
    pub at: i64,
    pub error: Option<&'a str>,
}

/// Records one call of a toolset the org still has (`exists` gets its raw names); the newest
/// outcome wins, and `failing_since` is the first failure after the last success.
pub async fn record(
    outcome: CallOutcome<'_>,
    exists: impl FnOnce(&[String]) -> bool,
) -> Result<(), errors::Error> {
    record_with(get_orm_client_rw().await, outcome, exists).await
}

/// Every health row of the org, keyed by toolset name.
pub async fn list(org: &str) -> Result<HashMap<String, ToolsetHealth>, errors::Error> {
    list_with(get_orm_client_ro().await, org).await
}

pub async fn remove(org: &str, toolset: &str) -> Result<(), errors::Error> {
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Toolset.eq(toolset))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

pub async fn delete_by_org(org: &str) -> Result<(), errors::Error> {
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

// One transaction, so a toolset deleted meanwhile gets no row back from a late completion.
async fn record_with<C: TransactionTrait>(
    conn: &C,
    outcome: CallOutcome<'_>,
    exists: impl FnOnce(&[String]) -> bool,
) -> Result<(), errors::Error> {
    let txn = conn.begin().await?;
    let names = super::org_ai_toolsets::list_names_with(&txn, outcome.org).await?;
    if !exists(&names) {
        return Ok(());
    }
    let row = ActiveModel {
        org: Set(outcome.org.to_string()),
        toolset: Set(outcome.toolset.to_string()),
        last_ok_at: Set(outcome.error.is_none().then_some(outcome.at)),
        last_error_at: Set(outcome.error.is_some().then_some(outcome.at)),
        failing_since: Set(outcome.error.is_some().then_some(outcome.at)),
        last_error: Set(outcome.error.map(str::to_string)),
    };
    let inserted = Entity::insert(row)
        .on_conflict(
            OnConflict::columns([Column::Org, Column::Toolset])
                .do_nothing()
                .to_owned(),
        )
        .exec_without_returning(&txn)
        .await?;
    if inserted == 0 {
        apply_outcome(&txn, &outcome).await?;
    }
    txn.commit().await?;
    Ok(())
}

// Calls finish out of order across batches: an outcome older than the other kind's newest is
// ignored, and only the newest failure sets `last_error`.
async fn apply_outcome<C: ConnectionTrait>(
    conn: &C,
    outcome: &CallOutcome<'_>,
) -> Result<(), errors::Error> {
    let at = outcome.at;
    let update = Entity::update_many()
        .filter(Column::Org.eq(outcome.org))
        .filter(Column::Toolset.eq(outcome.toolset));
    let update = match outcome.error {
        None => update
            .col_expr(Column::LastOkAt, Expr::value(at))
            .col_expr(Column::FailingSince, Expr::value(Option::<i64>::None))
            .filter(Expr::cust_with_values(
                "COALESCE(last_error_at, ?) <= ?",
                [at, at],
            ))
            .filter(Expr::cust_with_values("COALESCE(last_ok_at, ?) <= ?", [at, at])),
        Some(error) => update
            .col_expr(
                Column::FailingSince,
                Expr::cust_with_values(
                    "CASE WHEN failing_since IS NULL OR failing_since > ? THEN ? ELSE failing_since END",
                    [at, at],
                ),
            )
            .col_expr(
                Column::LastError,
                Expr::cust_with_values(
                    "CASE WHEN COALESCE(last_error_at, ?) <= ? THEN ? ELSE last_error END",
                    [
                        sea_orm::Value::from(at),
                        sea_orm::Value::from(at),
                        sea_orm::Value::from(error),
                    ],
                ),
            )
            .col_expr(
                Column::LastErrorAt,
                Expr::cust_with_values(
                    "CASE WHEN COALESCE(last_error_at, ?) <= ? THEN ? ELSE last_error_at END",
                    [at, at, at],
                ),
            )
            .filter(Expr::cust_with_values("COALESCE(last_ok_at, ?) <= ?", [at, at])),
    };
    update.exec(conn).await?;
    Ok(())
}

async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
) -> Result<HashMap<String, ToolsetHealth>, errors::Error> {
    let rows = Entity::find().filter(Column::Org.eq(org)).all(conn).await?;
    Ok(rows.into_iter().map(|r| (r.toolset.clone(), r)).collect())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ActiveModelTrait, Database, DatabaseConnection, Schema};

    use super::*;
    use crate::table::entity::org_ai_toolsets;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(Entity),
            schema.create_table_from_entity(org_ai_toolsets::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        org_ai_toolsets::ActiveModel {
            id: Set("t1".to_string()),
            org: Set("org".to_string()),
            name: Set("datadog-prod".to_string()),
            kind: Set("mcp".to_string()),
            description: Set(None),
            data: Set(None),
            created_by: Set("u".to_string()),
            created_at: Set(1),
            updated_at: Set(1),
            region_only: Set(false),
            origin_region: Set(None),
        }
        .insert(&db)
        .await
        .unwrap();
        db
    }

    async fn call_of(db: &DatabaseConnection, toolset: &str, at: i64, error: Option<&str>) {
        let outcome = CallOutcome {
            org: "org",
            toolset,
            at,
            error,
        };
        let exists = |names: &[String]| names.iter().any(|n| n == toolset);
        record_with(db, outcome, exists).await.unwrap();
    }

    async fn call(db: &DatabaseConnection, at: i64, error: Option<&str>) {
        call_of(db, "datadog-prod", at, error).await;
    }

    async fn row(db: &DatabaseConnection) -> ToolsetHealth {
        list_with(db, "org")
            .await
            .unwrap()
            .remove("datadog-prod")
            .unwrap()
    }

    #[tokio::test]
    async fn a_failure_run_starts_at_its_first_failure_and_a_success_ends_it() {
        let db = db().await;
        call(&db, 10, None).await;
        call(&db, 20, Some("401 Unauthorized")).await;
        call(&db, 30, Some("5xx")).await;
        let failing = row(&db).await;
        assert_eq!(
            (
                failing.last_ok_at,
                failing.failing_since,
                failing.last_error_at
            ),
            (Some(10), Some(20), Some(30))
        );
        assert_eq!(failing.last_error.as_deref(), Some("5xx"));

        call(&db, 40, None).await;
        let healthy = row(&db).await;
        assert_eq!(
            (healthy.last_ok_at, healthy.failing_since),
            (Some(40), None)
        );
        assert_eq!(healthy.last_error_at, Some(30), "the last error is kept");
    }

    #[tokio::test]
    async fn an_older_success_written_after_a_newer_failure_changes_nothing() {
        let db = db().await;
        call(&db, 20, Some("401 Unauthorized")).await;
        call(&db, 10, None).await;
        let row = row(&db).await;
        assert_eq!((row.last_ok_at, row.failing_since), (None, Some(20)));
    }

    #[tokio::test]
    async fn an_older_failure_written_after_a_newer_success_changes_nothing() {
        let db = db().await;
        call(&db, 20, None).await;
        call(&db, 10, Some("timeout")).await;
        let row = row(&db).await;
        assert_eq!(
            (row.last_ok_at, row.failing_since, row.last_error),
            (Some(20), None, None)
        );
    }

    #[tokio::test]
    async fn out_of_order_failures_keep_the_newest_error_and_the_first_start() {
        let db = db().await;
        call(&db, 30, Some("5xx")).await;
        call(&db, 20, Some("401 Unauthorized")).await;
        let row = row(&db).await;
        assert_eq!((row.failing_since, row.last_error_at), (Some(20), Some(30)));
        assert_eq!(row.last_error.as_deref(), Some("5xx"));
    }

    #[tokio::test]
    async fn a_toolset_the_org_does_not_have_gets_no_row() {
        let db = db().await;
        call_of(&db, "made-up", 5, Some("unknown toolset")).await;
        assert!(list_with(&db, "org").await.unwrap().is_empty());
    }
}
