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

use config::meta::oncall::{RcaContext, SubjectType, rca::RcaCapabilities};
use serde_json::Value;

pub fn rca_capabilities(org_id: &str) -> RcaCapabilities {
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

pub fn enrich_context(context: &mut Value, capabilities: &RcaCapabilities) {
    let Some(fields) = context.as_object_mut() else {
        return;
    };
    fields.remove("serving_region");
    match serde_json::to_value(capabilities) {
        Ok(value) => {
            fields.insert("capabilities".to_string(), value);
        }
        Err(error) => log::error!("[RCA] could not serialize capabilities: {error}"),
    }
    if fields.get("history_reads_allowed") == Some(&Value::Bool(false)) {
        block_history(context);
    }
}

pub fn block_history(context: &mut Value) {
    let Some(fields) = context.as_object_mut() else {
        return;
    };
    fields.insert("history_reads_allowed".to_string(), Value::Bool(false));
    for key in [
        "previous_analysis",
        "past_causes",
        "similar_causes",
        "is_reanalysis",
    ] {
        fields.remove(key);
    }
}

pub fn alert_context(org_id: &str, alert_id: &str, fired_at_us: i64) -> RcaContext {
    let mut context =
        RcaContext::new(SubjectType::Alert, alert_id, org_id).with_window(fired_at_us);
    context.first_alert_at_us = Some(fired_at_us);
    context.fired_at_us = Some(fired_at_us);
    context.capabilities = Some(rca_capabilities(org_id));
    context
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_enriched_subject_carries_capabilities_without_a_top_level_region() {
        for subject in [SubjectType::Incident, SubjectType::Alert] {
            let context = RcaContext::new(subject, "subject", "org");
            let mut json = serde_json::to_value(&context).unwrap();
            enrich_context(&mut json, &rca_capabilities("org"));
            assert!(json["capabilities"].is_object());
            assert!(json.get("serving_region").is_none());
            assert_eq!(
                json["capabilities"],
                serde_json::to_value(rca_capabilities("org")).unwrap()
            );
        }
    }

    #[cfg(not(feature = "enterprise"))]
    #[test]
    fn oss_capabilities_match_the_contract() {
        assert_eq!(rca_capabilities("org"), RcaCapabilities::oss());
    }

    #[test]
    fn only_explicit_false_removes_history() {
        for allowed in [None, Some(true), Some(false)] {
            let mut context = RcaContext::new(SubjectType::Incident, "incident", "org");
            context.previous_analysis = Some("previous report".into());
            context.past_causes = vec!["past cause".into()];
            context.similar_causes = vec!["reviewed cause".into()];
            context.history_reads_allowed = allowed;
            let mut json = serde_json::to_value(context).unwrap();
            json["is_reanalysis"] = Value::Bool(true);
            enrich_context(&mut json, &rca_capabilities("org"));
            for key in [
                "previous_analysis",
                "past_causes",
                "similar_causes",
                "is_reanalysis",
            ] {
                assert_eq!(json.get(key).is_none(), allowed == Some(false), "{key}");
            }
        }
    }

    #[test]
    fn alert_subjects_use_the_firing_time_and_two_hour_window() {
        let fired_at = 14 * 3_600_000_000;
        let context = alert_context("org", "alert", fired_at);
        assert_eq!(context.subject_type, SubjectType::Alert);
        assert_eq!(context.first_alert_at_us, Some(fired_at));
        assert_eq!(context.fired_at_us, Some(fired_at));
        assert_eq!(context.impact_start_at, Some(fired_at));
        assert_eq!(context.window_start_us, Some(12 * 3_600_000_000));
        assert_eq!(context.capabilities, Some(rca_capabilities("org")));
    }
}
