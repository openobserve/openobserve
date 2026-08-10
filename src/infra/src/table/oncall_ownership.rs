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

//! Ownership rules — which team owns which slice of the identity space.

use std::collections::HashMap;

use config::{ider, meta::oncall::OwnershipRule, utils::time::now_micros};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};

use super::entity::oncall_ownership_rules;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

/// A rule whose dimensions column will not parse is dropped, not defaulted to
/// empty. An empty rule matches EVERY alert in the org, so a parse failure
/// must never produce one.
fn to_rule(m: oncall_ownership_rules::Model) -> Option<OwnershipRule> {
    let dimensions: HashMap<String, String> = match serde_json::from_str(&m.dimensions) {
        Ok(d) => d,
        Err(e) => {
            log::error!(
                "[ONCALL] ownership rule {} has unparseable dimensions, ignoring it: {e}",
                m.id
            );
            return None;
        }
    };
    Some(OwnershipRule {
        id: m.id,
        org_id: m.org_id,
        team_id: m.team_id,
        dimensions,
        created_at: m.created_at,
        updated_at: m.updated_at,
    })
}

pub async fn create(
    org_id: &str,
    team_id: &str,
    dimensions: HashMap<String, String>,
) -> Result<OwnershipRule, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = now_micros();
    let rule = OwnershipRule {
        id: ider::uuid(),
        org_id: org_id.to_string(),
        team_id: team_id.to_string(),
        dimensions,
        created_at: now,
        updated_at: now,
    };
    let model = oncall_ownership_rules::ActiveModel {
        id: Set(rule.id.clone()),
        org_id: Set(rule.org_id.clone()),
        team_id: Set(rule.team_id.clone()),
        path: Set(rule.path()),
        dimensions: Set(serde_json::to_string(&rule.dimensions)?),
        created_at: Set(now),
        updated_at: Set(now),
    };
    model.insert(client).await?;
    Ok(rule)
}

/// Every rule for an org. The routing path loads the whole set and resolves in
/// memory: the match is longest-prefix over a map, which SQL cannot express,
/// and an org has tens of rules, not thousands.
pub async fn list(org_id: &str) -> Result<Vec<OwnershipRule>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_ownership_rules::Entity::find()
        .filter(oncall_ownership_rules::Column::OrgId.eq(org_id))
        .order_by_asc(oncall_ownership_rules::Column::Path)
        .all(client)
        .await?
        .into_iter()
        .filter_map(to_rule)
        .collect())
}

pub async fn list_by_team(
    org_id: &str,
    team_id: &str,
) -> Result<Vec<OwnershipRule>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_ownership_rules::Entity::find()
        .filter(oncall_ownership_rules::Column::OrgId.eq(org_id))
        .filter(oncall_ownership_rules::Column::TeamId.eq(team_id))
        .order_by_asc(oncall_ownership_rules::Column::Path)
        .all(client)
        .await?
        .into_iter()
        .filter_map(to_rule)
        .collect())
}

pub async fn delete(org_id: &str, id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let deleted = oncall_ownership_rules::Entity::delete_many()
        .filter(oncall_ownership_rules::Column::OrgId.eq(org_id))
        .filter(oncall_ownership_rules::Column::Id.eq(id))
        .exec(client)
        .await?
        .rows_affected;
    Ok(deleted > 0)
}

/// Drops every rule a team owns. Called when the team is deleted, so its
/// claims do not keep routing alerts at a team that no longer exists.
pub async fn delete_by_team(org_id: &str, team_id: &str) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_ownership_rules::Entity::delete_many()
        .filter(oncall_ownership_rules::Column::OrgId.eq(org_id))
        .filter(oncall_ownership_rules::Column::TeamId.eq(team_id))
        .exec(client)
        .await?
        .rows_affected)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(dimensions: &str) -> oncall_ownership_rules::Model {
        oncall_ownership_rules::Model {
            id: "rule_1".into(),
            org_id: "default".into(),
            team_id: "team_1".into(),
            path: "k8s-cluster=prod".into(),
            dimensions: dimensions.into(),
            created_at: 10,
            updated_at: 20,
        }
    }

    #[test]
    fn test_dimensions_round_trip_through_the_json_column() {
        let dims = HashMap::from([
            ("k8s-cluster".to_string(), "prod".to_string()),
            ("k8s-namespace".to_string(), "payments".to_string()),
        ]);
        let rule = to_rule(model(&serde_json::to_string(&dims).unwrap())).unwrap();
        assert_eq!(rule.dimensions, dims);
        assert_eq!(rule.team_id, "team_1");
    }

    /// An empty rule owns EVERY alert in the org. A parse failure must drop
    /// the row, never fall back to one.
    #[test]
    fn test_unparseable_dimensions_drop_the_rule() {
        for bad in ["not json", "[]", "null", r#"{"k":1}"#] {
            assert!(to_rule(model(bad)).is_none(), "`{bad}` must be dropped");
        }
    }

    /// `{}` parses cleanly as a map, so the drop above cannot catch it — the
    /// resolver's own validate() is the backstop.
    #[test]
    fn test_an_empty_map_parses_but_never_matches() {
        let rule = to_rule(model("{}")).unwrap();
        assert!(rule.validate().is_err());
        assert!(
            config::meta::oncall::resolve_owner(
                &[rule],
                &HashMap::from([("k8s-cluster".to_string(), "prod".to_string())])
            )
            .is_none()
        );
    }

    /// The stored path is what the unique index refuses duplicates on, so it
    /// has to be the canonical sorted form, not HashMap order.
    #[test]
    fn test_stored_path_is_canonical() {
        let dims = HashMap::from([
            ("k8s-namespace".to_string(), "payments".to_string()),
            ("k8s-cluster".to_string(), "prod".to_string()),
        ]);
        let rule = to_rule(model(&serde_json::to_string(&dims).unwrap())).unwrap();
        assert_eq!(rule.path(), "k8s-cluster=prod/k8s-namespace=payments");
    }
}
