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

use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder,
    Schema, Set,
};
use serde::{Deserialize, Serialize};

use super::get_lock;
pub use crate::table::entity::scorers::ScorerType;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
    table::entity::scorers::{ActiveModel, Column, Entity, Model},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Scorer {
    pub id: String,
    pub org_id: String,
    pub entity_id: String,
    pub name: String,
    pub version: i32,
    pub scorer_type: ScorerType,
    pub description: Option<String>,
    pub produces_score_config_id: Option<String>,
    pub produces_score_config_version: Option<i32>,
    pub template: String,
    pub output_schema: Option<serde_json::Value>,
    pub params: serde_json::Value,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Model> for Scorer {
    fn from(model: Model) -> Self {
        Self {
            id: model.id,
            org_id: model.org_id,
            entity_id: model.entity_id,
            name: model.name,
            version: model.version,
            scorer_type: model.scorer_type,
            description: model.description,
            produces_score_config_id: model.produces_score_config_id,
            produces_score_config_version: model.produces_score_config_version,
            template: model.template,
            output_schema: model.output_schema,
            params: model.params,
            is_active: model.is_active,
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

pub async fn add(scorer: &Scorer) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let record = ActiveModel {
        id: Set(scorer.id.clone()),
        org_id: Set(scorer.org_id.clone()),
        entity_id: Set(scorer.entity_id.clone()),
        name: Set(scorer.name.clone()),
        version: Set(scorer.version),
        scorer_type: Set(scorer.scorer_type),
        description: Set(scorer.description.clone()),
        produces_score_config_id: Set(scorer.produces_score_config_id.clone()),
        produces_score_config_version: Set(scorer.produces_score_config_version),
        template: Set(scorer.template.clone()),
        output_schema: Set(scorer.output_schema.clone()),
        params: Set(scorer.params.clone()),
        is_active: Set(scorer.is_active),
        created_at: Set(scorer.created_at),
        updated_at: Set(scorer.updated_at),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn update(scorer: &Scorer) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let record = ActiveModel {
        id: Set(scorer.id.clone()),
        org_id: Set(scorer.org_id.clone()),
        entity_id: Set(scorer.entity_id.clone()),
        name: Set(scorer.name.clone()),
        version: Set(scorer.version),
        scorer_type: Set(scorer.scorer_type),
        description: Set(scorer.description.clone()),
        produces_score_config_id: Set(scorer.produces_score_config_id.clone()),
        produces_score_config_version: Set(scorer.produces_score_config_version),
        template: Set(scorer.template.clone()),
        output_schema: Set(scorer.output_schema.clone()),
        params: Set(scorer.params.clone()),
        is_active: Set(scorer.is_active),
        created_at: Set(scorer.created_at),
        updated_at: Set(scorer.updated_at),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update(record).exec(client).await?;

    Ok(())
}

pub async fn get(id: &str) -> Result<Option<Scorer>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::Id.eq(id))
        .one(client)
        .await?
        .map(Scorer::from);

    Ok(record)
}

pub async fn get_by_entity_id(
    org_id: &str,
    entity_id: &str,
) -> Result<Option<Scorer>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::EntityId.eq(entity_id))
        .filter(Column::IsActive.eq(true))
        .order_by(Column::Version, Order::Desc)
        .one(client)
        .await?
        .map(Scorer::from);

    Ok(record)
}

pub async fn get_by_entity_id_and_version(
    org_id: &str,
    entity_id: &str,
    version: i32,
) -> Result<Option<Scorer>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::EntityId.eq(entity_id))
        .filter(Column::Version.eq(version))
        .one(client)
        .await?
        .map(Scorer::from);

    Ok(record)
}

pub async fn get_by_active_name(org_id: &str, name: &str) -> Result<Option<Scorer>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .filter(Column::IsActive.eq(true))
        .order_by(Column::Version, Order::Desc)
        .one(client)
        .await?
        .map(Scorer::from);

    Ok(record)
}

pub async fn get_versions(org_id: &str, entity_id: &str) -> Result<Vec<Scorer>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::EntityId.eq(entity_id))
        .order_by(Column::Version, Order::Desc)
        .all(client)
        .await?
        .into_iter()
        .map(Scorer::from)
        .collect();

    Ok(records)
}

