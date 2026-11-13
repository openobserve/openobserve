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

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    sync::{LazyLock, Mutex},
};

use config::meta::{
    service_identity::{ServiceKey, VersionImage},
    stream::StreamType,
};
use infra::table::{entity::service_version_deploys::Model, service_version_deploys as table};
use o2_enterprise::enterprise::service_identity::{
    deploys::{self, CountWindow, DetectInput, ServingVersion, Transition},
    not_serving,
    signals::{
        mappers::{self, K1Observation, PodRow, SignalRow, WindowCtx},
        series::{
            Kind, L_ENV, L_IMAGE, L_SERVICE, L_SOURCE, L_STATUS, L_VERSION, L_WHERE, M_POD_SPANS,
            M_REQUESTS, M_RUM_VIEWS, STATUS_ERROR,
        },
        sql,
    },
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{
    aggregator,
    metrics::{self, ArmGrid},
    processor::{self, Ownership},
};

// Detection reads this many closed windows, so a new transition never starts earlier.
pub(super) const RING_WINDOWS: i64 = 8;
// The day the K8s entry anchor and the verdict-event dedupe look back over.
const HISTORY_US: i64 = 86_400_000_000;
// Past its derived bounds an org keeps no history and reads its day from storage every window.
const MAX_HISTORY_IMAGES: usize = 25_000;
const HISTORY_EVENTS_PER_SERVICE: usize = 2;
const HISTORY_EVENTS_FLOOR: usize = 1_000;
const HISTORY_EVENTS_CAP: usize = 5_000;
// K1 samples land up to a scrape interval plus the collector's export retries late.
const K1_LATENESS_US: i64 = 600_000_000;
// A sample later than the lateness margin reaches the kept day only at a rebuild.
const REBUILD_US: i64 = 3_600_000_000;
const K1_STREAMS: [&str; 2] = ["kube_pod_container_info", "k8s_container_ready"];

// Only the scheduler holding the processor lock fills it; a restart or a claim starts it empty.
static HISTORY: LazyLock<Mutex<HashMap<String, OrgHistory>>> = LazyLock::new(Default::default);
// The producer's own rows of the last RING_WINDOWS windows per org, under their service key.
static RINGS: LazyLock<Mutex<HashMap<String, WindowRows>>> = LazyLock::new(Default::default);

type WindowRows = BTreeMap<i64, Vec<SignalRow>>;

/// What detection reads; every row and pod carries its service key, never a raw name.
pub(super) struct Ring {
    pub rows: Vec<SignalRow>,
    pub epoch: i64,
    pub end: i64,
    pub interval: i64,
    pub pods: Vec<PodRow>,
    pub presence: [Vec<K1Observation>; 2],
    pub images: Vec<K1Observation>,
    pub presence_history: BTreeMap<(String, String, String), BTreeSet<i64>>,
    pub events: Vec<serde_json::Value>,
}

impl Ring {
    pub fn new(rows: Vec<SignalRow>, epoch: i64, end: i64, interval: i64, day: Day) -> Self {
        let (pods, presence, images, events) = day;
        Self {
            presence_history: presence_history(&images, &pods, end),
            rows,
            epoch,
            end,
            interval,
            pods,
            presence,
            images,
            events,
        }
    }

    /// Each (service key, where) detection runs for.
    pub fn scopes(&self) -> BTreeSet<(ServiceKey, String)> {
        self.rows
            .iter()
            .map(|row| (&row.service, &row.where_key))
            .chain(self.pods.iter().map(|pod| (&pod.service, &pod.where_key)))
            .map(|(service, place)| (ServiceKey::stored(service.as_str()), place.clone()))
            .collect()
    }

    /// The version tables' scope key of each of [`Self::scopes`].
    pub fn scope_keys(&self, org: &str) -> BTreeSet<String> {
        self.scopes()
            .into_iter()
            .map(|(key, place)| key.scope_key(org, &place))
            .collect()
    }

    pub fn windows(&self, key: &ServiceKey, place: &str) -> Vec<CountWindow> {
        let mut windows: BTreeMap<_, _> = (1..=8)
            .map(|n| {
                let start = self.end - n * self.interval;
                (
                    start,
                    CountWindow {
                        start,
                        ..Default::default()
                    },
                )
            })
            .collect();
        let traces = self.rows.iter().any(|r| {
            r.service == key.as_str()
                && r.where_key == place
                && r.signal == "traces"
                && r.requests.unwrap_or(0) > 0
        });
        for row in self.rows.iter().filter(|row| {
            row.service == key.as_str()
                && row.where_key == place
                && row.signal == if traces { "traces" } else { "rum" }
        }) {
            if let Some(window) = windows.get_mut(&row.timestamp) {
                let version = VersionImage::new(&row.version, row.image.as_deref());
                *window.counts.entry(version.clone()).or_default() +=
                    row.requests.or(row.views).unwrap_or(0);
                window.streams.entry(version).or_default().insert(format!(
                    "{}/{}",
                    if row.signal == "traces" {
                        "traces"
                    } else {
                        "logs"
                    },
                    row.source_stream
                ));
            }
        }
        windows.into_values().collect()
    }
}

/// This window's rows and pods, each name reduced to its key once, with each scope's newest name.
pub(super) struct Live {
    pub rows: Vec<SignalRow>,
    pub pods: Vec<PodRow>,
    names: BTreeMap<(ServiceKey, String), (i64, String)>,
}

impl Live {
    pub fn of(rows: &[SignalRow], pods: &[PodRow]) -> Self {
        let mut names = BTreeMap::new();
        let observed = rows
            .iter()
            .map(|row| (row.timestamp, &row.service, &row.where_key))
            .chain(
                pods.iter()
                    .map(|pod| (pod.timestamp, &pod.service, &pod.where_key)),
            );
        for (at, service, place) in observed {
            let seen = (at, service.clone());
            let held = names
                .entry((ServiceKey::of(service), place.clone()))
                .or_insert_with(|| seen.clone());
            if seen > *held {
                *held = seen;
            }
        }
        Self {
            rows: rows
                .iter()
                .map(|row| SignalRow {
                    service: ServiceKey::of(&row.service).into_string(),
                    ..row.clone()
                })
                .collect(),
            pods: pods
                .iter()
                .map(|pod| PodRow {
                    service: ServiceKey::of(&pod.service).into_string(),
                    ..pod.clone()
                })
                .collect(),
            names,
        }
    }

    /// The deploy row's name: this window's newest, else the stored one, else one that keys back.
    pub fn display(&self, key: &ServiceKey, place: &str, stored: Option<&str>) -> String {
        if let Some((_, name)) = self.names.get(&(key.clone(), place.to_string())) {
            return name.clone();
        }
        stored
            .filter(|name| ServiceKey::of(name) == *key)
            .map_or_else(|| key.spelling(), str::to_string)
    }
}

/// One storage read a day of history is built from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum HistoryRead {
    Pods {
        start: i64,
        end: i64,
    },
    Images {
        stream: &'static str,
        start: i64,
        end: i64,
    },
    Events {
        start: i64,
        end: i64,
    },
}

/// An org's day of pods, K8s images and verdict events up to `end`, deduped as the reads dedupe.
#[derive(Clone, Debug, Default)]
pub(super) struct OrgHistory {
    end: i64,
    built: i64,
    interval: i64,
    pods: BTreeMap<PodKey, (i64, i64, PodRow)>,
    images: BTreeMap<(usize, i64), Vec<K1Observation>>,
    events: BTreeMap<(String, String), (EventRank, serde_json::Value)>,
}

impl OrgHistory {
    /// Whether this day tops up to `end`: same windows, under a day behind, no rebuild due.
    fn continues(&self, end: i64, interval: i64) -> bool {
        self.interval == interval
            && self.end <= end
            && (end - self.end) % interval == 0
            && end - self.end < HISTORY_US
            && end - self.built < REBUILD_US
    }

    /// Keeps the highest (generation, written_at) per pod key, as the pods read's ROW_NUMBER does.
    fn merge_pod(&mut self, generation: i64, row: PodRow) {
        let key = (
            row.timestamp,
            row.cluster.clone(),
            row.source_stream.clone(),
            row.service.clone(),
            row.where_key.clone(),
            row.version.clone(),
            row.k8s_pod.clone(),
            row.k8s_container.clone(),
        );
        if self
            .pods
            .get(&key)
            .is_none_or(|(stored, written, _)| (*stored, *written) <= (generation, row.written_at))
        {
            self.pods.insert(key, (generation, row.written_at, row));
        }
    }

    /// Keeps the newest row per (deploy, event), as the events read's ROW_NUMBER does.
    fn merge_event(&mut self, row: serde_json::Value) {
        let (Some(deploy), Some(event)) = (row["deploy_key"].as_str(), row["event"].as_str())
        else {
            return;
        };
        let key = (deploy.to_string(), event.to_string());
        let rank = (
            row["_timestamp"].as_i64().unwrap_or_default(),
            row["generation"].as_i64().unwrap_or_default(),
            row["written_at"].as_i64().unwrap_or_default(),
        );
        if self
            .events
            .get(&key)
            .is_none_or(|(stored, _)| *stored <= rank)
        {
            self.events.insert(key, (rank, row));
        }
    }

    /// Replaces one stream's buckets in `[start, end)` with a fresh read of them.
    fn put_images(&mut self, stream: usize, start: i64, end: i64, images: Vec<K1Observation>) {
        self.images
            .retain(|(index, bucket), _| *index != stream || *bucket < start || *bucket >= end);
        for image in images {
            self.images
                .entry((stream, image.window_start))
                .or_default()
                .push(image);
        }
    }

    fn prune(&mut self) {
        let from = self.end - HISTORY_US;
        self.pods.retain(|key, _| key.0 >= from);
        self.images.retain(|(_, bucket), _| *bucket >= from);
        self.events.retain(|_, (rank, _)| rank.0 >= from);
    }

