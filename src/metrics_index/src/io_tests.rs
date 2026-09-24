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
    collections::HashMap,
    ops::Range,
    sync::{Arc, Mutex},
};

use arrow::{
    array::{ArrayRef, Float64Array, Int64Array, RecordBatch, StringArray, UInt64Array},
    datatypes::{DataType, Field, Schema, SchemaRef},
};
use async_trait::async_trait;
use bytes::Bytes;
use config::meta::stream::{FileKey, FileMeta, FileSelection};
use futures::stream::BoxStream;
use object_store::{
    CopyOptions, GetOptions, GetRange, GetResult, ListResult, MultipartUpload, ObjectMeta,
    ObjectStore, PutMultipartOptions, PutOptions, PutPayload, PutResult, path::Path,
};
use promql_parser::label::{MatchOp, Matcher, Matchers};
use tokio::sync::Notify;

use crate::{
    MetricsFileLayout,
    block::{
        BlockWriter, HEADER_PROBE_BYTES, Header, MIDX_TRAILER_LEN, MidxTrailer, ParentMetadata,
    },
    reader::{IndexLabels, SMALL_METADATA_BYTES, evaluate_metrics_index, load_metrics_index_file},
};

/// One wire request as a remote object store would receive it.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Request {
    Head,
    Range(Range<u64>),
}

/// Records every `get_opts`, the only method the default `get_ranges` coalescing calls.
#[derive(Debug)]
struct CountingStore {
    inner: object_store::memory::InMemory,
    requests: Arc<Mutex<Vec<Request>>>,
    gate: Option<(Arc<Notify>, Arc<Notify>)>,
}

impl std::fmt::Display for CountingStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("midx-counting-store")
    }
}

#[async_trait]
impl ObjectStore for CountingStore {
    async fn get_opts(
        &self,
        location: &Path,
        options: GetOptions,
    ) -> object_store::Result<GetResult> {
        let request = match &options.range {
            _ if options.head => Request::Head,
            Some(GetRange::Bounded(range)) => Request::Range(range.clone()),
            other => panic!("unexpected MIDX request {other:?}"),
        };
        self.requests.lock().unwrap().push(request);
        if let Some((entered, release)) = &self.gate {
            entered.notify_one();
            release.notified().await;
        }
        self.inner.get_opts(location, options).await
    }

    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        options: PutOptions,
    ) -> object_store::Result<PutResult> {
        self.inner.put_opts(location, payload, options).await
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        options: PutMultipartOptions,
    ) -> object_store::Result<Box<dyn MultipartUpload>> {
        self.inner.put_multipart_opts(location, options).await
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, object_store::Result<Path>>,
    ) -> BoxStream<'static, object_store::Result<Path>> {
        self.inner.delete_stream(locations)
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

/// A source file and its MIDX, both with deterministic content.
struct Fixture {
    batch: RecordBatch,
    file: FileKey,
    midx: Vec<u8>,
}

impl Fixture {
    /// `labels` identity labels, `series` series of two samples; even labels are high cardinality.
    async fn new(format: config::FileFormat, labels: usize, series: usize) -> Self {
        Self::with_metadata(format, labels, series, HashMap::new()).await
    }

    async fn with_metadata(
        format: config::FileFormat,
        labels: usize,
        series: usize,
        metadata: HashMap<String, String>,
    ) -> Self {
        let mut fields = vec![
            Field::new("__hash__", DataType::UInt64, false),
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("value", DataType::Float64, false),
        ];
        fields.extend((0..labels).map(|i| Field::new(label_name(i), DataType::Utf8, true)));
        let schema: SchemaRef = Arc::new(Schema::new_with_metadata(fields, metadata));
        let rows = series * 2;
        let mut columns: Vec<ArrayRef> = vec![
            Arc::new(UInt64Array::from_iter_values(
                (0..rows).map(|r| (r / 2) as u64),
            )),
            Arc::new(Int64Array::from_iter_values(
                (0..rows).map(|r| (r % 2) as i64 * 15_000),
            )),
            Arc::new(Float64Array::from_iter_values((0..rows).map(|r| r as f64))),
        ];
        for label in 0..labels {
            columns.push(Arc::new(StringArray::from_iter_values(
                (0..rows).map(|r| label_value(label, r / 2)),
            )));
        }
        Self::from_batch(format, RecordBatch::try_new(schema, columns).unwrap()).await
    }