pub async fn get_all_by_org(org_id: &str) -> Result<Vec<Scorer>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records: Vec<Model> = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IsActive.eq(true))
        .order_by(Column::Name, Order::Asc)
        .order_by(Column::Version, Order::Desc)
        .all(client)
        .await?;

    // Deduplicate: keep highest version per logical entity.
    let mut seen = std::collections::HashSet::new();
    let records: Vec<_> = records
        .into_iter()
        .map(Scorer::from)
        .filter(|s| seen.insert(s.entity_id.clone()))
        .collect();

    Ok(records)
}

pub async fn get_by_type(
    org_id: &str,
    scorer_type: &ScorerType,
) -> Result<Vec<Scorer>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records: Vec<Model> = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ScorerType.eq(*scorer_type))
        .filter(Column::IsActive.eq(true))
        .order_by(Column::Name, Order::Asc)
        .order_by(Column::Version, Order::Desc)
        .all(client)
        .await?;

    // Deduplicate by logical entity.
    let mut seen = std::collections::HashSet::new();
    let records: Vec<_> = records
        .into_iter()
        .map(Scorer::from)
        .filter(|s| seen.insert(s.entity_id.clone()))
        .collect();

    Ok(records)
}

pub async fn has_active_by_score_config_id(
    org_id: &str,
    score_config_entity_id: &str,
) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let count = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IsActive.eq(true))
        .filter(Column::ProducesScoreConfigId.eq(score_config_entity_id))
        .count(client)
        .await?;

    Ok(count > 0)
}

pub async fn delete(entity_id: &str, org_id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // Deactivate all versions
    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::EntityId.eq(entity_id))
        .all(client)
        .await?;

    for model in records {
        let update = ActiveModel {
            id: Set(model.id.clone()),
            is_active: Set(false),
            ..model.into()
        };
        Entity::update(update).exec(client).await?;
    }

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

/// Returns the latest version number for a given entity, or 0 if none exist.
pub async fn get_latest_version(org_id: &str, entity_id: &str) -> Result<i32, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let model = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::EntityId.eq(entity_id))
        .order_by(Column::Version, Order::Desc)
        .one(client)
        .await?
        .map(|m| m.version)
        .unwrap_or(0);

    Ok(model)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_llm_judge_model() -> Model {
        Model {
            id: "scorer-1".to_string(),
            org_id: "myorg".to_string(),
            entity_id: "scorer-entity-1".to_string(),
            name: "faithfulness_judge".to_string(),
            version: 1,
            scorer_type: ScorerType::LlmJudge,
            description: Some("LLM-based faithfulness scoring".to_string()),
            produces_score_config_id: Some("scfg-entity-1".to_string()),
            produces_score_config_version: Some(1),
            template: "Evaluate {{input}} and {{output}}".to_string(),
            output_schema: None,
            params: serde_json::json!({
                "provider_id": "prov-1",
                "model": "gpt-4o",
                "temperature": 0.0
            }),
            is_active: true,
            created_at: 1000,
            updated_at: 2000,
        }
    }

    #[test]
    fn test_scorer_from_model_llm_judge() {
        let model = make_llm_judge_model();
        let s = Scorer::from(model);
        assert_eq!(s.id, "scorer-1");
        assert_eq!(s.scorer_type, "llm_judge");
        assert_eq!(
            s.produces_score_config_id,
            Some("scfg-entity-1".to_string())
        );
        assert_eq!(s.version, 1);
        assert_eq!(s.template, "Evaluate {{input}} and {{output}}");
        assert!(s.is_active);
    }

    #[test]
    fn test_scorer_from_model_remote() {
        let mut model = make_llm_judge_model();
        model.id = "scorer-2".to_string();
        model.name = "compliance_remote".to_string();
        model.scorer_type = ScorerType::Remote;
        model.produces_score_config_id = None;
        model.produces_score_config_version = None;
        model.params = serde_json::json!({
            "endpoint": "https://api.internal/compliance",
            "http_method": "POST",
            "timeout_ms": 5000
        });
        let s = Scorer::from(model);
        assert_eq!(s.scorer_type, "remote");
        assert!(s.produces_score_config_id.is_none());
    }
}
