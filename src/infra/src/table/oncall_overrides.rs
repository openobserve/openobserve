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

//! Overrides — "cover for me" (`architecture/02` §5).
//!
//! Their own table rather than a column on the schedule: an override has its
//! own lifecycle, expires on its own, and is deleted without touching the
//! rotation it stood over.
//!
//! Reads are deliberately blunt — one indexed query for a team's live covers,
//! and the resolver picks the winner in memory. There are single digits of
//! these per team, the paging path already loads the schedule row, and a
//! second round trip to have the database pick the maximum would cost more
//! than sorting a handful of rows.

use config::{
    ider,
    meta::oncall::ScheduleOverride,
    utils::time::now_micros,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
};

use super::entity::oncall_overrides;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

/// How far back a resolution load reaches.
///
/// The schedule loader cannot know which instant it will be asked about, so it
/// takes everything that has not long finished. Seven days back covers a
/// timeline being read the morning after a page while keeping the row count
/// bounded — an org that never deletes an override still loads a handful.
const RESOLUTION_LOOKBACK_MICROS: i64 = 7 * 24 * 60 * 60 * 1_000_000;

/// Ceiling on the rows any one read returns.
///
/// A team cannot be covered by a thousand people at once, so hitting this
/// means somebody scripted a loop. Losing the oldest of them is better than an
/// unbounded read on the path a page travels.
const MAX_ROWS: u64 = 500;

fn to_override(m: oncall_overrides::Model) -> ScheduleOverride {
    ScheduleOverride {
        id: m.id,
        org_id: m.org_id,
        team_id: m.team_id,
        slot: m.slot,
        user_email: m.user_email,
        start_at: m.start_at,
        end_at: m.end_at,
        covering_for: m.covering_for,
        reason: m.reason,
        created_by: m.created_by,
        created_at: m.created_at,
    }
}

/// Stores one cover. `id` and `created_at` are minted here, because
/// `created_at` is the overlap rule (§5) and a caller-supplied one would let a
/// client decide which of two covers wins.
#[allow(clippy::too_many_arguments)]
pub async fn create(
    org_id: &str,
    team_id: &str,
    slot: Option<String>,
    user_email: &str,
    start_at: i64,
    end_at: i64,
    covering_for: Option<String>,
    reason: Option<String>,
    created_by: &str,
) -> Result<ScheduleOverride, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = ScheduleOverride {
        id: ider::uuid(),
        org_id: org_id.to_string(),
        team_id: team_id.to_string(),
        slot,
        user_email: user_email.to_string(),
        start_at,
        end_at,
        covering_for,
        reason,
        created_by: created_by.to_string(),
        created_at: now_micros(),
    };
    oncall_overrides::ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        team_id: Set(record.team_id.clone()),
        slot: Set(record.slot.clone()),
        user_email: Set(record.user_email.clone()),
        covering_for: Set(record.covering_for.clone()),
        start_at: Set(record.start_at),
        end_at: Set(record.end_at),
        reason: Set(record.reason.clone()),
        created_by: Set(record.created_by.clone()),
        created_at: Set(record.created_at),
    }
    .insert(client)
    .await?;
    // A cover is stored here but *read* as part of the schedule, so the cache
    // that has to be dropped is the schedule's. Missing this is the failure
    // that makes the whole cover feature worse than useless: the engineer who
    // arranged cover stops watching and the page still goes to them.
    super::oncall_schedules::invalidate_and_publish(org_id, team_id).await;
    Ok(record)
}

pub async fn get(org_id: &str, id: &str) -> Result<Option<ScheduleOverride>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_overrides::Entity::find_by_id(id)
        .filter(oncall_overrides::Column::OrgId.eq(org_id))
        .one(client)
        .await?
        .map(to_override))
}

/// Every cover for a team, newest first.
pub async fn list_by_team(
    org_id: &str,
    team_id: &str,
) -> Result<Vec<ScheduleOverride>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_overrides::Entity::find()
        .filter(oncall_overrides::Column::OrgId.eq(org_id))
        .filter(oncall_overrides::Column::TeamId.eq(team_id))
        .order_by_desc(oncall_overrides::Column::CreatedAt)
        .order_by_desc(oncall_overrides::Column::Id)
        .limit(MAX_ROWS)
        .all(client)
        .await?
        .into_iter()
        .map(to_override)
        .collect())
}

/// Covers overlapping `[from, to)`.
///
/// Half-open on both sides, matching [`ScheduleOverride::covers`]: a cover
/// ending exactly at `from` does not touch the window, and one starting
/// exactly at `to` does not either.
pub async fn list_in_window(
    org_id: &str,
    team_id: &str,
    from: i64,
    to: i64,
) -> Result<Vec<ScheduleOverride>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_overrides::Entity::find()
        .filter(oncall_overrides::Column::OrgId.eq(org_id))
        .filter(oncall_overrides::Column::TeamId.eq(team_id))
        .filter(oncall_overrides::Column::StartAt.lt(to))
        .filter(oncall_overrides::Column::EndAt.gt(from))
        .order_by_asc(oncall_overrides::Column::StartAt)
        .order_by_asc(oncall_overrides::Column::Id)
        .limit(MAX_ROWS)
        .all(client)
        .await?
        .into_iter()
        .map(to_override)
        .collect())
}

