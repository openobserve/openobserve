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

//! Per-org processor state on the node's local disk, so a restart does not re-read a day (D231).

use std::{
    path::{Path, PathBuf},
    sync::LazyLock,
};

use config::{cluster::LOCAL_NODE, utils::time::SECOND_MICRO_SECS};
use dashmap::DashMap;
use o2_enterprise::enterprise::service_identity::signals::series::OrgSeries;
use serde::{Deserialize, Serialize};

use super::deploys::Kept;
use crate::traces::service_graph::v4::resolution::write_snapshot_file;

// 3: the kept ring holds service keys, so a ring kept by 2 with raw names would split scopes.
pub const SCHEMA: u32 = 3;
const DIR: &str = "service_signals";
const EXT: &str = ".json.zst";
const EVERY_MICROS: i64 = 600 * SECOND_MICRO_SECS;
// Derived bounds keep an org near 150 MiB; past this the org rebuilds from storage instead.
const MAX_BYTES: usize = 256 << 20;
const ZSTD_LEVEL: i32 = 3;
// Past a day behind the cursor, the kept day holds nothing a fresh read would not.
const TOP_UP_MICROS: i64 = 86_400 * SECOND_MICRO_SECS;

// When each org's snapshot was last written by this process.
static WRITTEN: LazyLock<DashMap<String, i64>> = LazyLock::new(DashMap::new);

/// Who wrote a snapshot and for which closed window.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Header {
    pub schema: u32,
    pub org: String,
    pub cluster: String,
    pub owner_node: String,
    pub window_end: i64,
    pub window_secs: i64,
    pub written_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Snapshot {
    pub header: Header,
    pub series: OrgSeries,
    pub kept: Kept,
}

/// How much of a snapshot a restoring node takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Restore {
    All,
    /// The previous owner went on past the snapshot: the day is topped up, the series restart.
    History,
    Nothing,
}

/// What a restoring node accepts: its region, its window and the node that last held the claim.
#[derive(Clone, Copy)]
pub(super) struct Expect<'a> {
    pub cluster: &'a str,
    pub owner_node: &'a str,
    pub window_secs: i64,
}

/// Restores every org whose snapshot the previous claim holder wrote at or behind its cursor.
pub(super) async fn restore_all(owner_node: &str) -> usize {
    let dir = dir();
    let loaded = {
        let dir = dir.clone();
        tokio::task::spawn_blocking(move || load_dir(&dir))
            .await
            .unwrap_or_default()
    };
    let cluster = config::get_cluster_name();
    let expect = Expect {
        cluster: &cluster,
        owner_node,
        window_secs: window_secs(),
    };
    let mut restored = 0;
    for snapshot in loaded {
        let org = snapshot.header.org.clone();
        let offset = match db::service_signals::get_org_offset(&org).await {
            Ok(offset) => offset,
            Err(error) => {
                log::warn!("[ServiceSignals] org={org} snapshot not restored: {error}");
                None
            }
        };
        match accepts(&snapshot.header, &expect, offset) {
            Restore::Nothing => remove(&path(&dir, &org)),
            kind => {
                install(snapshot, kind);
                restored += 1;
            }
        }
    }
    restored
}

/// Writes the org's state after a closed window, at most once per [`EVERY_MICROS`].
pub(super) async fn maybe_write(org: &str, window_end: i64, now: i64) {
    if WRITTEN.get(org).is_some_and(|at| now - *at < EVERY_MICROS) {
        return;
    }
    let snapshot = capture(org, window_end, &LOCAL_NODE.uuid, now).await;
    let dir = dir();
    match tokio::task::spawn_blocking(move || write_to(&dir, &snapshot)).await {
        Ok(Ok(true)) => {
            WRITTEN.insert(org.to_string(), now);
        }
        Ok(Ok(false)) => {
            log::warn!("[ServiceSignals] org={org} snapshot over {MAX_BYTES} bytes, not written")
        }
        Ok(Err(error)) => log::warn!("[ServiceSignals] org={org} snapshot not written: {error}"),
        Err(error) => log::warn!("[ServiceSignals] org={org} snapshot task failed: {error}"),
    }
}

pub(super) async fn capture(org: &str, window_end: i64, owner_node: &str, now: i64) -> Snapshot {
    let series = super::writer::state(org).lock().await.clone();
    Snapshot {
        header: Header {
            schema: SCHEMA,
            org: org.to_string(),
            cluster: config::get_cluster_name(),
            owner_node: owner_node.to_string(),
            window_end,
            window_secs: window_secs(),
            written_at: now,
        },
        series,
        kept: super::deploys::kept(org),
    }
}

pub(super) fn accepts(header: &Header, expect: &Expect<'_>, org_offset: Option<i64>) -> Restore {
    let ours = header.schema == SCHEMA
        && header.cluster == expect.cluster
        && header.window_secs == expect.window_secs
        && header.window_secs > 0
        && !expect.owner_node.is_empty()
        && header.owner_node == expect.owner_node;
    let window = header.window_secs * SECOND_MICRO_SECS;
    match org_offset.map(|offset| offset - header.window_end) {
        Some(0) if ours => Restore::All,
        Some(gap) if ours && gap > 0 && gap % window == 0 && gap < TOP_UP_MICROS => {
            Restore::History
        }
        _ => Restore::Nothing,
    }
}

pub(super) fn install(snapshot: Snapshot, kind: Restore) {
    let org = snapshot.header.org;
    if kind == Restore::All {
        super::writer::restore(&org, snapshot.series);
    }
    if kind != Restore::Nothing {
        super::deploys::restore(&org, snapshot.kept);
    }
}

