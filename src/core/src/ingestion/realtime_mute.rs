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

//! Per-row downtime decisions for real-time alerts, so a muted service never hides an unmuted one.

use std::collections::{HashMap, HashSet};
#[cfg(feature = "enterprise")]
use std::sync::{
    Arc, LazyLock,
    atomic::{AtomicI64, Ordering},
};

use config::{
    meta::{alerts::alert::Alert, downtimes::ActiveDowntime},
    utils::json::{Map, Value},
};
#[cfg(feature = "enterprise")]
use dashmap::DashMap;

use super::{RealtimeMute, TriggerAlertData};

/// Matches the downtime cache's full reload, so settings are as fresh as the downtimes.
#[cfg(feature = "enterprise")]
const SEMANTIC_GROUPS_TTL_MICROS: i64 = 60 * 1_000_000;

/// The settings read caches only a row it finds, so an org without an override reads per call.
#[cfg(feature = "enterprise")]
static SEMANTIC_GROUPS: LazyLock<DashMap<String, (i64, SemanticGroups)>> =
    LazyLock::new(DashMap::new);

/// Discovery matches only semantic-group fields, so the answer is cached per alert and those
/// fields.
#[cfg(feature = "enterprise")]
static FALLBACK_SERVICES: LazyLock<DashMap<String, (i64, Option<String>)>> =
    LazyLock::new(DashMap::new);

/// When [FALLBACK_SERVICES] was last pruned, so a miss scans it at most once per floor.
#[cfg(feature = "enterprise")]
static FALLBACK_PRUNED_AT: AtomicI64 = AtomicI64::new(0);

#[cfg(feature = "enterprise")]
type SemanticGroups = Arc<Vec<config::meta::correlation::FieldAlias>>;
type Row = Map<String, Value>;
type Dims = HashMap<String, String>;

/// Per request: every matching row of every real-time alert, classified as it arrives.
pub struct RealtimeMuteSplit {
    org: String,
    now: i64,
    row_cap: usize,
    alerts: HashMap<String, AlertEntry>,
    order: Vec<String>,
    full: usize,
}

impl RealtimeMuteSplit {
    /// `None` unless the org has an alert downtime; `row_cap` is the most rows one alert delivers.
    pub fn for_org(org: &str, row_cap: usize) -> Option<Self> {
        crate::alerts::downtimes::any_for(org, config::meta::downtimes::TargetModule::Alerts).then(
            || Self {
                org: org.to_string(),
                now: config::utils::time::now_micros(),
                row_cap,
                alerts: HashMap::new(),
                order: Vec::new(),
                full: 0,
            },
        )
    }

    pub fn seen(&self, key: &str, signature: u64) -> bool {
        self.alerts
            .get(key)
            .is_some_and(|entry| entry.rows.seen(signature))
    }

    /// Lets the caller skip evaluating an alert whose verdict is already Deliver.
    pub fn is_full(&self, key: &str) -> bool {
        self.alerts
            .get(key)
            .is_some_and(|entry| entry.rows.is_full())
    }

    /// A muted alert never fills, so the caller stops evaluating rows only when this reaches its
    /// alert count.
    pub fn full_alerts(&self) -> usize {
        self.full
    }

    /// Files the matching rows of `alert`, keyed as the caller keys its alerts.
    pub async fn push(&mut self, key: &str, alert: &Alert, rows: Vec<Row>, signature: Option<u64>) {
        if !self.alerts.contains_key(key) {
            let entry = AlertEntry {
                alert: alert.clone(),
                #[cfg(feature = "enterprise")]
                scope: scope(&self.org, self.now, alert).await,
                rows: RowSplit::with_cap(self.row_cap),
            };
            self.alerts.insert(key.to_string(), entry);
            self.order.push(key.to_string());
        }
        let entry = self.alerts.get_mut(key).expect("inserted above");
        let was_full = entry.rows.is_full();
        for row in rows {
            push_row(&self.org, self.now, entry, row, signature);
        }
        if !was_full && entry.rows.is_full() {
            self.full += 1;
        }
    }

    /// Spawned by the ingest path after the write, since the verdicts may read service discovery.
    pub async fn evaluate(self) {
        let triggers = self.finish().await;
        if !triggers.is_empty() {
            super::evaluate_trigger(triggers).await;
        }
    }

