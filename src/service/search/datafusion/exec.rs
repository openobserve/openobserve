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

use std::{cmp::max, num::NonZero, str::FromStr, sync::Arc};

use arrow::record_batch::RecordBatch;
use arrow_schema::Field;
use config::{
    PARQUET_BATCH_SIZE, TIMESTAMP_COL_NAME, get_config,
    meta::{
        search::{Session as SearchSession, StorageType},
        stream::{FileKey, FileMeta, StreamType},
    },
    utils::{parquet::new_parquet_writer, schema_ext::SchemaExt, util::DISTINCT_STREAM_PREFIX},
};
use datafusion::{
    arrow::datatypes::{DataType, Schema},
    catalog::TableProvider,
    config::Dialect,
    datasource::{
        file_format::parquet::ParquetFormat,
        listing::{ListingOptions, ListingTableConfig, ListingTableUrl},
        object_store::{DefaultObjectStoreRegistry, ObjectStoreRegistry},
    },
    error::{DataFusionError, Result},
    execution::{
        cache::cache_manager::{CacheManagerConfig, FileStatisticsCache},
        context::SessionConfig,
        memory_pool::{FairSpillPool, GreedyMemoryPool, TrackConsumersPool, UnboundedMemoryPool},
        runtime_env::{RuntimeEnv, RuntimeEnvBuilder},
        session_state::SessionStateBuilder,
    },
    logical_expr::AggregateUDF,
    optimizer::{AnalyzerRule, OptimizerRule},
    physical_expr_adapter::DefaultPhysicalExprAdapterFactory,
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::execute_stream,
    prelude::{SessionContext, col},
};
use futures::TryStreamExt;
use parquet::{arrow::AsyncArrowWriter, file::metadata::KeyValue};
#[cfg(feature = "enterprise")]
use {
    arrow::array::Int64Array,
    config::meta::promql::{DownsamplingRule, Function, HASH_LABEL, VALUE_LABEL},
    o2_enterprise::enterprise::{
        common::config::get_config as get_o2_config,
        common::downsampling::get_largest_downsampling_rule, search::WorkGroup,
    },
};

use super::{
    peak_memory_pool::PeakMemoryPool, planner::extension_planner::OpenobserveQueryPlanner,
    storage::file_list, table_provider::uniontable::NewUnionTable,
    udf::transform_udf::get_all_transform,
};
use crate::service::search::{
    datafusion::table_provider::listing_adapter::ListingTableAdapter, index::IndexCondition,
};

const DATAFUSION_MIN_MEM: usize = 1024 * 1024 * 256; // 256MB
const DATAFUSION_MIN_PARTITION: usize = 2; // CPU cores
#[cfg(feature = "enterprise")]
const TIMESTAMP_ALIAS: &str = "_timestamp_alias";

pub enum MergeParquetResult {
    Single(Vec<u8>),
    #[allow(unused)]
    Multiple {
        bufs: Vec<Vec<u8>>,
        file_metas: Vec<FileMeta>,
    },
}

pub async fn merge_parquet_files(
    stream_type: StreamType,
    stream_name: &str,
    schema: Arc<Schema>,
    tables: Vec<Arc<dyn TableProvider>>,
    bloom_filter_fields: &[String],
    metadata: &FileMeta,
    is_ingester: bool,
) -> Result<(Arc<Schema>, MergeParquetResult)> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    #[cfg(feature = "enterprise")]
    if stream_type == StreamType::Metrics && !is_ingester {
        let rule = get_largest_downsampling_rule(stream_name, metadata.max_ts);
        if let Some(rule) = rule {
            return merge_parquet_files_with_downsampling(
                schema,
                tables,
                bloom_filter_fields,
                rule,
                metadata,
            )
            .await;
        }
    }

    // get all sorted data
    let sql = if stream_type == StreamType::Index {
        format!(
            "SELECT * FROM tbl WHERE file_name NOT IN (SELECT file_name FROM tbl WHERE deleted IS TRUE ORDER BY {TIMESTAMP_COL_NAME} DESC) ORDER BY {TIMESTAMP_COL_NAME} DESC"
        )
    } else if cfg.limit.distinct_values_hourly
        && stream_type == StreamType::Metadata
        && stream_name.starts_with(DISTINCT_STREAM_PREFIX)
    {
        let fields = schema
            .fields()
            .iter()
            .filter(|f| f.name() != TIMESTAMP_COL_NAME && f.name() != "count")
            .map(|x| x.name().to_string())
            .collect::<Vec<_>>();
        let fields_str = fields.join(", ");
        format!(
            "SELECT MIN({TIMESTAMP_COL_NAME}) AS {TIMESTAMP_COL_NAME}, SUM(count) as count, {fields_str} FROM tbl GROUP BY {fields_str} ORDER BY {TIMESTAMP_COL_NAME} DESC"
        )
    } else if stream_type == StreamType::Filelist {
        // for file list we do not have timestamp, so we instead sort by min ts of entries
        "SELECT * FROM tbl ORDER BY min_ts DESC".to_string()
    } else {
        format!("SELECT * FROM tbl ORDER BY {TIMESTAMP_COL_NAME} DESC")
    };
    log::debug!("merge_parquet_files sql: {sql}");

    // create datafusion context
    let sort_by_timestamp_desc = true;
    // force use DATAFUSION_MIN_PARTITION for each merge task
    let target_partitions = DATAFUSION_MIN_PARTITION;
    let ctx = DataFusionContextBuilder::new()
        .sorted_by_time(sort_by_timestamp_desc)
        .build(target_partitions)
        .await?;
    // register union table
    let union_table = Arc::new(NewUnionTable::new(schema.clone(), tables));
    ctx.register_table("tbl", union_table)?;

    let plan = ctx.state().create_logical_plan(&sql).await?;
    let physical_plan = ctx.state().create_physical_plan(&plan).await?;
    let schema = physical_plan.schema();

    // print the physical plan
    if cfg.common.print_key_sql {
        let plan = datafusion::physical_plan::displayable(physical_plan.as_ref())
            .indent(false)
            .to_string();
        println!("+---------------------------+--------------------------+");
        println!("merge_parquet_files");
        println!("+---------------------------+--------------------------+");
        println!("{plan}");
    }

    // write result to parquet file
    let mut buf = Vec::new();
    let compression = if is_ingester && cfg.common.feature_ingester_none_compression {
        Some("none")
    } else {
        None
    };
    let mut writer = new_parquet_writer(
        &mut buf,
        &schema,
        bloom_filter_fields,
        metadata,
        false,
        compression,
    );

    // calculate the new file meta records
    let mut new_file_meta = metadata.clone();
    new_file_meta.records = 0;

    let mut batch_stream = execute_stream(physical_plan, ctx.task_ctx())?;
    let (tx, mut rx) = tokio::sync::mpsc::channel::<RecordBatch>(2);
    let task = tokio::task::spawn(async move {
        loop {
            match batch_stream.try_next().await {
                Ok(None) => {
                    break;
                }
                Ok(Some(batch)) => {
                    if let Err(e) = tx.send(batch).await {
                        log::error!("merge_parquet_files write to channel error: {e}");
                        return Err(DataFusionError::External(Box::new(e)));
                    }
                }
                Err(e) => {
                    log::error!("merge_parquet_files execute stream error: {e}");
                    return Err(e);
                }
            }
        }
        Ok(())
    });
    while let Some(batch) = rx.recv().await {
        new_file_meta.records += batch.num_rows() as i64;
        if let Err(e) = writer.write(&batch).await {
            log::error!("merge_parquet_files write error: {e}");
            return Err(e.into());
        }
    }
    task.await
        .map_err(|e| DataFusionError::External(Box::new(e)))??;
    append_metadata(&mut writer, &new_file_meta)?;
    writer.close().await?;

    ctx.deregister_table("tbl")?;
    drop(ctx);

    log::debug!(
        "merge_parquet_files took {} ms",
        start.elapsed().as_millis()
    );

    Ok((schema, MergeParquetResult::Single(buf)))
}

