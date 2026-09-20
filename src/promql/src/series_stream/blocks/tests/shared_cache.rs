// Copyright 2026 OpenObserve Inc.
// SPDX-License-Identifier: AGPL-3.0-only

use std::time::Duration;

use super::*;

struct SharedCacheFixture {
    storage: Fixture,
    file: FileKey,
    cache: Mutex<IndexCache>,
    registry: prometheus::Registry,
    flights: Arc<loads::LoadRegistry>,
    workers: Arc<Semaphore>,
}

impl SharedCacheFixture {
    async fn new(blocked: bool) -> Arc<Self> {
        let data = labeled_file();
        let storage = Fixture::with_gates(std::slice::from_ref(&data), false, blocked).await;
        let file = storage.scan([data.0]).files.remove(0);
        let (cache, registry) = observed_cache();
        Arc::new(Self {
            storage,
            file,
            cache: Mutex::new(cache),
            registry,
            flights: Arc::new(loads::LoadRegistry::default()),
            workers: Arc::new(Semaphore::new(8)),
        })
    }

    async fn load(&self, names: &[&str], limit: usize) -> Result<Arc<LoadedFile>> {
        tokio::time::timeout(
            Duration::from_secs(10),
            load_index_cached(
                &self.file,
                &names.iter().map(|name| (*name).into()).collect::<Vec<_>>(),
                false,
                Arc::clone(&self.workers),
                &self.cache,
                &self.flights,
                limit,
            ),
        )
        .await?
    }

    fn release(&self) {
        self.storage.metadata_blocked.store(false, Ordering::SeqCst);
        self.storage
            .metadata_gate
            .as_ref()
            .unwrap()
            .notify_waiters();
    }

    async fn replace(&self, bytes: Vec<u8>) {
        self.storage
            .inner
            .put_opts(
                &metrics_block::sidecar_path(&self.file.key).unwrap().into(),
                Bytes::from(bytes).into(),
                PutOptions::default(),
            )
            .await
            .unwrap();
    }

    fn metrics(&self) -> HashMap<String, f64> {
        cache_snapshot(&self.registry)
    }

    fn assert_idle(&self) {
        assert_eq!(self.flights.len(), 0);
        assert_eq!(self.workers.available_permits(), 8);
        assert_eq!(self.storage.active.load(Ordering::SeqCst), 0);
    }
}

fn labeled_batch(prefix: &str) -> RecordBatch {
    let rows = 1024;
    let schema = Arc::new(Schema::new(vec![
        Field::new("__hash__", DataType::UInt64, false),
        Field::new("_timestamp", DataType::Int64, false),
        Field::new("value", DataType::Float64, false),
        Field::new("group", DataType::Utf8, true),
        Field::new("zone", DataType::Utf8, false),
        Field::new("instance", DataType::Utf8, false),
    ]));
    RecordBatch::try_new(
        schema,
        vec![
            Arc::new(UInt64Array::from_iter_values(0..rows as u64)),
            Arc::new(Int64Array::from(vec![10; rows])),
            Arc::new(Float64Array::from(vec![1.0; rows])),
            Arc::new(StringArray::from_iter((0..rows).map(|i| match i % 4 {
                0 => None,
                1 => Some(String::new()),
                _ => Some(format!("{prefix}-group-{}", i % 4)),
            }))),
            Arc::new(StringArray::from_iter_values(
                (0..rows).map(|i| format!("{prefix}-zone-{}", i % 8)),
            )),
            Arc::new(StringArray::from_iter_values(
                (0..rows).map(|i| format!("{prefix}-unique-instance-{i:08}")),
            )),
        ],
    )
    .unwrap()
}

fn labeled_file() -> (FileKey, Vec<u8>) {
    file_batch(
        labeled_batch("old"),
        vec!["group".into(), "zone".into(), "instance".into()],
    )
}

fn replacement(file: &FileKey) -> Vec<u8> {
    let batch = labeled_batch("new");
    let mut writer = BlockWriter::new(
        Vec::new(),
        batch.schema(),
        vec!["group".into(), "zone".into(), "instance".into()],
        ParentIdentity {
            object_key: file.key.clone(),
            rows: file.meta.records as u64,
            compressed_size: file.meta.compressed_size as u64,
        },
        2,
    )
    .unwrap();
    writer.write(&batch).unwrap();
    writer.finish().unwrap()
}

