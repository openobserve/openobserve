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

//! What the serving build can answer, sent to the RCA agent in `RcaContext.capabilities`.

use config::meta::oncall::RcaCapabilities;
use serde_json::Value;

/// One function for every producer, so incident, alert-page and Slack contexts cannot drift.
pub async fn rca_capabilities(org_id: &str) -> RcaCapabilities {
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::alerts::rca_service::enterprise_capabilities(org_id)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = org_id;
        RcaCapabilities::oss()
    }
}

/// Writes `capabilities` and `serving_region` into a serialized `RcaContext`; a continuation's
/// `stored_region` (from its first turn) wins over this node's region.
pub fn enrich_context(context: &mut Value, caps: &RcaCapabilities, stored_region: Option<&str>) {
    let Some(fields) = context.as_object_mut() else {
        return;
    };
    let region = stored_region
        .filter(|r| !r.is_empty())
        .map(str::to_string)
        .or_else(|| caps.serving_region.clone().filter(|r| !r.is_empty()));
    if let Ok(caps) = serde_json::to_value(caps) {
        fields.insert("capabilities".to_string(), caps);
    }
    match region {
        Some(region) => {
            fields.insert("serving_region".to_string(), Value::String(region));
        }
        None => {
            fields.remove("serving_region");
        }
    }
}

/// Blocks history in a serialized `RcaContext`: an explicit `false` and no injected history.
pub fn block_history(context: &mut Value) {
    let Some(fields) = context.as_object_mut() else {
        return;
    };
    fields.insert("history_reads_allowed".to_string(), Value::Bool(false));
    fields.remove("previous_analysis");
    fields.remove("past_causes");
}

/// `context_used.serving_region` as a non-empty string; anything else is an unknown region.
pub fn stored_serving_region(context_used: Option<&Value>) -> Option<String> {
    context_used?
        .get("serving_region")?
        .as_str()
        .filter(|r| !r.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn the_oss_build_reports_oss_and_region_local() {
        let caps = rca_capabilities("default").await;
        assert_eq!(caps, RcaCapabilities::oss());
        assert_eq!(caps.serving_region.as_deref(), Some("local"));
        assert!(!caps.super_cluster);
    }

    #[test]
    fn enrichment_sets_capabilities_and_this_nodes_region() {
        let mut ctx = json!({ "subject_type": "incident", "subject_id": "inc_1" });
        let caps = RcaCapabilities {
            serving_region: Some("us-east-1".to_string()),
            ..RcaCapabilities::oss()
        };
        enrich_context(&mut ctx, &caps, None);
        assert_eq!(ctx["serving_region"], "us-east-1");
        assert_eq!(ctx["capabilities"]["edition"], "oss");
        assert_eq!(ctx["subject_id"], "inc_1");
    }

    #[test]
    fn a_continuation_keeps_the_region_its_first_turn_stored() {
        let mut ctx = json!({ "serving_region": "spoofed" });
        let caps = RcaCapabilities {
            serving_region: Some("eu-west-1".to_string()),
            ..RcaCapabilities::oss()
        };
        enrich_context(&mut ctx, &caps, Some("us-east-1"));
        assert_eq!(ctx["serving_region"], "us-east-1");
    }

    #[test]
    fn no_region_anywhere_leaves_the_key_absent() {
        let mut ctx = json!({ "serving_region": "" });
        let caps = RcaCapabilities {
            serving_region: None,
            ..RcaCapabilities::oss()
        };
        enrich_context(&mut ctx, &caps, Some(""));
        assert!(ctx.get("serving_region").is_none());
    }

    #[test]
    fn blocking_history_drops_injected_history() {
        let mut ctx = json!({
            "previous_analysis": "old report",
            "past_causes": ["[past:x] 2x x"],
            "history_reads_allowed": true
        });
        block_history(&mut ctx);
        assert_eq!(ctx["history_reads_allowed"], false);
        assert!(ctx.get("previous_analysis").is_none());
        assert!(ctx.get("past_causes").is_none());
    }

    #[test]
    fn the_stored_region_reads_only_a_non_empty_string() {
        assert_eq!(
            stored_serving_region(Some(&json!({ "serving_region": "us-east-1" }))).as_deref(),
            Some("us-east-1")
        );
        assert_eq!(
            stored_serving_region(Some(&json!({ "serving_region": "" }))),
            None
        );
        assert_eq!(
            stored_serving_region(Some(&json!({ "serving_region": 3 }))),
            None
        );
        assert_eq!(stored_serving_region(None), None);
    }
}
