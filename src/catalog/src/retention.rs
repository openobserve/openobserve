// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::sync::LazyLock;

use config::{
    RwHashMap,
    meta::stream::StreamType,
    utils::time::{hour_micros, now_micros},
};

static DELETING_STREAMS: LazyLock<RwHashMap<String, i64>> = LazyLock::new(Default::default);

pub fn key(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: Option<(&str, &str)>,
) -> String {
    match date_range {
        None => format!("{org_id}/{stream_type}/{stream_name}/all"),
        Some((start, end)) => format!("{org_id}/{stream_type}/{stream_name}/{start},{end}"),
    }
}

/// Mark a stream deletion unless the same deletion was registered in the last hour.
pub fn try_mark_deleting(key: &str) -> bool {
    if let Some(value) = DELETING_STREAMS.get(key)
        && *value + hour_micros(1) > now_micros()
    {
        return false;
    }
    mark_deleting(key);
    true
}

/// Update the in-memory catalog from a persisted deletion record or watch event.
pub fn mark_deleting(key: &str) {
    DELETING_STREAMS.insert(key.to_string(), now_micros());
}

/// Remove a completed deletion from the shared catalog.
pub fn unmark_deleting(key: &str) {
    DELETING_STREAMS.remove(key);
}

pub fn is_deleting_stream(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: Option<(&str, &str)>,
) -> bool {
    DELETING_STREAMS.contains_key(&key(org_id, stream_type, stream_name, date_range))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_stable_catalog_key() {
        assert_eq!(
            key("org", StreamType::Logs, "stream", None),
            "org/logs/stream/all"
        );
        assert_eq!(
            key(
                "org",
                StreamType::Metrics,
                "cpu",
                Some(("2026-01-01", "2026-01-02"))
            ),
            "org/metrics/cpu/2026-01-01,2026-01-02"
        );
    }

    #[test]
    fn tracks_deleting_streams() {
        let catalog_key = key("catalog_test", StreamType::Traces, "spans", None);
        unmark_deleting(&catalog_key);
        assert!(try_mark_deleting(&catalog_key));
        assert!(is_deleting_stream(
            "catalog_test",
            StreamType::Traces,
            "spans",
            None
        ));
        assert!(!try_mark_deleting(&catalog_key));
        unmark_deleting(&catalog_key);
    }
}
