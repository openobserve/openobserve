// Copyright 2026 OpenObserve Inc.

use std::{fmt, time::Duration};

use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use futures::StreamExt;
use hmac::{Hmac, Mac};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const SLACK_AUTHORIZE_URL: &str = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL: &str = "https://slack.com/api/oauth.v2.access";
const STATE_VERSION: u8 = 1;
const STATE_MAX_AGE_SECONDS: i64 = 10 * 60;
const STATE_FUTURE_TOLERANCE_SECONDS: i64 = 60;
const MAX_STATE_LENGTH: usize = 4096;
const MAX_SLACK_RESPONSE_LENGTH: usize = 64 * 1024;
const STATE_SIGNATURE_DOMAIN: &[u8] = b"openobserve/slack/oauth/state-signature/v1\0";
const STATE_CONTEXT_DOMAIN: &[u8] = b"openobserve/slack/oauth/context/v1\0";

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
struct SlackOAuthSettings {
    client_id: String,
    client_secret: String,
    redirect_url: String,
}

impl SlackOAuthSettings {
    fn from_config() -> Result<Self, SlackOAuthError> {
        let cfg = config::get_config();
        let client_id = cfg.slack_oauth.client_id.trim().to_string();
        let client_secret = cfg.slack_oauth.client_secret.trim().to_string();
        if client_id.is_empty() || client_secret.is_empty() {
            return Err(SlackOAuthError::NotConfigured);
        }

        let redirect_url = if cfg.slack_oauth.redirect_url.trim().is_empty() {
            default_redirect_url(&cfg.common.web_url, &cfg.common.base_uri)
        } else {
            cfg.slack_oauth.redirect_url.trim().to_string()
        };
        validate_redirect_url(&redirect_url)?;

        Ok(Self {
            client_id,
            client_secret,
            redirect_url,
        })
    }
}

#[derive(Debug)]
enum SlackOAuthError {
    NotConfigured,
    InvalidConfiguration,
    InvalidState,
    AuthorizationFailed,
    InvalidSlackResponse,
    MissingWebhook,
    InvalidWebhook,
    SlackUnavailable,
}

impl fmt::Display for SlackOAuthError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::NotConfigured => "Slack OAuth is not configured",
            Self::InvalidConfiguration => "Slack OAuth configuration is invalid",
            Self::InvalidState => "Slack authorization session is invalid or expired",
            Self::AuthorizationFailed => "Slack authorization could not be completed",
            Self::InvalidSlackResponse => "Slack returned an invalid authorization response",
            Self::MissingWebhook => "Slack did not return an incoming webhook",
            Self::InvalidWebhook => "Slack returned an invalid incoming webhook",
            Self::SlackUnavailable => "Slack authorization is temporarily unavailable",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for SlackOAuthError {}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct SlackOAuthState {
    version: u8,
    context_binding: String,
    issued_at: i64,
    // Makes concurrent flows for one user distinct; it is NOT single-use — replay
    // inside the TTL is bounded by Slack's own one-time code, not by this field.
    nonce: String,
}

/// Where to send the browser to authorize the app; the signed state is already embedded in the URL.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SlackOAuthStartResponse {
    authorization_url: String,
}

/// The code Slack handed the callback, plus the state issued by `start`, which must still be
/// unexpired.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SlackOAuthExchangeRequest {
    code: String,
    state: String,
}

#[derive(Debug, Deserialize)]
struct SlackOAuthApiResponse {
    ok: bool,
    team: Option<SlackOAuthTeam>,
    incoming_webhook: Option<SlackIncomingWebhook>,
}

#[derive(Debug, Deserialize)]
struct SlackOAuthTeam {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct SlackIncomingWebhook {
    channel: String,
    channel_id: String,
    url: String,
}

/// Carries only the incoming webhook Slack bound to the chosen channel; the access token never
/// leaves the server.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SlackOAuthConnection {
    webhook_url: String,
    channel: String,
    channel_id: String,
    team_id: String,
    team_name: String,
}

