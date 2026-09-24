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

use std::{ops::Range, sync::Arc};

use arrow::{
    array::{Array, BooleanArray, RecordBatch, UInt32Array},
    datatypes::SchemaRef,
};
use bytes::Bytes;
use datafusion::{
    common::{DataFusionError, Result},
    physical_plan::PhysicalExpr,
};

use crate::layout::METRICS_INDEX_ROW_COUNT;

/// Label plus directory regions up to this size are read whole, like object_store coalescing.
const SMALL_METADATA_BYTES: u64 = 1024 * 1024;

pub(super) struct MetricsIndexData {
    pub(super) schema: SchemaRef,
    pub(super) batches: Vec<RecordBatch>,
    pub(super) parent_records: usize,
    /// Vortex does not use Parquet row groups.
    pub(super) row_group_size: Option<u32>,
}

pub(super) struct IndexLabels {
    pub requested: Arc<Vec<String>>,
    pub flat: Arc<Vec<String>>,
}

/// Trailing bytes of a MIDX file already fetched while reading its header.
struct Tail {
    start: u64,
    bytes: Bytes,
}

impl Tail {
    fn slice(&self, range: Range<u64>) -> Result<Bytes> {
        let start = usize::try_from(range.start - self.start)
            .map_err(|error| DataFusionError::External(error.into()))?;
        let end = usize::try_from(range.end - self.start)
            .map_err(|error| DataFusionError::External(error.into()))?;
        if start > end || end > self.bytes.len() {
            return Err(DataFusionError::Execution(
                "MIDX column outside tail".into(),
            ));
        }
        Ok(self.bytes.slice(start..end))
    }
}

pub(super) async fn load_metrics_index_file(
    account: &str,
    path: &str,
    format: config::FileFormat,
    parent_rows: usize,
    parent_size: i64,
    index_size: i64,
    labels: IndexLabels,
) -> Result<MetricsIndexData> {
    let parent = crate::block::ParentMetadata {
        rows: u64::try_from(parent_rows)
            .map_err(|error| DataFusionError::External(error.into()))?,
        compressed_size: u64::try_from(parent_size)
            .map_err(|error| DataFusionError::External(error.into()))?,
    };
    load_block_metadata(account, path, parent, index_size, format, labels).await
}

/// Evaluate `filter` over the run rows and collect the selected physical row
/// ranges. Runs tile the data file, so each run's start is the prefix sum of
/// the preceding counts.
pub(super) fn evaluate_metrics_index(
    data: &MetricsIndexData,
    filter: Option<&dyn PhysicalExpr>,
    expected_rows: usize,
) -> Result<Vec<Range<usize>>> {
    let parent_records = data.parent_records;
    if parent_records != expected_rows {
        return Err(DataFusionError::Execution(format!(
            "metrics-index was written for {parent_records} rows, but the parent file contains {expected_rows} records"
        )));
    }
    let count_index = data.schema.index_of(METRICS_INDEX_ROW_COUNT)?;
    let mut ranges: Vec<Range<usize>> = Vec::new();
    let mut next_row: usize = 0;

    for batch in &data.batches {
        let mask = match filter {
            Some(filter) => {
                let mask = filter.evaluate(batch)?.into_array(batch.num_rows())?;
                mask.as_any()
                    .downcast_ref::<BooleanArray>()
                    .ok_or_else(|| {
                        DataFusionError::Execution(
                            "metrics-index filter did not produce a boolean array".to_string(),
                        )
                    })?
                    .clone()
            }
            None => BooleanArray::from(vec![true; batch.num_rows()]),
        };
        let mask = &mask;
        let counts = batch
            .column(count_index)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .ok_or_else(|| {
                DataFusionError::Execution("metrics-index row count is not UInt32".to_string())
            })?;

        for row in 0..batch.num_rows() {
            let count = counts.value(row) as usize;
            if count == 0 {
                return Err(DataFusionError::Execution(
                    "metrics-index contains an empty row range".to_string(),
                ));
            }
            let start = next_row;
            let end = start.checked_add(count).ok_or_else(|| {
                DataFusionError::Execution("metrics-index row range overflow".to_string())
            })?;
            if end > expected_rows {
                return Err(DataFusionError::Execution(format!(
                    "metrics-index row range ends at {end}, beyond the parent file's {expected_rows} records"
                )));
            }
            next_row = end;
            if mask.is_null(row) || !mask.value(row) {
                continue;
            }
            if let Some(previous) = ranges.last_mut()
                && start == previous.end
            {
                previous.end = end;
            } else {
                ranges.push(start..end);
            }
        }
    }
    if next_row != expected_rows {
        return Err(DataFusionError::Execution(format!(
            "metrics-index covers {next_row} rows, but the parent file contains {expected_rows} records"
        )));
    }
    Ok(ranges)
}