    /// The alerts with a verdict, ready for `evaluate_trigger`.
    pub async fn finish(mut self) -> TriggerAlertData {
        let mut out = Vec::with_capacity(self.order.len());
        for key in self.order {
            let Some(entry) = self.alerts.remove(&key) else {
                continue;
            };
            out.extend(finish_entry(&self.org, self.now, &key, entry).await);
        }
        out
    }
}

struct AlertEntry {
    alert: Alert,
    /// `None` leaves the rows unmuted, as `realtime_downtime` does without an id or folder.
    #[cfg(feature = "enterprise")]
    scope: Option<Scope>,
    rows: RowSplit,
}

/// What a row needs to be classified: the alert's id, folder and identity rules.
#[cfg(feature = "enterprise")]
struct Scope {
    alert_id: String,
    folder_id: String,
    semantic_groups: SemanticGroups,
    group_by: Option<Vec<String>>,
}

/// The rows of one alert in one request, split by their downtime decision.
pub(crate) struct RowSplit {
    cap: usize,
    unmuted: Vec<Row>,
    /// Rows with no identity by group key, decided at [Self::finish] as each group is scheduled.
    empty: HashMap<Option<String>, Vec<Row>>,
    muted: Option<ActiveDowntime>,
    muted_ids: HashSet<String>,
    any_identity: bool,
    groups: HashMap<String, Group>,
    /// Plain rows with the same identity get the same answer, so the cache scan runs once each.
    decided: HashMap<Vec<(String, String)>, Option<ActiveDowntime>>,
    seen: HashSet<u64>,
}

impl RowSplit {
    fn with_cap(cap: usize) -> Self {
        Self {
            cap,
            unmuted: Vec::new(),
            empty: HashMap::new(),
            muted: None,
            muted_ids: HashSet::new(),
            any_identity: false,
            groups: HashMap::new(),
            decided: HashMap::new(),
            seen: HashSet::new(),
        }
    }

    pub(crate) fn seen(&self, signature: u64) -> bool {
        self.seen.contains(&signature)
    }

    /// A full unmuted bucket fixes the verdict at Deliver, so later rows change nothing.
    pub(crate) fn is_full(&self) -> bool {
        self.unmuted.len() >= self.cap
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
        if self.is_full() {
            return;
        }
        if let Some(signature) = signature
            && !self.seen.insert(signature)
        {
            return;
        }
        let decision = match &group {
            Some(key) => match self.groups.get(key) {
                Some(group) => group.clone(),
                None => {
                    let decided = self.classify(&row, false, dims_of, active_for);
                    self.groups.insert(key.clone(), decided.clone());
                    decided
                }
            },
            None => self.classify(&row, true, dims_of, active_for),
        };
        match decision {
            Group::Empty => {
                let rows = self.empty.entry(group).or_default();
                if rows.len() < self.cap {
                    rows.push(row);
                }
            }
            Group::Decided(None) => self.unmuted.push(row),
            Group::Decided(Some(downtime)) => self.mute(downtime),
        }
    }

    /// A group's decision may be group-scoped, so only plain rows share the identity cache.
    fn classify(
        &mut self,
        row: &Row,
        cacheable: bool,
        dims_of: impl FnOnce(&Row) -> Dims,
        active_for: impl FnOnce(&Dims) -> Option<ActiveDowntime>,
    ) -> Group {
        let dims = dims_of(row);
        if dims.is_empty() {
            return Group::Empty;
        }
        self.any_identity = true;
        if !cacheable {
            return Group::Decided(active_for(&dims));
        }
        let mut identity: Vec<(String, String)> =
            dims.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        identity.sort_unstable();
        let decision = self
            .decided
            .entry(identity)
            .or_insert_with(|| active_for(&dims))
            .clone();
        Group::Decided(decision)
    }

    fn mute(&mut self, downtime: ActiveDowntime) {
        if !self.muted_ids.insert(downtime.id.clone()) {
            return;
        }
        self.muted = Some(match self.muted.take() {
            Some(merged) => merge(merged, downtime),
            None => downtime,
        });
    }

    /// Only when no row had an identity, as `downtime_identities_by_key` decides it.
    #[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
    pub(crate) fn fallback_row(&self) -> Option<&Row> {
        if self.any_identity {
            return None;
        }
        self.empty.values().find_map(|rows| rows.first())
    }

