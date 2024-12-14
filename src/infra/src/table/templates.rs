// Copyright 2024 OpenObserve Inc.
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

use config::{ider, meta::alerts::templates::Template};
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    ModelTrait, QueryFilter, Set, TryIntoModel,
};

use crate::{
    db::{connect_to_orm, ORM_CLIENT},
    errors,
    table::{
        entity::templates::{ActiveModel, Column, Entity, Model},
        get_lock,
    },
};

impl From<Model> for Template {
    fn from(value: Model) -> Self {
        Self {
            name: value.name,
            body: value.body,
            is_default: value.is_default.then_some(true),
            template_type: value.r#type.as_str().into(),
            title: value.title.unwrap_or_default(),
        }
    }
}

pub async fn put(org_id: &str, template: Template) -> Result<Template, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut active: ActiveModel = match get_model(client, org_id, &template.name).await? {
        Some(model) => model.into(),
        None => ActiveModel {
            id: Set(ider::uuid()),
            org: Set(org_id.to_string()),
            name: NotSet,
            is_default: Set(template.is_default.unwrap_or_default()),
            r#type: Set(template.template_type.to_string()),
            body: Set(template.body),
            title: Set(template.title.is_empty().then_some(template.title)),
        },
    };

    active.name = Set(template.name);
    let model: Model = active.save(client).await?.try_into_model()?;
    Ok(model.into())
}

pub async fn get(org_id: &str, name: &str) -> Result<Option<Template>, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let template = get_model(client, org_id, name)
        .await
        .map(|model| model.map(Template::from))?;
    Ok(template)
}

pub async fn list(org_id: &str) -> Result<Vec<Template>, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let templates = list_models(client, Some(org_id))
        .await?
        .into_iter()
        .map(Template::from)
        .collect();
    Ok(templates)
}

pub async fn list_all() -> Result<Vec<(String, Template)>, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let templates = list_models(client, None)
        .await?
        .into_iter()
        .map(|model| (model.org.to_string(), Template::from(model)))
        .collect();
    Ok(templates)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = get_model(client, org_id, name).await?;

    if let Some(model) = model {
        model.delete(client).await?;
    }

    Ok(())
}

async fn get_model(
    db: &DatabaseConnection,
    org_id: &str,
    name: &str,
) -> Result<Option<Model>, sea_orm::DbErr> {
    Entity::find()
        .filter(Column::Org.eq(org_id))
        .filter(Column::Name.eq(name))
        .one(db)
        .await
}

async fn list_models(
    db: &DatabaseConnection,
    org_id: Option<&str>,
) -> Result<Vec<Model>, sea_orm::DbErr> {
    let mut query = Entity::find();
    if let Some(org) = org_id {
        query = query.filter(Column::Org.eq(org));
    }
    query.all(db).await
}
