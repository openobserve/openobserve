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

use config::meta::{
    alerts::{
        incidents::{IncidentEvent, IncidentEventType},
        priority::AlertPriority,
    },
    oncall::{MICROS_PER_MINUTE, Response},
};
use infra::{
    db::{clock_micros, get_orm_client_rw},
    table::{
        alert_incidents, entity::alert_incidents as incident, incident_events, oncall_responses,
        oncall_teams,
    },
};
use o2_enterprise::enterprise::oncall::escalation::page_team_for_incident;
use sea_orm::TransactionTrait;
use serde::Serialize;
use utoipa::ToSchema;

use super::declare::{self, DeclareError};

const PAGE_WINDOW: i64 = 15 * MICROS_PER_MINUTE;

#[derive(Debug, Serialize, ToSchema)]
pub struct TeamPage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_id: Option<String>,
    pub paged_at: i64,
    pub state: PageState,
}

impl TeamPage {
    fn new(paged_at: i64, response: Option<Response>) -> Self {
        let state = if response.is_some() {
            PageState::Sent
        } else {
            PageState::Pending
        };
        Self {
            response_id: response.map(|page| page.id),
            paged_at,
            state,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PageState {
    Pending,
    Sent,
}

pub async fn page(org: &str, id: &str, team: &str, actor: &str) -> Result<TeamPage, DeclareError> {
    if team.trim().is_empty() {
        return Err(DeclareError::BadRequest("Provide team_id".to_owned()));
    }
    if oncall_teams::get(org, team).await?.is_none() {
        return Err(DeclareError::Forbidden);
    }
    let may_page = declare::may_page_team(org, actor, team).await?
        || is_paged_responder(org, id, actor).await?;
    let (paged_at, recorded) = reserve_page(org, id, team, actor, may_page).await?;
    let mut response = oncall_responses::open_for_incident_team(org, id, team).await?;
    if response.is_none()
        && let Some(incident) = recorded
    {
        response = send(&incident, team).await;
    }
    Ok(TeamPage::new(paged_at, response))
}

async fn is_paged_responder(org: &str, id: &str, actor: &str) -> Result<bool, DeclareError> {
    if !o2_enterprise::enterprise::oncall::is_enabled() {
        return Ok(false);
    }
    for page in oncall_responses::open_pages_held_by_incident(org, id).await? {
        if let Some(team) = page.team_id
            && declare::team_has_member(&team, actor).await?
        {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn reserve_page(
    org: &str,
    id: &str,
    team: &str,
    actor: &str,
    may_page: bool,
) -> Result<(i64, Option<incident::Model>), DeclareError> {
    let txn = get_orm_client_rw().await.begin().await?;
    let row = alert_incidents::get_locked(&txn, org, id)
        .await?
        .ok_or(DeclareError::NotFound)?;
    infra::race_point!("page_team_lock");
    if !may_page
        && !row
            .assigned_to
            .as_deref()
            .is_some_and(|lead| lead.eq_ignore_ascii_case(actor))
    {
        return Err(DeclareError::Forbidden);
    }
    if row.security_case && !crate::security::security_allowed(org, actor, "PUT").await {
        return Err(DeclareError::Forbidden);
    }
    if row.status == "resolved" || row.merged_into_id.is_some() {
        return Err(DeclareError::Conflict("Incident is closed"));
    }
    let now = clock_micros(&txn).await?;
    let events = incident_events::get_with(&txn, org, id).await?;
    if let Some(recent) = events.iter().rev().find(|event| {
        matches!(&event.event_type, IncidentEventType::TeamPaged { team_id, .. } if team_id == team)
    }) && now.saturating_sub(recent.timestamp) < PAGE_WINDOW
    {
        txn.commit().await?;
        return Ok((recent.timestamp, None));
    }
    let intent = IncidentEvent {
        timestamp: now,
        seq: 0,
        event_type: IncidentEventType::TeamPaged {
            team_id: team.to_owned(),
            actor: actor.to_owned(),
            transition_id: config::ider::generate_ulid(now),
        },
    };
    incident_events::append_in(&txn, org, id, intent).await?;
    txn.commit().await?;
    Ok((now, Some(row)))
}

async fn send(incident: &incident::Model, team: &str) -> Option<Response> {
    let org = &incident.org_id;
    let id = &incident.id;
    let dimensions = serde_json::from_value(incident.group_values.clone()).unwrap_or_default();
    let priority = incident.severity.parse().unwrap_or(AlertPriority::P3);
    let title = incident.title.as_deref().unwrap_or(id);
    let result = oncall_responses::with_declared_incident_episode(
        org,
        id,
        incident.reopen_count,
        page_team_for_incident(org, id, team, title, priority, &dimensions),
    )
    .await;
    match result {
        Ok(page) => page,
        Err(error) => {
            log::warn!("[incidents] team page pending for {org}/{id}/{team}: {error:#}");
            None
        }
    }
}

#[cfg(test)]
pub(in crate::alerts::incidents) mod tests {
    use std::sync::Arc;

    use config::{
        meta::{
            alerts::incidents::KeyType,
            oncall::{
                Channel, EscalationTarget, LadderStep, MICROS_PER_MINUTE, PriorityRung,
                ResponderRole, SubjectRef, SubjectType,
            },
            triggers::TriggerModule,
        },
        utils::time::now_micros,
    };
    use infra::race::{Barriers, Order, in_both_orders};
    use o2_enterprise::enterprise::oncall::{escalation, with_oncall_enabled};
    use sea_orm::{ConnectionTrait, DatabaseBackend};

    pub(in crate::alerts::incidents) use super::super::declare::tests::initialize_meta_store;
    use super::*;

    const A: &str = "ana@example.invalid";
    const B: &str = "bea@example.invalid";
    const LOCK: &str = "page_team_lock";
    const OPEN_LOCK: &str = "declare.page_before_incident_lock";

    struct Fixture {
        org: String,
        incident: String,
        first: String,
        second: String,
    }

    impl Fixture {
        async fn new() -> Self {
            let org = config::ider::generate();
            let incident = Self::incident(&org).await;
            let first = Self::team(&org, "platform").await;
            let second = Self::team(&org, "storage").await;
            for actor in [A, B] {
                oncall_teams::add_member(&first, actor).await.unwrap();
            }
            Self {
                org,
                incident,
                first,
                second,
            }
        }

        async fn incident(org: &str) -> String {
            let incident = alert_incidents::create(
                org,
                "P1",
                serde_json::json!({}),
                &KeyType::AlertId.to_string(),
                now_micros(),
                Some("Gateway errors".to_string()),
            )
            .await
            .unwrap();
            incident_events::init(org, &incident.id).await.unwrap();
            incident.id
        }

        async fn team(org: &str, name: &str) -> String {
            use infra::table::oncall_policies;

            let team = oncall_teams::create(org, name, "UTC", None).await.unwrap();
            oncall_policies::get_or_create(org, &team.id).await.unwrap();
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
                .unwrap();
            team.id
        }

        async fn start_primary_page(&self) -> Option<Response> {
            escalation::start_for_incident(
                &self.org,
                &self.incident,
                "Gateway errors",
                AlertPriority::P1,
                Some(&self.first),
                &Default::default(),
            )
            .await
            .unwrap()
        }

        async fn assert_pages(&self, expected_actor: &str, a: TeamPage, b: TeamPage) {
            assert_eq!(a.paged_at, b.paged_at);
            assert!(a.state == PageState::Sent || b.state == PageState::Sent);
            let [first]: [Response; 1] =
                oncall_responses::list_for_incident(&self.org, &self.incident)
                    .await
                    .unwrap()
                    .try_into()
                    .unwrap();
            assert_eq!(first.team(), self.first);
            assert!(first.state.is_unresolved());
            for result in [&a, &b] {
                if result.state == PageState::Sent {
                    assert_eq!(result.response_id.as_deref(), Some(first.id.as_str()));
                }
            }
            let repeat = page(&self.org, &self.incident, &self.first, B)
                .await
                .unwrap();
            assert_eq!(repeat.state, PageState::Sent);
            assert_eq!(repeat.paged_at, a.paged_at);
            assert_eq!(repeat.response_id.as_deref(), Some(first.id.as_str()));

            let events = incident_events::get_rw(&self.org, &self.incident)
                .await
                .unwrap();
            let intents: Vec<_> = events
                .iter()
                .filter_map(|event| match &event.event_type {
                    IncidentEventType::TeamPaged { team_id, actor, .. } => Some((team_id, actor)),
                    _ => None,
                })
                .collect();
            assert_eq!(intents.len(), 1);
            assert_eq!(intents[0].0, &self.first);
            assert_eq!(intents[0].1, expected_actor);

            let second = page(&self.org, &self.incident, &self.second, A)
                .await
                .unwrap();
            assert_eq!(second.state, PageState::Sent);
            let records = oncall_responses::list_for_incident(&self.org, &self.incident)
                .await
                .unwrap();
            assert_eq!(records.len(), 2);
            assert!(records.iter().any(|record| record.id == first.id));
            let second_record = records
                .iter()
                .find(|record| record.team() == self.second)
                .unwrap();
            assert!(second_record.state.is_unresolved());
            assert_eq!(
                second.response_id.as_deref(),
                Some(second_record.id.as_str())
            );
            for response in &records {
                assert!(response.state.is_unresolved());
                infra::scheduler::get(&self.org, TriggerModule::OncallEscalation, &response.id)
                    .await
                    .unwrap();
            }
        }
    }

    async fn request(
        race: Barriers,
        fixture: Arc<Fixture>,
        actor: &'static str,
        after_lock: bool,
    ) -> TeamPage {
        race.run(async {
            if after_lock {
                race.wait(LOCK).await;
            }
            page(&fixture.org, &fixture.incident, &fixture.first, actor)
                .await
                .unwrap()
        })
        .await
    }

    #[tokio::test]
    async fn page_team_concurrent_requests_page_once() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(race_orders()).await;
    }

    #[tokio::test]
    async fn page_team_requires_a_responder_page_held_by_this_incident() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let fixture = Fixture::new().await;
            let other = Fixture::incident(&fixture.org).await;
            let alert = config::ider::generate();
            let now = now_micros();
            attach_firing(&fixture.org, &other, &alert, now).await;
            attach_firing(
                &fixture.org,
                &fixture.incident,
                &alert,
                now + MICROS_PER_MINUTE,
            )
            .await;
            let page = escalation::start_with(
                &fixture.org,
                &SubjectRef::new(SubjectType::Alert, &alert, 1),
                Some(&fixture.first),
                AlertPriority::P1,
                "Shared firing",
                None,
            )
            .await
            .unwrap();
            oncall_responses::attach_incident(&fixture.org, &page.id, &other)
                .await
                .unwrap()
                .unwrap();
            assert!(is_paged_responder(&fixture.org, &other, A).await.unwrap());
            assert!(
                !is_paged_responder(&fixture.org, &fixture.incident, A)
                    .await
                    .unwrap()
            );
        })
        .await;
    }

    #[tokio::test]
    async fn page_team_reuses_blast_radius_page_held_through_its_origin() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let fixture = Fixture::new().await;
            let owner = fixture.start_primary_page().await.unwrap();
            let subject = SubjectRef::new(
                SubjectType::Incident,
                format!("{}:impacted:{}", fixture.incident, fixture.second),
                owner.subject.firing,
            );
            let (impacted, created) = oncall_responses::open_or_get(
                &fixture.org,
                &subject,
                Some(&fixture.second),
                AlertPriority::P1.to_i32(),
                Some("Impact on storage"),
                ResponderRole::Impacted,
                Some(&owner.id),
            )
            .await
            .unwrap();
            assert!(created);
            assert!(impacted.incident_id.is_none());
            assert_eq!(
                impacted.origin_response_id.as_deref(),
                Some(owner.id.as_str())
            );
            let result = page(&fixture.org, &fixture.incident, &fixture.second, A)
                .await
                .unwrap();
            assert_eq!(result.state, PageState::Sent);
            assert_eq!(result.response_id.as_deref(), Some(impacted.id.as_str()));
            assert_eq!(
                oncall_responses::open_pages_held_by_incident(&fixture.org, &fixture.incident)
                    .await
                    .unwrap()
                    .len(),
                2
            );
        })
        .await;
    }

    #[tokio::test]
    async fn page_team_and_normal_routing_share_the_same_team_open_lock() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(assert_cross_subject_open_dedup()).await;
    }

    #[tokio::test]
    async fn page_team_winner_is_the_origin_for_live_blast_radius_pages() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let fixture = Fixture::new().await;
            for (service, team) in [("gateway", &fixture.first), ("checkout", &fixture.second)] {
                infra::table::oncall_ownership::create(
                    &fixture.org,
                    team,
                    std::collections::HashMap::from([("service".to_owned(), service.to_owned())]),
                )
                .await
                .unwrap();
            }
            let help = page(&fixture.org, &fixture.incident, &fixture.first, A)
                .await
                .unwrap();
            let origin = fixture.start_primary_page().await.unwrap();
            assert_eq!(help.response_id.as_deref(), Some(origin.id.as_str()));
            let impacted = ["gateway".to_owned(), "checkout".to_owned()];
            let [downstream]: [Response; 1] =
                escalation::page_impacted(&fixture.org, &origin, &impacted, now_micros())
                    .await
                    .unwrap()
                    .try_into()
                    .unwrap();
            assert_eq!(downstream.team(), fixture.second);
            assert_eq!(
                downstream.origin_response_id.as_deref(),
                Some(origin.id.as_str())
            );
            assert_eq!(downstream.responder_role, ResponderRole::Impacted);
            assert!(downstream.subject.help_page_incident().is_none());

            let retry = fixture.start_primary_page().await.unwrap();
            assert_eq!(retry.id, origin.id);
            assert!(
                escalation::page_impacted(&fixture.org, &retry, &impacted, now_micros())
                    .await
                    .unwrap()
                    .is_empty()
            );
            assert_eq!(
                oncall_responses::open_pages_held_by_incident(&fixture.org, &fixture.incident)
                    .await
                    .unwrap()
                    .len(),
                2
            );
        })
        .await;
    }

    #[tokio::test]
    async fn page_team_winner_fences_delayed_live_fanout_after_reopen() {
        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let fixture = Fixture::new().await;
            let org = &fixture.org;
            let id = &fixture.incident;
            let service = "checkout".to_owned();
            infra::table::oncall_ownership::create(
                org,
                &fixture.second,
                std::collections::HashMap::from([("service".to_owned(), service.clone())]),
            )
            .await
            .unwrap();
            let help = page(org, id, &fixture.first, A).await.unwrap();
            let episode = alert_incidents::get_rw(org, id).await.unwrap().unwrap();

            let error = oncall_responses::with_declared_incident_episode(
                org,
                id,
                episode.reopen_count,
                async {
                    let origin = fixture.start_primary_page().await.unwrap();
                    assert_eq!(help.response_id.as_deref(), Some(origin.id.as_str()));
                    alert_incidents::update_status(org, id, "resolved")
                        .await
                        .unwrap();
                    let reopened = alert_incidents::update_status(org, id, "open")
                        .await
                        .unwrap();
                    assert_eq!(reopened.reopen_count, episode.reopen_count + 1);
                    escalation::page_impacted(org, &origin, &[service], now_micros())
                        .await
                        .unwrap_err()
                },
            )
            .await;
            assert!(
                error.chain().any(|cause| {
                    cause.is::<oncall_responses::DeclaredIncidentEpisodeChanged>()
                })
            );
            assert!(
                oncall_responses::list_impacted(org, help.response_id.as_deref().unwrap())
                    .await
                    .unwrap()
                    .is_empty()
            );
        })
        .await;
    }

    #[tokio::test]
    async fn page_team_resolve_leaves_the_incident_and_sibling_page_open() {
        use alert_incidents::{OwnershipRequest, OwnershipResult};
        use config::meta::oncall::ResponseState;

        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let fixture = Fixture::new().await;
            attach_firing(
                &fixture.org,
                &fixture.incident,
                &config::ider::generate(),
                now_micros(),
            )
            .await;
            let OwnershipResult::Committed(before, _) = alert_incidents::take_ownership(
                &fixture.org,
                &fixture.incident,
                &OwnershipRequest {
                    caller: A,
                    take_over_of: None,
                    assign_self: true,
                    ops_only: true,
                    expected_holder: None,
                    expected_lead: None,
                },
            )
            .await
            .unwrap() else {
                panic!("take ownership must commit")
            };
            let help = page(&fixture.org, &fixture.incident, &fixture.first, A)
                .await
                .unwrap()
                .response_id
                .unwrap();
            let sibling = page(&fixture.org, &fixture.incident, &fixture.second, A)
                .await
                .unwrap()
                .response_id
                .unwrap();
            oncall_responses::acknowledge(&fixture.org, &help, A)
                .await
                .unwrap()
                .unwrap();

            let closed = escalation::resolve(&fixture.org, &help, A, None, None)
                .await
                .unwrap();
            assert_eq!(closed.state, ResponseState::Resolved);
            let after = alert_incidents::get_rw(&fixture.org, &fixture.incident)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(after.status, "acknowledged");
            assert_eq!(after.acknowledged_by, before.acknowledged_by);
            assert_eq!(after.assigned_to, before.assigned_to);
            let still_open = oncall_responses::get(&fixture.org, &sibling)
                .await
                .unwrap()
                .unwrap();
            assert!(still_open.state.is_escalating());
            infra::scheduler::get(&fixture.org, TriggerModule::OncallEscalation, &sibling)
                .await
                .unwrap();
        })
        .await;
    }

    #[tokio::test]
    async fn resolution_records_incident_cause_without_copying_it_to_team_pages() {
        use config::meta::{
            alerts::incident_fields::{CustomerImpact, ResolutionDetails},
            oncall::{ResponseState, response::ResolutionCause},
        };

        if !initialize_meta_store().await {
            return;
        }
        with_oncall_enabled(async {
            let fixture = Fixture::new().await;
            for team in [&fixture.first, &fixture.second] {
                let page = page(&fixture.org, &fixture.incident, team, A)
                    .await
                    .unwrap();
                assert_eq!(page.state, PageState::Sent);
            }
            let note = "The dependency exhausted its connections";
            crate::alerts::incidents::resolve_with_details(
                &fixture.org,
                &fixture.incident,
                A,
                &ResolutionDetails {
                    resolution_cause: Some(ResolutionCause::DependencyFailure),
                    resolution_note: Some(note.to_owned()),
                    customer_impact: Some(CustomerImpact::Confirmed),
                },
            )
            .await
            .unwrap();
            let events = incident_events::get_rw(&fixture.org, &fixture.incident)
                .await
                .unwrap();
            assert!(events.iter().any(|event| matches!(
                &event.event_type,
                IncidentEventType::ResolutionRecorded { details, .. }
                    if details.resolution_cause == Some(ResolutionCause::DependencyFailure)
                       && details.resolution_note.as_deref() == Some(note)
            )));
            let records = oncall_responses::list_for_incident(&fixture.org, &fixture.incident)
                .await
                .unwrap();
            assert_eq!(records.len(), 2);
            for record in records {
                assert_eq!(record.state, ResponseState::Resolved);
                assert_eq!(record.cause, None);
                assert_ne!(record.cause_note.as_deref(), Some(note));
            }
        })
        .await;
    }

    async fn race_orders() {
        if get_orm_client_rw().await.get_database_backend() == DatabaseBackend::Postgres {
            for order in [Order::AThenB, Order::BThenA] {
                let fixture = Arc::new(Fixture::new().await);
                let race = Barriers::new();
                race.arm(LOCK, 2);
                let a = request(race.clone(), fixture.clone(), A, order == Order::BThenA);
                let b = request(race.clone(), fixture.clone(), B, order == Order::AThenB);
                let (a, b) = tokio::join!(a, b);
                race.assert_all_met();
                let actor = if order == Order::AThenB { A } else { B };
                fixture.assert_pages(actor, a, b).await;
            }
            return;
        }
        let runs = in_both_orders(|_| async {
            let fixture = Arc::new(Fixture::new().await);
            let race = Barriers::new();
            race.arm(LOCK, 1);
            let a = request(race.clone(), fixture.clone(), A, false);
            let b = request(race.clone(), fixture.clone(), B, false);
            (async move { (fixture, race, a.await) }, b)
        })
        .await;
        for run in runs {
            let (fixture, race, a) = run.a;
            race.assert_all_met();
            let actor = if run.order == Order::AThenB { A } else { B };
            fixture.assert_pages(actor, a, run.b).await;
        }
    }

    async fn attach_firing(org: &str, incident: &str, alert: &str, at: i64) {
        alert_incidents::add_firing_once(
            org,
            incident,
            &alert_incidents::FirstAlert {
                alert_id: alert,
                alert_name: "Gateway errors",
                alert_kind: "internal",
                correlation_reason: "service",
                labels: None,
                severity: None,
            },
            at,
        )
        .await
        .unwrap();
    }

    async fn assert_cross_subject_open_dedup() {
        if get_orm_client_rw().await.get_database_backend() == DatabaseBackend::Postgres {
            let fixture = Fixture::new().await;
            let race = Barriers::new();
            race.arm(OPEN_LOCK, 2);
            let (help, primary) = tokio::join!(
                race.run(page(&fixture.org, &fixture.incident, &fixture.first, A)),
                race.run(fixture.start_primary_page()),
            );
            race.assert_all_met();
            assert_one_team_page(&fixture, help.unwrap(), primary).await;
            return;
        }
        let runs = in_both_orders(|_| async {
            let fixture = Arc::new(Fixture::new().await);
            let other = fixture.clone();
            (
                async move {
                    let help = page(&fixture.org, &fixture.incident, &fixture.first, A)
                        .await
                        .unwrap();
                    (fixture, help)
                },
                async move { other.start_primary_page().await },
            )
        })
        .await;
        for run in runs {
            let (fixture, help) = run.a;
            assert_one_team_page(&fixture, help, run.b).await;
        }
    }

    async fn assert_one_team_page(fixture: &Fixture, help: TeamPage, primary: Option<Response>) {
        let [stored]: [Response; 1] =
            oncall_responses::list_for_incident(&fixture.org, &fixture.incident)
                .await
                .unwrap()
                .try_into()
                .unwrap();
        assert_eq!(help.state, PageState::Sent);
        assert_eq!(help.response_id.as_deref(), Some(stored.id.as_str()));
        assert_eq!(primary.unwrap().id, stored.id);
        infra::scheduler::get(&fixture.org, TriggerModule::OncallEscalation, &stored.id)
            .await
            .unwrap();
    }
}
