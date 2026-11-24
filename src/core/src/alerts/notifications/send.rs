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

//! Renders one template for one destination and sends it; the alert loop and `notify` share it.

use std::{collections::BTreeSet, time::Duration};

use config::meta::{
    destinations::{
        Destination, DestinationType, Email, Endpoint, Module, Template, TemplateKind, TemplateType,
    },
    secret_store::{ConsumerType, Decision, SecretErrorCode, SecretValue, grammar},
};
use infra::{
    db::get_orm_client_rw,
    secret_store::{
        http,
        redact::Redactor,
        resolver::{self, Resolved, Snapshot},
    },
    table::org_secrets,
};
use reqwest::{
    Method, StatusCode, Url,
    header::{HeaderMap, HeaderName, HeaderValue},
};

use super::{
    NotificationContext, RenderedMessage, apply_custom_template, apply_template_body,
    derive_channel_format,
    format::ChannelFormat,
    jira,
    platform::{self, platform_of},
    render, resolve_content,
};
use crate::alerts::{
    alert::{
        send_discord_with_attachment, send_email_notification,
        send_email_notification_with_inline_png, send_saved_http_notification,
        send_sns_notification,
    },
    destinations::{SavePrincipal, destination_snapshot, note_skipped, org_member_split},
};

tokio::task_local! {
    static HUMAN_SENDER: String;
}

const CONNECT_TIMEOUT_SECS: u64 = 10;

#[cfg(test)]
static SECRET_TEST_ROOT: std::sync::OnceLock<reqwest::Certificate> = std::sync::OnceLock::new();

/// Where the subject of an email or SNS message comes from (Backend section 5, subject rule).
#[derive(Clone, Copy, Debug)]
pub enum Subject<'a> {
    /// The alert paths: SNS takes the alert name, email keeps the template's own title.
    Alert(&'a str),
    /// The other kinds: the producer's subject, else the email title, name or rendered title.
    Kind(Option<&'a str>),
}

/// A failed send the shared path can classify; each message is the text alerts showed before.
#[derive(Debug, thiserror::Error)]
pub enum SendError {
    #[error("{0}")]
    Blocked(String),
    #[error("sent error status: {status}{}", body.as_deref().map(|b| format!(", err: {b}")).unwrap_or_default())]
    Rejected {
        status: reqwest::StatusCode,
        body: Option<String>,
    },
    #[error("redirect_refused:{}", .0.as_u16())]
    RedirectRefused(StatusCode),
    #[error("Email not sent: no recipient is part of this org (skipped: {})", .0.join(", "))]
    NoOrgMemberRecipient(Vec<String>),
    #[error("{0}")]
    Render(String),
}

pub(crate) struct SecretRequest {
    client: reqwest::Client,
    url: Url,
    headers: HeaderMap,
    endpoint_pointer: String,
    resolved: Resolved,
}

impl SecretRequest {
    pub(crate) async fn new(
        destination: Option<&Destination>,
        endpoint: &Endpoint,
        builder: reqwest::ClientBuilder,
    ) -> anyhow::Result<Option<Self>> {
        if !endpoint.uses_store_refs() {
            refuse_endpoint_refs(endpoint)?;
            return Ok(None);
        }
        let refuse = |code| secret_error(endpoint, code);
        let destination =
            destination.ok_or_else(|| refuse(SecretErrorCode::RefNotAllowedInField))?;
        if !matches!(&destination.module, Module::Alert {
            destination_type: DestinationType::Http(saved), ..
        } if saved == endpoint)
        {
            return Err(refuse(SecretErrorCode::DeliveryStale));
        }
        let snapshot = destination_snapshot(destination)
            .await
            .map_err(refuse)?
            .ok_or_else(|| refuse(SecretErrorCode::DeliveryStale))?;
        let url_field = &snapshot
            .request_urls
            .first()
            .ok_or_else(|| refuse(SecretErrorCode::DeliveryStale))?
            .field;
        let base = url_field.trim_end_matches("/url");
        let conn = get_orm_client_rw().await;
        let plan = resolver::plan(conn, &snapshot).await.map_err(refuse)?;
        let checked: Vec<_> = plan.checked_policies().cloned().collect();
        authorize_human_sender(&destination.org_id, &checked)
            .await
            .map_err(refuse)?;
        let resolved = resolver::materialize(conn, &snapshot, plan)
            .await
            .map_err(refuse)?;
        validate_materialized_slots(&snapshot, &resolved).map_err(refuse)?;
        let expanded = resolved
            .substitute_slot(url_field, &endpoint.url)
            .map_err(refuse)?;
        let invalid = || refuse(SecretErrorCode::DeliveryStale);
        let original = Url::parse(&endpoint.url).map_err(|_| invalid())?;
        let url = Url::parse(expanded.as_str()).map_err(|_| invalid())?;
        if original[..url::Position::BeforePath] != url[..url::Position::BeforePath] {
            return Err(invalid());
        }
        common::utils::ssrf_guard::SsrfGuard::validate_destination_url_with_config_async(
            url.as_str(),
        )
        .await
        .map_err(|_| SendError::Blocked("Destination URL blocked by SSRF guard".into()))?;
        let headers = secret_headers(endpoint, base, &resolved)?;
        #[cfg(test)]
        let builder = match SECRET_TEST_ROOT.get() {
            Some(cert) => builder.tls_certs_only([cert.clone()]).no_proxy(),
            None => builder,
        };
        // A transport replay would reuse credentials after rotation or revocation.
        let client = http::client(builder.retry(reqwest::retry::never()))
            .map_err(|error| secret_transport_error(error, &resolved.redactor))?;
        Ok(Some(Self {
            client,
            url,
            headers,
            endpoint_pointer: base.to_owned(),
            resolved,
        }))
    }

    pub(crate) fn request(&self, method: Method, suffix: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, self.url_with_suffix(suffix))
            .headers(self.headers.clone())
    }

    pub(crate) fn json_request(&self, method: Method, suffix: &str) -> reqwest::RequestBuilder {
        let req = self.request(method, suffix);
        if self.headers.contains_key(reqwest::header::CONTENT_TYPE) {
            req
        } else {
            req.header(reqwest::header::CONTENT_TYPE, "application/json")
        }
    }

    pub(crate) fn routing_key(&self, endpoint: &Endpoint) -> anyhow::Result<SecretValue> {
        let text = endpoint
            .metadata
            .get("routing_key")
            .map_or("", String::as_str);
        self.resolved
            .substitute_slot(
                &format!("{}/metadata/routing_key", self.endpoint_pointer),
                text,
            )
            .map_err(|code| secret_error(endpoint, code))
    }

    pub(crate) fn transport_error(&self, error: reqwest::Error) -> anyhow::Error {
        secret_transport_error(error, &self.resolved.redactor)
    }

    pub(crate) async fn send(
        &self,
        request: reqwest::RequestBuilder,
    ) -> anyhow::Result<reqwest::Response> {
        request
            .send()
            .await
            .map_err(|error| self.transport_error(error))
    }

    /// Whether a fresh resolve produced the same URL, headers and routing key as this one.
    pub(crate) fn same_material(&self, other: &Self, endpoint: &Endpoint) -> bool {
        let same_key = match (self.routing_key(endpoint), other.routing_key(endpoint)) {
            (Ok(a), Ok(b)) => a.as_str() == b.as_str(),
            (Err(_), Err(_)) => true,
            _ => false,
        };
        self.url == other.url && self.headers == other.headers && same_key
    }

    pub(crate) fn accepts_protocol_id(&self, id: &str) -> bool {
        !id.is_empty()
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            && self.resolved.redactor.redact(id) == id
    }

    fn url_with_suffix(&self, suffix: &str) -> Url {
        let mut url = self.url.clone();
        let (path, query) = suffix.split_once('?').unwrap_or((suffix, ""));
        if !path.is_empty() {
            url.set_path(&format!("{}{path}", url.path().trim_end_matches('/')));
        }
        if !query.is_empty() {
            let query = url
                .query()
                .map_or_else(|| query.to_owned(), |base| format!("{base}&{query}"));
            url.set_query(Some(&query));
        }
        url
    }
}

