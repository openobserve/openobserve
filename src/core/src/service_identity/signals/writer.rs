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

//! Per-org cumulative series of the service signals, written as metrics streams (D232).

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, LazyLock},
};

use config::meta::stream::{StreamSettings, StreamType};
use dashmap::DashMap;
use o2_enterprise::enterprise::service_identity::signals::{
    mappers::{PodRow, SignalRow},
    series::{self, ApplyReport, Kind, OrgSeries},
};
use tokio::sync::Mutex;

use super::processor::Ownership;
use crate::{
    ingestion::feature_writer::{self, FeatureWriter, GrpcTransport, WriteError, WriterTransport},
    traces::service_graph::v4::writer::{chunk, max_request_bytes},
};

pub const KIND_TOP_N: &str = "top_n";
pub const KIND_HISTORY: &str = "history";

static SERIES: LazyLock<DashMap<String, Arc<Mutex<OrgSeries>>>> = LazyLock::new(DashMap::new);
static DROPPED: LazyLock<prometheus::IntCounterVec> = LazyLock::new(|| {
    prometheus::register_int_counter_vec!(
        "o2_service_signals_dropped_total",
        "Service signal groups not admitted because their kind reached its derived bound",
        &["org", "kind"]
    )
    .expect("service signals dropped metric")
});
static RETAINED: LazyLock<prometheus::IntGaugeVec> = LazyLock::new(|| {
    prometheus::register_int_gauge_vec!(
        "o2_service_signals_retained_groups",
        "Service signal groups held in memory and written every window",
        &["org", "kind"]
    )
    .expect("service signals retained metric")
});

pub fn state(org: &str) -> Arc<Mutex<OrgSeries>> {
    SERIES.entry(org.to_string()).or_default().clone()
}

/// Puts back series a snapshot kept, so the next contiguous window continues their cumulatives.
pub fn restore(org: &str, mut series: OrgSeries) {
    series.reindex();
    SERIES.insert(org.to_string(), Arc::new(Mutex::new(series)));
}

/// Drops the series of orgs `keep` refuses; their next window starts from 0 baselines.
pub fn forget(keep: impl Fn(&str) -> bool) {
    SERIES.retain(|org, _| keep(org));
}

pub fn count_dropped(org: &str, kind: &str, n: u64) {
    if n > 0 {
        DROPPED.with_label_values(&[org, kind]).inc_by(n);
    }
}

pub fn dropped(org: &str, kind: &str) -> u64 {
    DROPPED.with_label_values(&[org, kind]).get()
}

/// Folds one window into the org's series and returns the records to write.
pub fn apply_window(
    org: &str,
    series: &mut OrgSeries,
    start: i64,
    end: i64,
    rows: &[&[SignalRow]],
    pods: &[PodRow],
) -> (ApplyReport, Vec<serde_json::Value>) {
    let rows = rows.iter().flat_map(|part| part.iter());
    let report = series.apply(start, end, series::window_groups(rows, pods));
    for (kind, n) in &report.dropped {
        count_dropped(org, kind.as_str(), *n);
    }
    for kind in Kind::ALL {
        RETAINED
            .with_label_values(&[org, kind.as_str()])
            .set(series.retained(kind) as i64);
    }
    if report.rebaselined {
        log::info!("[ServiceSignals] org={org} window_end={end} series restart from 0 baselines");
    }
    (report, series.render(end, &config::get_cluster_name()))
}

pub(super) async fn write_window(
    org: &str,
    start: i64,
    end: i64,
    rows: &[&[SignalRow]],
    pods: &[PodRow],
    ownership: &Ownership<'_>,
) -> anyhow::Result<()> {
    let written = before_backlog_edge(end, config::utils::time::now_micros(), async {
        let state = state(org);
        let mut series = state.lock().await;
        let (_, records) = apply_window(org, &mut series, start, end, rows, pods);
        ownership.check().await?;
        let written = deliver(&GrpcTransport, org, &records).await?;
        series.mark_written();
        Ok(written)
    })
    .await?;
    seed_retention(org, &written, ownership).await
}

