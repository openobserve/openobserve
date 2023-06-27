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

use ahash::AHashMap as HashMap;
use datafusion::{
    arrow::{
        datatypes::{DataType, Schema},
        json as arrowJson,
        record_batch::RecordBatch,
    },
    datasource::{
        file_format::{
            file_type::{FileType, GetExt},
            json::JsonFormat,
            parquet::ParquetFormat,
        },
        listing::{ListingOptions, ListingTable, ListingTableConfig, ListingTableUrl},
        object_store::{DefaultObjectStoreRegistry, ObjectStoreRegistry},
    },
    error::{DataFusionError, Result},
    execution::{
        context::SessionConfig,
        runtime_env::{RuntimeConfig, RuntimeEnv},
    },
    prelude::{cast, col, lit, Expr, SessionContext},
    scalar::ScalarValue,
};
use parquet::arrow::ArrowWriter;
use regex::Regex;
use std::sync::Arc;

use super::storage::{file_list, StorageType};

use super::transform_udf::get_all_transform;

use crate::common::json;
use crate::infra::{cache::tmpfs, config::CONFIG};
use crate::meta::{common::FileMeta, search::Session as SearchSession, sql};
use crate::service::search::sql::Sql;
use once_cell::sync::Lazy;

const AGGREGATE_UDF_LIST: [&str; 6] = ["min", "max", "count", "avg", "sum", "array_agg"];

