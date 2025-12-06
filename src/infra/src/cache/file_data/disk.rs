// Copyright 2025 OpenObserve Inc.
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

use std::{
    cmp::{max, min},
    fmt,
    ops::Range,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
    time::SystemTime,
};

use async_recursion::async_recursion;
use bytes::Bytes;
use config::{
    RwAHashMap, get_config, metrics, spawn_pausable_job,
    utils::{
        file::*,
        hash::{Sum64, gxhash},
        time::{get_ymdh_from_micros, now_micros},
    },
};
use hashbrown::HashMap;
use object_store::{GetOptions, GetResult, GetResultPayload, ObjectMeta};
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

use super::CacheStrategy;
use crate::{cache::meta::ResultCacheMeta, storage};

// parquet cache
static FILES: Lazy<Vec<RwLock<FileData>>> = Lazy::new(|| {
    let cfg = get_config();
    let mut files = Vec::with_capacity(cfg.disk_cache.bucket_num);
    for _ in 0..cfg.disk_cache.bucket_num {
        files.push(RwLock::new(FileData::new(FileType::Data)));
    }
    files
});

// read only parquet cache
static FILES_READER: Lazy<Vec<FileData>> = Lazy::new(|| {
    let cfg = get_config();
    let mut files = Vec::with_capacity(cfg.disk_cache.bucket_num);
    for _ in 0..cfg.disk_cache.bucket_num {
        files.push(FileData::new(FileType::Data));
    }
    files
});

static RESULT_FILES: Lazy<Vec<RwLock<FileData>>> = Lazy::new(|| {
    let cfg = get_config();
    let mut files = Vec::with_capacity(cfg.disk_cache.bucket_num);
    for _ in 0..cfg.disk_cache.bucket_num {
        files.push(RwLock::new(FileData::new(FileType::Result)));
    }
    files
});

// read only
static RESULT_FILES_READER: Lazy<Vec<FileData>> = Lazy::new(|| {
    let cfg = get_config();
    let mut files = Vec::with_capacity(cfg.disk_cache.bucket_num);
    for _ in 0..cfg.disk_cache.bucket_num {
        files.push(FileData::new(FileType::Result));
    }
    files
});

// aggregation cache
static AGGREGATION_FILES: Lazy<Vec<RwLock<FileData>>> = Lazy::new(|| {
    let cfg = get_config();
    let mut files = Vec::with_capacity(cfg.disk_cache.bucket_num);
    for _ in 0..cfg.disk_cache.bucket_num {
        files.push(RwLock::new(FileData::new(FileType::Aggregation)));
    }
    files
});

// read only aggregation cache
static AGGREGATION_FILES_READER: Lazy<Vec<FileData>> = Lazy::new(|| {
    let cfg = get_config();
    let mut files = Vec::with_capacity(cfg.disk_cache.bucket_num);
    for _ in 0..cfg.disk_cache.bucket_num {
        files.push(FileData::new(FileType::Aggregation));
    }
    files
});

pub static QUERY_RESULT_CACHE: Lazy<RwAHashMap<String, Vec<ResultCacheMeta>>> =
    Lazy::new(Default::default);

pub static METRICS_RESULT_CACHE: Lazy<RwLock<Vec<String>>> = Lazy::new(|| RwLock::new(Vec::new()));

pub static LOADING_FROM_DISK_NUM: Lazy<AtomicUsize> = Lazy::new(|| AtomicUsize::new(0));
pub static LOADING_FROM_DISK_DONE: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));

pub struct FileData {
    max_size: usize,
    cur_size: usize,
    root_dir: String,
    multi_dir: Vec<String>,
    file_type: FileType,
    data: CacheStrategy,
}

#[derive(Debug)]
pub enum FileType {
    Data,
    Result,
    Aggregation,
}

impl fmt::Display for FileType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FileType::Data => write!(f, "data"),
            FileType::Result => write!(f, "result"),
            FileType::Aggregation => write!(f, "aggregation"),
        }
    }
}

impl Default for FileData {
    fn default() -> Self {
        Self::new(FileType::Data)
    }
}

impl FileData {
    fn new(file_type: FileType) -> FileData {
        let cfg = get_config();
        let size = match file_type {
            FileType::Data => cfg.disk_cache.max_size,
            FileType::Result => cfg.disk_cache.result_max_size,
            FileType::Aggregation => cfg.disk_cache.aggregation_max_size,
        };
        FileData::with_capacity_and_cache_strategy(file_type, size, &cfg.disk_cache.cache_strategy)
    }

