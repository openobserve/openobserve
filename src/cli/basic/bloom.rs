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
//! Pure-local diagnostic: opens a `.bf` file by path, parses its footer
//! (no body bytes touched), prints the fields, file_id list per field,
//! and SBBF body sizes. Used to debug "pruner returned `keep all`" cases
//! where the .bf footer doesn't carry the field the search side asked
//! about (e.g. stream `bloom_filter_fields` changed after build).

use std::path::Path;

use infra::bloom::BloomReader;

pub fn inspect(file: &str) -> Result<(), anyhow::Error> {
    let path = Path::new(file);
    if !path.exists() {
        anyhow::bail!("file not found: {file}");
    }
    let bytes = std::fs::read(path)?;
    let total_bytes = bytes.len();
    let reader =
        BloomReader::parse(&bytes).map_err(|e| anyhow::anyhow!("parse `.bf` failed: {e:?}"))?;

    println!("file              : {file}");
    println!("total_bytes       : {total_bytes}");
    println!("field_count       : {}", reader.field_count());
    println!();

    let inspect = reader.inspect();
    if inspect.is_empty() {
        println!("(no fields — empty `.bf`)");
        return Ok(());
    }
    for fi in &inspect {
        println!("── field: {} ────────────────────────", fi.field);
        println!("  file_count        : {}", fi.file_count);
        println!("  total_body_bytes  : {}", fi.total_body_bytes);
        let per_file_avg = if fi.file_count > 0 {
            fi.total_body_bytes as f64 / fi.file_count as f64
        } else {
            0.0
        };
        println!("  per_file_avg_bytes: {:.1}", per_file_avg);
        if !fi.file_ids.is_empty() {
            let min = fi.file_ids.first().copied().unwrap_or(0);
            let max = fi.file_ids.last().copied().unwrap_or(0);
            println!("  file_id_range     : [{min}, {max}]");
            let preview_n = fi.file_ids.len().min(20);
            let preview: Vec<String> = fi
                .file_ids
                .iter()
                .take(preview_n)
                .map(|i| i.to_string())
                .collect();
            print!("  file_ids (first {}): [{}]", preview_n, preview.join(", "));
            if fi.file_ids.len() > preview_n {
                print!(" ... +{} more", fi.file_ids.len() - preview_n);
            }
            println!();
        }
        println!();
    }
    Ok(())
}