#[tokio::test(flavor = "current_thread")]
async fn same_file_concurrent_projections_share_directory_and_columns() {
    let fixture = SharedCacheFixture::new(true).await;
    let mut tasks = Vec::new();
    for projection in [
        "group", "zone", "instance", "group", "zone", "instance", "group", "zone",
    ] {
        let fixture = Arc::clone(&fixture);
        tasks.push(tokio::spawn(async move {
            fixture.load(&[projection], 1024 * 1024).await
        }));
    }
    fixture.storage.entered.notified().await;
    tokio::task::yield_now().await;
    assert_eq!(fixture.flights.len(), 1);
    assert_eq!(fixture.storage.active.load(Ordering::SeqCst), 1);
    assert_eq!(fixture.workers.available_permits(), 0);
    fixture.release();
    let mut views = Vec::new();
    for task in tasks {
        views.push(task.await.unwrap().unwrap());
    }
    let base = &views[0].index.base;
    assert!(views.iter().all(|view| Arc::ptr_eq(base, &view.index.base)));
    for (a, b) in [(0, 3), (0, 6), (1, 4), (1, 7), (2, 5)] {
        assert!(Arc::ptr_eq(
            views[a].index.labels.column(0),
            views[b].index.labels.column(0)
        ));
    }
    assert_eq!(fixture.metrics()["entries"], 1.0);
    assert!(fixture.storage.metadata_calls.load(Ordering::SeqCst) <= 9);
    assert_eq!(fixture.storage.calls.load(Ordering::SeqCst), 0);
    fixture.assert_idle();
}

#[tokio::test]
async fn projection_churn_keeps_one_file_and_releases_unrequested_columns_on_eviction() {
    let fixture = SharedCacheFixture::new(false).await;
    let held = fixture.load(&["group"], 1024 * 1024).await.unwrap();
    let all = fixture
        .load(&["group", "zone", "instance"], 1024 * 1024)
        .await
        .unwrap();
    let weak_base = Arc::downgrade(&all.index.base);
    let weak_instance = Arc::downgrade(all.index.labels.column_by_name("instance").unwrap());
    let retained = fixture.metrics()["used_bytes"];
    let reads = fixture.storage.metadata_calls.load(Ordering::SeqCst);
    for i in 0..64 {
        let missing = format!("missing-{i}");
        let names = if i % 2 == 0 {
            vec!["instance", missing.as_str(), "group"]
        } else {
            vec!["zone", "group", missing.as_str()]
        };
        let view = fixture.load(&names, 1024 * 1024).await.unwrap();
        assert!(Arc::ptr_eq(&all.index.base, &view.index.base));
        assert!(Arc::ptr_eq(
            held.index.labels.column(0),
            view.index.labels.column_by_name("group").unwrap()
        ));
        assert_eq!(view.index.label_value(2, &missing).unwrap(), None);
        assert_eq!(view.index.label_value(0, "group").unwrap(), None);
        assert_eq!(view.index.label_value(1, "group").unwrap(), Some(""));
        assert_eq!(fixture.metrics()["used_bytes"], retained);
    }
    assert_eq!(fixture.storage.metadata_calls.load(Ordering::SeqCst), reads);
    assert_eq!(fixture.metrics()["entries"], 1.0);
    drop(all);
    fixture.cache.lock().unwrap().trim(0);
    assert_eq!(fixture.metrics()["used_bytes"], 0.0);
    assert!(weak_instance.upgrade().is_none());
    assert!(weak_base.upgrade().is_some());
    assert_eq!(
        held.index.label_value(2, "group").unwrap(),
        Some("old-group-2")
    );
    drop(held);
    assert!(weak_base.upgrade().is_none());
    fixture.assert_idle();
}

#[tokio::test]
async fn oversized_growth_preserves_admitted_subset_and_zero_budget_drops_it() {
    let fixture = SharedCacheFixture::new(false).await;
    let group = fixture.load(&["group"], 1024 * 1024).await.unwrap();
    let group_size = fixture.cache.lock().unwrap().bytes;
    let full = fixture.load(&["instance"], group_size).await.unwrap();
    assert!(Arc::ptr_eq(&group.index.base, &full.index.base));
    assert_eq!(
        full.index.label_value(1000, "instance").unwrap(),
        Some("old-unique-instance-00001000")
    );
    let values = fixture.metrics();
    assert_eq!(values["entries"], 1.0);
    assert_eq!(values["used_bytes"], group_size as f64);
    assert_eq!(values["admission_rejections_total:oversize"], 1.0);
    assert_eq!(values["replacements_total"], 0.0);
    let cached = fixture.load(&["group"], group_size).await.unwrap();
    assert!(Arc::ptr_eq(
        group.index.labels.column(0),
        cached.index.labels.column(0)
    ));
    let disabled = fixture.load(&["group"], 0).await.unwrap();
    assert_eq!(
        disabled.index.label_value(2, "group").unwrap(),
        Some("old-group-2")
    );
    assert!(!Arc::ptr_eq(&group.index.base, &disabled.index.base));
    let values = fixture.metrics();
    assert_eq!(values["used_bytes"], 0.0);
    assert_eq!(values["evictions_total:limit_shrink"], 1.0);
    assert_eq!(values["admission_rejections_total:disabled"], 1.0);
    fixture.assert_idle();
}