    fn with_capacity_and_cache_strategy(
        file_type: FileType,
        max_size: usize,
        strategy: &str,
    ) -> FileData {
        let cfg = get_config();

        FileData {
            max_size,
            cur_size: 0,
            root_dir: format!(
                "{}{}",
                cfg.common.data_cache_dir,
                storage::format_key("", true),
            ),
            multi_dir: cfg
                .disk_cache
                .multi_dir
                .split(',')
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().to_string())
                .collect(),
            file_type,
            data: CacheStrategy::new(strategy),
        }
    }

    async fn exist(&self, file: &str) -> bool {
        self.data.contains_key(file)
    }

    fn get_file_path(&self, file: &str) -> String {
        format!("{}{}{}", self.root_dir, self.choose_multi_dir(file), file)
    }

    async fn get(&self, file: &str, range: Option<Range<u64>>) -> Option<Bytes> {
        let file_path = self.get_file_path(file);
        tokio::task::spawn_blocking(move || match get_file_contents(&file_path, range) {
            Ok(data) => Some(Bytes::from(data)),
            Err(_) => None,
        })
        .await
        .ok()
        .flatten()
    }

    async fn get_size(&self, file: &str) -> Option<usize> {
        let file_path = self.get_file_path(file);
        match get_file_size(&file_path) {
            Ok(v) => Some(v as usize),
            Err(_) => None,
        }
    }

    async fn set(
        &mut self,
        file: &str,
        tmp_file: &str,
        data_size: usize,
    ) -> Result<(), anyhow::Error> {
        if self.cur_size + data_size >= self.max_size {
            log::info!(
                "[CacheType:{}] File disk cache is full, can't cache extra {data_size} bytes",
                self.file_type,
            );
            // cache is full, need release some space
            let need_release_size = min(
                self.max_size,
                max(get_config().disk_cache.release_size, data_size * 100),
            );
            self.gc(need_release_size).await?;
        }

        // rename tmp file to real file
        let file_ops_start = std::time::Instant::now();
        let file_path = self.get_file_path(file);
        tokio::fs::create_dir_all(Path::new(&file_path).parent().unwrap()).await?;
        tokio::fs::rename(tmp_file, &file_path).await.map_err(|e| {
            anyhow::anyhow!(
                "[CacheType:{}] File disk cache rename tmp file {tmp_file} to real file {file_path} error: {e}",
                self.file_type,
            )
        })?;
        let file_ops_took = file_ops_start.elapsed().as_millis() as usize;
        if file_ops_took > 100 {
            log::info!(
                "[CacheType:{}] File disk cache rename file {file_path} took: {file_ops_took} ms",
                self.file_type,
            );
        }

        // set size
        self.set_size(file, data_size).await
    }

    async fn set_size(&mut self, file: &str, data_size: usize) -> Result<(), anyhow::Error> {
        // update size
        self.cur_size += data_size;
        self.data.insert(file.to_string(), data_size);
        // update metrics
        let columns = file.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::QUERY_DISK_CACHE_FILES
                .with_label_values(&[columns[1], columns[2]])
                .inc();
            metrics::QUERY_DISK_CACHE_USED_BYTES
                .with_label_values(&[columns[1], columns[2]])
                .add(data_size as i64);
        } else if columns[0] == "results" {
            metrics::QUERY_DISK_RESULT_CACHE_USED_BYTES
                .with_label_values(&[columns[1], columns[2], "results"])
                .add(data_size as i64);
        } else if columns[0] == "metrics_results" {
            metrics::QUERY_DISK_METRICS_CACHE_USED_BYTES
                .with_label_values(&[columns[1]])
                .add(data_size as i64);
        } else if columns[0] == "aggregations" && columns.len() >= 3 {
            metrics::QUERY_DISK_RESULT_CACHE_USED_BYTES
                .with_label_values(&[columns[1], columns[2], "aggregations"])
                .add(data_size as i64);
        };
        Ok(())
    }

    async fn gc(&mut self, need_release_size: usize) -> Result<(), anyhow::Error> {
        let start = std::time::Instant::now();
        log::info!(
            "[CacheType:{}] File disk cache start gc {}/{}, need to release {} bytes",
            self.file_type,
            self.cur_size,
            self.max_size,
            need_release_size
        );
        let mut release_size = 0;
        let mut remove_result_files = vec![];
        loop {
            let item = self.data.remove();
            if item.is_none() {
                log::warn!(
                    "[CacheType:{}] File disk cache is corrupt, it shouldn't be none",
                    self.file_type,
                );
                break;
            }
            let (key, data_size) = item.unwrap();
            // delete file from local disk
            let file_path = self.get_file_path(key.as_str());
            log::debug!(
                "[CacheType:{}] File disk cache gc remove file: {}",
                self.file_type,
                key
            );
            if let Err(e) = tokio::fs::remove_file(&file_path).await {
                log::error!(
                    "[CacheType:{}] File disk cache gc remove file: {}, error: {}",
                    self.file_type,
                    file_path,
                    e
                );
            }

            if key.starts_with("results/") {
                let columns = key.split('/').collect::<Vec<&str>>();
                let query_key = format!(
                    "{}_{}_{}_{}",
                    columns[1], columns[2], columns[3], columns[4]
                );
                remove_result_files.push(query_key);
            }
            // metrics
            let columns = key.split('/').collect::<Vec<&str>>();
            if columns[0] == "files" {
                metrics::QUERY_DISK_CACHE_FILES
                    .with_label_values(&[columns[1], columns[2]])
                    .dec();
                metrics::QUERY_DISK_CACHE_USED_BYTES
                    .with_label_values(&[columns[1], columns[2]])
                    .sub(data_size as i64);
            } else if columns[0] == "results" {
                metrics::QUERY_DISK_RESULT_CACHE_USED_BYTES
                    .with_label_values(&[columns[1], columns[2], "results"])
                    .sub(data_size as i64);
            } else if columns[0] == "metrics_results" {
                metrics::QUERY_DISK_METRICS_CACHE_USED_BYTES
                    .with_label_values(&[columns[1]])
                    .sub(data_size as i64);
            } else if columns[0] == "aggregations" && columns.len() >= 3 {
                metrics::QUERY_DISK_RESULT_CACHE_USED_BYTES
                    .with_label_values(&[columns[1], columns[2], "aggregations"])
                    .sub(data_size as i64);
            }

            release_size += data_size;
            if release_size >= need_release_size {
                break;
            }
        }
        self.cur_size -= release_size;

        if !remove_result_files.is_empty() {
            let mut r = QUERY_RESULT_CACHE.write().await;
            for query_key in remove_result_files {
                r.remove(&query_key);
            }
            drop(r);
        }
        log::info!(
            "[CacheType:{}] File disk cache gc done, released {release_size} bytes, took: {} ms",
            self.file_type,
            start.elapsed().as_millis()
        );

        Ok(())
    }

    async fn remove(&mut self, file: &str) -> Result<(), anyhow::Error> {
        log::debug!(
            "[CacheType:{}] File disk cache remove file {file}",
            self.file_type,
        );

        let Some((key, data_size)) = self.data.remove_key(file) else {
            return Ok(());
        };
        self.cur_size -= data_size;

        // delete file from local disk
        let file_path = self.get_file_path(key.as_str());
        if let Err(e) = tokio::fs::remove_file(&file_path).await {
            log::error!(
                "[CacheType:{}] File disk cache remove file: {file_path}, error: {e}",
                self.file_type,
            );
        }

        // metrics
        let columns = key.split('/').collect::<Vec<&str>>();
        if columns[0] == "files" {
            metrics::QUERY_DISK_CACHE_FILES
                .with_label_values(&[columns[1], columns[2]])
                .dec();
            metrics::QUERY_DISK_CACHE_USED_BYTES
                .with_label_values(&[columns[1], columns[2]])
                .sub(data_size as i64);
        } else if columns[0] == "results" {
            metrics::QUERY_DISK_RESULT_CACHE_USED_BYTES
                .with_label_values(&[columns[1], columns[2], "results"])
                .sub(data_size as i64);
        } else if columns[0] == "metrics_results" {
            metrics::QUERY_DISK_METRICS_CACHE_USED_BYTES
                .with_label_values(&[columns[1]])
                .sub(data_size as i64);
        } else if columns[0] == "aggregations" && columns.len() >= 3 {
            metrics::QUERY_DISK_RESULT_CACHE_USED_BYTES
                .with_label_values(&[columns[1], columns[2], "aggregations"])
                .sub(data_size as i64);
        }

        Ok(())
    }

    fn choose_multi_dir(&self, file: &str) -> String {
        if self.multi_dir.is_empty() {
            return "".to_string();
        }

        let h = gxhash::new().sum64(file);
        let index = h % (self.multi_dir.len() as u64);
        format!("{}/", self.multi_dir.get(index as usize).unwrap())
    }

    fn size(&self) -> (usize, usize) {
        (self.max_size, self.cur_size)
    }

    fn len(&self) -> usize {
        self.data.len()
    }

    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

