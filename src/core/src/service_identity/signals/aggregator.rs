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

use config::meta::stream::StreamSettings;

pub const VERDICTS: &str = "_o2_service_verdicts";
/// Days the verdict event stream keeps, seeded while the operator kept the default.
#[cfg(feature = "enterprise")]
const VERDICT_EVENTS_RETENTION_DAYS: i64 = 90;

pub fn seed_settings(settings: &mut StreamSettings, retention: i64, default: i64) -> bool {
    let before = settings.clone();
    if settings.data_retention == 0 || settings.data_retention == default {
        settings.data_retention = retention;
    }
    for field in ["service", "version", "image", "where_key"] {
        if !settings.index_fields.iter().any(|key| key == field) {
            settings.index_fields.push(field.to_string());
        }
    }
    *settings != before
}

/// Writes verdict events, the one log stream the processor still writes.
#[cfg(feature = "enterprise")]
pub(super) async fn write(
    org: &str,
    rows: Vec<serde_json::Value>,
    ownership: &super::processor::Ownership<'_>,
) -> Result<(), anyhow::Error> {
    use config::meta::stream::StreamType;

    use crate::ingestion::feature_writer::{self, FeatureWriter, GrpcTransport};
    if rows.is_empty() {
        return Ok(());
    }
    let token = feature_writer::token(FeatureWriter::ServiceSignals, org).await?;
    ownership.check().await?;
    feature_writer::write(&GrpcTransport, &token, VERDICTS, serde_json::to_vec(&rows)?).await?;
    let mut settings = infra::schema::get_settings(org, VERDICTS, StreamType::Logs)
        .await
        .map(|s| (*s).clone())
        .unwrap_or_default();
    if seed_settings(
        &mut settings,
        VERDICT_EVENTS_RETENTION_DAYS,
        config::get_config().compact.data_retention_days,
    ) {
        ownership.check().await?;
        schema::save_stream_settings(org, VERDICTS, StreamType::Logs, settings).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_seeded_only_when_retention_default() {
        for (old, expected) in [(0, 90), (30, 90), (12, 12)] {
            let mut settings = StreamSettings {
                data_retention: old,
                ..Default::default()
            };
            seed_settings(&mut settings, 90, 30);
            assert_eq!(settings.data_retention, expected);
            assert!(!seed_settings(&mut settings, 90, 30));
        }
    }
}
