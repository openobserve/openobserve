// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{Error, Result},
    table::entity::llm_playground_snapshots,
};
use o2_enterprise::enterprise::super_cluster::queue::{
    EvalPlaygroundSnapshotMessage, Message, MessageType,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let (org_id, snapshot_id) = crate::parse_eval_key(
        &msg.key,
        "playground_snapshots",
        "Invalid Playground snapshot key",
    )?;

    match msg.message_type {
        MessageType::EvalPlaygroundSnapshotPut => {
            let EvalPlaygroundSnapshotMessage::Put { snapshot } = msg.try_into()?;
            if snapshot.org_id != org_id || snapshot.id != snapshot_id {
                return Err(Error::Message(
                    "Playground snapshot does not match its super-cluster key".to_string(),
                ));
            }
            apply_put(snapshot).await
        }
        MessageType::EvalPlaygroundSnapshotDelete => apply_delete(&org_id, &snapshot_id).await,
        other => {
            log::error!(
                "[SUPER_CLUSTER:EVAL_PLAYGROUND_SNAPSHOT] Invalid message: type: {other:?}, key: {}",
                msg.key
            );
            Err(Error::Message("Invalid message type".to_string()))
        }
    }
}

/// Insert the snapshot, or merge its access time into the local copy.
///
/// A snapshot is immutable, so a body that differs in anything but
/// `last_accessed_at` means two clusters minted the same id for different
/// content — a real conflict, reported rather than silently resolved.
///
/// `last_accessed_at` is the one field that legitimately diverges: each cluster
/// renews it when someone there opens the snapshot. Taking the later of the two
/// makes the merge commutative, so replays and out-of-order delivery converge
/// on the same answer and no cluster expires a snapshot another is still using.
async fn apply_put(snapshot: llm_playground_snapshots::Model) -> Result<()> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(current) = llm_playground_snapshots::Entity::find_by_id(&snapshot.id)
        .one(db)
        .await?
    else {
        let active: llm_playground_snapshots::ActiveModel = snapshot.into();
        active.insert(db).await?;
        return Ok(());
    };

    if !same_immutable_content(&current, &snapshot) {
        return Err(Error::Message(
            "Playground snapshot ID contains conflicting immutable data".to_string(),
        ));
    }

    if snapshot.last_accessed_at <= current.last_accessed_at {
        return Ok(());
    }

    let merged = snapshot.last_accessed_at;
    let mut active: llm_playground_snapshots::ActiveModel = current.into();
    active.last_accessed_at = Set(merged);
    active.update(db).await?;
    Ok(())
}

/// Deleting a snapshot that is already gone is success, not an error: the
/// remote purge and a local purge reach the same end state, and a replayed
/// delete must not fail the queue.
async fn apply_delete(org_id: &str, snapshot_id: &str) -> Result<()> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    llm_playground_snapshots::Entity::delete_many()
        .filter(llm_playground_snapshots::Column::Id.eq(snapshot_id))
        .filter(llm_playground_snapshots::Column::OrgId.eq(org_id))
        .exec(db)
        .await?;
    Ok(())
}

/// Every field except the access time, which is expected to diverge.
fn same_immutable_content(
    current: &llm_playground_snapshots::Model,
    incoming: &llm_playground_snapshots::Model,
) -> bool {
    current.id == incoming.id
        && current.org_id == incoming.org_id
        && current.payload == incoming.payload
        && current.parent_snapshot_id == incoming.parent_snapshot_id
        && current.created_by == incoming.created_by
        && current.created_at == incoming.created_at
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(id: &str, payload: &str, last_accessed_at: i64) -> llm_playground_snapshots::Model {
        llm_playground_snapshots::Model {
            id: id.to_string(),
            org_id: "acme".to_string(),
            payload: serde_json::json!({ "columns": [], "note": payload }),
            parent_snapshot_id: None,
            created_by: "someone@example.com".to_string(),
            created_at: 1_000,
            last_accessed_at,
        }
    }

    #[test]
    fn a_differing_access_time_is_not_a_conflict() {
        let current = model("snap-1", "same", 1_000);
        let incoming = model("snap-1", "same", 9_000);
        assert!(same_immutable_content(&current, &incoming));
    }

    #[test]
    fn a_differing_payload_under_the_same_id_is_a_conflict() {
        let current = model("snap-1", "one", 1_000);
        let incoming = model("snap-1", "two", 1_000);
        assert!(!same_immutable_content(&current, &incoming));
    }

    #[test]
    fn a_differing_creator_under_the_same_id_is_a_conflict() {
        let current = model("snap-1", "same", 1_000);
        let mut incoming = model("snap-1", "same", 1_000);
        incoming.created_by = "someone-else@example.com".to_string();
        assert!(!same_immutable_content(&current, &incoming));
    }

    #[test]
    fn a_differing_lineage_under_the_same_id_is_a_conflict() {
        let current = model("snap-1", "same", 1_000);
        let mut incoming = model("snap-1", "same", 1_000);
        incoming.parent_snapshot_id = Some("snap-0".to_string());
        assert!(!same_immutable_content(&current, &incoming));
    }

    #[tokio::test]
    async fn rejects_a_key_that_names_a_different_module() {
        let message = Message::new(
            "/eval/experiments/acme/snap-1".to_string(),
            None,
            None,
            false,
            MessageType::EvalPlaygroundSnapshotDelete,
        );
        assert!(process(message).await.is_err());
    }

    #[tokio::test]
    async fn rejects_an_unrelated_message_type() {
        let message = Message::new(
            "/eval/playground_snapshots/acme/snap-1".to_string(),
            None,
            None,
            false,
            MessageType::EvalExperimentPut,
        );
        assert!(process(message).await.is_err());
    }
}
