// Copyright 2026 OpenObserve Inc.
// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::atomic::{AtomicUsize, Ordering};

use async_trait::async_trait;
use bytes::Bytes;
use config::meta::{
    promql::{
        MetricsBlockScan,
        value::{EvalContext, QueryContext, Value},
    },
    search::{ScanStats, Session as SearchSession, StorageType},
    stream::{FileKey, FileSelection},
};
use datafusion::{datasource::MemTable, prelude::SessionContext};
use futures::stream::BoxStream;
use hashbrown::HashSet;
use object_store::{
    CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOptions, PutOptions, PutPayload, PutResult, path::Path,
};
use promql_parser::label::Matchers;

use super::*;
use crate::datafusion::{exec::register_metrics_table_with_blocks, sort_order::FileSortOrder};

#[derive(Clone, Copy, Debug)]
enum Sidecar {
    Native,
    Legacy,
    Missing,
    Corrupt,
}

#[derive(Debug)]
struct BackendStore {
    inner: object_store::memory::InMemory,
    data_reads: Arc<AtomicUsize>,
}

impl std::fmt::Display for BackendStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("metrics-backend-test")
    }
}

#[async_trait]
impl ObjectStore for BackendStore {
    async fn get_opts(&self, path: &Path, options: GetOptions) -> object_store::Result<GetResult> {
        if path.as_ref().ends_with(".parquet") || path.as_ref().ends_with(".vortex") {
            self.data_reads.fetch_add(1, Ordering::SeqCst);
        }
        self.inner.get_opts(path, options).await
    }
    async fn put_opts(
        &self,
        path: &Path,
        payload: PutPayload,
        options: PutOptions,
    ) -> object_store::Result<PutResult> {
        self.inner.put_opts(path, payload, options).await
    }
    async fn put_multipart_opts(
        &self,
        path: &Path,
        options: PutMultipartOptions,
    ) -> object_store::Result<Box<dyn MultipartUpload>> {
        self.inner.put_multipart_opts(path, options).await
    }
    fn delete_stream(
        &self,
        paths: BoxStream<'static, object_store::Result<Path>>,
    ) -> BoxStream<'static, object_store::Result<Path>> {
        self.inner.delete_stream(paths)
    }
    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, object_store::Result<ObjectMeta>> {
        self.inner.list(prefix)
    }
    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> object_store::Result<ListResult> {
        self.inner.list_with_delimiter(prefix).await
    }
    async fn copy_opts(
        &self,
        from: &Path,
        to: &Path,
        options: CopyOptions,
    ) -> object_store::Result<()> {
        self.inner.copy_opts(from, to, options).await
    }
}

struct Provider {
    contexts: Vec<(SessionContext, Arc<Schema>, ScanStats, bool)>,
}

#[async_trait]
impl promql::TableProvider for Provider {
    async fn create_context(
        &self,
        _org: &str,
        _stream: &str,
        _range: (i64, i64),
        _matchers: Matchers,
        _labels: HashSet<String>,
        _filters: &mut [(String, Vec<String>)],
    ) -> Result<Vec<(SessionContext, Arc<Schema>, ScanStats, bool)>> {
        Ok(self.contexts.clone())
    }
}

async fn publish(
    store: &BackendStore,
    account: &str,
    format: FileFormat,
    kind: Sidecar,
    rows: &[SourceRow],
) -> FileKey {
    let schema = block_schema(None, false);
    let mut output = block_output(CompactMergeOutput::Disk, GenerationStats::default());
    output.file_format = format;
    output.blocks_enabled = !matches!(kind, Sidecar::Legacy);
    let file = produce(&schema, vec![block_batch(&schema, rows)], output)
        .await
        .unwrap()
        .remove(0);
    let key = file
        .file_key(
            "files/single-pass/metrics/m/2026/09/20/00",
            &config::ider::uuid(),
            format,
        )
        .unwrap();
    let (data, meta, index_path) = file.into_upload_parts().await.unwrap();
    let mut index = tokio::fs::read(index_path.unwrap()).await.unwrap();
    if matches!(kind, Sidecar::Corrupt) {
        let last = index.len() - 1;
        index[last] ^= 1;
    }
    store
        .put_opts(
            &key.clone().into(),
            Bytes::from(data).into(),
            PutOptions::default(),
        )
        .await
        .unwrap();
    if !matches!(kind, Sidecar::Missing) {
        store
            .put_opts(
                &metrics_block::sidecar_path(&key).unwrap().into(),
                Bytes::from(index).into(),
                PutOptions::default(),
            )
            .await
            .unwrap();
    }
    let count = meta.records as usize;
    let mut file = FileKey::new(0, account.to_owned(), key, meta, false);
    file.with_selection(
        FileSelection::RowRanges(Arc::new(std::iter::once(0..count).collect())),
        (format == FileFormat::Parquet).then_some(config::PARQUET_MAX_ROW_GROUP_SIZE as u32),
    );
    file
}

