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

//! The published Alert Library, indexed once per node: the manifest, each alert file and the
//! needs derived from it, refreshed on the manifest ETag.

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};

use futures::StreamExt;
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::Mutex;

use super::needs::{self, Needs};

/// The manifest `format_version` major this server reads, as the web gallery does.
pub const SUPPORTED_MANIFEST_MAJOR: u64 = 1;
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const CONCURRENT_FETCHES: usize = 16;
// A failed refresh is retried this soon rather than on every request.
const RETRY_AFTER: Duration = Duration::from_secs(60);

static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(|| Mutex::new(Cache::default()));

/// One manifest entry, as `generate_manifest.py` in the library repo emits it.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct ManifestEntry {
    pub id: String,
    pub name: String,
    pub pack: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub stream: String,
    pub stream_type: String,
    #[serde(default)]
    pub query_type: String,
    #[serde(default)]
    pub alert_type: Option<String>,
    pub path: String,
    #[serde(default)]
    pub content_hash: String,
    #[serde(default)]
    pub docs_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    format_version: String,
    #[serde(default)]
    alerts: Vec<ManifestEntry>,
    #[serde(default)]
    anomaly_alerts: Vec<ManifestEntry>,
}

#[derive(Clone, Debug)]
pub struct IndexedEntry {
    pub entry: ManifestEntry,
    pub anomaly: bool,
    pub needs: Needs,
    pub patterns: Vec<regex::Regex>,
    pub file: Value,
}

