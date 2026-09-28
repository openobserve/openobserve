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

use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const ENVIRONMENTS_ORG_NAME_IDX: &str = "synthetics_environments_org_name_idx";
const ENVIRONMENTS_ONE_GLOBAL_IDX: &str = "synthetics_environments_one_global_idx";
const GLOBAL_ORG_COLUMN: &str = "global_org_id";
const VARIABLES_ORG_IDX: &str = "synthetics_variables_org_idx";
const VARIABLES_UNIQUE_IDX: &str = "synthetics_variables_unique_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let backend = db.get_database_backend();
        manager.create_table(create_environments_table()).await?;
        manager
            .create_index(create_environments_org_name_idx())
            .await?;
        for sql in one_global_sql(backend) {
            db.execute(Statement::from_string(backend, sql)).await?;
        }
        manager
            .create_table(create_variables_table(backend))
            .await?;
        manager.create_index(create_variables_org_idx()).await?;
        manager.create_index(create_variables_unique_idx()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SyntheticsVariables::Table).to_owned())
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(SyntheticsEnvironments::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

fn create_environments_table() -> TableCreateStatement {
    Table::create()
        .table(SyntheticsEnvironments::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SyntheticsEnvironments::Id)
                .string_len(256)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(SyntheticsEnvironments::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsEnvironments::Name)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsEnvironments::Description)
                .text()
                .not_null()
                .default(""),
        )
        .col(ColumnDef::new(SyntheticsEnvironments::Owner).string_len(256))
        .col(
            ColumnDef::new(SyntheticsEnvironments::IsGlobal)
                .boolean()
                .not_null()
                .default(false),
        )
        .col(
            ColumnDef::new(SyntheticsEnvironments::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsEnvironments::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn create_environments_org_name_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(ENVIRONMENTS_ORG_NAME_IDX)
        .table(SyntheticsEnvironments::Table)
        .col(SyntheticsEnvironments::OrgId)
        .col(SyntheticsEnvironments::Name)
        .unique()
        .to_owned()
}

/// At most one global environment per org.
fn one_global_sql(backend: DatabaseBackend) -> Vec<String> {
    match backend {
        DatabaseBackend::Postgres => vec![format!(
            "CREATE UNIQUE INDEX IF NOT EXISTS {ENVIRONMENTS_ONE_GLOBAL_IDX} ON \
             synthetics_environments (org_id) WHERE is_global"
        )],
        DatabaseBackend::Sqlite => vec![format!(
            "CREATE UNIQUE INDEX IF NOT EXISTS {ENVIRONMENTS_ONE_GLOBAL_IDX} ON \
             synthetics_environments (org_id) WHERE is_global = 1"
        )],
        // MySQL has no partial index; a unique index skips NULLs, so index org_id only when global.
        DatabaseBackend::MySql => vec![
            format!(
                "ALTER TABLE synthetics_environments ADD COLUMN {GLOBAL_ORG_COLUMN} VARCHAR(100) \
                 GENERATED ALWAYS AS (CASE WHEN is_global THEN org_id END) STORED"
            ),
            format!(
                "CREATE UNIQUE INDEX {ENVIRONMENTS_ONE_GLOBAL_IDX} ON synthetics_environments \
                 ({GLOBAL_ORG_COLUMN})"
            ),
        ],
    }
}

/// A secret may not live in the global environment, whose id is `global_<org_id>`.
fn no_secret_in_global_check(backend: DatabaseBackend) -> String {
    let global_id = match backend {
        DatabaseBackend::MySql => "CONCAT('global_', org_id)",
        DatabaseBackend::Postgres | DatabaseBackend::Sqlite => "('global_' || org_id)",
    };
    format!("kind <> 'secret' OR env <> {global_id}")
}

fn create_variables_table(backend: DatabaseBackend) -> TableCreateStatement {
    Table::create()
        .table(SyntheticsVariables::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(SyntheticsVariables::Id)
                .string_len(256)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(SyntheticsVariables::OrgId)
                .string_len(100)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsVariables::Env)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsVariables::Name)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsVariables::Value)
                .text()
                .not_null()
                .default(""),
        )
        .col(
            ColumnDef::new(SyntheticsVariables::Kind)
                .string_len(16)
                .not_null()
                .default("plain"),
        )
        .col(
            ColumnDef::new(SyntheticsVariables::Description)
                .text()
                .not_null()
                .default(""),
        )
        .col(
            ColumnDef::new(SyntheticsVariables::Example)
                .text()
                .not_null()
                .default(""),
        )
        .col(ColumnDef::new(SyntheticsVariables::Tags).json().not_null())
        .col(ColumnDef::new(SyntheticsVariables::Owner).string_len(256))
        .col(
            ColumnDef::new(SyntheticsVariables::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(SyntheticsVariables::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .check(Expr::cust(no_secret_in_global_check(backend)))
        .foreign_key(
            ForeignKey::create()
                .name("synthetics_variables_env_fk")
                .from(SyntheticsVariables::Table, SyntheticsVariables::Env)
                .to(SyntheticsEnvironments::Table, SyntheticsEnvironments::Id),
        )
        .to_owned()
}

fn create_variables_org_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(VARIABLES_ORG_IDX)
        .table(SyntheticsVariables::Table)
        .col(SyntheticsVariables::OrgId)
        .to_owned()
}

fn create_variables_unique_idx() -> IndexCreateStatement {
    sea_query::Index::create()
        .if_not_exists()
        .name(VARIABLES_UNIQUE_IDX)
        .table(SyntheticsVariables::Table)
        .col(SyntheticsVariables::OrgId)
        .col(SyntheticsVariables::Env)
        .col(SyntheticsVariables::Name)
        .unique()
        .to_owned()
}

#[derive(DeriveIden)]
enum SyntheticsEnvironments {
    Table,
    Id,
    OrgId,
    Name,
    Description,
    Owner,
    IsGlobal,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SyntheticsVariables {
    Table,
    Id,
    OrgId,
    Env,
    Name,
    Value,
    Kind,
    Description,
    Example,
    Tags,
    Owner,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use collapse::*;
    use sea_orm::{ConnectOptions, Database, DatabaseConnection};

    use super::*;

    #[test]
    fn postgres() {
        collapsed_eq!(
            &create_environments_table().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_environments" (
                "id" varchar(256) NOT NULL PRIMARY KEY,
                "org_id" varchar(100) NOT NULL,
                "name" varchar(64) NOT NULL,
                "description" text NOT NULL DEFAULT '',
                "owner" varchar(256),
                "is_global" bool NOT NULL DEFAULT FALSE,
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL
            )"#
        );
        collapsed_eq!(
            &create_variables_table(DatabaseBackend::Postgres).to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_variables" (
                "id" varchar(256) NOT NULL PRIMARY KEY,
                "org_id" varchar(100) NOT NULL,
                "env" varchar(256) NOT NULL,
                "name" varchar(128) NOT NULL,
                "value" text NOT NULL DEFAULT '',
                "kind" varchar(16) NOT NULL DEFAULT 'plain',
                "description" text NOT NULL DEFAULT '',
                "example" text NOT NULL DEFAULT '',
                "tags" json NOT NULL,
                "owner" varchar(256),
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                CONSTRAINT "synthetics_variables_env_fk" FOREIGN KEY ("env") REFERENCES "synthetics_environments" ("id"),
                CHECK (kind <> 'secret' OR env <> ('global_' || org_id))
            )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_variables_table(DatabaseBackend::Sqlite).to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_variables" (
                "id" varchar(256) NOT NULL PRIMARY KEY,
                "org_id" varchar(100) NOT NULL,
                "env" varchar(256) NOT NULL,
                "name" varchar(128) NOT NULL,
                "value" text NOT NULL DEFAULT '',
                "kind" varchar(16) NOT NULL DEFAULT 'plain',
                "description" text NOT NULL DEFAULT '',
                "example" text NOT NULL DEFAULT '',
                "tags" json_text NOT NULL,
                "owner" varchar(256),
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                FOREIGN KEY ("env") REFERENCES "synthetics_environments" ("id"),
                CHECK (kind <> 'secret' OR env <> ('global_' || org_id))
            )"#
        );
    }

    #[test]
    fn mysql_holds_one_global_per_org_through_a_generated_column() {
        let sql = one_global_sql(DatabaseBackend::MySql);
        assert_eq!(sql.len(), 2);
        assert!(
            sql[0].contains("GENERATED ALWAYS AS (CASE WHEN is_global THEN org_id END)"),
            "{}",
            sql[0]
        );
        assert!(sql[1].starts_with("CREATE UNIQUE INDEX"), "{}", sql[1]);
        assert!(sql[1].contains("(global_org_id)"), "{}", sql[1]);
    }

    #[test]
    fn mysql_concatenates_with_concat_not_pipes() {
        // `||` is logical OR in MySQL, which would make the CHECK always true.
        let sql = no_secret_in_global_check(DatabaseBackend::MySql);
        assert!(sql.contains("CONCAT('global_', org_id)"), "{sql}");
        assert!(!sql.contains("||"), "{sql}");
    }

    #[test]
    fn the_check_names_the_id_the_table_layer_mints() {
        let id = crate::table::synthetics_environments::global_environment_id("acme");
        assert_eq!(id, "global_acme");
    }

    #[test]
    fn variable_names_are_unique_per_environment() {
        assert_eq!(
            &create_variables_unique_idx().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "synthetics_variables_unique_idx" ON "synthetics_variables" ("org_id", "env", "name")"#
        );
    }

    #[test]
    fn environment_names_are_unique_per_org() {
        assert_eq!(
            &create_environments_org_name_idx().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "synthetics_environments_org_name_idx" ON "synthetics_environments" ("org_id", "name")"#
        );
    }

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn migrated_sqlite() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        Migration.up(&SchemaManager::new(&db)).await.unwrap();
        db
    }

    async fn exec(db: &DatabaseConnection, sql: &str) -> Result<(), DbErr> {
        db.execute(Statement::from_string(
            DatabaseBackend::Sqlite,
            sql.to_string(),
        ))
        .await
        .map(|_| ())
    }

    fn insert_env(id: &str, name: &str, is_global: bool) -> String {
        format!(
            "INSERT INTO synthetics_environments (id, org_id, name, is_global, created_at, \
             updated_at) VALUES ('{id}', 'acme', '{name}', {}, 0, 0)",
            i32::from(is_global)
        )
    }

    fn insert_var(id: &str, env: &str, kind: &str) -> String {
        format!(
            "INSERT INTO synthetics_variables (id, org_id, env, name, kind, tags, created_at, \
             updated_at) VALUES ('{id}', 'acme', '{env}', 'TOKEN', '{kind}', '[]', 0, 0)"
        )
    }

    #[tokio::test]
    async fn a_second_global_environment_is_refused_by_the_partial_index() {
        let db = migrated_sqlite().await;
        exec(&db, &insert_env("global_acme", "global", true))
            .await
            .unwrap();
        assert!(
            exec(&db, &insert_env("other", "other", true))
                .await
                .is_err(),
            "a second is_global row under another name must be refused"
        );
        // The index is partial: ordinary environments are unaffected.
        exec(&db, &insert_env("e1", "staging", false))
            .await
            .unwrap();
        exec(&db, &insert_env("e2", "prod", false)).await.unwrap();
    }

    #[tokio::test]
    async fn the_table_refuses_a_secret_in_the_global_environment() {
        let db = migrated_sqlite().await;
        exec(&db, &insert_env("global_acme", "global", true))
            .await
            .unwrap();
        exec(&db, &insert_env("e-prod", "prod", false))
            .await
            .unwrap();

        assert!(
            exec(&db, &insert_var("v1", "global_acme", "secret"))
                .await
                .is_err()
        );
        exec(&db, &insert_var("v2", "global_acme", "plain"))
            .await
            .unwrap();
        exec(&db, &insert_var("v3", "e-prod", "secret"))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_variable_without_an_environment_is_refused() {
        let db = migrated_sqlite().await;
        let sql = "INSERT INTO synthetics_variables (id, org_id, env, name, kind, tags, \
                   created_at, updated_at) VALUES ('v1', 'acme', NULL, 'URL', 'plain', '[]', 0, 0)";
        assert!(exec(&db, sql).await.is_err());
    }
}