    /// Entries past the bounds derived from the org's service count (D229).
    fn overflow(&self) -> u64 {
        let services: BTreeSet<&str> = self
            .pods
            .values()
            .map(|(_, _, row)| row.service.as_str())
            .chain(
                self.events
                    .values()
                    .filter_map(|(_, row)| row["service"].as_str()),
            )
            .collect();
        let pods = Kind::Pod.bound(services.len(), 0);
        let events = (HISTORY_EVENTS_PER_SERVICE * services.len())
            .clamp(HISTORY_EVENTS_FLOOR, HISTORY_EVENTS_CAP);
        let images: usize = self.images.values().map(Vec::len).sum();
        (self.pods.len().saturating_sub(pods)
            + images.saturating_sub(MAX_HISTORY_IMAGES)
            + self.events.len().saturating_sub(events)) as u64
    }

    fn pods(&self) -> Vec<PodRow> {
        self.pods.values().map(|(_, _, row)| row.clone()).collect()
    }

    /// The two newest windows' images, the K1 windows detection compares.
    fn presence(&self) -> [Vec<K1Observation>; 2] {
        std::array::from_fn(|index| {
            let bucket = self.end - (2 - index as i64) * self.interval;
            (0..K1_STREAMS.len())
                .filter_map(|stream| self.images.get(&(stream, bucket)))
                .flatten()
                .cloned()
                .collect()
        })
    }

    fn images(&self) -> Vec<K1Observation> {
        self.images.values().flatten().cloned().collect()
    }

    fn events(&self) -> Vec<serde_json::Value> {
        self.events.values().map(|(_, row)| row.clone()).collect()
    }
}

/// What a snapshot keeps of an org's detection state: the ring and the day history (D231).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(super) struct Kept {
    pub ring: BTreeMap<i64, Vec<SignalRow>>,
    pub history: Option<KeptHistory>,
}

/// [`OrgHistory`] with its maps as pair lists, since JSON map keys are strings.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(super) struct KeptHistory {
    end: i64,
    built: i64,
    interval: i64,
    pods: Vec<(PodKey, (i64, i64, PodRow))>,
    images: Vec<((usize, i64), Vec<K1Observation>)>,
    events: Vec<((String, String), (EventRank, serde_json::Value))>,
}

impl From<&OrgHistory> for KeptHistory {
    fn from(history: &OrgHistory) -> Self {
        Self {
            end: history.end,
            built: history.built,
            interval: history.interval,
            pods: history.pods.clone().into_iter().collect(),
            images: history.images.clone().into_iter().collect(),
            events: history.events.clone().into_iter().collect(),
        }
    }
}

impl From<KeptHistory> for OrgHistory {
    fn from(kept: KeptHistory) -> Self {
        Self {
            end: kept.end,
            built: kept.built,
            interval: kept.interval,
            pods: kept.pods.into_iter().collect(),
            images: kept.images.into_iter().collect(),
            events: kept.events.into_iter().collect(),
        }
    }
}

/// An org's day as detection reads it: pods, the two newest K1 windows, every K1 image, events.
pub(super) type Day = (
    Vec<PodRow>,
    [Vec<K1Observation>; 2],
    Vec<K1Observation>,
    Vec<serde_json::Value>,
);
/// `_timestamp, cluster, source_stream, service, where_key, version, k8s_pod, k8s_container`.
type PodKey = (i64, String, String, String, String, String, String, String);
/// `_timestamp, generation, written_at`, the order the events read ranks rows by.
type EventRank = (i64, i64, i64);

pub(super) async fn detect(
    org: &str,
    end: i64,
    interval: i64,
    current_rows: &[SignalRow],
    current_pods: &[PodRow],
    ownership: &Ownership<'_>,
) -> anyhow::Result<Ring> {
    let conn = infra::db::get_orm_client_rw().await;
    ownership.check().await?;
    let epoch = if current_rows.is_empty() {
        infra::db::get_db()
            .await
            .get_with_revision(&format!("/service_signals/epoch/{org}"))
            .await?
            .map(|(value, _)| Ok::<_, anyhow::Error>(std::str::from_utf8(&value)?.parse::<i64>()?))
            .transpose()?
            .unwrap_or(end - interval)
    } else {
        epoch(org, end - interval).await?
    };
    let live = Live::of(current_rows, current_pods);
    let rows = ring_rows(org, end, interval, &live.rows).await?;
    let day = day_history(org, end, interval, &live.pods, ownership).await?;
    let ring = Ring::new(rows, epoch, end, interval, day);
    for (key, place) in &ring.scopes() {
        let scope = key.scope_key(org, place);
        let stored =
            table::history(conn, org, &scope, Some(&config::get_cluster_name()), 1000).await?;
        let history: Vec<Transition> = stored.iter().map(transition).collect::<Result<_, _>>()?;
        let current = table::current(conn, org, &scope, &config::get_cluster_name()).await?;
        let serving: Vec<ServingVersion> = current
            .as_ref()
            .map(|r| serde_json::from_str(&r.full_serving))
            .transpose()?
            .unwrap_or_default();
        let mut anchors = BTreeMap::new();
        for row in stored.iter().filter(|row| row.entry_source == "k8s") {
            anchors.entry(row.to_version.clone()).or_insert(row.at);
        }
        let display = live.display(
            key,
            place,
            current.as_ref().map(|row| row.service_name.as_str()),
        );
        let input = DetectInput {
            org_id: org.into(),
            service_name: display.clone(),
            where_key: place.clone(),
            cluster: config::get_cluster_name(),
            epoch: ring.epoch,
            now: end,
            window_us: interval,
            windows: ring.windows(key, place),
            serving: serving.clone(),
            current: current.as_ref().map(transition).transpose()?,
            history,
            first_seen: first_seen(org, &display, place).await?,
            pod_entries: pod_entries(&ring, key, place, &anchors),
        };
        let result = deploys::detect(&input);
        let mut updates = Vec::new();
        if let Some(update) = result.current_update {
            updates.push(model(
                &update,
                if result.transitions.is_empty() {
                    &result.serving
                } else {
                    &serving
                },
            )?);
        }
        let mut entered: BTreeSet<_> = serving.iter().map(ServingVersion::identity).collect();
        for entry in result.transitions {
            entered.insert(entry.to_identity());
            let full: Vec<_> = result
                .serving
                .iter()
                .filter(|member| entered.contains(&member.identity()))
                .cloned()
                .collect();
            updates.push(model(&entry, &full)?);
        }
        put_scope_updates(updates, |mut updates| async move {
            ownership.check().await?;
            table::put_fenced_batch(
                conn,
                org,
                &config::get_cluster_name(),
                ownership.generation,
                updates.clone(),
            )
            .await?;
            for row in &mut updates {
                *row = table::get(conn, org, &row.deploy_key)
                    .await?
                    .ok_or_else(|| anyhow::anyhow!("persisted deploy missing"))?;
            }
            db::service_identity_sync::publish_chunked(
                updates
                    .iter()
                    .map(serde_json::to_value)
                    .collect::<Result<Vec<_>, _>>()?,
                524_288,
                |rows| config::meta::service_identity::ServiceIdentityMessage::DeployPut {
                    org_id: org.into(),
                    rows,
                },
            )
            .await;
            Ok(())
        })
        .await?;
    }
    Ok(ring)
}

/// The org's day of history at `end`: the previous one topped up when it continues, else a read.
pub(super) async fn load_history<R, Fut>(
    org: &str,
    previous: Option<OrgHistory>,
    end: i64,
    interval: i64,
    pods: &[PodRow],
    generation: i64,
    read: R,
) -> anyhow::Result<OrgHistory>
where
    R: Fn(HistoryRead) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<Vec<serde_json::Value>>>,
{
    let (mut history, from) = match previous.filter(|history| history.continues(end, interval)) {
        Some(mut history) => {
            // Windows written before a restart, past the snapshot this day came from.
            let gap = history.end;
            if gap + interval < end {
                for row in read(HistoryRead::Pods {
                    start: gap,
                    end: end - interval,
                })
                .await?
                {
                    let generation = row["generation"].as_i64().unwrap_or_default();
                    history.merge_pod(generation, serde_json::from_value(row)?);
                }
                for row in read(HistoryRead::Events { start: gap, end }).await? {
                    history.merge_event(row);
                }
            }
            let from = reread_from((gap + interval).min(end), interval);
            (history, from)
        }
        None => {
            let start = end - HISTORY_US;
            let mut history = OrgHistory {
                end,
                built: end,
                interval,
                ..Default::default()
            };
            for row in read(HistoryRead::Pods { start, end }).await? {
                let generation = row["generation"].as_i64().unwrap_or_default();
                history.merge_pod(generation, serde_json::from_value(row)?);
            }
            for row in read(HistoryRead::Events { start, end }).await? {
                history.merge_event(row);
            }
            (history, start)
        }
    };
    for (index, stream) in K1_STREAMS.into_iter().enumerate() {
        let hits = read(HistoryRead::Images {
            stream,
            start: from,
            end,
        })
        .await?;
        let ctx = WindowCtx {
            org_id: org.into(),
            source_stream: stream.into(),
            window_start: from,
            window_secs: (end - from) / 1_000_000,
            written_at: end,
            cluster: config::get_cluster_name(),
        };
        history.put_images(index, from, end, k1_buckets(&ctx, hits)?);
    }
    for pod in pods {
        history.merge_pod(generation, pod.clone());
    }
    history.end = end;
    history.prune();
    Ok(history)
}

/// Adds an event this node wrote for window `end` to the org's history, as a later read would.
pub(super) fn remember_event(org: &str, end: i64, row: &serde_json::Value) {
    let mut histories = HISTORY.lock().expect("service signals history");
    if let Some(history) = histories.get_mut(org)
        && history.end == end
    {
        history.merge_event(row.clone());
        let overflow = history.overflow();
        if overflow > 0 {
            histories.remove(org);
            super::writer::count_dropped(org, super::writer::KIND_HISTORY, overflow);
        }
    }
}

/// Drops the history of every org `keep` rejects.
pub(super) fn forget_history(keep: impl Fn(&str) -> bool) {
    HISTORY
        .lock()
        .expect("service signals history")
        .retain(|org, _| keep(org));
}

