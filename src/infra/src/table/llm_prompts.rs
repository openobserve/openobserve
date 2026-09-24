// Copyright 2026 OpenObserve Inc.
//
// Database-only adapters for the Prompt registry. Domain invariants and
// transaction boundaries belong to openobserve-core::prompts.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, Set, TransactionTrait, sea_query::OnConflict,
};

use super::entity::{
    llm_prompt_label_events as label_events, llm_prompt_labels as labels,
    llm_prompt_versions as versions, llm_prompt_webhook_deliveries as deliveries,
    llm_prompts as prompts,
};

#[derive(Clone, Debug, PartialEq)]
pub struct PinnedPrompt {
    pub prompt: prompts::Model,
    pub version: versions::Model,
}

pub async fn insert_head<C: ConnectionTrait>(
    db: &C,
    model: prompts::ActiveModel,
) -> Result<prompts::Model, sea_orm::DbErr> {
    model.insert(db).await
}

pub async fn update_head<C: ConnectionTrait>(
    db: &C,
    model: prompts::ActiveModel,
) -> Result<prompts::Model, sea_orm::DbErr> {
    model.update(db).await
}

pub async fn get_head<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    entity_id: &str,
) -> Result<Option<prompts::Model>, sea_orm::DbErr> {
    prompts::Entity::find_by_id(entity_id)
        .filter(prompts::Column::OrgId.eq(org_id))
        .one(db)
        .await
}

pub async fn get_head_for_update<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    entity_id: &str,
) -> Result<Option<prompts::Model>, sea_orm::DbErr> {
    prompts::Entity::find_by_id(entity_id)
        .filter(prompts::Column::OrgId.eq(org_id))
        .lock_exclusive()
        .one(db)
        .await
}

pub async fn get_head_by_name<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    name: &str,
) -> Result<Option<prompts::Model>, sea_orm::DbErr> {
    prompts::Entity::find()
        .filter(prompts::Column::OrgId.eq(org_id))
        .filter(prompts::Column::Name.eq(name))
        .one(db)
        .await
}

pub async fn list_heads<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    include_archived: bool,
    folder_id: Option<&str>,
) -> Result<Vec<prompts::Model>, sea_orm::DbErr> {
    let mut query = prompts::Entity::find().filter(prompts::Column::OrgId.eq(org_id));
    if !include_archived {
        query = query.filter(prompts::Column::Status.eq("active"));
    }
    if let Some(folder_id) = folder_id {
        query = query.filter(prompts::Column::FolderId.eq(folder_id));
    }
    query.order_by_asc(prompts::Column::Name).all(db).await
}

/// Immutable version insert. No update or delete adapter is intentionally exposed.
pub async fn insert_version<C: ConnectionTrait>(
    db: &C,
    model: versions::ActiveModel,
) -> Result<versions::Model, sea_orm::DbErr> {
    model.insert(db).await
}

pub async fn get_version<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    entity_id: &str,
    version: i32,
) -> Result<Option<versions::Model>, sea_orm::DbErr> {
    versions::Entity::find()
        .filter(versions::Column::OrgId.eq(org_id))
        .filter(versions::Column::EntityId.eq(entity_id))
        .filter(versions::Column::Version.eq(version))
        .one(db)
        .await
}

pub async fn list_versions<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    entity_id: &str,
) -> Result<Vec<versions::Model>, sea_orm::DbErr> {
    versions::Entity::find()
        .filter(versions::Column::OrgId.eq(org_id))
        .filter(versions::Column::EntityId.eq(entity_id))
        .order_by_desc(versions::Column::Version)
        .all(db)
        .await
}

pub async fn newest_version_by_hash<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    entity_id: &str,
    content_hash: &str,
) -> Result<Option<versions::Model>, sea_orm::DbErr> {
    versions::Entity::find()
        .filter(versions::Column::OrgId.eq(org_id))
        .filter(versions::Column::EntityId.eq(entity_id))
        .filter(versions::Column::ContentHash.eq(content_hash))
        .order_by_desc(versions::Column::Version)
        .one(db)
        .await
}

pub async fn find_content_matches<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    content_hash: &str,
) -> Result<Vec<versions::Model>, sea_orm::DbErr> {
    versions::Entity::find()
        .filter(versions::Column::OrgId.eq(org_id))
        .filter(versions::Column::ContentHash.eq(content_hash))
        .order_by_desc(versions::Column::CreatedAt)
        .all(db)
        .await
}

pub async fn get_pinned_version<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    entity_id: &str,
    version: i32,
) -> Result<Option<PinnedPrompt>, sea_orm::DbErr> {
    let Some(prompt) = get_head(db, org_id, entity_id).await? else {
        return Ok(None);
    };
    Ok(get_version(db, org_id, entity_id, version)
        .await?
        .map(|version| PinnedPrompt { prompt, version }))
}

