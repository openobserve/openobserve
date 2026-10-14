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

use axum::{Json, extract::Path, response::Response};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Largest number of items one check request may carry.
pub const MAX_CHECK_ITEMS: usize = 500;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuthzCheckResource {
    Dashboard,
    Alert,
    Pipeline,
    Function,
    Stream,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuthzCheckAction {
    Edit,
    Delete,
}

/// One control the UI wants to show: may the caller run `action` on this object?
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AuthzCheckItem {
    pub resource: AuthzCheckResource,
    pub id: String,
    pub action: AuthzCheckAction,
    /// Folder of a dashboard or alert; the `default` folder when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    /// Stream type of a stream, as sent in the `type` query param of its edit and delete calls.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_type: Option<String>,
}

#[cfg(feature = "enterprise")]
impl AuthzCheckItem {
    fn to_fga_item(&self) -> o2_openfga::authorizer::check::CheckItem {
        use config::meta::stream::StreamType;
        use o2_openfga::authorizer::check::{CheckAction, CheckItem, CheckResource};

        CheckItem {
            resource: match self.resource {
                AuthzCheckResource::Dashboard => CheckResource::Dashboard,
                AuthzCheckResource::Alert => CheckResource::Alert,
                AuthzCheckResource::Pipeline => CheckResource::Pipeline,
                AuthzCheckResource::Function => CheckResource::Function,
                AuthzCheckResource::Stream => CheckResource::Stream,
            },
            id: self.id.clone(),
            action: match self.action {
                AuthzCheckAction::Edit => CheckAction::Edit,
                AuthzCheckAction::Delete => CheckAction::Delete,
            },
            folder: self.folder.clone(),
            stream_type: self.stream_type.as_deref().map(|stream_type| {
                openobserve_core::auth::route_stream_type(StreamType::from(stream_type))
            }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AuthzCheckRequest {
    pub items: Vec<AuthzCheckItem>,
}

/// `null` means the authorizer failed for this item, so the UI shows the control.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AuthzCheckResult {
    pub allowed: Option<bool>,
}

/// `results[i]` answers `items[i]`; `enforced: false` means every control may be shown.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AuthzCheckResponse {
    pub enforced: bool,
    pub results: Vec<AuthzCheckResult>,
}

impl AuthzCheckResponse {
    pub fn unenforced(len: usize) -> Self {
        Self::uniform(false, Some(true), len)
    }

    pub fn denied(len: usize) -> Self {
        Self::uniform(true, Some(false), len)
    }

    fn uniform(enforced: bool, allowed: Option<bool>, len: usize) -> Self {
        Self {
            enforced,
            results: vec![AuthzCheckResult { allowed }; len],
        }
    }
}

#[cfg(feature = "enterprise")]
impl From<o2_openfga::authorizer::check::CheckOutcome> for AuthzCheckResponse {
    fn from(outcome: o2_openfga::authorizer::check::CheckOutcome) -> Self {
        Self {
            enforced: outcome.enforced,
            results: outcome
                .results
                .into_iter()
                .map(|allowed| AuthzCheckResult { allowed })
                .collect(),
        }
    }
}

/// CheckAccess
#[utoipa::path(
    post,
    path = "/{org_id}/authz/check",
    context_path = "/api",
    tag = "Authz",
    operation_id = "CheckAccess",
    summary = "Check the caller's edit and delete access",
    description = "Answers, per item, whether the calling user may edit or delete a dashboard, alert, pipeline, function or stream, using the same authorization the real edit and delete requests go through. `enforced` is false when nothing per object is enforced for the caller (RBAC off, root, admin or editor, or the open-source build); every item is then allowed. An item's `allowed` is null when the authorizer could not answer it. At most 500 items per request.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = AuthzCheckRequest, description = "Items to check", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = AuthzCheckResponse),
        (status = 400, description = "More than 500 items", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Roles", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn check_access(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<AuthzCheckRequest>,
) -> Response {
    if req.items.len() > MAX_CHECK_ITEMS {
        return MetaHttpResponse::bad_request(format!(
            "At most {MAX_CHECK_ITEMS} items can be checked at once"
        ));
    }
    MetaHttpResponse::json(answer(&org_id, &user_email.user_id, &req.items).await)
}

#[cfg(feature = "enterprise")]
async fn answer(org_id: &str, user_id: &str, items: &[AuthzCheckItem]) -> AuthzCheckResponse {
    if db::user::is_root_user(user_id) || !openobserve_core::authz::rbac_enforced().await {
        return AuthzCheckResponse::unenforced(items.len());
    }
    let Some(user) = openobserve_core::users::get_user(Some(org_id), user_id).await else {
        return AuthzCheckResponse::denied(items.len());
    };
    let items = items
        .iter()
        .map(AuthzCheckItem::to_fga_item)
        .collect::<Vec<_>>();
    o2_openfga::authorizer::check::check_items(org_id, &user.email, &user.role.to_string(), &items)
        .await
        .into()
}

#[cfg(not(feature = "enterprise"))]
async fn answer(_org_id: &str, _user_id: &str, items: &[AuthzCheckItem]) -> AuthzCheckResponse {
    AuthzCheckResponse::unenforced(items.len())
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, http::StatusCode};

    use super::*;

    fn item(resource: AuthzCheckResource, action: AuthzCheckAction) -> AuthzCheckItem {
        AuthzCheckItem {
            resource,
            id: "id1".to_string(),
            action,
            folder: None,
            stream_type: None,
        }
    }

    async fn call(items: Vec<AuthzCheckItem>) -> (StatusCode, serde_json::Value) {
        let response = check_access(
            Path("org1".to_string()),
            Headers(UserEmail {
                user_id: "user@example.com".to_string(),
            }),
            Json(AuthzCheckRequest { items }),
        )
        .await;
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&body).unwrap())
    }

    #[test]
    fn request_parses_the_contract_shape() {
        let req: AuthzCheckRequest = serde_json::from_value(serde_json::json!({
            "items": [
                {"resource": "dashboard", "id": "d1", "action": "edit", "folder": "f1"},
                {"resource": "stream", "id": "s1", "action": "delete", "stream_type": "logs"},
                {"resource": "pipeline", "id": "p1", "action": "edit"},
                {"resource": "function", "id": "fn1", "action": "delete"},
                {"resource": "alert", "id": "a1", "action": "delete"},
            ]
        }))
        .unwrap();
        assert_eq!(req.items.len(), 5);
        assert_eq!(req.items[0].resource, AuthzCheckResource::Dashboard);
        assert_eq!(req.items[0].folder.as_deref(), Some("f1"));
        assert_eq!(req.items[1].action, AuthzCheckAction::Delete);
        assert_eq!(req.items[1].stream_type.as_deref(), Some("logs"));
        assert_eq!(req.items[2].folder, None);
        assert_eq!(req.items[4].resource, AuthzCheckResource::Alert);
    }

    #[test]
    fn request_rejects_unknown_resources_and_actions() {
        let unknown_resource = serde_json::json!({
            "items": [{"resource": "report", "id": "r1", "action": "edit"}]
        });
        assert!(serde_json::from_value::<AuthzCheckRequest>(unknown_resource).is_err());
        let unknown_action = serde_json::json!({
            "items": [{"resource": "dashboard", "id": "d1", "action": "view"}]
        });
        assert!(serde_json::from_value::<AuthzCheckRequest>(unknown_action).is_err());
    }

    #[test]
    fn response_serializes_a_failed_check_as_null() {
        let response = AuthzCheckResponse {
            enforced: true,
            results: vec![
                AuthzCheckResult {
                    allowed: Some(true),
                },
                AuthzCheckResult {
                    allowed: Some(false),
                },
                AuthzCheckResult { allowed: None },
            ],
        };
        assert_eq!(
            serde_json::to_value(&response).unwrap(),
            serde_json::json!({
                "enforced": true,
                "results": [{"allowed": true}, {"allowed": false}, {"allowed": null}]
            })
        );
    }

    #[test]
    fn unenforced_and_denied_cover_every_item() {
        let unenforced = AuthzCheckResponse::unenforced(2);
        assert!(!unenforced.enforced);
        assert!(unenforced.results.iter().all(|r| r.allowed == Some(true)));
        assert_eq!(unenforced.results.len(), 2);

        let denied = AuthzCheckResponse::denied(3);
        assert!(denied.enforced);
        assert!(denied.results.iter().all(|r| r.allowed == Some(false)));
        assert_eq!(denied.results.len(), 3);
    }

    #[tokio::test]
    async fn more_than_the_item_cap_is_a_bad_request() {
        let items = vec![
            item(AuthzCheckResource::Dashboard, AuthzCheckAction::Delete);
            MAX_CHECK_ITEMS + 1
        ];
        let (status, _) = call(items).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn open_source_build_allows_everything_unenforced() {
        let items = vec![
            item(AuthzCheckResource::Dashboard, AuthzCheckAction::Edit),
            item(AuthzCheckResource::Stream, AuthzCheckAction::Delete),
        ];
        let (status, body) = call(items).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            serde_json::json!({
                "enforced": false,
                "results": [{"allowed": true}, {"allowed": true}]
            })
        );
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn exactly_the_item_cap_is_accepted() {
        let items =
            vec![item(AuthzCheckResource::Function, AuthzCheckAction::Edit); MAX_CHECK_ITEMS];
        let (status, body) = call(items).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["results"].as_array().unwrap().len(), MAX_CHECK_ITEMS);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn items_convert_to_the_authorizer_shape() {
        use o2_openfga::{
            authorizer::check::{CheckAction, CheckResource},
            meta::route_permissions::StreamType,
        };

        let mut stream = item(AuthzCheckResource::Stream, AuthzCheckAction::Edit);
        stream.stream_type = Some("metrics".to_string());
        let converted = stream.to_fga_item();
        assert_eq!(converted.resource, CheckResource::Stream);
        assert_eq!(converted.action, CheckAction::Edit);
        assert_eq!(converted.stream_type, Some(StreamType::Metrics));

        let mut dashboard = item(AuthzCheckResource::Dashboard, AuthzCheckAction::Delete);
        dashboard.folder = Some("f1".to_string());
        let converted = dashboard.to_fga_item();
        assert_eq!(converted.resource, CheckResource::Dashboard);
        assert_eq!(converted.action, CheckAction::Delete);
        assert_eq!(converted.folder.as_deref(), Some("f1"));
        assert_eq!(converted.stream_type, None);
    }
}
