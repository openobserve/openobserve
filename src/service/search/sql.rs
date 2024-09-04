// Copyright 2024 Zinc Labs Inc.
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

use std::collections::HashMap;

use chrono::Duration;
use config::{
    get_config,
    meta::{
        sql::{Sql as MetaSql, SqlOperator},
        stream::{FileKey, StreamPartition, StreamPartitionType, StreamType},
    },
    utils::sql::is_aggregate_query,
    QUERY_WITH_NO_LIMIT, QUICK_MODEL_FIELDS,
};
use datafusion::arrow::datatypes::{DataType, Schema};
use hashbrown::HashSet;
use infra::{
    errors::{Error, ErrorCodes},
    schema::{
        get_stream_setting_fts_fields, get_stream_setting_index_fields, STREAM_SCHEMAS_FIELDS,
    },
};
use itertools::Itertools;
use once_cell::sync::Lazy;
use proto::cluster_rpc;
use regex::Regex;
use serde::Serialize;
use sqlparser::ast::{BinaryOperator, Expr, Ident};

use crate::{common::meta::stream::StreamParams, service::search::match_source};

const SQL_DELIMITERS: [u8; 12] = [
    b' ', b'*', b'(', b')', b'<', b'>', b',', b';', b'=', b'!', b'\r', b'\n',
];

pub static RE_ONLY_SELECT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)select[ ]+\*").unwrap());
pub static RE_SELECT_FROM: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)SELECT (.*) FROM").unwrap());
pub static RE_SELECT_WILDCARD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)select\s+\*\s+from").unwrap());
pub static RE_WHERE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i) where (.*)").unwrap());

pub static RE_HISTOGRAM: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)histogram\(([^\)]*)\)").unwrap());
static RE_MATCH_ALL_RAW: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)match_all_raw\('([^']*)'\)").unwrap());
static RE_MATCH_ALL_RAW_IGNORE_CASE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)match_all_raw_ignore_case\('([^']*)'\)").unwrap());
static RE_MATCH_ALL: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)match_all\('([^']*)'\)").unwrap());

#[derive(Clone, Debug, Serialize)]
pub struct Sql {
    pub origin_sql: String,
    pub rewrite_sql: String,
    pub org_id: String,
    pub stream_type: StreamType,
    pub stream_name: String,
    pub meta: MetaSql,
    pub fulltext: Vec<(String, String)>,
    pub fast_mode: bool, /* there is no group by, no aggregatioin,
                          * no where or only 1 equality where clause with term as a partition
                          * key, we can just get data from the latest file */
    pub schema: Schema,
    pub uses_zo_fn: bool,
    pub query_fn: Option<String>,
    pub fts_terms: Vec<String>,
    pub index_terms: Vec<(String, Vec<String>)>,
    pub histogram_interval: Option<i64>,
    pub use_inverted_index: bool,
    pub inverted_index_type: String,
}

