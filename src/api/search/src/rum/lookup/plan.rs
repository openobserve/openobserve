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

use config::utils::json;

// A page view outlives any trace started from it, so its rows are searched around the request.
const PAGE_VIEW_WINDOW_US: i64 = 3_600_000_000;

pub(super) struct PagePlan {
    pub(super) view_ids: Vec<String>,
    pub(super) action_ids: Vec<String>,
    pub(super) range: (i64, i64),
}

impl PagePlan {
    /// Ids come from every traced resource, the time anchor from the first one.
    pub(super) fn from_bridge(traced_resources: &[json::Value], trace_end: i64) -> Self {
        let mut view_ids: Vec<String> = Vec::new();
        let mut action_ids: Vec<String> = Vec::new();
        for hit in traced_resources {
            if let Some(id) = id_string(&hit["view_id"]) {
                push_unique(&mut view_ids, id);
            }
            for id in parse_action_ids(&hit["action_id"]) {
                push_unique(&mut action_ids, id);
            }
        }
        let anchor = traced_resources
            .first()
            .and_then(|hit| date_us(&hit["date"]))
            .unwrap_or(trace_end);
        Self {
            view_ids,
            action_ids,
            range: (
                anchor.saturating_sub(PAGE_VIEW_WINDOW_US),
                anchor.saturating_add(PAGE_VIEW_WINDOW_US),
            ),
        }
    }
}

fn push_unique(ids: &mut Vec<String>, id: String) {
    if !ids.contains(&id) {
        ids.push(id);
    }
}

fn id_string(value: &json::Value) -> Option<String> {
    match value {
        json::Value::String(id) if !id.is_empty() => Some(id.clone()),
        json::Value::Number(id) if id.as_f64() != Some(0.0) => Some(id.to_string()),
        _ => None,
    }
}

/// RUM `date` is in milliseconds, as a number or a numeric string.
fn date_us(value: &json::Value) -> Option<i64> {
    let ms = match value {
        json::Value::Number(ms) => ms.as_f64()?,
        json::Value::String(ms) => ms.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    (ms > 0.0).then_some((ms * 1000.0) as i64)
}

/// `action_id` is stored as a JSON array encoded in a string.
fn parse_action_ids(value: &json::Value) -> Vec<String> {
    let Some(encoded) = value.as_str().filter(|encoded| !encoded.is_empty()) else {
        return Vec::new();
    };
    match json::from_str::<json::Value>(encoded) {
        Ok(json::Value::Array(ids)) => ids
            .into_iter()
            .map(|id| match id {
                json::Value::String(id) => id,
                other => other.to_string(),
            })
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn test_page_plan_from_bridge() {
        let traced = vec![
            json!({"view_id": "v1", "date": 1_700_000_000_000i64, "action_id": "[\"a1\",\"a2\"]"}),
            json!({"view_id": "v2", "action_id": "[\"a3\"]"}),
            json!({"view_id": "v1", "action_id": "[\"a2\"]"}),
            json!({"view_id": ""}),
        ];
        let plan = PagePlan::from_bridge(&traced, 5);
        assert_eq!(plan.view_ids, vec!["v1", "v2"]);
        assert_eq!(plan.action_ids, vec!["a1", "a2", "a3"]);
        assert_eq!(
            plan.range,
            (
                1_700_000_000_000_000 - PAGE_VIEW_WINDOW_US,
                1_700_000_000_000_000 + PAGE_VIEW_WINDOW_US
            )
        );
    }

    #[test]
    fn test_page_plan_falls_back_to_trace_end() {
        let traced = vec![json!({"view_id": "v1", "date": 0, "action_id": "not json"})];
        let plan = PagePlan::from_bridge(&traced, 10 * PAGE_VIEW_WINDOW_US);
        assert!(plan.action_ids.is_empty());
        assert_eq!(
            plan.range,
            (9 * PAGE_VIEW_WINDOW_US, 11 * PAGE_VIEW_WINDOW_US)
        );
        assert_eq!(
            date_us(&json!("1700000000000")),
            Some(1_700_000_000_000_000)
        );
        assert_eq!(date_us(&json!(null)), None);
    }
}
