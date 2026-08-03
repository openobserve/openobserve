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
//! Used by the compactor merge hook to build per-(file, field)
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
pub(super) async fn build_blooms_from_index(
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
    for field in fields {
        let Ok(field) = schema.get_field(field) else {
            continue;
        };
        need_all_term_fields.insert(field);
    }

    // warm_up_terms operates on one SegmentReader at a time; warm each segment.
    // need_all_term_fields / need_fast_field are consumed per call, so clone them.
    for seg in searcher.segment_readers() {
        warm_up_terms(
            seg,
            &warm_terms,
            need_all_term_fields.clone(),
            HashSet::new(),
        )
        .await?;
    }

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