    async fn from_batch(format: config::FileFormat, batch: RecordBatch) -> Self {
        let schema = batch.schema();
        let rows = batch.num_rows();
        let id = config::ider::uuid();
        let mut file = FileKey::new(
            0,
            format!("{id}:default"),
            format!(
                "files/test/metrics/m/2026/09/20/00/indexed-v1-{id}{}",
                format.extension()
            ),
            FileMeta {
                records: rows as i64,
                compressed_size: 123,
                ..Default::default()
            },
            false,
        );
        let mut writer = BlockWriter::new_pending(Vec::new(), Arc::clone(&schema), 2).unwrap();
        writer.write(&batch).unwrap();
        let midx = match format {
            config::FileFormat::Parquet => {
                let mut parquet = config::utils::parquet::new_parquet_writer(
                    Vec::new(),
                    &schema,
                    &[],
                    &file.meta,
                    false,
                    None,
                );
                parquet.write(&batch).await.unwrap();
                let metadata = parquet.finish().await.unwrap();
                file.meta.compressed_size = i64::try_from(parquet.bytes_written()).unwrap();
                writer.finish_for_parquet(parent(&file), metadata)
            }
            config::FileFormat::Vortex => writer.finish_for_vortex(parent(&file), schema),
        }
        .unwrap();
        file.meta.mindex_size = midx.len() as i64;
        Self { batch, file, midx }
    }

    fn header(&self) -> Header {
        Header::parse(&self.midx, self.midx.len() as u64, &parent(&self.file)).unwrap()
    }

    fn trailer(&self) -> MidxTrailer {
        Header::trailer(&self.midx, self.midx.len() as u64).unwrap()
    }

    fn header_len(&self) -> usize {
        self.trailer().header_len as usize
    }

    fn path(&self) -> String {
        MetricsFileLayout::metrics_index_path(&self.file.key).unwrap()
    }

    async fn store(&self) -> Arc<Mutex<Vec<Request>>> {
        self.store_with(Some(&self.midx), None).await
    }

    /// Registers `bytes` (no object for `None`) as the MIDX and returns the request log.
    async fn store_with(
        &self,
        bytes: Option<&[u8]>,
        gate: Option<(Arc<Notify>, Arc<Notify>)>,
    ) -> Arc<Mutex<Vec<Request>>> {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let store = CountingStore {
            inner: object_store::memory::InMemory::new(),
            requests: Arc::clone(&requests),
            gate,
        };
        if let Some(bytes) = bytes {
            store
                .inner
                .put_opts(
                    &self.path().into(),
                    Bytes::copy_from_slice(bytes).into(),
                    PutOptions::default(),
                )
                .await
                .unwrap();
        }
        let id = self.file.account.strip_suffix(":default").unwrap();
        infra::storage::add_account(id, Box::new(store)).await;
        requests
    }

    async fn load(
        &self,
        requested: &[String],
    ) -> datafusion::common::Result<crate::reader::MetricsIndexData> {
        self.load_labels(requested, &[]).await
    }

    async fn load_labels(
        &self,
        requested: &[String],
        flat: &[String],
    ) -> datafusion::common::Result<crate::reader::MetricsIndexData> {
        load_metrics_index_file(
            &self.file.account,
            &self.path(),
            format_of(&self.file),
            self.file.meta.records as usize,
            self.file.meta.compressed_size,
            self.file.meta.mindex_size,
            IndexLabels {
                requested: Arc::new(requested.to_vec()),
                flat: Arc::new(flat.to_vec()),
            },
        )
        .await
    }

