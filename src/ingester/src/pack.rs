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

//! Packed persist format for the ingester WAL: all streams of a memtable are
//! appended into a few large pack files instead of one parquet per
//! stream × hour. Each segment is a complete, self-contained parquet file.
//!
//! Layout of `{data_wal_dir}/pack/{idx}/{memtable_id}.{seq}.pack`:
//!
//! ```text
//! [segment 0: parquet bytes][segment 1: parquet bytes]...[footer JSON]
//! [footer_len u32 LE][footer_hash u64 LE][version u16 LE][magic 8B]
//! ```
//!
//! Written as `.pack.tmp` first, finalized via the same `.lock` recovery flow
//! as the legacy per-stream files.

use std::{
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock as Lazy},
};

use arrow::record_batch::RecordBatch;
use arrow_schema::Schema;
use config::{
    FileFormat, RwAHashMap,
    meta::{search::ScanStats, stream::FileMeta},
    metrics,
    utils::hash::{Sum64, gxhash},
};
use hashbrown::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use snafu::ResultExt;
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
};

use crate::{
    entry::PersistStat,
    errors::{
        CreateFileSnafu, DeleteFileSnafu, JSONSerializationSnafu, OpenFileSnafu, ReadFileSnafu,
        Result, WriteFileSnafu,
    },
};

pub const PACK_DIR_PREFIX: &str = "pack";
pub const PACK_FILE_EXT: &str = "pack";

const PACK_MAGIC: [u8; 8] = *b"O2PACK\x00\x01";
const PACK_VERSION: u16 = 1;
// footer_len(u32) + footer_hash(u64) + version(u16) + magic(8)
const PACK_TRAILER_LEN: usize = 4 + 8 + 2 + 8;

/// Metadata of one segment (a complete parquet file) inside a pack.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackSegmentMeta {
    pub org_id: String,
    pub stream_name: String,
    /// partition path fragment, e.g. `2026/07/27/08/country=US`
    pub partition_key: String,
    pub offset: u64,
    pub length: u64,
    pub min_ts: i64,
    pub max_ts: i64,
    pub records: i64,
    pub original_size: i64,
}

/// Footer of a pack file, stores the index of all segments.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackFooter {
    pub memtable_id: u64,
    pub stream_type: String,
    pub segments: Vec<PackSegmentMeta>,
}

/// A finalized pack file, still named `.pack.tmp` until the lock/rename flow.
pub(crate) struct FinishedPack {
    pub tmp_path: PathBuf,
    pub path: PathBuf,
    pub footer: PackFooter,
    pub size: u64,
}

struct CurrentPack {
    file: fs::File,
    tmp_path: PathBuf,
    path: PathBuf,
    offset: u64,
    segments: Vec<PackSegmentMeta>,
}

/// Appends parquet segments into pack files, rolling over at `max_size`.
pub(crate) struct PackWriter {
    dir: PathBuf,
    memtable_id: u64,
    stream_type: String,
    max_size: u64,
    seq: usize,
    current: Option<CurrentPack>,
    finished: Vec<FinishedPack>,
    pub(crate) stat: PersistStat,
    /// bytes written per org, used for metrics accounting after finalize
    pub(crate) bytes_by_org: HashMap<String, i64>,
}

impl PackWriter {
    pub(crate) fn new(idx: usize, memtable_id: u64, stream_type: &str, max_size: u64) -> Self {
        let cfg = config::get_config();
        let dir = PathBuf::from(&cfg.common.data_wal_dir)
            .join(PACK_DIR_PREFIX)
            .join(idx.to_string());
        Self {
            dir,
            memtable_id,
            stream_type: stream_type.to_string(),
            max_size,
            seq: 0,
            current: None,
            finished: Vec::new(),
            stat: PersistStat::default(),
            bytes_by_org: HashMap::new(),
        }
    }

    async fn open_next(&mut self) -> Result<()> {
        fs::create_dir_all(&self.dir)
            .await
            .context(CreateFileSnafu { path: &self.dir })?;
        let path = self.dir.join(format!(
            "{}.{}.{}",
            self.memtable_id, self.seq, PACK_FILE_EXT
        ));
        let tmp_path = self.dir.join(format!(
            "{}.{}.{}.tmp",
            self.memtable_id, self.seq, PACK_FILE_EXT
        ));
        self.seq += 1;
        let file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp_path)
            .await
            .context(CreateFileSnafu { path: &tmp_path })?;
        self.current = Some(CurrentPack {
            file,
            tmp_path,
            path,
            offset: 0,
            segments: Vec::new(),
        });
        Ok(())
    }

    pub(crate) async fn append_segment(
        &mut self,
        org_id: &str,
        stream_name: &str,
        partition_key: &str,
        data: &[u8],
        file_meta: &FileMeta,
    ) -> Result<()> {
        // roll over to a new pack when the current one is full
        if let Some(current) = self.current.as_ref()
            && current.offset > 0
            && current.offset + data.len() as u64 > self.max_size
        {
            self.finish_current().await?;
        }
        if self.current.is_none() {
            self.open_next().await?;
        }
        let current = self.current.as_mut().unwrap();
        current.file.write_all(data).await.context(WriteFileSnafu {
            path: &current.tmp_path,
        })?;
        current.segments.push(PackSegmentMeta {
            org_id: org_id.to_string(),
            stream_name: stream_name.to_string(),
            partition_key: partition_key.to_string(),
            offset: current.offset,
            length: data.len() as u64,
            min_ts: file_meta.min_ts,
            max_ts: file_meta.max_ts,
            records: file_meta.records,
            original_size: file_meta.original_size,
        });
        current.offset += data.len() as u64;
        *self.bytes_by_org.entry_ref(org_id).or_insert(0) += data.len() as i64;
        Ok(())
    }

    async fn finish_current(&mut self) -> Result<()> {
        let Some(mut current) = self.current.take() else {
            return Ok(());
        };
        if current.segments.is_empty() {
            // nothing written, remove the empty tmp file
            let _ = fs::remove_file(&current.tmp_path).await;
            return Ok(());
        }
        let footer = PackFooter {
            memtable_id: self.memtable_id,
            stream_type: self.stream_type.clone(),
            segments: std::mem::take(&mut current.segments),
        };
        let footer_data = serde_json::to_string(&footer).context(JSONSerializationSnafu)?;
        let footer_hash = gxhash::new().sum64(&footer_data);
        let mut trailer = Vec::with_capacity(footer_data.len() + PACK_TRAILER_LEN);
        trailer.extend_from_slice(footer_data.as_bytes());
        trailer.extend_from_slice(&(footer_data.len() as u32).to_le_bytes());
        trailer.extend_from_slice(&footer_hash.to_le_bytes());
        trailer.extend_from_slice(&PACK_VERSION.to_le_bytes());
        trailer.extend_from_slice(&PACK_MAGIC);
        current
            .file
            .write_all(&trailer)
            .await
            .context(WriteFileSnafu {
                path: &current.tmp_path,
            })?;
        current.file.sync_all().await.context(WriteFileSnafu {
            path: &current.tmp_path,
        })?;
        self.stat.file_num += 1;
        self.finished.push(FinishedPack {
            size: current.offset + trailer.len() as u64,
            tmp_path: current.tmp_path,
            path: current.path,
            footer,
        });
        Ok(())
    }

    /// Finalize all pack files (footer written + fsynced, still `.pack.tmp`).
    pub(crate) async fn finish(
        mut self,
    ) -> Result<(Vec<FinishedPack>, PersistStat, HashMap<String, i64>)> {
        self.finish_current().await?;
        Ok((self.finished, self.stat, self.bytes_by_org))
    }
}