static RE_WHERE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i) where (.*)").unwrap());
static RE_FIELD_FN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?i)([a-zA-Z0-9_]+)\((['"a-zA-Z0-9_*]+)"#).unwrap());

pub async fn sql(
    session: &SearchSession,
    schema: Arc<Schema>,
    rules: &HashMap<String, DataType>,
    sql: &Arc<Sql>,
    files: &[String],
    file_type: FileType,
) -> Result<HashMap<String, Vec<RecordBatch>>> {
    if files.is_empty() {
        return Ok(HashMap::new());
    }

    let start = std::time::Instant::now();
    let mut ctx = register_table(session, schema.clone(), "tbl", files, file_type.clone()).await?;

    // register UDF
    register_udf(&mut ctx, &sql.org_id).await;

    let mut result: HashMap<String, Vec<RecordBatch>> = HashMap::new();

    // query sql
    result.insert(
        "query".to_string(),
        exec_query(
            &mut ctx,
            session,
            schema.clone(),
            rules,
            sql,
            files,
            file_type.clone(),
        )
        .await?,
    );

    //get alias from context query for agg sql
    let meta_sql = sql::Sql::new(&sql.query_context);

    for (name, orig_agg_sql) in sql.aggs.iter() {
        // Debug SQL
        log::info!("Query agg sql: {}", orig_agg_sql.0);

        let mut agg_sql = orig_agg_sql.0.to_owned();
        if meta_sql.is_ok() {
            for alias in &meta_sql.as_ref().unwrap().field_alias {
                replace_in_query(&alias.1, &mut agg_sql, true);
            }
        }

        let mut df = match ctx.sql(&agg_sql).await {
            Ok(df) => df,
            Err(e) => {
                log::error!(
                    "aggs sql execute failed, session: {:?}, sql: {}, err: {:?}",
                    session,
                    agg_sql,
                    e
                );
                return Err(e);
            }
        };

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
        result.insert(format!("agg_{name}"), batches);
        log::info!(
            "Query agg:{name} took {:.3} seconds.",
            start.elapsed().as_secs_f64()
        );
    }

    // drop table
    ctx.deregister_table("tbl")?;
    log::info!(
        "Query all took {:.3} seconds.",
        start.elapsed().as_secs_f64()
    );

    Ok(result)
}

async fn exec_query(
    ctx: &mut SessionContext,
    session: &SearchSession,
    schema: Arc<Schema>,
    rules: &HashMap<String, DataType>,
    sql: &Arc<Sql>,
    files: &[String],
    file_type: FileType,
) -> Result<Vec<RecordBatch>> {
    let start = std::time::Instant::now();

    let mut fast_mode = false;
    let (q_ctx, schema) = if sql.fast_mode && session.storage_type != StorageType::Tmpfs {
        fast_mode = true;
        get_fast_mode_ctx(session, schema, sql, files, file_type).await?
    } else {
        (ctx.clone(), schema.clone())
    };

    // get used UDF
    let mut field_fns = vec![];
    let mut sql_parts = vec![];
    for fn_name in crate::common::functions::get_all_transform_keys(&sql.org_id).await {
        if sql.origin_sql.contains(&fn_name) {
            field_fns.push(fn_name.clone());
        }
    }

    if !fast_mode && (!field_fns.is_empty() || sql.query_fn.is_some()) {
        if let Some(caps) = RE_WHERE.captures(&sql.origin_sql) {
            sql_parts.insert(
                0,
                sql.origin_sql
                    .strip_suffix(caps.get(0).unwrap().as_str())
                    .unwrap(),
            );
            sql_parts.insert(1, caps.get(1).unwrap().as_str());
        };
    }

    // query
    let query = if !&sql.query_context.is_empty() {
        sql.query_context.replace(&sql.stream_name, "tbl").clone()
    } else if !fast_mode
        && ((!field_fns.is_empty() && !sql_parts.is_empty()) || sql.query_fn.is_some())
    {
        match sql.meta.time_range {
            Some(ts_range) => format!(
                "{} where {} >= {} AND {} < {}",
                sql_parts[0],
                CONFIG.common.column_timestamp,
                ts_range.0,
                CONFIG.common.column_timestamp,
                ts_range.1
            ),
            None => sql_parts[0].to_owned(),
        }
    } else {
        sql.origin_sql.clone()
    };

    // Debug SQL
    log::info!("Query sql: {}", query);

    let mut df = match q_ctx.sql(&query).await {
        Ok(df) => df,
        Err(e) => {
            log::error!(
                "query sql execute failed, session: {:?}, sql: {}, err: {:?}",
                session,
                sql.origin_sql,
                e
            );
            return Err(e);
        }
    };
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

    if field_fns.is_empty() && sql.query_fn.is_none() {
        let batches = df.clone().collect().await?;
        log::info!("Query took {:.3} seconds.", start.elapsed().as_secs_f64());
        return Ok(batches);
    }

    if !sql.query_context.is_empty() {
        q_ctx.deregister_table("tbl")?;
        q_ctx.register_table("tbl", df.clone().into_view())?;
        // re-register to ctx
        if !fast_mode {
            ctx.deregister_table("tbl")?;
            ctx.register_table("tbl", df.into_view())?;
        }
    } else if sql.query_fn.is_some() {
        let batches = df.clone().collect().await?;
        match handle_query_fn(sql.query_fn.clone().unwrap(), batches, &sql.org_id) {
            None => {
                return Err(datafusion::error::DataFusionError::Execution(
                    "Error applying query function".to_string(),
                ));
            }
            Some(resp) => {
                let mem_table = datafusion::datasource::MemTable::try_new(
                    resp.first().unwrap().schema(),
                    vec![resp],
                )?;
                q_ctx.deregister_table("tbl")?;
                q_ctx.register_table("tbl", Arc::new(mem_table))?;
                // -- fix mem table, add missing columns
                let mut tmp_df = q_ctx.table("tbl").await?;
                let tmp_fields = tmp_df
                    .schema()
                    .field_names()
                    .iter()
                    .map(|f| f.strip_prefix("tbl.").unwrap().to_string())
                    .collect::<Vec<String>>();
                let need_add_columns = schema
                    .fields()
                    .iter()
                    .filter(|field| !tmp_fields.contains(field.name()))
                    .map(|field| field.name().as_str())
                    .collect::<Vec<&str>>();
                if !need_add_columns.is_empty() {
                    for column in need_add_columns {
                        tmp_df = tmp_df.with_column(column, lit(ScalarValue::Null))?;
                    }
                    q_ctx.deregister_table("tbl")?;
                    q_ctx.register_table("tbl", tmp_df.clone().into_view())?;
                    // re-register to ctx
                    if !fast_mode {
                        ctx.deregister_table("tbl")?;
                        ctx.register_table("tbl", tmp_df.into_view())?;
                    }
                }
                // -- fix done
            }
        }
    } else {
        return Err(datafusion::error::DataFusionError::Execution(
            "BUG -> this shouldn't be happen".to_string(),
        ));
    }

    let mut where_query = if !sql_parts.is_empty() {
        format!("select * from tbl where {}", &sql_parts[1])
    } else {
        sql.origin_sql.clone()
    };
    for alias in &sql.meta.field_alias {
        replace_in_query(&alias.1, &mut where_query, true);
    }
    let additional_clause = where_query.clone();

    let df = match q_ctx.sql(&additional_clause).await {
        Ok(df) => df,
        Err(e) => {
            log::error!(
                "query sql execute failed, session: {:?}, sql: {}, err: {:?}",
                session,
                sql.origin_sql,
                e
            );
            return Err(e);
        }
    };
    let batches = df.clone().collect().await?;
    log::info!("Query took {:.3} seconds.", start.elapsed().as_secs_f64());
    Ok(batches)
}

async fn get_fast_mode_ctx(
    session: &SearchSession,
    schema: Arc<Schema>,
    sql: &Arc<Sql>,
    files: &[String],
    file_type: FileType,
) -> Result<(SessionContext, Arc<Schema>)> {
    // sort files by time range
    let mut files_meta = HashMap::default();
    files.iter().for_each(|key| {
        let meta = crate::service::file_list::get_file_meta(key).unwrap_or_default();
        files_meta.insert(key, meta);
    });
    let mut files = files.to_vec();
    files.sort_by(|a, b| {
        let a_meta = files_meta.get(a).unwrap();
        let b_meta = files_meta.get(b).unwrap();
        a_meta.min_ts.cmp(&b_meta.min_ts)
    });

    let mut loaded_records = 0;
    let mut new_files = Vec::new();
    let needs = sql.meta.limit + sql.meta.offset;
    for i in (0..files.len()).rev() {
        loaded_records += files_meta.get(&files[i]).unwrap().records as usize;
        new_files.push(files[i].clone());
        if loaded_records >= needs {
            break;
        }
    }

    let fast_sesison = SearchSession {
        id: format!("{}-fast", session.id),
        storage_type: session.storage_type.clone(),
    };
    let mut ctx =
        register_table(&fast_sesison, schema.clone(), "tbl", &new_files, file_type).await?;

    // register UDF
    register_udf(&mut ctx, &sql.org_id).await;

    Ok((ctx, schema))
}

fn replace_in_query(replace_pat: &str, where_query: &mut String, is_alias: bool) {
    let re1 = Regex::new(&format!("(?i){}_([a-zA-Z0-9_-]*)", replace_pat)).unwrap();
    if let Some(caps) = re1.captures(&*where_query) {
        let cap_str = caps.get(0).unwrap().as_str();
        let field = caps.get(1).unwrap().as_str();
        if is_alias {
            *where_query = where_query.replace(cap_str, &format!("{replace_pat}['{field}']"));
        } else {
            let local_pattern = replace_pat
                .replace("tbl_", "")
                .replacen('_', "(", 1)
                .replace('_', ")");
            *where_query = where_query.replace(cap_str, &format!("{local_pattern}['{field}']"));
        }
    }
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

    let start = std::time::Instant::now();
    // write temp file
    let (schema, work_dir) = merge_write_recordbatch(batches)?;
    log::info!(
        "merge_write_recordbatch took {:.3} seconds.",
        start.elapsed().as_secs_f64()
    );
    if schema.fields().is_empty() {
        return Ok(vec![]);
    }

    // rewrite sql
    let query_sql = match merge_rewrite_sql(sql, schema) {
        Ok(sql) => {
            if offset > 0
                && sql.to_uppercase().contains(" LIMIT ")
                && !sql.to_uppercase().contains(" OFFSET ")
            {
                sql.replace(
                    &format!(" LIMIT {}", limit + offset),
                    &format!(" LIMIT {limit} OFFSET {offset}"),
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
        start.elapsed().as_secs_f64()
    );

    // query data
    let mut ctx = prepare_datafusion_context()?;
    // Configure listing options
    let file_format = ParquetFormat::default().with_enable_pruning(Some(false));
    let listing_options = ListingOptions::new(Arc::new(file_format))
        .with_file_extension(FileType::PARQUET.get_ext())
        .with_target_partitions(CONFIG.limit.cpu_num);
    let list_url = format!("tmpfs://{work_dir}");
    let prefix = match ListingTableUrl::parse(list_url) {
        Ok(url) => url,
        Err(e) => {
            return Err(datafusion::error::DataFusionError::Execution(format!(
                "ListingTableUrl error: {e}"
            )));
        }
    };

    let mut config = ListingTableConfig::new(prefix).with_listing_options(listing_options);
    config = match config.infer_schema(&ctx.state()).await {
        Ok(config) => config,
        Err(e) => {
            return Err(datafusion::error::DataFusionError::Execution(format!(
                "infer_schema error: {e}"
            )));
        }
    };

    let table = ListingTable::try_new(config)?;
    ctx.register_table("tbl", Arc::new(table))?;

    // register UDF
    register_udf(&mut ctx, org_id).await;

    // Debug SQL
    log::info!("Merge sql: {query_sql}");

    let df = match ctx.sql(&query_sql).await {
        Ok(df) => df,
        Err(e) => {
            log::error!("merge sql execute failed, sql: {}, err: {:?}", query_sql, e);
            return Err(e);
        }
    };
    let schema: Schema = df.schema().into();
    let mut batches = df.collect().await?;
    if batches.len() > 1 {
        // try to merge recordbatch
        let schema = Arc::new(schema);
        let mut merged_batch = batches[0].clone();
        for item in batches.iter().skip(1) {
            if item.num_rows() > 0 {
                merged_batch =
                    arrow::compute::concat_batches(&schema.clone(), &[merged_batch, item.clone()])
                        .unwrap();
            }
        }
        batches = vec![merged_batch];
    }
    ctx.deregister_table("tbl")?;

    log::info!("Merge took {:.3} seconds.", start.elapsed().as_secs_f64());

    // clear temp file
    tmpfs::delete(&work_dir, true).unwrap();

    Ok(vec![batches])
}

fn merge_write_recordbatch(batches: &[Vec<RecordBatch>]) -> Result<(Arc<Schema>, String)> {
    let mut i = 0;
    let work_dir = format!("/tmp/merge/{}/", chrono::Utc::now().timestamp_micros());
    let mut schema = Schema::empty();
    for item in batches.iter() {
        if item.is_empty() {
            continue;
        }
        for row in item.iter() {
            if row.num_rows() == 0 {
                continue;
            }
            i += 1;
            let row_schema = row.schema();
            schema = Schema::try_merge(vec![schema, row_schema.as_ref().to_owned()])?;
            let file_name = format!("{work_dir}{i}.parquet");
            let mut buf_parquet = Vec::new();
            let mut writer = ArrowWriter::try_new(&mut buf_parquet, row_schema.clone(), None)?;
            writer.write(row)?;
            writer.close().unwrap();
            tmpfs::set(&file_name, buf_parquet.into()).expect("tmpfs set success");
        }
    }
    Ok((Arc::new(schema), work_dir))
}

fn merge_rewrite_sql(sql: &str, schema: Arc<Schema>) -> Result<String> {
    let mut sql = sql.to_string();
    let mut fields = Vec::new();
    let mut from_pos = 0;
    let sql_chars = sql.chars().collect::<Vec<char>>();
    let sql_chars_len = sql_chars.len();
    let mut start_pos = 0;
    let mut in_word = false;
    let mut brackets = 0;
    let mut quotes = 0;
    let mut quote_now = '\"';
    for i in 0..sql_chars_len {
        let c = sql_chars.get(i).unwrap();
        if *c == '(' {
            brackets += 1;
            continue;
        }
        if *c == ')' {
            brackets -= 1;
            continue;
        }
        if *c == '"' || *c == '\'' {
            if quotes == 0 {
                quotes += 1;
                quote_now = *c;
                if !in_word {
                    start_pos = i;
                    in_word = true;
                }
                continue;
            }
            if quotes == 1 && quote_now == *c {
                quotes = 0;
                continue;
            }
        }
        if *c == ',' || *c == ' ' {
            if brackets > 0 || quotes > 0 {
                continue;
            }
            if in_word {
                let field = sql_chars[start_pos..i].iter().collect::<String>();
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

    let mut new_fields = Vec::new();
    let mut sel_fields_name = Vec::new();
    let mut sel_fields_has_star = false;
    let mut last_is_as = false;
    for (i, field) in fields.iter().enumerate() {
        let field = field.trim();
        if field.to_lowercase().eq("select") || field.to_lowercase().eq("distinct") {
            continue;
        }
        if field.to_lowercase().eq("as") {
            last_is_as = true;
            continue;
        }
        if last_is_as {
            new_fields.remove(new_fields.len() - 1);
            new_fields.push(format!("{} AS {field}", fields[i - 2]));
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
                    new_fields.push(format!("\"{field_name}\""));
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
        let cap = RE_FIELD_FN.captures(field).unwrap();
        let mut fn_name = cap.get(1).unwrap().as_str().to_lowercase();
        if !AGGREGATE_UDF_LIST.contains(&fn_name.as_str()) {
            fields[i] = format!("\"{}\"", schema.field(i).name());
            continue;
        }
        if fn_name == "count" {
            fn_name = "sum".to_string();
        }
        fields[i] = format!(
            "{fn_name}(\"{}\") as \"{}\"",
            schema.field(i).name(),
            schema.field(i).name()
        );
    }
    if need_rewrite {
        sql = format!("SELECT {} FROM {}", &fields.join(", "), &sql[from_pos..]);
        if sql.contains("_PLACEHOLDER_") {
            sql = sql.replace(r#""_PLACEHOLDER_", "#, "");
            sql = sql.replace(r#", "_PLACEHOLDER_""#, "");
        }
    }

    // delete where from sql
    let mut where_str = match RE_WHERE.captures(&sql) {
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
    session_id: &str,
    buf: &mut Vec<u8>,
    schema: Arc<Schema>,
    rules: HashMap<String, DataType>,
    file_type: FileType,
) -> Result<()> {
    let start = std::time::Instant::now();
    // query data
    let ctx = prepare_datafusion_context()?;

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
                "Unsupported file type scheme {file_type:?}",
            )));
        }
    };

    let prefix = match ListingTableUrl::parse(format!("tmpfs:///{session_id}/")) {
        Ok(url) => url,
        Err(e) => {
            return Err(datafusion::error::DataFusionError::Execution(format!(
                "ListingTableUrl error: {e}"
            )));
        }
    };

    let config = ListingTableConfig::new(prefix)
        .with_listing_options(listing_options)
        .with_schema(schema.clone());

    let table = ListingTable::try_new(config)?;
    ctx.register_table("tbl", Arc::new(table))?;

    // get all sorted data
    let query_sql = format!(
        "SELECT * FROM tbl ORDER BY {} DESC",
        CONFIG.common.column_timestamp
    );
    let mut df = match ctx.sql(&query_sql).await {
        Ok(df) => df,
        Err(e) => {
            log::error!(
                "convert sql execute failed, sql: {}, err: {:?}",
                query_sql,
                e
            );
            return Err(e);
        }
    };
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
    let schema = Arc::new(schema);
    let batches = df.collect().await?;
    let mut writer = super::new_writer(buf, &schema);
    for batch in batches {
        writer.write(&batch)?;
    }
    writer.close().unwrap();
    ctx.deregister_table("tbl")?;
    drop(ctx);

    log::info!(
        "convert_parquet_file took {:.3} seconds.",
        start.elapsed().as_secs_f64()
    );

    Ok(())
}

pub async fn merge_parquet_files(
    session_id: &str,
    buf: &mut Vec<u8>,
    schema: Arc<Schema>,
) -> Result<FileMeta> {
    let start = std::time::Instant::now();
    // query data
    let runtime_env = create_runtime_env()?;
    let session_config = SessionConfig::new()
        .with_information_schema(false)
        .with_batch_size(8192);
    let ctx = SessionContext::with_config_rt(session_config, Arc::new(runtime_env));

    // Configure listing options
    let file_format = ParquetFormat::default().with_enable_pruning(Some(false));
    let listing_options = ListingOptions::new(Arc::new(file_format))
        .with_file_extension(FileType::PARQUET.get_ext())
        .with_target_partitions(CONFIG.limit.cpu_num);
    let prefix = ListingTableUrl::parse(format!("tmpfs:///{session_id}/"))?;
    let config = ListingTableConfig::new(prefix)
        .with_listing_options(listing_options)
        .with_schema(schema);

    let table = ListingTable::try_new(config)?;
    ctx.register_table("tbl", Arc::new(table))?;

    // get meta data
    let meta_sql = format!(
        "SELECT MIN({}) as min_ts, MAX({}) as max_ts, COUNT(1) as num_records FROM tbl",
        CONFIG.common.column_timestamp, CONFIG.common.column_timestamp
    );
    let df = ctx.sql(&meta_sql).await?;
    let batches = df.collect().await?;
    let result = arrowJson::writer::record_batches_to_json_rows(&batches[..]).unwrap();
    let record = result.first().unwrap();
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
        CONFIG.common.column_timestamp
    );
    let df = ctx.sql(&query_sql).await?;
    let schema: Schema = df.schema().into();
    let schema = Arc::new(schema);
    let batches = df.collect().await?;
    let mut writer = super::new_writer(buf, &schema);
    for batch in batches {
        writer.write(&batch)?;
    }
    writer.close().unwrap();
    ctx.deregister_table("tbl")?;
    drop(ctx);

    log::info!(
        "merge_parquet_files took {:.3} seconds.",
        start.elapsed().as_secs_f64()
    );

    Ok(file_meta)
}

pub fn create_runtime_env() -> Result<RuntimeEnv> {
    let object_store_registry = DefaultObjectStoreRegistry::new();

    let fsm = super::storage::memory::FS::new();
    let fsm_url = url::Url::parse("fsm:///").unwrap();
    object_store_registry.register_store(&fsm_url, Arc::new(fsm));

    let fsn = super::storage::nocache::FS::new();
    let fsn_url = url::Url::parse("fsn:///").unwrap();
    object_store_registry.register_store(&fsn_url, Arc::new(fsn));

    let tmpfs = super::storage::tmpfs::Tmpfs::new();
    let tmpfs_url = url::Url::parse("tmpfs:///").unwrap();
    object_store_registry.register_store(&tmpfs_url, Arc::new(tmpfs));

    let rn_config =
        RuntimeConfig::new().with_object_store_registry(Arc::new(object_store_registry));
    RuntimeEnv::new(rn_config)
}

pub fn prepare_datafusion_context() -> Result<SessionContext, DataFusionError> {
    let runtime_env = create_runtime_env()?;
    let session_config = SessionConfig::new()
        .with_batch_size(8192)
        .set_bool("datafusion.execution.parquet.pushdown_filters", true);
    Ok(SessionContext::with_config_rt(
        session_config,
        Arc::new(runtime_env),
    ))
}

async fn register_udf(ctx: &mut SessionContext, _org_id: &str) {
    ctx.register_udf(super::match_udf::MATCH_UDF.clone());
    ctx.register_udf(super::match_udf::MATCH_IGNORE_CASE_UDF.clone());
    ctx.register_udf(super::regexp_udf::REGEX_MATCH_UDF.clone());
    ctx.register_udf(super::regexp_udf::REGEX_NOT_MATCH_UDF.clone());
    ctx.register_udf(super::time_range_udf::TIME_RANGE_UDF.clone());
    ctx.register_udf(super::date_format_udf::DATE_FORMAT_UDF.clone());

    {
        let udf_list = get_all_transform(_org_id).await;
        for udf in udf_list {
            ctx.register_udf(udf.clone());
        }
    }
}

pub async fn register_table(
    session: &SearchSession,
    schema: Arc<Schema>,
    table_name: &str,
    files: &[String],
    file_type: FileType,
) -> Result<SessionContext> {
    let ctx = prepare_datafusion_context()?;
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
                "Unsupported file type scheme {file_type:?}",
            )));
        }
    };

    let prefix = if session.storage_type.eq(&StorageType::FsMemory) {
        file_list::set(&session.id, files);
        format!("fsm:///{}/", session.id)
    } else if session.storage_type.eq(&StorageType::FsNoCache) {
        file_list::set(&session.id, files);
        format!("fsn:///{}/", session.id)
    } else if session.storage_type.eq(&StorageType::Tmpfs) {
        format!("tmpfs:///{}/", session.id)
    } else {
        return Err(DataFusionError::Execution(format!(
            "Unsupported file type scheme {file_type:?}",
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

    let config = ListingTableConfig::new(prefix)
        .with_listing_options(listing_options)
        .with_schema(schema);
    let table = ListingTable::try_new(config)?;
    ctx.register_table(table_name, Arc::new(table))?;

    Ok(ctx)
}

fn handle_query_fn(
    query_fn: String,
    batches: Vec<RecordBatch>,
    org_id: &str,
) -> Option<Vec<RecordBatch>> {
    match datafusion::arrow::json::writer::record_batches_to_json_rows(&batches) {
        Ok(json_rows) => apply_query_fn(query_fn, json_rows, org_id).unwrap_or(None),
        Err(_) => None,
    }
}

fn apply_query_fn(
    query_fn_src: String,
    in_batch: Vec<json::Map<String, json::Value>>,
    org_id: &str,
) -> Result<Option<Vec<RecordBatch>>> {
    use vector_enrichment::TableRegistry;

    let mut resp = vec![];
    let mut runtime = crate::common::functions::init_vrl_runtime();
    match crate::service::ingestion::compile_vrl_function(&query_fn_src, org_id) {
        Ok(program) => {
            let registry = program.config.get_custom::<TableRegistry>().unwrap();
            registry.finish_load();

            let rows_val: Vec<json::Value> = in_batch
                .iter()
                .filter_map(|hit| {
                    let ret_val = crate::service::ingestion::apply_vrl_fn(
                        &mut runtime,
                        &program,
                        &json::Value::Object(hit.clone()),
                    );
                    (!ret_val.is_null()).then_some(ret_val)
                })
                .collect();

            let first_rec = json::to_string(&rows_val.first()).unwrap();
            let mut schema_reader = std::io::BufReader::new(first_rec.as_bytes());
            let inf_schema = arrowJson::reader::infer_json_schema(&mut schema_reader, None)?;
            let mut decoder =
                arrow::json::RawReaderBuilder::new(Arc::new(inf_schema)).build_decoder()?;

            for value in rows_val {
                decoder
                    .decode(json::to_string(&value).unwrap().as_bytes())
                    .unwrap();
                resp.push(decoder.flush()?.unwrap());
            }
            Ok(Some(resp))
        }
        Err(_) => Ok(None),
    }
}

#[cfg(test)]
mod test {
    use arrow::array::Int32Array;
    use arrow_schema::Field;
    use datafusion::from_slice::FromSlice;

    use super::*;

    #[actix_web::test]
    async fn test_register_udf() {
        let mut ctx = SessionContext::new();
        let _ = register_udf(&mut ctx, "nexus").await;
        //assert!(res)
    }

    #[actix_web::test]
    async fn test_merge_write_recordbatch() {
        // define a schema.
        let schema = Arc::new(Schema::new(vec![Field::new("f", DataType::Int32, false)]));
        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int32Array::from_slice([1, 10, 10, 100]))],
        )
        .unwrap();

        let batch2 = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int32Array::from_slice([2, 20, 20, 200]))],
        )
        .unwrap();

        let res = merge_write_recordbatch(&[vec![batch, batch2]]).unwrap();
        assert!(!res.0.fields().is_empty());
        assert!(!res.1.is_empty())
    }

    #[actix_web::test]
    async fn test_merge() {
        // define a schema.
        let schema = Arc::new(Schema::new(vec![Field::new("f", DataType::Int32, false)]));
        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int32Array::from_slice([1, 10, 10, 100]))],
        )
        .unwrap();

        let batch2 = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int32Array::from_slice([2, 20, 20, 200]))],
        )
        .unwrap();

        let res = merge(
            "dummy",
            1,
            100,
            "select * from tbl limit 10",
            &vec![vec![batch, batch2]],
        )
        .await
        .unwrap();

        assert!(!res.is_empty())
    }
}
