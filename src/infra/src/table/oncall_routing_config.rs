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

//! The org's routing configuration — today, which team catches whatever no
//! ownership rule claimed.
//!
//! Read on the paging path, so the absence of a row has to be as cheap and as
//! unambiguous as the presence of one: [`get`] answers with an unset config
//! rather than an `Option`, and no caller has to decide what a missing row
//! means at 3am.

use config::{meta::oncall::RoutingConfig, utils::time::now_micros};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};

use super::entity::oncall_routing_config;
use crate::{db::get_orm_client_rw, errors};

fn to_config(m: oncall_routing_config::Model) -> RoutingConfig {
    RoutingConfig {
        org_id: m.org_id,
        // A row that stores an empty string is the same as one storing nothing;
        // normalising here means the routing decision never has to ask.
        default_team_id: m.default_team_id.filter(|t| !t.trim().is_empty()),
        updated_at: m.updated_at,
    }
}

/// The org's configuration, or the unset one if it has never set any.
pub async fn get(org_id: &str) -> Result<RoutingConfig, errors::Error> {
    let client = get_orm_client_rw().await;
    Ok(oncall_routing_config::Entity::find_by_id(org_id)
        .one(client)
        .await?
        .map(to_config)
        .unwrap_or_else(|| RoutingConfig::unset(org_id)))
}

/// The nominated catch-all, if there is one. The one question the paging path
/// asks, kept separate so it does not have to know about the row.
pub async fn default_team(org_id: &str) -> Result<Option<String>, errors::Error> {
    Ok(get(org_id).await?.default_team_id)
}

/// Nominates a team as the org's catch-all, or clears the nomination.
///
/// Upserts, because the row is a setting rather than a record: an org that has
/// never opened the routing screen has no row, and the first time somebody
/// picks a team is not a different operation from the second.
pub async fn set_default_team(
    org_id: &str,
    team_id: Option<&str>,
) -> Result<RoutingConfig, errors::Error> {
    let client = get_orm_client_rw().await;
    let team_id = team_id
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string);
    let now = now_micros();

    match oncall_routing_config::Entity::find_by_id(org_id)
        .one(client)
        .await?
    {
        Some(existing) => {
            let mut model: oncall_routing_config::ActiveModel = existing.into();
            model.default_team_id = Set(team_id);
            model.updated_at = Set(now);
            Ok(to_config(model.update(client).await?))
        }
        None => {
            let model = oncall_routing_config::ActiveModel {
                org_id: Set(org_id.to_string()),
                default_team_id: Set(team_id),
                updated_at: Set(now),
            };
            Ok(to_config(model.insert(client).await?))
        }
    }
}

/// Applies a whole configuration under the org it was written for.
///
/// The super-cluster door: a replica must end up with exactly what the source
/// region has, including the `updated_at` that says when it was decided.
pub async fn put(config: &RoutingConfig) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    let team_id = config
        .default_team_id
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string);
    match oncall_routing_config::Entity::find_by_id(&config.org_id)
        .one(client)
        .await?
    {
        Some(existing) => {
            let mut model: oncall_routing_config::ActiveModel = existing.into();
            model.default_team_id = Set(team_id);
            model.updated_at = Set(config.updated_at);
            model.update(client).await?;
        }
        None => {
            oncall_routing_config::ActiveModel {
                org_id: Set(config.org_id.clone()),
                default_team_id: Set(team_id),
                updated_at: Set(config.updated_at),
            }
            .insert(client)
            .await?;
        }
    }
    Ok(())
}

/// Whether `team_id` is this org's nominated catch-all.
///
/// Asked before a team is deleted. The answer decides whether the delete is
/// refused, so it is a query in its own right rather than something the caller
/// reassembles out of [`get`].
pub async fn is_default_team(org_id: &str, team_id: &str) -> Result<bool, errors::Error> {
    Ok(default_team(org_id).await?.as_deref() == Some(team_id))
}

/// Clears the nomination if it points at `team_id`.
///
/// Not called by team deletion — that is refused instead — but the super-cluster
/// consumer applies a team delete it did not originate, and a replica must not
/// be left pointing at a team it no longer has.
pub async fn clear_if_default_team(org_id: &str, team_id: &str) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    let Some(existing) = oncall_routing_config::Entity::find_by_id(org_id)
        .one(client)
        .await?
    else {
        return Ok(false);
    };
    if existing.default_team_id.as_deref() != Some(team_id) {
        return Ok(false);
    }
    let mut model: oncall_routing_config::ActiveModel = existing.into();
    model.default_team_id = Set(None);
    model.updated_at = Set(now_micros());
    model.update(client).await?;
    Ok(true)
}

/// Drops the org's configuration. Called when the org itself goes.
pub async fn delete(org_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    oncall_routing_config::Entity::delete_many()
        .filter(oncall_routing_config::Column::OrgId.eq(org_id))
        .exec(client)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(default_team_id: Option<&str>) -> oncall_routing_config::Model {
        oncall_routing_config::Model {
            org_id: "default".into(),
            default_team_id: default_team_id.map(str::to_string),
            updated_at: 42,
        }
    }

    #[test]
    fn test_a_row_maps_onto_the_meta_type() {
        let cfg = to_config(model(Some("team_1")));
        assert_eq!(cfg.org_id, "default");
        assert_eq!(cfg.default_team_id.as_deref(), Some("team_1"));
        assert_eq!(cfg.updated_at, 42);
        assert!(cfg.has_default());
    }

    /// A NULL and an empty string both mean "nobody has nominated a team", and
    /// the routing decision must not have to know that two spellings exist —
    /// one of them would eventually be treated as a team id that cannot resolve.
    #[test]
    fn test_null_and_blank_both_read_as_no_default() {
        for stored in [None, Some(""), Some("   ")] {
            let cfg = to_config(model(stored));
            assert_eq!(cfg.default_team_id, None, "stored={stored:?}");
            assert!(!cfg.has_default());
        }
    }
}
