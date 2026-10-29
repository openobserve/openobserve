// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use infra::{
    db::get_orm_client_rw,
    errors::{Error, Result},
    table::entity::{llm_dataset_items as dataset_items, llm_datasets as datasets},
};
use o2_enterprise::enterprise::super_cluster::queue::{EvalDatasetMessage, Message, MessageType};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set,
    TransactionTrait, sea_query::Expr,
};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::EvalDatasetPut => {
            let EvalDatasetMessage::Put { dataset, items } = msg.try_into()?;
            apply_put(get_orm_client_rw().await, dataset, items).await?;
        }
        MessageType::EvalDatasetDelete => {
            let (org_id, dataset_id) =
                crate::parse_eval_key(&msg.key, "datasets", "Invalid eval Dataset key")?;
            apply_delete(&org_id, &dataset_id).await?;
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:EVAL_DATASET] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}

async fn apply_put<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    dataset: datasets::Model,
    items: Vec<dataset_items::Model>,
) -> Result<()> {
    // Item messages carry the parent only as a version watermark. Dataset
    // metadata is authoritative only in a metadata-only snapshot, preventing
    // an item written from stale regional state from reverting a rename.
    let update_metadata = items.is_empty();
    if items
        .iter()
        .any(|item| item.org_id != dataset.org_id || item.dataset_id != dataset.id)
    {
        return Err(Error::Message(
            "Dataset Item does not match its Dataset".to_string(),
        ));
    }

    let txn = db.begin().await?;
    match datasets::Entity::find_by_id(&dataset.id).one(&txn).await? {
        Some(current) if current.org_id != dataset.org_id => {
            return Err(Error::Message(
                "Dataset ID belongs to a different organization".to_string(),
            ));
        }
        Some(current) => {
            let mut active: datasets::ActiveModel = current.clone().into();
            active.global_version = Set(current.global_version.max(dataset.global_version));
            if update_metadata && dataset.updated_at >= current.updated_at {
                active.name = Set(dataset.name.clone());
                active.description = Set(dataset.description.clone());
                active.tags = Set(dataset.tags.clone());
                active.updated_by = Set(dataset.updated_by.clone());
                active.updated_at = Set(dataset.updated_at);
            }
            active.update(&txn).await?;
        }
        None => {
            let active: datasets::ActiveModel = dataset.clone().into();
            active.insert(&txn).await?;
        }
    }

    for item in items {
        if let Some(current) = dataset_items::Entity::find_by_id(&item.row_id)
            .one(&txn)
            .await?
        {
            // This region may hold the row without its display label (an older node's echo,
            // or a row from before the column). Fill in that one column so MAX(write_version)
            // and the snapshot pins agree with the origin region; a stored label stays.
            let missing_label = item
                .write_version
                .filter(|_| current.write_version.is_none());
            if !compatible_item_rows(current, &item) {
                return Err(Error::Message(
                    "Dataset Item row ID contains conflicting data".to_string(),
                ));
            }
            if let Some(label) = missing_label {
                dataset_items::Entity::update_many()
                    .col_expr(dataset_items::Column::WriteVersion, Expr::value(label))
                    .filter(dataset_items::Column::RowId.eq(&item.row_id))
                    .filter(dataset_items::Column::WriteVersion.is_null())
                    .exec(&txn)
                    .await?;
            }
            continue;
        }
        if dataset_items::Entity::find()
            .filter(dataset_items::Column::DatasetId.eq(&item.dataset_id))
            .filter(dataset_items::Column::GlobalVersion.eq(item.global_version))
            .one(&txn)
            .await?
            .is_some()
        {
            return Err(Error::Message(format!(
                "Dataset global version {} conflicts with a concurrent regional write",
                item.global_version
            )));
        }
        let active: dataset_items::ActiveModel = item.into();
        active.insert(&txn).await?;
    }
    txn.commit().await?;
    Ok(())
}

