use ahash::AHashMap as HashMap;
use datafusion::arrow::datatypes::{DataType, Schema};
use datafusion::arrow::json as arrowJson;
use datafusion::arrow::record_batch::RecordBatch;
use datafusion::datasource::file_format::file_type::{FileType, GetExt};
use datafusion::datasource::file_format::json::JsonFormat;
use datafusion::datasource::file_format::parquet::ParquetFormat;
use datafusion::datasource::listing::{ListingOptions, ListingTable};
use datafusion::datasource::listing::{ListingTableConfig, ListingTableUrl};
use datafusion::datasource::object_store::ObjectStoreRegistry;
use datafusion::error::Result;
use datafusion::execution::context::SessionConfig;
use datafusion::execution::runtime_env::{RuntimeConfig, RuntimeEnv};
use datafusion::prelude::{cast, col, Expr, SessionContext};
use datafusion_common::DataFusionError;
use object_store::limit::LimitStore;
use parquet::arrow::ArrowWriter;
use parquet::file::properties::WriterProperties;
use parquet::format::SortingColumn;
use regex::Regex;
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;

use super::storage::file_list;
use super::transform_udf::get_all_transform;
use crate::infra::cache::tmpfs;
use crate::infra::config::{get_parquet_compression, CONFIG};
use crate::meta::common::FileMeta;
use crate::meta::{self, StreamType};
use crate::service::search::sql::Sql;

const AGGREGATE_UDF_LIST: [&str; 6] = ["min", "max", "count", "avg", "sum", "array_agg"];

