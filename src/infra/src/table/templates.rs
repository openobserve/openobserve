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
    meta::{
        alerts::notification_kind::NotificationKind,
        destinations::{Template, TemplateKind, TemplateType},
    },
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
            applies_to: applies_to_from_column(&value.applies_to),
        })
    }
}

/// A stored value that does not parse, or names a kind this binary lacks, drops that entry.
fn applies_to_from_column(value: &str) -> Vec<NotificationKind> {
    serde_json::from_str::<Vec<String>>(value)
        .unwrap_or_default()
        .iter()
        .filter_map(|k| NotificationKind::parse(k))
        .collect()
}

fn applies_to_column(kinds: &[NotificationKind]) -> String {
    let names: Vec<&str> = kinds.iter().map(|k| k.as_str()).collect();
    serde_json::to_string(&names).unwrap_or_else(|_| "[]".to_string())
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
        applies_to: Set(applies_to_column(&template.applies_to)),
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

/// The prefix of compiled default names; every name under it is reserved.
pub const RESERVED_PREFIX: &str = "o2_default_";
/// The setting keys whose values can name a template.
const POINTER_KEYS: [&str; 2] = ["default_alert_template", "default_templates"];

/// One user row moved out of the reserved prefix.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReservedRename {
    pub org: String,
    pub from: String,
    pub to: String,
}

/// A shipped seed row: the default org, written by the seeder (not `is_default`), Content.
fn is_shipped_seed(org: &str, is_default: bool, kind: &str) -> bool {
    org == DEFAULT_ORG && !is_default && kind == TemplateKind::Content.to_string()
}

/// Renames user rows under `o2_default_` to `user_{name}` and moves their references.
pub async fn rename_reserved_collisions<C>(db: &C) -> Result<Vec<ReservedRename>, sea_orm::DbErr>
where
    C: ConnectionTrait + sea_orm::TransactionTrait,
{
    let txn = db.begin().await?;
    let mut rows: Vec<Model> = Entity::find()
        .filter(Column::Name.like(format!("{RESERVED_PREFIX}%")))
        .all(&txn)
        .await?
        .into_iter()
        .filter(|m| m.name.starts_with(RESERVED_PREFIX))
        .filter(|m| !is_shipped_seed(&m.org, m.is_default, &m.kind))
        .collect();
    // Other orgs first, so a reference left on the old name afterwards reads the default row.
    rows.sort_by_key(|m| (m.org == DEFAULT_ORG, m.org.clone(), m.name.clone()));
    let mut renames = Vec::with_capacity(rows.len());
    for row in rows {
        let to = free_name(&txn, &row.org, &row.name).await?;
        Entity::update_many()
            .col_expr(Column::Name, sea_orm::sea_query::Expr::value(to.clone()))
            .filter(Column::Id.eq(row.id.clone()))
            .exec(&txn)
            .await?;
        let scope = (row.org != DEFAULT_ORG).then_some(row.org.as_str());
        follow_rename(&txn, scope, &row.name, &to).await?;
        renames.push(ReservedRename {
            org: row.org,
            from: row.name,
            to,
        });
    }
    txn.commit().await?;
    Ok(renames)
}

async fn free_name<C: ConnectionTrait>(
    db: &C,
    org: &str,
    name: &str,
) -> Result<String, sea_orm::DbErr> {
    let base = format!("user_{name}");
    let mut candidate = base.clone();
    let mut n = 1;
    while get_org_model(db, org, &candidate).await?.is_some() {
        n += 1;
        candidate = format!("{base}_{n}");
    }
    Ok(candidate)
}

/// Points alerts, composites and org template settings at the new name; `None` is every org.
async fn follow_rename<C: ConnectionTrait>(
    db: &C,
    org: Option<&str>,
    from: &str,
    to: &str,
) -> Result<(), sea_orm::DbErr> {
    use sea_orm::sea_query::Expr;

    use super::entity::{alert_composites, alerts, system_settings};

    let mut alerts_update = alerts::Entity::update_many()
        .col_expr(alerts::Column::Template, Expr::value(to))
        .filter(alerts::Column::Template.eq(from));
    let mut composites_update = alert_composites::Entity::update_many()
        .col_expr(alert_composites::Column::Template, Expr::value(to))
        .filter(alert_composites::Column::Template.eq(from));
    let mut settings = system_settings::Entity::find()
        .filter(system_settings::Column::Scope.eq("org"))
        .filter(system_settings::Column::SettingKey.is_in(POINTER_KEYS));
    if let Some(org) = org {
        alerts_update = alerts_update.filter(alerts::Column::Org.eq(org));
        composites_update = composites_update.filter(alert_composites::Column::Org.eq(org));
        settings = settings.filter(system_settings::Column::OrgId.eq(org));
    }
    alerts_update.exec(db).await?;
    composites_update.exec(db).await?;
    for setting in settings.all(db).await? {
        let mut value = setting.setting_value.clone();
        if !rename_in_value(&mut value, from, to) {
            continue;
        }
        let mut active: system_settings::ActiveModel = setting.into();
        active.setting_value = Set(value);
        active.update(db).await?;
    }
    Ok(())
}

