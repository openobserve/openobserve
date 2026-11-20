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

//! The incident analysis's side of the next step: the engine's evidence in, the model's step out.

use std::{future::Future, time::Duration};

use config::{
    meta::{
        alerts::incidents::AlertKind,
        oncall::{AnalysisVerdict, EvidenceBundle},
    },
    utils::time::now_micros,
};
use o2_enterprise::enterprise::autoobserve::{
    context::{self, IssueRef, StoredContext, issue_for},
    next_step::{self, BUNDLE_WAIT},
    plugins::stream::finding_id,
};

use super::{
    incidents::SUBJECT_PREFIX,
    ports::{SearchAdapter, ports},
};
use crate::alerts::incidents::{
    FINDING_KIND_DIMENSION, FINDING_STREAM_NAME_DIMENSION, FINDING_STREAM_TYPE_DIMENSION,
};

/// Between reads while the engine has not asked the issue's providers yet.
const POLL: Duration = Duration::from_secs(5);

/// The finding's decision kind, its stream's entity id and the onset of the firing analysed.
type FindingKey = (String, String, i64);

/// The bundle once the engine has asked, bound to `run_id`; `None` after [BUNDLE_WAIT] and the run
/// starts without it. The engine opens the incident before its analyzers store anything.
pub async fn evidence_for_incident(
    org: &str,
    incident_id: &str,
    run_id: &str,
) -> Option<EvidenceBundle> {
    if !next_step::enabled() {
        return None;
    }
    let key = match finding_key(org, incident_id).await {
        Ok(Some(key)) => key,
        Ok(None) => return None,
        Err(e) => {
            log::warn!("[autoobserve] no evidence for {org}/{incident_id}: {e}");
            return None;
        }
    };
    let Some((issue, stored)) = wait_for(BUNDLE_WAIT, POLL, || asked(org, &key)).await else {
        log::info!("[autoobserve] {org}/{incident_id} analysed without evidence: not asked yet");
        return None;
    };
    let (bundle, map) = next_step::bundle(&issue, &stored);
    // The issue and map this run read, never the incident's live run, so a later run binds nothing.
    let runs = &next_step::DbRuns;
    match next_step::bind(
        &ports(),
        runs,
        &issue,
        incident_id,
        run_id,
        map,
        now_micros(),
    )
    .await
    {
        Ok(true) => Some(bundle),
        Ok(false) => {
            log::info!(
                "[autoobserve] run {run_id} of {org}/{incident_id} ended before its evidence"
            );
            None
        }
        Err(e) => {
            log::warn!(
                "[autoobserve] run {run_id} of {org}/{incident_id}: evidence not bound: {e}"
            );
            None
        }
    }
}

/// Stores the run's step, accepted or refused; the engine's pass re-attaches one this misses.
pub async fn on_run_finished(
    org: &str,
    incident_id: &str,
    run_id: &str,
    verdict: Option<&AnalysisVerdict>,
) {
    if !next_step::enabled() {
        return;
    }
    let submitted = verdict.and_then(|v| v.next_step.clone());
    let (org, incident_id, run_id) = (org.to_string(), incident_id.to_string(), run_id.to_string());
    // Off the run's finalizer: a slow search must not hold the run open.
    tokio::spawn(async move {
        let issue = match finding_key(&org, &incident_id).await {
            Ok(Some((kind, entity, onset))) => {
                issue_for(&SearchAdapter, &org, &kind, &entity, onset).await
            }
            Ok(None) => return,
            Err(e) => Err(e),
        };
        let attached = match issue {
            Ok(Some(issue)) => {
                next_step::attach(&ports(), &issue, &incident_id, &run_id, submitted.as_ref()).await
            }
            Ok(None) => return,
            Err(e) => Err(e),
        };
        if let Err(e) = attached {
            log::warn!("[autoobserve] run {run_id} of {org}/{incident_id}: step not stored: {e}");
        }
    });
}

