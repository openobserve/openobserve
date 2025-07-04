use config::meta::sql::resolve_stream_names;
use infra::errors::Error;
use o2_enterprise::enterprise::search::{
    cache::{
        CardinalityLevel,
        streaming_agg::{
            create_aggregation_cache_file_path, generate_aggregation_cache_interval,
            get_aggregation_cache_key_from_request,
        },
    },
    datafusion::distributed_plan::streaming_aggs_exec,
};
#[cfg(feature = "enterprise")]
use proto::cluster_rpc;

use crate::service::search::sql::{Sql, get_group_by_fields};

#[cfg(feature = "enterprise")]
pub async fn check_eligibility_for_streaming_aggs(
    trace_id: &str,
    query: &cluster_rpc::SearchQuery,
    sql: &Sql,
    regions: &[String],
    clusters: &[String],
) -> Result<(Option<String>, i64), Error> {
    use config::ider;

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
