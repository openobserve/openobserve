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

use std::{
    sync::LazyLock,
    time::{Duration, Instant},
};

use config::{
    RwHashMap, ider,
    meta::oncall::{EscalationPolicy, PriorityRung},
    utils::time::now_micros,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};

use super::entity::oncall_policies;
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

/// The team's escalation policy, for the paging path (`06` §3).
///
/// Read on every tick of every open record — the rungs, the channels, the L0
/// block and the repeat settings all come off this one row, and a P1 climbing
/// its ladder reads it once a rung. It changes when somebody edits a form.
///
/// `06` §6 budgets five minutes of staleness here, with the consequence stated
/// as "previous wait times applied for one escalation". That is the mildest of
/// the four: a policy edit that lands a minute late delays or hurries one rung,
/// and cannot change *whether* anybody is paged, because an empty ladder is
/// never what a cached policy degrades to.
///
/// Backs [`get_or_create_cached`] only. The policy screen reads
/// [`get_or_create`].
static POLICY_CACHE: LazyLock<RwHashMap<String, (EscalationPolicy, Instant)>> =
    LazyLock::new(Default::default);

const POLICY_CACHE_TTL: Duration = Duration::from_secs(60);

fn policy_cache_key(org_id: &str, team_id: &str) -> String {
    format!("{org_id}/{team_id}")
}

/// Drops one team's policy. Called by the coordinator watcher and by the write
/// paths.
pub fn invalidate_cache(org_id: &str, team_id: &str) {
    POLICY_CACHE.remove(&policy_cache_key(org_id, team_id));
}

pub(super) async fn invalidate_and_publish(org_id: &str, team_id: &str) {
    invalidate_cache(org_id, team_id);
    if let Err(e) = crate::coordinator::oncall::emit_policy_changed(org_id, team_id).await {
        log::error!("[oncall] emit policy cache event failed for {org_id}/{team_id}: {e}");
    }
}