impl Sql {
    pub async fn new(req: &cluster_rpc::SearchRequest) -> Result<Sql, Error> {
        let req_query = req.query.as_ref().unwrap();
        let org_id = req.org_id.clone();
        let stream_type = StreamType::from(req.stream_type.as_str());

        let mut req_time_range = (req_query.start_time, req_query.end_time);
        if req_time_range.1 == 0 {
            req_time_range.1 = chrono::Utc::now().timestamp_micros();
        }

        // parse sql
        let mut origin_sql = req_query.sql.clone();
        let mut rewrite_sql = req_query.sql.clone();
        // log::info!("origin_sql: {:?}", origin_sql);
        origin_sql = origin_sql.replace('\n', " ");
        origin_sql = origin_sql.trim().to_string();
        if origin_sql.ends_with(';') {
            origin_sql.pop();
        }
        origin_sql = split_sql_token(&origin_sql).join("");
        let mut meta = match MetaSql::new(&origin_sql) {
            Ok(meta) => meta,
            Err(err) => {
                log::error!(
                    "split_sql_token: parse sql error: {}, sql: {}",
                    err,
                    origin_sql
                );
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(origin_sql)));
            }
        };

        // Hack for table name
        // DataFusion disallow use `k8s-logs-2022.09.11` as table name
        let stream_name = meta.source.clone();

        let track_total_hits = req_query.track_total_hits && meta.limit == 0;
        let fast_mode = !track_total_hits
            && is_fast_mode(&meta, &origin_sql, &org_id, &stream_type, &stream_name).await;

        let cfg = get_config();

        let re = Regex::new(&format!(r#"(?i) from[ '"]+{stream_name}[ '"]?"#)).unwrap();

        // Check if at least one match exists
        if re.captures(&origin_sql).is_none() {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(origin_sql)));
        }
        origin_sql = re.replace_all(&origin_sql, " FROM tbl ").to_string();

        // Hack select for _timestamp, add _timestamp to select clause
        let is_aggregate = is_aggregate_query(&origin_sql).unwrap_or_default();
        if !is_aggregate
            && meta.group_by.is_empty()
            && meta.order_by.is_empty()
            && !origin_sql.contains('*')
        {
            let caps = RE_SELECT_FROM.captures(origin_sql.as_str()).unwrap();
            let cap_str = caps.get(1).unwrap().as_str();
            if !cap_str.contains(&cfg.common.column_timestamp) {
                origin_sql = origin_sql.replacen(
                    cap_str,
                    &format!("{}, {}", &cfg.common.column_timestamp, cap_str),
                    1,
                );
            }
        }

        // check time_range values
        if req_time_range.0 > 0
            && req_time_range.0
                < Duration::try_seconds(1)
                    .unwrap()
                    .num_microseconds()
                    .unwrap()
        {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "Query SQL time_range start_time should be microseconds".to_string(),
            )));
        }
        if req_time_range.1 > 0
            && req_time_range.1
                < Duration::try_seconds(1)
                    .unwrap()
                    .num_microseconds()
                    .unwrap()
        {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "Query SQL time_range start_time should be microseconds".to_string(),
            )));
        }
        if req_time_range.0 > 0 && req_time_range.1 > 0 && req_time_range.1 < req_time_range.0 {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "Query SQL time_range start_time should be less than end_time".to_string(),
            )));
        }

        // Hack time_range for sql, add time range to where clause
        let meta_time_range_is_empty = meta.time_range.is_none() || meta.time_range == Some((0, 0));
        if meta_time_range_is_empty && (req_time_range.0 > 0 || req_time_range.1 > 0) {
            meta.time_range = Some(req_time_range); // update meta
        };

        let mut rewrite_time_range_sql = origin_sql.clone();
        if let Some(time_range) = meta.time_range {
            let time_range_sql = if time_range.0 > 0 && time_range.1 > 0 {
                format!(
                    "({} >= {} AND {} < {})",
                    cfg.common.column_timestamp,
                    time_range.0,
                    cfg.common.column_timestamp,
                    time_range.1
                )
            } else if time_range.0 > 0 {
                format!("{} >= {}", cfg.common.column_timestamp, time_range.0)
            } else if time_range.1 > 0 {
                format!("{} < {}", cfg.common.column_timestamp, time_range.1)
            } else {
                "".to_string()
            };
            if !time_range_sql.is_empty()
                && meta_time_range_is_empty
                && req_query.size > QUERY_WITH_NO_LIMIT
            {
                match pickup_where(&rewrite_time_range_sql, Some(meta.clone()))? {
                    Some(where_str) => {
                        let pos_start = rewrite_time_range_sql.find(where_str.as_str()).unwrap();
                        let pos_end = pos_start + where_str.len();
                        rewrite_time_range_sql = format!(
                            "{}{} AND ({}){}",
                            &rewrite_time_range_sql[0..pos_start],
                            time_range_sql,
                            where_str,
                            &rewrite_time_range_sql[pos_end..]
                        );
                    }
                    None => {
                        rewrite_time_range_sql = rewrite_time_range_sql
                            .replace(" FROM tbl", &format!(" FROM tbl WHERE {time_range_sql}"));
                    }
                };
            }
        }

        // Hack offset limit and sort by for sql
        origin_sql = rewrite_time_range_sql;
        if meta.limit == 0 && req_query.size > QUERY_WITH_NO_LIMIT {
            meta.offset = req_query.from as i64;
            // If `size` is negative, use the backend's default limit setting
            meta.limit = if req_query.size >= 0 {
                req_query.size as i64
            } else {
                cfg.limit.query_default_limit * std::cmp::max(1, meta.group_by.len() as i64)
            };
            origin_sql = if meta.order_by.is_empty()
                && ((meta.group_by.is_empty()
                    && !origin_sql
                        .to_lowercase()
                        .split(" from ")
                        .next()
                        .unwrap_or_default()
                        .contains('('))
                    && !origin_sql.to_lowercase().contains("distinct"))
            {
                let sort_by = if req_query.sort_by.is_empty() {
                    meta.order_by = vec![(cfg.common.column_timestamp.to_string(), true)];
                    format!("{} DESC", cfg.common.column_timestamp)
                } else {
                    if req_query.sort_by.to_uppercase().ends_with(" DESC") {
                        meta.order_by = vec![(
                            req_query.sort_by[0..req_query.sort_by.len() - 5].to_string(),
                            true,
                        )];
                    } else if req_query.sort_by.to_uppercase().ends_with(" ASC") {
                        meta.order_by = vec![(
                            req_query.sort_by[0..req_query.sort_by.len() - 4].to_string(),
                            false,
                        )];
                    }
                    req_query.sort_by.clone()
                };
                format!(
                    "{} ORDER BY {} LIMIT {}",
                    origin_sql,
                    sort_by,
                    meta.offset + meta.limit
                )
            } else {
                format!("{} LIMIT {}", origin_sql, meta.offset + meta.limit)
            };
        }

        // fetch schema
        let schema = match infra::schema::get(&org_id, &meta.source, stream_type).await {
            Ok(schema) => schema,
            Err(_) => Schema::empty(),
        };
        let schema_fields = schema.fields().to_vec();
        let stream_settings = infra::schema::unwrap_stream_settings(&schema);

        // fetch inverted index fields
        let mut fts_terms = HashSet::new();
        let fts_fields = get_stream_setting_fts_fields(&stream_settings);
        let mut index_terms = HashMap::new();
        let index_fields = get_stream_setting_index_fields(&stream_settings);

        // Hack for quick_mode
        // replace `select *` to `select f1,f2,f3`
        if (req_query.quick_mode || cfg.limit.quick_mode_force_enabled)
            && schema_fields.len() > cfg.limit.quick_mode_num_fields
            && RE_ONLY_SELECT.is_match(&origin_sql)
        {
            let stream_key = format!("{}/{}/{}", org_id, stream_type, meta.source);
            let cached_fields: Option<Vec<String>> = if cfg.limit.quick_mode_file_list_enabled {
                STREAM_SCHEMAS_FIELDS
                    .read()
                    .await
                    .get(&stream_key)
                    .map(|v| v.1.clone())
            } else {
                None
            };
            let fields = generate_quick_mode_fields(&schema, cached_fields, &fts_fields);
            let select_fields = "SELECT ".to_string() + &fields.join(",");
            origin_sql = RE_ONLY_SELECT
                .replace(origin_sql.as_str(), &select_fields)
                .to_string();
            // rewrite distribution sql
            rewrite_sql = RE_ONLY_SELECT
                .replace(rewrite_sql.as_str(), &select_fields)
                .to_string();
            // reset meta fields
            meta.fields.extend(fields);
        }

        // get sql where tokens
        let where_tokens = split_sql_token(&origin_sql);
        let where_pos = where_tokens
            .iter()
            .position(|x| x.to_lowercase() == "where");
        let where_tokens = if let Some(v) = where_pos {
            where_tokens[v + 1..].to_vec()
        } else {
            Vec::new()
        };

        // HACK full text search
        let mut fulltext = Vec::new();
        let mut indexed_text = Vec::new();
        for token in &where_tokens {
            let tokens = split_sql_token_unwrap_brace(token);
            for token in &tokens {
                if !token.to_lowercase().starts_with("match_all") {
                    continue;
                }
                for cap in RE_MATCH_ALL_RAW.captures_iter(token) {
                    fulltext.push((cap[0].to_string(), cap[1].to_string()));
                }
                for cap in RE_MATCH_ALL_RAW_IGNORE_CASE.captures_iter(token) {
                    fulltext.push((cap[0].to_string(), cap[1].to_lowercase()));
                }
                for cap in RE_MATCH_ALL.captures_iter(token) {
                    indexed_text.push((cap[0].to_string(), cap[1].to_lowercase())); // since `terms` are indexed in lowercase
                }
            }
        }

        // use full text search instead if inverted index feature is not enabled but it's an
        // inverted index search
        let ignore_case = if !cfg.common.inverted_index_enabled && fulltext.is_empty() {
            fulltext = std::mem::take(&mut indexed_text);
            true
        } else {
            false
        };

        // Iterator for indexed texts only
        for item in indexed_text.iter() {
            let mut indexed_search = Vec::new();
            for field in &schema_fields {
                if !fts_fields.contains(&field.name().to_lowercase()) {
                    continue;
                }
                if !field.data_type().eq(&DataType::Utf8) || field.name().starts_with('@') {
                    continue;
                }
                // since data in file can be in uppercase, we need to use ILIKE
                indexed_search.push(format!("\"{}\" ILIKE '%{}%'", field.name(), item.1));
                // add full text field to meta fields
                meta.fields.push(field.name().to_string());
                fts_terms.insert(item.1.clone());
            }
            if indexed_search.is_empty() {
                return Err(Error::ErrorCode(ErrorCodes::FullTextSearchFieldNotFound));
            }
            let indexed_search = format!("({})", indexed_search.join(" OR "));
            origin_sql = origin_sql.replace(item.0.as_str(), &indexed_search);
        }

        for item in fulltext.iter() {
            let mut fulltext_search = Vec::new();
            for field in &schema_fields {
                if !fts_fields.contains(&field.name().to_lowercase()) {
                    continue;
                }
                if !field.data_type().eq(&DataType::Utf8) || field.name().starts_with('@') {
                    continue;
                }
                let mut func = "LIKE";
                if ignore_case || item.0.to_lowercase().contains("_ignore_case") {
                    func = "ILIKE";
                }
                fulltext_search.push(format!("\"{}\" {} '%{}%'", field.name(), func, item.1));
                // add full text field to meta fields
                meta.fields.push(field.name().to_string());
            }
            if fulltext_search.is_empty() {
                return Err(Error::ErrorCode(ErrorCodes::FullTextSearchFieldNotFound));
            }
            let fulltext_search = format!("({})", fulltext_search.join(" OR "));
            origin_sql = origin_sql.replace(item.0.as_str(), &fulltext_search);
        }

        // Hack for index fields
        let filters = generate_filter_from_quick_text(&meta.quick_text);
        if !index_fields.is_empty() && !filters.is_empty() {
            let index_fields = index_fields.iter().collect::<HashSet<_>>();
            for (key, value) in filters {
                if !index_fields.contains(&key.to_string()) {
                    continue;
                }
                let value = value
                    .into_iter()
                    .filter(|v| !v.is_empty())
                    .collect::<Vec<_>>();
                if value.is_empty() {
                    continue;
                }
                let entry = index_terms
                    .entry(key.to_string())
                    .or_insert_with(HashSet::new);
                for v in value {
                    entry.insert(v);
                }
            }
        }

        // Hack for histogram
        let mut histogram_interval = None;
        let from_pos = origin_sql.to_lowercase().find(" from ").unwrap();
        let select_str = origin_sql[0..from_pos].to_string();
        for cap in RE_HISTOGRAM.captures_iter(select_str.as_str()) {
            let attrs = cap
                .get(1)
                .unwrap()
                .as_str()
                .split(',')
                .map(|v| v.trim().trim_matches(|v| v == '\'' || v == '"'))
                .collect::<Vec<&str>>();
            let field = attrs.first().unwrap();
            let interval = match attrs.get(1) {
                Some(v) => match v.parse::<u16>() {
                    Ok(v) => generate_histogram_interval(meta.time_range, v),
                    Err(_) => v.to_string(),
                },
                None => generate_histogram_interval(meta.time_range, 0),
            };
            origin_sql = origin_sql.replace(
                cap.get(0).unwrap().as_str(),
                &format!(
                    "date_bin(interval '{interval}', to_timestamp_micros(\"{field}\"), to_timestamp('2001-01-01T00:00:00'))",
                )
            );
            if histogram_interval.is_none() {
                histogram_interval = Some(convert_histogram_interval_to_seconds(&interval)?);
            }
        }

        // pickup where
        let where_str = match pickup_where(&origin_sql, Some(meta.clone()))? {
            Some(where_str) => where_str,
            None => "".to_string(),
        };

        // Hack for track total hits
        if track_total_hits {
            let sql = if where_str.is_empty() {
                "SELECT COUNT(*) as zo_sql_num FROM tbl".to_string()
            } else {
                format!("SELECT COUNT(*) as zo_sql_num FROM tbl WHERE {}", where_str)
            };
            let sql_meta = MetaSql::new(sql.clone().as_str());
            if sql_meta.is_err() {
                log::error!(
                    "sql_meta: parse track_total_hits sql error: {}, sql: {}",
                    sql_meta.err().unwrap(),
                    sql
                );
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(sql)));
            }
            origin_sql = sql;
        }

        let sql_meta = MetaSql::new(origin_sql.clone().as_str());
        match &sql_meta {
            Ok(sql_meta) => {
                let mut used_fns = vec![];
                for fn_name in
                    crate::common::utils::functions::get_all_transform_keys(&org_id).await
                {
                    let str_re = format!(r"(?i){}[ ]*\(.*\)", fn_name);

                    if let Ok(re1) = Regex::new(&str_re) {
                        let cap = re1.captures(&origin_sql);
                        if cap.is_some() {
                            for _ in 0..cap.unwrap().len() {
                                used_fns.push(fn_name.clone());
                            }
                        }
                    }
                }
                if sql_meta.field_alias.len() < used_fns.len() {
                    return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                        "Please use alias for function used in query.".to_string(),
                    )));
                }
            }
            Err(e) => {
                log::error!("final sql: parse sql error: {}, sql: {}", e, origin_sql);
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(origin_sql)));
            }
        }

        let query_fn = if req_query.query_fn.is_empty() {
            None
        } else {
            Some(req_query.query_fn.clone())
        };

        // check if we can use inverted index
        // if there are some OR conditions in the where clause and not all of index field, we can't
        // use inverted index
        let use_inverted_index = if stream_type == StreamType::Index {
            false
        } else {
            checking_inverted_index(&meta, &fts_fields, &index_fields)
        };

        // check index search type
        let inverted_index_type = if req.index_type.is_empty() {
            cfg.common.inverted_index_search_format.clone()
        } else {
            req.index_type.clone()
        };

        Ok(Sql {
            origin_sql,
            rewrite_sql,
            org_id,
            stream_type,
            stream_name,
            meta,
            fulltext,
            fast_mode,
            schema,
            uses_zo_fn: req_query.uses_zo_fn,
            query_fn,
            fts_terms: fts_terms.into_iter().collect(),
            index_terms: index_terms
                .into_iter()
                .map(|(k, v)| (k, v.into_iter().collect()))
                .collect(),
            histogram_interval,
            use_inverted_index,
            inverted_index_type,
        })
    }

    /// match a source is a valid file or not
    pub async fn match_source(
        &self,
        source: &FileKey,
        match_min_ts_only: bool,
        is_wal: bool,
        stream_type: StreamType,
        partition_keys: &[StreamPartition],
    ) -> bool {
        let mut filters = generate_filter_from_quick_text(&self.meta.quick_text);
        // rewrite partition filters
        let partition_keys: HashMap<&str, &StreamPartition> = partition_keys
            .iter()
            .map(|v| (v.field.as_str(), v))
            .collect();
        for entry in filters.iter_mut() {
            if let Some(partition_key) = partition_keys.get(entry.0) {
                for val in entry.1.iter_mut() {
                    *val = partition_key.get_partition_value(val);
                }
            }
        }
        match_source(
            StreamParams::new(&self.org_id, &self.stream_name, stream_type),
            self.meta.time_range,
            filters.as_slice(),
            source,
            is_wal,
            match_min_ts_only,
        )
        .await
    }
}

