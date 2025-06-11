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
    collections::HashSet,
    sync::Arc,
    time::{Duration, UNIX_EPOCH},
};

use async_trait::async_trait;
use config::{
    meta::{
        search::ScanStats,
        stream::{FileKey, PartitionTimeLevel, StreamType},
    },
    utils::time::{now_micros, second_micros},
};
use datafusion::{arrow::datatypes::Schema, error::DataFusionError, prelude::SessionContext};
use infra::errors::Result;
use promql_parser::{label::Matchers, parser};
use proto::cluster_rpc;
use rayon::slice::ParallelSliceMut;

use super::Value;
use crate::service::{
    promql::{DEFAULT_LOOKBACK, PromqlContext, TableProvider, name_visitor, value},
    search,
};

mod storage;
mod wal;

struct StorageProvider {
    trace_id: String,
    need_wal: bool,
}

#[async_trait]
impl TableProvider for StorageProvider {
    async fn create_context(
        &self,
        org_id: &str,
        stream_name: &str,
        time_range: (i64, i64),
        matchers: Matchers,
        label_selector: Option<HashSet<String>>,
        filters: &mut [(String, Vec<String>)],
    ) -> datafusion::error::Result<Vec<(SessionContext, Arc<Schema>, ScanStats)>> {
        let mut resp = Vec::new();
        // register storage table
        let trace_id = self.trace_id.to_owned() + "-storage-" + stream_name;
        let ctx = storage::create_context(
            &trace_id,
            org_id,
            stream_name,
            time_range,
            matchers.clone(),
            filters,
        )
        .await?;
        if let Some(ctx) = ctx {
            resp.push(ctx);
        }

        // register Wal table
        if self.need_wal {
            let trace_id = self.trace_id.to_owned() + "-wal-" + stream_name;
            let wal_ctx_list = wal::create_context(
                &trace_id,
                org_id,
                stream_name,
                time_range,
                matchers,
                label_selector,
            )
            .await?;
            for ctx in wal_ctx_list {
                resp.push(ctx);
            }
        }
        Ok(resp)
    }
}

#[tracing::instrument(name = "promql:search:grpc:search", skip_all, fields(org_id = req.org_id))]
pub async fn search(
    req: &cluster_rpc::MetricsQueryRequest,
) -> Result<cluster_rpc::MetricsQueryResponse> {
    let cfg = config::get_config();
    let start_time = std::time::Instant::now();
    let query = req.query.as_ref().unwrap();

    let start = query.start;
    let end = query.end;
    let step = query.step;
    let trace_id = req.job.as_ref().unwrap().trace_id.to_string();
    let org_id = &req.org_id;

    let mut results = Vec::new();
    if start == end {
        results.push(search_inner(req).await?);
    } else {
        // 1. get max records stream
        let start_time = std::time::Instant::now();
        let file_list = match get_max_file_list(&trace_id, org_id, &query.query, start, end).await {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[trace_id {trace_id}] promql->search->grpc: get max records stream error: {e}"
                );
                return Err(e);
            }
        };
        log::info!(
            "[trace_id {trace_id}] promql->search->grpc: get max records stream, took: {} ms",
            start_time.elapsed().as_millis()
        );

        // 2. generate search group with max records stream
        let start_time = std::time::Instant::now();
        let memory_limit = cfg.memory_cache.datafusion_max_size; // bytes
        let group = match generate_search_group(memory_limit, file_list, start, end, step).await {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[trace_id {trace_id}] promql->search->grpc: generate search group error: {e}"
                );
                return Err(e);
            }
        };
        if group.len() > 1 {
            log::info!(
                "[trace_id {trace_id}] promql->search->grpc: get groups {:?}",
                group
            );
        }
        log::info!(
            "[trace_id {trace_id}] promql->search->grpc: generate search group, took: {} ms",
            start_time.elapsed().as_millis()
        );

        // 3. search each group
        for (start, end) in group {
            let mut req = req.clone();
            req.need_wal =
                end >= now_micros() - second_micros(cfg.limit.max_file_retention_time as i64 * 3);
            req.query.as_mut().unwrap().start = start;
            req.query.as_mut().unwrap().end = end;
            let resp = search_inner(&req).await?;
            log::info!(
                "[trace_id {trace_id}] promql->search->grpc: group[{start}, {end}] get resp, took: {} ms",
                start_time.elapsed().as_millis()
            );
            results.push(resp);
        }
    }

    let mut resp = cluster_rpc::MetricsQueryResponse {
        job: req.job.clone(),
        took: start_time.elapsed().as_millis() as i32,
        result_type: results[0].1.clone(),
        ..Default::default()
    };

    let mut scan_stats = ScanStats::default();
    for (value, _, stats) in results {
        add_value(&mut resp, value);
        scan_stats.add(&stats);
    }
    resp.scan_stats = Some(cluster_rpc::ScanStats::from(&scan_stats));

    Ok(resp)
}

