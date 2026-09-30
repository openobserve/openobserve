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

use anyhow::{Context, Result, ensure};
use bytes::Bytes;

use crate::block_cache::{CachedIndex, Sidecar, SidecarBinding, covers};

/// Label and directory regions up to this total are fetched in one read instead of per column.
/// 1 MiB is object_store's coalescing gap: below it, one more request costs more than the bytes.
const SMALL_METADATA_BYTES: u64 = 1024 * 1024;

/// Trailing bytes of a MIDX file already fetched while reading its header.
struct Tail {
    start: u64,
    bytes: Bytes,
}

impl Tail {
    fn slice(&self, range: Range<u64>) -> Result<Bytes> {
        let start = usize::try_from(range.start - self.start)?;
        let end = usize::try_from(range.end - self.start)?;
        ensure!(
            start <= end && end <= self.bytes.len(),
            "MIDX column outside tail"
        );
        Ok(self.bytes.slice(start..end))
    }
}

/// Reads the sidecar columns `cached` lacks for `labels` and decodes them into a new entry.
pub(crate) async fn fetch_parsed_index(
    sidecar: &Sidecar,
    labels: &[String],
    cached: Option<Arc<CachedIndex>>,
) -> Result<Arc<CachedIndex>> {
    if let Some(entry) = &cached
        && covers(entry, labels)?
    {
        return Ok(Arc::clone(entry));
    }
    let (account, path, parent) = (
        sidecar.account.as_str(),
        sidecar.path.as_str(),
        &sidecar.parent,
    );
    let index_size = sidecar.size;
    let known_size = u64::try_from(index_size).ok().filter(|size| *size > 0);
    let size = if let Some(size) = known_size {
        size
    } else {
        head_size(account, path).await?
    };
    let (header, tail, size) = match read_header(account, path, size, parent).await {
        Ok((header, tail)) => (header, tail, size),
        Err(error) if known_size.is_some() => {
            let actual_size = head_size(account, path).await?;
            if actual_size == size {
                return Err(error);
            }
            let (header, tail) = read_header(account, path, actual_size, parent).await?;
            (header, tail, actual_size)
        }
        Err(error) => return Err(error),
    };
    let trailer = tail
        .bytes
        .get(tail.bytes.len() - crate::block::MIDX_TRAILER_LEN..)
        .context("short MIDX trailer")?;
    let binding = SidecarBinding::parse(size, trailer)?;
    if let Some(existing) = &cached {
        ensure!(
            existing.binding == binding,
            "MIDX sidecar differs from cached trailer/size"
        );
    }
    let requested = if let Some(existing) = &cached {
        existing.index.missing_labels(labels)?
    } else {
        labels.to_vec()
    };
    let mut ranges = header.column_ranges(&requested)?;
    if cached.is_some() {
        ranges.remove(0);
    }
    let columns = read_columns(account, path, &ranges, &tail).await?;
    tokio::task::spawn_blocking(move || -> Result<_> {
        let index = if let Some(existing) = cached {
            let additional =
                crate::block::decode_additional_labels(&existing.index, &columns, &requested)?;
            existing.index.merge_columns(&additional)?
        } else {
            crate::block::decode_index(&header, &columns, &requested)?
        };
        Ok(Arc::new(CachedIndex {
            index: Arc::new(index),
            binding,
        }))
    })
    .await?
}

async fn head_size(account: &str, path: &str) -> Result<u64> {
    Ok(infra::cache::storage::head(account, &path.into())
        .await?
        .size)
}

async fn get_range(account: &str, path: &str, range: Range<u64>) -> Result<Bytes> {
    let bytes = infra::cache::storage::get_range(account, &path.into(), range.clone()).await?;
    ensure!(
        bytes.len() as u64 == range.end - range.start,
        "Truncated MIDX range"
    );
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
    let mut start = size.saturating_sub(crate::block::HEADER_PROBE_BYTES);
    let mut bytes = get_range(account, path, start..size).await?;
    let trailer = crate::block::Header::trailer(&bytes, size)?;
    let needed = if trailer.label_len + trailer.directory_len <= SMALL_METADATA_BYTES {
        trailer.blocks_end(size)
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
    let header = crate::block::Header::parse(&bytes, size, parent)?;
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
        infra::cache::storage::get_ranges(account, &path.into(), &remote).await?
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
        let (prefix, expected) = fetched.next().context("Missing MIDX column range")?;
        ensure!(
            prefix.len() as u64 == expected.end - expected.start,
            "Truncated MIDX column"
        );
        columns.push(if local.is_empty() {
            prefix
        } else {
            concat(&prefix, &local)
        });
    }
    Ok(columns)
}

#[cfg(test)]
mod tests {
    use arrow::{
        array::{Float64Array, Int64Array, RecordBatch, StringArray, UInt64Array},
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
        let mut writer = crate::block::BlockWriter::new(Vec::new(), schema.clone(), 2).unwrap();
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
        let mut sidecar = Sidecar::of(&file).unwrap();
        sidecar.size += 1;
        let index = crate::block_cache::load_index(&sidecar, &["path".to_string()])
            .await
            .unwrap();
        assert_eq!(index.header.parent.rows, 6);
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
