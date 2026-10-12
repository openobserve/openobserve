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

use std::sync::LazyLock as Lazy;

use config::{
    meta::stream::{StreamSettings, StreamType},
    utils::time::now_micros,
};
use dashmap::DashSet;

pub const RUM_DATA_STREAM: &str = "_rumdata";

/// Secondary index fields the trace-to-RUM lookup filters on.
pub const RUM_LOOKUP_INDEX_FIELDS: [&str; 4] =
    ["_o2_trace_id", "_oo_trace_id", "view_id", "action_id"];

static SEEDED_ORGS: Lazy<DashSet<String>> = Lazy::new(DashSet::new);

/// Adds the lookup index fields to the org's RUM data stream once per process, keeping its other
/// settings.
pub async fn ensure_lookup_index_fields(org_id: &str) {
    if !SEEDED_ORGS.insert(org_id.to_string()) {
        return;
    }
    if let Err(e) = seed_lookup_index_fields(org_id).await {
        SEEDED_ORGS.remove(org_id);
        log::warn!("[RUM] failed to add lookup index fields to {org_id}/{RUM_DATA_STREAM}: {e}");
    }
}

async fn seed_lookup_index_fields(org_id: &str) -> Result<(), schema::StreamSettingsError> {
    let mut settings = infra::schema::get_settings(org_id, RUM_DATA_STREAM, StreamType::Logs)
        .await
        .map(|settings| (*settings).clone())
        .unwrap_or_default();
    if !add_lookup_index_fields(&mut settings, now_micros()) {
        return Ok(());
    }
    schema::save_stream_settings(org_id, RUM_DATA_STREAM, StreamType::Logs, settings).await?;
    log::info!(
        "[RUM] added lookup index fields {RUM_LOOKUP_INDEX_FIELDS:?} to {org_id}/{RUM_DATA_STREAM}"
    );
    Ok(())
}

fn add_lookup_index_fields(settings: &mut StreamSettings, now: i64) -> bool {
    let mut added = false;
    for field in RUM_LOOKUP_INDEX_FIELDS {
        // The settings store rejects a secondary index field that is also an FTS or partition key.
        if settings.index_fields.iter().any(|f| f == field)
            || settings.full_text_search_keys.iter().any(|f| f == field)
            || settings.partition_keys.iter().any(|p| p.field == field)
        {
            continue;
        }
        settings.index_fields.push(field.to_string());
        // Without its own cutoff the field inherits the stream's, claiming older files are indexed.
        settings
            .index_fields_updated_at
            .insert(field.to_string(), now);
        added = true;
    }
    added
}

#[cfg(test)]
mod tests {
    use config::meta::stream::{StreamPartition, StreamSettings};

    use super::*;

    #[test]
    fn test_lookup_index_fields_are_added_once() {
        let mut settings = StreamSettings {
            index_fields: vec!["service".to_string()],
            ..Default::default()
        };
        assert!(add_lookup_index_fields(&mut settings, 10));
        assert!(!add_lookup_index_fields(&mut settings, 20));
        assert_eq!(
            settings.index_fields,
            vec![
                "service",
                "_o2_trace_id",
                "_oo_trace_id",
                "view_id",
                "action_id"
            ]
        );
        assert_eq!(settings.index_fields_updated_at.get("view_id"), Some(&10));
        assert!(!settings.index_fields_updated_at.contains_key("service"));
    }

    #[test]
    fn test_lookup_index_fields_keep_existing_cutoff() {
        let mut settings = StreamSettings {
            index_fields: vec!["view_id".to_string()],
            ..Default::default()
        };
        settings
            .index_fields_updated_at
            .insert("view_id".to_string(), 5);
        assert!(add_lookup_index_fields(&mut settings, 10));
        assert_eq!(settings.index_fields_updated_at.get("view_id"), Some(&5));
        assert_eq!(settings.index_fields_updated_at.get("action_id"), Some(&10));
    }

    #[test]
    fn test_lookup_index_fields_skip_fts_and_partition_keys() {
        let mut settings = StreamSettings {
            full_text_search_keys: vec!["view_id".to_string()],
            partition_keys: vec![StreamPartition::new("action_id")],
            ..Default::default()
        };
        assert!(add_lookup_index_fields(&mut settings, 10));
        assert_eq!(settings.index_fields, vec!["_o2_trace_id", "_oo_trace_id"]);
    }
}
