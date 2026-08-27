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

use std::{
    sync::LazyLock,
    time::{Duration, Instant},
};

use config::{
    RwHashMap, ider,
    meta::oncall::{Team, TeamMember},
    utils::time::now_micros,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    TransactionTrait,
};

use super::entity::{oncall_team_members, oncall_teams};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

/// The team row, for the paging path (`06` §3).
///
/// Read once per dispatch, only for the team's display name — the sentence a
/// page opens with. Nothing about paging depends on it being current to the
/// second, and a rename that takes a few seconds to reach a page is not a
/// failure anybody can be hurt by.
///
/// Backs [`get_cached`] only, never [`get`]: the screens that edit a team read
/// through `get`, so an admin never sees what they just replaced.
static TEAM_CACHE: LazyLock<RwHashMap<String, (Team, Instant)>> = LazyLock::new(Default::default);

/// The roster, for the paging path.
///
/// Read whenever a rung names the whole team, which the shipped policy does for
/// every rung past the third. `06` §6 budgets five minutes of staleness on
/// membership because the consequence is bounded and one-directional: a member
/// removed moments ago may receive one more page. Nothing here can *suppress* a
/// page, which is the line §6 draws.
static MEMBERS_CACHE: LazyLock<RwHashMap<String, (Vec<TeamMember>, Instant)>> =
    LazyLock::new(Default::default);

/// Deliberately shorter than `06` §6's five-minute budget.
///
/// The budget is what the design tolerates; this is what the feature actually
/// needs. A page is a handful of reads either way, and the coordinator event is
/// the real invalidation — the TTL exists only for the event that never
/// arrived, so buying back four minutes of worst-case staleness costs almost
/// nothing.
const TEAM_CACHE_TTL: Duration = Duration::from_secs(60);

fn team_cache_key(org_id: &str, id: &str) -> String {
    format!("{org_id}/{id}")
}

/// Drops one team from the definition cache.
pub fn invalidate_cache(org_id: &str, id: &str) {
    TEAM_CACHE.remove(&team_cache_key(org_id, id));
}

/// Drops one team's roster.
pub fn invalidate_members_cache(team_id: &str) {
    MEMBERS_CACHE.remove(team_id);
}

/// Invalidates locally **and** tells every other node to do the same.
///
/// Write paths call this; the coordinator watcher calls the plain
/// [`invalidate_cache`], which is what stops an event echoing forever. A failed
/// emit is logged rather than propagated: the row is already committed, and
/// failing somebody's save because a cache hint did not send would be the worse
/// trade.
pub(super) async fn invalidate_and_publish_team(org_id: &str, id: &str) {
    invalidate_cache(org_id, id);
    if let Err(e) = crate::coordinator::oncall::emit_team_changed(org_id, id).await {
        log::error!("[oncall] emit team cache event failed for {org_id}/{id}: {e}");
    }
}

pub(super) async fn invalidate_and_publish_members(team_id: &str) {
    invalidate_members_cache(team_id);
    if let Err(e) = crate::coordinator::oncall::emit_members_changed(team_id).await {
        log::error!("[oncall] emit roster cache event failed for {team_id}: {e}");
    }
}

fn to_team(m: oncall_teams::Model) -> Team {
    Team {
        id: m.id,
        org_id: m.org_id,
        name: m.name,
        timezone: m.timezone,
        description: m.description,
        // Carried on the struct now, so a whole-row super-cluster snapshot
        // replicates the team's room instead of having to preserve a column it
        // could not see.
        channel_destinations: to_channel(m.channel_destinations),
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

/// The team's own channel, as stored.
///
/// `None` — never set, so the escalation policy's list stands (which is what
/// every team created before the field existed has). `Some(list)` — the team's
/// answer, and an empty list is a real answer meaning "no channel". The
/// precedence itself is [`config::meta::oncall::policy::team_channel`]; this
/// only reads the column.
///
/// Unparseable JSON reads as "never set" rather than failing the caller: the
/// caller is usually about to post a page's context into a room, and losing
/// that to a bad column is worse than falling back to the policy.
fn to_channel(raw: Option<String>) -> Option<Vec<String>> {
    let raw = raw?;
    match serde_json::from_str::<Vec<String>>(&raw) {
        Ok(list) => Some(list),
        Err(e) => {
            log::error!("[oncall] team channel_destinations is not a JSON array ({e}); ignoring it");
            None
        }
    }
}

fn to_member(m: oncall_team_members::Model) -> TeamMember {
    TeamMember {
        id: m.id,
        team_id: m.team_id,
        user_email: m.user_email,
    }
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
        // Not `[]`: a new team has not decided anything about its channel, and
        // storing an empty list here would mean "no channel" and silently
        // ignore the policy destinations the team is about to inherit.
        channel_destinations: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    };
    Ok(to_team(model.insert(client).await?))
}

/// The destination names this team is talked to on, or `None` if it has never
/// set any.
///
/// Not folded into [`Team`]: the team row is read on the paging path for its
/// display name and cached for that, and the channel is a delivery setting with
/// a different write path and a different audience. Keeping them apart is what
/// lets the channel be edited without invalidating the page path's cache.
pub async fn get_channel(org_id: &str, id: &str) -> Result<Option<Vec<String>>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_teams::Entity::find_by_id(id)
        .filter(oncall_teams::Column::OrgId.eq(org_id))
        .one(client)
        .await?
        .and_then(|m| to_channel(m.channel_destinations)))
}

