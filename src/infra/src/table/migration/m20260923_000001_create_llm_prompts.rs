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
        manager.create_table(prompts()).await?;
        manager.create_table(versions()).await?;
        manager.create_table(labels()).await?;
        manager.create_table(label_events()).await?;
        manager.create_table(webhook_deliveries()).await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_llm_prompts_list")
                    .table(LlmPrompts::Table)
                    .col(LlmPrompts::OrgId)
                    .col(LlmPrompts::Status)
                    .col(LlmPrompts::FolderId)
                    .col(LlmPrompts::Name)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_llm_prompt_versions_local_hash")
                    .table(LlmPromptVersions::Table)
                    .col(LlmPromptVersions::EntityId)
                    .col(LlmPromptVersions::ContentHash)
                    .col(LlmPromptVersions::Version)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_llm_prompt_versions_org_hash")
                    .table(LlmPromptVersions::Table)
                    .col(LlmPromptVersions::OrgId)
                    .col(LlmPromptVersions::ContentHash)
                    .col(LlmPromptVersions::CreatedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_llm_prompt_label_events_page")
                    .table(LlmPromptLabelEvents::Table)
                    .col(LlmPromptLabelEvents::EntityId)
                    .col(LlmPromptLabelEvents::CreatedAt)
                    .col(LlmPromptLabelEvents::Id)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_llm_prompt_webhooks_due")
                    .table(LlmPromptWebhookDeliveries::Table)
                    .col(LlmPromptWebhookDeliveries::Status)
                    .col(LlmPromptWebhookDeliveries::NextAttemptAt)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LlmExperiments::Table)
                    .add_column(
                        ColumnDef::new(LlmExperiments::PromptId)
                            .string_len(27)
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LlmExperiments::Table)
                    .add_column(
                        ColumnDef::new(LlmExperiments::PromptName)
                            .string_len(256)
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LlmExperiments::Table)
                    .add_column(
                        ColumnDef::new(LlmExperiments::PromptVersion)
                            .integer()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LlmExperiments::Table)
                    .add_column(
                        ColumnDef::new(LlmExperiments::PromptContentHash)
                            .string_len(64)
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_llm_experiments_prompt_version")
                    .table(LlmExperiments::Table)
                    .col(LlmExperiments::OrgId)
                    .col(LlmExperiments::PromptId)
                    .col(LlmExperiments::PromptVersion)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_llm_experiments_prompt_hash")
                    .table(LlmExperiments::Table)
                    .col(LlmExperiments::OrgId)
                    .col(LlmExperiments::PromptContentHash)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_llm_experiments_prompt_hash")
                    .table(LlmExperiments::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .name("idx_llm_experiments_prompt_version")
                    .table(LlmExperiments::Table)
                    .to_owned(),
            )
            .await?;
        for column in [
            LlmExperiments::PromptContentHash,
            LlmExperiments::PromptVersion,
            LlmExperiments::PromptName,
            LlmExperiments::PromptId,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(LlmExperiments::Table)
                        .drop_column(column)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .drop_table(
                Table::drop()
                    .table(LlmPromptWebhookDeliveries::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(LlmPromptLabelEvents::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(LlmPromptLabels::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(LlmPromptVersions::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(LlmPrompts::Table).to_owned())
            .await?;
        Ok(())
    }
}

fn prompts() -> TableCreateStatement {
    Table::create()
        .table(LlmPrompts::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmPrompts::EntityId)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(ColumnDef::new(LlmPrompts::OrgId).string_len(256).not_null())
        .col(ColumnDef::new(LlmPrompts::Name).string_len(256).not_null())
        .col(
            ColumnDef::new(LlmPrompts::FolderId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPrompts::PromptType)
                .string_len(16)
                .not_null(),
        )
        .col(ColumnDef::new(LlmPrompts::Description).text().null())
        .col(ColumnDef::new(LlmPrompts::Tags).json().not_null())
        .col(ColumnDef::new(LlmPrompts::Status).string_len(16).not_null())
        .col(
            ColumnDef::new(LlmPrompts::LatestVersion)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPrompts::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPrompts::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPrompts::UpdatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPrompts::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .foreign_key(
            ForeignKey::create()
                .name("fk_llm_prompts_folder")
                .from(LlmPrompts::Table, LlmPrompts::FolderId)
                .to(Folders::Table, Folders::Id)
                .on_delete(ForeignKeyAction::Restrict),
        )
        .index(
            Index::create()
                .name("uq_llm_prompts_org_name")
                .col(LlmPrompts::OrgId)
                .col(LlmPrompts::Name)
                .unique(),
        )
        .to_owned()
}

fn versions() -> TableCreateStatement {
    Table::create()
        .table(LlmPromptVersions::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmPromptVersions::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmPromptVersions::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptVersions::EntityId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptVersions::Version)
                .integer()
                .not_null(),
        )
        .col(ColumnDef::new(LlmPromptVersions::Payload).json().not_null())
        .col(ColumnDef::new(LlmPromptVersions::Config).json().not_null())
        .col(
            ColumnDef::new(LlmPromptVersions::CommitMessage)
                .text()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptVersions::Source)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptVersions::BaseVersion)
                .integer()
                .null(),
        )
        .col(
            ColumnDef::new(LlmPromptVersions::ContentHash)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptVersions::CreatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptVersions::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .foreign_key(
            ForeignKey::create()
                .name("fk_llm_prompt_versions_prompt")
                .from(LlmPromptVersions::Table, LlmPromptVersions::EntityId)
                .to(LlmPrompts::Table, LlmPrompts::EntityId)
                .on_delete(ForeignKeyAction::Restrict),
        )
        .index(
            Index::create()
                .name("uq_llm_prompt_versions_entity_version")
                .col(LlmPromptVersions::EntityId)
                .col(LlmPromptVersions::Version)
                .unique(),
        )
        .to_owned()
}

fn labels() -> TableCreateStatement {
    Table::create()
        .table(LlmPromptLabels::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmPromptLabels::EntityId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptLabels::Name)
                .string_len(128)
                .not_null(),
        )
        .col(ColumnDef::new(LlmPromptLabels::Version).integer().null())
        .col(
            ColumnDef::new(LlmPromptLabels::DeletedAt)
                .big_integer()
                .null(),
        )
        .col(
            ColumnDef::new(LlmPromptLabels::UpdatedBy)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptLabels::UpdatedAt)
                .big_integer()
                .not_null(),
        )
        .primary_key(
            Index::create()
                .col(LlmPromptLabels::EntityId)
                .col(LlmPromptLabels::Name),
        )
        .foreign_key(
            ForeignKey::create()
                .name("fk_llm_prompt_labels_version")
                .from_tbl(LlmPromptLabels::Table)
                .from_col(LlmPromptLabels::EntityId)
                .from_col(LlmPromptLabels::Version)
                .to_tbl(LlmPromptVersions::Table)
                .to_col(LlmPromptVersions::EntityId)
                .to_col(LlmPromptVersions::Version)
                .on_delete(ForeignKeyAction::Restrict),
        )
        .to_owned()
}

fn label_events() -> TableCreateStatement {
    Table::create()
        .table(LlmPromptLabelEvents::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmPromptLabelEvents::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmPromptLabelEvents::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptLabelEvents::EntityId)
                .string_len(27)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptLabelEvents::Label)
                .string_len(128)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptLabelEvents::FromVersion)
                .integer()
                .null(),
        )
        .col(
            ColumnDef::new(LlmPromptLabelEvents::ToVersion)
                .integer()
                .null(),
        )
        .col(
            ColumnDef::new(LlmPromptLabelEvents::Actor)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptLabelEvents::Via)
                .string_len(32)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptLabelEvents::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .foreign_key(
            ForeignKey::create()
                .name("fk_llm_prompt_label_events_prompt")
                .from(LlmPromptLabelEvents::Table, LlmPromptLabelEvents::EntityId)
                .to(LlmPrompts::Table, LlmPrompts::EntityId)
                .on_delete(ForeignKeyAction::Restrict),
        )
        .to_owned()
}