pub async fn init() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    // clean the tmp dir
    if let Err(e) = std::fs::remove_dir_all(&cfg.common.data_tmp_dir) {
        log::warn!("clean tmp dir error: {}", e);
    }
    std::fs::create_dir_all(&cfg.common.data_tmp_dir).expect("create tmp dir success");

    for file in FILES.iter() {
        let root_dir = file.read().await.root_dir.clone();
        std::fs::create_dir_all(&root_dir).expect("create cache dir success");
    }
    // trigger read only files
    for file in FILES_READER.iter() {
        std::fs::create_dir_all(&file.root_dir).expect("create cache dir success");
    }
    // trigger read only aggregation files
    for file in AGGREGATION_FILES_READER.iter() {
        std::fs::create_dir_all(&file.root_dir).expect("create cache dir success");
    }

    tokio::task::spawn(async move {
        log::info!("Loading disk cache start");
        let root_dir = FILES[0].read().await.root_dir.clone();
        let root_dir = tokio::fs::canonicalize(&root_dir).await.unwrap();
        if let Err(e) = load(&root_dir, &root_dir).await {
            log::error!("load disk cache error: {e}");
        }
        log::info!(
            "Loading disk cache done, total files: {}",
            LOADING_FROM_DISK_NUM.load(Ordering::Relaxed)
        );
        LOADING_FROM_DISK_DONE.store(true, Ordering::SeqCst);
    });

    spawn_pausable_job!("disk_cache_gc", get_config().disk_cache.gc_interval, {
        if let Err(e) = gc().await {
            log::error!("disk cache gc error: {e}");
        }
    });
    Ok(())
}

#[inline]
fn get_file_reader(file: &str) -> Option<&FileData> {
    if !get_config().disk_cache.enabled {
        return None;
    }
    let idx = get_bucket_idx(file);
    let files = if file.starts_with("files") {
        FILES_READER.get(idx).unwrap()
    } else if file.starts_with("results") {
        RESULT_FILES_READER.get(idx).unwrap()
    } else if file.starts_with("aggregations") {
        AGGREGATION_FILES_READER.get(idx).unwrap()
    } else {
        RESULT_FILES_READER.get(idx).unwrap()
    };
    Some(files)
}

pub async fn get_opts(file: &str, options: GetOptions) -> object_store::Result<GetResult> {
    let Some(files) = get_file_reader(file) else {
        return Err(object_store::Error::NotFound {
            path: file.to_string(),
            source: Box::new(std::io::Error::other("file not found")),
        });
    };
    let path = PathBuf::from(files.get_file_path(file));
    let (metadata, fp) = std::fs::File::open(&path)
        .and_then(|f| Ok((f.metadata()?, f)))
        .map_err(|e| object_store::Error::NotFound {
            path: file.to_string(),
            source: Box::new(e),
        })?;

    let last_modified = last_modified(&metadata);
    let meta = ObjectMeta {
        location: file.into(),
        last_modified,
        size: metadata.len(),
        e_tag: Some(get_etag(&metadata)),
        version: None,
    };
    options.check_preconditions(&meta)?;

    let range = match options.range {
        Some(r) => r.as_range(meta.size).unwrap(),
        None => 0..meta.size,
    };

    Ok(GetResult {
        payload: GetResultPayload::File(fp, path),
        attributes: Default::default(),
        range,
        meta,
    })
}