#[tracing::instrument(name = "promql:search:grpc:search_inner", skip_all, fields(org_id = req.org_id))]
pub async fn search_inner(
    req: &cluster_rpc::MetricsQueryRequest,
) -> Result<(Value, String, ScanStats)> {
    let trace_id = req.job.as_ref().unwrap().trace_id.to_string();

    let org_id = &req.org_id;
    let query = req.query.as_ref().unwrap();
    let prom_expr = parser::parse(&query.query).map_err(DataFusionError::Execution)?;

    let eval_stmt = parser::EvalStmt {
        expr: prom_expr,
        start: UNIX_EPOCH
            .checked_add(Duration::from_micros(query.start as _))
            .unwrap(),
        end: UNIX_EPOCH
            .checked_add(Duration::from_micros(query.end as _))
            .unwrap(),
        interval: Duration::from_micros(query.step as _),
        lookback_delta: DEFAULT_LOOKBACK,
    };

    let timeout = if req.timeout > 0 {
        req.timeout as u64
    } else {
        config::get_config().limit.query_timeout
    };

    let mut ctx = PromqlContext::new(
        org_id,
        StorageProvider {
            trace_id: trace_id.to_string(),
            need_wal: req.need_wal,
        },
        query.query_exemplars,
        timeout,
    );

    let (value, result_type, mut scan_stats) = if query.query_exemplars {
        ctx.query_exemplars(&trace_id, eval_stmt).await?
    } else {
        ctx.exec(&trace_id, eval_stmt).await?
    };
    let result_type = match result_type {
        Some(v) => v,
        None => value.get_type().to_string(),
    };

    // clear session
    search::datafusion::storage::file_list::clear(&trace_id);

    scan_stats.format_to_mb();
    Ok((value, result_type, scan_stats))
}

async fn get_max_file_list(
    trace_id: &str,
    org_id: &str,
    query: &str,
    start: i64,
    end: i64,
) -> Result<Vec<FileKey>> {
    // 1. get metrics name
    let ast = parser::parse(query).map_err(DataFusionError::Execution)?;
    let mut visitor = name_visitor::MetricNameVisitor::default();
    promql_parser::util::walk_expr(&mut visitor, &ast).unwrap();
    let metrics_name = visitor.name;

    // 2. get max records stream
    let mut file_list = Vec::new();
    let mut max_records = 0;
    for stream_name in metrics_name {
        let stream_file_list = crate::service::file_list::query(
            trace_id,
            org_id,
            &stream_name,
            StreamType::Metrics,
            PartitionTimeLevel::default(),
            start,
            end,
        )
        .await?;
        let stream_records = stream_file_list.iter().map(|f| f.meta.records).sum::<i64>();
        if stream_records > max_records {
            max_records = stream_records;
            file_list = stream_file_list;
        }
    }
    file_list.par_sort_unstable_by(|a, b| a.meta.max_ts.cmp(&b.meta.max_ts));
    Ok(file_list)
}

/// generate search group
async fn generate_search_group(
    memory_limit: usize,
    file_list: Vec<FileKey>,
    start: i64,
    end: i64,
    step: i64,
) -> Result<Vec<(i64, i64)>> {
    if start >= end {
        return Ok(vec![]);
    }

    // generate search group by records
    // each point = 24byte (timestamp: 8byte, value: 8byte, hash: 8byte)
    // 1GB = 1024 * 1024 * 1024 / 24 = 42,949,672 points
    // one record is one point, so we can use records to predict memory
    let point_size = 24; // bytes
    let mut groups = Vec::new();
    let mut group_memory_predicted = 0;
    let mut group_start = start;
    let mut group_max_ts = start;
    for file in file_list {
        let records = file.meta.records as usize;
        let memory_predicted = records * point_size;
        if group_memory_predicted > 0 && group_memory_predicted + memory_predicted > memory_limit {
            if file.meta.max_ts > group_max_ts {
                group_max_ts = file.meta.max_ts;
            }
            // align group_end to step
            let group_end = group_max_ts - group_max_ts % step;
            if group_end <= group_start {
                continue;
            }
            // if group_end is greater than end - step * 5, we can merge the last group
            if group_end >= end - step * 5 {
                groups.push((group_start, end));
                group_start = end;
                break;
            }
            groups.push((group_start, group_end));
            group_start = group_end + step;
            group_max_ts = group_start;
            group_memory_predicted = 0;
        }
        if file.meta.max_ts > group_max_ts {
            group_max_ts = file.meta.max_ts;
        }
        group_memory_predicted += memory_predicted;
    }
    if group_start < end {
        groups.push((group_start, end));
    }
    Ok(groups)
}

