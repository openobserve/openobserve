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

//! The runbook link is copied onto the record, so editing the alert cannot change a closed page.

use sea_orm_migration::prelude::*;

use super::get_text_type;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(OncallUserContacts::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallUserContacts::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(OncallUserContacts::OrgId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallUserContacts::UserEmail)
                            .string()
                            .not_null(),
                    )
                    // Nullable: a missing phone is a narrower chain, never an error.
                    .col(ColumnDef::new(OncallUserContacts::Phone).string().null())
                    // The safety interlock: no transport may page an unverified method.
                    .col(
                        ColumnDef::new(OncallUserContacts::PhoneVerifiedAt)
                            .big_integer()
                            .null(),
                    )
                    .col(ColumnDef::new(OncallUserContacts::PushToken).string().null())
                    .col(
                        ColumnDef::new(OncallUserContacts::PushVerifiedAt)
                            .big_integer()
                            .null(),
                    )
                    // Free text: a schema before a transport reads it is invented twice.
                    .col(
                        ColumnDef::new(OncallUserContacts::QuietHours)
                            .custom(Alias::new(get_text_type()))
                            .null(),
                    )
                    .col(
                        ColumnDef::new(OncallUserContacts::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // One profile per person per org: a second row makes "which phone do we call" a coin toss.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallUserContacts::Table)
                    .name("idx_oncall_user_contacts_org_user")
                    .col(OncallUserContacts::OrgId)
                    .col(OncallUserContacts::UserEmail)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(OncallDeliveryReads::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(OncallDeliveryReads::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(OncallDeliveryReads::OrgId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallDeliveryReads::UserEmail)
                            .string()
                            .not_null(),
                    )
                    // No foreign key: an inbox must never slow or block the engine here.
                    .col(
                        ColumnDef::new(OncallDeliveryReads::EventId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(OncallDeliveryReads::ReadAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // The uniqueness is the whole of the write logic: read twice, one row.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .table(OncallDeliveryReads::Table)
                    .name("idx_oncall_delivery_reads_org_user_event")
                    .col(OncallDeliveryReads::OrgId)
                    .col(OncallDeliveryReads::UserEmail)
                    .col(OncallDeliveryReads::EventId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        add_column(
            manager,
            "alerts",
            Alerts::RunbookUrl,
            ColumnDef::new(Alerts::RunbookUrl)
                .string()
                .null()
                .to_owned(),
        )
        .await?;

        add_column(
            manager,
            "oncall_responses",
            OncallResponses::RunbookUrl,
            ColumnDef::new(OncallResponses::RunbookUrl)
                .string()
                .null()
                .to_owned(),
        )
        .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // sea-query has no `drop_column_if_exists`, so a half-applied `up` needs the guard too.
        if manager
            .has_column("oncall_responses", "runbook_url")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(OncallResponses::Table)
                        .drop_column(OncallResponses::RunbookUrl)
                        .to_owned(),
                )
                .await?;
        }
        if manager.has_column("alerts", "runbook_url").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alerts::Table)
                        .drop_column(Alerts::RunbookUrl)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .drop_table(
                Table::drop()
                    .table(OncallDeliveryReads::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(OncallUserContacts::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

/// An explicit `has_column` guard: SQLite emits a plain `ADD COLUMN`, which a re-run dies on.
async fn add_column<C>(
    manager: &SchemaManager<'_>,
    table: &str,
    column: C,
    mut def: ColumnDef,
) -> Result<(), DbErr>
where
    C: IntoIden,
{
    let name = column.into_iden().to_string();
    if manager.has_column(table, &name).await? {
        return Ok(());
    }
    manager
        .alter_table(
            Table::alter()
                .table(Alias::new(table))
                .add_column(&mut def)
                .to_owned(),
        )
        .await
}

#[derive(DeriveIden)]
enum OncallUserContacts {
    Table,
    Id,
    OrgId,
    UserEmail,
    Phone,
    PhoneVerifiedAt,
    PushToken,
    PushVerifiedAt,
    QuietHours,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum OncallDeliveryReads {
    Table,
    Id,
    OrgId,
    UserEmail,
    EventId,
    ReadAt,
}

#[derive(DeriveIden)]
enum Alerts {
    Table,
    RunbookUrl,
}

#[derive(DeriveIden)]
enum OncallResponses {
    Table,
    RunbookUrl,
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, DatabaseConnection, Statement};
    use sea_orm_migration::{MigrationName, MigrationTrait};

    use super::*;

    const CONTACTS: &str = "oncall_user_contacts";
    const READS: &str = "oncall_delivery_reads";

    async fn columns(db: &DatabaseConnection, table: &str) -> Vec<String> {
        let rows = db
            .query_all(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                format!("SELECT name FROM pragma_table_info('{table}') ORDER BY name"),
            ))
            .await
            .unwrap();
        rows.iter()
            .map(|r| r.try_get::<String>("", "name").unwrap())
            .collect()
    }

    /// A stand-in for the two ALTERed tables, so the test need not replay sixty migrations.
    async fn stub_altered_tables(db: &DatabaseConnection) {
        for ddl in [
            "CREATE TABLE alerts (id TEXT NOT NULL PRIMARY KEY)",
            "CREATE TABLE oncall_responses (id TEXT NOT NULL PRIMARY KEY)",
        ] {
            db.execute(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                ddl.to_owned(),
            ))
            .await
            .unwrap();
        }
    }

    #[tokio::test]
    async fn test_up_creates_both_tables_and_is_idempotent() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        stub_altered_tables(&db).await;
        let manager = SchemaManager::new(&db);

        Migration.up(&manager).await.expect("first run");
        // A node that died between the first table and the last ALTER must finish on restart.
        Migration.up(&manager).await.expect("second run");

        assert_eq!(
            columns(&db, CONTACTS).await,
            vec![
                "id",
                "org_id",
                "phone",
                "phone_verified_at",
                "push_token",
                "push_verified_at",
                "quiet_hours",
                "updated_at",
                "user_email",
            ]
        );
        assert_eq!(
            columns(&db, READS).await,
            vec!["event_id", "id", "org_id", "read_at", "user_email"]
        );
        assert!(
            manager
                .has_index(CONTACTS, "idx_oncall_user_contacts_org_user")
                .await
                .unwrap()
        );
        assert!(
            manager
                .has_index(READS, "idx_oncall_delivery_reads_org_user_event")
                .await
                .unwrap()
        );
        assert!(columns(&db, "alerts").await.contains(&"runbook_url".into()));
        assert!(
            columns(&db, "oncall_responses")
                .await
                .contains(&"runbook_url".into())
        );
    }

    /// Two rows would make "which number do we call at 3am" a coin toss.
    #[tokio::test]
    async fn test_a_second_profile_for_the_same_person_is_refused() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        stub_altered_tables(&db).await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        let insert = |id: &str| {
            format!(
                "INSERT INTO oncall_user_contacts (id, org_id, user_email, updated_at) \
                 VALUES ('{id}', 'default', 'ana@o2.ai', 1)"
            )
        };
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            insert("c_1"),
        ))
        .await
        .expect("the first profile inserts");
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            insert("c_2"),
        ))
        .await
        .expect_err("a second profile for the same person must be refused");
    }

    /// Marking read twice must leave one row, or a badge counts the same page more than once.
    #[tokio::test]
    async fn test_marking_the_same_delivery_read_twice_is_refused() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        stub_altered_tables(&db).await;
        Migration.up(&SchemaManager::new(&db)).await.unwrap();

        let insert = |id: &str| {
            format!(
                "INSERT INTO oncall_delivery_reads (id, org_id, user_email, event_id, read_at) \
                 VALUES ('{id}', 'default', 'ana@o2.ai', 'ev_1', 1)"
            )
        };
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            insert("r_1"),
        ))
        .await
        .unwrap();
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            insert("r_2"),
        ))
        .await
        .expect_err("a duplicate read marker must be refused");
    }

    /// Testing only fresh installs cost two P0s: a column missing on upgrade is "no such column".
    #[tokio::test]
    async fn test_an_upgraded_database_gains_the_tables_and_the_columns() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let manager = SchemaManager::new(&db);
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "CREATE TABLE alerts (id TEXT NOT NULL PRIMARY KEY)".to_owned(),
        ))
        .await
        .unwrap();
        super::super::m20260806_000001_create_oncall_tables::Migration
            .up(&manager)
            .await
            .unwrap();
        super::super::m20260807_000001_create_oncall_ownership::Migration
            .up(&manager)
            .await
            .unwrap();
        super::super::m20260811_000001_create_oncall_unrouted_signals::Migration
            .up(&manager)
            .await
            .unwrap();
        super::super::m20260812_000001_create_oncall_routing_config::Migration
            .up(&manager)
            .await
            .unwrap();
        super::super::m20260812_000002_create_oncall_overrides::Migration
            .up(&manager)
            .await
            .unwrap();
        assert!(
            !manager.has_table(CONTACTS).await.unwrap(),
            "precondition: the upgraded database has no contacts table yet"
        );
        assert!(
            !columns(&db, "oncall_responses")
                .await
                .contains(&"runbook_url".into()),
            "precondition: the upgraded database has no runbook column yet"
        );

        Migration
            .up(&manager)
            .await
            .expect("the upgrade must apply");

        assert!(manager.has_table(CONTACTS).await.unwrap());
        assert!(manager.has_table(READS).await.unwrap());
        assert!(
            columns(&db, "oncall_responses")
                .await
                .contains(&"runbook_url".into())
        );

        // And they are actually writable, which the schema check above cannot prove on its own.
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "INSERT INTO oncall_user_contacts (id, org_id, user_email, phone, updated_at) \
             VALUES ('c_1', 'default', 'ana@o2.ai', '+15550100', 1)"
                .to_owned(),
        ))
        .await
        .expect("a contact profile must be insertable after the upgrade");
        db.execute(Statement::from_string(
            sea_orm::DbBackend::Sqlite,
            "INSERT INTO oncall_responses \
             (id, org_id, subject_type, subject_id, team_id, responder_role, priority, state, \
              opened_at, runbook_url) \
             VALUES ('r_1', 'default', 1, 'al_ckt#1', 'team_1', 1, 2, 1, 1, 'https://rb/x')"
                .to_owned(),
        ))
        .await
        .expect("a record must carry a runbook after the upgrade");
    }

    /// Upgrade and fresh install must end in the same schema, or only one path is tested.
    #[tokio::test]
    async fn test_upgraded_schema_matches_fresh_schema() {
        let fresh = Database::connect("sqlite::memory:").await.unwrap();
        stub_altered_tables(&fresh).await;
        Migration.up(&SchemaManager::new(&fresh)).await.unwrap();

        let upgraded = Database::connect("sqlite::memory:").await.unwrap();
        let mgr = SchemaManager::new(&upgraded);
        upgraded
            .execute(Statement::from_string(
                sea_orm::DbBackend::Sqlite,
                "CREATE TABLE alerts (id TEXT NOT NULL PRIMARY KEY)".to_owned(),
            ))
            .await
            .unwrap();
        super::super::m20260806_000001_create_oncall_tables::Migration
            .up(&mgr)
            .await
            .unwrap();
        Migration.up(&mgr).await.unwrap();

        for table in [CONTACTS, READS] {
            assert_eq!(
                columns(&fresh, table).await,
                columns(&upgraded, table).await,
                "table={table}"
            );
        }
    }

    #[tokio::test]
    async fn test_down_drops_what_up_added() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        stub_altered_tables(&db).await;
        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.unwrap();
        Migration.down(&manager).await.unwrap();

        assert!(!manager.has_table(CONTACTS).await.unwrap());
        assert!(!manager.has_table(READS).await.unwrap());
        assert!(!columns(&db, "alerts").await.contains(&"runbook_url".into()));
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20260812_000003_create_oncall_contacts_and_reads"
        );
    }
}
