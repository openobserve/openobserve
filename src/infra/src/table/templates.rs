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

use config::{
    ider,
    meta::destinations::{Template, TemplateKind, TemplateType},
};
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, EntityTrait, ModelTrait,
    QueryFilter, QueryOrder, QuerySelect, Set, TryIntoModel,
};

use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::{Error, TemplateError},
    table::entity::templates::{ActiveModel, Column, Entity, Model},
};

const DEFAULT_ORG: &str = "default";
/// Names per `IN` list, well under every backend's bind-parameter limit.
const NAMES_PER_QUERY: usize = 500;

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
            kind: TemplateKind::from(value.kind.as_str()),
        })
    }
}

pub async fn put(template: Template) -> Result<Template, Error> {
    let client = get_orm_client_rw().await;
    put_with(client, template).await
}

/// Upserts the row owned by the template's org; the shared default row is never the target.
pub async fn put_with<C: ConnectionTrait>(db: &C, template: Template) -> Result<Template, Error> {
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
        kind: Set(template.kind.to_string()),
    };
    let model: Model = match get_org_model(db, &template.org_id, &template.name).await? {
        Some(model) => {
            active.id = Set(model.id);
            active.update(db).await?.try_into_model()?
        }
        None => {
            active.id = Set(template.id.map_or_else(ider::uuid, |id| id.to_string()));
            active.insert(db).await?.try_into_model()?
        }
    };
    Ok(model.try_into()?)
}

pub async fn get(org_id: &str, name: &str) -> Result<Option<Template>, Error> {
    let client = get_orm_client_ro().await;
    get_with(client, org_id, name).await
}

/// Returns the org's own row, falling back to the shared default org.
pub async fn get_with<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    name: &str,
) -> Result<Option<Template>, Error> {
    match get_model(db, org_id, name).await? {
        Some(model) => Ok(Some(Template::try_from(model)?)),
        None => Ok(None),
    }
}

pub async fn list(org_id: &str) -> Result<Vec<Template>, Error> {
    let client = get_orm_client_ro().await;
    let templates = list_models(client, Some(org_id))
        .await?
        .into_iter()
        .map(|model| Ok(Template::try_from(model)?))
        .collect::<Result<_, Error>>()?;
    Ok(templates)
}

pub async fn list_all() -> Result<Vec<(String, Template)>, Error> {
    let client = get_orm_client_ro().await;
    let templates = list_models(client, None)
        .await?
        .into_iter()
        .map(|model| Ok((model.org.to_string(), Template::try_from(model)?)))
        .collect::<Result<_, Error>>()?;
    Ok(templates)
}

/// Deletes the template owned by `org_id`; returns whether a row was removed.
pub async fn delete(org_id: &str, name: &str) -> Result<bool, Error> {
    let client = get_orm_client_rw().await;
    delete_with(client, org_id, name).await
}

/// Deletes the row owned by `org_id`; returns whether a row was removed.
pub async fn delete_with<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    name: &str,
) -> Result<bool, Error> {
    match get_org_model(db, org_id, name).await? {
        Some(model) => {
            model.delete(db).await?;
            Ok(true)
        }
        None => Ok(false),
    }
}

async fn get_org_model<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    name: &str,
) -> Result<Option<Model>, sea_orm::DbErr> {
    Entity::find()
        .filter(Column::Org.eq(org_id))
        .filter(Column::Name.eq(name))
        .one(db)
        .await
}

// Reads fall back to the shared default org; writes stay org-exact via `get_org_model`.
async fn get_model<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    name: &str,
) -> Result<Option<Model>, sea_orm::DbErr> {
    if let Some(model) = get_org_model(db, org_id, name).await? {
        return Ok(Some(model));
    }
    if org_id == DEFAULT_ORG {
        return Ok(None);
    }
    get_org_model(db, DEFAULT_ORG, name).await
}

async fn list_models<C: ConnectionTrait>(
    db: &C,
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

/// Deletes all templates belonging to the given org.
pub async fn delete_by_org(org_id: &str) -> Result<(), Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::Org.eq(org_id))
        .exec(client)
        .await?;
    Ok(())
}

/// `(id, name)` of each template of exactly this org.
pub async fn list_ids_by_org(org_id: &str) -> Result<Vec<(String, String)>, Error> {
    let client = get_orm_client_ro().await;
    let ids = Entity::find()
        .select_only()
        .column(Column::Id)
        .column(Column::Name)
        .filter(Column::Org.eq(org_id))
        .into_tuple::<(String, String)>()
        .all(client)
        .await?;
    Ok(ids)
}