impl IndexedEntry {
    pub fn new(entry: ManifestEntry, anomaly: bool, file: Value) -> Self {
        let needs = needs::derive(&file, config::TIMESTAMP_COL_NAME);
        let patterns = needs
            .name_patterns
            .iter()
            .filter_map(|p| regex::Regex::new(&format!("^(?:{p})$")).ok())
            .collect();
        Self {
            entry,
            anomaly,
            needs,
            patterns,
            file,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct LibraryIndex {
    pub version: String,
    pub entries: Vec<IndexedEntry>,
}

#[derive(Clone, Debug)]
pub enum IndexState {
    Ready(Arc<LibraryIndex>),
    Unavailable,
    UnsupportedFormat,
}

#[derive(Default)]
struct Cache {
    index: Option<Arc<LibraryIndex>>,
    etag: Option<String>,
    unsupported: bool,
    checked_at: Option<Instant>,
    next_check: Duration,
    files: HashMap<String, Value>,
}

enum Fetched {
    NotModified,
    Manifest { body: Manifest, etag: String },
}

/// The current index, refreshed first when it is older than the sync interval.
pub async fn current() -> IndexState {
    let mut cache = CACHE.lock().await;
    let due = cache
        .checked_at
        .is_none_or(|at| at.elapsed() >= cache.next_check);
    if due {
        refresh(&mut cache).await;
    }
    match (&cache.index, cache.unsupported) {
        (_, true) => IndexState::UnsupportedFormat,
        (Some(index), false) => IndexState::Ready(index.clone()),
        (None, false) => IndexState::Unavailable,
    }
}

async fn refresh(cache: &mut Cache) {
    let interval = Duration::from_secs(
        config::get_config()
            .common
            .alert_library_sync_interval_secs
            .max(60),
    );
    cache.checked_at = Some(Instant::now());
    let base = library_base();
    let client = match reqwest::Client::builder().timeout(FETCH_TIMEOUT).build() {
        Ok(client) => client,
        Err(e) => {
            log::warn!("[ALERT LIBRARY] http client: {e}");
            cache.next_check = RETRY_AFTER;
            return;
        }
    };
    match fetch_manifest(&client, &base, cache.etag.as_deref()).await {
        Ok(Fetched::NotModified) => cache.next_check = interval,
        Ok(Fetched::Manifest { body, etag }) => {
            cache.unsupported = !is_supported(&body.format_version);
            if !cache.unsupported {
                let index = build(&client, &base, body, etag.clone(), &mut cache.files).await;
                cache.index = Some(Arc::new(index));
            }
            cache.etag = Some(etag);
            cache.next_check = interval;
        }
        Err(e) => {
            // A stale index keeps answering; only a node that never loaded one is unavailable.
            log::warn!("[ALERT LIBRARY] manifest fetch from {base} failed: {e}");
            cache.next_check = RETRY_AFTER;
        }
    }
}

fn library_base() -> String {
    let base = config::get_config().common.alert_library_url.clone();
    if base.ends_with('/') {
        base
    } else {
        format!("{base}/")
    }
}

/// True when this server can read a manifest of `format_version`.
pub fn is_supported(format_version: &str) -> bool {
    format_version
        .split('.')
        .next()
        .and_then(|major| major.parse::<u64>().ok())
        == Some(SUPPORTED_MANIFEST_MAJOR)
}

async fn fetch_manifest(
    client: &reqwest::Client,
    base: &str,
    etag: Option<&str>,
) -> anyhow::Result<Fetched> {
    let mut request = client.get(format!("{base}manifest.json"));
    if let Some(etag) = etag {
        request = request.header(reqwest::header::IF_NONE_MATCH, etag);
    }
    let response = request.send().await?;
    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(Fetched::NotModified);
    }
    let response = response.error_for_status()?;
    let header_etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let bytes = response.bytes().await?;
    let etag = header_etag
        .unwrap_or_else(|| format!("{:x}", md5::compute(&bytes)))
        .to_string();
    Ok(Fetched::Manifest {
        body: serde_json::from_slice(&bytes)?,
        etag,
    })
}

/// Indexes every entry, fetching only the files whose `content_hash` is new.
async fn build(
    client: &reqwest::Client,
    base: &str,
    manifest: Manifest,
    etag: String,
    files: &mut HashMap<String, Value>,
) -> LibraryIndex {
    let entries: Vec<(ManifestEntry, bool)> = manifest
        .alerts
        .into_iter()
        .map(|e| (e, false))
        .chain(manifest.anomaly_alerts.into_iter().map(|e| (e, true)))
        .collect();
    // Owned futures: a stream closure borrowing the client fails the handler's Send bound.
    let jobs: Vec<_> = entries
        .iter()
        .map(|(e, _)| (file_key(e), format!("{base}{}", e.path)))
        .filter(|(key, _)| !files.contains_key(key))
        .map(|(key, url)| {
            let client = client.clone();
            async move { (key, fetch_file(&client, &url).await) }
        })
        .collect();
    let fetched: Vec<(String, Option<Value>)> = futures::stream::iter(jobs)
        .buffer_unordered(CONCURRENT_FETCHES)
        .collect()
        .await;
    for (key, file) in fetched {
        if let Some(file) = file {
            files.insert(key, file);
        }
    }
    let keys: std::collections::HashSet<String> =
        entries.iter().map(|(e, _)| file_key(e)).collect();
    files.retain(|k, _| keys.contains(k));
    let entries = entries
        .into_iter()
        .filter_map(|(entry, anomaly)| {
            let file = files.get(&file_key(&entry))?.clone();
            Some(IndexedEntry::new(entry, anomaly, file))
        })
        .collect();
    LibraryIndex {
        version: etag.trim_matches('"').to_string(),
        entries,
    }
}

fn file_key(entry: &ManifestEntry) -> String {
    format!("{}@{}", entry.path, entry.content_hash)
}

async fn fetch_file(client: &reqwest::Client, url: &str) -> Option<Value> {
    let response = client.get(url).send().await.ok()?;
    response.error_for_status().ok()?.json().await.ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_supported_major_is_read() {
        let cases = [("1.1.0", true), ("1", true), ("2.0.0", false), ("x", false)];
        for (version, supported) in cases {
            assert_eq!(is_supported(version), supported, "{version}");
        }
    }
}
