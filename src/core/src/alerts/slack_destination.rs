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

//! Saving a Slack app destination: the refusals of §3.1, §4, §7.8, §10.5 (b) and Q8.

use async_trait::async_trait;
use config::meta::{
    cluster::Node,
    destinations::{Destination, DestinationType, Endpoint, Module, SlackAppTarget},
    oncall::{policy::EscalationPolicy, team::Team},
    slack::{AnswerMode, SetFrom, SlackChannelDefault},
};
use db::alerts::destinations::{DestinationError, SlackAppRefusal};

/// The org's on-call teams and policies, which decide the (b) confirm and the switch refusal.
#[derive(Clone, Debug, Default)]
pub struct OncallRooms {
    pub teams: Vec<Team>,
    pub policies: Vec<EscalationPolicy>,
}

impl OncallRooms {
    /// Destination names a team's room posts to: its own list, else its policy's.
    fn rooms(&self) -> impl Iterator<Item = (&Team, &[String])> {
        self.teams.iter().map(|team| {
            let policy = self
                .policies
                .iter()
                .find(|p| p.team_id == team.id)
                .map(|p| p.destinations.as_slice())
                .unwrap_or_default();
            let room = config::meta::oncall::policy::team_channel(
                team.channel_destinations.as_deref(),
                policy,
            );
            (team, room)
        })
    }

    /// The team that pages through `name`, by its room or its policy.
    pub fn team_using(&self, name: &str) -> Option<String> {
        self.rooms()
            .find(|(_, room)| room.iter().any(|d| d == name))
            .map(|(team, _)| team.name.clone())
            .or_else(|| {
                self.policies
                    .iter()
                    .find(|p| p.destinations.iter().any(|d| d == name))
                    .map(|p| {
                        self.teams
                            .iter()
                            .find(|t| t.id == p.team_id)
                            .map(|t| t.name.clone())
                            .unwrap_or_else(|| p.team_id.clone())
                    })
            })
    }
}

/// What the Slack side says about the target; the enterprise check in production.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TargetFacts {
    pub team_id: String,
    pub is_ext_shared: bool,
}

/// The Slack and cluster reads a save makes, so a test can stand in for Slack and the nodes.
#[async_trait]
pub trait SaveEnv: Send + Sync {
    fn unavailable(&self, org_id: &str) -> Option<String>;
    async fn nodes(&self) -> Vec<Node>;
    async fn check_target(
        &self,
        org_id: &str,
        target: &SlackAppTarget,
    ) -> Result<TargetFacts, SlackAppRefusal>;
    async fn oncall_rooms(&self, org_id: &str) -> Result<OncallRooms, DestinationError>;
    async fn destinations(&self, org_id: &str) -> Result<Vec<Destination>, DestinationError>;
}

/// The running cluster and the live Slack workspace.
pub struct LiveEnv;

#[async_trait]
impl SaveEnv for LiveEnv {
    fn unavailable(&self, org_id: &str) -> Option<String> {
        crate::alerts::slack_publish::unavailable_reason(org_id)
    }

    async fn nodes(&self) -> Vec<Node> {
        infra::cluster::get_cached_online_nodes()
            .await
            .unwrap_or_default()
    }

    async fn check_target(
        &self,
        org_id: &str,
        target: &SlackAppTarget,
    ) -> Result<TargetFacts, SlackAppRefusal> {
        live_check_target(org_id, target).await
    }

    async fn oncall_rooms(&self, org_id: &str) -> Result<OncallRooms, DestinationError> {
        Ok(OncallRooms {
            teams: infra::table::oncall_teams::list(org_id).await?,
            policies: infra::table::oncall_policies::list(org_id).await?,
        })
    }

    async fn destinations(&self, org_id: &str) -> Result<Vec<Destination>, DestinationError> {
        db::alerts::destinations::list(org_id, Some("alert")).await
    }
}