/// Read and verify the footer of a pack file.
pub async fn read_footer(path: &Path) -> Result<PackFooter> {
    let mut file = fs::File::open(path).await.context(OpenFileSnafu { path })?;
    let file_size = file.metadata().await.context(ReadFileSnafu { path })?.len();
    if file_size < PACK_TRAILER_LEN as u64 {
        return Err(pack_format_error(path, "file too small"));
    }
    file.seek(SeekFrom::End(-(PACK_TRAILER_LEN as i64)))
        .await
        .context(ReadFileSnafu { path })?;
    let mut trailer = [0u8; PACK_TRAILER_LEN];
    file.read_exact(&mut trailer)
        .await
        .context(ReadFileSnafu { path })?;
    if trailer[14..22] != PACK_MAGIC {
        return Err(pack_format_error(path, "invalid magic"));
    }
    let version = u16::from_le_bytes(trailer[12..14].try_into().unwrap());
    if version != PACK_VERSION {
        return Err(pack_format_error(path, "unsupported version"));
    }
    let footer_len = u32::from_le_bytes(trailer[0..4].try_into().unwrap()) as u64;
    let footer_hash = u64::from_le_bytes(trailer[4..12].try_into().unwrap());
    if footer_len + PACK_TRAILER_LEN as u64 > file_size {
        return Err(pack_format_error(path, "invalid footer length"));
    }
    file.seek(SeekFrom::End(
        -((PACK_TRAILER_LEN as u64 + footer_len) as i64),
    ))
    .await
    .context(ReadFileSnafu { path })?;
    let mut footer_data = vec![0u8; footer_len as usize];
    file.read_exact(&mut footer_data)
        .await
        .context(ReadFileSnafu { path })?;
    let footer_data = String::from_utf8(footer_data)
        .map_err(|_| pack_format_error(path, "footer is not valid utf8"))?;
    if gxhash::new().sum64(&footer_data) != footer_hash {
        return Err(pack_format_error(path, "footer hash mismatch"));
    }
    serde_json::from_str(&footer_data).context(JSONSerializationSnafu)
}

/// Read the raw bytes of one segment from a pack file.
pub async fn read_segment(path: &Path, offset: u64, length: u64) -> Result<Vec<u8>> {
    let mut file = fs::File::open(path).await.context(OpenFileSnafu { path })?;
    file.seek(SeekFrom::Start(offset))
        .await
        .context(ReadFileSnafu { path })?;
    let mut buf = vec![0u8; length as usize];
    file.read_exact(&mut buf)
        .await
        .context(ReadFileSnafu { path })?;
    Ok(buf)
}

fn pack_format_error(path: &Path, reason: &str) -> crate::errors::Error {
    crate::errors::Error::ReadFileError {
        path: path.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidData, reason.to_string()),
    }
}

/// One registered segment, resolvable to parquet bytes inside a pack file.
#[derive(Clone)]
pub struct PackSegment {
    pub pack_path: Arc<PathBuf>,
    pub memtable_id: u64,
    pub registered_at: i64, // micros, used for the flush-by-age condition
    pub meta: Arc<PackSegmentMeta>,
}

/// Segments of one stream plus cached aggregates, so the mover snapshot can
/// copy a few numbers per stream instead of walking and cloning segments.
#[derive(Default)]
struct StreamSegments {
    segments: Vec<PackSegment>,
    total_original_size: i64,
    total_compressed_size: i64,
    oldest_registered_at: i64,
}

impl StreamSegments {
    fn recompute(&mut self) {
        self.total_original_size = self.segments.iter().map(|s| s.meta.original_size).sum();
        self.total_compressed_size = self.segments.iter().map(|s| s.meta.length as i64).sum();
        self.oldest_registered_at = self
            .segments
            .iter()
            .map(|s| s.registered_at)
            .min()
            .unwrap_or(0);
    }
}

/// In-memory segment index: `org/stream_type/stream_name` -> segments.
static PACK_SEGMENTS: Lazy<RwAHashMap<Arc<str>, StreamSegments>> = Lazy::new(Default::default);

/// Per-pack bookkeeping for consumption and deletion.
struct PackEntry {
    total: usize,    // total segments in the pack
    consumed: usize, // segments uploaded (or dropped) by the mover
    readers: usize,  // in-flight read_from_pack calls holding this pack
}

/// Pack registry: pack path -> consumption/reader state.
static PACK_REGISTRY: Lazy<RwAHashMap<Arc<PathBuf>, PackEntry>> = Lazy::new(Default::default);

fn segment_index_key(org_id: &str, stream_type: &str, stream_name: &str) -> String {
    format!("{org_id}/{stream_type}/{stream_name}")
}

