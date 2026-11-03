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

//! The downtime decision of a real-time alert, made per row before any row cap, so a muted
//! service never hides an unmuted one in the same request.

use std::collections::{HashMap, HashSet};

use config::{
    meta::{
        alerts::{alert::Alert, level::PAYLOAD_SAMPLE_ROWS},
        downtimes::ActiveDowntime,
    },
    utils::json::{Map, Value},
};

use super::{RealtimeMute, TriggerAlertData};

const ROW_CAP: usize = PAYLOAD_SAMPLE_ROWS as usize;

type Row = Map<String, Value>;
type Dims = HashMap<String, String>;

/// One group's decision, kept so every row of the group gets the answer its first row got.
#[derive(Clone)]
enum Group {
    /// The first row had no identity; the empty bucket decides it at the end.
    Empty,
    Decided(Option<ActiveDowntime>),
}

/// The rows of one alert in one request, split by their downtime decision.
#[derive(Default)]
pub(crate) struct RowSplit {
    unmuted: Vec<Row>,
    /// Rows with no identity share one identity, so they share one decision at [Self::finish].
    empty: Vec<Row>,
    empty_count: usize,
    muted: Option<ActiveDowntime>,
    muted_count: usize,
    muted_sample: Option<Row>,
    /// Whether any row (a multi-alert: any group's first row) had an identity.
    any_identity: bool,
    groups: HashMap<String, Group>,
    seen: HashSet<u64>,
}

/// What a request's rows of one alert come to.
#[derive(Debug, PartialEq)]
pub(crate) enum Verdict {
    /// The unmuted rows, at most [ROW_CAP].
    Deliver(Vec<Row>),
    Suppress {
        downtime: ActiveDowntime,
        muted_rows: usize,
        sample: Row,
    },
    Nothing,
}

impl RowSplit {
    /// Whether a series with this signature was already taken, so its evaluation can be skipped.
    pub(crate) fn seen(&self, signature: u64) -> bool {
        self.seen.contains(&signature)
    }

    /// Files one matching row; `group` is its multi-alert group key, `None` for a plain alert.
    pub(crate) fn push(
        &mut self,
        row: Row,
        group: Option<String>,
        signature: Option<u64>,
        dims_of: impl FnOnce(&Row) -> Dims,
        active_for: impl FnOnce(&Dims) -> Option<ActiveDowntime>,
    ) {
        if let Some(signature) = signature
            && !self.seen.insert(signature)
        {
            return;
        }
        let decision = match group {
            Some(key) => match self.groups.get(&key) {
                Some(group) => group.clone(),
                None => {
                    let group = self.classify(&row, dims_of, active_for);
                    self.groups.insert(key, group.clone());
                    group
                }
            },
            None => self.classify(&row, dims_of, active_for),
        };
        match decision {
            Group::Empty => {
                self.empty_count += 1;
                if self.empty.len() < ROW_CAP {
                    self.empty.push(row);
                }
            }
            Group::Decided(None) => {
                if self.unmuted.len() < ROW_CAP {
                    self.unmuted.push(row);
                }
            }
            Group::Decided(Some(downtime)) => self.mute(downtime, 1, row),
        }
    }

    fn classify(
        &mut self,
        row: &Row,
        dims_of: impl FnOnce(&Row) -> Dims,
        active_for: impl FnOnce(&Dims) -> Option<ActiveDowntime>,
    ) -> Group {
        let dims = dims_of(row);
        if dims.is_empty() {
            return Group::Empty;
        }
        self.any_identity = true;
        Group::Decided(active_for(&dims))
    }

    fn mute(&mut self, downtime: ActiveDowntime, rows: usize, sample: Row) {
        self.muted_count += rows;
        self.muted_sample.get_or_insert(sample);
        self.muted = Some(match self.muted.take() {
            Some(merged) => merge(merged, downtime),
            None => downtime,
        });
    }

    /// The row the service-discovery fallback reads: the first matching row, and only when no
    /// row had an identity, as `downtime_identities_by_key` decides for a scheduled run.
    pub(crate) fn fallback_row(&self) -> Option<&Row> {
        (!self.any_identity).then(|| self.empty.first()).flatten()
    }

