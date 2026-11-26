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

use std::collections::HashMap;

use config::{
    meta::{
        alerts::{ack::AckSource, priority::AlertPriority},
        downtimes::{Downtime, TargetModule},
        oncall::{Response, ResponseState},
    },
    utils::time::now_micros,
};
use infra::table::{
    alert_incidents::{
        self,
        relapse_repage::{RelapseAcknowledgements, RelapseRepageFence, RepageSkip},
    },
    entity::alert_incidents::Model,
    incident_events::{self, ReopenEffect},
    oncall_responses,
};
use o2_enterprise::enterprise::downtimes::{schedule::window_at, scope::target_for};
use sea_orm::{DatabaseConnection, DatabaseTransaction, TransactionTrait};

use super::{restart_exhausted_ladder, route_new_incident};
use crate::alerts::{
    ack::{self, Problem},
    downtimes,
};

const ACTOR: &str = "system (relapse)";

pub(super) struct RelapseRepage {
    pub(super) transition_id: String,
    pub(super) committed_at: i64,
    pub(super) reopen_count: i32,
    pub(super) check_id: String,
    pub(super) attempt_id: String,
    pub(super) generation: i64,
    pub(super) after_resolve: bool,
    pub(super) acknowledgements: RelapseAcknowledgements,
}

impl RelapseRepage {
    pub(super) async fn run(self, db: &DatabaseConnection, org: &str, incident: &str) {
        let transition = &self.transition_id;
        if let Err(error) = self.execute(db, org, incident).await {
            log::warn!("[INCIDENT RECOVERY] repage {org}/{incident} ({transition}): {error:#}");
        }
    }

    async fn execute(
        &self,
        db: &DatabaseConnection,
        org: &str,
        incident: &str,
    ) -> anyhow::Result<()> {
        let fence = self.fence(org, incident);
        let txn = db.begin().await?;
        let action = self.claim(&txn, &fence).await?;
        txn.commit().await?;
        if let Some(action) = action {
            let execution_fence = fence.clone();
            fence
                .run(action.run(&execution_fence, &self.transition_id))
                .await?;
        }
        Ok(())
    }

    fn fence(&self, org: &str, incident: &str) -> RelapseRepageFence {
        RelapseRepageFence {
            org: org.to_owned(),
            incident_id: incident.to_owned(),
            committed_at: self.committed_at,
            reopen_count: self.reopen_count,
            check_id: self.check_id.clone(),
            attempt_id: self.attempt_id.clone(),
            generation: self.generation,
            after_resolve: self.after_resolve,
            acknowledgements: self.acknowledgements.clone(),
        }
    }

    async fn claim(
        &self,
        txn: &DatabaseTransaction,
        fence: &RelapseRepageFence,
    ) -> anyhow::Result<Option<Action>> {
        let (org, incident) = (fence.org.as_str(), fence.incident_id.as_str());
        let Some(row) = alert_incidents::get_locked(txn, org, incident).await? else {
            return Ok(None);
        };
        if let Err(reason) = fence.check(txn, &row).await {
            return self.skip(org, incident, reason);
        }
        let Some(priority) = critical_priority(&row) else {
            return Ok(None);
        };
        let pages = match fence.locked_pages(txn).await {
            Ok(pages) => pages,
            Err(reason) => return self.skip(org, incident, reason),
        };
        let now = now_micros();
        let dimensions = serde_json::from_value(row.group_values.clone())?;
        if is_muted(txn, &row, &dimensions, now).await? {
            return Ok(None);
        }
        let Some(action) = decide(row, priority, dimensions, pages, now) else {
            return Ok(None);
        };
        let key = ReopenEffect::Repage(action.response_id().map(str::to_owned));
        let won =
            incident_events::claim_reopen_effect_in(txn, org, incident, &self.transition_id, key)
                .await?;
        Ok(won.then_some(action))
    }

    fn skip(
        &self,
        org: &str,
        incident: &str,
        reason: RepageSkip,
    ) -> anyhow::Result<Option<Action>> {
        if let RepageSkip::Database(error) = reason {
            return Err(error.into());
        }
        log::info!(
            "[INCIDENT RECOVERY] repage {org}/{incident} ({}): {reason}",
            self.transition_id
        );
        Ok(None)
    }
}

