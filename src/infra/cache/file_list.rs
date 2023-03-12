// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use chrono::{Datelike, Duration, TimeZone, Timelike, Utc};
use dashmap::DashMap;

use crate::meta::{common::FileMeta, StreamType};

lazy_static! {
    pub static ref FILES: DashMap<String, Box<FileList>> = DashMap::new();
}

const FILE_LIST_MEM_SIZE: usize = std::mem::size_of::<Box<FileList>>();
const FILE_META_MEM_SIZE: usize = std::mem::size_of::<Option<FileMeta>>();

#[derive(Debug)]
pub struct FileList {
    sub: Option<DashMap<String, Box<FileList>>>,
    files: Option<DashMap<String, FileMeta>>,
    size: usize,
}

pub fn set_file_to_cache(
    key: &str,
    val: Option<FileMeta>,
    delete: bool,
) -> Result<(), anyhow::Error> {
    // eg: files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet
    let columns = key.split('/').collect::<Vec<&str>>();
    if columns.len() < 8 {
        return Err(anyhow::anyhow!(
            "[TRACE] [set_file_to_cache] Invalid file path: {}",
            key
        ));
    }
    let _ = columns[0].to_string();
    let org_id = columns[1].to_string();
    let data_type = columns[2].to_string();
    let stream_name = columns[3].to_string();
    let year = columns[4].to_string();
    let month = columns[5].to_string();
    let day = columns[6].to_string();
    let hour = columns[7].to_string();
    let file_name = columns[8..].join("/");

    let mut org_cache = FILES.entry(org_id).or_insert(Box::new(FileList {
        sub: Some(DashMap::new()),
        files: None,
        size: 0,
    }));
    let cache = org_cache.sub.as_mut().unwrap();
    let mut type_cache = cache.entry(data_type).or_insert(Box::new(FileList {
        sub: Some(DashMap::new()),
        files: None,
        size: 0,
    }));
    let cache = type_cache.sub.as_mut().unwrap();
    let mut stream_cache = cache.entry(stream_name).or_insert(Box::new(FileList {
        sub: Some(DashMap::new()),
        files: None,
        size: 0,
    }));
    let cache = stream_cache.sub.as_mut().unwrap();
    let mut year_cache = cache.entry(year).or_insert(Box::new(FileList {
        sub: Some(DashMap::new()),
        files: None,
        size: 0,
    }));
    let cache = year_cache.sub.as_mut().unwrap();
    let mut month_cache = cache.entry(month).or_insert(Box::new(FileList {
        sub: Some(DashMap::new()),
        files: None,
        size: 0,
    }));
    let cache = month_cache.sub.as_mut().unwrap();
    let mut day_cache = cache.entry(day).or_insert(Box::new(FileList {
        sub: Some(DashMap::new()),
        files: None,
        size: 0,
    }));
    let cache = day_cache.sub.as_mut().unwrap();
    let mut hour_cache = cache.entry(hour).or_insert(Box::new(FileList {
        sub: Some(DashMap::new()),
        files: Some(DashMap::with_capacity(8)),
        size: 0,
    }));
    let cache = hour_cache.files.as_mut().unwrap();
    if delete {
        cache.remove(&file_name);
        hour_cache.size -= key.len() + FILE_META_MEM_SIZE;
    } else {
        cache.insert(file_name, val.unwrap());
        hour_cache.size += key.len() + FILE_META_MEM_SIZE;
    }

    Ok(())
}

