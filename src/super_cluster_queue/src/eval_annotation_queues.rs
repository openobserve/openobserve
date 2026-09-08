// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use infra::{
    db::get_orm_client_rw,
    errors::{Error, Result},
    table::entity::{
        llm_annotation_queue_bindings as queue_bindings, llm_annotation_queue_items as queue_items,
        llm_annotation_queues as queues,
    },
};
use o2_enterprise::enterprise::super_cluster::queue::{
    EvalAnnotationQueueMessage, Message, MessageType,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, TransactionTrait};

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::EvalAnnotationQueuePut => {
            let EvalAnnotationQueueMessage::Put { queue, bindings } = msg.try_into()?;
            apply_put(queue, bindings).await?;
        }
        MessageType::EvalAnnotationQueueDelete => {
            let (org_id, queue_id) = crate::parse_eval_key(
                &msg.key,
                "annotation_queues",
                "Invalid eval annotation Queue key",
            )?;
            apply_delete(&org_id, &queue_id).await?;
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:EVAL_ANNOTATION_QUEUE] Invalid message: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}

async fn apply_put(queue: queues::Model, bindings: Vec<queue_bindings::Model>) -> Result<()> {
    if bindings
        .iter()
        .any(|binding| binding.org_id != queue.org_id || binding.queue_id != queue.id)
    {
        return Err(Error::Message(
            "Annotation Queue binding does not match its Queue".to_string(),
        ));
    }

    let db = get_orm_client_rw().await;
    let txn = db.begin().await?;
    match queues::Entity::find_by_id(&queue.id).one(&txn).await? {
        Some(current) if current.org_id != queue.org_id => {
            return Err(Error::Message(
                "Annotation Queue ID belongs to a different organization".to_string(),
            ));
        }
        Some(current) if current.updated_at > queue.updated_at => {
            txn.commit().await?;
            return Ok(());
        }
        Some(_) => {
            let active: queues::ActiveModel = queue.clone().into();
            active.update(&txn).await?;
        }
        None => {
            let active: queues::ActiveModel = queue.clone().into();
            active.insert(&txn).await?;
        }
    }

    queue_bindings::Entity::delete_many()
        .filter(queue_bindings::Column::OrgId.eq(&queue.org_id))
        .filter(queue_bindings::Column::QueueId.eq(&queue.id))
        .exec(&txn)
        .await?;
    if !bindings.is_empty() {
        queue_bindings::Entity::insert_many(
            bindings.into_iter().map(queue_bindings::ActiveModel::from),
        )
        .exec(&txn)
        .await?;
    }
    txn.commit().await?;
    Ok(())
}

async fn apply_delete(org_id: &str, queue_id: &str) -> Result<()> {
    let db = get_orm_client_rw().await;
    let txn = db.begin().await?;
    queue_bindings::Entity::delete_many()
        .filter(queue_bindings::Column::OrgId.eq(org_id))
        .filter(queue_bindings::Column::QueueId.eq(queue_id))
        .exec(&txn)
        .await?;
    queue_items::Entity::delete_many()
        .filter(queue_items::Column::OrgId.eq(org_id))
        .filter(queue_items::Column::QueueId.eq(queue_id))
        .exec(&txn)
        .await?;
    queues::Entity::delete_many()
        .filter(queues::Column::OrgId.eq(org_id))
        .filter(queues::Column::Id.eq(queue_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}