pub fn generate_filter_from_quick_text(
    data: &[(String, String, SqlOperator)],
) -> Vec<(&str, Vec<String>)> {
    let quick_text_len = data.len();
    let mut filters = HashMap::with_capacity(quick_text_len);
    for i in 0..quick_text_len {
        let (k, v, op) = &data[i];
        if op == &SqlOperator::And
            || (op == &SqlOperator::Or && (i + 1 == quick_text_len || k == &data[i + 1].0))
        {
            let entry = filters.entry(k.as_str()).or_insert_with(Vec::new);
            entry.push(v.to_string());
        } else {
            filters.clear();
            break;
        }
    }
    filters.into_iter().collect::<Vec<(_, _)>>()
}

pub(crate) fn generate_quick_mode_fields(
    schema: &Schema,
    cached_fields: Option<Vec<String>>,
    fts_fields: &[String],
) -> Vec<String> {
    let cfg = get_config();
    let strategy = cfg.limit.quick_mode_strategy.to_lowercase();
    let schema_fields = match cached_fields {
        Some(v) => v,
        None => schema
            .fields()
            .iter()
            .map(|f| f.name().to_string())
            .collect(),
    };
    let mut fields = match strategy.as_str() {
        "last" => {
            let skip = std::cmp::max(0, schema_fields.len() - cfg.limit.quick_mode_num_fields);
            schema_fields.into_iter().skip(skip).collect()
        }
        "both" => {
            let need_num = std::cmp::min(schema_fields.len(), cfg.limit.quick_mode_num_fields);
            let mut inner_fields = schema_fields
                .iter()
                .take(need_num / 2)
                .map(|f| f.to_string())
                .collect::<Vec<_>>();
            if schema_fields.len() > inner_fields.len() {
                let skip = std::cmp::max(0, schema_fields.len() + inner_fields.len() - need_num);
                inner_fields.extend(schema_fields.iter().skip(skip).map(|f| f.to_string()));
            }
            inner_fields
        }
        _ => {
            // default is first mode
            schema_fields
                .into_iter()
                .take(cfg.limit.quick_mode_num_fields)
                .collect()
        }
    };
    // check _timestamp
    if !fields.contains(&cfg.common.column_timestamp) {
        fields.push(cfg.common.column_timestamp.to_string());
    }
    // check fts fields
    for field in fts_fields {
        if !fields.contains(field) && schema.field_with_name(field).is_ok() {
            fields.push(field.to_string());
        }
    }
    // check quick mode fields
    for field in QUICK_MODEL_FIELDS.iter() {
        if !fields.contains(field) && schema.field_with_name(field).is_ok() {
            fields.push(field.to_string());
        }
    }
    fields
}

