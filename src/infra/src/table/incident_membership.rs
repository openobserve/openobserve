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

//! The per-org memory of alert pairs and the incident reads the membership check needs.

use std::collections::HashMap;

use config::meta::alerts::incidents::AlertKind;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    sea_query::OnConflict,
};

use super::entity::{
    alert_incident_alerts, alert_incidents, alert_pair_verdicts, oncall_responses,
    service_version_deploys,
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::{self, DbError, Error},
};

/// The pair verdict a move out stores: the alert does not rejoin incidents the opener starts.
pub const SEPARATE: &str = "separate";
/// Two lists of this many bound values stay far under SQLite's 32,766 per statement.
const OPENERS_CHUNK: usize = 1_000;

/// The unordered pair key: the lesser id first.
pub fn pair_key(x: &str, y: &str) -> (String, String) {
    if x <= y {
        (x.to_string(), y.to_string())
    } else {
        (y.to_string(), x.to_string())
    }
}

pub async fn get_pair(
    org_id: &str,
    x: &str,
    y: &str,
) -> Result<Option<alert_pair_verdicts::Model>, errors::Error> {
    let (a, b) = pair_key(x, y);
    Ok(
        alert_pair_verdicts::Entity::find_by_id((org_id.to_string(), a, b))
            .one(get_orm_client_rw().await)
            .await?,
    )
}

/// Every unexpired remembered pair of the org, from the primary: a replica may lack a new choice.
pub async fn list_pairs(
    org_id: &str,
    now: i64,
) -> Result<Vec<alert_pair_verdicts::Model>, errors::Error> {
    Ok(alert_pair_verdicts::Entity::find()
        .filter(alert_pair_verdicts::Column::OrgId.eq(org_id))
        .filter(alert_pair_verdicts::Column::ExpiresAt.gt(now))
        .all(get_orm_client_rw().await)
        .await?)
}

/// Deletes every org's pairs that expired before `now`; reads already skip them.
pub async fn purge_expired_pairs<C: ConnectionTrait>(
    conn: &C,
    now: i64,
) -> Result<u64, errors::Error> {
    Ok(alert_pair_verdicts::Entity::delete_many()
        .filter(alert_pair_verdicts::Column::ExpiresAt.lte(now))
        .exec(conn)
        .await?
        .rows_affected)
}

pub async fn put_pair(row: alert_pair_verdicts::Model) -> Result<(), errors::Error> {
    put_pair_with(get_orm_client_rw().await, row).await
}

pub async fn put_pair_with<C: ConnectionTrait>(
    conn: &C,
    row: alert_pair_verdicts::Model,
) -> Result<(), errors::Error> {
    use alert_pair_verdicts::Column as C;
    if row.alert_a > row.alert_b {
        return Err(Error::DbError(DbError::SeaORMError(
            "alert pair is not ordered".to_string(),
        )));
    }
    let active = alert_pair_verdicts::ActiveModel {
        org_id: Set(row.org_id),
        alert_a: Set(row.alert_a),
        alert_b: Set(row.alert_b),
        verdict: Set(row.verdict),
        reason: Set(row.reason),
        decided_by: Set(row.decided_by),
        signal: Set(row.signal),
        expires_at: Set(row.expires_at),
    };
    alert_pair_verdicts::Entity::insert(active)
        .on_conflict(
            OnConflict::columns([C::OrgId, C::AlertA, C::AlertB])
                .update_columns([C::Verdict, C::Reason, C::DecidedBy, C::Signal, C::ExpiresAt])
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;
    Ok(())
}

/// Whether `alert_id` was moved out of incidents this one's opener started (unexpired); read in
/// the join's transaction after it locked the incident row.
pub async fn separated_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    incident_id: &str,
    alert_id: &str,
) -> Result<bool, errors::Error> {
    let Some(opener) = opener_with(conn, incident_id).await? else {
        return Ok(false);
    };
    if opener == alert_id {
        return Ok(false);
    }
    let (a, b) = pair_key(&opener, alert_id);
    let now = chrono::Utc::now().timestamp_micros();
    Ok(
        alert_pair_verdicts::Entity::find_by_id((org_id.to_string(), a, b))
            .one(conn)
            .await?
            .is_some_and(|pair| pair.verdict == SEPARATE && pair.expires_at > now),
    )
}

/// The incident's opener: the alert of its earliest firing.
pub async fn opener_of(incident_id: &str) -> Result<Option<String>, errors::Error> {
    opener_with(get_orm_client_rw().await, incident_id).await
}

