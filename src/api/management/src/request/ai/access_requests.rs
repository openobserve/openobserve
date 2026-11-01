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

//! A member asking the org's admins for assistant access (`/ai/access_requests`).

use axum::{
    Json,
    body::Bytes,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::{SMTP_CLIENT, get_config, meta::user::UserRole, utils::time::now_micros};
use lettre::{AsyncTransport, Message, message::SinglePart};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    capabilities,
    error::{self, AiErrorCode, AiErrorEnvelope},
};

const DAY_MICROS: i64 = 24 * 3600 * 1_000_000;
const MESSAGE_MAX_CHARS: usize = 1000;

#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AccessRequestBody {
    pub message: Option<String>,
}

/// The answer names no admin: who receives the request is not the member's to know.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct AccessRequestAccepted {
    pub accepted: bool,
}

/// The storage and mail a request touches.
trait AccessIo {
    /// `false` when the member already asked in this org this UTC day.
    async fn store(
        &self,
        org_id: &str,
        user_id: &str,
        message: Option<&str>,
        now: i64,
    ) -> Result<bool, String>;
    /// Returns at once; delivery runs in the background.
    fn notify(&self, org_id: &str, user_id: &str, message: Option<&str>);
}

struct LiveIo;

impl AccessIo for LiveIo {
    async fn store(
        &self,
        org_id: &str,
        user_id: &str,
        message: Option<&str>,
        now: i64,
    ) -> Result<bool, String> {
        infra::table::ai_access_requests::insert_if_absent(org_id, user_id, message, now)
            .await
            .map_err(|e| e.to_string())
    }

    fn notify(&self, org_id: &str, user_id: &str, message: Option<&str>) {
        let (org_id, user_id) = (org_id.to_string(), user_id.to_string());
        let message = message.map(str::to_string);
        tokio::spawn(async move {
            if let Err(e) = email_admins(&org_id, &user_id, message.as_deref()).await {
                log::warn!("[org_id:{org_id}] assistant access request not mailed: {e}");
            }
        });
    }
}

#[utoipa::path(
    post,
    path = "/{org_id}/ai/access_requests",
    context_path = "/api",
    tag = "AI",
    operation_id = "CreateAiAccessRequest",
    summary = "Ask the organization's admins for assistant access",
    description = "Any org member. Stores the request and, when email is configured, mails \
                   the org's admins once. One request per member per org per UTC day; the \
                   answer names no admin.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = AccessRequestBody, content_type = "application/json"),
    responses(
        (status = 202, description = "Accepted", body = AccessRequestAccepted),
        (status = 400, description = "Malformed body or a message over 1000 characters", body = Object),
        (status = 403, description = "Not a member of the organization", body = Object),
        (status = 429, description = "Already asked this UTC day (`rate_limited`, `retry_after`)", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn create_access_request(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    let user_id = user_email.user_id;
    if !capabilities::is_member(&org_id, &user_id).await {
        return error::permission_denied("Unauthorized Access");
    }
    let message = match parse_message(&body) {
        Ok(message) => message,
        Err(reason) => return error::invalid_request(reason),
    };
    accept(&LiveIo, &org_id, &user_id, message.as_deref(), now_micros()).await
}

async fn accept(
    io: &impl AccessIo,
    org_id: &str,
    user_id: &str,
    message: Option<&str>,
    now: i64,
) -> Response {
    match io.store(org_id, user_id, message, now).await {
        Ok(true) => {}
        Ok(false) => {
            return AiErrorEnvelope::new(
                AiErrorCode::RateLimited,
                "You already asked your admins today",
            )
            .retry_after(Some(until_next_day(now)))
            .into_response();
        }
        Err(e) => {
            log::error!("[org_id:{org_id}] cannot store an access request: {e}");
            return error::history_unavailable("The request could not be sent; please retry");
        }
    }
    io.notify(org_id, user_id, message);
    (
        StatusCode::ACCEPTED,
        Json(AccessRequestAccepted { accepted: true }),
    )
        .into_response()
}

/// Seconds until the next UTC day, when the member may ask again.
fn until_next_day(now: i64) -> u64 {
    let wait = (DAY_MICROS - now.rem_euclid(DAY_MICROS)) / 1_000_000;
    u64::try_from(wait).unwrap_or(0).max(1)
}

fn parse_message(body: &[u8]) -> Result<Option<String>, &'static str> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(None);
    }
    let body: AccessRequestBody =
        serde_json::from_slice(body).map_err(|_| "The body must be {\"message\"?: string}")?;
    let message = body
        .message
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty());
    if message
        .as_ref()
        .is_some_and(|m| m.chars().count() > MESSAGE_MAX_CHARS)
    {
        return Err("The message is longer than 1000 characters");
    }
    Ok(message)
}

fn admin_emails(users: &[infra::table::org_users::OrgUserRecord]) -> Vec<String> {
    users
        .iter()
        .filter(|user| matches!(user.role, UserRole::Admin | UserRole::Root))
        .map(|user| user.email.clone())
        .collect()
}

