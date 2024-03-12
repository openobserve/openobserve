// Copyright 2023 Zinc Labs Inc.
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

use config::{
    ider,
    meta::stream::{FileKey, FileMeta},
    utils::json,
};

use crate::{common::meta, service::promql};

pub mod auth;
pub mod request;

pub mod cluster_rpc {
    tonic::include_proto!("cluster");
}

impl From<meta::search::Request> for cluster_rpc::SearchRequest {
    fn from(req: meta::search::Request) -> Self {
        let req_query = cluster_rpc::SearchQuery {
            sql: req.query.sql.clone(),
            sql_mode: req.query.sql_mode.clone(),
            fast_mode: req.query.fast_mode,
            query_type: req.query.query_type.clone(),
            from: req.query.from as i32,
            size: req.query.size as i32,
            start_time: req.query.start_time,
            end_time: req.query.end_time,
            sort_by: req.query.sort_by.unwrap_or_default(),
            track_total_hits: req.query.track_total_hits,
            query_context: req.query.query_context.unwrap_or_default(),
            uses_zo_fn: req.query.uses_zo_fn,
            query_fn: req.query.query_fn.unwrap_or_default(),
        };

        let job = cluster_rpc::Job {
            session_id: ider::uuid(),
            job: "".to_string(),
            stage: 0,
            partition: 0,
        };

        let mut aggs = Vec::new();
        for (name, sql) in req.aggs {
            aggs.push(cluster_rpc::SearchAggRequest { name, sql });
        }

        cluster_rpc::SearchRequest {
            job: Some(job),
            org_id: "".to_string(),
            stype: cluster_rpc::SearchType::User.into(),
            query: Some(req_query),
            aggs,
            file_list: vec![],
            stream_type: "".to_string(),
            timeout: req.timeout,
            work_group: "".to_string(),
        }
    }
}

impl From<&FileMeta> for cluster_rpc::FileMeta {
    fn from(req: &FileMeta) -> Self {
        cluster_rpc::FileMeta {
            min_ts: req.min_ts,
            max_ts: req.max_ts,
            records: req.records,
            original_size: req.original_size,
            compressed_size: req.compressed_size,
        }
    }
}

impl From<&cluster_rpc::FileMeta> for FileMeta {
    fn from(req: &cluster_rpc::FileMeta) -> Self {
        FileMeta {
            min_ts: req.min_ts,
            max_ts: req.max_ts,
            records: req.records,
            original_size: req.original_size,
            compressed_size: req.compressed_size,
        }
    }
}

impl From<&FileKey> for cluster_rpc::FileKey {
    fn from(req: &FileKey) -> Self {
        cluster_rpc::FileKey {
            key: req.key.clone(),
            meta: Some(cluster_rpc::FileMeta::from(&req.meta)),
            deleted: req.deleted,
        }
    }
}

impl From<&cluster_rpc::FileKey> for FileKey {
    fn from(req: &cluster_rpc::FileKey) -> Self {
        FileKey {
            key: req.key.clone(),
            meta: FileMeta::from(req.meta.as_ref().unwrap()),
            deleted: req.deleted,
        }
    }
}

impl From<promql::MetricsQueryRequest> for cluster_rpc::MetricsQueryRequest {
    fn from(req: promql::MetricsQueryRequest) -> Self {
        let req_query = cluster_rpc::MetricsQueryStmt {
            query: req.query.to_owned(),
            start: req.start,
            end: req.end,
            step: req.step,
        };

        let job = cluster_rpc::Job {
            session_id: ider::uuid(),
            job: "".to_string(),
            stage: 0,
            partition: 0,
        };

        cluster_rpc::MetricsQueryRequest {
            job: Some(job),
            org_id: "".to_string(),
            stype: cluster_rpc::SearchType::User.into(),
            need_wal: false,
            query: Some(req_query),
            timeout: 0,
        }
    }
}

impl From<&cluster_rpc::Label> for promql::value::Label {
    fn from(req: &cluster_rpc::Label) -> Self {
        promql::value::Label {
            name: req.name.to_owned(),
            value: req.value.to_owned(),
        }
    }
}

impl From<&promql::value::Label> for cluster_rpc::Label {
    fn from(req: &promql::value::Label) -> Self {
        cluster_rpc::Label {
            name: req.name.to_owned(),
            value: req.value.to_owned(),
        }
    }
}

impl From<&cluster_rpc::Sample> for promql::value::Sample {
    fn from(req: &cluster_rpc::Sample) -> Self {
        promql::value::Sample::new(req.time, req.value)
    }
}

impl From<&promql::value::Sample> for cluster_rpc::Sample {
    fn from(req: &promql::value::Sample) -> Self {
        cluster_rpc::Sample {
            time: req.timestamp,
            value: req.value,
        }
    }
}

impl From<&meta::stream::ScanStats> for cluster_rpc::ScanStats {
    fn from(req: &meta::stream::ScanStats) -> Self {
        cluster_rpc::ScanStats {
            files: req.files,
            records: req.records,
            original_size: req.original_size,
            compressed_size: req.compressed_size,
        }
    }
}

impl From<&cluster_rpc::ScanStats> for meta::stream::ScanStats {
    fn from(req: &cluster_rpc::ScanStats) -> Self {
        meta::stream::ScanStats {
            files: req.files,
            records: req.records,
            original_size: req.original_size,
            compressed_size: req.compressed_size,
        }
    }
}

impl From<Vec<json::Value>> for cluster_rpc::UsageData {
    fn from(usages: Vec<json::Value>) -> Self {
        Self {
            data: json::to_vec(&usages).unwrap(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[tokio::test]
    async fn test_get_file_meta() {
        let file_meta = FileMeta {
            min_ts: 1667978841110,
            max_ts: 1667978845354,
            records: 300,
            original_size: 10,
            compressed_size: 1,
        };

        let rpc_meta = cluster_rpc::FileMeta::from(&file_meta);
        let resp = FileMeta::from(&rpc_meta);
        assert_eq!(file_meta, resp);
    }

    #[tokio::test]
    async fn test_search_convert() {
        let mut req = meta::search::Request {
            query: meta::search::Query {
                sql: "SELECT * FROM test".to_string(),
                sql_mode: "default".to_string(),
                fast_mode: false,
                query_type: "".to_string(),
                from: 0,
                size: 100,
                start_time: 0,
                end_time: 0,
                sort_by: None,
                track_total_hits: false,
                query_context: None,
                uses_zo_fn: false,
                query_fn: None,
            },
            aggs: HashMap::new(),
            encoding: "base64".into(),
            timeout: 0,
        };
        req.aggs
            .insert("test".to_string(), "SELECT * FROM test".to_string());

        let rpc_req = cluster_rpc::SearchRequest::from(req.clone());

        assert_eq!(rpc_req.query.as_ref().unwrap().sql, req.query.sql);
        assert_eq!(rpc_req.query.as_ref().unwrap().size, req.query.size as i32);
    }
}