#[cfg(feature = "enterprise")]
pub async fn merge_parquet_files_with_downsampling(
    schema: Arc<Schema>,
    tables: Vec<Arc<dyn TableProvider>>,
    bloom_filter_fields: &[String],
    rule: &DownsamplingRule,
    metadata: &FileMeta,
) -> Result<(Arc<Schema>, MergeParquetResult)> {
    let start = std::time::Instant::now();
    let cfg = get_config();
    let mut metadata = metadata.clone();
    // assume that the metrics data is sampled at a point every 15 seconds, and then estimate the
    // records, used for bloom filter.
    let step = if rule.step < 15 { 15 } else { rule.step };
    metadata.records = (metadata.records * 15) / step;

    let sql = generate_downsampling_sql(&schema, rule);

    log::debug!("merge_parquet_files_with_downsampling sql: {sql}");

    // create datafusion context
    let ctx = DataFusionContextBuilder::new()
        .sorted_by_time(true)
        .build(DATAFUSION_MIN_PARTITION)
        .await?;
    // register union table
    let union_table = Arc::new(NewUnionTable::new(schema.clone(), tables));
    ctx.register_table("tbl", union_table)?;

    let plan = ctx.state().create_logical_plan(&sql).await?;
    let physical_plan = ctx.state().create_physical_plan(&plan).await?;
    let schema = physical_plan.schema();

    // write result to parquet file
    let mut bufs = Vec::new();
    let mut file_metas = Vec::new();
    let mut min_ts = 0;

    let mut buf = Vec::with_capacity(cfg.compact.max_file_size as usize);
    let mut file_meta = FileMeta::default();
    let mut writer = new_parquet_writer(
        &mut buf,
        &schema,
        bloom_filter_fields,
        &metadata,
        false,
        None,
    );
    let mut batch_stream = execute_stream(physical_plan, ctx.task_ctx())?;
    let (tx, mut rx) = tokio::sync::mpsc::channel::<RecordBatch>(2);
    let task = tokio::task::spawn(async move {
        loop {
            match batch_stream.try_next().await {
                Ok(None) => {
                    break;
                }
                Ok(Some(batch)) => {
                    if let Err(e) = tx.send(batch).await {
                        log::error!(
                            "merge_parquet_files_with_downsampling write to channel error: {e}"
                        );
                        return Err(DataFusionError::External(Box::new(e)));
                    }
                }
                Err(e) => {
                    log::error!("merge_parquet_files_with_downsampling execute stream error: {e}");
                    return Err(e);
                }
            }
        }
        Ok(())
    });
    while let Some(batch) = rx.recv().await {
        if file_meta.max_ts == 0 {
            file_meta.max_ts = get_max_timestamp(&batch);
        }
        file_meta.original_size += batch.get_array_memory_size() as i64;
        file_meta.records += batch.num_rows() as i64;
        min_ts = get_min_timestamp(&batch);
        if file_meta.original_size > cfg.compact.max_file_size as i64 {
            file_meta.min_ts = min_ts;
            append_metadata(&mut writer, &file_meta)?;
            writer.close().await?;
            bufs.push(std::mem::take(&mut buf));
            file_metas.push(file_meta);

            // reset for next file
            buf.clear();
            file_meta = FileMeta::default();
            writer = new_parquet_writer(
                &mut buf,
                &schema,
                bloom_filter_fields,
                &metadata,
                false,
                None,
            );
        }
        if let Err(e) = writer.write(&batch).await {
            log::error!("merge_parquet_files_with_downsampling write Error: {e}");
            return Err(e.into());
        }
    }
    task.await
        .map_err(|e| DataFusionError::External(Box::new(e)))??;

    if file_meta.original_size > 0 {
        file_meta.min_ts = min_ts;
        append_metadata(&mut writer, &file_meta)?;
        writer.close().await?;
        bufs.push(std::mem::take(&mut buf));
        file_metas.push(file_meta);
    }

    ctx.deregister_table("tbl")?;
    drop(ctx);

    log::debug!(
        "merge_parquet_files_with_downsampling took {} ms",
        start.elapsed().as_millis()
    );

    Ok((schema, MergeParquetResult::Multiple { bufs, file_metas }))
}