fn default_redirect_url(web_url: &str, base_uri: &str) -> String {
    let web_url = web_url.trim_end_matches('/');
    let base_uri = base_uri.trim_matches('/');
    if base_uri.is_empty() {
        format!("{web_url}/web/slack/oauth/callback")
    } else {
        format!("{web_url}/{base_uri}/web/slack/oauth/callback")
    }
}

fn validate_redirect_url(redirect_url: &str) -> Result<(), SlackOAuthError> {
    let parsed =
        url::Url::parse(redirect_url).map_err(|_| SlackOAuthError::InvalidConfiguration)?;
    let is_local_http = parsed.scheme() == "http"
        && matches!(
            parsed.host_str(),
            Some("localhost") | Some("127.0.0.1") | Some("::1")
        );
    if (parsed.scheme() != "https" && !is_local_http)
        || parsed.host_str().is_none()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(SlackOAuthError::InvalidConfiguration);
    }
    Ok(())
}

fn build_authorization_url(
    settings: &SlackOAuthSettings,
    state: &str,
) -> Result<String, SlackOAuthError> {
    let mut url =
        url::Url::parse(SLACK_AUTHORIZE_URL).map_err(|_| SlackOAuthError::InvalidConfiguration)?;
    url.query_pairs_mut()
        .append_pair("client_id", &settings.client_id)
        .append_pair("scope", "incoming-webhook")
        .append_pair("redirect_uri", &settings.redirect_url)
        .append_pair("state", state);
    Ok(url.into())
}

fn sign_state(
    settings: &SlackOAuthSettings,
    state: SlackOAuthState,
) -> Result<String, SlackOAuthError> {
    let payload = serde_json::to_vec(&state).map_err(|_| SlackOAuthError::InvalidState)?;
    let payload = URL_SAFE_NO_PAD.encode(payload);
    let mut signer = HmacSha256::new_from_slice(settings.client_secret.as_bytes())
        .map_err(|_| SlackOAuthError::InvalidConfiguration)?;
    signer.update(STATE_SIGNATURE_DOMAIN);
    signer.update(payload.as_bytes());
    let signature = URL_SAFE_NO_PAD.encode(signer.finalize().into_bytes());
    Ok(format!("{payload}.{signature}"))
}

fn context_mac(secret: &str, org_id: &str, user_id: &str) -> Result<HmacSha256, SlackOAuthError> {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).map_err(|_| SlackOAuthError::InvalidState)?;
    mac.update(STATE_CONTEXT_DOMAIN);
    for value in [org_id, user_id] {
        mac.update(&(value.len() as u64).to_be_bytes());
        mac.update(value.as_bytes());
    }
    Ok(mac)
}

fn create_context_binding(
    secret: &str,
    org_id: &str,
    user_id: &str,
) -> Result<String, SlackOAuthError> {
    Ok(URL_SAFE_NO_PAD.encode(
        context_mac(secret, org_id, user_id)?
            .finalize()
            .into_bytes(),
    ))
}

fn verify_context_binding(
    binding: &str,
    secret: &str,
    org_id: &str,
    user_id: &str,
) -> Result<(), SlackOAuthError> {
    let binding = URL_SAFE_NO_PAD
        .decode(binding)
        .map_err(|_| SlackOAuthError::InvalidState)?;
    context_mac(secret, org_id, user_id)?
        .verify_slice(&binding)
        .map_err(|_| SlackOAuthError::InvalidState)
}

