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

use std::{
    sync::LazyLock,
    time::{Duration, Instant},
};

use config::{
    RwHashMap, ider,
    meta::oncall::{Rotation, Schedule, Unavailability},
    utils::time::now_micros,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};

use super::entity::oncall_schedules;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

/// The team's schedule *with its covers*, for the paging path (`06` §3).
///
/// The riskiest of the four on-call caches, and the reason the TTL below is a
/// minute rather than five: a stale schedule pages the wrong person, and it
/// does it quietly, because somebody's phone still rings. Two things make it
/// safe enough to be worth having.
///
/// First, what is cached is the *schedule*, not the resolution. `CACHING-STRATEGY`
/// §2 proposes caching `(schedule_id, level, hour_bucket) -> user`; that has a
/// bucket boundary to get wrong, and getting it wrong pages yesterday's
/// on-call. Caching the rotations and letting `on_call_now(now)` run on every
/// call has no boundary at all — the answer is always computed against the real
/// clock.
///
/// Second, [`with_overrides`] attaches covers with a *backward-looking* cutoff
/// (`end_at > at - lookback`, unbounded forward). A cached copy is therefore a
/// superset of what a fresh read would attach, never a subset: no cover can be
/// missing because the list is a minute old. A cover created in the last minute
/// is the case the coordinator event exists for, and `oncall_overrides` emits
/// one on every write.
///
/// Backs [`get_by_team_cached`] only. Every screen still reads [`get_by_team`].
static SCHEDULE_CACHE: LazyLock<RwHashMap<String, (Schedule, Instant)>> =
    LazyLock::new(Default::default);

/// One minute. See [`SCHEDULE_CACHE`] — this is the backstop for a coordinator
/// event that never arrived, not the invalidation mechanism, and the thing it
/// backstops is somebody being woken in place of the person who took their
/// shift.
const SCHEDULE_CACHE_TTL: Duration = Duration::from_secs(60);

fn schedule_cache_key(org_id: &str, team_id: &str) -> String {
    format!("{org_id}/{team_id}")
}

/// Drops one team's schedule. Called by the coordinator watcher, and by every
/// path that edits a rotation or a cover.
pub fn invalidate_cache(org_id: &str, team_id: &str) {
    SCHEDULE_CACHE.remove(&schedule_cache_key(org_id, team_id));
}

/// Drops every schedule an org holds.
///
/// The blunt instrument, and the only correct one for an absence: a window is
/// stored per person and applies to every rotation they are on, so there is no
/// single team to name. Bounded by the org's team count, which is the same
/// order as the cache itself.
pub fn invalidate_org(org_id: &str) {
    let prefix = format!("{org_id}/");
    SCHEDULE_CACHE.retain(|key, _| !key.starts_with(&prefix));
}

/// Invalidates every schedule in the org locally, and tells every other node.
///
/// `pub(super)` because `oncall_unavailability` has to call it: an absence is
/// stored in its own table but read as part of the schedule, so the write that
/// records it invalidates the schedule — and missing this is what makes the
/// feature worse than useless. Somebody marks themselves away, believes it,
/// stops watching, and the stale schedule pages them anyway.
pub(super) async fn invalidate_org_and_publish(org_id: &str) {
    invalidate_org(org_id);
    if let Err(e) = crate::coordinator::oncall::emit_absences_changed(org_id).await {
        log::error!("[oncall] emit absence cache event failed for {org_id}: {e}");
    }
}

/// Invalidates locally and tells every other node to do the same.
///
/// `pub(super)` because `oncall_overrides` has to call it: a cover is stored in
/// its own table but read as part of the schedule, so the write that creates it
/// invalidates the schedule.
pub(super) async fn invalidate_and_publish(org_id: &str, team_id: &str) {
    invalidate_cache(org_id, team_id);
    if let Err(e) = crate::coordinator::oncall::emit_schedule_changed(org_id, team_id).await {
        log::error!("[oncall] emit schedule cache event failed for {org_id}/{team_id}: {e}");
    }
}

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
        // resolves as though nobody had arranged cover and nobody were away,
        // which is why every loader that answers "who is on call" goes through
        // `with_resolution_inputs` rather than constructing one here.
        overrides: Vec::new(),
        unavailability: Vec::new(),
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

