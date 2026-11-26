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

//! The create branch of correlation: a firing that found no incident takes its lane's lock,
//! looks again under it, and opens an incident only if the second look also finds none.

use std::collections::HashMap;

use config::meta::alerts::incidents::KeyType;
use infra::table::{
    alert_incidents::{self as table, CaseActivity, CaseFilter, Opening},
    entity::alert_incidents::Model,
};
use sea_orm::TransactionTrait;

use super::{Correlation, CorrelationSubject};

/// The lookup a firing missed, which its create re-runs under the lock.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Lane {
    /// STEP 1: the open incident holding the alert's firings.
    Alert,
    /// The open ops incident the firing's dimensions match (STEP 2).
    Ops,
    /// A detection naming no entity: its open case within the window.
    DetectionCase { span: (i64, i64), window: i64 },
    /// The open case with exactly the firing's detection and entity, within the window.
    SiemCase { span: (i64, i64), window: i64 },
}

impl Lane {
    /// The lane `find_or_create_incident` looked up for this firing.
    pub(super) fn of(
        key_type: KeyType,
        subject: &CorrelationSubject<'_>,
        span: (i64, i64),
    ) -> Self {
        match (key_type, subject.siem_case_window) {
            (KeyType::AlertId, Some(window)) => Self::DetectionCase { span, window },
            (KeyType::AlertId, None) => Self::Alert,
            (_, Some(window)) => Self::SiemCase { span, window },
            (_, None) => Self::Ops,
        }
    }

    /// The advisory lock key: the coarsest key every candidate of the lane shares (I7).
    fn lock_key(self, org_id: &str, alert_id: &str) -> String {
        match self {
            Self::Alert => format!("incident_correlation/{org_id}/alert/{alert_id}"),
            Self::Ops => format!("incident_correlation/{org_id}/ops"),
            Self::DetectionCase { .. } | Self::SiemCase { .. } => {
                format!("incident_correlation/{org_id}/siem")
            }
        }
    }
}

/// The re-run lookup, and the incident the firing already found and could not join.
#[derive(Clone, Copy, Debug)]
pub(super) struct Recheck<'a> {
    pub lane: Lane,
    /// Incidents that already refused the firing: found again under the lock they are a miss.
    pub rejected: &'a [String],
}

/// An incident another firing opened between the first look and the lock.
#[derive(Debug)]
pub(super) enum Found {
    /// Joined as STEP 1 joins: by alert id or as a security case.
    Exact(Box<Model>),
    /// Joined as STEP 2 joins, by dimensions.
    Ops(Box<Model>),
}

impl Found {
    pub(super) fn id(&self) -> &str {
        match self {
            Self::Exact(incident) | Self::Ops(incident) => &incident.id,
        }
    }
}

/// What the create branch did.
pub(super) enum Opened {
    Correlated(Correlation),
    Found(Found),
}

/// The row a firing opens an incident with, prepared before any write starts.
pub(super) struct NewIncident<'a, 's> {
    pub org_id: &'a str,
    pub group_values: &'a HashMap<String, String>,
    pub key_type: KeyType,
    pub subject: &'a CorrelationSubject<'s>,
    pub triggered_at: i64,
    pub correlation_reason: &'a str,
    pub muted_by: Option<&'a str>,
    pub severity: String,
    pub title: String,
}

/// How a candidate's "alert was moved out of it" verdict is read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PairRead {
    /// Through the node's verdict memory, confirmed on the primary.
    Remembered,
    /// On the given connection: the write transaction must not ask for a second connection.
    OnConnection,
}