enum Action {
    Unack(String),
    Restart(Box<Response>),
    Route {
        priority: AlertPriority,
        title: String,
        team: Option<String>,
        dimensions: HashMap<String, String>,
    },
}

impl Action {
    fn response_id(&self) -> Option<&str> {
        match self {
            Self::Unack(id) => Some(id),
            Self::Restart(page) => Some(&page.id),
            Self::Route { .. } => None,
        }
    }

    async fn run(self, fence: &RelapseRepageFence, transition: &str) -> anyhow::Result<()> {
        let (org, incident) = (&fence.org, &fence.incident_id);
        match self {
            Self::Unack(_) => {
                let problem = Problem::Incident {
                    org_id: org.clone(),
                    incident_id: incident.clone(),
                };
                ack::unack(&problem, ACTOR, AckSource::Incident)
                    .await
                    .map_err(|error| {
                        anyhow::anyhow!("could not unacknowledge incident: {error:?}")
                    })?;
            }
            Self::Restart(page) => {
                restart_exhausted_ladder(org, &page, now_micros()).await?;
            }
            Self::Route {
                priority,
                title,
                team,
                dimensions,
            } => {
                let outcome = oncall_responses::with_declared_incident_episode(
                    org,
                    incident,
                    fence.reopen_count,
                    route_new_incident(
                        org,
                        incident,
                        &title,
                        priority,
                        team.as_deref(),
                        &dimensions,
                    ),
                )
                .await;
                if let Some(error) = outcome.error.or(outcome.impacted_error) {
                    if !error
                        .chain()
                        .any(|cause| cause.is::<oncall_responses::DeclaredIncidentEpisodeChanged>())
                    {
                        return Err(error);
                    }
                } else if outcome.record.is_none()
                    && oncall_responses::open_pages_held_by_incident(org, incident)
                        .await?
                        .is_empty()
                {
                    log::info!(
                        "[INCIDENT RECOVERY] repage {org}/{incident} ({transition}): no_route"
                    );
                }
            }
        }
        Ok(())
    }
}

fn critical_priority(row: &Model) -> Option<AlertPriority> {
    match row.severity.as_str() {
        "P1" => Some(AlertPriority::P1),
        "P2" => Some(AlertPriority::P2),
        _ => None,
    }
}

async fn is_muted(
    txn: &DatabaseTransaction,
    row: &Model,
    dimensions: &HashMap<String, String>,
    now: i64,
) -> anyhow::Result<bool> {
    if !downtimes::enabled() {
        return Ok(false);
    }
    if let Some(id) = &row.muted_by_downtime_id
        && let Some(downtime) = infra::table::downtimes::get_with(txn, &row.org_id, id).await?
        && recorded_mute_is_live(&downtime, now)
    {
        return Ok(true);
    }
    Ok(downtimes::active_for_declare(&row.org_id, dimensions, now)
        .is_some_and(|window| window.incident_mode.is_muted()))
}

fn recorded_mute_is_live(downtime: &Downtime, now: i64) -> bool {
    // A recorded mute already matched the firing, including any alert-group scope.
    downtime
        .cancelled_at
        .is_none_or(|cancelled| cancelled > now)
        && target_for(&downtime.targets, TargetModule::Alerts)
            .is_some_and(|target| target.incident_mode.is_muted())
        && window_at(&downtime.schedule, now).is_some()
}

