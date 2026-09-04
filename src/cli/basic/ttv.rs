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

//! `ttv-inspect` CLI subcommand.
//!
//! Diagnostic: opens a `.ttv` file (a Puffin container that wraps a tantivy
//! index) by path, parses its footer locally — no object-store / DB needed —
//! and prints:
//!   * file-level puffin properties (e.g. `row_group_size`),
//!   * every blob (the wrapped tantivy files: `*.term`, `*.idx`, `*.pos`, `*.fast`, `meta.json`,
//!     `footer_cache`) with its type, offset and length,
//!   * a digest of the embedded tantivy `meta.json`: segments + doc counts and the schema fields.
//!
//! Use it to debug index builds — what got indexed, how many docs/segments a
//! file holds, and which row-group size it was built against.

use std::path::Path;

use tantivy_utils::puffin::{BlobMetadata, reader::parse_puffin_footer_from_bytes};

pub fn inspect(file: &str, raw: bool) -> Result<(), anyhow::Error> {
    let path = Path::new(file);
    if !path.exists() {
        anyhow::bail!("file not found: {file}");
    }
    let bytes = std::fs::read(path)?;
    let total_bytes = bytes.len();
    let meta = parse_puffin_footer_from_bytes(&bytes)
        .map_err(|e| anyhow::anyhow!("parse `.ttv` failed: {e:?}"))?;

    println!("file              : {file}");
    println!("total_bytes       : {total_bytes}");
    println!("blob_count        : {}", meta.blobs.len());

    // ── file-level properties ──────────────────────────────────────────────
    println!();
    println!("── file properties ──────────────────────────");
    if meta.properties.is_empty() {
        println!("  (none)");
    } else {
        let mut props: Vec<(&String, &String)> = meta.properties.iter().collect();
        props.sort_by(|a, b| a.0.cmp(b.0));
        for (k, v) in props {
            println!("  {k:<16}: {v}");
        }
    }

    // ── blobs ──────────────────────────────────────────────────────────────
    println!();
    println!("── blobs ────────────────────────────────────");
    println!(
        "  {:<3} {:<40} {:<18} {:>12} {:>12} {:<6}",
        "#", "name", "type", "offset", "length", "comp"
    );
    // Sort by on-disk offset so the layout reads top-to-bottom.
    let mut blobs: Vec<&BlobMetadata> = meta.blobs.iter().collect();
    blobs.sort_by_key(|b| b.offset);
    for (i, blob) in blobs.iter().enumerate() {
        let name = blob
            .properties
            .get("blob_tag")
            .map(|s| s.as_str())
            .unwrap_or("(unnamed)");
        println!(
            "  {:<3} {:<40} {:<18} {:>12} {:>12} {:<6}",
            i,
            name,
            blob_type_str(blob),
            blob.offset,
            blob.length,
            compression_str(blob),
        );
    }

    // ── tantivy index (meta.json) ───────────────────────────────────────────
    println!();
    println!("── tantivy index (meta.json) ────────────────");
    match find_blob_bytes(&bytes, &meta, "meta.json") {
        Some(meta_json) => match serde_json::from_slice::<serde_json::Value>(meta_json) {
            Ok(tantivy_meta) => {
                print_tantivy_meta(&tantivy_meta);
                if raw {
                    println!();
                    println!("── raw meta.json ────────────────────────────");
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&tantivy_meta)
                            .unwrap_or_else(|_| "(failed to render)".to_string())
                    );
                }
            }
            Err(e) => println!("  (failed to parse meta.json: {e})"),
        },
        None => println!("  (no meta.json blob found)"),
    }

    Ok(())
}

/// Slice a blob's raw bytes out of the in-memory file. Blobs are stored
/// uncompressed in OpenObserve, so for `meta.json` this is the JSON directly.
fn find_blob_bytes<'a>(
    data: &'a [u8],
    meta: &tantivy_utils::puffin::PuffinMeta,
    name: &str,
) -> Option<&'a [u8]> {
    let blob = meta
        .blobs
        .iter()
        .find(|b| b.properties.get("blob_tag").map(|s| s.as_str()) == Some(name))?;
    let start = blob.offset as usize;
    let end = start + blob.length as usize;
    data.get(start..end)
}

