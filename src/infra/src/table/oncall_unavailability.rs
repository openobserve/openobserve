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

//! Unavailability — org-scoped: being away is a fact about a person, not about one team.

use config::{ider, meta::oncall::Unavailability, utils::time::now_micros};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
};

use super::entity::oncall_unavailability;
use crate::{db::get_orm_client_rw, errors};

/// How far back a resolution load reaches.
///
/// The schedule loader cannot know which instant it will be asked about, so it
/// takes everything that has not long finished. The same rule the covers follow,
/// stated the same way so the two cannot drift apart.
const RESOLUTION_LOOKBACK_MICROS: i64 = 7 * 24 * 60 * 60 * 1_000_000;

/// Ceiling on the rows any one read returns.
///
/// The resolution read is ordered so a truncation drops far-future windows, not
/// ones in force now.
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
    // An absence is stored here but read with a schedule, so every schedule's cache is dropped.
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
/// Half-open on both sides, matching [`Unavailability::covers`]: a window ending
/// exactly at `from` does not touch the interval, and one starting exactly at
/// `to` does not either.
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

/// What the schedule loader attaches so every resolution sees the absences.
///
/// Bounded rather than "everything", like the cover read: an absence table is
/// append-mostly and a read on the paging path must not grow with the org's
/// history.
///
/// Windows not yet ended come first, earliest start first, so a truncated read
/// drops far-future and long-ended windows and keeps the ones in force now.
pub async fn list_for_resolution(
    org_id: &str,
    at: i64,
) -> Result<Vec<Unavailability>, errors::Error> {
    list_for_resolution_in(get_orm_client_rw().await, org_id, at).await
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

async fn list_for_resolution_in<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    at: i64,
) -> Result<Vec<Unavailability>, errors::Error> {
    let mut rows = oncall_unavailability::Entity::find()
        .filter(oncall_unavailability::Column::OrgId.eq(org_id))
        .filter(oncall_unavailability::Column::EndAt.gt(at))
        .order_by_asc(oncall_unavailability::Column::StartAt)
        .order_by_asc(oncall_unavailability::Column::Id)
        .limit(MAX_ROWS)
        .all(db)
        .await?;
    let room = MAX_ROWS.saturating_sub(rows.len() as u64);
    if room > 0 {
        rows.extend(
            oncall_unavailability::Entity::find()
                .filter(oncall_unavailability::Column::OrgId.eq(org_id))
                .filter(oncall_unavailability::Column::EndAt.gt(at - RESOLUTION_LOOKBACK_MICROS))
                .filter(oncall_unavailability::Column::EndAt.lte(at))
                .order_by_desc(oncall_unavailability::Column::EndAt)
                .order_by_desc(oncall_unavailability::Column::Id)
                .limit(room)
                .all(db)
                .await?,
        );
    }
    Ok(rows.into_iter().map(to_window).collect())
}

#[cfg(test)]
mod tests {
    use config::meta::oncall::is_unavailable;
    use sea_orm::{ConnectOptions, Database, Schema};

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
        // `start_at < to AND end_at > from`, which is what `list_in_window` asks the database for.
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

    /// Past the cap, far-future or recently ended leave never pushes out an absence in force now.
    #[tokio::test]
    async fn test_truncation_keeps_the_absence_in_force_now() {
        let now = 1_000_000_000_000;
        for (start_offset, end_offset) in [(100, 200), (-2_000_000, -1_000_000)] {
            let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
            opts.max_connections(1);
            let db = Database::connect(opts).await.unwrap();
            let backend = db.get_database_backend();
            let table =
                Schema::new(backend).create_table_from_entity(oncall_unavailability::Entity);
            db.execute(backend.build(&table)).await.unwrap();
            let mut rows = vec![model("un_now", "ana@o2.ai", now - 10, now + 10)];
            rows.extend((0..MAX_ROWS as i64).map(|i| {
                let (start, end) = (now + start_offset + i, now + end_offset + i);
                model(&format!("un_{i}"), "bob@o2.ai", start, end)
            }));
            for row in rows {
                oncall_unavailability::ActiveModel::from(row)
                    .insert(&db)
                    .await
                    .unwrap();
            }
            let kept = list_for_resolution_in(&db, "default", now).await.unwrap();
            assert_eq!(kept.len(), MAX_ROWS as usize);
            assert!(is_unavailable(&kept, "ana@o2.ai", now));
        }
    }
}
