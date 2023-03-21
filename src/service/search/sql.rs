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
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt::{Display, Formatter};

use crate::common::str;
use crate::handler::grpc::cluster_rpc;
use crate::infra::config::CONFIG;
use crate::infra::errors::{Error, ErrorCodes};
use crate::meta::sql::Sql as MetaSql;
use crate::meta::StreamType;
use crate::service::stream::get_stream_setting_fts_fields;
use crate::service::{db, file_list, logs};

const SQL_DELIMITERS: [u8; 10] = [b' ', b'*', b'(', b')', b'<', b'>', b',', b';', b'=', b'!'];
const SQL_DEFAULT_FULL_MODE_LIMIT: usize = 1000;

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
    pub schema: Schema,
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
        let req_time_range = (req_query.start_time, req_query.end_time);
        let org_id = req.org_id.clone();
        let stream_type: StreamType = StreamType::from(req.stream_type.as_str());

        // parse sql
        let mut origin_sql = req_query.sql.clone();
        // log::info!("[TRACE] origin_sql: {:?}", origin_sql);

        let mut meta = match MetaSql::new(&origin_sql) {
            Ok(meta) => meta,
            Err(err) => {
                log::error!("parse sql error: {}, sql: {}", err, origin_sql);
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(origin_sql)));
            }
        };

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
        let re1 = Regex::new(r"(?i) from[ ]+query").unwrap();
        let re2 = Regex::new(r"(?i)select \*").unwrap();
        let re3 = Regex::new(r#"(?i) group[ ]+by[ ]+([a-zA-Z0-9'"._-]+)"#).unwrap();
        let re4 = Regex::new(r"(?i)select (.*) from[ ]+query").unwrap();
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
        if !req_aggs.is_empty() {
            track_total_hits = true;
        }
        for sql in req_aggs.values() {
            if !re1.is_match(sql.as_str()) {
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                    "Aggregation SQL only support 'from query' as context".to_string(),
                )));
            }
            if re2.is_match(sql.as_str()) {
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                    "Aggregation SQL is not supported 'select *' please specify the fields"
                        .to_string(),
                )));
            }
            if re3.is_match(sql.as_str()) {
                let caps = re3.captures(sql.as_str()).unwrap();
                let group_by = caps
                    .get(1)
                    .unwrap()
                    .as_str()
                    .trim_matches(|v| v == '\'' || v == '"');
                let select_caps = match re4.captures(sql.as_str()) {
                    Some(caps) => caps,
                    None => {
                        return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                            sql.to_owned(),
                        )));
                    }
                };
                if !select_caps.get(1).unwrap().as_str().contains(group_by) {
                    return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(format!(
                        "Aggregation SQL used [group by] you should select the field [{}]",
                        group_by
                    ))));
                }
            }
        }

        // Hack for table name
        // DataFusion disallow use `k8s-logs-2022.09.11` as table name
        let stream_name = meta.source.clone();
        let re = Regex::new(&format!(r#"(?i) from[ '"]+{}[ '"]?"#, stream_name)).unwrap();
        let caps = match re.captures(origin_sql.as_str()) {
            Some(caps) => caps,
            None => {
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(origin_sql)));
            }
        };
        origin_sql = origin_sql.replace(caps.get(0).unwrap().as_str(), " FROM tbl ");

        // Hack _timestamp
        if !sql_mode.eq(&SqlMode::Full) && meta.order_by.is_empty() && !origin_sql.contains('*') {
            let re = Regex::new(r"(?i)SELECT (.*) FROM").unwrap();
            let caps = re.captures(origin_sql.as_str()).unwrap();
            let cap_str = caps.get(1).unwrap().as_str();
            if !cap_str.contains(&CONFIG.common.time_stamp_col) {
                origin_sql = origin_sql.replace(
                    cap_str,
                    &format!("{}, {}", &CONFIG.common.time_stamp_col, cap_str),
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
            meta.time_range = Some(req_time_range)
        };
        if let Some(time_range) = meta.time_range {
            let time_range_sql = if time_range.0 > 0 && time_range.1 > 0 {
                format!(
                    "({} >= {} AND {} < {})",
                    CONFIG.common.time_stamp_col,
                    time_range.0,
                    CONFIG.common.time_stamp_col,
                    time_range.1
                )
            } else if time_range.0 > 0 {
                format!("{} >= {}", CONFIG.common.time_stamp_col, time_range.0)
            } else if time_range.1 > 0 {
                format!("{} < {}", CONFIG.common.time_stamp_col, time_range.1)
            } else {
                "".to_string()
            };
            if !time_range_sql.is_empty() && meta_time_range_is_empty {
                let re = Regex::new(r"(?i) where (.*)").unwrap();
                match re.captures(origin_sql.as_str()) {
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
                            .replace(" FROM tbl", &format!(" FROM tbl WHERE {}", time_range_sql));
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
                    CONFIG.common.time_stamp_col,
                    meta.offset + meta.limit
                )
            } else {
                format!("{} LIMIT {}", origin_sql, meta.offset + meta.limit)
            };
        }

        // fetch schema
        let schema = match db::schema::get(&org_id, &meta.source, Some(stream_type)).await {
            Ok(schema) => schema,
            Err(_) => Schema::empty(),
        };
        let schema_fields = schema.fields().to_vec();

        // getch sql where tokens
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
        let re1 = Regex::new(r"(?i)match_all\('([^']*)'\)").unwrap();
        let re2 = Regex::new(r"(?i)match_all_ignore_case\('([^']*)'\)").unwrap();
        for token in &where_tokens {
            if !token.to_lowercase().starts_with("match_all") {
                continue;
            }
            for cap in re1.captures_iter(token) {
                // println!("match_all: {}, {}", &cap[0], &cap[1]);
                fulltext.push((cap[0].to_string(), cap[1].to_string()));
            }
            for cap in re2.captures_iter(token) {
                // println!("match_all_ignore_case: {}, {}", &cap[0], &cap[1]);
                fulltext.push((cap[0].to_string(), cap[1].to_lowercase()));
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
            let re_str_match = Regex::new(&format!(r"(?i)\b{}\b\(([^\)]*)\)", key)).unwrap();
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
                        format!("\"{}\" {} '%{}%'", field, re_fn, value,).as_str(),
                    );
                }
            }
        }

        // Hack for histogram
        let re_histogram = Regex::new(r"(?i)histogram\(([^\)]*)\)").unwrap();
        let from_pos = origin_sql.to_lowercase().find(" from ").unwrap();
        let select_str = origin_sql[0..from_pos].to_string();
        for cap in re_histogram.captures_iter(select_str.as_str()) {
            let attrs = cap
                .get(1)
                .unwrap()
                .as_str()
                .split(',')
                .map(|v| v.trim().trim_matches(|v| v == '\'' || v == '"'))
                .collect::<Vec<&str>>();
            let field = attrs.first().unwrap();
            let interval = attrs.get(1).unwrap();
            origin_sql = origin_sql.replace(
                cap.get(0).unwrap().as_str(),
                format!(
                    "date_bin(interval '{}', to_timestamp_micros(\"{}\"), to_timestamp('2001-01-01T00:00:00'))",
                    interval,
                   field,
                )
                .as_str(),
            );
        }

        // pickup where
        let re_where = Regex::new(r"(?i) where (.*)").unwrap();
        let mut where_str = match re_where.captures(&origin_sql) {
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
        if track_total_hits {
            req_aggs.insert(
                "_count".to_string(),
                String::from("SELECT COUNT(*) as num from query"),
            );
        }
        let mut aggs = AHashMap::new();
        let re_where = Regex::new(r"(?i) where ").unwrap();
        let re_from = Regex::new(r"(?i) from[ ]+query").unwrap();
        for (key, sql) in &req_aggs {
            let mut sql = sql.to_string();
            if let Some(caps) = re_from.captures(&sql) {
                sql = sql.replace(&caps[0].to_string(), " FROM tbl ");
            }
            if !where_str.is_empty() {
                match re_where.captures(&sql) {
                    Some(caps) => {
                        sql = sql.replace(
                            &caps[0].to_string(),
                            &format!(" WHERE ({}) AND ", where_str),
                        );
                    }
                    None => {
                        sql = sql.replace(
                            &" FROM tbl ".to_string(),
                            &format!(" FROM tbl WHERE ({}) ", where_str),
                        );
                    }
                }
            }
            let sql_meta = MetaSql::new(sql.clone().as_str());
            if sql_meta.is_err() {
                log::error!("parse sql error: {}, sql: {}", sql_meta.err().unwrap(), sql);
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(sql)));
            }
            for cap in re_histogram.captures_iter(sql.clone().as_str()) {
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
                    format!(
                        "date_bin(interval '{}', to_timestamp_micros(\"{}\"), to_timestamp('2001-01-01T00:00:00'))",
                        interval,
                       field,
                    )
                    .as_str(),
                );
            }

            aggs.insert(key.clone(), (sql, sql_meta.unwrap()));
        }

        let mut sql = Sql {
            origin_sql,
            org_id,
            stream_name,
            meta,
            fulltext,
            aggs,
            fields: vec![],
            sql_mode,
            schema,
        };

        // calculate all needs fields
        for field in schema_fields {
            if check_field_in_use(&sql, field.name()) {
                sql.fields.push(field.name().to_string());
            }
        }

        log::info!(
            "[TRACE] sqlparser: stream_name -> {:?}, fields -> {:?}, partition_key -> {:?}, full_text -> {:?}, time_range -> {:?}, order_by -> {:?}, limit -> {:?},{:?}", 
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
        stream_type: StreamType,
    ) -> bool {
        // match org_id & table
        if !source.starts_with(
            format!(
                "files/{}/{}/{}/",
                &self.org_id, stream_type, &self.stream_name
            )
            .as_str(),
        ) {
            return false;
        }

        // check partition key
        if !self.filter_source_by_partition_key(source).await {
            return false;
        }

        // check time range
        let file_meta = file_list::get_file_meta(source).await.unwrap_or_default();
        if file_meta.min_ts == 0 || file_meta.max_ts == 0 {
            return true;
        }
        log::trace!(
            "time range: {:?}, file time: {}-{}, {}",
            self.meta.time_range,
            file_meta.min_ts,
            file_meta.max_ts,
            source
        );

        // match partation clause
        if self.meta.time_range.is_some() {
            let (time_min, time_max) = self.meta.time_range.unwrap();
            if match_min_ts_only && time_min > 0 {
                return file_meta.min_ts >= time_min && file_meta.min_ts < time_max;
            }
            if time_min > 0 && time_min > file_meta.max_ts {
                return false;
            }
            if time_max > 0 && time_max < file_meta.min_ts {
                return false;
            }
        }
        true
    }

    /// filter source by partition key
    pub async fn filter_source_by_partition_key(&self, source: &str) -> bool {
        // check partition key
        for key in &self.meta.quick_text {
            let field = logs::get_partition_key_str(format!("{}=", key.0).as_str());
            let value = logs::get_partition_key_str(format!("{}={}", key.0, key.1).as_str());
            if str::find(source, format!("/{}", field).as_str())
                && !str::find(source, format!("/{}/", value).as_str())
            {
                return false;
            }
            // println!("source: {}", source);
            // println!("field: {}, value: {}", field, value);
        }
        true
    }
}

