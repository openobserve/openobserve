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
use config::meta::stream::{DataRetentionDefaults, StreamType, UpdateStreamSettings};
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
        .is_some_and(|current| weakens_under(current, update, inherited));
    refuse_unless_admin(org_id, user_id, weakens).await?;
    Ok(source || update.security.is_some())
}

/// Judges `data_retention: 0` by what the stream then inherits, where 0 keeps data forever.
/// After a failed read the update is refused if the shortest or the longest value weakens it.
fn weakens_under(
    current: &config::meta::stream::StreamSettings,
    update: &UpdateStreamSettings,
    inherited: Result<i64, infra::errors::Error>,
) -> bool {
    let candidates = match inherited {
        Ok(0) => vec![i64::MAX],
        Ok(days) => vec![days],
        Err(e) => {
            log::error!("[SECURITY] inherited retention read failed: {e}");
            vec![1, i64::MAX]
        }
    };
    candidates
        .into_iter()
        .any(|days| weakens_security_source(current, update, days))
}

/// Refuses org defaults that shorten a Security source without the Security delete grant.
/// `Some` holds the stored defaults the answer rests on; the write must still find them.
pub async fn guard_org_retention_update(
    org_id: &str,
    user_id: &str,
    stored: Option<DataRetentionDefaults>,
    update: &DataRetentionDefaults,
) -> Result<Option<DataRetentionDefaults>, Response> {
    // `stored` is what a write found under its lock; without one the cached value is judged
    let current = match stored {
        Some(stored) => Some(stored),
        None => db::organization::org_retention_defaults(org_id)
            .await
            .inspect_err(|e| log::error!("[SECURITY] org retention read failed: {e}"))
            .ok(),
    };
    // unknown stored defaults are refused: a source may get shorter under them
    let destructive = match &current {
        Some(current) => shortens_a_security_source(org_id, current, update).await,
        None => true,
    };
    refuse_unless_admin(org_id, user_id, destructive).await?;
    Ok(current.filter(|_| !destructive))
}

/// Whether any Security source keeps its data for fewer days under `update` than `current`.
async fn shortens_a_security_source(
    org_id: &str,
    current: &DataRetentionDefaults,
    update: &DataRetentionDefaults,
) -> bool {
    if current == update {
        return false;
    }
    let streams = match stream::try_get_streams(org_id, None, false, None).await {
        Ok(streams) => streams,
        Err(e) => {
            log::error!("[SECURITY] stream listing failed for {org_id}: {e}");
            return true;
        }
    };
    for stream in streams {
        if !is_security_source(stream.settings.security.as_ref()) {
            continue;
        }
        let days = |org| {
            db::organization::stream_retention_days_under(
                org,
                org_id,
                stream.stream_type,
                &stream.name,
                stream.settings.data_retention,
            )
        };
        if retention_shortened(days(current).await, days(update).await) {
            return true;
        }
    }
    false
}

/// 0 keeps the data forever; a failed read is treated as shortened.
fn retention_shortened(
    before: Result<i64, infra::errors::Error>,
    after: Result<i64, infra::errors::Error>,
) -> bool {
    let days = |days: i64| if days > 0 { days } else { i64::MAX };
    match (before, after) {
        (Ok(before), Ok(after)) => days(after) < days(before),
        (Err(e), _) | (_, Err(e)) => {
            log::error!("[SECURITY] effective retention read failed: {e}");
            true
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
        let retention = |days| UpdateStreamSettings {
            data_retention: Some(days),
            ..Default::default()
        };
        let down = || Err(infra::errors::Error::Message("down".to_string()));
        assert!(
            weakens_under(&source, &retention(0), Ok(3)),
            "the org default is shorter than 30 days"
        );
        assert!(!weakens_under(&source, &retention(0), Ok(90)));
        assert!(
            !weakens_under(&source, &retention(0), Ok(0)),
            "0 keeps the data forever"
        );
        assert!(
            weakens_under(&source, &retention(0), down()),
            "an unknown default is refused"
        );
        // a source that inherits its retention: an unknown default never hides a shorter value
        let inheriting = config::meta::stream::StreamSettings {
            data_retention: 0,
            ..source.clone()
        };
        assert!(weakens_under(&inheriting, &retention(7), Ok(90)));
        assert!(weakens_under(&inheriting, &retention(7), down()));
        assert!(!weakens_under(&source, &retention(60), down()));
    }

    #[test]
    fn test_a_source_is_shortened_only_by_fewer_effective_days() {
        let down = || Err(infra::errors::Error::Message("down".to_string()));
        assert!(retention_shortened(Ok(30), Ok(3)));
        assert!(!retention_shortened(Ok(30), Ok(30)));
        assert!(!retention_shortened(Ok(30), Ok(60)));
        assert!(retention_shortened(Ok(0), Ok(3)), "0 kept the data forever");
        assert!(!retention_shortened(Ok(3), Ok(0)));
        assert!(retention_shortened(down(), Ok(30)));
        assert!(retention_shortened(Ok(30), down()));
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
