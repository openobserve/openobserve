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

//! Skipped automatic pages, run numbers and the run fence, and the stored Correlate cut of each
//! service row, recomputed once for the rows written before the column existed.

#[cfg(test)]
use config::meta::service_streams::STREAMS_CUT_OUTSIDE_FORM;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    sea_query::Expr as OrmExpr,
};
use sea_orm_migration::prelude::*;

const RCA_RUNS: &str = "rca_runs";
const SERVICE_STREAMS: &str = "service_streams";
const PAGE: u64 = 1000;
/// Read with `std::env`: the cap is ENT config, which `infra` cannot read.
const CAP_ENV: &str = "O2_SERVICE_STREAMS_MAX_STREAMS_PER_SERVICE";
/// The cap every deployment started with, so a cap raised later still marks rows cut at 50.
const DEFAULT_CAP: usize = 50;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(skipped_pages_table()).await?;
        for index in skipped_pages_indexes() {
            manager.create_index(index).await?;
        }
        // SQLite drops IF NOT EXISTS on columns, so retries must check each addition.
        if !manager.has_column(RCA_RUNS, "run_number").await? {
            manager.alter_table(run_number_column()).await?;
        }
        if !manager.has_column(RCA_RUNS, "fenced").await? {
            manager.alter_table(fenced_column()).await?;
        }
        if !manager.has_column(SERVICE_STREAMS, "streams_cut").await? {
            manager.alter_table(streams_cut_column()).await?;
        }
        // No writer of the bits runs before this migration ends, so this step races none.
        recompute_streams_cut(
            manager.get_connection(),
            threshold(std::env::var(CAP_ENV).ok()),
        )
        .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column(SERVICE_STREAMS, "streams_cut").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(ServiceStreams::Table)
                        .drop_column(ServiceStreams::StreamsCut)
                        .to_owned(),
                )
                .await?;
        }
        for column in [RcaRuns::Fenced, RcaRuns::RunNumber] {
            if manager.has_column(RCA_RUNS, &column.to_string()).await? {
                manager
                    .alter_table(
                        Table::alter()
                            .table(RcaRuns::Table)
                            .drop_column(column)
                            .to_owned(),
                    )
                    .await?;
            }
        }
        manager
            .drop_table(
                Table::drop()
                    .table(RcaSkippedPages::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum RcaSkippedPages {
    Table,
    Id,
    OrgId,
    SubjectType,
    SubjectId,
    IncidentId,
    ResponseId,
    Reason,
    CoveringRunId,
    CoveringRunNumber,
    RetryAfterUs,
    CooldownUs,
    AtUs,
}

#[derive(DeriveIden)]
enum RcaRuns {
    Table,
    RunNumber,
    Fenced,
}

#[derive(DeriveIden)]
enum ServiceStreams {
    Table,
    StreamsCut,
}

fn skipped_pages_table() -> TableCreateStatement {
    Table::create()
        .table(RcaSkippedPages::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RcaSkippedPages::Id)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::SubjectType)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::SubjectId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::IncidentId)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::ResponseId)
                .string_len(256)
                .null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::Reason)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::CoveringRunId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::CoveringRunNumber)
                .integer()
                .null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::RetryAfterUs)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::CooldownUs)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(RcaSkippedPages::AtUs)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn skipped_pages_indexes() -> [IndexCreateStatement; 4] {
    [
        Index::create()
            .name("rca_skipped_pages_incident_idx")
            .if_not_exists()
            .table(RcaSkippedPages::Table)
            .col(RcaSkippedPages::OrgId)
            .col(RcaSkippedPages::IncidentId)
            .col(RcaSkippedPages::AtUs)
            .to_owned(),
        Index::create()
            .name("rca_skipped_pages_response_idx")
            .if_not_exists()
            .table(RcaSkippedPages::Table)
            .col(RcaSkippedPages::OrgId)
            .col(RcaSkippedPages::ResponseId)
            .to_owned(),
        Index::create()
            .name("rca_skipped_pages_covering_idx")
            .if_not_exists()
            .table(RcaSkippedPages::Table)
            .col(RcaSkippedPages::OrgId)
            .col(RcaSkippedPages::CoveringRunId)
            .to_owned(),
        Index::create()
            .name("rca_skipped_pages_subject_idx")
            .if_not_exists()
            .table(RcaSkippedPages::Table)
            .col(RcaSkippedPages::OrgId)
            .col(RcaSkippedPages::SubjectType)
            .col(RcaSkippedPages::SubjectId)
            .col(RcaSkippedPages::AtUs)
            .to_owned(),
    ]
}

fn run_number_column() -> TableAlterStatement {
    Table::alter()
        .table(RcaRuns::Table)
        .add_column(ColumnDef::new(RcaRuns::RunNumber).integer().null())
        .to_owned()
}

