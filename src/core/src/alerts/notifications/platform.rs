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

//! A platform resolve is protocol, not a message, so the template is never rendered for it.

use anyhow::Result;
use common::utils::ssrf_guard::SsrfGuard;
use config::meta::destinations::{DestinationType, Endpoint};
use serde_json::{Value, json};

use super::format::{ChannelFormat, derive_channel_format};

/// ServiceNow refuses a resolve without a resolution code, and valid values are per-instance.
const DEFAULT_CLOSE_CODE: &str = "Solved (Permanently)";

/// Destination metadata key holding an operator's override for the above.
const CLOSE_CODE_KEY: &str = "credential_resolutionCode";

/// ServiceNow incident states: the one a resolve sets, and the terminal one it must skip.
const STATE_RESOLVED: &str = "6";
const STATE_CLOSED: &str = "7";

/// Bounded: unlimited would fall back to the instance row cap and PATCH thousands.
const LOOKUP_LIMIT: usize = 100;

/// A destination whose resolve protocol we know well enough to speak ourselves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    PagerDuty,
    Opsgenie,
    ServiceNow,
}

/// Read off the destination, never the template — the author may have attached
/// any message body to a PagerDuty destination and it is still PagerDuty.
pub fn platform_of(dest_type: &DestinationType) -> Option<Platform> {
    match derive_channel_format(dest_type) {
        ChannelFormat::PagerDuty => Some(Platform::PagerDuty),
        ChannelFormat::Opsgenie => Some(Platform::Opsgenie),
        ChannelFormat::ServiceNow => Some(Platform::ServiceNow),
        _ => None,
    }
}

impl Platform {
    /// The field the firing must carry for the resolve to find what it opened.
    pub fn key_field(self) -> &'static str {
        match self {
            Platform::PagerDuty => "dedup_key",
            Platform::Opsgenie => "alias",
            Platform::ServiceNow => "correlation_id",
        }
    }
}

/// Overwrites, routing key included: a template's own key would page and then never resolve.
pub fn stamp_key(
    platform: Platform,
    body: &str,
    episode_id: &str,
    metadata: &hashbrown::HashMap<String, String>,
) -> Result<String> {
    let mut value: Value = serde_json::from_str(body)?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("payload is not a JSON object"))?;
    object.insert(platform.key_field().to_string(), json!(episode_id));
    if platform == Platform::PagerDuty
        && let Some(routing_key) = metadata.get("routing_key").filter(|key| !key.is_empty())
    {
        object.insert("routing_key".to_string(), json!(routing_key));
    }
    Ok(value.to_string())
}

/// The prefix of a resolve answer that found no open record for the key.
pub const NOTHING_TO_CLOSE: &str = "nothing to close";

/// One resolve as the delivery ledger classifies it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveAnswer {
    Closed(String),
    NothingToClose(String),
    Rejected { status: u16, body: String },
    Blocked(String),
    NoAnswer(String),
}

/// Close whatever the firing opened; ServiceNow needs two, updating only by `sys_id`.
pub async fn send_resolve(
    platform: Platform,
    endpoint: &Endpoint,
    episode_id: &str,
) -> Result<String> {
    match resolve_once(platform, endpoint, episode_id, None).await? {
        ResolveAnswer::Closed(text) | ResolveAnswer::NothingToClose(text) => Ok(text),
        ResolveAnswer::Rejected { status, body } => Err(answer_error(status, &body)),
        ResolveAnswer::Blocked(e) | ResolveAnswer::NoAnswer(e) => Err(anyhow::anyhow!(e)),
    }
}

/// Like `send_resolve`, but Opsgenie's 404 on close also reads as nothing to close.
pub async fn resolve_for_ledger(
    platform: Platform,
    endpoint: &Endpoint,
    episode_id: &str,
    timeout: Option<std::time::Duration>,
) -> Result<ResolveAnswer> {
    let answer = resolve_once(platform, endpoint, episode_id, timeout).await?;
    Ok(match answer {
        ResolveAnswer::Rejected { status: 404, body } if platform == Platform::Opsgenie => {
            ResolveAnswer::NothingToClose(format!("{NOTHING_TO_CLOSE}: {body}"))
        }
        other => other,
    })
}

fn answer_error(status: u16, body: &str) -> anyhow::Error {
    let status = reqwest::StatusCode::from_u16(status).unwrap_or(reqwest::StatusCode::BAD_GATEWAY);
    if body.is_empty() {
        anyhow::anyhow!("status {status}")
    } else {
        anyhow::anyhow!("status {status}: {body}")
    }
}

