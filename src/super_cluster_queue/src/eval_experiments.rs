// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use infra::{
    db::get_orm_client_rw,
    errors::{Error, Result},
    table::entity::llm_experiments,
};
use o2_enterprise::enterprise::{
    llm_evaluations::experiments::{ExperimentStatus, valid_lifecycle_transition},
    super_cluster::queue::{EvalExperimentMessage, Message, MessageType},
};
use sea_orm::{ActiveModelTrait, EntityTrait, Set};

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
    let db = get_orm_client_rw().await;
    match llm_experiments::Entity::find_by_id(&experiment.id)
        .one(db)
        .await?
    {
        Some(current) if current == experiment => Ok(()),
        Some(current) if !same_immutable_definition(&current, &experiment) => Err(Error::Message(
            "Experiment ID contains conflicting immutable data".to_string(),
        )),
        Some(current) if experiment.lifecycle_version < current.lifecycle_version => Ok(()),
        Some(current) if experiment.lifecycle_version == current.lifecycle_version => Err(
            Error::Message("Experiment lifecycle version contains conflicting data".to_string()),
        ),
        Some(current) if !valid_model_lifecycle_transition(&current, &experiment) => {
            Err(Error::Message(format!(
                "Invalid Experiment lifecycle transition from '{}' to '{}'",
                current.status, experiment.status
            )))
        }
        Some(current) => {
            let mut active: llm_experiments::ActiveModel = current.into();
            active.status = Set(experiment.status);
            active.status_reason = Set(experiment.status_reason);
            active.deadline_at = Set(experiment.deadline_at);
            active.completed_at = Set(experiment.completed_at);
            active.lifecycle_version = Set(experiment.lifecycle_version);
            active.retry_count = Set(experiment.retry_count);
            active.update(db).await?;
            Ok(())
        }
        None => {
            let active: llm_experiments::ActiveModel = experiment.into();
            active.insert(db).await?;
            Ok(())
        }
    }
}

fn same_immutable_definition(
    left: &llm_experiments::Model,
    right: &llm_experiments::Model,
) -> bool {
    left.id == right.id
        && left.org_id == right.org_id
        && left.name == right.name
        && left.description == right.description
        && left.dataset_id == right.dataset_id
        && left.dataset_version == right.dataset_version
        && left.dataset_filter == right.dataset_filter
        && left.task_config == right.task_config
        && left.scorers == right.scorers
        && left.trial_count == right.trial_count
        && left.metadata == right.metadata
        && left.idempotency_key == right.idempotency_key
        && left.created_by == right.created_by
        && left.created_at == right.created_at
}

fn valid_model_lifecycle_transition(
    current: &llm_experiments::Model,
    incoming: &llm_experiments::Model,
) -> bool {
    let Ok(current_status) = ExperimentStatus::parse(&current.status) else {
        return false;
    };
    let Ok(incoming_status) = ExperimentStatus::parse(&incoming.status) else {
        return false;
    };
    let (Ok(current_retry_count), Ok(incoming_retry_count)) = (
        u32::try_from(current.retry_count),
        u32::try_from(incoming.retry_count),
    ) else {
        return false;
    };
    valid_lifecycle_transition(
        current_status,
        incoming_status,
        current_retry_count,
        incoming_retry_count,
    )
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
            status_reason: None,
            deadline_at: 86_400_001,
            completed_at: None,
            lifecycle_version: 0,
            retry_count: 0,
            scores_settled_at: None,
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

    #[test]
    fn accepts_only_declared_lifecycle_edges() {
        let mut current = llm_experiments::Model {
            id: "experiment-1".to_string(),
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
            status: "running".to_string(),
            status_reason: None,
            deadline_at: 86_400_001,
            completed_at: None,
            lifecycle_version: 0,
            retry_count: 0,
            scores_settled_at: None,
            idempotency_key: Some("key-1".to_string()),
            created_by: "owner@example.com".to_string(),
            created_at: 1,
        };
        for terminal in ["completed", "cancelled", "failed"] {
            let mut incoming = current.clone();
            incoming.status = terminal.to_string();
            incoming.lifecycle_version = 1;
            assert!(valid_model_lifecycle_transition(&current, &incoming));
        }

        let mut invalid = current.clone();
        invalid.status = "pending".to_string();
        invalid.lifecycle_version = 1;
        assert!(!valid_model_lifecycle_transition(&current, &invalid));

        current.status = "failed".to_string();
        let mut retry = current.clone();
        retry.status = "running".to_string();
        retry.retry_count = 1;
        retry.lifecycle_version = 1;
        assert!(valid_model_lifecycle_transition(&current, &retry));
        retry.retry_count = 0;
        assert!(!valid_model_lifecycle_transition(&current, &retry));
    }
}
