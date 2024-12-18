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

use config::{ider, meta::destinations, utils::json};
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    ModelTrait, QueryFilter, Set, TryIntoModel,
};

use crate::{
    db::{connect_to_orm, ORM_CLIENT},
    errors::{self, GetDestinationError},
    table::{
        entity::{
            destinations::{ActiveModel, Column, Entity, Model},
            templates,
        },
        get_lock,
    },
};

impl Model {
    fn try_into(
        self,
        template: Option<String>,
    ) -> Result<destinations::Destination, errors::Error> {
        let module = match self.module.to_lowercase().as_str() {
            "alert" => {
                let destination_type: destinations::DestinationType =
                    json::from_value(self.r#type)?;
                let template = template.ok_or(GetDestinationError::AlertDestTemplateNotFound)?;
                destinations::Module::Alert {
                    template,
                    destination_type,
                }
            }
            _ => {
                let pipeline_id = self
                    .pipeline_id
                    .ok_or(GetDestinationError::PipelineDestEmptyPipelineId)?;
                let endpoint: destinations::Endpoint = json::from_value(self.r#type)?;
                destinations::Module::Pipeline {
                    pipeline_id,
                    endpoint,
                }
            }
        };
        Ok(destinations::Destination {
            id: self.id,
            org_id: self.org,
            name: self.name,
            module,
        })
    }
}

pub async fn put(
    org_id: &str,
    destination: destinations::Destination,
) -> Result<destinations::Destination, errors::Error> {
    let template_id = if let destinations::Module::Alert { template, .. } = &destination.module {
        super::templates::get(org_id, template)
            .await?
            .map(|temp| temp.id)
    } else {
        None
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let (model, template): (Model, Option<String>) =
        match get_model_and_template(client, org_id, &destination.name).await? {
            Some((model, ..)) => {
                let mut active: ActiveModel = model.into();
                active.name = Set(destination.name);
                active.org = Set(destination.org_id);
                let new_template = match destination.module {
                    destinations::Module::Alert {
                        template: new_template,
                        destination_type,
                    } => {
                        let template_id =
                            template_id.ok_or(GetDestinationError::AlertDestEmptyTemplateId)?;
                        active.template_id = Set(Some(template_id));
                        active.pipeline_id = Set(None);
                        active.module = Set("alert".to_string());
                        active.r#type = Set(json::to_value(destination_type)?);
                        Some(new_template)
                    }
                    destinations::Module::Pipeline {
                        pipeline_id,
                        endpoint,
                    } => {
                        active.template_id = Set(None);
                        active.pipeline_id = Set(Some(pipeline_id));
                        active.module = Set("pipeline".to_string());
                        active.r#type = Set(json::to_value(endpoint)?);
                        None
                    }
                };
                (active.update(client).await?.try_into_model()?, new_template)
            }
            None => {
                let (active, new_template) = {
                    let mut active = ActiveModel {
                        id: Set(ider::uuid()),
                        org: Set(destination.org_id),
                        name: Set(destination.name),
                        template_id: Set(None),
                        pipeline_id: Set(None),
                        r#type: NotSet,
                        module: NotSet,
                    };
                    let new_template = match destination.module {
                        destinations::Module::Alert {
                            template: new_template,
                            destination_type,
                        } => {
                            let template_id =
                                template_id.ok_or(GetDestinationError::AlertDestEmptyTemplateId)?;
                            active.module = Set("alert".to_string());
                            active.template_id = Set(Some(template_id));
                            active.r#type = Set(json::to_value(destination_type)?);
                            Some(new_template)
                        }
                        destinations::Module::Pipeline {
                            pipeline_id,
                            endpoint,
                        } => {
                            active.module = Set("pipeline".to_string());
                            active.pipeline_id = Set(Some(pipeline_id));
                            active.r#type = Set(json::to_value(endpoint)?);
                            None
                        }
                    };
                    (active, new_template)
                };
                (active.insert(client).await?.try_into_model()?, new_template)
            }
        };
    model.try_into(template)
}

pub async fn get(
    org_id: &str,
    name: &str,
) -> Result<Option<destinations::Destination>, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match get_model_and_template(client, org_id, name).await? {
        Some((model, template)) => Ok(Some(model.try_into(template)?)),
        None => Ok(None),
    }
}

pub async fn list(org_id: &str) -> Result<Vec<destinations::Destination>, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let destinations = list_models(client, Some(org_id))
        .await?
        .into_iter()
        .map(|(model, template)| model.try_into(template))
        .collect::<Result<_, errors::Error>>()?;
    Ok(destinations)
}

pub async fn list_all() -> Result<Vec<destinations::Destination>, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let destinations = list_models(client, None)
        .await?
        .into_iter()
        .map(|(model, template)| model.try_into(template))
        .collect::<Result<_, errors::Error>>()?;
    Ok(destinations)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = get_model_and_template(client, org_id, name).await?;

    if let Some((model, ..)) = model {
        model.delete(client).await?;
    }

    Ok(())
}

async fn get_model_and_template(
    db: &DatabaseConnection,
    org_id: &str,
    name: &str,
) -> Result<Option<(Model, Option<String>)>, sea_orm::DbErr> {
    Ok(Entity::find()
        .find_also_related(templates::Entity)
        .filter(Column::Org.eq(org_id))
        .filter(Column::Name.eq(name))
        .one(db)
        .await?
        .map(|(dest, temp)| (dest, temp.map(|t| t.name))))
}

async fn list_models(
    db: &DatabaseConnection,
    org_id: Option<&str>,
) -> Result<Vec<(Model, Option<String>)>, sea_orm::DbErr> {
    let mut query = Entity::find().find_also_related(templates::Entity);
    if let Some(org) = org_id {
        query = query.filter(Column::Org.eq(org));
    }
    Ok(query
        .all(db)
        .await?
        .into_iter()
        .map(|(dest, temp)| (dest, temp.map(|t| t.name)))
        .collect())
}