/// The checks that need no I/O; the OSS build refuses every Slack app destination here.
pub fn validate_fields(target: &SlackAppTarget) -> Result<(), DestinationError> {
    if cfg!(not(feature = "enterprise")) {
        return Err(DestinationError::SlackAppNeedsEnterprise);
    }
    if target.installation_id.is_empty() || target.channel_id.is_empty() {
        return Err(refusal(
            400,
            "invalid_slack_app",
            "A Slack app destination needs a workspace and a channel",
        ));
    }
    if target.refire_reuse_minutes > SlackAppTarget::MAX_REFIRE_REUSE_MINUTES {
        return Err(refusal(
            400,
            "invalid_slack_app",
            format!(
                "Re-fire reuse is 0 to {} minutes",
                SlackAppTarget::MAX_REFIRE_REUSE_MINUTES
            ),
        ));
    }
    Ok(())
}

/// Every refusal of a Slack app save, in the order the form resolves them.
pub async fn check_save(
    env: &dyn SaveEnv,
    destination: &Destination,
    target: &SlackAppTarget,
    previous: Option<&Destination>,
) -> Result<(), DestinationError> {
    let org_id = destination.org_id.as_str();
    if let Some(reason) = env.unavailable(org_id) {
        return Err(refusal(400, "slack_unavailable", reason));
    }
    let previous_target = previous.and_then(slack_app_target);
    if previous_target.is_none() {
        version_guard(&env.nodes().await)?;
    }
    let rooms = env.oncall_rooms(org_id).await?;
    if previous.is_some()
        && previous_target.is_none()
        && let Some(team) = rooms.team_using(&destination.name)
    {
        return Err(refusal(
            400,
            "used_by_oncall",
            format!(
                "On-call team {team} pages through {}; Slack app destinations cannot receive \
                 on-call pages, so it stays a webhook",
                destination.name
            ),
        ));
    }
    let facts = env
        .check_target(org_id, target)
        .await
        .map_err(DestinationError::SlackApp)?;
    if facts.is_ext_shared && !target.shared_channel_confirmed {
        return Err(refusal(
            400,
            "shared_channel_unconfirmed",
            format!(
                "#{} is shared with another company, so people outside it will see alert data; \
                 confirm to continue",
                target.channel_name
            ),
        ));
    }
    if !target.oncall_room_confirmed {
        let destinations = env.destinations(org_id).await?;
        if let Some((team, webhook)) = oncall_room(
            target,
            &facts.team_id,
            &destination.name,
            &destinations,
            &rooms,
        ) {
            let mut r = refusal_of(
                400,
                "oncall_room_unconfirmed",
                format!(
                    "On-call pages for team {team} also post to #{} through {webhook}; confirm \
                     that alerts here post separately",
                    target.channel_name
                ),
            );
            r.team = Some(team);
            r.destination = Some(webhook);
            return Err(DestinationError::SlackApp(r));
        }
    }
    Ok(())
}

/// Q8: a node on another release cannot read a Slack app row, so none is written until all match.
pub fn version_guard(nodes: &[Node]) -> Result<(), DestinationError> {
    let own = config::VERSION;
    let other: Vec<String> = nodes
        .iter()
        .filter(|n| n.version != own)
        .map(|n| match n.version.as_str() {
            "" => format!("{} (unknown version)", n.name),
            v => format!("{} ({v})", n.name),
        })
        .collect();
    if other.is_empty() {
        return Ok(());
    }
    Err(refusal(
        409,
        "version_mismatch",
        format!(
            "Upgrade every node first: {} not on {own}",
            other.join(", ")
        ),
    ))
}

/// (b): an on-call team's room is this channel through a Slack webhook destination.
pub fn oncall_room(
    target: &SlackAppTarget,
    team_id: &str,
    own_name: &str,
    destinations: &[Destination],
    rooms: &OncallRooms,
) -> Option<(String, String)> {
    let webhooks: Vec<&str> = destinations
        .iter()
        .filter(|d| d.name != own_name)
        .filter(|d| webhook_endpoint(d).is_some_and(|e| posts_to(e, team_id, &target.channel_id)))
        .map(|d| d.name.as_str())
        .collect();
    rooms.rooms().find_map(|(team, room)| {
        room.iter()
            .find(|name| webhooks.contains(&name.as_str()))
            .map(|name| (team.name.clone(), name.clone()))
    })
}

/// A row this release wrote that the running node cannot decode is a newer release's (R-128).
pub fn newer_row(name: &str) -> DestinationError {
    refusal(
        409,
        "version_mismatch",
        format!(
            "Destination {name} was saved by a newer release of OpenObserve; upgrade every node \
             first"
        ),
    )
}

