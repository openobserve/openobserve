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

use ahash::AHashMap;
use chrono::{Datelike, Duration, TimeZone, Timelike, Utc};
use dashmap::DashMap;
use once_cell::sync::Lazy;

use crate::infra::config::RwHashMap;
use crate::meta::{common::FileMeta, StreamType};

static FILES: Lazy<RwHashMap<String, OrgFilelist>> = Lazy::new(DashMap::default);
static DATA: Lazy<RwHashMap<String, FileMeta>> = Lazy::new(DashMap::default);

const FILE_LIST_MEM_SIZE: usize = std::mem::size_of::<AHashMap<String, Vec<String>>>();
const FILE_META_MEM_SIZE: usize = std::mem::size_of::<FileMeta>();

type OrgFilelist = AHashMap<String, TypeFilelist>;
type TypeFilelist = AHashMap<String, StreamFilelist>;
type StreamFilelist = AHashMap<String, YearFilelist>;
type YearFilelist = AHashMap<String, MonthFilelist>;
type MonthFilelist = AHashMap<String, DayFilelist>;
type DayFilelist = Vec<String>;

type KeyColumns = (String, String, String, String, String, String, String);

pub fn set_file_to_cache(key: &str, val: FileMeta) -> Result<(), anyhow::Error> {
    let (org_id, stream_type, stream_name, year, month, day, _hour) = parse_key_columns(key)?;
    let mut org_filelist = FILES.entry(org_id).or_insert_with(AHashMap::default);
    let type_filelist = org_filelist
        .entry(stream_type)
        .or_insert_with(AHashMap::default);
    let stream_filelist = type_filelist
        .entry(stream_name)
        .or_insert_with(AHashMap::default);
    let year_filelist = stream_filelist
        .entry(year)
        .or_insert_with(AHashMap::default);
    let month_filelist = year_filelist.entry(month).or_insert_with(AHashMap::default);
    let day_filelist = month_filelist.entry(day).or_insert_with(Vec::new);
    day_filelist.push(key.to_string());
    DATA.insert(key.to_string(), val);
    Ok(())
}

pub fn del_file_from_cache(key: &str) -> Result<(), anyhow::Error> {
    DATA.remove(key);
    let (org_id, stream_type, stream_name, year, month, day, _hour) = parse_key_columns(key)?;
    let mut org_filelist = match FILES.get_mut(&org_id) {
        Some(org_filelist) => org_filelist,
        None => return Ok(()),
    };
    let type_filelist = match org_filelist.get_mut(&stream_type) {
        Some(type_filelist) => type_filelist,
        None => return Ok(()),
    };
    let stream_filelist = match type_filelist.get_mut(&stream_name) {
        Some(stream_filelist) => stream_filelist,
        None => return Ok(()),
    };
    let year_filelist = match stream_filelist.get_mut(&year) {
        Some(year_filelist) => year_filelist,
        None => return Ok(()),
    };
    let month_filelist = match year_filelist.get_mut(&month) {
        Some(month_filelist) => month_filelist,
        None => return Ok(()),
    };
    let day_filelist = match month_filelist.get_mut(&day) {
        Some(day_filelist) => day_filelist,
        None => return Ok(()),
    };
    day_filelist.retain(|x| x != key);
    Ok(())
}

pub fn get_file_from_cache(key: &str) -> Result<FileMeta, anyhow::Error> {
    match DATA.get(key) {
        Some(v) => Ok(v.value().to_owned()),
        None => Err(anyhow::anyhow!("file_list: file_name not found: {key}")),
    }
}

fn scan_prefix(
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

    let mut items = Vec::new();
    let org_cache = match FILES.get(org_id) {
        Some(v) => v,
        None => return Ok(items),
    };
    let type_cache = match org_cache.get(&stream_type) {
        Some(v) => v,
        None => return Ok(items),
    };
    let stream_cache = match type_cache.get(stream_name) {
        Some(v) => v,
        None => return Ok(items),
    };

    if year.is_empty() {
        for (_, year_cache) in stream_cache.iter() {
            for (_, month_cache) in year_cache.iter() {
                for (_, day_cache) in month_cache.iter() {
                    items.extend(day_cache.iter().map(|x| x.to_string()));
                }
            }
        }
        return Ok(items);
    }

    let year_cache = match stream_cache.get(year) {
        Some(v) => v,
        None => return Ok(items),
    };
    if month.is_empty() {
        for (_, month_cache) in year_cache.iter() {
            for (_, day_cache) in month_cache.iter() {
                items.extend(day_cache.iter().map(|x| x.to_string()));
            }
        }
        return Ok(items);
    }

    let month_cache = match year_cache.get(month) {
        Some(v) => v,
        None => return Ok(items),
    };
    if day.is_empty() {
        for (_, day_cache) in month_cache.iter() {
            items.extend(day_cache.iter().map(|x| x.to_string()));
        }
        return Ok(items);
    }

    let day_cache = match month_cache.get(day) {
        Some(v) => v,
        None => return Ok(items),
    };

    let prefix = if hour.is_empty() {
        format!("files/{org_id}/{stream_type}/{stream_name}/{year}/{month}/{day}/")
    } else {
        format!("files/{org_id}/{stream_type}/{stream_name}/{year}/{month}/{day}/{hour}/")
    };
    items.extend(
        day_cache
            .iter()
            .filter(|x| x.starts_with(&prefix))
            .map(|x| x.to_string()),
    );
    Ok(items)
}