/// Register the segments of a finalized pack into the in-memory index,
/// skipping segments already recorded as consumed in the sidecar file.
pub async fn register_pack(
    path: PathBuf,
    footer: &PackFooter,
    registered_at: i64,
    consumed: &HashSet<u64>,
) {
    let pack_path = Arc::new(path);
    // count only sidecar offsets that exist in the footer: a partially
    // written sidecar record can parse as a garbage offset, and trusting
    // consumed.len() would over-count and delete the pack before every real
    // segment is uploaded
    let consumed_count = footer
        .segments
        .iter()
        .filter(|s| consumed.contains(&s.offset))
        .count();
    {
        let mut w = PACK_REGISTRY.write().await;
        w.insert(
            pack_path.clone(),
            PackEntry {
                total: footer.segments.len(),
                consumed: consumed_count,
                readers: 0,
            },
        );
    }
    let mut w = PACK_SEGMENTS.write().await;
    let mut touched = Vec::new();
    for seg in footer.segments.iter() {
        if consumed.contains(&seg.offset) {
            continue;
        }
        let key: Arc<str> = Arc::from(segment_index_key(
            &seg.org_id,
            &footer.stream_type,
            &seg.stream_name,
        ));
        w.entry(key.clone())
            .or_default()
            .segments
            .push(PackSegment {
                pack_path: pack_path.clone(),
                memtable_id: footer.memtable_id,
                registered_at,
                meta: Arc::new(seg.clone()),
            });
        touched.push(key);
    }
    touched.dedup();
    for key in touched {
        if let Some(v) = w.get_mut(&key) {
            v.recompute();
        }
    }
}

/// Sidecar file recording consumed segment offsets, so partial consumption
/// survives a restart without re-uploading (and duplicating) segments.
fn consumed_sidecar_path(pack_path: &Path) -> PathBuf {
    let mut p = pack_path.as_os_str().to_owned();
    p.push(".consumed");
    PathBuf::from(p)
}

/// Open sidecar file handles, cached for the pack lifetime (a sidecar gets
/// one append per consumed stream, tens of thousands for a large pack). Also
/// serializes appends so concurrent workers cannot interleave lines. Handles
/// are dropped in delete_pack_file; live packs are few so the map stays small.
static CONSUMED_FILES: Lazy<tokio::sync::Mutex<HashMap<PathBuf, (fs::File, u32)>>> =
    Lazy::new(Default::default);

/// fsync the sidecar every N appends: a successful write() already survives a
/// process crash (page cache), the periodic fsync only bounds how many chunks
/// can be re-uploaded after a power loss / kernel crash.
const CONSUMED_SYNC_EVERY: u32 = 32;

async fn append_consumed_sidecar(pack_path: &Path, offsets: &[u64]) -> std::io::Result<()> {
    if offsets.is_empty() {
        return Ok(());
    }
    let path = consumed_sidecar_path(pack_path);
    let mut data = String::with_capacity(offsets.len() * 12);
    for offset in offsets {
        data.push_str(&offset.to_string());
        data.push('\n');
    }
    let mut files = CONSUMED_FILES.lock().await;
    let mut last_err = None;
    for attempt in 1..=3 {
        match sidecar_append_once(&mut files, &path, &data).await {
            Ok(_) => return Ok(()),
            Err(e) => {
                // drop the handle so the next attempt reopens the file and
                // truncates whatever partial record this attempt left behind
                files.remove(&path);
                log::warn!(
                    "[INGESTER:PACK] write consumed sidecar {} failed (attempt {attempt}/3): {e}",
                    path.display()
                );
                last_err = Some(e);
            }
        }
    }
    Err(last_err.unwrap())
}

async fn sidecar_append_once(
    files: &mut HashMap<PathBuf, (fs::File, u32)>,
    path: &PathBuf,
    data: &str,
) -> std::io::Result<()> {
    if !files.contains_key(path) {
        // a crashed or failed previous append can leave a partial record;
        // appending after it would concatenate both into a different
        // (possibly valid) offset, so cut back to the last complete line
        truncate_partial_sidecar_line(path).await?;
        let f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await?;
        files.insert(path.clone(), (f, 0));
    }
    let (f, writes) = files.get_mut(path).unwrap();
    f.write_all(data.as_bytes()).await?;
    *writes += 1;
    if *writes >= CONSUMED_SYNC_EVERY {
        *writes = 0;
        f.sync_all().await?;
    }
    Ok(())
}

