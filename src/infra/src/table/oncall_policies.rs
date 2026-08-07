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

//! A team's escalation policy, stored as JSON.

use config::{
    ider,
    meta::oncall::{EscalationPolicy, PriorityRung},
    utils::time::now_micros,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};

use super::entity::oncall_policies;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

/// A policy whose rungs will not parse falls back to the shipped defaults
/// rather than to nothing.
///
/// This is the opposite choice from schedules, and deliberately so. An
/// unstaffed schedule pages nobody but is *visible* as a coverage gap; an
/// empty policy would also page nobody and look like a deliberate
/// configuration. Falling back to the defaults keeps the team pageable while
/// the corruption is logged.
fn to_policy(m: oncall_policies::Model) -> EscalationPolicy {
    match serde_json::from_str::<Vec<PriorityRung>>(&m.rungs) {
        Ok(rungs) => EscalationPolicy {
            id: m.id,
            org_id: m.org_id,
            team_id: m.team_id,
            rungs,
        },
        Err(e) => {
            log::error!(
                "[ONCALL] policy {} has unparseable rungs, falling back to defaults: {e}",
                m.id
            );
            EscalationPolicy::default_for_team(m.id, m.org_id, m.team_id)
        }
    }
}

/// Reads the team's policy, creating it from the defaults if it has none.
///
/// Get-or-create rather than plain get because a team must be pageable the
/// moment it exists — requiring someone to design a policy first is how
/// alerts end up going nowhere.
pub async fn get_or_create(org_id: &str, team_id: &str) -> Result<EscalationPolicy, errors::Error> {
    if let Some(found) = get_by_team(org_id, team_id).await? {
        return Ok(found);
    }
    let defaults = EscalationPolicy::default_for_team(ider::uuid(), org_id, team_id);
    match insert(&defaults).await {
        Ok(created) => Ok(created),
        // Another node created it between our read and our write; the unique
        // index on team_id is what makes that safe, and re-reading is the
        // correct resolution.
        Err(e) => match get_by_team(org_id, team_id).await? {
            Some(found) => Ok(found),
            None => Err(e),
        },
    }
}

async fn insert(policy: &EscalationPolicy) -> Result<EscalationPolicy, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = now_micros();
    let model = oncall_policies::ActiveModel {
        id: Set(policy.id.clone()),
        org_id: Set(policy.org_id.clone()),
        team_id: Set(policy.team_id.clone()),
        rungs: Set(serde_json::to_string(&policy.rungs)?),
        created_at: Set(now),
        updated_at: Set(now),
    };
    Ok(to_policy(model.insert(client).await?))
}

pub async fn get_by_team(
    org_id: &str,
    team_id: &str,
) -> Result<Option<EscalationPolicy>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_policies::Entity::find()
        .filter(oncall_policies::Column::OrgId.eq(org_id))
        .filter(oncall_policies::Column::TeamId.eq(team_id))
        .one(client)
        .await?
        .map(to_policy))
}

pub async fn update_rungs(
    org_id: &str,
    team_id: &str,
    rungs: &[PriorityRung],
) -> Result<Option<EscalationPolicy>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(existing) = oncall_policies::Entity::find()
        .filter(oncall_policies::Column::OrgId.eq(org_id))
        .filter(oncall_policies::Column::TeamId.eq(team_id))
        .one(client)
        .await?
    else {
        return Ok(None);
    };
    let mut model: oncall_policies::ActiveModel = existing.into();
    model.rungs = Set(serde_json::to_string(rungs)?);
    model.updated_at = Set(now_micros());
    Ok(Some(to_policy(model.update(client).await?)))
}

pub async fn list(org_id: &str) -> Result<Vec<EscalationPolicy>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_policies::Entity::find()
        .filter(oncall_policies::Column::OrgId.eq(org_id))
        .order_by_asc(oncall_policies::Column::Id)
        .all(client)
        .await?
        .into_iter()
        .map(to_policy)
        .collect())
}

pub async fn delete_by_team(org_id: &str, team_id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let deleted = oncall_policies::Entity::delete_many()
        .filter(oncall_policies::Column::OrgId.eq(org_id))
        .filter(oncall_policies::Column::TeamId.eq(team_id))
        .exec(client)
        .await?
        .rows_affected;
    Ok(deleted > 0)
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::priority::AlertPriority;

    use super::*;

    fn model(rungs: &str) -> oncall_policies::Model {
        oncall_policies::Model {
            id: "pol_1".into(),
            org_id: "default".into(),
            team_id: "team_1".into(),
            rungs: rungs.into(),
            created_at: 10,
            updated_at: 20,
        }
    }

    #[test]
    fn test_rungs_round_trip_through_the_json_column() {
        let defaults = EscalationPolicy::default_for_team("pol_1", "default", "team_1");
        let encoded = serde_json::to_string(&defaults.rungs).unwrap();
        let p = to_policy(model(&encoded));
        assert_eq!(p, defaults);
    }

    /// Unlike a schedule, a corrupt policy falls back to the defaults: an
    /// empty policy pages nobody and is indistinguishable from a deliberate
    /// one, so the team would go silently unpageable.
    #[test]
    fn test_unparseable_rungs_fall_back_to_the_defaults() {
        for bad in ["not json", "{}", r#"[{"priority":99}]"#] {
            let p = to_policy(model(bad));
            assert!(
                p.pages_anyone(AlertPriority::P1),
                "`{bad}` must leave the team pageable"
            );
            assert_eq!(
                p,
                EscalationPolicy::default_for_team("pol_1", "default", "team_1")
            );
        }
    }

    /// A policy that genuinely pages nobody is stored as valid JSON and must
    /// be honoured — that is a team's choice, not corruption.
    #[test]
    fn test_an_explicitly_empty_policy_is_honoured() {
        let p = to_policy(model("[]"));
        assert!(p.rungs.is_empty());
        assert!(!p.pages_anyone(AlertPriority::P1));
    }

    #[test]
    fn test_edited_rungs_survive_the_round_trip() {
        let mut edited = EscalationPolicy::default_for_team("pol_1", "default", "team_1");
        let idx = edited
            .rungs
            .iter()
            .position(|r| r.priority == AlertPriority::P3)
            .unwrap();
        edited.rungs[idx].steps.clear();
        let encoded = serde_json::to_string(&edited.rungs).unwrap();
        let back = to_policy(model(&encoded));
        assert!(
            !back.pages_anyone(AlertPriority::P3),
            "the team's edit stands"
        );
        assert!(back.pages_anyone(AlertPriority::P1));
    }
}
