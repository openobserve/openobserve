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

use config::meta::{
    alerts::auto_investigate::GateSettings,
    destinations::{Destination, DestinationType, Endpoint, HTTPOutputFormat, HTTPType, Module},
};
use hashbrown::HashMap;
use o2_enterprise::enterprise::{
    common::auditor::AuditMessage,
    slack::{
        self,
        hooks::{
            AlertRcaRefusal, AlertRcaRequest, AlertRcaStart, AlertRcaVerdict, AlertViewKey, BoxFut,
            ChartSeries, CreatedDestination, DestinationRefusal, GateFacts, SlackAppDestination,
            SlackHooks, WebhookDestination,
        },
    },
};
use openobserve_core::alerts::notifications::chart::{
    self as alert_chart,
    payload::{ChartPayload, downsample},
};

const PREBUILT_TYPE: &str = "slack";
const PREBUILT_TEMPLATE: &str = "prebuilt_slack";

/// The F5 hooks, built from the OpenObserve services the enterprise crate cannot depend on.
pub fn hooks() -> SlackHooks {
    SlackHooks {
        domain_mappings_for_org,
        is_org_blocked: db::org_status::is_blocked,
        create_webhook_destination,
        create_slack_app_destination,
        alert_message_view,
        render_chart_png,
        shorten_url,
        audit,
        auto_investigate_facts,
        auto_investigate_settings,
        start_alert_rca,
        running_rca_verdict,
        publish_auto_investigate_decision: usage_reporting::publish_auto_investigate_decision,
    }
}

/// Runs on every node role and before `slack::boot`, so every task `boot` starts finds the hooks.
pub fn register() {
    slack::hooks::register(hooks());
}

fn domain_mappings_for_org(org_id: String) -> BoxFut<anyhow::Result<Vec<String>>> {
    Box::pin(async move { mapped_domains(&org_id).await })
}

#[cfg(feature = "cloud")]
async fn mapped_domains(org_id: &str) -> anyhow::Result<Vec<String>> {
    // A blocked org's domain is not passed on to the next mapping (`process_domain_org_mapping`).
    if db::org_status::is_blocked(org_id) {
        return Ok(vec![]);
    }
    let settings = db::organization::get_org_setting(config::META_ORG_ID).await?;
    let mappings = settings
        .domain_org_mappings
        .iter()
        .map(|m| (m.domain.as_str(), m.org_id.as_str()));
    Ok(first_match_domains(mappings, org_id))
}

#[cfg(not(feature = "cloud"))]
async fn mapped_domains(_org_id: &str) -> anyhow::Result<Vec<String>> {
    Ok(vec![])
}

/// Login uses the first mapping per domain, so later ones for that domain never apply.
#[cfg(any(feature = "cloud", test))]
fn first_match_domains<'a>(
    mappings: impl Iterator<Item = (&'a str, &'a str)>,
    org_id: &str,
) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    mappings
        .filter_map(|(domain, mapped_org)| {
            let domain = domain.to_lowercase();
            (seen.insert(domain.clone()) && mapped_org == org_id).then_some(domain)
        })
        .collect()
}

fn create_webhook_destination(d: WebhookDestination) -> BoxFut<anyhow::Result<CreatedDestination>> {
    Box::pin(async move {
        let saved =
            openobserve_core::alerts::destinations::save("", webhook_destination(d), true).await?;
        Ok(CreatedDestination {
            id: saved.id.map(|id| id.to_string()).unwrap_or_default(),
            name: saved.name,
        })
    })
}

fn create_slack_app_destination(
    d: SlackAppDestination,
) -> BoxFut<anyhow::Result<CreatedDestination>> {
    Box::pin(async move {
        let by = d.created_by.clone();
        let destination = Destination {
            id: None,
            org_id: d.org_id,
            name: d.name,
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::SlackApp(d.target),
            },
        };
        let saved = openobserve_core::alerts::destinations::save_by("", destination, true, &by)
            .await
            .map_err(refusal_or_error)?;
        Ok(CreatedDestination {
            id: saved.id.map(|id| id.to_string()).unwrap_or_default(),
            name: saved.name,
        })
    })
}