pub(crate) fn add_value(resp: &mut cluster_rpc::MetricsQueryResponse, value: Value) {
    match value {
        value::Value::None => {}
        value::Value::Instant(v) => {
            resp.series.push(cluster_rpc::Series {
                metric: v.labels.iter().map(|x| x.as_ref().into()).collect(),
                sample: Some((&v.sample).into()),
                ..Default::default()
            });
        }
        value::Value::Range(v) => {
            resp.series.push(cluster_rpc::Series {
                metric: v.labels.iter().map(|x| x.as_ref().into()).collect(),
                samples: v.samples.iter().map(|x| x.into()).collect(),
                ..Default::default()
            });
        }
        value::Value::Vector(v) => {
            v.iter().for_each(|v| {
                resp.series.push(cluster_rpc::Series {
                    metric: v.labels.iter().map(|x| x.as_ref().into()).collect(),
                    sample: Some((&v.sample).into()),
                    ..Default::default()
                });
            });
        }
        value::Value::Matrix(v) => {
            v.iter().for_each(|v| {
                let samples = v
                    .samples
                    .iter()
                    .filter_map(|x| if x.is_nan() { None } else { Some(x.into()) })
                    .collect::<Vec<_>>();
                let exemplars = v.exemplars.as_ref().map(|v| {
                    let exemplars = v.iter().map(|x| x.as_ref().into()).collect::<Vec<_>>();
                    cluster_rpc::Exemplars { exemplars }
                });
                if !samples.is_empty() || exemplars.is_some() {
                    resp.series.push(cluster_rpc::Series {
                        metric: v.labels.iter().map(|x| x.as_ref().into()).collect(),
                        samples,
                        exemplars,
                        ..Default::default()
                    });
                }
            });
        }
        value::Value::Sample(v) => {
            resp.series.push(cluster_rpc::Series {
                sample: Some((&v).into()),
                ..Default::default()
            });
        }
        value::Value::Float(v) => {
            resp.series.push(cluster_rpc::Series {
                scalar: Some(v),
                ..Default::default()
            });
        }
        value::Value::String(v) => {
            resp.series.push(cluster_rpc::Series {
                stringliteral: Some(v),
                ..Default::default()
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::stream::FileMeta;

    use super::*;

    #[tokio::test]
    async fn test_promql_generate_search_group() {
        // test case 1: normal case
        let memory_limit = 200 as usize;
        let file_list = vec![
            FileKey {
                meta: FileMeta {
                    records: 100,
                    min_ts: 0,
                    max_ts: 100,
                    ..Default::default()
                },
                ..Default::default()
            },
            FileKey {
                meta: FileMeta {
                    records: 100,
                    min_ts: 100,
                    max_ts: 200,
                    ..Default::default()
                },
                ..Default::default()
            },
            FileKey {
                meta: FileMeta {
                    records: 100,
                    min_ts: 200,
                    max_ts: 300,
                    ..Default::default()
                },
                ..Default::default()
            },
            FileKey {
                meta: FileMeta {
                    records: 100,
                    min_ts: 300,
                    max_ts: 400,
                    ..Default::default()
                },
                ..Default::default()
            },
            FileKey {
                meta: FileMeta {
                    records: 30,
                    min_ts: 400,
                    max_ts: 430,
                    ..Default::default()
                },
                ..Default::default()
            },
        ];
        let resp = generate_search_group(memory_limit, file_list.clone(), 0, 400, 30).await;
        let expected = vec![(0, 180), (210, 400)];
        assert!(resp.is_ok());
        assert_eq!(resp.unwrap(), expected);

        // test case 2: start == end
        let resp = generate_search_group(memory_limit, file_list.clone(), 0, 0, 30).await;
        let expected = vec![];
        assert!(resp.is_ok());
        assert_eq!(resp.unwrap(), expected);

        // test case 3: start > end
        let resp = generate_search_group(memory_limit, file_list.clone(), 10, 0, 30).await;
        let expected = vec![];
        assert!(resp.is_ok());
        assert_eq!(resp.unwrap(), expected);

        // test case 4, the last group is greater than step * 5
        let memory_limit = 100 as usize;
        let resp = generate_search_group(memory_limit, file_list.clone(), 0, 430, 5).await;
        let expected = vec![(0, 200), (205, 300), (305, 400), (405, 430)];
        assert!(resp.is_ok());
        assert_eq!(resp.unwrap(), expected);

        // test case 5, the last group is less than step * 5
        let resp = generate_search_group(memory_limit, file_list.clone(), 0, 430, 10).await;
        let expected = vec![(0, 200), (210, 300), (310, 430)];
        assert!(resp.is_ok());
        assert_eq!(resp.unwrap(), expected);
    }
}
