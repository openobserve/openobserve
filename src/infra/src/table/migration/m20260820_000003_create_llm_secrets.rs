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
        manager.create_index(unique_ref_state_index()).await?;
        manager.create_index(owner_index()).await?;
        manager.create_index(grace_index()).await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(LlmSecrets::Table).to_owned())
            .await
    }
}

fn create_statement() -> TableCreateStatement {
    Table::create()
        .table(LlmSecrets::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmSecrets::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        // Stable handle stored by Task and Scorer versions. Rotation creates a
        // new row with the same handle and a different state.
        .col(
            ColumnDef::new(LlmSecrets::SecretRef)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmSecrets::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmSecrets::OwnerKind)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmSecrets::OwnerId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmSecrets::Purpose)
                .string_len(32)
                .not_null(),
        )
        .col(ColumnDef::new(LlmSecrets::KeyId).string_len(64).null())
        .col(
            ColumnDef::new(LlmSecrets::State)
                .string_len(16)
                .not_null(),
        )
        .col(ColumnDef::new(LlmSecrets::Ciphertext).text().not_null())
        .col(
            ColumnDef::new(LlmSecrets::LastVerifiedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(LlmSecrets::GraceExpiresAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(LlmSecrets::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmSecrets::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .to_owned()
}

fn unique_ref_state_index() -> IndexCreateStatement {
    Index::create()
        .name("uq_llm_secrets_ref_state")
        .table(LlmSecrets::Table)
        .col(LlmSecrets::SecretRef)
        .col(LlmSecrets::State)
        .unique()
        .to_owned()
}

fn owner_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_llm_secrets_owner")
        .table(LlmSecrets::Table)
        .col(LlmSecrets::OrgId)
        .col(LlmSecrets::OwnerKind)
        .col(LlmSecrets::OwnerId)
        .to_owned()
}

fn grace_index() -> IndexCreateStatement {
    Index::create()
        .name("idx_llm_secrets_grace")
        .table(LlmSecrets::Table)
        .col(LlmSecrets::State)
        .col(LlmSecrets::GraceExpiresAt)
        .to_owned()
}

#[derive(DeriveIden)]
enum LlmSecrets {
    Table,
    Id,
    SecretRef,
    OrgId,
    OwnerKind,
    OwnerId,
    Purpose,
    KeyId,
    State,
    Ciphertext,
    LastVerifiedAt,
    GraceExpiresAt,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_only_encrypted_secret_material() {
        let sql = create_statement().to_string(PostgresQueryBuilder);
        assert!(sql.contains("\"ciphertext\" text NOT NULL"));
        assert!(!sql.contains("plaintext"));
    }

    #[test]
    fn permits_only_one_value_in_each_rotation_state() {
        let sql = unique_ref_state_index().to_string(PostgresQueryBuilder);
        assert!(sql.contains("UNIQUE"));
        assert!(sql.contains("\"secret_ref\""));
        assert!(sql.contains("\"state\""));
    }
}