    /// Source row ranges whose series carry `value` for `label`, computed from the source batch.
    fn expected_ranges(&self, label: usize, value: &str) -> Vec<Range<usize>> {
        let series = self.batch.num_rows() / 2;
        let mut ranges: Vec<Range<usize>> = Vec::new();
        for s in (0..series).filter(|s| label_value(label, *s) == value) {
            match ranges.last_mut() {
                Some(last) if last.end == s * 2 => last.end = s * 2 + 2,
                _ => ranges.push(s * 2..s * 2 + 2),
            }
        }
        ranges
    }
}

fn label_name(i: usize) -> String {
    format!("service_instance_label_{i:03}")
}

fn label_value(label: usize, series: usize) -> String {
    if label.is_multiple_of(2) {
        format!(
            "{:016x}",
            (series as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ label as u64
        )
    } else {
        format!("value-{}", series % 7)
    }
}

fn parent(file: &FileKey) -> ParentMetadata {
    ParentMetadata {
        rows: file.meta.records as u64,
        compressed_size: file.meta.compressed_size as u64,
    }
}

fn format_of(file: &FileKey) -> config::FileFormat {
    config::FileFormat::from_extension(&file.key).unwrap()
}

fn ranges(requests: &Mutex<Vec<Request>>) -> Vec<Range<u64>> {
    requests
        .lock()
        .unwrap()
        .iter()
        .map(|request| match request {
            Request::Range(range) => range.clone(),
            Request::Head => panic!("unexpected HEAD"),
        })
        .collect()
}

/// Requests `object_store`'s default `get_ranges` issues for `wanted`.
async fn coalesced(wanted: &[Range<u64>]) -> Vec<Range<u64>> {
    let issued = Mutex::new(Vec::new());
    object_store::coalesce_ranges(
        wanted,
        |range| {
            issued.lock().unwrap().push(range.clone());
            let len = (range.end - range.start) as usize;
            async move { Ok::<_, object_store::Error>(Bytes::from(vec![0; len])) }
        },
        object_store::OBJECT_STORE_COALESCE_DEFAULT,
    )
    .await
    .unwrap();
    issued.into_inner().unwrap()
}

/// Wire requests expected for one cold load: probe, trailer-planned read, then uncovered columns.
async fn expected_requests(fixture: &Fixture, requested: &[String]) -> Vec<Range<u64>> {
    let size = fixture.midx.len() as u64;
    let trailer = fixture.trailer();
    let probe_start = size.saturating_sub(HEADER_PROBE_BYTES);
    let tail_start = if trailer.label_len + trailer.directory_len <= SMALL_METADATA_BYTES {
        trailer.payload_end(size)
    } else if trailer.header_start(size) < probe_start {
        trailer.directory_start(size)
    } else {
        probe_start
    }
    .min(probe_start);
    let mut requests = Vec::new();
    requests.push(probe_start..size);
    if tail_start < probe_start {
        requests.push(tail_start..probe_start);
    }
    let uncovered = fixture
        .header()
        .column_ranges(requested)
        .unwrap()
        .into_iter()
        .filter(|range| range.start < tail_start)
        .map(|range| range.start..range.end.min(tail_start))
        .collect::<Vec<_>>();
    requests.extend(coalesced(&uncovered).await);
    requests
}

#[test]
fn header_probe_covers_wide_headers() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    for labels in [0, 1, 8, 32, 64, 128] {
        let fixture = rt.block_on(Fixture::new(config::FileFormat::Parquet, labels, 16));
        let tail = (fixture.header_len() + MIDX_TRAILER_LEN) as u64;
        eprintln!("MIDX header with {labels} labels: {tail} bytes");
        assert!(tail <= HEADER_PROBE_BYTES, "{labels} labels: {tail} bytes");
    }
}

