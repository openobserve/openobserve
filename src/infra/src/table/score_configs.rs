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
    ColumnTrait, ConnectionTrait, EntityTrait, Order, QueryFilter, QueryOrder, Schema, Set,
};
use serde::{Deserialize, Serialize};

use super::get_lock;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
    table::entity::score_configs::{ActiveModel, Column, Entity, Model},
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScoreConfigDataType {
    #[default]
    Numeric,
    Categorical,
    Boolean,
}

impl ScoreConfigDataType {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Numeric => "numeric",
            Self::Categorical => "categorical",
            Self::Boolean => "boolean",
        }
    }
}

impl std::str::FromStr for ScoreConfigDataType {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "numeric" => Ok(Self::Numeric),
            "categorical" => Ok(Self::Categorical),
            "boolean" => Ok(Self::Boolean),
            _ => Err(value.to_string()),
        }
    }
}

impl std::fmt::Display for ScoreConfigDataType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScoreConfig {
    pub id: String,
    pub org_id: String,
    pub entity_id: String,
    pub name: String,
    pub version: i32,
    pub data_type: ScoreConfigDataType,
    pub description: Option<String>,
    pub numeric_range: Option<serde_json::Value>,
    pub categories: Option<serde_json::Value>,
    pub healthy_threshold: Option<serde_json::Value>,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Model> for ScoreConfig {
    fn from(model: Model) -> Self {
        Self {
            id: model.id,
            org_id: model.org_id,
            entity_id: model.entity_id,
            name: model.name,
            version: model.version,
            data_type: model.data_type.parse().unwrap_or_default(),
            description: model.description,
            numeric_range: model.numeric_range,
            categories: model.categories,
            healthy_threshold: model.healthy_threshold,
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

pub async fn add(config: &ScoreConfig) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let record = ActiveModel {
        id: Set(config.id.clone()),
        org_id: Set(config.org_id.clone()),
        entity_id: Set(config.entity_id.clone()),
        name: Set(config.name.clone()),
        version: Set(config.version),
        data_type: Set(config.data_type.to_string()),
        description: Set(config.description.clone()),
        numeric_range: Set(config.numeric_range.clone()),
        categories: Set(config.categories.clone()),
        healthy_threshold: Set(config.healthy_threshold.clone()),
        is_active: Set(config.is_active),
        created_at: Set(config.created_at),
        updated_at: Set(config.updated_at),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn update(config: &ScoreConfig) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let record = ActiveModel {
        id: Set(config.id.clone()),
        org_id: Set(config.org_id.clone()),
        entity_id: Set(config.entity_id.clone()),
        name: Set(config.name.clone()),
        version: Set(config.version),
        data_type: Set(config.data_type.to_string()),
        description: Set(config.description.clone()),
        numeric_range: Set(config.numeric_range.clone()),
        categories: Set(config.categories.clone()),
        healthy_threshold: Set(config.healthy_threshold.clone()),
        is_active: Set(config.is_active),
        created_at: Set(config.created_at),
        updated_at: Set(config.updated_at),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update(record).exec(client).await?;

    Ok(())
}

pub async fn get(id: &str) -> Result<Option<ScoreConfig>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::Id.eq(id))
        .one(client)
        .await?
        .map(ScoreConfig::from);

    Ok(record)
}

pub async fn get_by_entity_id(
    org_id: &str,
    entity_id: &str,
) -> Result<Option<ScoreConfig>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::EntityId.eq(entity_id))
        .filter(Column::IsActive.eq(true))
        .order_by(Column::Version, Order::Desc)
        .one(client)
        .await?
        .map(ScoreConfig::from);

    Ok(record)
}

pub async fn get_by_entity_id_and_version(
    org_id: &str,
    entity_id: &str,
    version: i32,
) -> Result<Option<ScoreConfig>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::EntityId.eq(entity_id))
        .filter(Column::Version.eq(version))
        .one(client)
        .await?
        .map(ScoreConfig::from);

    Ok(record)
}

pub async fn get_by_active_name(
    org_id: &str,
    name: &str,
) -> Result<Option<ScoreConfig>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .filter(Column::IsActive.eq(true))
        .order_by(Column::Version, Order::Desc)
        .one(client)
        .await?
        .map(ScoreConfig::from);

    Ok(record)
}

pub async fn get_versions(
    org_id: &str,
    entity_id: &str,
) -> Result<Vec<ScoreConfig>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::EntityId.eq(entity_id))
        .order_by(Column::Version, Order::Desc)
        .all(client)
        .await?
        .into_iter()
        .map(ScoreConfig::from)
        .collect();

    Ok(records)
}

pub async fn get_all_by_org(org_id: &str) -> Result<Vec<ScoreConfig>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    // Get the latest version per logical entity.
    let records: Vec<Model> = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IsActive.eq(true))
        .order_by(Column::Name, Order::Asc)
        .order_by(Column::Version, Order::Desc)
        .all(client)
        .await?;

    // Deduplicate: keep only the highest version per entity.
    let mut seen = std::collections::HashSet::new();
    let records: Vec<_> = records
        .into_iter()
        .map(ScoreConfig::from)
        .filter(|c| seen.insert(c.entity_id.clone()))
        .collect();

    Ok(records)
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

    fn make_model() -> Model {
        Model {
            id: "sc-1".to_string(),
            org_id: "myorg".to_string(),
            entity_id: "scfg-entity-1".to_string(),
            name: "faithfulness".to_string(),
            version: 2,
            data_type: "numeric".to_string(),
            description: Some("Measures factual accuracy".to_string()),
            numeric_range: Some(serde_json::json!({"min": 0.0, "max": 1.0})),
            categories: None,
            healthy_threshold: Some(serde_json::json!({"direction": "gte", "value": 0.7})),
            is_active: true,
            created_at: 1000,
            updated_at: 2000,
        }
    }

    #[test]
    fn test_score_config_from_model_fields() {
        let model = make_model();
        let sc = ScoreConfig::from(model);
        assert_eq!(sc.id, "sc-1");
        assert_eq!(sc.org_id, "myorg");
        assert_eq!(sc.entity_id, "scfg-entity-1");
        assert_eq!(sc.name, "faithfulness");
        assert_eq!(sc.version, 2);
        assert_eq!(sc.data_type, ScoreConfigDataType::Numeric);
        assert!(sc.is_active);
        assert!(sc.categories.is_none());
    }

    #[test]
    fn test_score_config_from_model_categorical() {
        let mut model = make_model();
        model.data_type = "categorical".to_string();
        model.numeric_range = None;
        model.categories = Some(serde_json::json!(["excellent", "good", "poor"]));
        model.healthy_threshold =
            Some(serde_json::json!({"healthy_categories": ["excellent", "good"]}));
        let sc = ScoreConfig::from(model);
        assert_eq!(sc.data_type, ScoreConfigDataType::Categorical);
        assert!(sc.categories.is_some());
        assert!(sc.numeric_range.is_none());
    }

    #[test]
    fn test_score_config_from_model_boolean() {
        let mut model = make_model();
        model.data_type = "boolean".to_string();
        model.numeric_range = None;
        model.healthy_threshold = Some(serde_json::json!({"healthy_value": true}));
        let sc = ScoreConfig::from(model);
        assert_eq!(sc.data_type, ScoreConfigDataType::Boolean);
        assert!(sc.numeric_range.is_none());
    }
}