/// Fills the channel's default org when it has none; never moves one (§7.3, R-80).
pub async fn fill_channel_default(org_id: &str, target: &SlackAppTarget, by: &str) {
    let row = SlackChannelDefault {
        installation_id: target.installation_id.clone(),
        channel_id: target.channel_id.clone(),
        channel_name: target.channel_name.clone(),
        org_id: org_id.to_string(),
        answer_mode: AnswerMode::Thread,
        set_from: SetFrom::Destination,
        updated_by: by.to_string(),
        updated_at: config::utils::time::now_micros(),
        origin_region: String::new(),
        deleted_at: None,
    };
    match infra::table::slack_channel_defaults::insert_if_absent(&row).await {
        Ok(true) => log::info!(
            "[SLACK_DESTINATION] #{} on {} now answers for org {org_id}",
            target.channel_name,
            target.installation_id
        ),
        Ok(false) => {}
        Err(e) => log::warn!(
            "[SLACK_DESTINATION] could not set the default of #{}: {e}",
            target.channel_name
        ),
    }
}

/// The target of a Slack app destination; `None` for any other kind.
pub fn slack_app_target(d: &Destination) -> Option<&SlackAppTarget> {
    match &d.module {
        Module::Alert {
            destination_type: DestinationType::SlackApp(t),
            ..
        } => Some(t),
        _ => None,
    }
}

#[cfg(feature = "enterprise")]
async fn live_check_target(
    org_id: &str,
    target: &SlackAppTarget,
) -> Result<TargetFacts, SlackAppRefusal> {
    o2_enterprise::enterprise::slack::alerts::destination::check_target(org_id, target)
        .await
        .map(|f| TargetFacts {
            team_id: f.team_id,
            is_ext_shared: f.is_ext_shared,
        })
        .map_err(|e| SlackAppRefusal::new(400, "slack_target", e.message))
}

#[cfg(not(feature = "enterprise"))]
async fn live_check_target(
    _org_id: &str,
    _target: &SlackAppTarget,
) -> Result<TargetFacts, SlackAppRefusal> {
    Err(SlackAppRefusal::new(
        403,
        "slack_target",
        "Slack app needs Enterprise",
    ))
}

fn webhook_endpoint(d: &Destination) -> Option<&Endpoint> {
    match &d.module {
        Module::Alert {
            destination_type: DestinationType::Http(e),
            ..
        } => Some(e),
        _ => None,
    }
}

/// Phase 1 records the team and channel on a webhook made through Connect (repo.rs).
fn posts_to(e: &Endpoint, team_id: &str, channel_id: &str) -> bool {
    let meta = |k: &str| e.metadata.get(k).map(String::as_str).unwrap_or_default();
    meta("slack_channel_id") == channel_id
        && (meta("slack_team_id").is_empty()
            || team_id.is_empty()
            || meta("slack_team_id") == team_id)
}

fn refusal(status: u16, code: &'static str, message: impl Into<String>) -> DestinationError {
    DestinationError::SlackApp(refusal_of(status, code, message))
}

fn refusal_of(status: u16, code: &'static str, message: impl Into<String>) -> SlackAppRefusal {
    SlackAppRefusal::new(status, code, message)
}

#[cfg(test)]
mod tests {
    use config::meta::cluster::{NodeStatus, RoleGroup};
    use hashbrown::HashMap;

    use super::*;

    #[derive(Default)]
    struct FakeEnv {
        unavailable: Option<String>,
        versions: Vec<&'static str>,
        facts: TargetFacts,
        target_refusal: Option<SlackAppRefusal>,
        rooms: OncallRooms,
        destinations: Vec<Destination>,
    }

    #[async_trait]
    impl SaveEnv for FakeEnv {
        fn unavailable(&self, _org_id: &str) -> Option<String> {
            self.unavailable.clone()
        }

        async fn nodes(&self) -> Vec<Node> {
            self.versions
                .iter()
                .enumerate()
                .map(|(i, v)| node(&format!("node-{i}"), v))
                .collect()
        }

        async fn check_target(
            &self,
            _org_id: &str,
            _target: &SlackAppTarget,
        ) -> Result<TargetFacts, SlackAppRefusal> {
            match &self.target_refusal {
                Some(r) => Err(r.clone()),
                None => Ok(self.facts.clone()),
            }
        }

