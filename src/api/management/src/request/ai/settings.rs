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

//! An org's assistant settings (`/ai/settings`) and the admission and turn policy they set.

use axum::{
    Json,
    body::Bytes,
    extract::Path,
    response::{IntoResponse, Response},
};
use common::meta::organization::{AiDataSharingLevel, AiPermissionTier, OrgAiSettings};
use config::utils::time::now_micros;
use o2_enterprise::enterprise::ai::client::{PolicyGrant, TurnPolicy};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    capabilities,
    error::{self, AiErrorCode, AiErrorEnvelope},
};

const OFF_FOR_ORG: &str = "O2 Assistant is turned off for this organization";

/// The settings as an admin reads them; sharing is the effective value, deployment included.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct SettingsView {
    pub enabled: bool,
    pub permission_tier: AiPermissionTier,
    pub org_sharing: bool,
    pub public_sharing: bool,
    pub data_sharing_level: AiDataSharingLevel,
    pub updated_by: Option<String>,
    pub updated_at: Option<i64>,
    pub enforced: Enforced,
}

impl SettingsView {
    fn new(settings: &OrgAiSettings, deployment: Deployment, policy_enforced: bool) -> Self {
        Self {
            enabled: settings.enabled,
            permission_tier: settings.permission_tier,
            org_sharing: deployment.org_sharing && settings.org_sharing.unwrap_or(true),
            public_sharing: deployment.public_sharing && settings.public_sharing.unwrap_or(true),
            data_sharing_level: settings.data_sharing_level,
            updated_by: settings.updated_by.clone(),
            updated_at: settings.updated_at,
            enforced: Enforced {
                permission_tier: policy_enforced
                    || settings.permission_tier == AiPermissionTier::ActWithApproval,
                data_sharing_level: policy_enforced
                    || settings.data_sharing_level == AiDataSharingLevel::Raw,
            },
        }
    }
}

/// Whether the stored value is enforced; anything but the default waits on o2-ai's support.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct Enforced {
    pub permission_tier: bool,
    pub data_sharing_level: bool,
}

/// What a member who is not an admin may read: only whether the assistant is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct MemberSettingsView {
    pub enabled: bool,
}

/// `PUT` body; a field left out keeps its stored value.
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SettingsUpdate {
    pub enabled: Option<bool>,
    pub permission_tier: Option<AiPermissionTier>,
    pub org_sharing: Option<bool>,
    pub public_sharing: Option<bool>,
    pub data_sharing_level: Option<AiDataSharingLevel>,
}

/// What this deployment allows before any org narrows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Deployment {
    org_sharing: bool,
    public_sharing: bool,
}

