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

//! Search-side bloom prune layer.
//!
//! Given a candidate `Vec<FileKey>` returned by `file_list` and the
//! bloom-prunable predicates extracted by [`super::bloom_predicate`],
//! this module:
//!
//! 1. Splits files into "has bloom" (`bloom_ver != 0`) and "no bloom" (`bloom_ver == 0`). The
//!    latter pass through untouched.
//! 2. Groups "has bloom" files by `(date, bloom_ver)` so that all files sharing a `.bf` are tested
//!    with one fetch.
//! 3. Fetches each `.bf` (memory → disk → remote, via the existing `infra::cache::file_data`
//!    ladder).
//! 4. For each file, evaluates the predicates: a file is kept iff **every** predicate's bloom
//!    returns *maybe* for **at least one** of its values (OR within a predicate, AND across
//!    predicates).
//!
//! Any failure (fetch, parse, schema mismatch) **falls back to "keep
//! all"** for the affected group — bloom is performance, not correctness.

use std::collections::HashMap;

use config::meta::stream::{FileKey, StreamType};
use futures::future::join_all;
use infra::bloom::{BloomReader, file_id_from_path, path::bloom_path};

use super::bloom_predicate::BloomPredicate;

/// Prune `files` against `predicates`, returning the surviving subset.
/// Files with `bloom_ver == 0` are always kept (no bloom info).
pub async fn prune(
    files: Vec<FileKey>,
    predicates: &[BloomPredicate],
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Vec<FileKey> {
    if predicates.is_empty() {
        return files;
    }

    // 1. Split.
    let mut without_bloom: Vec<FileKey> = Vec::new();
    let mut with_bloom: Vec<FileKey> = Vec::with_capacity(files.len());
    for f in files {
        if f.meta.bloom_ver == 0 {
            without_bloom.push(f);
        } else {
            with_bloom.push(f);
        }
    }
    if with_bloom.is_empty() {
        return without_bloom;
    }

    // 2. Group by (date, bloom_ver). The date is the YYYY/MM/DD/HH bucket embedded in the parquet
    //    key.
    type Group = (String, i64); // (date, bloom_ver)
    let mut groups: HashMap<Group, Vec<usize>> = HashMap::new();
    let mut date_for: Vec<Option<String>> = vec![None; with_bloom.len()];
    for (i, f) in with_bloom.iter().enumerate() {
        let date = match config::utils::parquet::parse_file_key_columns(&f.key) {
            Ok((_, d, _)) => d,
            Err(_) => continue, // unparseable key → keep file (handled below)
        };
        date_for[i] = Some(date.clone());
        groups.entry((date, f.meta.bloom_ver)).or_default().push(i);
    }

    // 3. Fetch all .bf files in parallel (bounded by underlying cache / object_store concurrency;
    //    typical bucket counts are << 1k).
    let bf_paths: Vec<(Group, String)> = groups
        .keys()
        .map(|(date, ver)| {
            (
                (date.clone(), *ver),
                bloom_path(org_id, stream_type, stream_name, date, *ver),
            )
        })
        .collect();

    let fetches = bf_paths.iter().map(|(group, path)| async move {
        let account = infra::storage::get_account(path).unwrap_or_default();
        let bytes = infra::cache::file_data::get(&account, path, None).await;
        (group.clone(), path.clone(), bytes)
    });
    let fetched = join_all(fetches).await;

    let mut readers: HashMap<Group, BloomReader> = HashMap::new();
    for (group, path, bytes) in fetched {
        let bytes = match bytes {
            Ok(b) => b,
            Err(e) => {
                log::warn!("[bloom-prune] fetch {path} failed: {e}; keeping its files");
                continue;
            }
        };
        match BloomReader::parse(bytes.to_vec()) {
            Ok(r) => {
                readers.insert(group, r);
            }
            Err(e) => {
                log::warn!("[bloom-prune] parse {path} failed: {e:?}; keeping its files");
            }
        }
    }

    // 4. Evaluate. Default = keep. Only drop if every predicate of the file is definitively
    //    excluded by the bloom.
    let mut kept = without_bloom;
    for (idx, f) in with_bloom.into_iter().enumerate() {
        let date = match date_for[idx].as_ref() {
            Some(d) => d.clone(),
            None => {
                kept.push(f);
                continue;
            }
        };
        let group = (date, f.meta.bloom_ver);
        let reader = match readers.get_mut(&group) {
            Some(r) => r,
            None => {
                kept.push(f);
                continue;
            }
        };
        let file_id = file_id_from_path(&f.key);
        let mut all_match = true;
        for pred in predicates {
            // OR within predicate values: any value's bloom-maybe keeps it.
            let any_match = pred.values.iter().any(|v| {
                reader
                    .check(&pred.field, file_id, v.as_bytes())
                    .unwrap_or(true)
            });
            if !any_match {
                all_match = false;
                break;
            }
        }
        if all_match {
            kept.push(f);
        }
    }
    kept
}

#[cfg(test)]
mod tests {
    use config::meta::stream::{FileKey, FileMeta};
    use infra::bloom::{BloomBuilder, BloomReader, BloomWriter, file_id_from_path};

    use super::*;

    fn fk(key: &str, bloom_ver: i64) -> FileKey {
        let mut k = FileKey::new(0, "default".into(), key.into(), FileMeta::default(), false);
        k.meta.bloom_ver = bloom_ver;
        k
    }

    /// Builds a `.bf` blob with two parquet files and one indexed field,
    /// then evaluates the predicates directly against the parsed reader
    /// the same way `prune()` does (without going through the
    /// `file_data::get` ladder, which would need an object-store backend).
    /// This nails down the writer→reader→predicate-evaluation contract.
    #[test]
    fn test_writer_reader_predicate_contract() {
        let key_a = "files/o/logs/s/2026/05/08/14/a.parquet";
        let key_b = "files/o/logs/s/2026/05/08/14/b.parquet";
        let id_a = file_id_from_path(key_a);
        let id_b = file_id_from_path(key_b);

        let mut bb = BloomBuilder::new();
        let i_a = bb.begin(id_a, "trace_id", 100);
        bb.insert(i_a, b"present-A");
        let i_b = bb.begin(id_b, "trace_id", 100);
        bb.insert(i_b, b"present-B");
        let blob = BloomWriter::serialize(bb.finish());
        let mut r = BloomReader::parse(blob).unwrap();

        // Predicate matching only file A
        let pred = BloomPredicate {
            field: "trace_id".into(),
            values: vec!["present-A".into()],
        };
        // file A: any value matches → kept
        assert!(
            pred.values
                .iter()
                .any(|v| r.check(&pred.field, id_a, v.as_bytes()).unwrap())
        );
        // file B: no value matches → would be dropped
        assert!(
            !pred
                .values
                .iter()
                .any(|v| r.check(&pred.field, id_b, v.as_bytes()).unwrap())
        );

        // IN list with one present + one absent → still kept (any-of within
        // a predicate)
        let pred_in = BloomPredicate {
            field: "trace_id".into(),
            values: vec!["present-A".into(), "absent-X".into()],
        };
        assert!(
            pred_in
                .values
                .iter()
                .any(|v| r.check(&pred_in.field, id_a, v.as_bytes()).unwrap())
        );

        // Multi-predicate AND: every predicate must hit
        let pred_other = BloomPredicate {
            field: "trace_id".into(),
            values: vec!["absent-Z".into()],
        };
        let preds = [pred.clone(), pred_other];
        let kept = preds.iter().all(|p| {
            p.values
                .iter()
                .any(|v| r.check(&p.field, id_a, v.as_bytes()).unwrap())
        });
        assert!(!kept, "AND of preds where one fully misses must drop");
    }

    #[tokio::test]
    async fn test_files_without_bloom_pass_through() {
        // bloom_ver = 0 → never touched, never dropped.
        let files = vec![
            fk("files/o/logs/s/2026/05/08/14/a.parquet", 0),
            fk("files/o/logs/s/2026/05/08/14/b.parquet", 0),
        ];
        let preds = vec![BloomPredicate {
            field: "trace_id".into(),
            values: vec!["x".into()],
        }];
        let kept = prune(files.clone(), &preds, "o", StreamType::Logs, "s").await;
        assert_eq!(kept.len(), files.len());
    }

    #[tokio::test]
    async fn test_no_predicates_keeps_everything() {
        let files = vec![fk("files/o/logs/s/2026/05/08/14/a.parquet", 123)];
        let kept = prune(files.clone(), &[], "o", StreamType::Logs, "s").await;
        assert_eq!(kept.len(), 1);
    }

    #[tokio::test]
    async fn test_missing_bf_keeps_all_files_in_group() {
        // bloom_ver = nonzero but the .bf doesn't exist in storage → degrade.
        let files = vec![fk("files/o/logs/missing/2026/05/08/14/a.parquet", 9_999)];
        let preds = vec![BloomPredicate {
            field: "trace_id".into(),
            values: vec!["x".into()],
        }];
        let kept = prune(files.clone(), &preds, "o", StreamType::Logs, "missing").await;
        assert_eq!(kept.len(), 1);
    }

    #[tokio::test]
    async fn test_unparseable_key_kept() {
        // Defensive: pathological keys shouldn't take the file out — they
        // just bypass bloom evaluation.
        let files = vec![fk("not-a-files-path", 1234)];
        let preds = vec![BloomPredicate {
            field: "trace_id".into(),
            values: vec!["x".into()],
        }];
        let kept = prune(files, &preds, "o", StreamType::Logs, "s").await;
        assert_eq!(kept.len(), 1);
    }
}