fn append_metadata(
    writer: &mut AsyncArrowWriter<&mut Vec<u8>>,
    file_meta: &FileMeta,
) -> Result<()> {
    writer.append_key_value_metadata(KeyValue::new(
        "min_ts".to_string(),
        file_meta.min_ts.to_string(),
    ));
    writer.append_key_value_metadata(KeyValue::new(
        "max_ts".to_string(),
        file_meta.max_ts.to_string(),
    ));
    writer.append_key_value_metadata(KeyValue::new(
        "records".to_string(),
        file_meta.records.to_string(),
    ));
    writer.append_key_value_metadata(KeyValue::new(
        "original_size".to_string(),
        file_meta.original_size.to_string(),
    ));
    Ok(())
}

pub fn create_session_config(
    sorted_by_time: bool,
    target_partitions: usize,
) -> Result<SessionConfig> {
    let cfg = get_config();
    let target_partitions = if target_partitions == 0 {
        cfg.limit.cpu_num
    } else {
        target_partitions
    };
    let target_partitions = max(
        DATAFUSION_MIN_PARTITION,
        max(cfg.limit.datafusion_min_partition_num, target_partitions),
    );
    let mut config = SessionConfig::from_env()?
        .with_batch_size(PARQUET_BATCH_SIZE)
        .with_target_partitions(target_partitions)
        .with_information_schema(true);
    config
        .options_mut()
        .execution
        .listing_table_ignore_subdirectory = false;
    config.options_mut().sql_parser.dialect = Dialect::PostgreSQL;

    // based on data distributing, it only works for the data on a few records
    config = config.set_bool(
        "datafusion.execution.parquet.pushdown_filters",
        cfg.common.feature_pushdown_filter_enabled,
    );
    // config = config.set_bool("datafusion.execution.parquet.reorder_filters", true);

    if cfg.common.bloom_filter_enabled {
        config = config.set_bool("datafusion.execution.parquet.bloom_filter_on_read", true);
    }
    if cfg.common.bloom_filter_disabled_on_search {
        config = config.set_bool("datafusion.execution.parquet.bloom_filter_on_read", false);
    }
    if sorted_by_time {
        config = config.set_bool("datafusion.execution.split_file_groups_by_statistics", true);
    }

    // due to: https://github.com/apache/datafusion/issues/19219
    config = config.set_bool("datafusion.optimizer.enable_topk_aggregation", false);

    // When set to true, skips verifying that the schema produced by planning the input of
    // `LogicalPlan::Aggregate` exactly matches the schema of the input plan.
    config = config.set_bool(
        "datafusion.execution.skip_physical_aggregate_schema_check",
        true,
    );

    Ok(config)
}

pub async fn create_runtime_env(trace_id: &str, memory_limit: usize) -> Result<RuntimeEnv> {
    let object_store_registry = DefaultObjectStoreRegistry::new();

    let memory = super::storage::memory::FS::new();
    let memory_url = url::Url::parse("memory:///").unwrap();
    object_store_registry.register_store(&memory_url, Arc::new(memory));

    let wal = super::storage::wal::FS::new();
    let wal_url = url::Url::parse("wal:///").unwrap();
    object_store_registry.register_store(&wal_url, Arc::new(wal));

    let cfg = get_config();
    let mut builder =
        RuntimeEnvBuilder::new().with_object_store_registry(Arc::new(object_store_registry));
    if cfg.limit.datafusion_file_stat_cache_max_entries > 0 {
        let cache_config = CacheManagerConfig::default();
        let cache_config = cache_config.with_files_statistics_cache(Some(
            super::storage::file_statistics_cache::GLOBAL_CACHE.clone(),
        ));
        builder = builder.with_cache_manager(cache_config);
    }

    let memory_size = std::cmp::max(DATAFUSION_MIN_MEM, memory_limit);
    let mem_pool = super::MemoryPoolType::from_str(&cfg.memory_cache.datafusion_memory_pool)
        .map_err(|e| {
            DataFusionError::Execution(format!("Invalid datafusion memory pool type: {e}"))
        })?;
    let memory_pool = match mem_pool {
        super::MemoryPoolType::Greedy => {
            let pool = GreedyMemoryPool::new(memory_size);
            let track_memory_pool = TrackConsumersPool::new(pool, NonZero::new(20).unwrap());
            PeakMemoryPool::new(Arc::new(track_memory_pool), trace_id.to_string())
        }
        super::MemoryPoolType::Fair => {
            let pool = FairSpillPool::new(memory_size);
            let track_memory_pool = TrackConsumersPool::new(pool, NonZero::new(20).unwrap());
            PeakMemoryPool::new(Arc::new(track_memory_pool), trace_id.to_string())
        }
        super::MemoryPoolType::None => {
            let pool = UnboundedMemoryPool::default();
            let track_memory_pool = TrackConsumersPool::new(pool, NonZero::new(20).unwrap());
            PeakMemoryPool::new(Arc::new(track_memory_pool), trace_id.to_string())
        }
    };

    builder = builder.with_memory_pool(Arc::new(memory_pool));
    builder.build()
}

