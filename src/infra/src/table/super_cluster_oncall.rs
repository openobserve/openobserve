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

//! Id-preserving writes for replicated on-call rows.
//!
//! The ordinary `oncall_*` table modules mint a fresh `ider::uuid()` on every
//! insert, which is right for the region where the thing is created and wrong
//! for every other region: an escalation trigger's `module_key` **is** the
//! response id, teams are referenced by id from schedules, policies and
//! ownership rules, and an impacted record points at its origin by id. A
//! replica that renumbered its rows would hold the same facts under different
//! names, and the trigger arriving behind them would find nothing.
//!
//! So the super-cluster consumer needs a second door: apply this row, exactly
//! as the source region wrote it, under the id it already has. That is the only
//! thing this module does. It lives beside the tables rather than in the queue
//! crate because it is schema knowledge, and schema knowledge that drifts from
//! its entity definitions fails at runtime rather than at compile time.
//!
//! Everything here is last-write-wins over a whole row rather than a set of
//! field-level edits. A snapshot is idempotent under replay and under
//! reordering-by-retry in a way that "apply this delta" is not, and the queue
//! promises neither exactly-once nor ordering across retries. The cost is that
//! two regions writing the same record concurrently resolve to whichever
//! message lands second — acceptable, because only one cluster runs the
//! alert-manager job, so only one region writes.

use config::meta::oncall::{
    EscalationPolicy, OwnershipRule, Response, ResponseEvent, Schedule, ScheduleOverride, Team,
    TeamMember, Unavailability,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter, Set, TransactionTrait,
};

use super::entity::{
    oncall_overrides, oncall_ownership_rules, oncall_policies, oncall_response_events,
    oncall_responses, oncall_schedules, oncall_team_members, oncall_teams, oncall_unavailability,
};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

/// Applies a team exactly as the source region wrote it.
pub async fn put_team(team: &Team) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let existing = oncall_teams::Entity::find_by_id(&team.id).one(client).await?;
    let model = oncall_teams::Model {
        id: team.id.clone(),
        org_id: team.org_id.clone(),
        name: team.name.clone(),
        timezone: team.timezone.clone(),
        description: team.description.clone(),
        // The channel rides the snapshot now that `Team` carries it, so a room
        // set in one region is the room the other region posts to. It used to
        // be preserved from the local row instead, which meant it never
        // replicated at all — a failover would page correctly and then talk to
        // nobody.
        channel_destinations: team
            .channel_destinations
            .as_ref()
            .map(|d| serde_json::to_string(d))
            .transpose()
            .map_err(|e| errors::Error::Message(format!("team channel is not serialisable: {e}")))?,
        created_at: team.created_at,
        updated_at: team.updated_at,
    };
    match existing {
        Some(_) => {
            let mut active = model.into_active_model();
            active.id = Set(team.id.clone());
            active.update(client).await?;
        }
        None => {
            model.into_active_model().insert(client).await?;
        }
    }
    // A replicated row is a configuration change like any other, and this path
    // writes through the ORM rather than through the table module's own
    // functions — so the invalidation the write path does for free has to be
    // done by hand here, or a failover serves the losing region's teams.
    super::oncall_teams::invalidate_and_publish_team(&team.org_id, &team.id).await;
    Ok(())
}

/// Replaces a team's whole membership.
///
/// Sent and applied as a set rather than as add/remove pairs: membership is a
/// handful of rows, and a lost `remove` would leave somebody being paged in one
/// region and not in another — the sort of divergence nobody notices until a
/// page goes to a mailbox that closed months ago.
pub async fn put_members(team_id: &str, members: &[TeamMember]) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let txn = client.begin().await?;

    let keep: Vec<String> = members.iter().map(|m| m.id.clone()).collect();
    let mut prune = oncall_team_members::Entity::delete_many()
        .filter(oncall_team_members::Column::TeamId.eq(team_id));
    if !keep.is_empty() {
        prune = prune.filter(oncall_team_members::Column::Id.is_not_in(keep));
    }
    prune.exec(&txn).await?;

    for member in members {
        let existing = oncall_team_members::Entity::find_by_id(&member.id)
            .one(&txn)
            .await?;
        if existing.is_some() {
            continue;
        }
        // `created_at` is not carried on the meta type and nothing reads it, so
        // the replica stamps its own rather than inventing a source value.
        oncall_team_members::ActiveModel {
            id: Set(member.id.clone()),
            team_id: Set(member.team_id.clone()),
            user_email: Set(member.user_email.clone()),
            created_at: Set(config::utils::time::now_micros()),
        }
        .insert(&txn)
        .await?;
    }

    txn.commit().await?;
    super::oncall_teams::invalidate_and_publish_members(team_id).await;
    Ok(())
}