pub fn generate_histogram_interval(time_range: Option<(i64, i64)>, num: u16) -> String {
    if time_range.is_none() || time_range.unwrap().eq(&(0, 0)) {
        return "1 hour".to_string();
    }
    let time_range = time_range.unwrap();
    if num > 0 {
        return format!(
            "{} second",
            std::cmp::max(
                (time_range.1 - time_range.0)
                    / Duration::try_seconds(1)
                        .unwrap()
                        .num_microseconds()
                        .unwrap()
                    / num as i64,
                1
            )
        );
    }

    let intervals = [
        (Duration::try_hours(24 * 60), "1 day"),
        (Duration::try_hours(24 * 30), "12 hour"),
        (Duration::try_hours(24 * 28), "6 hour"),
        (Duration::try_hours(24 * 21), "3 hour"),
        (Duration::try_hours(24 * 14), "2 hour"),
        (Duration::try_hours(24 * 7), "1 hour"),
        (Duration::try_hours(24), "30 minute"),
        (Duration::try_hours(6), "5 minute"),
        (Duration::try_hours(2), "1 minute"),
        (Duration::try_hours(1), "30 second"),
        (Duration::try_minutes(30), "15 second"),
        (Duration::try_minutes(15), "10 second"),
    ];
    for (time, interval) in intervals.iter() {
        let time = time.unwrap().num_microseconds().unwrap();
        if (time_range.1 - time_range.0) >= time {
            return interval.to_string();
        }
    }
    "10 second".to_string()
}