fn validate_state(
    token: &str,
    secret: &str,
    expected_org_id: &str,
    expected_user_id: &str,
    now: i64,
) -> Result<SlackOAuthState, SlackOAuthError> {
    if token.is_empty() || token.len() > MAX_STATE_LENGTH {
        return Err(SlackOAuthError::InvalidState);
    }
    let (payload, signature) = token.split_once('.').ok_or(SlackOAuthError::InvalidState)?;
    if payload.is_empty() || signature.is_empty() || signature.contains('.') {
        return Err(SlackOAuthError::InvalidState);
    }

    let signature = URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| SlackOAuthError::InvalidState)?;
    let mut verifier =
        HmacSha256::new_from_slice(secret.as_bytes()).map_err(|_| SlackOAuthError::InvalidState)?;
    verifier.update(STATE_SIGNATURE_DOMAIN);
    verifier.update(payload.as_bytes());
    verifier
        .verify_slice(&signature)
        .map_err(|_| SlackOAuthError::InvalidState)?;

    let payload = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| SlackOAuthError::InvalidState)?;
    let state: SlackOAuthState =
        serde_json::from_slice(&payload).map_err(|_| SlackOAuthError::InvalidState)?;

    if state.version != STATE_VERSION
        || state.nonce.is_empty()
        || state.issued_at < now - STATE_MAX_AGE_SECONDS
        || state.issued_at > now + STATE_FUTURE_TOLERANCE_SECONDS
    {
        return Err(SlackOAuthError::InvalidState);
    }
    verify_context_binding(
        &state.context_binding,
        secret,
        expected_org_id,
        expected_user_id,
    )?;
    Ok(state)
}

fn parse_slack_oauth_response(body: &str) -> Result<SlackOAuthConnection, SlackOAuthError> {
    if body.len() > MAX_SLACK_RESPONSE_LENGTH {
        return Err(SlackOAuthError::InvalidSlackResponse);
    }
    let response: SlackOAuthApiResponse =
        serde_json::from_str(body).map_err(|_| SlackOAuthError::InvalidSlackResponse)?;
    if !response.ok {
        return Err(SlackOAuthError::AuthorizationFailed);
    }

    let team = response.team.ok_or(SlackOAuthError::InvalidSlackResponse)?;
    let webhook = response
        .incoming_webhook
        .ok_or(SlackOAuthError::MissingWebhook)?;
    if team.id.trim().is_empty()
        || team.name.trim().is_empty()
        || webhook.channel.trim().is_empty()
        || webhook.channel_id.trim().is_empty()
    {
        return Err(SlackOAuthError::InvalidSlackResponse);
    }
    if !is_valid_slack_webhook_url(&webhook.url) {
        return Err(SlackOAuthError::InvalidWebhook);
    }

    Ok(SlackOAuthConnection {
        webhook_url: webhook.url,
        channel: webhook.channel,
        channel_id: webhook.channel_id,
        team_id: team.id,
        team_name: team.name,
    })
}

fn is_valid_slack_webhook_url(value: &str) -> bool {
    if value != value.trim() || value.chars().any(char::is_whitespace) {
        return false;
    }
    let Ok(parsed) = url::Url::parse(value) else {
        return false;
    };
    let valid_host = matches!(
        parsed.host_str(),
        Some("hooks.slack.com") | Some("hooks.slack-gov.com")
    );
    let segments = parsed
        .path_segments()
        .map(|segments| {
            segments
                .filter(|segment| !segment.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    parsed.scheme() == "https"
        && valid_host
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.port().is_none()
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && segments.len() == 4
        && segments[0] == "services"
        && segments[1..].iter().all(|segment| !segment.is_empty())
}

fn service_unavailable(error: SlackOAuthError) -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(MetaHttpResponse::error(
            StatusCode::SERVICE_UNAVAILABLE,
            error,
        )),
    )
        .into_response()
}

fn bad_gateway(error: SlackOAuthError) -> Response {
    (
        StatusCode::BAD_GATEWAY,
        Json(MetaHttpResponse::error(StatusCode::BAD_GATEWAY, error)),
    )
        .into_response()
}

fn slack_oauth_client() -> Result<reqwest::Client, SlackOAuthError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| SlackOAuthError::SlackUnavailable)
}

async fn read_slack_response_body(response: reqwest::Response) -> Result<String, SlackOAuthError> {
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| SlackOAuthError::InvalidSlackResponse)?;
        if body.len().saturating_add(chunk.len()) > MAX_SLACK_RESPONSE_LENGTH {
            return Err(SlackOAuthError::InvalidSlackResponse);
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| SlackOAuthError::InvalidSlackResponse)
}

