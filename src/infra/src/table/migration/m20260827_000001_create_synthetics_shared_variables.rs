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

//! Create `synthetics_environments` and `synthetics_variables` — the org-level
//! variable store, and the environments that scope it.
//!
//! Both tables are new, so both constraints are created with the table and
//! validated. Environments ship in the same migration as variables precisely so
//! that a secret can never pre-date the environment the CHECK requires it to
//! carry.

use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

const ENVIRONMENTS_ORG_NAME_IDX: &str = "synthetics_environments_org_name_idx";
const VARIABLES_ORG_IDX: &str = "synthetics_variables_org_idx";
const VARIABLES_UNIQUE_IDX: &str = "synthetics_variables_unique_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_environments_table()).await?;
        manager
            .create_index(create_environments_org_name_idx())
            .await?;
        manager.create_table(create_variables_table()).await?;
        manager.create_index(create_variables_org_idx()).await?;
        let db = manager.get_connection();
        let backend = db.get_database_backend();
        db.execute(Statement::from_string(backend, unique_index_sql(backend)))
            .await?;
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

fn create_variables_table() -> TableCreateStatement {
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
        // NULL means "every environment", which is why the unique index below
        // has to COALESCE it — see `unique_index_sql`.
        .col(ColumnDef::new(SyntheticsVariables::Env).string_len(256))
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
        // A secret's access boundary IS its environment: an unscoped secret
        // would be governed by the module umbrella, which is the broadest grant
        // in the feature. Enforced here rather than in the handler so no code
        // path can create one.
        .check(Expr::cust("kind <> 'secret' OR env IS NOT NULL"))
        .foreign_key(
            ForeignKey::create()
                .name("synthetics_variables_env_fk")
                .from(SyntheticsVariables::Table, SyntheticsVariables::Env)
                .to(
                    SyntheticsEnvironments::Table,
                    SyntheticsEnvironments::Id,
                ),
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

/// The uniqueness rule, as an expression index.
///
/// **`COALESCE(env, '')` is load-bearing.** PostgreSQL and SQLite both treat
/// NULLs as *distinct* inside a unique index, so a plain composite index over
/// `(org_id, env, name)` permits two unscoped `BASE_URL` rows — and then a run
/// resolves whichever the query planner returns first. `system_settings` has
/// exactly this defect; follow its table shape, not its index.
///
/// MySQL is not a supported meta store (`MetaStore` is `Sqlite | Nats |
/// PostgreSQL`), so its arm is the plain composite index rather than an
/// expression index its older versions cannot build.
fn unique_index_sql(backend: DatabaseBackend) -> String {
    match backend {
        DatabaseBackend::Postgres | DatabaseBackend::Sqlite => format!(
            "CREATE UNIQUE INDEX IF NOT EXISTS {VARIABLES_UNIQUE_IDX} ON synthetics_variables \
             (org_id, (COALESCE(env, '')), name)"
        ),
        DatabaseBackend::MySql => format!(
            "CREATE UNIQUE INDEX {VARIABLES_UNIQUE_IDX} ON synthetics_variables (org_id, env, name)"
        ),
    }
}

#[derive(DeriveIden)]
enum SyntheticsEnvironments {
    Table,
    Id,
    OrgId,
    Name,
    Description,
    Owner,
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
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL
            )"#
        );
        collapsed_eq!(
            &create_variables_table().to_string(PostgresQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_variables" (
                "id" varchar(256) NOT NULL PRIMARY KEY,
                "org_id" varchar(100) NOT NULL,
                "env" varchar(256),
                "name" varchar(128) NOT NULL,
                "value" text NOT NULL DEFAULT '',
                "kind" varchar(16) NOT NULL DEFAULT 'plain',
                "description" text NOT NULL DEFAULT '',
                "example" text NOT NULL DEFAULT '',
                "tags" json NOT NULL,
                "owner" varchar(256),
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                CHECK (kind <> 'secret' OR env IS NOT NULL),
                CONSTRAINT "synthetics_variables_env_fk" FOREIGN KEY ("env") REFERENCES "synthetics_environments" ("id")
            )"#
        );
    }

    #[test]
    fn sqlite() {
        collapsed_eq!(
            &create_variables_table().to_string(SqliteQueryBuilder),
            r#"
                CREATE TABLE IF NOT EXISTS "synthetics_variables" (
                "id" varchar(256) NOT NULL PRIMARY KEY,
                "org_id" varchar(100) NOT NULL,
                "env" varchar(256),
                "name" varchar(128) NOT NULL,
                "value" text NOT NULL DEFAULT '',
                "kind" varchar(16) NOT NULL DEFAULT 'plain',
                "description" text NOT NULL DEFAULT '',
                "example" text NOT NULL DEFAULT '',
                "tags" json_text NOT NULL,
                "owner" varchar(256),
                "created_at" bigint NOT NULL,
                "updated_at" bigint NOT NULL,
                CHECK (kind <> 'secret' OR env IS NOT NULL),
                FOREIGN KEY ("env") REFERENCES "synthetics_environments" ("id")
            )"#
        );
    }

    /// The COALESCE must survive review. Without it PostgreSQL and SQLite both
    /// accept two unscoped rows with the same name.
    #[test]
    fn the_unique_index_coalesces_a_null_environment() {
        for backend in [DatabaseBackend::Postgres, DatabaseBackend::Sqlite] {
            let sql = unique_index_sql(backend);
            assert!(sql.contains("COALESCE(env, '')"), "{backend:?}: {sql}");
            assert!(sql.contains("UNIQUE INDEX"), "{backend:?}: {sql}");
        }
    }

    #[test]
    fn environment_names_are_unique_per_org() {
        assert_eq!(
            &create_environments_org_name_idx().to_string(PostgresQueryBuilder),
            r#"CREATE UNIQUE INDEX IF NOT EXISTS "synthetics_environments_org_name_idx" ON "synthetics_environments" ("org_id", "name")"#
        );
    }
}
