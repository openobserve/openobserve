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

//! Announcement Banners HTTP Handler
//!
//! Banners are authored once on the `_meta` org and read by every organization
//! they target. Reads are open to any authenticated org so each tenant's UI can
//! poll them; writes are restricted to `_meta`.
//!
//! The org allowlist is applied server-side in [`get_announcements`] so one tenant
//! never receives another tenant's notice text or org identifiers.

use axum::{extract::Path, response::Response};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::META_ORG_ID;

/// The stored `system_settings` value.
///
/// Both halves are kept: `source` is what the operator typed, `resolved` is what
/// readers consume. Normalization is lossy in a way that matters to the author —
/// it turns `"2026-08-12T07:30:00+05:30"` into microseconds and `"1h"` into an
/// absolute end — so the editor is served the source verbatim instead of a
/// round-tripped rewrite of it.
#[cfg(feature = "enterprise")]
mod storage {
    use config::meta::system_settings::{SettingScope, SystemSetting};
    use o2_enterprise::enterprise::announcements::{
        self, ANNOUNCEMENT_BANNERS_KEY, meta::AnnouncementBanners,
    };

    /// Key holding the operator's authored JSON inside the stored envelope.
    const SOURCE_FIELD: &str = "source";
    /// Key holding the normalized banners inside the stored envelope.
    const RESOLVED_FIELD: &str = "resolved";

    pub fn envelope(
        source: &serde_json::Value,
        resolved: &AnnouncementBanners,
    ) -> serde_json::Value {
        serde_json::json!({
            SOURCE_FIELD: source,
            RESOLVED_FIELD: resolved,
        })
    }

    /// Read the stored value, if any.
    async fn read_raw() -> Result<Option<serde_json::Value>, infra::errors::Error> {
        let setting = db::system_settings::get(
            &SettingScope::Org,
            Some(config::META_ORG_ID),
            None,
            ANNOUNCEMENT_BANNERS_KEY,
        )
        .await?;
        Ok(setting.map(|s| s.setting_value))
    }

    /// The authored JSON, for the editor. Absent when nothing has been saved yet.
    pub async fn read_source() -> Result<Option<serde_json::Value>, infra::errors::Error> {
        Ok(read_raw().await?.and_then(|v| {
            v.get(SOURCE_FIELD)
                .cloned()
                // A value written before the envelope existed (or seeded directly
                // into the table) is itself the source.
                .or(Some(v))
        }))
    }

    /// The normalized banners, for readers.
    ///
    /// Falls back to normalizing the stored value when the envelope is missing, so
    /// a config seeded straight into the table still renders. `now` only anchors
    /// relative durations, which that fallback path may contain.
    pub async fn read_resolved(now: i64) -> Result<AnnouncementBanners, infra::errors::Error> {
        let Some(raw) = read_raw().await? else {
            return Ok(AnnouncementBanners::default());
        };

        if let Some(resolved) = raw.get(RESOLVED_FIELD) {
            return serde_json::from_value(resolved.clone())
                .map_err(|e| infra::errors::Error::Message(e.to_string()));
        }

        announcements::normalize(&raw, now)
            .map_err(|e| infra::errors::Error::Message(e.to_string()))
    }

    pub async fn write(value: serde_json::Value) -> Result<(), infra::errors::Error> {
        let mut setting =
            SystemSetting::new_org(config::META_ORG_ID, ANNOUNCEMENT_BANNERS_KEY, value);
        setting.setting_category = Some("ui".to_string());
        setting.description = Some("Announcement banners shown across organizations".to_string());

        db::system_settings::set(&setting).await.map(|_| ())
    }
}

/// Writes are `_meta`-only: these banners render for every organization, so the
/// authority to publish one has to sit above any single tenant.
fn validate_meta_org_access(org_id: &str) -> Result<(), infra::errors::Error> {
    if org_id != META_ORG_ID {
        return Err(infra::errors::Error::Message(format!(
            "Announcement banners can only be configured from the meta organization. Provided \
             org_id: {org_id}, expected: {META_ORG_ID}"
        )));
    }
    Ok(())
}