    /// Decides each empty group with `empty_identity` and its group key, then the whole alert.
    pub(crate) fn finish(
        mut self,
        empty_identity: Dims,
        mut active_for: impl FnMut(&Dims, Option<&str>) -> Option<ActiveDowntime>,
    ) -> Verdict {
        let mut empty: Vec<_> = std::mem::take(&mut self.empty).into_iter().collect();
        empty.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        for (group, rows) in empty {
            match active_for(&empty_identity, group.as_deref()) {
                Some(downtime) => self.mute(downtime),
                None => {
                    let room = self.cap.saturating_sub(self.unmuted.len());
                    self.unmuted.extend(rows.into_iter().take(room));
                }
            }
        }
        if !self.unmuted.is_empty() {
            return Verdict::Deliver(self.unmuted);
        }
        match self.muted {
            Some(downtime) => Verdict::Suppress(downtime),
            None => Verdict::Nothing,
        }
    }
}

/// A group's first row decides every row of the group, as in a scheduled run.
#[derive(Clone)]
enum Group {
    Empty,
    Decided(Option<ActiveDowntime>),
}

/// What a request's rows of one alert come to.
#[derive(Debug, PartialEq)]
pub(crate) enum Verdict {
    Deliver(Vec<Row>),
    Suppress(ActiveDowntime),
    Nothing,
}

#[cfg(feature = "enterprise")]
fn merge(a: ActiveDowntime, b: ActiveDowntime) -> ActiveDowntime {
    crate::alerts::downtimes::enterprise::merged(a, b)
}

#[cfg(not(feature = "enterprise"))]
fn merge(a: ActiveDowntime, _b: ActiveDowntime) -> ActiveDowntime {
    a
}

#[cfg(feature = "enterprise")]
async fn semantic_groups(org: &str, now: i64) -> SemanticGroups {
    if let Some(cached) = SEMANTIC_GROUPS.get(org)
        && now.saturating_sub(cached.0) < SEMANTIC_GROUPS_TTL_MICROS
    {
        return cached.1.clone();
    }
    let groups = Arc::new(crate::db::system_settings::get_semantic_field_groups(org).await);
    SEMANTIC_GROUPS.insert(org.to_string(), (now, groups.clone()));
    groups
}