/// Older nodes omit the display label when echoing an otherwise identical immutable row, so a
/// missing label on either side is not a conflict; two different labels still are.
fn compatible_item_rows(
    mut current: dataset_items::Model,
    incoming: &dataset_items::Model,
) -> bool {
    if current.write_version.is_none() || incoming.write_version.is_none() {
        current.write_version = incoming.write_version;
    }
    current == *incoming
}

async fn apply_delete(org_id: &str, dataset_id: &str) -> Result<()> {
    let db = get_orm_client_rw().await;
    let txn = db.begin().await?;
    dataset_items::Entity::delete_many()
        .filter(dataset_items::Column::OrgId.eq(org_id))
        .filter(dataset_items::Column::DatasetId.eq(dataset_id))
        .exec(&txn)
        .await?;
    datasets::Entity::delete_many()
        .filter(datasets::Column::OrgId.eq(org_id))
        .filter(datasets::Column::Id.eq(dataset_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;

    fn row(write_version: Option<i64>) -> dataset_items::Model {
        serde_json::from_value(serde_json::json!({
            "row_id": "row-1",
            "logical_id": "item-1",
            "org_id": "org-1",
            "dataset_id": "dataset-1",
            "input": "question",
            "expected_output": "answer",
            "global_version": 59,
            "write_version": write_version,
            "is_deleted": false,
            "source": "telemetry",
            "updated_by": "owner@example.com",
            "updated_at": 100
        }))
        .unwrap()
    }

    #[test]
    fn an_older_node_can_echo_a_row_without_its_display_label() {
        assert!(compatible_item_rows(row(Some(57)), &row(None)));
        assert!(compatible_item_rows(row(None), &row(Some(57))));
        assert!(compatible_item_rows(row(Some(57)), &row(Some(57))));
        assert!(!compatible_item_rows(row(Some(57)), &row(Some(58))));
    }

    #[test]
    fn missing_display_labels_do_not_hide_immutable_content_conflicts() {
        let mut changed = row(None);
        changed.input = serde_json::json!("different question");
        assert!(!compatible_item_rows(row(Some(57)), &changed));
        let mut changed = row(None);
        changed.global_version = 60;
        assert!(!compatible_item_rows(row(Some(57)), &changed));
    }

    // One connection: separate connections to `sqlite::memory:` get separate databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(datasets::Entity),
            schema.create_table_from_entity(dataset_items::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        db
    }

    fn dataset() -> datasets::Model {
        datasets::Model {
            id: "dataset-1".to_string(),
            org_id: "org-1".to_string(),
            name: "Golden set".to_string(),
            description: None,
            tags: None,
            global_version: 59,
            created_by: "owner@example.com".to_string(),
            created_at: 1,
            updated_by: "owner@example.com".to_string(),
            updated_at: 1,
        }
    }

    async fn stored(db: &DatabaseConnection) -> dataset_items::Model {
        dataset_items::Entity::find_by_id("row-1")
            .one(db)
            .await
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn a_replayed_label_reaches_a_row_stored_without_one() {
        let db = db().await;
        apply_put(&db, dataset(), vec![row(None)]).await.unwrap();
        apply_put(&db, dataset(), vec![row(Some(57))])
            .await
            .unwrap();
        assert_eq!(stored(&db).await, row(Some(57)));
    }

    #[tokio::test]
    async fn an_unlabelled_echo_never_erases_a_stored_label() {
        let db = db().await;
        apply_put(&db, dataset(), vec![row(Some(57))])
            .await
            .unwrap();
        apply_put(&db, dataset(), vec![row(None)]).await.unwrap();
        assert_eq!(stored(&db).await.write_version, Some(57));
    }

    #[tokio::test]
    async fn a_label_is_not_filled_in_beside_conflicting_content() {
        let db = db().await;
        apply_put(&db, dataset(), vec![row(None)]).await.unwrap();
        let mut changed = row(Some(57));
        changed.input = serde_json::json!("different question");
        assert!(apply_put(&db, dataset(), vec![changed]).await.is_err());
        assert_eq!(stored(&db).await, row(None));
    }
}
