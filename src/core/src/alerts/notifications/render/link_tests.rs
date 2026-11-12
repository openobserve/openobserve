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

//! The data button and the object button on every renderer, per kind.

use config::meta::alerts::{content_spec::ContentLink, notification_kind::NotificationKind};
use serde_json::Value;

use super::{ChannelFormat, RenderedMessage, render};
use crate::alerts::notifications::{
    context::NotificationContext, default_template::compiled_default_content,
    examples::example_context, preview::synthetic_context, resolve::resolve_content,
};

const ALERT_URL: &str = "https://o2.acme.com/web/short/ab12";
const DETAIL_URL: &str = "https://o2.acme.com/web/alerts/detail/7Kx2?org_identifier=acme";

fn alert_ctx() -> NotificationContext {
    let mut ctx = synthetic_context(Some(config::meta::alerts::level::AlertLevel::Critical));
    ctx.alert_url = ALERT_URL.into();
    ctx.alert_url_label = "View logs".into();
    ctx.alert_detail_url = DETAIL_URL.into();
    ctx.alert_detail_label = "Open alert".into();
    ctx
}

fn rendered(format: ChannelFormat, ctx: &NotificationContext, links: &[(&str, &str)]) -> Value {
    let mut spec = compiled_default_content();
    spec.links = links
        .iter()
        .map(|(label, url)| ContentLink {
            label: (*label).into(),
            url: (*url).into(),
            show_when: None,
        })
        .collect();
    let content = resolve_content(&spec, ctx, format.channel_family());
    match render(format, &content, ctx).unwrap() {
        RenderedMessage::Http { body } => serde_json::from_str(&body).unwrap(),
        RenderedMessage::Email {
            subject,
            html,
            text,
        } => serde_json::json!({"subject": subject, "html": html, "text": text}),
        RenderedMessage::Sns { subject, message } => {
            serde_json::json!({"subject": subject, "message": message})
        }
    }
}

fn slack_blocks<'a>(v: &'a Value, kind: &str) -> Vec<&'a Value> {
    v["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|b| b["type"] == kind)
        .collect()
}