pub fn get_file_from_cache(key: &str) -> Result<FileMeta, anyhow::Error> {
    // eg: files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet
    let columns = key.split('/').collect::<Vec<&str>>();
    let _ = columns[0].to_string();
    let org_id = columns[1].to_string();
    let data_type = columns[2].to_string();
    let stream_name = columns[3].to_string();
    let year = columns[4].to_string();
    if year.len() != 4 {
        return Err(anyhow::anyhow!(
            "file_list: year format error, value: {}",
            year
        ));
    }
    let month = columns[5].to_string();
    let day = columns[6].to_string();
    let hour = columns[7].to_string();
    let file_name = columns[8..].join("/");

    let org_cache = match FILES.get(&org_id) {
        Some(v) => v,
        None => return Err(anyhow::anyhow!("file_list: org_id not found, key: {}", key)),
    };
    let cache = org_cache.sub.as_ref().unwrap();
    let type_cache = match cache.get(&data_type) {
        Some(v) => v,
        None => {
            return Err(anyhow::anyhow!(
                "file_list: data_type not found, key: {}",
                key
            ))
        }
    };
    let cache = type_cache.sub.as_ref().unwrap();
    let stream_cache = match cache.get(&stream_name) {
        Some(v) => v,
        None => {
            return Err(anyhow::anyhow!(
                "file_list: stream_name not found, key: {}",
                key
            ))
        }
    };
    let cache = stream_cache.sub.as_ref().unwrap();
    let year_cache = match cache.get(&year) {
        Some(v) => v,
        None => return Err(anyhow::anyhow!("file_list: year not found, key: {}", key)),
    };
    let cache = year_cache.sub.as_ref().unwrap();
    let month_cache = match cache.get(&month) {
        Some(v) => v,
        None => return Err(anyhow::anyhow!("file_list: month not found, key: {}", key)),
    };
    let cache = month_cache.sub.as_ref().unwrap();
    let day_cache = match cache.get(&day) {
        Some(v) => v,
        None => return Err(anyhow::anyhow!("file_list: day not found, key: {}", key)),
    };
    let cache = day_cache.sub.as_ref().unwrap();
    let hour_cache = match cache.get(&hour) {
        Some(v) => v,
        None => return Err(anyhow::anyhow!("file_list: hour not found, key: {}", key)),
    };
    let cache = hour_cache.files.as_ref().unwrap();
    let resp = match cache.get(&file_name) {
        Some(v) => v,
        None => {
            return Err(anyhow::anyhow!(
                "file_list: file_name not found, key: {}",
                key
            ))
        }
    };

    // println!("get_file_meta_from_cache: {}", key);

    Ok(*resp)
}

async fn scan_prefix(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    prefix: &str,
) -> Result<Vec<String>, anyhow::Error> {
    let prefix = if prefix.starts_with("files/") {
        prefix.trim_start_matches("files/").trim_end_matches('/')
    } else {
        prefix.trim_end_matches('/')
    };
    let stream_type = stream_type.to_string();
    let columns = prefix.split('/').collect::<Vec<&str>>();
    let column_num = columns.len();
    let mut year = "";
    let mut month = "";
    let mut day = "";
    let mut hour = "";
    if column_num >= 1 {
        year = columns[0];
    }
    if column_num >= 2 {
        month = columns[1];
    }
    if column_num >= 3 {
        day = columns[2];
    }
    if column_num >= 4 {
        hour = columns[3];
    }

    let mut resp = Vec::new();
    let org_cache = match FILES.get(org_id) {
        Some(v) => v,
        None => return Ok(resp),
    };
    let cache = org_cache.sub.as_ref().unwrap();
    let type_cache = match cache.get(&stream_type) {
        Some(v) => v,
        None => return Ok(resp),
    };
    let cache = type_cache.sub.as_ref().unwrap();
    let stream_cache = match cache.get(stream_name) {
        Some(v) => v,
        None => return Ok(resp),
    };

    if year.is_empty() {
        for cache in stream_cache.sub.as_ref().unwrap().iter() {
            let year = cache.key();
            for cache in cache.sub.as_ref().unwrap().iter() {
                let month = cache.key();
                for cache in cache.sub.as_ref().unwrap().iter() {
                    let day = cache.key();
                    for cache in cache.sub.as_ref().unwrap().iter() {
                        let hour = cache.key();
                        for item in cache.files.as_ref().unwrap().iter() {
                            resp.push(format!(
                                "files/{}/{}/{}/{}/{}/{}/{}/{}",
                                org_id,
                                stream_type,
                                stream_name,
                                year,
                                month,
                                day,
                                hour,
                                item.key()
                            ));
                        }
                    }
                }
            }
        }
        return Ok(resp);
    }

    let cache = stream_cache.sub.as_ref().unwrap();
    let year_cache = match cache.get(year) {
        Some(v) => v,
        None => return Ok(resp),
    };
    if month.is_empty() {
        for cache in year_cache.sub.as_ref().unwrap().iter() {
            let month = cache.key();
            for cache in cache.sub.as_ref().unwrap().iter() {
                let day = cache.key();
                for cache in cache.sub.as_ref().unwrap().iter() {
                    let hour = cache.key();
                    for item in cache.files.as_ref().unwrap().iter() {
                        resp.push(format!(
                            "files/{}/{}/{}/{}/{}/{}/{}/{}",
                            org_id,
                            stream_type,
                            stream_name,
                            year,
                            month,
                            day,
                            hour,
                            item.key()
                        ));
                    }
                }
            }
        }
        return Ok(resp);
    }

    let cache = year_cache.sub.as_ref().unwrap();
    let month_cache = match cache.get(month) {
        Some(v) => v,
        None => return Ok(resp),
    };
    if day.is_empty() {
        for cache in month_cache.sub.as_ref().unwrap().iter() {
            let day = cache.key();
            for cache in cache.sub.as_ref().unwrap().iter() {
                let hour = cache.key();
                for item in cache.files.as_ref().unwrap().iter() {
                    resp.push(format!(
                        "files/{}/{}/{}/{}/{}/{}/{}/{}",
                        org_id,
                        stream_type,
                        stream_name,
                        year,
                        month,
                        day,
                        hour,
                        item.key()
                    ));
                }
            }
        }
        return Ok(resp);
    }

    let cache = month_cache.sub.as_ref().unwrap();
    let day_cache = match cache.get(day) {
        Some(v) => v,
        None => return Ok(resp),
    };
    if hour.is_empty() {
        for cache in day_cache.sub.as_ref().unwrap().iter() {
            let hour = cache.key();
            for item in cache.files.as_ref().unwrap().iter() {
                resp.push(format!(
                    "files/{}/{}/{}/{}/{}/{}/{}/{}",
                    org_id,
                    stream_type,
                    stream_name,
                    year,
                    month,
                    day,
                    hour,
                    item.key()
                ));
            }
        }
        return Ok(resp);
    }

    let cache = day_cache.sub.as_ref().unwrap();
    let hour_cache = match cache.get(hour) {
        Some(v) => v,
        None => return Ok(resp),
    };
    for item in hour_cache.files.as_ref().unwrap().iter() {
        resp.push(format!(
            "files/{}/{}/{}/{}/{}/{}/{}/{}",
            org_id,
            stream_type,
            stream_name,
            year,
            month,
            day,
            hour,
            item.key()
        ));
    }
    Ok(resp)
}

