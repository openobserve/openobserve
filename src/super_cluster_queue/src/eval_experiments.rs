// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{Error, Result},
    table::entity::llm_experiments,
};
use o2_enterprise::enterprise::super_cluster::queue::{
    EvalExperimentMessage, Message, MessageType,
};
use sea_orm::{ActiveModelTrait, EntityTrait};

pub(crate) async fn process(msg: Message) -> Result<()> {
    if msg.message_type != MessageType::EvalExperimentPut {
        log::error!(
            "[SUPER_CLUSTER:EVAL_EXPERIMENT] Invalid message: type: {:?}, key: {}",
            msg.message_type,
            msg.key
        );
        return Err(Error::Message("Invalid message type".to_string()));
    }

    let (org_id, experiment_id) =
        crate::parse_eval_key(&msg.key, "experiments", "Invalid eval Experiment key")?;
    let EvalExperimentMessage::Put { experiment } = msg.try_into()?;
    if experiment.org_id != org_id || experiment.id != experiment_id {
        return Err(Error::Message(
            "Experiment does not match its super-cluster key".to_string(),
        ));
    }
    apply_put(experiment).await
}

async fn apply_put(experiment: llm_experiments::Model) -> Result<()> {
    let db = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match llm_experiments::Entity::find_by_id(&experiment.id)
        .one(db)
        .await?
    {
        Some(current) if current == experiment => Ok(()),
        Some(_) => Err(Error::Message(
            "Experiment ID contains conflicting immutable data".to_string(),
        )),
        None => {
            let active: llm_experiments::ActiveModel = experiment.into();
            active.insert(db).await?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::*;

    #[tokio::test]
    async fn rejects_a_payload_whose_identity_differs_from_the_queue_key() {
        let experiment = llm_experiments::Model {
            id: "experiment-2".to_string(),
            org_id: "org-1".to_string(),
            name: "Immutable".to_string(),
            description: None,
            dataset_id: "dataset-1".to_string(),
            dataset_version: 1,
            dataset_filter: None,
            task_config: serde_json::json!({"type": "inline_prompt"}),
            scorers: serde_json::json!([]),
            trial_count: 1,
            metadata: None,
            status: "pending".to_string(),
            idempotency_key: Some("key-1".to_string()),
            created_by: "owner@example.com".to_string(),
            created_at: 1,
        };
        let value =
            config::utils::json::to_vec(&EvalExperimentMessage::Put { experiment }).unwrap();
        let message = Message::new(
            "/eval/experiments/org-1/experiment-1".to_string(),
            Some(Bytes::from(value)),
            None,
            false,
            MessageType::EvalExperimentPut,
        );

        let error = process(message).await.unwrap_err();
        assert!(error.to_string().contains("does not match"));
    }
}