#[tokio::test]
async fn cold_load_reads_tail_then_only_requested_columns() {
    for format in [config::FileFormat::Parquet, config::FileFormat::Vortex] {
        for (labels, series) in [(0, 8), (3, 64), (3, 20_000), (128, 3_000)] {
            let fixture = Fixture::new(format, labels, series).await;
            let payload_end = fixture.header().payload_end();
            let cases = [
                vec![],
                vec![label_name(0)],
                vec![label_name(labels.saturating_sub(1))],
            ];
            for requested in cases.iter().filter(|r| labels > 0 || r.is_empty()) {
                let requests = fixture.store().await;
                let data = fixture.load(requested).await.unwrap();
                assert_eq!(data.parent_records, series * 2);
                let actual = ranges(&requests);
                let case = format!("{format:?} {labels} labels {series} series {requested:?}");
                assert_eq!(
                    actual,
                    expected_requests(&fixture, requested).await,
                    "{case}"
                );
                assert!(actual.len() <= 3, "{case}");
                assert!(
                    actual[1..].iter().all(|range| range.start >= payload_end),
                    "{case}: read sample blocks"
                );
            }
        }
    }
}

#[tokio::test]
async fn large_file_skips_unrequested_label_columns() {
    let fixture = Fixture::new(config::FileFormat::Parquet, 128, 8_000).await;
    let metadata = fixture.midx.len() as u64 - fixture.header().payload_end();
    let requests = fixture.store().await;
    let requested = vec![label_name(0)];
    fixture.load(&requested).await.unwrap();
    let actual = ranges(&requests);
    let read = actual
        .iter()
        .map(|range| range.end - range.start)
        .sum::<u64>();
    assert_eq!(actual, expected_requests(&fixture, &requested).await);
    assert!(metadata > 4 * object_store::OBJECT_STORE_COALESCE_DEFAULT);
    assert!(
        read * 4 < metadata,
        "read {read} of {metadata} metadata bytes"
    );
}

#[tokio::test]
async fn small_metadata_is_read_whole_in_the_second_request() {
    let fixture = Fixture::new(config::FileFormat::Parquet, 16, 5_000).await;
    let size = fixture.midx.len() as u64;
    let trailer = fixture.trailer();
    let metadata = size - trailer.payload_end(size);
    assert!(metadata > HEADER_PROBE_BYTES);
    assert!(trailer.label_len + trailer.directory_len <= SMALL_METADATA_BYTES);
    for requested in [
        vec![],
        vec![label_name(0)],
        vec![label_name(15)],
        (0..16).map(label_name).collect(),
    ] {
        let requests = fixture.store().await;
        fixture.load(&requested).await.unwrap();
        assert_eq!(
            ranges(&requests),
            vec![
                size - HEADER_PROBE_BYTES..size,
                trailer.payload_end(size)..size - HEADER_PROBE_BYTES
            ],
            "{requested:?}"
        );
    }
}

#[tokio::test]
async fn header_beyond_probe_is_read_with_the_whole_directory() {
    let metadata = HashMap::from([("large".to_string(), "x".repeat(200 * 1024))]);
    let fixture = Fixture::with_metadata(config::FileFormat::Vortex, 16, 20_000, metadata).await;
    let size = fixture.midx.len() as u64;
    let trailer = fixture.trailer();
    assert!(trailer.header_start(size) < size - HEADER_PROBE_BYTES);
    assert!(trailer.label_len + trailer.directory_len > SMALL_METADATA_BYTES);
    let requests = fixture.store().await;
    let requested = vec![label_name(0)];
    fixture.load(&requested).await.unwrap();
    let actual = ranges(&requests);
    assert_eq!(actual.len(), 3);
    assert_eq!(
        actual[1],
        trailer.directory_start(size)..size - HEADER_PROBE_BYTES
    );
    assert_eq!(
        actual[2],
        fixture.header().column_ranges(&requested).unwrap()[1]
    );
    assert_eq!(actual, expected_requests(&fixture, &requested).await);
}