/// Every org's snapshot in `dir`; an unreadable file is removed so the org rebuilds.
pub(super) fn load_dir(dir: &Path) -> Vec<Snapshot> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(org) = org_of(&path) else {
            continue;
        };
        match std::fs::read(&path)
            .map_err(anyhow::Error::from)
            .and_then(|bytes| decode(&bytes))
        {
            Ok(snapshot) if snapshot.header.org == org => out.push(snapshot),
            Ok(_) => remove(&path),
            Err(error) => {
                log::warn!(
                    "[ServiceSignals] snapshot {} unreadable: {error}",
                    path.display()
                );
                remove(&path);
            }
        }
    }
    out
}

/// False when the snapshot is over [`MAX_BYTES`] and nothing was written.
pub(super) fn write_to(dir: &Path, snapshot: &Snapshot) -> anyhow::Result<bool> {
    let json = serde_json::to_vec(snapshot)?;
    if json.len() > MAX_BYTES {
        remove(&path(dir, &snapshot.header.org));
        return Ok(false);
    }
    let bytes = zstd::encode_all(json.as_slice(), ZSTD_LEVEL)?;
    write_snapshot_file(&path(dir, &snapshot.header.org), &bytes)?;
    Ok(true)
}

/// Removes the snapshots of orgs `keep` rejects: orgs that left the tick, or all on claim loss.
pub(super) fn forget(keep: impl Fn(&str) -> bool) {
    WRITTEN.retain(|org, _| keep(org));
    forget_in(&dir(), keep);
}

/// Every node runs it when the org is deleted.
pub fn forget_org(org: &str) {
    WRITTEN.remove(org);
    remove(&path(&dir(), org));
}

fn forget_in(dir: &Path, keep: impl Fn(&str) -> bool) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if org_of(&path).is_some_and(|org| !keep(&org)) {
            remove(&path);
        }
    }
}

fn decode(bytes: &[u8]) -> anyhow::Result<Snapshot> {
    Ok(serde_json::from_slice(&zstd::decode_all(bytes)?)?)
}

fn dir() -> PathBuf {
    Path::new(&config::get_config().common.data_cache_dir).join(DIR)
}

fn path(dir: &Path, org: &str) -> PathBuf {
    dir.join(format!("{org}{EXT}"))
}

fn org_of(path: &Path) -> Option<String> {
    path.file_name()?
        .to_str()?
        .strip_suffix(EXT)
        .filter(|org| !org.starts_with('.'))
        .map(str::to_string)
}

fn remove(path: &Path) {
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => log::warn!(
            "[ServiceSignals] snapshot {} not removed: {error}",
            path.display()
        ),
    }
}

fn window_secs() -> i64 {
    o2_enterprise::enterprise::common::config::get_config()
        .service_signals
        .window_secs as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "svcsig-snapshot-{name}-{}",
            config::ider::generate()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn snapshot(org: &str, end: i64) -> Snapshot {
        let mut series = OrgSeries::default();
        series.last_end = Some(end);
        Snapshot {
            header: Header {
                schema: SCHEMA,
                org: org.into(),
                cluster: "eu".into(),
                owner_node: "node-a".into(),
                window_end: end,
                window_secs: 300,
                written_at: end,
            },
            series,
            kept: Kept::default(),
        }
    }

    #[test]
    fn only_the_previous_owner_is_accepted_whole_at_the_cursor_or_for_history_past_it() {
        let end = 3_000_000_000;
        let header = snapshot("o", end).header;
        let expect = Expect {
            cluster: "eu",
            owner_node: "node-a",
            window_secs: 300,
        };
        assert_eq!(accepts(&header, &expect, Some(end)), Restore::All);
        assert_eq!(
            accepts(&header, &expect, Some(end + 300_000_000)),
            Restore::History,
            "the same owner's cursor moved on"
        );
        for (expect, offset) in [
            (
                Expect {
                    owner_node: "node-b",
                    ..expect
                },
                Some(end),
            ),
            (
                Expect {
                    owner_node: "",
                    ..expect
                },
                Some(end),
            ),
            (
                Expect {
                    window_secs: 60,
                    ..expect
                },
                Some(end),
            ),
            (
                Expect {
                    cluster: "us",
                    ..expect
                },
                Some(end),
            ),
            (
                Expect {
                    owner_node: "node-b",
                    ..expect
                },
                Some(end + 300_000_000),
            ),
            (expect, Some(end - 300_000_000)),
            (expect, Some(end + 150_000_000)),
            (expect, None),
        ] {
            assert_eq!(accepts(&header, &expect, offset), Restore::Nothing);
        }
        let newer = Header {
            schema: SCHEMA + 1,
            ..header
        };
        assert_eq!(accepts(&newer, &expect, Some(end)), Restore::Nothing);
    }

    #[test]
    fn files_round_trip_and_leave_with_their_org_or_the_claim() {
        let dir = scratch("files");
        for org in ["a", "b", "c"] {
            assert!(write_to(&dir, &snapshot(org, 600_000_000)).unwrap());
        }
        std::fs::write(dir.join("d.json.zst"), b"torn").unwrap();
        let mut loaded: Vec<String> = load_dir(&dir).into_iter().map(|s| s.header.org).collect();
        loaded.sort();
        assert_eq!(loaded, ["a", "b", "c"]);
        assert!(
            !dir.join("d.json.zst").exists(),
            "an unreadable file is removed"
        );
        // An org leaving the tick or deleted loses its file; the others keep theirs.
        forget_in(&dir, |org| org != "b");
        assert!(!path(&dir, "b").exists() && path(&dir, "a").exists());
        // Claim loss clears every org.
        forget_in(&dir, |_| false);
        assert!(load_dir(&dir).is_empty());
        std::fs::remove_dir(&dir).unwrap();
    }
}