#[cfg(feature = "enterprise")]
async fn fallback_service(
    org: &str,
    key: &str,
    now: i64,
    groups: &[config::meta::correlation::FieldAlias],
    row: &Row,
) -> Option<String> {
    let floor = config::meta::alerts::TriggerCondition::min_silence_micros();
    let cache_key = format!("{key}/{:x}", fields_hash(row, groups));
    if let Some(cached) = FALLBACK_SERVICES.get(&cache_key)
        && now.saturating_sub(cached.0) < floor
    {
        return cached.1.clone();
    }
    let pruned_at = FALLBACK_PRUNED_AT.load(Ordering::Relaxed);
    if now.saturating_sub(pruned_at) >= floor
        && FALLBACK_PRUNED_AT
            .compare_exchange(pruned_at, now, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
    {
        FALLBACK_SERVICES.retain(|_, (at, _)| now.saturating_sub(*at) < floor);
    }
    let service = crate::alerts::incidents::correlated_service_for_routing(org, row).await;
    FALLBACK_SERVICES.insert(cache_key, (now, service.clone()));
    service
}

/// The scalar fields `correlate` can match (a group id or one of its fields), so `_timestamp` is
/// out.
#[cfg(feature = "enterprise")]
fn fields_hash(row: &Row, groups: &[config::meta::correlation::FieldAlias]) -> u64 {
    use std::hash::{Hash, Hasher};
    let matched = |k: &String| groups.iter().any(|g| g.id == *k || g.fields.contains(k));
    let mut fields: Vec<(&String, String)> = row
        .iter()
        .filter(|(k, _)| matched(k))
        .filter_map(|(k, v)| match v {
            Value::String(s) => Some((k, s.clone())),
            Value::Number(n) => Some((k, n.to_string())),
            Value::Bool(b) => Some((k, b.to_string())),
            _ => None,
        })
        .collect();
    fields.sort_unstable();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    fields.hash(&mut hasher);
    hasher.finish()
}

#[cfg(feature = "enterprise")]
async fn scope(org: &str, now: i64, alert: &Alert) -> Option<Scope> {
    let alert_id = alert.id.as_ref()?.to_string();
    let (folder, _) = crate::db::alerts::alert::get_alert_from_cache(org, &alert_id).await?;
    let group_by = alert
        .query_condition
        .multi_alert_enabled()
        .then(|| crate::alerts::scheduler::handlers::alert_group_by(alert));
    Some(Scope {
        alert_id,
        folder_id: folder.folder_id,
        semantic_groups: semantic_groups(org, now).await,
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
    let group_key = group.clone();
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
            crate::alerts::downtimes::active_for_alert_key(
                org,
                &scope.alert_id,
                &scope.folder_id,
                dims,
                group_key.as_deref(),
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
async fn finish_entry(org: &str, now: i64, key: &str, entry: AlertEntry) -> TriggerAlertData {
    let AlertEntry { alert, scope, rows } = entry;
    let Some(scope) = scope else {
        return into_trigger(alert, rows.finish(Dims::new(), |_, _| None));
    };
    let mut empty_identity = Dims::new();
    if let Some(row) = rows.fallback_row()
        && let Some(service) = fallback_service(org, key, now, &scope.semantic_groups, row).await
    {
        empty_identity.insert(config::meta::oncall::SERVICE_DIMENSION.to_string(), service);
    }
    let verdict = rows.finish(empty_identity, |dims, group_key| {
        crate::alerts::downtimes::active_for_alert_key(
            org,
            &scope.alert_id,
            &scope.folder_id,
            dims,
            group_key,
            now,
        )
    });
    into_trigger(alert, verdict)
}

#[cfg(not(feature = "enterprise"))]
async fn finish_entry(_org: &str, _now: i64, _key: &str, entry: AlertEntry) -> TriggerAlertData {
    into_trigger(entry.alert, entry.rows.finish(Dims::new(), |_, _| None))
}

fn into_trigger(alert: Alert, verdict: Verdict) -> TriggerAlertData {
    match verdict {
        Verdict::Deliver(rows) => vec![(alert, rows, RealtimeMute::Unmuted)],
        // A suppressed run reads only the downtime, never the rows.
        Verdict::Suppress(downtime) => vec![(alert, vec![], RealtimeMute::Muted(downtime))],
        Verdict::Nothing => vec![],
    }
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::level::PAYLOAD_SAMPLE_ROWS;

    use super::*;

    const ROW_CAP: usize = PAYLOAD_SAMPLE_ROWS as usize;

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

    /// The answer for a plain alert, which ignores the group key.
    fn plain(
        active: fn(&Dims) -> Option<ActiveDowntime>,
    ) -> impl FnMut(&Dims, Option<&str>) -> Option<ActiveDowntime> {
        move |dims, _| active(dims)
    }

    fn split(
        rows: &[&str],
        groups: Option<&[&str]>,
        active: fn(&Dims) -> Option<ActiveDowntime>,
    ) -> RowSplit {
        let mut split = RowSplit::with_cap(ROW_CAP);
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
            let verdict = split(&rows, None, mutes_a).finish(Dims::new(), plain(mutes_a));
            assert_eq!(delivered(&verdict), ["b"]);
        }
    }

    #[test]
    fn only_muted_rows_suppress_with_the_downtime() {
        let verdict = split(&["a", "a"], None, mutes_a).finish(Dims::new(), plain(mutes_a));
        match verdict {
            Verdict::Suppress(downtime) => assert_eq!(downtime.id, "dt-a"),
            other => panic!("expected a suppression, got {other:?}"),
        }
    }

    #[test]
    fn muted_rows_past_the_cap_never_push_out_an_unmuted_row() {
        let mut rows = vec!["a"; 150];
        rows.push("b");
        let verdict = split(&rows, None, mutes_a).finish(Dims::new(), plain(mutes_a));
        assert_eq!(delivered(&verdict), ["b"]);
    }

    #[test]
    fn a_metric_series_seen_once_is_not_taken_again() {
        let mut split = RowSplit::with_cap(ROW_CAP);
        for signature in [1, 1, 2] {
            split.push(row("b"), None, Some(signature), dims_of, mutes_a);
        }
        assert!(split.seen(1) && split.seen(2) && !split.seen(3));
        assert_eq!(
            delivered(&split.finish(Dims::new(), plain(mutes_a))).len(),
            2
        );
    }

    #[test]
    fn a_multi_alert_group_takes_the_decision_of_its_first_row() {
        // Group keys: rows 1 and 3 are group "ga" (service a), row 2 is group "gb".
        let verdict = split(&["a", "b", "a"], Some(&["ga", "gb", "ga"]), mutes_a)
            .finish(Dims::new(), plain(mutes_a));
        assert_eq!(delivered(&verdict), ["b"]);
        let reversed = split(&["b", "a", "a"], Some(&["gb", "ga", "ga"]), mutes_a)
            .finish(Dims::new(), plain(mutes_a));
        assert_eq!(delivered(&reversed), ["b"]);
        // A later row of a group follows its first row even with other dims.
        let verdict =
            split(&["b", "a"], Some(&["g", "g"]), mutes_a).finish(Dims::new(), plain(mutes_a));
        assert_eq!(delivered(&verdict), ["b", "a"]);
    }

    #[test]
    fn the_fallback_runs_only_when_no_group_first_row_has_an_identity() {
        // The group's first row is empty, its second row has service a: the fallback still runs.
        let split_rows = split(&["", "a"], Some(&["g", "g"]), mutes_a);
        assert!(split_rows.fallback_row().is_some());
        let fallback = Dims::from([("service".to_string(), "a".to_string())]);
        assert!(matches!(
            split_rows.finish(fallback, plain(mutes_a)),
            Verdict::Suppress(_)
        ));
    }

    #[test]
    fn empty_rows_beside_an_identity_are_decided_with_empty_dims() {
        let mut rows = vec![""; 150];
        rows.push("b");
        let split_rows = split(&rows, None, mutes_a);
        assert!(split_rows.fallback_row().is_none(), "row b has an identity");
        let verdict = split_rows.finish(Dims::new(), plain(mutes_a));
        assert_eq!(
            delivered(&verdict).len(),
            ROW_CAP,
            "b plus empty rows, capped"
        );
    }

    #[test]
    fn empty_rows_past_the_cap_suppress_when_the_downtime_covers_them() {
        let mut rows = vec![""; 150];
        rows.push("b");
        let verdict = split(&rows, None, mutes_all).finish(Dims::new(), plain(mutes_all));
        assert!(matches!(verdict, Verdict::Suppress(_)));
    }

    #[test]
    fn rows_with_no_identity_use_the_fallback_service() {
        let split_rows = split(&["", ""], None, mutes_a);
        assert!(split_rows.fallback_row().is_some());
        let fallback = Dims::from([("service".to_string(), "a".to_string())]);
        assert!(matches!(
            split_rows.finish(fallback, plain(mutes_a)),
            Verdict::Suppress(_)
        ));
    }

    #[test]
    fn empty_rows_of_a_multi_alert_are_decided_per_group_key() {
        let split_rows = split(&["", ""], Some(&["g1", "g2"]), mutes_a);
        let verdict = split_rows.finish(Dims::new(), |_, group| {
            (group == Some("g1")).then(|| downtime("dt-g1"))
        });
        assert_eq!(delivered(&verdict), [""]);
        let all_muted = split(&["", ""], Some(&["g1", "g2"]), mutes_a)
            .finish(Dims::new(), |_, group| group.map(downtime));
        assert!(matches!(all_muted, Verdict::Suppress(_)));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn the_discovery_key_ignores_fields_outside_the_semantic_groups() {
        use config::meta::correlation::FieldAlias;
        let groups = [FieldAlias::new("service", "Service", &["service", "svc"])];
        let with = |svc: &str, ts: i64| {
            let mut row = row("");
            row.insert("svc".to_string(), Value::String(svc.to_string()));
            row.insert("_timestamp".to_string(), Value::from(ts));
            fields_hash(&row, &groups)
        };
        assert_eq!(
            with("a", 1),
            with("a", 2),
            "_timestamp must not split the cache"
        );
        assert_ne!(
            with("a", 1),
            with("b", 1),
            "a different service must not share it"
        );
    }
}