        async fn oncall_rooms(&self, _org_id: &str) -> Result<OncallRooms, DestinationError> {
            Ok(self.rooms.clone())
        }

        async fn destinations(&self, _org_id: &str) -> Result<Vec<Destination>, DestinationError> {
            Ok(self.destinations.clone())
        }
    }

    fn node(name: &str, version: &str) -> Node {
        Node {
            id: 0,
            uuid: name.into(),
            name: name.into(),
            http_addr: String::new(),
            grpc_addr: String::new(),
            role: vec![],
            role_group: RoleGroup::None,
            cpu_num: 1,
            scheduled: false,
            broadcasted: false,
            status: NodeStatus::Online,
            metrics: Default::default(),
            version: version.into(),
        }
    }

    fn env() -> FakeEnv {
        FakeEnv {
            versions: vec![config::VERSION, config::VERSION],
            facts: TargetFacts {
                team_id: "T0FAKE00001".into(),
                is_ext_shared: false,
            },
            ..Default::default()
        }
    }

    fn target() -> SlackAppTarget {
        SlackAppTarget {
            installation_id: "I0FAKE00001".into(),
            channel_id: "C0FAKE00001".into(),
            channel_name: "sre-prod".into(),
            ..Default::default()
        }
    }

    fn app(name: &str, target: SlackAppTarget) -> Destination {
        Destination {
            id: None,
            org_id: "prod".into(),
            name: name.into(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::SlackApp(target),
            },
        }
    }