/// A hanging endpoint must not stall the alert that sends to it.
pub(crate) fn destination_client_builder(skip_tls_verify: bool) -> reqwest::ClientBuilder {
    let timeout = config::get_config().limit.alert_notification_timeout;
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .danger_accept_invalid_certs(skip_tls_verify)
}

/// Carry the episode id into a platform's own correlation field, so the resolve
/// this module sends later can find what the firing opened.
///
/// A body we cannot parse is left alone and logged: saving the alert already
/// refused this combination, so reaching here means the template changed after
/// the fact, and dropping the firing would be the worse failure.
pub(crate) fn stamp_platform_key(
    dest_type: &DestinationType,
    ctx: &NotificationContext,
    msg: String,
) -> String {
    let (Some(platform), Some(episode_id)) = (platform_of(dest_type), ctx.episode_id.as_deref())
    else {
        return msg;
    };
    let empty = hashbrown::HashMap::new();
    let metadata = match dest_type {
        DestinationType::Http(endpoint) => &endpoint.metadata,
        _ => &empty,
    };
    match platform::stamp_key(platform, &msg, episode_id, metadata) {
        Ok(stamped) => stamped,
        Err(e) => {
            log::warn!(
                "[ALERT] {} payload has no place for {}: {e} — it will not be resolvable",
                ctx.alert_name,
                platform.key_field()
            );
            msg
        }
    }
}

/// Every destination type except the Slack app, which the caller sends through `slack_publish`.
pub async fn send_to_destination(
    org_id: &str,
    subject: Subject<'_>,
    destination: &Destination,
    dest_type: &DestinationType,
    template: &Template,
    ctx: &mut NotificationContext,
) -> Result<String, anyhow::Error> {
    // Jira builds its own text and keeps one issue per alert, so no template is rendered for it.
    if let DestinationType::Http(endpoint) = dest_type
        && jira::is_jira(endpoint)
    {
        return jira::send_saved(destination, endpoint, ctx).await;
    }
    refuse_unsupported_refs(dest_type)?;
    let is_email = matches!(dest_type, DestinationType::Email(_));
    let empty_meta = hashbrown::HashMap::new();
    let metadata: &hashbrown::HashMap<String, String> = match dest_type {
        DestinationType::Http(endpoint) => &endpoint.metadata,
        _ => &empty_meta,
    };
    let store_refs_enabled = config::get_config().common.secret_store_refs_enabled;
    ctx.metadata = metadata
        .iter()
        .filter(|(_, value)| !store_refs_enabled || !grammar::has_secret_ref(value))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    match template.kind {
        TemplateKind::Custom => {
            // Unchanged legacy path — byte-identical output.
            let msg = if platform_of(dest_type) == Some(platform::Platform::PagerDuty)
                && store_refs_enabled
                && metadata
                    .get("routing_key")
                    .is_some_and(|v| grammar::has_secret_ref(v))
            {
                super::custom::apply_template_body_without_routing_key(template, ctx)
            } else {
                apply_template_body(template, ctx, is_email)
            };
            let title = custom_title(template, ctx, is_email);
            let (email_subject, sns_subject) = custom_subjects(subject, title);
            match dest_type {
                DestinationType::Http(endpoint) => {
                    send_saved_http_notification(destination, endpoint, Some(ctx), msg).await
                }
                DestinationType::Email(email) => {
                    let (email, skipped) = org_member_email(org_id, email).await?;
                    send_email_notification(&email_subject, &email, None, msg)
                        .await
                        .map(|resp| note_skipped(resp, &skipped))
                }
                DestinationType::Sns(aws_sns) => {
                    send_sns_notification(&sns_subject, aws_sns, msg).await
                }
                DestinationType::SlackApp(_) => Err(anyhow::anyhow!(
                    "a Slack app destination is sent through slack_publish"
                )),
            }
        }
        TemplateKind::Content => {
            send_content(org_id, subject, destination, dest_type, template, ctx).await
        }
    }
}

pub(crate) fn refuse_unsupported_refs(dest_type: &DestinationType) -> anyhow::Result<()> {
    match dest_type {
        DestinationType::Http(_) => Ok(()),
        DestinationType::Email(_) | DestinationType::Sns(_) | DestinationType::SlackApp(_) => {
            if has_ref(&serde_json::to_string(dest_type)?) {
                return Err(SendError::Blocked(format!(
                    "secret_error:{}",
                    SecretErrorCode::RefNotAllowedInField
                ))
                .into());
            }
            Ok(())
        }
    }
}

/// Runs `fut` as `user`'s send, so each secret request checks use on the secrets it resolved.
pub async fn as_human_sender<F: std::future::Future>(user: String, fut: F) -> F::Output {
    HUMAN_SENDER.scope(user, fut).await
}

pub(crate) fn secret_error(endpoint: &Endpoint, code: SecretErrorCode) -> anyhow::Error {
    let mut names = BTreeSet::new();
    for text in std::iter::once(&endpoint.url)
        .chain(endpoint.headers.iter().flatten().flat_map(|(k, v)| [k, v]))
        .chain(endpoint.metadata.iter().flat_map(|(k, v)| [k, v]))
    {
        for (start, suffix) in text.match_indices("{{") {
            let candidate = &text[start + suffix.len()..];
            if let Some(end) = candidate.find("}}")
                && let Ok(tokens) =
                    grammar::parse_refs(&text[start..start + suffix.len() + end + 2])
            {
                names.extend(tokens.into_iter().map(|token| token.name));
            }
        }
    }
    let names = names.into_iter().collect::<Vec<_>>().join(",");
    let message = if names.is_empty() {
        format!("secret_error:{code}")
    } else {
        format!("secret_error:{code}:{names}")
    };
    SendError::Blocked(message).into()
}

/// After a 401/403, evicts this node's provider values for the destination's bound secrets, each
/// at most once per cooldown; `true` when any was evicted, so a fresh resolve may differ.
pub(crate) async fn refetch_after_auth_failure(destination: &Destination) -> bool {
    let Some(id) = destination.id else {
        return false;
    };
    let consumer_type = match destination.module {
        Module::Alert { .. } => ConsumerType::AlertDestination,
        Module::Pipeline { .. } => ConsumerType::PipelineDestination,
    };
    let Ok(refs) = infra::table::secret_refs::list_for_consumer_in(
        get_orm_client_rw().await,
        &destination.org_id,
        consumer_type.as_str(),
        &id.to_string(),
    )
    .await
    else {
        return false;
    };
    let ids: BTreeSet<String> = refs.into_iter().map(|r| r.secret_id).collect();
    let mut evicted = false;
    for secret_id in &ids {
        evicted |= infra::secret_store::external::cache::refetch_on_auth_failure(
            &destination.org_id,
            secret_id,
        );
    }
    evicted
}

pub(crate) fn refuse_endpoint_refs(endpoint: &Endpoint) -> anyhow::Result<()> {
    if !config::get_config().common.secret_store_refs_enabled {
        return Ok(());
    }
    if endpoint.uses_store_refs()
        || endpoint
            .metadata
            .iter()
            .any(|(key, value)| has_ref(key) || has_ref(value))
        || endpoint
            .headers
            .iter()
            .flatten()
            .any(|(key, _)| has_ref(key))
    {
        return Err(secret_error(
            endpoint,
            SecretErrorCode::RefNotAllowedInField,
        ));
    }
    Ok(())
}

fn secret_transport_error(error: reqwest::Error, redactor: &Redactor) -> anyhow::Error {
    let class = serde_json::json!(http::outcome_of_error(&error).class);
    log::warn!(
        "Secret-bearing notification transport failed: {}",
        http::redacted_error(error, redactor)
    );
    anyhow::anyhow!("transport_error:{}", class.as_str().unwrap_or("connect"))
}

fn has_ref(text: &str) -> bool {
    text.contains("{{")
        && (grammar::has_secret_ref(text)
            || grammar::parse_refs(text).is_ok_and(|refs| !refs.is_empty()))
}