async fn truncate_partial_sidecar_line(path: &Path) -> std::io::Result<()> {
    let data = match fs::read(path).await {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    if data.last().is_none_or(|b| *b == b'\n') {
        return Ok(());
    }
    let keep = data.iter().rposition(|b| *b == b'\n').map_or(0, |i| i + 1);
    let f = fs::OpenOptions::new().write(true).open(path).await?;
    f.set_len(keep as u64).await?;
    Ok(())
}

async fn read_consumed_sidecar(pack_path: &Path) -> HashSet<u64> {
    let path = consumed_sidecar_path(pack_path);
    match fs::read_to_string(&path).await {
        Ok(data) => {
            // ignore a trailing partial line: a crash mid-append can leave a
            // truncated record that parses as a wrong offset
            let complete = match data.rfind('\n') {
                Some(i) => &data[..=i],
                None => "",
            };
            complete
                .lines()
                .filter_map(|l| l.trim().parse().ok())
                .collect()
        }
        Err(_) => HashSet::new(),
    }
}

/// Remove a pack from the index and registry without deleting the file.
#[cfg(test)]
async fn unregister_pack(path: &Path) {
    let mut w = PACK_SEGMENTS.write().await;
    for (_, v) in w.iter_mut() {
        v.segments.retain(|s| s.pack_path.as_path() != path);
        v.recompute();
    }
    w.retain(|_, v| !v.segments.is_empty());
    drop(w);
    let mut w = PACK_REGISTRY.write().await;
    w.retain(|p, _| p.as_path() != path);
}

/// Number of registered streams and segments, for stats/debugging.
pub async fn get_segment_index_stats() -> (usize, usize) {
    let r = PACK_SEGMENTS.read().await;
    let streams = r.len();
    let segments = r.values().map(|v| v.segments.len()).sum();
    (streams, segments)
}

/// Refresh the pack backlog gauges: total pack files on disk and total
/// segments pending upload. Unlabeled totals, set every cycle.
pub async fn collect_pack_metrics() {
    let (_, segments) = get_segment_index_stats().await;
    let files = PACK_REGISTRY.read().await.len();
    metrics::INGEST_PACK_FILES
        .with_label_values::<&str>(&[])
        .set(files as i64);
    metrics::INGEST_PACK_SEGMENTS
        .with_label_values::<&str>(&[])
        .set(segments as i64);
}

/// Acquire read guards so the mover will not delete these packs mid-read.
/// Returns the paths actually acquired (already-deleted packs are skipped).
async fn begin_read(paths: &[Arc<PathBuf>]) -> Vec<Arc<PathBuf>> {
    let mut acquired = Vec::with_capacity(paths.len());
    let mut w = PACK_REGISTRY.write().await;
    for path in paths {
        if let Some(entry) = w.get_mut(path) {
            entry.readers += 1;
            acquired.push(path.clone());
        }
    }
    acquired
}

/// Release read guards, deleting packs that became fully consumed meanwhile.
async fn end_read(paths: &[Arc<PathBuf>]) {
    let to_delete = {
        let mut w = PACK_REGISTRY.write().await;
        end_read_locked(&mut w, paths)
    };
    for path in to_delete {
        delete_pack_file(&path).await;
    }
}

/// Decrement reader counters and collect packs whose deferred deletion now
/// falls to the caller. Sync on purpose: callers must not cross a cancellation
/// point between taking the guard paths and decrementing the counters.
fn end_read_locked(
    w: &mut HashMap<Arc<PathBuf>, PackEntry>,
    paths: &[Arc<PathBuf>],
) -> Vec<Arc<PathBuf>> {
    let mut to_delete = Vec::new();
    for path in paths {
        if let Some(entry) = w.get_mut(path) {
            entry.readers = entry.readers.saturating_sub(1);
            if entry.readers == 0 && entry.consumed >= entry.total {
                to_delete.push(path.clone());
            }
        }
    }
    for path in to_delete.iter() {
        w.remove(path);
    }
    to_delete
}

async fn delete_pack_file(path: &Path) {
    let sidecar = consumed_sidecar_path(path);
    CONSUMED_FILES.lock().await.remove(&sidecar);
    // delete the pack first: if it fails the sidecar must survive, otherwise
    // a restart would re-register the whole pack and re-upload every segment
    match fs::remove_file(path).await {
        Ok(_) => {
            log::info!(
                "[INGESTER:PACK] deleted consumed pack file: {}",
                path.display()
            );
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            log::error!(
                "[INGESTER:PACK] failed to delete consumed pack file: {}, error: {e}",
                path.display()
            );
            return;
        }
    }
    let _ = fs::remove_file(&sidecar).await;
}

/// Aggregates of one stream's pending segments, for the mover flush decision.
pub struct PendingStreamStats {
    pub org_id: String,
    pub stream_type: String,
    pub stream_name: String,
    pub total_original_size: i64,
    pub total_compressed_size: i64,
    pub oldest_registered_at: i64,
}

/// Snapshot the aggregates of all pending streams. Copies only the cached
/// per-stream numbers (no segment walking or cloning), so the read-lock hold
/// stays short even with hundreds of thousands of streams — a long hold would
/// queue writers and, with the write-preferring RwLock, stall new searches.
pub async fn get_pending_stream_stats() -> Vec<PendingStreamStats> {
    let r = PACK_SEGMENTS.read().await;
    let mut result = Vec::with_capacity(r.len());
    for (key, v) in r.iter() {
        if v.segments.is_empty() {
            continue;
        }
        let parts: Vec<&str> = key.splitn(3, '/').collect();
        if parts.len() != 3 {
            continue;
        }
        result.push(PendingStreamStats {
            org_id: parts[0].to_string(),
            stream_type: parts[1].to_string(),
            stream_name: parts[2].to_string(),
            total_original_size: v.total_original_size,
            total_compressed_size: v.total_compressed_size,
            oldest_registered_at: v.oldest_registered_at,
        });
    }
    result
}

/// Get the pending segments of one stream (fetched by the mover worker right
/// before uploading, so it also picks up segments added after the snapshot).
pub async fn get_stream_segments(
    org_id: &str,
    stream_type: &str,
    stream_name: &str,
) -> Vec<PackSegment> {
    let key = segment_index_key(org_id, stream_type, stream_name);
    let r = PACK_SEGMENTS.read().await;
    r.get(key.as_str())
        .map(|v| v.segments.clone())
        .unwrap_or_default()
}

/// Mark segments as consumed: remove them from the index and delete packs
/// that are fully consumed with no in-flight readers.
///
/// Returns an error when a sidecar write definitively failed. The in-memory
/// consumption is still committed in that case: the file_list entry is
/// already durable, so keeping the segments pending would re-upload
/// (duplicate) them immediately - the error is for the caller to stop and
/// surface the IO problem, the remaining risk is a re-upload after a restart.
pub async fn mark_segments_consumed(
    org_id: &str,
    stream_type: &str,
    stream_name: &str,
    segments: &[(Arc<PathBuf>, u64)],
) -> Result<()> {
    if segments.is_empty() {
        return Ok(());
    }
    // record the consumption in the sidecar first, so a restart does not
    // re-upload (duplicate) already consumed segments
    let mut by_pack: HashMap<Arc<PathBuf>, Vec<u64>> = HashMap::new();
    for (path, offset) in segments {
        by_pack.entry(path.clone()).or_default().push(*offset);
    }
    let mut sidecar_err = None;
    for (path, offsets) in by_pack.iter() {
        if let Err(e) = append_consumed_sidecar(path.as_path(), offsets).await
            && sidecar_err.is_none()
        {
            sidecar_err = Some((path.clone(), e));
        }
    }
    let key = segment_index_key(org_id, stream_type, stream_name);
    {
        let mut w = PACK_SEGMENTS.write().await;
        if let Some(v) = w.get_mut(key.as_str()) {
            v.segments.retain(|s| {
                !segments
                    .iter()
                    .any(|(p, offset)| s.pack_path == *p && s.meta.offset == *offset)
            });
            if v.segments.is_empty() {
                w.remove(key.as_str());
            } else {
                v.recompute();
            }
        }
    }
    // update pack consumption counters and delete fully consumed packs
    let mut to_delete = Vec::new();
    {
        let mut w = PACK_REGISTRY.write().await;
        for (path, _) in segments {
            if let Some(entry) = w.get_mut(path) {
                entry.consumed += 1;
                if entry.consumed >= entry.total && entry.readers == 0 {
                    to_delete.push(path.clone());
                }
            }
        }
        for path in to_delete.iter() {
            w.remove(path);
        }
    }
    to_delete.dedup();
    for path in to_delete {
        delete_pack_file(&path).await;
    }

    if let Some((path, e)) = sidecar_err {
        return Err(e).context(WriteFileSnafu {
            path: consumed_sidecar_path(&path),
        });
    }
    Ok(())
}

/// Read all pack segments of a stream as record batches. Segments are fully
/// materialized, so no lock is needed afterwards; `skip_memtable_ids` avoids
/// duplicates with data still readable in memory.
/// RAII holder for pack read guards: releases the reader counters even when
/// the query future is cancelled mid-read (drop spawns the async release).
struct ReadGuards {
    paths: Vec<Arc<PathBuf>>,
}

impl ReadGuards {
    /// The paths are taken and the counters decremented inside a single lock
    /// scope with no cancellation point in between: a cancelled call either
    /// left the guards intact (Drop re-releases them) or has already fully
    /// released them. Pack deletion runs detached so a cancel cannot skip it.
    async fn release(mut self) {
        let to_delete = {
            let mut w = PACK_REGISTRY.write().await;
            let paths = std::mem::take(&mut self.paths);
            end_read_locked(&mut w, &paths)
        };
        if !to_delete.is_empty() {
            tokio::spawn(async move {
                for path in to_delete {
                    delete_pack_file(&path).await;
                }
            });
        }
    }
}

impl Drop for ReadGuards {
    fn drop(&mut self) {
        if self.paths.is_empty() {
            return;
        }
        let paths = std::mem::take(&mut self.paths);
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                end_read(&paths).await;
            });
        }
    }
}

