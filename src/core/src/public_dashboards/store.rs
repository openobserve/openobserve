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

//! The dashboard-result file (design 7.2): version, public header, private manifest, zstd body.

use std::{
    collections::BTreeMap,
    sync::{
        Arc, LazyLock,
        atomic::{AtomicU64, Ordering},
    },
};

use anyhow::Context;
use bytes::Bytes;
use config::{
    meta::{
        public_dashboards::{PanelState, ResultBody, Window, WithheldPanel},
        stream::StreamType,
    },
    metrics,
    utils::time::now_micros,
};
use infra::cache::file_data::disk::{
    self, PUBLIC_DASHBOARDS_PREFIX, public_dashboards_evict, public_dashboards_memory_get,
    public_dashboards_memory_put, public_dashboards_replace,
};
use serde::{Deserialize, Serialize};

const MAGIC: &[u8; 4] = b"O2PD";
pub const FORMAT_VERSION: u16 = 2;
/// Magic, version and the header length.
const PREFIX_LEN: usize = 4 + 2 + 4;

/// Seeded from the clock, so an incarnation is never reused, not even across a restart.
static INCARNATION: LazyLock<AtomicU64> =
    LazyLock::new(|| AtomicU64::new(u64::try_from(now_micros()).unwrap_or_default()));

/// Keys whose next writes fail, to drive the write-failure paths in tests.
#[cfg(test)]
pub static FAIL_WRITES: LazyLock<dashmap::DashSet<String>> = LazyLock::new(Default::default);

/// The public header: what may be served from the file and when it is due.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Header {
    /// Process-unique id of this write; part of the memory key and of rev.
    pub incarnation: u64,
    /// Start of the build that produced the body; None for a body-less backoff file.
    pub built_at: Option<i64>,
    /// How long that build took, for the refresh poll hint.
    pub build_ms: u64,
    pub withheld_panels: Vec<WithheldPanel>,
    /// Frozen-value keys of variables whose values query the publisher can no longer read.
    pub withheld_variables: Vec<String>,
    /// Each panel's state in the body, so rev and a 304 need no body read.
    pub panels: Vec<PanelSummary>,
    pub auth_checked_at: i64,
    pub window_start: i64,
    pub window_end: i64,
    pub dashboard_updated_at: i64,
    pub link_rev: i64,
    pub settings_rev: i64,
    pub size_bytes: u32,
    pub panel_count: u16,
    pub incomplete_count: u16,
    pub retained_count: u16,
    pub unavailable_count: u16,
    pub fail_streak: u16,
    pub next_retry_at: Option<i64>,
    pub last_error_at: Option<i64>,
    pub last_error: Option<String>,
    /// Revisions of the last failed attempt; an edit bypasses backoff only while it differs.
    pub attempted_revs: Option<[i64; 3]>,
    pub refresh_count: u32,
    pub last_read_at: i64,
}

impl Header {
    pub fn has_body(&self) -> bool {
        self.built_at.is_some()
    }

    pub fn is_withheld(&self, panel_id: &str) -> bool {
        self.withheld_panels.iter().any(|w| w.panel_id == panel_id)
    }
}

/// One body panel as masking and rev see it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PanelSummary {
    pub id: String,
    pub intent: String,
    pub state: PanelState,
    pub built_at: Option<i64>,
}

/// How one panel's data in the body was produced.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PanelOutcome {
    #[default]
    Fresh,
    Retained,
    Partial,
    Truncated,
    Withheld,
    Unsupported,
    Failed,
}

/// One executed query of a panel, as the build ran it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ExecutedQuery {
    pub text: String,
    pub query_type: String,
    pub window: Window,
    pub time_shift_micros: i64,
    pub is_partial: bool,
    pub hits: usize,
    pub trace_id: String,
}

/// A variable whose value came from a values query, with the streams that query read.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ValuesDependency {
    pub variable: String,
    pub sources: Vec<(StreamType, String)>,
}

/// The private provenance of one panel: what the authorization deadline re-checks.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ManifestPanel {
    pub intent: String,
    pub resolved_variables: BTreeMap<String, serde_json::Value>,
    pub queries: Vec<ExecutedQuery>,
    pub sources: Vec<(StreamType, String)>,
    pub cipher_keys: Vec<String>,
    pub values_dependencies: Vec<ValuesDependency>,
    pub built_at: Option<i64>,
    pub outcome: PanelOutcome,
}