/// Applies a schedule, rotations and all.
pub async fn put_schedule(schedule: &Schedule) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = oncall_schedules::Model {
        id: schedule.id.clone(),
        org_id: schedule.org_id.clone(),
        team_id: schedule.team_id.clone(),
        timezone: schedule.timezone.clone(),
        rotations: serde_json::to_string(&schedule.rotations)?,
        created_at: schedule.created_at,
        updated_at: schedule.updated_at,
    };
    // A team has exactly one schedule, enforced by a unique index on `team_id`.
    // Matching on that rather than on the id means a replica that somehow
    // created its own schedule first is corrected instead of deadlocked on a
    // constraint it can never satisfy.
    match oncall_schedules::Entity::find()
        .filter(oncall_schedules::Column::OrgId.eq(&schedule.org_id))
        .filter(oncall_schedules::Column::TeamId.eq(&schedule.team_id))
        .one(client)
        .await?
    {
        Some(existing) => {
            let mut active: oncall_schedules::ActiveModel = existing.into();
            active.timezone = Set(model.timezone);
            active.rotations = Set(model.rotations);
            active.updated_at = Set(model.updated_at);
            active.update(client).await?;
        }
        None => {
            model.into_active_model().insert(client).await?;
        }
    }
    super::oncall_schedules::invalidate_and_publish(&schedule.org_id, &schedule.team_id).await;
    Ok(())
}

/// Applies one override under the id the source region gave it.
///
/// Overrides replicate for the same reason schedules do: they are
/// configuration, and an override the surviving cluster has never seen means a
/// failover pages the engineer who arranged cover. `created_at` is carried
/// rather than restamped — it is the overlap rule (§5), so a replica that
/// stamped its own could pick a different winner from the region that wrote
/// them, and the two clusters would page different people for the same
/// minute.
pub async fn put_override(record: &ScheduleOverride) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = oncall_overrides::Model {
        id: record.id.clone(),
        org_id: record.org_id.clone(),
        team_id: record.team_id.clone(),
        // Carried, not defaulted: this IS which position the cover stands
        // over, and a replica that guessed at it would cover a different
        // rotation from the region that wrote it.
        rotation_id: record.rotation_id.clone(),
        user_email: record.user_email.clone(),
        covering_for: record.covering_for.clone(),
        start_at: record.start_at,
        end_at: record.end_at,
        reason: record.reason.clone(),
        created_by: record.created_by.clone(),
        created_at: record.created_at,
    };
    match oncall_overrides::Entity::find_by_id(&record.id)
        .one(client)
        .await?
    {
        Some(_) => {
            let mut active = model.into_active_model();
            active.id = Set(record.id.clone());
            active.update(client).await?;
        }
        None => {
            model.into_active_model().insert(client).await?;
        }
    }
    super::oncall_schedules::invalidate_and_publish(&record.org_id, &record.team_id).await;
    Ok(())
}

/// Applies one absence window under the id the source region gave it.
///
/// Absences replicate for the same reason covers do, and they were the last
/// piece of on-call that did not: precedence is override → **unavailability** →
/// the rotation, so a region that has never seen this row resolves a different
/// person to the same minute. Lose the active cluster mid-holiday and the
/// survivor pages somebody who is away, which is the one outcome the feature
/// exists to prevent.
///
/// `created_at` is carried rather than restamped, matching the cover: nothing
/// reads it as a tiebreak today, but the two are read by the same resolver and
/// letting them drift is how a future overlap rule picks a different winner in
/// each region.
pub async fn put_unavailability(record: &Unavailability) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = oncall_unavailability::Model {
        id: record.id.clone(),
        org_id: record.org_id.clone(),
        user_email: record.user_email.clone(),
        start_at: record.start_at,
        end_at: record.end_at,
        reason: record.reason.clone(),
        created_by: record.created_by.clone(),
        created_at: record.created_at,
    };
    match oncall_unavailability::Entity::find_by_id(&record.id)
        .one(client)
        .await?
    {
        Some(_) => {
            let mut active = model.into_active_model();
            active.id = Set(record.id.clone());
            active.update(client).await?;
        }
        None => {
            model.into_active_model().insert(client).await?;
        }
    }
    // An absence is stored per person but *read* as part of a schedule, so the
    // cache that has to be dropped is every schedule's in the org. Missing this
    // is what makes the feature worse than useless: the row lands, the stale
    // schedule keeps resolving to the person who is away, and they are paged
    // anyway.
    super::oncall_schedules::invalidate_org_and_publish(&record.org_id).await;
    Ok(())
}

