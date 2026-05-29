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

use std::collections::HashSet;

use anyhow::Context;
use hashbrown::HashMap;
use infra::bloom::{BloomBuilder, FieldBloom};
use tantivy::Index;
use tantivy_utils::puffin_directory::reader::warm_up_terms;

/// Build per-field SBBFs for one file using a group-uniform `num_blocks`.
///
/// Every file in a (stream, hour, bloom_ver) group must pass the same
/// `num_blocks` so the transposed `.bf` layout can read one block-row per
/// group (see `infra::bloom` module docs). The caller derives it once from
/// the configured expected cardinality.
///
/// Behavior:
/// - Fields not present in the schema are silently skipped — the compactor passes the union of
///   `index_fields ∩ bloom_filter_fields` over potentially many streams, and not every field exists
///   everywhere.
/// - Terms across all segments of the index are merged into one bloom per field. Today
///   `create_tantivy_index` produces a single segment, but this is robust to that changing.
pub async fn build_blooms_from_index(
    index: &Index,
    file_id: u64,
    fields: &[String],
    num_blocks: u32,
) -> Result<Vec<FieldBloom>, anyhow::Error> {
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

    let warm_terms: HashMap<tantivy::schema::Field, HashMap<tantivy::Term, bool>> = HashMap::new();
    let mut need_all_term_fields = HashSet::new();
    let need_fast_field = HashSet::new();
    for field in fields {
        let Ok(field) = schema.get_field(field) else {
            continue;
        };
        need_all_term_fields.insert(field);
    }

    warm_up_terms(
        &searcher,
        &warm_terms,
        need_all_term_fields,
        need_fast_field,
    )
    .await?;

    let mut builder = BloomBuilder::new();

    for field_name in fields {
        let Ok(field) = schema.get_field(field_name) else {
            continue;
        };

        // Skip fields with no terms in this file so they don't become an
        // empty column in the transposed matrix.
        let mut has_terms = false;
        for seg in searcher.segment_readers() {
            if let Ok(inv) = seg.inverted_index(field)
                && inv.terms().num_terms() > 0
            {
                has_terms = true;
                break;
            }
        }
        if !has_terms {
            continue;
        }

        // Uniform block count across the whole group (caller-provided).
        let idx = builder.begin_with_blocks(file_id, field_name, num_blocks);

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
    use tantivy::directory::RamDirectory;

    use super::*;
    use crate::service::tantivy::{
        sequential::build_index,
        tests::{create_test_parquet_bytes, make_index_schema},
    };

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
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;
        let index = build_index(
            dir,
            config::FileFormat::Parquet,
            buf,
            make_index_schema(
                &[],
                &[
                    "trace_id".to_string(),
                    "user_id".to_string(),
                    "level".to_string(),
                ],
                &schema,
            ),
        )
        .await
        .unwrap()
        .expect("index built");

        let num_blocks = infra::bloom::num_blocks_for(200, 0.01);
        let blooms = build_blooms_from_index(
            &index,
            42,
            &[
                "trace_id".to_string(),
                "user_id".to_string(),
                "level".to_string(),
                "missing_field".to_string(),
            ],
            num_blocks,
        )
        .await
        .unwrap();

        // 3 fields with terms — missing_field skipped silently.
        assert_eq!(blooms.len(), 3);
        for b in &blooms {
            assert_eq!(b.file_id, 42);
            assert!(!b.bytes.is_empty());
        }

        // Round-trip via the transposed `.bf` format: row_range → slice the
        // file's column → check_block (the same path the pruner uses).
        use infra::bloom::{BloomReader, BloomWriter, sbbf::BLOCK_BYTES};
        let blob = BloomWriter::serialize(blooms).unwrap();
        let reader = BloomReader::parse(&blob).unwrap();

        let check = |field: &str, file_id: u64, v: &[u8]| -> Option<bool> {
            let (range, h) = reader.row_range(field, v)?;
            let col = reader.column_index(field, file_id)?;
            let row = &blob[range.start as usize..range.end as usize];
            let off = col * BLOCK_BYTES;
            let block: &[u8; BLOCK_BYTES] = row[off..off + BLOCK_BYTES].try_into().unwrap();
            Some(BloomReader::check_block_with_hash(block, h))
        };

        for tid in &trace_ids {
            assert_eq!(
                check("trace_id", 42, tid.as_bytes()),
                Some(true),
                "trace_id {tid} should be present"
            );
        }
        for uid in &user_ids {
            assert_eq!(
                check("user_id", 42, uid.as_bytes()),
                Some(true),
                "user_id {uid} should be present"
            );
        }
        for lv in ["info", "error"] {
            assert_eq!(check("level", 42, lv.as_bytes()), Some(true));
        }

        // Overwhelmingly negative for absent values.
        let mut fp = 0;
        for i in 200..1200u32 {
            if check("trace_id", 42, format!("trace-{i:03}").as_bytes()).unwrap_or(true) {
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
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;
        let index = build_index(
            dir,
            config::FileFormat::Parquet,
            buf,
            make_index_schema(&[], &["f".to_string()], &schema),
        )
        .await
        .unwrap()
        .unwrap();
        let blooms = build_blooms_from_index(&index, 1, &[], 256).await.unwrap();
        assert!(blooms.is_empty());
    }
}