pub async fn read_from_pack(
    org_id: &str,
    stream_type: &str,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
    partition_filters: &[(String, Vec<String>)],
    skip_memtable_ids: &HashSet<u64>,
) -> Result<(Vec<(Arc<Schema>, Vec<RecordBatch>)>, ScanStats)> {
    let key = segment_index_key(org_id, stream_type, stream_name);
    // snapshot the segments and acquire the read guards atomically (under the
    // segment index lock), so the mover cannot consume and delete a pack in
    // between: any pack present in the snapshot is guaranteed guardable
    let (segments, guards) = {
        let r = PACK_SEGMENTS.read().await;
        let segments = match r.get(key.as_str()) {
            Some(v) => v.segments.clone(),
            None => return Ok((Vec::new(), ScanStats::new())),
        };
        let mut pack_paths = segments
            .iter()
            .map(|s| s.pack_path.clone())
            .collect::<Vec<_>>();
        pack_paths.sort();
        pack_paths.dedup();
        let acquired = begin_read(&pack_paths).await;
        (segments, ReadGuards { paths: acquired })
    };

    let result = read_segments(segments, time_range, partition_filters, skip_memtable_ids).await;
    guards.release().await;
    result
}

async fn read_segments(
    segments: Vec<PackSegment>,
    time_range: Option<(i64, i64)>,
    partition_filters: &[(String, Vec<String>)],
    skip_memtable_ids: &HashSet<u64>,
) -> Result<(Vec<(Arc<Schema>, Vec<RecordBatch>)>, ScanStats)> {
    let mut stats = ScanStats::new();
    let mut results = Vec::new();
    for segment in segments {
        if skip_memtable_ids.contains(&segment.memtable_id) {
            continue;
        }
        if let Some((min_ts, max_ts)) = time_range
            && (min_ts, max_ts) != (0, 0)
            && (segment.meta.min_ts > max_ts || segment.meta.max_ts < min_ts)
        {
            continue;
        }
        if !config::utils::schema::filter_source_by_partition_key(
            &format!("{}/", segment.meta.partition_key),
            partition_filters,
        ) {
            continue;
        }
        // the caller holds read guards on every involved pack, so the file
        // cannot be deleted concurrently: any IO error here is a real
        // failure and must fail the query instead of returning partial data
        let data = read_segment(
            segment.pack_path.as_path(),
            segment.meta.offset,
            segment.meta.length,
        )
        .await?;
        let (schema, batches) = config::utils::parquet::read_recordbatch_from_bytes(
            FileFormat::Parquet,
            bytes::Bytes::from(data),
        )
        .await
        .map_err(|e| crate::errors::Error::ExternalError { source: e.into() })?;
        stats.files += 1;
        stats.records += segment.meta.records;
        stats.original_size += segment.meta.original_size;
        stats.compressed_size += segment.meta.length as i64;
        results.push((schema, batches));
        tokio::task::coop::consume_budget().await;
    }
    Ok((results, stats))
}