async fn evaluate(files: &[FileKey], native: bool, wal: bool) -> (String, f64) {
    let trace = config::ider::uuid();
    let schema = block_schema(None, false);
    let session = SearchSession {
        id: trace.clone(),
        storage_type: StorageType::Memory,
        work_group: None,
        target_partitions: 3,
    };
    let descriptor = native.then(|| {
        Arc::new(MetricsBlockScan {
            table_name: "m".into(),
            files: files.to_vec(),
        })
    });
    let ctx = register_metrics_table_with_blocks(
        &session,
        Arc::clone(&schema),
        "m",
        files.to_vec(),
        FileSortOrder::HashTimestampAsc,
        descriptor,
    )
    .await
    .unwrap();
    let effective = Arc::new(ctx.table("m").await.unwrap().schema().as_arrow().clone());
    let mut contexts = vec![(ctx, effective, ScanStats::default(), false)];
    if wal {
        let ctx = SessionContext::new();
        let batch = block_batch(
            &schema,
            &[
                (1, 150_000_000, Some(5f64.to_bits())),
                (1, 160_000_000, Some(6f64.to_bits())),
            ],
        );
        ctx.register_table(
            "m",
            Arc::new(MemTable::try_new(Arc::clone(&schema), vec![vec![batch]]).unwrap()),
        )
        .unwrap();
        contexts.push((ctx, schema, ScanStats::default(), false));
    }
    let end = if wal { 160_000_000 } else { 140_000_000 };
    let query = Arc::new(QueryContext {
        trace_id: trace.clone(),
        org_id: "o".into(),
        need_wal: wal,
        timeout: 60,
        query_exemplars: false,
        query_data: false,
        use_cache: false,
        search_event_type: None,
        search_event_context: None,
        regions: vec![],
        clusters: vec![],
        is_super_cluster: false,
    });
    let mut ctx = promql::exec::PromqlContext::new(query, Provider { contexts }, vec![]);
    ctx.start = end;
    ctx.end = end;
    ctx.interval = 1_000_000;
    let mut engine = promql::engine::Engine::new(
        &trace,
        Arc::new(ctx),
        EvalContext::new(end, end, 1_000_000, trace.clone()),
    );
    let expression = promql_parser::parser::parse("sum by(tag) (rate(m[30s]))").unwrap();
    let (value, _) = engine.exec(&expression).await.unwrap();
    let sample = match &value {
        Value::Matrix(values) => values[0].samples[0].value,
        Value::Vector(values) => values[0].sample.value,
        other => panic!("unexpected {other:?}"),
    };
    crate::datafusion::storage::file_list::clear(&trace);
    (serde_json::to_string(&value).unwrap(), sample)
}

