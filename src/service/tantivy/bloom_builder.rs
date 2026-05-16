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

//! Build SBBF blooms by iterating tantivy term dictionaries.
//!
//! For an indexed field, tantivy already stores a deduplicated term
//! dictionary. Iterating it is much cheaper than re-scanning the parquet
//! column — terms come back already unique, sorted, and as raw bytes.
//!
//! Used by the compactor `merge_files()` hook to build per-(file, field)
//! blooms after the .ttv file is written.

use anyhow::Context;
use infra::bloom::{BloomBuilder, FieldBloom};
use tantivy::Index;

/// Build blooms for the given fields against an already-opened tantivy
/// `Index`. The caller pairs the resulting `FieldBloom`s with their
/// `file_id` (the file_list row id of the originating parquet file).
///
/// Behavior:
/// - Fields not present in the schema are silently skipped — the compactor passes the union of
///   `index_fields ∩ bloom_filter_fields` over potentially many streams, and not every field exists
///   everywhere.
/// - Terms across all segments of the index are merged into one bloom per field. Today
///   `create_tantivy_index` produces a single segment, but this is robust to that changing.
pub fn build_blooms_from_index(
    index: &Index,
    file_id: u64,
    fields: &[String],
    fpp: f64,
) -> anyhow::Result<Vec<FieldBloom>> {
    if fields.is_empty() {
        return Ok(Vec::new());
    }

    let schema = index.schema();
    let reader = index
        .reader_builder()
        .reload_policy(tantivy::ReloadPolicy::Manual)
        .num_warming_threads(0)
        .try_into()
        .context("open tantivy reader")?;
    let searcher = reader.searcher();

    let mut builder = BloomBuilder::new().with_fpp(fpp);

    for field_name in fields {
        let Ok(field) = schema.get_field(field_name) else {
            continue;
        };

        // Estimate the number of unique terms across all segments. This is
        // an upper bound — duplicates across segments inflate it slightly,
        // but oversizing the bloom is cheap and FPR-safe.
        let mut term_estimate: usize = 0;
        for seg in searcher.segment_readers() {
            let inv = match seg.inverted_index(field) {
                Ok(i) => i,
                Err(_) => continue,
            };
            term_estimate = term_estimate.saturating_add(inv.terms().num_terms());
        }
        if term_estimate == 0 {
            continue;
        }

        let idx = builder.begin(file_id, field_name, term_estimate);

        for seg in searcher.segment_readers() {
            let inv = match seg.inverted_index(field) {
                Ok(i) => i,
                Err(_) => continue,
            };
            let mut stream = inv
                .terms()
                .stream()
                .with_context(|| format!("stream terms for {field_name}"))?;
            while let Some((term_bytes, _info)) = stream.next() {
                builder.insert(idx, term_bytes);
            }
        }
    }

    Ok(builder.finish())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{RecordBatch, StringArray},
        datatypes::{DataType, Field, Schema},
    };
    use config::utils::parquet::RecordBatchStream;
    use futures::stream;
    use tantivy::directory::RamDirectory;

    use super::*;
    use crate::service::tantivy::generate_tantivy_index;

    fn batches_to_stream(batches: Vec<RecordBatch>) -> RecordBatchStream {
        Box::pin(stream::iter(batches.into_iter().map(Ok)))
    }

    /// Build a real in-memory tantivy index from a single record batch and
    /// then verify the bloom we extract round-trips term membership.
    #[tokio::test]
    async fn test_build_blooms_round_trip() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("trace_id", DataType::Utf8, false),
            Field::new("user_id", DataType::Utf8, false),
            Field::new("level", DataType::Utf8, false),
        ]));
        let trace_ids = (0..100)
            .map(|i| format!("trace-{i:03}"))
            .collect::<Vec<_>>();
        let user_ids = (0..100).map(|i| format!("user-{i:03}")).collect::<Vec<_>>();
        let levels = (0..100)
            .map(|i| if i % 2 == 0 { "info" } else { "error" })
            .collect::<Vec<_>>();
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(trace_ids.clone())),
                Arc::new(StringArray::from(user_ids.clone())),
                Arc::new(StringArray::from(levels.clone())),
            ],
        )
        .unwrap();

        let dir = RamDirectory::create();
        let reader = batches_to_stream(vec![batch]);

        let index = generate_tantivy_index(
            dir,
            reader,
            &[],
            &[
                "trace_id".to_string(),
                "user_id".to_string(),
                "level".to_string(),
            ],
            schema,
        )
        .await
        .unwrap()
        .expect("index built");

        let blooms = build_blooms_from_index(
            &index,
            42,
            &[
                "trace_id".to_string(),
                "user_id".to_string(),
                "level".to_string(),
                "missing_field".to_string(),
            ],
            0.01,
        )
        .unwrap();

        // 3 fields with terms — missing_field skipped silently.
        assert_eq!(blooms.len(), 3);
        for b in &blooms {
            assert_eq!(b.file_id, 42);
            assert!(!b.bytes.is_empty());
        }

        // Round-trip via the .bf format and verify positives match.
        use infra::bloom::{BloomReader, BloomWriter};
        let blob = BloomWriter::serialize(blooms).unwrap();
        let reader = BloomReader::parse(blob).unwrap();

        for tid in &trace_ids {
            assert!(
                reader.check("trace_id", 42, tid.as_bytes()).unwrap(),
                "trace_id {tid} should be present"
            );
        }
        for uid in &user_ids {
            assert!(
                reader.check("user_id", 42, uid.as_bytes()).unwrap(),
                "user_id {uid} should be present"
            );
        }
        for lv in ["info", "error"] {
            assert!(reader.check("level", 42, lv.as_bytes()).unwrap());
        }

        // Overwhelmingly negative for absent values.
        let mut fp = 0;
        for i in 200..1200u32 {
            if reader
                .check("trace_id", 42, format!("trace-{i:03}").as_bytes())
                .unwrap()
            {
                fp += 1;
            }
        }
        assert!(fp < 100, "FPR > 10%: {fp}/1000");
    }

    #[tokio::test]
    async fn test_empty_field_list_returns_empty() {
        // No fields requested → no work, no error.
        let dir = RamDirectory::create();
        let schema = Arc::new(Schema::new(vec![Field::new("f", DataType::Utf8, false)]));
        let batch =
            RecordBatch::try_new(schema.clone(), vec![Arc::new(StringArray::from(vec!["x"]))])
                .unwrap();
        let reader = batches_to_stream(vec![batch]);
        let index = generate_tantivy_index(dir, reader, &[], &["f".to_string()], schema)
            .await
            .unwrap()
            .unwrap();
        let blooms = build_blooms_from_index(&index, 1, &[], 0.01).unwrap();
        assert!(blooms.is_empty());
    }
}