pub async fn get_for_new_reference<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    entity_id: &str,
    version: i32,
) -> Result<Option<PinnedPrompt>, sea_orm::DbErr> {
    Ok(get_pinned_version(db, org_id, entity_id, version)
        .await?
        .filter(|pinned| pinned.prompt.status == "active"))
}

pub async fn get_label<C: ConnectionTrait>(
    db: &C,
    entity_id: &str,
    name: &str,
) -> Result<Option<labels::Model>, sea_orm::DbErr> {
    labels::Entity::find_by_id((entity_id.to_string(), name.to_string()))
        .one(db)
        .await
}

pub async fn get_label_for_update<C: ConnectionTrait>(
    db: &C,
    entity_id: &str,
    name: &str,
) -> Result<Option<labels::Model>, sea_orm::DbErr> {
    labels::Entity::find_by_id((entity_id.to_string(), name.to_string()))
        .lock_exclusive()
        .one(db)
        .await
}

pub async fn list_labels<C: ConnectionTrait>(
    db: &C,
    entity_id: &str,
) -> Result<Vec<labels::Model>, sea_orm::DbErr> {
    labels::Entity::find()
        .filter(labels::Column::EntityId.eq(entity_id))
        .order_by_asc(labels::Column::Name)
        .all(db)
        .await
}