#[tokio::test]
async fn stale_size_retries_once_with_head() {
    let fixture = Fixture::new(config::FileFormat::Parquet, 3, 64).await;
    let requests = fixture.store().await;
    let mut stale = fixture;
    stale.file.meta.mindex_size += 1;
    let data = stale.load(&[label_name(1)]).await.unwrap();
    assert_eq!(data.parent_records, 128);
    let log = requests.lock().unwrap().clone();
    let size = stale.midx.len() as u64;
    assert_eq!(
        log[0],
        Request::Range((size + 1).saturating_sub(HEADER_PROBE_BYTES)..size + 1)
    );
    assert_eq!(log[1], Request::Head);
    assert_eq!(
        log[2],
        Request::Range(size.saturating_sub(HEADER_PROBE_BYTES)..size)
    );
}

#[tokio::test]
async fn corrupt_offsets_and_truncation_fail_before_decoding() {
    let fixture = Fixture::new(config::FileFormat::Vortex, 3, 20_000).await;
    assert!(fixture.midx.len() as u64 > 2 * HEADER_PROBE_BYTES);
    let size = fixture.midx.len();
    let trailer = size - MIDX_TRAILER_LEN;
    let header_len = fixture.header_len();
    let mut wrong_len = fixture.midx.clone();
    wrong_len[trailer + 16..trailer + 20].copy_from_slice(&(header_len as u32 - 1).to_le_bytes());
    let mut huge = fixture.midx.clone();
    huge[trailer + 16..trailer + 20].copy_from_slice(&u32::MAX.to_le_bytes());
    let mut regions = fixture.midx.clone();
    regions[trailer..trailer + 8].copy_from_slice(&(size as u64).to_le_bytes());
    let mut column = fixture.midx.clone();
    let json_start = trailer - header_len;
    let json = std::str::from_utf8(&column[json_start..trailer]).unwrap();
    let length = json.split("\"compressed\":").nth(1).unwrap();
    let digits = length.find(|c: char| !c.is_ascii_digit()).unwrap();
    let position = json_start + json.len() - length.len() + digits - 1;
    column[position] = if column[position] == b'9' {
        b'8'
    } else {
        column[position] + 1
    };
    let payload_end = fixture.header().payload_end();
    for (case, bytes, trailer_error) in [
        ("header length", &wrong_len[..], false),
        ("oversized header", &huge[..], true),
        ("region lengths", &regions[..], true),
        ("truncated", &fixture.midx[..size - 1], true),
        ("column length", &column[..], false),
    ] {
        let requests = fixture.store_with(Some(bytes), None).await;
        assert!(fixture.load(&[label_name(1)]).await.is_err(), "{case}");
        assert!(
            requests
                .lock()
                .unwrap()
                .iter()
                .all(|request| match request {
                    Request::Head => true,
                    Request::Range(range) if trailer_error => {
                        range.start + HEADER_PROBE_BYTES + 1 >= size as u64
                    }
                    Request::Range(range) => range.start >= payload_end,
                }),
            "{case}: read beyond what the trailer allows"
        );
    }
}

#[tokio::test]
async fn selections_match_source_rows_across_formats_and_label_counts() {
    for format in [config::FileFormat::Parquet, config::FileFormat::Vortex] {
        for labels in [1, 3, 128] {
            let fixture = Fixture::new(format, labels, 200).await;
            fixture.store().await;
            for (label, value) in [
                (0, label_value(0, 17)),
                (labels - 1, "value-3".to_string()),
                (0, "absent".into()),
            ] {
                let mut files = vec![fixture.file.clone()];
                let matchers = Matchers::new(vec![Matcher::new(
                    MatchOp::Equal,
                    &label_name(label),
                    &value,
                )]);
                let (_, exact) = crate::search(
                    "io",
                    &mut files,
                    fixture.batch.schema().as_ref(),
                    &matchers,
                    1,
                )
                .await
                .unwrap()
                .unwrap();
                assert!(exact);
                let expected = fixture.expected_ranges(label, &value);
                if expected.is_empty() {
                    assert!(files.is_empty(), "{format:?} {labels} {label}={value}");
                } else {
                    assert!(
                        matches!(&files[0].selection, Some(FileSelection::RowRanges(ranges)) if ranges.as_ref() == &expected),
                        "{format:?} {labels} {label}={value}"
                    );
                }
            }
            let data = fixture.load(&[]).await.unwrap();
            assert_eq!(
                evaluate_metrics_index(&data, None, 400).unwrap(),
                vec![0..400]
            );
        }
    }
}

