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
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    EntityTrait, ModelTrait, QueryFilter, QueryOrder, QuerySelect, Set, TryIntoModel,
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
    put_in(get_orm_client_rw().await, destination).await
}

pub async fn put_in<C: ConnectionTrait>(
    conn: &C,
    destination: destinations::Destination,
) -> Result<destinations::Destination, Error> {
    // Template is now optional - only look it up if one is specified
    let template_id = if let destinations::Module::Alert {
        template: Some(template_name),
        ..
    } = &destination.module
    {
        super::templates::get_with(conn, &destination.org_id, template_name)
            .await?
            .and_then(|temp| temp.id.map(|id| id.to_string()))
    } else {
        None
    };

    let stored_type = stored_type(&destination.module)?;

    let (model, template): (Model, Option<String>) =
        match get_model_and_template(conn, &destination.org_id, &destination.name).await? {
            Some((model, ..)) => {
                let mut active: ActiveModel = model.into();
                active.name = Set(destination.name);
                active.org = Set(destination.org_id);
                let new_template = match destination.module {
                    destinations::Module::Alert {
                        template: new_template,
                        ..
                    } => {
                        // Template is optional - only set template_id if a template is specified
                        active.template_id = Set(template_id);
                        active.module = Set("alert".to_string());
                        active.r#type = Set(stored_type);
                        new_template
                    }
                    destinations::Module::Pipeline { .. } => {
                        active.template_id = Set(None);
                        active.module = Set("pipeline".to_string());
                        active.r#type = Set(stored_type);
                        None
                    }
                };
                (active.update(conn).await?.try_into_model()?, new_template)
            }
            None => {
                let (active, new_template) = {
                    let mut active = ActiveModel {
                        id: Set(destination.id.map_or_else(ider::ksuid, |id| id.to_string())),
                        org: Set(destination.org_id),
                        name: Set(destination.name),
                        template_id: Set(None),
                        r#type: NotSet,
                        module: NotSet,
                    };
                    let new_template = match destination.module {
                        destinations::Module::Alert {
                            template: new_template,
                            ..
                        } => {
                            // Template is optional - only set template_id if a template is
                            // specified
                            active.module = Set("alert".to_string());
                            active.template_id = Set(template_id);
                            active.r#type = Set(stored_type);
                            new_template
                        }
                        destinations::Module::Pipeline { .. } => {
                            active.module = Set("pipeline".to_string());
                            active.r#type = Set(stored_type);
                            None
                        }
                    };
                    (active, new_template)
                };
                (active.insert(conn).await?.try_into_model()?, new_template)
            }
        };
    model.try_into(template)
}

pub async fn get(org_id: &str, name: &str) -> Result<Option<destinations::Destination>, Error> {
    get_on(get_orm_client_ro().await, org_id, name).await
}

pub async fn get_on<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    name: &str,
) -> Result<Option<destinations::Destination>, Error> {
    // An old node reads a newer release's type as not found, as the list path does.
    Ok(get_model_and_template(db, org_id, name)
        .await?
        .and_then(|row| decode_models(vec![row]).pop()))
}

/// Whether a row exists under this name, decodable by this binary or not.
pub async fn exists_row(org_id: &str, name: &str) -> Result<bool, Error> {
    exists_row_on(get_orm_client_ro().await, org_id, name).await
}

