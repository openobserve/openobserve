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
        .is_some_and(|current| weakens_under(current, update, inherited));
    refuse_unless_admin(org_id, user_id, weakens).await?;
    Ok(source || update.security.is_some())
}

/// Judges the update by the days a stream with no value of its own keeps data, where 0 keeps
/// it forever. After a failed read the value is unknown, so the update is refused if it weakens
/// the source under the shortest or the longest value.
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

/// Refuses an org retention default that shortens a Security source which inherits it, unless
/// the user holds the Security delete grant.
pub async fn guard_org_retention_update(
    org_id: &str,
    user_id: &str,
    update: &config::meta::stream::DataRetentionDefaults,
) -> Result<(), Response> {
    // `None` after a failed read: every type then counts as shortened
    let defaults = match db::organization::org_retention_defaults(org_id).await {
        Ok(current) => Some((
            db::organization::resolved_retention_defaults(&current),
            db::organization::resolved_retention_defaults(update),
        )),
        Err(e) => {
            log::error!("[SECURITY] org retention read failed: {e}");
            None
        }
    };
    let shortened = |stream_type| {
        defaults
            .as_ref()
            .is_none_or(|(current, update)| default_shortened_for(stream_type, current, update))
    };
    let any_shortened = defaults.as_ref().is_none_or(|(current, update)| {
        RETENTION_TYPES
            .into_iter()
            .chain([StreamType::Metadata])
            .any(|t| default_shortened_for(t, current, update))
    });
    // a failed listing is refused: a source may sit behind it
    let destructive = any_shortened
        && match stream::try_get_streams(org_id, None, false, None).await {
            Ok(streams) => streams.iter().any(|stream| {
                shortened(stream.stream_type) && inherits_as_security_source(&stream.settings)
            }),
            Err(e) => {
                log::error!("[SECURITY] stream listing failed for {org_id}: {e}");
                true
            }
        };
    refuse_unless_admin(org_id, user_id, destructive).await
}

/// The stream types with an org retention default of their own.
const RETENTION_TYPES: [StreamType; 4] = [
    StreamType::Logs,
    StreamType::Metrics,
    StreamType::Traces,
    StreamType::Profiles,
];

/// Whether the resolved default that a stream of this type inherits gets shorter. A type with
/// no value of its own follows the generic default. 0 keeps the data forever.
fn default_shortened_for(
    stream_type: StreamType,
    current: &config::meta::stream::DataRetentionDefaults,
    update: &config::meta::stream::DataRetentionDefaults,
) -> bool {
    let days = |defaults: &config::meta::stream::DataRetentionDefaults| {
        let days = if RETENTION_TYPES.contains(&stream_type) {
            defaults.for_type(stream_type)
        } else {
            defaults.default
        };
        if days > 0 { days } else { i64::MAX }
    };
    days(update) < days(current)
}

/// A Security source with no retention of its own, so the org default decides its data.
fn inherits_as_security_source(settings: &config::meta::stream::StreamSettings) -> bool {
    settings.data_retention <= 0 && is_security_source(settings.security.as_ref())
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
    fn test_an_org_default_is_judged_per_type_and_only_for_inheriting_sources() {
        use config::meta::stream::{DataRetentionDefaults, SecuritySourceSetting, StreamSettings};
        let defaults = |default, logs| DataRetentionDefaults {
            default,
            logs,
            metrics: 30,
            traces: 30,
            profiles: 30,
        };
        let shortened =
            |stream_type, current, update| default_shortened_for(stream_type, &current, &update);
        let (logs, metrics, metadata) =
            (StreamType::Logs, StreamType::Metrics, StreamType::Metadata);
        assert!(shortened(logs, defaults(30, 30), defaults(30, 3)));
        assert!(!shortened(metrics, defaults(30, 30), defaults(30, 3)));
        assert!(!shortened(logs, defaults(30, 30), defaults(30, 60)));
        assert!(
            shortened(logs, defaults(30, 0), defaults(30, 3)),
            "0 kept the data forever"
        );
        assert!(!shortened(logs, defaults(30, 3), defaults(30, 0)));
        // a type with no value of its own follows the generic default
        assert!(shortened(metadata, defaults(30, 30), defaults(3, 30)));
        assert!(!shortened(logs, defaults(30, 30), defaults(3, 30)));
        assert!(!shortened(metadata, defaults(30, 30), defaults(30, 3)));

        let stream = |data_retention, source: bool| StreamSettings {
            data_retention,
            security: source.then(|| SecuritySourceSetting {
                included: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(inherits_as_security_source(&stream(0, true)));
        assert!(
            !inherits_as_security_source(&stream(30, true)),
            "its own retention decides"
        );
        assert!(!inherits_as_security_source(&stream(0, false)));
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
