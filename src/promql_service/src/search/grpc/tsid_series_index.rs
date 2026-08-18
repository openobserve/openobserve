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
    collections::{BTreeMap, HashMap},
    io::Cursor,
    ops::Range,
    sync::{Arc, LazyLock},
};

use arrow::{
    array::{Array, BooleanArray, RecordBatch, UInt32Array, UInt64Array},
    datatypes::{Schema, SchemaRef},
    ipc::reader::FileReaderBuilder as ArrowFileReaderBuilder,
};
use config::{
    PARQUET_MAX_ROW_GROUP_SIZE, TIMESTAMP_COL_NAME,
    meta::{
        promql::{
            EXEMPLARS_LABEL, MetricsFileLayout, TSID_SERIES_INDEX_ROW_COUNT,
            TSID_SERIES_INDEX_ROW_START, VALUE_LABEL,
        },
        stream::{FileKey, FileSelection},
    },
};
use datafusion::{
    common::{DFSchema, DataFusionError, Result},
    logical_expr::Expr,
    physical_plan::PhysicalExpr,
    prelude::SessionContext,
};
use futures::{StreamExt, stream};
use hashlink::LruCache;
use parking_lot::Mutex;
use promql_parser::label::Matchers;
use rayon::prelude::*;
use search::types::QueryParams;

const SERIES_SELECTION_CACHE_MAX_BYTES: usize = 256 * 1024 * 1024;

struct SeriesIndexData {
    schema: SchemaRef,
    batches: Vec<RecordBatch>,
}

struct SeriesSelectionCache {
    entries: LruCache<String, Arc<Vec<Range<usize>>>>,
    memory_size: usize,
}

impl Default for SeriesSelectionCache {
    fn default() -> Self {
        Self {
            entries: LruCache::new_unbounded(),
            memory_size: 0,
        }
    }
}

impl SeriesSelectionCache {
    fn get(&mut self, key: &str) -> Option<Arc<Vec<Range<usize>>>> {
        self.entries.get(key).cloned()
    }

    fn insert(&mut self, key: String, ranges: Arc<Vec<Range<usize>>>) {
        let key_memory_size = key.len();
        let ranges_memory_size = ranges.capacity() * std::mem::size_of::<Range<usize>>()
            + std::mem::size_of::<Vec<Range<usize>>>();
        let memory_size = key_memory_size + ranges_memory_size;
        if memory_size > SERIES_SELECTION_CACHE_MAX_BYTES {
            return;
        }
        if let Some(previous) = self.entries.insert(key, Arc::clone(&ranges)) {
            self.memory_size = self.memory_size.saturating_sub(
                key_memory_size
                    + previous.capacity() * std::mem::size_of::<Range<usize>>()
                    + std::mem::size_of::<Vec<Range<usize>>>(),
            );
        }
        self.memory_size += memory_size;
        while self.memory_size > SERIES_SELECTION_CACHE_MAX_BYTES {
            let Some((key, evicted)) = self.entries.remove_lru() else {
                break;
            };
            self.memory_size = self.memory_size.saturating_sub(
                key.len()
                    + evicted.capacity() * std::mem::size_of::<Range<usize>>()
                    + std::mem::size_of::<Vec<Range<usize>>>(),
            );
        }
    }
}

static SERIES_SELECTION_CACHE: LazyLock<Mutex<SeriesSelectionCache>> =
    LazyLock::new(|| Mutex::new(SeriesSelectionCache::default()));