fn fenced_column() -> TableAlterStatement {
    Table::alter()
        .table(RcaRuns::Table)
        .add_column(
            ColumnDef::new(RcaRuns::Fenced)
                .boolean()
                .not_null()
                .default(false),
        )
        .to_owned()
}

fn streams_cut_column() -> TableAlterStatement {
    Table::alter()
        .table(ServiceStreams::Table)
        .add_column(
            ColumnDef::new(ServiceStreams::StreamsCut)
                .small_integer()
                .not_null()
                .default(0),
        )
        .to_owned()
}

/// `min(cap, 50)`; an unset or unreadable cap is the default.
fn threshold(cap: Option<String>) -> usize {
    cap.and_then(|raw| raw.trim().parse::<usize>().ok())
        .unwrap_or(DEFAULT_CAP)
        .min(DEFAULT_CAP)
}

/// Writes each row's cut in primary-key pages; rows are only updated, never deleted.
async fn recompute_streams_cut<C: ConnectionTrait>(db: &C, threshold: usize) -> Result<(), DbErr> {
    use service_streams::{Column, Entity};

    let mut after = String::new();
    let mut changed = 0usize;
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
        for row in page {
            let cut = legacy_cut(&row, threshold);
            if cut == row.streams_cut {
                continue;
            }
            Entity::update_many()
                .col_expr(Column::StreamsCut, OrmExpr::value(cut))
                .filter(Column::Id.eq(row.id.as_str()))
                .exec(db)
                .await?;
            changed += 1;
        }
    }
    if changed > 0 {
        log::info!(
            "[SERVICE_STREAMS] recomputed streams_cut on {changed} services (threshold {threshold})"
        );
    }
    Ok(())
}

fn legacy_cut(row: &service_streams::Model, threshold: usize) -> i16 {
    let lists = [
        &row.logs_streams,
        &row.traces_streams,
        &row.metrics_streams,
        &row.profiles_streams,
    ];
    // The historical schema used NULL for absent lists.
    let lists = lists.map(|list| list.as_ref().filter(|value| !value.is_null()));
    crate::table::service_streams::legacy_cut(lists, threshold)
}

// Frozen view of the service_streams table, so later schema changes do not alter this migration.
mod service_streams {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "service_streams")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub logs_streams: Option<Json>,
        pub traces_streams: Option<Json>,
        pub metrics_streams: Option<Json>,
        pub profiles_streams: Option<Json>,
        pub streams_cut: i16,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

#[cfg(test)]
mod tests {
    use sea_orm::{DatabaseConnection, PaginatorTrait, Schema, Set};
    use serde_json::json;

    use super::*;
    use crate::table::service_streams as table;

    #[test]
    fn postgres_statements_preserve_column_types_and_defaults() {
        assert_eq!(
            skipped_pages_table().to_string(PostgresQueryBuilder),
            concat!(
                "CREATE TABLE IF NOT EXISTS \"rca_skipped_pages\" ( ",
                "\"id\" varchar(64) NOT NULL PRIMARY KEY, ",
                "\"org_id\" varchar(256) NOT NULL, ",
                "\"subject_type\" varchar(16) NOT NULL, ",
                "\"subject_id\" varchar(256) NOT NULL, ",
                "\"incident_id\" varchar(256) NULL, ",
                "\"response_id\" varchar(256) NULL, ",
                "\"reason\" varchar(16) NOT NULL, ",
                "\"covering_run_id\" varchar(64) NOT NULL, ",
                "\"covering_run_number\" integer NULL, ",
                "\"retry_after_us\" bigint NULL, ",
                "\"cooldown_us\" bigint NULL, ",
                "\"at_us\" bigint NOT NULL )"
            )
        );
        assert_eq!(
            run_number_column().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "rca_runs" ADD COLUMN "run_number" integer NULL"#
        );
        assert_eq!(
            fenced_column().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "rca_runs" ADD COLUMN "fenced" bool NOT NULL DEFAULT FALSE"#
        );
        assert_eq!(
            streams_cut_column().to_string(PostgresQueryBuilder),
            r#"ALTER TABLE "service_streams" ADD COLUMN "streams_cut" smallint NOT NULL DEFAULT 0"#
        );
    }

    #[test]
    fn threshold_is_the_lower_of_the_cap_and_fifty() {
        assert_eq!(threshold(None), 50);
        assert_eq!(threshold(Some("100".into())), 50);
        assert_eq!(threshold(Some(" 20 ".into())), 20);
        assert_eq!(threshold(Some("lots".into())), 50);
    }

