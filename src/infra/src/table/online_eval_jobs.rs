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

use std::collections::BTreeMap;

use config::meta::pipeline::components::ScorerRef;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Order, QueryFilter, QueryOrder, Schema, Set,
};
use serde::{Deserialize, Serialize};

use super::get_lock;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
    table::entity::online_eval_jobs::{ActiveModel, Column, Entity, Model},
};

/// Valid job states.
pub const VALID_STATUSES: &[&str] = &["draft", "active", "paused", "degraded", "archived"];

pub type ScorerInputMapping = BTreeMap<String, String>;
pub type JobInputMapping = BTreeMap<String, ScorerInputMapping>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SamplingMode {
    #[default]
    Rate,
    All,
    Count,
}

impl SamplingMode {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Rate => "rate",
            Self::All => "all",
            Self::Count => "count",
        }
    }
}

impl std::str::FromStr for SamplingMode {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "rate" => Ok(Self::Rate),
            "all" => Ok(Self::All),
            "count" => Ok(Self::Count),
            _ => Err(value.to_string()),
        }
    }
}

impl std::fmt::Display for SamplingMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Valid state transitions. Maps from current state to allowed next states.
pub fn is_valid_transition(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("draft", "active")
            | ("active", "paused")
            | ("active", "degraded")
            | ("paused", "active")
            | ("degraded", "paused")
            | ("degraded", "active")
            | (_, "archived")
    )
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OnlineEvalJob {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
    pub stream: String,
    pub stream_type: String,
    pub filter_condition: serde_json::Value,
    pub scorers: Vec<ScorerRef>,
    pub input_mapping: Option<JobInputMapping>,
    pub sampling_mode: SamplingMode,
    pub sampling_value: serde_json::Value,
    pub status: String,
    pub version: i32,
    pub pipeline_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Model> for OnlineEvalJob {
    fn from(model: Model) -> Self {
        Self {
            id: model.id,
            org_id: model.org_id,
            name: model.name,
            description: model.description,
            stream: model.stream,
            stream_type: model.stream_type,
            filter_condition: model.filter_condition,
            scorers: serde_json::from_value(model.scorers).unwrap_or_default(),
            input_mapping: model
                .input_mapping
                .and_then(|mapping| serde_json::from_value(mapping).ok()),
            sampling_mode: model.sampling_mode.parse().unwrap_or_default(),
            sampling_value: model.sampling_value,
            status: model.status,
            version: model.version,
            pipeline_id: model.pipeline_id,
            created_at: model.created_at,
            updated_at: model.updated_at,
        }
    }
}

pub async fn create_table() -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let builder = client.get_database_backend();

    let schema = Schema::new(builder);
    let create_table_stmt = schema
        .create_table_from_entity(Entity)
        .if_not_exists()
        .take();

    client.execute(builder.build(&create_table_stmt)).await?;

    Ok(())
}

pub async fn add(job: &OnlineEvalJob) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let record = ActiveModel {
        id: Set(job.id.clone()),
        org_id: Set(job.org_id.clone()),
        name: Set(job.name.clone()),
        description: Set(job.description.clone()),
        stream: Set(job.stream.clone()),
        stream_type: Set(job.stream_type.clone()),
        filter_condition: Set(job.filter_condition.clone()),
        scorers: Set(serde_json::json!(job.scorers)),
        input_mapping: Set(job
            .input_mapping
            .as_ref()
            .map(|mapping| serde_json::json!(mapping))),
        sampling_mode: Set(job.sampling_mode.to_string()),
        sampling_value: Set(job.sampling_value.clone()),
        status: Set(job.status.clone()),
        version: Set(job.version),
        pipeline_id: Set(job.pipeline_id.clone()),
        created_at: Set(job.created_at),
        updated_at: Set(job.updated_at),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn update(job: &OnlineEvalJob) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let record = ActiveModel {
        id: Set(job.id.clone()),
        org_id: Set(job.org_id.clone()),
        name: Set(job.name.clone()),
        description: Set(job.description.clone()),
        stream: Set(job.stream.clone()),
        stream_type: Set(job.stream_type.clone()),
        filter_condition: Set(job.filter_condition.clone()),
        scorers: Set(serde_json::json!(job.scorers)),
        input_mapping: Set(job
            .input_mapping
            .as_ref()
            .map(|mapping| serde_json::json!(mapping))),
        sampling_mode: Set(job.sampling_mode.to_string()),
        sampling_value: Set(job.sampling_value.clone()),
        status: Set(job.status.clone()),
        version: Set(job.version),
        pipeline_id: Set(job.pipeline_id.clone()),
        created_at: Set(job.created_at),
        updated_at: Set(job.updated_at),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update(record).exec(client).await?;

    Ok(())
}

pub async fn get(id: &str) -> Result<Option<OnlineEvalJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::Id.eq(id))
        .one(client)
        .await?
        .map(OnlineEvalJob::from);

    Ok(record)
}

pub async fn get_by_org(id: &str, org_id: &str) -> Result<Option<OnlineEvalJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::Id.eq(id))
        .filter(Column::OrgId.eq(org_id))
        .one(client)
        .await?
        .map(OnlineEvalJob::from);

    Ok(record)
}

pub async fn get_all_by_org(org_id: &str) -> Result<Vec<OnlineEvalJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by(Column::CreatedAt, Order::Desc)
        .all(client)
        .await?
        .into_iter()
        .map(OnlineEvalJob::from)
        .collect();

    Ok(records)
}