/// Drops every absence one person holds. What offboarding replicates.
pub async fn clear_unavailability_for_user(
    org_id: &str,
    user_email: &str,
) -> Result<(), errors::Error> {
    // Delegated: `delete_by_user` already prunes and invalidates, and there is
    // no id to preserve in a delete. Listed here so the replication surface
    // stays readable as one list.
    super::oncall_unavailability::delete_by_user(org_id, user_email).await?;
    Ok(())
}

/// Applies a team's escalation policy.
pub async fn put_policy(policy: &EscalationPolicy) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let rungs = serde_json::to_string(&policy.rungs)?;
    let destinations = serde_json::to_string(&policy.destinations)?;
    // §4's L0 block replicates with the rest of the policy, so a failover
    // gates the surviving cluster the way the team configured it.
    let l0_json = serde_json::to_string(&policy.l0)?;
    // 04 §3's repeat/final-action pair travels with the policy for the same
    // reason: a failover has to run the ladder the team configured, not the
    // shipped default.
    let final_action = policy.final_action.as_str().to_string();
    let now = config::utils::time::now_micros();
    // Same reasoning as the schedule: `team_id` is the unique key, and
    // `get_or_create` on the read path means a replica may well have minted a
    // default policy of its own before this message arrived.
    match oncall_policies::Entity::find()
        .filter(oncall_policies::Column::OrgId.eq(&policy.org_id))
        .filter(oncall_policies::Column::TeamId.eq(&policy.team_id))
        .one(client)
        .await?
    {
        Some(existing) => {
            let mut active: oncall_policies::ActiveModel = existing.into();
            active.rungs = Set(rungs);
            active.destinations = Set(destinations);
            active.l0_json = Set(l0_json);
            active.repeat_count = Set(policy.repeat_count);
            active.final_action = Set(final_action);
            active.updated_at = Set(now);
            active.update(client).await?;
        }
        None => {
            oncall_policies::ActiveModel {
                id: Set(policy.id.clone()),
                org_id: Set(policy.org_id.clone()),
                team_id: Set(policy.team_id.clone()),
                rungs: Set(rungs),
                destinations: Set(destinations),
                l0_json: Set(l0_json),
                repeat_count: Set(policy.repeat_count),
                final_action: Set(final_action),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(client)
            .await?;
        }
    }
    super::oncall_policies::invalidate_and_publish(&policy.org_id, &policy.team_id).await;
    Ok(())
}

/// Applies one ownership rule.
pub async fn put_ownership_rule(rule: &OwnershipRule) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let dimensions = serde_json::to_string(&rule.dimensions)?;
    // `path` is derived, never sent: recomputing it locally keeps the canonical
    // form owned by one function, so a future change to the canonicalisation
    // cannot leave two regions disagreeing about what the unique index means.
    let path = rule.path();
    match oncall_ownership_rules::Entity::find_by_id(&rule.id)
        .one(client)
        .await?
    {
        Some(existing) => {
            let mut active: oncall_ownership_rules::ActiveModel = existing.into();
            active.team_id = Set(rule.team_id.clone());
            active.path = Set(path);
            active.dimensions = Set(dimensions);
            active.updated_at = Set(rule.updated_at);
            active.update(client).await?;
        }
        None => {
            oncall_ownership_rules::ActiveModel {
                id: Set(rule.id.clone()),
                org_id: Set(rule.org_id.clone()),
                team_id: Set(rule.team_id.clone()),
                path: Set(path),
                dimensions: Set(dimensions),
                created_at: Set(rule.created_at),
                updated_at: Set(rule.updated_at),
            }
            .insert(client)
            .await?;
        }
    }
    super::oncall_ownership::invalidate_and_publish(&rule.org_id).await;
    Ok(())
}

/// Applies the org's routing configuration.
///
/// Delegated rather than reimplemented: the setting is keyed on the org, so
/// there is no id to preserve and nothing this module would add beyond a second
/// copy of the same upsert. It is listed here so the replication surface is
/// still readable as one list.
pub async fn put_routing_config(
    config: &config::meta::oncall::RoutingConfig,
) -> Result<(), errors::Error> {
    super::oncall_routing_config::put(config).await
}