fn slack_buttons(v: &Value) -> Vec<(String, String, Value)> {
    slack_blocks(v, "actions")
        .first()
        .map(|b| {
            b["elements"]
                .as_array()
                .unwrap()
                .iter()
                .map(|e| {
                    (
                        e["text"]["text"].as_str().unwrap().to_string(),
                        e["url"].as_str().unwrap().to_string(),
                        e["style"].clone(),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Labels and URLs of every system button the channel shows, in order.
fn system_buttons(format: ChannelFormat, v: &Value) -> Vec<(String, String)> {
    let pair = |l: &Value, u: &Value| {
        (
            l.as_str().unwrap_or_default().to_string(),
            u.as_str().unwrap_or_default().to_string(),
        )
    };
    match format {
        ChannelFormat::Slack => slack_buttons(v)
            .into_iter()
            .map(|(l, u, _)| (l, u))
            .collect(),
        ChannelFormat::TeamsAdaptiveCard => v["attachments"][0]["content"]["actions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| pair(&a["title"], &a["url"]))
            .collect(),
        ChannelFormat::TeamsMessageCard => v["potentialAction"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| pair(&a["name"], &a["targets"][0]["uri"]))
            .collect(),
        ChannelFormat::PagerDuty => v["links"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| pair(&a["text"], &a["href"]))
            .collect(),
        other => panic!("{other:?} has no button list"),
    }
}

const BUTTON_FORMATS: [ChannelFormat; 4] = [
    ChannelFormat::Slack,
    ChannelFormat::TeamsAdaptiveCard,
    ChannelFormat::TeamsMessageCard,
    ChannelFormat::PagerDuty,
];

#[test]
fn an_alert_shows_the_data_button_then_the_object_button_on_every_button_channel() {
    let ctx = alert_ctx();
    for format in BUTTON_FORMATS {
        let v = rendered(format, &ctx, &[]);
        assert_eq!(
            system_buttons(format, &v),
            vec![
                ("View logs".to_string(), ALERT_URL.to_string()),
                ("Open alert".to_string(), DETAIL_URL.to_string()),
            ],
            "{format:?}: {v:#}"
        );
    }
    let slack = rendered(ChannelFormat::Slack, &ctx, &[]);
    let styles: Vec<Value> = slack_buttons(&slack).into_iter().map(|b| b.2).collect();
    assert_eq!(styles, vec![serde_json::json!("primary"), Value::Null]);
    let teams = rendered(ChannelFormat::TeamsAdaptiveCard, &ctx, &[]);
    let actions = &teams["attachments"][0]["content"]["actions"];
    assert_eq!(actions[0]["style"], "positive");
    assert!(actions[1].get("style").is_none(), "{actions:#}");
}

#[test]
fn an_alert_email_has_a_filled_data_button_and_an_outlined_object_button() {
    let v = rendered(ChannelFormat::Email, &alert_ctx(), &[]);
    let html = v["html"].as_str().unwrap();
    let data = html.find(">View logs</a>").expect("data button");
    let object = html.find(">Open alert</a>").expect("object button");
    assert!(data < object);
    let object_tag = &html[html[..object].rfind("<a ").unwrap()..object];
    assert!(object_tag.contains("border:1px solid"), "{object_tag}");
    assert!(!object_tag.contains("background-color"), "{object_tag}");
    let text = v["text"].as_str().unwrap();
    assert!(
        text.contains(&format!(
            "View logs: {ALERT_URL}\nOpen alert: {}",
            DETAIL_URL
        )),
        "{text}"
    );
}

#[test]
fn an_alert_on_discord_sns_and_webhook_carries_both_links_where_each_contract_allows() {
    let ctx = alert_ctx();
    let discord = rendered(ChannelFormat::Discord, &ctx, &[]);
    assert_eq!(discord["embeds"][0]["url"], ALERT_URL);
    let description = discord["embeds"][0]["description"].as_str().unwrap();
    assert!(
        description.contains(&format!("[Open alert]({DETAIL_URL})")),
        "{description}"
    );

    let sns = rendered(ChannelFormat::Sns, &ctx, &[]);
    let message = sns["message"].as_str().unwrap();
    assert!(
        message.ends_with(&format!("View logs: {ALERT_URL}\nOpen alert: {DETAIL_URL}")),
        "{message}"
    );

    let webhook = rendered(
        ChannelFormat::Webhook,
        &ctx,
        &[("Runbook", "https://wiki/rb")],
    );
    assert_eq!(
        webhook["links"],
        serde_json::json!([
            {"label": "Runbook", "url": "https://wiki/rb"},
            {"label": "", "url": ALERT_URL},
        ]),
        "the Detail link stays out of links[]"
    );
    let context = &webhook["context"];
    assert_eq!(context["alert_url_label"], "View logs");
    assert_eq!(context["alert_detail_url"], DETAIL_URL);
    assert_eq!(context["alert_detail_label"], "Open alert");
}

#[test]
fn an_incident_shows_open_incident_then_open_alert() {
    let ctx = example_context(NotificationKind::Incident, false);
    for format in BUTTON_FORMATS {
        let v = rendered(format, &ctx, &[]);
        let buttons = system_buttons(format, &v);
        assert_eq!(buttons.len(), 2, "{format:?}: {v:#}");
        assert_eq!(buttons[0].0, "Open incident");
        assert!(
            buttons[0].1.contains("/web/incidents/inc_7f3a"),
            "{buttons:?}"
        );
        assert_eq!(buttons[1].0, "Open alert");
        assert!(
            buttons[1].1.contains("/web/alerts/detail/7Kx2"),
            "{buttons:?}"
        );
    }
    let mut no_source = ctx.clone();
    no_source.alert_detail_url.clear();
    no_source.alert_detail_label.clear();
    for format in BUTTON_FORMATS {
        let v = rendered(format, &no_source, &[]);
        let labels: Vec<String> = system_buttons(format, &v)
            .into_iter()
            .map(|b| b.0)
            .collect();
        assert_eq!(labels, vec!["Open incident"], "{format:?}");
    }
}

#[test]
fn single_button_kinds_show_one_system_button_with_their_label() {
    for (kind, label) in [
        (NotificationKind::Downtime, "Open downtime"),
        (NotificationKind::Synthetics, "Open check"),
        (NotificationKind::OnCall, "Open page"),
    ] {
        let ctx = example_context(kind, false);
        for format in BUTTON_FORMATS {
            let v = rendered(format, &ctx, &[]);
            let labels: Vec<String> = system_buttons(format, &v)
                .into_iter()
                .map(|b| b.0)
                .collect();
            assert_eq!(labels, vec![label], "{kind:?} {format:?}");
        }
    }
    let anomaly = example_context(NotificationKind::Anomaly, false);
    let spec = compiled_default_content();
    let content = resolve_content(&spec, &anomaly, "slack");
    let slack = match render(ChannelFormat::Slack, &content, &anomaly).unwrap() {
        RenderedMessage::Http { body } => serde_json::from_str::<Value>(&body).unwrap(),
        other => panic!("{other:?}"),
    };
    let labels: Vec<String> = slack_buttons(&slack).into_iter().map(|b| b.0).collect();
    assert_eq!(
        labels,
        vec!["View data around the window", "Open detector"],
        "the explore link keeps its own label"
    );
}

#[test]
fn a_composite_alert_shows_one_open_alert_button() {
    let mut ctx = alert_ctx();
    ctx.alert_url = DETAIL_URL.into();
    ctx.alert_url_label = "Open alert".into();
    ctx.alert_detail_url.clear();
    ctx.alert_detail_label.clear();
    for format in BUTTON_FORMATS {
        let v = rendered(format, &ctx, &[]);
        assert_eq!(
            system_buttons(format, &v),
            vec![("Open alert".to_string(), DETAIL_URL.to_string())],
            "{format:?}"
        );
    }
    let mut same = alert_ctx();
    same.alert_detail_url = same.alert_url.clone();
    let v = rendered(ChannelFormat::Slack, &same, &[]);
    assert_eq!(
        slack_buttons(&v).len(),
        1,
        "a Detail equal to alert_url drops"
    );
}

#[test]
fn an_empty_web_url_drops_the_object_button_and_keeps_todays_data_button() {
    let mut ctx = alert_ctx();
    ctx.alert_url = "/web/logs?stream=app".into();
    ctx.alert_detail_url.clear();
    ctx.alert_detail_label.clear();
    for format in BUTTON_FORMATS {
        let v = rendered(format, &ctx, &[]);
        assert!(system_buttons(format, &v).is_empty(), "{format:?}: {v:#}");
    }
    let email = rendered(ChannelFormat::Email, &ctx, &[]);
    assert!(
        email["text"]
            .as_str()
            .unwrap()
            .contains("View logs: /web/logs?stream=app")
    );
    assert!(!email.to_string().contains("Open alert"));
}

#[test]
fn slack_puts_authored_links_that_do_not_fit_into_one_context_block() {
    let links = [
        ("A", "https://x/a"),
        ("B", "https://x/b"),
        ("C", "https://x/c"),
        ("D", "https://x/d"),
    ];
    let v = rendered(ChannelFormat::Slack, &alert_ctx(), &links);
    let labels: Vec<String> = slack_buttons(&v).into_iter().map(|b| b.0).collect();
    assert_eq!(labels, vec!["A", "B", "C", "View logs", "Open alert"]);
    let context = slack_blocks(&v, "context");
    let overflow = context.last().expect("context block");
    assert_eq!(
        overflow["elements"],
        serde_json::json!([{"type": "mrkdwn", "text": "<https://x/d|D>"}])
    );
}

#[test]
fn slack_counts_links_it_cannot_show_and_never_cuts_one() {
    let long = format!("https://x/{}", "a".repeat(3_100));
    let mut links: Vec<(String, String)> = (0..3)
        .map(|i| (format!("L{i}"), format!("https://x/{i}")))
        .collect();
    links.push(("Long".into(), long));
    links.extend((10..21).map(|i| (format!("L{i}"), format!("https://x/{i}"))));
    let refs: Vec<(&str, &str)> = links
        .iter()
        .map(|(l, u)| (l.as_str(), u.as_str()))
        .collect();
    let v = rendered(ChannelFormat::Slack, &alert_ctx(), &refs);
    let context = slack_blocks(&v, "context");
    let elements = context.last().unwrap()["elements"].as_array().unwrap();
    assert_eq!(elements.len(), 10, "nine links and the count");
    assert!(
        elements
            .iter()
            .all(|e| { e["text"].as_str().unwrap().chars().count() <= 3_000 })
    );
    assert!(
        !elements[..9]
            .iter()
            .any(|e| e["text"].as_str().unwrap().contains("|Long>"))
    );
    assert_eq!(elements[9]["text"], "3 more links not shown");
}

#[test]
fn an_authored_link_to_the_detail_page_shows_once_and_keeps_its_slot() {
    let links = [
        ("A", "https://x/a"),
        ("B", "https://x/b"),
        ("C", "https://x/c"),
        ("D", "https://x/d"),
        ("My alert", DETAIL_URL),
    ];
    let v = rendered(ChannelFormat::Slack, &alert_ctx(), &links);
    let labels: Vec<String> = slack_buttons(&v).into_iter().map(|b| b.0).collect();
    assert_eq!(labels, vec!["A", "B", "C", "My alert", "View logs"]);
    assert!(!v.to_string().contains("Open alert"), "{v:#}");
    let overflow = slack_blocks(&v, "context");
    assert_eq!(
        overflow.last().unwrap()["elements"][0]["text"],
        "<https://x/d|D>"
    );
    let webhook = rendered(ChannelFormat::Webhook, &alert_ctx(), &links);
    let labels: Vec<&str> = webhook["links"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels, vec!["A", "B", "C", "D", "My alert", ""]);
}

#[test]
fn a_long_body_never_pushes_the_object_link_out_of_discord_or_jira() {
    let mut ctx = alert_ctx();
    let mut spec = compiled_default_content();
    spec.links.clear();
    spec.body = "x".repeat(10_000);
    let content = resolve_content(&spec, &ctx, "discord");
    let RenderedMessage::Http { body } = render(ChannelFormat::Discord, &content, &ctx).unwrap()
    else {
        panic!("discord renders http");
    };
    let v: Value = serde_json::from_str(&body).unwrap();
    let description = v["embeds"][0]["description"].as_str().unwrap();
    assert!(description.chars().count() <= 4_096);
    assert!(
        description.ends_with(&format!("[Open alert]({DETAIL_URL})")),
        "{}",
        &description[description.len() - 80..]
    );
    ctx.alert_description = "y".repeat(40_000);
    let jira = crate::alerts::notifications::jira::description_for_test(&ctx);
    assert!(
        jira.contains(&format!("View logs: {ALERT_URL}")),
        "{}",
        &jira[..200]
    );
    assert!(jira.contains(&format!("Open alert: {DETAIL_URL}")));
}

#[test]
fn slack_overflow_links_escape_their_url_for_mrkdwn() {
    let links = [
        ("A", "https://x/a"),
        ("B", "https://x/b"),
        ("C", "https://x/c"),
        ("D|E", "https://wiki/a?x=1&y=<2>|z"),
    ];
    let v = rendered(ChannelFormat::Slack, &alert_ctx(), &links);
    let context = slack_blocks(&v, "context");
    assert_eq!(
        context.last().unwrap()["elements"][0]["text"],
        "<https://wiki/a?x=1&amp;y=%3C2%3E%7Cz|D\u{ff5c}E>"
    );
}