pub(super) fn kept(org: &str) -> Kept {
    Kept {
        ring: RINGS
            .lock()
            .expect("service signals rings")
            .get(org)
            .cloned()
            .unwrap_or_default(),
        history: HISTORY
            .lock()
            .expect("service signals history")
            .get(org)
            .map(KeptHistory::from),
    }
}

pub(super) fn restore(org: &str, kept: Kept) {
    if !kept.ring.is_empty() {
        RINGS
            .lock()
            .expect("service signals rings")
            .insert(org.to_string(), kept.ring);
    }
    if let Some(history) = kept.history {
        HISTORY
            .lock()
            .expect("service signals history")
            .insert(org.to_string(), history.into());
    }
}

pub(super) fn transition(row: &Model) -> anyhow::Result<Transition> {
    let mut value = serde_json::to_value(row)?;
    for key in ["serving_versions", "source_streams"] {
        value[key] = serde_json::from_str(
            value[key]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("invalid deploy field"))?,
        )?;
    }
    Ok(serde_json::from_value(value)?)
}

pub(super) fn model(row: &Transition, serving: &[ServingVersion]) -> anyhow::Result<Model> {
    let mut value = serde_json::to_value(row)?;
    value["full_serving"] = json!(serde_json::to_string(serving)?);
    value["serving_versions"] = json!(serde_json::to_string(&row.serving_versions)?);
    value["source_streams"] = json!(serde_json::to_string(&row.source_streams)?);
    value["source_streams_overflow"] = json!(false);
    Ok(serde_json::from_value(value)?)
}

/// Orgs of this region with a verdict evaluating or a deploy within a day of `end`.
pub(super) async fn orgs_with_work(end: i64) -> anyhow::Result<BTreeSet<String>> {
    orgs_with_work_with(infra::db::get_orm_client_rw().await, end).await
}

/// An org with an epoch was tracked before, so it resumes rather than starting at the present.
pub(super) async fn has_epoch(org: &str) -> anyhow::Result<bool> {
    Ok(infra::db::get_db()
        .await
        .get_with_revision(&format!("/service_signals/epoch/{org}"))
        .await?
        .is_some())
}

pub(super) fn agreement(ring: &Ring, key: &ServiceKey, place: &str) -> (u64, u64) {
    let mut matched = 0;
    let mut total = 0;
    for pod in ring
        .pods
        .iter()
        .filter(|pod| pod.service == key.as_str() && pod.where_key == place)
    {
        total += pod.spans;
        if ring.images.iter().any(|image| {
            image.pod == pod.k8s_pod
                && image.namespace == pod.k8s_namespace
                && image.container == pod.k8s_container
                && image.k8s_cluster == pod.k8s_cluster
                && image.version == pod.version
        }) {
            matched += pod.spans;
        }
    }
    (matched, total)
}

/// The pods running a not_serving version as of its last evaluated window, with K8s status.
pub(super) async fn not_serving_pods(
    org: &str,
    row: &infra::table::entity::service_version_verdicts::Model,
) -> anyhow::Result<config::meta::service_identity::NotServingPods> {
    let interval = o2_enterprise::enterprise::common::config::get_config()
        .service_signals
        .window_secs as i64
        * 1_000_000;
    let end = row.window_end;
    let (span_pods, _, history) = presence(org, end, interval, None).await?;
    let key = ServiceKey::of(&row.service_name);
    let mut table = not_serving::pods(&not_serving::PodsInput {
        service: key.as_str(),
        where_key: &row.where_key,
        version: &row.version,
        now: end,
        window_us: interval,
        history: &history,
        span_pods: &span_pods,
        no_requests_since: row.ns_not_serving_since,
    });
    let start = end - 2 * interval;
    let mut streams = vec![sql::POD_READY_STREAM, sql::POD_WAITING_STREAM];
    if infra::schema::get(org, sql::POD_READY_STREAM, StreamType::Metrics)
        .await?
        .fields()
        .is_empty()
    {
        streams.push(sql::OTEL_READY_STREAM);
    }
    let mut results = Vec::new();
    for stream in streams {
        let cols: std::collections::HashSet<String> =
            infra::schema::get(org, stream, StreamType::Metrics)
                .await?
                .fields()
                .iter()
                .map(|field| field.name().clone())
                .collect();
        if let Some(sql) = sql::build_pod_status_sql(stream, &table.pods, start, end, &cols) {
            match processor::query(org, StreamType::Metrics, Some(sql), start, end).await {
                Ok(hits) => results.push((stream, hits)),
                // Partial status could mark a pod running from one stream alone, so all or none.
                Err(error) => {
                    log::warn!("[ServiceVersions] not_serving pod status unavailable: {error}");
                    return Ok(table);
                }
            }
        }
    }
    not_serving::apply_pod_status(&mut table, &results);
    Ok(table)
}

async fn epoch(org: &str, first_window: i64) -> anyhow::Result<i64> {
    let store = infra::db::get_db().await;
    let key = format!("/service_signals/epoch/{org}");
    if let Some((value, _)) = store.get_with_revision(&key).await? {
        return Ok(std::str::from_utf8(&value)?.parse()?);
    }
    if store
        .put_if_revision(&key, bytes::Bytes::from(first_window.to_string()), None)
        .await?
    {
        return Ok(first_window);
    }
    let value = store.get(&key).await?;
    Ok(std::str::from_utf8(&value)?.parse()?)
}

/// Orgs evaluating, pending or within a day of a deploy, read once for the region as a superset.
async fn orgs_with_work_with<C: sea_orm::ConnectionTrait>(
    conn: &C,
    end: i64,
) -> anyhow::Result<BTreeSet<String>> {
    use infra::table::entity::{
        service_version_deploys as deploys, service_version_verdicts as verdicts,
    };
    let cluster = config::get_cluster_name();
    let mut orgs: BTreeSet<String> = verdicts::Entity::find()
        .select_only()
        .column(verdicts::Column::OrgId)
        .distinct()
        .filter(verdicts::Column::Cluster.eq(&cluster))
        .filter(verdicts::Column::State.eq("evaluating"))
        .into_tuple::<String>()
        .all(conn)
        .await?
        .into_iter()
        .collect();
    orgs.extend(
        deploys::Entity::find()
            .select_only()
            .column(deploys::Column::OrgId)
            .distinct()
            .filter(deploys::Column::Cluster.eq(&cluster))
            .filter(deploys::Column::Kind.ne("pre_existing"))
            .filter(deploys::Column::At.gte(end - 86_400_000_000))
            .into_tuple::<String>()
            .all(conn)
            .await?,
    );
    Ok(orgs)
}

fn pod_entries(
    ring: &Ring,
    key: &ServiceKey,
    place: &str,
    anchors: &BTreeMap<String, i64>,
) -> Vec<deploys::PodEntry> {
    let (matched, total) = agreement(ring, key, place);
    if total == 0 || (matched as f64 / total as f64) < 0.9 {
        return vec![];
    }
    let mapped: Vec<_> = ring
        .presence
        .iter()
        .map(|rows| not_serving::map_presence(rows, &ring.pods, ring.end))
        .collect();
    mapped[1]
        .iter()
        .filter(|row| {
            row.service == key.as_str()
                && row.where_key == place
                && mapped[0].iter().any(|previous| {
                    previous.service == row.service
                        && previous.where_key == row.where_key
                        && previous.version == row.version
                })
        })
        .map(|row| deploys::PodEntry {
            version: row.version.clone(),
            first_window: {
                let first = entry_start(
                    ring.presence_history.get(&(
                        row.service.clone(),
                        row.where_key.clone(),
                        row.version.clone(),
                    )),
                    ring.end - 2 * ring.interval,
                    ring.interval,
                );
                if first <= ring.end - 86_400_000_000 + ring.interval {
                    anchors
                        .get(&row.version)
                        .copied()
                        .unwrap_or(first)
                        .min(first)
                } else {
                    first
                }
            },
            source_streams: mapped
                .iter()
                .flatten()
                .filter(|evidence| {
                    evidence.service == row.service
                        && evidence.where_key == row.where_key
                        && evidence.version == row.version
                })
                .flat_map(|evidence| evidence.source_streams.iter().cloned())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
        })
        .filter(|entry| {
            entry.first_window > ring.end - 86_400_000_000 + ring.interval
                || anchors.contains_key(&entry.version)
        })
        .collect()
}

fn entry_start(windows: Option<&BTreeSet<i64>>, mut start: i64, interval: i64) -> i64 {
    while windows.is_some_and(|windows| windows.contains(&(start - interval))) {
        start -= interval;
    }
    start
}

fn presence_history(
    images: &[K1Observation],
    pods: &[PodRow],
    now: i64,
) -> BTreeMap<(String, String, String), BTreeSet<i64>> {
    let mut windows: BTreeMap<i64, Vec<K1Observation>> = BTreeMap::new();
    for image in images {
        windows
            .entry(image.window_start)
            .or_default()
            .push(image.clone());
    }
    let mut history: BTreeMap<_, BTreeSet<i64>> = BTreeMap::new();
    for (start, observations) in windows {
        for mapped in not_serving::map_presence(&observations, pods, now) {
            history
                .entry((mapped.service, mapped.where_key, mapped.version))
                .or_default()
                .insert(start);
        }
    }
    history
}

async fn presence(
    org: &str,
    end: i64,
    interval: i64,
    ownership: Option<&Ownership<'_>>,
) -> anyhow::Result<(Vec<PodRow>, [Vec<K1Observation>; 2], Vec<K1Observation>)> {
    let start = end - 86_400_000_000;
    let pods = pod_rows(org, start, end, interval).await?;
    let mut windows = [vec![], vec![]];
    let mut images = vec![];
    for stream in K1_STREAMS {
        let (observations, history) =
            presence_stream(org, stream, end, interval, ownership).await?;
        for (window, observations) in windows.iter_mut().zip(observations) {
            window.extend(observations);
        }
        images.extend(history);
    }
    Ok((pods, windows, images))
}

