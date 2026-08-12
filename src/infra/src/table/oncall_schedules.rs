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

//! A team's schedule: its rotations, stored as JSON.
//!
//! Rotations are one column rather than one table because they are always
//! read and written as a set — resolving who is on call needs every level at
//! once, and editing one rotation is a save of the whole schedule. Layers
//! land inside the same column later.

use config::{
    ider,
    meta::oncall::{Rotation, Schedule},
    utils::time::now_micros,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};

use super::entity::oncall_schedules;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

/// A schedule whose rotations column will not parse is returned with no
/// rotations rather than as an error.
///
/// The alternative is that one corrupt row takes down the whole schedule list
/// for the org. An empty schedule resolves to nobody, which surfaces as a
/// coverage gap the team can see and fix — a visible failure beats an opaque
/// one.
fn to_schedule(m: oncall_schedules::Model) -> Schedule {
    let rotations: Vec<Rotation> = serde_json::from_str(&m.rotations).unwrap_or_else(|e| {
        log::error!(
            "[ONCALL] schedule {} has unparseable rotations, treating as unstaffed: {e}",
            m.id
        );
        Vec::new()
    });
    Schedule {
        id: m.id,
        org_id: m.org_id,
        team_id: m.team_id,
        timezone: m.timezone,
        rotations,
        // Filled in by the read paths below. A `Schedule` built without them
        // resolves as though nobody had arranged cover, which is why every
        // loader that answers "who is on call" goes through
        // `with_overrides` rather than constructing one here.
        overrides: Vec::new(),
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

/// Attaches the team's covers to a schedule.
///
/// Kept as one function, and called by every read that resolves, because the
/// failure it prevents is silent: a caller that loads the schedule and forgets
/// the overrides gets a perfectly plausible answer that pages the person who
/// arranged not to be paged. The alternative — leaving each caller to join the
/// two — is how this feature would break the first time somebody added a
/// resolution path.
///
/// Failing to read the overrides is logged and swallowed rather than
/// propagated: a page with a slightly wrong recipient beats no page at all
/// (§12), and the same reasoning already governs the DashMap fallback.
async fn with_overrides(mut schedule: Schedule, at: i64) -> Schedule {
    match super::oncall_overrides::list_for_resolution(&schedule.org_id, &schedule.team_id, at)
        .await
    {
        Ok(overrides) => schedule.overrides = overrides,
        Err(e) => log::error!(
            "[ONCALL] could not load overrides for team {}, resolving without them — somebody who arranged cover may be paged: {e}",
            schedule.team_id
        ),
    }
    schedule
}

/// Creates the schedule if the team has none, otherwise replaces its
/// rotations. A team has exactly one schedule, enforced by a unique index on
/// `team_id`.
pub async fn upsert(
    org_id: &str,
    team_id: &str,
    timezone: &str,
    rotations: &[Rotation],
) -> Result<Schedule, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let encoded = serde_json::to_string(rotations)?;
    let now = now_micros();

    match oncall_schedules::Entity::find()
        .filter(oncall_schedules::Column::OrgId.eq(org_id))
        .filter(oncall_schedules::Column::TeamId.eq(team_id))
        .one(client)
        .await?
    {
        Some(existing) => {
            let mut model: oncall_schedules::ActiveModel = existing.into();
            model.timezone = Set(timezone.to_string());
            model.rotations = Set(encoded);
            model.updated_at = Set(now);
            Ok(to_schedule(model.update(client).await?))
        }
        None => {
            let model = oncall_schedules::ActiveModel {
                id: Set(ider::uuid()),
                org_id: Set(org_id.to_string()),
                team_id: Set(team_id.to_string()),
                timezone: Set(timezone.to_string()),
                rotations: Set(encoded),
                created_at: Set(now),
                updated_at: Set(now),
            };
            Ok(to_schedule(model.insert(client).await?))
        }
    }
}

/// The team's schedule, covers included, so the result resolves correctly on
/// its own.
pub async fn get_by_team(org_id: &str, team_id: &str) -> Result<Option<Schedule>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let found = oncall_schedules::Entity::find()
        .filter(oncall_schedules::Column::OrgId.eq(org_id))
        .filter(oncall_schedules::Column::TeamId.eq(team_id))
        .one(client)
        .await?
        .map(to_schedule);
    Ok(match found {
        Some(s) => Some(with_overrides(s, now_micros()).await),
        None => None,
    })
}