/// Opens the incident unless the lane's lookup, re-run under its lock, now finds one.
pub(super) async fn open_rechecked(
    new: &NewIncident<'_, '_>,
    recheck: Recheck<'_>,
    service_name: &str,
) -> Result<Opened, anyhow::Error> {
    let db = infra::db::get_orm_client_rw().await;
    let txn = db.begin().await?;
    let key = recheck.lane.lock_key(new.org_id, &new.subject.id);
    table::lock_correlation(&txn, &key).await?;
    let (subject, pairs) = (new.subject, PairRead::OnConnection);
    let found = look(
        &txn,
        new.org_id,
        new.group_values,
        subject,
        new.triggered_at,
        recheck.lane,
        pairs,
    );
    let refused = |f: &Found| recheck.rejected.iter().any(|id| id == f.id());
    if let Some(found) = found.await?.filter(|f| !refused(f)) {
        txn.rollback().await?;
        return Ok(Opened::Found(found));
    }
    let opening = insert_in(&txn, new).await?;
    match opening {
        Opening::Opened(_) => txn.commit().await?,
        _ => txn.rollback().await?,
    }
    let outcome = super::settle_opening(new, opening, service_name).await?;
    Ok(Opened::Correlated(Correlation::opened(outcome)))
}

/// Opens the incident with no lock and no second look, in its own transaction.
pub(super) async fn insert(new: &NewIncident<'_, '_>) -> Result<Opening, anyhow::Error> {
    let db = infra::db::get_orm_client_rw().await;
    let txn = db.begin().await?;
    let opening = insert_in(&txn, new).await?;
    match opening {
        Opening::Opened(_) => txn.commit().await?,
        _ => txn.rollback().await?,
    }
    Ok(opening)
}

/// The lane's lookup, for the first look and for the one under the lock alike. On the lock's
/// transaction nothing in it may take another connection, so pass `PairRead::OnConnection`.
pub(super) async fn look<C: sea_orm::ConnectionTrait>(
    client: &C,
    org_id: &str,
    group_values: &HashMap<String, String>,
    subject: &CorrelationSubject<'_>,
    triggered_at: i64,
    lane: Lane,
    pairs: PairRead,
) -> Result<Option<Found>, anyhow::Error> {
    let exact = match lane {
        Lane::Alert => {
            // An alert switched between SIEM and ops must not keep firing into the other kind.
            let cases = CaseFilter::of_kind(subject.security_case);
            table::find_open_incident_by_alert_id_with(client, org_id, &subject.id, cases).await?
        }
        Lane::DetectionCase { span, window } => {
            super::find_open_detection_case_with(client, org_id, &subject.id, span, window).await?
        }
        Lane::SiemCase { span, window } => {
            super::find_open_siem_case_with(client, org_id, group_values, span, window).await?
        }
        Lane::Ops => {
            let firing = (subject.id.as_str(), triggered_at);
            let ops = super::select_ops_incident(client, org_id, group_values, firing, pairs);
            return Ok(ops.await?.map(|incident| Found::Ops(Box::new(incident))));
        }
    };
    Ok(exact.map(|incident| Found::Exact(Box::new(incident))))
}

