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

//! Compare and verdict arms read from the service-signal metrics streams (D232).

use std::collections::{BTreeMap, BTreeSet, HashMap};

use config::{
    meta::service_identity::{VersionImage, service_key},
    utils::time::SECOND_MICRO_SECS,
};
use futures::StreamExt;
use o2_enterprise::enterprise::service_identity::{
    compare::{EndpointArm, ErrorEvidence},
    signals::{
        histogram::Histogram,
        series::{
            L_CLUSTER, L_FINGERPRINT, L_IMAGE, L_OPERATION, L_SERVICE, L_SOURCE, L_STATUS,
            L_VERSION, L_VITAL, L_WHERE, M_DURATION, M_ENDPOINT_DURATION, M_ENDPOINT_REQUESTS,
            M_PAGE_ERRORS, M_PAGE_VIEWS, M_PAGE_VITALS, M_REQUESTS, M_RUM_ERROR_TYPES,
            M_RUM_ERRORS, M_RUM_SESSIONS, M_RUM_VIEWS, M_RUM_VITALS, STATUS_ERROR, VITALS,
        },
    },
};

use super::{
    api::{Aggregate, Selection},
    metrics::{self, ArmGrid, SeriesIncrease},
};

// Verdict reads of every org share these, so the processor never queues on its own search slots.
static BACKGROUND_READS: std::sync::LazyLock<tokio::sync::Semaphore> =
    std::sync::LazyLock::new(|| tokio::sync::Semaphore::new(read_slots()));
// "Live" traffic is what an arm saw in its last ten minutes.
const LATEST_MICROS: i64 = 600 * SECOND_MICRO_SECS;
const TRACE_FAMILIES: [&str; 4] = [
    M_REQUESTS,
    M_DURATION,
    M_ENDPOINT_REQUESTS,
    M_ENDPOINT_DURATION,
];
const RUM_FAMILIES: [&str; 5] = [
    M_RUM_VIEWS,
    M_RUM_ERRORS,
    M_RUM_SESSIONS,
    M_RUM_VITALS,
    M_RUM_ERROR_TYPES,
];
const PAGE_FAMILIES: [&str; 3] = [M_PAGE_VIEWS, M_PAGE_ERRORS, M_PAGE_VITALS];

/// Per-series increases of each family an arm reads.
type Families = HashMap<&'static str, Vec<SeriesIncrease>>;

