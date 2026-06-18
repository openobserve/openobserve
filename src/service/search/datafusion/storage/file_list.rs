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

use std::sync::LazyLock as Lazy;

use chrono::{TimeZone, Utc};
use config::meta::stream::{FileKey, FileSelection};
use hashbrown::HashMap;
use object_store::ObjectMeta;
use parking_lot::RwLock;

use super::{ACCOUNT_SEPARATOR, TRACE_ID_SEPARATOR};

#[derive(Clone)]
pub struct ScanSelection {
    pub selection: FileSelection,
    pub row_group_size: Option<u32>,
}

type ScanSelectionMap = HashMap<String, ScanSelection>;

static FILES: Lazy<RwLock<HashMap<String, Vec<ObjectMeta>>>> = Lazy::new(Default::default);
static SCAN_SELECTIONS: Lazy<RwLock<HashMap<String, ScanSelectionMap>>> =
    Lazy::new(Default::default);

pub fn get(trace_id: &str) -> Result<Vec<ObjectMeta>, anyhow::Error> {
    let data = match FILES.read().get(trace_id) {
        Some(data) => data.clone(),
        None => return Err(anyhow::anyhow!("trace_id not found: {}", trace_id)),
    };
    Ok(data)
}

pub async fn set(trace_id: &str, schema_key: &str, format: &str, files: Vec<FileKey>) {
    let key = format!("{trace_id}/schema={schema_key}/format={format}");
    let mut values = Vec::with_capacity(files.len());
    let mut scan_selections = HashMap::new();
    for file in files {
        let modified = Utc.timestamp_nanos(file.meta.max_ts * 1000);
        let file_name = if file.account.is_empty() {
            format!("/{}/{}/{}", key, TRACE_ID_SEPARATOR, file.key)
        } else {
            format!(
                "/{}/{}/{}/{}/{}",
                key, TRACE_ID_SEPARATOR, file.account, ACCOUNT_SEPARATOR, file.key
            )
        };
        values.push(ObjectMeta {
            location: file_name.into(),
            last_modified: modified,
            size: file.meta.compressed_size as u64,
            e_tag: None,
            version: None,
        });
        if let Some(selection) = file.selection {
            // Must match the suffix that `get_scan_selection` extracts by splitting
            // the full object path on `/$$/`. For accounted files that suffix is
            // `{account}/{ACCOUNT_SEPARATOR}/{file.key}`, not just `file.key`.
            let selection_key = if file.account.is_empty() {
                file.key
            } else {
                format!("{}/{}/{}", file.account, ACCOUNT_SEPARATOR, file.key)
            };
            scan_selections.insert(
                selection_key,
                ScanSelection {
                    selection,
                    row_group_size: file.row_group_size,
                },
            );
        }
    }
    FILES.write().insert(key.clone(), values);
    SCAN_SELECTIONS.write().insert(key, scan_selections);
}

pub fn clear(trace_id: &str) {
    // Remove all files for the given trace_id
    let r = FILES.read();
    let keys = r
        .keys()
        .filter(|x| x.starts_with(trace_id))
        .cloned()
        .collect::<Vec<_>>();
    drop(r);
    let mut w = FILES.write();
    for key in keys.iter() {
        w.remove(key);
    }
    w.shrink_to_fit();
    drop(w);

    // Remove all scan selections for the given trace_id
    // here we can reuse the keys, because they are the same
    let mut w = SCAN_SELECTIONS.write();
    for key in keys.iter() {
        w.remove(key);
    }
    w.shrink_to_fit();
    drop(w);
}

pub fn get_scan_selection(file_key: &str) -> Option<ScanSelection> {
    let (trace_id, filename) = file_key.split_once("/$$/")?;
    let r = SCAN_SELECTIONS.read();
    let Some(data) = r.get(trace_id) else {
        log::warn!(
            "[trace_id {trace_id}] scan_selection lookup: trace_id not in map (filename={filename})"
        );
        return None;
    };
    let result = data.get(filename).cloned();
    if result.is_none() {
        let sample_key = data.keys().next().cloned().unwrap_or_default();
        log::warn!(
            "[trace_id {trace_id}] scan_selection miss: lookup_filename={filename}, selections_in_map={}, sample_key_in_map={sample_key}",
            data.len(),
        );
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_nonexistent_trace_id_returns_error() {
        let result = get("nonexistent_trace_xyz_file_list_12345");
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("trace_id not found")
        );
    }

    #[test]
    fn test_get_scan_selection_nonexistent_returns_none() {
        let result = get_scan_selection("nonexistent_trace_file_list/$$/filename.parquet");
        assert!(result.is_none());
    }

    #[test]
    fn test_get_scan_selection_no_separator_returns_none() {
        let result = get_scan_selection("no-separator-here");
        assert!(result.is_none());
    }

    // Regression: when `file.account` is non-empty, the path produced by `set()`
    // splits on `/$$/` into `({key}, "{account}/::/{file.key}")`, so the
    // SCAN_SELECTIONS inner map must be keyed by `{account}/::/{file.key}` —
    // not just `file.key`. Previously the lookup silently missed and the
    // tantivy row-id selection was dropped, causing the parquet reader to
    // scan whole row groups instead of the indexed rows.
    #[tokio::test]
    async fn test_scan_selection_lookup_with_account() {
        use std::sync::Arc;

        use arrow::buffer::BooleanBuffer;

        let trace_id = "trace_account_lookup_regression";
        let schema_key = "schemakey";
        let format = "parquet";
        let account = "acc1";
        let file_key = "files/default/traces/default/2026/06/17/16/regress.parquet";

        let mut file = FileKey::default();
        file.account = account.to_string();
        file.key = file_key.to_string();
        file.selection = Some(FileSelection::Rows(Arc::new(BooleanBuffer::new_unset(8))));
        file.row_group_size = Some(1024);

        set(trace_id, schema_key, format, vec![file]).await;

        // Path shape matches `set()`'s file_name construction with the leading
        // slash stripped (object_store::path::Path normalises it).
        let lookup = format!(
            "{trace_id}/schema={schema_key}/format={format}/{TRACE_ID_SEPARATOR}/{account}/{ACCOUNT_SEPARATOR}/{file_key}"
        );
        assert!(
            get_scan_selection(&lookup).is_some(),
            "row-id selection must be retrievable for accounted files",
        );

        clear(trace_id);
    }

    #[tokio::test]
    async fn test_scan_selection_lookup_without_account() {
        use std::sync::Arc;

        use arrow::buffer::BooleanBuffer;

        let trace_id = "trace_no_account_lookup_regression";
        let schema_key = "schemakey";
        let format = "parquet";
        let file_key = "files/default/traces/default/2026/06/17/16/regress2.parquet";

        let mut file = FileKey::default();
        file.key = file_key.to_string();
        file.selection = Some(FileSelection::Rows(Arc::new(BooleanBuffer::new_unset(8))));
        file.row_group_size = Some(1024);

        set(trace_id, schema_key, format, vec![file]).await;

        let lookup = format!(
            "{trace_id}/schema={schema_key}/format={format}/{TRACE_ID_SEPARATOR}/{file_key}"
        );
        assert!(get_scan_selection(&lookup).is_some());

        clear(trace_id);
    }
}