async fn presence_stream(
    org: &str,
    stream: &str,
    end: i64,
    interval: i64,
    ownership: Option<&Ownership<'_>>,
) -> anyhow::Result<([Vec<K1Observation>; 2], Vec<K1Observation>)> {
    let schema = infra::schema::get(org, stream, StreamType::Metrics).await?;
    let cols = schema
        .fields()
        .iter()
        .map(|field| field.name().clone())
        .collect();
    let mut windows = [vec![], vec![]];
    let mut images = vec![];
    for (index, from) in [end - 2 * interval, end - interval, end - 86_400_000_000]
        .into_iter()
        .enumerate()
    {
        if let Some(ownership) = ownership {
            ownership.check().await?;
        }
        let to = if index == 2 { end } else { from + interval };
        let hits = processor::query(
            org,
            StreamType::Metrics,
            sql::build_k1_sql(stream, from, to, &cols).map(|sql| {
                if index == 2 {
                    bucketed_k1_sql(&sql, interval)
                } else {
                    sql
                }
            }),
            from,
            to,
        )
        .await?;
        let ctx = WindowCtx {
            org_id: org.into(),
            source_stream: stream.into(),
            window_start: from,
            window_secs: (to - from) / 1_000_000,
            written_at: end,
            cluster: config::get_cluster_name(),
        };
        if index == 2 {
            images.extend(k1_buckets(&ctx, hits)?);
        } else {
            windows[index] = mappers::map_k1(&ctx, &hits);
        }
    }
    Ok((windows, images))
}

// Deploy writers share one fence row per region, so a scope with nothing to write skips it.
async fn put_scope_updates<F, Fut>(updates: Vec<Model>, put: F) -> anyhow::Result<()>
where
    F: FnOnce(Vec<Model>) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<()>>,
{
    if updates.is_empty() {
        return Ok(());
    }
    put(updates).await
}

async fn first_seen(
    org: &str,
    service: &str,
    place: &str,
) -> anyhow::Result<BTreeMap<VersionImage, i64>> {
    let mut result = BTreeMap::new();
    let mut offset = 0;
    loop {
        let rows = infra::table::service_versions::list(
            infra::db::get_orm_client_rw().await,
            org,
            &infra::table::service_versions::ListQuery {
                service_name: Some(service.into()),
                where_key: Some(place.into()),
                limit: 1000,
                offset,
            },
        )
        .await?;
        let count = rows.len();
        result.extend(rows.into_iter().map(|row| (row.identity(), row.first_seen)));
        if count < 1000 {
            return Ok(result);
        }
        offset += count as u64;
    }
}

async fn event_history(org: &str, start: i64, end: i64) -> anyhow::Result<Vec<serde_json::Value>> {
    if infra::schema::get(org, aggregator::VERDICTS, StreamType::Logs)
        .await?
        .fields()
        .is_empty()
    {
        return Ok(vec![]);
    }
    let sql = format!(
        "SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY deploy_key,event ORDER BY _timestamp DESC,generation DESC,written_at DESC) AS rn FROM \"{}\" WHERE _timestamp >= {start} AND _timestamp <= {end}) WHERE rn=1",
        aggregator::VERDICTS
    );
    processor::query(org, StreamType::Logs, Some(sql), start, end + 1).await
}

/// The day detection reads: kept between contiguous windows, read from storage otherwise.
async fn day_history(
    org: &str,
    end: i64,
    interval: i64,
    current_pods: &[PodRow],
    ownership: &Ownership<'_>,
) -> anyhow::Result<Day> {
    // Image buckets line up with windows only when the window does.
    if end.rem_euclid(interval) != 0 {
        let (pods, presence, images) = presence(org, end, interval, Some(ownership)).await?;
        let events = event_history(org, end - HISTORY_US, end).await?;
        return Ok((pods, presence, images, events));
    }
    let previous = HISTORY.lock().expect("service signals history").remove(org);
    let history = load_history(
        org,
        previous,
        end,
        interval,
        current_pods,
        ownership.generation,
        |read| read_history(org, interval, read, ownership),
    )
    .await?;
    let day = (
        history.pods(),
        history.presence(),
        history.images(),
        history.events(),
    );
    let overflow = history.overflow();
    if overflow == 0 {
        HISTORY
            .lock()
            .expect("service signals history")
            .insert(org.to_string(), history);
    }
    super::writer::count_dropped(org, super::writer::KIND_HISTORY, overflow);
    Ok(day)
}

/// One history read against storage; a stream not written yet reads as empty.
async fn read_history(
    org: &str,
    interval: i64,
    read: HistoryRead,
    ownership: &Ownership<'_>,
) -> anyhow::Result<Vec<serde_json::Value>> {
    ownership.check().await?;
    match read {
        HistoryRead::Pods { start, end } => Ok(pod_rows(org, start, end, interval)
            .await?
            .iter()
            .map(PodRow::to_json)
            .collect()),
        HistoryRead::Events { start, end } => event_history(org, start, end).await,
        HistoryRead::Images { stream, start, end } => {
            let cols = infra::schema::get(org, stream, StreamType::Metrics)
                .await?
                .fields()
                .iter()
                .map(|field| field.name().clone())
                .collect();
            let sql = sql::build_k1_sql(stream, start, end, &cols)
                .map(|sql| bucketed_k1_sql(&sql, interval));
            processor::query(org, StreamType::Metrics, sql, start, end).await
        }
    }
}

/// The start of the K1 buckets a contiguous window re-reads: its own and the lateness margin's.
fn reread_from(end: i64, interval: i64) -> i64 {
    let interval = interval.max(1);
    end - (1 + (K1_LATENESS_US + interval - 1) / interval) * interval
}

/// This region's pod rows per window from `_o2_service_pod_spans_total`, one PromQL read.
pub(super) async fn pod_rows(
    org: &str,
    start: i64,
    end: i64,
    interval: i64,
) -> anyhow::Result<Vec<PodRow>> {
    let grid = ArmGrid {
        start: start - start.rem_euclid(interval),
        end,
        step: interval,
        hourly: false,
    };
    let cluster = config::get_cluster_name();
    let selector = format!("{M_POD_SPANS}{{cluster={}}}", metrics::literal(&cluster));
    processor::record_query();
    let value = metrics::range(
        org,
        &metrics::arm_query(&selector, grid.start, end, interval).0,
        grid,
        true,
    )
    .await?;
    let mut rows = Vec::new();
    for (series, steps) in metrics::step_increases(&value, grid.start, grid.step) {
        let label = |name: &str| series.label(name);
        for (t, spans) in steps {
            rows.push(PodRow {
                timestamp: t - interval,
                window_secs: interval / 1_000_000,
                written_at: t,
                cluster: cluster.clone(),
                source_stream: label(L_SOURCE),
                k8s_cluster: label("k8s_cluster"),
                k8s_namespace: label("k8s_namespace"),
                k8s_pod: label("k8s_pod"),
                k8s_workload: label("k8s_workload"),
                k8s_workload_kind: label("k8s_workload_kind"),
                k8s_container: label("k8s_container"),
                service: label(L_SERVICE),
                where_key: label(L_WHERE),
                env: label(L_ENV),
                env_source: None,
                version: label(L_VERSION),
                spans: spans.round() as u64,
                min_ts: t - interval,
                max_ts: t - 1,
            });
        }
    }
    Ok(rows)
}

/// The ring's earlier windows from memory, else from this region's request and view series.
async fn ring_rows(
    org: &str,
    end: i64,
    interval: i64,
    current: &[SignalRow],
) -> anyhow::Result<Vec<SignalRow>> {
    ring_rows_with(org, end, interval, current, |start, last| {
        cold_ring(org, start, last, interval)
    })
    .await
}

/// [`ring_rows`] with the storage read of windows `(start, last]` passed in.
async fn ring_rows_with<F, Fut>(
    org: &str,
    end: i64,
    interval: i64,
    current: &[SignalRow],
    cold: F,
) -> anyhow::Result<Vec<SignalRow>>
where
    F: FnOnce(i64, i64) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<BTreeMap<i64, Vec<SignalRow>>>>,
{
    let start = end - RING_WINDOWS * interval;
    let held = {
        let rings = RINGS.lock().expect("service signals rings");
        rings.get(org).cloned().unwrap_or_default()
    };
    let contiguous = (1..RING_WINDOWS).all(|n| held.contains_key(&(end - n * interval)));
    let mut ring = if contiguous {
        held
    } else {
        let mut ring = cold(start, end - interval).await?;
        // A read can miss windows this node wrote moments ago, as in a catch-up tick.
        ring.extend(held);
        ring
    };
    ring.insert(end, current.to_vec());
    ring.retain(|at, _| *at > start);
    let rows = ring.values().flatten().cloned().collect();
    RINGS
        .lock()
        .expect("service signals rings")
        .insert(org.to_string(), ring);
    Ok(rows)
}

/// Rebuilds the ring after a restart or a claim: one read per family over the ring's windows.
async fn cold_ring(
    org: &str,
    start: i64,
    end: i64,
    interval: i64,
) -> anyhow::Result<BTreeMap<i64, Vec<SignalRow>>> {
    let mut ring: BTreeMap<i64, Vec<SignalRow>> = BTreeMap::new();
    if end <= start {
        return Ok(ring);
    }
    let grid = ArmGrid {
        start,
        end,
        step: interval,
        hourly: false,
    };
    let cluster = config::get_cluster_name();
    for (family, signal) in [(M_REQUESTS, "traces"), (M_RUM_VIEWS, "rum")] {
        let selector = format!("{family}{{cluster={}}}", metrics::literal(&cluster));
        processor::record_query();
        let value = metrics::range(
            org,
            &metrics::arm_query(&selector, start, end, interval).0,
            grid,
            true,
        )
        .await?;
        for (series, steps) in metrics::step_increases(&value, start, interval) {
            let error = series.label(L_STATUS) == STATUS_ERROR;
            for (t, n) in steps {
                let n = n.round() as u64;
                let image = series.label(L_IMAGE);
                let row = SignalRow {
                    timestamp: t - interval,
                    window_secs: interval / 1_000_000,
                    cluster: cluster.clone(),
                    signal: signal.to_string(),
                    source_stream: series.label(L_SOURCE),
                    service: series.label(L_SERVICE),
                    where_key: series.label(L_WHERE),
                    env: series.label(L_ENV),
                    version: series.label(L_VERSION),
                    image: (!image.is_empty()).then_some(image),
                    min_ts: t - interval,
                    max_ts: t - 1,
                    ..Default::default()
                };
                let rows = ring.entry(t).or_default();
                let held = match rows.iter_mut().find(|r| same_group(r, &row)) {
                    Some(held) => held,
                    None => {
                        rows.push(row);
                        rows.last_mut().expect("just pushed")
                    }
                };
                let (total, errors) = if signal == "traces" {
                    (&mut held.requests, &mut held.errors)
                } else {
                    (&mut held.views, &mut held.error_views)
                };
                *total = Some(total.unwrap_or_default() + n);
                if error {
                    *errors = Some(errors.unwrap_or_default() + n);
                }
            }
        }
    }
    Ok(ring)
}