#[inline]
pub async fn get(file: &str, range: Option<Range<u64>>) -> Option<Bytes> {
    let files = get_file_reader(file)?;
    files.get(file, range).await
}

#[inline]
pub async fn get_size(file: &str) -> Option<usize> {
    let files = get_file_reader(file)?;
    files.get_size(file).await
}

#[inline]
pub fn get_file_path(file: &str) -> Option<String> {
    let files = get_file_reader(file)?;
    Some(files.get_file_path(file))
}

#[inline]
pub async fn exist(file: &str) -> bool {
    if !get_config().disk_cache.enabled {
        return false;
    }
    let start = std::time::Instant::now();
    let idx = get_bucket_idx(file);
    let files = if file.starts_with("files") {
        FILES[idx].read().await
    } else if file.starts_with("results") {
        RESULT_FILES[idx].read().await
    } else if file.starts_with("aggregations") {
        AGGREGATION_FILES[idx].read().await
    } else {
        RESULT_FILES[idx].read().await
    };
    let get_lock_took = start.elapsed().as_millis() as usize;
    if get_lock_took > 100 {
        log::info!("disk->cache: check file {file} exist get lock took: {get_lock_took} ms");
    }
    // file not exist, we can fast return
    if !files.exist(file).await {
        return false;
    }
    drop(files);

    let exist_took = start.elapsed().as_millis() as usize;
    if exist_took > 100 {
        log::info!("disk->cache: check file {file} exist took: {exist_took} ms");
    }

    // check if the file is really exist
    if get_size(file).await.is_some() {
        return true;
    }

    // file is not exist, need remove it from cache index
    _ = remove(file).await;
    let remove_took = start.elapsed().as_millis() as usize;
    if remove_took > 100 {
        log::info!("disk->cache: check file {file} exist remove took: {remove_took} ms");
    }

    // finally return false
    false
}

#[inline]
pub async fn set(file: &str, data: Bytes) -> Result<(), anyhow::Error> {
    if !get_config().disk_cache.enabled {
        return Ok(());
    }

    // write to tmp file
    let data_size = data.len();
    let (file, tmp_file) = write_tmp_file(file, data).await?;

    // hash the file name and get the bucket index
    let start = std::time::Instant::now();
    let idx = get_bucket_idx(&file);

    // get all the files from the bucket
    let mut files = if file.starts_with("files") {
        FILES[idx].write().await
    } else if file.starts_with("results") {
        RESULT_FILES[idx].write().await
    } else if file.starts_with("aggregations") {
        AGGREGATION_FILES[idx].write().await
    } else {
        RESULT_FILES[idx].write().await
    };

    let get_lock_took = start.elapsed().as_millis() as usize;
    if get_lock_took > 100 {
        log::info!("disk->cache: set file {file} get lock took: {get_lock_took} ms");
    }

    if files.exist(&file).await {
        // remove the tmp file
        if let Err(e) = tokio::fs::remove_file(&tmp_file).await {
            log::warn!(
                "[CacheType:{}] File disk cache remove tmp file {} error: {}",
                files.file_type,
                tmp_file,
                e
            );
        }
        return Ok(());
    }
    let ret = files.set(&file, &tmp_file, data_size).await;

    let set_took = start.elapsed().as_millis() as usize;
    if set_took > 100 {
        log::info!("disk->cache: set file {file} took: {set_took} ms");
    }

    ret
}

#[inline]
pub async fn set_size(file: &str, data_size: usize) -> Result<(), anyhow::Error> {
    if !get_config().disk_cache.enabled {
        return Ok(());
    }

    // hash the file name and get the bucket index
    let idx = get_bucket_idx(file);

    // get all the files from the bucket
    let mut files = if file.starts_with("files") {
        FILES[idx].write().await
    } else if file.starts_with("results") {
        RESULT_FILES[idx].write().await
    } else if file.starts_with("aggregations") {
        AGGREGATION_FILES[idx].write().await
    } else {
        RESULT_FILES[idx].write().await
    };
    if files.exist(file).await {
        return Ok(());
    }
    files.set_size(file, data_size).await
}

#[inline]
pub async fn remove(file: &str) -> Result<(), anyhow::Error> {
    if !get_config().disk_cache.enabled {
        return Ok(());
    }
    let idx = get_bucket_idx(file);
    let mut files = if file.starts_with("files") {
        FILES[idx].write().await
    } else if file.starts_with("results") {
        RESULT_FILES[idx].write().await
    } else if file.starts_with("aggregations") {
        AGGREGATION_FILES[idx].write().await
    } else {
        RESULT_FILES[idx].write().await
    };
    files.remove(file).await
}