async fn opener_with<C: ConnectionTrait>(
    conn: &C,
    incident_id: &str,
) -> Result<Option<String>, errors::Error> {
    Ok(alert_incident_alerts::Entity::find()
        .select_only()
        .column(alert_incident_alerts::Column::AlertId)
        .filter(alert_incident_alerts::Column::IncidentId.eq(incident_id))
        .order_by_asc(alert_incident_alerts::Column::AlertFiredAt)
        .order_by_asc(alert_incident_alerts::Column::AlertId)
        .into_tuple()
        .one(conn)
        .await?)
}

/// Each incident's opening alert, the one whose firing paged; AutoObserve's own have none.
pub async fn openers_of(incident_ids: &[String]) -> Result<HashMap<String, String>, errors::Error> {
    openers_with(get_orm_client_ro().await, incident_ids).await
}

pub async fn openers_with<C: ConnectionTrait>(
    conn: &C,
    incident_ids: &[String],
) -> Result<HashMap<String, String>, errors::Error> {
    use alert_incident_alerts::{Column, Entity};
    let mut out = HashMap::new();
    for chunk in incident_ids.chunks(OPENERS_CHUNK) {
        let firsts: HashMap<String, i64> = Entity::find()
            .select_only()
            .column(Column::IncidentId)
            .column_as(Column::AlertFiredAt.min(), "first_at")
            .filter(Column::IncidentId.is_in(chunk.iter().map(String::as_str)))
            .group_by(Column::IncidentId)
            .into_tuple()
            .all(conn)
            .await?
            .into_iter()
            .collect();
        let rows: Vec<(String, String, String, i64)> = Entity::find()
            .select_only()
            .column(Column::IncidentId)
            .column(Column::AlertId)
            .column(Column::AlertKind)
            .column(Column::AlertFiredAt)
            .filter(Column::IncidentId.is_in(chunk.iter().map(String::as_str)))
            .filter(Column::AlertFiredAt.is_in(firsts.values().copied()))
            .order_by_asc(Column::AlertId)
            .into_tuple()
            .all(conn)
            .await?;
        for (incident, alert, kind, fired_at) in rows {
            if firsts.get(&incident) == Some(&fired_at) {
                out.entry(incident).or_insert((alert, kind));
            }
        }
    }
    let autoobserve = AlertKind::AutoObserve.as_str();
    Ok(out
        .into_iter()
        .filter(|(_, (_, kind))| kind != autoobserve)
        .map(|(incident, (alert, _))| (incident, alert))
        .collect())
}

/// The org's incidents the alert fired into that were still open at `since`; a resolved one can't
/// page, and a reopened one has no resolved time.
pub async fn incidents_open_since_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    alert_id: &str,
    since: i64,
) -> Result<Vec<String>, errors::Error> {
    use sea_orm::{Condition, JoinType, RelationTrait};
    let open = Condition::any()
        .add(alert_incidents::Column::ResolvedAt.is_null())
        .add(alert_incidents::Column::ResolvedAt.gte(since));
    Ok(alert_incident_alerts::Entity::find()
        .select_only()
        .column(alert_incident_alerts::Column::IncidentId)
        .join(
            JoinType::InnerJoin,
            alert_incident_alerts::Relation::Incident.def(),
        )
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .filter(alert_incident_alerts::Column::AlertId.eq(alert_id))
        .filter(open)
        .distinct()
        .into_tuple()
        .all(conn)
        .await?)
}

/// Fire times of the alert's firings in the org's incidents over `[since, until)`, oldest first.
pub async fn firing_times(
    org_id: &str,
    alert_id: &str,
    since: i64,
    until: i64,
) -> Result<Vec<i64>, errors::Error> {
    use sea_orm::{JoinType, RelationTrait};
    let times: Vec<i64> = alert_incident_alerts::Entity::find()
        .select_only()
        .column(alert_incident_alerts::Column::AlertFiredAt)
        .join(
            JoinType::InnerJoin,
            alert_incident_alerts::Relation::Incident.def(),
        )
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .filter(alert_incident_alerts::Column::AlertId.eq(alert_id))
        .filter(alert_incident_alerts::Column::AlertFiredAt.gte(since))
        .filter(alert_incident_alerts::Column::AlertFiredAt.lt(until))
        .order_by_asc(alert_incident_alerts::Column::AlertFiredAt)
        .into_tuple()
        .all(get_orm_client_ro().await)
        .await?;
    Ok(times)
}

