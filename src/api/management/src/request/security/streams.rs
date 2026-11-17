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

use axum::response::Response;
use config::meta::stream::{StreamType, UpdateStreamSettings};
use o2_enterprise::enterprise::security::streams::{is_security_source, weakens_security_source};

use super::security_allowed;
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

pub const REFUSED: &str = "Security source streams need the Security delete permission";

/// Refuses deleting a Security source stream or its data without the Security delete grant.
pub async fn guard_stream_delete(
    org_id: &str,
    user_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), Response> {
    let settings = infra::schema::get_settings(org_id, stream_name, stream_type).await;
    let source = settings.is_some_and(|s| is_security_source(s.security.as_ref()));
    if stream_type == StreamType::EnrichmentTables {
        super::intel::guard_intel_list(org_id, user_id, stream_name, "DELETE").await?;
    }
    refuse_unless_admin(org_id, user_id, source).await?;
    if source {
        o2_enterprise::enterprise::security::audit::mark();
    }
    Ok(())
}

/// Refuses weakening a Security source without Security DELETE; `Ok(true)` if it touches one.
pub async fn guard_settings_update(
    org_id: &str,
    user_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    update: &UpdateStreamSettings,
) -> Result<bool, Response> {
    let current = infra::schema::get_settings(org_id, stream_name, stream_type).await;
    let source = current
        .as_ref()
        .is_some_and(|s| is_security_source(s.security.as_ref()));
    // what `data_retention: 0` resolves to for this stream (org per-type, org default, global)
    let inherited =
        db::organization::stream_retention_days(org_id, stream_type, stream_name, 0).await;
    let weakens = current
        .as_ref()
        .is_some_and(|current| weakens_security_source(current, update, inherited_days(inherited)));
    refuse_unless_admin(org_id, user_id, weakens).await?;
    Ok(source || update.security.is_some())
}

/// The days a stream with no value of its own keeps data. 0 keeps it forever, and a failed read
/// counts as the shortest retention, so the guard refuses instead of guessing.
fn inherited_days(resolved: Result<i64, infra::errors::Error>) -> i64 {
    match resolved {
        Ok(0) => i64::MAX,
        Ok(days) => days,
        Err(e) => {
            log::error!("[SECURITY] inherited retention read failed: {e}");
            1
        }
    }
}

/// A `security` change is audited by its summary row, so its request row is not stamped too.
pub fn audits_settings_request(touches_security: bool, summary_written: bool) -> bool {
    touches_security && !summary_written
}

async fn refuse_unless_admin(
    org_id: &str,
    user_id: &str,
    destructive: bool,
) -> Result<(), Response> {
    if destructive && !security_allowed(org_id, user_id, "DELETE").await {
        return Err(MetaHttpResponse::forbidden(REFUSED));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_a_destructive_change_needs_the_security_delete_grant() {
        let stranger = format!("{}@example.com", config::ider::uuid());
        let refused = refuse_unless_admin("org", &stranger, true)
            .await
            .unwrap_err();
        assert_eq!(refused.status(), axum::http::StatusCode::FORBIDDEN);
        assert!(refuse_unless_admin("org", &stranger, false).await.is_ok());
    }

    #[test]
    fn test_retention_zero_is_judged_by_what_the_stream_inherits() {
        let source = config::meta::stream::StreamSettings {
            data_retention: 30,
            security: Some(config::meta::stream::SecuritySourceSetting {
                included: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        };
        let to_default = UpdateStreamSettings {
            data_retention: Some(0),
            ..Default::default()
        };
        let weakens =
            |resolved| weakens_security_source(&source, &to_default, inherited_days(resolved));
        assert!(weakens(Ok(3)), "the org default is shorter than 30 days");
        assert!(!weakens(Ok(90)));
        assert!(!weakens(Ok(0)), "0 keeps the data forever");
        assert!(
            weakens(Err(infra::errors::Error::Message("down".to_string()))),
            "an unknown default is refused"
        );
    }

    #[test]
    fn test_a_security_change_is_audited_once() {
        assert!(
            !audits_settings_request(true, true),
            "the summary row covers it"
        );
        assert!(audits_settings_request(true, false));
        assert!(!audits_settings_request(false, false));
    }

    #[tokio::test]
    async fn test_the_settings_guard_never_stamps_the_request_row_itself() {
        let stranger = format!("{}@example.com", config::ider::uuid());
        let update = UpdateStreamSettings {
            security: Some(Some(Default::default())),
            ..Default::default()
        };
        let (touches, marked) = o2_enterprise::enterprise::security::audit::tracked(
            guard_settings_update("org", &stranger, "web", StreamType::Logs, &update),
        )
        .await;
        assert!(touches.unwrap());
        assert!(!marked);
    }
}