/// Replaces every string value equal to `from` one level deep; returns whether one changed.
fn rename_in_value(value: &mut serde_json::Value, from: &str, to: &str) -> bool {
    let Some(map) = value.as_object_mut() else {
        return false;
    };
    let mut changed = false;
    for v in map.values_mut() {
        if v.as_str() == Some(from) {
            *v = serde_json::Value::String(to.to_string());
            changed = true;
        }
    }
    changed
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
            applies_to: "[]".to_string(),
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

    /// A templates entity as a binary before stage 2 knew it: no `applies_to`.
    mod old_binary {
        use sea_orm::entity::prelude::*;

        #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
        #[sea_orm(table_name = "templates")]
        pub struct Model {
            #[sea_orm(primary_key, auto_increment = false)]
            pub id: String,
            pub org: String,
            pub name: String,
            pub is_default: bool,
            pub r#type: String,
            pub body: String,
            pub title: Option<String>,
            pub kind: String,
        }

        #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
        pub enum Relation {}

        impl ActiveModelBehavior for ActiveModel {}
    }

    #[tokio::test]
    async fn an_old_binary_update_keeps_applies_to() {
        let db = db().await;
        let mut t = template("acme", "ops-card", "v1");
        t.applies_to = vec![NotificationKind::Anomaly, NotificationKind::Incident];
        let saved = put_with(&db, t).await.unwrap();
        let id = saved.id.unwrap().to_string();

        // The old put_with names every column it knows and updates by id.
        old_binary::ActiveModel {
            id: Set(id),
            org: Set("acme".to_string()),
            name: Set("ops-card".to_string()),
            is_default: Set(false),
            r#type: Set("http".to_string()),
            body: Set("v2".to_string()),
            title: Set(None),
            kind: Set("custom".to_string()),
        }
        .update(&db)
        .await
        .unwrap();

        let read = get_with(&db, "acme", "ops-card").await.unwrap().unwrap();
        assert_eq!(read.body, "v2");
        assert_eq!(
            read.applies_to,
            vec![NotificationKind::Anomaly, NotificationKind::Incident]
        );
    }

    #[test]
    fn applies_to_column_round_trips_and_drops_unknown_kinds() {
        let kinds = vec![NotificationKind::OnCall, NotificationKind::Alert];
        assert_eq!(applies_to_column(&kinds), r#"["on_call","alert"]"#);
        assert_eq!(applies_to_from_column(r#"["on_call","alert"]"#), kinds);
        assert_eq!(
            applies_to_from_column(r#"["pages","anomaly"]"#),
            vec![NotificationKind::Anomaly]
        );
        assert!(applies_to_from_column("not json").is_empty());
    }

    /// Templates plus reference tables; the alerts tables hold only the columns a rename uses.
    async fn reference_db() -> DatabaseConnection {
        use crate::table::entity::system_settings;

        let db = db().await;
        for table in ["alerts", "alert_composites"] {
            db.execute_unprepared(&format!(
                "CREATE TABLE {table} (id TEXT PRIMARY KEY, org TEXT NOT NULL, name TEXT NOT NULL, template TEXT)"
            ))
            .await
            .unwrap();
        }
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(system_settings::Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db
    }

    async fn insert_row(
        db: &DatabaseConnection,
        org: &str,
        name: &str,
        is_default: bool,
        kind: &str,
    ) {
        ActiveModel {
            id: Set(ider::uuid()),
            org: Set(org.to_string()),
            name: Set(name.to_string()),
            is_default: Set(is_default),
            r#type: Set("http".to_string()),
            body: Set("{}".to_string()),
            title: Set(None),
            kind: Set(kind.to_string()),
            applies_to: Set("[]".to_string()),
        }
        .insert(db)
        .await
        .unwrap();
    }

    async fn insert_alert(
        db: &DatabaseConnection,
        table: &str,
        org: &str,
        name: &str,
        template: &str,
    ) {
        db.execute_unprepared(&format!(
            "INSERT INTO {table} (id, org, name, template) VALUES ('{}', '{org}', '{name}', '{template}')",
            ider::uuid()
        ))
        .await
        .unwrap();
    }

    async fn alert_template(db: &DatabaseConnection, table: &str, name: &str) -> Option<String> {
        use sea_orm::{FromQueryResult, Statement};

        #[derive(FromQueryResult)]
        struct Row {
            template: Option<String>,
        }
        Row::find_by_statement(Statement::from_string(
            db.get_database_backend(),
            format!("SELECT template FROM {table} WHERE name = '{name}'"),
        ))
        .one(db)
        .await
        .unwrap()
        .unwrap()
        .template
    }

    async fn names(db: &DatabaseConnection, org: &str) -> Vec<String> {
        Entity::find()
            .filter(Column::Org.eq(org))
            .order_by(Column::Name, sea_orm::Order::Asc)
            .all(db)
            .await
            .unwrap()
            .into_iter()
            .map(|m| m.name)
            .collect()
    }

    #[tokio::test]
    async fn reserved_collisions_are_renamed_and_their_references_follow() {
        use crate::table::entity::system_settings;

        let db = reference_db().await;
        // The shipped seeds: default org, written by the seeder, Content.
        insert_row(&db, DEFAULT_ORG, "o2_default_content", false, "content").await;
        insert_row(&db, DEFAULT_ORG, "o2_default_anomaly", false, "content").await;
        // User rows: another org, and a default org row a user saved.
        insert_row(&db, "acme", "o2_default_anomaly", false, "custom").await;
        insert_row(&db, "acme", "user_o2_default_anomaly", false, "custom").await;
        insert_row(&db, DEFAULT_ORG, "o2_default_mine", true, "content").await;
        insert_row(&db, "acme", "ops-card", false, "content").await;
        insert_alert(&db, "alerts", "acme", "acme-alert", "o2_default_anomaly").await;
        insert_alert(&db, "alerts", "other", "other-alert", "o2_default_anomaly").await;
        insert_alert(&db, "alerts", "other", "shared-alert", "o2_default_mine").await;
        insert_alert(
            &db,
            "alert_composites",
            "acme",
            "acme-composite",
            "o2_default_anomaly",
        )
        .await;
        system_settings::ActiveModel {
            scope: Set("org".to_string()),
            org_id: Set(Some("acme".to_string())),
            setting_key: Set("default_templates".to_string()),
            setting_value: Set(serde_json::json!({"anomaly": "o2_default_anomaly"})),
            created_at: Set(0),
            updated_at: Set(0),
            ..Default::default()
        }
        .insert(&db)
        .await
        .unwrap();

        let renames = rename_reserved_collisions(&db).await.unwrap();

        assert_eq!(
            renames,
            vec![
                ReservedRename {
                    org: "acme".to_string(),
                    from: "o2_default_anomaly".to_string(),
                    to: "user_o2_default_anomaly_2".to_string(),
                },
                ReservedRename {
                    org: DEFAULT_ORG.to_string(),
                    from: "o2_default_mine".to_string(),
                    to: "user_o2_default_mine".to_string(),
                },
            ]
        );
        assert_eq!(
            names(&db, "acme").await,
            vec![
                "ops-card",
                "user_o2_default_anomaly",
                "user_o2_default_anomaly_2"
            ]
        );
        assert_eq!(
            names(&db, DEFAULT_ORG).await,
            vec![
                "o2_default_anomaly",
                "o2_default_content",
                "user_o2_default_mine"
            ]
        );
        // The acme alert follows its org's row; another org's alert keeps reading the shipped seed.
        assert_eq!(
            alert_template(&db, "alerts", "acme-alert").await.as_deref(),
            Some("user_o2_default_anomaly_2")
        );
        assert_eq!(
            alert_template(&db, "alerts", "other-alert")
                .await
                .as_deref(),
            Some("o2_default_anomaly")
        );
        // A renamed default org row is shared, so every org's reference follows it.
        assert_eq!(
            alert_template(&db, "alerts", "shared-alert")
                .await
                .as_deref(),
            Some("user_o2_default_mine")
        );
        assert_eq!(
            alert_template(&db, "alert_composites", "acme-composite")
                .await
                .as_deref(),
            Some("user_o2_default_anomaly_2")
        );
        let pointer = system_settings::Entity::find()
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            pointer.setting_value,
            serde_json::json!({"anomaly": "user_o2_default_anomaly_2"})
        );

        // A second boot finds nothing left under the prefix that is not a seed.
        assert!(rename_reserved_collisions(&db).await.unwrap().is_empty());
    }
}