async fn load_block_metadata(
    account: &str,
    path: &str,
    parent: crate::block::ParentMetadata,
    index_size: i64,
    format: config::FileFormat,
    labels: IndexLabels,
) -> Result<MetricsIndexData> {
    let known_size = u64::try_from(index_size).ok().filter(|size| *size > 0);
    let size = if let Some(size) = known_size {
        size
    } else {
        head_size(account, path).await?
    };
    let (header, tail) = match read_header(account, path, size, &parent).await {
        Ok(read) => read,
        Err(error) if known_size.is_some() => {
            let actual_size = head_size(account, path).await?;
            if actual_size == size {
                return Err(error);
            }
            read_header(account, path, actual_size, &parent).await?
        }
        Err(error) => return Err(error),
    };
    let ranges = header
        .column_ranges(&labels.requested)
        .map_err(|error| DataFusionError::External(error.into()))?;
    let columns = read_columns(account, path, &ranges, &tail).await?;
    tokio::task::spawn_blocking(move || {
        let index = crate::block::decode_index(&header, &columns, &labels.requested)
            .map_err(|error| DataFusionError::External(error.into()))?;
        metrics_block_index_data(&index, format, &labels.flat)
    })
    .await
    .map_err(|error| DataFusionError::External(Box::new(error)))?
}

async fn head_size(account: &str, path: &str) -> Result<u64> {
    Ok(infra::cache::storage::head(account, &path.into())
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?
        .size)
}

async fn get_range(account: &str, path: &str, range: Range<u64>) -> Result<Bytes> {
    let bytes = infra::cache::storage::get_range(account, &path.into(), range.clone())
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?;
    if bytes.len() as u64 != range.end - range.start {
        return Err(DataFusionError::Execution("Truncated MIDX range".into()));
    }
    Ok(bytes)
}

fn concat(prefix: &[u8], suffix: &[u8]) -> Bytes {
    Bytes::from([prefix, suffix].concat())
}

/// Reads the probe, then in one more request whatever the trailer shows is needed before columns.
async fn read_header(
    account: &str,
    path: &str,
    size: u64,
    parent: &crate::block::ParentMetadata,
) -> Result<(crate::block::Header, Tail)> {
    let external = |error: anyhow::Error| DataFusionError::External(error.into());
    let mut start = size.saturating_sub(crate::block::HEADER_PROBE_BYTES);
    let mut bytes = get_range(account, path, start..size).await?;
    let trailer = crate::block::Header::trailer(&bytes, size).map_err(external)?;
    let needed = if trailer.label_len + trailer.directory_len <= SMALL_METADATA_BYTES {
        trailer.payload_end(size)
    } else if trailer.header_start(size) < start {
        trailer.directory_start(size)
    } else {
        start
    };
    if needed < start {
        let prefix = get_range(account, path, needed..start).await?;
        start = needed;
        bytes = concat(&prefix, &bytes);
    }
    let header = crate::block::Header::parse(&bytes, size, parent).map_err(external)?;
    Ok((header, Tail { start, bytes }))
}