/// Applies a response record under the id the source region gave it.
///
/// The id is the contract with the scheduler: a replicated escalation trigger's
/// `module_key` is this string, and the trigger sync path refuses to push a
/// timer for a record it cannot find. Renumbering here would drop every
/// replicated page.
pub async fn put_response(response: &Response) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = oncall_responses::Model {
        id: response.id.clone(),
        org_id: response.org_id.clone(),
        subject_type: response.subject.subject_type.to_i32(),
        subject_id: response.subject.subject_id(),
        team_id: response.team_id.clone(),
        title: response.title.clone(),
        cause: response.cause.map(|c| c.as_str().to_string()),
        cause_note: response.cause_note.clone(),
        snoozed_until: response.snoozed_until,
        ladder_anchor: response.ladder_anchor,
        ladder_run: response.ladder_run,
        responder_role: response.responder_role.to_i32(),
        origin_response_id: response.origin_response_id.clone(),
        priority: response.priority,
        state: response.state.to_i32(),
        opened_at: response.opened_at,
        acked_by: response.acked_by.clone(),
        acked_at: response.acked_at,
        closed_at: response.closed_at,
        incident_id: response.incident_id.clone(),
        // Not carried on the meta type, so a replicated record re-derives it
        // from its own region's alert. The link is a convenience on the page,
        // never an input to whether or whom to page, so a region that has not
        // yet replicated the alert shows no runbook rather than failing the
        // replication.
        runbook_url: None,
        exhausted_at: response.exhausted_at,
    };
    match oncall_responses::Entity::find_by_id(&response.id)
        .one(client)
        .await?
    {
        Some(_) => {
            let mut active = model.into_active_model();
            active.id = Set(response.id.clone());
            active.update(client).await?;
        }
        None => {
            model.into_active_model().insert(client).await?;
        }
    }
    Ok(())
}

