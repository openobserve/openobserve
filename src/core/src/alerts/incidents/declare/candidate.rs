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

use config::meta::alerts::{incident_fields::group_fingerprint, incidents::ContextTarget};
use infra::table::{alert_incidents, entity::alert_incidents::Model, incident_contexts};
use sea_orm::ConnectionTrait;

use super::{DeclareCandidate, DeclareError, ScopeMatch, Subject};

const DEDUP_LOOKBACK_US: i64 = 30 * 60 * 1_000_000;

pub(super) struct Candidate {
    pub incident: Model,
    pub scope: ScopeMatch,
    reason: Reason,
}

impl Candidate {
    pub fn preview(self) -> DeclareCandidate {
        DeclareCandidate {
            incident_id: self.incident.id,
            title: self.incident.title,
            scope_match: self.scope,
            reason: self.reason.as_str().to_owned(),
        }
    }
}

enum Reason {
    Service,
    Source,
}

impl Reason {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Source => "source",
        }
    }
}

pub(super) async fn find<C: ConnectionTrait>(
    conn: &C,
    subject: &Subject<'_>,
) -> Result<Option<Candidate>, DeclareError> {
    infra::race_point!("declare.candidate_query");
    let cutoff = subject.window_start().saturating_sub(DEDUP_LOOKBACK_US);
    if let Some(fingerprint) = group_fingerprint(&serde_json::to_value(&subject.groups)?) {
        let scoped = service_candidates(conn, subject, &fingerprint, cutoff, true).await?;
        if scoped
            .as_ref()
            .is_some_and(|candidate| candidate.scope == ScopeMatch::Exact)
        {
            return Ok(scoped);
        }
        let context = context_candidate(conn, subject, cutoff, true).await?;
        if context.is_some() || scoped.is_some() {
            return Ok(context.or(scoped));
        }
        return service_candidates(conn, subject, &fingerprint, cutoff, false).await;
    }
    context_candidate(conn, subject, cutoff, false).await
}

pub(super) fn still_matches(
    candidate: &Candidate,
    incident: &Model,
    subject: &Subject<'_>,
) -> bool {
    if !open(incident) {
        return false;
    }
    match candidate.reason {
        Reason::Service => {
            same_service(incident, subject) && scope(incident, subject) == ScopeMatch::Exact
        }
        Reason::Source => {
            !subject.groups.contains_key("service")
                || (dimension(incident, &["service"]).is_none()
                    && scope(incident, subject) == ScopeMatch::Exact)
        }
    }
}

fn open(incident: &Model) -> bool {
    matches!(incident.status.as_str(), "open" | "acknowledged")
        && incident.merged_into_id.is_none()
        && !incident.security_case
}

fn dimension<'a>(incident: &'a Model, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| {
        incident
            .group_values
            .get(*key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("unknown"))
    })
}

fn same_service(incident: &Model, subject: &Subject<'_>) -> bool {
    let Some((stored, service)) =
        dimension(incident, &["service"]).zip(subject.groups.get("service"))
    else {
        return false;
    };
    let start = incident.impact_start_at.unwrap_or(incident.first_alert_at);
    let end = incident.impact_end_at.unwrap_or(subject.now);
    stored.to_lowercase() == *service
        && start <= subject.now
        && end >= subject.window_start().saturating_sub(DEDUP_LOOKBACK_US)
}

fn scope(incident: &Model, subject: &Subject<'_>) -> ScopeMatch {
    let requested = |name| subject.groups.get(name).map(String::as_str);
    let env = dimension(incident, &["environment", "env"]);
    let env_matches = match (env, requested("env")) {
        (Some(left), Some(right)) => left.to_lowercase() == right,
        (None, None) => true,
        _ => false,
    };
    let region_matches = dimension(incident, &["region"])
        .zip(requested("region"))
        .is_some_and(|(left, right)| left.to_lowercase() == right);
    if env_matches && region_matches {
        ScopeMatch::Exact
    } else {
        ScopeMatch::Possible
    }
}

async fn service_candidates<C: ConnectionTrait>(
    conn: &C,
    subject: &Subject<'_>,
    fingerprint: &str,
    cutoff: i64,
    same_env: bool,
) -> Result<Option<Candidate>, DeclareError> {
    let candidates = alert_incidents::declare_service_candidates(
        conn,
        subject.org,
        fingerprint,
        cutoff,
        subject.now,
        same_env,
    )
    .await?;
    let mut possible = None;
    for incident in candidates {
        if !same_service(&incident, subject) {
            continue;
        }
        let candidate = Candidate {
            scope: scope(&incident, subject),
            incident,
            reason: Reason::Service,
        };
        if candidate.scope == ScopeMatch::Exact {
            return Ok(Some(candidate));
        }
        if possible.is_none() {
            possible = Some(candidate);
        }
    }
    Ok(possible)
}

async fn context_candidate<C: ConnectionTrait>(
    conn: &C,
    subject: &Subject<'_>,
    cutoff: i64,
    service_request: bool,
) -> Result<Option<Candidate>, DeclareError> {
    let Some(target) = subject.source.map(|source| &source.target) else {
        return Ok(None);
    };
    if target.streams.is_empty() || target.fingerprint.is_none() {
        return Ok(None);
    }
    for context in
        incident_contexts::candidate_contexts(conn, subject.org, cutoff, subject.now).await?
    {
        let stored: ContextTarget = serde_json::from_str(&context.target)?;
        if target.streams != stored.streams || target.fingerprint != stored.fingerprint {
            continue;
        }
        let Some(incident) =
            alert_incidents::get_with(conn, subject.org, &context.incident_id).await?
        else {
            continue;
        };
        if !open(&incident)
            || (service_request
                && (dimension(&incident, &["service"]).is_some()
                    || scope(&incident, subject) != ScopeMatch::Exact))
        {
            continue;
        }
        return Ok(Some(Candidate {
            incident,
            scope: ScopeMatch::Exact,
            reason: Reason::Source,
        }));
    }
    Ok(None)
}