/// Startup: delete orphan `.tmp` files (the `.lock` recovery has already run)
/// and rebuild the segment index from pack footers.
pub(crate) async fn init() -> Result<()> {
    let cfg = config::get_config();
    let pack_dir = PathBuf::from(&cfg.common.data_wal_dir).join(PACK_DIR_PREFIX);
    fs::create_dir_all(&pack_dir)
        .await
        .context(CreateFileSnafu { path: &pack_dir })?;

    let tmp_files = crate::wal::wal_scan_files(&pack_dir, "tmp")
        .await
        .unwrap_or_default();
    for tmp_file in tmp_files {
        log::warn!("[INGESTER:PACK] delete orphan tmp pack file: {tmp_file:?}");
        fs::remove_file(&tmp_file)
            .await
            .context(DeleteFileSnafu { path: &tmp_file })?;
    }

    let pack_files = crate::wal::wal_scan_files(&pack_dir, PACK_FILE_EXT)
        .await
        .unwrap_or_default();
    let mut packs = 0;
    let mut segments = 0;
    for pack_file in pack_files.iter() {
        let footer = match read_footer(pack_file).await {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[INGESTER:PACK] read footer from {} failed: {e}, skip the file",
                    pack_file.display()
                );
                continue;
            }
        };
        let consumed = read_consumed_sidecar(pack_file).await;
        // crashed between full consumption and deletion
        if footer.segments.iter().all(|s| consumed.contains(&s.offset)) {
            delete_pack_file(pack_file).await;
            continue;
        }
        packs += 1;
        // count only sidecar offsets that exist in the footer: garbage
        // records would otherwise underflow the pending count
        segments += footer
            .segments
            .iter()
            .filter(|s| !consumed.contains(&s.offset))
            .count();
        // mtime keeps the flush-by-age condition working across restarts
        let registered_at = fs::metadata(pack_file)
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_micros() as i64)
            .unwrap_or_else(config::utils::time::now_micros);
        register_pack(pack_file.clone(), &footer, registered_at, &consumed).await;
    }

    // delete orphan sidecar files whose pack is gone
    let sidecar_files = crate::wal::wal_scan_files(&pack_dir, "consumed")
        .await
        .unwrap_or_default();
    for sidecar in sidecar_files {
        let pack_file = sidecar.with_extension("");
        if !pack_file.exists() {
            let _ = fs::remove_file(&sidecar).await;
        }
    }

    if packs > 0 {
        log::info!("[INGESTER:PACK] registered {packs} pack files with {segments} segments");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_file_meta(min_ts: i64, max_ts: i64, records: i64, original_size: i64) -> FileMeta {
        FileMeta {
            min_ts,
            max_ts,
            records,
            original_size,
            ..Default::default()
        }
    }

    async fn write_test_pack(dir: &Path, memtable_id: u64) -> Vec<FinishedPack> {
        let mut writer = PackWriter::new(0, memtable_id, "logs", 1024 * 1024);
        writer.dir = dir.to_path_buf();
        writer
            .append_segment(
                "org1",
                "stream_a",
                "2026/07/27/08",
                b"parquet-bytes-aaaa",
                &test_file_meta(100, 200, 10, 1000),
            )
            .await
            .unwrap();
        writer
            .append_segment(
                "org1",
                "stream_b",
                "2026/07/27/09",
                b"parquet-bytes-bb",
                &test_file_meta(300, 400, 5, 500),
            )
            .await
            .unwrap();
        let (finished, stat, bytes_by_org) = writer.finish().await.unwrap();
        assert_eq!(stat.file_num, 1);
        assert_eq!(bytes_by_org.get("org1"), Some(&(18 + 16)));
        finished
    }

    #[tokio::test]
    async fn test_pack_write_read_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let finished = write_test_pack(dir.path(), 42).await;
        assert_eq!(finished.len(), 1);
        let pack = &finished[0];
        assert!(pack.tmp_path.exists());
        // rename like the persist flow does
        fs::rename(&pack.tmp_path, &pack.path).await.unwrap();

        let footer = read_footer(&pack.path).await.unwrap();
        assert_eq!(footer.memtable_id, 42);
        assert_eq!(footer.stream_type, "logs");
        assert_eq!(footer.segments.len(), 2);
        let seg0 = &footer.segments[0];
        assert_eq!(seg0.stream_name, "stream_a");
        assert_eq!(seg0.offset, 0);
        assert_eq!(seg0.length, 18);
        assert_eq!(seg0.min_ts, 100);
        let seg1 = &footer.segments[1];
        assert_eq!(seg1.stream_name, "stream_b");
        assert_eq!(seg1.offset, 18);
        assert_eq!(seg1.length, 16);

        let data = read_segment(&pack.path, seg1.offset, seg1.length)
            .await
            .unwrap();
        assert_eq!(data, b"parquet-bytes-bb");
        let data = read_segment(&pack.path, seg0.offset, seg0.length)
            .await
            .unwrap();
        assert_eq!(data, b"parquet-bytes-aaaa");
    }

    #[tokio::test]
    async fn test_pack_rolls_over_by_size() {
        let dir = tempfile::tempdir().unwrap();
        let mut writer = PackWriter::new(0, 7, "metrics", 20);
        writer.dir = dir.path().to_path_buf();
        // 18 bytes, fits
        writer
            .append_segment(
                "o",
                "s1",
                "p",
                b"parquet-bytes-aaaa",
                &test_file_meta(1, 2, 1, 1),
            )
            .await
            .unwrap();
        // 18 more bytes would exceed 20 -> roll over
        writer
            .append_segment(
                "o",
                "s2",
                "p",
                b"parquet-bytes-aaaa",
                &test_file_meta(1, 2, 1, 1),
            )
            .await
            .unwrap();
        let (finished, stat, _) = writer.finish().await.unwrap();
        assert_eq!(finished.len(), 2);
        assert_eq!(stat.file_num, 2);
        assert_ne!(finished[0].path, finished[1].path);
        // each pack holds exactly one segment starting at offset 0
        for pack in finished.iter() {
            assert_eq!(pack.footer.segments.len(), 1);
            assert_eq!(pack.footer.segments[0].offset, 0);
        }
    }

    #[tokio::test]
    async fn test_read_footer_rejects_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let finished = write_test_pack(dir.path(), 1).await;
        let pack = &finished[0];
        fs::rename(&pack.tmp_path, &pack.path).await.unwrap();

        // truncated file
        let data = fs::read(&pack.path).await.unwrap();
        let truncated = dir.path().join("truncated.pack");
        fs::write(&truncated, &data[..data.len() - 4])
            .await
            .unwrap();
        assert!(read_footer(&truncated).await.is_err());

        // corrupted footer byte
        let mut corrupted_data = data.clone();
        let n = corrupted_data.len();
        corrupted_data[n - PACK_TRAILER_LEN - 5] ^= 0xff;
        let corrupted = dir.path().join("corrupted.pack");
        fs::write(&corrupted, &corrupted_data).await.unwrap();
        assert!(read_footer(&corrupted).await.is_err());

        // too small
        let small = dir.path().join("small.pack");
        fs::write(&small, b"tiny").await.unwrap();
        assert!(read_footer(&small).await.is_err());
    }

    #[tokio::test]
    async fn test_empty_writer_produces_no_pack() {
        let dir = tempfile::tempdir().unwrap();
        let mut writer = PackWriter::new(0, 9, "logs", 1024);
        writer.dir = dir.path().to_path_buf();
        let (finished, stat, _) = writer.finish().await.unwrap();
        assert!(finished.is_empty());
        assert_eq!(stat.file_num, 0);
    }

    #[tokio::test]
    async fn test_read_from_pack_with_real_parquet_segment() {
        use arrow::array::{Int64Array, StringArray};
        use arrow_schema::{DataType, Field};

        // build a real parquet segment
        let schema = Arc::new(Schema::new(vec![
            Field::new(config::TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("value", DataType::Utf8, true),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1000i64, 2000i64])),
                Arc::new(StringArray::from(vec!["a", "b"])),
            ],
        )
        .unwrap();
        let file_meta = test_file_meta(1000, 2000, 2, 100);
        let mut buf = Vec::new();
        let mut writer = config::utils::parquet::new_parquet_writer(
            &mut buf,
            &schema,
            &[],
            &file_meta,
            true,
            None,
        );
        writer.write(&batch).await.unwrap();
        writer.close().await.unwrap();

        // pack it
        let dir = tempfile::tempdir().unwrap();
        let mut pack_writer = PackWriter::new(0, 8888, "logs", 1024 * 1024);
        pack_writer.dir = dir.path().to_path_buf();
        pack_writer
            .append_segment("porg", "pstream", "2026/07/27/08", &buf, &file_meta)
            .await
            .unwrap();
        let (finished, ..) = pack_writer.finish().await.unwrap();
        let pack = &finished[0];
        fs::rename(&pack.tmp_path, &pack.path).await.unwrap();
        register_pack(
            pack.path.clone(),
            &pack.footer,
            config::utils::time::now_micros(),
            &Default::default(),
        )
        .await;

        // read it back through the segment index
        let skip_ids = HashSet::new();
        let (batches, stats) =
            read_from_pack("porg", "logs", "pstream", Some((0, 3000)), &[], &skip_ids)
                .await
                .unwrap();
        assert_eq!(stats.files, 1);
        assert_eq!(stats.records, 2);
        assert_eq!(batches.len(), 1);
        let (read_schema, read_batches) = &batches[0];
        assert_eq!(read_schema.fields().len(), 2);
        assert_eq!(read_batches.iter().map(|b| b.num_rows()).sum::<usize>(), 2);

        // time range filter excludes the segment
        let (batches, stats) = read_from_pack(
            "porg",
            "logs",
            "pstream",
            Some((5000, 6000)),
            &[],
            &skip_ids,
        )
        .await
        .unwrap();
        assert!(batches.is_empty());
        assert_eq!(stats.files, 0);

        // skip when its memtable is still readable in memory
        let skip_ids = HashSet::from_iter([8888u64]);
        let (batches, _) =
            read_from_pack("porg", "logs", "pstream", Some((0, 3000)), &[], &skip_ids)
                .await
                .unwrap();
        assert!(batches.is_empty());

        unregister_pack(&pack.path).await;
    }

    #[tokio::test]
    async fn test_consume_lifecycle_deletes_pack() {
        let dir = tempfile::tempdir().unwrap();
        let finished = write_test_pack(dir.path(), 555).await;
        let pack = &finished[0];
        fs::rename(&pack.tmp_path, &pack.path).await.unwrap();
        register_pack(
            pack.path.clone(),
            &pack.footer,
            config::utils::time::now_micros(),
            &Default::default(),
        )
        .await;

        // both streams are pending, with cached aggregates
        let pending = get_pending_stream_stats().await;
        let stats_a = pending
            .iter()
            .find(|p| p.stream_name == "stream_a" && p.org_id == "org1")
            .expect("stream_a pending");
        assert_eq!(stats_a.stream_type, "logs");
        assert!(stats_a.total_original_size > 0);
        assert!(stats_a.total_compressed_size > 0);
        assert!(stats_a.oldest_registered_at > 0);

        // consume stream_a only: pack must remain (stream_b not consumed yet)
        let consumed_a = get_stream_segments("org1", "logs", "stream_a")
            .await
            .iter()
            .filter(|s| s.memtable_id == 555)
            .map(|s| (s.pack_path.clone(), s.meta.offset))
            .collect::<Vec<_>>();
        mark_segments_consumed("org1", "logs", "stream_a", &consumed_a)
            .await
            .unwrap();
        assert!(pack.path.exists());

        // consume stream_b: pack fully consumed -> file deleted
        let consumed_b = get_stream_segments("org1", "logs", "stream_b")
            .await
            .iter()
            .filter(|s| s.memtable_id == 555)
            .map(|s| (s.pack_path.clone(), s.meta.offset))
            .collect::<Vec<_>>();
        mark_segments_consumed("org1", "logs", "stream_b", &consumed_b)
            .await
            .unwrap();
        assert!(!pack.path.exists());

        // registry entry is gone
        let r = PACK_REGISTRY.read().await;
        assert!(!r.contains_key(&pack.path));
    }

    #[tokio::test]
    async fn test_consumed_sidecar_survives_restart() {
        let dir = tempfile::tempdir().unwrap();
        let finished = write_test_pack(dir.path(), 777).await;
        let pack = &finished[0];
        fs::rename(&pack.tmp_path, &pack.path).await.unwrap();
        register_pack(
            pack.path.clone(),
            &pack.footer,
            config::utils::time::now_micros(),
            &Default::default(),
        )
        .await;

        // consume stream_a only: the sidecar records its offset
        let pack_path = Arc::new(pack.path.clone());
        let seg_a = &pack.footer.segments[0];
        mark_segments_consumed(
            "org1",
            "logs",
            "stream_a",
            &[(pack_path.clone(), seg_a.offset)],
        )
        .await
        .unwrap();
        let consumed = read_consumed_sidecar(&pack.path).await;
        assert!(consumed.contains(&seg_a.offset));
        assert_eq!(consumed.len(), 1);

        // simulate a restart: re-register from footer + sidecar,
        // the consumed segment must not come back as pending
        unregister_pack(&pack.path).await;
        register_pack(
            pack.path.clone(),
            &pack.footer,
            config::utils::time::now_micros(),
            &consumed,
        )
        .await;
        let segs_a = get_stream_segments("org1", "logs", "stream_a").await;
        assert!(!segs_a.iter().any(|s| s.memtable_id == 777));

        // consuming the remaining stream deletes the pack and the sidecar
        let seg_b = &pack.footer.segments[1];
        mark_segments_consumed(
            "org1",
            "logs",
            "stream_b",
            &[(pack_path.clone(), seg_b.offset)],
        )
        .await
        .unwrap();
        assert!(!pack.path.exists());
        assert!(!consumed_sidecar_path(&pack.path).exists());
    }

    #[tokio::test]
    async fn test_garbage_sidecar_offsets_do_not_over_count() {
        // 3-segment pack; sidecar records one real offset and one garbage
        // value (a partially written record) - the pack must NOT be deleted
        // until every real segment is consumed
        let dir = tempfile::tempdir().unwrap();
        let mut writer = PackWriter::new(0, 888, "logs", 1024 * 1024);
        writer.dir = dir.path().to_path_buf();
        for (i, stream) in ["sa", "sb", "sc"].iter().enumerate() {
            writer
                .append_segment(
                    "org1",
                    stream,
                    "2026/07/28/08",
                    b"parquet-bytes-aaaa",
                    &test_file_meta(1, 2, 1, 100 * (i as i64 + 1)),
                )
                .await
                .unwrap();
        }
        let (finished, ..) = writer.finish().await.unwrap();
        let pack = &finished[0];
        fs::rename(&pack.tmp_path, &pack.path).await.unwrap();

        let seg0 = pack.footer.segments[0].offset;
        let consumed = HashSet::from_iter([seg0, 1212345u64]); // garbage entry
        register_pack(
            pack.path.clone(),
            &pack.footer,
            config::utils::time::now_micros(),
            &consumed,
        )
        .await;

        let pack_path = Arc::new(pack.path.clone());
        // consume the second real segment: 2 of 3 real segments consumed,
        // the pack must survive (the garbage entry must not count)
        mark_segments_consumed(
            "org1",
            "logs",
            "sb",
            &[(pack_path.clone(), pack.footer.segments[1].offset)],
        )
        .await
        .unwrap();
        assert!(pack.path.exists());

        // consuming the last real segment deletes the pack
        mark_segments_consumed(
            "org1",
            "logs",
            "sc",
            &[(pack_path.clone(), pack.footer.segments[2].offset)],
        )
        .await
        .unwrap();
        assert!(!pack.path.exists());
    }

    #[tokio::test]
    async fn test_sidecar_trailing_partial_line_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let pack_path = dir.path().join("1.0.pack");
        // "20" is a truncated record (no trailing newline), must be dropped
        fs::write(consumed_sidecar_path(&pack_path), "0\n100\n20")
            .await
            .unwrap();
        let consumed = read_consumed_sidecar(&pack_path).await;
        assert_eq!(consumed, HashSet::from_iter([0u64, 100]));
    }

    #[tokio::test]
    async fn test_reader_guard_defers_pack_deletion() {
        let dir = tempfile::tempdir().unwrap();
        let finished = write_test_pack(dir.path(), 666).await;
        let pack = &finished[0];
        fs::rename(&pack.tmp_path, &pack.path).await.unwrap();
        register_pack(
            pack.path.clone(),
            &pack.footer,
            config::utils::time::now_micros(),
            &Default::default(),
        )
        .await;

        let pack_path = Arc::new(pack.path.clone());
        let acquired = begin_read(std::slice::from_ref(&pack_path)).await;
        assert_eq!(acquired.len(), 1);

        // consume everything while a reader holds the pack
        let all = pack
            .footer
            .segments
            .iter()
            .map(|s| (pack_path.clone(), s.offset))
            .collect::<Vec<_>>();
        mark_segments_consumed("org1", "logs", "stream_a", &all[..1])
            .await
            .unwrap();
        mark_segments_consumed("org1", "logs", "stream_b", &all[1..])
            .await
            .unwrap();
        // deletion deferred: reader still active
        assert!(pack.path.exists());

        // releasing the guard deletes the fully consumed pack
        end_read(&acquired).await;
        assert!(!pack.path.exists());
    }

    #[tokio::test]
    async fn test_cancelled_release_still_frees_reader() {
        let dir = tempfile::tempdir().unwrap();
        let finished = write_test_pack(dir.path(), 999).await;
        let pack = &finished[0];
        fs::rename(&pack.tmp_path, &pack.path).await.unwrap();
        register_pack(
            pack.path.clone(),
            &pack.footer,
            config::utils::time::now_micros(),
            &Default::default(),
        )
        .await;

        let pack_path = Arc::new(pack.path.clone());
        let acquired = begin_read(std::slice::from_ref(&pack_path)).await;
        assert_eq!(acquired.len(), 1);
        let guards = ReadGuards { paths: acquired };

        // cancel release() while it is still waiting for the registry lock
        {
            let _hold = PACK_REGISTRY.write().await;
            let cancelled =
                tokio::time::timeout(std::time::Duration::from_millis(50), guards.release()).await;
            assert!(cancelled.is_err());
        }

        // the Drop-spawned release must still bring the counter back to zero
        let mut readers = usize::MAX;
        for _ in 0..1000 {
            tokio::task::yield_now().await;
            let r = PACK_REGISTRY.read().await;
            readers = r.get(&pack_path).map(|e| e.readers).unwrap_or(usize::MAX);
            if readers == 0 {
                break;
            }
        }
        assert_eq!(readers, 0);
        unregister_pack(&pack.path).await;
    }

    #[tokio::test]
    async fn test_sidecar_append_truncates_partial_line() {
        let dir = tempfile::tempdir().unwrap();
        let pack_path = dir.path().join("truncate_test.pack");
        let sidecar = consumed_sidecar_path(&pack_path);
        // crash remnant: one complete record followed by a partial one; a
        // plain append would concatenate into "100\n25300\n"
        fs::write(&sidecar, b"100\n25").await.unwrap();
        append_consumed_sidecar(&pack_path, &[300]).await.unwrap();
        let data = fs::read_to_string(&sidecar).await.unwrap();
        assert_eq!(data, "100\n300\n");
        let consumed = read_consumed_sidecar(&pack_path).await;
        assert_eq!(consumed.len(), 2);
        assert!(consumed.contains(&100) && consumed.contains(&300));
    }

    #[tokio::test]
    async fn test_register_and_unregister_pack() {
        let dir = tempfile::tempdir().unwrap();
        let finished = write_test_pack(dir.path(), 77).await;
        let pack = &finished[0];
        fs::rename(&pack.tmp_path, &pack.path).await.unwrap();
        register_pack(
            pack.path.clone(),
            &pack.footer,
            config::utils::time::now_micros(),
            &Default::default(),
        )
        .await;

        let r = PACK_SEGMENTS.read().await;
        let segs = r.get("org1/logs/stream_a").expect("registered");
        assert!(segs.segments.iter().any(|s| s.memtable_id == 77));
        drop(r);

        unregister_pack(&pack.path).await;
        let r = PACK_SEGMENTS.read().await;
        assert!(
            r.get("org1/logs/stream_a")
                .map(|v| v.segments.iter().all(|s| s.memtable_id != 77))
                .unwrap_or(true)
        );
    }

    #[tokio::test]
    async fn test_collect_pack_metrics() {
        let dir = tempfile::tempdir().unwrap();
        let finished = write_test_pack(dir.path(), 79).await;
        let pack = &finished[0];
        fs::rename(&pack.tmp_path, &pack.path).await.unwrap();
        register_pack(
            pack.path.clone(),
            &pack.footer,
            config::utils::time::now_micros(),
            &Default::default(),
        )
        .await;

        collect_pack_metrics().await;
        // the totals are global and other tests register their own packs
        // concurrently, so only assert this pack's contribution is included
        assert!(
            metrics::INGEST_PACK_SEGMENTS
                .with_label_values::<&str>(&[])
                .get()
                >= 2
        );
        assert!(
            metrics::INGEST_PACK_FILES
                .with_label_values::<&str>(&[])
                .get()
                >= 1
        );

        unregister_pack(&pack.path).await;
    }
}