/// Fetches `ranges` in one batched call, serving the parts already held in `tail` locally.
async fn read_columns(
    account: &str,
    path: &str,
    ranges: &[Range<u64>],
    tail: &Tail,
) -> Result<Vec<Bytes>> {
    let remote = ranges
        .iter()
        .filter(|range| range.start < tail.start)
        .map(|range| range.start..range.end.min(tail.start))
        .collect::<Vec<_>>();
    let mut fetched = if remote.is_empty() {
        Vec::new()
    } else {
        infra::cache::storage::get_ranges(account, &path.into(), &remote)
            .await
            .map_err(|error| DataFusionError::External(Box::new(error)))?
    }
    .into_iter()
    .zip(remote);
    let mut columns = Vec::with_capacity(ranges.len());
    for range in ranges {
        let local = tail.slice(range.start.max(tail.start)..range.end.max(tail.start))?;
        if range.start >= tail.start {
            columns.push(local);
            continue;
        }
        let (prefix, expected) = fetched
            .next()
            .ok_or_else(|| DataFusionError::Execution("Missing MIDX column range".into()))?;
        if prefix.len() as u64 != expected.end - expected.start {
            return Err(DataFusionError::Execution("Truncated MIDX column".into()));
        }
        columns.push(if local.is_empty() {
            prefix
        } else {
            concat(&prefix, &local)
        });
    }
    Ok(columns)
}

fn metrics_block_index_data(
    index: &crate::block::Index,
    format: config::FileFormat,
    flat_labels: &[String],
) -> Result<MetricsIndexData> {
    let row_group_size = match format {
        config::FileFormat::Parquet => Some(index.row_group_size.ok_or_else(|| {
            DataFusionError::Execution("Parquet block index lacks parent row group size".into())
        })?),
        config::FileFormat::Vortex if index.row_group_size.is_none() => None,
        _ => {
            return Err(DataFusionError::Execution(
                "Invalid block parent format/row-group binding".into(),
            ));
        }
    };
    let mut fields = vec![arrow::datatypes::Field::new(
        METRICS_INDEX_ROW_COUNT,
        arrow::datatypes::DataType::UInt32,
        false,
    )];
    let mut columns: Vec<arrow::array::ArrayRef> = vec![Arc::new(UInt32Array::from_iter_values(
        index.blocks.row_counts(),
    ))];
    for (i, field) in index.labels.schema().fields().iter().enumerate() {
        if index.source_schema.field_with_name(field.name()).is_ok() {
            if flat_labels.contains(field.name()) {
                let source_field = index.source_schema.field_with_name(field.name())?;
                fields.push(source_field.clone());
                columns.push(arrow::compute::cast(
                    index.labels.column(i),
                    source_field.data_type(),
                )?);
            } else {
                fields.push(field.as_ref().clone());
                columns.push(Arc::clone(index.labels.column(i)));
            }
        }
    }
    let schema = Arc::new(arrow::datatypes::Schema::new(fields));
    let batch = RecordBatch::try_new(Arc::clone(&schema), columns)?;
    Ok(MetricsIndexData {
        schema,
        batches: vec![batch],
        parent_records: usize::try_from(index.parent.rows)
            .map_err(|e| DataFusionError::External(e.into()))?,
        row_group_size,
    })
}

#[cfg(test)]
mod tests {
    use arrow::{
        array::{Float64Array, Int64Array, StringArray, UInt64Array},
        datatypes::{DataType, Field, Schema},
    };
    use config::meta::stream::{FileKey, FileMeta, FileSelection};
    use object_store::{ObjectStore, PutOptions};
    use promql_parser::label::{MatchOp, Matcher, Matchers};

    use super::*;
    use crate::MetricsFileLayout;

    async fn fixture(format: config::FileFormat) -> (RecordBatch, FileKey, Vec<u8>) {
        let schema = Arc::new(Schema::new(vec![
            Field::new("__hash__", DataType::UInt64, false),
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("value", DataType::Float64, false),
            Field::new("path", DataType::Utf8, true),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
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
            ],
        )
        .unwrap();
        let id = config::ider::uuid();
        let mut file = FileKey::new(
            0,
            format!("{id}:default"),
            format!(
                "files/test/metrics/m/2026/09/20/00/indexed-v1-{id}{}",
                format.extension()
            ),
            FileMeta {
                records: 6,
                compressed_size: 123,
                ..Default::default()
            },
            false,
        );
        let mut writer =
            crate::block::BlockWriter::new_pending(Vec::new(), schema.clone(), 2).unwrap();
        writer.write(&batch).unwrap();
        let bytes = match format {
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
                writer.finish_for_parquet(
                    crate::block::ParentMetadata {
                        rows: 6,
                        compressed_size: file.meta.compressed_size as u64,
                    },
                    metadata,
                )
            }
            config::FileFormat::Vortex => writer.finish_for_vortex(
                crate::block::ParentMetadata {
                    rows: 6,
                    compressed_size: 123,
                },
                schema,
            ),
        }
        .unwrap();
        file.meta.mindex_size = i64::try_from(bytes.len()).unwrap();
        (batch, file, bytes)
    }