/// Apply a TSID-major `.sidx` sidecar before registering the metrics table.
///
/// This mirrors the PromQL Tantivy path: matching physical rows are attached
/// to each [`FileKey`] and the generic DataFusion scan later converts that
/// selection into a Parquet access plan. `Ok(None)` means the file set or
/// matchers are not eligible and the caller should try Tantivy/full scan.
pub(super) async fn search(
    query: &QueryParams,
    files: &mut Vec<FileKey>,
    table_schema: &Schema,
    matchers: &Matchers,
    target_partitions: usize,
) -> Result<Option<usize>> {
    let Some(matcher_labels) = series_index_labels(table_schema, matchers) else {
        return Ok(None);
    };
    let matcher_labels = Arc::new(matcher_labels);
    if files.is_empty() {
        return Ok(None);
    }

    // Keep the complete matcher set in the key. A short hash collision could
    // otherwise reuse physical row ranges selected by a different query.
    let filter_key = format!("{matchers:?}");
    let mut index_files = BTreeMap::new();
    for file in files.iter() {
        if MetricsFileLayout::of(&file.key) != MetricsFileLayout::TsidMajor {
            return Ok(None);
        }
        let sidecar_path = MetricsFileLayout::series_index_path(&file.key).ok_or_else(|| {
            DataFusionError::Execution(format!(
                "TSID-major file has no series-index path: {}",
                file.key
            ))
        })?;
        let cache_key = format!("{}\0{sidecar_path}\0{filter_key}", file.account);
        index_files.entry(file.key.clone()).or_insert((
            file.account.clone(),
            sidecar_path,
            cache_key,
        ));
    }

    let start = std::time::Instant::now();
    let mut evaluated = Vec::with_capacity(index_files.len());
    let mut misses = Vec::new();
    {
        let mut cache = SERIES_SELECTION_CACHE.lock();
        for (data_path, (account, sidecar_path, cache_key)) in index_files {
            if let Some(ranges) = cache.get(&cache_key) {
                evaluated.push((data_path, ranges));
            } else {
                misses.push((data_path, account, sidecar_path, cache_key));
            }
        }
    }
    let cache_hits = evaluated.len();
    let concurrency = target_partitions.max(1).saturating_mul(2).min(64);
    let loaded = stream::iter(misses.into_iter().map(
        |(data_path, account, sidecar_path, cache_key)| {
            let labels = Arc::clone(&matcher_labels);
            async move {
                load_series_index_file(&account, &sidecar_path, labels)
                    .await
                    .map(|data| (data_path, cache_key, data))
            }
        },
    ))
    .buffer_unordered(concurrency)
    .collect::<Vec<_>>()
    .await;

    let loaded_files = loaded.into_iter().collect::<Result<Vec<_>>>()?;
    // Sidecars written at different times can carry different label sets and
    // column orders, so the physical filter is resolved by name against each
    // file's own schema instead of being shared across files.
    let newly_evaluated = loaded_files
        .into_par_iter()
        .map(|(path, cache_key, data)| {
            let physical_filter = create_physical_filter(data.schema.as_ref(), matchers)?;
            evaluate_series_index(&data, physical_filter.as_deref())
                .map(|ranges| (path, cache_key, Arc::new(ranges)))
        })
        .collect::<Result<Vec<_>>>()?;
    {
        let mut cache = SERIES_SELECTION_CACHE.lock();
        for (path, cache_key, ranges) in newly_evaluated {
            cache.insert(cache_key, Arc::clone(&ranges));
            evaluated.push((path, ranges));
        }
    }

    let selected_files = evaluated
        .iter()
        .filter(|(_, ranges)| !ranges.is_empty())
        .count();
    let selected_ranges = evaluated
        .iter()
        .map(|(_, ranges)| ranges.len())
        .sum::<usize>();
    let indexed_file_count = evaluated.len();
    let mut selections = evaluated.into_iter().collect::<HashMap<_, _>>();
    files.retain_mut(|file| {
        let Some(ranges) = selections.remove(&file.key) else {
            return false;
        };
        if ranges.is_empty() {
            return false;
        }
        file.with_selection(
            FileSelection::RowRanges(ranges),
            Some(PARQUET_MAX_ROW_GROUP_SIZE as u32),
        );
        true
    });

    let took = start.elapsed().as_millis() as usize;
    log::info!(
        "[trace_id {}] promql->series-index: selected {selected_ranges} ranges across {selected_files}/{} files, selection cache hits: {cache_hits}, took: {took} ms",
        query.trace_id,
        indexed_file_count,
    );
    Ok(Some(took))
}

