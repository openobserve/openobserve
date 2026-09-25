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

//! The resolve OpenObserve sends for itself.
//!
//! On PagerDuty, Opsgenie and ServiceNow a resolve carries no user-authored
//! content — it is protocol, not a message. So the template describes the
//! firing and this module writes the recovery, and a custom template of any
//! shape is harmless because it is never rendered for the resolve. The firing
//! only has to carry the correlation key, which [`stamp_key`] sets.

use anyhow::Result;
use common::utils::ssrf_guard::SsrfGuard;
use config::meta::destinations::{DestinationType, Endpoint};
use serde_json::{Value, json};

use super::format::{ChannelFormat, derive_channel_format};

/// ServiceNow refuses a state change to Resolved without a resolution code, and
/// the valid values are per-instance. This is the out-of-box one.
const DEFAULT_CLOSE_CODE: &str = "Solved (Permanently)";

/// Destination metadata key holding an operator's override for the above.
const CLOSE_CODE_KEY: &str = "credential_resolutionCode";

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

/// Put the episode id on a rendered firing body.
///
/// Overwrites rather than merges: the resolve quotes the episode id back, so a
/// key the template supplied would not match it.
///
/// PagerDuty's routing key is overwritten for the same reason. The resolve
/// reads it off the destination, and Events v2 discards a resolve whose routing
/// key differs from its trigger's — answering 202 either way, so a template
/// that hardcoded a different key would page and then never resolve, silently.
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

/// Close whatever the firing opened.
///
/// One request for PagerDuty and Opsgenie. Two for ServiceNow, whose Table API
/// can only update by `sys_id`, so the incident is found by its correlation id
/// first — which is why nothing has to be stored between the two halves.
pub async fn send_resolve(
    platform: Platform,
    endpoint: &Endpoint,
    episode_id: &str,
) -> Result<String> {
    match platform {
        Platform::PagerDuty => {
            let body = json!({
                // Events v2 drops a resolve sent via a different routing key
                // than the trigger, answering 202 either way.
                "routing_key": endpoint.metadata.get("routing_key").cloned().unwrap_or_default(),
                "event_action": "resolve",
                "dedup_key": episode_id,
            });
            request(
                endpoint,
                reqwest::Method::POST,
                &endpoint.url,
                Some(body.to_string()),
            )
            .await
        }
        Platform::Opsgenie => {
            let url = format!(
                "{}/{episode_id}/close?identifierType=alias",
                endpoint.url.trim_end_matches('/')
            );
            let body = json!({ "source": "OpenObserve" });
            request(
                endpoint,
                reqwest::Method::POST,
                &url,
                Some(body.to_string()),
            )
            .await
        }
        Platform::ServiceNow => resolve_servicenow(endpoint, episode_id).await,
    }
}

async fn resolve_servicenow(endpoint: &Endpoint, episode_id: &str) -> Result<String> {
    let base = endpoint.url.trim_end_matches('/');
    let lookup = format!(
        "{base}?sysparm_query=correlation_id={episode_id}&sysparm_fields=sys_id&sysparm_limit=1"
    );
    let found = request(endpoint, reqwest::Method::GET, &lookup, None).await?;
    let sys_id = serde_json::from_str::<Value>(&found)
        .ok()
        .and_then(|v| v["result"][0]["sys_id"].as_str().map(str::to_string))
        .ok_or_else(|| anyhow::anyhow!("no incident carries correlation_id {episode_id}"))?;

    let close_code = endpoint
        .metadata
        .get(CLOSE_CODE_KEY)
        .filter(|code| !code.is_empty())
        .cloned()
        .unwrap_or_else(|| DEFAULT_CLOSE_CODE.to_string());
    let body = json!({
        "state": "6",
        "close_code": close_code,
        "close_notes": "Recovered automatically by OpenObserve",
    });
    request(
        endpoint,
        reqwest::Method::PATCH,
        &format!("{base}/{sys_id}"),
        Some(body.to_string()),
    )
    .await
}

/// The destination's own auth and TLS settings, against a URL this module built
/// rather than one the operator typed — so the guard runs on the joined result.
async fn request(
    endpoint: &Endpoint,
    method: reqwest::Method,
    url: &str,
    body: Option<String>,
) -> Result<String> {
    SsrfGuard::validate_url_with_config_async(url)
        .await
        .map_err(|e| anyhow::anyhow!("URL blocked by SSRF guard: {e}"))?;

    let builder = if endpoint.skip_tls_verify {
        reqwest::Client::builder().danger_accept_invalid_certs(true)
    } else {
        reqwest::Client::builder()
    };
    let client = common::utils::ssrf_guard::build_safe_client(builder)?;
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

    let resp = req.send().await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if status.is_success() {
        Ok(text)
    } else {
        Err(anyhow::anyhow!("status {status}: {text}"))
    }
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
