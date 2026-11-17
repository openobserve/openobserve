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

/// The org's own row only, with no fallback to the shared default org.
pub async fn get_own(org_id: &str, name: &str) -> Result<Option<Template>, Error> {
    let client = get_orm_client_ro().await;
    match get_org_model(client, org_id, name).await? {
        Some(model) => Ok(Some(Template::try_from(model)?)),
        None => Ok(None),
    }
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
/// The one compiled default every kind falls back to; reserved like the prefix.
pub const DEFAULT_TEMPLATE_NAME: &str = "prebuilt_default";
/// The name an earlier build of this release seeded the compiled default under.
const LEGACY_DEFAULT_NAME: &str = "o2_default";
/// The rows main seeded that `prebuilt_default` replaced; their references move to it.
pub const RETIRED_DEFAULT_NAMES: [&str; 3] = [
    "o2_default_content",
    "prebuilt_downtime",
    "prebuilt_downtime_email",
];
/// The setting keys whose values can name a template.
const POINTER_KEYS: [&str; 2] = ["default_alert_template", "default_templates"];

/// One user row moved out of the reserved prefix.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReservedRename {
    pub org: String,
    pub from: String,
    pub to: String,
}

/// Main seeded only `o2_default_content`, so a migration treats any other reserved name as a user
/// row, `prebuilt_default` included.
pub const MIGRATION_SEEDS: [&str; 1] = ["o2_default_content"];
/// After the migrations the seeder owns `prebuilt_default`, so a boot rename leaves its row alone.
pub const BOOT_SEEDS: [&str; 2] = [DEFAULT_TEMPLATE_NAME, "o2_default_content"];
/// The rows an earlier build of this release seeded with `is_default` false; a user row saved in
/// the default org always has it true, so the flag tells the two apart.
pub const BRANCH_KIND_SEEDS: [&str; 5] = [
    LEGACY_DEFAULT_NAME,
    "o2_default_incident",
    "o2_default_anomaly",
    "o2_default_synthetics",
    "o2_default_on_call",
];
/// System setting mapping every renamed or retired template name to its new name, so a node whose
/// cache still holds the old name resolves it.
pub const RENAMED_ALIASES_KEY: &str = "templates_renamed";
/// System setting holding the renames a migration made, whose ownership tuples boot still moves.
pub const RENAMES_PENDING_KEY: &str = "templates_renamed_pending";
/// The templates and destinations name columns are varchar(256).
pub const NAME_MAX_CHARS: usize = 256;

/// A shipped seed row: the default org, one of `seeds` or a branch kind seed, Content; the seeder
/// writes `prebuilt_default` with `is_default` false, which an API save in the default org never
/// does.
fn is_shipped_seed(seeds: &[&str], m: &Model) -> bool {
    let seeded =
        seeds.contains(&m.name.as_str()) && (m.name != DEFAULT_TEMPLATE_NAME || !m.is_default);
    m.org == DEFAULT_ORG
        && m.kind == TemplateKind::Content.to_string()
        && (seeded || is_branch_kind_seed(m))
}

/// A per-kind row an earlier build seeded, which the fold retires instead of renaming.
fn is_branch_kind_seed(m: &Model) -> bool {
    m.org == DEFAULT_ORG
        && !m.is_default
        && m.kind == TemplateKind::Content.to_string()
        && BRANCH_KIND_SEEDS.contains(&m.name.as_str())
}

/// A name only the system may use: `prebuilt_default`, `o2_default` or anything under
/// `o2_default_`.
pub fn is_reserved_default_name(name: &str) -> bool {
    name == DEFAULT_TEMPLATE_NAME
        || name == LEGACY_DEFAULT_NAME
        || name.starts_with(RESERVED_PREFIX)
}

/// Renames user rows with a reserved default name to `user_{name}` and moves their references.
/// `overrides` also moves the anomaly, synthetics and on-call template columns; migration 137
/// runs before 138 to 140 add them, so it passes false.
pub async fn rename_reserved_collisions<C>(
    db: &C,
    seeds: &[&str],
    overrides: bool,
) -> Result<Vec<ReservedRename>, sea_orm::DbErr>
where
    C: ConnectionTrait + sea_orm::TransactionTrait,
{
    let txn = db.begin().await?;
    let mut rows: Vec<Model> = Entity::find()
        .filter(
            sea_orm::Condition::any()
                .add(Column::Name.like(format!("{LEGACY_DEFAULT_NAME}%")))
                .add(Column::Name.eq(DEFAULT_TEMPLATE_NAME)),
        )
        .all(&txn)
        .await?
        .into_iter()
        .filter(|m| is_reserved_default_name(&m.name))
        .filter(|m| !is_shipped_seed(seeds, m))
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
        if overrides {
            follow_override_rename(&txn, scope, &row.name, &to).await?;
        }
        renames.push(ReservedRename {
            org: row.org,
            from: row.name,
            to,
        });
    }
    record_aliases(&txn, &renames).await?;
    txn.commit().await?;
    Ok(renames)
}