/// Sets — or clears — the team's channel.
///
/// `None` puts the team back to "never set", so the escalation policy's list
/// takes over again; `Some(vec![])` says the team has no channel at all. Both
/// are reachable deliberately, because a field that cannot be un-set is one
/// nobody can undo a mistake in.
///
/// Returns `false` when there is no such team in this org — the caller already
/// knows what it asked to store, so nothing is read back.
pub async fn set_channel(
    org_id: &str,
    id: &str,
    destinations: Option<Vec<String>>,
) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some(existing) = oncall_teams::Entity::find_by_id(id)
        .filter(oncall_teams::Column::OrgId.eq(org_id))
        .one(client)
        .await?
    else {
        return Ok(false);
    };
    let stored = destinations
        .as_ref()
        .map(|d| serde_json::to_string(d).unwrap_or_else(|_| "[]".to_string()));
    let mut model: oncall_teams::ActiveModel = existing.into();
    model.channel_destinations = Set(stored);
    model.updated_at = Set(now_micros());
    model.update(client).await?;
    invalidate_and_publish_team(org_id, id).await;
    Ok(true)
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
    let updated = to_team(model.update(client).await?);
    invalidate_and_publish_team(org_id, id).await;
    Ok(Some(updated))
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
    invalidate_and_publish_team(org_id, id).await;
    invalidate_and_publish_members(id).await;
    Ok(true)
}

pub async fn add_member(team_id: &str, user_email: &str) -> Result<TeamMember, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = oncall_team_members::ActiveModel {
        id: Set(ider::uuid()),
        team_id: Set(team_id.to_string()),
        user_email: Set(user_email.to_string()),
        created_at: Set(now_micros()),
    };
    let member = to_member(model.insert(client).await?);
    invalidate_and_publish_members(team_id).await;
    Ok(member)
}

/// Members in the order they were added, which is the order the client sent.
///
/// This list seeds a new team's rotation roster, so its order decides who holds
/// Primary first and who follows. Sorting it by email made that decision
/// alphabetically: a team added as `[subhradeep, bhargav, …]` came back
/// `[bhargav, subhradeep, …]`, so the form's preview of the handover and the
/// handover the team actually got disagreed — and nothing on either screen
/// explained why. Lexical order of an address is not a statement about who
/// should be woken first; the order somebody typed is.
///
/// Ordered on `created_at` rather than `id`: `ider::uuid()` is a KSUID, whose
/// timestamp prefix has one-second resolution, so a bulk add lands several rows
/// in one second and their relative id order is random. `created_at` is
/// microseconds and the inserts are sequential. `id` breaks the tie so the
/// answer is stable across nodes rather than left to the database.
///
/// This is the roster's *seed* only. Once a schedule exists, the order lives in
/// `shift_rules[].members` and is already whatever the client last wrote — so
/// re-ordering an existing rotation does not go through here.
pub async fn list_members(team_id: &str) -> Result<Vec<TeamMember>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_team_members::Entity::find()
        .filter(oncall_team_members::Column::TeamId.eq(team_id))
        .order_by_asc(oncall_team_members::Column::CreatedAt)
        .order_by_asc(oncall_team_members::Column::Id)
        .all(client)
        .await?
        .into_iter()
        .map(to_member)
        .collect())
}

/// The team, served from [`TEAM_CACHE`] when fresh.
///
/// For the paging path only. A team that does not exist is deliberately not
/// cached: a page whose team was deleted should keep reaching the database and
/// keep saying so, rather than being answered from memory.
pub async fn get_cached(org_id: &str, id: &str) -> Result<Option<Team>, errors::Error> {
    let key = team_cache_key(org_id, id);
    if let Some(entry) = TEAM_CACHE.get(&key)
        && entry.1.elapsed() < TEAM_CACHE_TTL
    {
        return Ok(Some(entry.0.clone()));
    }
    let found = get(org_id, id).await?;
    if let Some(team) = &found {
        TEAM_CACHE.insert(key, (team.clone(), Instant::now()));
    }
    Ok(found)
}

/// The roster, served from [`MEMBERS_CACHE`] when fresh.
///
/// For the paging path only — the rungs that page the whole team. An empty
/// roster **is** cached, unlike a missing team: "this team has nobody on it" is
/// a real, stable answer, and it is the one a coverage gap is made of.
pub async fn list_members_cached(team_id: &str) -> Result<Vec<TeamMember>, errors::Error> {
    if let Some(entry) = MEMBERS_CACHE.get(team_id)
        && entry.1.elapsed() < TEAM_CACHE_TTL
    {
        return Ok(entry.0.clone());
    }
    let members = list_members(team_id).await?;
    MEMBERS_CACHE.insert(team_id.to_string(), (members.clone(), Instant::now()));
    Ok(members)
}

