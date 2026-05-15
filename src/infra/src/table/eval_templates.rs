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
    table::entity::eval_templates::{ActiveModel, Column, Entity, Model},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EvalTemplate {
    pub id: String,
    pub org_id: String,
    pub response_type: String,
    pub name: String,
    pub description: Option<String>,
    pub content: String,
    pub dimensions: Vec<String>,
    pub version: i32,
    pub is_active: bool,
    pub created_by: Option<String>,
    pub created_at: i64,
    pub updated_by: Option<String>,
    pub updated_at: i64,
}

impl From<Model> for EvalTemplate {
    fn from(model: Model) -> Self {
        Self {
            id: model.id,
            org_id: model.org_id,
            response_type: model.response_type,
            name: model.name,
            description: model.description,
            content: model.content,
            dimensions: serde_json::from_value(model.dimensions).unwrap_or_default(),
            version: model.version,
            is_active: model.is_active,
            created_by: model.created_by,
            created_at: model.created_at,
            updated_by: model.updated_by,
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

pub async fn add(template: &EvalTemplate) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let record = ActiveModel {
        id: Set(template.id.clone()),
        org_id: Set(template.org_id.clone()),
        response_type: Set(template.response_type.clone()),
        name: Set(template.name.clone()),
        description: Set(template.description.clone()),
        content: Set(template.content.clone()),
        dimensions: Set(serde_json::json!(template.dimensions)),
        version: Set(template.version),
        is_active: Set(template.is_active),
        created_by: Set(template.created_by.clone()),
        created_at: Set(template.created_at),
        updated_by: Set(template.updated_by.clone()),
        updated_at: Set(template.updated_at),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn update(template: &EvalTemplate) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let record = ActiveModel {
        id: Set(template.id.clone()),
        org_id: Set(template.org_id.clone()),
        response_type: Set(template.response_type.clone()),
        name: Set(template.name.clone()),
        description: Set(template.description.clone()),
        content: Set(template.content.clone()),
        dimensions: Set(serde_json::json!(template.dimensions)),
        version: Set(template.version),
        is_active: Set(template.is_active),
        created_by: Set(template.created_by.clone()),
        created_at: Set(template.created_at),
        updated_by: Set(template.updated_by.clone()),
        updated_at: Set(template.updated_at),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update(record).exec(client).await?;

    Ok(())
}

pub async fn get(id: &str) -> Result<Option<EvalTemplate>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::Id.eq(id))
        .one(client)
        .await?
        .map(EvalTemplate::from);

    Ok(record)
}

pub async fn get_by_response_type(
    org_id: &str,
    response_type: &str,
) -> Result<Vec<EvalTemplate>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ResponseType.eq(response_type))
        .filter(Column::IsActive.eq(true))
        .order_by(Column::Version, Order::Desc)
        .all(client)
        .await?
        .into_iter()
        .map(EvalTemplate::from)
        .collect();

    Ok(records)
}

pub async fn get_all_by_org(org_id: &str) -> Result<Vec<EvalTemplate>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .order_by(Column::CreatedAt, Order::Desc)
        .all(client)
        .await?
        .into_iter()
        .map(EvalTemplate::from)
        .collect();

    Ok(records)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_model() -> Model {
        Model {
            id: "tmpl-1".to_string(),
            org_id: "myorg".to_string(),
            response_type: "json".to_string(),
            name: "test_template".to_string(),
            description: Some("A test template".to_string()),
            content: "Hello {{name}}".to_string(),
            dimensions: serde_json::json!(["accuracy", "relevance"]),
            version: 2,
            is_active: true,
            created_by: Some("admin".to_string()),
            created_at: 1000,
            updated_by: None,
            updated_at: 2000,
        }
    }

    #[test]
    fn test_eval_template_from_model_fields() {
        let model = make_model();
        let et = EvalTemplate::from(model);
        assert_eq!(et.id, "tmpl-1");
        assert_eq!(et.org_id, "myorg");
        assert_eq!(et.response_type, "json");
        assert_eq!(et.name, "test_template");
        assert_eq!(et.version, 2);
        assert!(et.is_active);
        assert_eq!(et.created_at, 1000);
        assert_eq!(et.updated_at, 2000);
    }

    #[test]
    fn test_eval_template_dimensions_deserialized() {
        let model = make_model();
        let et = EvalTemplate::from(model);
        assert_eq!(et.dimensions, vec!["accuracy", "relevance"]);
    }

    #[test]
    fn test_eval_template_invalid_dimensions_defaults_to_empty() {
        let mut model = make_model();
        model.dimensions = serde_json::json!(42);
        let et = EvalTemplate::from(model);
        assert!(et.dimensions.is_empty());
    }

    #[test]
    fn test_eval_template_optional_fields() {
        let mut model = make_model();
        model.description = None;
        model.created_by = None;
        model.updated_by = Some("editor".to_string());
        let et = EvalTemplate::from(model);
        assert!(et.description.is_none());
        assert!(et.created_by.is_none());
        assert_eq!(et.updated_by.as_deref(), Some("editor"));
    }
}
