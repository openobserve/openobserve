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

use axum::{
    extract::{Path, Query},
    response::Response,
};
use config::meta::alerts::notification_kind::NotificationKind;
use infra::table::{entity::notification_deliveries::Model, notification_deliveries as ledger};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    alerts::notifications::delivery::{NotificationSummary, summarize},
    auth::UserEmail,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const MAX_PAGE: u64 = 200;

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct DeliveriesQuery {
    /// alert, incident, anomaly, synthetics, downtime or on_call.
    pub kind: String,
    pub object_id: Option<String>,
    pub episode_id: Option<String>,
    /// Exact event, e.g. `firing:1762077900000000`.
    pub event: Option<String>,
    pub destination: Option<String>,
    pub status: Option<String>,
    #[serde(default)]
    pub from: u64,
    pub size: Option<u64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeliveriesResponse {
    pub total: u64,
    pub summary: Option<NotificationSummary>,
    pub hits: Vec<DeliveryHit>,
}

/// A delivery row without its replay record or claim token.
#[derive(Debug, Serialize, ToSchema)]
pub struct DeliveryHit {
    pub id: String,
    pub kind: String,
    pub object_id: String,
    pub episode_id: String,
    pub event: String,
    pub destination: String,
    pub channel: String,
    pub template_source: String,
    pub template_name: String,
    pub template_skipped: serde_json::Value,
    pub status: String,
    pub status_code: Option<i32>,
    pub attempt: i32,
    pub max_attempts: i32,
    pub retryable: bool,
    pub error: Option<String>,
    pub skip_reason: Option<String>,
    pub claimed_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub next_retry_at: Option<i64>,
    pub created_at: i64,
}

impl From<Model> for DeliveryHit {
    fn from(m: Model) -> Self {
        Self {
            template_skipped: serde_json::from_str(&m.template_skipped)
                .unwrap_or(serde_json::Value::Array(vec![])),
            id: m.id,
            kind: m.kind,
            object_id: m.object_id,
            episode_id: m.episode_id,
            event: m.event,
            destination: m.destination,
            channel: m.channel,
            template_source: m.template_source,
            template_name: m.template_name,
            status: m.status,
            status_code: m.status_code,
            attempt: m.attempt,
            max_attempts: m.max_attempts,
            retryable: m.retryable,
            error: m.error,
            skip_reason: m.skip_reason,
            claimed_at: m.claimed_at,
            finished_at: m.finished_at,
            next_retry_at: m.next_retry_at,
            created_at: m.created_at,
        }
    }
}

#[utoipa::path(
    get,
    path = "/{org_id}/notifications/deliveries",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "ListNotificationDeliveries",
    summary = "List notification deliveries",
    description = "Per destination delivery rows of one object or one episode, newest first. Needs the read \
                   permission of the owning object.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), DeliveriesQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = DeliveriesResponse),
        (status = 400, description = "Missing or invalid filter", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Alerts", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_deliveries(
    Path(org_id): Path<String>,
    Query(query): Query<DeliveriesQuery>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let (kind, owner) = match validate(&query) {
        Ok(v) => v,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    if !can_read(&org_id, &user_email.user_id, kind, &owner).await {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    let filter = ledger::ListFilter {
        org: org_id.clone(),
        kind: kind.as_str().to_string(),
        object_id: query.object_id.clone(),
        episode_id: query.episode_id.clone(),
        event: query.event.clone(),
        destination: query.destination.clone(),
        status: query.status.clone(),
        from: query.from,
        size: query.size.unwrap_or(50).min(MAX_PAGE),
    };
    let db = infra::db::get_orm_client_ro().await;
    match ledger::list(db, &filter).await {
        Ok((total, rows)) => MetaHttpResponse::json(DeliveriesResponse {
            total,
            summary: summarize(&rows),
            hits: rows.into_iter().map(DeliveryHit::from).collect(),
        }),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// The kind, and the owning object id the permission check runs against.
fn validate(query: &DeliveriesQuery) -> Result<(NotificationKind, String), String> {
    let kind = NotificationKind::parse(&query.kind).ok_or_else(|| {
        format!(
            "kind: unknown kind '{}'; allowed: alert, incident, anomaly, synthetics, downtime, on_call",
            query.kind
        )
    })?;
    // Only the kinds whose producers write rows today; the others land with their stages.
    if !matches!(
        kind,
        NotificationKind::Anomaly
            | NotificationKind::Incident
            | NotificationKind::Synthetics
            | NotificationKind::Downtime
    ) {
        return Err(format!(
            "kind: '{}' has no delivery rows yet; allowed: anomaly, incident, synthetics, downtime",
            query.kind
        ));
    }
    let owner = match (&query.object_id, &query.episode_id) {
        (Some(object_id), _) if !object_id.is_empty() => object_id.clone(),
        (_, Some(episode_id)) if !episode_id.is_empty() => owner_of_episode(episode_id),
        _ => return Err("one of object_id or episode_id is required".to_string()),
    };
    Ok((kind, owner))
}

/// Episode keys start with the owning object's id: `{object_id}:{...}`.
fn owner_of_episode(episode_id: &str) -> String {
    episode_id
        .split(':')
        .next()
        .unwrap_or(episode_id)
        .to_string()
}

#[cfg(feature = "enterprise")]
async fn can_read(org_id: &str, user_id: &str, kind: NotificationKind, owner: &str) -> bool {
    let object_type = match kind {
        NotificationKind::Incident => "incidents",
        NotificationKind::Synthetics => "synthetics",
        NotificationKind::Downtime => "downtimes",
        _ => "alerts",
    };
    openobserve_core::auth::check_permissions(
        owner,
        org_id,
        user_id,
        object_type,
        "GET",
        None,
        false,
        false,
        false,
    )
    .await
}

#[cfg(not(feature = "enterprise"))]
async fn can_read(_org_id: &str, _user_id: &str, _kind: NotificationKind, _owner: &str) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(kind: &str, object_id: Option<&str>, episode_id: Option<&str>) -> DeliveriesQuery {
        DeliveriesQuery {
            kind: kind.into(),
            object_id: object_id.map(str::to_string),
            episode_id: episode_id.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn a_request_needs_an_object_or_an_episode() {
        assert!(validate(&q("anomaly", None, None)).is_err());
        assert!(validate(&q("anomaly", Some(""), None)).is_err());
        assert_eq!(
            validate(&q("anomaly", Some("a1"), None)).unwrap(),
            (NotificationKind::Anomaly, "a1".to_string())
        );
        assert_eq!(
            validate(&q("incident", None, Some("inc_7f3a:1762077900000000"))).unwrap(),
            (NotificationKind::Incident, "inc_7f3a".to_string())
        );
    }

    #[test]
    fn kinds_without_rows_yet_are_refused() {
        for kind in ["alert", "on_call"] {
            let err = validate(&q(kind, Some("x1"), None)).unwrap_err();
            assert!(
                err.contains("allowed: anomaly, incident, synthetics, downtime"),
                "{kind}: {err}"
            );
        }
        for kind in ["synthetics", "downtime"] {
            assert!(validate(&q(kind, Some("x1"), None)).is_ok(), "{kind}");
        }
    }

    #[test]
    fn an_unknown_kind_is_refused_with_the_allowed_list() {
        let err = validate(&q("pages", Some("a1"), None)).unwrap_err();
        assert!(err.contains("allowed: alert, incident"));
    }
}