/// The teams one person belongs to, in this org.
///
/// The reverse of `list_members`, and the only way to answer "which teams am I
/// on" without fetching every team and every roster. The membership row has no
/// org of its own — it is keyed on the team — so the org is established by
/// joining back to the team, and without that join a member of a team in
/// another tenant would be reported here.
pub async fn list_for_user(org_id: &str, user_email: &str) -> Result<Vec<Team>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(oncall_teams::Entity::find()
        .filter(oncall_teams::Column::OrgId.eq(org_id))
        .join(
            sea_orm::JoinType::InnerJoin,
            oncall_teams::Entity::belongs_to(oncall_team_members::Entity)
                .from(oncall_teams::Column::Id)
                .to(oncall_team_members::Column::TeamId)
                .into(),
        )
        .filter(oncall_team_members::Column::UserEmail.eq(user_email))
        .order_by_asc(oncall_teams::Column::Name)
        .all(client)
        .await?
        .into_iter()
        .map(to_team)
        .collect())
}

/// How many alert rules name this team in their own `oncall_team` field.
///
/// Counted in SQL, and deliberately narrow: this is the *directly assigned*
/// half of "what does this team own". The other half — alerts whose identity
/// path falls under one of the team's ownership rules — cannot be counted here
/// at all, because an alert's dimensions are not known until it fires. The
/// field name says which half this is so a screen cannot present it as the
/// whole answer.
pub async fn count_alerts_assigned(org_id: &str, team_id: &str) -> Result<u64, errors::Error> {
    use sea_orm::PaginatorTrait;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(super::entity::alerts::Entity::find()
        .filter(super::entity::alerts::Column::Org.eq(org_id))
        .filter(super::entity::alerts::Column::OncallTeam.eq(team_id))
        .count(client)
        .await?)
}

#[derive(Debug, sea_orm::FromQueryResult)]
struct PriorityTally {
    priority: Option<i32>,
    count: i64,
}

/// The same count, broken down by the priority the alert fires at.
///
/// What makes "P4 pages nobody" actionable: on its own it is a policy someone
/// may have chosen, and "…and six alert rules fire at P4" is the sentence that
/// turns it into a finding. Grouped in SQL, one statement for all five
/// priorities. Alerts with no priority set are left out — they have no rung to
/// be missing.
pub async fn count_alerts_assigned_by_priority(
    org_id: &str,
    team_id: &str,
) -> Result<std::collections::HashMap<i32, i64>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Ok(super::entity::alerts::Entity::find()
        .filter(super::entity::alerts::Column::Org.eq(org_id))
        .filter(super::entity::alerts::Column::OncallTeam.eq(team_id))
        .filter(super::entity::alerts::Column::Priority.is_not_null())
        .select_only()
        .column_as(super::entity::alerts::Column::Priority, "priority")
        .column_as(super::entity::alerts::Column::Id.count(), "count")
        .group_by(super::entity::alerts::Column::Priority)
        .into_model::<PriorityTally>()
        .all(client)
        .await?
        .into_iter()
        .filter_map(|t| t.priority.map(|p| (p, t.count)))
        .collect())
}

pub async fn remove_member(team_id: &str, user_email: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let deleted = oncall_team_members::Entity::delete_many()
        .filter(oncall_team_members::Column::TeamId.eq(team_id))
        .filter(oncall_team_members::Column::UserEmail.eq(user_email))
        .exec(client)
        .await?
        .rows_affected;
    // Published whether or not a row went: a node that somehow still holds the
    // removed member is exactly the one that needs the message.
    invalidate_and_publish_members(team_id).await;
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
            channel_destinations: None,
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

    /// Membership is a flat fact: this person is on this team. Which rung
    /// they cover lives in the schedule's rotations.
    #[test]
    fn test_member_maps_without_a_level() {
        let m = oncall_team_members::Model {
            id: "mem_1".into(),
            team_id: "team_1".into(),
            user_email: "ana@o2.ai".into(),
            created_at: 0,
        };
        let member = to_member(m);
        assert_eq!(member.user_email, "ana@o2.ai");
        assert_eq!(member.team_id, "team_1");
    }

    /// The three states of the column, and they are three different answers.
    /// Collapsing null and `[]` is what would make the team channel impossible
    /// to turn off — clearing it would silently fall back to whatever the
    /// escalation policy still had in it.
    #[test]
    fn test_null_and_empty_are_different_answers_about_a_teams_channel() {
        assert_eq!(to_channel(None), None, "never set");
        assert_eq!(to_channel(Some("[]".into())), Some(vec![]), "no channel");
        assert_eq!(
            to_channel(Some(r#"["slack-platform","teams-sre"]"#.into())),
            Some(vec!["slack-platform".to_string(), "teams-sre".to_string()])
        );
    }

    /// A column somebody hand-edited into nonsense must not cost the room its
    /// context: it reads as "never set", so the policy's list still stands.
    #[test]
    fn test_an_unreadable_channel_column_falls_back_rather_than_failing() {
        assert_eq!(to_channel(Some("not json".into())), None);
        assert_eq!(to_channel(Some("{\"a\":1}".into())), None);
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
