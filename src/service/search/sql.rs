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
use chrono::Duration;
use datafusion::arrow::datatypes::{DataType, Schema};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fmt::{Display, Formatter},
};

use crate::common::str::find;
use crate::handler::grpc::cluster_rpc;
use crate::infra::{
    config::CONFIG,
    errors::{Error, ErrorCodes},
};
use crate::meta::{sql::Sql as MetaSql, stream::StreamParams, StreamType};
use crate::service::{db, search::match_source, stream::get_stream_setting_fts_fields};

const SQL_DELIMITERS: [u8; 12] = [
    b' ', b'*', b'(', b')', b'<', b'>', b',', b';', b'=', b'!', b'\r', b'\n',
];
const SQL_DEFAULT_FULL_MODE_LIMIT: usize = 1000;

static RE_ONLY_SELECT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)select \*").unwrap());
static RE_ONLY_GROUPBY: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?i) group[ ]+by[ ]+([a-zA-Z0-9'"._-]+)"#).unwrap());
static RE_SELECT_FIELD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)select (.*) from[ ]+query").unwrap());
static RE_SELECT_FROM: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)SELECT (.*) FROM").unwrap());
static RE_TIMESTAMP_EMPTY: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i) where (.*)").unwrap());
static RE_WHERE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i) where (.*)").unwrap());

static RE_ONLY_WHERE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i) where ").unwrap());
static RE_ONLY_FROM: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i) from[ ]+query").unwrap());

static RE_HISTOGRAM: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)histogram\(([^\)]*)\)").unwrap());
static RE_MATCH_ALL: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)match_all\('([^']*)'\)").unwrap());
static RE_MATCH_ALL_IGNORE_CASE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)match_all_ignore_case\('([^']*)'\)").unwrap());

#[derive(Clone, Debug, Serialize)]
pub struct Sql {
    pub origin_sql: String,
    pub org_id: String,
    pub stream_name: String,
    pub meta: MetaSql,
    pub fulltext: Vec<(String, String)>,
    pub aggs: AHashMap<String, (String, MetaSql)>,
    pub fields: Vec<String>,
    pub sql_mode: SqlMode,
    pub fast_mode: bool, // there is no where, no group by, no aggregatioin, we can just get data from the latest file
    pub schema: Schema,
    pub query_context: String,
    pub uses_zo_fn: bool,
    pub query_fn: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum SqlMode {
    Context,
    Full,
}

impl From<&str> for SqlMode {
    fn from(mode: &str) -> Self {
        match mode.to_lowercase().as_str() {
            "full" => SqlMode::Full,
            "context" => SqlMode::Context,
            _ => SqlMode::Context,
        }
    }
}

impl Display for SqlMode {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            SqlMode::Context => write!(f, "context"),
            SqlMode::Full => write!(f, "full"),
        }
    }
}