    /// Decides the empty bucket with `empty_identity`, then the whole alert.
    pub(crate) fn finish(
        mut self,
        empty_identity: Dims,
        active_for: impl FnOnce(&Dims) -> Option<ActiveDowntime>,
    ) -> Verdict {
        if self.empty_count > 0 {
            let empty = std::mem::take(&mut self.empty);
            match active_for(&empty_identity) {
                Some(downtime) => {
                    let count = self.empty_count;
                    if let Some(sample) = empty.into_iter().next() {
                        self.mute(downtime, count, sample);
                    }
                }
                None => {
                    let room = ROW_CAP.saturating_sub(self.unmuted.len());
                    self.unmuted.extend(empty.into_iter().take(room));
                }
            }
        }
        if !self.unmuted.is_empty() {
            return Verdict::Deliver(self.unmuted);
        }
        match (self.muted, self.muted_sample) {
            (Some(downtime), Some(sample)) => Verdict::Suppress {
                downtime,
                muted_rows: self.muted_count,
                sample,
            },
            _ => Verdict::Nothing,
        }
    }
}

#[cfg(feature = "enterprise")]
fn merge(a: ActiveDowntime, b: ActiveDowntime) -> ActiveDowntime {
    crate::alerts::downtimes::enterprise::merged(a, b)
}

#[cfg(not(feature = "enterprise"))]
fn merge(a: ActiveDowntime, _b: ActiveDowntime) -> ActiveDowntime {
    a
}

/// What a row needs to be classified: the alert's id, folder and identity rules.
#[cfg(feature = "enterprise")]
struct Scope {
    alert_id: String,
    folder_id: String,
    semantic_groups: Vec<config::meta::correlation::FieldAlias>,
    /// A multi-alert's group-by, so rows of one group share a decision.
    group_by: Option<Vec<String>>,
}

struct AlertEntry {
    alert: Alert,
    /// `None` when the alert has no id or no cached folder; its rows are then unmuted, as
    /// `realtime_downtime` decides for them.
    #[cfg(feature = "enterprise")]
    scope: Option<Scope>,
    rows: RowSplit,
}

/// Per request: every matching row of every real-time alert, classified as it arrives.
pub struct RealtimeMuteSplit {
    org: String,
    now: i64,
    alerts: HashMap<String, AlertEntry>,
    order: Vec<String>,
}

impl RealtimeMuteSplit {
    /// `None` unless the org has an alert downtime; other orgs keep the first-row path.
    pub fn for_org(org: &str) -> Option<Self> {
        crate::alerts::downtimes::any_for(org, config::meta::downtimes::TargetModule::Alerts).then(
            || Self {
                org: org.to_string(),
                now: config::utils::time::now_micros(),
                alerts: HashMap::new(),
                order: Vec::new(),
            },
        )
    }

    /// Whether `key` already took a series with this signature.
    pub fn seen(&self, key: &str, signature: u64) -> bool {
        self.alerts
            .get(key)
            .is_some_and(|entry| entry.rows.seen(signature))
    }

    /// Files the matching rows of `alert`, keyed as the caller keys its alerts.
    pub async fn push(&mut self, key: &str, alert: &Alert, rows: Vec<Row>, signature: Option<u64>) {
        if !self.alerts.contains_key(key) {
            let entry = AlertEntry {
                alert: alert.clone(),
                #[cfg(feature = "enterprise")]
                scope: scope(&self.org, alert).await,
                rows: RowSplit::default(),
            };
            self.alerts.insert(key.to_string(), entry);
            self.order.push(key.to_string());
        }
        let entry = self.alerts.get_mut(key).expect("inserted above");
        for row in rows {
            push_row(&self.org, self.now, entry, row, signature);
        }
    }

    /// The alerts with a verdict, ready for `evaluate_trigger`.
    pub async fn finish(mut self) -> TriggerAlertData {
        let mut out = Vec::with_capacity(self.order.len());
        for key in self.order {
            let Some(entry) = self.alerts.remove(&key) else {
                continue;
            };
            let verdict = finish_entry(&self.org, self.now, entry.alert.clone(), entry).await;
            out.extend(verdict);
        }
        out
    }
}

#[cfg(feature = "enterprise")]
async fn scope(org: &str, alert: &Alert) -> Option<Scope> {
    let alert_id = alert.id.as_ref()?.to_string();
    let (folder, _) = crate::db::alerts::alert::get_alert_from_cache(org, &alert_id).await?;
    let group_by = alert
        .query_condition
        .multi_alert_enabled()
        .then(|| crate::alerts::scheduler::handlers::alert_group_by(alert));
    Some(Scope {
        alert_id,
        folder_id: folder.folder_id,
        semantic_groups: crate::db::system_settings::get_semantic_field_groups(org).await,
        group_by,
    })
}