/// Reads every selection's arm; `window` is the processor window the series were written at.
pub async fn read(
    org: &str,
    selections: &[&Selection<'_>],
    window: i64,
    now: i64,
    background: bool,
) -> anyhow::Result<Vec<Aggregate>> {
    let mut queries = Vec::new();
    let mut grids = Vec::with_capacity(selections.len());
    for (index, selection) in selections.iter().enumerate() {
        let grid = metrics::arm_grid(selection.window.start, selection.window.end, window, now);
        grids.push(grid);
        if selection.streams.is_empty() || selection.window.end <= selection.window.start {
            continue;
        }
        let matcher = matcher(selection);
        for family in families(selection.signal) {
            let (query, ..) = metrics::arm_query(
                &format!("{}{{{matcher}}}", series_name(family)),
                grid.start,
                grid.end,
                grid.step,
            );
            queries.push((index, family, query, grid, selection.local));
        }
    }
    let mut read: Vec<Families> = (0..selections.len()).map(|_| Families::new()).collect();
    // Collected first: a closure in the stream's type makes the jobs' Send proof higher-ranked.
    let reads: Vec<_> = queries
        .into_iter()
        .map(|(index, family, query, grid, local)| async move {
            super::processor::record_query();
            let value = gated(background, metrics::range(org, &query, grid, local)).await?;
            let latest = grid.end - LATEST_MICROS;
            Ok::<_, anyhow::Error>((
                index,
                family,
                metrics::increases(&value, grid.start, grid.step, latest),
            ))
        })
        .collect();
    let mut results = futures::stream::iter(reads).buffer_unordered(read_slots());
    while let Some(result) = results.next().await {
        let (index, family, series) = result?;
        read[index].insert(family, series);
    }
    Ok(selections
        .iter()
        .zip(read)
        .zip(grids)
        .map(|((selection, families), grid)| {
            with_basis(
                aggregate(selection.signal, &selection.identity(), &families),
                grid.hourly,
            )
        })
        .collect())
}

/// The arm's aggregate for the selected version and, under `versions`, for every version read.
pub fn aggregate(signal: &str, version: &VersionImage, families: &Families) -> Aggregate {
    let mut versions = per_version(signal, families);
    let primary = if signal == "traces" {
        M_REQUESTS
    } else if signal == "rum_page" {
        M_PAGE_VIEWS
    } else {
        M_RUM_VIEWS
    };
    let mut result = if signal == "traces" {
        versions.get(version).cloned().unwrap_or_default()
    } else {
        // RUM series carry the version text only, so they belong to every image of it.
        versions
            .iter()
            .find(|(v, _)| v.version == version.version)
            .map(|(_, arm)| arm.clone())
            .unwrap_or_default()
    };
    for s in families.get(primary).into_iter().flatten() {
        let item = result.volumes.entry(identity(signal, s)).or_default();
        item.0 += s.total.round() as u64;
        item.1 += s.latest.round() as u64;
        result.total += s.total.round() as u64;
    }
    for arm in versions.values_mut() {
        arm.volumes = result.volumes.clone();
        arm.total = result.total;
    }
    result.versions = versions;
    result
}

// Reads run as the internal user, so each is admitted under that user's Short slots of its org.
fn read_slots() -> usize {
    o2_enterprise::enterprise::common::config::get_config()
        .work_group
        .short
        .user_concurrency
        .max(1)
}

/// Runs `read`; a background read first takes one of the node-wide background permits.
async fn gated<T>(
    background: bool,
    read: impl std::future::Future<Output = anyhow::Result<T>>,
) -> anyhow::Result<T> {
    let _permit = if background {
        Some(BACKGROUND_READS.acquire().await?)
    } else {
        None
    };
    read.await
}

/// Marks the arm read at whole-hour steps, with every version a compare may take out of it.
fn with_basis(mut arm: Aggregate, hourly: bool) -> Aggregate {
    arm.hourly = hourly;
    for version in arm.versions.values_mut() {
        version.hourly = hourly;
    }
    arm
}

fn per_version(signal: &str, families: &Families) -> BTreeMap<VersionImage, Aggregate> {
    let mut out: BTreeMap<VersionImage, Aggregate> = BTreeMap::new();
    let series = |family: &str| families.get(family).into_iter().flatten();
    for s in series(M_REQUESTS)
        .chain(series(M_RUM_VIEWS))
        .chain(series(M_PAGE_VIEWS))
    {
        let arm = out.entry(identity(signal, s)).or_default();
        let n = s.total.round() as u64;
        let error = s.label(L_STATUS) == STATUS_ERROR;
        if signal == "traces" {
            arm.traces.requests += n;
            if error {
                arm.traces.errors += n;
            }
        } else {
            arm.rum.views += n;
            if error {
                arm.rum.error_views += n;
            }
        }
        extend(&mut arm.traffic_span, s.span);
    }
    for s in series(M_RUM_ERRORS).chain(series(M_PAGE_ERRORS)) {
        out.entry(identity(signal, s)).or_default().rum.errors += s.total.round() as u64;
    }
    for s in series(M_RUM_SESSIONS) {
        out.entry(identity(signal, s)).or_default().rum.sessions += s.total.round() as u64;
    }
    for s in series(M_RUM_ERROR_TYPES) {
        let arm = out.entry(identity(signal, s)).or_default();
        let fingerprint = s.label(L_FINGERPRINT);
        *arm.rum.error_types.entry(fingerprint.clone()).or_default() += s.total.round() as u64;
        let text = |name: &str| Some(s.label(name)).filter(|v| !v.is_empty());
        arm.rum.error_evidence.insert(
            fingerprint,
            ErrorEvidence {
                error_type: text("error_type"),
                error_message: text("error_message"),
                ..Default::default()
            },
        );
        extend(&mut arm.detail_span, s.span);
    }
    endpoints(signal, families, &mut out);
    histograms(signal, families, &mut out);
    out
}

fn endpoints(signal: &str, families: &Families, out: &mut BTreeMap<VersionImage, Aggregate>) {
    let mut by_op: BTreeMap<(VersionImage, String, String), EndpointArm> = BTreeMap::new();
    for s in families.get(M_ENDPOINT_REQUESTS).into_iter().flatten() {
        let key = (identity(signal, s), s.label(L_SOURCE), s.label(L_OPERATION));
        let arm = by_op.entry(key.clone()).or_insert_with(|| EndpointArm {
            operation: key.2.clone(),
            source_stream: key.1.clone(),
            ..Default::default()
        });
        let n = s.total.round() as u64;
        arm.requests += n;
        if s.label(L_STATUS) == STATUS_ERROR {
            arm.errors += n;
        }
        extend(&mut out.entry(key.0).or_default().detail_span, s.span);
    }
    let latency = buckets(families.get(M_ENDPOINT_DURATION), |s| {
        (identity(signal, s), s.label(L_SOURCE), s.label(L_OPERATION))
    });
    for (key, pairs) in latency {
        if let Some(arm) = by_op.get_mut(&key) {
            arm.latency = Some(Histogram::from_cumulative(&pairs, 1e6, true));
        }
    }
    for ((version, ..), arm) in by_op {
        if arm.requests > 0 {
            out.entry(version).or_default().endpoints.push(arm);
        }
    }
}

fn histograms(signal: &str, families: &Families, out: &mut BTreeMap<VersionImage, Aggregate>) {
    let latency = buckets(families.get(M_DURATION), |s| identity(signal, s));
    for (version, pairs) in latency {
        out.entry(version).or_default().traces.latency =
            Some(Histogram::from_cumulative(&pairs, 1e6, false));
    }
    let detail = families.contains_key(M_PAGE_VITALS);
    let vitals = buckets(
        families.get(M_RUM_VITALS).or(families.get(M_PAGE_VITALS)),
        |s| (identity(signal, s), s.label(L_VITAL)),
    );
    for ((version, vital), pairs) in vitals {
        let Some((_, divisor)) = VITALS.iter().find(|(name, _)| *name == vital) else {
            continue;
        };
        let hist = Some(Histogram::from_cumulative(&pairs, *divisor, detail));
        let rum = &mut out.entry(version).or_default().rum;
        match vital.as_str() {
            "lcp" => rum.lcp = hist,
            "inp" => rum.inp = hist,
            "cls" => rum.cls = hist,
            _ => rum.loading_time = hist,
        }
    }
}

/// Bucket increases summed per key and `le`, as cumulative pairs.
fn buckets<K: Ord>(
    series: Option<&Vec<SeriesIncrease>>,
    key: impl Fn(&SeriesIncrease) -> K,
) -> BTreeMap<K, Vec<(String, f64)>> {
    let mut sums: BTreeMap<K, BTreeMap<String, f64>> = BTreeMap::new();
    for s in series.into_iter().flatten() {
        *sums
            .entry(key(s))
            .or_default()
            .entry(s.label("le"))
            .or_default() += s.total;
    }
    sums.into_iter()
        .map(|(k, les)| (k, les.into_iter().collect()))
        .collect()
}

fn identity(signal: &str, s: &SeriesIncrease) -> VersionImage {
    let image = s.label(L_IMAGE);
    let image = (signal == "traces" && !image.is_empty()).then_some(image);
    VersionImage::new(&s.label(L_VERSION), image.as_deref())
}

fn extend(span: &mut Option<(i64, i64)>, moved: Option<(i64, i64)>) {
    if let Some((a, b)) = moved {
        *span = Some(span.map_or((a, b), |(x, y)| (x.min(a), y.max(b))));
    }
}

fn families(signal: &str) -> &'static [&'static str] {
    match signal {
        "traces" => &TRACE_FAMILIES,
        "rum_page" => &PAGE_FAMILIES,
        _ => &RUM_FAMILIES,
    }
}