impl Sql {
    #[tracing::instrument(name = "service:search:sql:new", skip(req))]
    pub async fn new(req: &cluster_rpc::SearchRequest) -> Result<Sql, Error> {
        let req_query = req.query.as_ref().unwrap();
        let mut req_time_range = (req_query.start_time, req_query.end_time);
        let org_id = req.org_id.clone();
        let stream_type: StreamType = StreamType::from(req.stream_type.as_str());

        // parse sql
        let mut origin_sql = req_query.sql.clone();
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
                log::error!("parse sql error: {}, sql: {}", err, origin_sql);
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(origin_sql)));
            }
        };

        // need check some things:
        // 1. no where
        // 2. no aggregation
        // 3. no group by
        let mut fast_mode = meta.selection.is_none()
            && meta.group_by.is_empty()
            && !meta.fields.iter().any(|f| f.contains('('))
            && !meta.field_alias.iter().any(|f| f.0.contains('('));

        // check sql_mode
        let sql_mode: SqlMode = req_query.sql_mode.as_str().into();
        let mut track_total_hits = if sql_mode.eq(&SqlMode::Full) {
            false
        } else {
            req_query.track_total_hits
        };

        // check SQL limitation
        // in context mode, disallow, [limit|offset|group by|having|join|union]
        // in full    mode, disallow, [join|union]
        if sql_mode.eq(&SqlMode::Context)
            && (meta.offset > 0 || meta.limit > 0 || !meta.group_by.is_empty())
        {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "sql_mode=context, Query SQL does not supported [limit|offset|group by|having|join|union]".to_string()
            )));
        }

        // check Agg SQL
        // 1. must from query
        // 2. disallow select *
        // 3. must select group by field
        let mut req_aggs = HashMap::new();
        for agg in req.aggs.iter() {
            req_aggs.insert(agg.name.to_string(), agg.sql.to_string());
        }
        if sql_mode.eq(&SqlMode::Full) && !req_aggs.is_empty() {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "sql_mode=full, Query not supported aggs".to_string(),
            )));
        }

        // check aggs
        for sql in req_aggs.values() {
            if !RE_ONLY_FROM.is_match(sql) {
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                    "Aggregation SQL only support 'from query' as context".to_string(),
                )));
            }
            if RE_ONLY_SELECT.is_match(sql) {
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                    "Aggregation SQL is not supported 'select *' please specify the fields"
                        .to_string(),
                )));
            }
            if RE_ONLY_GROUPBY.is_match(sql) {
                let caps = RE_ONLY_GROUPBY.captures(sql).unwrap();
                let group_by = caps
                    .get(1)
                    .unwrap()
                    .as_str()
                    .trim_matches(|v| v == '\'' || v == '"');
                let select_caps = match RE_SELECT_FIELD.captures(sql) {
                    Some(caps) => caps,
                    None => {
                        return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                            sql.to_owned(),
                        )));
                    }
                };
                if !select_caps.get(1).unwrap().as_str().contains(group_by) {
                    return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(format!(
                        "Aggregation SQL used [group by] you should select the field [{group_by}]"
                    ))));
                }
            }
        }

        // Hack for table name
        // DataFusion disallow use `k8s-logs-2022.09.11` as table name
        let stream_name = meta.source.clone();
        let re = Regex::new(&format!(r#"(?i) from[ '"]+{stream_name}[ '"]?"#)).unwrap();
        let caps = match re.captures(origin_sql.as_str()) {
            Some(caps) => caps,
            None => {
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(origin_sql)));
            }
        };
        origin_sql = origin_sql.replace(caps.get(0).unwrap().as_str(), " FROM tbl ");

        // Hack _timestamp
        if !sql_mode.eq(&SqlMode::Full) && meta.order_by.is_empty() && !origin_sql.contains('*') {
            let caps = RE_SELECT_FROM.captures(origin_sql.as_str()).unwrap();
            let cap_str = caps.get(1).unwrap().as_str();
            if !cap_str.contains(&CONFIG.common.column_timestamp) {
                origin_sql = origin_sql.replace(
                    cap_str,
                    &format!("{}, {}", &CONFIG.common.column_timestamp, cap_str),
                );
            }
        }

        // check time_range
        if req_time_range.0 > 0
            && req_time_range.0 < Duration::seconds(1).num_microseconds().unwrap()
        {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "Query SQL time_range start_time should be microseconds".to_string(),
            )));
        }
        if req_time_range.1 > 0
            && req_time_range.1 < Duration::seconds(1).num_microseconds().unwrap()
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

        // Hack time_range
        let meta_time_range_is_empty =
            meta.time_range.is_none() || meta.time_range.unwrap() == (0, 0);
        if meta_time_range_is_empty && (req_time_range.0 > 0 || req_time_range.1 > 0) {
            if req_time_range.1 == 0 {
                req_time_range.1 = chrono::Utc::now().timestamp_micros();
            }
            meta.time_range = Some(req_time_range); // update meta
        };
        if let Some(time_range) = meta.time_range {
            let time_range_sql = if time_range.0 > 0 && time_range.1 > 0 {
                format!(
                    "({} >= {} AND {} < {})",
                    CONFIG.common.column_timestamp,
                    time_range.0,
                    CONFIG.common.column_timestamp,
                    time_range.1
                )
            } else if time_range.0 > 0 {
                format!("{} >= {}", CONFIG.common.column_timestamp, time_range.0)
            } else if time_range.1 > 0 {
                format!("{} < {}", CONFIG.common.column_timestamp, time_range.1)
            } else {
                "".to_string()
            };
            if !time_range_sql.is_empty() && meta_time_range_is_empty {
                match RE_TIMESTAMP_EMPTY.captures(origin_sql.as_str()) {
                    Some(caps) => {
                        let mut where_str = caps.get(1).unwrap().as_str().to_string();
                        if !meta.order_by.is_empty() {
                            where_str = where_str
                                [0..where_str.to_lowercase().rfind(" order ").unwrap()]
                                .to_string();
                        }
                        let pos_start = origin_sql.find(where_str.as_str()).unwrap();
                        let pos_end = pos_start + where_str.len();
                        origin_sql = format!(
                            "{}{} AND {}{}",
                            &origin_sql[0..pos_start],
                            time_range_sql,
                            where_str,
                            &origin_sql[pos_end..]
                        );
                    }
                    None => {
                        origin_sql = origin_sql
                            .replace(" FROM tbl", &format!(" FROM tbl WHERE {time_range_sql}"));
                    }
                };
            }
        }

        // Hack offset limit
        if meta.limit == 0 {
            meta.offset = req_query.from as usize;
            meta.limit = req_query.size as usize;
            if meta.limit == 0 && sql_mode.eq(&SqlMode::Full) {
                // sql mode context, allow limit 0, used to no hits, but return aggs
                // sql mode full, disallow without limit, default limit 1000
                meta.limit = SQL_DEFAULT_FULL_MODE_LIMIT;
            }
            origin_sql = if meta.order_by.is_empty() && !sql_mode.eq(&SqlMode::Full) {
                format!(
                    "{} ORDER BY {} DESC LIMIT {}",
                    origin_sql,
                    CONFIG.common.column_timestamp,
                    meta.offset + meta.limit
                )
            } else {
                format!("{} LIMIT {}", origin_sql, meta.offset + meta.limit)
            };
        }

        // fetch schema
        let schema = match db::schema::get(&org_id, &meta.source, stream_type).await {
            Ok(schema) => schema,
            Err(_) => Schema::empty(),
        };
        let schema_fields = schema.fields().to_vec();

        // get sql where tokens
        let where_tokens = split_sql_token(&origin_sql);
        let where_pos = where_tokens
            .iter()
            .position(|x| x.to_lowercase() == "where");
        let mut where_tokens = if where_pos.is_none() {
            Vec::new()
        } else {
            where_tokens[where_pos.unwrap() + 1..].to_vec()
        };

        // HACK full text search
        let mut fulltext = Vec::new();
        for token in &where_tokens {
            let tokens = split_sql_token_unwrap_brace(token);
            for token in &tokens {
                if !token.to_lowercase().starts_with("match_all") {
                    continue;
                }
                for cap in RE_MATCH_ALL.captures_iter(token) {
                    fulltext.push((cap[0].to_string(), cap[1].to_string()));
                }
                for cap in RE_MATCH_ALL_IGNORE_CASE.captures_iter(token) {
                    fulltext.push((cap[0].to_string(), cap[1].to_lowercase()));
                }
            }
        }
        // fetch fts fields
        let fts_fields = get_stream_setting_fts_fields(&schema).unwrap();
        let match_all_fields = if !fts_fields.is_empty() {
            fts_fields.iter().map(|v| v.to_lowercase()).collect()
        } else {
            crate::common::stream::SQL_FULL_TEXT_SEARCH_FIELDS
                .iter()
                .map(|v| v.to_string())
                .collect::<String>()
        };
        for item in fulltext.iter() {
            let mut fulltext_search = Vec::new();
            for field in &schema_fields {
                if !CONFIG.common.feature_fulltext_on_all_fields
                    && !match_all_fields.contains(&field.name().to_lowercase())
                {
                    continue;
                }
                if !field.data_type().eq(&DataType::Utf8) || field.name().starts_with('@') {
                    continue;
                }
                let mut func = "LIKE";
                if item.0.to_lowercase().contains("_ignore_case") {
                    func = "ILIKE";
                }
                fulltext_search.push(format!("\"{}\" {} '%{}%'", field.name(), func, item.1));
            }
            if fulltext_search.is_empty() {
                return Err(Error::ErrorCode(ErrorCodes::FullTextSearchFieldNotFound));
            }
            let fulltext_search = format!("({})", fulltext_search.join(" OR "));
            origin_sql = origin_sql.replace(item.0.as_str(), &fulltext_search);
        }

        // Hack: str_match
        for key in [
            "match",
            "match_ignore_case",
            "str_match",
            // "str_match_ignore_case", use UDF will get better result
        ] {
            let re_str_match = Regex::new(&format!(r"(?i)\b{key}\b\(([^\)]*)\)")).unwrap();
            let re_fn = if key == "match" || key == "str_match" {
                "LIKE"
            } else {
                "ILIKE"
            };
            for token in &where_tokens {
                if !token.to_lowercase().starts_with("match")
                    && !token.to_lowercase().starts_with("str_match")
                {
                    continue;
                }
                for cap in re_str_match.captures_iter(token.as_str()) {
                    let attrs = cap
                        .get(1)
                        .unwrap()
                        .as_str()
                        .split(',')
                        .map(|v| v.trim().trim_matches(|v| v == '\'' || v == '"'))
                        .collect::<Vec<&str>>();
                    let field = attrs.first().unwrap();
                    let value = attrs.get(1).unwrap();
                    origin_sql = origin_sql.replace(
                        cap.get(0).unwrap().as_str(),
                        &format!("\"{field}\" {re_fn} '%{value}%'"),
                    );
                }
            }
        }

        // Hack for histogram
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
        }

        // pickup where
        let mut where_str = match RE_WHERE.captures(&origin_sql) {
            Some(caps) => caps[1].to_string(),
            None => "".to_string(),
        };
        if !where_str.is_empty() {
            let mut where_str_lower = where_str.to_lowercase();
            for key in ["group", "order", "offset", "limit"].iter() {
                if !where_tokens.iter().any(|x| x.to_lowercase().eq(key)) {
                    continue;
                }
                let where_pos = where_tokens
                    .iter()
                    .position(|x| x.to_lowercase().eq(key))
                    .unwrap();
                where_tokens = where_tokens[..where_pos].to_vec();
                if let Some(pos) = where_str_lower.rfind(key) {
                    where_str = where_str[..pos].to_string();
                    where_str_lower = where_str.to_lowercase();
                }
            }
        }

        // Hack for aggregation
        if !req_aggs.is_empty() && meta.limit > 0 {
            track_total_hits = true;
        }
        if track_total_hits {
            req_aggs.insert(
                "_count".to_string(),
                String::from("SELECT COUNT(*) as num from query"),
            );
        }
        let mut aggs = AHashMap::new();
        for (key, sql) in &req_aggs {
            let mut sql = sql.to_string();
            if let Some(caps) = RE_ONLY_FROM.captures(&sql) {
                sql = sql.replace(&caps[0].to_string(), " FROM tbl ");
            }
            if !where_str.is_empty() {
                match RE_ONLY_WHERE.captures(&sql) {
                    Some(caps) => {
                        sql = sql
                            .replace(&caps[0].to_string(), &format!(" WHERE ({where_str}) AND "));
                    }
                    None => {
                        sql = sql.replace(
                            &" FROM tbl ".to_string(),
                            &format!(" FROM tbl WHERE ({where_str}) "),
                        );
                    }
                }
            }
            let sql_meta = MetaSql::new(sql.clone().as_str());
            if sql_meta.is_err() {
                log::error!("parse sql error: {}, sql: {}", sql_meta.err().unwrap(), sql);
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(sql)));
            }
            let sql_meta = sql_meta.unwrap();
            for cap in RE_HISTOGRAM.captures_iter(sql.clone().as_str()) {
                let attrs = cap
                    .get(1)
                    .unwrap()
                    .as_str()
                    .split(',')
                    .map(|v| v.trim().trim_matches(|v| v == '\'' || v == '"'))
                    .collect::<Vec<&str>>();
                let field = attrs.first().unwrap();
                let interval = attrs.get(1).unwrap();
                sql = sql.replace(
                    cap.get(0).unwrap().as_str(),
                    &format!(
                        "date_bin(interval '{interval}', to_timestamp_micros(\"{field}\"), to_timestamp('2001-01-01T00:00:00'))"
                    )
                );
            }

            if !(sql_meta.group_by.is_empty()
                || (sql_meta.field_alias.len() == 2
                    && sql_meta.field_alias[0].1 == "zo_sql_key"
                    && sql_meta.field_alias[1].1 == "zo_sql_num"))
            {
                fast_mode = false;
            }
            aggs.insert(key.clone(), (sql, sql_meta));
        }

        let sql_meta = MetaSql::new(origin_sql.clone().as_str());

        match &sql_meta {
            Ok(sql_meta) => {
                let mut used_fns = vec![];
                for fn_name in crate::common::functions::get_all_transform_keys(&org_id).await {
                    let str_re = format!(r"(?i){}[ ]*\(.*\)", fn_name);
                    let re1 = Regex::new(&str_re).unwrap();
                    let cap = re1.captures(&origin_sql);
                    if cap.is_some() {
                        for _ in 0..cap.unwrap().len() {
                            used_fns.push(fn_name.clone());
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
                log::error!("parse sql error: {}, sql: {}", e, origin_sql);
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(origin_sql)));
            }
        }

        let query_fn = if req_query.query_fn.is_empty() {
            None
        } else {
            Some(req_query.query_fn.clone())
        };

        let mut sql = Sql {
            origin_sql,
            org_id,
            stream_name,
            meta,
            fulltext,
            aggs,
            fields: vec![],
            sql_mode,
            fast_mode,
            schema,
            query_context: req_query.query_context.clone(),
            uses_zo_fn: req_query.uses_zo_fn,
            query_fn,
        };

        // calculate all needs fields
        for field in schema_fields {
            if check_field_in_use(&sql, field.name()) {
                sql.fields.push(field.name().to_string());
            }
        }

        log::info!(
            "sqlparser: stream_name -> {:?}, fields -> {:?}, partition_key -> {:?}, full_text -> {:?}, time_range -> {:?}, order_by -> {:?}, limit -> {:?},{:?}",
            sql.stream_name,
            sql.meta.fields,
            sql.meta.quick_text,
            sql.fulltext,
            sql.meta.time_range,
            sql.meta.order_by,
            sql.meta.offset,
            sql.meta.limit,
        );

        Ok(sql)
    }

    /// match a source is a valid file or not
    pub async fn match_source(
        &self,
        source: &str,
        match_min_ts_only: bool,
        is_wal: bool,
        stream_type: StreamType,
    ) -> bool {
        let filters = self
            .meta
            .quick_text
            .iter()
            .map(|(k, v, _)| (k.as_str(), v.as_str()))
            .collect::<Vec<(_, _)>>();
        match_source(
            StreamParams {
                org_id: &self.org_id,
                stream_name: &self.stream_name,
                stream_type,
            },
            self.meta.time_range,
            &filters,
            source,
            is_wal,
            match_min_ts_only,
        )
    }
}