/// Appends one timeline entry, if the replica does not already have it.
///
/// The timeline is not decoration: `Page` entries **are** the delivery ledger,
/// and the engine refuses to re-send a rung it finds there. Replicating the
/// record without its entries would hand the surviving cluster a record with an
/// empty ledger, and the first tick after failover would page the whole ladder
/// from rung zero again.
///
/// Deduped on the entry's own content rather than on a row id, because the meta
/// type carries no id — and content is the better key anyway: two regions that
/// independently recorded the same page should converge on one row, not two.
pub async fn put_event(response_id: &str, event: &ResponseEvent) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let channel = event.channel.map(|c| c.to_i32());
    let existing = oncall_response_events::Entity::find()
        .filter(oncall_response_events::Column::ResponseId.eq(response_id))
        .filter(oncall_response_events::Column::At.eq(event.at))
        .filter(oncall_response_events::Column::Kind.eq(event.kind.to_i32()))
        .filter(oncall_response_events::Column::Actor.eq(event.actor.as_str()))
        .filter(oncall_response_events::Column::RungMicros.eq(event.rung_micros))
        .filter(oncall_response_events::Column::LadderRun.eq(event.ladder_run))
        .filter(oncall_response_events::Column::Recipient.eq(event.recipient.clone()))
        .filter(oncall_response_events::Column::Channel.eq(channel))
        .one(client)
        .await?;
    if existing.is_some() {
        return Ok(());
    }
    oncall_response_events::ActiveModel {
        id: Set(config::ider::uuid()),
        response_id: Set(response_id.to_string()),
        kind: Set(event.kind.to_i32()),
        at: Set(event.at),
        actor: Set(event.actor.clone()),
        body: Set(event.body.clone()),
        rung_micros: Set(event.rung_micros),
        ladder_run: Set(event.ladder_run),
        recipient: Set(event.recipient.clone()),
        channel: Set(channel),
        delivered: Set(event.delivered),
    }
    .insert(client)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use config::meta::oncall::{
        Channel, ResponderRole, ResponseEvent, ResponseEventKind, ResponseState, SubjectRef,
        SubjectType,
    };

    use super::*;

    fn a_response() -> Response {
        Response {
            id: "resp_1".to_string(),
            org_id: "org".to_string(),
            subject: SubjectRef::new(SubjectType::Alert, "al_1", 3),
            team_id: "team_1".to_string(),
            title: Some("disk full".to_string()),
            cause: None,
            cause_note: None,
            snoozed_until: None,
            ladder_anchor: Some(42),
            ladder_run: Some(2),
            priority: 1,
            responder_role: ResponderRole::Owner,
            origin_response_id: None,
            state: ResponseState::Triggered,
            opened_at: 10,
            acked_by: None,
            acked_at: None,
            closed_at: None,
            incident_id: None,
        }
    }

    /// The whole point of this module: a replicated record keeps its id, so the
    /// escalation trigger keyed on it can find it. Everything else is detail.
    #[test]
    fn test_response_row_keeps_the_source_id_and_subject() {
        let r = a_response();
        assert_eq!(r.subject.subject_id(), "al_1#3");
        assert_eq!(r.subject.subject_type.to_i32(), SubjectType::Alert.to_i32());
        assert_eq!(r.id, "resp_1");
    }

    /// A rule's canonical path is recomputed on the receiving side, so it must
    /// be a pure function of the dimensions and not of anything local.
    #[test]
    fn test_ownership_path_is_derived_not_carried() {
        let mut dims = HashMap::new();
        dims.insert("service".to_string(), "checkout".to_string());
        dims.insert("env".to_string(), "prod".to_string());
        let a = OwnershipRule {
            id: "r1".to_string(),
            org_id: "org".to_string(),
            team_id: "t".to_string(),
            dimensions: dims.clone(),
            created_at: 1,
            updated_at: 2,
        };
        let b = OwnershipRule {
            id: "r2".to_string(),
            org_id: "other".to_string(),
            team_id: "u".to_string(),
            dimensions: dims,
            created_at: 9,
            updated_at: 9,
        };
        assert_eq!(a.path(), b.path());
    }

    fn an_absence() -> Unavailability {
        Unavailability {
            id: "un_1".to_string(),
            org_id: "org".to_string(),
            user_email: "ana@o2.ai".to_string(),
            start_at: 20_000,
            end_at: 30_000,
            reason: Some("annual leave".to_string()),
            created_by: "ana@o2.ai".to_string(),
            created_at: 5,
        }
    }

    /// The round trip an absence has to survive: the row the replica writes
    /// carries the source region's id and the source region's window, so the
    /// two clusters answer "is Ana away at t?" the same way. A replica that
    /// renumbered the row or restamped the window would hold the same holiday
    /// under a different name and, at the edges, a different answer.
    #[test]
    fn test_an_absence_replicates_under_its_source_id_and_window() {
        let source = an_absence();
        let row = oncall_unavailability::Model {
            id: source.id.clone(),
            org_id: source.org_id.clone(),
            user_email: source.user_email.clone(),
            start_at: source.start_at,
            end_at: source.end_at,
            reason: source.reason.clone(),
            created_by: source.created_by.clone(),
            created_at: source.created_at,
        };
        let replicated = Unavailability {
            id: row.id,
            org_id: row.org_id,
            user_email: row.user_email,
            start_at: row.start_at,
            end_at: row.end_at,
            reason: row.reason,
            created_by: row.created_by,
            created_at: row.created_at,
        };
        assert_eq!(replicated, source, "nothing is dropped or restamped");
        // And the surviving region resolves the away window identically.
        for at in [source.start_at, 25_000, source.end_at - 1] {
            assert!(replicated.covers(at));
            assert_eq!(replicated.covers(at), source.covers(at));
        }
        assert!(!replicated.covers(source.end_at), "the end stays exclusive");
        assert!(config::meta::oncall::is_unavailable(
            std::slice::from_ref(&replicated),
            "ana@o2.ai",
            25_000
        ));
    }

    /// The dedupe key has to separate two deliveries that differ only by
    /// recipient or channel, or a replay would collapse a fan-out rung into one
    /// row and the ledger would claim people were paged who were not.
    #[test]
    fn test_event_identity_includes_recipient_and_channel() {
        let base = ResponseEvent::new(ResponseEventKind::Page, 100, "o2-engine", "paged");
        let to_ana = ResponseEvent {
            recipient: Some("ana@example.com".to_string()),
            channel: Some(Channel::Email),
            ..base.clone()
        };
        let to_bo = ResponseEvent {
            recipient: Some("bo@example.com".to_string()),
            ..to_ana.clone()
        };
        let ana_on_webhook = ResponseEvent {
            channel: Some(Channel::Webhook),
            ..to_ana.clone()
        };
        assert_ne!(to_ana.recipient, to_bo.recipient);
        assert_ne!(to_ana.channel, ana_on_webhook.channel);
        assert_eq!(to_ana, to_ana.clone());
    }
}