#[async_recursion]
async fn load(root_dir: &PathBuf, scan_dir: &PathBuf) -> Result<(), anyhow::Error> {
    let mut entries = tokio::fs::read_dir(&scan_dir).await?;
    let mut result_cache: HashMap<String, Vec<ResultCacheMeta>> = HashMap::new();
    let mut metrics_cache: Vec<String> = Vec::new();
    loop {
        match entries.next_entry().await {
            Err(e) => return Err(e.into()),
            Ok(None) => break,
            Ok(Some(f)) => {
                let fp = match tokio::fs::canonicalize(f.path()).await {
                    Ok(p) => p,
                    Err(e) => {
                        log::error!("canonicalize file path error: {e}");
                        continue;
                    }
                };
                let ft = match f.file_type().await {
                    Ok(t) => t,
                    Err(e) => {
                        log::error!("get file type error: {e}");
                        continue;
                    }
                };
                if ft.is_dir() {
                    if let Err(e) = load(root_dir, &fp).await {
                        log::error!("load disk cache error: {e}");
                    }
                } else {
                    // check file is tmp file
                    if fp.extension().is_some_and(|ext| ext == "tmp")
                        || fp.to_str().unwrap().ends_with("_tmp.arrow")
                    {
                        log::debug!(
                            "Removing temporary file during cache load: {}",
                            fp.display()
                        );
                        if let Err(e) = tokio::fs::remove_file(&fp).await {
                            log::warn!("Failed to remove tmp file: {}, error: {}", fp.display(), e);
                        }
                        continue;
                    }
                    let meta = match get_file_meta(&fp) {
                        Ok(m) => m,
                        Err(e) => {
                            log::error!("get file meta error: {e}");
                            continue;
                        }
                    };
                    let data_size = meta.len() as usize;
                    let mut file_key = fp
                        .strip_prefix(root_dir)
                        .unwrap()
                        .to_str()
                        .unwrap()
                        .replace('\\', "/");

                    if !get_config().disk_cache.multi_dir.is_empty() {
                        file_key = file_key.split('/').skip(1).collect::<Vec<_>>().join("/");
                    }
                    // check file already exists
                    if exist(&file_key).await {
                        continue;
                    }
                    // write into cache
                    let idx = get_bucket_idx(&file_key);
                    let total = LOADING_FROM_DISK_NUM.fetch_add(1, Ordering::Relaxed);
                    // print progress
                    if total.is_multiple_of(1000) {
                        log::info!("Loading disk cache {total}");
                    }
                    if file_key.starts_with("files") {
                        let mut w = FILES[idx].write().await;
                        w.cur_size += data_size;
                        w.data.insert(file_key.clone(), data_size);
                        drop(w);
                        // metrics
                        let columns = file_key.split('/').collect::<Vec<&str>>();

                        metrics::QUERY_DISK_CACHE_FILES
                            .with_label_values(&[columns[1], columns[2]])
                            .inc();
                        metrics::QUERY_DISK_CACHE_USED_BYTES
                            .with_label_values(&[columns[1], columns[2]])
                            .add(data_size as i64);
                    } else if file_key.starts_with("results") {
                        let Some((org_id, stream_type, query_key, meta)) =
                            parse_result_cache_key(&file_key)
                        else {
                            log::error!("parse result cache key error: {file_key}");
                            continue;
                        };

                        let mut w = RESULT_FILES[idx].write().await;
                        w.cur_size += data_size;
                        w.data.insert(file_key.clone(), data_size);
                        drop(w);

                        // metrics
                        metrics::QUERY_DISK_RESULT_CACHE_USED_BYTES
                            .with_label_values(&[org_id.as_str(), stream_type.as_str(), "results"])
                            .add(data_size as i64);

                        result_cache
                            .entry(query_key)
                            .or_insert_with(Vec::new)
                            .push(meta);
                    } else if file_key.starts_with("metrics_results") {
                        // metrics
                        let columns = file_key.split('/').collect::<Vec<&str>>();
                        metrics::QUERY_DISK_METRICS_CACHE_USED_BYTES
                            .with_label_values(&[columns[1]])
                            .add(data_size as i64);

                        metrics_cache.push(file_key);
                    } else if file_key.starts_with("aggregations") {
                        let Some((org_id, stream_type, ..)) =
                            parse_aggregation_cache_key(&file_key)
                        else {
                            log::error!("parse aggregation cache key error: {file_key}");
                            continue;
                        };
                        let mut w = AGGREGATION_FILES[idx].write().await;
                        w.cur_size += data_size;
                        w.data.insert(file_key.clone(), data_size);
                        drop(w);

                        // metrics
                        metrics::QUERY_DISK_RESULT_CACHE_USED_BYTES
                            .with_label_values(&[
                                org_id.as_str(),
                                stream_type.as_str(),
                                "aggregations",
                            ])
                            .add(data_size as i64);

                        // metrics for aggregations
                        let columns = file_key.split('/').collect::<Vec<&str>>();
                        if columns.len() >= 3 {
                            metrics::QUERY_DISK_CACHE_USED_BYTES
                                .with_label_values(&[columns[1], columns[2]])
                                .add(data_size as i64);
                        }
                    }
                }
            }
        }
    }

    // write all data from result_cache to QUERY_RESULT_CACHE
    QUERY_RESULT_CACHE.write().await.extend(result_cache);
    // write all data from metrics_cache to QUERY_METRICS_CACHE
    METRICS_RESULT_CACHE.write().await.extend(metrics_cache);
    Ok(())
}

async fn gc() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    if !cfg.disk_cache.enabled {
        return Ok(());
    }

    for file in FILES.iter() {
        let r = file.read().await;
        if r.cur_size + cfg.disk_cache.release_size < r.max_size {
            continue;
        }
        drop(r);
        let mut w = file.write().await;
        w.gc(cfg.disk_cache.gc_size).await?;
        drop(w);
    }
    let scale_factor = std::cmp::max(1, cfg.disk_cache.max_size / cfg.disk_cache.result_max_size);
    let release_size = std::cmp::max(
        10 * config::SIZE_IN_MB as usize,
        cfg.disk_cache.release_size / scale_factor,
    );
    for file in RESULT_FILES.iter() {
        let r = file.read().await;
        if r.cur_size + release_size < r.max_size {
            drop(r);
            continue;
        }
        drop(r);
        let mut w = file.write().await;
        w.gc(cfg.disk_cache.gc_size).await?;
        drop(w);
    }
    let scale_factor = std::cmp::max(
        1,
        cfg.disk_cache.max_size / cfg.disk_cache.aggregation_max_size,
    );
    let release_size = std::cmp::max(
        10 * config::SIZE_IN_MB as usize,
        cfg.disk_cache.release_size / scale_factor,
    );
    for file in AGGREGATION_FILES.iter() {
        let r = file.read().await;
        if r.cur_size + release_size < r.max_size {
            drop(r);
            continue;
        }
        drop(r);
        let mut w = file.write().await;
        w.gc(cfg.disk_cache.gc_size).await?;
        drop(w);
    }
    Ok(())
}

