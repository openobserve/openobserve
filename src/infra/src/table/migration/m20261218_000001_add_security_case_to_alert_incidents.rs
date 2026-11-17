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

//! Marks security cases durably, so deleting a detection never turns its case into an incident.

use sea_orm::{ConnectionTrait, DatabaseConnection, QueryResult};
use sea_orm_migration::prelude::*;

const TABLE: &str = "alert_incidents";
const COLUMN: &str = "security_case";
const PAGE_SIZE: u64 = 500;
/// Group keys only a security case's entity grouping writes (`security::cases`).
const CASE_GROUP_KEYS: [&str; 2] = ["security_host", "security_user"];
/// This migration and the `historical` one under their names before main took version 147.
const RENAMED_MIGRATIONS: [&str; 2] = [
    "m20261217_000001_add_security_case_to_alert_incidents",
    "m20261218_000001_add_historical_to_alert_incidents",
];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite drops IF NOT EXISTS, so a retry must skip the column already added.
        if !manager.has_column(TABLE, COLUMN).await? {
            manager.alter_table(add_column_statement()).await?;
        }
        let db = manager.get_connection();
        let siem_alerts = siem_alert_ids(db).await?;
        for chunk in siem_alerts.chunks(PAGE_SIZE as usize) {
            db.execute(db.get_database_backend().build(&mark_fired_by(chunk)))
                .await?;
        }
        mark_entity_grouped(db).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(TABLE, COLUMN).await? {
            return Ok(());
        }
        manager
            .alter_table(
                Table::alter()
                    .table(AlertIncidents::Table)
                    .drop_column(AlertIncidents::SecurityCase)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum AlertIncidents {
    Table,
    Id,
    GroupValues,
    SecurityCase,
}

#[derive(DeriveIden)]
enum AlertIncidentAlerts {
    Table,
    IncidentId,
    AlertId,
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    Id,
    ContextAttributes,
}

fn add_column_statement() -> TableAlterStatement {
    Table::alter()
        .table(AlertIncidents::Table)
        .add_column(
            ColumnDef::new(AlertIncidents::SecurityCase)
                .boolean()
                .not_null()
                .default(false),
        )
        .to_owned()
}

/// Drops the pre-rename history rows, which `Migrator::up` refuses to run with; both bodies rerun.
pub(crate) async fn forget_renamed_migrations(db: &DatabaseConnection) -> Result<(), DbErr> {
    if !SchemaManager::new(db).has_table("seaql_migrations").await? {
        return Ok(());
    }
    let stmt = Query::delete()
        .from_table(Alias::new("seaql_migrations"))
        .and_where(Expr::col(Alias::new("version")).is_in(RENAMED_MIGRATIONS))
        .to_owned();
    db.execute(db.get_database_backend().build(&stmt)).await?;
    Ok(())
}

/// Ids of the stored alerts whose context attributes mark them as SIEM detections.
async fn siem_alert_ids<C: ConnectionTrait>(db: &C) -> Result<Vec<String>, DbErr> {
    let backend = db.get_database_backend();
    let mut ids = Vec::new();
    let mut after = String::new();
    loop {
        let page = Query::select()
            .columns([Alerts::Id, Alerts::ContextAttributes])
            .from(Alerts::Table)
            .and_where(Expr::col(Alerts::Id).gt(after.clone()))
            .order_by(Alerts::Id, Order::Asc)
            .limit(PAGE_SIZE)
            .to_owned();
        let rows = db.query_all(backend.build(&page)).await?;
        let Some(last) = rows.last() else {
            break;
        };
        after = last.try_get("", "id")?;
        ids.extend(rows.iter().filter_map(siem_alert_id));
        if (rows.len() as u64) < PAGE_SIZE {
            break;
        }
    }
    Ok(ids)
}

fn siem_alert_id(row: &QueryResult) -> Option<String> {
    let attrs: Option<serde_json::Value> = row.try_get("", "context_attributes").ok()?;
    if !is_siem_attrs(attrs.as_ref()?) {
        return None;
    }
    row.try_get("", "id").ok()
}

fn is_siem_attrs(attrs: &serde_json::Value) -> bool {
    attrs.get("siem").and_then(|v| v.as_str()) == Some("true")
}

fn is_case_group(group_values: &serde_json::Value) -> bool {
    group_values
        .as_object()
        .is_some_and(|dims| CASE_GROUP_KEYS.iter().any(|key| dims.contains_key(*key)))
}

/// Marks every incident one of `alert_ids` fired into.
fn mark_fired_by(alert_ids: &[String]) -> UpdateStatement {
    Query::update()
        .table(AlertIncidents::Table)
        .value(AlertIncidents::SecurityCase, true)
        .and_where(
            Expr::col(AlertIncidents::Id).in_subquery(
                Query::select()
                    .column(AlertIncidentAlerts::IncidentId)
                    .from(AlertIncidentAlerts::Table)
                    .and_where(Expr::col(AlertIncidentAlerts::AlertId).is_in(alert_ids.to_vec()))
                    .to_owned(),
            ),
        )
        .to_owned()
}

/// Marks unmarked incidents grouped on a security case's entity key.
async fn mark_entity_grouped<C: ConnectionTrait>(db: &C) -> Result<(), DbErr> {
    let backend = db.get_database_backend();
    let mut after = String::new();
    loop {
        let page = Query::select()
            .columns([AlertIncidents::Id, AlertIncidents::GroupValues])
            .from(AlertIncidents::Table)
            .and_where(Expr::col(AlertIncidents::SecurityCase).eq(false))
            .and_where(Expr::col(AlertIncidents::Id).gt(after.clone()))
            .order_by(AlertIncidents::Id, Order::Asc)
            .limit(PAGE_SIZE)
            .to_owned();
        let rows = db.query_all(backend.build(&page)).await?;
        let Some(last) = rows.last() else {
            break;
        };
        after = last.try_get("", "id")?;
        let cases: Vec<String> = rows
            .iter()
            .filter(|row| {
                row.try_get::<serde_json::Value>("", "group_values")
                    .is_ok_and(|dims| is_case_group(&dims))
            })
            .filter_map(|row| row.try_get("", "id").ok())
            .collect();
        if !cases.is_empty() {
            let mark = Query::update()
                .table(AlertIncidents::Table)
                .value(AlertIncidents::SecurityCase, true)
                .and_where(Expr::col(AlertIncidents::Id).is_in(cases))
                .to_owned();
            db.execute(backend.build(&mark)).await?;
        }
        if (rows.len() as u64) < PAGE_SIZE {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;
    use sea_orm_migration::MigratorTrait;

    use super::*;
    use crate::table::migration::Migrator;

    #[test]
    fn postgres() {
        assert_eq!(
            &add_column_statement().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "alert_incidents" ADD COLUMN "security_case" bool NOT NULL DEFAULT FALSE"#
        );
    }

    async fn legacy_db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        for sql in [
            "CREATE TABLE alerts (id TEXT PRIMARY KEY, context_attributes TEXT)",
            "CREATE TABLE alert_incidents (id TEXT PRIMARY KEY, group_values TEXT NOT NULL)",
            "CREATE TABLE alert_incident_alerts (incident_id TEXT NOT NULL, alert_id TEXT NOT NULL)",
            r#"INSERT INTO alerts VALUES ('siem-1', '{"siem":"true"}'), ('ops-1', '{"siem":"false"}'), ('ops-2', NULL)"#,
            r#"INSERT INTO alert_incidents VALUES ('ungrouped', '{}'), ('host', '{"security_host":"web-1"}'), ('ops', '{"service":"api"}'), ('orphan', '{}')"#,
            "INSERT INTO alert_incident_alerts VALUES ('ungrouped', 'siem-1'), ('ops', 'ops-1'), ('orphan', 'gone-1')",
        ] {
            db.execute_unprepared(sql).await.unwrap();
        }
        db
    }

    #[tokio::test]
    async fn cases_opened_before_the_marker_are_recognised() {
        let db = legacy_db().await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();

        let rows = db
            .query_all(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT id FROM alert_incidents WHERE security_case ORDER BY id",
            ))
            .await
            .unwrap();
        let marked: Vec<String> = rows.iter().map(|r| r.try_get("", "id").unwrap()).collect();
        assert_eq!(marked, ["host", "ungrouped"]);
    }

    #[tokio::test]
    async fn forgetting_the_renamed_migrations_lets_the_migrator_run() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        forget_renamed_migrations(&db).await.unwrap();
        Migrator::install(&db).await.unwrap();
        for name in RENAMED_MIGRATIONS {
            db.execute_unprepared(&format!(
                "INSERT INTO seaql_migrations (version, applied_at) VALUES ('{name}', 1)"
            ))
            .await
            .unwrap();
        }
        let Err(err) = Migrator::get_pending_migrations(&db).await else {
            panic!("the migrator ran with renamed migrations in its history");
        };
        assert!(err.to_string().contains("is missing"), "{err}");

        forget_renamed_migrations(&db).await.unwrap();
        assert!(
            Migrator::get_applied_migrations(&db)
                .await
                .unwrap()
                .is_empty()
        );
    }
}