fn same_group(a: &SignalRow, b: &SignalRow) -> bool {
    (
        &a.signal,
        &a.source_stream,
        &a.service,
        &a.where_key,
        &a.version,
        &a.image,
    ) == (
        &b.signal,
        &b.source_stream,
        &b.service,
        &b.where_key,
        &b.version,
        &b.image,
    )
}

/// Forgets the held rings of orgs `keep` refuses.
pub(super) fn forget_rings(keep: impl Fn(&str) -> bool) {
    RINGS
        .lock()
        .expect("service signals rings")
        .retain(|org, _| keep(org));
}

/// Tags each K1 row with its window, so one read covers many windows.
fn bucketed_k1_sql(sql: &str, interval: i64) -> String {
    sql.replacen(
        "SELECT DISTINCT ",
        &format!(
            "SELECT DISTINCT CAST(FLOOR(_timestamp / {interval}) AS BIGINT) * {interval} AS presence_window, "
        ),
        1,
    )
}

/// K1 hits of a bucketed read, each an observation of its own window.
fn k1_buckets(ctx: &WindowCtx, hits: Vec<serde_json::Value>) -> anyhow::Result<Vec<K1Observation>> {
    let mut images = Vec::new();
    for hit in hits {
        let window_start = hit["presence_window"]
            .as_i64()
            .ok_or_else(|| anyhow::anyhow!("K1 history missing window"))?;
        images.extend(mappers::map_k1(
            &WindowCtx {
                window_start,
                ..ctx.clone()
            },
            &[hit],
        ));
    }
    Ok(images)
}

#[cfg(test)]
mod tests {
    use config::meta::service_identity::scope_key;

    use super::*;