/// Labels referenced by the matchers that the sidecar can answer. `None`
/// when no matcher can be evaluated on the series index.
fn series_index_labels(table_schema: &Schema, matchers: &Matchers) -> Option<Vec<String>> {
    let mut labels: Vec<String> = Vec::new();
    for matcher in &matchers.matchers {
        if matches!(
            matcher.name.as_str(),
            TIMESTAMP_COL_NAME | VALUE_LABEL | EXEMPLARS_LABEL
        ) || table_schema.field_with_name(&matcher.name).is_err()
        {
            continue;
        }
        if !labels.contains(&matcher.name) {
            labels.push(matcher.name.clone());
        }
    }
    (!labels.is_empty()).then_some(labels)
}

async fn load_series_index_file(
    account: &str,
    path: &str,
    labels: Arc<Vec<String>>,
) -> Result<SeriesIndexData> {
    let bytes = infra::cache::file_data::get(account, path, None)
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?;
    let path = path.to_string();
    tokio::task::spawn_blocking(move || decode_series_index(&path, bytes, &labels))
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?
}

/// Read the row-range columns plus the requested labels from a sidecar.
///
/// The projection is resolved by name against the sidecar's own schema: the
/// label set and column order of a sidecar depend on the schema at compaction
/// time and differ between files. A requested label that the sidecar does not
/// have is skipped, which over-selects that file; the final PromQL filter keeps
/// the query result exact.
fn decode_series_index(
    path: &str,
    bytes: bytes::Bytes,
    labels: &[String],
) -> Result<SeriesIndexData> {
    let file_schema = ArrowFileReaderBuilder::new()
        .build(Cursor::new(bytes.clone()))?
        .schema();
    let mut projection = vec![
        file_schema.index_of(TSID_SERIES_INDEX_ROW_START)?,
        file_schema.index_of(TSID_SERIES_INDEX_ROW_COUNT)?,
    ];
    for label in labels {
        match file_schema.index_of(label) {
            Ok(index) => projection.push(index),
            Err(_) => log::debug!(
                "TSID series index {path} has no label {label}, evaluating the remaining matchers only"
            ),
        }
    }
    let reader = ArrowFileReaderBuilder::new()
        .with_projection(projection)
        .build(Cursor::new(bytes))?;
    let reader_schema = reader.schema();
    let batches = reader.collect::<std::result::Result<Vec<_>, _>>()?;
    let schema = batches
        .first()
        .map(RecordBatch::schema)
        .unwrap_or(reader_schema);
    Ok(SeriesIndexData { schema, batches })
}

/// Physical filter over the sidecar columns. `None` when none of the matchers
/// can be evaluated on this sidecar (all matched labels are missing): every
/// series of the file must then be scanned.
fn create_physical_filter(
    sidecar_schema: &Schema,
    matchers: &Matchers,
) -> Result<Option<Arc<dyn PhysicalExpr>>> {
    let Some(filter) = promql::utils::matcher_predicates(sidecar_schema, matchers)
        .into_iter()
        .reduce(Expr::and)
    else {
        return Ok(None);
    };
    let df_schema = DFSchema::try_from(sidecar_schema.clone())?;
    SessionContext::new()
        .state()
        .create_physical_expr(filter, &df_schema)
        .map(Some)
}

