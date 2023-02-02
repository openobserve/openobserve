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
use crate::meta::sql::Sql as MetaSql;
use crate::meta::StreamType;
use crate::service::stream::get_stream_setting_fts_fields;
use crate::service::{db, file_list, logs};

const SQL_KEYWORDS: [&str; 31] = [
    "SELECT", "FROM", "WHERE", "TABLE", "LIMIT", "OFFSET", "AND", "OR", "NOT", "IN", "ANY", "IS",
    "NULL", "CASE", "AS", "HAVING", "GROUP", "BY", "ORDER", "ASC", "DESC", "BETWEEN", "LIKE",
    "DISTINCT", "UNION", "JOIN", "INNER", "OUTER", "INDEX", "LEFT", "RIGHT",
];
const SQL_FULL_TEXT_SEARCH_FIELDS: [&str; 4] = ["log", "message", "content", "data"];
const SQL_PUNCTUATION: [char; 2] = ['"', '\''];

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
    pub async fn new(req: &cluster_rpc::SearchRequest) -> Result<Sql, anyhow::Error> {
        let req_query = req.query.as_ref().unwrap();
        let req_time_range = (req_query.start_time, req_query.end_time);
        let org_id = req.org_id.clone();
        let stream_type: StreamType = StreamType::from(req.stream_type.as_str());

        let mut origin_sql = req_query.sql.clone();

        // Hack for quote
        origin_sql = add_quote_for_sql(&origin_sql);
        // log::info!("[TRACE] origin_sql: {:?}", origin_sql);

        // check sql_mode
        let sql_mode: SqlMode = req_query.sql_mode.as_str().into();
        let mut track_total_hits = if sql_mode.eq(&SqlMode::Full) {
            false
        } else {
            req_query.track_total_hits
        };

        // check SQL
        let re1 = Regex::new(r"(?i) (limit|offset|group|having|join|union) ").unwrap();
        let re2 = Regex::new(r"(?i) (join|union) ").unwrap();
        if sql_mode.eq(&SqlMode::Context) && re1.is_match(&origin_sql) {
            return Err(anyhow::anyhow!(
                "sql_mode=context, Query SQL is not supported [limit|offset|group by|having|join|union]",
            ));
        }
        if sql_mode.eq(&SqlMode::Full) && re2.is_match(&origin_sql) {
            return Err(anyhow::anyhow!(
                "sql_mode=full, Query SQL is not supported [join|union]",
            ));
        }

        // check time_range
        if req_time_range.0 > 0
            && req_time_range.0 < Duration::seconds(1).num_microseconds().unwrap()
        {
            return Err(anyhow::anyhow!(
                "Query SQL time_range start_time should be microseconds",
            ));
        }
        if req_time_range.1 > 0
            && req_time_range.1 < Duration::seconds(1).num_microseconds().unwrap()
        {
            return Err(anyhow::anyhow!(
                "Query SQL time_range start_time should be microseconds",
            ));
        }
        if req_time_range.0 > 0 && req_time_range.1 > 0 && req_time_range.1 < req_time_range.0 {
            return Err(anyhow::anyhow!(
                "Query SQL time_range start_time should be less than end_time",
            ));
        }

        // check full sql_mode limit
        if sql_mode.eq(&SqlMode::Full) {
            let origin_sql = origin_sql.to_lowercase();
            if !origin_sql.contains(" limit ")
                && !origin_sql.contains(" group ")
                && !origin_sql.contains(" count(")
            {
                return Err(anyhow::anyhow!("sql_mode=full, Query SQL must limit rows"));
            }
        }

        // check Agg SQL
        // 1. must from query
        // 2. disallow select *
        // 3. must select group by field
        let re1 = Regex::new(r"(?i) from[ ]+query").unwrap();
        let re2 = Regex::new(r"(?i)select \*").unwrap();
        let re3 = Regex::new(r##"(?i) group[ ]+by[ ]+([a-zA-Z0-9'"._-]+)"##).unwrap();
        let re4 = Regex::new(r"(?i)select (.*) from[ ]+query").unwrap();
        let mut req_aggs = HashMap::new();
        for agg in req.aggs.iter() {
            req_aggs.insert(agg.name.to_string(), agg.sql.to_string());
        }
        if sql_mode.eq(&SqlMode::Full) && !req_aggs.is_empty() {
            return Err(anyhow::anyhow!("sql_mode=full, Query not supported aggs"));
        }

        // check aggs
        if !req_aggs.is_empty() {
            track_total_hits = true;
        }
        for sql in req_aggs.values() {
            if !re1.is_match(sql.as_str()) {
                return Err(anyhow::anyhow!(
                    "Aggregation SQL only support 'from query' as context",
                ));
            }
            if re2.is_match(sql.as_str()) {
                return Err(anyhow::anyhow!(
                    "Aggregation SQL is not supportted 'select *' please specify the fields",
                ));
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
                        return Err(anyhow::anyhow!(
                            "Aggregation SQL should start with 'select'",
                        ))
                    }
                };
                if !select_caps.get(1).unwrap().as_str().contains(group_by) {
                    return Err(anyhow::anyhow!(
                        "Aggregation SQL used [group by] you should select the field [{}]",
                        group_by
                    ));
                }
            }
        }

        // parse sql
        let meta = MetaSql::new(&origin_sql);
        if meta.is_err() {
            return Err(anyhow::anyhow!(meta.err().unwrap()));
        }
        let mut meta = meta.unwrap();

        // fetch schema
        let schema = match db::schema::get(&org_id, &meta.source, Some(stream_type)).await {
            Ok(schema) => schema,
            Err(_) => Schema::empty(),
        };
        let schema_fields = schema.fields().to_vec();

        // Hack for DataFusion
        // DataFusion disallow use `k8s-logs-2022.09.11` as table name
        let stream_name = meta.source.clone();
        let re = Regex::new(&format!(r##"(?i) from[ '"]+{}[ '"]?"##, stream_name)).unwrap();
        let caps = match re.captures(origin_sql.as_str()) {
            Some(caps) => caps,
            None => return Err(anyhow::anyhow!("SQL should likes [select * from table]")),
        };
        origin_sql = origin_sql.replace(caps.get(0).unwrap().as_str(), " FROM tbl ");

        // Hack _timestamp
        if !sql_mode.eq(&SqlMode::Full)
            && meta.order_by.is_empty()
            && !origin_sql.contains('*')
            && !origin_sql.contains(&CONFIG.common.time_stamp_col)
        {
            let re = Regex::new(r"(?i)SELECT (.*) FROM").unwrap();
            let caps = re.captures(origin_sql.as_str()).unwrap();
            let cap_str = caps.get(1).unwrap().as_str();
            origin_sql = origin_sql.replace(
                cap_str,
                &format!("{}, {}", &CONFIG.common.time_stamp_col, cap_str),
            );
        }

        // Hack time range
        if req_time_range.0 > 0 || req_time_range.1 > 0 {
            meta.time_range = Some(req_time_range);
        }
        if req.partition.is_some() {
            let partition = req.partition.as_ref().unwrap();
            meta.time_range = Some((partition.time_min, partition.time_max));
        }
        if let Some(time_range) = meta.time_range {
            let time_range_sql = if req_time_range.0 > 0 && req_time_range.1 > 0 {
                format!(
                    "({} >= {} AND {} < {})",
                    CONFIG.common.time_stamp_col,
                    time_range.0,
                    CONFIG.common.time_stamp_col,
                    time_range.1
                )
            } else if req_time_range.0 > 0 {
                format!("{} >= {}", CONFIG.common.time_stamp_col, time_range.0)
            } else if req_time_range.1 > 0 {
                format!("{} < {}", CONFIG.common.time_stamp_col, time_range.1)
            } else {
                "".to_string()
            };
            if !time_range_sql.is_empty() {
                let re = Regex::new(r"(?i) WHERE (.*)").unwrap();
                match re.captures(origin_sql.as_str()) {
                    Some(caps) => {
                        let mut where_str = caps.get(1).unwrap().as_str().to_string();
                        if where_str.to_lowercase().contains(" order ") {
                            where_str = where_str
                                [0..where_str.to_lowercase().find(" order ").unwrap()]
                                .to_string();
                        }
                        if !where_str.contains(&CONFIG.common.time_stamp_col) {
                            origin_sql = origin_sql.replace(
                                where_str.as_str(),
                                &format!("{} AND {}", time_range_sql, where_str),
                            );
                        }
                    }
                    None => {
                        origin_sql = origin_sql
                            .replace(" FROM tbl", &format!(" FROM tbl WHERE {}", time_range_sql));
                    }
                };
            }
        }

        // Hack offset limit
        meta.offset = req_query.from as usize;
        meta.limit = req_query.size as usize;
        if !sql_mode.eq(&SqlMode::Full) && !origin_sql.to_lowercase().contains(" limit ") {
            origin_sql = if meta.order_by.is_empty() {
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

        // HACK full text search
        let mut fulltext = Vec::new();
        let re1 = Regex::new(r"(?i)match_all\('([^']*)'\)").unwrap();
        let re2 = Regex::new(r"(?i)match_all_no_case\('([^']*)'\)").unwrap();
        for cap in re1.captures_iter(&origin_sql) {
            // println!("match_all: {}, {}", &cap[0], &cap[1]);
            fulltext.push((cap[0].to_string(), cap[1].to_string()));
        }
        for cap in re2.captures_iter(&origin_sql) {
            // println!("match_all_no_case: {}, {}", &cap[0], &cap[1]);
            fulltext.push((cap[0].to_string(), cap[1].to_lowercase()));
        }
        // fetch fts fields
        let fts_fiels = get_stream_setting_fts_fields(&schema).unwrap();
        let match_all_fields = if !fts_fiels.is_empty() {
            fts_fiels.iter().map(|v| v.to_lowercase()).collect()
        } else {
            SQL_FULL_TEXT_SEARCH_FIELDS
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
                let mut func = "STR_MATCH";
                if item.0.to_lowercase().contains("_no_case") {
                    func = "STR_MATCH_NO_CASE";
                }
                fulltext_search.push(format!("{}(\"{}\", '{}')", func, field.name(), item.1));
            }
            if fulltext_search.is_empty() {
                return Err(anyhow::anyhow!("No full text search field found"));
            }
            let fulltext_search = format!("({})", fulltext_search.join(" OR "));
            origin_sql = origin_sql.replace(item.0.as_str(), &fulltext_search);
        }

        // query support histogram
        let re_histogram = Regex::new(r"(?i)histogram\(([^\)]*)\)").unwrap();
        for cap in re_histogram.captures_iter(origin_sql.clone().as_str()) {
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
            for key in [" order by", " group by", " offset", " limit"].iter() {
                if let Some(pos) = where_str_lower.find(key) {
                    where_str = where_str[..pos].to_string();
                    where_str_lower = where_str.to_lowercase();
                }
            }
        }

        // Hack aggregation
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
                return Err(sql_meta.err().unwrap());
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

            // Hack for quote
            sql = add_quote_for_sql(sql.as_str());

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

// Hack for double quote
fn add_quote_for_sql(text: &str) -> String {
    let text_len = text.len();
    let mut new_text = Vec::new();

    let re = Regex::new(r##"\b[a-zA-Z0-9\._/:@-]+\b"##).unwrap();
    let re_lower = Regex::new(r##"^[a-z0-9_]+$"##).unwrap();
    let mut caps = Vec::new();
    for cap in re.captures_iter(text) {
        caps.push(cap.get(0).unwrap());
    }
    let mut append_num = 0;
    for i in 0..caps.len() {
        let cap = caps[i];
        let cap_str = cap.as_str();
        let cap_str_upper = cap_str.to_uppercase();
        let cap_str_upper = cap_str_upper.as_str();
        if SQL_KEYWORDS.contains(&cap_str_upper) {
            continue;
        }
        if SQL_PUNCTUATION.contains(&text.chars().nth(cap.start() - 1).unwrap())
            || (text_len > cap.end()
                && SQL_PUNCTUATION.contains(&text.chars().nth(cap.end()).unwrap()))
        {
            continue;
        }
        if text_len > cap.end() && text.chars().nth(cap.end()).unwrap() == '(' {
            continue;
        }
        if i > 0 && caps[i - 1].as_str().to_uppercase() == "FROM" {
            continue;
        }
        // level is a special field (keyword for SQL: SET TRANSACTION ISOLATION LEVEL)
        if cap_str_upper != "LEVEL" && re_lower.is_match(cap_str) {
            continue;
        }
        new_text.push(text[append_num..cap.start()].to_string());
        new_text.push(format!("\"{}\"", cap_str));
        append_num = cap.end();
    }

    if append_num < text_len {
        new_text.push(text[append_num..].to_string());
    }

    new_text.join("")
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