fn email_text(org_id: &str, user_id: &str, message: Option<&str>) -> String {
    let mut text = format!(
        "{user_id} asked for O2 Assistant access in the {org_id} organization.\n\nGrant it in \
         IAM (O2 Assistant, Chat) if appropriate."
    );
    if let Some(message) = message {
        text.push_str("\n\nTheir message:\n");
        text.push_str(message);
    }
    text
}

async fn email_admins(org_id: &str, user_id: &str, message: Option<&str>) -> anyhow::Result<()> {
    let cfg = get_config();
    let Some(client) = SMTP_CLIENT.as_ref().filter(|_| cfg.smtp.smtp_enabled) else {
        log::info!("[org_id:{org_id}] access request stored; email is not configured");
        return Ok(());
    };
    let users = infra::table::org_users::list_users_by_org(org_id).await?;
    let admins = admin_emails(&users);
    if admins.is_empty() {
        return Ok(());
    }
    let mut email = Message::builder()
        .from(cfg.smtp.smtp_from_email.parse()?)
        .subject(format!("O2 Assistant access for {org_id}"));
    // Bcc, so admins are not listed to each other through this mail.
    for admin in &admins {
        email = email.bcc(admin.parse()?);
    }
    if !cfg.smtp.smtp_reply_to.is_empty() {
        email = email.reply_to(cfg.smtp.smtp_reply_to.parse()?);
    }
    let email = email.singlepart(SinglePart::plain(email_text(org_id, user_id, message)))?;
    client.send(email).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    /// `(org, user, day, message)` of one stored request.
    type Stored = (String, String, i64, Option<String>);

    /// Keeps the unique `(org, user, day)` key the table enforces.
    #[derive(Default)]
    struct FakeIo {
        stored: Mutex<Vec<Stored>>,
        notified: Mutex<u32>,
    }

    impl AccessIo for FakeIo {
        async fn store(
            &self,
            org_id: &str,
            user_id: &str,
            message: Option<&str>,
            now: i64,
        ) -> Result<bool, String> {
            let mut stored = self.stored.lock().unwrap();
            let day = now.div_euclid(DAY_MICROS);
            if stored
                .iter()
                .any(|(o, u, d, _)| (o.as_str(), u.as_str(), *d) == (org_id, user_id, day))
            {
                return Ok(false);
            }
            stored.push((
                org_id.to_string(),
                user_id.to_string(),
                day,
                message.map(str::to_string),
            ));
            Ok(true)
        }

        fn notify(&self, _: &str, _: &str, _: Option<&str>) {
            *self.notified.lock().unwrap() += 1;
        }
    }

    async fn body(response: Response) -> (StatusCode, serde_json::Value) {
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn a_request_is_stored_notifies_once_and_names_no_admin() {
        let io = FakeIo::default();
        let (status, json) = body(accept(&io, "o", "a@x", Some("please"), 10).await).await;
        assert_eq!(status, StatusCode::ACCEPTED);
        assert_eq!(json, serde_json::json!({"accepted": true}));
        assert_eq!(*io.notified.lock().unwrap(), 1);
        assert_eq!(
            io.stored.lock().unwrap().as_slice(),
            [(
                "o".to_string(),
                "a@x".to_string(),
                0,
                Some("please".to_string())
            )]
        );
    }

    #[tokio::test]
    async fn a_second_request_the_same_utc_day_is_rate_limited_and_sends_nothing() {
        let io = FakeIo::default();
        let accepted = accept(&io, "o", "a@x", None, 0).await;
        assert_eq!(accepted.status(), StatusCode::ACCEPTED);
        let (status, json) = body(accept(&io, "o", "a@x", None, 3_600_000_000).await).await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(json["code"], "rate_limited");
        assert_eq!(json["retry_after"], 23 * 3600);
        assert_eq!(*io.notified.lock().unwrap(), 1);
        assert_eq!(io.stored.lock().unwrap().len(), 1);
        let next_day = accept(&io, "o", "a@x", None, DAY_MICROS).await;
        assert_eq!(next_day.status(), StatusCode::ACCEPTED);
    }

    #[test]
    fn the_message_is_optional_trimmed_and_capped() {
        assert_eq!(parse_message(b""), Ok(None));
        assert_eq!(
            parse_message(br#"{"message": "  hi "}"#),
            Ok(Some("hi".into()))
        );
        assert_eq!(parse_message(br#"{}"#), Ok(None));
        let long = format!(r#"{{"message": "{}"}}"#, "x".repeat(1001));
        assert!(parse_message(long.as_bytes()).is_err());
        assert!(parse_message(br#"{"to": "admin@x"}"#).is_err());
    }

    #[test]
    fn only_admins_are_mailed() {
        let user = |email: &str, role| infra::table::org_users::OrgUserRecord {
            email: email.into(),
            org_id: "o".into(),
            role,
            token: String::new(),
            rum_token: None,
            created_at: 0,
            allow_static_token: false,
        };
        let users = [user("a@x", UserRole::Admin), user("e@x", UserRole::Editor)];
        assert_eq!(admin_emails(&users), ["a@x"]);
        assert!(email_text("o", "m@x", Some("why")).contains("why"));
    }
}