    fn webhook(name: &str, channel_id: &str) -> Destination {
        Destination {
            id: None,
            org_id: "prod".into(),
            name: name.into(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://hooks.slack.com/services/T0FAKE/B0FAKE/x".into(),
                    metadata: HashMap::from([
                        ("prebuilt_type".to_string(), "slack".to_string()),
                        ("slack_team_id".to_string(), "T0FAKE00001".to_string()),
                        ("slack_channel_id".to_string(), channel_id.to_string()),
                    ]),
                    ..Default::default()
                }),
            },
        }
    }

    fn team(id: &str, name: &str, room: &[&str]) -> Team {
        Team {
            id: id.into(),
            org_id: "prod".into(),
            name: name.into(),
            timezone: "UTC".into(),
            description: None,
            channel_destinations: Some(room.iter().map(|s| s.to_string()).collect()),
            created_at: 0,
            updated_at: 0,
        }
    }

    fn code(r: Result<(), DestinationError>) -> SlackAppRefusal {
        match r {
            Err(DestinationError::SlackApp(r)) => r,
            other => panic!("expected a Slack app refusal, got {other:?}"),
        }
    }

    async fn save_check(
        env: &FakeEnv,
        d: &Destination,
        previous: Option<&Destination>,
    ) -> Result<(), DestinationError> {
        let t = slack_app_target(d).unwrap().clone();
        check_save(env, d, &t, previous).await
    }

    #[tokio::test]
    async fn a_plain_save_passes_every_check() {
        save_check(&env(), &app("sre", target()), None)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_super_cluster_or_disabled_slack_refuses_with_the_reason() {
        let env = FakeEnv {
            unavailable: Some("Slack is not available on super-cluster deployments".into()),
            ..env()
        };
        let r = code(save_check(&env, &app("sre", target()), None).await);
        assert_eq!((r.status, r.code), (400, "slack_unavailable"));
        assert_eq!(
            r.message,
            "Slack is not available on super-cluster deployments"
        );
    }

    #[tokio::test]
    async fn the_version_guard_refuses_a_create_and_a_switch_but_not_an_edit() {
        let env = FakeEnv {
            versions: vec![config::VERSION, "v0.80.0-fake"],
            ..env()
        };
        let r = code(save_check(&env, &app("sre", target()), None).await);
        assert_eq!((r.status, r.code), (409, "version_mismatch"));
        assert!(
            r.message.starts_with("Upgrade every node first"),
            "{}",
            r.message
        );
        assert!(r.message.contains("node-1 (v0.80.0-fake)"), "{}", r.message);
        if !config::VERSION.is_empty() {
            let r = code(version_guard(&[node("old-node", "")]));
            assert!(
                r.message.contains("old-node (unknown version)"),
                "{}",
                r.message
            );
        }
        let was_webhook = webhook("sre", "C0FAKE00009");
        let r = code(save_check(&env, &app("sre", target()), Some(&was_webhook)).await);
        assert_eq!(
            r.code, "version_mismatch",
            "a switch writes a new-type row too"
        );
        let was_app = app("sre", target());
        save_check(&env, &app("sre", target()), Some(&was_app))
            .await
            .expect("an existing Slack app row is already unreadable to the old node");
    }

    #[tokio::test]
    async fn a_shared_channel_needs_the_tick() {
        let env = FakeEnv {
            facts: TargetFacts {
                team_id: "T0FAKE00001".into(),
                is_ext_shared: true,
            },
            ..env()
        };
        let r = code(save_check(&env, &app("sre", target()), None).await);
        assert_eq!((r.status, r.code), (400, "shared_channel_unconfirmed"));
        let ticked = SlackAppTarget {
            shared_channel_confirmed: true,
            ..target()
        };
        save_check(&env, &app("sre", ticked), None).await.unwrap();
    }

    #[tokio::test]
    async fn an_oncall_teams_room_needs_the_tick_and_names_the_team_and_webhook() {
        let env = FakeEnv {
            rooms: OncallRooms {
                teams: vec![
                    team("t1", "payments", &["pay-slack"]),
                    team("t2", "search", &["search-slack"]),
                ],
                policies: vec![],
            },
            destinations: vec![
                webhook("pay-slack", "C0FAKE00001"),
                webhook("search-slack", "C0FAKE00002"),
            ],
            ..env()
        };
        let r = code(save_check(&env, &app("sre", target()), None).await);
        assert_eq!((r.status, r.code), (400, "oncall_room_unconfirmed"));
        assert_eq!(r.team.as_deref(), Some("payments"));
        assert_eq!(r.destination.as_deref(), Some("pay-slack"));
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["code"], "oncall_room_unconfirmed");
        assert_eq!(json["team"], "payments");
        assert!(json.get("status").is_none());
        let ticked = SlackAppTarget {
            oncall_room_confirmed: true,
            ..target()
        };
        save_check(&env, &app("sre", ticked), None).await.unwrap();
        let other = SlackAppTarget {
            channel_id: "C0FAKE00003".into(),
            ..target()
        };
        save_check(&env, &app("sre", other), None)
            .await
            .expect("no team pages into that channel");
    }

    #[tokio::test]
    async fn a_webhook_an_oncall_team_pages_through_is_not_switched() {
        let env = FakeEnv {
            rooms: OncallRooms {
                teams: vec![team("t1", "payments", &["pay-slack"])],
                policies: vec![],
            },
            ..env()
        };
        let previous = webhook("pay-slack", "C0FAKE00001");
        let r = code(save_check(&env, &app("pay-slack", target()), Some(&previous)).await);
        assert_eq!((r.status, r.code), (400, "used_by_oncall"));
        assert!(r.message.contains("payments"), "{}", r.message);
    }

    #[tokio::test]
    async fn the_slack_sides_refusal_is_passed_through() {
        let env = FakeEnv {
            target_refusal: Some(SlackAppRefusal::new(
                400,
                "slack_target",
                "#sre-prod is archived",
            )),
            ..env()
        };
        let r = code(save_check(&env, &app("sre", target()), None).await);
        assert_eq!(
            (r.code, r.message.as_str()),
            ("slack_target", "#sre-prod is archived")
        );
    }

    #[test]
    fn field_checks_refuse_a_missing_channel_and_a_long_reuse_window() {
        if cfg!(not(feature = "enterprise")) {
            assert!(matches!(
                validate_fields(&target()),
                Err(DestinationError::SlackAppNeedsEnterprise)
            ));
            return;
        }
        validate_fields(&target()).unwrap();
        let no_channel = SlackAppTarget {
            channel_id: String::new(),
            ..target()
        };
        assert_eq!(code(validate_fields(&no_channel)).code, "invalid_slack_app");
        let long = SlackAppTarget {
            refire_reuse_minutes: 241,
            ..target()
        };
        assert_eq!(code(validate_fields(&long)).code, "invalid_slack_app");
    }
}