fn series_name(family: &str) -> String {
    if [M_DURATION, M_ENDPOINT_DURATION, M_RUM_VITALS, M_PAGE_VITALS].contains(&family) {
        format!("{family}_bucket")
    } else {
        family.to_string()
    }
}

fn matcher(selection: &Selection<'_>) -> String {
    let services: BTreeSet<String> = selection.services.iter().map(|s| service_key(s)).collect();
    let mut parts = vec![
        format!(
            "{L_SERVICE}=~{}",
            metrics::any_of(services.iter().map(String::as_str))
        ),
        format!("{L_WHERE}={}", metrics::literal(selection.place)),
        format!(
            "{L_SOURCE}=~{}",
            metrics::any_of(selection.streams.iter().map(String::as_str))
        ),
    ];
    let local = config::get_cluster_name();
    if let Some(cluster) = selection
        .cluster
        .or(selection.local.then_some(local.as_str()))
    {
        parts.push(format!("{L_CLUSTER}={}", metrics::literal(cluster)));
    }
    parts.join(",")
}

/// The arm grid a selection is read on, for callers that report the read basis.
pub fn grid_of(selection: &Selection<'_>, window: i64, now: i64) -> ArmGrid {
    metrics::arm_grid(selection.window.start, selection.window.end, window, now)
}