#[test]
fn actual_mixed_formats_native_legacy_corrupt_missing_and_wal_paths() {
    const CHILD: &str = "O2_VORTEX_BACKEND_TEST";
    if std::env::var_os(CHILD).is_none() {
        let directory = tempfile::tempdir().unwrap();
        let output=std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact","datafusion::merge::metrics::tests::backend::actual_mixed_formats_native_legacy_corrupt_missing_and_wal_paths","--nocapture"])
            .current_dir(directory.path()).env(CHILD,"1")
            .env("ZO_FEATURE_METRICS_STREAMING_AGG_ENABLED","true")
            .env("ZO_METRICS_INDEX_ENABLED","true").env("ZO_METRICS_INDEX_BLOCKS_ENABLED","true")
            .env("ZO_METRICS_INDEX_SELECTION_CACHE_ENABLED","false")
            .env("ZO_MEMORY_CACHE_ENABLED","false").env("ZO_DISK_CACHE_ENABLED","false")
            .output().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            for formats in [
                [FileFormat::Vortex, FileFormat::Vortex],
                [FileFormat::Parquet, FileFormat::Vortex],
                [FileFormat::Vortex, FileFormat::Parquet],
            ] {
                for kind in [
                    Sidecar::Native,
                    Sidecar::Legacy,
                    Sidecar::Missing,
                    Sidecar::Corrupt,
                ] {
                    for overlap in [false, true] {
                        let id = config::ider::uuid();
                        let account = format!("{id}:default");
                        let reads = Arc::new(AtomicUsize::new(0));
                        let store = BackendStore {
                            inner: object_store::memory::InMemory::new(),
                            data_reads: Arc::clone(&reads),
                        };
                        let files = vec![
                            publish(
                                &store,
                                &account,
                                formats[0],
                                kind,
                                &[
                                    (1, 110_000_000, Some(1f64.to_bits())),
                                    (1, 120_000_000, Some(2f64.to_bits())),
                                ],
                            )
                            .await,
                            publish(
                                &store,
                                &account,
                                formats[1],
                                Sidecar::Native,
                                &[
                                    (
                                        1,
                                        if overlap { 120_000_000 } else { 130_000_000 },
                                        Some(3f64.to_bits()),
                                    ),
                                    (1, 140_000_000, Some(4f64.to_bits())),
                                ],
                            )
                            .await,
                        ];
                        infra::storage::add_account(&id, Box::new(store)).await;
                        let native = evaluate(&files, true, false).await;
                        if matches!(kind, Sidecar::Native) && !overlap {
                            assert_eq!(reads.load(Ordering::SeqCst), 0);
                        } else {
                            assert!(reads.load(Ordering::SeqCst) > 0);
                        }
                        let fallback = evaluate(&files, false, false).await;
                        assert_eq!(
                            native.0, fallback.0,
                            "formats {formats:?}, {kind:?}, overlap={overlap}"
                        );
                        if !overlap {
                            assert!((native.1 - 0.1).abs() < 1e-12);
                        }
                        if matches!(kind, Sidecar::Native) && !overlap {
                            let wal = evaluate(&files, true, true).await;
                            assert!((wal.1 - 0.1).abs() < 1e-12);
                        }
                    }
                }
            }
        });
}

#[tokio::test]
async fn compressed_vortex_preserves_rare_nonfinite_payloads_and_signed_zero() {
    let schema = block_schema(None, false);
    let rows = (0..131_083)
        .map(|i| {
            let bits = match i % 4096 {
                0 => (-0f64).to_bits(),
                1 => 0x7ff8_0000_0000_1234,
                2 => 0xfff8_0000_0000_5678,
                3 => 1,
                4 => f64::INFINITY.to_bits(),
                5 => f64::NEG_INFINITY.to_bits(),
                _ => (f64::from(i % 1000) * 0.25).to_bits(),
            };
            (1, i64::from(i), Some(bits))
        })
        .collect::<Vec<_>>();
    let mut output = block_output(CompactMergeOutput::Disk, GenerationStats::default());
    output.file_format = FileFormat::Vortex;
    let file = produce(
        &schema,
        rows.chunks(4096).map(|r| block_batch(&schema, r)).collect(),
        output,
    )
    .await
    .unwrap()
    .remove(0);
    let (data, meta, index) = file.into_upload_parts().await.unwrap();
    let session = VortexSession::default().with_tokio();
    let stored = session
        .open_options()
        .open_buffer(vortex::buffer::Buffer::from(data.clone()))
        .unwrap();
    let layout = stored.footer().layout().display_tree().to_string();
    assert!(layout.contains("chunked"), "{layout}");
    let size = stored
        .footer()
        .compressed_field_sizes()
        .unwrap()
        .get(&vortex::dtype::FieldPath::from_name("value"))
        .unwrap();
    assert!(
        size < (rows.len() * 8) as u64,
        "value column did not compress: {size}"
    );
    assert_eq!(stored.row_count(), rows.len() as u64);
    assert_eq!(
        sample_rows_for(FileFormat::Vortex, Bytes::from(data.clone())).await,
        rows
    );
    let encoded = tokio::fs::read(index.unwrap()).await.unwrap();
    assert!(!encoded.starts_with(b"ARROW1"));
    println!(
        "VORTEX_COMPRESSED_BITS_FIXTURE {}",
        serde_json::json!({"rows":rows.len(),"input_batches":rows.len().div_ceil(4096),"data_bytes":data.len(),"value_compressed_bytes":size,"raw_value_bytes":rows.len()*8,"midx_bytes":encoded.len(),"parent_rows":meta.records,"layout":layout})
    );
}