/// The `names` another org holds while not deleting or deleted (no row = live), once per name.
pub async fn names_held_by_live_orgs(org_id: &str, names: &[String]) -> Result<Vec<String>, Error> {
    use sea_orm::sea_query::Query;

    use crate::{
        coordinator::org_status::{STATUS_DELETED, STATUS_DELETING},
        table::entity::organizations,
    };

    let client = get_orm_client_ro().await;
    let mut held = Vec::new();
    for chunk in names.chunks(NAMES_PER_QUERY) {
        // The inverse set is small: only orgs being deleted, never every live org.
        let gone = Query::select()
            .column(organizations::Column::Identifier)
            .from(organizations::Entity)
            .and_where(organizations::Column::Status.is_in([STATUS_DELETING, STATUS_DELETED]))
            .to_owned();
        let found = Entity::find()
            .select_only()
            .column(Column::Name)
            .filter(Column::Name.is_in(chunk.iter().cloned()))
            .filter(Column::Org.ne(org_id))
            .filter(Column::Org.not_in_subquery(gone))
            .distinct()
            .into_tuple::<String>()
            .all(client)
            .await?;
        held.extend(found);
    }
    Ok(held)
}

pub async fn delete_by_id(org_id: &str, id: &str) -> Result<bool, Error> {
    delete_by_id_with(get_orm_client_rw().await, org_id, id).await
}

pub async fn delete_by_org_returning(org_id: &str) -> Result<Vec<(String, String)>, Error> {
    delete_by_org_returning_with(get_orm_client_rw().await, org_id).await
}

async fn delete_by_id_with<C: ConnectionTrait>(
    client: &C,
    org_id: &str,
    id: &str,
) -> Result<bool, Error> {
    let deleted = Entity::delete_many()
        .filter(Column::Id.eq(id))
        .filter(Column::Org.eq(org_id))
        .exec(client)
        .await?;
    Ok(deleted.rows_affected > 0)
}