fn decide(
    row: Model,
    priority: AlertPriority,
    dimensions: HashMap<String, String>,
    pages: Vec<Response>,
    now: i64,
) -> Option<Action> {
    if pages.iter().any(|page| page.is_snoozed(now)) {
        return None;
    }
    if let Some(page) = pages
        .iter()
        .find(|page| page.state == ResponseState::Acknowledged)
    {
        return Some(Action::Unack(page.id.clone()));
    }
    if pages.iter().any(Response::is_escalating) {
        return None;
    }
    if let Some(page) = pages.into_iter().next() {
        return Some(Action::Restart(Box::new(page)));
    }
    Some(Action::Route {
        priority,
        title: row.title.unwrap_or_else(|| "Incident".to_owned()),
        team: row.owner_team_id,
        dimensions,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::ack::AlertAck,
        downtimes::{
            AlertGroupRef, DowntimeSchedule, DowntimeTarget, IncidentMode, Repeat, TargetFolders,
        },
        folder::{DEFAULT_FOLDER, Folder, FolderType},
        oncall::{Channel, EscalationTarget, LadderStep, MICROS_PER_MINUTE, PriorityRung},
        triggers::TriggerModule,
    };
    use infra::{
        db::get_orm_client_rw,
        scheduler,
        table::{folders, incident_recovery_checks, oncall_policies, oncall_teams},
    };
    use o2_enterprise::enterprise::oncall::with_oncall_enabled;
    use serde_json::json;

    use super::*;
    use crate::alerts::incidents::{
        declare::tests::initialize_meta_store, recovery::tests::produce_repage,
    };

    struct Incident {
        row: Model,
        team: String,
    }

    impl Incident {
        async fn create(db: &DatabaseConnection) -> Self {
            Self::create_for_org(db, &test_org(), None).await
        }

        async fn create_for_org(
            db: &DatabaseConnection,
            org: &str,
            muted_by: Option<&str>,
        ) -> Self {
            let team = oncall_teams::create(org, "platform", "UTC", None)
                .await
                .unwrap();
            oncall_policies::get_or_create(org, &team.id).await.unwrap();
            // The inline tick skips empty rungs, so the first rung must still be in the future.
            let rung = PriorityRung {
                priority: AlertPriority::P1,
                steps: vec![LadderStep::new(
                    MICROS_PER_MINUTE,
                    vec![EscalationTarget::WholeTeam],
                )],
                channels: vec![Channel::Email],
            };
            oncall_policies::update_rungs(org, &team.id, &[rung], None, None)
                .await
                .unwrap()
                .unwrap();
            let txn = db.begin().await.unwrap();
            let row = alert_incidents::insert_declared_in(
                &txn,
                alert_incidents::DeclaredIncident {
                    org,
                    severity: "P1",
                    title: "Relapse paging test",
                    groups: json!({}),
                    now: now_micros(),
                    impact_start_at: None,
                    source_fingerprint: None,
                    owner_team_id: Some(team.id.clone()),
                    muted_by: muted_by.map(str::to_owned),
                },
            )
            .await
            .unwrap();
            txn.commit().await.unwrap();
            let row = alert_incidents::acknowledge(org, &row.id, "ana")
                .await
                .unwrap()
                .unwrap();
            let assigned = alert_incidents::assign_lead_with(db, org, &row.id, Some("ana"), "ana")
                .await
                .unwrap()
                .unwrap();
            Self {
                row: assigned.row,
                team: team.id,
            }
        }

        async fn page(&self) -> Response {
            let routed = route_new_incident(
                &self.row.org_id,
                &self.row.id,
                self.row.title.as_deref().unwrap(),
                AlertPriority::P1,
                Some(&self.team),
                &HashMap::new(),
            )
            .await;
            assert!(routed.error.is_none(), "{:?}", routed.error);
            routed.record.unwrap()
        }

        async fn records(&self) -> Vec<Response> {
            oncall_responses::list_for_incident(&self.row.org_id, &self.row.id)
                .await
                .unwrap()
        }

        async fn assert_ladder(&self, expected: i32) {
            let records = self.records().await;
            let [page] = records.as_slice() else {
                panic!("expected one page")
            };
            assert_eq!(page.team(), &self.team);
            assert!(page.is_escalating());
            assert_eq!(page.current_run(), expected);
            scheduler::get(&self.row.org_id, TriggerModule::OncallEscalation, &page.id)
                .await
                .unwrap();
        }

        async fn execute(&self, db: &DatabaseConnection, effect: &RelapseRepage) {
            effect
                .execute(db, &self.row.org_id, &self.row.id)
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn repage_unacks_and_restarts_the_live_ladder_once() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let db = get_orm_client_rw().await;
            let incident = Incident::create(db).await;
            let page = incident.page().await;
            let org = &incident.row.org_id;
            oncall_responses::acknowledge(org, &page.id, "ana")
                .await
                .unwrap()
                .unwrap();
            let effect = produce_repage(db, &incident.row, false).await;
            tokio::join!(incident.execute(db, &effect), incident.execute(db, &effect));
            incident.assert_ladder(page.current_run() + 1).await;
            let updated = alert_incidents::get_rw(org, &incident.row.id)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(updated.status, "open");
            assert_eq!(updated.acknowledged_at, None);
            assert_eq!(updated.assigned_to.as_deref(), Some("ana"));
        })
        .await;
    }

    #[tokio::test]
    async fn repage_leaves_a_live_ladder_and_restarts_an_exhausted_one() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let db = get_orm_client_rw().await;
            let live = Incident::create(db).await;
            let page = live.page().await;
            live.assert_ladder(page.current_run()).await;
            let effect = produce_repage(db, &live.row, false).await;
            live.execute(db, &effect).await;
            live.assert_ladder(page.current_run()).await;

            let exhausted = Incident::create(db).await;
            let page = exhausted.page().await;
            let org = &exhausted.row.org_id;
            oncall_responses::mark_exhausted(org, &page.id, now_micros())
                .await
                .unwrap()
                .unwrap();
            let effect = produce_repage(db, &exhausted.row, false).await;
            exhausted.execute(db, &effect).await;
            exhausted.assert_ladder(page.current_run() + 1).await;
        })
        .await;
    }

    #[tokio::test]
    async fn repage_routes_without_an_open_record_and_respects_live_downtime() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let db = get_orm_client_rw().await;
            let incident = Incident::create(db).await;
            let effect = produce_repage(db, &incident.row, false).await;
            assert!(incident.records().await.is_empty());
            incident.execute(db, &effect).await;
            incident.assert_ladder(1).await;

            let muted = Incident::create(db).await;
            let effect = produce_repage(db, &muted.row, false).await;
            let downtime = start_downtime(&muted.row.org_id, None).await;
            let active =
                downtimes::active_for_declare(&muted.row.org_id, &HashMap::new(), now_micros())
                    .expect("persisted downtime must match the incident at effect time");
            assert_eq!(active.id, downtime);
            assert!(active.incident_mode.is_muted());
            muted.execute(db, &effect).await;
            assert!(muted.records().await.is_empty());
            assert!(
                incident_events::completed_reopen_effects(
                    &muted.row.org_id,
                    &muted.row.id,
                    &effect.transition_id,
                )
                .await
                .unwrap()
                .is_empty()
            );
        })
        .await;
    }

    #[tokio::test]
    async fn repage_after_resolve_bypasses_flap_dampening() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let db = get_orm_client_rw().await;
            let incident = Incident::create(db).await;
            let page = incident.page().await;
            let org = &incident.row.org_id;
            let closed = oncall_responses::resolve(org, &page.id, None, None)
                .await
                .unwrap()
                .unwrap();
            assert!(closed.state.is_terminal());
            let effect = produce_repage(db, &incident.row, true).await;
            let now = now_micros();
            assert!(
                now - closed.closed_at.unwrap()
                    < o2_enterprise::enterprise::common::config::get_config()
                        .oncall
                        .flap_dampening_secs
                        * 1_000_000
            );

            incident.execute(db, &effect).await;
            let records = incident.records().await;
            assert_eq!(records.len(), 2);
            let replacement = records.iter().find(|record| record.id != page.id).unwrap();
            assert!(replacement.is_escalating());
            assert_eq!(replacement.subject.firing, page.subject.firing + 1);
            scheduler::get(org, TriggerModule::OncallEscalation, &replacement.id)
                .await
                .unwrap();
        })
        .await;
    }

    #[tokio::test]
    async fn repage_respects_the_recorded_alert_group_downtime() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let db = get_orm_client_rw().await;
            let org = test_org();
            let group = AlertGroupRef {
                alert_id: config::ider::generate(),
                group_key: "database-errors".to_owned(),
                group_labels: None,
            };
            let downtime = start_downtime(&org, Some(group.clone())).await;
            let active = downtimes::active_for_alert_group(
                &org,
                &group.alert_id,
                DEFAULT_FOLDER,
                &HashMap::new(),
                &group.group_key,
                now_micros(),
            )
            .expect("the persisted downtime covers this alert group");
            assert_eq!(active.id, downtime);
            assert!(downtimes::active_for_declare(&org, &HashMap::new(), now_micros()).is_none());
            let incident = Incident::create_for_org(db, &org, Some(&downtime)).await;
            let effect = produce_repage(db, &incident.row, false).await;
            incident.execute(db, &effect).await;
            assert!(incident.records().await.is_empty());
        })
        .await;
    }

    #[tokio::test]
    async fn repage_skips_newer_ack_and_old_episode() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let db = get_orm_client_rw().await;
            let incident = Incident::create(db).await;
            let page = incident.page().await;
            let org = &incident.row.org_id;
            let id = &incident.row.id;
            let effect = produce_repage(db, &incident.row, false).await;
            let acked = oncall_responses::acknowledge(org, &page.id, "new-holder")
                .await
                .unwrap()
                .unwrap();
            assert!(acked.acked_at.unwrap() > effect.committed_at);
            incident.execute(db, &effect).await;
            let [held]: [Response; 1] = incident.records().await.try_into().unwrap();
            assert_eq!(held.acked_by.as_deref(), Some("new-holder"));
            assert_eq!(held.current_run(), page.current_run());
            assert!(
                alert_incidents::get_rw(org, id)
                    .await
                    .unwrap()
                    .unwrap()
                    .acknowledged_at
                    .is_some()
            );

            let incident = Incident::create(db).await;
            let mut effect = produce_repage(db, &incident.row, true).await;
            let org = &incident.row.org_id;
            let id = &incident.row.id;
            alert_incidents::update_status_by_with(db, org, id, "resolved", Some("ana"))
                .await
                .unwrap();
            let reopened = alert_incidents::update_status_by_with(db, org, id, "open", Some("ana"))
                .await
                .unwrap();
            let check = incident_recovery_checks::get(db, org, &effect.check_id)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(reopened.reopen_count, effect.reopen_count + 1);
            assert_eq!(reopened.fix_attempt_id, None);
            // Isolate the episode guard from T13's independent generation fence.
            effect.generation = check.generation;
            incident.execute(db, &effect).await;
            assert!(incident.records().await.is_empty());
            assert!(
                incident_events::completed_reopen_effects(org, id, &effect.transition_id)
                    .await
                    .unwrap()
                    .is_empty()
            );
        })
        .await;
    }

    #[tokio::test]
    async fn repage_preserves_ack_committed_between_claim_and_unack() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let db = get_orm_client_rw().await;
            let incident = Incident::create(db).await;
            let page = incident.page().await;
            let org = &incident.row.org_id;
            let id = &incident.row.id;
            oncall_responses::acknowledge(org, &page.id, "ana")
                .await
                .unwrap()
                .unwrap();
            let effect = produce_repage(db, &incident.row, false).await;
            let fence = effect.fence(org, id);
            let txn = db.begin().await.unwrap();
            let action = effect.claim(&txn, &fence).await.unwrap().unwrap();
            assert!(matches!(&action, Action::Unack(_)));
            txn.commit().await.unwrap();

            let newer = alert_incidents::take_over_acknowledgement_row(org, id, "ana", "lee")
                .await
                .unwrap()
                .unwrap();
            assert!(newer.acknowledged_at.unwrap() > effect.committed_at);
            fence
                .clone()
                .run(action.run(&fence, &effect.transition_id))
                .await
                .unwrap();

            let row = alert_incidents::get_rw(org, id).await.unwrap().unwrap();
            assert_eq!(row.acknowledged_at, newer.acknowledged_at);
            assert_eq!(row.acknowledged_by.as_deref(), Some("lee"));
            let [held]: [Response; 1] = incident.records().await.try_into().unwrap();
            assert_eq!(held.state, ResponseState::Acknowledged);
            assert_eq!(held.current_run(), page.current_run());
        })
        .await;
    }

    #[tokio::test]
    async fn repage_preserves_newer_page_ack_revision_with_an_older_timestamp() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let db = get_orm_client_rw().await;
            let incident = Incident::create(db).await;
            let page = incident.page().await;
            let org = &incident.row.org_id;
            let id = &incident.row.id;
            let prior = oncall_responses::acknowledge(org, &page.id, "ana")
                .await
                .unwrap()
                .unwrap();
            let mut effect = produce_repage(db, &incident.row, false).await;
            // An ack can take its timestamp before the relapse and write its revision after it.
            effect.committed_at = i64::MAX;
            let fence = effect.fence(org, id);
            let txn = db.begin().await.unwrap();
            let action = effect.claim(&txn, &fence).await.unwrap().unwrap();
            assert!(matches!(&action, Action::Unack(_)));
            txn.commit().await.unwrap();

            let newer = oncall_responses::take_over_acknowledgement(org, &page.id, "ana", "lee")
                .await
                .unwrap()
                .unwrap();
            assert!(newer.updated_at > prior.updated_at);
            assert!(newer.acked_at.unwrap() < effect.committed_at);

            let txn = db.begin().await.unwrap();
            alert_incidents::get_locked(&txn, org, id)
                .await
                .unwrap()
                .unwrap();
            assert!(matches!(
                fence.locked_pages(&txn).await,
                Err(RepageSkip::NewerAck)
            ));
            txn.rollback().await.unwrap();
            fence
                .clone()
                .run(action.run(&fence, &effect.transition_id))
                .await
                .unwrap();

            let [held]: [Response; 1] = incident.records().await.try_into().unwrap();
            assert_eq!(held.acked_by.as_deref(), Some("lee"));
            assert_eq!(held.current_run(), page.current_run());
        })
        .await;
    }

    #[tokio::test]
    async fn repage_restarts_an_acknowledged_page_after_unsnooze() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let db = get_orm_client_rw().await;
            let incident = Incident::create(db).await;
            let page = incident.page().await;
            let org = &incident.row.org_id;
            let held = oncall_responses::acknowledge(org, &page.id, "ana")
                .await
                .unwrap()
                .unwrap();
            let now = now_micros();
            let snoozed = oncall_responses::snooze(org, &page.id, now, now + 60_000_000)
                .await
                .unwrap()
                .unwrap();
            let effect = produce_repage(db, &incident.row, false).await;
            let awake = oncall_responses::unsnooze(org, &page.id, now_micros())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(awake.acked_at, held.acked_at);
            assert_eq!(awake.acked_by, held.acked_by);
            assert!(awake.snoozed_until.is_none());
            assert!(awake.updated_at > snoozed.updated_at);
            incident.execute(db, &effect).await;
            incident.assert_ladder(page.current_run() + 1).await;
        })
        .await;
    }

    #[tokio::test]
    async fn repage_preserves_firing_ack_newer_than_relapse() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(assert_newer_firing_ack_blocks_repage()).await;
    }

    async fn assert_newer_firing_ack_blocks_repage() {
        let db = get_orm_client_rw().await;
        let incident = Incident::create(db).await;
        let org = &incident.row.org_id;
        let id = &incident.row.id;
        let page = incident.page().await;
        oncall_responses::acknowledge(org, &page.id, "ana")
            .await
            .unwrap()
            .unwrap();
        let alert = config::ider::generate();
        let fired_at = now_micros();
        alert_incidents::add_firing_once_with(
            db,
            org,
            id,
            &alert_incidents::FirstAlert {
                alert_id: &alert,
                alert_name: "Error rate",
                alert_kind: "internal",
                correlation_reason: "service",
                labels: None,
                severity: None,
            },
            fired_at,
        )
        .await
        .unwrap();
        let original = firing_ack(org, &alert, "original", fired_at);
        assert!(db::alerts::alert_acks::claim(&original).await.unwrap());
        let prior = firing_ack(org, &alert, "raced", fired_at);
        assert!(db::alerts::alert_acks::claim(&prior).await.unwrap());
        let raced = AlertAck {
            acked_by: "lee".to_owned(),
            ..prior.clone()
        };
        let effect = produce_repage(db, &incident.row, false).await;
        let fence = effect.fence(org, id);
        let txn = db.begin().await.unwrap();
        let action = effect.claim(&txn, &fence).await.unwrap().unwrap();
        assert!(matches!(&action, Action::Unack(_)));
        txn.commit().await.unwrap();

        assert!(raced.acked_at < effect.committed_at);
        assert!(
            db::alerts::alert_acks::take_over(&raced, "ana")
                .await
                .unwrap()
        );
        let txn = db.begin().await.unwrap();
        alert_incidents::get_locked(&txn, org, id)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            fence.locked_pages(&txn).await,
            Err(RepageSkip::NewerAck)
        ));
        txn.rollback().await.unwrap();

        let newer = firing_ack(org, &alert, "newer", fired_at);
        assert!(newer.acked_at > effect.committed_at);
        assert!(db::alerts::alert_acks::claim(&newer).await.unwrap());

        fence
            .clone()
            .run(async {
                for held in [&original, &newer, &raced] {
                    let unacked = db::alerts::alert_acks::unack(
                        org,
                        &alert,
                        &held.group_key,
                        fired_at,
                        ACTOR,
                        now_micros(),
                    )
                    .await
                    .unwrap();
                    assert!(unacked.is_none());
                    let row = infra::table::alert_acks::get_with(db, org, &alert, &held.group_key)
                        .await
                        .unwrap()
                        .unwrap();
                    assert_eq!(row.acked_at, held.acked_at);
                    assert_eq!(row.acked_by, held.acked_by);
                    assert_eq!(row.unacked_at, None);
                    if held.group_key == "raced" {
                        assert!(row.updated_at > prior.updated_at);
                    }
                }
                action.run(&fence, &effect.transition_id).await.unwrap();
            })
            .await;
        let [held]: [Response; 1] = incident.records().await.try_into().unwrap();
        assert_eq!(held.acked_by.as_deref(), Some("ana"));
        assert_eq!(held.current_run(), page.current_run());
        let row = alert_incidents::get_rw(org, id).await.unwrap().unwrap();
        assert_eq!(row.acknowledged_by.as_deref(), Some("ana"));
    }

    fn firing_ack(org: &str, alert: &str, group: &str, fired_at: i64) -> AlertAck {
        let now = now_micros();
        AlertAck {
            org_id: org.to_owned(),
            alert_id: alert.to_owned(),
            group_key: group.to_owned(),
            firing_started_at: fired_at,
            acked_by: "ana".to_owned(),
            acked_at: now,
            ack_source: AckSource::Incident,
            updated_at: now,
            ..Default::default()
        }
    }

    fn test_org() -> String {
        format!("repage_{}", config::ider::generate().to_lowercase())
    }

    async fn start_downtime(org: &str, group: Option<AlertGroupRef>) -> String {
        folders::get_or_create_with(
            get_orm_client_rw().await,
            org,
            Folder {
                folder_id: DEFAULT_FOLDER.to_owned(),
                name: DEFAULT_FOLDER.to_owned(),
                description: String::new(),
                icon: None,
            },
            FolderType::Downtimes,
        )
        .await
        .unwrap();
        let now = now_micros();
        let id = infra::table::downtimes::new_id();
        let target_alerts = group.iter().map(|group| group.alert_id.clone()).collect();
        db::downtimes::set(
            &Downtime {
                id: id.clone(),
                org: org.to_owned(),
                folder_id: DEFAULT_FOLDER.to_owned(),
                name: "Deployment".to_owned(),
                reason: None,
                condition: None,
                targets: vec![DowntimeTarget {
                    module: TargetModule::Alerts,
                    folders: TargetFolders::All,
                    tags: vec![],
                    ids: target_alerts,
                    slo_mode: None,
                    incident_mode: IncidentMode::Muted,
                }],
                alert_groups: group.map(|group| vec![group]),
                end_on_clear: None,
                source: None,
                schedule: DowntimeSchedule {
                    repeat: Repeat::None,
                    starts_at: now - 1_000_000,
                    ends_at: Some(now + 600_000_000),
                    timezone: "UTC".to_owned(),
                    start_time_local: None,
                    duration_secs: 600,
                    weekdays: vec![],
                },
                cancelled_at: None,
                cancelled_by: None,
                show_banner: false,
                notifications: None,
                origin_region: None,
                version: 1,
                created_by: "ana".to_owned(),
                created_at: now,
                updated_by: "ana".to_owned(),
                updated_at: now,
            },
            &[],
        )
        .await
        .unwrap();
        id
    }
}