pub fn convert_histogram_interval_to_seconds(interval: &str) -> Result<i64, Error> {
    let Some((num, unit)) = interval.splitn(2, ' ').collect_tuple() else {
        return Err(Error::Message("Invalid interval format".to_string()));
    };
    let seconds = match unit.to_lowercase().as_str() {
        "second" | "seconds" => num.parse::<i64>(),
        "minute" | "minutes" => num.parse::<i64>().map(|n| n * 60),
        "hour" | "hours" => num.parse::<i64>().map(|n| n * 3600),
        "day" | "days" => num.parse::<i64>().map(|n| n * 86400),
        _ => {
            return Err(Error::Message(
                "Unsupported histogram interval unit".to_string(),
            ));
        }
    };
    seconds.map_err(|_| Error::Message("Invalid number format".to_string()))
}

pub fn pickup_where(sql: &str, meta: Option<MetaSql>) -> Result<Option<String>, Error> {
    let meta = match meta {
        Some(v) => v,
        None => match MetaSql::new(sql) {
            Ok(meta) => meta,
            Err(_) => {
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                    sql.to_string(),
                )));
            }
        },
    };
    let Some(caps) = RE_WHERE.captures(sql) else {
        return Ok(None);
    };
    let mut where_str = caps.get(1).unwrap().as_str().to_string();
    if !meta.group_by.is_empty() {
        where_str = where_str[0..where_str.to_lowercase().rfind(" group ").unwrap()].to_string();
    } else if meta.having {
        where_str = where_str[0..where_str.to_lowercase().rfind(" having ").unwrap()].to_string();
    } else if !meta.order_by.is_empty() {
        where_str = where_str[0..where_str.to_lowercase().rfind(" order ").unwrap()].to_string();
    } else if meta.limit > 0 || where_str.to_lowercase().ends_with(" limit 0") {
        where_str = where_str[0..where_str.to_lowercase().rfind(" limit ").unwrap()].to_string();
    } else if meta.offset > 0 {
        where_str = where_str[0..where_str.to_lowercase().rfind(" offset ").unwrap()].to_string();
    }
    Ok(Some(where_str))
}