fn check_field_in_use(sql: &Sql, field: &str) -> bool {
    let re = Regex::new(&format!(r"\b{field}\b")).unwrap();
    if find(sql.origin_sql.as_str(), field) && re.is_match(sql.origin_sql.as_str()) {
        return true;
    }
    for (_, sql) in sql.aggs.iter() {
        if find(sql.0.as_str(), field) && re.is_match(sql.0.as_str()) {
            return true;
        }
    }
    false
}

fn generate_histogram_interval(time_range: Option<(i64, i64)>, num: u16) -> String {
    if time_range.is_none() || time_range.unwrap().eq(&(0, 0)) {
        return "1 hour".to_string();
    }
    let time_range = time_range.unwrap();
    if num > 0 {
        return format!(
            "{} second",
            std::cmp::max(
                (time_range.1 - time_range.0)
                    / Duration::seconds(1).num_microseconds().unwrap()
                    / num as i64,
                1
            )
        );
    }

    let intervals = [
        (
            Duration::hours(24 * 30).num_microseconds().unwrap(),
            "1 day",
        ),
        (
            Duration::hours(24 * 7).num_microseconds().unwrap(),
            "1 hour",
        ),
        (Duration::hours(24).num_microseconds().unwrap(), "30 minute"),
        (Duration::hours(6).num_microseconds().unwrap(), "5 minute"),
        (Duration::hours(2).num_microseconds().unwrap(), "1 minute"),
        (Duration::hours(1).num_microseconds().unwrap(), "30 second"),
        (
            Duration::minutes(30).num_microseconds().unwrap(),
            "15 second",
        ),
        (
            Duration::minutes(15).num_microseconds().unwrap(),
            "10 second",
        ),
    ];
    for interval in intervals.iter() {
        if (time_range.1 - time_range.0) >= interval.0 {
            return interval.1.to_string();
        }
    }
    "10 second".to_string()
}