/// A policy whose rungs will not parse falls back to the shipped defaults
/// rather than to nothing.
///
/// This is the opposite choice from schedules, and deliberately so. An
/// unstaffed schedule pages nobody but is *visible* as a coverage gap; an
/// empty policy would also page nobody and look like a deliberate
/// configuration. Falling back to the defaults keeps the team pageable while
/// the corruption is logged.
fn to_policy(m: oncall_policies::Model) -> EscalationPolicy {
    // A bad destination list costs one transport, not the whole policy, so it
    // degrades to empty instead of taking the ladder down with it.
    let destinations: Vec<String> = serde_json::from_str(&m.destinations).unwrap_or_default();
    // §4's L0 block. An unreadable one falls back to the published defaults
    // rather than to nothing: L0 is additive, and a corrupt column must leave
    // the team exactly as pageable as it was.
    let l0 = match m.l0_json.trim() {
        // The column default, and every row written before it existed: a team
        // that has never opened the screen runs §4's published defaults.
        "" | "{}" => config::meta::oncall::L0Policy::defaults(),
        stored => serde_json::from_str(stored).unwrap_or_else(|e| {
            // Additive, so a corrupt block leaves the team exactly as pageable
            // as it was rather than taking the ladder down with it.
            log::warn!(
                "[ONCALL] policy {} has an unreadable l0 block, using the defaults: {e}",
                m.id
            );
            config::meta::oncall::L0Policy::defaults()
        }),
    };
    // 04 §3's two knobs. `final_action` fails to `Stop` rather than to a
    // handoff nobody nominated, and `repeat_count` is clamped by
    // `EscalationPolicy::passes` on the way out — a column can hold anything a
    // hand-edit or a replicated row put in it.
    let final_action = config::meta::oncall::FinalAction::from_str_or_stop(&m.final_action);
    let repeat_count = m.repeat_count;
    match serde_json::from_str::<Vec<PriorityRung>>(&m.rungs) {
        Ok(rungs) => EscalationPolicy {
            id: m.id,
            org_id: m.org_id,
            team_id: m.team_id,
            rungs,
            destinations,
            l0,
            repeat_count,
            final_action,
        },
        Err(e) => {
            log::error!(
                "[ONCALL] policy {} has unparseable rungs, falling back to defaults: {e}",
                m.id
            );
            // The rungs are what could not be read; how many times they run and
            // what happens afterwards were stored in their own columns and are
            // still perfectly legible.
            EscalationPolicy {
                repeat_count,
                final_action,
                ..EscalationPolicy::default_for_team(m.id, m.org_id, m.team_id)
            }
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

/// The team's policy, served from [`POLICY_CACHE`] when fresh.
///
/// For the paging path only. Still get-or-create on a miss, for the reason
/// [`get_or_create`] gives: a team must be pageable the moment it exists.
pub async fn get_or_create_cached(
    org_id: &str,
    team_id: &str,
) -> Result<EscalationPolicy, errors::Error> {
    let key = policy_cache_key(org_id, team_id);
    if let Some(entry) = POLICY_CACHE.get(&key)
        && entry.1.elapsed() < POLICY_CACHE_TTL
    {
        return Ok(entry.0.clone());
    }
    let policy = get_or_create(org_id, team_id).await?;
    POLICY_CACHE.insert(key, (policy.clone(), Instant::now()));
    Ok(policy)
}

async fn insert(policy: &EscalationPolicy) -> Result<EscalationPolicy, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = now_micros();
    let model = oncall_policies::ActiveModel {
        id: Set(policy.id.clone()),
        org_id: Set(policy.org_id.clone()),
        team_id: Set(policy.team_id.clone()),
        rungs: Set(serde_json::to_string(&policy.rungs)?),
        destinations: Set(serde_json::to_string(&policy.destinations)?),
        l0_json: Set(serde_json::to_string(&policy.l0)?),
        repeat_count: Set(policy.repeat_count),
        final_action: Set(policy.final_action.as_str().to_string()),
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
    destinations: Option<&[String]>,
    // §4's L0 block. `None` means **unchanged**, never reset-to-defaults: a
    // caller editing rungs must not silently wipe a team's L0 configuration,
    // and this column is the only copy of it.
    l0: Option<&config::meta::oncall::L0Policy>,
    // §3's repeat/final-action pair. `None` means **unchanged** for the same
    // reason `l0` does: a caller editing rungs is saying nothing about what
    // happens when the ladder runs out.
    repeats: Option<(i32, config::meta::oncall::FinalAction)>,
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
    if let Some(d) = destinations {
        model.destinations = Set(serde_json::to_string(d)?);
    }
    if let Some(l0) = l0 {
        model.l0_json = Set(serde_json::to_string(l0)?);
    }
    if let Some((repeat_count, final_action)) = repeats {
        model.repeat_count = Set(repeat_count);
        model.final_action = Set(final_action.as_str().to_string());
    }
    model.updated_at = Set(now_micros());
    let updated = to_policy(model.update(client).await?);
    invalidate_and_publish(org_id, team_id).await;
    Ok(Some(updated))
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
    invalidate_and_publish(org_id, team_id).await;
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
            destinations: "[]".into(),
            // The column default: a team that has never opened the L0 screen.
            l0_json: "{}".into(),
            // The column defaults, which are 04 §3's own: one pass, then say
            // on the record that nobody answered.
            repeat_count: config::meta::oncall::DEFAULT_REPEAT_COUNT,
            final_action: config::meta::oncall::FinalAction::Stop.as_str().into(),
            created_at: 10,
            updated_at: 20,
        }
    }

    /// The upgrade contract, at the layer that reads the row: a policy whose
    /// repeat columns hold their defaults must come back as the ladder the
    /// engine has always run.
    #[test]
    fn test_the_default_columns_read_back_as_todays_ladder() {
        let defaults = EscalationPolicy::default_for_team("pol_1", "default", "team_1");
        let encoded = serde_json::to_string(&defaults.rungs).unwrap();
        let p = to_policy(model(&encoded));
        assert_eq!(p.repeat_count, config::meta::oncall::DEFAULT_REPEAT_COUNT);
        assert_eq!(p.final_action, config::meta::oncall::FinalAction::Stop);
    }

    /// Unparseable rungs fall back to the shipped ladder, but how many times
    /// it runs and what happens afterwards were stored in their own columns
    /// and are still perfectly legible — losing them would quietly undo a
    /// team's configuration on top of the corruption.
    #[test]
    fn test_corrupt_rungs_do_not_take_the_repeat_configuration_with_them() {
        let mut m = model("{not json");
        m.repeat_count = 3;
        m.final_action = config::meta::oncall::FinalAction::NotifyDefaultTeam
            .as_str()
            .into();
        let p = to_policy(m);
        assert_eq!(p.repeat_count, 3);
        assert_eq!(
            p.final_action,
            config::meta::oncall::FinalAction::NotifyDefaultTeam
        );
    }

    /// An unreadable `final_action` must not invent a handoff to a team
    /// nobody nominated.
    #[test]
    fn test_an_unreadable_final_action_stops_rather_than_handing_off() {
        let mut m = model("[]");
        m.final_action = "notify_the_ceo".into();
        assert_eq!(
            to_policy(m).final_action,
            config::meta::oncall::FinalAction::Stop
        );
    }

    #[test]
    fn test_rungs_round_trip_through_the_json_column() {
        let defaults = EscalationPolicy::default_for_team("pol_1", "default", "team_1");
        let encoded = serde_json::to_string(&defaults.rungs).unwrap();
        let p = to_policy(model(&encoded));
        assert_eq!(p, defaults);
    }

    /// §4's L0 block is a stored column, so a team that edits its triage
    /// budget has to get that budget back. A column that is written and never
    /// read is a knob that does nothing, and the team who set it has no way to
    /// tell.
    #[test]
    fn test_the_l0_block_round_trips_through_its_own_column() {
        let defaults = EscalationPolicy::default_for_team("pol_1", "default", "team_1");
        let encoded = serde_json::to_string(&defaults.rungs).unwrap();

        let mut stored = model(&encoded);
        let mut edited = config::meta::oncall::L0Policy::defaults();
        edited.triage_budget_seconds = 45;
        edited.allow_suppress = true;
        stored.l0_json = serde_json::to_string(&edited).unwrap();
        assert_eq!(to_policy(stored).l0, edited);

        // The column default, and every row written before the column existed:
        // §4's published defaults, so an upgraded team is gated exactly as a
        // fresh one is.
        for never_configured in ["{}", ""] {
            let mut stored = model(&encoded);
            stored.l0_json = never_configured.into();
            assert_eq!(
                to_policy(stored).l0,
                config::meta::oncall::L0Policy::defaults(),
                "{never_configured:?}"
            );
        }
        // And a corrupt one leaves the team exactly as pageable as it was.
        let mut stored = model(&encoded);
        stored.l0_json = "{\"mode\":".into();
        assert_eq!(
            to_policy(stored).l0,
            config::meta::oncall::L0Policy::defaults()
        );
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