/// Issues a Slack authorize URL whose state is signed and bound to this org and user.
#[utoipa::path(
    post,
    path = "/{org_id}/alerts/destinations/slack/oauth/start",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "StartSlackDestinationOAuth",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Slack authorization URL", body = SlackOAuthStartResponse),
        (status = 503, description = "Slack OAuth is not configured")
    )
)]
pub async fn start(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let settings = match SlackOAuthSettings::from_config() {
        Ok(settings) => settings,
        Err(error) => return service_unavailable(error),
    };
    let context_binding =
        match create_context_binding(&settings.client_secret, &org_id, &user_email.user_id) {
            Ok(binding) => binding,
            Err(error) => return MetaHttpResponse::internal_error(error),
        };
    let state = SlackOAuthState {
        version: STATE_VERSION,
        context_binding,
        issued_at: chrono::Utc::now().timestamp(),
        nonce: uuid::Uuid::now_v7().to_string(),
    };
    let state = match sign_state(&settings, state) {
        Ok(state) => state,
        Err(error) => return MetaHttpResponse::internal_error(error),
    };
    let authorization_url = match build_authorization_url(&settings, &state) {
        Ok(url) => url,
        Err(error) => return MetaHttpResponse::internal_error(error),
    };
    MetaHttpResponse::json(SlackOAuthStartResponse { authorization_url })
}