#[cfg(feature = "enterprise")]
fn push_row(org: &str, now: i64, entry: &mut AlertEntry, row: Row, signature: Option<u64>) {
    let alert = &entry.alert;
    let Some(scope) = &entry.scope else {
        entry
            .rows
            .push(row, None, signature, |_| Dims::new(), |_| None);
        return;
    };
    let group = scope.group_by.as_ref().map(|group_by| {
        crate::alerts::scheduler::handlers::downtime_row_key(alert, group_by, &row)
    });
    entry.rows.push(
        row,
        group,
        signature,
        |row| {
            o2_enterprise::enterprise::oncall::routing::dimensions_for_alert(
                &scope.semantic_groups,
                &alert.query_condition,
                row,
            )
        },
        |dims| {
            crate::alerts::downtimes::active_for_alert(
                org,
                &scope.alert_id,
                &scope.folder_id,
                dims,
                now,
            )
        },
    );
}

#[cfg(not(feature = "enterprise"))]
fn push_row(_org: &str, _now: i64, entry: &mut AlertEntry, row: Row, signature: Option<u64>) {
    entry
        .rows
        .push(row, None, signature, |_| Dims::new(), |_| None);
}

#[cfg(feature = "enterprise")]
async fn finish_entry(org: &str, now: i64, alert: Alert, entry: AlertEntry) -> TriggerAlertData {
    let mut empty_identity = Dims::new();
    if let Some(row) = entry.rows.fallback_row()
        && let Some(service) =
            crate::alerts::incidents::correlated_service_for_routing(org, row).await
    {
        empty_identity.insert(config::meta::oncall::SERVICE_DIMENSION.to_string(), service);
    }
    let verdict = match &entry.scope {
        Some(scope) => entry.rows.finish(empty_identity, |dims| {
            crate::alerts::downtimes::active_for_alert(
                org,
                &scope.alert_id,
                &scope.folder_id,
                dims,
                now,
            )
        }),
        None => entry.rows.finish(empty_identity, |_| None),
    };
    into_trigger(alert, verdict)
}

#[cfg(not(feature = "enterprise"))]
async fn finish_entry(_org: &str, _now: i64, alert: Alert, entry: AlertEntry) -> TriggerAlertData {
    into_trigger(alert, entry.rows.finish(Dims::new(), |_| None))
}