/// The incident row, its empty events row and its first firing, written in `txn`.
async fn insert_in<C: sea_orm::ConnectionTrait>(
    txn: &C,
    new: &NewIncident<'_, '_>,
) -> Result<Opening, anyhow::Error> {
    let subject = new.subject;
    let group_values = serde_json::to_value(new.group_values)?;
    let key_type = new.key_type.to_string();
    let title = Some(new.title.clone());
    let muted_by = new.muted_by.map(str::to_string);
    let alert = subject.first_alert(new.correlation_reason);
    if !subject.security_case {
        let opening = table::create_with_first_alert_in(
            txn,
            subject.incident_id.as_deref(),
            new.org_id,
            &new.severity,
            group_values,
            &key_type,
            new.triggered_at,
            title,
            muted_by,
            &alert,
        );
        let opening = opening.await?;
        if let Opening::Opened(incident) = &opening {
            infra::table::incident_events::open_empty_in(txn, new.org_id, &incident.id).await?;
        }
        return Ok(opening);
    }
    let span = subject.case_activity.unwrap_or(CaseActivity {
        first_event_at: new.triggered_at,
        last_event_at: new.triggered_at,
        historical: subject.historical,
    });
    let case = table::create_security_case_in(
        txn,
        new.org_id,
        &new.severity,
        group_values,
        &key_type,
        span,
        title,
        muted_by,
        (&alert, new.triggered_at, subject.case_activity),
    )
    .await?;
    infra::table::incident_events::open_empty_in(txn, new.org_id, &case.id).await?;
    Ok(Opening::Opened(Box::new(case)))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::meta::alerts::incidents::{AlertKind, IncidentEventType};
    use infra::table::entity::{alert_incident_alerts, alert_incidents};
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
    use tokio::sync::{Barrier, Notify};

    use super::{
        super::{FenceStep, TurnFence, find_or_create_incident},
        *,
    };

    const HOUR: i64 = 3_600_000_000;

    /// Holds a firing at its opening until both firings missed; `after` holds it until the other
    /// firing finished too, for a serial order.
    #[derive(Debug)]
    struct Gate {
        missed: Arc<Barrier>,
        after: Option<Arc<Notify>>,
    }

    impl Gate {
        /// A gate for one firing alone: nothing to wait for.
        fn open() -> Self {
            Self {
                missed: Arc::new(Barrier::new(1)),
                after: None,
            }
        }
    }

    #[async_trait::async_trait]
    impl TurnFence for Gate {
        async fn before(&self, step: FenceStep) -> anyhow::Result<()> {
            if step == FenceStep::Open {
                self.missed.wait().await;
                if let Some(other) = &self.after {
                    other.notified().await;
                }
            }
            Ok(())
        }
    }

    /// Which firing opens first once both missed; `Together` lets them race for the lock.
    #[derive(Clone, Copy, Debug)]
    enum Order {
        Together,
        FirstThenSecond,
        SecondThenFirst,
    }

    /// The global meta store CI configures through `ZO_META_STORE`, migrated once per binary.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            std::fs::create_dir_all(&config::get_config().common.data_db_dir).unwrap();
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
        true
    }

    fn subject(lane: Lane, id: &str, at: i64, fence: Arc<Gate>) -> CorrelationSubject<'static> {
        let security = matches!(lane, Lane::DetectionCase { .. } | Lane::SiemCase { .. });
        CorrelationSubject {
            id: id.to_string(),
            name: id.to_string(),
            org_id: String::new(),
            kind: AlertKind::Internal,
            base_destinations: Vec::new(),
            severity: None,
            evaluated_severity: None,
            title_inputs: None,
            labels: None,
            case_title: None,
            siem_case_window: security.then_some(2 * HOUR),
            security_case: security,
            historical: false,
            case_activity: security.then_some(CaseActivity {
                first_event_at: at,
                last_event_at: at,
                historical: false,
            }),
            case_entity: None,
            incident_id: None,
            fence: Some(fence),
            entity_case: None,
            detection: None,
        }
    }

    /// Two firings of one correlation key: their alert ids, key type and dimensions.
    fn firings(lane: Lane) -> ([&'static str; 2], KeyType, HashMap<String, String>) {
        let dims = |pairs: &[(&str, &str)]| {
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect()
        };
        match lane {
            Lane::Alert => (["a1", "a1"], KeyType::AlertId, HashMap::new()),
            Lane::Ops => (
                ["checkout_5xx", "checkout_p95"],
                KeyType::Primary,
                dims(&[("service", "checkout"), ("k8s-namespace", "shop")]),
            ),
            Lane::DetectionCase { .. } => (["spray", "spray"], KeyType::AlertId, HashMap::new()),
            Lane::SiemCase { .. } => (
                ["spray", "spray"],
                KeyType::Primary,
                dims(&[
                    ("security_ip", "185.220.101.47"),
                    ("security_detection", "sigma:spray"),
                ]),
            ),
        }
    }

    /// Runs both firings past their missed lookups in `order`; returns each one's incident id.
    async fn race(org: &str, lane: Lane, order: Order) -> [(String, bool); 2] {
        let ([first_id, second_id], key_type, dims) = firings(lane);
        let missed = Arc::new(Barrier::new(2));
        let (first_done, second_done) = (Arc::new(Notify::new()), Arc::new(Notify::new()));
        let (first_after, second_after) = match order {
            Order::Together => (None, None),
            Order::FirstThenSecond => (None, Some(first_done.clone())),
            Order::SecondThenFirst => (Some(second_done.clone()), None),
        };
        let gate = |after| {
            Arc::new(Gate {
                missed: missed.clone(),
                after,
            })
        };
        let first = subject(lane, first_id, HOUR, gate(first_after));
        let second = subject(lane, second_id, HOUR + 1, gate(second_after));
        let (a, b) = tokio::join!(
            fire(org, &dims, key_type, &first, (HOUR, first_done)),
            fire(org, &dims, key_type, &second, (HOUR + 1, second_done)),
        );
        [a, b]
    }

    /// One firing through the real correlation; `done` is told when it has finished.
    async fn fire(
        org: &str,
        dims: &HashMap<String, String>,
        key_type: KeyType,
        subject: &CorrelationSubject<'_>,
        (at, done): (i64, Arc<Notify>),
    ) -> (String, bool) {
        let found = find_or_create_incident(org, dims, key_type, subject, at, "t", "s", None, None)
            .await
            .unwrap();
        done.notify_one();
        (found.outcome.incident_id().to_string(), found.created)
    }

    /// F21: one correlation key's two first firings open one incident on every lane, every order.
    #[tokio::test]
    async fn correlate_first_evaluation_race_opens_one_incident() {
        if !meta_store().await {
            return;
        }
        crate::alerts::rca_runs::tests::rca_off();
        let window = 2 * HOUR;
        let span = (HOUR, HOUR);
        let lanes = [
            Lane::Alert,
            Lane::Ops,
            Lane::DetectionCase { span, window },
            Lane::SiemCase { span, window },
        ];
        let orders = [
            Order::Together,
            Order::FirstThenSecond,
            Order::SecondThenFirst,
        ];
        for lane in lanes {
            for order in orders {
                let org = format!("f21_{}", config::ider::uuid());
                let [(a, a_created), (b, b_created)] = race(&org, lane, order).await;
                let case = format!("{lane:?} {order:?}");
                assert_eq!(a, b, "{case}: both firings land in one incident");
                assert!(
                    a_created ^ b_created,
                    "{case}: exactly one firing opened it"
                );
                let db = infra::db::get_orm_client_rw().await;
                let rows = alert_incidents::Entity::find()
                    .filter(alert_incidents::Column::OrgId.eq(org.as_str()))
                    .all(db)
                    .await
                    .unwrap();
                assert_eq!(rows.len(), 1, "{case}: one incident in the org");
                let links = alert_incident_alerts::Entity::find()
                    .filter(alert_incident_alerts::Column::IncidentId.eq(a.as_str()))
                    .all(db)
                    .await
                    .unwrap();
                assert_eq!(links.len(), 2, "{case}: both firings are linked");
                let events = infra::table::incident_events::get_rw(&org, &a)
                    .await
                    .unwrap();
                let created = events
                    .iter()
                    .filter(|e| matches!(e.event_type, IncidentEventType::Created))
                    .count();
                assert_eq!(
                    created, 1,
                    "{case}: the joiner's event did not take the timeline"
                );
            }
        }
    }

    /// An incident that already refused the firing is a miss under the lock; any other is found.
    #[tokio::test]
    async fn a_refused_incident_found_under_the_lock_is_a_miss() {
        use infra::table::alert_incidents::{add_alert_to_incident, create};

        if !meta_store().await {
            return;
        }
        crate::alerts::rca_runs::tests::rca_off();
        let org = format!("f21_refused_{}", config::ider::uuid());
        let existing = create(&org, "P2", serde_json::json!({}), "AlertId", HOUR, None)
            .await
            .unwrap();
        add_alert_to_incident(&existing.id, "a1", "a1", "internal", HOUR, "t")
            .await
            .unwrap();
        let mut firing = subject(Lane::Alert, "a1", HOUR + 1, Arc::new(Gate::open()));
        firing.fence = None;
        let dims = HashMap::new();
        let new = NewIncident {
            org_id: &org,
            group_values: &dims,
            key_type: KeyType::AlertId,
            subject: &firing,
            triggered_at: HOUR + 1,
            correlation_reason: "t",
            muted_by: None,
            severity: "P2".to_string(),
            title: "t".to_string(),
        };
        let lane = Lane::Alert;
        let found = open_rechecked(
            &new,
            Recheck {
                lane,
                rejected: &[],
            },
            "s",
        )
        .await;
        let found = match found.unwrap() {
            Opened::Found(found) => found.id().to_string(),
            Opened::Correlated(_) => String::new(),
        };
        assert_eq!(
            found, existing.id,
            "an open incident holding the alert is found"
        );
        let refused = [existing.id.clone()];
        let opened = open_rechecked(
            &new,
            Recheck {
                lane,
                rejected: &refused,
            },
            "s",
        )
        .await;
        let Opened::Correlated(opened) = opened.unwrap() else {
            panic!("the refused incident was found again under the lock");
        };
        assert!(opened.created);
        assert_ne!(opened.outcome.incident_id(), existing.id);
    }

    /// A firing its alert's stored verdict moved out of the matching incident opens its own, once.
    #[tokio::test]
    async fn a_separated_firing_opens_its_own_incident_once() {
        use infra::table::{
            alert_incidents::{add_alert_to_incident, create},
            entity::alert_pair_verdicts,
            incident_membership::{SEPARATE, pair_key, put_pair},
        };

        if !meta_store().await {
            return;
        }
        crate::alerts::rca_runs::tests::rca_off();
        let org = format!("f21_separated_{}", config::ider::uuid());
        let (_, _, dims) = firings(Lane::Ops);
        let stored = serde_json::to_value(&dims).unwrap();
        let existing = create(&org, "P2", stored, "Primary", HOUR, None)
            .await
            .unwrap();
        add_alert_to_incident(&existing.id, "opener", "opener", "internal", HOUR, "t")
            .await
            .unwrap();
        let (alert_a, alert_b) = pair_key("opener", "moved");
        put_pair(alert_pair_verdicts::Model {
            org_id: org.clone(),
            alert_a,
            alert_b,
            verdict: SEPARATE.to_string(),
            reason: "moved out".to_string(),
            decided_by: "rule".to_string(),
            signal: None,
            expires_at: config::utils::time::now_micros() + HOUR,
        })
        .await
        .unwrap();
        let mut firing = subject(Lane::Ops, "moved", HOUR + 1, Arc::new(Gate::open()));
        firing.fence = None;
        let primary = KeyType::Primary;
        let at = HOUR + 1;
        let opened =
            find_or_create_incident(&org, &dims, primary, &firing, at, "t", "s", None, None)
                .await
                .unwrap();
        assert!(opened.created, "the firing opens its own incident");
        assert_ne!(opened.outcome.incident_id(), existing.id);
        let db = infra::db::get_orm_client_rw().await;
        let rows = alert_incidents::Entity::find()
            .filter(alert_incidents::Column::OrgId.eq(org.as_str()))
            .all(db)
            .await
            .unwrap();
        assert_eq!(rows.len(), 2, "one incident of its own, no more");
        let moved_into_existing = alert_incident_alerts::Entity::find()
            .filter(alert_incident_alerts::Column::IncidentId.eq(existing.id.as_str()))
            .filter(alert_incident_alerts::Column::AlertId.eq("moved"))
            .all(db)
            .await
            .unwrap();
        assert!(
            moved_into_existing.is_empty(),
            "the refused incident never takes it"
        );
    }
}