/// Get the banners this organization should currently display
#[utoipa::path(
    get,
    path = "/{org_id}/announcements",
    context_path = "/api",
    tag = "Announcements",
    operation_id = "GetAnnouncements",
    summary = "Get active announcement banners",
    description = "Returns the announcement banners that are active right now for this organization, \
                   most severe first. Banners are authored on the meta organization; the per-banner \
                   organization allowlist is applied server-side. Also returns the server clock and the \
                   next instant the set changes, so clients can correct for clock skew and refresh on \
                   the exact boundary rather than waiting out a poll interval. Returns an empty list \
                   when nothing is configured.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get active announcement banners", "category": "system"}))
    )
)]
pub async fn get_announcements(Path(org_id): Path<String>) -> Response {
    let now = chrono::Utc::now().timestamp_micros();

    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::announcements::{
            self, meta::AnnouncementsResponse, next_boundary_for_org,
        };

        let config = match storage::read_resolved(now).await {
            Ok(config) => config,
            Err(e) => {
                log::error!("Error reading announcement banners: {e}");
                return MetaHttpResponse::internal_error(e);
            }
        };

        MetaHttpResponse::json(AnnouncementsResponse {
            banners: announcements::resolve_for_org(&config, &org_id, now),
            now,
            next_boundary: next_boundary_for_org(&config, &org_id, now),
        })
    }

    // An OSS build has no banners to serve. Answering with an empty set rather
    // than a 403 keeps a client that polls this endpoint quiet.
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        MetaHttpResponse::json(serde_json::json!({ "banners": [], "now": now }))
    }
}

/// Get the authored announcement banner configuration
#[utoipa::path(
    get,
    path = "/{org_id}/announcements/config",
    context_path = "/api",
    tag = "Announcements",
    operation_id = "GetAnnouncementsConfig",
    summary = "Get authored announcement banner configuration",
    description = "Retrieves the announcement banner JSON exactly as it was authored, for editing. \
                   Only accessible from the meta organization. Unlike the read endpoint, this returns \
                   every configured banner including scheduled and expired ones, with timestamps in \
                   their original authored form.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get authored announcement banner config", "category": "system"}))
    )
)]
pub async fn get_announcements_config(Path(org_id): Path<String>) -> Response {
    if let Err(e) = validate_meta_org_access(&org_id) {
        return MetaHttpResponse::forbidden(e);
    }

    #[cfg(feature = "enterprise")]
    match storage::read_source().await {
        // Nothing saved yet: hand the editor an empty document rather than null,
        // so it opens on something valid to type into.
        Ok(source) => {
            MetaHttpResponse::json(source.unwrap_or_else(|| serde_json::json!({ "banners": [] })))
        }
        Err(e) => {
            log::error!("Error reading announcement banner config: {e}");
            MetaHttpResponse::internal_error(e)
        }
    }

    #[cfg(not(feature = "enterprise"))]
    MetaHttpResponse::forbidden("Announcement banners are not available")
}

/// Set the announcement banner configuration
#[utoipa::path(
    put,
    path = "/{org_id}/announcements/config",
    context_path = "/api",
    tag = "Announcements",
    operation_id = "SetAnnouncementsConfig",
    summary = "Configure announcement banners",
    description = "Replaces the announcement banner configuration. Only accessible from the meta \
                   organization. The body is validated and normalized before storage: timestamps must \
                   be RFC 3339 with a UTC offset, and relative durations are resolved to absolute \
                   instants at write time. An empty banner list removes every banner. Validation \
                   errors name the offending banner index and field.",
    security(("Authorization" = [])),
    request_body(content = Object, description = "Announcement banner configuration", content_type = "application/json"),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Bad Request", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Configure announcement banners", "category": "system"}))
    )
)]
pub async fn set_announcements_config(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] axum::Json(body): axum::Json<serde_json::Value>,
) -> Response {
    if let Err(e) = validate_meta_org_access(&org_id) {
        return MetaHttpResponse::forbidden(e);
    }

    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::announcements;

        let now = chrono::Utc::now().timestamp_micros();

        // Reject malformed input here rather than at render time: a typo that
        // silently blanked every banner would not be noticed until the window it
        // was meant to cover had already passed.
        let resolved = match announcements::normalize(&body, now) {
            Ok(resolved) => resolved,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };

        let banner_count = resolved.banners.len();
        if let Err(e) = storage::write(storage::envelope(&body, &resolved)).await {
            log::error!("Error saving announcement banners: {e}");
            return MetaHttpResponse::internal_error(e);
        }

        // The normalized form goes back with the response so the caller can see
        // what the relative durations actually resolved to.
        MetaHttpResponse::json(serde_json::json!({
            "message": format!("Saved {banner_count} announcement banner(s)"),
            "resolved": resolved,
        }))
    }

    #[cfg(not(feature = "enterprise"))]
    MetaHttpResponse::forbidden("Announcement banners are not available")
}