fn secret_headers(
    endpoint: &Endpoint,
    base: &str,
    resolved: &Resolved,
) -> anyhow::Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    for (key, text) in endpoint.headers.iter().flatten() {
        if key.is_empty() || text.is_empty() {
            continue;
        }
        let component = key.replace('~', "~0").replace('/', "~1");
        let value = resolved
            .substitute_slot(&format!("{base}/headers/{component}"), text)
            .map_err(|code| secret_error(endpoint, code))?;
        let key = HeaderName::from_bytes(key.as_bytes())
            .map_err(|_| SendError::Blocked("invalid destination header name".into()))?;
        let mut value = HeaderValue::from_str(value.as_str())
            .map_err(|_| SendError::Blocked("invalid destination header value".into()))?;
        value.set_sensitive(true);
        headers.append(key, value);
    }
    Ok(headers)
}

/// Runs on the set this attempt will materialize, before any value is read or fetched for it.
async fn authorize_human_sender(
    org_id: &str,
    bound: &[org_secrets::Model],
) -> Result<(), SecretErrorCode> {
    let Ok(user) = HUMAN_SENDER.try_with(Clone::clone) else {
        return Ok(());
    };
    if bound.is_empty() {
        return Ok(());
    }
    let principal = SavePrincipal::for_user(org_id, &user)
        .await
        .map_err(|refusal| refusal.code)?;
    for row in bound {
        let object = format!("secrets:{}", row.id);
        let decision = crate::authz::check_strict(
            org_id,
            &principal.user_id,
            principal.role.clone(),
            &object,
            "GET",
        )
        .await?;
        if decision != Decision::Allow {
            return Err(SecretErrorCode::SecretUseDenied);
        }
    }
    Ok(())
}

fn validate_materialized_slots(
    snapshot: &Snapshot,
    resolved: &Resolved,
) -> Result<(), SecretErrorCode> {
    for field in &snapshot.slot_pointers {
        let text = snapshot
            .stored
            .pointer(field)
            .and_then(serde_json::Value::as_str)
            .ok_or(SecretErrorCode::SecretUnbound)?;
        for token in grammar::parse_refs(text)? {
            if token.kind == grammar::RefKind::Var {
                resolved
                    .var(&token.name)
                    .ok_or(SecretErrorCode::SecretUnbound)?;
                continue;
            }
            let value = resolved
                .value(field, &token.name)
                .ok_or(SecretErrorCode::SecretUnbound)?;
            if value.is_empty() {
                return Err(SecretErrorCode::SecretUnset);
            }
        }
    }
    Ok(())
}

async fn send_content(
    org_id: &str,
    subject: Subject<'_>,
    destination: &Destination,
    dest_type: &DestinationType,
    template: &Template,
    ctx: &NotificationContext,
) -> Result<String, anyhow::Error> {
    let spec = db::alerts::templates::get_parsed_content(template).map_err(|e| {
        SendError::Render(format!("Invalid content template {}: {e}", template.name))
    })?;
    let format = derive_channel_format(dest_type);
    let content = resolve_content(&spec, ctx, format.channel_family());
    let rendered = render(format, &content, ctx)
        .map_err(|e| SendError::Render(format!("Renderer failed: {e}")))?;

    match (rendered, dest_type) {
        (RenderedMessage::Http { body }, DestinationType::Http(endpoint)) => {
            // Discord with a rendered chart: upload the PNG in the
            // same webhook POST (the embed references it as
            // `attachment://`).
            if matches!(format, ChannelFormat::Discord)
                && let Some(png) = ctx.chart_png.clone()
            {
                send_discord_with_attachment(Some(destination), endpoint, body, png).await
            } else {
                send_saved_http_notification(destination, endpoint, Some(ctx), body).await
            }
        }
        (
            RenderedMessage::Email {
                subject: rendered_subject,
                html,
                text,
            },
            DestinationType::Email(email),
        ) => {
            let (email_subject, _) = content_subjects(subject, rendered_subject, "");
            let (email, skipped) = org_member_email(org_id, email).await?;
            send_email_notification_with_inline_png(
                &email_subject,
                &email,
                Some(text),
                html,
                ctx.chart_png.clone(),
            )
            .await
            .map(|resp| note_skipped(resp, &skipped))
        }
        (RenderedMessage::Sns { message, .. }, DestinationType::Sns(aws_sns)) => {
            let (_, sns_subject) = content_subjects(subject, String::new(), &content.title);
            send_sns_notification(&sns_subject, aws_sns, message).await
        }
        (rendered, dest_type) => Err(SendError::Render(format!(
            "Rendered message {rendered:?} does not match destination type {dest_type:?}"
        ))
        .into()),
    }
}

/// `(email, SNS)` subjects of a Custom template send; `title` is its email title or fallback.
fn custom_subjects(subject: Subject<'_>, title: String) -> (String, String) {
    match subject {
        Subject::Alert(name) => (title, name.to_string()),
        Subject::Kind(given) => {
            let s = given.map(str::to_string).unwrap_or(title);
            (s.clone(), s)
        }
    }
}

/// `(email, SNS)` subjects of a Content template send, from its rendered subject and title.
fn content_subjects(subject: Subject<'_>, rendered: String, title: &str) -> (String, String) {
    match subject {
        Subject::Alert(name) => (rendered, name.to_string()),
        Subject::Kind(Some(given)) => (given.to_string(), given.to_string()),
        Subject::Kind(None) => (rendered, title.to_string()),
    }
}

/// Narrows an email destination to org members and returns the skipped ones. [strong]
pub(crate) async fn org_member_email(
    org_id: &str,
    email: &Email,
) -> Result<(Email, Vec<String>), anyhow::Error> {
    let (kept, skipped) = org_member_split(org_id, &email.recipients).await?;
    Ok((members_to_send(kept, &skipped)?, skipped))
}

/// Email to the kept members, or an error naming the skipped when none is left. [pure]
fn members_to_send(kept: Vec<String>, skipped: &[String]) -> Result<Email, SendError> {
    if kept.is_empty() && !skipped.is_empty() {
        return Err(SendError::NoOrgMemberRecipient(skipped.to_vec()));
    }
    Ok(Email { recipients: kept })
}

/// The subject of a Custom template; alerts never set a fallback, so their subjects are unchanged.
fn custom_title(template: &Template, ctx: &NotificationContext, is_email: bool) -> String {
    let title = custom_title_unmarked(template, ctx, is_email);
    if ctx.render_hints.test_marker {
        return format!("{}{title}", super::TEST_MARKER);
    }
    title
}

