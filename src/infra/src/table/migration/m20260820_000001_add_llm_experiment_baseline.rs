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

/// One Baseline per organization and Dataset (A2.1, A9).
///
/// Postgres and SQLite express that directly as a partial unique index, which
/// makes a second Baseline impossible no matter which writer attempts it.
/// MySQL has no partial index, so it gets a plain lookup index and relies on
/// the single transaction that clears the old flag and sets the new one.
const INDEX_NAME: &str = "llm_experiments_baseline_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column(LlmExperiments::Table.to_string(), "is_baseline")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(LlmExperiments::Table)
                        .add_column(
                            ColumnDef::new(LlmExperiments::IsBaseline)
                                .boolean()
                                .not_null()
                                .default(false),
                        )
                        .to_owned(),
                )
                .await?;
        }
        let db = manager.get_connection();
        let sql = baseline_index_sql(db.get_database_backend());
        db.execute(Statement::from_string(db.get_database_backend(), sql))
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let backend = db.get_database_backend();
        let drop = match backend {
            DatabaseBackend::MySql => {
                format!("DROP INDEX {INDEX_NAME} ON llm_experiments")
            }
            _ => format!("DROP INDEX IF EXISTS {INDEX_NAME}"),
        };
        db.execute(Statement::from_string(backend, drop)).await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LlmExperiments::Table)
                    .drop_column(LlmExperiments::IsBaseline)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

fn baseline_index_sql(backend: DatabaseBackend) -> String {
    match backend {
        DatabaseBackend::Postgres => format!(
            "CREATE UNIQUE INDEX IF NOT EXISTS {INDEX_NAME} ON llm_experiments (org_id, \
             dataset_id) WHERE is_baseline"
        ),
        DatabaseBackend::Sqlite => format!(
            "CREATE UNIQUE INDEX IF NOT EXISTS {INDEX_NAME} ON llm_experiments (org_id, \
             dataset_id) WHERE is_baseline = 1"
        ),
        DatabaseBackend::MySql => format!(
            "CREATE INDEX {INDEX_NAME} ON llm_experiments (org_id, dataset_id, is_baseline)"
        ),
    }
}

#[derive(DeriveIden)]
enum LlmExperiments {
    Table,
    IsBaseline,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_baseline_row_can_exist_per_org_and_dataset() {
        let postgres = baseline_index_sql(DatabaseBackend::Postgres);
        assert!(postgres.contains("UNIQUE"));
        assert!(postgres.ends_with("WHERE is_baseline"));

        let sqlite = baseline_index_sql(DatabaseBackend::Sqlite);
        assert!(sqlite.contains("UNIQUE"));
        assert!(sqlite.ends_with("WHERE is_baseline = 1"));

        // MySQL has no partial index; the transactional swap is the guarantee
        // there, so the index exists only to make the lookup cheap.
        let mysql = baseline_index_sql(DatabaseBackend::MySql);
        assert!(!mysql.contains("UNIQUE"));
    }
}
