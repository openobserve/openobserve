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

//! Renames `llm_secrets` to `credential_values`. On PostgreSQL a view keeps the old name
//! readable and writable for older nodes still running; index names stay as they are.

use sea_orm::{ConnectionTrait, DatabaseBackend, Statement, TransactionTrait};
use sea_orm_migration::prelude::*;

pub(crate) const OLD_NAME: &str = "llm_secrets";
pub(crate) const NEW_NAME: &str = "credential_values";

/// Privileges a table grant may carry; anything else in the ACL is not copied.
const VIEW_PRIVILEGES: [&str; 7] = [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
];

/// Every grant on the renamed table except its owner's, with PUBLIC spelled as such.
const TABLE_GRANTS_SQL: &str = "SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' \
     ELSE quote_ident(r.rolname) END AS grantee, a.privilege_type, a.is_grantable \
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
     CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee \
     WHERE n.nspname = current_schema() AND c.relname = 'credential_values' \
     AND a.grantee <> c.relowner";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        match conn.get_database_backend() {
            DatabaseBackend::Postgres => {
                if pg_relkind(conn, OLD_NAME).await?.as_deref() != Some("r") {
                    return Ok(());
                }
                let txn = conn.begin().await?;
                txn.execute_unprepared(&format!("ALTER TABLE {OLD_NAME} RENAME TO {NEW_NAME}"))
                    .await?;
                txn.execute_unprepared(&format!(
                    "CREATE VIEW {OLD_NAME} AS SELECT * FROM {NEW_NAME}"
                ))
                .await?;
                for grant in view_grants(&txn).await? {
                    txn.execute_unprepared(&grant).await?;
                }
                txn.commit().await
            }
            _ => {
                if manager.has_table(NEW_NAME).await? {
                    return Ok(());
                }
                rename(manager, OLD_NAME, NEW_NAME).await
            }
        }
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        if conn.get_database_backend() == DatabaseBackend::Postgres {
            if pg_relkind(conn, NEW_NAME).await?.as_deref() != Some("r") {
                return Ok(());
            }
            let txn = conn.begin().await?;
            txn.execute_unprepared(&format!("DROP VIEW IF EXISTS {OLD_NAME}"))
                .await?;
            txn.execute_unprepared(&format!("ALTER TABLE {NEW_NAME} RENAME TO {OLD_NAME}"))
                .await?;
            return txn.commit().await;
        }
        if !manager.has_table(NEW_NAME).await? {
            return Ok(());
        }
        rename(manager, NEW_NAME, OLD_NAME).await
    }
}

async fn rename(manager: &SchemaManager<'_>, from: &str, to: &str) -> Result<(), DbErr> {
    manager
        .rename_table(
            Table::rename()
                .table(Alias::new(from), Alias::new(to))
                .to_owned(),
        )
        .await
}

/// `r` table, `v` view, `None` absent, in the current schema.
async fn pg_relkind<C: ConnectionTrait>(conn: &C, name: &str) -> Result<Option<String>, DbErr> {
    let row = conn
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT c.relkind::text AS relkind FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = current_schema() AND c.relname = $1",
            [name.into()],
        ))
        .await?;
    row.map(|r| r.try_get::<String>("", "relkind")).transpose()
}

/// The new view starts with only its owner's rights, so an application role that is not
/// the migration role would lose every read and write under the old name.
async fn view_grants<C: ConnectionTrait>(conn: &C) -> Result<Vec<String>, DbErr> {
    let rows = conn
        .query_all(Statement::from_string(
            DatabaseBackend::Postgres,
            TABLE_GRANTS_SQL,
        ))
        .await?;
    let mut grants = Vec::with_capacity(rows.len());
    for row in rows {
        let grantee: String = row.try_get("", "grantee")?;
        let privilege: String = row.try_get("", "privilege_type")?;
        let grantable: bool = row.try_get("", "is_grantable")?;
        if !VIEW_PRIVILEGES.contains(&privilege.as_str()) {
            continue;
        }
        let option = if grantable { " WITH GRANT OPTION" } else { "" };
        grants.push(format!(
            "GRANT {privilege} ON {OLD_NAME} TO {grantee}{option}"
        ));
    }
    Ok(grants)
}

#[cfg(test)]
mod tests {
    use sea_orm::{
        ActiveModelTrait, ColumnTrait, Database, EntityTrait, QueryFilter, QuerySelect, Set,
    };

    use super::*;
    use crate::table::{entity::credential_values, testing::meta_store};

    /// The entity an older node still runs: same columns, the old table name.
    mod n_minus_one {
        use sea_orm::entity::prelude::*;

        #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
        #[sea_orm(table_name = "llm_secrets")]
        pub struct Model {
            #[sea_orm(primary_key, auto_increment = false)]
            pub id: String,
            pub secret_ref: String,
            pub org_id: String,
            pub owner_kind: String,
            pub owner_id: String,
            pub purpose: String,
            pub key_id: Option<String>,
            pub state: String,
            pub ciphertext: String,
            pub last_verified_at: Option<i64>,
            pub grace_expires_at: Option<i64>,
            pub created_at: i64,
            pub updated_at: i64,
        }

        #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
        pub enum Relation {}

        impl ActiveModelBehavior for ActiveModel {}
    }