impl Deployment {
    fn from_config() -> Self {
        let (org_sharing, public_sharing) = capabilities::deployment_sharing();
        Self {
            org_sharing,
            public_sharing,
        }
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/ai/settings",
    context_path = "/api",
    tag = "AI",
    operation_id = "GetAiSettings",
    summary = "The organization's assistant settings",
    description = "Every org member may read whether the assistant is on (`{enabled}`); org \
                   admins read every setting. `org_sharing` and `public_sharing` are the \
                   effective values, so a deployment that disables sharing reads `false`. \
                   `enforced` says whether o2-ai enforces the stored tier and data level; \
                   until it does, only the defaults are enforced.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Settings (admins) or `{enabled}` (members)", body = SettingsView),
        (status = 403, description = "Not a member of the organization", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn get_settings(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let user_id = user_email.user_id;
    if !capabilities::is_member(&org_id, &user_id).await {
        return error::permission_denied("Unauthorized Access");
    }
    let settings = org_ai(&org_id).await;
    if !is_settings_admin(&org_id, &user_id).await {
        return Json(MemberSettingsView {
            enabled: settings.enabled,
        })
        .into_response();
    }
    Json(view(&org_id, &settings)).into_response()
}

#[utoipa::path(
    put,
    path = "/{org_id}/ai/settings",
    context_path = "/api",
    tag = "AI",
    operation_id = "UpdateAiSettings",
    summary = "Change the organization's assistant settings",
    description = "Org admins and root only. Fields left out keep their value. With \
                   `enabled: false` the assistant makes no o2-ai call for the org: every new \
                   turn and every approval through `/confirm` are refused with 400 \
                   `not_enabled`, and the capability probe reports `gate: \"off_for_org\"`. \
                   Incident analysis does not read this setting. Sharing cannot be turned \
                   on where the deployment disables it (400 `invalid_request`). A malformed \
                   body or an unknown field is 400 `invalid_request`.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = SettingsUpdate, content_type = "application/json"),
    responses(
        (status = 200, description = "The saved settings", body = SettingsView),
        (status = 400, description = "Unknown field, or sharing the deployment disables", body = Object),
        (status = 403, description = "Not an organization admin", body = Object),
    ),
    extensions(("x-o2-mcp" = json!({"enabled": false})))
)]
pub async fn put_settings(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    body: Bytes,
) -> Response {
    let update: SettingsUpdate = match error::json_body(&body) {
        Ok(update) => update,
        Err(response) => return response,
    };
    let user_id = user_email.user_id;
    if !is_settings_admin(&org_id, &user_id).await {
        return error::permission_denied(
            "Only organization administrators can change the assistant settings",
        );
    }
    let org_setting = match db::organization::get_org_setting(&org_id).await {
        Ok(setting) => setting,
        Err(e) => {
            log::error!("[org_id:{org_id}] cannot read org settings: {e}");
            return error::internal("The settings could not be read; please retry");
        }
    };
    let current = org_setting.ai.clone().unwrap_or_default();
    let next = match apply(current, update, Deployment::from_config()) {
        Ok(next) => OrgAiSettings {
            updated_by: Some(user_id.clone()),
            updated_at: Some(now_micros()),
            ..next
        },
        Err(message) => return error::invalid_request(message),
    };
    if let Err(e) = db::organization::set_org_ai_settings(&org_id, next.clone()).await {
        log::error!("[org_id:{org_id}] cannot save the assistant settings: {e}");
        return error::internal("The settings could not be saved; please retry");
    }
    log::info!(
        "[org_id:{org_id}] assistant settings changed by {user_id}: enabled={} tier={} level={}",
        next.enabled,
        next.permission_tier.as_str(),
        next.data_sharing_level.as_str()
    );
    Json(view(&org_id, &next)).into_response()
}

/// The org's settings, the defaults when never saved or unreadable (today's behaviour).
pub(crate) async fn org_ai(org_id: &str) -> OrgAiSettings {
    openobserve_core::ai_policy::org_settings(org_id)
        .await
        .unwrap_or_else(|e| {
            log::warn!("[org_id:{org_id}] assistant settings unreadable, using defaults: {e}");
            OrgAiSettings::default()
        })
}

/// Admission's refusal for an org that turned the assistant off.
pub(crate) async fn refuse_if_off(org_id: &str) -> Result<(), Response> {
    admission(
        org_id,
        openobserve_core::ai_policy::org_settings(org_id).await,
    )
}

/// Whether the org lets a chat be shared with `public` (or in-org) visibility.
pub(crate) async fn sharing_allowed(org_id: &str, public: bool) -> bool {
    let view = SettingsView::new(&org_ai(org_id).await, Deployment::from_config(), false);
    if public {
        view.public_sharing
    } else {
        view.org_sharing
    }
}

/// The policy a turn of `user_id` in `chat_id` carries to o2-ai; it replaces any client one.
pub(crate) async fn turn_policy(org_id: &str, user_id: &str, chat_id: Option<&str>) -> TurnPolicy {
    let settings = org_ai(org_id).await;
    let grants = match infra::table::ai_grants::active_for_turn(org_id, user_id, chat_id).await {
        Ok(grants) => grants,
        Err(e) => {
            log::warn!("[org_id:{org_id}] standing approvals unreadable, none sent: {e}");
            Vec::new()
        }
    };
    policy_of(&settings, grants)
}

/// The typed `not_enabled` refusal of anything that would call o2-ai for an org that is off.
pub(crate) fn off_for_org() -> Response {
    AiErrorEnvelope::new(AiErrorCode::NotEnabled, OFF_FOR_ORG)
        .with("reason", "off_for_org")
        .into_response()
}