/// A coded refusal crosses the hook typed, so the setup path can hand the confirm to the form.
fn refusal_or_error(e: db::alerts::destinations::DestinationError) -> anyhow::Error {
    match e {
        db::alerts::destinations::DestinationError::SlackApp(r) => {
            anyhow::Error::new(DestinationRefusal {
                status: r.status,
                code: r.code.to_string(),
                message: r.message,
                team: r.team,
                destination: r.destination,
            })
        }
        e => anyhow::Error::new(e),
    }
}

fn alert_message_view(
    key: AlertViewKey,
) -> BoxFut<anyhow::Result<Option<config::meta::slack::AlertMessageView>>> {
    Box::pin(async move {
        openobserve_core::alerts::slack_view::alert_message_view(
            &key.org_id,
            &key.alert_id,
            &key.group_key,
            key.firing_started_at,
        )
        .await
    })
}

fn auto_investigate_facts(key: AlertViewKey, now: i64) -> BoxFut<anyhow::Result<GateFacts>> {
    Box::pin(async move {
        let f = openobserve_core::alerts::slack_investigate::gate_facts(
            &key.org_id,
            &key.alert_id,
            &key.group_key,
            key.firing_started_at,
            now,
        )
        .await?;
        Ok(GateFacts {
            onsets_7d: f.stats.onsets,
            evaluations_7d: f.stats.evaluations,
            fire_share_7d: f.stats.fire_share,
            rca_running: f.rca_running,
            settings: f.settings,
            settings_version: f.settings_version,
        })
    })
}

fn auto_investigate_settings(org_id: String) -> BoxFut<GateSettings> {
    Box::pin(async move {
        openobserve_core::alerts::slack_investigate::gate_settings(&org_id)
            .await
            .0
    })
}

fn start_alert_rca(req: AlertRcaRequest) -> BoxFut<Result<AlertRcaStart, AlertRcaRefusal>> {
    Box::pin(openobserve_core::alerts::slack_investigate::start_alert_rca(req))
}

fn running_rca_verdict(key: AlertViewKey) -> BoxFut<Option<AlertRcaVerdict>> {
    Box::pin(async move {
        openobserve_core::alerts::slack_investigate::running_rca_verdict(
            &key.org_id,
            &key.alert_id,
            key.firing_started_at,
        )
        .await
    })
}

/// The same destination the web form saves for a Slack OAuth setup (usePrebuiltDestinations.ts).
fn webhook_destination(d: WebhookDestination) -> Destination {
    let mut metadata = HashMap::from([
        ("prebuilt_type".to_string(), PREBUILT_TYPE.to_string()),
        ("setup_method".to_string(), "oauth".to_string()),
    ]);
    for (key, value) in [
        ("credential_channel", &d.channel),
        ("slack_team_id", &d.team_id),
        ("slack_team_name", &d.team_name),
        ("slack_channel_id", &d.channel_id),
    ] {
        let value = value.trim();
        if !value.is_empty() {
            metadata.insert(key.to_string(), value.to_string());
        }
    }
    Destination {
        id: None,
        org_id: d.org_id,
        name: d.name,
        module: Module::Alert {
            template: Some(PREBUILT_TEMPLATE.to_string()),
            destination_type: DestinationType::Http(Endpoint {
                url: d.webhook_url,
                method: HTTPType::POST,
                skip_tls_verify: false,
                headers: Some(HashMap::from([(
                    "Content-Type".to_string(),
                    "application/json".to_string(),
                )])),
                output_format: Some(HTTPOutputFormat::JSON),
                destination_type: Some(PREBUILT_TYPE.to_string()),
                metadata,
            }),
        },
    }
}

fn render_chart_png(chart: ChartSeries) -> BoxFut<Option<Vec<u8>>> {
    Box::pin(async move {
        let payload = chart_payload(&chart)?;
        tokio::task::spawn_blocking(move || alert_chart::try_render_png(&payload))
            .await
            .ok()
            .flatten()
    })
}

