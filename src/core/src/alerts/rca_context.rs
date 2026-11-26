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

use std::str::FromStr;

use config::meta::{
    alerts::{incidents::AlertKind, what_changed::WhatChanged},
    oncall::{EvidenceBundle, RcaContext},
};

use super::{
    rca_capabilities::rca_capabilities,
    what_changed::{self, ChangeScope, ChangeWindow},
};

pub async fn incident_context(
    org_id: &str,
    incident_id: &str,
    previous_analysis: Option<String>,
    evidence: Option<EvidenceBundle>,
    principal: Option<&str>,
) -> RcaContext {
    let mut context = o2_enterprise::enterprise::alerts::rca_service::build_incident_context(
        org_id,
        incident_id,
        previous_analysis,
        evidence,
    )
    .await;
    let history_allowed =
        infra::table::rca_fence::incident_history_allowed(org_id, incident_id).await;
    context.history_reads_allowed = Some(history_allowed);
    if !history_allowed {
        context.past_causes.clear();
        context.similar_causes.clear();
        context.previous_analysis = None;
    }
    context.capabilities = Some(rca_capabilities(org_id));
    context.recent_changes = Some(incident_changes(org_id, incident_id, &context, principal).await);
    context
}

async fn incident_changes(
    org_id: &str,
    incident_id: &str,
    context: &RcaContext,
    principal: Option<&str>,
) -> WhatChanged {
    let incident = match infra::table::alert_incidents::get_rw(org_id, incident_id).await {
        Ok(Some(incident)) => incident,
        Ok(None) => return unavailable_changes("incident not found"),
        Err(error) => {
            log::warn!("[RCA] cannot read change scope for {org_id}/{incident_id}: {error}");
            return unavailable_changes("incident lookup failed");
        }
    };
    // Context must use the same stream grants as this producer's tools.
    let principal = match change_principal(org_id, principal).await {
        Ok(principal) => principal,
        Err(error) => {
            log::warn!("[RCA] cannot read changes as the SRE account of {org_id}: {error}");
            return unavailable_changes("SRE agent credentials unavailable");
        }
    };
    let (Some(onset_us), Some(start_us)) = (context.impact_start_at, context.window_start_us)
    else {
        return unavailable_changes("impact window unavailable");
    };
    let evaluation_period_secs = evaluation_period_or_zero(
        org_id,
        incident_id,
        evaluation_period(org_id, incident_id).await,
    );
    let window = ChangeWindow {
        start_us,
        end_us: config::utils::time::now_micros(),
        onset_us,
        evaluation_period_secs,
    };
    what_changed::read(
        org_id,
        &principal,
        window,
        &context.affected_services,
        &ChangeScope::from_group_values(&incident.group_values),
    )
    .await
}

async fn change_principal(org_id: &str, principal: Option<&str>) -> anyhow::Result<String> {
    match principal {
        Some(principal) => Ok(principal.to_string()),
        None => crate::organization::get_sre_agent_credentials(org_id)
            .await
            .map(|(email, _)| email),
    }
}

async fn evaluation_period(org_id: &str, incident_id: &str) -> Result<i64, String> {
    let firings = infra::table::alert_incidents::get_incident_alerts_rw(incident_id)
        .await
        .map_err(|error| error.to_string())?;
    let Some(first) = firings.iter().min_by_key(|firing| firing.alert_fired_at) else {
        return Err("incident has no linked alerts".to_string());
    };
    if AlertKind::from_stored(&first.alert_kind) != AlertKind::Internal {
        return Err(format!(
            "{} alert {} is not local",
            first.alert_kind, first.alert_id
        ));
    }
    let id = match svix_ksuid::Ksuid::from_str(&first.alert_id) {
        Ok(id) => id,
        Err(error) => return Err(error.to_string()),
    };
    let alert = db::alerts::alert::get_by_id(infra::db::get_orm_client_rw().await, org_id, id)
        .await
        .map_err(|error| error.to_string())?;
    match alert {
        Some((_, alert)) => Ok(alert.trigger_condition.period.max(0).saturating_mul(60)),
        None => Err(format!("alert {} not found", first.alert_id)),
    }
}

fn evaluation_period_or_zero(org_id: &str, incident_id: &str, period: Result<i64, String>) -> i64 {
    match period {
        Ok(period) => period,
        Err(error) => {
            log::warn!(
                "[RCA] cannot read onset precision of {org_id}/{incident_id}, using 0 seconds: {error}"
            );
            0
        }
    }
}

fn unavailable_changes(reason: &str) -> WhatChanged {
    log::warn!("[RCA] change context unavailable: {reason}");
    let mut result = WhatChanged::default();
    result.coverage.unavailable_sources.push(reason.to_string());
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn explicit_principal_does_not_require_sre_credentials() {
        assert_eq!(
            change_principal("org-without-sre-credentials", Some("caller@example.com"))
                .await
                .unwrap(),
            "caller@example.com"
        );
    }

    #[test]
    fn unavailable_evaluation_period_keeps_zero_precision() {
        for period in [
            Ok(0),
            Err("external alert is not local".to_string()),
            Err("autoobserve alert is not local".to_string()),
            Err("alert not found".to_string()),
            Err("invalid ksuid".to_string()),
            Err("database unavailable".to_string()),
        ] {
            assert_eq!(evaluation_period_or_zero("org", "incident", period), 0);
        }
        assert_eq!(evaluation_period_or_zero("org", "incident", Ok(120)), 120);
    }

    #[test]
    fn failed_context_reads_are_visible_in_change_coverage() {
        let changes = unavailable_changes("principal credentials unavailable");
        assert!(changes.changes.is_empty());
        assert_eq!(
            changes.coverage.unavailable_sources,
            ["principal credentials unavailable"]
        );
        assert!(!changes.coverage.detected_deploys);
        assert!(!changes.coverage.change_events);
    }

    #[test]
    fn incident_scope_keeps_environment_and_region_separate() {
        let dimensions =
            serde_json::json!({"service": "checkout", "env": "prod", "region": "west"});
        let scope = ChangeScope::from_group_values(&dimensions);
        assert_eq!(scope.env.as_deref(), Some("prod"));
        assert_eq!(scope.region.as_deref(), Some("west"));
        assert_eq!(
            ChangeScope::from_group_values(&serde_json::json!({})).env,
            None
        );
    }
}
