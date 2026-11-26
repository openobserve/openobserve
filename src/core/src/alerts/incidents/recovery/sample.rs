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

use std::time::Duration;

use common::meta::incidents_v2::RecoverySettings;
use config::{
    meta::alerts::recovery::{Observation, Rollback, Verdict, transitions::CheckState},
    utils::time::now_micros,
};
use infra::table::entity::{
    alert_incidents::Model as Incident, incident_recovery_checks::Model as Check,
};
use sea_orm::DatabaseConnection;

use super::{
    super::mitigations::signals::{Reading, measure},
    ApplyMetadata,
};
use crate::alerts::what_changed::{self, ChangeScope, ChangeWindow};

pub(super) async fn observe(
    db: &DatabaseConnection,
    incident: &Incident,
    check: &Check,
    sample_ts: i64,
    settings: &RecoverySettings,
) -> (Observation, ApplyMetadata) {
    let timeout = Duration::from_secs(settings.query_timeout_secs.max(1) as u64);
    let read = async {
        let reading = measure(db, check, sample_ts, settings).await;
        // Live SLO status can include data newer than the scheduled grid point.
        (reading, (check.source == "slo").then(now_micros))
    };
    let ((reading, measured_at), rollback) = tokio::join!(
        read,
        tokio::time::timeout(timeout, observed_rollout(incident, check, sample_ts)),
    );
    let reading = match reading {
        Ok(reading) => reading,
        Err(error) => {
            log::warn!(
                "[INCIDENTS] Recovery measurement failed for {}: {error}",
                check.id
            );
            Reading::without_values(Verdict::Error)
        }
    };
    let rollback = match rollback {
        Ok(Ok(change)) => change,
        Ok(Err(error)) => {
            log::warn!(
                "[INCIDENTS] Recovery rollout lookup failed for {}: {error}",
                check.id
            );
            None
        }
        Err(_) => {
            log::warn!(
                "[INCIDENTS] Recovery rollout lookup timed out for {}",
                check.id
            );
            None
        }
    };
    let reading = match rollback {
        Some(change) if !matches!(reading.verdict, Verdict::Denied { .. }) => {
            Reading::without_values(Verdict::RollbackObserved(change))
        }
        _ => reading,
    };
    let observation = Observation {
        incident_id: check.incident_id.clone(),
        check_id: check.id.clone(),
        attempt_id: check.attempt_id.clone(),
        generation: check.generation,
        sample_ts,
        verdict: reading.verdict,
        value: reading.value,
        volume_pct: reading.volume_pct,
        evaluator_region: config::get_cluster_name(),
    };
    let metadata = ApplyMetadata {
        measured_at,
        verification_blocked: reading.verification_blocked,
    };
    (observation, metadata)
}

async fn observed_rollout(
    incident: &Incident,
    check: &Check,
    sample_ts: i64,
) -> anyhow::Result<Option<Rollback>> {
    if check.state == CheckState::Held.as_str() || incident.status == "resolved" {
        return Ok(None);
    }
    let service = if check.source == "traces_red" {
        check.source_ref.as_deref()
    } else {
        incident.group_values[config::meta::oncall::SERVICE_DIMENSION].as_str()
    };
    let Some(service) = service.filter(|service| !service.is_empty()) else {
        return Ok(None);
    };
    let mut scope = ChangeScope::from_group_values(&incident.group_values);
    let scoped = check
        .scope
        .as_deref()
        .map(serde_json::from_str::<serde_json::Value>)
        .transpose()?;
    if let Some(scoped) = &scoped {
        scope.region = scoped["region"].as_str().map(str::to_owned);
    }
    let rest_regions: Vec<_> = scoped
        .as_ref()
        .and_then(|scope| scope["rest"].as_array())
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .collect();
    let start = check.trigger_at.max(check.effect_from_at).saturating_add(1);
    if start > sample_ts {
        return Ok(None);
    }
    let window = ChangeWindow {
        start_us: start,
        end_us: sample_ts,
        onset_us: check.trigger_at,
        evaluation_period_secs: 0,
    };
    Ok(
        what_changed::recovery_rollout(&check.org_id, service, scope, &rest_regions, window)
            .await?
            .map(|(change_ref, at)| Rollback { change_ref, at }),
    )
}