/// Sends `records` with the org's own writer token, one request per metric stream it names.
async fn deliver(
    transport: &dyn WriterTransport,
    org: &str,
    records: &[serde_json::Value],
) -> anyhow::Result<BTreeSet<String>> {
    let token = feature_writer::token(FeatureWriter::ServiceSignals, org).await?;
    let mut by_stream: BTreeMap<String, Vec<serde_json::Value>> = BTreeMap::new();
    for record in records {
        let stream = record["__name__"].as_str().unwrap_or_default().to_string();
        by_stream.entry(stream).or_default().push(record.clone());
    }
    for (stream, records) in &by_stream {
        for data in chunk(records, max_request_bytes()) {
            match feature_writer::write_metrics(transport, &token, stream, data.clone()).await {
                Ok(()) => {}
                // one retry, as the shared metrics writer gives a transient failure
                Err(WriteError::Failed(_)) => {
                    feature_writer::write_metrics(transport, &token, stream, data).await?
                }
                Err(err) => return Err(err.into()),
            }
        }
    }
    Ok(by_stream.into_keys().collect())
}

/// D239: a new stream gets its retention while the operator has not set one.
pub fn seed_retention_settings(settings: &mut StreamSettings, days: i64, default: i64) -> bool {
    if settings.data_retention == 0 || settings.data_retention == default {
        let changed = settings.data_retention != days;
        settings.data_retention = days;
        return changed;
    }
    false
}

// Settled arm reads are kept as final (metrics::settled_read), so no window may land behind them.
fn writable(end: i64, now: i64) -> anyhow::Result<()> {
    anyhow::ensure!(
        end > super::metrics::writable_after(now),
        "service signals window {end} is past the catch-up backlog"
    );
    Ok(())
}

// A settled arm is cached past the backlog edge, so the whole write must land before it.
async fn before_backlog_edge<T>(
    end: i64,
    now: i64,
    write: impl std::future::Future<Output = anyhow::Result<T>>,
) -> anyhow::Result<T> {
    writable(end, now)?;
    let left = std::time::Duration::from_micros((end - super::metrics::writable_after(now)) as u64);
    tokio::time::timeout(left, write).await.map_err(|_| {
        anyhow::anyhow!("service signals window {end} was still writing at the catch-up backlog")
    })?
}

async fn seed_retention(
    org: &str,
    written: &BTreeSet<String>,
    ownership: &Ownership<'_>,
) -> anyhow::Result<()> {
    let default = config::get_config().compact.data_retention_days;
    seed_streams(|stream, days| async move {
        // only a stream this window wrote is read, so a missing one costs no schema lookup
        if !written.contains(stream)
            || infra::schema::get(org, stream, StreamType::Metrics)
                .await?
                .fields()
                .is_empty()
        {
            return Ok(());
        }
        let mut settings = infra::schema::get_settings(org, stream, StreamType::Metrics)
            .await
            .map(|s| (*s).clone())
            .unwrap_or_default();
        if seed_retention_settings(&mut settings, days, default) {
            ownership.check().await?;
            schema::save_stream_settings(org, stream, StreamType::Metrics, settings).await?;
        }
        Ok(())
    })
    .await
}