fn evaluate_series_index(
    data: &SeriesIndexData,
    filter: Option<&dyn PhysicalExpr>,
) -> Result<Vec<Range<usize>>> {
    let start_index = data.schema.index_of(TSID_SERIES_INDEX_ROW_START)?;
    let count_index = data.schema.index_of(TSID_SERIES_INDEX_ROW_COUNT)?;
    let mut ranges: Vec<Range<usize>> = Vec::new();

    for batch in &data.batches {
        let mask = match filter {
            Some(filter) => {
                let mask = filter.evaluate(batch)?.into_array(batch.num_rows())?;
                mask.as_any()
                    .downcast_ref::<BooleanArray>()
                    .ok_or_else(|| {
                        DataFusionError::Execution(
                            "TSID series-index filter did not produce a boolean array".to_string(),
                        )
                    })?
                    .clone()
            }
            None => BooleanArray::from(vec![true; batch.num_rows()]),
        };
        let mask = &mask;
        let starts = batch
            .column(start_index)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .ok_or_else(|| {
                DataFusionError::Execution("TSID series-index row start is not UInt64".to_string())
            })?;
        let counts = batch
            .column(count_index)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .ok_or_else(|| {
                DataFusionError::Execution("TSID series-index row count is not UInt32".to_string())
            })?;

        for row in 0..batch.num_rows() {
            if mask.is_null(row) || !mask.value(row) {
                continue;
            }
            let start = usize::try_from(starts.value(row)).map_err(|_| {
                DataFusionError::Execution("TSID series-index row start exceeds usize".to_string())
            })?;
            let end = start
                .checked_add(counts.value(row) as usize)
                .ok_or_else(|| {
                    DataFusionError::Execution("TSID series-index row range overflow".to_string())
                })?;
            if start == end {
                return Err(DataFusionError::Execution(
                    "TSID series-index contains an empty row range".to_string(),
                ));
            }
            if let Some(previous) = ranges.last_mut()
                && start <= previous.end
            {
                previous.end = previous.end.max(end);
            } else {
                ranges.push(start..end);
            }
        }
    }
    Ok(ranges)
}

#[cfg(test)]
mod tests {
    use arrow::{
        array::{StringViewArray, UInt32Array, UInt64Array},
        datatypes::{DataType, Field},
        ipc::writer::FileWriter as ArrowFileWriter,
    };
    use bytes::Bytes;
    use promql_parser::label::{MatchOp, Matcher};

    use super::*;

