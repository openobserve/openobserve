use config::{
    ider,
    meta::{search, sql::resolve_stream_names, stream::StreamType},
    utils::sql::is_simple_aggregate_query,
};
use infra::errors::Error;
use o2_enterprise::enterprise::search::{
    cache::{
        CardinalityLevel,
        streaming_agg::{
            create_aggregation_cache_file_path, generate_aggregation_cache_interval,
            get_aggregation_cache_key_from_request,
        },
    },
    cache_aggs_util,
    datafusion::distributed_plan::streaming_aggs_exec,
};
#[cfg(feature = "enterprise")]
use proto::cluster_rpc;

use crate::service::search::{
    cache as CacheSearchService,
    search_stream::{get_partitions, handle_partial_response},
    sql::{Sql, get_group_by_fields},
};

#[cfg(feature = "enterprise")]
pub fn check_eligibility_for_streaming_aggs_cache(sql: &str) -> bool {
    let mut is_cachable_aggs = is_simple_aggregate_query(sql).unwrap_or(false);

    let aggs_rules_match = cache_aggs_util::analyze_count_aggregation_pattern(sql);
    if let Ok(result) = aggs_rules_match {
        is_cachable_aggs = result.matches_pattern || is_cachable_aggs;
    }

    is_cachable_aggs && config::get_config().common.feature_query_streaming_aggs
}

#[cfg(feature = "enterprise")]
pub async fn get_streaming_id_and_interval(
    trace_id: &str,
    query: &cluster_rpc::SearchQuery,
    sql: &Sql,
    regions: &[String],
    clusters: &[String],
) -> Result<(Option<String>, i64), Error> {
    let (stream_name, _all_streams) = match resolve_stream_names(&sql.sql) {
        // TODO: cache don't not support multiple stream names
        Ok(v) => (v[0].clone(), v.join(",")),
        Err(e) => {
            return Err(Error::Message(e.to_string()));
        }
    };

    // check cardinality for group by fields
    let group_by_fields = get_group_by_fields(sql).await?;
    let cardinality_map = crate::service::search::cardinality::check_cardinality(
        &sql.org_id,
        sql.stream_type,
        &stream_name,
        &group_by_fields,
        query.end_time,
    )
    .await?;

    let cardinality_value = cardinality_map.values().product::<f64>();
    let cardinality_level = CardinalityLevel::from(cardinality_value);
    let cache_interval =
        generate_aggregation_cache_interval(query.start_time, query.end_time, cardinality_level);

    log::info!(
        "[trace_id {}] search_partition: using streaming_output, group by fields: {:?}, cardinality level: {:?}, interval: {:?}",
        trace_id,
        cardinality_map,
        cardinality_level,
        cache_interval
    );

    let cache_interval_mins = cache_interval.get_duration_minutes();
    if cache_interval_mins == 0 {
        return Ok((None, 0));
    }

    let streaming_id = ider::uuid();
    let hashed_query = get_aggregation_cache_key_from_request(
        &sql.sql,
        regions.to_vec(),
        clusters.to_vec(),
        query.query_fn.clone(),
    );
    let cache_file_path = create_aggregation_cache_file_path(
        &sql.org_id,
        &sql.stream_type.to_string(),
        &stream_name,
        hashed_query,
        cache_interval_mins,
    );
    streaming_aggs_exec::init_cache(
        &streaming_id,
        query.start_time,
        query.end_time,
        &cache_file_path,
    );
    log::info!(
        "[trace_id {}] [streaming_id: {}] init streaming_agg cache: cache_file_path: {}",
        trace_id,
        streaming_id,
        cache_file_path
    );
    let res = (
        Some(streaming_id),
        cache_interval.get_interval_microseconds(),
    );
    Ok(res)
}

pub async fn do_partitioned_search_for_streaming_aggs(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    req: &search::Request,
    user_id: Option<String>,
    use_cache: bool,
) -> Result<search::Response, Error> {
    if user_id.is_none() {
        return Err(Error::Message("user_id is required".to_string()));
    }

    let partition_resp = get_partitions(
        trace_id,
        org_id,
        stream_type,
        req,
        &user_id.clone().unwrap(),
    )
    .await?;
    let partitions = partition_resp.partitions;
    let is_streaming_aggs = partition_resp.streaming_aggs;

    if partitions.is_empty() || !is_streaming_aggs {
        return Ok(search::Response::default());
    }

    let mut req = req.clone();
    req.query.streaming_output = true;
    req.query.streaming_id = partition_resp.streaming_id;

    let mut final_res = search::Response::default();
    let partition_num = partitions.len();
    for (idx, [start_time, end_time]) in partitions.iter().enumerate() {
        req.query.start_time = *start_time;
        req.query.end_time = *end_time;
        req.use_cache = use_cache;

        let trace_id = if partition_num == 1 {
            trace_id.to_string()
        } else {
            format!("{}-{}", trace_id, idx)
        };

        let res = CacheSearchService::search(
            &trace_id,
            org_id,
            stream_type,
            user_id.clone(),
            &req,
            "".to_string(),
            false,
        )
        .await;
        let res = res.map(handle_partial_response)?;

        // For streaming aggs, the last partition will have the final result
        if partition_num == idx + 1 {
            final_res = res;
        }
    }
    Ok(final_res)
}