fn webhook_deliveries() -> TableCreateStatement {
    Table::create()
        .table(LlmPromptWebhookDeliveries::Table)
        .if_not_exists()
        .col(
            ColumnDef::new(LlmPromptWebhookDeliveries::Id)
                .string_len(27)
                .not_null()
                .primary_key(),
        )
        .col(
            ColumnDef::new(LlmPromptWebhookDeliveries::OrgId)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptWebhookDeliveries::EventType)
                .string_len(64)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptWebhookDeliveries::Payload)
                .json()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptWebhookDeliveries::Endpoint)
                .string_len(2048)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptWebhookDeliveries::SecretRef)
                .string_len(256)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptWebhookDeliveries::Status)
                .string_len(16)
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptWebhookDeliveries::AttemptCount)
                .integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptWebhookDeliveries::NextAttemptAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptWebhookDeliveries::LastError)
                .text()
                .null(),
        )
        .col(
            ColumnDef::new(LlmPromptWebhookDeliveries::CreatedAt)
                .big_integer()
                .not_null(),
        )
        .col(
            ColumnDef::new(LlmPromptWebhookDeliveries::DeliveredAt)
                .big_integer()
                .null(),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum Folders {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum LlmPrompts {
    Table,
    EntityId,
    OrgId,
    Name,
    FolderId,
    PromptType,
    Description,
    Tags,
    Status,
    LatestVersion,
    CreatedBy,
    CreatedAt,
    UpdatedBy,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum LlmPromptVersions {
    Table,
    Id,
    OrgId,
    EntityId,
    Version,
    Payload,
    Config,
    CommitMessage,
    Source,
    BaseVersion,
    ContentHash,
    CreatedBy,
    CreatedAt,
}

#[derive(DeriveIden)]
enum LlmPromptLabels {
    Table,
    EntityId,
    Name,
    Version,
    DeletedAt,
    UpdatedBy,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum LlmPromptLabelEvents {
    Table,
    Id,
    OrgId,
    EntityId,
    Label,
    FromVersion,
    ToVersion,
    Actor,
    Via,
    CreatedAt,
}

#[derive(DeriveIden)]
enum LlmPromptWebhookDeliveries {
    Table,
    Id,
    OrgId,
    EventType,
    Payload,
    Endpoint,
    SecretRef,
    Status,
    AttemptCount,
    NextAttemptAt,
    LastError,
    CreatedAt,
    DeliveredAt,
}

#[derive(DeriveIden)]
enum LlmExperiments {
    Table,
    OrgId,
    PromptId,
    PromptName,
    PromptVersion,
    PromptContentHash,
}

#[cfg(test)]
mod tests {
    use sea_orm::DbBackend;

    use super::*;

    #[test]
    fn llm_prompt_schema_builds_for_every_supported_backend() {
        for backend in [DbBackend::Sqlite, DbBackend::Postgres, DbBackend::MySql] {
            for statement in [
                prompts(),
                versions(),
                labels(),
                label_events(),
                webhook_deliveries(),
            ] {
                let sql = backend.build(&statement).to_string();
                assert!(!sql.is_empty());
            }
        }
    }

    #[tokio::test]
    async fn llm_prompt_schema_enforces_identity_and_label_targets() {
        use sea_orm::{ConnectionTrait, Database};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE folders (
               id TEXT PRIMARY KEY,
               org TEXT NOT NULL,
               folder_id TEXT NOT NULL,
               name TEXT NOT NULL,
               description TEXT,
               type INTEGER NOT NULL,
               icon TEXT
             );
             CREATE TABLE llm_experiments (
               id TEXT PRIMARY KEY,
               org_id TEXT NOT NULL
             );",
        )
        .await
        .unwrap();
        crate::table::migration::create_llm_prompt_schema_for_test(&db)
            .await
            .unwrap();

        db.execute_unprepared(
            "INSERT INTO folders (id, org, folder_id, name, type)
             VALUES ('folder-pk', 'org-1', 'default', 'default', 5);
             INSERT INTO llm_prompts (
               entity_id, org_id, name, folder_id, prompt_type, tags, status,
               latest_version, created_by, created_at, updated_by, updated_at
             ) VALUES (
               'prompt-1', 'org-1', 'support', 'folder-pk', 'text', '[]', 'active',
               1, 'user', 1, 'user', 1
             );
             INSERT INTO llm_prompt_versions (
               id, org_id, entity_id, version, payload, config, commit_message,
               source, content_hash, created_by, created_at
             ) VALUES (
               'version-1', 'org-1', 'prompt-1', 1, '\"hello\"', '{}', 'initial',
               'ui', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
               'user', 1
             );
             INSERT INTO llm_prompt_labels (
               entity_id, name, version, updated_by, updated_at
             ) VALUES ('prompt-1', 'latest', 1, 'user', 1);
             INSERT INTO llm_prompt_labels (
               entity_id, name, version, deleted_at, updated_by, updated_at
             ) VALUES ('prompt-1', 'retired', NULL, 2, 'user', 2);",
        )
        .await
        .unwrap();

        assert!(
            db.execute_unprepared(
                "INSERT INTO llm_prompts (
                   entity_id, org_id, name, folder_id, prompt_type, tags, status,
                   latest_version, created_by, created_at, updated_by, updated_at
                 ) VALUES (
                   'prompt-2', 'org-1', 'support', 'folder-pk', 'text', '[]', 'active',
                   1, 'user', 1, 'user', 1
                 );",
            )
            .await
            .is_err()
        );
        assert!(
            db.execute_unprepared(
                "INSERT INTO llm_prompt_labels (
                   entity_id, name, version, updated_by, updated_at
                 ) VALUES ('prompt-1', 'production', 2, 'user', 2);",
            )
            .await
            .is_err()
        );
    }
}