    #[test]
    fn labels_keep_only_matchable_table_labels() {
        let schema = Schema::new(vec![
            Field::new("__hash__", DataType::UInt64, false),
            Field::new("__name__", DataType::Utf8View, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("instance", DataType::Utf8View, true),
            Field::new("path", DataType::Utf8View, true),
            Field::new(VALUE_LABEL, DataType::Float64, false),
        ]);
        let matchers = Matchers::new(vec![
            Matcher::new(MatchOp::Equal, "path", "a"),
            Matcher::new(MatchOp::Equal, "path", "b"),
            Matcher::new(MatchOp::NotEqual, VALUE_LABEL, "1"),
            Matcher::new(MatchOp::Equal, "missing_label", "x"),
            Matcher::new(MatchOp::NotEqual, "instance", "i1"),
        ]);
        assert_eq!(
            series_index_labels(&schema, &matchers),
            Some(vec!["path".to_string(), "instance".to_string()])
        );

        let only_value = Matchers::new(vec![Matcher::new(MatchOp::Equal, VALUE_LABEL, "1")]);
        assert_eq!(series_index_labels(&schema, &only_value), None);
    }

    #[test]
    fn evaluates_and_coalesces_selected_ranges() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(TSID_SERIES_INDEX_ROW_START, DataType::UInt64, false),
            Field::new(TSID_SERIES_INDEX_ROW_COUNT, DataType::UInt32, false),
            Field::new("path", DataType::Utf8View, false),
        ]));
        let batch = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(UInt64Array::from(vec![0, 2, 4, 5])),
                Arc::new(UInt32Array::from(vec![2, 2, 1, 3])),
                Arc::new(StringViewArray::from(vec!["a", "b", "a", "a"])),
            ],
        )
        .unwrap();
        let data = SeriesIndexData {
            schema: Arc::clone(&schema),
            batches: vec![batch],
        };
        let matchers = Matchers::new(vec![Matcher::new(MatchOp::Equal, "path", "a")]);
        let filter = create_physical_filter(&schema, &matchers).unwrap();
        assert!(filter.is_some());

        assert_eq!(
            evaluate_series_index(&data, filter.as_deref()).unwrap(),
            vec![0..2, 4..8]
        );

        // no evaluable matcher: every series is selected
        assert_eq!(
            evaluate_series_index(&data, None).unwrap(),
            vec![Range { start: 0, end: 8 }]
        );
    }

    /// Serialize a sidecar with the given label columns (in this order).
    fn sidecar_bytes(labels: &[(&str, Vec<&str>)], starts: Vec<u64>, counts: Vec<u32>) -> Bytes {
        let mut fields = vec![
            Field::new(TSID_SERIES_INDEX_ROW_START, DataType::UInt64, false),
            Field::new(TSID_SERIES_INDEX_ROW_COUNT, DataType::UInt32, false),
        ];
        let mut columns: Vec<Arc<dyn Array>> = vec![
            Arc::new(UInt64Array::from(starts)),
            Arc::new(UInt32Array::from(counts)),
        ];
        for (name, values) in labels {
            fields.push(Field::new(*name, DataType::Utf8View, true));
            columns.push(Arc::new(StringViewArray::from(values.clone())));
        }
        let schema = Arc::new(Schema::new(fields));
        let batch = RecordBatch::try_new(Arc::clone(&schema), columns).unwrap();
        let mut writer = ArrowFileWriter::try_new(Vec::new(), &schema).unwrap();
        writer.write(&batch).unwrap();
        Bytes::from(writer.into_inner().unwrap())
    }

    #[test]
    fn projects_by_name_across_sidecars_with_different_layouts() {
        let labels = vec!["path".to_string(), "instance".to_string()];
        let matchers = Matchers::new(vec![
            Matcher::new(MatchOp::Equal, "path", "a"),
            Matcher::new(MatchOp::Equal, "instance", "i1"),
        ]);

        // file 1: [.., instance, job, path]; file 2: [.., path, instance] —
        // same labels, different positions
        let file1 = sidecar_bytes(
            &[
                ("instance", vec!["i1", "i2", "i1"]),
                ("job", vec!["j", "j", "j"]),
                ("path", vec!["a", "a", "b"]),
            ],
            vec![0, 3, 5],
            vec![3, 2, 4],
        );
        let file2 = sidecar_bytes(
            &[("path", vec!["b", "a"]), ("instance", vec!["i1", "i1"])],
            vec![0, 7],
            vec![7, 1],
        );
        for (name, bytes, expected) in [
            ("f1", file1, vec![Range { start: 0, end: 3 }]),
            ("f2", file2, vec![Range { start: 7, end: 8 }]),
        ] {
            let data = decode_series_index(name, bytes, &labels).unwrap();
            assert_eq!(data.schema.fields().len(), 4, "{name}");
            let filter = create_physical_filter(&data.schema, &matchers).unwrap();
            assert_eq!(
                evaluate_series_index(&data, filter.as_deref()).unwrap(),
                expected,
                "{name}"
            );
        }
    }

    #[test]
    fn missing_label_over_selects_instead_of_dropping() {
        let labels = vec!["path".to_string(), "instance".to_string()];
        let matchers = Matchers::new(vec![
            Matcher::new(MatchOp::Equal, "path", "a"),
            Matcher::new(MatchOp::Equal, "instance", "i1"),
        ]);

        // sidecar without `instance`: only the `path` matcher is evaluated
        let partial = sidecar_bytes(
            &[("path", vec!["a", "b", "a"])],
            vec![0, 2, 6],
            vec![2, 4, 1],
        );
        let data = decode_series_index("partial", partial, &labels).unwrap();
        assert_eq!(data.schema.fields().len(), 3);
        let filter = create_physical_filter(&data.schema, &matchers).unwrap();
        assert!(filter.is_some());
        assert_eq!(
            evaluate_series_index(&data, filter.as_deref()).unwrap(),
            vec![0..2, 6..7]
        );

        // sidecar with none of the matched labels: the whole file is selected
        let none = sidecar_bytes(&[("job", vec!["j", "j"])], vec![0, 4], vec![4, 2]);
        let data = decode_series_index("none", none, &labels).unwrap();
        assert_eq!(data.schema.fields().len(), 2);
        let filter = create_physical_filter(&data.schema, &matchers).unwrap();
        assert!(filter.is_none());
        assert_eq!(
            evaluate_series_index(&data, filter.as_deref()).unwrap(),
            vec![Range { start: 0, end: 6 }]
        );
    }
}