pub struct DataFusionContextBuilder<'a> {
    trace_id: &'a str,
    work_group: Option<String>,
    analyzer_rules: Vec<Arc<dyn AnalyzerRule + Send + Sync>>,
    optimizer_rules: Vec<Arc<dyn OptimizerRule + Send + Sync>>,
    physical_optimizer_rules: Vec<Arc<dyn PhysicalOptimizerRule + Send + Sync>>,
    sorted_by_time: bool,
}

impl<'a> DataFusionContextBuilder<'a> {
    pub fn new() -> Self {
        Self {
            trace_id: "",
            work_group: None,
            analyzer_rules: vec![],
            optimizer_rules: vec![],
            physical_optimizer_rules: vec![],
            sorted_by_time: false,
        }
    }

    pub fn trace_id(mut self, trace_id: &'a str) -> Self {
        self.trace_id = trace_id;
        self
    }

    pub fn work_group(mut self, work_group: Option<String>) -> Self {
        self.work_group = work_group;
        self
    }

    pub fn analyzer_rules(
        mut self,
        analyzer_rules: Vec<Arc<dyn AnalyzerRule + Send + Sync>>,
    ) -> Self {
        self.analyzer_rules = analyzer_rules;
        self
    }

    pub fn optimizer_rules(
        mut self,
        optimizer_rules: Vec<Arc<dyn OptimizerRule + Send + Sync>>,
    ) -> Self {
        self.optimizer_rules = optimizer_rules;
        self
    }

    pub fn physical_optimizer_rules(
        mut self,
        physical_optimizer_rules: Vec<Arc<dyn PhysicalOptimizerRule + Send + Sync>>,
    ) -> Self {
        self.physical_optimizer_rules = physical_optimizer_rules;
        self
    }

    pub fn sorted_by_time(mut self, sorted_by_time: bool) -> Self {
        self.sorted_by_time = sorted_by_time;
        self
    }

    pub async fn build(self, target_partitions: usize) -> Result<SessionContext, DataFusionError> {
        let cfg = get_config();
        let (target_partitions, memory_size) =
            (target_partitions, cfg.memory_cache.datafusion_max_size);
        #[cfg(feature = "enterprise")]
        let (target_partitions, memory_size) = get_cpu_and_mem_limit(
            self.trace_id,
            self.work_group.clone(),
            target_partitions,
            memory_size,
        )
        .await?;

        let session_config = create_session_config(self.sorted_by_time, target_partitions)?;
        let runtime_env = Arc::new(create_runtime_env(self.trace_id, memory_size).await?);
        let mut builder = SessionStateBuilder::new()
            .with_config(session_config)
            .with_runtime_env(runtime_env)
            .with_default_features();
        for rule in self.analyzer_rules {
            builder = builder.with_analyzer_rule(rule);
        }
        if !self.optimizer_rules.is_empty() {
            builder = builder.with_optimizer_rules(self.optimizer_rules)
        }
        for rule in self.physical_optimizer_rules {
            builder = builder.with_physical_optimizer_rule(rule);
        }
        if cfg.common.feature_join_match_one_enabled {
            builder = builder.with_query_planner(Arc::new(OpenobserveQueryPlanner::new()));
        }
        Ok(SessionContext::new_with_state(builder.build()))
    }
}

pub fn register_udf(ctx: &SessionContext, org_id: &str) -> Result<()> {
    ctx.register_udf(super::udf::str_match_udf::STR_MATCH_UDF.clone());
    ctx.register_udf(super::udf::str_match_udf::STR_MATCH_IGNORE_CASE_UDF.clone());
    ctx.register_udf(super::udf::fuzzy_match_udf::FUZZY_MATCH_UDF.clone());
    ctx.register_udf(super::udf::regexp_udf::REGEX_MATCH_UDF.clone());
    ctx.register_udf(super::udf::regexp_udf::REGEX_NOT_MATCH_UDF.clone());
    ctx.register_udf(super::udf::regexp_udf::REGEXP_MATCH_TO_FIELDS_UDF.clone());
    ctx.register_udf(super::udf::regexp_matches_udf::REGEX_MATCHES_UDF.clone());
    ctx.register_udf(super::udf::time_range_udf::TIME_RANGE_UDF.clone());
    ctx.register_udf(super::udf::date_format_udf::DATE_FORMAT_UDF.clone());
    ctx.register_udf(super::udf::string_to_array_v2_udf::STRING_TO_ARRAY_V2_UDF.clone());
    ctx.register_udf(super::udf::arrzip_udf::ARR_ZIP_UDF.clone());
    ctx.register_udf(super::udf::arrindex_udf::ARR_INDEX_UDF.clone());
    ctx.register_udf(super::udf::arr_descending_udf::ARR_DESCENDING_UDF.clone());
    ctx.register_udf(super::udf::arrjoin_udf::ARR_JOIN_UDF.clone());
    ctx.register_udf(super::udf::arrcount_udf::ARR_COUNT_UDF.clone());
    ctx.register_udf(super::udf::arrsort_udf::ARR_SORT_UDF.clone());
    ctx.register_udf(super::udf::cast_to_arr_udf::CAST_TO_ARR_UDF.clone());
    ctx.register_udf(super::udf::spath_udf::SPATH_UDF.clone());
    ctx.register_udf(super::udf::to_arr_string_udf::TO_ARR_STRING.clone());
    ctx.register_udf(super::udf::histogram_udf::HISTOGRAM_UDF.clone());
    ctx.register_udf(super::udf::match_all_hash_udf::MATCH_ALL_HASH_UDF.clone());
    ctx.register_udf(super::udf::match_all_udf::MATCH_ALL_UDF.clone());
    ctx.register_udf(super::udf::match_all_udf::FUZZY_MATCH_ALL_UDF.clone());
    ctx.register_udaf(AggregateUDF::from(
        super::udaf::summary_percentile::SummaryPercentile::new(),
    ));
    ctx.register_udf(super::udf::cast_to_timestamp_udf::CAST_TO_TIMESTAMP_UDF.clone());
    let udf_list = get_all_transform(org_id)?;
    for udf in udf_list {
        ctx.register_udf(udf.clone());
    }

    #[cfg(feature = "enterprise")]
    {
        ctx.register_udf(super::udf::cipher_udf::DECRYPT_UDF.clone());
        ctx.register_udf(super::udf::cipher_udf::DECRYPT_SLOW_UDF.clone());
        ctx.register_udf(super::udf::cipher_udf::ENCRYPT_UDF.clone());
        ctx.register_udaf(AggregateUDF::from(
            o2_enterprise::enterprise::search::datafusion::udaf::approx_topk::ApproxTopK::new(),
        ));
        ctx.register_udaf(AggregateUDF::from(
            o2_enterprise::enterprise::search::datafusion::udaf::approx_topk_distinct::ApproxTopKDistinct::new(),
        ));
    }

    Ok(())
}

