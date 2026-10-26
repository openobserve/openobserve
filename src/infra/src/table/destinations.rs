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

use std::str::FromStr;

use config::{ider, meta::destinations, utils::json};
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    ModelTrait, QueryFilter, QueryOrder, QuerySelect, Set, TryIntoModel,
};

use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::{DestinationError, Error},
    table::entity::{
        destinations::{ActiveModel, Column, Entity, Model},
        templates,
    },
};

impl Model {
    fn try_into(self, template: Option<String>) -> Result<destinations::Destination, Error> {
        let module = match self.module.to_lowercase().as_str() {
            "alert" => {
                let destination_type: destinations::DestinationType =
                    json::from_value(self.r#type)?;
                // Template is now optional at destination level - can be specified at alert level
                destinations::Module::Alert {
                    template,
                    destination_type,
                }
            }
            _ => {
                let endpoint: destinations::Endpoint = json::from_value(self.r#type)?;
                destinations::Module::Pipeline { endpoint }
            }
        };
        let id = svix_ksuid::Ksuid::from_str(&self.id)
            .map_err(|e| DestinationError::ConvertingId(e.to_string()))?;
        Ok(destinations::Destination {
            id: Some(id),
            org_id: self.org,
            name: self.name,
            module,
        })
    }
}

pub async fn put(
    destination: destinations::Destination,
) -> Result<destinations::Destination, Error> {
    // Template is now optional - only look it up if one is specified
    let template_id = if let destinations::Module::Alert {
        template: Some(template_name),
        ..
    } = &destination.module
    {
        super::templates::get(&destination.org_id, template_name)
            .await?
            .and_then(|temp| temp.id.map(|id| id.to_string()))
    } else {
        None
    };

    let client = get_orm_client_rw().await;

    let (model, template): (Model, Option<String>) =
        match get_model_and_template(client, &destination.org_id, &destination.name).await? {
            Some((model, ..)) => {
                let mut active: ActiveModel = model.into();
                active.name = Set(destination.name);
                active.org = Set(destination.org_id);
                let new_template = match destination.module {
                    destinations::Module::Alert {
                        template: new_template,
                        destination_type,
                    } => {
                        // Template is optional - only set template_id if a template is specified
                        active.template_id = Set(template_id);
                        active.module = Set("alert".to_string());
                        active.r#type = Set(json::to_value(destination_type)?);
                        new_template
                    }
                    destinations::Module::Pipeline { endpoint } => {
                        active.template_id = Set(None);
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
                        id: Set(destination.id.map_or_else(ider::uuid, |id| id.to_string())),
                        org: Set(destination.org_id),
                        name: Set(destination.name),
                        template_id: Set(None),
                        r#type: NotSet,
                        module: NotSet,
                    };
                    let new_template = match destination.module {
                        destinations::Module::Alert {
                            template: new_template,
                            destination_type,
                        } => {
                            // Template is optional - only set template_id if a template is
                            // specified
                            active.module = Set("alert".to_string());
                            active.template_id = Set(template_id);
                            active.r#type = Set(json::to_value(destination_type)?);
                            new_template
                        }
                        destinations::Module::Pipeline { endpoint } => {
                            active.module = Set("pipeline".to_string());
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

pub async fn get(org_id: &str, name: &str) -> Result<Option<destinations::Destination>, Error> {
    let client = get_orm_client_ro().await;
    match get_model_and_template(client, org_id, name).await? {
        Some((model, template)) => Ok(Some(model.try_into(template)?)),
        None => Ok(None),
    }
}

pub async fn list(
    org_id: &str,
    module: Option<&str>,
) -> Result<Vec<destinations::Destination>, Error> {
    let client = get_orm_client_ro().await;
    Ok(decode_models(
        list_models(client, Some(org_id), module).await?,
    ))
}

pub async fn list_all() -> Result<Vec<destinations::Destination>, Error> {
    let client = get_orm_client_ro().await;
    Ok(decode_models(list_models(client, None, None).await?))
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), Error> {
    let client = get_orm_client_rw().await;
    let model = get_model_and_template(client, org_id, name).await?;

    if let Some((model, ..)) = model {
        model.delete(client).await?;
    }

    Ok(())
}

/// Skips rows this binary cannot decode, so a newer destination type never fails the whole list.
fn decode_models(rows: Vec<(Model, Option<String>)>) -> Vec<destinations::Destination> {
    rows.into_iter()
        .filter_map(|(model, template)| {
            let (org, name) = (model.org.clone(), model.name.clone());
            // The decode error can quote row content, so only the key is logged.
            let decoded = model.try_into(template).ok();
            if decoded.is_none() {
                log::warn!(
                    "[DESTINATIONS] skipping undecodable destination, org: {org}, name: {name}"
                );
            }
            decoded
        })
        .collect()
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
    module: Option<&str>,
) -> Result<Vec<(Model, Option<String>)>, sea_orm::DbErr> {
    let mut query = Entity::find().find_also_related(templates::Entity);
    if let Some(org) = org_id {
        query = query.filter(Column::Org.eq(org));
    }
    if let Some(module) = module {
        let module = module.to_lowercase();
        query = query.filter(Column::Module.eq(&module));
    }
    Ok(query
        .order_by(Column::Name, sea_orm::Order::Asc)
        .all(db)
        .await?
        .into_iter()
        .map(|(dest, temp)| (dest, temp.map(|t| t.name)))
        .collect())
}

/// Deletes all destinations of the org and returns their names.
pub async fn delete_by_org(org_id: &str) -> Result<Vec<String>, Error> {
    let client = get_orm_client_rw().await;
    let delete = Entity::delete_many().filter(Column::Org.eq(org_id));
    Ok(super::delete_returning(client, delete, &[Column::Name]).await?)
}

/// Names of the org's destinations.
pub async fn list_names_by_org(org_id: &str) -> Result<Vec<String>, Error> {
    let client = get_orm_client_ro().await;
    let names = Entity::find()
        .select_only()
        .column(Column::Name)
        .filter(Column::Org.eq(org_id))
        .into_tuple::<String>()
        .all(client)
        .await?;
    Ok(names)
}

#[cfg(test)]
mod tests {
    use svix_ksuid::KsuidLike as _;

    use super::*;

    fn make_model(id: &str, module: &str, type_json: serde_json::Value) -> Model {
        Model {
            id: id.to_string(),
            org: "myorg".to_string(),
            name: "my-dest".to_string(),
            module: module.to_string(),
            template_id: None,
            r#type: type_json,
        }
    }

    #[test]
    fn test_try_into_alert_http_ok() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let type_json = serde_json::json!({"type": "http", "url": "https://example.com"});
        let model = make_model(&id, "alert", type_json);
        let result = model.try_into(None);
        assert!(result.is_ok());
        let dest = result.unwrap();
        assert_eq!(dest.org_id, "myorg");
        assert_eq!(dest.name, "my-dest");
        assert!(matches!(dest.module, destinations::Module::Alert { .. }));
    }

    #[test]
    fn test_try_into_alert_with_template() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let type_json = serde_json::json!({"type": "http", "url": "https://example.com"});
        let model = make_model(&id, "alert", type_json);
        let dest = model.try_into(Some("tmpl".to_string())).unwrap();
        match dest.module {
            destinations::Module::Alert { template, .. } => {
                assert_eq!(template, Some("tmpl".to_string()));
            }
            _ => panic!("expected alert module"),
        }
    }

    #[test]
    fn test_try_into_pipeline_ok() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let type_json = serde_json::json!({"url": "https://pipeline.example.com"});
        let model = make_model(&id, "pipeline", type_json);
        let result = model.try_into(None);
        assert!(result.is_ok());
        assert!(matches!(
            result.unwrap().module,
            destinations::Module::Pipeline { .. }
        ));
    }

    #[test]
    fn decode_models_skips_unknown_destination_type() {
        let good_id = svix_ksuid::Ksuid::new(None, None).to_string();
        let bad_id = svix_ksuid::Ksuid::new(None, None).to_string();
        let good = make_model(
            &good_id,
            "alert",
            serde_json::json!({"type": "http", "url": "https://example.com"}),
        );
        let mut bad = make_model(
            &bad_id,
            "alert",
            serde_json::json!({"type": "slack_app", "installation_id": "inst"}),
        );
        bad.name = "slack-dest".to_string();
        assert!(bad.clone().try_into(None).is_err());
        let decoded = decode_models(vec![(bad, None), (good, None)]);
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].name, "my-dest");
    }

    #[test]
    fn test_try_into_invalid_ksuid_fails() {
        let type_json = serde_json::json!({"type": "http", "url": "https://example.com"});
        let model = make_model("not-a-ksuid", "alert", type_json);
        let result = model.try_into(None);
        assert!(result.is_err());
    }
}
