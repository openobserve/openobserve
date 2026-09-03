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

//! Unavailability — "I am away 20 Aug – 3 Sep".
//!
//! **Org-scoped, not team-scoped.** Being away is a fact about a person; one
//! who is on two teams is away from both. A per-team row would mean writing the
//! same window twice, and forgetting the second one is the failure the whole
//! feature exists to prevent.
//!
//! Reads are blunt, like the overrides beside them: one indexed query for the
//! org's live windows, narrowed to a schedule's members in memory. A rotation
//! has single digits of people on it, and asking the database to do the
//! intersection would cost a round trip per team on the paging path.

use config::{ider, meta::oncall::Unavailability, utils::time::now_micros};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
};

use super::entity::oncall_unavailability;
use crate::{db::get_orm_client_rw, errors};

/// How far back a resolution load reaches.
///
/// The schedule loader cannot know which instant it will be asked about, so it
/// takes everything that has not long finished. Seven days back covers a
/// timeline being read the morning after a page while keeping the row count
/// bounded — the same rule the covers follow, stated the same way so the two
/// cannot drift apart.
const RESOLUTION_LOOKBACK_MICROS: i64 = 7 * 24 * 60 * 60 * 1_000_000;

/// Ceiling on the rows any one read returns.
///
/// An org where a thousand absences are live at once has scripted a loop.
/// Losing the oldest of them beats an unbounded read on the path a page
/// travels — and the loss is safe in one direction only, which is why the
/// resolution read is ordered so that the windows most likely to be in force
/// survive the truncation.
const MAX_ROWS: u64 = 1_000;

fn to_window(m: oncall_unavailability::Model) -> Unavailability {
    Unavailability {
        id: m.id,
        org_id: m.org_id,
        user_email: m.user_email,
        start_at: m.start_at,
        end_at: m.end_at,
        reason: m.reason,
        created_by: m.created_by,
        created_at: m.created_at,
    }
}

/// Records one absence. `id` and `created_at` are minted here for the same
/// reason they are for a cover: they are the record of what happened, not a
/// claim a client gets to make.
pub async fn create(
    org_id: &str,
    user_email: &str,
    start_at: i64,
    end_at: i64,
    reason: Option<String>,
    created_by: &str,
) -> Result<Unavailability, errors::Error> {
    let client = get_orm_client_rw().await;
    let record = Unavailability {
        id: ider::uuid(),
        org_id: org_id.to_string(),
        user_email: user_email.to_string(),
        start_at,
        end_at,
        reason,
        created_by: created_by.to_string(),
        created_at: now_micros(),
    };
    oncall_unavailability::ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        user_email: Set(record.user_email.clone()),
        start_at: Set(record.start_at),
        end_at: Set(record.end_at),
        reason: Set(record.reason.clone()),
        created_by: Set(record.created_by.clone()),
        created_at: Set(record.created_at),
    }
    .insert(client)
    .await?;
    // An absence is stored here but *read* as part of a schedule, so the cache
    // that has to be dropped is every schedule's. Missing this is what makes
    // the feature worse than useless: somebody marks themselves away, believes
    // it, stops watching — and the stale schedule pages them anyway.
    super::oncall_schedules::invalidate_org_and_publish(org_id).await;
    Ok(record)
}

pub async fn get(org_id: &str, id: &str) -> Result<Option<Unavailability>, errors::Error> {
    let client = get_orm_client_rw().await;
    Ok(oncall_unavailability::Entity::find_by_id(id)
        .filter(oncall_unavailability::Column::OrgId.eq(org_id))
        .one(client)
        .await?
        .map(to_window))
}

/// One person's absences, soonest first.
pub async fn list_by_user(
    org_id: &str,
    user_email: &str,
) -> Result<Vec<Unavailability>, errors::Error> {
    let client = get_orm_client_rw().await;
    Ok(oncall_unavailability::Entity::find()
        .filter(oncall_unavailability::Column::OrgId.eq(org_id))
        .filter(oncall_unavailability::Column::UserEmail.eq(user_email))
        .order_by_asc(oncall_unavailability::Column::StartAt)
        .order_by_asc(oncall_unavailability::Column::Id)
        .limit(MAX_ROWS)
        .all(client)
        .await?
        .into_iter()
        .map(to_window)
        .collect())
}

/// Absences overlapping `[from, to)`, for the whole org or for one person.
///
/// Half-open on both sides, matching [`Unavailability::covers`]: a window
/// ending exactly at `from` does not touch the interval, and one starting
/// exactly at `to` does not either.
pub async fn list_in_window(
    org_id: &str,
    user_email: Option<&str>,
    from: i64,
    to: i64,
) -> Result<Vec<Unavailability>, errors::Error> {
    let client = get_orm_client_rw().await;
    let mut query = oncall_unavailability::Entity::find()
        .filter(oncall_unavailability::Column::OrgId.eq(org_id))
        .filter(oncall_unavailability::Column::StartAt.lt(to))
        .filter(oncall_unavailability::Column::EndAt.gt(from));
    if let Some(email) = user_email {
        query = query.filter(oncall_unavailability::Column::UserEmail.eq(email));
    }
    Ok(query
        .order_by_asc(oncall_unavailability::Column::StartAt)
        .order_by_asc(oncall_unavailability::Column::Id)
        .limit(MAX_ROWS)
        .all(client)
        .await?
        .into_iter()
        .map(to_window)
        .collect())
}