#[tokio::test]
async fn unfiltered_query_reads_no_index() {
    let fixture = Fixture::new(config::FileFormat::Parquet, 3, 64).await;
    let requests = fixture.store().await;
    let mut files = vec![fixture.file.clone()];
    let matchers = Matchers::new(vec![Matcher::new(MatchOp::Equal, "__name__", "m")]);
    assert!(
        crate::search(
            "io",
            &mut files,
            fixture.batch.schema().as_ref(),
            &matchers,
            1
        )
        .await
        .unwrap()
        .is_none()
    );
    assert!(requests.lock().unwrap().is_empty());
    assert!(files[0].selection.is_none());
}

#[tokio::test]
async fn previous_format_files_mixed_with_current_keep_source_scan() {
    let current = Fixture::new(config::FileFormat::Parquet, 3, 64).await;
    current.store().await;
    let previous = Fixture::new(config::FileFormat::Vortex, 3, 64).await;
    let mut v2 = previous.midx.clone();
    let magic = v2.len() - 8;
    v2[magic..].copy_from_slice(b"O2MIDX02");
    previous.store_with(Some(&v2), None).await;
    let value = "value-3";
    let mut files = vec![current.file.clone(), previous.file.clone()];
    let matchers = Matchers::new(vec![Matcher::new(MatchOp::Equal, &label_name(1), value)]);
    let (_, exact) = crate::search(
        "mixed",
        &mut files,
        current.batch.schema().as_ref(),
        &matchers,
        1,
    )
    .await
    .unwrap()
    .unwrap();
    assert!(!exact, "an unreadable index keeps the query filters");
    assert_eq!(files.len(), 2);
    assert!(
        matches!(&files[0].selection, Some(FileSelection::RowRanges(ranges)) if ranges.as_ref() == &current.expected_ranges(1, value))
    );
    assert!(files[1].selection.is_none());
}

#[tokio::test]
async fn cancelled_and_concurrent_loads_are_independent() {
    let fixture = Arc::new(Fixture::new(config::FileFormat::Parquet, 3, 20_000).await);
    let requested = vec![label_name(0)];
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    fixture
        .store_with(
            Some(&fixture.midx),
            Some((Arc::clone(&entered), Arc::clone(&release))),
        )
        .await;
    let blocked = {
        let fixture = Arc::clone(&fixture);
        let requested = requested.clone();
        tokio::spawn(async move {
            fixture
                .load(&requested)
                .await
                .map(|data| data.parent_records)
        })
    };
    entered.notified().await;
    blocked.abort();
    assert!(matches!(blocked.await, Err(error) if error.is_cancelled()));

    fixture.store().await;
    let loads = (0..8).map(|_| fixture.load(&requested));
    let results = futures::future::join_all(loads).await;
    let expected = fixture.expected_ranges(0, &label_value(0, 5));
    let matchers = Matchers::new(vec![Matcher::new(
        MatchOp::Equal,
        &label_name(0),
        &label_value(0, 5),
    )]);
    for data in results {
        let data = data.unwrap();
        let filter =
            crate::pruner::create_physical_filter(data.schema.as_ref(), &matchers).unwrap();
        assert_eq!(
            evaluate_metrics_index(&data, filter.as_deref(), 40_000).unwrap(),
            expected
        );
    }
}