/// What the schedule loader attaches so that every resolution sees the covers.
///
/// Bounded rather than "everything": an override table is append-mostly, and a
/// read on the paging path must not grow with the org's history. `at` is the
/// instant resolution is centred on, passed in rather than read from a clock
/// here so the same function serves a replay.
pub async fn list_for_resolution(
    org_id: &str,
    team_id: &str,
    at: i64,
) -> Result<Vec<ScheduleOverride>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_overrides::Entity::find()
        .filter(oncall_overrides::Column::OrgId.eq(org_id))
        .filter(oncall_overrides::Column::TeamId.eq(team_id))
        .filter(oncall_overrides::Column::EndAt.gt(at - RESOLUTION_LOOKBACK_MICROS))
        // Newest last, so a truncated read keeps the covers that win.
        .order_by_asc(oncall_overrides::Column::CreatedAt)
        .order_by_asc(oncall_overrides::Column::Id)
        .limit(MAX_ROWS)
        .all(client)
        .await?
        .into_iter()
        .map(to_override)
        .collect())
}

pub async fn delete(org_id: &str, id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // Read before the delete purely to learn the team: the invalidation is
    // keyed on the team, and after the row is gone there is nothing left to ask.
    let team_id = get(org_id, id).await?.map(|o| o.team_id);
    let deleted = oncall_overrides::Entity::delete_many()
        .filter(oncall_overrides::Column::OrgId.eq(org_id))
        .filter(oncall_overrides::Column::Id.eq(id))
        .exec(client)
        .await?
        .rows_affected;
    if let Some(team_id) = team_id {
        super::oncall_schedules::invalidate_and_publish(org_id, &team_id).await;
    }
    Ok(deleted > 0)
}

/// Drops every cover a team has. Called when the team is deleted, so its
/// overrides do not outlive it as rows pointing at nothing.
pub async fn delete_by_team(org_id: &str, team_id: &str) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let dropped = oncall_overrides::Entity::delete_many()
        .filter(oncall_overrides::Column::OrgId.eq(org_id))
        .filter(oncall_overrides::Column::TeamId.eq(team_id))
        .exec(client)
        .await?
        .rows_affected;
    super::oncall_schedules::invalidate_and_publish(org_id, team_id).await;
    Ok(dropped)
}

/// Drops a person's covers that have not finished by `at`.
///
/// The mirror of taking somebody off the rotation when they leave the team.
/// An override outranks every layer, so a departed engineer holding a future
/// cover would still be the answer to "who is on call" — the exact bug that
/// removing them from the rotation was written to prevent, arriving through
/// the other door. Covers already finished are kept: they are history.
pub async fn delete_future_for_user(
    org_id: &str,
    team_id: &str,
    user_email: &str,
    at: i64,
) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let dropped = oncall_overrides::Entity::delete_many()
        .filter(oncall_overrides::Column::OrgId.eq(org_id))
        .filter(oncall_overrides::Column::TeamId.eq(team_id))
        .filter(oncall_overrides::Column::UserEmail.eq(user_email))
        .filter(oncall_overrides::Column::EndAt.gt(at))
        .exec(client)
        .await?
        .rows_affected;
    super::oncall_schedules::invalidate_and_publish(org_id, team_id).await;
    Ok(dropped)
}

#[cfg(test)]
mod tests {
    use config::meta::oncall::covering_override;

    use super::*;

    fn model(id: &str, start: i64, end: i64, created_at: i64) -> oncall_overrides::Model {
        oncall_overrides::Model {
            id: id.into(),
            org_id: "default".into(),
            team_id: "team_1".into(),
            slot: None,
            user_email: "sam@o2.ai".into(),
            covering_for: Some("ana@o2.ai".into()),
            start_at: start,
            end_at: end,
            reason: Some("dentist".into()),
            created_by: "ana@o2.ai".into(),
            created_at,
        }
    }

    #[test]
    fn test_a_row_round_trips_into_the_meta_type() {
        let o = to_override(model("ov_1", 100, 200, 5));
        assert_eq!(o.id, "ov_1");
        assert_eq!(o.user_email, "sam@o2.ai");
        assert_eq!(o.covering_for.as_deref(), Some("ana@o2.ai"));
        assert_eq!(o.reason.as_deref(), Some("dentist"));
        assert!(o.covers(150));
        assert!(!o.covers(200));
    }

    /// The optional columns are genuinely optional: a cover arranged in ten
    /// seconds names nobody and gives no reason.
    #[test]
    fn test_the_optional_columns_stay_optional() {
        let mut m = model("ov_1", 0, 10, 1);
        m.covering_for = None;
        m.reason = None;
        let o = to_override(m);
        assert!(o.covering_for.is_none() && o.reason.is_none());
    }

    /// The window filter and `overlaps` have to agree, or the list endpoint
    /// and the resolver disagree about which covers exist.
    #[test]
    fn test_the_window_filter_matches_the_overlap_predicate() {
        let o = to_override(model("ov_1", 100, 200, 1));
        // `start_at < to AND end_at > from`, which is what `list_in_window`
        // asks the database for.
        assert!(o.overlaps(150, 250), "straddles the end");
        assert!(o.overlaps(50, 150), "straddles the start");
        assert!(o.overlaps(0, 500), "enclosed");
        assert!(!o.overlaps(200, 300), "starts where the cover ends");
        assert!(!o.overlaps(0, 100), "ends where the cover starts");
    }

    /// `list_for_resolution` orders oldest first so that a truncated read
    /// keeps the covers that would win — and the winner is picked in memory,
    /// so the ordering must not be what decides it.
    #[test]
    fn test_the_winner_does_not_depend_on_the_row_order() {
        let rows = vec![
            to_override(model("ov_a", 0, 1000, 10)),
            to_override(model("ov_b", 0, 1000, 20)),
        ];
        let reversed: Vec<_> = rows.iter().rev().cloned().collect();
        assert_eq!(covering_override(&rows, 500).unwrap().id, "ov_b");
        assert_eq!(covering_override(&reversed, 500).unwrap().id, "ov_b");
    }
}