pub async fn exists_row_on<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    name: &str,
) -> Result<bool, Error> {
    Ok(Entity::find()
        .filter(Column::Org.eq(org_id))
        .filter(Column::Name.eq(name))
        .one(db)
        .await?
        .is_some())
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

fn stored_type(module: &destinations::Module) -> Result<json::Value, Error> {
    let mut stored;
    let (endpoint, fields) = match module {
        destinations::Module::Alert {
            destination_type, ..
        } => {
            stored = json::to_value(destination_type)?;
            match destination_type {
                destinations::DestinationType::Http(endpoint) => (endpoint, &mut stored),
                destinations::DestinationType::SlackApp(target) => match &target.previous_webhook {
                    Some(endpoint) => (endpoint, &mut stored["previous_webhook"]),
                    None => return Ok(stored),
                },
                destinations::DestinationType::Sns(_) | destinations::DestinationType::Email(_) => {
                    return Ok(stored);
                }
            }
        }
        destinations::Module::Pipeline { endpoint } => {
            stored = json::to_value(endpoint)?;
            (endpoint, &mut stored)
        }
    };
    // An older reader must reject the whole destination even when only a header carries a ref.
    if endpoint.uses_store_refs() {
        fields["url"] = json::json!({"t": endpoint.url});
    }
    Ok(stored)
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

async fn get_model_and_template<C: ConnectionTrait>(
    db: &C,
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

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectionTrait, Database, Schema, TransactionTrait};
    use svix_ksuid::KsuidLike as _;

    use super::*;

    #[derive(Default, serde::Deserialize, serde::Serialize)]
    #[serde(default)]
    struct FrozenEndpoint {
        url: String,
        #[serde(default)]
        method: destinations::HTTPType,
        #[serde(default)]
        skip_tls_verify: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        headers: Option<hashbrown::HashMap<String, String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output_format: Option<destinations::HTTPOutputFormat>,
        #[serde(skip_serializing_if = "Option::is_none")]
        destination_type: Option<String>,
        #[serde(default)]
        metadata: hashbrown::HashMap<String, String>,
    }

    #[tokio::test]
    async fn put_in_reads_the_template_on_the_callers_transaction() {
        if std::env::var_os("ZO_META_STORE").is_none() {
            return;
        }
        let db = db_with_rows().await;
        let txn = db.begin().await.unwrap();
        let template = destinations::Template {
            name: "new-template".into(),
            org_id: "myorg".into(),
            ..Default::default()
        };
        let template = crate::table::templates::put_with(&txn, template)
            .await
            .unwrap();
        let dest = destinations::Destination {
            name: "uses-template".into(),
            org_id: template.org_id,
            module: destinations::Module::Alert {
                template: Some(template.name),
                destination_type: Default::default(),
            },
            id: None,
        };
        put_in(&txn, dest).await.unwrap();
        let row = get_model_and_template(&txn, "myorg", "uses-template")
            .await
            .unwrap()
            .unwrap()
            .0;
        assert_eq!(row.template_id, Some(template.id.unwrap().to_string()));
        txn.rollback().await.unwrap();
        assert!(!exists_row_on(&db, "myorg", "uses-template").await.unwrap());
    }

    #[tokio::test]
    async fn stored_endpoint_fences_every_store_ref_for_older_readers() {
        if std::env::var_os("ZO_META_STORE").is_none() {
            return;
        }
        if std::env::var_os("O2_DESTINATION_FENCE_TEST").is_none() {
            let path = concat!(
                module_path!(),
                "::stored_endpoint_fences_every_store_ref_for_older_readers"
            );
            let (_, test) = path.split_once("::").unwrap();
            for enabled in ["false", "true"] {
                let output = std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", test, "--nocapture"])
                    .env("O2_DESTINATION_FENCE_TEST", enabled)
                    .env("O2_SECRET_STORE_REFS_ENABLED", enabled)
                    .output()
                    .unwrap();
                let stdout = String::from_utf8_lossy(&output.stdout);
                assert!(
                    output.status.success() && stdout.contains("1 passed"),
                    "refs enabled={enabled}: {stdout}\n{}",
                    String::from_utf8_lossy(&output.stderr)
                );
            }
            return;
        }
        let enabled = std::env::var("O2_DESTINATION_FENCE_TEST").unwrap() == "true";
        assert_eq!(
            config::get_config().common.secret_store_refs_enabled,
            enabled
        );
        let db = db_with_rows().await;
        for pipeline in [false, true] {
            for (field, value, fenced) in [
                (
                    "url",
                    serde_json::json!("https://example.com/{{secrets.PATH}}"),
                    true,
                ),
                (
                    "headers",
                    serde_json::json!({"Authorization": "Bearer {{secrets.TOKEN}}"}),
                    true,
                ),
                (
                    "metadata",
                    serde_json::json!({"routing_key": "{{secrets.KEY}}"}),
                    true,
                ),
                (
                    "headers",
                    serde_json::json!({"Authorization": "literal"}),
                    false,
                ),
            ] {
                let fenced = fenced && enabled;
                let mut input = serde_json::json!({"url":"https://example.com"});
                input[field] = value;
                let endpoint: destinations::Endpoint = serde_json::from_value(input).unwrap();
                let module = if pipeline {
                    destinations::Module::Pipeline {
                        endpoint: endpoint.clone(),
                    }
                } else {
                    destinations::Module::Alert {
                        template: None,
                        destination_type: destinations::DestinationType::Http(endpoint.clone()),
                    }
                };
                let dest = destinations::Destination {
                    name: "fence".into(),
                    org_id: "myorg".into(),
                    module,
                    id: None,
                };
                let txn = db.begin().await.unwrap();
                put_in(&txn, dest.clone()).await.unwrap();
                txn.commit().await.unwrap();
                let stored = get_model_and_template(&db, "myorg", "fence")
                    .await
                    .unwrap()
                    .unwrap()
                    .0
                    .r#type;
                let mut expected = serde_json::to_value(&endpoint).unwrap();
                if !pipeline {
                    expected["type"] = serde_json::json!("http");
                }
                if fenced {
                    expected["url"] = serde_json::json!({"t": endpoint.url});
                }
                assert_eq!(stored, expected);
                assert_eq!(
                    serde_json::from_value::<FrozenEndpoint>(stored).is_err(),
                    fenced
                );
                let read = get_on(&db, "myorg", "fence").await.unwrap().unwrap();
                assert_eq!(
                    serde_json::to_value(read.module).unwrap(),
                    serde_json::to_value(dest.module).unwrap()
                );
                let rows = list_models(&db, Some("myorg"), None).await.unwrap();
                assert!(decode_models(rows).iter().any(|dest| dest.name == "fence"));
            }
        }
    }

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
            serde_json::json!({"type": "from_a_newer_release", "installation_id": "inst"}),
        );
        bad.name = "newer-dest".to_string();
        assert!(bad.clone().try_into(None).is_err());
        let decoded = decode_models(vec![(bad, None), (good, None)]);
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].name, "my-dest");
    }

    async fn db_with_rows() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(templates::Entity),
            schema.create_table_from_entity(Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        for name in ["my-dest", "slack-dest"] {
            ActiveModel {
                id: Set(svix_ksuid::Ksuid::new(None, None).to_string()),
                org: Set("myorg".to_string()),
                name: Set(name.to_string()),
                module: Set("alert".to_string()),
                template_id: Set(None),
                r#type: Set(serde_json::json!({"type": "http", "url": "https://example.com"})),
            }
            .insert(&db)
            .await
            .unwrap();
        }
        db.execute_unprepared(
            r#"UPDATE destinations SET type='{"type":"from_a_newer_release"}' WHERE name='slack-dest'"#,
        )
        .await
        .unwrap();
        db
    }

    #[tokio::test]
    async fn get_skips_undecodable_row() {
        let db = db_with_rows().await;
        assert!(
            get_on(&db, "myorg", "slack-dest").await.unwrap().is_none(),
            "an undecodable row reads as not found"
        );
        assert!(exists_row_on(&db, "myorg", "slack-dest").await.unwrap());
        assert!(!exists_row_on(&db, "myorg", "no-such").await.unwrap());
        let good = get_on(&db, "myorg", "my-dest").await.unwrap().unwrap();
        assert_eq!(good.name, "my-dest");
        let listed = decode_models(list_models(&db, Some("myorg"), None).await.unwrap());
        assert_eq!(
            listed.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(),
            ["my-dest"]
        );
    }

    #[test]
    fn test_try_into_invalid_ksuid_fails() {
        let type_json = serde_json::json!({"type": "http", "url": "https://example.com"});
        let model = make_model("not-a-ksuid", "alert", type_json);
        let result = model.try_into(None);
        assert!(result.is_err());
    }
}