async fn resolve_once(
    platform: Platform,
    endpoint: &Endpoint,
    episode_id: &str,
    timeout: Option<std::time::Duration>,
) -> Result<ResolveAnswer> {
    match platform {
        Platform::PagerDuty => {
            let body = json!({
                // Events v2 drops a resolve sent via a different routing key
                // than the trigger, answering 202 either way.
                "routing_key": endpoint.metadata.get("routing_key").cloned().unwrap_or_default(),
                "event_action": "resolve",
                "dedup_key": episode_id,
            });
            let answer = request_raw(
                endpoint,
                reqwest::Method::POST,
                &endpoint.url,
                Some(body.to_string()),
                timeout,
            )
            .await?;
            Ok(answer.into_resolve())
        }
        Platform::Opsgenie => {
            let url = format!(
                "{}/{episode_id}/close?identifierType=alias",
                endpoint.url.trim_end_matches('/')
            );
            let body = json!({ "source": "OpenObserve" });
            let answer = request_raw(
                endpoint,
                reqwest::Method::POST,
                &url,
                Some(body.to_string()),
                timeout,
            )
            .await?;
            Ok(answer.into_resolve())
        }
        Platform::ServiceNow => resolve_servicenow(endpoint, episode_id, timeout).await,
    }
}

async fn resolve_servicenow(
    endpoint: &Endpoint,
    episode_id: &str,
    timeout: Option<std::time::Duration>,
) -> Result<ResolveAnswer> {
    let base = endpoint.url.trim_end_matches('/');
    // No dedup, so one episode leaves several records; closed ones reject a PATCH.
    let lookup = format!(
        "{base}?sysparm_query=correlation_id={episode_id}^state!={STATE_RESOLVED}^state!={STATE_CLOSED}\
         &sysparm_fields=sys_id&sysparm_limit={LOOKUP_LIMIT}"
    );
    let found = match request_raw(endpoint, reqwest::Method::GET, &lookup, None, timeout).await? {
        RawAnswer::Answered { status, text, .. } if status.is_success() => text,
        other => return Ok(other.into_resolve()),
    };
    let sys_ids: Vec<String> = serde_json::from_str::<Value>(&found)
        .ok()
        .and_then(|v| v["result"].as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|row| row["sys_id"].as_str().map(str::to_string))
        .collect();
    if sys_ids.is_empty() {
        return Ok(ResolveAnswer::Rejected {
            status: 404,
            body: format!("no open incident carries correlation_id {episode_id}"),
        });
    }

    let close_code = endpoint
        .metadata
        .get(CLOSE_CODE_KEY)
        .filter(|code| !code.is_empty())
        .cloned()
        .unwrap_or_else(|| DEFAULT_CLOSE_CODE.to_string());
    let body = json!({
        "state": STATE_RESOLVED,
        "close_code": close_code,
        "close_notes": "Recovered automatically by OpenObserve",
    })
    .to_string();

    // Runs to the end: one failure must not strand the records after it.
    let (mut closed, mut failures, mut last) = (0usize, String::new(), None);
    for sys_id in &sys_ids {
        let answer = request_raw(
            endpoint,
            reqwest::Method::PATCH,
            &format!("{base}/{sys_id}"),
            Some(body.clone()),
            timeout,
        )
        .await?
        .into_resolve();
        match answer {
            ResolveAnswer::Closed(_) => closed += 1,
            other => {
                failures = format!("{failures} {sys_id}: {other:?};");
                last = Some(other);
            }
        }
    }
    match last {
        None => Ok(ResolveAnswer::Closed(format!(
            "closed {closed} incident(s)"
        ))),
        Some(ResolveAnswer::Rejected { status, .. }) => Ok(ResolveAnswer::Rejected {
            status,
            body: format!("closed {closed} of {}, failed:{failures}", sys_ids.len()),
        }),
        Some(ResolveAnswer::NoAnswer(_)) => Ok(ResolveAnswer::NoAnswer(format!(
            "closed {closed} of {}, failed:{failures}",
            sys_ids.len()
        ))),
        Some(other) => Ok(other),
    }
}

enum RawAnswer {
    Answered {
        status: reqwest::StatusCode,
        text: String,
        hide_body: bool,
    },
    Blocked(String),
    NoAnswer(String),
}

impl RawAnswer {
    fn into_resolve(self) -> ResolveAnswer {
        match self {
            RawAnswer::Answered { status, text, .. } if status.is_success() => {
                ResolveAnswer::Closed(text)
            }
            RawAnswer::Answered {
                status,
                text,
                hide_body,
            } => ResolveAnswer::Rejected {
                status: status.as_u16(),
                body: if hide_body { String::new() } else { text },
            },
            RawAnswer::Blocked(e) => ResolveAnswer::Blocked(e),
            RawAnswer::NoAnswer(e) => ResolveAnswer::NoAnswer(e),
        }
    }
}