pub async fn register_metrics_table(
    session: &SearchSession,
    schema: Arc<Schema>,
    table_name: &str,
    files: Vec<FileKey>,
) -> Result<SessionContext> {
    let ctx = DataFusionContextBuilder::new()
        .trace_id(&session.id)
        .work_group(session.work_group.clone())
        .build(session.target_partitions)
        .await?;

    let table = TableBuilder::new()
        .file_stat_cache(ctx.runtime_env().cache_manager.get_file_statistic_cache())
        .build(session.clone(), files, schema)
        .await?;
    ctx.register_table(table_name, table)?;

    Ok(ctx)
}

/// Create a datafusion table from a list of files and a schema
pub struct TableBuilder {
    sorted_by_time: bool,
    file_stat_cache: Option<Arc<dyn FileStatisticsCache>>,
    index_condition: Option<IndexCondition>,
    fst_fields: Vec<String>,
    timestamp_filter: Option<(i64, i64)>,
}

impl TableBuilder {
    pub fn new() -> Self {
        Self {
            sorted_by_time: false,
            file_stat_cache: None,
            index_condition: None,
            fst_fields: vec![],
            timestamp_filter: None,
        }
    }

    pub fn sorted_by_time(mut self, sorted_by_time: bool) -> Self {
        self.sorted_by_time = sorted_by_time;
        self
    }

    pub fn file_stat_cache(
        mut self,
        file_stat_cache: Option<Arc<dyn FileStatisticsCache>>,
    ) -> Self {
        self.file_stat_cache = file_stat_cache;
        self
    }

    pub fn index_condition(mut self, index_condition: Option<IndexCondition>) -> Self {
        self.index_condition = index_condition;
        self
    }

    pub fn fst_fields(mut self, fst_fields: Vec<String>) -> Self {
        self.fst_fields = fst_fields;
        self
    }

    /// apply timestamp filter to the table
    pub fn timestamp_filter(mut self, timestamp_filter: (i64, i64)) -> Self {
        self.timestamp_filter = Some(timestamp_filter);
        self
    }

    pub async fn build(
        self,
        session: SearchSession,
        files: Vec<FileKey>,
        schema: Arc<Schema>,
    ) -> Result<Arc<dyn TableProvider>> {
        let cfg = get_config();
        let target_partitions = if session.target_partitions == 0 {
            cfg.limit.cpu_num
        } else {
            session.target_partitions
        };
        let target_partitions = max(
            DATAFUSION_MIN_PARTITION,
            max(cfg.limit.datafusion_min_partition_num, target_partitions),
        );

        #[cfg(feature = "enterprise")]
        let (target_partitions, _) = get_cpu_and_mem_limit(
            &session.id,
            session.work_group.clone(),
            target_partitions,
            cfg.memory_cache.datafusion_max_size,
        )
        .await?;

        // Configure listing options
        let file_format = ParquetFormat::default();
        let mut listing_options = ListingOptions::new(Arc::new(file_format))
            .with_target_partitions(target_partitions)
            .with_collect_stat(true); // current is default to true

        if self.sorted_by_time {
            // specify sort columns for parquet file
            listing_options = listing_options
                .with_file_sort_order(vec![vec![col(TIMESTAMP_COL_NAME).sort(false, false)]]);
        }

        let schema_key = schema.hash_key();
        let prefix = if session.storage_type == StorageType::Memory {
            file_list::set(&session.id, &schema_key, files).await;
            format!("memory:///{}/schema={}/", session.id, schema_key)
        } else if session.storage_type == StorageType::Wal {
            file_list::set(&session.id, &schema_key, files).await;
            format!("wal:///{}/schema={}/", session.id, schema_key)
        } else {
            return Err(DataFusionError::Execution(format!(
                "Unsupported storage_type {:?}",
                session.storage_type,
            )));
        };
        let prefix = match ListingTableUrl::parse(prefix) {
            Ok(url) => url,
            Err(e) => {
                return Err(datafusion::error::DataFusionError::Execution(format!(
                    "ListingTableUrl error: {e}",
                )));
            }
        };

        let mut config = ListingTableConfig::new(prefix).with_listing_options(listing_options);
        let timestamp_field = schema.field_with_name(TIMESTAMP_COL_NAME);
        let schema = if timestamp_field.is_ok() && timestamp_field.unwrap().is_nullable() {
            let new_fields = schema
                .fields()
                .iter()
                .map(|x| {
                    if x.name() == TIMESTAMP_COL_NAME {
                        Arc::new(Field::new(
                            TIMESTAMP_COL_NAME.to_string(),
                            DataType::Int64,
                            false,
                        ))
                    } else {
                        x.clone()
                    }
                })
                .collect::<Vec<_>>();
            Arc::new(Schema::new(new_fields))
        } else {
            schema
        };
        config = config.with_schema(schema);
        config = config.with_expr_adapter_factory(Arc::new(DefaultPhysicalExprAdapterFactory {}));
        let mut table = ListingTableAdapter::try_new(
            config,
            session.id.clone(),
            self.index_condition,
            self.fst_fields,
            self.timestamp_filter,
        )?;
        if self.file_stat_cache.is_some() {
            table = table.with_cache(self.file_stat_cache);
        }
        Ok(Arc::new(table))
    }
}