/// Verifies the signed state, redeems the code, and returns only the webhook Slack bound to the
/// chosen channel.
#[utoipa::path(
    post,
    path = "/{org_id}/alerts/destinations/slack/oauth/exchange",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ExchangeSlackDestinationOAuth",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = SlackOAuthExchangeRequest, content_type = "application/json"),
    responses(
        (status = 200, description = "Connected Slack incoming webhook", body = SlackOAuthConnection),
        (status = 400, description = "Invalid or rejected authorization"),
        (status = 502, description = "Slack authorization service failure"),
        (status = 503, description = "Slack OAuth is not configured")
    )
)]
pub async fn exchange(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(request): Json<SlackOAuthExchangeRequest>,
) -> Response {
    if request.code.trim().is_empty() || request.state.trim().is_empty() {
        return MetaHttpResponse::bad_request(SlackOAuthError::InvalidState);
    }
    let settings = match SlackOAuthSettings::from_config() {
        Ok(settings) => settings,
        Err(error) => return service_unavailable(error),
    };
    if let Err(error) = validate_state(
        &request.state,
        &settings.client_secret,
        &org_id,
        &user_email.user_id,
        chrono::Utc::now().timestamp(),
    ) {
        return MetaHttpResponse::bad_request(error);
    }

    let client = match slack_oauth_client() {
        Ok(client) => client,
        Err(error) => return bad_gateway(error),
    };
    let response = match client
        .post(SLACK_TOKEN_URL)
        .form(&[
            ("client_id", settings.client_id.as_str()),
            ("client_secret", settings.client_secret.as_str()),
            ("code", request.code.trim()),
            ("redirect_uri", settings.redirect_url.as_str()),
        ])
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return bad_gateway(SlackOAuthError::SlackUnavailable),
    };
    if !response.status().is_success() {
        return bad_gateway(SlackOAuthError::SlackUnavailable);
    }
    let body = match read_slack_response_body(response).await {
        Ok(body) => body,
        Err(error) => return bad_gateway(error),
    };
    match parse_slack_oauth_response(&body) {
        Ok(connection) => MetaHttpResponse::json(connection),
        Err(SlackOAuthError::AuthorizationFailed) => {
            MetaHttpResponse::bad_request(SlackOAuthError::AuthorizationFailed)
        }
        Err(error) => bad_gateway(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLIENT_ID: &str = "123456.789012";
    const CLIENT_SECRET: &str = "slack-client-secret";
    const REDIRECT_URL: &str = "https://observe.example.com/web/slack/oauth/callback";
    const ORG_ID: &str = "acme";
    const USER_ID: &str = "operator@example.com";
    const NOW: i64 = 1_800_000_000;

    fn settings() -> SlackOAuthSettings {
        SlackOAuthSettings {
            client_id: CLIENT_ID.to_string(),
            client_secret: CLIENT_SECRET.to_string(),
            redirect_url: REDIRECT_URL.to_string(),
        }
    }

    fn state_at(issued_at: i64) -> String {
        sign_state(
            &settings(),
            SlackOAuthState {
                version: STATE_VERSION,
                context_binding: create_context_binding(CLIENT_SECRET, ORG_ID, USER_ID).unwrap(),
                issued_at,
                nonce: "018f47f2-dc31-7c3d-aeca-123456789abc".to_string(),
            },
        )
        .expect("state should sign")
    }

    #[test]
    fn authorization_url_requests_only_incoming_webhook() {
        let state = state_at(NOW);
        let authorization_url =
            build_authorization_url(&settings(), &state).expect("authorization URL should build");
        let parsed = url::Url::parse(&authorization_url).unwrap();
        let query = parsed
            .query_pairs()
            .into_owned()
            .collect::<std::collections::HashMap<_, _>>();

        assert_eq!(
            parsed.as_str().split('?').next().unwrap(),
            SLACK_AUTHORIZE_URL
        );
        assert_eq!(query.get("client_id").map(String::as_str), Some(CLIENT_ID));
        assert_eq!(
            query.get("scope").map(String::as_str),
            Some("incoming-webhook")
        );
        assert_eq!(
            query.get("redirect_uri").map(String::as_str),
            Some(REDIRECT_URL)
        );
        assert_eq!(query.get("state").map(String::as_str), Some(state.as_str()));
        assert!(!authorization_url.contains(CLIENT_SECRET));
        assert!(!query.contains_key("user_scope"));
    }

    #[test]
    fn state_round_trips_for_the_same_org_and_user() {
        let claims = validate_state(&state_at(NOW), CLIENT_SECRET, ORG_ID, USER_ID, NOW)
            .expect("state should validate");

        assert_eq!(claims.issued_at, NOW);
    }

    #[test]
    fn state_payload_does_not_disclose_org_or_user() {
        let state = state_at(NOW);
        let payload = state.split_once('.').unwrap().0;
        let decoded = URL_SAFE_NO_PAD.decode(payload).unwrap();
        let decoded = String::from_utf8(decoded).unwrap();

        assert!(!decoded.contains(ORG_ID));
        assert!(!decoded.contains(USER_ID));
    }

    #[test]
    fn state_rejects_tampering_wrong_context_and_bad_time() {
        let state = state_at(NOW);
        let mut tampered = state.clone().into_bytes();
        let last = tampered.len() - 1;
        tampered[last] = if tampered[last] == b'a' { b'b' } else { b'a' };
        let tampered = String::from_utf8(tampered).unwrap();

        assert!(validate_state(&tampered, CLIENT_SECRET, ORG_ID, USER_ID, NOW).is_err());
        assert!(validate_state(&state, CLIENT_SECRET, "other-org", USER_ID, NOW).is_err());
        assert!(validate_state(&state, CLIENT_SECRET, ORG_ID, "other-user", NOW).is_err());
        assert!(
            validate_state(
                &state_at(NOW - STATE_MAX_AGE_SECONDS - 1),
                CLIENT_SECRET,
                ORG_ID,
                USER_ID,
                NOW,
            )
            .is_err()
        );
        assert!(
            validate_state(
                &state_at(NOW + STATE_FUTURE_TOLERANCE_SECONDS + 1),
                CLIENT_SECRET,
                ORG_ID,
                USER_ID,
                NOW,
            )
            .is_err()
        );
        assert!(validate_state("not-a-state", CLIENT_SECRET, ORG_ID, USER_ID, NOW).is_err());
    }

    #[test]
    fn state_rejects_an_unknown_version() {
        let state = sign_state(
            &settings(),
            SlackOAuthState {
                version: STATE_VERSION + 1,
                context_binding: create_context_binding(CLIENT_SECRET, ORG_ID, USER_ID).unwrap(),
                issued_at: NOW,
                nonce: "version-test".to_string(),
            },
        )
        .unwrap();

        assert!(validate_state(&state, CLIENT_SECRET, ORG_ID, USER_ID, NOW).is_err());
    }

    #[test]
    fn parses_the_incoming_webhook_from_slack_success() {
        let response = r#"{
            "ok": true,
            "team": { "id": "T123", "name": "Acme" },
            "incoming_webhook": {
                "channel": "alerts",
                "channel_id": "C123",
                "configuration_url": "https://acme.slack.com/apps/config",
                "url": "https://hooks.slack.com/services/T123/C123/secret"
            }
        }"#;

        let connection = parse_slack_oauth_response(response).expect("Slack response should parse");

        assert_eq!(
            connection.webhook_url,
            "https://hooks.slack.com/services/T123/C123/secret"
        );
        assert_eq!(connection.channel, "alerts");
        assert_eq!(connection.channel_id, "C123");
        assert_eq!(connection.team_id, "T123");
        assert_eq!(connection.team_name, "Acme");
    }

    #[test]
    fn rejects_missing_or_invalid_incoming_webhooks() {
        let missing = r#"{"ok":true,"team":{"id":"T123","name":"Acme"}}"#;
        let invalid = r#"{
            "ok": true,
            "team": { "id": "T123", "name": "Acme" },
            "incoming_webhook": {
                "channel": "alerts",
                "channel_id": "C123",
                "url": "https://evil.example.com/services/T123/C123/secret"
            }
        }"#;

        assert!(parse_slack_oauth_response(missing).is_err());
        assert!(parse_slack_oauth_response(invalid).is_err());
    }

    #[tokio::test]
    async fn token_client_does_not_follow_redirects() {
        use axum::{Router, response::Redirect, routing::post};

        let app = Router::new().route(
            "/token",
            post(|| async { Redirect::temporary("http://127.0.0.1:9/steal") }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test listener should bind");
        let address = listener
            .local_addr()
            .expect("listener should have an address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("test server should run");
        });

        let response = slack_oauth_client()
            .expect("OAuth client should build")
            .post(format!("http://{address}/token"))
            .form(&[("client_secret", "must-not-be-forwarded")])
            .send()
            .await
            .expect("redirect response should be returned without following it");

        assert_eq!(response.status(), reqwest::StatusCode::TEMPORARY_REDIRECT);
        server.abort();
    }

    #[tokio::test]
    async fn slack_response_reader_rejects_an_oversized_body() {
        use axum::{Router, routing::get};

        let app = Router::new().route(
            "/response",
            get(|| async { "x".repeat(MAX_SLACK_RESPONSE_LENGTH + 1) }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test listener should bind");
        let address = listener
            .local_addr()
            .expect("listener should have an address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("test server should run");
        });

        let response = slack_oauth_client()
            .expect("OAuth client should build")
            .get(format!("http://{address}/response"))
            .send()
            .await
            .expect("test response should be returned");

        assert!(read_slack_response_body(response).await.is_err());
        server.abort();
    }

    #[test]
    fn sanitizes_slack_and_malformed_response_errors() {
        let slack_error = parse_slack_oauth_response(r#"{"ok":false,"error":"bad_client_secret"}"#)
            .expect_err("Slack error must fail")
            .to_string();
        let malformed = parse_slack_oauth_response("client-secret-value")
            .expect_err("malformed response must fail")
            .to_string();

        assert_eq!(slack_error, "Slack authorization could not be completed");
        assert_eq!(
            malformed,
            "Slack returned an invalid authorization response"
        );
        assert!(!slack_error.contains("bad_client_secret"));
        assert!(!malformed.contains("client-secret-value"));
    }

    #[test]
    fn validates_only_complete_slack_webhook_urls() {
        assert!(is_valid_slack_webhook_url(
            "https://hooks.slack.com/services/T123/C123/secret"
        ));
        assert!(is_valid_slack_webhook_url(
            "https://hooks.slack-gov.com/services/T123/C123/secret/"
        ));
        assert!(!is_valid_slack_webhook_url(
            "https://hooks.slack.com/services/T123"
        ));
        assert!(!is_valid_slack_webhook_url(
            "https://foo.hooks.slack.com/services/T123/C123/secret"
        ));
        assert!(!is_valid_slack_webhook_url(
            "https://hooks.slack.com/services/T123/C123/secret?copy=1"
        ));
    }
}
