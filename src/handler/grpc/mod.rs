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

use uuid::Uuid;

use crate::meta;

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
            query_type: req.query.query_type.clone(),
            from: req.query.from as i32,
            size: req.query.size as i32,
            start_time: req.query.start_time,
            end_time: req.query.end_time,
            track_total_hits: req.query.track_total_hits,
            query_context: req.query.query_context.unwrap_or("".to_string()),
        };

        let job = cluster_rpc::Job {
            session_id: Uuid::new_v4().to_string(),
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
        }
    }
}

impl From<&meta::common::FileMeta> for cluster_rpc::FileMeta {
    fn from(req: &meta::common::FileMeta) -> Self {
        cluster_rpc::FileMeta {
            min_ts: req.min_ts,
            max_ts: req.max_ts,
            records: req.records,
            original_size: req.original_size,
            compressed_size: req.compressed_size,
        }
    }
}

impl From<&cluster_rpc::FileMeta> for meta::common::FileMeta {
    fn from(req: &cluster_rpc::FileMeta) -> Self {
        meta::common::FileMeta {
            min_ts: req.min_ts,
            max_ts: req.max_ts,
            records: req.records,
            original_size: req.original_size,
            compressed_size: req.compressed_size,
        }
    }
}

impl From<&meta::common::FileKey> for cluster_rpc::FileKey {
    fn from(req: &meta::common::FileKey) -> Self {
        cluster_rpc::FileKey {
            key: req.key.clone(),
            meta: Some(cluster_rpc::FileMeta::from(&req.meta)),
            deleted: req.deleted,
        }
    }
}

#[cfg(test)]
mod test {
    use std::collections::HashMap;

    use super::*;

    #[actix_web::test]
    async fn test_get_file_meta() {
        let file_meta = meta::common::FileMeta {
            min_ts: 1667978841110,
            max_ts: 1667978845354,
            records: 300,
            original_size: 10,
            compressed_size: 1,
        };

        let rpc_meta = cluster_rpc::FileMeta::from(&file_meta);
        let resp = meta::common::FileMeta::from(&rpc_meta);
        assert_eq!(file_meta, resp);
    }

    #[actix_web::test]
    async fn test_search_convert() {
        let mut req = meta::search::Request {
            query: meta::search::Query {
                sql: "SELECT * FROM test".to_string(),
                sql_mode: "default".to_string(),
                query_type: "logs".to_string(),
                from: 0,
                size: 100,
                start_time: 0,
                end_time: 0,
                track_total_hits: false,
                query_context: None,
            },
            aggs: HashMap::new(),
            encoding: "base64".into(),
        };
        req.aggs
            .insert("test".to_string(), "SELECT * FROM test".to_string());

        let rpc_req = cluster_rpc::SearchRequest::from(req.clone());

        assert_eq!(rpc_req.query.as_ref().unwrap().sql, req.query.sql);
        assert_eq!(rpc_req.query.as_ref().unwrap().size, req.query.size as i32);
    }
}
