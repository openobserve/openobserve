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

//! The delivery each run owes every on-call record it was started for (X08).

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(delivery_obligations_table()).await?;
        for index in delivery_obligations_indexes() {
            manager.create_index(index).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(RcaDeliveryObligations::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum RcaDeliveryObligations {
    Table,
    Id,
    OrgId,
    RunId,
    ResponseId,
    Subject,
    LadderRun,
    Kind,
    State,
    Attempts,
    NextAttemptAt,
    Outcome,
    CreatedAt,
    UpdatedAt,
}

fn delivery_obligations_table() -> TableCreateStatement {
    Table::create()
        .table(RcaDeliveryObligations::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(RcaDeliveryObligations::Id)
                .string_len(64)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::RunId)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::ResponseId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::Subject)
                .text()
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::LadderRun)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::Kind)
                .string_len(16)
                .null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::State)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::Attempts)
                .integer()
                .not_null()
                .default(0),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::NextAttemptAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::Outcome)
                .string_len(32)
                .null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(RcaDeliveryObligations::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn delivery_obligations_indexes() -> [IndexCreateStatement; 2] {
    [
        Index::create()
            .name("rca_delivery_obligations_due_idx")
            .if_not_exists()
            .table(RcaDeliveryObligations::Table)
            .col(RcaDeliveryObligations::State)
            .col(RcaDeliveryObligations::NextAttemptAt)
            .to_owned(),
        Index::create()
            .name("rca_delivery_obligations_run_idx")
            .if_not_exists()
            .table(RcaDeliveryObligations::Table)
            .col(RcaDeliveryObligations::OrgId)
            .col(RcaDeliveryObligations::RunId)
            .to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database};

    use super::*;

    #[test]
    fn postgres_statement_has_the_thirteen_columns_of_the_design() {
        assert_eq!(
            delivery_obligations_table().to_string(PostgresQueryBuilder),
            concat!(
                "CREATE TABLE IF NOT EXISTS \"rca_delivery_obligations\" ( ",
                "\"id\" varchar(64) NOT NULL PRIMARY KEY, ",
                "\"org_id\" varchar(256) NOT NULL, ",
                "\"run_id\" varchar(64) NOT NULL, ",
                "\"response_id\" varchar(256) NOT NULL, ",
                "\"subject\" text NOT NULL, ",
                "\"ladder_run\" integer NOT NULL, ",
                "\"kind\" varchar(16) NULL, ",
                "\"state\" varchar(16) NOT NULL, ",
                "\"attempts\" integer NOT NULL DEFAULT 0, ",
                "\"next_attempt_at\" bigint NOT NULL, ",
                "\"outcome\" varchar(32) NULL, ",
                "\"created_at\" bigint NOT NULL, ",
                "\"updated_at\" bigint NOT NULL )"
            )
        );
    }

    #[tokio::test]
    async fn up_twice_and_down_twice_on_sqlite() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        up_and_down(&db).await;
    }

    /// The same on a fresh PostgreSQL database when `ZO_META_POSTGRES_DSN` is set.
    #[tokio::test]
    async fn up_and_down_on_postgres_when_configured() {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").unwrap_or_default();
        if dsn.trim().is_empty() {
            println!("ZO_META_POSTGRES_DSN unset; postgres arm skipped");
            return;
        }
        let name = format!(
            "rca_obligations_{}",
            config::ider::generate().to_ascii_lowercase()
        );
        let admin = Database::connect(&dsn).await.unwrap();
        admin
            .execute_unprepared(&format!(r#"CREATE DATABASE "{name}""#))
            .await
            .unwrap();
        let base = dsn.split('?').next().unwrap();
        let (server, _) = base.rsplit_once('/').unwrap();
        let db = Database::connect(format!("{server}/{name}")).await.unwrap();
        up_and_down(&db).await;
        db.close().await.unwrap();
        admin
            .execute_unprepared(&format!(r#"DROP DATABASE "{name}""#))
            .await
            .unwrap();
        println!("postgres arm ran");
    }

    async fn up_and_down(db: &sea_orm::DatabaseConnection) {
        let manager = SchemaManager::new(db);
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        db.execute_unprepared(
            "INSERT INTO rca_delivery_obligations (id, org_id, run_id, response_id, subject, \
             ladder_run, state, next_attempt_at, created_at, updated_at) \
             VALUES ('o', 'acme', 'run', 'resp', '{}', 1, 'armed', 1, 1, 1)",
        )
        .await
        .unwrap();
        let row = db
            .query_one(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT attempts, kind, outcome FROM rca_delivery_obligations WHERE id = 'o'",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i32>("", "attempts").unwrap(), 0);
        assert_eq!(row.try_get::<Option<String>>("", "kind").unwrap(), None);
        assert_eq!(row.try_get::<Option<String>>("", "outcome").unwrap(), None);
        for index in [
            "rca_delivery_obligations_due_idx",
            "rca_delivery_obligations_run_idx",
        ] {
            assert!(
                manager
                    .has_index("rca_delivery_obligations", index)
                    .await
                    .unwrap(),
                "{index}"
            );
        }
        Migration.down(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();
        assert!(!manager.has_table("rca_delivery_obligations").await.unwrap());
    }
}