fn blob_type_str(blob: &BlobMetadata) -> String {
    // Reuse the serde wire name (e.g. "o2-ttv-v1") so new variants display
    // without needing to touch this match.
    serde_json::to_string(&blob.blob_type)
        .map(|s| s.trim_matches('"').to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

fn compression_str(blob: &BlobMetadata) -> String {
    match &blob.compression_codec {
        None => "none".to_string(),
        Some(c) => serde_json::to_string(c)
            .map(|s| s.trim_matches('"').to_string())
            .unwrap_or_else(|_| "?".to_string()),
    }
}

/// Print a human digest of the tantivy `meta.json`: segments + doc counts and
/// the schema fields. Parsed permissively (as `serde_json::Value`) so it keeps
/// working across tantivy versions.
fn print_tantivy_meta(meta: &serde_json::Value) {
    // segments
    let segments = meta.get("segments").and_then(|v| v.as_array());
    let seg_count = segments.map(|s| s.len()).unwrap_or(0);
    let mut total_docs: u64 = 0;
    let mut total_deleted: u64 = 0;
    if let Some(segments) = segments {
        for seg in segments {
            total_docs += seg.get("max_doc").and_then(|v| v.as_u64()).unwrap_or(0);
            total_deleted += seg
                .get("deletes")
                .and_then(|d| d.get("num_deleted_docs"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
        }
    }
    println!("  segments          : {seg_count}");
    println!("  total_docs        : {total_docs} (deleted: {total_deleted})");
    if let Some(opstamp) = meta.get("opstamp").and_then(|v| v.as_u64()) {
        println!("  opstamp           : {opstamp}");
    }
    if let Some(segments) = segments {
        for seg in segments {
            let id = seg
                .get("segment_id")
                .and_then(|v| v.as_str())
                .unwrap_or("?");
            let max_doc = seg.get("max_doc").and_then(|v| v.as_u64()).unwrap_or(0);
            let deleted = seg
                .get("deletes")
                .and_then(|d| d.get("num_deleted_docs"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            println!("    - {id}: max_doc={max_doc} deleted={deleted}");
        }
    }

    // schema
    let schema = meta.get("schema").and_then(|v| v.as_array());
    let field_count = schema.map(|s| s.len()).unwrap_or(0);
    println!();
    println!("  schema fields     : {field_count}");
    if let Some(schema) = schema {
        for field in schema {
            let name = field.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            let ftype = field.get("type").and_then(|v| v.as_str()).unwrap_or("?");
            println!("    {name:<28} {ftype:<8} [{}]", field_flags(field));
        }
    }
}

/// Best-effort summary of a schema field's indexing options. Tantivy spells
/// these differently per field type (text uses an `indexing` object; numeric
/// types use an `indexed` bool), so probe both and de-duplicate.
fn field_flags(field: &serde_json::Value) -> String {
    let Some(opts) = field.get("options") else {
        return "-".to_string();
    };
    let mut flags: Vec<&str> = Vec::new();
    // text: presence of a non-null `indexing` object means it's indexed
    let text_indexed = opts.get("indexing").map(|v| !v.is_null()).unwrap_or(false);
    // numeric/date/bool/ip: explicit `indexed` bool
    let numeric_indexed = opts.get("indexed").and_then(|v| v.as_bool()) == Some(true);
    if text_indexed || numeric_indexed {
        flags.push("indexed");
    }
    if opts.get("stored").and_then(|v| v.as_bool()) == Some(true) {
        flags.push("stored");
    }
    // `fast` is a bool for numeric types and a string/object for text types;
    // any non-false / non-null value means fast is on.
    let fast = match opts.get("fast") {
        Some(v) if v.is_boolean() => v.as_bool() == Some(true),
        Some(v) => !v.is_null(),
        None => false,
    };
    if fast {
        flags.push("fast");
    }
    if opts.get("fieldnorms").and_then(|v| v.as_bool()) == Some(true) {
        flags.push("fieldnorms");
    }
    // tokenizer, if any (text fields)
    let tokenizer = opts
        .get("indexing")
        .and_then(|v| v.get("tokenizer"))
        .and_then(|v| v.as_str());

    let out = if flags.is_empty() {
        "-".to_string()
    } else {
        flags.join(",")
    };
    match tokenizer {
        Some(tok) => format!("{out}, tokenizer={tok}"),
        None => out,
    }
}