fn closing_brace_index(opening_brace_index: usize, expr: &str) -> Option<usize> {
    let mut brace_count = 0;
    for (i, c) in expr[opening_brace_index..].chars().enumerate() {
        if c == '(' {
            brace_count += 1;
        }
        if c == ')' {
            brace_count -= 1;
        }
        if brace_count == 0 {
            return Some(opening_brace_index + i);
        }
    }

    None
}

fn split_sql_token_unwrap_brace(token: &str) -> Vec<String> {
    if token.is_empty() {
        return vec![];
    }
    if token.starts_with('(')
        && token.ends_with(')')
        && closing_brace_index(0, token) == Some(token.len() - 1)
    {
        return split_sql_token_unwrap_brace(&token[1..token.len() - 1]);
    }
    let tokens = split_sql_token(token);
    let mut fin_tokens = Vec::with_capacity(tokens.len());
    for token in tokens {
        if token.starts_with('(') && token.ends_with(')') {
            fin_tokens.extend(split_sql_token_unwrap_brace(&token[1..token.len() - 1]));
        } else {
            fin_tokens.push(token);
        }
    }
    fin_tokens
}

fn split_sql_token(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let text_chars = text.chars().collect::<Vec<char>>();
    let text_chars_len = text_chars.len();
    let mut start_pos = 0;
    let mut in_word = false;
    let mut bracket = 0;
    let mut in_quote = false;
    let mut quote = ' ';
    for i in 0..text_chars_len {
        let c = text_chars.get(i).unwrap();
        if !in_quote && *c == '(' {
            bracket += 1;
            continue;
        }
        if !in_quote && *c == ')' {
            bracket -= 1;
            continue;
        }
        if *c == '\'' || *c == '"' {
            if in_quote {
                if quote == *c {
                    in_quote = false;
                }
            } else {
                in_quote = true;
                quote = *c;
            }
        }
        if SQL_DELIMITERS.contains(&(*c as u8)) {
            if bracket > 0 || in_quote {
                continue;
            }
            if in_word {
                let token = text_chars[start_pos..i].iter().collect::<String>();
                tokens.push(token);
            }
            tokens.push(String::from_utf8(vec![*c as u8]).unwrap());
            in_word = false;
            start_pos = i + 1;
            continue;
        }
        if in_word {
            continue;
        }
        in_word = true;
    }
    if start_pos != text_chars_len {
        let token = text_chars[start_pos..text_chars_len]
            .iter()
            .collect::<String>();
        tokens.push(token);
    }

    // filter tokens by break line
    for token in tokens.iter_mut() {
        if token.eq(&"\r\n") || token.eq(&"\n") {
            *token = " ".to_string();
        }
    }
    tokens
}

/// need check some things:
///  1. no where or 1 equality where clause and term is partition key
///  2. no aggregation
///  3. no group by
async fn is_fast_mode(
    meta: &MetaSql,
    origin_sql: &str,
    org_id: &str,
    stream_type: &StreamType,
    stream_name: &str,
) -> bool {
    let cfg = get_config();
    if meta.group_by.is_empty()
        && (meta.order_by.is_empty() || meta.order_by[0].0 == cfg.common.column_timestamp)
        && !meta.fields.iter().any(|f| f.contains('('))
        && !meta.field_alias.iter().any(|f| f.0.contains('('))
        && !origin_sql.to_lowercase().contains("distinct")
    {
        match &meta.selection {
            None => true,
            Some(selection) => match selection {
                Expr::BinaryOp { left, op, right: _ } => match (left.as_ref(), op) {
                    (
                        Expr::Identifier(Ident {
                            value,
                            quote_style: _,
                        }),
                        BinaryOperator::Eq,
                    ) => {
                        let partition_det = crate::service::ingestion::get_stream_partition_keys(
                            org_id,
                            stream_type,
                            stream_name,
                        )
                        .await;
                        partition_det.partition_keys.iter().any(|stream_partition| {
                            stream_partition.types == StreamPartitionType::Value
                                && stream_partition.field == *value
                        })
                    }
                    _ => false,
                },
                _ => false,
            },
        }
    } else {
        false
    }
}

/// need check some things: all the conditions should be AND or all the fiels are index fields
fn checking_inverted_index(meta: &MetaSql, fts_fields: &[String], index_fields: &[String]) -> bool {
    let Some(selection) = &meta.selection else {
        return false;
    };
    let index_fields =
        itertools::chain(fts_fields.iter(), index_fields.iter()).collect::<HashSet<_>>();
    checking_inverted_index_inner(&index_fields, selection)
}

