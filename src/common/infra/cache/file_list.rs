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

use crate::common::infra::config::RwHashMap;
use crate::common::meta::{common::FileMeta, stream::PartitionTimeLevel, StreamType};
use crate::service::{db, stream};

static FILES: Lazy<RwHashMap<String, RwHashMap<String, Vec<String>>>> = Lazy::new(DashMap::default);
static DATA: Lazy<RwHashMap<String, FileMeta>> = Lazy::new(DashMap::default);

const FILE_LIST_MEM_SIZE: usize = std::mem::size_of::<AHashMap<String, Vec<String>>>();
const FILE_META_MEM_SIZE: usize = std::mem::size_of::<FileMeta>();

pub fn set_file_to_cache(key: &str, val: FileMeta) -> Result<(), anyhow::Error> {
    let (stream_key, date_key, file_name) = parse_file_key_columns(key)?;
    let stream_filelist = FILES.entry(stream_key).or_insert_with(DashMap::default);
    let mut date_filelist = stream_filelist.entry(date_key).or_insert_with(Vec::new);
    date_filelist.push(file_name);
    DATA.insert(key.to_string(), val);
    Ok(())
}

pub fn del_file_from_cache(key: &str) -> Result<(), anyhow::Error> {
    DATA.remove(key);
    let (stream_key, date_key, file_name) = parse_file_key_columns(key)?;
    let stream_filelist = match FILES.get_mut(&stream_key) {
        Some(v) => v,
        None => return Ok(()),
    };
    let mut date_filelist = match stream_filelist.get_mut(&date_key) {
        Some(v) => v,
        None => return Ok(()),
    };
    date_filelist.retain(|f| file_name.ne(f));
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
    let stream_key = format!("{}/{}/{}", org_id, stream_type, stream_name);
    let stream_cache = match FILES.get(&stream_key) {
        Some(v) => v,
        None => return Ok(items),
    };

    let prefix_key = if year.is_empty() {
        "".to_string()
    } else if month.is_empty() {
        format!("{year}/")
    } else if day.is_empty() {
        format!("{year}/{month}/")
    } else if hour.is_empty() {
        format!("{year}/{month}/{day}/")
    } else {
        format!("{year}/{month}/{day}/{hour}")
    };
    for date_cache in stream_cache.iter() {
        let date_key = date_cache.key();
        if !prefix_key.is_empty() && !date_cache.key().starts_with(&prefix_key) {
            continue;
        }
        items.extend(
            date_cache
                .iter()
                .map(|f| format!("files/{stream_key}/{date_key}/{f}")),
        );
    }
    Ok(items)
}

pub async fn get_file_list(
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
            // Handle partiton time level
            let schema = db::schema::get(org_id, stream_name, stream_type).await?;
            let stream_settings = stream::stream_settings(&schema).unwrap_or_default();
            let partition_time_level = stream::unwrap_partition_time_level(
                stream_settings.partition_time_level,
                stream_type,
            );
            if partition_time_level == PartitionTimeLevel::Daily {
                keys.push(time_min.format("%Y/%m/%d/00/").to_string());
            }
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
    for stream_cache in FILES.iter() {
        mem_size += stream_cache.key().len();
        for date_cache in stream_cache.iter() {
            mem_size += date_cache.key().len();
            file_list_num += 1;
            for key in date_cache.iter() {
                mem_size += key.len() * 2; // one is in FILES, one is in DATA
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
    let mut orgs = ahash::AHashSet::new();
    for stream_cache in FILES.iter() {
        let stream_key = stream_cache.key();
        let org_id = stream_key.split('/').next().unwrap();
        orgs.insert(org_id.to_string());
    }
    Ok(orgs.into_iter().collect())
}

pub fn get_all_stream(org_id: &str, stream_type: StreamType) -> Result<Vec<String>, anyhow::Error> {
    let mut streams = Vec::new();
    for stream_cache in FILES.iter() {
        let stream_key = stream_cache.key();
        let columns = stream_key.split('/').collect::<Vec<&str>>();
        if columns.len() >= 3 && columns[0] == org_id && columns[1] == stream_type.to_string() {
            streams.push(columns[2].to_string());
        }
    }
    streams.sort();
    Ok(streams)
}

/// parse file key to get stream_key, date_key, file_name
pub fn parse_file_key_columns(key: &str) -> Result<(String, String, String), anyhow::Error> {
    // eg: files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet
    let columns = key.splitn(9, '/').collect::<Vec<&str>>();
    if columns.len() < 9 {
        return Err(anyhow::anyhow!("[file_list] Invalid file path: {}", key));
    }
    let _ = columns[0].to_string();
    let org_id = columns[1].to_string();
    let stream_type = columns[2].to_string();
    let stream_name = columns[3].to_string();
    let year = columns[4].to_string();
    let month = columns[5].to_string();
    let day = columns[6].to_string();
    let hour = columns[7].to_string();
    let file_name = columns[8].to_string();
    let stream_key = format!("{org_id}/{stream_type}/{stream_name}");
    let date_key = format!("{year}/{month}/{day}/{hour}");
    Ok((stream_key, date_key, file_name))
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
        let file = "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet";
        let ret = set_file_to_cache(file, meta);
        assert!(ret.is_ok());

        let res = get_file_from_cache(file);
        assert!(res.is_ok());

        let ret = del_file_from_cache(file);
        assert!(ret.is_ok());

        let res = get_file_from_cache(file);
        assert!(res.is_err());
    }

    #[actix_web::test]
    async fn test_get_file_list() {
        let ret = get_file_list("default", "olympics", StreamType::Logs, 0, 0).await;
        assert!(ret.is_ok());

        let ret = get_file_list("default", "olympics", StreamType::Logs, 1678613530133899, 0).await;
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