// A plain `Fn` returning a future, since the job's spawn cannot prove an `AsyncFn` future `Send`.
async fn seed_streams<F, Fut>(seed: F) -> anyhow::Result<()>
where
    F: Fn(&'static str, i64) -> Fut,
    Fut: Future<Output = anyhow::Result<()>>,
{
    for (stream, days) in series::STREAM_RETENTION_DAYS {
        seed(stream, days).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: i64 = 60_000_000;
    const T0: i64 = 1_700_000_040_000_000;

    fn t1(version: &str, requests: u64) -> SignalRow {
        SignalRow {
            signal: "traces".into(),
            service: "checkout".into(),
            where_key: "env:prod".into(),
            version: version.into(),
            source_stream: "default".into(),
            requests: Some(requests),
            errors: Some(0),
            ..Default::default()
        }
    }

    #[test]
    fn a_window_behind_the_catch_up_backlog_is_refused() {
        let now = T0 + 30 * 86_400_000_000;
        let edge = super::super::metrics::writable_after(now);
        assert!(writable(edge, now).is_err());
        assert!(writable(edge + 1, now).is_ok());
        assert!(writable(now - 300_000_000, now).is_ok());
    }

    #[tokio::test(start_paused = true)]
    async fn a_delayed_final_chunk_crossing_the_settlement_boundary_leaves_no_stale_cached_arm() {
        use std::time::Duration;

        use config::meta::promql::value::{Labels, RangeValue, Sample, Value};

        use super::super::metrics::{
            ArmGrid, increases, settled_before, settled_read, writable_after,
        };

        const HOUR: i64 = 3_600_000_000;
        let now = T0 + 30 * 86_400_000_000;
        let end = writable_after(now) + W;
        let settles_in = end - settled_before(now);
        let landed = Arc::new(std::sync::Mutex::new(vec![]));
        let write = {
            let landed = landed.clone();
            async move {
                landed.lock().unwrap().push(Sample::new(end - 1_000, 0.0));
                tokio::time::sleep(Duration::from_micros((settles_in + W) as u64)).await;
                landed.lock().unwrap().push(Sample::new(end, 7.0));
                Ok(())
            }
        };
        let writer = tokio::spawn(before_backlog_edge(end, now, write));
        let storage = || {
            let samples = landed.lock().unwrap().clone();
            let value = Value::Matrix(vec![RangeValue::new(Labels::default(), samples)]);
            async move { Ok::<_, anyhow::Error>(value) }
        };
        let grid = ArmGrid {
            start: end - HOUR,
            end,
            step: HOUR,
            hourly: true,
        };
        let key = |org: &str| (org.to_string(), "m{}[1h]".to_string(), grid, false);
        tokio::time::sleep(Duration::from_micros(settles_in as u64)).await;
        let cached = settled_read(key("fence-org"), now + settles_in, storage)
            .await
            .unwrap();
        let written = writer.await.unwrap();
        let after = now + settles_in + 2 * W;
        let stored = settled_read(key("fence-org-after"), after, storage)
            .await
            .unwrap();
        assert_eq!(
            increases(&cached, grid.start, grid.step, grid.end),
            increases(&stored, grid.start, grid.step, grid.end),
            "the cached arm still equals storage once the write has ended"
        );
        assert!(
            written.is_err(),
            "a write still delivering at the backlog edge is cut off"
        );
    }

    #[test]
    fn a_group_over_its_derived_bound_increments_the_drop_counter() {
        let org = "writer_drop_counter_org";
        let before = dropped(org, "request");
        let rows: Vec<_> = (0..2_003).map(|i| t1(&format!("v{i}"), 1 + i)).collect();
        let mut series = OrgSeries::default();
        let (report, records) = apply_window(org, &mut series, T0 - W, T0, &[&rows], &[]);
        assert_eq!(report.dropped.get(&Kind::Request), Some(&3));
        assert_eq!(dropped(org, "request") - before, 3);
        assert!(!records.is_empty());
    }

    #[test]
    fn a_retried_window_resends_the_same_samples_without_counting_twice() {
        let org = "writer_retry_org";
        let mut series = OrgSeries::default();
        let (_, first) = apply_window(org, &mut series, T0 - W, T0, &[&[t1("1", 7)]], &[]);
        let (_, again) = apply_window(org, &mut series, T0 - W, T0, &[&[t1("1", 7)]], &[]);
        assert_eq!(first, again);
    }

    #[test]
    fn retention_is_seeded_only_while_the_operator_kept_the_default() {
        let mut settings = StreamSettings::default();
        assert!(seed_retention_settings(&mut settings, 90, 3650));
        assert_eq!(settings.data_retention, 90);
        settings.data_retention = 3650;
        assert!(seed_retention_settings(&mut settings, 30, 3650));
        assert_eq!(settings.data_retention, 30);
        settings.data_retention = 12;
        assert!(!seed_retention_settings(&mut settings, 30, 3650));
        assert_eq!(settings.data_retention, 12);
    }

    #[tokio::test]
    async fn a_stream_created_after_the_first_window_still_gets_its_retention() {
        let settings = std::sync::Mutex::new(BTreeMap::from([(
            series::M_REQUESTS,
            StreamSettings::default(),
        )]));
        let seed = |stream: &'static str, days: i64| {
            let mut settings = settings.lock().unwrap();
            if let Some(settings) = settings.get_mut(stream) {
                seed_retention_settings(settings, days, 3650);
            }
            std::future::ready(anyhow::Ok(()))
        };
        seed_streams(&seed).await.unwrap();
        let retention = settings.lock().unwrap()[series::M_REQUESTS].data_retention;
        assert!(retention > 0);
        settings
            .lock()
            .unwrap()
            .insert(series::M_RUM_VIEWS, StreamSettings::default());
        seed_streams(&seed).await.unwrap();
        assert!(settings.lock().unwrap()[series::M_RUM_VIEWS].data_retention > 0);
        settings.lock().unwrap().remove(series::M_REQUESTS);
        seed_streams(&seed).await.unwrap();
        settings
            .lock()
            .unwrap()
            .insert(series::M_REQUESTS, StreamSettings::default());
        seed_streams(&seed).await.unwrap();
        assert_eq!(
            settings.lock().unwrap()[series::M_REQUESTS].data_retention,
            retention
        );
    }

    #[tokio::test]
    async fn each_org_writes_with_its_own_token_until_an_admin_disables_it() {
        use crate::ingestion::feature_writer::tests::{RecordingTransport, meta_store};
        meta_store().await;
        let now = config::utils::time::now_micros();
        let (a, b) = (
            format!("svc-signals-a-{now}"),
            format!("svc-signals-b-{now}"),
        );
        let records = [serde_json::json!({"__name__": series::M_REQUESTS, "value": 1.0})];
        let transport = RecordingTransport::answering(200);
        for org in [&a, &b] {
            deliver(&transport, org, &records).await.unwrap();
        }
        let sent = transport.credentials();
        let scope: Vec<_> = sent
            .iter()
            .map(|(_, org, body)| {
                (
                    org.as_str(),
                    body.stream_type.as_str(),
                    body.stream_name.as_str(),
                )
            })
            .collect();
        assert_eq!(
            scope,
            [
                (a.as_str(), "metrics", series::M_REQUESTS),
                (b.as_str(), "metrics", series::M_REQUESTS)
            ]
        );
        assert_ne!(sent[0].0, sent[1].0, "two orgs wrote with one token");
        crate::ingestion_tokens::set_enabled_token(&a, "_o2_service_signals", false)
            .await
            .unwrap();
        assert!(deliver(&transport, &a, &records).await.is_err());
        assert_eq!(
            transport.credentials().len(),
            2,
            "a disabled token still wrote"
        );
    }

    #[tokio::test]
    async fn a_chunk_that_did_not_land_fails_the_delivery() {
        use crate::ingestion::feature_writer::tests::{
            RecordingTransport, UncachedTransport, meta_store,
        };
        meta_store().await;
        let org = format!("svc-signals-unlanded-{}", config::utils::time::now_micros());
        let (refused, accepted) = (
            RecordingTransport::answering(500),
            RecordingTransport::answering(200),
        );
        let cases: [(&str, &dyn WriterTransport, &str); 3] = [
            ("Failed", &refused, series::M_REQUESTS),
            ("NotReady", &UncachedTransport, series::M_REQUESTS),
            ("OutOfScope", &accepted, "default"),
        ];
        for (want, transport, stream) in cases {
            let records = [serde_json::json!({"__name__": stream, "value": 1.0})];
            let err = deliver(transport, &org, &records).await.expect_err(want);
            let got = match err.downcast_ref::<WriteError>() {
                Some(WriteError::Failed(_)) => "Failed",
                Some(WriteError::NotReady(_)) => "NotReady",
                Some(WriteError::OutOfScope(_)) => "OutOfScope",
                None => "another error",
            };
            assert_eq!(got, want, "{err}");
        }
        assert_eq!(
            refused.sent.lock().unwrap().len(),
            2,
            "a failed chunk is retried once"
        );
    }
}
