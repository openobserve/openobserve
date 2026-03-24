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
    meta::model_pricing::{ModelPricingDefinition, PricingSource},
    utils::json,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait, QueryFilter,
    QueryOrder, QuerySelect, Set, TryIntoModel,
};

use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::Error,
    table::{
        entity::model_pricing::{ActiveModel, Column, Entity, Model},
        get_lock,
    },
};

impl TryFrom<Model> for ModelPricingDefinition {
    type Error = Error;

    fn try_from(model: Model) -> Result<Self, Self::Error> {
        let id = svix_ksuid::Ksuid::from_str(&model.id)
            .map_err(|e| Error::Message(format!("Invalid KSUID: {e}")))?;
        let tiers: Vec<config::meta::model_pricing::PricingTierDefinition> =
            json::from_value(model.tiers)?;
        Ok(ModelPricingDefinition {
            id: Some(id),
            org_id: model.org,
            name: model.name,
            match_pattern: model.match_pattern,
            enabled: model.enabled,
            valid_from: model.valid_from,
            sort_order: model.sort_order,
            source: PricingSource::from(model.source.as_str()),
            provider: model.provider.unwrap_or_default(),
            description: model.description.unwrap_or_default(),
            tiers,
            created_at: model.created_at,
            updated_at: model.updated_at,
        })
    }
}

pub async fn put(item: ModelPricingDefinition) -> Result<ModelPricingDefinition, Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();
    let tiers_json = json::to_value(&item.tiers)?;

    // When an ID is present, look up by ID first so renames don't orphan the old record.
    // Fall back to (org, name) lookup for new records without an ID.
    let existing = if let Some(ref id) = item.id {
        Entity::find_by_id(id.to_string()).one(client).await?
    } else {
        get_by_org_and_name(client, &item.org_id, &item.name).await?
    };

    match existing {
        Some(existing) => {
            // If the name changed, check that the new name doesn't conflict with another
            // entry in the same org (the DB has a unique index on (org, name)).
            if existing.name != item.name
                && (get_by_org_and_name(client, &item.org_id, &item.name).await?).is_some()
            {
                return Err(Error::Message(format!(
                    "A model pricing definition with name '{}' already exists in this organization",
                    item.name
                )));
            }
            let mut active: ActiveModel = existing.into();
            active.name = Set(item.name);
            active.match_pattern = Set(item.match_pattern);
            active.enabled = Set(item.enabled);
            active.tiers = Set(tiers_json);
            active.valid_from = Set(item.valid_from);
            active.sort_order = Set(item.sort_order);
            active.source = Set(item.source.as_str().to_string());
            active.provider = Set(if item.provider.is_empty() {
                None
            } else {
                Some(item.provider)
            });
            active.description = Set(if item.description.is_empty() {
                None
            } else {
                Some(item.description)
            });
            active.updated_at = Set(now);
            let updated = active.update(client).await?.try_into_model()?;
            updated.try_into()
        }
        None => {
            let active = ActiveModel {
                id: Set(item.id.map_or_else(ider::uuid, |id| id.to_string())),
                org: Set(item.org_id),
                name: Set(item.name),
                match_pattern: Set(item.match_pattern),
                enabled: Set(item.enabled),
                tiers: Set(tiers_json),
                valid_from: Set(item.valid_from),
                sort_order: Set(item.sort_order),
                source: Set(item.source.as_str().to_string()),
                provider: Set(if item.provider.is_empty() {
                    None
                } else {
                    Some(item.provider)
                }),
                description: Set(if item.description.is_empty() {
                    None
                } else {
                    Some(item.description)
                }),
                created_at: Set(now),
                updated_at: Set(now),
            };
            let model = active.insert(client).await?.try_into_model()?;
            model.try_into()
        }
    }
}

pub async fn get(org_id: &str, name: &str) -> Result<Option<ModelPricingDefinition>, Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match get_by_org_and_name(client, org_id, name).await? {
        Some(model) => Ok(Some(model.try_into()?)),
        None => Ok(None),
    }
}

pub async fn get_by_id(id: &str) -> Result<Option<ModelPricingDefinition>, Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match Entity::find_by_id(id).one(client).await? {
        Some(model) => Ok(Some(model.try_into()?)),
        None => Ok(None),
    }
}

/// Return the distinct org IDs that have at least one model pricing definition.
/// Used for startup cache warming.
pub async fn list_orgs() -> Result<Vec<String>, Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let rows: Vec<(String,)> = Entity::find()
        .select_only()
        .column(Column::Org)
        .distinct()
        .into_tuple()
        .all(client)
        .await?;
    Ok(rows.into_iter().map(|(org,)| org).collect())
}

pub async fn list(org_id: &str) -> Result<Vec<ModelPricingDefinition>, Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::find()
        .filter(Column::Org.eq(org_id))
        .order_by(Column::Name, sea_orm::Order::Asc)
        .all(client)
        .await?
        .into_iter()
        .map(|m| m.try_into())
        .collect()
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    if let Some(model) = get_by_org_and_name(client, org_id, name).await? {
        model.delete(client).await?;
    }
    Ok(())
}

/// Delete a model pricing definition by ID, scoped to org.
/// Returns `Ok(true)` if a row was deleted, `Ok(false)` if not found.
/// Built-in entries (`source = 'built_in'`) are never deleted — returns an error.
pub async fn delete_by_id(org_id: &str, id: &str) -> Result<bool, Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    if let Some(model) = Entity::find_by_id(id)
        .filter(Column::Org.eq(org_id))
        .one(client)
        .await?
    {
        if model.source == config::meta::model_pricing::PricingSource::BuiltIn.as_str() {
            return Err(Error::Message(
                "Built-in model pricing definitions cannot be deleted".to_string(),
            ));
        }
        model.delete(client).await?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Return all model names belonging to the built-in org.
/// Used by the sync job to detect models removed from the upstream source.
pub async fn list_built_in_names() -> Result<Vec<String>, Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let rows: Vec<(String,)> = Entity::find()
        .select_only()
        .column(Column::Name)
        .filter(Column::Org.eq(config::meta::model_pricing::BUILT_IN_ORG))
        .into_tuple()
        .all(client)
        .await?;
    Ok(rows.into_iter().map(|(name,)| name).collect())
}

async fn get_by_org_and_name(
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