/// Six rows over three series whose `path` is `a`, null and the empty string.
async fn path_fixture(format: config::FileFormat) -> Fixture {
    let schema = Arc::new(Schema::new(vec![
        Field::new("__hash__", DataType::UInt64, false),
        Field::new("_timestamp", DataType::Int64, false),
        Field::new("value", DataType::Float64, false),
        Field::new("path", DataType::Utf8, true),
    ]));
    let columns: Vec<ArrayRef> = vec![
        Arc::new(UInt64Array::from(vec![1, 1, 1, 2, 2, 3])),
        Arc::new(Int64Array::from(vec![10, 20, 30, 10, 20, 10])),
        Arc::new(Float64Array::from(vec![1., 2., 3., 4., 5., 6.])),
        Arc::new(StringArray::from(vec![
            Some("a"),
            Some("a"),
            Some("a"),
            None,
            None,
            Some(""),
        ])),
    ];
    Fixture::from_batch(format, RecordBatch::try_new(schema, columns).unwrap()).await
}

#[tokio::test]
async fn path_label_prunes_nulls_and_empty_strings_for_both_parent_formats() {
    for format in [config::FileFormat::Parquet, config::FileFormat::Vortex] {
        let fixture = path_fixture(format).await;
        fixture.store().await;
        for (op, value, expected) in [
            (MatchOp::Equal, "a", vec![Range { start: 0, end: 3 }]),
            (MatchOp::Equal, "", vec![Range { start: 5, end: 6 }]),
            (MatchOp::NotEqual, "a", vec![Range { start: 5, end: 6 }]),
            (MatchOp::Re(".*".parse().unwrap()), ".*", vec![0..3, 5..6]),
            (MatchOp::Equal, "unmatched", vec![]),
        ] {
            let mut files = vec![fixture.file.clone()];
            let case = format!("{format:?} {op:?} {value}");
            let matchers = Matchers::new(vec![Matcher::new(op, "path", value)]);
            let (_, exact) = crate::search(
                "prune",
                &mut files,
                fixture.batch.schema().as_ref(),
                &matchers,
                1,
            )
            .await
            .unwrap()
            .unwrap();
            assert!(exact, "{case}");
            if expected.is_empty() {
                assert!(files.is_empty(), "{case}");
            } else {
                assert_eq!(files.len(), 1, "{case}");
                assert!(
                    matches!(&files[0].selection, Some(FileSelection::RowRanges(ranges)) if ranges.as_ref() == &expected),
                    "{case}"
                );
                assert_eq!(
                    files[0].row_group_size.is_some(),
                    format == config::FileFormat::Parquet
                );
            }
        }
    }
}

#[tokio::test]
async fn equality_keeps_dictionary_and_regex_flattens_label() {
    let fixture = path_fixture(config::FileFormat::Vortex).await;
    fixture.store().await;
    let path = vec!["path".to_string()];
    for flat in [false, true] {
        let data = fixture
            .load_labels(&path, if flat { &path } else { &[] })
            .await
            .unwrap();
        assert_eq!(
            matches!(
                data.schema.field_with_name("path").unwrap().data_type(),
                DataType::Dictionary(_, _)
            ),
            !flat
        );
    }
}

#[tokio::test]
async fn unusable_index_preserves_source_scan() {
    for format in [config::FileFormat::Parquet, config::FileFormat::Vortex] {
        for bytes in [None, Some(&[0u8; 128][..])] {
            let fixture = path_fixture(format).await;
            fixture.store_with(bytes, None).await;
            let mut files = vec![fixture.file.clone()];
            let matchers = Matchers::new(vec![Matcher::new(MatchOp::Equal, "path", "a")]);
            let (_, exact) = crate::search(
                "fallback",
                &mut files,
                fixture.batch.schema().as_ref(),
                &matchers,
                1,
            )
            .await
            .unwrap()
            .unwrap();
            assert!(!exact);
            assert_eq!(files.len(), 1);
            assert!(files[0].selection.is_none());
        }
    }
}