#[inline]
pub async fn stats(file_type: FileType) -> (usize, usize) {
    let mut total_size = 0;
    let mut used_size = 0;
    let files = match file_type {
        FileType::Data => &FILES,
        FileType::Result => &RESULT_FILES,
        FileType::Aggregation => &AGGREGATION_FILES,
    };

    for file in files.iter() {
        let r = file.read().await;
        let (max_size, cur_size) = r.size();
        total_size += max_size;
        used_size += cur_size;
    }
    (total_size, used_size)
}

#[inline]
pub async fn len(file_type: FileType) -> usize {
    let mut total = 0;
    let files = match file_type {
        FileType::Data => &FILES,
        FileType::Result => &RESULT_FILES,
        FileType::Aggregation => &AGGREGATION_FILES,
    };
    for file in files.iter() {
        let r = file.read().await;
        total += r.len();
    }
    total
}

#[inline]
pub async fn is_empty(file_type: FileType) -> bool {
    let files = match file_type {
        FileType::Data => &FILES,
        FileType::Result => &RESULT_FILES,
        FileType::Aggregation => &AGGREGATION_FILES,
    };

    for file in files.iter() {
        let r = file.read().await;
        if !r.is_empty() {
            return false;
        }
    }
    true
}
#[inline]
pub async fn get_dir() -> String {
    FILES[0].read().await.root_dir.clone()
}

pub async fn download(
    account: &str,
    file: &str,
    size: Option<usize>,
) -> Result<usize, anyhow::Error> {
    let (data_len, data_bytes) = super::download_from_storage(account, file, size).await?;
    if let Err(e) = set(file, data_bytes).await {
        return Err(anyhow::anyhow!(
            "set file {} to disk cache failed: {}",
            file,
            e
        ));
    };
    Ok(data_len)
}

fn get_bucket_idx(file: &str) -> usize {
    let cfg = get_config();
    if cfg.disk_cache.bucket_num <= 1 {
        0
    } else {
        let h = gxhash::new().sum64(file);
        (h as usize) % cfg.disk_cache.bucket_num
    }
}

// parse the result cache key from the file name
// returns (org_id, stream_type, query_key, ResultCacheMeta)
// results/default/logs/default/16042959487540176184_30_zo_sql_key/
// 1744081170000000_1744081170000000_1_0.json
pub fn parse_result_cache_key(file: &str) -> Option<(String, String, String, ResultCacheMeta)> {
    let columns = file.split('/').collect::<Vec<&str>>();
    if columns.len() < 6 {
        return None;
    }
    let org_id = columns[1].to_string();
    let stream_type = columns[2].to_string();
    let query_key = format!(
        "{}_{}_{}_{}",
        columns[1], columns[2], columns[3], columns[4]
    );

    let meta = columns[5].split('_').collect::<Vec<&str>>();
    let is_aggregate = meta[2] == "1";
    let is_descending = meta[3] == "1";
    let meta = ResultCacheMeta {
        start_time: meta[0].parse().unwrap(),
        end_time: meta[1].parse().unwrap(),
        is_aggregate,
        is_descending,
    };

    Some((org_id, stream_type, query_key, meta))
}

// parse the aggregation cache key from the file name
// returns (org_id, stream_type, query_key, ResultCacheMeta)
// aggregations/default/logs/default/16042959487540176184/1744081170000000_1744081170000000.arrow
pub fn parse_aggregation_cache_key(
    file: &str,
) -> Option<(String, String, String, ResultCacheMeta)> {
    let columns = file.split('/').collect::<Vec<&str>>();
    if columns.len() < 6 {
        return None;
    }
    let org_id = columns[1].to_string();
    let stream_type = columns[2].to_string();
    let query_key = format!(
        "{}_{}_{}_{}",
        columns[1], columns[2], columns[3], columns[4]
    );

    // Remove file extension before parsing
    let filename = columns[5];
    let filename_without_ext = if let Some(dot_pos) = filename.rfind('.') {
        &filename[..dot_pos]
    } else {
        filename
    };

    let meta = filename_without_ext.split('_').collect::<Vec<&str>>();
    if meta.len() < 2 {
        return None;
    }

    let meta = ResultCacheMeta {
        start_time: meta[0].parse().unwrap(),
        end_time: meta[1].parse().unwrap(),
        is_aggregate: true,
        // NOTE: aggregate record batches don't honor order by
        is_descending: false,
    };
    Some((org_id, stream_type, query_key, meta))
}

fn last_modified(metadata: &std::fs::Metadata) -> chrono::DateTime<chrono::Utc> {
    metadata
        .modified()
        .expect("Modified file time should be supported on this platform")
        .into()
}

fn get_etag(metadata: &std::fs::Metadata) -> String {
    let size = metadata.len();
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|mtime| mtime.duration_since(SystemTime::UNIX_EPOCH).ok())
        .unwrap_or_default()
        .as_micros();
    format!("{mtime:x}-{size:x}")
}

