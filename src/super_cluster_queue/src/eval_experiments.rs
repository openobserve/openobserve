// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use infra::{
    db::get_orm_client_rw,
    errors::{Error, Result},
    table::entity::llm_experiments,
};
use o2_enterprise::enterprise::{
    llm_evaluations::experiments::{ExperimentStatus, valid_lifecycle_transition},
    super_cluster::queue::{EvalExperimentMessage, Message, MessageType},
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, Set,
    TransactionTrait, sea_query::Expr,
};

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
    let revised = match llm_experiments::Entity::find_by_id(&experiment.id)
        .one(db)
        .await?
    {
        Some(current) => {
            let Some(active) = revision(current, &experiment)? else {
                return Ok(());
            };
            Some(active)
        }
        None => None,
    };
    let txn = db.begin().await?;
    if experiment.is_baseline {
        demote_other_baselines(&txn, &experiment).await?;
    }
    match revised {
        Some(active) => {
            active.update(&txn).await?;
        }
        None => {
            llm_experiments::ActiveModel::from(experiment)
                .insert(&txn)
                .await?;
        }
    }
    txn.commit().await?;
    Ok(())
}

/// The update `incoming` makes to the stored head, or `None` when it carries
/// nothing newer.
fn revision(
    current: llm_experiments::Model,
    incoming: &llm_experiments::Model,
) -> Result<Option<llm_experiments::ActiveModel>> {
    if current == *incoming {
        return Ok(None);
    }
    if !same_immutable_definition(&current, incoming) {
        return Err(Error::Message(
            "Experiment ID contains conflicting immutable data".to_string(),
        ));
    }
    if incoming.lifecycle_version < current.lifecycle_version {
        return Ok(None);
    }
    if incoming.lifecycle_version == current.lifecycle_version {
        return Err(Error::Message(
            "Experiment lifecycle version contains conflicting data".to_string(),
        ));
    }
    if !valid_model_change(&current, incoming) {
        return Err(Error::Message(format!(
            "Invalid Experiment lifecycle transition from '{}' to '{}'",
            current.status, incoming.status
        )));
    }
    let mut active: llm_experiments::ActiveModel = current.into();
    active.status = Set(incoming.status.clone());
    active.status_reason = Set(incoming.status_reason.clone());
    active.deadline_at = Set(incoming.deadline_at);
    active.completed_at = Set(incoming.completed_at);
    active.lifecycle_version = Set(incoming.lifecycle_version);
    active.retry_count = Set(incoming.retry_count);
    active.is_baseline = Set(incoming.is_baseline);
    active.deleted_at = Set(incoming.deleted_at);
    Ok(Some(active))
}

/// The origin replicates a Baseline move as one message per head, so a peer can
/// apply the promotion while it still holds another Baseline for the Dataset —
/// a demotion that is still in flight, or one that was lost before replication
/// carried it. The incoming promotion is the origin's current word, so it wins;
/// the demoted head's own message later arrives as a same-state revision.
async fn demote_other_baselines(
    txn: &DatabaseTransaction,
    experiment: &llm_experiments::Model,
) -> Result<()> {
    llm_experiments::Entity::update_many()
        .col_expr(llm_experiments::Column::IsBaseline, Expr::value(false))
        .filter(llm_experiments::Column::OrgId.eq(experiment.org_id.as_str()))
        .filter(llm_experiments::Column::DatasetId.eq(experiment.dataset_id.as_str()))
        .filter(llm_experiments::Column::IsBaseline.eq(true))
        .filter(llm_experiments::Column::Id.ne(experiment.id.as_str()))
        .exec(txn)
        .await?;
    Ok(())
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
        && left.prompt_id == right.prompt_id
        && left.prompt_name == right.prompt_name
        && left.prompt_version == right.prompt_version
        && left.prompt_content_hash == right.prompt_content_hash
        && left.created_by == right.created_by
        && left.created_at == right.created_at
}

/// Whether `incoming`, already known to carry a newer `lifecycle_version`, may
/// replace `current`.
///
/// Deletion is terminal and wins from any status: the origin seals the head on
/// the way out, which can be a self-edge (completed → completed) or an edge the
/// running lifecycle never takes (pending → cancelled). Once deleted, nothing
/// newer may revive the head. A revision that leaves the lifecycle where it is
/// only moves the Baseline flag. Everything else must be a declared lifecycle
/// edge.
fn valid_model_change(current: &llm_experiments::Model, incoming: &llm_experiments::Model) -> bool {
    if incoming.deleted_at.is_some() {
        return true;
    }
    if current.deleted_at.is_some() {
        return false;
    }
    same_lifecycle_state(current, incoming) || valid_model_lifecycle_transition(current, incoming)
}