#[tokio::test(flavor = "current_thread")]
async fn cancelled_owner_wakes_follower_and_removes_inflight_state() {
    let fixture = SharedCacheFixture::new(true).await;
    let first_fixture = Arc::clone(&fixture);
    let owner = tokio::spawn(async move { first_fixture.load(&["group"], 1024 * 1024).await });
    fixture.storage.entered.notified().await;
    let second_fixture = Arc::clone(&fixture);
    let follower = tokio::spawn(async move { second_fixture.load(&["zone"], 1024 * 1024).await });
    tokio::task::yield_now().await;
    assert_eq!(fixture.storage.active.load(Ordering::SeqCst), 1);
    owner.abort();
    assert!(matches!(owner.await, Err(error) if error.is_cancelled()));
    fixture.storage.entered.notified().await;
    assert_eq!(fixture.flights.len(), 1);
    assert_eq!(fixture.storage.active.load(Ordering::SeqCst), 1);
    fixture.release();
    let view = follower.await.unwrap().unwrap();
    assert_eq!(
        view.index.label_value(3, "zone").unwrap(),
        Some("old-zone-3")
    );
    assert_eq!(fixture.metrics()["admissions_total"], 1.0);
    fixture.assert_idle();
}

#[tokio::test(flavor = "current_thread")]
async fn failed_owner_propagates_to_followers_and_a_valid_retry_recovers() {
    let fixture = SharedCacheFixture::new(true).await;
    fixture.replace(vec![0; metrics_block::FOOTER_LEN]).await;
    let mut tasks = Vec::new();
    for label in ["group", "zone", "instance"] {
        let fixture = Arc::clone(&fixture);
        tasks.push(tokio::spawn(async move {
            fixture.load(&[label], 1024 * 1024).await
        }));
    }
    fixture.storage.entered.notified().await;
    tokio::task::yield_now().await;
    fixture.release();
    for task in tasks {
        assert!(task.await.unwrap().is_err());
    }
    assert_eq!(fixture.metrics()["admissions_total"], 0.0);
    fixture.assert_idle();
    fixture.replace(replacement(&fixture.file)).await;
    let view = fixture.load(&["zone"], 1024 * 1024).await.unwrap();
    assert_eq!(
        view.index.label_value(3, "zone").unwrap(),
        Some("new-zone-3")
    );
    fixture.assert_idle();
}

#[tokio::test]
async fn additional_columns_reject_replaced_sidecar_without_mixing_old_and_new_views() {
    let fixture = SharedCacheFixture::new(false).await;
    let old = fixture.load(&["group"], 1024 * 1024).await.unwrap();
    fixture.replace(replacement(&fixture.file)).await;
    assert!(fixture.load(&["zone"], 1024 * 1024).await.is_err());
    assert_eq!(fixture.metrics()["invalidations_total"], 1.0);
    assert_eq!(fixture.metrics()["used_bytes"], 0.0);
    let new = fixture.load(&["group", "zone"], 1024 * 1024).await.unwrap();
    assert!(!Arc::ptr_eq(&old.index.base, &new.index.base));
    assert_eq!(
        old.index.label_value(2, "group").unwrap(),
        Some("old-group-2")
    );
    assert_eq!(
        new.index.label_value(2, "group").unwrap(),
        Some("new-group-2")
    );
    assert_eq!(
        new.index.label_value(3, "zone").unwrap(),
        Some("new-zone-3")
    );
    fixture.assert_idle();
}

#[tokio::test]
async fn aggregate_growth_evicts_an_entire_other_file_and_reconciles_components() {
    let fixture = SharedCacheFixture::new(false).await;
    let other = SharedCacheFixture::new(false).await;
    let all = fixture
        .load(&["group", "instance"], 1024 * 1024)
        .await
        .unwrap();
    let full_size = fixture.cache.lock().unwrap().bytes;
    drop(all);
    fixture.cache.lock().unwrap().trim(0);
    let group = fixture.load(&["group"], 1024 * 1024).await.unwrap();
    let small_size = fixture.cache.lock().unwrap().bytes;
    let limit = (full_size + small_size / 2).max(small_size * 2);
    assert!(full_size <= limit && full_size + small_size > limit);
    let other_view = load_index_cached(
        &other.file,
        &["group".into()],
        false,
        Arc::clone(&fixture.workers),
        &fixture.cache,
        &fixture.flights,
        limit,
    )
    .await
    .unwrap();
    let weak_other_base = Arc::downgrade(&other_view.index.base);
    assert!(!Arc::ptr_eq(&other_view.index.base, &group.index.base));
    drop(other_view);
    assert_eq!(fixture.metrics()["entries"], 2.0);
    let grown = fixture.load(&["instance"], limit).await.unwrap();
    assert!(Arc::ptr_eq(&group.index.base, &grown.index.base));
    assert!(weak_other_base.upgrade().is_none());
    let values = fixture.metrics();
    assert_eq!(values["entries"], 1.0);
    assert_eq!(values["evictions_total:capacity"], 1.0);
    assert_eq!(values["used_bytes"], full_size as f64);
    assert!(values["used_bytes"] <= values["limit_bytes"]);
    fixture.assert_idle();
}