fn into_trigger(alert: Alert, verdict: Verdict) -> TriggerAlertData {
    match verdict {
        Verdict::Deliver(rows) => vec![(alert, rows, RealtimeMute::Unmuted)],
        Verdict::Suppress {
            downtime, sample, ..
        } => vec![(alert, vec![sample], RealtimeMute::Muted(downtime))],
        Verdict::Nothing => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(service: &str) -> Row {
        let mut row = Row::new();
        if !service.is_empty() {
            row.insert("service".to_string(), Value::String(service.to_string()));
        }
        row
    }

    fn dims_of(row: &Row) -> Dims {
        row.get("service")
            .and_then(|v| v.as_str())
            .map(|s| Dims::from([("service".to_string(), s.to_string())]))
            .unwrap_or_default()
    }

    fn downtime(id: &str) -> ActiveDowntime {
        ActiveDowntime {
            id: id.to_string(),
            ..Default::default()
        }
    }

    /// A downtime on `service=a`, the way `active_for_alert` answers.
    fn mutes_a(dims: &Dims) -> Option<ActiveDowntime> {
        (dims.get("service").map(String::as_str) == Some("a")).then(|| downtime("dt-a"))
    }

    fn mutes_all(_: &Dims) -> Option<ActiveDowntime> {
        Some(downtime("dt-all"))
    }

    fn split(
        rows: &[&str],
        groups: Option<&[&str]>,
        active: fn(&Dims) -> Option<ActiveDowntime>,
    ) -> RowSplit {
        let mut split = RowSplit::default();
        for (i, service) in rows.iter().enumerate() {
            let group = groups.map(|g| g[i].to_string());
            split.push(row(service), group, None, dims_of, active);
        }
        split
    }

    fn delivered(verdict: &Verdict) -> Vec<String> {
        match verdict {
            Verdict::Deliver(rows) => rows
                .iter()
                .map(|r| dims_of(r).get("service").cloned().unwrap_or_default())
                .collect(),
            other => panic!("expected a delivery, got {other:?}"),
        }
    }

    #[test]
    fn a_muted_row_never_hides_an_unmuted_one_in_either_order() {
        for rows in [["a", "b"], ["b", "a"]] {
            let verdict = split(&rows, None, mutes_a).finish(Dims::new(), mutes_a);
            assert_eq!(delivered(&verdict), ["b"]);
        }
    }

    #[test]
    fn only_muted_rows_suppress_with_the_downtime() {
        let verdict = split(&["a", "a"], None, mutes_a).finish(Dims::new(), mutes_a);
        match verdict {
            Verdict::Suppress {
                downtime,
                muted_rows,
                ..
            } => {
                assert_eq!(downtime.id, "dt-a");
                assert_eq!(muted_rows, 2);
            }
            other => panic!("expected a suppression, got {other:?}"),
        }
    }

    #[test]
    fn muted_rows_past_the_cap_never_push_out_an_unmuted_row() {
        let mut rows = vec!["a"; 150];
        rows.push("b");
        let verdict = split(&rows, None, mutes_a).finish(Dims::new(), mutes_a);
        assert_eq!(delivered(&verdict), ["b"]);
    }

    #[test]
    fn a_metric_series_seen_once_is_not_taken_again() {
        let mut split = RowSplit::default();
        for signature in [1, 1, 2] {
            split.push(row("b"), None, Some(signature), dims_of, mutes_a);
        }
        assert!(split.seen(1) && split.seen(2) && !split.seen(3));
        assert_eq!(delivered(&split.finish(Dims::new(), mutes_a)).len(), 2);
    }

    #[test]
    fn a_multi_alert_group_takes_the_decision_of_its_first_row() {
        // Group keys: rows 1 and 3 are group "ga" (service a), row 2 is group "gb".
        let verdict = split(&["a", "b", "a"], Some(&["ga", "gb", "ga"]), mutes_a)
            .finish(Dims::new(), mutes_a);
        assert_eq!(delivered(&verdict), ["b"]);
        let reversed = split(&["b", "a", "a"], Some(&["gb", "ga", "ga"]), mutes_a)
            .finish(Dims::new(), mutes_a);
        assert_eq!(delivered(&reversed), ["b"]);
        // A later row of a group follows its first row even with other dims.
        let verdict = split(&["b", "a"], Some(&["g", "g"]), mutes_a).finish(Dims::new(), mutes_a);
        assert_eq!(delivered(&verdict), ["b", "a"]);
    }

    #[test]
    fn the_fallback_runs_only_when_no_group_first_row_has_an_identity() {
        // The group's first row is empty, its second row has service a: the fallback still runs.
        let split_rows = split(&["", "a"], Some(&["g", "g"]), mutes_a);
        assert!(split_rows.fallback_row().is_some());
        let fallback = Dims::from([("service".to_string(), "a".to_string())]);
        assert!(matches!(
            split_rows.finish(fallback, mutes_a),
            Verdict::Suppress { muted_rows: 2, .. }
        ));
    }

    #[test]
    fn empty_rows_beside_an_identity_are_decided_with_empty_dims() {
        let mut rows = vec![""; 150];
        rows.push("b");
        let split_rows = split(&rows, None, mutes_a);
        assert!(split_rows.fallback_row().is_none(), "row b has an identity");
        let verdict = split_rows.finish(Dims::new(), mutes_a);
        assert_eq!(
            delivered(&verdict).len(),
            ROW_CAP,
            "b plus empty rows, capped"
        );
    }

    #[test]
    fn empty_rows_past_the_cap_are_counted_when_the_downtime_covers_them() {
        let mut rows = vec![""; 150];
        rows.push("b");
        let verdict = split(&rows, None, mutes_all).finish(Dims::new(), mutes_all);
        assert!(matches!(
            verdict,
            Verdict::Suppress {
                muted_rows: 151,
                ..
            }
        ));
    }

    #[test]
    fn rows_with_no_identity_use_the_fallback_service() {
        let split_rows = split(&["", ""], None, mutes_a);
        assert!(split_rows.fallback_row().is_some());
        let fallback = Dims::from([("service".to_string(), "a".to_string())]);
        assert!(matches!(
            split_rows.finish(fallback, mutes_a),
            Verdict::Suppress { muted_rows: 2, .. }
        ));
    }
}