    const RECORDED_TICK: &str = r#"{"window_start": 1792773900000000, "window_end": 1792774800000000, "pods": [{"_timestamp": 1792774500000000, "cluster": "fixture-region", "env": "fixture-cluster", "k8s_cluster": "fixture-cluster", "k8s_container": "app", "k8s_namespace": "fixture-ns", "k8s_pod": "store-pod-2.0", "k8s_workload": "store-workload", "k8s_workload_kind": "deployment", "max_ts": 1792774700000000, "min_ts": 1792774501000000, "service": "store", "source_stream": "default", "spans": 200, "version": "2.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565492884}], "signals": [
        {"_timestamp": 1792774500000000, "cluster": "fixture-region", "env": "fixture-cluster", "errors": 2, "max_ts": 1792774700000000, "min_ts": 1792774501000000, "requests": 200, "service": "store", "signal": "traces", "source_stream": "default", "truncated": false, "version": "1.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565492884},
        {"_timestamp": 1792774500000000, "cluster": "fixture-region", "env": "fixture-cluster", "errors": 2, "max_ts": 1792774700000000, "min_ts": 1792774501000000, "requests": 200, "service": "store", "signal": "traces", "source_stream": "default", "truncated": false, "version": "2.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565492884},
        {"_timestamp": 1792774200000000, "cluster": "fixture-region", "env": "fixture-cluster", "errors": 2, "max_ts": 1792774400000000, "min_ts": 1792774201000000, "requests": 200, "service": "store", "signal": "traces", "source_stream": "default", "truncated": false, "version": "1.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565391829},
        {"_timestamp": 1792774200000000, "cluster": "fixture-region", "env": "fixture-cluster", "errors": 2, "max_ts": 1792774400000000, "min_ts": 1792774201000000, "requests": 200, "service": "store", "signal": "traces", "source_stream": "default", "truncated": false, "version": "2.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565391829},
        {"_timestamp": 1792773900000000, "cluster": "fixture-region", "env": "fixture-cluster", "errors": 2, "max_ts": 1792774100000000, "min_ts": 1792773901000000, "requests": 200, "service": "store", "signal": "traces", "source_stream": "default", "truncated": false, "version": "1.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565265023},
        {"_timestamp": 1792773900000000, "cluster": "fixture-region", "env": "fixture-cluster", "errors": 2, "max_ts": 1792774100000000, "min_ts": 1792773901000000, "requests": 200, "service": "store", "signal": "traces", "source_stream": "default", "truncated": false, "version": "2.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565265023}
    ]}"#;

    #[tokio::test]
    async fn held_windows_survive_a_cold_read_that_lags_the_writer() {
        let org = "ring_lag_fixture";
        let interval = 300_000_000;
        let row = |end: i64| SignalRow {
            timestamp: end - interval,
            signal: "traces".into(),
            service: "store".into(),
            version: "1.0".into(),
            requests: Some(120),
            ..Default::default()
        };
        let lagging = |_, _| async { Ok::<_, anyhow::Error>(BTreeMap::new()) };
        let end = 1_000 * interval;
        for at in [end, end + interval, end + 2 * interval] {
            ring_rows_with(org, at, interval, &[row(at)], lagging)
                .await
                .unwrap();
        }
        let rows = ring_rows_with(
            org,
            end + 3 * interval,
            interval,
            &[row(end + 3 * interval)],
            lagging,
        )
        .await
        .unwrap();
        forget_rings(|held| held != org);
        let starts: Vec<i64> = rows.iter().map(|row| row.timestamp).collect();
        assert_eq!(
            starts,
            (0..4)
                .map(|n| end - interval + n * interval)
                .collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn a_scope_without_changes_writes_no_fenced_batch() {
        let mut calls = 0;
        put_scope_updates(Vec::new(), |_| {
            calls += 1;
            async { Ok(()) }
        })
        .await
        .unwrap();
        assert_eq!(calls, 0);
        put_scope_updates(vec![Model::default()], |rows| {
            calls += 1;
            assert_eq!(rows.len(), 1);
            async { Ok(()) }
        })
        .await
        .unwrap();
        assert_eq!(calls, 1);
    }

    #[tokio::test]
    async fn orgs_with_work_are_the_evaluating_and_recently_deployed_ones() {
        use infra::table::{
            entity::service_version_verdicts,
            service_versions::{create_tables_for_tests, sqlite_and_postgres_for_tests},
        };
        use sea_orm::{ActiveModelTrait, IntoActiveModel};
        use sha2::Digest;
        let hour = 3_600_000_000;
        let end = 100 * hour;
        for conn in sqlite_and_postgres_for_tests("orgs_with_work").await {
            create_tables_for_tests(&conn).await.unwrap();
            for (org, kind, at) in [
                ("deployed_today", "deploy", end - 2 * hour),
                ("deployed_yesterday", "deploy", end - 25 * hour),
                ("pre_existing_today", "pre_existing", end - hour),
            ] {
                table::put(
                    &conn,
                    Model {
                        deploy_key: format!(
                            "{:x}",
                            sha2::Sha256::digest(
                                json!([org, "svc", "w", config::get_cluster_name(), "v2", at])
                                    .to_string()
                                    .as_bytes()
                            )
                        ),
                        org_id: org.into(),
                        service_name: "svc".into(),
                        where_key: "w".into(),
                        scope_key: format!("{org}-scope"),
                        cluster: config::get_cluster_name(),
                        to_version: "v2".into(),
                        to_version_key: format!("{org}-v2"),
                        kind: kind.into(),
                        entry_source: "traffic".into(),
                        at,
                        serving_versions: "[]".into(),
                        full_serving: "[]".into(),
                        source_streams: "[]".into(),
                        created_at: at,
                        updated_at: at,
                        ..Default::default()
                    },
                )
                .await
                .unwrap();
            }
            for (org, state) in [("judging", "evaluating"), ("judged", "frozen")] {
                let row = service_version_verdicts::Model {
                    verdict_key: format!("{org}-verdict"),
                    org_id: org.into(),
                    cluster: config::get_cluster_name(),
                    state: state.into(),
                    ..Default::default()
                }
                .into_active_model()
                .reset_all();
                service_version_verdicts::Entity::insert(row)
                    .exec(&conn)
                    .await
                    .unwrap();
            }
            let orgs = orgs_with_work_with(&conn, end).await.unwrap();
            assert_eq!(
                orgs.iter().map(String::as_str).collect::<Vec<_>>(),
                ["deployed_today", "judging"]
            );
        }
    }

    #[tokio::test]
    async fn a_contiguous_window_reads_only_its_newest_k1_windows_and_a_gap_only_itself() {
        let interval = 300_000_000;
        let end = 1_000 * interval;
        let reads = std::sync::Mutex::new(Vec::new());
        let read = |request: HistoryRead| {
            reads.lock().unwrap().push(request);
            async { Ok(Vec::new()) }
        };
        let first = load_history("org", None, end, interval, &[], 1, &read)
            .await
            .unwrap();
        let next = end + interval;
        let second = load_history("org", Some(first), next, interval, &[], 1, &read)
            .await
            .unwrap();
        let gap = next + 3 * interval;
        load_history("org", Some(second), gap, interval, &[], 1, &read)
            .await
            .unwrap();
        let day = |end: i64| {
            [
                HistoryRead::Pods {
                    start: end - HISTORY_US,
                    end,
                },
                HistoryRead::Events {
                    start: end - HISTORY_US,
                    end,
                },
                HistoryRead::Images {
                    stream: K1_STREAMS[0],
                    start: end - HISTORY_US,
                    end,
                },
                HistoryRead::Images {
                    stream: K1_STREAMS[1],
                    start: end - HISTORY_US,
                    end,
                },
            ]
        };
        let mut expected = day(end).to_vec();
        expected.extend(K1_STREAMS.map(|stream| HistoryRead::Images {
            stream,
            start: next - 3 * interval,
            end: next,
        }));
        // The kept day stands for storage up to its end, so after a gap only the gap is read.
        expected.extend([
            HistoryRead::Pods {
                start: next,
                end: gap - interval,
            },
            HistoryRead::Events {
                start: next,
                end: gap,
            },
        ]);
        expected.extend(K1_STREAMS.map(|stream| HistoryRead::Images {
            stream,
            start: reread_from(next + interval, interval),
            end: gap,
        }));
        assert_eq!(*reads.lock().unwrap(), expected);
    }

    #[tokio::test]
    async fn a_day_kept_in_memory_matches_the_day_read_after_a_restart() {
        use std::sync::Mutex;
        let interval = 300_000_000;
        let pods: Mutex<Vec<serde_json::Value>> = Mutex::default();
        let images: Mutex<Vec<(&str, serde_json::Value)>> = Mutex::default();
        let events: Mutex<Vec<serde_json::Value>> = Mutex::default();
        fn newest(
            rows: Vec<serde_json::Value>,
            key: impl Fn(&serde_json::Value) -> String,
            rank: impl Fn(&serde_json::Value) -> (i64, i64, i64),
        ) -> Vec<serde_json::Value> {
            let mut kept: BTreeMap<String, serde_json::Value> = BTreeMap::new();
            for row in rows {
                if kept
                    .get(&key(&row))
                    .is_none_or(|stored| rank(stored) <= rank(&row))
                {
                    kept.insert(key(&row), row);
                }
            }
            kept.into_values().collect()
        }
        let read = |request: HistoryRead| {
            let at = |row: &serde_json::Value, field: &str| row[field].as_i64().unwrap();
            let rows = match request {
                HistoryRead::Pods { start, end } => newest(
                    pods.lock()
                        .unwrap()
                        .iter()
                        .filter(|row| (start..end).contains(&at(row, "_timestamp")))
                        .cloned()
                        .collect(),
                    |row: &serde_json::Value| {
                        [
                            "cluster",
                            "source_stream",
                            "service",
                            "where_key",
                            "version",
                            "k8s_pod",
                            "k8s_container",
                        ]
                        .iter()
                        .fold(at(row, "_timestamp").to_string(), |key, field| {
                            format!("{key}|{}", row[*field])
                        })
                    },
                    |row: &serde_json::Value| (at(row, "generation"), at(row, "written_at"), 0),
                ),
                HistoryRead::Events { start, end } => newest(
                    events
                        .lock()
                        .unwrap()
                        .iter()
                        .filter(|row| (start..=end).contains(&at(row, "_timestamp")))
                        .cloned()
                        .collect(),
                    |row: &serde_json::Value| format!("{}|{}", row["deploy_key"], row["event"]),
                    |row: &serde_json::Value| {
                        (
                            at(row, "_timestamp"),
                            at(row, "generation"),
                            at(row, "written_at"),
                        )
                    },
                ),
                HistoryRead::Images { stream, start, end } => {
                    let mut hits: Vec<serde_json::Value> = Vec::new();
                    for (name, hit) in images.lock().unwrap().iter() {
                        if *name == stream
                            && (start..end).contains(&at(hit, "presence_window"))
                            && !hits.contains(hit)
                        {
                            hits.push(hit.clone());
                        }
                    }
                    hits
                }
            };
            async move { Ok(rows) }
        };
        let first_end = 2_000 * interval;
        let mut kept: Option<OrgHistory> = None;
        let mut last_end = first_end;
        for window in 0..320_i64 {
            let end = first_end + window * interval;
            last_end = end;
            let generation = 10 + window / 6;
            let attempts: &[(i64, usize)] = if window % 7 == 3 {
                &[(generation, 3), (generation + 1, 2)]
            } else {
                &[(generation, 3)]
            };
            for (attempt, (generation, count)) in attempts.iter().enumerate() {
                let produced: Vec<PodRow> = (0..*count)
                    .map(|pod| PodRow {
                        timestamp: end - interval,
                        written_at: 1_000 * window + attempt as i64,
                        cluster: "c1".into(),
                        source_stream: "default".into(),
                        service: "svc".into(),
                        where_key: "w".into(),
                        version: format!("v{}", window / 100),
                        k8s_pod: format!("pod-{pod}"),
                        k8s_container: "app".into(),
                        spans: (window as u64 + 1) * (attempt as u64 + 1),
                        ..Default::default()
                    })
                    .collect();
                for pod in &produced {
                    let mut row = serde_json::to_value(pod).unwrap();
                    row["generation"] = json!(generation);
                    pods.lock().unwrap().push(row);
                }
                let hit = |bucket: i64, pod: String| {
                    json!({
                        "presence_window": bucket,
                        "image": format!("registry/svc:v{}", window / 100),
                        "namespace": "ns",
                        "pod": pod,
                        "container": "app",
                        "k8s_cluster": "k1",
                    })
                };
                images
                    .lock()
                    .unwrap()
                    .push((K1_STREAMS[0], hit(end - interval, "pod-0".into())));
                if window % 2 == 0 {
                    images
                        .lock()
                        .unwrap()
                        .push((K1_STREAMS[1], hit(end - interval, "pod-1".into())));
                }
                if window % 5 == 0 {
                    images.lock().unwrap().push((
                        K1_STREAMS[0],
                        hit(end - 2 * interval, format!("late-{window}")),
                    ));
                }
                if window % 5 == 1 {
                    images.lock().unwrap().push((
                        K1_STREAMS[1],
                        hit(end - 3 * interval, format!("later-{window}")),
                    ));
                }
                let mut history = load_history(
                    "org",
                    kept.take(),
                    end,
                    interval,
                    &produced,
                    *generation,
                    &read,
                )
                .await
                .unwrap();
                let event = json!({
                    "deploy_key": format!("d{}", window % 4),
                    "event": if window % 3 == 0 { "verdict_changed" } else { "frozen" },
                    "_timestamp": end,
                    "generation": generation,
                    "written_at": 1_000 * window + attempt as i64,
                });
                events.lock().unwrap().push(event.clone());
                history.merge_event(event);
                kept = Some(history);
            }
        }
        let kept = kept.unwrap();
        let restarted = load_history("org", None, last_end, interval, &[], 0, &read)
            .await
            .unwrap();
        let debug = |images: Vec<K1Observation>| {
            let mut images: Vec<_> = images.iter().map(|image| format!("{image:?}")).collect();
            images.sort();
            images
        };
        assert_eq!(kept.pods(), restarted.pods());
        assert_eq!(debug(kept.images()), debug(restarted.images()));
        for (kept, restarted) in kept.presence().into_iter().zip(restarted.presence()) {
            assert_eq!(debug(kept), debug(restarted));
        }
        assert_eq!(kept.events(), restarted.events());
        assert_eq!(kept.pods().len(), 288 * 3);
        assert!(!kept.images().is_empty() && !kept.presence()[1].is_empty());
        assert!(
            kept.pods()
                .iter()
                .all(|pod| pod.timestamp >= last_end - HISTORY_US)
        );
    }

    #[tokio::test]
    async fn a_k1_sample_three_windows_late_is_in_the_kept_day() {
        let interval = 60_000_000;
        let first = 100_000 * interval;
        let hits: std::sync::Mutex<Vec<serde_json::Value>> = std::sync::Mutex::default();
        let rebuilds = std::sync::atomic::AtomicUsize::new(0);
        let read = |request: HistoryRead| {
            let rows = match request {
                HistoryRead::Images { stream, start, end } if stream == K1_STREAMS[0] => hits
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|hit| (start..end).contains(&hit["presence_window"].as_i64().unwrap()))
                    .cloned()
                    .collect(),
                HistoryRead::Pods { .. } => {
                    rebuilds.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Vec::new()
                }
                _ => Vec::new(),
            };
            async move { Ok(rows) }
        };
        let hit = |bucket: i64, pod: &str| {
            json!({
                "presence_window": bucket,
                "image": "registry/svc:v1",
                "namespace": "ns",
                "pod": pod,
                "container": "app",
                "k8s_cluster": "k1",
            })
        };
        let mut kept = load_history("org", None, first, interval, &[], 1, &read)
            .await
            .unwrap();
        for window in 1..=4 {
            let end = first + window * interval;
            hits.lock().unwrap().push(hit(end - interval, "on-time"));
            if window == 4 {
                hits.lock().unwrap().push(hit(first, "three-windows-late"));
            }
            kept = load_history("org", Some(kept), end, interval, &[], 1, &read)
                .await
                .unwrap();
        }
        assert_eq!(rebuilds.load(std::sync::atomic::Ordering::SeqCst), 1);
        let late: Vec<_> = kept
            .images()
            .into_iter()
            .filter(|image| image.pod == "three-windows-late")
            .collect();
        assert_eq!(late.len(), 1);
        assert_eq!(late[0].window_start, first);
    }

    #[tokio::test]
    async fn contiguous_windows_rebuild_the_day_every_hour() {
        let interval = 300_000_000;
        let first = 1_000 * interval;
        let rebuilt_at = std::sync::Mutex::new(Vec::new());
        let read = |request: HistoryRead| {
            if let HistoryRead::Pods { end, .. } = request {
                rebuilt_at.lock().unwrap().push(end);
            }
            async { Ok(Vec::new()) }
        };
        let mut kept = None;
        for window in 0..=24 {
            kept = Some(
                load_history(
                    "org",
                    kept,
                    first + window * interval,
                    interval,
                    &[],
                    1,
                    &read,
                )
                .await
                .unwrap(),
            );
        }
        assert_eq!(
            *rebuilt_at.lock().unwrap(),
            [first, first + 12 * interval, first + 24 * interval]
        );
    }

    #[test]
    fn history_bounds_follow_the_service_count_and_count_what_is_dropped() {
        let event = |deploy: usize, service: usize| json!({"deploy_key": deploy.to_string(), "event": "frozen", "service": format!("s{service}")});
        let mut few = OrgHistory::default();
        for deploy in 0..=1_000 {
            few.merge_event(event(deploy, 0));
        }
        // One service: the floor of 1,000 events applies.
        assert!(few.overflow() > 0);
        let mut many = OrgHistory::default();
        for deploy in 0..1_200 {
            many.merge_event(event(deploy, deploy % 600));
        }
        assert_eq!(many.overflow(), 0);
        many.merge_event(event(1_200, 0));
        assert_eq!(many.overflow(), 1);
        let org = "history-bound-org";
        let mut kept = OrgHistory {
            end: 10,
            ..OrgHistory::default()
        };
        for deploy in 0..1_000 {
            kept.merge_event(event(deploy, 0));
        }
        HISTORY.lock().unwrap().insert(org.to_string(), kept);
        let before = super::super::writer::dropped(org, super::super::writer::KIND_HISTORY);
        remember_event(org, 10, &event(1_000, 0));
        assert!(!HISTORY.lock().unwrap().contains_key(org));
        assert_eq!(
            super::super::writer::dropped(org, super::super::writer::KIND_HISTORY) - before,
            1
        );
    }

    #[tokio::test]
    async fn a_restart_with_a_valid_snapshot_reads_no_day_and_no_ring() {
        use super::super::{processor::QUERY_COUNT, snapshot, writer};
        let org = "snapshot-restart-org";
        let interval = 300_000_000;
        let end = 1_000 * interval;
        let reads = Mutex::new(Vec::new());
        let read = |what: HistoryRead| {
            reads.lock().unwrap().push(what);
            async { Ok(Vec::new()) }
        };
        let day = |reads: &Mutex<Vec<HistoryRead>>| {
            reads
                .lock()
                .unwrap()
                .iter()
                .filter(|r| !matches!(r, HistoryRead::Images { .. }))
                .count()
        };
        let history = load_history(org, None, end, interval, &[], 1, read)
            .await
            .unwrap();
        assert_eq!(
            day(&reads),
            2,
            "a cold start reads the day of pods and events"
        );
        let ring = (0..RING_WINDOWS)
            .map(|n| (end - n * interval, Vec::new()))
            .collect();
        restore(
            org,
            Kept {
                ring,
                history: Some((&history).into()),
            },
        );
        writer::state(org).lock().await.last_end = Some(end);
        let taken = snapshot::capture(org, end, "previous-run", end).await;
        let dir = std::env::temp_dir().join(format!("svcsig-restart-{}", config::ider::generate()));
        assert!(snapshot::write_to(&dir, &taken).unwrap());
        // The restart: nothing in memory, the snapshot on disk.
        forget_history(|o| o != org);
        forget_rings(|o| o != org);
        writer::forget(|o| o != org);
        let expect = snapshot::Expect {
            cluster: &taken.header.cluster,
            owner_node: "previous-run",
            window_secs: taken.header.window_secs,
        };
        let loaded = snapshot::load_dir(&dir).pop().unwrap();
        assert_eq!(
            snapshot::accepts(&loaded.header, &expect, Some(end)),
            snapshot::Restore::All
        );
        snapshot::install(loaded, snapshot::Restore::All);
        reads.lock().unwrap().clear();
        let previous = HISTORY.lock().unwrap().remove(org);
        load_history(org, previous, end + interval, interval, &[], 1, read)
            .await
            .unwrap();
        assert_eq!(day(&reads), 0, "a restored day is topped up, not re-read");
        let ring_reads = QUERY_COUNT
            .scope(std::cell::Cell::new(0), async {
                ring_rows(org, end + interval, interval, &[]).await.unwrap();
                QUERY_COUNT.with(std::cell::Cell::get)
            })
            .await;
        assert_eq!(ring_reads, 0, "a restored ring is not read back");
        assert_eq!(writer::state(org).lock().await.last_end, Some(end));
        forget_history(|o| o != org);
        forget_rings(|o| o != org);
        writer::forget(|o| o != org);
        std::fs::remove_file(dir.join(format!("{org}.json.zst"))).unwrap();
        std::fs::remove_dir(&dir).unwrap();
    }

    #[tokio::test]
    async fn a_restart_windows_after_the_snapshot_tops_up_the_gap_and_drops_the_series() {
        use super::super::{snapshot, writer};
        let org = "snapshot-advanced-org";
        let interval = 300_000_000;
        let end = 1_000 * interval;
        let reads = Mutex::new(Vec::new());
        let read = |what: HistoryRead| {
            reads.lock().unwrap().push(what);
            async { Ok(Vec::new()) }
        };
        let history = load_history(org, None, end, interval, &[], 1, read)
            .await
            .unwrap();
        restore(
            org,
            Kept {
                ring: BTreeMap::new(),
                history: Some((&history).into()),
            },
        );
        writer::state(org).lock().await.last_end = Some(end);
        let taken = snapshot::capture(org, end, "previous-run", end).await;
        let dir =
            std::env::temp_dir().join(format!("svcsig-advanced-{}", config::ider::generate()));
        assert!(snapshot::write_to(&dir, &taken).unwrap());
        forget_history(|o| o != org);
        forget_rings(|o| o != org);
        writer::forget(|o| o != org);
        let expect = snapshot::Expect {
            cluster: &taken.header.cluster,
            owner_node: "previous-run",
            window_secs: taken.header.window_secs,
        };
        // The previous run went on for three windows after its last snapshot.
        let cursor = end + 3 * interval;
        let loaded = snapshot::load_dir(&dir).pop().unwrap();
        let kind = snapshot::accepts(&loaded.header, &expect, Some(cursor));
        assert_eq!(kind, snapshot::Restore::History);
        snapshot::install(loaded, kind);
        assert_eq!(
            writer::state(org).lock().await.last_end,
            None,
            "stale cumulatives are not continued"
        );
        reads.lock().unwrap().clear();
        let previous = HISTORY.lock().unwrap().remove(org);
        assert!(previous.is_some(), "the day is restored");
        load_history(org, previous, cursor + interval, interval, &[], 1, read)
            .await
            .unwrap();
        let day: Vec<HistoryRead> = reads
            .lock()
            .unwrap()
            .iter()
            .filter(|r| !matches!(r, HistoryRead::Images { .. }))
            .copied()
            .collect();
        assert_eq!(
            day,
            vec![
                HistoryRead::Pods {
                    start: end,
                    end: cursor
                },
                HistoryRead::Events {
                    start: end,
                    end: cursor + interval
                },
            ],
            "only the gap is read"
        );
        let images_from = reads.lock().unwrap().iter().find_map(|r| match r {
            HistoryRead::Images { start, .. } => Some(*start),
            _ => None,
        });
        assert_eq!(images_from, Some(reread_from(end + interval, interval)));
        let mut far = snapshot::accepts(&taken.header, &expect, Some(end + HISTORY_US));
        assert_eq!(far, snapshot::Restore::Nothing, "a day behind rebuilds");
        far = snapshot::accepts(
            &taken.header,
            &snapshot::Expect {
                owner_node: "another-node",
                ..expect
            },
            Some(cursor),
        );
        assert_eq!(far, snapshot::Restore::Nothing);
        forget_history(|o| o != org);
        forget_rings(|o| o != org);
        writer::forget(|o| o != org);
        std::fs::remove_file(dir.join(format!("{org}.json.zst"))).unwrap();
        std::fs::remove_dir(&dir).unwrap();
    }

    fn two_spellings(end: i64, interval: i64) -> Live {
        let place = "k8s:c/ns";
        let mut rows = Vec::new();
        for n in 0..RING_WINDOWS {
            for (service, version) in [("Checkout", "1.0"), ("checkout.service", "2.0")] {
                rows.push(SignalRow {
                    timestamp: end - (n + 1) * interval,
                    signal: "traces".into(),
                    service: service.into(),
                    where_key: place.into(),
                    version: version.into(),
                    requests: Some(100),
                    ..Default::default()
                });
            }
        }
        let pods = [("Checkout", "1.0", "a"), ("checkout.service", "2.0", "b")]
            .map(|(service, version, pod)| PodRow {
                timestamp: end - interval,
                service: service.into(),
                where_key: place.into(),
                version: version.into(),
                k8s_pod: pod.into(),
                spans: 50,
                ..Default::default()
            })
            .to_vec();
        Live::of(&rows, &pods)
    }

    #[test]
    fn two_spellings_of_a_service_serving_together_are_one_scope_over_many_windows() {
        let interval = 300_000_000;
        let first = 1_000 * interval;
        let place = "k8s:c/ns";
        let both = BTreeSet::from(["1.0".to_string(), "2.0".to_string()]);
        let mut serving: Vec<ServingVersion> = vec![];
        let mut current = None;
        let mut history = vec![];
        for n in 0..4 {
            let end = first + n * interval;
            let live = two_spellings(end, interval);
            let key = ServiceKey::of("checkout");
            assert_eq!(live.display(&key, place, None), "checkout.service");
            let day = (live.pods.clone(), [vec![], vec![]], vec![], vec![]);
            let ring = Ring::new(live.rows, end - RING_WINDOWS * interval, end, interval, day);
            assert_eq!(
                ring.scopes(),
                BTreeSet::from([(key.clone(), place.to_string())])
            );
            for spelling in ["Checkout", "checkout", "checkout.service"] {
                let windows = ring.windows(&ServiceKey::of(spelling), place);
                assert!(windows.iter().all(|w| w.counts.len() == 2), "{spelling}");
                assert_eq!(
                    agreement(&ring, &ServiceKey::of(spelling), place).1,
                    100,
                    "{spelling}"
                );
            }
            assert!(ring.pods.iter().all(|pod| pod.service == "checkout"));
            let input = DetectInput {
                org_id: "two_spellings".into(),
                service_name: "checkout.service".into(),
                where_key: place.into(),
                cluster: String::new(),
                epoch: ring.epoch,
                now: end,
                window_us: interval,
                windows: ring.windows(&key, place),
                serving: serving.clone(),
                current: current.clone(),
                history: history.clone(),
                first_seen: BTreeMap::new(),
                pod_entries: vec![],
            };
            let detection = deploys::detect(&input);
            if n > 0 {
                assert!(
                    detection.transitions.is_empty(),
                    "window {n}: {:?}",
                    detection.transitions
                );
            }
            let versions: BTreeSet<String> = detection
                .serving
                .iter()
                .map(|s| s.version.clone())
                .collect();
            assert_eq!(versions, both, "window {n}");
            serving = detection.serving.clone();
            if let Some(last) = detection.transitions.last() {
                let stored = model(last, &detection.serving).unwrap();
                current = Some(transition(&stored).unwrap());
                history.extend(detection.transitions.clone());
            }
        }
    }

    #[tokio::test]
    async fn a_repeated_suffix_is_one_scope_across_live_restored_and_cold_rows() {
        use super::super::{snapshot, writer};
        let org = "repeated-suffix-org";
        let place = "k8s:c/ns";
        let raw = "A.service.service";
        let interval = 300_000_000;
        let end = 1_000 * interval;
        let previous = end - interval;
        let row = |at: i64, service: &str| SignalRow {
            timestamp: at - interval,
            signal: "traces".into(),
            service: service.into(),
            where_key: place.into(),
            version: "1.0".into(),
            requests: Some(10),
            ..Default::default()
        };
        let pod = |at: i64, service: &str, name: &str| PodRow {
            timestamp: at - interval,
            service: service.into(),
            where_key: place.into(),
            version: "1.0".into(),
            k8s_pod: name.into(),
            spans: 5,
            ..Default::default()
        };
        let read = |what: HistoryRead| {
            let rows = match what {
                HistoryRead::Pods { .. } => {
                    vec![pod(previous - interval, "a.service", "read-back").to_json()]
                }
                _ => vec![],
            };
            async move { Ok(rows) }
        };
        let empty = |_, _| async { Ok::<_, anyhow::Error>(BTreeMap::new()) };
        let before = Live::of(&[row(previous, raw)], &[pod(previous, raw, "live-1")]);
        ring_rows_with(org, previous, interval, &before.rows, empty)
            .await
            .unwrap();
        let history = load_history(org, None, previous, interval, &before.pods, 1, read)
            .await
            .unwrap();
        HISTORY.lock().unwrap().insert(org.to_string(), history);
        writer::state(org).lock().await.last_end = Some(previous);
        let taken = snapshot::capture(org, previous, "previous-run", previous).await;
        let dir = std::env::temp_dir().join(format!("svcsig-suffix-{}", config::ider::generate()));
        assert!(snapshot::write_to(&dir, &taken).unwrap());
        forget_history(|o| o != org);
        forget_rings(|o| o != org);
        writer::forget(|o| o != org);
        snapshot::install(
            snapshot::load_dir(&dir).pop().unwrap(),
            snapshot::Restore::All,
        );
        let cold = |start: i64, last: i64| {
            let ring: BTreeMap<i64, Vec<SignalRow>> = (1..RING_WINDOWS)
                .map(|n| start + n * interval)
                .filter(|at| *at <= last)
                .map(|at| (at, vec![row(at, "a.service")]))
                .collect();
            async move { Ok::<_, anyhow::Error>(ring) }
        };
        let live = Live::of(&[row(end, raw)], &[pod(end, raw, "live-2")]);
        let rows = ring_rows_with(org, end, interval, &live.rows, cold)
            .await
            .unwrap();
        let restored = HISTORY.lock().unwrap().remove(org);
        let day = load_history(org, restored, end, interval, &live.pods, 1, read)
            .await
            .unwrap();
        let day = (day.pods(), day.presence(), day.images(), day.events());
        let ring = Ring::new(rows, end - RING_WINDOWS * interval, end, interval, day);
        forget_history(|o| o != org);
        forget_rings(|o| o != org);
        writer::forget(|o| o != org);
        std::fs::remove_file(dir.join(format!("{org}.json.zst"))).unwrap();
        std::fs::remove_dir(&dir).unwrap();
        let key = ServiceKey::of(raw);
        assert_eq!(key.as_str(), "a.service");
        assert_eq!(
            ring.scopes(),
            BTreeSet::from([(key.clone(), place.to_string())])
        );
        assert_eq!(
            ring.scope_keys(org),
            BTreeSet::from([scope_key(org, raw, place)])
        );
        assert_eq!(live.display(&key, place, None), raw);
        assert_eq!(
            ServiceKey::of(&Live::of(&[], &[]).display(&key, place, Some("a.service"))),
            key,
            "a stored name that keys elsewhere is not shown"
        );
        let windows = ring.windows(&key, place);
        assert_eq!(
            windows
                .iter()
                .filter(|w| w.counts.values().sum::<u64>() == 10)
                .count(),
            RING_WINDOWS as usize,
            "{windows:?}"
        );
        assert_eq!(agreement(&ring, &key, place).1, 15);
        assert!(ring.pods.iter().all(|pod| pod.service == "a.service"));
    }

    #[test]
    fn recorded_pods_require_actual_typed_k1_sources() {
        let fixture: serde_json::Value = serde_json::from_str(RECORDED_TICK).unwrap();
        let pods: Vec<PodRow> = serde_json::from_value(fixture["pods"].clone()).unwrap();
        let pod = pods.first().unwrap().clone();
        let end = fixture["window_end"].as_i64().unwrap();
        let observation = |stream: &str, start| K1Observation {
            source_stream: format!("metrics/{stream}"),
            window_start: start,
            namespace: pod.k8s_namespace.clone(),
            pod: pod.k8s_pod.clone(),
            container: pod.k8s_container.clone(),
            k8s_cluster: pod.k8s_cluster.clone(),
            version: pod.version.clone(),
            image: None,
            image_ref: None,
        };
        let mut ring = Ring {
            rows: vec![],
            epoch: end - 8 * 300_000_000,
            end,
            interval: 300_000_000,
            pods: vec![pod.clone()],
            presence: std::array::from_fn(|i| {
                vec![observation(
                    "k8s_container_ready",
                    end - (2 - i as i64) * 300_000_000,
                )]
            }),
            images: vec![observation("k8s_container_ready", end - 300_000_000)],
            presence_history: BTreeMap::new(),
            events: vec![],
        };
        ring.images = vec![
            observation("k8s_container_ready", end - 3 * ring.interval),
            observation("k8s_container_ready", end - 2 * ring.interval),
            observation("k8s_container_ready", end - ring.interval),
        ];
        ring.presence_history = presence_history(&ring.images, &ring.pods, ring.end);
        let entries = pod_entries(
            &ring,
            &ServiceKey::of(&pod.service),
            &pod.where_key,
            &BTreeMap::new(),
        );
        assert_eq!(entries[0].first_window, end - 3 * ring.interval);
        ring.end += ring.interval;
        ring.images
            .push(observation("k8s_container_ready", ring.end - ring.interval));
        ring.presence_history = presence_history(&ring.images, &ring.pods, ring.end);
        assert_eq!(
            pod_entries(
                &ring,
                &ServiceKey::of(&pod.service),
                &pod.where_key,
                &BTreeMap::new()
            )[0]
            .first_window,
            entries[0].first_window
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source_streams, ["metrics/k8s_container_ready"]);
        for (i, window) in ring.presence.iter_mut().enumerate() {
            window.push(observation(
                "kube_pod_container_info",
                end - (2 - i as i64) * 300_000_000,
            ));
        }
        assert_eq!(
            pod_entries(
                &ring,
                &ServiceKey::of(&pod.service),
                &pod.where_key,
                &BTreeMap::new()
            )[0]
            .source_streams,
            [
                "metrics/k8s_container_ready",
                "metrics/kube_pod_container_info"
            ]
        );
    }

    #[test]
    fn recorded_ingest_ring_survives_restart_without_duplicate_entries() {
        let fixture: serde_json::Value = serde_json::from_str(RECORDED_TICK).unwrap();
        let rows: Vec<SignalRow> = serde_json::from_value(fixture["signals"].clone()).unwrap();
        let sample = rows
            .iter()
            .find(|row| row.signal == "traces")
            .unwrap()
            .clone();
        let end = fixture["window_end"].as_i64().unwrap();
        let ring = Ring {
            rows,
            epoch: fixture["window_start"].as_i64().unwrap(),
            end,
            interval: 300_000_000,
            pods: vec![],
            presence: [vec![], vec![]],
            images: vec![],
            presence_history: BTreeMap::new(),
            events: vec![],
        };
        let mut input = DetectInput {
            org_id: "restart_fixture".into(),
            service_name: sample.service.clone(),
            where_key: sample.where_key.clone(),
            cluster: sample.cluster,
            epoch: ring.epoch,
            now: end,
            window_us: ring.interval,
            windows: ring.windows(&ServiceKey::of(&sample.service), &sample.where_key),
            serving: vec![],
            current: None,
            history: vec![],
            first_seen: BTreeMap::new(),
            pod_entries: vec![],
        };
        let detection = deploys::detect(&input);
        assert_eq!(detection.transitions.len(), 2);
        assert!(
            detection
                .transitions
                .iter()
                .all(|row| row.kind == deploys::Kind::PreExisting && row.verdict_key.is_none())
        );
        let last = detection.transitions.last().unwrap();
        let stored = model(last, &detection.serving).unwrap();
        assert_eq!(transition(&stored).unwrap(), *last);
        input.serving = serde_json::from_str(&stored.full_serving).unwrap();
        input.current = Some(transition(&stored).unwrap());
        input.history = detection.transitions;
        assert!(deploys::detect(&input).transitions.is_empty());
    }
}
