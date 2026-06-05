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

//! `bloom-inspect` CLI subcommand.
//!
//! Diagnostic: opens a `.bf` file by path, parses its footer (no body bytes
//! touched), and prints the fields, per-field SBBF body sizes, and the list
//! of files each field covers. The footer keys files by `file_list.id`, so
//! the file names are resolved back through `file_list` — when the DB isn't
//! reachable or a file has already been archived to a dump parquet, the bare
//! id is shown instead. Used to debug "pruner returned `keep all`" cases
//! where the `.bf` footer doesn't carry the field (or file) the search side
//! asked about (e.g. stream `bloom_filter_fields` changed after build).

use std::{collections::HashMap, path::Path};

use infra::bloom::BloomReader;

pub async fn inspect(file: &str) -> Result<(), anyhow::Error> {
    let path = Path::new(file);
    if !path.exists() {
        anyhow::bail!("file not found: {file}");
    }
    let bytes = std::fs::read(path)?;
    let total_bytes = bytes.len();
    let reader =
        BloomReader::parse(&bytes).map_err(|e| anyhow::anyhow!("parse `.bf` failed: {e:?}"))?;

    let fields = reader.inspect();

    // Resolve the footer's file_list ids back to file names. Live rows only —
    // a file already archived to a dump parquet won't be found here and falls
    // back to showing its bare id.
    let mut all_ids: Vec<i64> = fields
        .iter()
        .flat_map(|fi| fi.file_ids.iter().map(|&id| id as i64))
        .collect();
    all_ids.sort_unstable();
    all_ids.dedup();
    let name_by_id: HashMap<i64, String> = if all_ids.is_empty() {
        HashMap::new()
    } else {
        match infra::file_list::query_by_ids(&all_ids, None).await {
            Ok(files) => files.into_iter().map(|f| (f.id, f.key)).collect(),
            Err(e) => {
                eprintln!("warning: could not resolve file names from file_list: {e}");
                HashMap::new()
            }
        }
    };
    let resolved = all_ids
        .iter()
        .filter(|id| name_by_id.contains_key(id))
        .count();

    println!("file              : {file}");
    println!("total_bytes       : {total_bytes}");
    println!("field_count       : {}", reader.field_count());
    println!("files_resolved    : {resolved}/{}", all_ids.len());
    println!();

    if fields.is_empty() {
        println!("(no fields — empty `.bf`)");
        return Ok(());
    }
    for fi in &fields {
        println!("── field: {} ────────────────────────", fi.field);
        println!("  file_count        : {}", fi.file_count);
        println!("  num_blocks (B)    : {}", fi.num_blocks);
        // bytes a single query reads for this field = one block row.
        println!("  row_bytes (1 read): {}", fi.row_bytes);
        println!("  total_body_bytes  : {}", fi.total_body_bytes);
        println!("  files:");
        for id in &fi.file_ids {
            match name_by_id.get(&(*id as i64)) {
                Some(name) => println!("    {name}"),
                None => println!("    (id {id} — not in file_list)"),
            }
        }
        println!();
    }
    Ok(())
}