    fn old_row(id: &str, secret_ref: &str, org: &str) -> n_minus_one::ActiveModel {
        n_minus_one::ActiveModel {
            id: Set(id.to_string()),
            secret_ref: Set(secret_ref.to_string()),
            org_id: Set(org.to_string()),
            owner_kind: Set("Task".to_string()),
            owner_id: Set(id.to_string()),
            purpose: Set("api_key".to_string()),
            key_id: Set(None),
            state: Set("active".to_string()),
            ciphertext: Set("c".to_string()),
            last_verified_at: Set(None),
            grace_expires_at: Set(None),
            created_at: Set(1),
            updated_at: Set(1),
        }
    }

    #[tokio::test]
    async fn sqlite_renames_the_table_keeps_rows_and_makes_no_view() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        super::super::m20260820_000003_create_llm_secrets::Migration
            .up(&manager)
            .await
            .unwrap();
        old_row("r1", "ref1", "acme").insert(&db).await.unwrap();

        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert!(!manager.has_table(OLD_NAME).await.unwrap());
        let rows = credential_values::Entity::find().all(&db).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "r1");
        assert!(
            manager
                .has_index(NEW_NAME, "uq_llm_secrets_ref_state")
                .await
                .unwrap()
        );

        Migration.down(&manager).await.unwrap();
        assert!(manager.has_table(OLD_NAME).await.unwrap());
        assert!(!manager.has_table(NEW_NAME).await.unwrap());
        Migration.up(&manager).await.unwrap();
        assert!(manager.has_table(NEW_NAME).await.unwrap());
    }

    #[tokio::test]
    async fn an_older_node_reads_and_writes_through_the_postgres_view() {
        if !meta_store().await {
            return;
        }
        let conn = crate::db::get_orm_client_rw().await;
        if conn.get_database_backend() != DatabaseBackend::Postgres {
            let manager = SchemaManager::new(conn);
            assert!(!manager.has_table(OLD_NAME).await.unwrap(), "no view");
            return;
        }
        assert_eq!(
            pg_relkind(conn, OLD_NAME).await.unwrap().as_deref(),
            Some("v")
        );
        assert_eq!(
            pg_relkind(conn, NEW_NAME).await.unwrap().as_deref(),
            Some("r")
        );
        let org = crate::table::testing::unique("n1");
        let (a, b) = (config::ider::ksuid(), config::ider::ksuid());
        let secret_ref = config::ider::ksuid();

        old_row(&a, &secret_ref, &org).insert(conn).await.unwrap();
        let through_table = credential_values::Entity::find_by_id(a.clone())
            .one(conn)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(through_table.org_id, org);

        let dup = old_row(&b, &secret_ref, &org)
            .insert(conn)
            .await
            .unwrap_err();
        assert!(
            dup.to_string().contains("uq_llm_secrets_ref_state"),
            "the old duplicate matcher still sees its index name: {dup}"
        );

        let mut am: n_minus_one::ActiveModel = n_minus_one::Entity::find_by_id(a.clone())
            .lock_exclusive()
            .one(conn)
            .await
            .unwrap()
            .unwrap()
            .into();
        am.state = Set("retired".to_string());
        am.update(conn).await.unwrap();
        let updated = credential_values::Entity::find_by_id(a.clone())
            .one(conn)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(updated.state, "retired");

        n_minus_one::Entity::delete_many()
            .filter(n_minus_one::Column::OrgId.eq(org.as_str()))
            .exec(conn)
            .await
            .unwrap();
        assert!(
            credential_values::Entity::find_by_id(a)
                .one(conn)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn postgres_copies_every_table_grant_to_the_view() {
        if !meta_store().await {
            return;
        }
        let conn = crate::db::get_orm_client_rw().await;
        if conn.get_database_backend() != DatabaseBackend::Postgres {
            return;
        }
        let role = format!("o2_view_{}", config::utils::time::now_micros());
        conn.execute_unprepared(&format!("CREATE ROLE {role}"))
            .await
            .unwrap();
        let manager = SchemaManager::new(conn);
        Migration.down(&manager).await.unwrap();
        conn.execute_unprepared(&format!("GRANT SELECT, INSERT ON {OLD_NAME} TO {role}"))
            .await
            .unwrap();
        Migration.up(&manager).await.unwrap();

        let row = conn
            .query_one(Statement::from_string(
                DatabaseBackend::Postgres,
                format!(
                    "SELECT has_table_privilege('{role}', '{OLD_NAME}', 'SELECT') AS s, \
                     has_table_privilege('{role}', '{OLD_NAME}', 'INSERT') AS i, \
                     has_table_privilege('{role}', '{OLD_NAME}', 'DELETE') AS d"
                ),
            ))
            .await
            .unwrap()
            .unwrap();
        assert!(row.try_get::<bool>("", "s").unwrap());
        assert!(row.try_get::<bool>("", "i").unwrap());
        assert!(!row.try_get::<bool>("", "d").unwrap());
        conn.execute_unprepared(&format!(
            "REVOKE ALL ON {OLD_NAME} FROM {role}; REVOKE ALL ON {NEW_NAME} FROM {role}; \
             DROP ROLE {role}"
        ))
        .await
        .unwrap();
    }
}