pub async fn get_by_status(
    org_id: &str,
    status: &str,
) -> Result<Vec<OnlineEvalJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Status.eq(status))
        .order_by(Column::CreatedAt, Order::Desc)
        .all(client)
        .await?
        .into_iter()
        .map(OnlineEvalJob::from)
        .collect();

    Ok(records)
}

pub async fn get_by_stream(
    org_id: &str,
    stream: &str,
    stream_type: &str,
) -> Result<Vec<OnlineEvalJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Stream.eq(stream))
        .filter(Column::StreamType.eq(stream_type))
        .order_by(Column::CreatedAt, Order::Desc)
        .all(client)
        .await?
        .into_iter()
        .map(OnlineEvalJob::from)
        .collect();

    Ok(records)
}

fn scorer_refs_contain(scorers: &[ScorerRef], scorer_entity_id: &str) -> bool {
    scorers.iter().any(|scorer| scorer.id == scorer_entity_id)
}

pub async fn has_non_archived_by_scorer_ref(
    org_id: &str,
    scorer_entity_id: &str,
) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let jobs = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Status.ne("archived"))
        .all(client)
        .await?
        .into_iter()
        .map(OnlineEvalJob::from);

    Ok(jobs
        .into_iter()
        .any(|job| scorer_refs_contain(&job.scorers, scorer_entity_id)))
}

pub async fn delete(id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn delete_all_by_org(org_id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn exists(id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find().filter(Column::Id.eq(id)).one(client).await?;

    Ok(record.is_some())
}

/// Update only the status and pipeline_id fields of a job.
pub async fn update_status(
    id: &str,
    status: &str,
    pipeline_id: Option<&str>,
    updated_at: i64,
) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = Entity::find()
        .filter(Column::Id.eq(id))
        .one(client)
        .await?
        .ok_or_else(|| errors::Error::Message("Job not found".to_string()))?;

    let update = ActiveModel {
        status: Set(status.to_string()),
        pipeline_id: Set(pipeline_id.map(|pid| pid.to_string())),
        updated_at: Set(updated_at),
        ..model.into()
    };
    Entity::update(update).exec(client).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_model() -> Model {
        Model {
            id: "job-1".to_string(),
            org_id: "myorg".to_string(),
            name: "qa-eval".to_string(),
            description: Some("Evaluate QA pipeline traces".to_string()),
            stream: "production-logs".to_string(),
            stream_type: "traces".to_string(),
            filter_condition: serde_json::json!({"type": "custom", "conditions": []}),
            scorers: serde_json::json!(["faithfulness_judge"]),
            input_mapping: None,
            sampling_mode: "rate".to_string(),
            sampling_value: serde_json::json!({"rate": 0.1}),
            status: "draft".to_string(),
            version: 1,
            pipeline_id: None,
            created_at: 1000,
            updated_at: 2000,
        }
    }

    #[test]
    fn test_job_from_model_fields() {
        let model = make_model();
        let job = OnlineEvalJob::from(model);
        assert_eq!(job.id, "job-1");
        assert_eq!(job.org_id, "myorg");
        assert_eq!(job.name, "qa-eval");
        assert_eq!(job.status, "draft");
        assert_eq!(job.version, 1);
        assert_eq!(job.sampling_mode, SamplingMode::Rate);
        assert_eq!(job.stream, "production-logs");
        assert!(job.pipeline_id.is_none());
    }

    #[test]
    fn test_job_from_model_active_state() {
        let mut model = make_model();
        model.status = "active".to_string();
        model.pipeline_id = Some("pipeline-1".to_string());
        let job = OnlineEvalJob::from(model);
        assert_eq!(job.status, "active");
        assert_eq!(job.pipeline_id, Some("pipeline-1".to_string()));
    }

    #[test]
    fn test_job_scorers_deserialized() {
        let mut model = make_model();
        model.scorers = serde_json::json!(["s1", "s2", "s3"]);
        let job = OnlineEvalJob::from(model);
        assert_eq!(
            job.scorers,
            vec![
                ScorerRef {
                    id: "s1".to_string(),
                    version: None
                },
                ScorerRef {
                    id: "s2".to_string(),
                    version: None
                },
                ScorerRef {
                    id: "s3".to_string(),
                    version: None
                },
            ]
        );
    }

    #[test]
    fn test_scorer_refs_contain_string_and_pinned_refs() {
        let scorer_refs = vec![
            ScorerRef {
                id: "latest-scorer".to_string(),
                version: None,
            },
            ScorerRef {
                id: "pinned-scorer".to_string(),
                version: Some(2),
            },
        ];

        assert!(scorer_refs_contain(&scorer_refs, "latest-scorer"));
        assert!(scorer_refs_contain(&scorer_refs, "pinned-scorer"));
        assert!(!scorer_refs_contain(&scorer_refs, "missing-scorer"));
    }

    #[test]
    fn test_valid_transitions() {
        assert!(is_valid_transition("draft", "active"));
        assert!(is_valid_transition("active", "paused"));
        assert!(is_valid_transition("paused", "active"));
        assert!(is_valid_transition("active", "degraded"));
        assert!(is_valid_transition("degraded", "paused"));
        assert!(is_valid_transition("degraded", "active"));
        assert!(is_valid_transition("draft", "archived"));
        assert!(is_valid_transition("active", "archived"));
        assert!(is_valid_transition("paused", "archived"));
        assert!(is_valid_transition("degraded", "archived"));
    }

    #[test]
    fn test_invalid_transitions() {
        assert!(!is_valid_transition("active", "draft"));
        assert!(!is_valid_transition("paused", "draft"));
        assert!(!is_valid_transition("archived", "active"));
        assert!(!is_valid_transition("archived", "paused"));
        assert!(!is_valid_transition("draft", "paused"));
    }
}