async fn delete_by_org_returning_with<C: ConnectionTrait>(
    client: &C,
    org_id: &str,
) -> Result<Vec<(String, String)>, Error> {
    let delete = Entity::delete_many().filter(Column::Org.eq(org_id));
    Ok(super::delete_returning(client, delete, &[Column::Id, Column::Name]).await?)
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection, Schema};
    use svix_ksuid::KsuidLike;

    use super::*;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db
    }

    fn template(org: &str, name: &str, body: &str) -> Template {
        Template {
            org_id: org.to_string(),
            name: name.to_string(),
            body: body.to_string(),
            template_type: TemplateType::Http,
            ..Default::default()
        }
    }

    async fn bodies(db: &DatabaseConnection, name: &str) -> Vec<(String, String)> {
        Entity::find()
            .filter(Column::Name.eq(name))
            .order_by(Column::Org, sea_orm::Order::Asc)
            .all(db)
            .await
            .unwrap()
            .into_iter()
            .map(|m| (m.org, m.body))
            .collect()
    }

    #[tokio::test]
    async fn put_from_another_org_never_touches_the_default_row() {
        let db = db().await;
        put_with(&db, template(DEFAULT_ORG, "foo", "shared"))
            .await
            .unwrap();
        put_with(&db, template("acme", "foo", "mine"))
            .await
            .unwrap();
        put_with(&db, template("acme", "foo", "mine-v2"))
            .await
            .unwrap();
        assert_eq!(
            bodies(&db, "foo").await,
            vec![
                ("acme".to_string(), "mine-v2".to_string()),
                (DEFAULT_ORG.to_string(), "shared".to_string()),
            ]
        );
    }

    #[tokio::test]
    async fn delete_from_another_org_leaves_the_default_row() {
        let db = db().await;
        put_with(&db, template(DEFAULT_ORG, "foo", "shared"))
            .await
            .unwrap();
        assert!(!delete_with(&db, "acme", "foo").await.unwrap());
        assert_eq!(
            bodies(&db, "foo").await,
            vec![(DEFAULT_ORG.to_string(), "shared".to_string())]
        );
        assert!(delete_with(&db, DEFAULT_ORG, "foo").await.unwrap());
        assert!(bodies(&db, "foo").await.is_empty());
    }

    #[tokio::test]
    async fn get_prefers_the_org_row_and_falls_back_to_default() {
        let db = db().await;
        put_with(&db, template(DEFAULT_ORG, "foo", "shared"))
            .await
            .unwrap();
        put_with(&db, template("acme", "foo", "mine"))
            .await
            .unwrap();
        let body = |t: Option<Template>| t.map(|t| t.body);
        assert_eq!(
            body(get_with(&db, "acme", "foo").await.unwrap()),
            Some("mine".to_string())
        );
        assert_eq!(
            body(get_with(&db, "other", "foo").await.unwrap()),
            Some("shared".to_string())
        );
        assert_eq!(body(get_with(&db, "other", "bar").await.unwrap()), None);
    }

    fn make_model(id: &str, title: Option<&str>, tmpl_type: &str) -> Model {
        Model {
            id: id.to_string(),
            org: "myorg".to_string(),
            name: "my-template".to_string(),
            is_default: false,
            r#type: tmpl_type.to_string(),
            body: r#"{"text": "alert"}"#.to_string(),
            title: title.map(|s| s.to_string()),
            kind: "custom".to_string(),
        }
    }

    #[test]
    fn test_try_from_model_email_template() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let model = make_model(&id, Some("Alert Subject"), "email");
        let tmpl = Template::try_from(model).unwrap();
        assert_eq!(tmpl.org_id, "myorg");
        assert_eq!(tmpl.name, "my-template");
        assert!(!tmpl.is_default);
        assert!(
            matches!(tmpl.template_type, TemplateType::Email { title } if title == "Alert Subject")
        );
    }

    #[test]
    fn test_try_from_model_sns_template() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let model = make_model(&id, None, "slack");
        let tmpl = Template::try_from(model).unwrap();
        assert!(matches!(tmpl.template_type, TemplateType::Sns));
    }

    #[test]
    fn test_try_from_model_invalid_ksuid() {
        let model = make_model("bad-id", None, "http");
        let result = Template::try_from(model);
        assert!(result.is_err());
    }

    #[test]
    fn test_try_from_model_http_type_case_insensitive() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let model = make_model(&id, None, "HTTP");
        let tmpl = Template::try_from(model).unwrap();
        assert!(matches!(tmpl.template_type, TemplateType::Http));
    }

    #[test]
    fn test_try_from_model_is_default_true() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let mut model = make_model(&id, None, "http");
        model.is_default = true;
        let tmpl = Template::try_from(model).unwrap();
        assert!(tmpl.is_default);
    }

    #[test]
    fn test_try_from_model_body_preserved() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let model = make_model(&id, None, "http");
        let tmpl = Template::try_from(model).unwrap();
        assert_eq!(tmpl.body, r#"{"text": "alert"}"#);
    }

    #[test]
    fn test_try_from_model_kind_content() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let mut model = make_model(&id, None, "http");
        model.kind = "content".to_string();
        let tmpl = Template::try_from(model).unwrap();
        assert_eq!(tmpl.kind, TemplateKind::Content);
    }

    #[tokio::test]
    async fn destination_template_lookup_never_resolves_another_nondefault_org() {
        let db = db().await;
        put_with(&db, template("owner", "private", "mine"))
            .await
            .unwrap();
        assert!(get_with(&db, "other", "private").await.unwrap().is_none());
        assert_eq!(
            get_with(&db, "owner", "private")
                .await
                .unwrap()
                .unwrap()
                .org_id,
            "owner"
        );
        put_with(&db, template(DEFAULT_ORG, "private", "shared"))
            .await
            .unwrap();
        assert_eq!(
            get_with(&db, "other", "private")
                .await
                .unwrap()
                .unwrap()
                .org_id,
            DEFAULT_ORG
        );
    }

    #[tokio::test]
    async fn org_teardown_deletes_every_owned_template_without_touching_other_orgs() {
        let db = db().await;
        for org in ["deleted", "live", DEFAULT_ORG] {
            put_with(&db, template(org, "shared-name", org))
                .await
                .unwrap();
        }
        let owned = get_with(&db, "deleted", "shared-name")
            .await
            .unwrap()
            .unwrap();
        let owned_id = owned.id.unwrap().to_string();
        assert!(!delete_by_id_with(&db, "live", &owned_id).await.unwrap());
        assert!(delete_by_id_with(&db, "deleted", &owned_id).await.unwrap());
        put_with(&db, template("deleted", "late", "late"))
            .await
            .unwrap();
        let removed = delete_by_org_returning_with(&db, "deleted").await.unwrap();
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].1, "late");
        assert!(
            delete_by_org_returning_with(&db, "deleted")
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            bodies(&db, "shared-name").await,
            [
                (DEFAULT_ORG.to_string(), DEFAULT_ORG.to_string()),
                ("live".to_string(), "live".to_string())
            ]
        );
    }
}
