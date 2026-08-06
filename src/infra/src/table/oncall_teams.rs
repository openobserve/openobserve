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

//! On-call teams and their membership.

use config::{
    ider,
    meta::oncall::{EscalationLevel, Team, TeamMember},
    utils::time::now_micros,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};

use super::entity::{oncall_team_members, oncall_teams};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

fn to_team(m: oncall_teams::Model) -> Team {
    Team {
        id: m.id,
        org_id: m.org_id,
        name: m.name,
        timezone: m.timezone,
        description: m.description,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

/// Rows whose stored level is not a level this build knows about are dropped
/// rather than defaulted. A membership we cannot interpret must not silently
/// become a Primary.
fn to_member(m: oncall_team_members::Model) -> Option<TeamMember> {
    Some(TeamMember {
        id: m.id,
        team_id: m.team_id,
        user_email: m.user_email,
        level: EscalationLevel::from_i32(m.level)?,
    })
}

pub async fn create(
    org_id: &str,
    name: &str,
    timezone: &str,
    description: Option<String>,
) -> Result<Team, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = now_micros();
    let model = oncall_teams::ActiveModel {
        id: Set(ider::uuid()),
        org_id: Set(org_id.to_string()),
        name: Set(name.to_string()),
        timezone: Set(timezone.to_string()),
        description: Set(description),
        created_at: Set(now),
        updated_at: Set(now),
    };
    Ok(to_team(model.insert(client).await?))
}

pub async fn get(org_id: &str, id: &str) -> Result<Option<Team>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_teams::Entity::find_by_id(id)
        .filter(oncall_teams::Column::OrgId.eq(org_id))
        .one(client)
        .await?
        .map(to_team))
}

pub async fn get_by_name(org_id: &str, name: &str) -> Result<Option<Team>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_teams::Entity::find()
        .filter(oncall_teams::Column::OrgId.eq(org_id))
        .filter(oncall_teams::Column::Name.eq(name))
        .one(client)
        .await?
        .map(to_team))
}

/// Ordered by id: stable and roughly creation-ordered, which is all a team
/// list needs.
pub async fn list(org_id: &str) -> Result<Vec<Team>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_teams::Entity::find()
        .filter(oncall_teams::Column::OrgId.eq(org_id))
        .order_by_asc(oncall_teams::Column::Id)
        .all(client)
        .await?
        .into_iter()
        .map(to_team)
        .collect())
}

pub async fn update(
    org_id: &str,
    id: &str,
    name: Option<String>,
    timezone: Option<String>,
    description: Option<Option<String>>,
) -> Result<Option<Team>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(existing) = oncall_teams::Entity::find_by_id(id)
        .filter(oncall_teams::Column::OrgId.eq(org_id))
        .one(client)
        .await?
    else {
        return Ok(None);
    };
    let mut model: oncall_teams::ActiveModel = existing.into();
    if let Some(v) = name {
        model.name = Set(v);
    }
    if let Some(v) = timezone {
        model.timezone = Set(v);
    }
    if let Some(v) = description {
        model.description = Set(v);
    }
    model.updated_at = Set(now_micros());
    Ok(Some(to_team(model.update(client).await?)))
}

/// Deletes the team and its membership in one transaction.
///
/// Schedules, policies and responses are left alone deliberately: a response
/// record is history and must survive the team being reorganised away.
pub async fn delete(org_id: &str, id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let txn = client.begin().await?;
    let deleted = oncall_teams::Entity::delete_many()
        .filter(oncall_teams::Column::OrgId.eq(org_id))
        .filter(oncall_teams::Column::Id.eq(id))
        .exec(&txn)
        .await?
        .rows_affected;
    if deleted == 0 {
        txn.rollback().await?;
        return Ok(false);
    }
    oncall_team_members::Entity::delete_many()
        .filter(oncall_team_members::Column::TeamId.eq(id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(true)
}

pub async fn add_member(
    team_id: &str,
    user_email: &str,
    level: EscalationLevel,
) -> Result<TeamMember, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = oncall_team_members::ActiveModel {
        id: Set(ider::uuid()),
        team_id: Set(team_id.to_string()),
        user_email: Set(user_email.to_string()),
        level: Set(level.to_i32()),
        created_at: Set(now_micros()),
    };
    let inserted = model.insert(client).await?;
    Ok(TeamMember {
        id: inserted.id,
        team_id: inserted.team_id,
        user_email: inserted.user_email,
        level,
    })
}

pub async fn list_members(team_id: &str) -> Result<Vec<TeamMember>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_team_members::Entity::find()
        .filter(oncall_team_members::Column::TeamId.eq(team_id))
        .order_by_asc(oncall_team_members::Column::Level)
        .order_by_asc(oncall_team_members::Column::Id)
        .all(client)
        .await?
        .into_iter()
        .filter_map(to_member)
        .collect())
}

pub async fn remove_member(
    team_id: &str,
    user_email: &str,
    level: EscalationLevel,
) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let deleted = oncall_team_members::Entity::delete_many()
        .filter(oncall_team_members::Column::TeamId.eq(team_id))
        .filter(oncall_team_members::Column::UserEmail.eq(user_email))
        .filter(oncall_team_members::Column::Level.eq(level.to_i32()))
        .exec(client)
        .await?
        .rows_affected;
    Ok(deleted > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_maps_onto_the_meta_type() {
        let m = oncall_teams::Model {
            id: "team_1".into(),
            org_id: "default".into(),
            name: "Platform".into(),
            timezone: "Asia/Kolkata".into(),
            description: Some("owns queriers".into()),
            created_at: 10,
            updated_at: 20,
        };
        let t = to_team(m.clone());
        assert_eq!(t.id, m.id);
        assert_eq!(t.name, "Platform");
        assert_eq!(t.timezone, "Asia/Kolkata");
        assert_eq!(t.description.as_deref(), Some("owns queriers"));
        assert_eq!((t.created_at, t.updated_at), (10, 20));
    }

    #[test]
    fn test_member_level_round_trips_through_storage() {
        for level in EscalationLevel::HUMAN_LEVELS {
            let m = oncall_team_members::Model {
                id: "mem_1".into(),
                team_id: "team_1".into(),
                user_email: "ana@o2.ai".into(),
                level: level.to_i32(),
                created_at: 0,
            };
            assert_eq!(to_member(m).unwrap().level, level);
        }
    }

    /// A row this build cannot interpret must be dropped, not defaulted.
    /// Defaulting would page whoever happens to sit at the fallback level.
    #[test]
    fn test_unknown_stored_level_is_dropped() {
        let m = oncall_team_members::Model {
            id: "mem_1".into(),
            team_id: "team_1".into(),
            user_email: "ana@o2.ai".into(),
            level: 99,
            created_at: 0,
        };
        assert!(to_member(m).is_none());
    }

    /// Ksuids carry a one-second timestamp and a random payload, so two ids
    /// minted in the same second sort arbitrarily. Anything needing strict
    /// ordering sorts on an explicit timestamp with the id as a tiebreak.
    #[test]
    fn test_generated_ids_are_unique_and_fixed_width() {
        let ids: std::collections::HashSet<String> = (0..64).map(|_| ider::uuid()).collect();
        assert_eq!(ids.len(), 64, "ksuids must be unique");
        assert!(
            ids.iter().all(|i| i.len() == 27),
            "ksuids are fixed width, so lexical and byte order agree"
        );
    }
}