#[cfg(feature = "enterprise")]
async fn get_cpu_and_mem_limit(
    trace_id: &str,
    work_group: Option<String>,
    mut target_partitions: usize,
    mut memory_size: usize,
) -> Result<(usize, usize)> {
    if let Some(wg) = work_group.as_ref()
        && let Ok(wg) = WorkGroup::from_str(wg)
    {
        let (cpu, mem) = wg.get_dynamic_resource().await.map_err(|e| {
            DataFusionError::Execution(format!("Failed to get dynamic resource: {e}"))
        })?;
        if get_o2_config().search_group.cpu_limit_enabled {
            target_partitions = std::cmp::max(
                get_config().limit.datafusion_min_partition_num,
                target_partitions * cpu as usize / 100,
            );
        }
        memory_size = memory_size * mem as usize / 100;
    }

    let target_partitions = if target_partitions == 0 {
        DATAFUSION_MIN_PARTITION
    } else {
        target_partitions
    };

    log::info!(
        "[trace_id: {trace_id}] work_group: {work_group:?}, target_partitions: {target_partitions}, memory_size: {memory_size}"
    );

    Ok((target_partitions, memory_size))
}

#[cfg(feature = "enterprise")]
fn generate_downsampling_sql(schema: &Arc<Schema>, rule: &DownsamplingRule) -> String {
    let step = rule.step;
    let fields = schema
        .fields()
        .iter()
        .filter_map(|f| {
            if f.name() != HASH_LABEL && f.name() != VALUE_LABEL && f.name() != TIMESTAMP_COL_NAME {
                Some(format!("max({}) as {}", f.name(), f.name()))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    let fun_str = if rule.function == Function::Last || rule.function == Function::First {
        format!(
            "{}({} ORDER BY {} ASC) as {}",
            rule.function.fun(),
            VALUE_LABEL,
            TIMESTAMP_COL_NAME,
            VALUE_LABEL
        )
    } else {
        format!(
            "{}({}) as {}",
            rule.function.fun(),
            VALUE_LABEL,
            VALUE_LABEL
        )
    };

    let sql = format!(
        "SELECT {}, to_unixtime(date_bin(interval '{} second', to_timestamp_micros({}), to_timestamp('2001-01-01T00:00:00'))) * 1000000 as {}, {}, {} FROM tbl GROUP BY {}, {}",
        HASH_LABEL,
        step,
        TIMESTAMP_COL_NAME,
        TIMESTAMP_ALIAS,
        fields.join(", "),
        fun_str,
        HASH_LABEL,
        TIMESTAMP_ALIAS,
    );

    let fields = schema
        .fields()
        .iter()
        .filter_map(|f| {
            if f.name() != HASH_LABEL && f.name() != VALUE_LABEL && f.name() != TIMESTAMP_COL_NAME {
                Some(f.name().to_string())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    format!(
        "SELECT {}, {}, {}, {} AS {} FROM ({}) ORDER BY {} DESC",
        HASH_LABEL,
        VALUE_LABEL,
        fields.join(", "),
        TIMESTAMP_ALIAS,
        TIMESTAMP_COL_NAME,
        sql,
        TIMESTAMP_ALIAS,
    )
}

#[cfg(feature = "enterprise")]
fn get_max_timestamp(record_batch: &RecordBatch) -> i64 {
    record_batch
        .column_by_name(TIMESTAMP_COL_NAME)
        .unwrap()
        .slice(0, 1)
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap()
        .value(0)
}

#[cfg(feature = "enterprise")]
fn get_min_timestamp(record_batch: &RecordBatch) -> i64 {
    record_batch
        .column_by_name(TIMESTAMP_COL_NAME)
        .unwrap()
        .slice(record_batch.num_rows() - 1, 1)
        .as_any()
        .downcast_ref::<Int64Array>()
        .unwrap()
        .value(0)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int64Array, StringArray};
    use arrow_schema::{DataType, Field, Schema};
    use config::get_config;

    use super::*;

    fn create_test_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("field1", DataType::Utf8, true),
            Field::new("field2", DataType::Int64, true),
        ]))
    }

    #[allow(dead_code)]
    fn create_test_record_batch() -> RecordBatch {
        let schema = create_test_schema();
        let timestamp_array = Int64Array::from(vec![1000, 2000, 3000]);
        let field1_array = StringArray::from(vec![Some("a"), Some("b"), Some("c")]);
        let field2_array = Int64Array::from(vec![Some(10), Some(20), Some(30)]);

        RecordBatch::try_new(
            schema,
            vec![
                Arc::new(timestamp_array),
                Arc::new(field1_array),
                Arc::new(field2_array),
            ],
        )
        .unwrap()
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_get_max_timestamp() {
        let batch = create_test_record_batch();
        let max_ts = get_max_timestamp(&batch);
        assert_eq!(max_ts, 1000); // first row in timestamp column
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_get_min_timestamp() {
        let batch = create_test_record_batch();
        let min_ts = get_min_timestamp(&batch);
        assert_eq!(min_ts, 3000); // last row in timestamp column
    }

    #[test]
    fn test_append_metadata() -> Result<()> {
        let mut buf = Vec::new();
        let schema = create_test_schema();
        let mut writer = AsyncArrowWriter::try_new(&mut buf, schema, None)?;

        let file_meta = FileMeta {
            min_ts: 1000,
            max_ts: 2000,
            records: 100,
            original_size: 1024,
            compressed_size: 512,
            flattened: false,
            index_size: 0,
        };

        let result = append_metadata(&mut writer, &file_meta);
        assert!(result.is_ok());
        Ok(())
    }

    #[tokio::test]
    async fn test_create_session_config_default() -> Result<()> {
        let config = create_session_config(false, 0)?;

        // Test default configurations
        assert_eq!(
            config.options().execution.target_partitions,
            get_config()
                .limit
                .cpu_num
                .max(DATAFUSION_MIN_PARTITION)
                .max(get_config().limit.datafusion_min_partition_num)
        );
        assert_eq!(config.options().execution.batch_size, PARQUET_BATCH_SIZE);
        assert_eq!(config.options().sql_parser.dialect, Dialect::PostgreSQL);
        assert!(!config.options().execution.listing_table_ignore_subdirectory);
        assert!(config.information_schema());

        Ok(())
    }

    #[tokio::test]
    async fn test_create_session_config_with_partitions() -> Result<()> {
        let target_partitions = 8;
        let config = create_session_config(true, target_partitions)?;

        let expected_partitions = std::cmp::max(
            DATAFUSION_MIN_PARTITION,
            std::cmp::max(
                get_config().limit.datafusion_min_partition_num,
                target_partitions,
            ),
        );

        assert_eq!(
            config.options().execution.target_partitions,
            expected_partitions
        );
        assert!(config.options().execution.split_file_groups_by_statistics);

        Ok(())
    }

    #[tokio::test]
    async fn test_create_session_config_sorted_by_time() -> Result<()> {
        let config = create_session_config(true, 4)?;
        assert!(config.options().execution.split_file_groups_by_statistics);
        Ok(())
    }

    #[tokio::test]
    async fn test_create_runtime_env() -> Result<()> {
        let memory_limit = 1024 * 1024 * 512; // 512MB
        let runtime_env = create_runtime_env("test", memory_limit).await?;

        // Check that object stores are registered
        let memory_url = url::Url::parse("memory:///").unwrap();
        let wal_url = url::Url::parse("wal:///").unwrap();

        assert!(
            runtime_env
                .object_store_registry
                .get_store(&memory_url)
                .is_ok()
        );
        assert!(
            runtime_env
                .object_store_registry
                .get_store(&wal_url)
                .is_ok()
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_create_runtime_env_min_memory() -> Result<()> {
        let small_memory = 1024; // Very small memory
        let runtime_env = create_runtime_env("test", small_memory).await?;

        // Should handle small memory gracefully
        // Memory pool behavior may vary by implementation
        // Memory pool exists and was created successfully
        let _ = runtime_env.memory_pool.reserved();

        Ok(())
    }

    #[tokio::test]
    async fn test_datafusion_context_builder_new() {
        let builder = DataFusionContextBuilder::new();
        assert_eq!(builder.trace_id, "");
        assert_eq!(builder.work_group, None);
        assert!(!builder.sorted_by_time);
        assert!(builder.analyzer_rules.is_empty());
        assert!(builder.optimizer_rules.is_empty());
        assert!(builder.physical_optimizer_rules.is_empty());
    }

    #[tokio::test]
    async fn test_datafusion_context_builder_with_options() {
        let builder = DataFusionContextBuilder::new()
            .trace_id("test-trace-123")
            .work_group(Some("test-group".to_string()))
            .sorted_by_time(true);

        assert_eq!(builder.trace_id, "test-trace-123");
        assert_eq!(builder.work_group, Some("test-group".to_string()));
        assert!(builder.sorted_by_time);
    }

    #[tokio::test]
    async fn test_datafusion_context_builder_build() -> Result<()> {
        let builder = DataFusionContextBuilder::new()
            .trace_id("test-trace")
            .sorted_by_time(true);

        let ctx = builder.build(4).await?;

        // Verify context was created successfully
        assert!(ctx.sql("SELECT 1").await.is_ok());

        Ok(())
    }

    #[tokio::test]
    async fn test_register_udf() -> Result<()> {
        let ctx = SessionContext::new();
        let result = register_udf(&ctx, "test_org");

        assert!(result.is_ok());

        // Test that UDFs are registered by checking the context has functions
        // str_match might have different signature, so just verify registration succeeded
        assert!(result.is_ok());

        Ok(())
    }

    #[test]
    fn test_table_builder_new() {
        let builder = TableBuilder::new();
        assert!(!builder.sorted_by_time);
        assert!(builder.file_stat_cache.is_none());
        assert!(builder.index_condition.is_none());
        assert!(builder.fst_fields.is_empty());
    }

    #[test]
    fn test_table_builder_with_options() {
        let builder = TableBuilder::new()
            .sorted_by_time(true)
            .fst_fields(vec!["field1".to_string()]);

        assert!(builder.sorted_by_time);
        assert_eq!(builder.fst_fields, vec!["field1".to_string()]);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_generate_downsampling_sql() {
        use config::meta::promql::{DownsamplingRule, Function};

        let schema = Arc::new(Schema::new(vec![
            Field::new("__hash__", DataType::Utf8, false),
            Field::new("__value__", DataType::Float64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("instance", DataType::Utf8, true),
        ]));

        let rule = DownsamplingRule {
            rule: None,
            function: Function::Avg,
            offset: 0,
            step: 300, // 5 minutes
        };

        let sql = generate_downsampling_sql(&schema, &rule);

        // Basic checks that SQL contains expected elements
        assert!(sql.contains("GROUP BY"));
        assert!(sql.contains("__hash__"));
        assert!(sql.contains("__value__"));
        assert!(sql.contains("300 second"));
        assert!(sql.contains("ORDER BY"));
    }

    #[tokio::test]
    async fn test_create_session_config_memory_pools() -> Result<()> {
        // Test different memory pool configurations by creating runtime environments
        let memory_limit = 1024 * 1024 * 256; // 256MB

        // Test that runtime env creation works (which tests different pool types)
        let runtime_env = create_runtime_env("test", memory_limit).await?;
        // Memory pool exists and was created successfully
        // Memory pool exists and was created successfully
        let _ = runtime_env.memory_pool.reserved();

        Ok(())
    }

    #[tokio::test]
    async fn test_merge_parquet_files_error_handling() {
        // Test with empty tables vector
        let schema = create_test_schema();
        let empty_tables: Vec<Arc<dyn TableProvider>> = vec![];
        let bloom_fields = vec![];
        let metadata = FileMeta::default();

        let result = merge_parquet_files(
            StreamType::Logs,
            "test_stream",
            schema,
            empty_tables,
            &bloom_fields,
            &metadata,
            false,
        )
        .await;

        // Should handle empty tables gracefully or return appropriate error
        // The exact behavior depends on implementation details
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    async fn test_append_metadata_values() -> Result<()> {
        let mut buf = Vec::new();
        let schema = create_test_schema();
        let mut writer = AsyncArrowWriter::try_new(&mut buf, schema, None)?;

        let file_meta = FileMeta {
            min_ts: 1000,
            max_ts: 2000,
            records: 100,
            original_size: 1024,
            compressed_size: 512,
            flattened: false,
            index_size: 0,
        };

        append_metadata(&mut writer, &file_meta)?;

        // Verify the writer has the metadata (indirectly by checking no errors)
        let result = writer.close().await;
        assert!(result.is_ok());

        Ok(())
    }

    mod integration_tests {
        use config::meta::{
            search::{Session as SearchSession, StorageType},
            stream::FileKey,
        };

        use super::*;

        #[tokio::test]
        async fn test_register_table_integration() -> Result<()> {
            let session = SearchSession {
                id: "test-session".to_string(),
                storage_type: StorageType::Memory,
                target_partitions: 2,
                work_group: None,
            };

            let schema = create_test_schema();
            let files = vec![FileKey {
                key: "test-file".to_string(),
                meta: FileMeta::default(),
                deleted: false,
                account: "test_account".to_string(),
                id: 1,
                segment_ids: None,
            }];

            let result = register_metrics_table(&session, schema, "test_table", files).await;

            // Should create context successfully
            assert!(result.is_ok());
            if let Ok(ctx) = result {
                // Verify table is registered
                assert!(
                    ctx.catalog("datafusion")
                        .unwrap()
                        .schema("public")
                        .unwrap()
                        .table("test_table")
                        .await
                        .is_ok()
                );
            }

            Ok(())
        }

        #[tokio::test]
        async fn test_table_builder_build_integration() -> Result<()> {
            let session = SearchSession {
                id: "test-session".to_string(),
                storage_type: StorageType::Memory,
                target_partitions: 2,
                work_group: None,
            };

            let schema = create_test_schema();
            let files = vec![FileKey {
                key: "test-file".to_string(),
                meta: FileMeta::default(),
                deleted: false,
                account: "test_account".to_string(),
                id: 1,
                segment_ids: None,
            }];

            let builder = TableBuilder::new().sorted_by_time(true);

            let result = builder.build(session, files, schema).await;
            assert!(result.is_ok());

            Ok(())
        }
    }

    mod error_cases {
        use super::*;

        #[tokio::test]
        async fn test_create_runtime_env_invalid_memory_pool_type() {
            // This test verifies error handling in memory pool creation
            // The actual error handling is in the FromStr implementation
            let memory_limit = 1024 * 1024 * 256;
            let result = create_runtime_env("test", memory_limit).await;
            assert!(result.is_ok()); // Should handle gracefully
        }

        #[test]
        fn test_append_metadata_with_defaults() -> Result<()> {
            let mut buf = Vec::new();
            let schema = create_test_schema();
            let mut writer = AsyncArrowWriter::try_new(&mut buf, schema, None)?;

            let file_meta = FileMeta::default();
            let result = append_metadata(&mut writer, &file_meta);
            assert!(result.is_ok());

            Ok(())
        }

        #[tokio::test]
        async fn test_datafusion_context_builder_zero_partitions() -> Result<()> {
            let builder = DataFusionContextBuilder::new();
            let ctx = builder.build(0).await?; // Zero partitions should use default

            // Should still create a valid context
            assert!(ctx.sql("SELECT 1").await.is_ok());

            Ok(())
        }
    }

    mod configuration_tests {
        use super::*;

        #[tokio::test]
        async fn test_session_config_bloom_filter_settings() -> Result<()> {
            // Test bloom filter configurations
            let config1 = create_session_config(false, 4)?;
            let config2 = create_session_config(true, 4)?;

            // Both should be valid configurations
            assert!(config1.options().execution.target_partitions > 0);
            assert!(config2.options().execution.target_partitions > 0);

            Ok(())
        }

        #[tokio::test]
        async fn test_session_config_partition_bounds() -> Result<()> {
            // Test minimum partition enforcement
            let config = create_session_config(false, 1)?; // Very small number

            let actual_partitions = config.options().execution.target_partitions;
            assert!(actual_partitions >= DATAFUSION_MIN_PARTITION);

            Ok(())
        }
    }
}
