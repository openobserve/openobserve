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
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set, TransactionTrait};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::EvalDatasetPut => {
            let EvalDatasetMessage::Put { dataset, items } = msg.try_into()?;
            apply_put(dataset, items).await?;
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

async fn apply_put(dataset: datasets::Model, items: Vec<dataset_items::Model>) -> Result<()> {
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

    let db = get_orm_client_rw().await;
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
            if current != item {
                return Err(Error::Message(
                    "Dataset Item row ID contains conflicting data".to_string(),
                ));
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
