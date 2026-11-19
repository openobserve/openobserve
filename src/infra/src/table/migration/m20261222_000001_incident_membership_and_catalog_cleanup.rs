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

//! The firing's own labels and severity on each incident member row, the per-org memory of
//! alert pairs, and the deletion of catalog services the metric-name label named.

use config::meta::promql::NAME_LABEL;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use sea_orm_migration::prelude::*;

const TABLE: &str = "alert_incident_alerts";
/// The semantic group the catalog's `field_name_mapping` keys a service's field under.
const SERVICE_GROUP: &str = "service";
const PAGE: u64 = 1000;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite drops IF NOT EXISTS, so a retry must skip a column already added.
        for (name, column) in columns() {
            if !manager.has_column(TABLE, name).await? {
                manager.alter_table(add_column_statement(column)).await?;
            }
        }
        manager.create_table(pair_verdicts_statement()).await?;
        delete_metric_named(manager.get_connection()).await
    }

    /// The deleted services named metrics, not services, so that delete is not undone.
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(AlertPairVerdicts::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        for (name, _) in columns() {
            if manager.has_column(TABLE, name).await? {
                let drop = Table::alter()
                    .table(AlertIncidentAlerts::Table)
                    .drop_column(Alias::new(name))
                    .to_owned();
                manager.alter_table(drop).await?;
            }
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum AlertIncidentAlerts {
    Table,
    Labels,
    Severity,
}

#[derive(DeriveIden)]
enum AlertPairVerdicts {
    Table,
    OrgId,
    AlertA,
    AlertB,
    Verdict,
    Reason,
    DecidedBy,
    Signal,
    ExpiresAt,
}

fn columns() -> [(&'static str, ColumnDef); 2] {
    [
        (
            "labels",
            ColumnDef::new(AlertIncidentAlerts::Labels)
                .text()
                .null()
                .to_owned(),
        ),
        (
            "severity",
            ColumnDef::new(AlertIncidentAlerts::Severity)
                .string_len(8)
                .null()
                .to_owned(),
        ),
    ]
}

fn add_column_statement(mut column: ColumnDef) -> TableAlterStatement {
    Table::alter()
        .table(AlertIncidentAlerts::Table)
        .add_column(&mut column)
        .to_owned()
}

fn pair_verdicts_statement() -> TableCreateStatement {
    Table::create()
        .table(AlertPairVerdicts::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(AlertPairVerdicts::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertPairVerdicts::AlertA)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertPairVerdicts::AlertB)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertPairVerdicts::Verdict)
                .string_len(16)
                .not_null(),
        )
        .col(ColumnDef::new(AlertPairVerdicts::Reason).text().not_null())
        .col(
            ColumnDef::new(AlertPairVerdicts::DecidedBy)
                .string_len(8)
                .not_null(),
        )
        .col(
            ColumnDef::new(AlertPairVerdicts::Signal)
                .string_len(32)
                .null(),
        )
        .col(
            ColumnDef::new(AlertPairVerdicts::ExpiresAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(AlertPairVerdicts::OrgId)
                .col(AlertPairVerdicts::AlertA)
                .col(AlertPairVerdicts::AlertB),
        )
        .to_owned()
}

/// Deletes each row whose service came from the metric-name label and that lists no trace
/// stream; a row with traces names a real service.
async fn delete_metric_named<C: ConnectionTrait>(db: &C) -> Result<(), DbErr> {
    use service_streams::{Column, Entity};

    let mut doomed = Vec::new();
    let mut after = String::new();
    loop {
        let page = Entity::find()
            .filter(Column::Id.gt(after.as_str()))
            .order_by_asc(Column::Id)
            .limit(PAGE)
            .all(db)
            .await?;
        let Some(last) = page.last() else {
            break;
        };
        after = last.id.clone();
        doomed.extend(page.into_iter().filter(metric_named).map(|row| row.id));
    }
    for ids in doomed.chunks(PAGE as usize) {
        Entity::delete_many()
            .filter(Column::Id.is_in(ids.iter().cloned()))
            .exec(db)
            .await?;
    }
    if !doomed.is_empty() {
        log::info!(
            "[SERVICE_STREAMS] deleted {} services named by {NAME_LABEL}",
            doomed.len()
        );
    }
    Ok(())
}

fn metric_named(row: &service_streams::Model) -> bool {
    let service_field = row
        .field_name_mapping
        .as_ref()
        .and_then(|mapping| mapping.get(SERVICE_GROUP))
        .and_then(|field| field.as_str());
    service_field == Some(NAME_LABEL)
        && row
            .traces_streams
            .as_array()
            .is_some_and(|traces| traces.is_empty())
}

// Frozen view of the service_streams table, so later schema changes do not alter this migration.
mod service_streams {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "service_streams")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub traces_streams: Json,
        pub field_name_mapping: Option<Json>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

#[cfg(test)]
mod tests {
    use sea_orm::{ActiveModelTrait, Database, DatabaseConnection, Schema, Set};
    use serde_json::json;

    use super::*;
    use crate::table::service_streams as table;

    /// The member table as it stood before this migration, beside the current catalog table.
    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE alert_incident_alerts (incident_id TEXT, alert_id TEXT, alert_fired_at BIGINT)",
        )
        .await
        .unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(table::Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db
    }

    async fn seed(db: &DatabaseConnection, id: &str, mapping: Option<&str>, traces: &[&str]) {
        table::ActiveModel {
            id: Set(id.to_string()),
            org_id: Set("o1".to_string()),
            service_name: Set(id.to_string()),
            set_id: Set("k8s".to_string()),
            disambiguation: Set(json!({})),
            all_dimensions: Set(json!({})),
            logs_streams: Set(json!([])),
            traces_streams: Set(json!(traces)),
            metrics_streams: Set(json!(["m"])),
            profiles_streams: Set(json!([])),
            field_name_mapping: Set(mapping.map(|field| json!({ SERVICE_GROUP: field }))),
            last_seen: Set(1),
        }
        .insert(db)
        .await
        .unwrap();
    }

    async fn ids(db: &DatabaseConnection) -> Vec<String> {
        let mut ids: Vec<String> = table::Entity::find()
            .all(db)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.id)
            .collect();
        ids.sort();
        ids
    }

    #[tokio::test]
    async fn existing_rows_get_no_labels_or_severity_and_up_down_up_round_trips() {
        let db = db().await;
        db.execute_unprepared("INSERT INTO alert_incident_alerts VALUES ('i', 'a', 1)")
            .await
            .unwrap();
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        let sql = "SELECT labels, severity FROM alert_incident_alerts WHERE incident_id = 'i'";
        let stmt = sea_orm::Statement::from_string(db.get_database_backend(), sql);
        let row = db.query_one(stmt).await.unwrap().unwrap();
        assert_eq!(row.try_get::<Option<String>>("", "labels").unwrap(), None);
        assert_eq!(row.try_get::<Option<String>>("", "severity").unwrap(), None);
        db.execute_unprepared(
            "INSERT INTO alert_pair_verdicts VALUES ('o', 'a', 'b', 'separate', 'r', 'ai', NULL, 2)",
        )
        .await
        .unwrap();
        Migration.down(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("alert_pair_verdicts").await.unwrap());
        for name in ["labels", "severity"] {
            assert!(!manager.has_column(TABLE, name).await.unwrap());
        }
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_table("alert_pair_verdicts").await.unwrap());
        for name in ["labels", "severity"] {
            assert!(manager.has_column(TABLE, name).await.unwrap());
        }
    }

    #[tokio::test]
    async fn only_metric_named_services_without_traces_are_deleted() {
        let db = db().await;
        seed(&db, "metric", Some(NAME_LABEL), &[]).await;
        seed(&db, "metric_with_traces", Some(NAME_LABEL), &["default"]).await;
        seed(&db, "named", Some("service_name"), &[]).await;
        seed(&db, "unmapped", None, &[]).await;

        for _ in 0..2 {
            Migration.up(&SchemaManager::new(&db)).await.unwrap();
            assert_eq!(ids(&db).await, ["metric_with_traces", "named", "unmapped"]);
        }
    }
}
