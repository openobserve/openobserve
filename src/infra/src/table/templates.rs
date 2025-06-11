// Copyright 2025 OpenObserve Inc.
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

use std::str::FromStr;

use config::{
    ider,
    meta::destinations::{Template, TemplateType},
};
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    ModelTrait, QueryFilter, QueryOrder, Set, TryIntoModel,
};

use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{Error, TemplateError},
    table::{
        entity::templates::{ActiveModel, Column, Entity, Model},
        get_lock,
    },
};

const DEFAULT_ORG: &str = "default";

impl TryFrom<Model> for Template {
    type Error = TemplateError;

    fn try_from(value: Model) -> Result<Self, Self::Error> {
        let template_type = match value.title {
            Some(title) => TemplateType::Email { title },
            None => match value.r#type.to_lowercase().as_str() {
                "http" => TemplateType::Http,
                _ => TemplateType::Sns,
            },
        };
        let id = svix_ksuid::Ksuid::from_str(&value.id)
            .map_err(|e| TemplateError::ConvertingId(e.to_string()))?;
        Ok(Self {
            id: Some(id),
            org_id: value.org,
            name: value.name,
            is_default: value.is_default,
            template_type,
            body: value.body,
        })
    }
}

pub async fn put(template: Template) -> Result<Template, Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let title = match &template.template_type {
        TemplateType::Email { title } => Some(title.to_string()),
        _ => None,
    };
    let mut active: ActiveModel = ActiveModel {
        id: NotSet,
        org: Set(template.org_id.to_string()),
        name: Set(template.name.to_string()),
        is_default: Set(template.is_default),
        r#type: Set(template.template_type.to_string()),
        body: Set(template.body),
        title: Set(title),
    };
    let model: Model = match get_model(client, &template.org_id, &template.name).await? {
        Some(model) => {
            active.id = Set(model.id);
            active.update(client).await?.try_into_model()?
        }
        None => {
            active.id = Set(template.id.map_or_else(ider::uuid, |id| id.to_string()));
            active.insert(client).await?.try_into_model()?
        }
    };
    Ok(model.try_into()?)
}

pub async fn get(org_id: &str, name: &str) -> Result<Option<Template>, Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match get_model(client, org_id, name).await? {
        Some(model) => Ok(Some(Template::try_from(model)?)),
        None => Ok(None),
    }
}

pub async fn list(org_id: &str) -> Result<Vec<Template>, Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let templates = list_models(client, Some(org_id))
        .await?
        .into_iter()
        .map(|model| Ok(Template::try_from(model)?))
        .collect::<Result<_, Error>>()?;
    Ok(templates)
}

pub async fn list_all() -> Result<Vec<(String, Template)>, Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let templates = list_models(client, None)
        .await?
        .into_iter()
        .map(|model| Ok((model.org.to_string(), Template::try_from(model)?)))
        .collect::<Result<_, Error>>()?;
    Ok(templates)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), Error> {
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
        .filter(Column::Org.eq(org_id).or(Column::Org.eq(DEFAULT_ORG)))
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
    query
        .order_by(Column::Name, sea_orm::Order::Asc)
        .all(db)
        .await
}