#[tracing::instrument(name = "cache:file_list:get_file_list")]
pub async fn get_file_list(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_min: i64,
    time_max: i64,
) -> Result<Vec<String>, anyhow::Error> {
    let mut files = Vec::new();
    let mut keys = Vec::new();
    if time_min > 0 && time_max > 0 {
        let time_min = Utc.timestamp_nanos(time_min * 1000);
        let time_max = Utc.timestamp_nanos(time_max * 1000);
        if time_min + Duration::hours(48) >= time_max {
            // less than 48 hours, generate keys by hours
            let mut time_min = Utc
                .with_ymd_and_hms(
                    time_min.year(),
                    time_min.month(),
                    time_min.day(),
                    time_min.hour(),
                    0,
                    0,
                )
                .unwrap();
            while time_min <= time_max {
                keys.push(time_min.format("%Y/%m/%d/%H/").to_string());
                time_min += Duration::hours(1);
            }
        } else {
            // more than 48 hours, generate keys by days
            let mut time_min = Utc
                .with_ymd_and_hms(time_min.year(), time_min.month(), time_min.day(), 0, 0, 0)
                .unwrap();
            while time_min <= time_max {
                keys.push(time_min.format("%Y/%m/%d/").to_string());
                time_min += Duration::days(1);
            }
        }
    } else {
        keys.push("".to_string());
    }

    for key in keys {
        let resp = scan_prefix(org_id, stream_name, stream_type, &key)
            .await
            .unwrap();
        files.extend(resp);
    }

    Ok(files)
}