    /// The tables as they stood before this migration.
    async fn legacy_tables(db: &DatabaseConnection) {
        db.execute_unprepared("CREATE TABLE rca_runs (run_id TEXT PRIMARY KEY)")
            .await
            .unwrap();
        db.execute_unprepared("INSERT INTO rca_runs VALUES ('old')")
            .await
            .unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(table::Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        // The live entity now carries the column this migration adds.
        db.execute_unprepared("ALTER TABLE service_streams DROP COLUMN streams_cut")
            .await
            .unwrap();
    }

    async fn seed(db: &DatabaseConnection, id: &str, logs: Vec<String>) {
        let row = table::ActiveModel {
            id: Set(id.to_string()),
            org_id: Set("o1".to_string()),
            service_name: Set(id.to_string()),
            set_id: Set("k8s".to_string()),
            disambiguation: Set(json!({})),
            all_dimensions: Set(json!({})),
            logs_streams: Set(json!(logs)),
            traces_streams: Set(json!([])),
            metrics_streams: Set(json!([])),
            profiles_streams: Set(json!([])),
            field_name_mapping: Set(None),
            last_seen: Set(1),
            streams_cut: sea_orm::ActiveValue::NotSet,
        };
        // Without RETURNING, so the insert never reads the column the table lacks.
        table::Entity::insert(row)
            .exec_without_returning(db)
            .await
            .unwrap();
    }

    async fn cuts(db: &DatabaseConnection) -> Vec<(String, i16)> {
        service_streams::Entity::find()
            .order_by_asc(service_streams::Column::Id)
            .all(db)
            .await
            .unwrap()
            .into_iter()
            .map(|row| (row.id, row.streams_cut))
            .collect()
    }

    /// OF-11 storage half: L1 under the cap reads 0, L2 at the cap reads 1, L3 has bit 16.
    #[tokio::test]
    async fn correlate_upgrade_recomputes_legacy_cut() {
        for db in crate::table::migration::sqlite_and_postgres_for_test("streams_cut").await {
            legacy_tables(&db).await;
            seed(&db, "l1", vec!["app_a".into()]).await;
            seed(
                &db,
                "l2",
                (0..DEFAULT_CAP).map(|i| format!("app_{i}")).collect(),
            )
            .await;
            seed(&db, "l3", vec!["app_a".into(), "caf\u{e9}".into()]).await;
            let expected = vec![
                ("l1".to_string(), 0),
                ("l2".to_string(), 1),
                ("l3".to_string(), STREAMS_CUT_OUTSIDE_FORM),
            ];
            let manager = SchemaManager::new(&db);
            for _ in 0..2 {
                Migration.up(&manager).await.unwrap();
                assert_eq!(cuts(&db).await, expected);
                assert_eq!(table::Entity::find().count(&db).await.unwrap(), 3);
            }
        }
    }

    #[test]
    fn a_value_that_is_not_a_list_fails_closed_and_null_lists_nothing() {
        let row = service_streams::Model {
            id: "x".into(),
            logs_streams: Some(json!({"not": "a list"})),
            traces_streams: None,
            metrics_streams: Some(json!(null)),
            profiles_streams: Some(json!(["p1", "p2"])),
            streams_cut: 0,
        };
        assert_eq!(legacy_cut(&row, 2), 1 | 8 | STREAMS_CUT_OUTSIDE_FORM);
    }

    #[tokio::test]
    async fn up_twice_preserves_existing_runs_and_down_is_idempotent() {
        for db in crate::table::migration::sqlite_and_postgres_for_test("rca_skipped").await {
            legacy_tables(&db).await;
            let manager = SchemaManager::new(&db);
            Migration.up(&manager).await.unwrap();
            Migration.up(&manager).await.unwrap();
            let row = db
                .query_one(sea_orm::Statement::from_string(
                    db.get_database_backend(),
                    "SELECT run_number, fenced FROM rca_runs WHERE run_id = 'old'",
                ))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(row.try_get::<Option<i32>>("", "run_number").unwrap(), None);
            assert!(!row.try_get::<bool>("", "fenced").unwrap());
            for index in [
                "rca_skipped_pages_incident_idx",
                "rca_skipped_pages_response_idx",
                "rca_skipped_pages_covering_idx",
                "rca_skipped_pages_subject_idx",
            ] {
                let found = manager.has_index("rca_skipped_pages", index).await.unwrap();
                assert!(found, "{index}");
            }
            Migration.down(&manager).await.unwrap();
            Migration.down(&manager).await.unwrap();
            assert!(!manager.has_column(RCA_RUNS, "run_number").await.unwrap());
            assert!(!manager.has_column(RCA_RUNS, "fenced").await.unwrap());
            assert!(manager.has_column(RCA_RUNS, "run_id").await.unwrap());
            let cut = manager.has_column(SERVICE_STREAMS, "streams_cut").await;
            assert!(!cut.unwrap());
            assert!(!manager.has_table("rca_skipped_pages").await.unwrap());
        }
    }
}