/// What the schedule loader attaches so that every resolution sees the
/// absences.
///
/// Bounded rather than "everything", for the same reason the cover read is: an
/// absence table is append-mostly and a read on the paging path must not grow
/// with the org's history. `at` is passed in rather than read from a clock, so
/// the same function serves a replay.
///
/// Ordered by `end_at` **descending** so that a truncated read keeps the
/// windows reaching furthest forward — the ones most likely still to be in
/// force. Truncation can then cost a skip that should have happened, never a
/// skip that should not have.
pub async fn list_for_resolution(
    org_id: &str,
    at: i64,
) -> Result<Vec<Unavailability>, errors::Error> {
    let client = get_orm_client_rw().await;
    Ok(oncall_unavailability::Entity::find()
        .filter(oncall_unavailability::Column::OrgId.eq(org_id))
        .filter(oncall_unavailability::Column::EndAt.gt(at - RESOLUTION_LOOKBACK_MICROS))
        .order_by_desc(oncall_unavailability::Column::EndAt)
        .order_by_asc(oncall_unavailability::Column::Id)
        .limit(MAX_ROWS)
        .all(client)
        .await?
        .into_iter()
        .map(to_window)
        .collect())
}

pub async fn delete(org_id: &str, id: &str) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    let deleted = oncall_unavailability::Entity::delete_many()
        .filter(oncall_unavailability::Column::OrgId.eq(org_id))
        .filter(oncall_unavailability::Column::Id.eq(id))
        .exec(client)
        .await?
        .rows_affected;
    if deleted > 0 {
        super::oncall_schedules::invalidate_org_and_publish(org_id).await;
    }
    Ok(deleted > 0)
}

/// Drops one person's absences. Called when they leave the org, so their
/// windows do not outlive them as rows quietly excusing a name nothing pages.
pub async fn delete_by_user(org_id: &str, user_email: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    let dropped = oncall_unavailability::Entity::delete_many()
        .filter(oncall_unavailability::Column::OrgId.eq(org_id))
        .filter(oncall_unavailability::Column::UserEmail.eq(user_email))
        .exec(client)
        .await?
        .rows_affected;
    super::oncall_schedules::invalidate_org_and_publish(org_id).await;
    Ok(dropped)
}

#[cfg(test)]
mod tests {
    use config::meta::oncall::is_unavailable;

    use super::*;

    fn model(id: &str, user: &str, start: i64, end: i64) -> oncall_unavailability::Model {
        oncall_unavailability::Model {
            id: id.into(),
            org_id: "default".into(),
            user_email: user.into(),
            start_at: start,
            end_at: end,
            reason: Some("annual leave".into()),
            created_by: user.into(),
            created_at: 1,
        }
    }

    #[test]
    fn test_a_row_round_trips_into_the_meta_type() {
        let u = to_window(model("un_1", "ana@o2.ai", 100, 200));
        assert_eq!(u.id, "un_1");
        assert_eq!(u.user_email, "ana@o2.ai");
        assert_eq!(u.reason.as_deref(), Some("annual leave"));
        assert!(u.covers(150));
        assert!(!u.covers(200), "the end is exclusive");
    }

    /// A reason is genuinely optional: "away" is the whole statement, and
    /// demanding a justification for time off would be a strange product.
    #[test]
    fn test_the_reason_stays_optional() {
        let mut m = model("un_1", "ana@o2.ai", 0, 10);
        m.reason = None;
        assert!(to_window(m).reason.is_none());
    }

    /// The window filter and `overlaps` have to agree, or the list endpoint
    /// and the resolver disagree about which absences exist.
    #[test]
    fn test_the_window_filter_matches_the_overlap_predicate() {
        let u = to_window(model("un_1", "ana@o2.ai", 100, 200));
        // `start_at < to AND end_at > from`, which is what `list_in_window`
        // asks the database for.
        assert!(u.overlaps(150, 250), "straddles the end");
        assert!(u.overlaps(50, 150), "straddles the start");
        assert!(u.overlaps(0, 500), "enclosed");
        assert!(!u.overlaps(200, 300), "starts where the absence ends");
        assert!(!u.overlaps(0, 100), "ends where the absence starts");
    }

    /// The resolver picks the answer in memory, so the row order must not be
    /// what decides it — the table promises none.
    #[test]
    fn test_the_answer_does_not_depend_on_the_row_order() {
        let rows = vec![
            to_window(model("un_a", "ana@o2.ai", 0, 1000)),
            to_window(model("un_b", "bob@o2.ai", 0, 1000)),
        ];
        let reversed: Vec<_> = rows.iter().rev().cloned().collect();
        for order in [&rows, &reversed] {
            assert!(is_unavailable(order, "ana@o2.ai", 500));
            assert!(is_unavailable(order, "bob@o2.ai", 500));
            assert!(!is_unavailable(order, "cara@o2.ai", 500));
        }
    }
}