#[tracing::instrument(name = "service:search:datafusion:exec:sql", skip_all)]
pub async fn sql(
    session: &meta::search::Session,
    stream_type: StreamType,
    schema: Option<Arc<Schema>>,
    rules: HashMap<String, DataType>,
    sql: &Arc<Sql>,
    files: &Vec<String>,
    file_type: FileType,
) -> Result<HashMap<String, Vec<RecordBatch>>> {
    if files.is_empty() {
        return Ok(HashMap::new());
    }

    let now = Instant::now();

    let runtime_env = create_runtime_env()?;
    let session_config = SessionConfig::new()
        .with_information_schema(schema.is_none())
        .with_batch_size(8192);
    let mut ctx = SessionContext::with_config_rt(session_config.clone(), Arc::new(runtime_env));

    // Configure listing options
    let listing_options = match file_type {
        FileType::PARQUET => {
            let file_format = ParquetFormat::default().with_enable_pruning(Some(false));
            ListingOptions::new(Arc::new(file_format))
                .with_file_extension(FileType::PARQUET.get_ext())
                .with_target_partitions(CONFIG.limit.cpu_num)
        }
        FileType::JSON => {
            let file_format = JsonFormat::default();
            ListingOptions::new(Arc::new(file_format))
                .with_file_extension(FileType::JSON.get_ext())
                .with_target_partitions(CONFIG.limit.cpu_num)
        }
        _ => {
            return Err(DataFusionError::Execution(format!(
                "Unsupported file type scheme {:?}",
                file_type,
            )));
        }
    };

    let prefix = if session.data_type.eq(&file_list::SessionType::Cache) {
        format!(
            "{}files/{}/{}/{}/",
            &CONFIG.common.data_wal_dir, sql.org_id, stream_type, sql.stream_name
        )
    } else {
        file_list::set(&session.id, files).await.unwrap();
        format!("mem:///{}/", session.id)
    };
    let prefix = match ListingTableUrl::parse(prefix) {
        Ok(url) => url,
        Err(e) => {
            return Err(datafusion::error::DataFusionError::Execution(format!(
                "ListingTableUrl error: {}",
                e
            )));
        }
    };
    let prefixes = vec![prefix];
    log::info!(
        "Prepare table took {:.3} seconds.",
        now.elapsed().as_secs_f64()
    );

    let mut config =
        ListingTableConfig::new_with_multi_paths(prefixes).with_listing_options(listing_options);
    if schema.is_none() {
        config = config.infer_schema(&ctx.state()).await.unwrap();
    } else {
        config = config.with_schema(schema.as_ref().unwrap().clone());
    }
    log::info!(
        "infer schema took {:.3} seconds.",
        now.elapsed().as_secs_f64()
    );

    let table = ListingTable::try_new(config)?;
    ctx.register_table("tbl", Arc::new(table))?;

    // register UDF
    register_udf(&mut ctx, &sql.org_id).await;
    log::info!(
        "Register table took {:.3} seconds.",
        now.elapsed().as_secs_f64()
    );

    // Debug SQL
    log::info!("Query sql: {}", sql.origin_sql);

    let mut result: HashMap<String, Vec<RecordBatch>> = HashMap::new();
    // query
    let mut df = ctx.sql(&sql.origin_sql).await?;
    if !rules.is_empty() {
        let fields = df.schema().fields();
        let mut exprs = Vec::with_capacity(fields.len());
        for field in fields {
            if field.qualifier().is_none() {
                exprs.push(col(field.name()));
                continue;
            }
            exprs.push(match rules.get(field.name()) {
                Some(rule) => Expr::Alias(
                    Box::new(cast(col(field.name()), rule.clone())),
                    field.name().to_string(),
                ),
                None => col(field.name()),
            });
        }
        df = df.select(exprs)?;
    }
    let batches = df.collect().await?;
    result.insert("query".to_string(), batches);
    log::info!("Query took {:.3} seconds.", now.elapsed().as_secs_f64());
    // aggs
    for (name, sql) in sql.aggs.iter() {
        // Debug SQL
        // log::info!("Query agg sql: {}", sql.0);
        let mut df = ctx.sql(&sql.0).await?;
        if !rules.is_empty() {
            let fields = df.schema().fields();
            let mut exprs = Vec::with_capacity(fields.len());
            for field in fields {
                if field.qualifier().is_none() {
                    exprs.push(col(field.name()));
                    continue;
                }
                exprs.push(match rules.get(field.name()) {
                    Some(rule) => Expr::Alias(
                        Box::new(cast(col(field.name()), rule.clone())),
                        field.name().to_string(),
                    ),
                    None => col(field.name()),
                });
            }
            df = df.select(exprs)?;
        }
        let batches = df.collect().await?;
        result.insert(format!("agg_{}", name), batches);
        log::info!(
            "Query agg:{} took {:.3} seconds.",
            name,
            now.elapsed().as_secs_f64()
        );
    }

    // drop table
    ctx.deregister_table("tbl")?;
    log::info!("Query all took {:.3} seconds.", now.elapsed().as_secs_f64());

    Ok(result)
}

pub async fn merge(
    org_id: &str,
    offset: usize,
    limit: usize,
    sql: &str,
    batches: &Vec<Vec<RecordBatch>>,
) -> Result<Vec<Vec<RecordBatch>>> {
    if batches.is_empty() {
        return Ok(vec![]);
    }
    if offset == 0 && batches.len() == 1 && batches[0].len() <= 1 {
        return Ok(batches.to_owned());
    }

    let now = Instant::now();

    // write temp file
    let work_dir = merge_write_recordbatch(batches)?;
    log::info!(
        "merge_write_recordbatch took {:.3} seconds.",
        now.elapsed().as_secs_f64()
    );

    // rewrite sql
    let schema = batches[0][0].schema();
    let query_sql = match merge_rewrite_sql(sql, schema) {
        Ok(sql) => {
            if offset > 0
                && sql.to_uppercase().contains(" LIMIT ")
                && !sql.to_uppercase().contains(" OFFSET ")
            {
                sql.replace(
                    &format!(" LIMIT {}", limit + offset),
                    &format!(" LIMIT {} OFFSET {}", limit, offset),
                )
            } else {
                sql
            }
        }
        Err(e) => {
            return Err(e);
        }
    };
    log::info!(
        "merge_rewrite_sql took {:.3} seconds.",
        now.elapsed().as_secs_f64()
    );

    // query data
    let runtime_env = create_runtime_env()?;
    let session_config = SessionConfig::new()
        .with_information_schema(true)
        .with_batch_size(8192);
    let mut ctx = SessionContext::with_config_rt(session_config.clone(), Arc::new(runtime_env));

    // Configure listing options
    let file_format = ParquetFormat::default().with_enable_pruning(Some(false));
    let listing_options = ListingOptions::new(Arc::new(file_format))
        .with_file_extension(FileType::PARQUET.get_ext())
        .with_target_partitions(CONFIG.limit.cpu_num);

    let prefix = match ListingTableUrl::parse(format!("tmpfs://{}", work_dir)) {
        Ok(url) => url,
        Err(e) => {
            return Err(datafusion::error::DataFusionError::Execution(format!(
                "ListingTableUrl error: {}",
                e
            )));
        }
    };
    let prefixes = vec![prefix];

    let mut config =
        ListingTableConfig::new_with_multi_paths(prefixes).with_listing_options(listing_options);
    config = config.infer_schema(&ctx.state()).await.unwrap();

    let table = ListingTable::try_new(config)?;
    ctx.register_table("tbl", Arc::new(table))?;

    // register UDF
    register_udf(&mut ctx, org_id).await;

    // Debug SQL
    // log::info!("Merge sql: {}", query_sql);

    let df = ctx.sql(&query_sql).await?;
    let batches = df.collect().await?;
    ctx.deregister_table("tbl")?;

    log::info!("Merge took {:.3} seconds.", now.elapsed().as_secs_f64());

    // clear temp file
    tmpfs::remove_dir_all(work_dir).unwrap();

    Ok(vec![batches])
}