/// The alert chart draws one line, so the first series with at least two points is rendered.
fn chart_payload(chart: &ChartSeries) -> Option<ChartPayload> {
    let per_second = match chart.x_unit.as_str() {
        "s" => 1,
        "ms" => 1_000,
        _ => 1_000_000,
    };
    let (_, points) = chart.series.iter().find(|(_, points)| points.len() > 1)?;
    let mut secs: Vec<(u64, f64)> = points
        .iter()
        .filter(|(ts, value)| *ts >= 0 && value.is_finite())
        .map(|(ts, value)| ((ts / per_second) as u64, *value))
        .collect();
    secs.sort_by_key(|(ts, _)| *ts);
    let points = downsample(&secs);
    let trigger_ts = points.last()?.0;
    (points.len() > 1).then(|| ChartPayload {
        v: 1,
        // Only a signed chart URL checks `exp`; this payload is rendered in process.
        exp: trigger_ts,
        title: chart.title.clone(),
        points,
        crit: None,
        warn: None,
        trigger_ts,
    })
}

fn shorten_url(org_id: String, url: String) -> BoxFut<anyhow::Result<String>> {
    Box::pin(async move { openobserve_core::short_url::shorten(&org_id, &url).await })
}

fn audit(msg: AuditMessage) -> BoxFut<()> {
    Box::pin(::audit::audit(msg))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chart(x_unit: &str, series: Vec<(String, Vec<(i64, f64)>)>) -> ChartSeries {
        ChartSeries {
            title: "errors".to_string(),
            x_unit: x_unit.to_string(),
            series,
        }
    }

    #[test]
    fn first_match_domains_keeps_the_first_mapping_per_domain() {
        let mappings = [
            ("acme.com", "acme"),
            ("ACME.io", "acme"),
            ("shared.com", "first"),
            ("shared.com", "acme"),
            ("Acme.com", "other"),
            ("beta.com", "beta"),
        ];
        assert_eq!(
            first_match_domains(mappings.into_iter(), "acme"),
            vec!["acme.com", "acme.io"]
        );
        assert_eq!(
            first_match_domains(mappings.into_iter(), "first"),
            vec!["shared.com"]
        );
        assert!(first_match_domains(mappings.into_iter(), "other").is_empty());
    }

    #[test]
    fn webhook_destination_matches_the_web_oauth_metadata() {
        let d = webhook_destination(WebhookDestination {
            org_id: "acme".to_string(),
            name: "alerts".to_string(),
            webhook_url: "https://hooks.slack.com/services/T/B/x".to_string(),
            channel: " ".to_string(),
            channel_id: "C1".to_string(),
            team_id: "T1".to_string(),
            team_name: "Acme".to_string(),
        });
        let Module::Alert {
            destination_type: DestinationType::Http(endpoint),
            ..
        } = d.module
        else {
            panic!("an alert webhook destination");
        };
        assert!(
            !endpoint.metadata.contains_key("credential_channel"),
            "blank values are left out, as the web does"
        );
        assert_eq!(endpoint.metadata.len(), 5);
    }

    #[test]
    fn chart_payload_converts_microseconds_and_picks_the_first_drawable_series() {
        let p = chart_payload(&chart(
            "us",
            vec![
                ("lonely".to_string(), vec![(5_000_000, 1.0)]),
                (
                    "p95".to_string(),
                    vec![(3_000_000, 3.0), (1_000_000, 1.0), (2_000_000, f64::NAN)],
                ),
            ],
        ))
        .expect("drawable");
        assert_eq!(p.points, vec![(1, 1.0), (3, 3.0)]);
        assert_eq!(p.trigger_ts, 3);
        assert_eq!(p.title, "errors");
        let ms = chart_payload(&chart(
            "ms",
            vec![("a".to_string(), vec![(1_000, 1.0), (2_000, 2.0)])],
        ))
        .unwrap();
        assert_eq!(ms.points, vec![(1, 1.0), (2, 2.0)]);
    }

    #[test]
    fn chart_payload_downsamples_and_refuses_undrawable_input() {
        let long: Vec<(i64, f64)> = (0..500).map(|i| (i * 60_000_000, i as f64)).collect();
        let p = chart_payload(&chart("us", vec![("a".to_string(), long)])).unwrap();
        assert_eq!(p.points.len(), alert_chart::payload::MAX_POINTS);
        assert!(chart_payload(&chart("us", vec![])).is_none());
        let one_finite = vec![(1_000_000, 1.0), (2_000_000, f64::INFINITY)];
        assert!(chart_payload(&chart("us", vec![("a".to_string(), one_finite)])).is_none());
    }
}