fn split_sql_token_unwrap_brace(s: &str) -> Vec<String> {
    if s.is_empty() {
        return vec![];
    }
    if s.starts_with('(') && s.ends_with(')') {
        return split_sql_token_unwrap_brace(&s[1..s.len() - 1]);
    }
    split_sql_token(s)
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
        if *c == '(' {
            bracket += 1;
            continue;
        }
        if *c == ')' {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[actix_web::test]
    async fn sql_works() {
        let org_id = "test_org";
        let col = "_timestamp";
        let table = "default";
        let query = crate::meta::search::Query {
            sql: format!("select {} from {} ", col, table),
            from: 0,
            size: 100,
            sql_mode: "full".to_owned(),
            query_type: "logs".to_owned(),
            start_time: 1667978895416,
            end_time: 1667978900217,
            track_total_hits: false,
            query_context: None,
            uses_zo_fn: false,
            query_fn: None,
        };

        let req: crate::meta::search::Request = crate::meta::search::Request {
            query,
            aggs: HashMap::new(),
            encoding: crate::meta::search::RequestEncoding::Empty,
        };

        let mut rpc_req: cluster_rpc::SearchRequest = req.to_owned().into();
        rpc_req.org_id = org_id.to_string();

        let resp = Sql::new(&rpc_req).await.unwrap();
        assert_eq!(resp.stream_name, table);
        assert_eq!(resp.org_id, org_id);
        assert!(check_field_in_use(&resp, col));
    }

    #[actix_web::test]
    async fn test_context_sqls() {
        let sqls = [
            ("select * from table1", true, (0,0)),
            ("select * from table1 where a=1", true, (0,0)),
            ("select * from table1 where a='b'", true, (0,0)),
            ("select * from table1 where a='b' limit 10 offset 10", false, (0,0)),
            ("select * from table1 where a='b' group by abc", false, (0,0)),
            (
                "select * from table1 where a='b' group by abc having count(*) > 19",
                false, (0,0),
            ),
            ("select * from table1, table2 where a='b'", false, (0,0)),
            (
                "select * from table1 left join table2 on table1.a=table2.b where a='b'",
                false, (0,0),
            ),
            (
                "select * from table1 union select * from table2 where a='b'",
                false, (0,0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  openobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150'",
                true, (0,0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  openobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150' order by _timestamp desc limit 10 offset 10",
                false, (0,0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  openobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150' AND time_range(_timestamp, 1679202494333000, 1679203394333000) order by _timestamp desc",
                true, (1679202494333000, 1679203394333000),
            ),
            (
                "select * from table1 WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000 AND str_match(log, 's')) order by _timestamp desc",
                true, (1679202494333000, 1679203394333000),
            ),
            (
                "select * from table1 WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000 AND str_match(log, 's') AND str_match_IGNORE_CASE(log, 's')) order by _timestamp desc",
                true, (1679202494333000, 1679203394333000),
            ),
            (
                "select * from table1 where match_all('abc') order by _timestamp desc limit 10 offset 10",
                false, (0,0),
            ),
            (
                "select * from table1 where match_all('abc') and str_match(log,'abc') order by _timestamp desc",
                false, (0,0),
            ),

        ];

        let org_id = "test_org";
        for (sql, ok, time_range) in sqls {
            let query = crate::meta::search::Query {
                sql: sql.to_string(),
                from: 0,
                size: 100,
                sql_mode: "context".to_owned(),
                query_type: "logs".to_owned(),
                start_time: 1667978895416,
                end_time: 1667978900217,
                track_total_hits: true,
                query_context: None,
                uses_zo_fn: false,
                query_fn: None,
            };
            let req: crate::meta::search::Request = crate::meta::search::Request {
                query: query.clone(),
                aggs: HashMap::new(),
                encoding: crate::meta::search::RequestEncoding::Empty,
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
                assert_eq!(resp.meta.limit, query.size);
            }
        }
    }

    #[actix_web::test]
    async fn test_full_sqls() {
        let sqls = [
            ("select * from table1", true, 0,(0,0)),
            ("select * from table1 where a=1", true, 0,(0,0)),
            ("select * from table1 where a='b'", true, 0,(0,0)),
            ("select * from table1 where a='b' limit 10 offset 10", true, 10,(0,0)),
            ("select * from table1 where a='b' group by abc", true, 0,(0,0)),
            (
                "select * from table1 where a='b' group by abc having count(*) > 19",
                true, 0, (0,0),
            ),
            ("select * from table1, table2 where a='b'", false, 0,(0,0)),
            (
                "select * from table1 left join table2 on table1.a=table2.b where a='b'",
                false, 0, (0,0),
            ),
            (
                "select * from table1 union select * from table2 where a='b'",
                false, 0, (0,0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  openobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150'",
                true, 0, (0,0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  openobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150' order by _timestamp desc limit 10 offset 10",
                true, 10, (0,0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  openobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150' AND time_range(_timestamp, 1679202494333000, 1679203394333000) order by _timestamp desc",
                true, 0, (1679202494333000, 1679203394333000),
            ),
            (
                "select histogram(_timestamp, '5 second') AS zo_sql_key, count(*) AS zo_sql_num from table1 GROUP BY zo_sql_key ORDER BY zo_sql_key",
                true, 0, (0,0),
            ),
            (
                "select DISTINCT field1, field2, field3 FROM table1",
                true, 0, (0,0),
            ),

        ];

        let org_id = "test_org";
        for (sql, ok, limit, time_range) in sqls {
            let query = crate::meta::search::Query {
                sql: sql.to_string(),
                from: 0,
                size: 100,
                sql_mode: "full".to_owned(),
                query_type: "logs".to_owned(),
                start_time: 1667978895416,
                end_time: 1667978900217,
                track_total_hits: true,
                query_context: None,
                uses_zo_fn: false,
                query_fn: None,
            };
            let req: crate::meta::search::Request = crate::meta::search::Request {
                query: query.clone(),
                aggs: HashMap::new(),
                encoding: crate::meta::search::RequestEncoding::Empty,
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
}