fn merge_write_recordbatch(batches: &[Vec<RecordBatch>]) -> Result<String> {
    let work_dir = format!(
        "/tmp/zinc/observe/merge/{}/",
        chrono::Utc::now().timestamp_micros()
    );
    tmpfs::create_dir_all(&work_dir).unwrap();
    for (i, item) in batches.iter().enumerate() {
        let file_name = format!("{}{}.parquet", &work_dir, i);
        let f = tmpfs::create_file(file_name).unwrap();
        let mut writer = ArrowWriter::try_new(f, item[0].schema().clone(), None)?;
        for row in item.iter() {
            writer.write(row)?;
        }
        writer.close().unwrap();
    }

    Ok(work_dir)
}

fn merge_rewrite_sql(sql: &str, schema: Arc<Schema>) -> Result<String> {
    let mut sql = sql.to_string();
    let mut fields = Vec::new();
    let mut from_pos = 0;
    let sql_chars = sql.chars().collect::<Vec<char>>();
    let sql_chars_len = sql_chars.len();
    let mut start_pos = 0;
    let mut in_word = false;
    let mut bracket = 0;
    for i in 0..sql_chars_len {
        let c = sql_chars.get(i).unwrap();
        if *c == '(' {
            bracket += 1;
            continue;
        }
        if *c == ')' {
            bracket -= 1;
            continue;
        }
        if *c == ',' || *c == ' ' {
            if bracket > 0 {
                continue;
            }
            if in_word {
                let field = sql[start_pos..i].to_string();
                if field.to_lowercase().eq("from") {
                    from_pos = i;
                    break;
                }
                fields.push(field);
            }
            in_word = false;
            continue;
        }
        if in_word {
            continue;
        }
        start_pos = i;
        in_word = true;
    }
    // println!("fields: {:?}", fields);

    let mut new_fields = Vec::new();
    let mut sel_fields_name = Vec::new();
    let mut sel_fields_has_star = false;
    let mut last_is_as = false;
    for (i, field) in fields.iter().enumerate() {
        let field = field.trim();
        if field.to_lowercase().eq("select") {
            continue;
        }
        if field.to_lowercase().eq("as") {
            last_is_as = true;
            continue;
        }
        if last_is_as {
            new_fields.remove(new_fields.len() - 1);
            new_fields.push(format!("{} AS {}", fields[i - 2], field));
            sel_fields_name.remove(sel_fields_name.len() - 1);
            sel_fields_name.push(field.to_string().replace('"', "").replace(", ", ","));
            last_is_as = false;
            continue;
        }
        if field.eq("*") {
            sel_fields_has_star = true;
        }
        new_fields.push(field.to_string());
        sel_fields_name.push(field.to_string().replace('"', "").replace(", ", ","));
    }
    // println!("new fields: {:?}", new_fields);
    // println!("sel_fields_name: {:?}", sel_fields_name);
    // println!("schema fields: {:?}", schema.fields());

    // handle select *
    let mut fields = new_fields;
    if fields.len() == 1 && sel_fields_has_star {
        return Ok(sql);
    }
    if sel_fields_has_star {
        let mut new_fields = Vec::with_capacity(fields.len());
        for field in fields.iter() {
            if field.eq("*") {
                for f in schema.fields() {
                    let f_name = f.name().replace("tbl.", "");
                    if sel_fields_name.contains(&f_name) {
                        continue;
                    }
                    let field_name = if f.name().contains('@') {
                        "_PLACEHOLDER_"
                    } else {
                        f.name()
                    };
                    new_fields.push(format!("\"{}\"", field_name));
                }
            } else {
                new_fields.push(field.to_string());
            }
        }
        fields = new_fields;
    }
    if fields.len() != schema.fields().len() {
        log::error!(
            "in sql fields: {:?}",
            fields
                .iter()
                .map(|f| f.trim_matches('"').to_string())
                .collect::<Vec<String>>()
        );
        log::error!(
            "schema fields: {:?}",
            schema
                .fields()
                .iter()
                .map(|f| f.name().clone())
                .collect::<Vec<String>>()
        );
        return Err(datafusion::error::DataFusionError::Execution(
            "merge arrow files error: schema and SQL fields mismatch".to_string(),
        ));
    }

    let mut need_rewrite = false;
    let re_field_fn = Regex::new(r##"(?i)([a-zA-Z0-9_]+)\((['"a-zA-Z0-9_*]+)"##).unwrap();
    for i in 0..fields.len() {
        let field = fields.get(i).unwrap();
        if !field.contains('(') {
            if field.contains(" AS ") {
                need_rewrite = true;
                fields[i] = format!("\"{}\"", schema.field(i).name());
            }
            continue;
        }
        need_rewrite = true;
        let cap = re_field_fn.captures(field).unwrap();
        let mut fn_name = cap.get(1).unwrap().as_str().to_lowercase();
        if !AGGREGATE_UDF_LIST.contains(&fn_name.as_str()) {
            fields[i] = format!("\"{}\"", schema.field(i).name());
            continue;
        }
        if fn_name == "count" {
            fn_name = "sum".to_string();
        }
        fields[i] = format!(
            "{}(\"{}\") as \"{}\"",
            fn_name,
            schema.field(i).name(),
            schema.field(i).name()
        );
    }
    if need_rewrite {
        // println!("merge_rewrite_sql A: {}", sql);
        sql = format!("SELECT {} FROM {}", &fields.join(", "), &sql[from_pos..]);
        // println!("merge_rewrite_sql B: {}", sql);
        if sql.contains("_PLACEHOLDER_") {
            sql = sql.replace(r##""_PLACEHOLDER_", "##, "");
            sql = sql.replace(r##", "_PLACEHOLDER_""##, "");
        }
        // println!("merge_rewrite_sql C: {}", sql);
    }

    // delete where from sql
    let re_where = Regex::new(r"(?i) where (.*)").unwrap();
    let mut where_str = match re_where.captures(&sql) {
        Some(caps) => caps[0].to_string(),
        None => "".to_string(),
    };
    if !where_str.is_empty() {
        let mut where_str_lower = where_str.to_lowercase();
        for key in [" order by", " group by", " offset", " limit"].iter() {
            if let Some(pos) = where_str_lower.find(key) {
                where_str = where_str[..pos].to_string();
                where_str_lower = where_str.to_lowercase();
            }
        }
        sql = sql.replace(&where_str, " ");
    }

    Ok(sql)
}

pub async fn convert_parquet_file(
    buf: &mut Vec<u8>,
    schema: Arc<Schema>,
    rules: HashMap<String, DataType>,
    file: &str,
) -> Result<()> {
    let now = Instant::now();

    // query data
    let runtime_env = create_runtime_env()?;
    let session_config = SessionConfig::new()
        .with_information_schema(false)
        .with_batch_size(8192);
    let ctx = SessionContext::with_config_rt(session_config.clone(), Arc::new(runtime_env));

    // Configure listing options
    let file_format = ParquetFormat::default().with_enable_pruning(Some(false));
    let listing_options = ListingOptions::new(Arc::new(file_format))
        .with_file_extension(FileType::PARQUET.get_ext())
        .with_target_partitions(CONFIG.limit.cpu_num);

    let session_id = Uuid::new_v4().to_string();
    file_list::set(&session_id, &[file.to_string()])
        .await
        .unwrap();

    let prefix = match ListingTableUrl::parse(format!("mem:///{}/", session_id)) {
        Ok(url) => url,
        Err(e) => {
            return Err(datafusion::error::DataFusionError::Execution(format!(
                "ListingTableUrl error: {}",
                e
            )));
        }
    };
    let prefixes = vec![prefix];

    let config = ListingTableConfig::new_with_multi_paths(prefixes)
        .with_listing_options(listing_options)
        .with_schema(schema.clone());

    let table = ListingTable::try_new(config)?;
    ctx.register_table("tbl", Arc::new(table))?;

    // get all sorted data
    let query_sql = format!(
        "SELECT * FROM tbl ORDER BY {} DESC",
        CONFIG.common.time_stamp_col
    );
    let mut df = ctx.sql(&query_sql).await?;
    if !rules.is_empty() {
        let fields = df.schema().fields();
        let mut exprs = Vec::with_capacity(fields.len());
        for field in fields {
            if field.qualifier().is_none() {
                exprs.push(col(field.name()));
                continue;
            }
            exprs.push(match rules.get(field.name()) {
                Some(rule) => Expr::Alias(
                    Box::new(cast(col(field.name()), rule.clone())),
                    field.name().to_string(),
                ),
                None => col(field.name()),
            });
        }
        df = df.select(exprs)?;
    }
    let schema: Schema = df.schema().into();
    let batches = df.collect().await?;
    let props = WriterProperties::builder()
        .set_compression(get_parquet_compression())
        .set_write_batch_size(8192)
        .set_data_pagesize_limit(1024 * 512)
        .set_max_row_group_size(1024 * 1024 * 256);
    let writer_props = props.build();
    let mut writer = ArrowWriter::try_new(buf, Arc::new(schema), Some(writer_props)).unwrap();
    for batch in batches {
        writer.write(&batch)?;
    }
    writer.close().unwrap();
    ctx.deregister_table("tbl")?;

    // clear session
    file_list::clear(&session_id).await.unwrap();

    log::info!(
        "convert_parquet_file took {:.3} seconds.",
        now.elapsed().as_secs_f64()
    );

    Ok(())
}

pub async fn merge_parquet_files(
    buf: &mut Vec<u8>,
    schema: Arc<Schema>,
    files: &[String],
) -> Result<FileMeta> {
    let now = Instant::now();

    // query data
    let runtime_env = create_runtime_env()?;
    let session_config = SessionConfig::new()
        .with_information_schema(false)
        .with_batch_size(8192);
    let ctx = SessionContext::with_config_rt(session_config.clone(), Arc::new(runtime_env));

    // Configure listing options
    let file_format = ParquetFormat::default().with_enable_pruning(Some(false));
    let listing_options = ListingOptions::new(Arc::new(file_format))
        .with_file_extension(FileType::PARQUET.get_ext())
        .with_target_partitions(CONFIG.limit.cpu_num);

    let session_id = Uuid::new_v4().to_string();
    file_list::set(&session_id, files).await.unwrap();

    let prefix = match ListingTableUrl::parse(format!("mem:///{}/", session_id)) {
        Ok(url) => url,
        Err(e) => {
            return Err(datafusion::error::DataFusionError::Execution(format!(
                "ListingTableUrl error: {}",
                e
            )));
        }
    };
    let prefixes = vec![prefix];

    let config = ListingTableConfig::new_with_multi_paths(prefixes)
        .with_listing_options(listing_options)
        .with_schema(schema.clone());

    let table = ListingTable::try_new(config)?;
    ctx.register_table("tbl", Arc::new(table))?;

    // get meta data
    let meta_sql = format!(
        "SELECT MIN({}) as min_ts, MAX({}) as max_ts, COUNT(1) as num_records FROM tbl",
        CONFIG.common.time_stamp_col, CONFIG.common.time_stamp_col
    );
    let df = ctx.sql(&meta_sql).await?;
    let batches = df.collect().await.unwrap();
    let json_rows = arrowJson::writer::record_batches_to_json_rows(&batches[..]).unwrap();
    let mut result: Vec<serde_json::Value> = json_rows
        .into_iter()
        .map(serde_json::Value::Object)
        .collect();
    let record = result.pop().unwrap();
    let file_meta = FileMeta {
        min_ts: record["min_ts"].as_i64().unwrap(),
        max_ts: record["max_ts"].as_i64().unwrap(),
        records: record["num_records"].as_u64().unwrap(),
        original_size: 0,
        compressed_size: 0,
    };

    // get all sorted data
    let query_sql = format!(
        "SELECT * FROM tbl ORDER BY {} DESC",
        CONFIG.common.time_stamp_col
    );
    let df = ctx.sql(&query_sql).await?;
    let schema: Schema = df.schema().into();
    let batches = df.collect().await?;
    let sort_column_id = schema.index_of(&CONFIG.common.time_stamp_col).unwrap();
    let props = WriterProperties::builder()
        .set_compression(get_parquet_compression())
        .set_write_batch_size(8192)
        .set_data_pagesize_limit(1024 * 512)
        .set_max_row_group_size(1024 * 1024 * 256)
        .set_sorting_columns(Some(
            [SortingColumn::new(sort_column_id as i32, true, false)].to_vec(),
        ));
    let writer_props = props.build();
    let mut writer = ArrowWriter::try_new(buf, Arc::new(schema), Some(writer_props)).unwrap();
    for batch in batches {
        writer.write(&batch)?;
    }
    writer.close().unwrap();
    ctx.deregister_table("tbl")?;

    // clear session
    file_list::clear(&session_id).await.unwrap();

    log::info!(
        "merge_parquet_files took {:.3} seconds.",
        now.elapsed().as_secs_f64()
    );

    Ok(file_meta)
}

fn create_runtime_env() -> Result<RuntimeEnv> {
    let object_store_registry = ObjectStoreRegistry::new();

    let mem = super::storage::memory::InMemory::new();
    let mem = LimitStore::new(mem, CONFIG.limit.query_thread_num);
    object_store_registry.register_store("mem", "", Arc::new(mem));

    let tmpfs = super::storage::tmpfs::InMemory::new();
    let tmpfs = LimitStore::new(tmpfs, CONFIG.limit.query_thread_num);
    object_store_registry.register_store("tmpfs", "", Arc::new(tmpfs));

    let rn_config =
        RuntimeConfig::new().with_object_store_registry(Arc::new(object_store_registry));
    RuntimeEnv::new(rn_config)
}

async fn register_udf(ctx: &mut SessionContext, org_id: &str) {
    ctx.register_udf(super::match_udf::MATCH_UDF.clone());
    ctx.register_udf(super::match_udf::MATCH_NO_CASE_UDF.clone());
    ctx.register_udf(super::regexp_udf::REGEX_MATCH_UDF.clone());
    ctx.register_udf(super::regexp_udf::REGEX_NOT_MATCH_UDF.clone());
    ctx.register_udf(super::time_range_udf::TIME_RANGE_UDF.clone());

    let udf_list = get_all_transform(org_id).await;
    for udf in udf_list {
        ctx.register_udf(udf.clone());
    }
}

#[cfg(test)]
mod test {
    use super::*;
    #[actix_web::test]
    async fn test_register_udf() {
        let mut ctx = SessionContext::new();
        let _ = register_udf(&mut ctx, "nexus").await;
        //assert!(res)
    }
}