pub fn get_file_list(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_min: i64,
    time_max: i64,
) -> Result<Vec<String>, anyhow::Error> {
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

    let mut files = Vec::new();
    for key in keys {
        let resp = scan_prefix(org_id, stream_name, stream_type, &key).unwrap();
        files.extend(resp);
    }

    Ok(files)
}

/// Get file list num and total keys length
pub fn get_file_num() -> Result<(usize, usize, usize), anyhow::Error> {
    let files_num = DATA.len();
    let mut mem_size = 0;
    let mut file_list_num = 0;
    for cache in FILES.iter() {
        mem_size += cache.key().len();
        for (key, type_cache) in cache.value().iter() {
            mem_size += key.len();
            for (key, stream_cache) in type_cache.iter() {
                mem_size += key.len();
                for (key, year_cache) in stream_cache.iter() {
                    mem_size += key.len();
                    for (key, month_cache) in year_cache.iter() {
                        mem_size += key.len();
                        for (key, day_cache) in month_cache.iter() {
                            mem_size += key.len();
                            file_list_num += 1;
                            for key in day_cache.iter() {
                                mem_size += key.len() * 2; // one is in FILES, one is in DATA
                            }
                        }
                    }
                }
            }
        }
    }
    mem_size += file_list_num * FILE_LIST_MEM_SIZE;
    mem_size += files_num * FILE_META_MEM_SIZE;
    Ok((file_list_num, files_num, mem_size))
}

pub fn shrink_to_fit() {
    FILES.shrink_to_fit();
    DATA.shrink_to_fit();
}

pub fn get_all_organization() -> Result<Vec<String>, anyhow::Error> {
    let mut orgs = Vec::new();
    for cache in FILES.iter() {
        orgs.push(cache.key().to_string());
    }
    Ok(orgs)
}

pub fn get_all_stream(org_id: &str, stream_type: StreamType) -> Result<Vec<String>, anyhow::Error> {
    let org_cache = FILES.get(org_id).unwrap();
    let type_cache = match org_cache.value().get(&stream_type.to_string()) {
        Some(cache) => cache,
        None => return Ok(vec![]),
    };
    Ok(type_cache.keys().map(|x| x.to_string()).collect())
}

fn parse_key_columns(key: &str) -> Result<KeyColumns, anyhow::Error> {
    // eg: files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet
    let columns = key.split('/').collect::<Vec<&str>>();
    if columns.len() < 9 {
        return Err(anyhow::anyhow!(
            "[set_file_to_cache] Invalid file path: {}",
            key
        ));
    }
    let _ = columns[0].to_string();
    let org_id = columns[1].to_string();
    let stream_type = columns[2].to_string();
    let stream_name = columns[3].to_string();
    let year = columns[4].to_string();
    let month = columns[5].to_string();
    let day = columns[6].to_string();
    let hour = columns[7].to_string();
    Ok((org_id, stream_type, stream_name, year, month, day, hour))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_set_file_to_cache() {
        let meta = FileMeta::default();
        let ret = set_file_to_cache(
            "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet",
            meta,
        );
        assert!(ret.is_ok());

        let ret = set_file_to_cache("files/default/logs/olympics/2022/10/03", meta);
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
            meta,
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
            meta,
        );
        assert!(ret.is_ok());

        let meta = FileMeta::default();
        let ret = set_file_to_cache(
            "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet",
            meta,
        );
        assert!(ret.is_ok());
    }

    #[actix_web::test]
    async fn test_get_file_list() {
        let ret = get_file_list("default", "olympics", StreamType::Logs, 0, 0);
        assert!(ret.is_ok());

        let ret = get_file_list("default", "olympics", StreamType::Logs, 1678613530133899, 0);
        assert!(ret.is_ok());

        let ret = scan_prefix("default", "olympics", StreamType::Logs, "");
        assert!(ret.is_ok());

        let ret = scan_prefix("default", "olympics", StreamType::Logs, "2022/");
        assert!(ret.is_ok());

        let ret = scan_prefix("default", "olympics", StreamType::Logs, "2022/10/");
        assert!(ret.is_ok());

        let ret = scan_prefix("default", "olympics", StreamType::Logs, "2022/10/10/");
        assert!(ret.is_ok());
    }

    #[actix_web::test]
    async fn test_get_file_num() {
        let ret = get_file_num();
        assert!(ret.is_ok());
    }
}