/// The org's switch as admission reads it; see [`refuse_if_off`].
fn admission(
    org_id: &str,
    settings: Result<OrgAiSettings, infra::errors::Error>,
) -> Result<(), Response> {
    match settings {
        Ok(settings) if settings.enabled => Ok(()),
        Ok(_) => Err(off_for_org()),
        // Unreadable is never read as on: the org may have turned the assistant off.
        Err(e) => {
            log::error!("[org_id:{org_id}] assistant settings unreadable, turn refused: {e}");
            Err(AiErrorEnvelope::new(
                AiErrorCode::AuthorizationUnavailable,
                "The assistant settings could not be read; please retry",
            )
            .into_response())
        }
    }
}

fn view(org_id: &str, settings: &OrgAiSettings) -> SettingsView {
    SettingsView::new(
        settings,
        Deployment::from_config(),
        capabilities::policy_enforced(org_id),
    )
}

/// The real authorizer's decision on the settings `PUT`, and the org-admin rule on top of it.
async fn is_settings_admin(org_id: &str, user_id: &str) -> bool {
    capabilities::is_org_admin(org_id, user_id).await
        && capabilities::may(org_id, user_id, &["ai", "settings"], "PUT").await
}

fn apply(
    mut settings: OrgAiSettings,
    update: SettingsUpdate,
    deployment: Deployment,
) -> Result<OrgAiSettings, &'static str> {
    if update.org_sharing == Some(true) && !deployment.org_sharing {
        return Err("Chat sharing is disabled on this deployment");
    }
    if update.public_sharing == Some(true) && !deployment.public_sharing {
        return Err("Public chat links are disabled on this deployment");
    }
    if let Some(enabled) = update.enabled {
        settings.enabled = enabled;
    }
    if let Some(tier) = update.permission_tier {
        settings.permission_tier = tier;
    }
    if let Some(level) = update.data_sharing_level {
        settings.data_sharing_level = level;
    }
    settings.org_sharing = update.org_sharing.or(settings.org_sharing);
    settings.public_sharing = update.public_sharing.or(settings.public_sharing);
    Ok(settings)
}