fn check_field_in_use(sql: &Sql, field: &str) -> bool {
    let re = Regex::new(&format!(r"\b{}\b", field)).unwrap();
    if str::find(sql.origin_sql.as_str(), field) && re.is_match(sql.origin_sql.as_str()) {
        return true;
    }
    for (_, sql) in sql.aggs.iter() {
        if str::find(sql.0.as_str(), field) && re.is_match(sql.0.as_str()) {
            return true;
        }
    }
    false
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

    // println!("tokens: {:?}", tokens);
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
            start_time: 1667978895416,
            end_time: 1667978900217,
            track_total_hits: false,
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
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  zincobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150'",
                true, (0,0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  zincobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150' order by _timestamp desc limit 10 offset 10",
                false, (0,0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  zincobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150' AND time_range(_timestamp, 1679202494333000, 1679203394333000) order by _timestamp desc",
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
                start_time: 1667978895416,
                end_time: 1667978900217,
                track_total_hits: true,
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
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  zincobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150'",
                true, 0, (0,0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  zincobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150' order by _timestamp desc limit 10 offset 10",
                true, 10, (0,0),
            ),
            (
                "select * from table1 where log='[2023-03-19T05:23:14Z INFO  zincobserve::service::search::datafusion::exec] Query sql: select * FROM tbl WHERE (_timestamp >= 1679202494333000 AND _timestamp < 1679203394333000)   ORDER BY _timestamp DESC LIMIT 150' AND time_range(_timestamp, 1679202494333000, 1679203394333000) order by _timestamp desc",
                true, 0, (1679202494333000, 1679203394333000),
            ),
            (
                "select histogram(_timestamp, '5 second') AS key, count(*) AS num from table1 GROUP BY key ORDER BY key",
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
                start_time: 1667978895416,
                end_time: 1667978900217,
                track_total_hits: true,
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