#[cfg(test)]
mod tests {
    use config::meta::promql::value::{Label, Labels};

    use super::*;

    #[tokio::test]
    async fn background_reads_of_every_org_hold_at_most_the_per_user_slots_at_once() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let running = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let read = || async {
            let now = running.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(now, Ordering::SeqCst);
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            running.fetch_sub(1, Ordering::SeqCst);
            Ok::<_, anyhow::Error>(())
        };
        let orgs = (0..3).map(|_| {
            futures::stream::iter((0..12).map(|_| gated(true, read())))
                .buffer_unordered(read_slots())
                .collect::<Vec<_>>()
        });
        futures::future::join_all(orgs).await;
        let peak = peak.load(Ordering::SeqCst);
        assert!(
            (1..=read_slots()).contains(&peak),
            "{peak} > {}",
            read_slots()
        );
        let held: Vec<_> =
            futures::future::join_all((0..read_slots()).map(|_| BACKGROUND_READS.acquire())).await;
        let compare = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            gated(false, async { Ok::<_, anyhow::Error>(7) }),
        )
        .await;
        drop(held);
        assert_eq!(compare.ok().and_then(Result::ok), Some(7));
    }

    fn series(labels: &[(&str, &str)], total: f64) -> SeriesIncrease {
        let labels: Labels = labels
            .iter()
            .map(|(n, v)| {
                std::sync::Arc::new(Label {
                    name: n.to_string(),
                    value: v.to_string(),
                })
            })
            .collect();
        SeriesIncrease {
            labels,
            total,
            latest: total / 2.0,
            span: Some((0, 60)),
        }
    }

    #[test]
    fn a_trace_arm_sums_versions_volumes_endpoints_and_buckets() {
        let mut families = Families::new();
        families.insert(
            M_REQUESTS,
            vec![
                series(&[("version", "2"), ("status", "ok")], 90.0),
                series(&[("version", "2"), ("status", "error")], 10.0),
                series(&[("version", "1"), ("status", "ok")], 40.0),
            ],
        );
        families.insert(
            M_DURATION,
            vec![
                series(&[("version", "2"), ("le", "0.001")], 50.0),
                series(&[("version", "2"), ("le", "0.00118920712")], 100.0),
                series(&[("version", "2"), ("le", "+Inf")], 100.0),
            ],
        );
        families.insert(
            M_ENDPOINT_REQUESTS,
            vec![series(
                &[
                    ("version", "2"),
                    ("operation", "GET /"),
                    ("source_stream", "default"),
                    ("status", "ok"),
                ],
                90.0,
            )],
        );
        let arm = aggregate("traces", &VersionImage::new("2", None), &families);
        assert_eq!((arm.traces.requests, arm.traces.errors), (100, 10));
        assert_eq!(arm.total, 140);
        assert_eq!(arm.volumes[&VersionImage::new("1", None)], (40, 20));
        assert_eq!(arm.versions.len(), 2);
        let latency = arm.traces.latency.as_ref().unwrap();
        assert_eq!(latency.total(), 100);
        let p95 = latency.quantile(0.95).unwrap();
        assert!(p95 > 1_000.0 && p95 <= 1_189.21, "{p95}");
        assert_eq!(arm.endpoints.len(), 1);
        assert_eq!(arm.endpoints[0].requests, 90);
    }

    #[test]
    fn every_version_read_from_an_hourly_arm_reports_the_hourly_basis() {
        let mut arm = Aggregate::default();
        arm.versions
            .insert(VersionImage::default(), Aggregate::default());
        let arm = with_basis(arm, true);
        assert!(arm.hourly);
        assert!(arm.versions.values().all(|version| version.hourly));
    }

    #[test]
    fn the_matcher_selects_service_keys_place_streams_and_the_local_region() {
        let services = BTreeSet::from(["Checkout".to_string(), "checkout.service".to_string()]);
        let streams = BTreeSet::from(["default".to_string()]);
        let selection = Selection {
            services: &services,
            place: "env:prod",
            version: "1",
            image: None,
            signal: "traces",
            streams: &streams,
            window: o2_enterprise::enterprise::service_identity::compare::ArmWindow {
                start: 0,
                end: 60,
                coverage: o2_enterprise::enterprise::service_identity::compare::Coverage::Ok,
            },
            local: false,
            cluster: Some("eu"),
            detail_from: None,
        };
        assert_eq!(
            matcher(&selection),
            r#"service=~"checkout",where_key="env:prod",source_stream=~"default",cluster="eu""#
        );
    }
}