pub async fn upsert_label<C: ConnectionTrait>(
    db: &C,
    model: labels::ActiveModel,
) -> Result<(), sea_orm::DbErr> {
    labels::Entity::insert(model)
        .on_conflict(
            OnConflict::columns([labels::Column::EntityId, labels::Column::Name])
                .update_columns([
                    labels::Column::Version,
                    labels::Column::DeletedAt,
                    labels::Column::UpdatedBy,
                    labels::Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec(db)
        .await?;
    Ok(())
}

pub async fn insert_label_event<C: ConnectionTrait>(
    db: &C,
    model: label_events::ActiveModel,
) -> Result<label_events::Model, sea_orm::DbErr> {
    model.insert(db).await
}

pub async fn list_label_activity<C: ConnectionTrait>(
    db: &C,
    entity_id: &str,
) -> Result<Vec<label_events::Model>, sea_orm::DbErr> {
    label_events::Entity::find()
        .filter(label_events::Column::EntityId.eq(entity_id))
        .order_by_desc(label_events::Column::CreatedAt)
        .order_by_desc(label_events::Column::Id)
        .all(db)
        .await
}

pub async fn insert_delivery<C: ConnectionTrait>(
    db: &C,
    model: deliveries::ActiveModel,
) -> Result<deliveries::Model, sea_orm::DbErr> {
    model.insert(db).await
}

pub async fn due_deliveries<C: ConnectionTrait>(
    db: &C,
    now: i64,
    limit: u64,
) -> Result<Vec<deliveries::Model>, sea_orm::DbErr> {
    deliveries::Entity::find()
        .filter(deliveries::Column::Status.eq("pending"))
        .filter(deliveries::Column::NextAttemptAt.lte(now))
        .order_by_asc(deliveries::Column::NextAttemptAt)
        .limit(limit)
        .all(db)
        .await
}

/// Claims due deliveries by moving their due time to a short lease in the same
/// transaction that selects them.
pub async fn claim_due_deliveries(
    db: &DatabaseConnection,
    now: i64,
    limit: u64,
    lease_until: i64,
) -> Result<Vec<deliveries::Model>, sea_orm::DbErr> {
    let txn = db.begin().await?;
    let rows = deliveries::Entity::find()
        .filter(deliveries::Column::Status.eq("pending"))
        .filter(deliveries::Column::NextAttemptAt.lte(now))
        .order_by_asc(deliveries::Column::NextAttemptAt)
        .limit(limit)
        .lock_exclusive()
        .all(&txn)
        .await?;
    let mut claimed = Vec::with_capacity(rows.len());
    for row in rows {
        let mut active: deliveries::ActiveModel = row.into();
        active.next_attempt_at = Set(lease_until);
        claimed.push(active.update(&txn).await?);
    }
    txn.commit().await?;
    Ok(claimed)
}

pub async fn update_delivery<C: ConnectionTrait>(
    db: &C,
    delivery: deliveries::Model,
    status: &str,
    attempt_count: i32,
    next_attempt_at: i64,
    last_error: Option<String>,
    delivered_at: Option<i64>,
) -> Result<deliveries::Model, sea_orm::DbErr> {
    let mut model: deliveries::ActiveModel = delivery.into();
    model.status = Set(status.to_string());
    model.attempt_count = Set(attempt_count);
    model.next_attempt_at = Set(next_attempt_at);
    model.last_error = Set(last_error);
    model.delivered_at = Set(delivered_at);
    model.update(db).await
}

/// Deletes every Prompt registry row for an organization in foreign-key order.
pub async fn delete_by_org(org_id: &str) -> Result<(), sea_orm::DbErr> {
    let db = crate::db::get_orm_client_rw().await;
    delete_by_org_with(db, org_id).await
}

async fn delete_by_org_with(db: &DatabaseConnection, org_id: &str) -> Result<(), sea_orm::DbErr> {
    let txn = db.begin().await?;
    let entity_ids = prompts::Entity::find()
        .select_only()
        .column(prompts::Column::EntityId)
        .filter(prompts::Column::OrgId.eq(org_id))
        .into_tuple::<String>()
        .all(&txn)
        .await?;

    deliveries::Entity::delete_many()
        .filter(deliveries::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    label_events::Entity::delete_many()
        .filter(label_events::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    if !entity_ids.is_empty() {
        labels::Entity::delete_many()
            .filter(labels::Column::EntityId.is_in(entity_ids))
            .exec(&txn)
            .await?;
    }
    versions::Entity::delete_many()
        .filter(versions::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    prompts::Entity::delete_many()
        .filter(prompts::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    txn.commit().await
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, EntityTrait, PaginatorTrait, QueryFilter};

    use super::*;

    #[tokio::test]
    async fn delete_by_org_removes_prompt_children_and_preserves_other_orgs() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE folders (
               id TEXT PRIMARY KEY, org TEXT NOT NULL, folder_id TEXT NOT NULL,
               name TEXT NOT NULL, description TEXT, type INTEGER NOT NULL, icon TEXT
             );
             CREATE TABLE llm_experiments (id TEXT PRIMARY KEY, org_id TEXT NOT NULL);",
        )
        .await
        .unwrap();
        crate::table::migration::create_llm_prompt_schema_for_test(&db)
            .await
            .unwrap();
        db.execute_unprepared(
            "INSERT INTO folders (id, org, folder_id, name, type) VALUES
               ('folder-1', 'org-1', 'default', 'default', 5),
               ('folder-2', 'org-2', 'default', 'default', 5);
             INSERT INTO llm_prompts (
               entity_id, org_id, name, folder_id, prompt_type, tags, status,
               latest_version, created_by, created_at, updated_by, updated_at
             ) VALUES
               ('prompt-1', 'org-1', 'support', 'folder-1', 'text', '[]', 'active', 1, 'user', 1, 'user', 1),
               ('prompt-2', 'org-2', 'support', 'folder-2', 'text', '[]', 'active', 1, 'user', 1, 'user', 1);
             INSERT INTO llm_prompt_versions (
               id, org_id, entity_id, version, payload, config, commit_message,
               source, content_hash, created_by, created_at
             ) VALUES
               ('version-1', 'org-1', 'prompt-1', 1, '\"hello\"', '{}', 'initial', 'ui',
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'user', 1),
               ('version-2', 'org-2', 'prompt-2', 1, '\"hello\"', '{}', 'initial', 'ui',
                'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'user', 1);
             INSERT INTO llm_prompt_labels (entity_id, name, version, updated_by, updated_at) VALUES
               ('prompt-1', 'latest', 1, 'user', 1),
               ('prompt-2', 'latest', 1, 'user', 1);
             INSERT INTO llm_prompt_label_events (
               id, org_id, entity_id, label, from_version, to_version, actor, via, created_at
             ) VALUES
               ('event-1', 'org-1', 'prompt-1', 'latest', NULL, 1, 'user', 'ui', 1),
               ('event-2', 'org-2', 'prompt-2', 'latest', NULL, 1, 'user', 'ui', 1);
             INSERT INTO llm_prompt_webhook_deliveries (
               id, org_id, event_type, payload, endpoint, secret_ref, status,
               attempt_count, next_attempt_at, created_at
             ) VALUES
               ('delivery-1', 'org-1', 'version.created', '{}', 'https://example.com', 'secret', 'pending', 0, 1, 1),
               ('delivery-2', 'org-2', 'version.created', '{}', 'https://example.com', 'secret', 'pending', 0, 1, 1);",
        )
        .await
        .unwrap();

        delete_by_org_with(&db, "org-1").await.unwrap();

        assert_eq!(
            prompts::Entity::find()
                .filter(prompts::Column::OrgId.eq("org-1"))
                .count(&db)
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            prompts::Entity::find()
                .filter(prompts::Column::OrgId.eq("org-2"))
                .count(&db)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            labels::Entity::find()
                .filter(labels::Column::EntityId.eq("prompt-1"))
                .count(&db)
                .await
                .unwrap(),
            0
        );
        assert_eq!(deliveries::Entity::find().count(&db).await.unwrap(), 1);
        assert_eq!(label_events::Entity::find().count(&db).await.unwrap(), 1);
        assert_eq!(versions::Entity::find().count(&db).await.unwrap(), 1);
        db.execute_unprepared("DELETE FROM folders WHERE org = 'org-1';")
            .await
            .unwrap();
    }
}
