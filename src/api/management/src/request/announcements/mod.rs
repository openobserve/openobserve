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
/// `source` as authored (durations pinned), `resolved` for readers, `revision` counting saves.
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
    /// Key holding the save counter, in the envelope and in the config the editor round-trips.
    pub const REVISION_FIELD: &str = "revision";

    const WRITE_LOCK_KEY: &str = "/announcements/config/write";

    /// Serializes saves on one node; the distributed lock only covers a cluster.
    static LOCAL_WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    pub struct Stored {
        pub source: serde_json::Value,
        resolved: Option<serde_json::Value>,
        pub revision: u64,
    }

    impl Stored {
        fn from_raw(raw: serde_json::Value) -> Self {
            // A value written before the envelope existed (or seeded) is itself the source.
            let Some(source) = raw.get(SOURCE_FIELD) else {
                return Self {
                    source: raw,
                    resolved: None,
                    revision: 0,
                };
            };
            Self {
                source: source.clone(),
                resolved: raw.get(RESOLVED_FIELD).cloned(),
                revision: raw
                    .get(REVISION_FIELD)
                    .and_then(|r| r.as_u64())
                    .unwrap_or(0),
            }
        }
    }

    pub fn envelope(
        source: &serde_json::Value,
        resolved: &AnnouncementBanners,
        revision: u64,
    ) -> serde_json::Value {
        serde_json::json!({
            SOURCE_FIELD: source,
            RESOLVED_FIELD: resolved,
            REVISION_FIELD: revision,
        })
    }

    /// Read the stored value through the settings cache, if any.
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

    /// The stored envelope from the database, as another node's save may not be cached here yet.
    pub async fn read_stored_fresh() -> Result<Option<Stored>, infra::errors::Error> {
        let setting = infra::table::system_settings::get(
            &SettingScope::Org,
            Some(config::META_ORG_ID),
            None,
            ANNOUNCEMENT_BANNERS_KEY,
        )
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        Ok(setting.map(|s| Stored::from_raw(s.setting_value)))
    }

    /// The authored JSON plus its revision, for the editor. Absent when nothing has been saved yet.
    pub async fn read_source() -> Result<Option<serde_json::Value>, infra::errors::Error> {
        let Some(stored) = read_raw().await?.map(Stored::from_raw) else {
            return Ok(None);
        };
        // Envelopes saved before durations were pinned still hold one; show the end it resolved to.
        let resolved = stored
            .resolved
            .and_then(|r| serde_json::from_value::<AnnouncementBanners>(r).ok());
        let mut source = match resolved {
            Some(resolved) => announcements::pin_durations(&stored.source, &resolved),
            None => stored.source,
        };
        if let Some(obj) = source.as_object_mut() {
            obj.insert(REVISION_FIELD.into(), stored.revision.into());
        }
        Ok(Some(source))
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

        // Every message is already stored, so rules newer than the seeded config cannot hide it.
        announcements::normalize_edit(&raw, Some(&raw), now)
            .map_err(|e| infra::errors::Error::Message(e.to_string()))
    }

    /// Run `save` while no other save of the config can, on this node or any other.
    pub async fn with_write_lock<T>(
        save: impl std::future::Future<Output = T>,
    ) -> Result<T, infra::errors::Error> {
        let _local = LOCAL_WRITE_LOCK.lock().await;
        let locker = infra::dist_lock::lock(WRITE_LOCK_KEY, 0).await?;
        let result = save.await;
        // The save has already happened, so a failed unlock must not report it as failed.
        if let Err(e) = infra::dist_lock::unlock(&locker).await {
            log::error!("Error unlocking announcement banners: {e}");
        }
        Ok(result)
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

/// Validate `body` against the stored config and save it, under [`storage::with_write_lock`].
#[cfg(feature = "enterprise")]
async fn save_config(mut body: serde_json::Value) -> Response {
    use o2_enterprise::enterprise::announcements;

    let stored = match storage::read_stored_fresh().await {
        Ok(stored) => stored,
        Err(e) => {
            log::error!("Error reading announcement banners: {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };
    let revision = stored.as_ref().map_or(0, |s| s.revision);

    // A body without a revision comes from a client that predates it, and is saved as before.
    let based_on = body
        .as_object_mut()
        .and_then(|obj| obj.remove(storage::REVISION_FIELD))
        .and_then(|r| r.as_u64());
    if based_on.is_some_and(|r| r != revision) {
        return MetaHttpResponse::conflict(
            "The announcement banners were changed by someone else. Reload and try again.",
        );
    }

    let now = chrono::Utc::now().timestamp_micros();
    // Rejected here, a typo cannot silently blank every banner until the window it covered has
    // passed.
    let resolved =
        match announcements::normalize_edit(&body, stored.as_ref().map(|s| &s.source), now) {
            Ok(resolved) => resolved,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };

    let banner_count = resolved.banners.len();
    let source = announcements::pin_durations(&body, &resolved);
    let revision = revision + 1;
    if let Err(e) = storage::write(storage::envelope(&source, &resolved, revision)).await {
        log::error!("Error saving announcement banners: {e}");
        return MetaHttpResponse::internal_error(e);
    }

    // Returned so the caller sees what relative durations resolved to.
    MetaHttpResponse::json(serde_json::json!({
        "message": format!("Saved {banner_count} announcement banner(s)"),
        "resolved": resolved,
        "revision": revision,
    }))
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
                   their original authored form, plus the `revision` to send back when saving.",
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
                   errors name the offending banner index and field. A body carrying the `revision` \
                   it was read at is refused with 409 when the config has been saved since.",
    security(("Authorization" = [])),
    request_body(content = Object, description = "Announcement banner configuration", content_type = "application/json"),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Bad Request", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 409, description = "Conflict", content_type = "application/json", body = ()),
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
    match storage::with_write_lock(save_config(body)).await {
        Ok(response) => response,
        Err(e) => {
            log::error!("Error locking announcement banners: {e}");
            MetaHttpResponse::internal_error(e)
        }
    }

    #[cfg(not(feature = "enterprise"))]
    MetaHttpResponse::forbidden("Announcement banners are not available")
}
