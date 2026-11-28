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

use config::meta::oncall::{ResponderRole, SubjectRef, SubjectType};
use o2_enterprise::enterprise::{
    common::config::with_incidents_v2,
    oncall::{
        escalation,
        notify::{PhoneAction, PressOutcome},
    },
};
use openobserve_core::alerts::ack::{Act, Caller, Verb};

use super::*;

struct Orphan {
    org: String,
    incident: String,
    page: String,
    actor: String,
}

impl Orphan {
    async fn new() -> Option<Self> {
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return None;
        }
        crate::request::security::tests::meta_store().await;
        let org = format!("s15_orphan_{}", config::ider::uuid());
        let actor = format!("root-{org}@example.com");
        common::infra::config::ORG_USERS.insert(
            format!("{}/{actor}", config::DEFAULT_ORG),
            infra::table::org_users::OrgUserRecord::new(
                config::DEFAULT_ORG,
                &actor,
                config::meta::user::UserRole::Root,
                "token",
                None,
            ),
        );
        let incident = infra::table::alert_incidents::create(
            &org,
            "P3",
            serde_json::json!({}),
            "alert",
            config::utils::time::now_micros(),
            Some("Checkout".to_string()),
        )
        .await
        .unwrap();
        let page = infra::table::oncall_responses::open(
            &org,
            &SubjectRef::new(SubjectType::Alert, config::ider::uuid(), 1),
            None,
            3,
            Some("Checkout"),
            ResponderRole::Owner,
            None,
        )
        .await
        .unwrap();
        infra::table::oncall_responses::attach_incident(&org, &page.id, &incident.id)
            .await
            .unwrap();
        Some(Self {
            org,
            incident: incident.id,
            page: page.id,
            actor,
        })
    }

    async fn lead(&self) -> Option<String> {
        infra::table::alert_incidents::get_rw(&self.org, &self.incident)
            .await
            .unwrap()
            .unwrap()
            .assigned_to
    }
}

#[tokio::test]
async fn an_orphan_page_ack_and_takeover_fill_the_empty_incident_lead() {
    for verb in [Verb::Acknowledge, Verb::TakeOver] {
        let Some(orphan) = Orphan::new().await else {
            return;
        };
        if verb == Verb::TakeOver {
            escalation::acknowledge_as(&orphan.org, &orphan.page, "previous@example.com")
                .await
                .unwrap();
        }
        let caller = Caller::person(&orphan.actor);
        let problem = page_problem_of(&orphan.org, &orphan.page, &caller, verb.into())
            .await
            .unwrap();
        assert!(problem.is_none());
        let ack = acknowledge_page(
            &orphan.org,
            &orphan.page,
            problem.as_ref(),
            &caller,
            verb,
            config::meta::alerts::ack::AckSource::Oncall,
        )
        .await
        .unwrap();
        assert_eq!(orphan.lead().await.as_deref(), Some(orphan.actor.as_str()));
        let response = page_with_ack(&orphan.org, &orphan.page, ack).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["acked"], orphan.actor);
        assert_eq!(body["assigned_to"], orphan.actor);
    }
}

#[tokio::test]
async fn a_phone_ack_of_an_orphan_page_fills_the_empty_incident_lead() {
    let Some(orphan) = Orphan::new().await else {
        return;
    };
    let outcome = act_by_phone(
        orphan.org.clone(),
        orphan.page.clone(),
        orphan.actor.clone(),
        PhoneAction::Acknowledge,
    )
    .await
    .unwrap();
    assert_ne!(outcome, PressOutcome::Refused);
    assert_eq!(orphan.lead().await.as_deref(), Some(orphan.actor.as_str()));
}

#[tokio::test]
async fn an_ai_orphan_page_ack_never_fills_the_empty_incident_lead_with_v2_off() {
    let Some(orphan) = Orphan::new().await else {
        return;
    };
    with_incidents_v2(false, async {
        let caller = Caller {
            email: orphan.actor.clone(),
            ai: true,
        };
        let problem = page_problem_of(&orphan.org, &orphan.page, &caller, Act::Ack)
            .await
            .unwrap();
        assert!(problem.is_none());
        acknowledge_page(
            &orphan.org,
            &orphan.page,
            None,
            &caller,
            Verb::Acknowledge,
            config::meta::alerts::ack::AckSource::Api,
        )
        .await
        .unwrap();
        assert_eq!(orphan.lead().await, None);
    })
    .await;
}

#[tokio::test]
async fn every_ai_action_on_an_incident_linked_orphan_page_is_refused_with_v2_on() {
    let Some(orphan) = Orphan::new().await else {
        return;
    };
    with_incidents_v2(true, async {
        let caller = Caller {
            email: orphan.actor.clone(),
            ai: true,
        };
        for act in [
            Act::Ack,
            Act::Unack,
            Act::TakeOver,
            Act::Resolve,
            Act::Mute,
            Act::Unmute,
            Act::Snooze,
            Act::Unsnooze,
            Act::HandOff,
            Act::Escalate,
            Act::Promote,
            Act::Note,
            Act::ConfirmRecovery,
        ] {
            let error = page_problem_of(&orphan.org, &orphan.page, &caller, act)
                .await
                .unwrap_err();
            assert!(
                matches!(error, openobserve_core::alerts::ack::AckError::Refused(_)),
                "{act:?}"
            );
        }
    })
    .await;
    assert_eq!(orphan.lead().await, None);
    assert!(
        infra::table::oncall_responses::list_events(&orphan.page)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn a_page_outside_any_incident_always_refuses_ai() {
    let Some(orphan) = Orphan::new().await else {
        return;
    };
    let mut page = infra::table::oncall_responses::get(&orphan.org, &orphan.page)
        .await
        .unwrap()
        .unwrap();
    page.incident_id = None;
    let caller = Caller {
        email: orphan.actor,
        ai: true,
    };
    for enabled in [false, true] {
        with_incidents_v2(enabled, async {
            assert!(
                openobserve_core::alerts::ack::authorize_orphan_page(&page, &caller, Act::Ack)
                    .await
                    .is_err()
            );
        })
        .await;
    }
}

#[tokio::test]
async fn wrapped_page_revision_conflicts_return_409() {
    let error = infra::errors::Error::OtherError(anyhow::Error::new(
        infra::table::oncall_responses::ResponseConflict {
            response_id: "changed-page".to_string(),
        },
    ));
    let response = to_response(anyhow::Error::from(error).context("page update"));
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        body["message"],
        "The on-call page changed. Refresh it before trying again."
    );
}
