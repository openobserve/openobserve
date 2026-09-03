// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Super-cluster queue processor for on-call state.
//!
//! Replicates everything the escalation engine reads: teams and their
//! membership, schedules, escalation policies, ownership rules, response
//! records and their timelines.
//!
//! This exists because on-call keeps no state in `Trigger.data` — every fact
//! lives in a table. A replicated escalation trigger therefore names a response
//! id and nothing else, and the trigger sync path in `scheduler.rs` will not
//! push a timer for a record the receiving region has never seen. Without these
//! messages that check fails for every replicated trigger, and the failover the
//! design promises ("escalation resumes from replicated rows") resumes nothing.
//!
//! Idempotency: every handler is an id-preserving upsert or a delete of
//! something that may already be gone, so a redelivery changes nothing. Ids come
//! from the source region and are never regenerated — the id *is* the join
//! between a trigger and its record.

use infra::{errors::Result, table};
use o2_enterprise::enterprise::super_cluster::queue::{Message, OncallMessage};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let msg = msg.try_into().map_err(|e| {
        infra::errors::Error::Message(format!("[ONCALL] Failed to deserialize: {e}"))
    })?;
    process_msg(msg).await
}

pub(crate) async fn process_msg(msg: OncallMessage) -> Result<()> {
    match msg {
        OncallMessage::TeamPut { team } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put team org={} id={}",
                team.org_id,
                team.id
            );
            table::super_cluster_oncall::put_team(&team).await?;
        }
        OncallMessage::TeamDelete { org_id, team_id } => {
            log::debug!("[SUPER_CLUSTER:oncall] Delete team org={org_id} id={team_id}");
            // The source region refuses to delete a team that is its default,
            // so this should never fire — but a replica that somehow holds a
            // stale nomination would otherwise route every unclaimed signal at
            // a team it no longer has, which is a page that goes nowhere and
            // looks routed. Clearing first is cheap and cannot be wrong.
            table::oncall_routing_config::clear_if_default_team(&org_id, &team_id).await?;
            // Deleting a team that is already gone is a no-op, which is what
            // makes a redelivered delete harmless.
            table::oncall_teams::delete(&org_id, &team_id).await?;
        }
        OncallMessage::MembersPut { team_id, members } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put {} member(s) for team={team_id}",
                members.len()
            );
            table::super_cluster_oncall::put_members(&team_id, &members).await?;
        }
        OncallMessage::SchedulePut { schedule } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put schedule org={} team={}",
                schedule.org_id,
                schedule.team_id
            );
            table::super_cluster_oncall::put_schedule(&schedule).await?;
        }
        OncallMessage::ScheduleDelete { org_id, team_id } => {
            log::debug!("[SUPER_CLUSTER:oncall] Delete schedule org={org_id} team={team_id}");
            table::oncall_schedules::delete_by_team(&org_id, &team_id).await?;
        }
        OncallMessage::PolicyPut { policy } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put policy org={} team={}",
                policy.org_id,
                policy.team_id
            );
            table::super_cluster_oncall::put_policy(&policy).await?;
        }
        OncallMessage::PolicyDelete { org_id, team_id } => {
            log::debug!("[SUPER_CLUSTER:oncall] Delete policy org={org_id} team={team_id}");
            table::oncall_policies::delete_by_team(&org_id, &team_id).await?;
        }
        OncallMessage::OverridePut { record } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put override org={} team={} id={}",
                record.org_id,
                record.team_id,
                record.id
            );
            table::super_cluster_oncall::put_override(&record).await?;
        }
        OncallMessage::OverrideDelete {
            org_id,
            override_id,
        } => {
            log::debug!("[SUPER_CLUSTER:oncall] Delete override org={org_id} id={override_id}");
            // Deleting a cover that is already gone is a no-op, which is what
            // makes a redelivered delete harmless.
            table::oncall_overrides::delete(&org_id, &override_id).await?;
        }
        OncallMessage::OwnershipPut { rule } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put ownership rule org={} id={}",
                rule.org_id,
                rule.id
            );
            table::super_cluster_oncall::put_ownership_rule(&rule).await?;
        }
        OncallMessage::OwnershipDelete { org_id, rule_id } => {
            log::debug!("[SUPER_CLUSTER:oncall] Delete ownership rule org={org_id} id={rule_id}");
            table::oncall_ownership::delete(&org_id, &rule_id).await?;
        }
        OncallMessage::RoutingConfigPut { config } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put routing config org={} default_team={:?}",
                config.org_id,
                config.default_team_id
            );
            table::super_cluster_oncall::put_routing_config(&config).await?;
        }
        OncallMessage::ResponsePut { response } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put response org={} id={} state={:?}",
                response.org_id,
                response.id,
                response.state
            );
            table::super_cluster_oncall::put_response(&response).await?;
        }
        OncallMessage::ResponseEventPut { response_id, event } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put timeline entry response={response_id} kind={:?}",
                event.kind
            );
            table::super_cluster_oncall::put_event(&response_id, &event).await?;
        }
        OncallMessage::UnavailabilityPut { record } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Put absence org={} user={} id={}",
                record.org_id,
                record.user_email,
                record.id
            );
            table::super_cluster_oncall::put_unavailability(&record).await?;
        }
        OncallMessage::UnavailabilityDelete {
            org_id,
            unavailability_id,
        } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Delete absence org={org_id} id={unavailability_id}"
            );
            // Deleting an absence that is already gone is a no-op, which is
            // what makes a redelivered delete harmless.
            table::oncall_unavailability::delete(&org_id, &unavailability_id).await?;
        }
        OncallMessage::UnavailabilityClearedForUser { org_id, user_email } => {
            log::debug!(
                "[SUPER_CLUSTER:oncall] Clear every absence org={org_id} user={user_email}"
            );
            table::super_cluster_oncall::clear_unavailability_for_user(&org_id, &user_email)
                .await?;
        }
    }
    Ok(())
}