/// The private block: each panel's provenance and every values query a variable came from.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub panels: BTreeMap<String, ManifestPanel>,
    pub variables: Vec<ValuesDependency>,
}

/// A file as read from disk; the body stays compressed until a serve needs it.
#[derive(Clone, Debug)]
pub struct Stored {
    pub header: Header,
    pub manifest: Manifest,
    pub body_zst: Bytes,
}

/// The cache key of one range of one link.
pub fn key(org_id: &str, link_id: &str, range_key: &str) -> String {
    format!("{PUBLIC_DASHBOARDS_PREFIX}{org_id}/{link_id}/{range_key}")
}

pub fn next_incarnation() -> u64 {
    INCARNATION.fetch_add(1, Ordering::SeqCst)
}

/// The panels body as zstd, and its uncompressed size.
pub fn compress_body(body: &ResultBody) -> Result<(Bytes, usize), anyhow::Error> {
    let json = serde_json::to_vec(body)?;
    let zst = zstd::bulk::compress(&json, 3)?;
    Ok((Bytes::from(zst), json.len()))
}

pub fn decompress_body(zst: &[u8]) -> Result<Bytes, anyhow::Error> {
    Ok(Bytes::from(zstd::stream::decode_all(zst)?))
}

pub fn encode(
    header: &Header,
    manifest: &Manifest,
    body_zst: &[u8],
) -> Result<Bytes, anyhow::Error> {
    let header = serde_json::to_vec(header)?;
    let manifest = serde_json::to_vec(manifest)?;
    let mut out =
        Vec::with_capacity(PREFIX_LEN + header.len() + 4 + manifest.len() + body_zst.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    out.extend_from_slice(&u32::try_from(header.len())?.to_le_bytes());
    out.extend_from_slice(&header);
    out.extend_from_slice(&u32::try_from(manifest.len())?.to_le_bytes());
    out.extend_from_slice(&manifest);
    out.extend_from_slice(body_zst);
    Ok(Bytes::from(out))
}

/// The header length from the fixed prefix; an unknown magic or version is an error.
pub fn header_len(prefix: &[u8]) -> Result<usize, anyhow::Error> {
    anyhow::ensure!(prefix.len() >= PREFIX_LEN, "short file");
    anyhow::ensure!(&prefix[..4] == MAGIC, "not a public dashboard result file");
    let version = u16::from_le_bytes([prefix[4], prefix[5]]);
    anyhow::ensure!(
        version == FORMAT_VERSION,
        "unknown format version {version}"
    );
    Ok(u32::from_le_bytes(prefix[6..10].try_into()?) as usize)
}

pub fn decode(bytes: &Bytes) -> Result<Stored, anyhow::Error> {
    let header_len = header_len(bytes)?;
    let header_end = PREFIX_LEN + header_len;
    let header: Header =
        serde_json::from_slice(bytes.get(PREFIX_LEN..header_end).context("short header")?)?;
    let len_bytes = bytes
        .get(header_end..header_end + 4)
        .context("short file")?;
    let manifest_len = u32::from_le_bytes(len_bytes.try_into()?) as usize;
    let manifest_end = header_end + 4 + manifest_len;
    let manifest: Manifest = serde_json::from_slice(
        bytes
            .get(header_end + 4..manifest_end)
            .context("short manifest")?,
    )?;
    Ok(Stored {
        header,
        manifest,
        body_zst: bytes.slice(manifest_end..),
    })
}

/// The header alone, read through one handle; an unknown or broken file is a miss and is evicted.
pub async fn read_header(key: &str) -> Option<Header> {
    let path = disk::get_file_path(key)?;
    let read = tokio::task::spawn_blocking(move || read_header_bytes(&path)).await;
    let parsed = match read {
        Ok(Ok(None)) => return None,
        Ok(Ok(Some(raw))) => serde_json::from_slice::<Header>(&raw).map_err(anyhow::Error::from),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(e.into()),
    };
    match parsed {
        Ok(header) => Some(header),
        Err(e) => {
            log::warn!("public dashboard file {key} is unreadable, evicting: {e}");
            evict(key).await;
            None
        }
    }
}

/// The whole file; an unknown or broken file is a miss and is evicted.
pub async fn read(key: &str) -> Option<Stored> {
    let bytes = disk::get(key, None).await?;
    match decode(&bytes) {
        Ok(stored) => Some(stored),
        Err(e) => {
            log::warn!("public dashboard file {key} is unreadable, evicting: {e}");
            evict(key).await;
            None
        }
    }
}

/// The body of the written version `header` names: from memory, else decompressed from disk.
pub async fn body(key: &str, header: &Header) -> Option<Arc<ResultBody>> {
    if let Some(json) = public_dashboards_memory_get(key, header.incarnation).await {
        metrics::PUBLIC_DASHBOARD_MEM_CACHE_HITS_TOTAL.inc();
        return serde_json::from_slice(&json).ok().map(Arc::new);
    }
    metrics::PUBLIC_DASHBOARD_MEM_CACHE_MISSES_TOTAL.inc();
    let stored = read(key).await?;
    // The file was replaced since the header read; that version's body is gone.
    if stored.header.incarnation != header.incarnation || stored.body_zst.is_empty() {
        return None;
    }
    let json = decompress_body(&stored.body_zst).ok()?;
    let body = serde_json::from_slice(&json).ok().map(Arc::new);
    public_dashboards_memory_put(key, header.incarnation, json).await;
    body
}

/// Writes the file under a new incarnation and returns it; the body is compressed here.
pub async fn write(
    key: &str,
    header: &mut Header,
    manifest: &Manifest,
    body: Option<&ResultBody>,
) -> Result<u64, anyhow::Error> {
    let (zst, json_len) = match body {
        Some(body) => compress_body(body)?,
        None => (Bytes::new(), 0),
    };
    header.size_bytes = u32::try_from(json_len).unwrap_or(u32::MAX);
    write_raw(key, header, manifest, zst).await
}

/// Writes a header and manifest over an already compressed body under a new incarnation.
pub async fn write_raw(
    key: &str,
    header: &mut Header,
    manifest: &Manifest,
    body_zst: Bytes,
) -> Result<u64, anyhow::Error> {
    header.incarnation = next_incarnation();
    header.last_read_at = now_micros();
    #[cfg(test)]
    anyhow::ensure!(!FAIL_WRITES.contains(key), "injected write failure");
    let bytes = encode(header, manifest, &body_zst)?;
    public_dashboards_replace(key, header.incarnation, bytes).await?;
    Ok(header.incarnation)
}

/// Evicts an indexed file, or any while the startup scan runs, since reads serve unscanned files.
pub async fn evict_if_indexed(key: &str) {
    let loading = !disk::LOADING_FROM_DISK_DONE.load(Ordering::Relaxed);
    if loading || disk::public_dashboards_indexed(key).await {
        evict(key).await;
    }
}

pub async fn evict(key: &str) {
    if let Err(e) = public_dashboards_evict(key).await {
        log::error!("public dashboard file {key} evict error: {e}");
    }
}

/// The header JSON of the file at `path`, or None when there is no file.
fn read_header_bytes(path: &str) -> Result<Option<Vec<u8>>, anyhow::Error> {
    use std::io::Read;
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let mut prefix = [0u8; PREFIX_LEN];
    file.read_exact(&mut prefix)?;
    let mut raw = vec![0u8; header_len(&prefix)?];
    file.read_exact(&mut raw)?;
    Ok(Some(raw))
}

#[cfg(test)]
mod tests {
    use config::meta::public_dashboards::{NotAvailableReason, PanelResult};

    use super::*;

    fn sample_body() -> ResultBody {
        let mut panels = BTreeMap::new();
        panels.insert(
            "p1".to_string(),
            PanelResult::not_available(NotAvailableReason::TooLarge),
        );
        ResultBody {
            panels,
            variables: vec![],
            ..Default::default()
        }
    }

    fn manifest() -> Manifest {
        let mut m = Manifest::default();
        m.panels.insert(
            "p1".into(),
            ManifestPanel {
                intent: "abc".into(),
                sources: vec![(StreamType::Logs, "secret_stream".into())],
                queries: vec![ExecutedQuery {
                    text: "SELECT * FROM secret_stream".into(),
                    ..Default::default()
                }],
                ..Default::default()
            },
        );
        m
    }

    #[test]
    fn gate03_the_file_round_trips_header_manifest_and_body() {
        let header = Header {
            incarnation: 7,
            built_at: Some(10),
            withheld_panels: vec![WithheldPanel {
                panel_id: "p2".into(),
                reason: NotAvailableReason::Unauthorized,
            }],
            ..Default::default()
        };
        let (zst, len) = compress_body(&sample_body()).unwrap();
        assert!(len > 0);
        let bytes = encode(&header, &manifest(), &zst).unwrap();
        let stored = decode(&bytes).unwrap();
        assert_eq!(stored.header, header);
        assert_eq!(stored.manifest, manifest());
        let json = decompress_body(&stored.body_zst).unwrap();
        let back: ResultBody = serde_json::from_slice(&json).unwrap();
        assert_eq!(
            serde_json::to_value(back).unwrap(),
            serde_json::to_value(sample_body()).unwrap()
        );
        // The body alone carries no provenance.
        assert!(!String::from_utf8_lossy(&json).contains("secret_stream"));
    }

    #[test]
    fn gate16_an_unknown_format_version_or_broken_file_does_not_decode() {
        let bytes = encode(&Header::default(), &Manifest::default(), &[]).unwrap();
        let mut newer = bytes.to_vec();
        newer[4..6].copy_from_slice(&(FORMAT_VERSION + 1).to_le_bytes());
        assert!(decode(&Bytes::from(newer)).is_err());
        let mut garbage = bytes.to_vec();
        garbage[0] = b'X';
        assert!(decode(&Bytes::from(garbage)).is_err());
        assert!(decode(&bytes.slice(..bytes.len() - 3)).is_err());
        assert!(decode(&bytes).is_ok());
    }

    #[test]
    fn gate06_incarnations_are_unique_and_ahead_of_the_clock_at_start() {
        let a = next_incarnation();
        let b = next_incarnation();
        assert!(b > a);
        assert!(a >= u64::try_from(now_micros()).unwrap() - 60_000_000);
    }

    #[tokio::test]
    async fn gate16_a_broken_file_on_disk_is_a_miss_and_is_evicted() {
        let key = key("o", &config::ider::uuid(), "r60");
        public_dashboards_replace(&key, 1, Bytes::from_static(b"not a result file"))
            .await
            .unwrap();
        assert!(read_header(&key).await.is_none());
        assert!(disk::get(&key, None).await.is_none());
    }

    #[tokio::test]
    async fn gate06_a_write_gets_a_new_incarnation_and_its_own_body() {
        let key = key("o", &config::ider::uuid(), "r3600");
        let mut header = Header {
            built_at: Some(1),
            ..Default::default()
        };
        let first = write(&key, &mut header, &manifest(), Some(&sample_body()))
            .await
            .unwrap();
        let read_back = read_header(&key).await.unwrap();
        assert_eq!(read_back.incarnation, first);
        assert!(body(&key, &read_back).await.is_some());
        let second = write(&key, &mut header, &manifest(), None).await.unwrap();
        assert!(second > first);
        // The older version's body is never served once the file moved on.
        assert!(body(&key, &read_back).await.is_none());
        evict(&key).await;
        assert!(read_header(&key).await.is_none());
    }

    #[tokio::test]
    async fn a_file_the_startup_scan_has_not_indexed_is_evicted_while_it_runs() {
        assert!(
            !disk::LOADING_FROM_DISK_DONE.load(Ordering::Relaxed),
            "no scan in tests"
        );
        let key = key("o", &config::ider::uuid(), "r60");
        let path = disk::get_file_path(&key).unwrap();
        std::fs::create_dir_all(std::path::Path::new(&path).parent().unwrap()).unwrap();
        std::fs::write(&path, b"from before the restart").unwrap();
        assert!(!disk::public_dashboards_indexed(&key).await);
        evict_if_indexed(&key).await;
        assert!(!std::path::Path::new(&path).exists());
    }
}