// Write data to a temporary random file and return the file path
async fn write_tmp_file(file: &str, data: Bytes) -> Result<(String, String), anyhow::Error> {
    let tmp_path = format!(
        "{}/{}",
        get_config().common.data_tmp_dir,
        get_ymdh_from_micros(now_micros())
    );
    if let Err(e) = std::fs::create_dir_all(&tmp_path) {
        return Err(anyhow::anyhow!(
            "[FileData::Disk] create tmp dir {}, failed: {}",
            tmp_path,
            e
        ));
    }
    let tmp_path = tokio::fs::canonicalize(&tmp_path).await.unwrap();
    let tmp_file = tmp_path.join(format!("{}.tmp", config::ider::generate()));
    let tmp_file = tmp_file.to_str().unwrap();
    if let Err(e) = config::utils::async_file::put_file_contents(tmp_file, &data).await {
        return Err(anyhow::anyhow!(
            "[FileData::Disk] write tmp file {}, failed: {}",
            tmp_file,
            e
        ));
    }
    Ok((file.to_string(), tmp_file.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_disk_lru_cache_set_file() {
        let mut file_data = FileData::with_capacity_and_cache_strategy(FileType::Data, 1024, "lru");
        let content = Bytes::from("Some text Need to store in cache");
        let data_size = content.len();
        for i in 0..50 {
            let file_key = format!(
                "files/default/logs/disk/2022/10/03/10/6982652937134804993_1_{}.parquet",
                i
            );
            let (_file_key, tmp_file) = write_tmp_file(&file_key, content.clone()).await.unwrap();
            let resp = file_data.set(&file_key, &tmp_file, data_size).await;
            assert!(resp.is_ok());
        }
    }

    #[tokio::test]
    async fn test_disk_lru_cache_get_file() {
        let mut file_data = FileData::with_capacity_and_cache_strategy(
            FileType::Data,
            get_config().disk_cache.max_size,
            "lru",
        );
        let file_key = "files/default/logs/disk/2022/10/03/10/6982652937134804993_2_1.parquet";
        let content = Bytes::from("Some text");
        let data_size = content.len();
        let (file_key, tmp_file) = write_tmp_file(&file_key, content.clone()).await.unwrap();

        file_data
            .set(&file_key, &tmp_file, data_size)
            .await
            .unwrap();
        assert!(file_data.exist(&file_key).await);

        let (file_key, tmp_file) = write_tmp_file(&file_key, content.clone()).await.unwrap();
        file_data
            .set(&file_key, &tmp_file, data_size)
            .await
            .unwrap();
        assert!(file_data.exist(&file_key).await);
        assert!(file_data.size().0 > 0);
    }

    #[tokio::test]
    async fn test_disk_lru_cache_miss() {
        let mut file_data = FileData::with_capacity_and_cache_strategy(FileType::Data, 10, "lru");
        let file_key1 = "files/default/logs/disk/2022/10/03/10/6982652937134804993_3_1.parquet";
        let file_key2 = "files/default/logs/disk/2022/10/03/10/6982652937134804993_3_2.parquet";
        let content = Bytes::from("Some text");
        let data_size = content.len();
        let (file_key1, tmp_file) = write_tmp_file(&file_key1, content.clone()).await.unwrap();
        // set one key
        file_data
            .set(&file_key1, &tmp_file, data_size)
            .await
            .unwrap();
        assert!(file_data.exist(&file_key1).await);
        // set another key, will release first key
        let (file_key2, tmp_file) = write_tmp_file(&file_key2, content.clone()).await.unwrap();
        file_data
            .set(&file_key2, &tmp_file, data_size)
            .await
            .unwrap();
        assert!(file_data.exist(&file_key2).await);
        // get first key, should get error
        assert!(!file_data.exist(&file_key1).await);
    }

    #[tokio::test]
    async fn test_disk_fifo_cache_set_file() {
        let mut file_data =
            FileData::with_capacity_and_cache_strategy(FileType::Data, 1024, "fifo");
        let content = Bytes::from("Some text Need to store in cache");
        let data_size = content.len();
        for i in 0..50 {
            let file_key = format!(
                "files/default/logs/disk/2022/10/03/10/6982652937134804993_4_{}.parquet",
                i
            );
            let (_file_key, tmp_file) = write_tmp_file(&file_key, content.clone()).await.unwrap();
            let resp = file_data.set(&file_key, &tmp_file, data_size).await;
            if let Some(e) = resp.as_ref().err() {
                println!("set file_key: {} error: {:?}", file_key, e);
            }
            assert!(resp.is_ok());
        }
    }

    #[tokio::test]
    async fn test_disk_fifo_cache_get_file() {
        let mut file_data = FileData::with_capacity_and_cache_strategy(
            FileType::Data,
            get_config().disk_cache.max_size,
            "fifo",
        );
        let file_key = "files/default/logs/disk/2022/10/03/10/6982652937134804993_5_1.parquet";
        let content = Bytes::from("Some text");
        let data_size = content.len();
        let (file_key, tmp_file) = write_tmp_file(&file_key, content.clone()).await.unwrap();

        file_data
            .set(&file_key, &tmp_file, data_size)
            .await
            .unwrap();
        assert!(file_data.exist(&file_key).await);

        let (file_key, tmp_file) = write_tmp_file(&file_key, content.clone()).await.unwrap();
        file_data
            .set(&file_key, &tmp_file, data_size)
            .await
            .unwrap();
        assert!(file_data.exist(&file_key).await);
        assert!(file_data.size().0 > 0);
    }

    #[tokio::test]
    async fn test_disk_fifo_cache_miss() {
        let mut file_data = FileData::with_capacity_and_cache_strategy(FileType::Data, 10, "fifo");
        let file_key1 = "files/default/logs/disk/2022/10/03/10/6982652937134804993_6_1.parquet";
        let file_key2 = "files/default/logs/disk/2022/10/03/10/6982652937134804993_6_2.parquet";
        let content = Bytes::from("Some text");
        let data_size = content.len();
        let (file_key1, tmp_file) = write_tmp_file(&file_key1, content.clone()).await.unwrap();
        // set one key
        file_data
            .set(&file_key1, &tmp_file, data_size)
            .await
            .unwrap();
        assert!(file_data.exist(&file_key1).await);
        // set another key, will release first key
        let (file_key2, tmp_file) = write_tmp_file(&file_key2, content.clone()).await.unwrap();
        file_data
            .set(&file_key2, &tmp_file, data_size)
            .await
            .unwrap();
        assert!(file_data.exist(&file_key2).await);
        // get first key, should get error
        assert!(!file_data.exist(&file_key1).await);
    }

    #[tokio::test]
    async fn test_disk_multi_dir() {
        let multi_dir: Vec<String> = "dir1 , dir2 , dir3"
            .split(',')
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .collect();

        let mut file_data = FileData::with_capacity_and_cache_strategy(
            FileType::Data,
            get_config().disk_cache.max_size,
            "lru",
        );
        file_data.multi_dir = multi_dir;
        let file_key = "files/default/logs/disk/2022/10/03/10/6982652937134804993_7_1.parquet";
        let content = Bytes::from("Some text");
        let data_size = content.len();
        let (file_key, tmp_file) = write_tmp_file(&file_key, content.clone()).await.unwrap();

        file_data
            .set(&file_key, &tmp_file, data_size)
            .await
            .unwrap();
        assert!(file_data.exist(&file_key).await);

        let (file_key, tmp_file) = write_tmp_file(&file_key, content.clone()).await.unwrap();
        file_data
            .set(&file_key, &tmp_file, data_size)
            .await
            .unwrap();
        assert!(file_data.exist(&file_key).await);
        assert!(file_data.size().0 > 0);

        assert_eq!(file_data.get(&file_key, None).await, Some(content))
    }

    #[tokio::test]
    async fn test_disk_parse_result_cache_key() {
        let file_key = "results/default/logs/default/16042959487540176184_30_zo_sql_key/1744081170000000_1744081170000000_1_0.json";
        let Some((org_id, stream_type, query_key, meta)) = parse_result_cache_key(file_key) else {
            panic!("parse result cache key error");
        };
        assert_eq!(org_id, "default");
        assert_eq!(stream_type, "logs");
        assert_eq!(
            query_key,
            "default_logs_default_16042959487540176184_30_zo_sql_key"
        );
        assert_eq!(meta.start_time, 1744081170000000);
        assert_eq!(meta.end_time, 1744081170000000);
        assert!(meta.is_aggregate);
        assert!(!meta.is_descending);
    }

    #[tokio::test]
    async fn test_parse_aggregation_cache_key() {
        let file_key = "aggregations/default/logs/default/16042959487540176184/1744081170000000_1744081170000000.arrow";
        let Some((org_id, stream_type, query_key, meta)) = parse_aggregation_cache_key(file_key)
        else {
            panic!("parse aggregation cache key error");
        };
        assert_eq!(org_id, "default");
        assert_eq!(stream_type, "logs");
        assert_eq!(query_key, "default_logs_default_16042959487540176184");
        assert_eq!(meta.start_time, 1744081170000000);
        assert_eq!(meta.end_time, 1744081170000000);
    }

    #[tokio::test]
    async fn test_disk_write_tmp_file() {
        let file_key = "files/default/logs/disk/2022/10/03/10/test_file.parquet";
        let test_data = Bytes::from("test content for temporary file");

        // Test successful write
        let result = write_tmp_file(file_key, test_data.clone()).await;
        assert!(result.is_ok());

        let (returned_file_key, tmp_file_path) = result.unwrap();
        assert_eq!(returned_file_key, file_key);

        // Verify the temporary file exists and contains the correct data
        let tmp_path = Path::new(&tmp_file_path);
        assert!(tmp_path.exists());
        assert!(tmp_path.is_file());

        // Read back the file content to verify it matches
        let file_content = std::fs::read(tmp_path).unwrap();
        assert_eq!(file_content, test_data);

        // Clean up
        let _ = std::fs::remove_file(tmp_path);
    }

    #[tokio::test]
    async fn test_disk_write_tmp_file_with_empty_data() {
        let file_key = "files/default/logs/disk/2022/10/03/10/empty_file.parquet";
        let empty_data = Bytes::new();

        let result = write_tmp_file(file_key, empty_data).await;
        assert!(result.is_ok());

        let (returned_file_key, tmp_file_path) = result.unwrap();
        assert_eq!(returned_file_key, file_key);

        // Verify the temporary file exists but is empty
        let tmp_path = Path::new(&tmp_file_path);
        assert!(tmp_path.exists());
        assert_eq!(tmp_path.metadata().unwrap().len(), 0);

        // Clean up
        let _ = std::fs::remove_file(tmp_path);
    }

    #[tokio::test]
    async fn test_disk_write_tmp_file_with_large_data() {
        let file_key = "files/default/logs/disk/2022/10/03/10/large_file.parquet";
        let large_data = Bytes::from(vec![b'a'; 1024 * 1024]); // 1MB of data

        let result = write_tmp_file(file_key, large_data.clone()).await;
        assert!(result.is_ok());

        let (returned_file_key, tmp_file_path) = result.unwrap();
        assert_eq!(returned_file_key, file_key);

        // Verify the temporary file exists and has correct size
        let tmp_path = Path::new(&tmp_file_path);
        assert!(tmp_path.exists());
        assert_eq!(tmp_path.metadata().unwrap().len(), 1024 * 1024);

        // Read back the file content to verify it matches
        let file_content = std::fs::read(tmp_path).unwrap();
        assert_eq!(file_content, large_data);

        // Clean up
        let _ = std::fs::remove_file(tmp_path);
    }
}