fn policy_of(settings: &OrgAiSettings, grants: Vec<infra::table::ai_grants::Model>) -> TurnPolicy {
    TurnPolicy {
        permission_tier: settings.permission_tier.as_str().to_string(),
        data_sharing_level: settings.data_sharing_level.as_str().to_string(),
        grants: grants
            .into_iter()
            .map(|grant| PolicyGrant {
                id: grant.id,
                tool: grant.tool,
                operation: grant.operation,
                scope: grant.scope,
                chat_id: grant.chat_id,
                granted_by: grant.granted_by,
                granted_at: grant.granted_at,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;
    use serde_json::json;

    use super::*;

    const OPEN: Deployment = Deployment {
        org_sharing: true,
        public_sharing: true,
    };

    #[test]
    fn an_org_without_settings_reads_as_today() {
        let view = SettingsView::new(&OrgAiSettings::default(), OPEN, false);
        let json = serde_json::to_value(&view).unwrap();
        assert_eq!(
            json,
            json!({
                "enabled": true,
                "permission_tier": "act_with_approval",
                "org_sharing": true,
                "public_sharing": true,
                "data_sharing_level": "raw",
                "updated_by": null,
                "updated_at": null,
                "enforced": {"permission_tier": true, "data_sharing_level": true}
            })
        );
        let closed = Deployment {
            org_sharing: true,
            public_sharing: false,
        };
        assert!(!SettingsView::new(&OrgAiSettings::default(), closed, false).public_sharing);
        let member = serde_json::to_value(MemberSettingsView { enabled: true }).unwrap();
        assert_eq!(member, json!({"enabled": true}));
    }

    #[test]
    fn a_tier_o2_ai_does_not_enforce_is_stored_but_reported_unenforced() {
        let settings = apply(
            OrgAiSettings::default(),
            SettingsUpdate {
                permission_tier: Some(AiPermissionTier::Read),
                data_sharing_level: Some(AiDataSharingLevel::Schema),
                ..Default::default()
            },
            OPEN,
        )
        .unwrap();
        let view = SettingsView::new(&settings, OPEN, false);
        assert_eq!(view.permission_tier, AiPermissionTier::Read);
        assert!(!view.enforced.permission_tier && !view.enforced.data_sharing_level);
        assert!(
            SettingsView::new(&settings, OPEN, true)
                .enforced
                .permission_tier
        );
    }

    #[test]
    fn sharing_the_deployment_forbids_is_refused_and_a_partial_update_keeps_the_rest() {
        let closed = Deployment {
            org_sharing: true,
            public_sharing: false,
        };
        let public = SettingsUpdate {
            public_sharing: Some(true),
            ..Default::default()
        };
        assert!(apply(OrgAiSettings::default(), public, closed).is_err());
        let off = apply(
            OrgAiSettings {
                org_sharing: Some(false),
                ..Default::default()
            },
            SettingsUpdate {
                enabled: Some(false),
                ..Default::default()
            },
            closed,
        )
        .unwrap();
        assert!(!off.enabled);
        assert_eq!(off.org_sharing, Some(false));
        let unknown = serde_json::from_value::<SettingsUpdate>(json!({"enabled": true, "x": 1}));
        assert!(unknown.is_err());
    }

    #[tokio::test]
    async fn an_org_that_is_off_refuses_turns_with_not_enabled_and_ask_admin() {
        let response = off_for_org();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], "not_enabled");
        assert_eq!(body["action"], "ask_admin");
        assert_eq!(body["reason"], "off_for_org");
    }

    #[tokio::test]
    async fn a_non_member_reads_nothing_and_cannot_write() {
        let headers = || {
            Headers(UserEmail {
                user_id: "stranger@example.invalid".to_string(),
            })
        };
        let read = get_settings(Path("no-such-org".to_string()), headers()).await;
        assert_eq!(read.status(), StatusCode::FORBIDDEN);
        let write = put_settings(
            Path("no-such-org".to_string()),
            headers(),
            Bytes::from_static(br#"{"enabled": false}"#),
        )
        .await;
        assert_eq!(write.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn an_unknown_field_or_a_bad_value_is_the_400_envelope() {
        for body in [r#"{"enabled": true, "x": 1}"#, r#"{"enabled": "yes"}"#] {
            let response = put_settings(
                Path("o".to_string()),
                Headers(UserEmail {
                    user_id: "a@x".to_string(),
                }),
                Bytes::from(body),
            )
            .await;
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{body}");
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(json["code"], "invalid_request", "{body}");
        }
    }

    #[test]
    fn the_turn_policy_names_the_settings_and_only_the_given_grants() {
        let settings = OrgAiSettings {
            permission_tier: AiPermissionTier::Propose,
            ..Default::default()
        };
        let grant = infra::table::ai_grants::Model {
            id: "g1".into(),
            org_id: "o".into(),
            user_email: "a@x".into(),
            tool: "UpdateDashboard".into(),
            operation: "update".into(),
            scope: "chat".into(),
            chat_id: Some("c1".into()),
            granted_by: "a@x".into(),
            granted_at: 5,
        };
        let policy = policy_of(&settings, vec![grant]);
        assert_eq!(policy.permission_tier, "propose");
        assert_eq!(policy.data_sharing_level, "raw");
        assert_eq!(policy.grants.len(), 1);
        assert_eq!(policy.grants[0].chat_id.as_deref(), Some("c1"));
        assert_eq!(
            policy_of(&OrgAiSettings::default(), vec![]),
            TurnPolicy::default()
        );
    }

    #[test]
    fn an_unreadable_setting_refuses_the_turn_and_is_never_read_as_on() {
        assert!(admission("o", Ok(OrgAiSettings::default())).is_ok());
        let off = OrgAiSettings {
            enabled: false,
            ..Default::default()
        };
        let refused = admission("o", Ok(off)).unwrap_err();
        assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
        let unreadable = admission("o", Err(infra::errors::Error::Message("down".into())));
        assert_eq!(
            unreadable.unwrap_err().status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