fn checking_inverted_index_inner(index_fields: &HashSet<&String>, expr: &Expr) -> bool {
    match expr {
        Expr::Identifier(Ident {
            value,
            quote_style: _,
        }) => index_fields.contains(value),
        Expr::Nested(expr) => checking_inverted_index_inner(index_fields, expr),
        Expr::BinaryOp { left, op, right } => match op {
            BinaryOperator::And => true,
            BinaryOperator::Or => {
                checking_inverted_index_inner(index_fields, left)
                    && checking_inverted_index_inner(index_fields, right)
            }
            BinaryOperator::Eq => checking_inverted_index_inner(index_fields, left),
            _ => false,
        },
        Expr::Like {
            negated: _,
            expr,
            pattern: _,
            escape_char: _,
        } => checking_inverted_index_inner(index_fields, expr),
        Expr::Function(f) => f.name.to_string().starts_with("match_all"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_sql_works() {
        let org_id = "test_org";
        let col = "_timestamp";
        let table = "default";
        let query = config::meta::search::Query {
            sql: format!("select {} from {} ", col, table),
            from: 0,
            size: 100,
            quick_mode: false,
            query_type: "".to_owned(),
            start_time: 1667978895416,
            end_time: 1667978900217,
            sort_by: None,
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
        };

        let req: config::meta::search::Request = config::meta::search::Request {
            query,
            encoding: config::meta::search::RequestEncoding::Empty,
            regions: vec![],
            clusters: vec![],
            timeout: 0,
            search_type: None,
            index_type: "".to_string(),
        };

        let mut rpc_req: cluster_rpc::SearchRequest = req.to_owned().into();
        rpc_req.org_id = org_id.to_string();

        let resp = Sql::new(&rpc_req).await.unwrap();
        assert_eq!(resp.stream_name, table);
        assert_eq!(resp.org_id, org_id);
        assert!(resp.meta.fields.contains(&col.to_string()));
    }

    #[tokio::test]
    async fn test_sql_contexts() {
        let sqls = [
            ("select * from table1", true, (0, 0)),
            ("select * from table1 where a=1", true, (0, 0)),
            ("select * from table1 where a='b'", true, (0, 0)),
            (
                "select * from table1 where a='b' limit 10 offset 10",
                true,
                (0, 0),
            ),
            (
                "select * from table1 where a='b' group by abc",
                true,
                (0, 0),
            ),
            (
                "select * from table1 where a='b' group by abc having count(*) > 19",
                true,
                (0, 0),
            ),
            ("select * from table1, table2 where a='b'", false, (0, 0)),
            (
                "select * from table1 left join table2 on table1.a=table2.b where a='b'",
                false,
                (0, 0),
            ),
            (
                "select * from table1 union select * from table2 where a='b'",
                false,
                (0, 0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  openobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150'",
                true,
                (0, 0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  openobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150' order by _timestamp desc limit 10 offset 10",
                true,
                (0, 0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  openobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150' AND time_range(_timestamp, 1679202494333000, 1679203394333000) order by _timestamp desc",
                true,
                (1679202494333000, 1679203394333000),
            ),
            (
                "select * from table1 WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000 AND str_match(log, 's')) order by _timestamp desc",
                true,
                (1679202494333000, 1679203394333000),
            ),
            (
                "select * from table1 WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000 AND str_match(log, 's') AND str_match_IGNORE_CASE(log, 's')) order by _timestamp desc",
                true,
                (1679202494333000, 1679203394333000),
            ),
            (
                "select * from table1 where match_all('abc') order by _timestamp desc limit 10 offset 10",
                false,
                (0, 0),
            ),
            (
                "select * from table1 where match_all('abc') and str_match(log,'abc') order by _timestamp desc",
                false,
                (0, 0),
            ),
            (
                "select abc, count(*) as cnt from table1 where match_all('abc') and str_match(log,'abc') group by abc having cnt > 1 order by _timestamp desc limit 10",
                false,
                (0, 0),
            ),
        ];

        let org_id = "test_org";
        for (sql, ok, time_range) in sqls {
            let query = config::meta::search::Query {
                sql: sql.to_string(),
                from: 0,
                size: 100,
                quick_mode: false,
                query_type: "".to_owned(),
                start_time: 1667978895416,
                end_time: 1667978900217,
                sort_by: None,
                track_total_hits: true,
                uses_zo_fn: false,
                query_fn: None,
                skip_wal: false,
            };
            let req = config::meta::search::Request {
                query: query.clone(),
                encoding: config::meta::search::RequestEncoding::Empty,
                regions: vec![],
                clusters: vec![],
                timeout: 0,
                search_type: None,
                index_type: "".to_string(),
            };
            let mut rpc_req: cluster_rpc::SearchRequest = req.to_owned().into();
            rpc_req.org_id = org_id.to_string();

            let resp = Sql::new(&rpc_req).await;
            println!("sql: {}", sql);
            assert_eq!(resp.is_ok(), ok);
            if ok {
                let resp = resp.unwrap();
                assert_eq!(resp.stream_name, "table1");
                assert_eq!(resp.org_id, org_id);
                if time_range.0 > 0 {
                    assert_eq!(resp.meta.time_range, Some((time_range.0, time_range.1)));
                } else {
                    assert_eq!(
                        resp.meta.time_range,
                        Some((query.start_time, query.end_time))
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn test_sql_full() {
        let sqls = [
            ("select * from table1", true, 0, (0, 0)),
            ("select * from table1 where a=1", true, 0, (0, 0)),
            ("select * from table1 where a='b'", true, 0, (0, 0)),
            (
                "select * from table1 where a='b' limit 10 offset 10",
                true,
                10,
                (0, 0),
            ),
            (
                "select * from table1 where a='b' group by abc",
                true,
                0,
                (0, 0),
            ),
            (
                "select * from table1 where a='b' group by abc having count(*) > 19",
                true,
                0,
                (0, 0),
            ),
            ("select * from table1, table2 where a='b'", false, 0, (0, 0)),
            (
                "select * from table1 left join table2 on table1.a=table2.b where a='b'",
                false,
                0,
                (0, 0),
            ),
            (
                "select * from table1 union select * from table2 where a='b'",
                false,
                0,
                (0, 0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  openobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150'",
                true,
                0,
                (0, 0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  openobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150' order by _timestamp desc limit 10 offset 10",
                true,
                10,
                (0, 0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  openobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150' AND time_range(_timestamp, 1679202494333000, 1679203394333000) order by _timestamp desc",
                true,
                0,
                (1679202494333000, 1679203394333000),
            ),
            (
                "select histogram(_timestamp, '5 second') AS zo_sql_key, count(*) AS zo_sql_num from table1 GROUP BY zo_sql_key ORDER BY zo_sql_key",
                true,
                0,
                (0, 0),
            ),
            (
                "select DISTINCT field1, field2, field3 FROM table1",
                true,
                0,
                (0, 0),
            ),
            (
                "SELECT trace_id, MIN(start_time) AS start_time FROM table1 WHERE service_name ='APISIX-B' GROUP BY trace_id ORDER BY start_time DESC LIMIT 10",
                true,
                10,
                (0, 0),
            ),
        ];

        let org_id = "test_org";
        for (sql, ok, limit, time_range) in sqls {
            let query = config::meta::search::Query {
                sql: sql.to_string(),
                from: 0,
                size: 100,
                quick_mode: false,
                query_type: "".to_owned(),
                start_time: 1667978895416,
                end_time: 1667978900217,
                sort_by: None,
                track_total_hits: true,
                uses_zo_fn: false,
                query_fn: None,
                skip_wal: false,
            };
            let req = config::meta::search::Request {
                query: query.clone(),
                encoding: config::meta::search::RequestEncoding::Empty,
                regions: vec![],
                clusters: vec![],
                timeout: 0,
                search_type: None,
                index_type: "".to_string(),
            };
            let mut rpc_req: cluster_rpc::SearchRequest = req.to_owned().into();
            rpc_req.org_id = org_id.to_string();

            let resp = Sql::new(&rpc_req).await;
            assert_eq!(resp.is_ok(), ok);
            if ok {
                let resp = resp.unwrap();
                assert_eq!(resp.stream_name, "table1");
                assert_eq!(resp.org_id, org_id);
                if time_range.0 > 0 {
                    assert_eq!(resp.meta.time_range, Some((time_range.0, time_range.1)));
                } else {
                    assert_eq!(
                        resp.meta.time_range,
                        Some((query.start_time, query.end_time))
                    );
                }
                if limit > 0 {
                    assert_eq!(resp.meta.limit, limit);
                } else {
                    assert_eq!(resp.meta.limit, query.size);
                }
            }
        }
    }

    #[test]
    fn test_checking_inverted_index() {
        let index_fields = vec!["log", "content", "namespace"];
        let index_fields = index_fields
            .iter()
            .map(|s| s.to_string())
            .collect::<HashSet<_>>();
        let index_fields = index_fields.iter().collect::<HashSet<_>>();
        let sqls = vec![
            ("SELECT * FROM tbl", false),
            ("SELECT * FROM tbl WHERE log = 'abc'", true),
            ("SELECT * FROM tbl WHERE match_all('abc')", true),
            (
                "SELECT * FROM tbl WHERE match_all('abc') AND f2='cba'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE match_all('abc') OR f2='cba'",
                false,
            ),
            (
                "SELECT * FROM tbl WHERE match_all('abc') AND namespace='cba'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE match_all('abc') OR namespace='cba'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE match_all('abc') AND str_match(log, 'abc')",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE match_all('abc') OR match_all('cba')",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE (match_all('abc') OR match_all('cba')) AND
            namespace='abc'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE (match_all('abc') OR match_all('cba')) AND f2='abc'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE (match_all('abc') OR match_all('cba')) OR
            namespace='abc'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE (match_all('abc') OR match_all('cba')) OR f2='abc'",
                false,
            ),
            (
                "SELECT * FROM tbl WHERE log = 'abc' AND content = 'abc'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE log = 'abc' OR content = 'abc'",
                true,
            ),
            ("SELECT * FROM tbl WHERE log = 'abc' AND f2 = 'abc'", true),
            ("SELECT * FROM tbl WHERE log = 'abc' OR f2 = 'abc'", false),
        ];
        for (sql, ok) in sqls {
            let meta = MetaSql::new(sql).unwrap();
            println!("meta: {:?}", meta);
            let Some(expr) = meta.selection else {
                continue;
            };
            let res = checking_inverted_index_inner(&index_fields, &expr);
            assert_eq!(res, ok);
        }
    }
}
