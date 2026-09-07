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

//! Org teardown for the raman tables.

use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait};

use super::entity::{raman_configs, raman_digests};
use crate::errors::Error;

/// Removes the org's raman config together with every digest it produced.
pub async fn delete_by_org(db: &DatabaseConnection, org: &str) -> Result<(), Error> {
    let txn = db.begin().await?;
    // Digests identify their run through `config_id`, so they go before the config.
    raman_digests::Entity::delete_many()
        .filter(raman_digests::Column::Org.eq(org))
        .exec(&txn)
        .await?;
    raman_configs::Entity::delete_many()
        .filter(raman_configs::Column::Org.eq(org))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{
        ActiveModelTrait, ActiveValue::Set, ConnectionTrait, Database, DatabaseBackend, Statement,
    };

    use super::*;
    use crate::table::migration::{create_raman_tables_for_test, raman_migration_sql_for_test};

    const ORG: &str = "acme";
    const OTHER_ORG: &str = "globex";

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_raman_tables_for_test(&db).await.unwrap();
        db
    }

    /// Every table the raman migration creates, read from the migration itself
    /// so a table added later cannot quietly escape the sweep test below.
    fn migrated_tables() -> Vec<String> {
        raman_migration_sql_for_test(DatabaseBackend::Sqlite)
            .iter()
            .filter_map(|sql| {
                sql.to_lowercase()
                    .starts_with("create table")
                    .then(|| sql.split('"').nth(1).expect("a quoted table name"))
                    .map(str::to_string)
            })
            .collect()
    }

    /// (name, type, notnull, has_default) for each column of `table`.
    async fn columns(db: &DatabaseConnection, table: &str) -> Vec<(String, String, bool, bool)> {
        db.query_all(Statement::from_string(
            DatabaseBackend::Sqlite,
            format!("PRAGMA table_info('{table}')"),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| {
            (
                row.try_get::<String>("", "name").unwrap(),
                row.try_get::<String>("", "type").unwrap().to_lowercase(),
                row.try_get::<i32>("", "notnull").unwrap() == 1,
                row.try_get::<Option<String>>("", "dflt_value")
                    .unwrap()
                    .is_some(),
            )
        })
        .collect()
    }

    fn literal(table: &str, column: &str, column_type: &str, seed: &str) -> String {
        let base = column_type.split('(').next().unwrap_or_default().trim();
        match base {
            "varchar" | "char" | "text" | "string" => format!("'{seed}'"),
            "json_text" | "json" | "jsonb" => "'[]'".to_string(),
            "integer" | "int" | "bigint" | "smallint" => "1".to_string(),
            "boolean" => "0".to_string(),
            "real" | "double" | "float" | "decimal" => "1.0".to_string(),
            _ => panic!("{table}.{column} has type {column_type}; teach this fixture about it"),
        }
    }

    async fn insert_row(db: &DatabaseConnection, table: &str, org: &str, seed: &str) {
        let mut names = Vec::new();
        let mut values = Vec::new();
        for (name, column_type, notnull, has_default) in columns(db, table).await {
            if !notnull || has_default {
                continue;
            }
            values.push(if name == "org" {
                format!("'{org}'")
            } else {
                literal(table, &name, &column_type, seed)
            });
            names.push(format!("\"{name}\""));
        }
        db.execute(Statement::from_string(
            DatabaseBackend::Sqlite,
            format!(
                "INSERT INTO \"{table}\" ({}) VALUES ({})",
                names.join(", "),
                values.join(", ")
            ),
        ))
        .await
        .unwrap();
    }

    async fn count(db: &DatabaseConnection, table: &str, org: &str) -> i64 {
        db.query_one(Statement::from_string(
            DatabaseBackend::Sqlite,
            format!("SELECT COUNT(*) AS n FROM \"{table}\" WHERE org = '{org}'"),
        ))
        .await
        .unwrap()
        .unwrap()
        .try_get::<i64>("", "n")
        .unwrap()
    }

    async fn has_org_column(db: &DatabaseConnection, table: &str) -> bool {
        columns(db, table)
            .await
            .iter()
            .any(|(name, ..)| name == "org")
    }

    /// The completeness pin: a raman table added to the migration but not to
    /// `delete_by_org` fails here, without anyone remembering to update a list.
    #[tokio::test]
    async fn delete_by_org_sweeps_every_org_scoped_raman_table() {
        let db = db().await;
        let tables = migrated_tables();
        assert!(!tables.is_empty(), "the raman migration creates tables");

        let mut swept = Vec::new();
        for table in &tables {
            // A table with no org column resolves its org through a parent, not here.
            if !has_org_column(&db, table).await {
                continue;
            }
            insert_row(&db, table, ORG, "a").await;
            insert_row(&db, table, OTHER_ORG, "b").await;
            swept.push(table.clone());
        }
        assert!(!swept.is_empty(), "no org-scoped raman table was exercised");

        delete_by_org(&db, ORG).await.unwrap();

        for table in &swept {
            assert_eq!(count(&db, table, ORG).await, 0, "{table} was not swept");
            assert_eq!(
                count(&db, table, OTHER_ORG).await,
                1,
                "{table}: another org's rows were deleted"
            );
        }
    }

    /// The consequence the sweep exists to prevent: `idx_raman_configs_org` is
    /// UNIQUE, and auto-provisioned orgs reuse the deleted org's identifier.
    #[tokio::test]
    async fn a_recreated_org_can_still_write_its_config() {
        let db = db().await;
        raman_configs::ActiveModel {
            id: Set("config-1".to_string()),
            org: Set(ORG.to_string()),
            ..Default::default()
        }
        .insert(&db)
        .await
        .unwrap();

        delete_by_org(&db, ORG).await.unwrap();

        raman_configs::ActiveModel {
            id: Set("config-2".to_string()),
            org: Set(ORG.to_string()),
            ..Default::default()
        }
        .insert(&db)
        .await
        .expect("a leftover config row blocked the re-created org");
    }

    #[tokio::test]
    async fn delete_by_org_is_a_no_op_for_an_org_that_never_used_raman() {
        let db = db().await;
        insert_row(&db, "raman_configs", OTHER_ORG, "b").await;
        delete_by_org(&db, ORG).await.unwrap();
        assert_eq!(count(&db, "raman_configs", OTHER_ORG).await, 1);
    }
}