/// Get file list num and total keys length
pub fn get_file_num() -> Result<(usize, usize, usize), anyhow::Error> {
    let mut files_num = 0;
    let mut mem_size = 0;
    let mut file_list_num = 0;
    for cache in FILES.iter() {
        let org_cache = cache.sub.as_ref().unwrap();
        for cache in org_cache.iter() {
            let type_cache = cache.sub.as_ref().unwrap();
            for cache in type_cache.iter() {
                let stream_cache = cache.sub.as_ref().unwrap();
                for cache in stream_cache.iter() {
                    let year_cache = cache.sub.as_ref().unwrap();
                    for cache in year_cache.iter() {
                        let month_cache = cache.sub.as_ref().unwrap();
                        for cache in month_cache.iter() {
                            let day_cache = cache.sub.as_ref().unwrap();
                            for cache in day_cache.iter() {
                                files_num += cache.files.as_ref().unwrap().len();
                                mem_size += cache.size;
                                file_list_num += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    mem_size += file_list_num * FILE_LIST_MEM_SIZE;
    Ok((file_list_num, files_num, mem_size))
}

pub fn get_all_organization() -> Result<Vec<String>, anyhow::Error> {
    let mut orgs = Vec::new();
    for cache in FILES.iter() {
        orgs.push(cache.key().to_string());
    }
    Ok(orgs)
}

pub fn get_all_stream(org_id: &str, stream_type: StreamType) -> Result<Vec<String>, anyhow::Error> {
    let mut streams = Vec::new();
    let org_cache = FILES.get(org_id).unwrap();
    let org_cache = org_cache.sub.as_ref().unwrap();
    let type_cache = match org_cache.get(&stream_type.to_string()) {
        Some(cache) => cache,
        None => return Ok(streams),
    };
    let type_cache = type_cache.sub.as_ref().unwrap();
    for cache in type_cache.iter() {
        streams.push(cache.key().to_string());
    }
    Ok(streams)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_set_file_to_cache() {
        let meta = FileMeta::default();
        let ret = set_file_to_cache(
            "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet",
            Some(meta),
            false,
        );
        assert!(ret.is_ok());

        let ret = set_file_to_cache("files/default/logs/olympics/2022/10/03", Some(meta), false);
        assert!(ret.is_err());
    }

    #[test]
    fn test_get_file_from_cache() {
        let meta = FileMeta {
            min_ts: 100,
            max_ts: 200,
            records: 10000,
            original_size: 1024,
            compressed_size: 1,
        };
        let _ret = set_file_to_cache(
            "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet",
            Some(meta),
            false,
        )
        .unwrap();

        let res = get_file_from_cache(
            "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet",
        );
        assert_eq!(res.unwrap().records, meta.records);

        let res = get_file_from_cache(
            "files/defaultx/logs/olympics/2000/10/03/10/6982652937134804993_1.parquet",
        );
        assert!(res.is_err());

        let res = get_file_from_cache(
            "files/default/logsx/olympics/2000/10/03/10/6982652937134804993_1.parquet",
        );
        assert!(res.is_err());

        let res = get_file_from_cache(
            "files/default/logs/olympicsx/2000/10/03/10/6982652937134804993_1.parquet",
        );
        assert!(res.is_err());

        let res = get_file_from_cache(
            "files/default/logs/olympics/2000/10/03/10/6982652937134804993_1.parquet",
        );
        assert!(res.is_err());

        let res = get_file_from_cache(
            "files/default/logs/olympics/2022/00/03/10/6982652937134804993_1.parquet",
        );
        assert!(res.is_err());

        let res = get_file_from_cache(
            "files/default/logs/olympics/2022/10/00/10/6982652937134804993_1.parquet",
        );
        assert!(res.is_err());

        let res = get_file_from_cache(
            "files/default/logs/olympics/2022/10/03/00/6982652937134804993_1.parquet",
        );
        assert!(res.is_err());

        let res = get_file_from_cache("files/default/logs/olympics/2022/10/03/10/0.parquet");
        assert!(res.is_err());
    }

    #[test]
    fn test_delete_file_from_cache() {
        let meta = FileMeta::default();
        let ret = set_file_to_cache(
            "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet",
            Some(meta),
            false,
        );
        assert!(ret.is_ok());

        let meta = FileMeta::default();
        let ret = set_file_to_cache(
            "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet",
            Some(meta),
            true,
        );
        assert!(ret.is_ok());
    }

    #[actix_web::test]
    async fn test_get_file_list() {
        let ret = get_file_list("default", "olympics", StreamType::Logs, 0, 0).await;
        assert!(ret.is_ok());

        let ret = get_file_list("default", "olympics", StreamType::Logs, 1678613530133899, 0).await;
        assert!(ret.is_ok());

        let ret = scan_prefix("default", "olympics", StreamType::Logs, "").await;
        assert!(ret.is_ok());

        let ret = scan_prefix("default", "olympics", StreamType::Logs, "2022/").await;
        assert!(ret.is_ok());

        let ret = scan_prefix("default", "olympics", StreamType::Logs, "2022/10/").await;
        assert!(ret.is_ok());

        let ret = scan_prefix("default", "olympics", StreamType::Logs, "2022/10/10/").await;
        assert!(ret.is_ok());
    }

    #[actix_web::test]
    async fn test_get_file_num() {
        let ret = get_file_num();
        assert!(ret.is_ok());
    }
}