fn custom_title_unmarked(template: &Template, ctx: &NotificationContext, is_email: bool) -> String {
    let fallback = ctx.render_hints.fallback_subject.as_ref();
    match &template.template_type {
        TemplateType::Email { title } if !(title.is_empty() && fallback.is_some()) => {
            // A subject is plain text: no HTML entities, and is_email keeps JSON escaping off too.
            let mut plain = ctx.clone();
            plain.render_hints.escape_email_attributes = false;
            apply_custom_template(title, &plain, is_email)
        }
        _ => fallback.cloned().unwrap_or_else(|| template.name.clone()),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        future::Future,
        path::Path,
        process::{Command, Stdio},
        sync::Mutex,
    };

    use config::{
        ider::ksuid,
        meta::{
            destinations::{AwsSns, Module, SlackAppTarget},
            secret_store::{ConsumerType, GateState, ORG_ENV_ID, SecretKind},
            user::UserRole,
        },
    };
    use infra::{
        secret_store::gate,
        table::{
            cipher,
            credential_values::{self, NamedValueAd, NamedValueClass, SecretRecord, SlotClass},
            org_secret_consumers, org_secret_values, org_secrets,
            org_users::OrgUserRecord,
        },
    };
    use sea_orm::{IntoActiveModel, Set};
    use serde_json::{Value, json};
    use tokio::{
        io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
        process::{Child, ChildStdout},
        time::timeout,
    };

    use super::*;
    use crate::{
        alerts::{destinations::SavePrincipal, notifications::notify},
        ssrf_test_support::isolated,
    };

    const TOKEN: &str = "{{secrets.TOKEN}}";
    const CANARY: &str = "u44+canary!";
    const TLS_RECEIVER: &str = r#"
import http.server, json, ssl, sys

class Receiver(http.server.BaseHTTPRequestHandler):
    def receive(self):
        size = int(self.headers.get("Content-Length", "0"))
        request = {"path": self.path, "headers": {k.lower(): v for k,v in self.headers.items()},
                   "body": self.rfile.read(size).decode()}
        print(json.dumps(request), flush=True)
        reply = json.loads(sys.stdin.readline())
        body = reply.get("body", "").encode()
        self.send_response(reply["status"])
        for key, value in reply.get("headers", {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = do_PUT = do_PATCH = receive
    def log_message(self, *args):
        pass

server = http.server.HTTPServer(("127.0.0.1", 0), Receiver)
tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
tls.load_cert_chain(sys.argv[1], sys.argv[2])
server.socket = tls.wrap_socket(server.socket, server_side=True)
print(server.server_port, flush=True)
server.serve_forever()
"#;

    struct Receiver {
        child: Child,
        output: BufReader<ChildStdout>,
        base: String,
    }

    impl Receiver {
        async fn start(dir: &Path) -> Self {
            let cert = dir.join("receiver.crt");
            let key = dir.join("receiver.key");
            let command = Command::new("openssl")
                .args([
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-nodes",
                    "-days",
                    "1",
                    "-subj",
                    "/CN=127.0.0.1",
                    "-addext",
                    "subjectAltName=IP:127.0.0.1",
                    "-addext",
                    "basicConstraints=critical,CA:FALSE",
                    "-keyout",
                ])
                .arg(&key)
                .arg("-out")
                .arg(&cert)
                .output()
                .unwrap();
            assert!(
                command.status.success(),
                "{}",
                String::from_utf8_lossy(&command.stderr)
            );
            let root = reqwest::Certificate::from_pem(&std::fs::read(&cert).unwrap()).unwrap();
            assert!(SECRET_TEST_ROOT.set(root).is_ok());
            let mut child = tokio::process::Command::new("python3")
                .args(["-c", TLS_RECEIVER])
                .args([&cert, &key])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .unwrap();
            let mut output = BufReader::new(child.stdout.take().unwrap());
            let mut port = String::new();
            assert!(
                timeout(Duration::from_secs(5), output.read_line(&mut port))
                    .await
                    .unwrap()
                    .unwrap()
                    > 0
            );
            Self {
                child,
                output,
                base: format!("https://127.0.0.1:{}", port.trim()),
            }
        }

        async fn request(&mut self) -> Value {
            let mut request = String::new();
            let size = timeout(Duration::from_secs(5), self.output.read_line(&mut request))
                .await
                .unwrap()
                .unwrap();
            assert!(size > 0);
            serde_json::from_str(&request).unwrap()
        }

        async fn reply(&mut self, value: Value) {
            self.child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(format!("{value}\n").as_bytes())
                .await
                .unwrap();
        }

        async fn assert_no_request(&mut self) {
            let mut line = String::new();
            assert!(
                timeout(Duration::from_millis(100), self.output.read_line(&mut line))
                    .await
                    .is_err()
            );
        }
    }

    struct Fixture {
        secret: org_secrets::Model,
        head: org_secret_values::Model,
    }

    impl Fixture {
        async fn new(base: &str, name: &str, value: &str) -> Self {
            let db = get_orm_client_rw().await;
            let org = format!("u44-{}", ksuid());
            cipher::get_dek(&org).await.unwrap();
            let secret = org_secrets::insert_in(
                db,
                org_secrets::ActiveModel {
                    org_id: Set(org.clone()),
                    id: Set(ksuid()),
                    name: Set(name.into()),
                    kind: Set("secret".into()),
                    state: Set("active".into()),
                    description: Set(String::new()),
                    allowed_hosts: Set(base.into()),
                    pin_mode: Set(org_secrets::PinMode::Hosts),
                    policy_rev: Set(ksuid()),
                    policy_version: Set(1),
                    created_by: Set("owner".into()),
                    updated_by: Set("owner".into()),
                    created_at: Set(1),
                    updated_at: Set(1),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            org_secret_consumers::add_in(
                db,
                org_secret_consumers::ActiveModel {
                    org_id: Set(org.clone()),
                    secret_id: Set(secret.id.clone()),
                    consumer_type: Set(ConsumerType::AlertDestination.as_str().into()),
                    consumer_id: Set(org_secret_consumers::ANY_CONSUMER.into()),
                    added_by: Set("owner".into()),
                    added_at: Set(1),
                },
            )
            .await
            .unwrap();
            let head = org_secret_values::insert_in(
                db,
                org_secret_values::ActiveModel {
                    id: Set(ksuid()),
                    org_id: Set(org),
                    secret_id: Set(secret.id.clone()),
                    env_id: Set(ORG_ENV_ID.into()),
                    env_incarnation: Set(String::new()),
                    state: Set("set".into()),
                    value_ref: Set(Some(ksuid())),
                    value_rev: Set(ksuid()),
                    value_version: Set(1),
                    updated_by: Set("owner".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            Self::seal(db, &head, value, SecretKind::Secret).await;
            Self { secret, head }
        }

        async fn seal(
            db: &impl sea_orm::ConnectionTrait,
            head: &org_secret_values::Model,
            value: &str,
            kind: SecretKind,
        ) {
            let sref = head.value_ref.as_deref().unwrap();
            let class = NamedValueClass::OrgSecret;
            let slot = SlotClass::NamedValue(NamedValueAd {
                org_id: &head.org_id,
                class,
                value_row_id: &head.id,
                secret_ref: sref,
                secret_id: &head.secret_id,
                kind,
                env_id: &head.env_id,
                env_incarnation: &head.env_incarnation,
                value_rev: &head.value_rev,
            });
            let record = SecretRecord {
                id: ksuid(),
                secret_ref: sref.to_owned(),
                org_id: head.org_id.clone(),
                owner_kind: class.owner_kind().into(),
                owner_id: head.id.clone(),
                purpose: "auth".into(),
                key_id: None,
                state: "current".into(),
                value: value.to_owned().into(),
                last_verified_at: None,
                grace_expires_at: None,
                created_at: 1,
                updated_at: 1,
            };
            let model = credential_values::encrypted_active_model(&record, &slot)
                .await
                .unwrap();
            credential_values::insert(db, model).await.unwrap();
        }

        async fn rotate(&self, value: &str) {
            use sea_orm::TransactionTrait;

            let db = get_orm_client_rw().await;
            let txn = db.begin().await.unwrap();
            let mut rev = self.head.clone().into_active_model();
            rev.value_ref = Set(Some(ksuid()));
            rev.value_rev = Set(ksuid());
            rev.value_version = Set(self.head.value_version + 1);
            let head = org_secret_values::update_in(&txn, &self.head.org_id, rev)
                .await
                .unwrap()
                .unwrap();
            Self::seal(&txn, &head, value, SecretKind::Secret).await;
            txn.commit().await.unwrap();
        }

        async fn variable(&self, name: &str, value: &str) {
            let db = get_orm_client_rw().await;
            let org = &self.secret.org_id;
            let row = org_secrets::insert_in(
                db,
                org_secrets::ActiveModel {
                    org_id: Set(org.clone()),
                    id: Set(ksuid()),
                    name: Set(name.into()),
                    kind: Set("variable".into()),
                    state: Set("active".into()),
                    description: Set(String::new()),
                    allowed_hosts: Set(String::new()),
                    pin_mode: Set(org_secrets::PinMode::Any),
                    policy_rev: Set(ksuid()),
                    policy_version: Set(1),
                    created_by: Set("owner".into()),
                    updated_by: Set("owner".into()),
                    created_at: Set(1),
                    updated_at: Set(1),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            org_secret_consumers::add_in(
                db,
                org_secret_consumers::ActiveModel {
                    org_id: Set(org.clone()),
                    secret_id: Set(row.id.clone()),
                    consumer_type: Set(ConsumerType::AlertDestination.as_str().into()),
                    consumer_id: Set(org_secret_consumers::ANY_CONSUMER.into()),
                    added_by: Set("owner".into()),
                    added_at: Set(1),
                },
            )
            .await
            .unwrap();
            let head = org_secret_values::insert_in(
                db,
                org_secret_values::ActiveModel {
                    id: Set(ksuid()),
                    org_id: Set(org.clone()),
                    secret_id: Set(row.id),
                    env_id: Set(ORG_ENV_ID.into()),
                    env_incarnation: Set(String::new()),
                    state: Set("set".into()),
                    value_ref: Set(Some(ksuid())),
                    value_rev: Set(ksuid()),
                    value_version: Set(1),
                    updated_by: Set("owner".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            Self::seal(db, &head, value, SecretKind::Variable).await;
        }

        async fn delete(&self) {
            let mut row = self.secret.clone().into_active_model();
            row.state = Set("deleted".into());
            row.policy_rev = Set(ksuid());
            org_secrets::update_in(get_orm_client_rw().await, &self.secret.org_id, row)
                .await
                .unwrap()
                .unwrap();
        }

        async fn save(&self, endpoint: Endpoint) -> Destination {
            let destination = Destination {
                org_id: self.secret.org_id.clone(),
                name: "receiver".into(),
                module: Module::Alert {
                    template: None,
                    destination_type: DestinationType::Http(endpoint),
                },
                ..Default::default()
            };
            let principal = SavePrincipal {
                user_id: "root@example.org".into(),
                role: UserRole::Root,
            };
            crate::alerts::destinations::save_with_binds("", destination, true, &principal, vec![])
                .await
                .unwrap()
                .0
        }
    }

    struct CaptureLogs(Mutex<Vec<String>>);

    impl log::Log for CaptureLogs {
        fn enabled(&self, meta: &log::Metadata<'_>) -> bool {
            meta.target().starts_with("openobserve_core::alerts")
        }

        fn log(&self, record: &log::Record<'_>) {
            if self.enabled(record.metadata()) {
                self.0.lock().unwrap().push(record.args().to_string());
            }
        }

        fn flush(&self) {}
    }

    static CAPTURE: CaptureLogs = CaptureLogs(Mutex::new(Vec::new()));

    fn run<F: Future<Output = ()>>(path: &str, task: impl FnOnce(std::path::PathBuf) -> F) {
        if std::env::var_os("ZO_META_STORE").is_none() {
            return;
        }
        let base = std::env::var_os("ZO_DATA_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let data = base.join(format!("destination-send-{}", ksuid()));
        let dir = format!("{}/", data.display());
        isolated(
            path,
            &[
                ("O2_SECRET_STORE_REFS_ENABLED", "true"),
                ("ZO_DATA_DIR", &dir),
                ("ZO_SSRF_ALLOWED_CIDRS", "127.0.0.1/32"),
                ("ZO_ALERT_NOTIFICATION_TIMEOUT", "5"),
            ],
            || async {
                std::fs::create_dir_all(&config::get_config().common.data_db_dir).unwrap();
                infra::db_init().await.unwrap();
                infra::table::migrate().await.unwrap();
                cipher::install_master_key(Ok(cipher::MasterKeyMode::None)).unwrap();
                gate::force_state_for_tests(Some(gate::GateView {
                    state: GateState::Latched,
                    suspended: false,
                }));
                log::set_logger(&CAPTURE).unwrap();
                log::set_max_level(log::LevelFilter::Debug);
                task(std::env::var_os("ZO_DATA_DIR").unwrap().into()).await;
            },
        );
        if data.exists() {
            std::fs::remove_dir_all(data).unwrap();
        }
    }

    fn http(destination: &Destination) -> (&DestinationType, &Endpoint) {
        let Module::Alert {
            destination_type: ty @ DestinationType::Http(endpoint),
            ..
        } = &destination.module
        else {
            panic!("expected HTTP alert destination")
        };
        (ty, endpoint)
    }

    fn with_header(url: String, platform: Option<&str>) -> Endpoint {
        Endpoint {
            url,
            destination_type: platform.map(str::to_owned),
            headers: Some([("Authorization".into(), format!("Bearer {TOKEN}"))].into()),
            ..Default::default()
        }
    }

    fn root_sender(user_id: &str) -> SavePrincipal {
        common::infra::config::ORG_USERS.insert(
            format!("{}/{user_id}", config::DEFAULT_ORG),
            OrgUserRecord::new(config::DEFAULT_ORG, user_id, UserRole::Root, "", None),
        );
        SavePrincipal {
            user_id: user_id.into(),
            role: UserRole::Root,
        }
    }

    #[test]
    fn saved_destination_snapshot_authorizes_its_url_and_header_slots() {
        run(
            concat!(
                module_path!(),
                "::saved_destination_snapshot_authorizes_its_url_and_header_slots"
            ),
            |_| async {
                let base = "https://8.8.8.8";
                let fixture = Fixture::new(base, "TOKEN", CANARY).await;
                let destination = fixture
                    .save(with_header(format!("{base}/events/{TOKEN}"), None))
                    .await;
                let (_, endpoint) = http(&destination);
                let attempt = SecretRequest::new(
                    Some(&destination),
                    endpoint,
                    destination_client_builder(false),
                )
                .await
                .unwrap()
                .unwrap();
                let request = attempt.request(Method::POST, "").build().unwrap();
                assert_eq!(request.url().path(), format!("/events/{CANARY}"));
                assert_eq!(
                    request.headers()["authorization"],
                    format!("Bearer {CANARY}")
                );
                assert!(request.headers()["authorization"].is_sensitive());
            },
        );
    }

    #[test]
    fn t29_a_human_send_checks_use_on_the_refs_it_resolved() {
        run(
            concat!(
                module_path!(),
                "::t29_a_human_send_checks_use_on_the_refs_it_resolved"
            ),
            |_| async {
                let base = "https://8.8.8.8";
                let fixture = Fixture::new(base, "TOKEN", CANARY).await;
                let destination = fixture
                    .save(with_header(format!("{base}/events/{TOKEN}"), None))
                    .await;
                let (_, endpoint) = http(&destination);
                let attempt = || {
                    SecretRequest::new(
                        Some(&destination),
                        endpoint,
                        destination_client_builder(false),
                    )
                };
                let refused = as_human_sender("t29-no-use@example.com".into(), attempt())
                    .await
                    .err()
                    .expect("a requester without use is refused at materialization");
                assert!(
                    refused.to_string().contains("secret_use_denied"),
                    "{refused}"
                );
                assert!(attempt().await.unwrap().is_some(), "a system send resolves");
            },
        );
    }

    #[test]
    fn s3_02_a_requester_is_refused_before_any_value_is_read() {
        run(
            concat!(
                module_path!(),
                "::s3_02_a_requester_is_refused_before_any_value_is_read"
            ),
            |_| async {
                let base = "https://8.8.8.8";
                let fixture = Fixture::new(base, "TOKEN", CANARY).await;
                let destination = fixture
                    .save(with_header(format!("{base}/events/{TOKEN}"), None))
                    .await;
                // A head pointing at no credential fails only when its value is read.
                let mut head = fixture.head.clone().into_active_model();
                head.value_ref = Set(Some(ksuid()));
                org_secret_values::update_in(get_orm_client_rw().await, &fixture.head.org_id, head)
                    .await
                    .unwrap()
                    .unwrap();
                let (_, endpoint) = http(&destination);
                let attempt = || {
                    SecretRequest::new(
                        Some(&destination),
                        endpoint,
                        destination_client_builder(false),
                    )
                };
                let refused = as_human_sender("s3-02-no-use@example.com".into(), attempt())
                    .await
                    .err()
                    .expect("a requester without use is refused");
                assert!(
                    refused.to_string().contains("secret_use_denied"),
                    "the use check ran after a value read: {refused}"
                );
                let unread = attempt().await.err().expect("the value is unreadable");
                assert!(
                    unread.to_string().contains("secret_unavailable"),
                    "{unread}"
                );
            },
        );
    }

    #[test]
    fn t19_store_variables_are_substituted_in_saved_destination_sends() {
        run(
            concat!(
                module_path!(),
                "::t19_store_variables_are_substituted_in_saved_destination_sends"
            ),
            |_| async {
                let base = "https://8.8.8.8";
                let mut endpoint = with_header(format!("{base}/events/{TOKEN}"), None);
                endpoint
                    .headers
                    .as_mut()
                    .unwrap()
                    .insert("X-Region".into(), "r-{{vars.REGION}}".into());
                for endpoint in [
                    endpoint,
                    Endpoint {
                        url: format!("{base}/events"),
                        headers: Some([("X-Region".into(), "r-{{vars.REGION}}".into())].into()),
                        ..Default::default()
                    },
                ] {
                    let fixture = Fixture::new(base, "TOKEN", CANARY).await;
                    fixture.variable("REGION", "eu-west").await;
                    let destination = fixture.save(endpoint).await;
                    let (_, endpoint) = http(&destination);
                    let attempt = SecretRequest::new(
                        Some(&destination),
                        endpoint,
                        destination_client_builder(false),
                    )
                    .await
                    .unwrap()
                    .expect("a destination with a store variable resolves through the store");
                    let request = attempt.request(Method::POST, "").build().unwrap();
                    assert_eq!(request.headers()["x-region"], "r-eu-west");
                }
            },
        );
    }

    #[test]
    fn saved_variable_only_test_send_checks_use_and_substitutes_its_value() {
        use config::meta::alerts::{
            content_spec::ContentSpec, notification_kind::NotificationKind,
        };

        use super::super::test_send::{TestSendError, test_send_saved};

        run(
            concat!(
                module_path!(),
                "::saved_variable_only_test_send_checks_use_and_substitutes_its_value"
            ),
            |dir| async move {
                let mut receiver = Receiver::start(&dir).await;
                let fixture = Fixture::new(&receiver.base, "TOKEN", CANARY).await;
                fixture.variable("REGION", "eu-west").await;
                let destination = fixture
                    .save(Endpoint {
                        url: format!("{}/events", receiver.base),
                        headers: Some([("X-Region".into(), "{{vars.REGION}}".into())].into()),
                        ..Default::default()
                    })
                    .await;
                let sender = root_sender("variable-test-send@example.org");
                let spec = ContentSpec {
                    title: "Variable destination".into(),
                    body: "Test message".into(),
                    ..Default::default()
                };
                let (outcome, ()) = tokio::join!(
                    test_send_saved(
                        &destination.org_id,
                        &sender,
                        &destination,
                        &spec,
                        NotificationKind::Alert,
                    ),
                    async {
                        let request = receiver.request().await;
                        assert_eq!(request["headers"]["x-region"], "eu-west");
                        receiver.reply(json!({"status": 200})).await;
                    }
                );
                assert_eq!(outcome.unwrap(), "sent status: 200 OK");
                let denied = SavePrincipal {
                    user_id: "variable-no-use@example.org".into(),
                    role: UserRole::Editor,
                };
                let refused = test_send_saved(
                    &destination.org_id,
                    &denied,
                    &destination,
                    &spec,
                    NotificationKind::Alert,
                )
                .await
                .unwrap_err();
                assert!(matches!(refused, TestSendError::Secret(refusal)
                    if refusal.code == SecretErrorCode::SecretUseDenied));
                common::infra::config::ORG_USERS.remove(&format!(
                    "{}/{}",
                    config::DEFAULT_ORG,
                    sender.user_id
                ));
                let revoked = test_send_saved(
                    &destination.org_id,
                    &sender,
                    &destination,
                    &spec,
                    NotificationKind::Alert,
                )
                .await
                .unwrap_err();
                assert!(
                    matches!(revoked, TestSendError::SavedDispatchFailed { message, .. }
                    if message.contains("secret_use_denied"))
                );
                receiver.assert_no_request().await;
            },
        );
    }

    #[test]
    fn manual_trigger_rechecks_variable_use_between_destination_sends() {
        use config::meta::{
            alerts::alert::Alert,
            folder::{Folder, FolderType},
        };

        run(
            concat!(
                module_path!(),
                "::manual_trigger_rechecks_variable_use_between_destination_sends"
            ),
            |dir| async move {
                let mut receiver = Receiver::start(&dir).await;
                let fixture = Fixture::new(&receiver.base, "TOKEN", CANARY).await;
                fixture.variable("REGION", "eu-west").await;
                let destination = fixture
                    .save(Endpoint {
                        url: format!("{}/events", receiver.base),
                        headers: Some([("X-Region".into(), "{{vars.REGION}}".into())].into()),
                        ..Default::default()
                    })
                    .await;
                let sender = root_sender("variable-manual-trigger@example.org");
                let mut second = destination.clone();
                second.id = None;
                second.name = "second".into();
                let (second, _) =
                    crate::alerts::destinations::save_with_binds("", second, true, &sender, vec![])
                        .await
                        .unwrap();
                let db = get_orm_client_rw().await;
                infra::table::folders::get_or_create(
                    &destination.org_id,
                    Folder {
                        folder_id: "default".into(),
                        name: "default".into(),
                        ..Default::default()
                    },
                    FolderType::Alerts,
                )
                .await
                .unwrap();
                let alert = infra::table::alerts::create(
                    db,
                    &destination.org_id,
                    "default",
                    {
                        let mut alert = Alert::default();
                        alert.org_id = destination.org_id.clone();
                        alert.name = "manual-variable-send".into();
                        alert.destinations = vec![destination.name.clone(), second.name];
                        alert
                    },
                    false,
                )
                .await
                .unwrap();
                let (outcome, ()) = tokio::join!(
                    crate::alerts::alert::trigger_by_id(
                        db,
                        &destination.org_id,
                        alert.id.unwrap(),
                        &sender.user_id,
                    ),
                    async {
                        let request = receiver.request().await;
                        assert_eq!(request["headers"]["x-region"], "eu-west");
                        common::infra::config::ORG_USERS.remove(&format!(
                            "{}/{}",
                            config::DEFAULT_ORG,
                            sender.user_id
                        ));
                        receiver.reply(json!({"status": 200})).await;
                    }
                );
                let outcome = outcome.unwrap();
                assert!(
                    outcome
                        .warning()
                        .is_some_and(|text| text.contains("secret_use_denied"))
                );
                receiver.assert_no_request().await;
                let (_, endpoint) = http(&destination);
                let (automated, ()) = tokio::join!(
                    send_saved_http_notification(&destination, endpoint, None, "{}".into()),
                    async {
                        receiver.request().await;
                        receiver.reply(json!({"status": 200})).await;
                    }
                );
                assert_eq!(automated.unwrap(), "sent status: 200 OK");
            },
        );
    }

    #[test]
    fn t34_auth_failure_resends_once_only_when_the_refetched_value_changed() {
        run(
            concat!(
                module_path!(),
                "::t34_auth_failure_resends_once_only_when_the_refetched_value_changed"
            ),
            |dir| async move {
                let mut receiver = Receiver::start(&dir).await;
                let fixture = Fixture::new(&receiver.base, "TOKEN", CANARY).await;
                let destination = fixture
                    .save(with_header(format!("{}/events", receiver.base), None))
                    .await;
                let (_, endpoint) = http(&destination);
                let send =
                    || send_saved_http_notification(&destination, endpoint, None, "{}".into());

                let (outcome, ()) = tokio::join!(send(), async {
                    let request = receiver.request().await;
                    assert_eq!(
                        request["headers"]["authorization"],
                        format!("Bearer {CANARY}")
                    );
                    fixture.rotate("rotated").await;
                    receiver.reply(json!({"status": 401})).await;
                    let request = receiver.request().await;
                    assert_eq!(request["headers"]["authorization"], "Bearer rotated");
                    receiver.reply(json!({"status": 200})).await;
                });
                assert_eq!(outcome.unwrap(), "sent status: 200 OK");

                // Inside the cooldown nothing is evicted, so a second 401 is not resent.
                let (outcome, ()) = tokio::join!(send(), async {
                    receiver.request().await;
                    fixture.rotate("again").await;
                    receiver.reply(json!({"status": 403})).await;
                });
                assert!(outcome.is_err());
                receiver.assert_no_request().await;
            },
        );
    }

    #[test]
    fn secret_transport_error_only_returns_the_class() {
        let error = reqwest::Client::new()
            .get(format!("http://[{CANARY}"))
            .build()
            .unwrap_err();
        assert_eq!(
            secret_transport_error(error, &Redactor::for_attempt([CANARY])).to_string(),
            "transport_error:connect"
        );
    }

    #[test]
    fn retries_resolve_latest_header_and_refuse_redirects_and_deleted_values() {
        run(
            concat!(
                module_path!(),
                "::retries_resolve_latest_header_and_refuse_redirects_and_deleted_values"
            ),
            |dir| async move {
                let mut receiver = Receiver::start(&dir).await;
                let fixture = Fixture::new(&receiver.base, "TOKEN", CANARY).await;
                let destination = fixture
                    .save(with_header(
                        format!("{}/events/{TOKEN}", receiver.base),
                        None,
                    ))
                    .await;
                let (_, endpoint) = http(&destination);
                let send =
                    || send_saved_http_notification(&destination, endpoint, None, "{}".into());

                let (outcome, ()) = tokio::join!(send(), async {
                    let request = receiver.request().await;
                    assert_eq!(
                        request["headers"]["authorization"],
                        format!("Bearer {CANARY}")
                    );
                    assert_eq!(request["path"], format!("/events/{CANARY}"));
                    receiver
                        .reply(json!({"status": 500, "body": request.to_string()}))
                        .await;
                });
                assert_eq!(
                    outcome.unwrap_err().to_string(),
                    "sent error status: 500 Internal Server Error"
                );

                fixture.rotate("rotated").await;
                let (outcome, ()) = tokio::join!(send(), async {
                    let request = receiver.request().await;
                    assert_eq!(request["headers"]["authorization"], "Bearer rotated");
                    assert_eq!(request["path"], "/events/rotated");
                    receiver
                        .reply(json!({"status": 200, "body": request.to_string()}))
                        .await;
                });
                assert_eq!(outcome.unwrap(), "sent status: 200 OK");

                let (outcome, ()) = tokio::join!(send(), async {
                    receiver.request().await;
                    let location = format!("{}/redirected", receiver.base);
                    receiver
                        .reply(json!({"status": 302, "headers": {"Location": location}}))
                        .await;
                });
                assert_eq!(outcome.unwrap_err().to_string(), "redirect_refused:302");
                receiver.assert_no_request().await;

                fixture.delete().await;
                assert_eq!(
                    send().await.unwrap_err().to_string(),
                    "secret_error:secret_deleted:TOKEN"
                );
                receiver.assert_no_request().await;
            },
        );
    }

    #[test]
    fn pagerduty_writes_credential_only_into_routing_key_and_ignores_echoes() {
        run(
            concat!(
                module_path!(),
                "::pagerduty_writes_credential_only_into_routing_key_and_ignores_echoes"
            ),
            |dir| async move {
                let mut receiver = Receiver::start(&dir).await;
                let fixture = Fixture::new(&receiver.base, "PD", CANARY).await;
                let destination = fixture
                    .save(Endpoint {
                        url: format!("{}/events", receiver.base),
                        destination_type: Some("pagerduty".into()),
                        metadata: [("routing_key".into(), "{{secrets.PD}}".into())].into(),
                        ..Default::default()
                    })
                    .await;
                let (ty, endpoint) = http(&destination);
                let template = Template {
                    body: r#"{"payload":{"summary":"{routing_key}"}}"#.into(),
                    kind: TemplateKind::Custom,
                    ..Default::default()
                };
                let mut ctx = NotificationContext {
                    episode_id: Some("episode".into()),
                    ..Default::default()
                };
                let echoes = [
                    CANARY,
                    "dTQ0K2NhbmFyeSE=",
                    "dTQ0K2NhbmFyeSE",
                    "u44%2Bcanary%21",
                ];
                let (outcome, ()) = tokio::join!(
                    send_to_destination(
                        &destination.org_id,
                        Subject::Alert("alert"),
                        &destination,
                        ty,
                        &template,
                        &mut ctx
                    ),
                    async {
                        let request = receiver.request().await;
                        let body: Value =
                            serde_json::from_str(request["body"].as_str().unwrap()).unwrap();
                        assert_eq!(
                            body,
                            json!({
                                "routing_key": CANARY, "dedup_key": "episode", "payload": {"summary": ""}
                            })
                        );
                        receiver
                            .reply(json!({"status": 500, "headers": {
                        "X-Echo": CANARY, "Set-Cookie": format!("secret={CANARY}"),
                    }, "body": format!("{request} {echoes:?}")}))
                            .await;
                    },
                );
                assert!(ctx.metadata.is_empty());
                let webhook = super::super::render::webhook::context_object(&ctx);
                assert!(webhook.get("routing_key").is_none());
                assert_eq!(
                    outcome.unwrap_err().to_string(),
                    "sent error status: 500 Internal Server Error"
                );
                let (outcome, ()) = tokio::join!(
                    platform::send_saved_resolve(
                        &destination,
                        platform::Platform::PagerDuty,
                        endpoint,
                        "episode",
                    ),
                    async {
                        let request = receiver.request().await;
                        let body: Value =
                            serde_json::from_str(request["body"].as_str().unwrap()).unwrap();
                        assert_eq!(
                            body,
                            json!({
                                "routing_key": CANARY, "dedup_key": "episode", "event_action": "resolve"
                            })
                        );
                        receiver
                            .reply(json!({"status": 202, "body": request.to_string()}))
                            .await;
                    },
                );
                assert_eq!(outcome.unwrap(), "sent status: 202 Accepted");
                let logs = CAPTURE.0.lock().unwrap().join("\n");
                assert!(logs.contains(&format!(
                    "Alert notification failed for destination {} with status: 500",
                    destination.id.unwrap()
                )));
                for echo in echoes {
                    assert!(!logs.contains(echo));
                }
                assert!(!logs.contains(&receiver.base));
                assert!(!logs.contains("payload:"));
            },
        );
    }

    #[test]
    fn servicenow_lookup_and_patch_materialize_independently() {
        run(
            concat!(
                module_path!(),
                "::servicenow_lookup_and_patch_materialize_independently"
            ),
            |dir| async move {
                let mut receiver = Receiver::start(&dir).await;
                let fixture = Fixture::new(&receiver.base, "TOKEN", CANARY).await;
                let destination = fixture
                    .save(with_header(
                        format!("{}/incidents", receiver.base),
                        Some("servicenow"),
                    ))
                    .await;
                let (_, endpoint) = http(&destination);
                let send = || {
                    platform::send_saved_resolve(
                        &destination,
                        platform::Platform::ServiceNow,
                        endpoint,
                        "episode",
                    )
                };
                let (outcome, ()) = tokio::join!(send(), async {
                    let lookup = receiver.request().await;
                    assert!(lookup["path"].as_str().unwrap().contains("sysparm_query="));
                    assert_eq!(
                        lookup["headers"]["authorization"],
                        format!("Bearer {CANARY}")
                    );
                    fixture.rotate("rotated").await;
                    receiver
                        .reply(json!({"status": 200, "body": json!({"result": [
                    {"sys_id": "incident1"}, {"sys_id": CANARY}
                ]}).to_string()}))
                        .await;
                    let patch = receiver.request().await;
                    assert_eq!(patch["path"], "/incidents/incident1");
                    assert_eq!(patch["headers"]["authorization"], "Bearer rotated");
                    receiver
                        .reply(json!({"status": 200, "body": patch.to_string()}))
                        .await;
                });
                assert_eq!(outcome.unwrap(), "sent status: 200 OK");

                let (outcome, ()) = tokio::join!(send(), async {
                    receiver.request().await;
                    fixture.delete().await;
                    receiver.reply(json!({"status": 200, "body": r#"{"result":[{"sys_id":"incident1"}]}"#})).await;
                });
                assert_eq!(
                    outcome.unwrap_err().to_string(),
                    "secret_error:secret_deleted:TOKEN"
                );
                receiver.assert_no_request().await;
            },
        );
    }

    #[test]
    fn other_metadata_refs_fail_at_materialization() {
        isolated(
            concat!(
                module_path!(),
                "::other_metadata_refs_fail_at_materialization"
            ),
            &[("O2_SECRET_STORE_REFS_ENABLED", "true")],
            || async {
                let destination = Destination {
                    module: Module::Alert {
                        template: None,
                        destination_type: DestinationType::Http(Endpoint {
                            url: "https://example.com".into(),
                            destination_type: Some("servicenow".into()),
                            metadata: [("credential_resolutionCode".into(), TOKEN.into())].into(),
                            ..Default::default()
                        }),
                    },
                    ..Default::default()
                };
                let (_, endpoint) = http(&destination);
                let result = platform::send_saved_resolve(
                    &destination,
                    platform::Platform::ServiceNow,
                    endpoint,
                    "episode",
                )
                .await;
                assert_eq!(
                    result.unwrap_err().to_string(),
                    "secret_error:ref_not_allowed_in_field:TOKEN"
                );
            },
        );
    }

    #[test]
    fn every_send_arm_and_route_has_a_secret_ref_contract() {
        let classification = |ty: &DestinationType| match ty {
            DestinationType::Http(endpoint) if jira::is_jira(endpoint) => "Jira request",
            DestinationType::Http(_) => match derive_channel_format(ty) {
                ChannelFormat::Discord => "webhook or attachment request",
                ChannelFormat::Webhook
                | ChannelFormat::Slack
                | ChannelFormat::TeamsAdaptiveCard
                | ChannelFormat::TeamsMessageCard
                | ChannelFormat::PagerDuty
                | ChannelFormat::Opsgenie
                | ChannelFormat::ServiceNow => "webhook request",
                ChannelFormat::Email | ChannelFormat::Sns => panic!("HTTP rendered as non-HTTP"),
            },
            DestinationType::Email(_) | DestinationType::Sns(_) | DestinationType::SlackApp(_) => {
                assert!(
                    refuse_unsupported_refs(ty)
                        .unwrap_err()
                        .to_string()
                        .contains("ref_not_allowed_in_field")
                );
                "refused"
            }
        };
        let http = |kind: &str| {
            DestinationType::Http(Endpoint {
                destination_type: Some(kind.into()),
                ..with_header("https://example.com/".into(), None)
            })
        };
        let email = DestinationType::Email(Email {
            recipients: vec![TOKEN.into()],
        });
        let sns = DestinationType::Sns(AwsSns {
            sns_topic_arn: TOKEN.into(),
            ..Default::default()
        });
        let slack = DestinationType::SlackApp(SlackAppTarget {
            channel_id: TOKEN.into(),
            ..Default::default()
        });
        for kind in [TemplateKind::Custom, TemplateKind::Content] {
            match kind {
                TemplateKind::Custom => {
                    assert_eq!(classification(&http("webhook")), "webhook request")
                }
                TemplateKind::Content => assert_eq!(
                    classification(&http("discord")),
                    "webhook or attachment request"
                ),
            }
            for unsupported in [&email, &sns, &slack] {
                assert_eq!(classification(unsupported), "refused");
            }
            assert_eq!(classification(&http("jira")), "Jira request");
        }

        use notify::Route;
        let classification = |route| match route {
            Route::Render => "classified by destination",
            Route::Legacy(_) => "webhook request",
            Route::PlatformResolve(platform) => match platform {
                platform::Platform::PagerDuty | platform::Platform::Opsgenie => "platform request",
                platform::Platform::ServiceNow => "lookup and patch requests",
            },
        };
        assert_eq!(classification(Route::Render), "classified by destination");
        assert_eq!(
            classification(Route::Legacy(Value::Null)),
            "webhook request"
        );
        assert_eq!(
            classification(Route::PlatformResolve(platform::Platform::PagerDuty)),
            "platform request"
        );
        assert_eq!(
            classification(Route::PlatformResolve(platform::Platform::Opsgenie)),
            "platform request"
        );
        assert_eq!(
            classification(Route::PlatformResolve(platform::Platform::ServiceNow)),
            "lookup and patch requests"
        );
    }

    #[test]
    fn a_custom_email_subject_is_plain_text_where_the_body_is_escaped() {
        let template = Template {
            name: "check-mail".into(),
            template_type: TemplateType::Email {
                title: "{check_name} is down".into(),
            },
            ..Default::default()
        };
        let mut ctx = NotificationContext {
            context_attributes: vec![("check_name".into(), "API \"edge\" & Bob's worker".into())],
            ..Default::default()
        };
        ctx.render_hints.escape_email_attributes = true;
        assert_eq!(
            custom_title(&template, &ctx, true),
            "API \"edge\" & Bob's worker is down"
        );
    }

    #[test]
    fn a_test_send_marks_a_custom_email_subject_and_its_fallback() {
        let titled = Template {
            name: "check-mail".into(),
            template_type: TemplateType::Email {
                title: "{check_name} is down".into(),
            },
            ..Default::default()
        };
        let untitled = Template {
            name: "plain".into(),
            ..Default::default()
        };
        let mut ctx = NotificationContext {
            context_attributes: vec![("check_name".into(), "api".into())],
            ..Default::default()
        };
        ctx.render_hints.fallback_subject = Some("Nightly started".into());
        assert_eq!(custom_title(&titled, &ctx, true), "api is down");
        assert_eq!(custom_title(&untitled, &ctx, false), "Nightly started");
        ctx.render_hints.test_marker = true;
        assert_eq!(custom_title(&titled, &ctx, true), "[TEST] api is down");
        assert_eq!(
            custom_title(&untitled, &ctx, false),
            "[TEST] Nightly started"
        );
    }

    #[test]
    fn the_subject_rule_per_template_kind() {
        let s = |a: &str, b: &str| (a.to_string(), b.to_string());
        let title = || "Email title".to_string();
        assert_eq!(
            custom_subjects(Subject::Alert("cpu"), title()),
            s("Email title", "cpu")
        );
        assert_eq!(
            custom_subjects(Subject::Kind(Some("[opened] db")), title()),
            s("[opened] db", "[opened] db")
        );
        assert_eq!(
            custom_subjects(Subject::Kind(None), title()),
            s("Email title", "Email title")
        );
        let rendered = || "Rendered".to_string();
        assert_eq!(
            content_subjects(Subject::Alert("cpu"), rendered(), "Card"),
            s("Rendered", "cpu")
        );
        assert_eq!(
            content_subjects(Subject::Kind(Some("[opened] db")), rendered(), "Card"),
            s("[opened] db", "[opened] db")
        );
        assert_eq!(
            content_subjects(Subject::Kind(None), rendered(), "Card"),
            s("Rendered", "Card")
        );
    }

    #[test]
    fn test_members_to_send() {
        let to = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        type Expected = Result<Vec<String>, String>;
        let cases: Vec<(Vec<String>, Vec<String>, Expected)> = vec![
            (to(&["a@x.com"]), vec![], Ok(to(&["a@x.com"]))),
            (to(&["a@x.com"]), to(&["gone@x.com"]), Ok(to(&["a@x.com"]))),
            (vec![], vec![], Ok(vec![])),
            (
                vec![],
                to(&["gone@x.com", "left@x.com"]),
                Err("Email not sent: no recipient is part of this org (skipped: gone@x.com, left@x.com)".to_string()),
            ),
        ];
        for (kept, skipped, expected) in cases {
            let got = members_to_send(kept, &skipped)
                .map(|email| email.recipients)
                .map_err(|e| e.to_string());
            assert_eq!(got, expected, "skipped {skipped:?}");
        }
    }
}