/// Every schedule in the org, covers included.
///
/// One override query per schedule rather than one for the org: the callers
/// are the coverage-gap sweep and the team list, both of which run per org on
/// a background cadence, and the indexed per-team read is what the paging path
/// already uses. Sharing one query shape is worth more here than saving a
/// round trip on a screen nobody is paged by.
pub async fn list(org_id: &str) -> Result<Vec<Schedule>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let rows = oncall_schedules::Entity::find()
        .filter(oncall_schedules::Column::OrgId.eq(org_id))
        .order_by_asc(oncall_schedules::Column::Id)
        .all(client)
        .await?;
    let now = now_micros();
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(with_overrides(to_schedule(row), now).await);
    }
    Ok(out)
}

pub async fn delete_by_team(org_id: &str, team_id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let deleted = oncall_schedules::Entity::delete_many()
        .filter(oncall_schedules::Column::OrgId.eq(org_id))
        .filter(oncall_schedules::Column::TeamId.eq(team_id))
        .exec(client)
        .await?
        .rows_affected;
    Ok(deleted > 0)
}

#[cfg(test)]
mod tests {
    use config::meta::oncall::MICROS_PER_WEEK;

    use super::*;

    fn model(rotations: &str) -> oncall_schedules::Model {
        oncall_schedules::Model {
            id: "sch_1".into(),
            org_id: "default".into(),
            team_id: "team_1".into(),
            timezone: "Asia/Kolkata".into(),
            rotations: rotations.into(),
            created_at: 10,
            updated_at: 20,
        }
    }

    #[test]
    fn test_rotations_round_trip_through_the_json_column() {
        let rotations = vec![
            Rotation::weekly("Weekdays", vec!["ana@o2.ai".into()], 100),
        ];
        let encoded = serde_json::to_string(&rotations).unwrap();
        let s = to_schedule(model(&encoded));
        assert_eq!(s.rotations, rotations);
        assert_eq!(s.timezone, "Asia/Kolkata");
        assert_eq!(s.team_id, "team_1");
    }

    /// One corrupt row must not take down the org's whole schedule list. An
    /// unstaffed schedule surfaces as a coverage gap the team can see.
    #[test]
    fn test_unparseable_rotations_degrade_to_unstaffed() {
        for bad in ["not json", "{}", r#"[{"name":123}]"#] {
            let s = to_schedule(model(bad));
            assert!(s.rotations.is_empty(), "`{bad}` must not panic or throw");
            assert_eq!(s.id, "sch_1", "the rest of the row still loads");
        }
    }

    #[test]
    fn test_an_empty_schedule_is_valid_and_staffs_nobody() {
        let s = to_schedule(model("[]"));
        assert!(s.rotations.is_empty());
        assert!(s.on_call_at(0).is_empty());
    }

    #[test]
    fn test_a_stored_schedule_resolves_who_is_on_call() {
        let encoded = serde_json::to_string(&vec![Rotation::weekly(
            "Primary",
            vec!["ana@o2.ai".into(), "bob@o2.ai".into()],
            0,
        )])
        .unwrap();
        let s = to_schedule(model(&encoded));

        assert_eq!(s.on_call_now(0).unwrap(), "ana@o2.ai");
        assert_eq!(s.next_on_call(0).unwrap(), "bob@o2.ai");
        assert_eq!(s.on_call_now(MICROS_PER_WEEK).unwrap(), "bob@o2.ai");
    }
}
