// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(create_statement()).await?;
        manager.create_index(org_created_index()).await?;
        manager.create_index(org_accessed_index()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(LlmPlaygroundSnapshots::Table)
                    .to_owned(),
            )
            .await
    }
}

/// A shared Playground snapshot.
///
/// The Playground is volatile by design: running it persists nothing. Sharing
/// is the one moment state crosses the server boundary, and what it stores is
/// a photograph — every column, row, result and score copied **by value**, so
/// the snapshot keeps rendering after the dataset, scorer or provider it came
/// from has changed or been deleted.
///
/// The row is therefore immutable apart from `last_accessed_at`, which the
/// sliding TTL renews on every read. There is no status and no version: an
/// edit does not update a snapshot, it shares a new one.
fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(LlmPlaygroundSnapshots::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmPlaygroundSnapshots::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmPlaygroundSnapshots::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPlaygroundSnapshots::Payload)
                .json()
                .not_null(),
        )
        // Weak reference on purpose. The parent may be purged by the TTL sweep
        // while this child lives on, so there is no foreign key and the diff
        // degrades to "parent no longer available" rather than failing.
        .col(
            ColumnDef::new(LlmPlaygroundSnapshots::ParentSnapshotId)
                .string_len(27)
                .null(),
        )
        .col(
            ColumnDef::new(LlmPlaygroundSnapshots::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPlaygroundSnapshots::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPlaygroundSnapshots::LastAccessedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

/// Backs the org listing, which is ordered newest first.
fn org_created_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_llm_playground_snapshots_org_created")
        .table(LlmPlaygroundSnapshots::Table)
        .col(LlmPlaygroundSnapshots::OrgId)
        .col(LlmPlaygroundSnapshots::CreatedAt)
        .to_owned()
}

/// Backs both halves of the cleanup pass: expiring snapshots past the sliding
/// TTL, and trimming an organization back to its cap oldest-access-first.
fn org_accessed_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_llm_playground_snapshots_org_accessed")
        .table(LlmPlaygroundSnapshots::Table)
        .col(LlmPlaygroundSnapshots::OrgId)
        .col(LlmPlaygroundSnapshots::LastAccessedAt)
        .to_owned()
}

#[derive(DeriveIden)]
enum LlmPlaygroundSnapshots {
    Table,
    Id,
    OrgId,
    Payload,
    ParentSnapshotId,
    CreatedBy,
    CreatedAt,
    LastAccessedAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_the_whole_workbench_by_value() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"payload\" json NOT NULL"));
        assert!(sql.contains("\"created_by\" varchar(256) NOT NULL"));
        assert!(sql.contains("\"created_at\" bigint NOT NULL"));
        assert!(sql.contains("\"last_accessed_at\" bigint NOT NULL"));
    }

    #[test]
    fn lineage_is_optional_so_a_purged_parent_cannot_orphan_a_child() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"parent_snapshot_id\" varchar(27)"));
        assert!(!sql.contains("\"parent_snapshot_id\" varchar(27) NOT NULL"));
        // A foreign key would turn the TTL sweep into a cascade or a failure.
        assert!(!sql.to_uppercase().contains("FOREIGN KEY"));
    }

    #[test]
    fn carries_no_mutable_state_beyond_the_ttl_renewal() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        // A snapshot is immutable: sharing an edit creates a new row.
        assert!(!sql.contains("updated_at"));
        assert!(!sql.contains("\"status\""));
        assert!(!sql.contains("\"version\""));
    }

    #[test]
    fn builds_on_sqlite_as_well_as_postgres() {
        let sqlite = create_statement().to_string(SqliteQueryBuilder);
        assert!(sqlite.contains("\"payload\" json_text NOT NULL"));
        assert!(sqlite.contains("\"last_accessed_at\" bigint NOT NULL"));
        for index in [org_created_index(), org_accessed_index()] {
            assert!(index.to_string(SqliteQueryBuilder).contains("CREATE INDEX"));
        }
    }

    #[test]
    fn indexes_cover_listing_and_cleanup() {
        let created = org_created_index().to_string(PostgresQueryBuilder);
        assert!(created.contains("\"org_id\""));
        assert!(created.contains("\"created_at\""));

        let accessed = org_accessed_index().to_string(PostgresQueryBuilder);
        assert!(accessed.contains("\"org_id\""));
        assert!(accessed.contains("\"last_accessed_at\""));
    }
}