/// The labels of the alert's latest firing in the incident that has them.
pub async fn latest_labels(
    incident_id: &str,
    alert_id: &str,
) -> Result<Option<String>, errors::Error> {
    let labels: Option<Option<String>> = alert_incident_alerts::Entity::find()
        .select_only()
        .column(alert_incident_alerts::Column::Labels)
        .filter(alert_incident_alerts::Column::IncidentId.eq(incident_id))
        .filter(alert_incident_alerts::Column::AlertId.eq(alert_id))
        .filter(alert_incident_alerts::Column::Labels.is_not_null())
        .order_by_desc(alert_incident_alerts::Column::AlertFiredAt)
        .into_tuple()
        .one(get_orm_client_rw().await)
        .await?;
    Ok(labels.flatten())
}

/// The on-call cause of each earlier incident holding both alerts, newest first.
pub async fn past_causes(
    org_id: &str,
    x: &str,
    y: &str,
    exclude: &str,
    limit: u64,
) -> Result<Vec<Option<String>>, errors::Error> {
    let db = get_orm_client_ro().await;
    let holding = |alert: &str| {
        alert_incident_alerts::Entity::find()
            .select_only()
            .column(alert_incident_alerts::Column::IncidentId)
            .filter(alert_incident_alerts::Column::AlertId.eq(alert.to_string()))
            .into_query()
    };
    use sea_orm::QueryTrait;
    let ids: Vec<String> = alert_incidents::Entity::find()
        .select_only()
        .column(alert_incidents::Column::Id)
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .filter(alert_incidents::Column::Id.ne(exclude))
        .filter(alert_incidents::Column::Id.in_subquery(holding(x)))
        .filter(alert_incidents::Column::Id.in_subquery(holding(y)))
        .order_by_desc(alert_incidents::Column::FirstAlertAt)
        .limit(limit)
        .into_tuple()
        .all(db)
        .await?;
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let causes: Vec<(Option<String>, Option<String>)> = oncall_responses::Entity::find()
        .select_only()
        .column(oncall_responses::Column::IncidentId)
        .column(oncall_responses::Column::Cause)
        .filter(oncall_responses::Column::OrgId.eq(org_id))
        .filter(oncall_responses::Column::IncidentId.is_in(ids.clone()))
        .filter(oncall_responses::Column::Cause.is_not_null())
        .into_tuple()
        .all(db)
        .await?;
    let by_incident: HashMap<String, String> = causes
        .into_iter()
        .filter_map(|(id, cause)| Some((id?, cause?)))
        .collect();
    Ok(ids.iter().map(|id| by_incident.get(id).cloned()).collect())
}

/// Deploys of the service (in the cluster when known) over `[since, until]`.
pub async fn deploys_between(
    org_id: &str,
    service: &str,
    cluster: Option<&str>,
    since: i64,
    until: i64,
) -> Result<Vec<service_version_deploys::Model>, errors::Error> {
    let mut query = service_version_deploys::Entity::find()
        .filter(service_version_deploys::Column::OrgId.eq(org_id))
        .filter(service_version_deploys::Column::ServiceName.eq(service))
        .filter(service_version_deploys::Column::At.gte(since))
        .filter(service_version_deploys::Column::At.lte(until));
    if let Some(cluster) = cluster {
        query = query.filter(service_version_deploys::Column::Cluster.eq(cluster));
    }
    Ok(query
        .order_by_desc(service_version_deploys::Column::At)
        .limit(3)
        .all(get_orm_client_ro().await)
        .await?)
}

pub async fn delete_by_org(org_id: &str) -> Result<(), errors::Error> {
    alert_pair_verdicts::Entity::delete_many()
        .filter(alert_pair_verdicts::Column::OrgId.eq(org_id))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, Schema};

    use super::*;

    #[tokio::test]
    async fn the_purge_deletes_only_expired_pairs() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let table = Schema::new(backend).create_table_from_entity(alert_pair_verdicts::Entity);
        db.execute(backend.build(&table)).await.unwrap();
        for (joiner, expires_at) in [("expired", 99), ("due", 100), ("live", 101)] {
            let row = alert_pair_verdicts::Model {
                org_id: "o".to_string(),
                alert_a: "a".to_string(),
                alert_b: joiner.to_string(),
                verdict: SEPARATE.to_string(),
                reason: "r".to_string(),
                decided_by: "rule".to_string(),
                signal: None,
                expires_at,
            };
            put_pair_with(&db, row).await.unwrap();
        }
        assert_eq!(purge_expired_pairs(&db, 100).await.unwrap(), 2);
        let left: Vec<String> = alert_pair_verdicts::Entity::find()
            .all(&db)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.alert_b)
            .collect();
        assert_eq!(left, ["live"]);
    }
}