/// Attaches the team's covers **and** the absences of the people on it.
///
/// Kept as one function, and called by every read that resolves, because the
/// failure it prevents is silent: a caller that loads the schedule and forgets
/// either of these gets a perfectly plausible answer that pages the person who
/// arranged not to be paged, or the person on a beach. The alternative —
/// leaving each caller to join the three — is how this feature would break the
/// first time somebody added a resolution path.
///
/// Failing either read is logged and swallowed rather than propagated: a page
/// with a slightly wrong recipient beats no page at all (§12), and the same
/// reasoning already governs the DashMap fallback.
///
/// The absences are narrowed to the schedule's own members here rather than in
/// the query. The org read is one indexed scan whatever it is asked for, a
/// rotation has single digits of people on it, and doing the intersection in
/// SQL would cost a round trip per team on the path a page travels.
async fn with_resolution_inputs(mut schedule: Schedule, at: i64) -> Schedule {
    match super::oncall_overrides::list_for_resolution(&schedule.org_id, &schedule.team_id, at)
        .await
    {
        Ok(overrides) => schedule.overrides = overrides,
        Err(e) => log::error!(
            "[ONCALL] could not load overrides for team {}, resolving without them — somebody who arranged cover may be paged: {e}",
            schedule.team_id
        ),
    }
    match super::oncall_unavailability::list_for_resolution(&schedule.org_id, at).await {
        Ok(windows) => schedule.unavailability = narrow_to_members(&schedule, windows),
        Err(e) => log::error!(
            "[ONCALL] could not load unavailability for team {}, resolving without it — somebody who is away may be paged: {e}",
            schedule.team_id
        ),
    }
    schedule
}

/// The org's absence windows, cut down to the people this schedule can page.
///
/// Includes the covering engineers as well as the rotation members: a cover
/// outranks an absence, so their window never changes who is paged, but the
/// calendar still has to be able to say the shift is being held by somebody who
/// was down as away.
fn narrow_to_members(schedule: &Schedule, windows: Vec<Unavailability>) -> Vec<Unavailability> {
    let mut people: std::collections::HashSet<String> = schedule
        .rotations
        .iter()
        .flat_map(|r| r.members.iter())
        .map(|m| m.trim().to_ascii_lowercase())
        .collect();
    people.extend(
        schedule
            .overrides
            .iter()
            .map(|o| o.user_email.trim().to_ascii_lowercase()),
    );
    windows
        .into_iter()
        .filter(|u| people.contains(&u.user_email.trim().to_ascii_lowercase()))
        .collect()
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
            let updated = to_schedule(model.update(client).await?);
            invalidate_and_publish(org_id, team_id).await;
            Ok(updated)
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
            let created = to_schedule(model.insert(client).await?);
            invalidate_and_publish(org_id, team_id).await;
            Ok(created)
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
        Some(s) => Some(with_resolution_inputs(s, now_micros()).await),
        None => None,
    })
}

/// The team's schedule, served from [`SCHEDULE_CACHE`] when fresh.
///
/// For the paging path only. A team with no schedule is deliberately not
/// cached: "nobody is on call here" is the single most consequential answer
/// this table gives, and it should keep asking the database until a schedule
/// exists.
pub async fn get_by_team_cached(
    org_id: &str,
    team_id: &str,
) -> Result<Option<Schedule>, errors::Error> {
    let key = schedule_cache_key(org_id, team_id);
    if let Some(entry) = SCHEDULE_CACHE.get(&key)
        && entry.1.elapsed() < SCHEDULE_CACHE_TTL
    {
        return Ok(Some(entry.0.clone()));
    }
    let found = get_by_team(org_id, team_id).await?;
    if let Some(schedule) = &found {
        SCHEDULE_CACHE.insert(key, (schedule.clone(), Instant::now()));
    }
    Ok(found)
}

/// Every schedule in the org, covers included.
///
/// One override query per schedule rather than one for the org: the callers
/// are the coverage-gap sweep and the team list, both of which run per org on
/// a background cadence, and the indexed per-team read is what the paging path
/// already uses. Sharing one query shape is worth more here than saving a
/// round trip on a screen nobody is paged by. Absences are org-scoped and read
/// the same way for the same reason.
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
        out.push(with_resolution_inputs(to_schedule(row), now).await);
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
    invalidate_and_publish(org_id, team_id).await;
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