    async fn store(file: &FileKey, bytes: Option<Vec<u8>>) {
        let store = object_store::memory::InMemory::new();
        if let Some(bytes) = bytes {
            let path = MetricsFileLayout::metrics_index_path(&file.key).unwrap();
            store
                .put_opts(
                    &path.into(),
                    bytes::Bytes::from(bytes).into(),
                    PutOptions::default(),
                )
                .await
                .unwrap();
        }
        let id = file.account.strip_suffix(":default").unwrap();
        infra::storage::add_account(id, Box::new(store)).await;
    }

    #[tokio::test]
    async fn current_metadata_prunes_both_parent_formats() {
        for format in [config::FileFormat::Parquet, config::FileFormat::Vortex] {
            let (batch, file, bytes) = fixture(format).await;
            store(&file, Some(bytes)).await;
            for (op, value, expected) in [
                (MatchOp::Equal, "a", vec![Range { start: 0, end: 3 }]),
                (MatchOp::Equal, "", vec![Range { start: 5, end: 6 }]),
                (MatchOp::NotEqual, "a", vec![Range { start: 5, end: 6 }]),
                (MatchOp::Re(".*".parse().unwrap()), ".*", vec![0..3, 5..6]),
                (MatchOp::Equal, "unmatched", vec![]),
            ] {
                let mut files = vec![file.clone()];
                let case = format!("{format:?} {op:?} {value}");
                let matchers = Matchers::new(vec![Matcher::new(op, "path", value)]);
                let (_, exact) =
                    crate::search("prune", &mut files, batch.schema().as_ref(), &matchers, 1)
                        .await
                        .unwrap()
                        .unwrap();
                assert!(exact, "{case}");
                if expected.is_empty() {
                    assert!(files.is_empty());
                } else {
                    assert_eq!(files.len(), 1);
                    assert!(
                        matches!(&files[0].selection, Some(FileSelection::RowRanges(ranges)) if ranges.as_ref() == &expected)
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
    async fn stale_mindex_size_retries_with_object_size() {
        let (_, file, bytes) = fixture(config::FileFormat::Parquet).await;
        store(&file, Some(bytes)).await;
        let path = MetricsFileLayout::metrics_index_path(&file.key).unwrap();
        let data = load_metrics_index_file(
            &file.account,
            &path,
            config::FileFormat::Parquet,
            file.meta.records as usize,
            file.meta.compressed_size,
            file.meta.mindex_size + 1,
            IndexLabels {
                requested: Arc::new(vec!["path".to_string()]),
                flat: Arc::new(Vec::new()),
            },
        )
        .await
        .unwrap();
        assert_eq!(data.parent_records, 6);
    }

    #[tokio::test]
    async fn equality_keeps_dictionary_and_regex_flattens_label() {
        let (_, file, bytes) = fixture(config::FileFormat::Vortex).await;
        store(&file, Some(bytes)).await;
        let path = MetricsFileLayout::metrics_index_path(&file.key).unwrap();
        for flat in [false, true] {
            let data = load_metrics_index_file(
                &file.account,
                &path,
                config::FileFormat::Vortex,
                file.meta.records as usize,
                file.meta.compressed_size,
                file.meta.mindex_size,
                IndexLabels {
                    requested: Arc::new(vec!["path".to_string()]),
                    flat: Arc::new(if flat {
                        vec!["path".to_string()]
                    } else {
                        vec![]
                    }),
                },
            )
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
            for present in [false, true] {
                let (batch, file, _) = fixture(format).await;
                store(&file, present.then(|| vec![0; 128])).await;
                let mut files = vec![file];
                let matchers = Matchers::new(vec![Matcher::new(MatchOp::Equal, "path", "a")]);
                let (_, exact) = crate::search(
                    "fallback",
                    &mut files,
                    batch.schema().as_ref(),
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
}