fn same_lifecycle_state(left: &llm_experiments::Model, right: &llm_experiments::Model) -> bool {
    left.status == right.status
        && left.status_reason == right.status_reason
        && left.deadline_at == right.deadline_at
        && left.completed_at == right.completed_at
        && left.retry_count == right.retry_count
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
            is_baseline: false,
            prompt_id: None,
            prompt_name: None,
            prompt_version: None,
            prompt_content_hash: None,
            deleted_at: None,
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
            is_baseline: false,
            prompt_id: None,
            prompt_name: None,
            prompt_version: None,
            prompt_content_hash: None,
            deleted_at: None,
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

    #[test]
    fn prompt_ref_definition_and_evidence_are_immutable() {
        let current = llm_experiments::Model {
            id: "experiment-prompt".to_string(),
            org_id: "org-1".to_string(),
            name: "Managed Prompt".to_string(),
            description: None,
            dataset_id: "dataset-1".to_string(),
            dataset_version: 1,
            dataset_filter: None,
            task_config: serde_json::json!({
                "type": "prompt_ref",
                "id": "prompt-1",
                "version": 3,
                "provider_id": "provider-1"
            }),
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
            idempotency_key: Some("key-prompt".to_string()),
            is_baseline: false,
            deleted_at: None,
            prompt_id: Some("prompt-1".to_string()),
            prompt_name: Some("Support answer".to_string()),
            prompt_version: Some(3),
            prompt_content_hash: Some("sha256:content".to_string()),
            created_by: "owner@example.com".to_string(),
            created_at: 1,
        };
        let mut incoming = current.clone();
        assert!(same_immutable_definition(&current, &incoming));

        incoming.prompt_version = Some(4);
        assert!(!same_immutable_definition(&current, &incoming));
    }

    fn head(status: &str, lifecycle_version: i64) -> llm_experiments::Model {
        llm_experiments::Model {
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
            status: status.to_string(),
            status_reason: None,
            deadline_at: 86_400_001,
            completed_at: None,
            lifecycle_version,
            retry_count: 0,
            scores_settled_at: None,
            idempotency_key: Some("key-1".to_string()),
            is_baseline: false,
            prompt_id: None,
            prompt_name: None,
            prompt_version: None,
            prompt_content_hash: None,
            deleted_at: None,
            created_by: "owner@example.com".to_string(),
            created_at: 1,
        }
    }

    #[test]
    fn a_deletion_applies_from_every_status() {
        // The origin seals an unsealed head as cancelled and keeps a sealed one.
        for (status, sealed) in [
            ("pending", "cancelled"),
            ("running", "cancelled"),
            ("failed", "cancelled"),
            ("completed", "completed"),
            ("cancelled", "cancelled"),
        ] {
            let mut current = head(status, 3);
            current.is_baseline = status == "completed";
            let mut incoming = current.clone();
            incoming.status = sealed.to_string();
            incoming.status_reason = Some("deleted".to_string());
            incoming.completed_at = Some(2);
            incoming.deleted_at = Some(2);
            incoming.is_baseline = false;
            incoming.lifecycle_version = 4;

            let active = revision(current, &incoming)
                .unwrap_or_else(|e| panic!("delete from {status}: {e}"))
                .unwrap_or_else(|| panic!("delete from {status} was skipped"));
            assert_eq!(active.deleted_at, Set(Some(2)), "{status}");
            assert_eq!(active.is_baseline, Set(false), "{status}");
            assert_eq!(active.status, Set(sealed.to_string()), "{status}");
            assert_eq!(active.lifecycle_version, Set(4), "{status}");
        }
    }

    #[test]
    fn a_baseline_set_or_clear_applies_at_a_newer_version() {
        let current = head("completed", 2);
        let mut set = current.clone();
        set.is_baseline = true;
        set.lifecycle_version = 3;
        let active = revision(current, &set).unwrap().unwrap();
        assert_eq!(active.is_baseline, Set(true));
        assert_eq!(active.lifecycle_version, Set(3));

        let mut current = set;
        let mut clear = current.clone();
        clear.is_baseline = false;
        clear.lifecycle_version = 4;
        let active = revision(current.clone(), &clear).unwrap().unwrap();
        assert_eq!(active.is_baseline, Set(false));
        assert_eq!(active.lifecycle_version, Set(4));

        // A head already demoted for a newer promotion still takes its own demotion message.
        current.is_baseline = false;
        assert!(revision(current, &clear).unwrap().is_some());
    }

    #[test]
    fn the_same_version_with_different_data_is_rejected() {
        let current = head("completed", 2);
        let mut incoming = current.clone();
        incoming.is_baseline = true;
        let error = revision(current.clone(), &incoming).unwrap_err();
        assert!(error.to_string().contains("conflicting data"), "{error}");

        incoming.is_baseline = false;
        incoming.deleted_at = Some(2);
        assert!(revision(current, &incoming).is_err());
    }

    #[test]
    fn an_invalid_transition_without_a_deletion_is_rejected() {
        let current = head("completed", 2);
        let mut incoming = current.clone();
        incoming.status = "running".to_string();
        incoming.lifecycle_version = 3;
        let error = revision(current, &incoming).unwrap_err();
        assert!(
            error.to_string().contains("Invalid Experiment lifecycle"),
            "{error}"
        );

        // Deletion is terminal: nothing newer revives the head.
        let mut deleted = head("cancelled", 4);
        deleted.deleted_at = Some(2);
        let mut revived = deleted.clone();
        revived.deleted_at = None;
        revived.lifecycle_version = 5;
        assert!(revision(deleted, &revived).is_err());
    }

    #[test]
    fn an_older_or_identical_revision_is_skipped() {
        let current = head("completed", 3);
        assert!(revision(current.clone(), &current).unwrap().is_none());
        let mut older = current.clone();
        older.status = "running".to_string();
        older.lifecycle_version = 2;
        assert!(revision(current, &older).unwrap().is_none());
    }
}