/// A `user_{name}` free in `org`; a default org row needs one free in every org, because
/// its references follow it everywhere and an org's own row of that name would win the read.
async fn free_name<C: ConnectionTrait>(
    db: &C,
    org: &str,
    name: &str,
) -> Result<String, sea_orm::DbErr> {
    // Room for `user_` and a `_n` suffix, so the longest candidate still fits the column.
    let kept: String = name
        .chars()
        .take(NAME_MAX_CHARS - "user_".len() - 6)
        .collect();
    let base = format!("user_{kept}");
    let mut candidate = base.clone();
    let mut n = 1;
    while name_taken(db, org, &candidate).await? {
        n += 1;
        candidate = format!("{base}_{n}");
    }
    Ok(candidate)
}

async fn name_taken<C: ConnectionTrait>(
    db: &C,
    org: &str,
    name: &str,
) -> Result<bool, sea_orm::DbErr> {
    if org != DEFAULT_ORG {
        // A default org row of that name is shared, so it would collide with this org's row.
        return Ok(get_org_model(db, org, name).await?.is_some()
            || get_org_model(db, DEFAULT_ORG, name).await?.is_some());
    }
    Ok(Entity::find()
        .filter(Column::Name.eq(name))
        .one(db)
        .await?
        .is_some())
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

/// Points anomaly, synthetics and on-call template overrides at the new name; `None` is every org.
async fn follow_override_rename<C: ConnectionTrait>(
    db: &C,
    org: Option<&str>,
    from: &str,
    to: &str,
) -> Result<(), sea_orm::DbErr> {
    use sea_orm::sea_query::Expr;

    use super::entity::{anomaly_detection_config, oncall_policies, synthetics_checks};

    let mut anomaly = anomaly_detection_config::Entity::update_many()
        .col_expr(anomaly_detection_config::Column::Template, Expr::value(to))
        .filter(anomaly_detection_config::Column::Template.eq(from));
    let mut synthetics = synthetics_checks::Entity::update_many()
        .col_expr(synthetics_checks::Column::Template, Expr::value(to))
        .filter(synthetics_checks::Column::Template.eq(from));
    let mut oncall = oncall_policies::Entity::update_many()
        .col_expr(oncall_policies::Column::Template, Expr::value(to))
        .filter(oncall_policies::Column::Template.eq(from));
    if let Some(org) = org {
        anomaly = anomaly.filter(anomaly_detection_config::Column::OrgId.eq(org));
        synthetics = synthetics.filter(synthetics_checks::Column::OrgId.eq(org));
        oncall = oncall.filter(oncall_policies::Column::OrgId.eq(org));
    }
    anomaly.exec(db).await?;
    synthetics.exec(db).await?;
    oncall.exec(db).await?;
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

/// Appends `renames` to the pending list boot reads to move their ownership tuples.
pub async fn record_pending_renames<C: ConnectionTrait>(
    db: &C,
    renames: &[ReservedRename],
) -> Result<(), sea_orm::DbErr> {
    if renames.is_empty() {
        return Ok(());
    }
    let mut list = pending_renames(db).await?;
    list.extend(renames.iter().cloned());
    set_pending_renames(db, &list).await
}

/// Adds `renames` to the alias list; a later rename of the same name replaces its entry.
async fn record_aliases<C: ConnectionTrait>(
    db: &C,
    renames: &[ReservedRename],
) -> Result<(), sea_orm::DbErr> {
    use super::entity::system_settings;

    if renames.is_empty() {
        return Ok(());
    }
    let existing = setting_row(db, RENAMED_ALIASES_KEY).await?;
    let mut list = existing
        .as_ref()
        .and_then(|row| row.setting_value.as_array().cloned())
        .unwrap_or_default();
    for r in renames {
        list.retain(|v| !(v["org"] == r.org.as_str() && v["from"] == r.from.as_str()));
        list.push(serde_json::json!({"org": r.org, "from": r.from, "to": r.to}));
    }
    let now = chrono::Utc::now().timestamp_micros();
    match existing {
        Some(row) => {
            let mut active: system_settings::ActiveModel = row.into();
            active.setting_value = Set(serde_json::Value::Array(list));
            active.updated_at = Set(now);
            active.update(db).await?;
        }
        None => {
            system_settings::ActiveModel {
                scope: Set("system".to_string()),
                setting_key: Set(RENAMED_ALIASES_KEY.to_string()),
                setting_value: Set(serde_json::Value::Array(list)),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            }
            .insert(db)
            .await?;
        }
    }
    Ok(())
}

/// The name `name` was renamed or retired to in exactly `org`.
pub async fn renamed_in(org: &str, name: &str) -> Result<Option<String>, sea_orm::DbErr> {
    let db = get_orm_client_ro().await;
    let Some(row) = setting_row(db, RENAMED_ALIASES_KEY).await? else {
        return Ok(None);
    };
    Ok(row
        .setting_value
        .as_array()
        .into_iter()
        .flatten()
        .find(|v| v["org"] == org && v["from"] == name)
        .and_then(|v| v["to"].as_str().map(str::to_string)))
}

/// The name `name` was renamed or retired to in `org` (or in the shared default org), if any.
pub async fn renamed_to(org: &str, name: &str) -> Result<Option<String>, sea_orm::DbErr> {
    renamed_to_with(get_orm_client_ro().await, org, name).await
}

pub async fn renamed_to_with<C: ConnectionTrait>(
    db: &C,
    org: &str,
    name: &str,
) -> Result<Option<String>, sea_orm::DbErr> {
    let Some(row) = setting_row(db, RENAMED_ALIASES_KEY).await? else {
        return Ok(None);
    };
    let found = |owner: &str| {
        row.setting_value
            .as_array()
            .into_iter()
            .flatten()
            .find(|v| v["org"] == owner && v["from"] == name)
            .and_then(|v| v["to"].as_str().map(str::to_string))
    };
    Ok(found(org).or_else(|| found(DEFAULT_ORG)))
}

async fn setting_row<C: ConnectionTrait>(
    db: &C,
    key: &str,
) -> Result<Option<super::entity::system_settings::Model>, sea_orm::DbErr> {
    use super::entity::system_settings;

    system_settings::Entity::find()
        .filter(system_settings::Column::Scope.eq("system"))
        .filter(system_settings::Column::SettingKey.eq(key))
        .one(db)
        .await
}

/// The renames whose tuples are still to move, oldest first; the list stays until it is replaced.
pub async fn pending_renames<C: ConnectionTrait>(
    db: &C,
) -> Result<Vec<ReservedRename>, sea_orm::DbErr> {
    let Some(row) = pending_row(db).await? else {
        return Ok(Vec::new());
    };
    let field = |v: &serde_json::Value, k: &str| v[k].as_str().unwrap_or_default().to_string();
    Ok(row
        .setting_value
        .as_array()
        .into_iter()
        .flatten()
        .map(|v| ReservedRename {
            org: field(v, "org"),
            from: field(v, "from"),
            to: field(v, "to"),
        })
        .filter(|r| !r.from.is_empty() && !r.to.is_empty())
        .collect())
}

/// Replaces the pending list with `left` in one statement, so a stop never drops it.
pub async fn set_pending_renames<C: ConnectionTrait>(
    db: &C,
    left: &[ReservedRename],
) -> Result<(), sea_orm::DbErr> {
    use super::entity::system_settings;

    let existing = pending_row(db).await?;
    if left.is_empty() {
        if let Some(row) = existing {
            row.delete(db).await?;
        }
        return Ok(());
    }
    let value = serde_json::Value::Array(
        left.iter()
            .map(|r| serde_json::json!({"org": r.org, "from": r.from, "to": r.to}))
            .collect(),
    );
    let now = chrono::Utc::now().timestamp_micros();
    match existing {
        Some(row) => {
            let mut active: system_settings::ActiveModel = row.into();
            active.setting_value = Set(value);
            active.updated_at = Set(now);
            active.update(db).await?;
        }
        None => {
            system_settings::ActiveModel {
                scope: Set("system".to_string()),
                setting_key: Set(RENAMES_PENDING_KEY.to_string()),
                setting_value: Set(value),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            }
            .insert(db)
            .await?;
        }
    }
    Ok(())
}

async fn pending_row<C: ConnectionTrait>(
    db: &C,
) -> Result<Option<super::entity::system_settings::Model>, sea_orm::DbErr> {
    use super::entity::system_settings;

    system_settings::Entity::find()
        .filter(system_settings::Column::Scope.eq("system"))
        .filter(system_settings::Column::SettingKey.eq(RENAMES_PENDING_KEY))
        .one(db)
        .await
}

/// Folds the retired default rows into `prebuilt_default`, moves every reference to it and drops
/// the org default pointers; safe to run again.
pub async fn retire_default_templates<C>(db: &C) -> Result<Vec<ReservedRename>, sea_orm::DbErr>
where
    C: ConnectionTrait + sea_orm::TransactionTrait,
{
    use sea_orm::sea_query::Expr;

    use super::entity::{destinations, system_settings};

    let txn = db.begin().await?;
    let mut retired: Vec<Model> = Entity::find()
        .filter(Column::Org.eq(DEFAULT_ORG))
        .filter(Column::Name.is_in(RETIRED_DEFAULT_NAMES.into_iter().chain(BRANCH_KIND_SEEDS)))
        .all(&txn)
        .await?
        .into_iter()
        .filter(|m| RETIRED_DEFAULT_NAMES.contains(&m.name.as_str()) || is_branch_kind_seed(m))
        .collect();
    // The alert default's row becomes prebuilt_default, so a destination bound to it keeps its id.
    retired.sort_by_key(|m| {
        (
            m.name != "o2_default_content",
            m.name != LEGACY_DEFAULT_NAME,
        )
    });
    let mut target = get_org_model(&txn, DEFAULT_ORG, DEFAULT_TEMPLATE_NAME)
        .await?
        .map(|m| m.id);
    let mut moved = Vec::with_capacity(retired.len());
    for row in retired {
        if target.is_none() && row.kind == TemplateKind::Content.to_string() {
            Entity::update_many()
                .col_expr(Column::Name, Expr::value(DEFAULT_TEMPLATE_NAME))
                .filter(Column::Id.eq(row.id.clone()))
                .exec(&txn)
                .await?;
            target = Some(row.id.clone());
        } else {
            destinations::Entity::update_many()
                .col_expr(
                    destinations::Column::TemplateId,
                    Expr::value(target.clone()),
                )
                .filter(destinations::Column::TemplateId.eq(row.id.clone()))
                .exec(&txn)
                .await?;
            Entity::delete_by_id(row.id.clone()).exec(&txn).await?;
        }
        moved.push(ReservedRename {
            org: row.org,
            from: row.name,
            to: DEFAULT_TEMPLATE_NAME.to_string(),
        });
    }
    let kind_seeds: Vec<String> = moved
        .iter()
        .filter(|r| BRANCH_KIND_SEEDS.contains(&r.from.as_str()))
        .map(|r| r.from.clone())
        .collect();
    point_names_at_default(&txn, &kind_seeds).await?;
    record_aliases(&txn, &moved).await?;
    system_settings::Entity::delete_many()
        .filter(system_settings::Column::Scope.eq("org"))
        .filter(system_settings::Column::SettingKey.is_in(POINTER_KEYS))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(moved)
}

/// Every override that names a retired default names `prebuilt_default` instead, in every org.
async fn point_names_at_default<C: ConnectionTrait>(
    db: &C,
    kind_seeds: &[String],
) -> Result<(), sea_orm::DbErr> {
    let names: Vec<String> = RETIRED_DEFAULT_NAMES
        .iter()
        .map(|n| n.to_string())
        .chain(kind_seeds.iter().cloned())
        .collect();
    use sea_orm::sea_query::Expr;

    use super::entity::{
        alert_composites, alerts, anomaly_detection_config, oncall_policies, synthetics_checks,
    };

    alerts::Entity::update_many()
        .col_expr(alerts::Column::Template, Expr::value(DEFAULT_TEMPLATE_NAME))
        .filter(alerts::Column::Template.is_in(names.clone()))
        .exec(db)
        .await?;
    alert_composites::Entity::update_many()
        .col_expr(
            alert_composites::Column::Template,
            Expr::value(DEFAULT_TEMPLATE_NAME),
        )
        .filter(alert_composites::Column::Template.is_in(names.clone()))
        .exec(db)
        .await?;
    anomaly_detection_config::Entity::update_many()
        .col_expr(
            anomaly_detection_config::Column::Template,
            Expr::value(DEFAULT_TEMPLATE_NAME),
        )
        .filter(anomaly_detection_config::Column::Template.is_in(names.clone()))
        .exec(db)
        .await?;
    synthetics_checks::Entity::update_many()
        .col_expr(
            synthetics_checks::Column::Template,
            Expr::value(DEFAULT_TEMPLATE_NAME),
        )
        .filter(synthetics_checks::Column::Template.is_in(names.clone()))
        .exec(db)
        .await?;
    oncall_policies::Entity::update_many()
        .col_expr(
            oncall_policies::Column::Template,
            Expr::value(DEFAULT_TEMPLATE_NAME),
        )
        .filter(oncall_policies::Column::Template.is_in(names.clone()))
        .exec(db)
        .await?;
    Ok(())
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
        insert_row(&db, DEFAULT_ORG, "o2_default", false, "content").await;
        // User rows: another org, and a default org row a user saved.
        insert_row(&db, "acme", "o2_default_anomaly", false, "custom").await;
        insert_row(&db, "acme", "user_o2_default_anomaly", false, "custom").await;
        insert_row(&db, DEFAULT_ORG, "o2_default_mine", true, "content").await;
        // A root user's Content row in the default org is not a seed.
        insert_row(&db, DEFAULT_ORG, "o2_default_foo", false, "content").await;
        insert_row(&db, "acme", "ops-card", false, "content").await;
        insert_alert(&db, "alerts", "acme", "acme-alert", "o2_default_anomaly").await;
        insert_alert(&db, "alerts", "other", "other-alert", "o2_default_content").await;
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

        let renames = rename_reserved_collisions(&db, &BOOT_SEEDS, false)
            .await
            .unwrap();

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
                    from: "o2_default_foo".to_string(),
                    to: "user_o2_default_foo".to_string(),
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
                "o2_default",
                "o2_default_content",
                "user_o2_default_foo",
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
            Some("o2_default_content")
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
        assert!(
            rename_reserved_collisions(&db, &BOOT_SEEDS, false)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn an_org_rename_skips_a_name_the_default_org_holds() {
        let db = reference_db().await;
        insert_row(&db, "acme", "o2_default_anomaly", false, "custom").await;
        insert_row(&db, DEFAULT_ORG, "user_o2_default_anomaly", false, "custom").await;

        let renames = rename_reserved_collisions(&db, &BOOT_SEEDS, false)
            .await
            .unwrap();

        assert_eq!(
            renames,
            vec![ReservedRename {
                org: "acme".to_string(),
                from: "o2_default_anomaly".to_string(),
                to: "user_o2_default_anomaly_2".to_string(),
            }]
        );
    }

    #[tokio::test]
    async fn an_inherited_reference_keeps_its_body_when_another_org_owns_the_new_name() {
        let db = reference_db().await;
        insert_row(&db, DEFAULT_ORG, "o2_default_mine", false, "custom").await;
        insert_row(&db, "acme", "user_o2_default_mine", false, "custom").await;
        for (org, name, body) in [
            (DEFAULT_ORG, "o2_default_mine", "shared body"),
            ("acme", "user_o2_default_mine", "acme body"),
        ] {
            Entity::update_many()
                .col_expr(Column::Body, sea_orm::sea_query::Expr::value(body))
                .filter(Column::Org.eq(org))
                .filter(Column::Name.eq(name))
                .exec(&db)
                .await
                .unwrap();
        }
        // The acme alert reads the default row through the fallback.
        insert_alert(&db, "alerts", "acme", "acme-alert", "o2_default_mine").await;
        async fn body_for(db: &DatabaseConnection, name: &str) -> String {
            get_model(db, "acme", name).await.unwrap().unwrap().body
        }
        let before = body_for(&db, "o2_default_mine").await;
        assert_eq!(before, "shared body");

        let renames = rename_reserved_collisions(&db, &BOOT_SEEDS, false)
            .await
            .unwrap();

        assert_eq!(
            renames,
            vec![ReservedRename {
                org: DEFAULT_ORG.to_string(),
                from: "o2_default_mine".to_string(),
                to: "user_o2_default_mine_2".to_string(),
            }]
        );
        let after = alert_template(&db, "alerts", "acme-alert").await.unwrap();
        assert_eq!(after, "user_o2_default_mine_2");
        assert_eq!(body_for(&db, &after).await, before);
        assert_eq!(body_for(&db, "user_o2_default_mine").await, "acme body");
    }

    /// The reference tables the retire touches; each holds only the columns it rewrites.
    async fn retire_db() -> DatabaseConnection {
        let db = reference_db().await;
        for table in ["anomaly_detection_config", "synthetics", "oncall_policies"] {
            db.execute_unprepared(&format!(
                "CREATE TABLE {table} (id TEXT PRIMARY KEY, org TEXT NOT NULL, name TEXT NOT NULL, template TEXT)"
            ))
            .await
            .unwrap();
        }
        db.execute_unprepared(
            "CREATE TABLE destinations (id TEXT PRIMARY KEY, org TEXT NOT NULL, name TEXT NOT NULL, template_id TEXT)",
        )
        .await
        .unwrap();
        db
    }

    async fn row_id(db: &DatabaseConnection, org: &str, name: &str) -> String {
        get_org_model(db, org, name).await.unwrap().unwrap().id
    }

    async fn insert_destination(db: &DatabaseConnection, name: &str, template_id: &str) {
        db.execute_unprepared(&format!(
            "INSERT INTO destinations (id, org, name, template_id) VALUES ('{}', 'acme', '{name}', '{template_id}')",
            ider::uuid()
        ))
        .await
        .unwrap();
    }

    async fn destination_template(db: &DatabaseConnection, name: &str) -> Option<String> {
        use sea_orm::{FromQueryResult, Statement};

        #[derive(FromQueryResult)]
        struct Row {
            template_id: Option<String>,
        }
        Row::find_by_statement(Statement::from_string(
            db.get_database_backend(),
            format!("SELECT template_id FROM destinations WHERE name = '{name}'"),
        ))
        .one(db)
        .await
        .unwrap()
        .unwrap()
        .template_id
    }

    #[tokio::test]
    async fn a_user_row_named_like_a_kind_default_survives_both_migrations() {
        let db = retire_db().await;
        // A row saved through the API in the default org always has is_default set.
        insert_row(&db, DEFAULT_ORG, "o2_default_incident", true, "content").await;
        insert_alert(
            &db,
            "alerts",
            "acme",
            "incident-alert",
            "o2_default_incident",
        )
        .await;
        let mine = row_id(&db, DEFAULT_ORG, "o2_default_incident").await;
        insert_destination(&db, "mine-dest", &mine).await;

        rename_reserved_collisions(&db, &BOOT_SEEDS, false)
            .await
            .unwrap();
        retire_default_templates(&db).await.unwrap();

        assert_eq!(
            names(&db, DEFAULT_ORG).await,
            vec!["user_o2_default_incident"]
        );
        assert_eq!(
            row_id(&db, DEFAULT_ORG, "user_o2_default_incident").await,
            mine
        );
        assert_eq!(
            alert_template(&db, "alerts", "incident-alert")
                .await
                .as_deref(),
            Some("user_o2_default_incident")
        );
        assert_eq!(destination_template(&db, "mine-dest").await, Some(mine));
    }

    #[tokio::test]
    async fn a_kind_row_an_earlier_build_seeded_is_retired_not_renamed() {
        let db = retire_db().await;
        insert_row(&db, DEFAULT_ORG, "o2_default_content", false, "content").await;
        insert_row(&db, DEFAULT_ORG, "o2_default_anomaly", false, "content").await;
        insert_row(&db, DEFAULT_ORG, "o2_default_synthetics", true, "content").await;
        insert_alert(&db, "alerts", "acme", "seed-alert", "o2_default_anomaly").await;
        let seed = row_id(&db, DEFAULT_ORG, "o2_default_anomaly").await;
        insert_destination(&db, "seed-dest", &seed).await;

        let renames = rename_reserved_collisions(&db, &MIGRATION_SEEDS, false)
            .await
            .unwrap();
        retire_default_templates(&db).await.unwrap();

        // Only the row a user saved moves aside; the seeded one folds into prebuilt_default.
        assert_eq!(
            renames.iter().map(|r| r.from.as_str()).collect::<Vec<_>>(),
            vec!["o2_default_synthetics"]
        );
        assert_eq!(
            names(&db, DEFAULT_ORG).await,
            vec!["prebuilt_default", "user_o2_default_synthetics"]
        );
        let target = row_id(&db, DEFAULT_ORG, "prebuilt_default").await;
        assert_eq!(destination_template(&db, "seed-dest").await, Some(target));
        assert_eq!(
            alert_template(&db, "alerts", "seed-alert").await.as_deref(),
            Some("prebuilt_default")
        );
    }

    #[tokio::test]
    async fn the_retired_rows_fold_into_o2_default_and_their_references_follow() {
        use crate::table::entity::system_settings;

        let db = retire_db().await;
        insert_row(&db, DEFAULT_ORG, "o2_default_content", false, "content").await;
        insert_row(&db, DEFAULT_ORG, "prebuilt_downtime", true, "custom").await;
        insert_row(&db, DEFAULT_ORG, "prebuilt_downtime_email", true, "custom").await;
        insert_row(&db, "acme", "ops-card", false, "content").await;
        let content = row_id(&db, DEFAULT_ORG, "o2_default_content").await;
        let downtime = row_id(&db, DEFAULT_ORG, "prebuilt_downtime").await;
        let ops = row_id(&db, "acme", "ops-card").await;
        insert_destination(&db, "alerts-dest", &content).await;
        insert_destination(&db, "downtime-dest", &downtime).await;
        insert_destination(&db, "ops-dest", &ops).await;
        insert_alert(&db, "alerts", "acme", "content-alert", "o2_default_content").await;
        insert_alert(&db, "alerts", "acme", "ops-alert", "ops-card").await;
        insert_alert(
            &db,
            "oncall_policies",
            "acme",
            "team-a",
            "prebuilt_downtime",
        )
        .await;
        for key in [
            "default_templates",
            "default_alert_template",
            "other_setting",
        ] {
            system_settings::ActiveModel {
                scope: Set("org".to_string()),
                org_id: Set(Some("acme".to_string())),
                setting_key: Set(key.to_string()),
                setting_value: Set(serde_json::json!({"template": "o2_default_content"})),
                created_at: Set(0),
                updated_at: Set(0),
                ..Default::default()
            }
            .insert(&db)
            .await
            .unwrap();
        }

        let moved = retire_default_templates(&db).await.unwrap();

        assert_eq!(moved.len(), 3);
        assert_eq!(names(&db, DEFAULT_ORG).await, vec!["prebuilt_default"]);
        // The alert default's row keeps its id, so a destination bound to it needs no rewrite.
        assert_eq!(row_id(&db, DEFAULT_ORG, "prebuilt_default").await, content);
        assert_eq!(
            destination_template(&db, "alerts-dest").await.as_deref(),
            Some(content.as_str())
        );
        assert_eq!(
            destination_template(&db, "downtime-dest").await.as_deref(),
            Some(content.as_str())
        );
        assert_eq!(destination_template(&db, "ops-dest").await, Some(ops));
        assert_eq!(
            alert_template(&db, "alerts", "content-alert")
                .await
                .as_deref(),
            Some("prebuilt_default")
        );
        assert_eq!(
            alert_template(&db, "alerts", "ops-alert").await.as_deref(),
            Some("ops-card")
        );
        assert_eq!(
            alert_template(&db, "oncall_policies", "team-a")
                .await
                .as_deref(),
            Some("prebuilt_default")
        );
        let keys: Vec<String> = system_settings::Entity::find()
            .filter(system_settings::Column::Scope.eq("org"))
            .all(&db)
            .await
            .unwrap()
            .into_iter()
            .map(|s| s.setting_key)
            .collect();
        assert_eq!(keys, vec!["other_setting"]);

        // A second boot finds nothing left to fold.
        assert!(retire_default_templates(&db).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_user_row_named_prebuilt_default_survives_both_migrations_with_its_tuples_queued() {
        let db = retire_db().await;
        ActiveModel {
            id: Set(ider::uuid()),
            org: Set(DEFAULT_ORG.to_string()),
            name: Set(DEFAULT_TEMPLATE_NAME.to_string()),
            is_default: Set(true),
            r#type: Set("http".to_string()),
            body: Set("mine".to_string()),
            title: Set(None),
            kind: Set("content".to_string()),
            applies_to: Set("[]".to_string()),
        }
        .insert(&db)
        .await
        .unwrap();
        insert_row(&db, DEFAULT_ORG, "o2_default_content", false, "content").await;
        insert_alert(&db, "alerts", "acme", "mine-alert", DEFAULT_TEMPLATE_NAME).await;
        let mine = row_id(&db, DEFAULT_ORG, DEFAULT_TEMPLATE_NAME).await;

        // Migration 137 then 143, as an upgrade from main runs them.
        let renames = rename_reserved_collisions(&db, &MIGRATION_SEEDS, false)
            .await
            .unwrap();
        record_pending_renames(&db, &renames).await.unwrap();
        let renames = rename_reserved_collisions(&db, &MIGRATION_SEEDS, false)
            .await
            .unwrap();
        record_pending_renames(&db, &renames).await.unwrap();
        retire_default_templates(&db).await.unwrap();

        assert_eq!(
            names(&db, DEFAULT_ORG).await,
            vec!["prebuilt_default", "user_prebuilt_default"]
        );
        let kept = get_org_model(&db, DEFAULT_ORG, "user_prebuilt_default")
            .await
            .unwrap()
            .unwrap();
        assert_eq!((kept.id, kept.body), (mine, "mine".to_string()));
        assert_eq!(
            alert_template(&db, "alerts", "mine-alert").await.as_deref(),
            Some("user_prebuilt_default")
        );
        // Boot reads the list, then replaces it with what did not move.
        let pending = pending_renames(&db).await.unwrap();
        assert_eq!(
            pending,
            vec![ReservedRename {
                org: DEFAULT_ORG.to_string(),
                from: DEFAULT_TEMPLATE_NAME.to_string(),
                to: "user_prebuilt_default".to_string(),
            }]
        );
        set_pending_renames(&db, &pending[1..]).await.unwrap();
        assert!(pending_renames(&db).await.unwrap().is_empty());
        set_pending_renames(&db, &pending).await.unwrap();
        assert_eq!(pending_renames(&db).await.unwrap(), pending);
        // The seeder's own prebuilt_default is a seed at boot.
        assert!(
            rename_reserved_collisions(&db, &BOOT_SEEDS, false)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn a_long_reserved_name_is_cut_to_fit_the_column() {
        let db = reference_db().await;
        let long = format!("o2_default_{}", "x".repeat(245));
        insert_row(&db, "acme", &long, false, "custom").await;
        let renames = rename_reserved_collisions(&db, &BOOT_SEEDS, false)
            .await
            .unwrap();
        assert!(renames[0].to.starts_with("user_o2_default_x"));
        assert!(renames[0].to.chars().count() <= 250, "{}", renames[0].to);
    }

    #[tokio::test]
    async fn an_o2_default_seed_folds_into_prebuilt_default_and_a_user_row_moves_aside() {
        let db = retire_db().await;
        insert_row(&db, DEFAULT_ORG, "o2_default", false, "content").await;
        insert_row(&db, "acme", "o2_default", false, "content").await;
        let seed = row_id(&db, DEFAULT_ORG, "o2_default").await;
        insert_destination(&db, "seed-dest", &seed).await;
        insert_alert(&db, "alerts", "other", "seed-alert", "o2_default").await;
        insert_alert(&db, "alerts", "acme", "mine-alert", "o2_default").await;

        let renames = rename_reserved_collisions(&db, &BOOT_SEEDS, false)
            .await
            .unwrap();
        retire_default_templates(&db).await.unwrap();

        assert_eq!(
            renames,
            vec![ReservedRename {
                org: "acme".to_string(),
                from: "o2_default".to_string(),
                to: "user_o2_default".to_string(),
            }]
        );
        assert_eq!(names(&db, DEFAULT_ORG).await, vec!["prebuilt_default"]);
        assert_eq!(names(&db, "acme").await, vec!["user_o2_default"]);
        assert_eq!(row_id(&db, DEFAULT_ORG, "prebuilt_default").await, seed);
        assert_eq!(destination_template(&db, "seed-dest").await, Some(seed));
        assert_eq!(
            alert_template(&db, "alerts", "seed-alert").await.as_deref(),
            Some("prebuilt_default")
        );
        assert_eq!(
            alert_template(&db, "alerts", "mine-alert").await.as_deref(),
            Some("user_o2_default")
        );
    }

    #[tokio::test]
    async fn a_boot_rename_moves_the_anomaly_synthetics_and_on_call_overrides() {
        let db = retire_db().await;
        // A user row saved in the default org has is_default set, so it is not the seed.
        insert_row(&db, DEFAULT_ORG, "prebuilt_default", true, "content").await;
        insert_alert(
            &db,
            "anomaly_detection_config",
            "acme",
            "spike",
            "prebuilt_default",
        )
        .await;
        insert_alert(&db, "synthetics", "acme", "home", "prebuilt_default").await;
        insert_alert(&db, "oncall_policies", "acme", "team-a", "prebuilt_default").await;

        rename_reserved_collisions(&db, &BOOT_SEEDS, true)
            .await
            .unwrap();

        for table in ["anomaly_detection_config", "synthetics", "oncall_policies"] {
            let name = match table {
                "anomaly_detection_config" => "spike",
                "synthetics" => "home",
                _ => "team-a",
            };
            assert_eq!(
                alert_template(&db, table, name).await.as_deref(),
                Some("user_prebuilt_default"),
                "{table}"
            );
        }
    }

    #[tokio::test]
    async fn a_renamed_or_retired_name_resolves_to_its_new_name() {
        let db = retire_db().await;
        insert_row(&db, DEFAULT_ORG, "o2_default_content", false, "content").await;
        insert_row(&db, "acme", "o2_default_mine", false, "custom").await;

        rename_reserved_collisions(&db, &BOOT_SEEDS, false)
            .await
            .unwrap();
        retire_default_templates(&db).await.unwrap();

        assert_eq!(
            renamed_to_with(&db, "acme", "o2_default_mine")
                .await
                .unwrap(),
            Some("user_o2_default_mine".to_string())
        );
        // A default org move is shared, so every org's stale name follows it.
        assert_eq!(
            renamed_to_with(&db, "other", "o2_default_content")
                .await
                .unwrap(),
            Some("prebuilt_default".to_string())
        );
        assert_eq!(
            renamed_to_with(&db, "other", "o2_default_mine")
                .await
                .unwrap(),
            None
        );
    }
}