/// The finding behind an AutoObserve incident, `None` for any other incident.
async fn finding_key(org: &str, incident_id: &str) -> anyhow::Result<Option<FindingKey>> {
    let Some(incident) = infra::table::alert_incidents::get(org, incident_id).await? else {
        return Ok(None);
    };
    let Some((kind, entity)) = finding_of(&incident.group_values) else {
        return Ok(None);
    };
    let subject = format!("{SUBJECT_PREFIX}{}", finding_id(org, &kind, &entity));
    let ids = [incident_id.to_string()];
    let links =
        infra::table::alert_incidents::links_with_alert_kind(&ids, AlertKind::AutoObserve.as_str())
            .await?;
    // A reopened incident has a firing per onset; the run analyses the newest.
    let onset = links
        .iter()
        .filter(|l| l.alert_id == subject)
        .map(|l| l.alert_fired_at)
        .max();
    Ok(onset.map(|onset| (kind, entity, onset)))
}

fn finding_of(group_values: &serde_json::Value) -> Option<(String, String)> {
    let dim = |k: &str| group_values.get(k).and_then(|v| v.as_str());
    let kind = dim(FINDING_KIND_DIMENSION)?;
    let stream_type = dim(FINDING_STREAM_TYPE_DIMENSION)?;
    let stream_name = dim(FINDING_STREAM_NAME_DIMENSION)?;
    Some((kind.to_string(), format!("{stream_type}/{stream_name}")))
}

/// The issue and its stored context once the engine has asked its providers at least once.
async fn asked(org: &str, key: &FindingKey) -> anyhow::Result<Option<(IssueRef, StoredContext)>> {
    let (kind, entity, onset) = key;
    let Some(issue) = issue_for(&SearchAdapter, org, kind, entity, *onset).await? else {
        return Ok(None);
    };
    let stored = context::load(&SearchAdapter, org, std::slice::from_ref(&issue)).await?;
    Ok((!stored.asked.is_empty()).then_some((issue, stored)))
}

/// Reads until one finds something; `None` once `wait` passes, however slow a read is.
async fn wait_for<T, F, Fut>(wait: Duration, poll: Duration, mut read: F) -> Option<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = anyhow::Result<Option<T>>>,
{
    let reads = async {
        loop {
            match read().await {
                Ok(Some(found)) => return found,
                Ok(None) => {}
                Err(e) => log::debug!("[autoobserve] evidence read failed, retrying: {e}"),
            }
            tokio::time::sleep(poll).await;
        }
    };
    tokio::time::timeout(wait, reads).await.ok()
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use serde_json::json;

    use super::*;

    #[test]
    fn only_a_finding_incident_names_a_finding() {
        let finding = json!({
            FINDING_KIND_DIMENSION: "stream_silence",
            FINDING_STREAM_TYPE_DIMENSION: "logs",
            FINDING_STREAM_NAME_DIMENSION: "k8s-prod",
        });
        let alert = json!({"service": "checkout"});
        let no_stream = json!({FINDING_KIND_DIMENSION: "stream_silence"});
        let cases = [
            (finding, Some(("stream_silence", "logs/k8s-prod"))),
            (alert, None),
            (no_stream, None),
        ];
        for (dims, want) in cases {
            let want = want.map(|(k, e)| (k.to_string(), e.to_string()));
            assert_eq!(finding_of(&dims), want, "{dims}");
        }
    }

    /// The run waits at most `wait` for the engine's ask, however the reads go, then starts bare.
    #[tokio::test(start_paused = true)]
    async fn the_bundle_wait_ends_at_its_limit_and_takes_a_late_ask() {
        let wait = Duration::from_secs(45);
        let poll = Duration::from_secs(5);
        let start = tokio::time::Instant::now();
        let never = wait_for(wait, poll, || async { Ok(None::<u8>) }).await;
        assert_eq!((never, start.elapsed()), (None, wait));

        let reads = Cell::new(0);
        let start = tokio::time::Instant::now();
        let late = wait_for(wait, poll, || {
            reads.set(reads.get() + 1);
            let n = reads.get();
            async move {
                match n {
                    1 => Err(anyhow::anyhow!("search busy")),
                    2 => Ok(None),
                    _ => Ok(Some(n)),
                }
            }
        })
        .await;
        assert_eq!((late, start.elapsed()), (Some(3), 2 * poll));
    }
}