/// Guards the URL this module built rather than the one the operator typed.
async fn request_raw(
    endpoint: &Endpoint,
    method: reqwest::Method,
    url: &str,
    body: Option<String>,
    timeout: Option<std::time::Duration>,
) -> Result<RawAnswer> {
    if let Err(e) = SsrfGuard::validate_destination_url_with_config_async(url).await {
        return Ok(RawAnswer::Blocked(format!(
            "URL blocked by SSRF guard: {e}"
        )));
    }

    let builder = if endpoint.skip_tls_verify {
        reqwest::Client::builder().danger_accept_invalid_certs(true)
    } else {
        reqwest::Client::builder()
    };
    let builder = match timeout {
        Some(t) => builder.timeout(t),
        None => builder,
    };
    let client = common::utils::ssrf_guard::build_safe_destination_client(builder)?;
    let mut req = client.request(method, url::Url::parse(url)?);

    let mut has_content_type = false;
    if let Some(headers) = &endpoint.headers {
        for (key, value) in headers.iter() {
            if key.is_empty() || value.is_empty() {
                continue;
            }
            if key.to_lowercase().trim() == "content-type" {
                has_content_type = true;
            }
            req = req.header(key, value);
        }
    }
    if let Some(body) = body {
        if !has_content_type {
            req = req.header("Content-type", "application/json");
        }
        req = req.body(body);
    }

    let resp = match req.send().await {
        Ok(resp) => resp,
        Err(e) => return Ok(RawAnswer::NoAnswer(e.without_url().to_string())),
    };
    let status = resp.status();
    let hide_body = config::utils::ssrf_guard::admitted_only_by_allowlist(&resp);
    let text = resp.text().await.unwrap_or_default();
    Ok(RawAnswer::Answered {
        status,
        text,
        hide_body,
    })
}

#[cfg(test)]
mod tests {
    use config::meta::destinations::{DestinationType, Endpoint};

    use super::*;

    fn meta(routing_key: &str) -> hashbrown::HashMap<String, String> {
        let mut m = hashbrown::HashMap::new();
        if !routing_key.is_empty() {
            m.insert("routing_key".to_string(), routing_key.to_string());
        }
        m
    }

    fn http(destination_type: &str) -> DestinationType {
        DestinationType::Http(Endpoint {
            destination_type: Some(destination_type.to_string()),
            ..Default::default()
        })
    }

    #[test]
    fn the_platform_comes_from_the_destination_not_the_template() {
        assert_eq!(platform_of(&http("pagerduty")), Some(Platform::PagerDuty));
        assert_eq!(platform_of(&http("opsgenie")), Some(Platform::Opsgenie));
        assert_eq!(platform_of(&http("servicenow")), Some(Platform::ServiceNow));
        // Chat destinations get an ordinary rendered message, not a protocol resolve.
        assert_eq!(platform_of(&http("slack")), None);
        assert_eq!(platform_of(&http("discord")), None);
    }

    #[test]
    fn the_key_lands_whatever_the_author_wrote_and_overwrites_their_own() {
        // A hand-written body we have never seen before.
        let body = r#"{"payload":{"summary":"disk full"},"routing_key":"k"}"#;
        let out = stamp_key(Platform::PagerDuty, body, "ep_1", &meta("")).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["dedup_key"], "ep_1");
        assert_eq!(
            v["payload"]["summary"], "disk full",
            "the rest of the author's payload is untouched"
        );

        // Their own key loses, because the resolve quotes the episode id back
        // and a key that disagreed with it would never match.
        let theirs = r#"{"alias":"mine","message":"x"}"#;
        let out = stamp_key(Platform::Opsgenie, theirs, "ep_2", &meta("")).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&out).unwrap()["alias"],
            "ep_2"
        );
    }

    /// Events v2 discards a resolve whose routing key differs from its
    /// trigger's, and answers 202 anyway — so the two must agree by
    /// construction, not by the author remembering.
    #[test]
    fn the_destinations_routing_key_wins_over_one_hardcoded_in_the_template() {
        let hardcoded = r#"{"routing_key":"TEMPLATE_KEY","event_action":"trigger"}"#;
        let out = stamp_key(Platform::PagerDuty, hardcoded, "ep_1", &meta("DEST_KEY")).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["routing_key"], "DEST_KEY");

        // Nothing to say: leave whatever the template had rather than blanking it.
        let out = stamp_key(Platform::PagerDuty, hardcoded, "ep_1", &meta("")).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["routing_key"], "TEMPLATE_KEY");
    }

    #[test]
    fn a_body_we_cannot_parse_is_reported_rather_than_guessed_at() {
        assert!(stamp_key(Platform::ServiceNow, "not json", "ep_1", &meta("")).is_err());
        assert!(
            stamp_key(Platform::ServiceNow, r#"["an","array"]"#, "ep_1", &meta("")).is_err(),
            "a JSON array has nowhere to put a correlation id"
        );
    }
}
