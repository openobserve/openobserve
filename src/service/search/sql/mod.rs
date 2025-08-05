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

use std::sync::Arc;

use arrow_schema::{DataType, Field};
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{
        inverted_index::IndexOptimizeMode,
        search::SearchEventType,
        sql::{OrderBy, TableReferenceExt, resolve_stream_names_with_type},
        stream::StreamType,
    },
};
use datafusion::{arrow::datatypes::Schema, common::TableReference};
use hashbrown::{HashMap, HashSet};
use infra::{
    errors::{Error, ErrorCodes},
    schema::{SchemaCache, get_stream_setting_fts_fields, unwrap_stream_settings},
};
use once_cell::sync::Lazy;
use proto::cluster_rpc::SearchQuery;
use regex::Regex;
use sqlparser::{ast::VisitMut, dialect::PostgreSqlDialect, parser::Parser};

use super::{
    index::{Condition, IndexCondition},
    request::Request,
};
use crate::service::search::sql::{
    rewriter::{
        add_o2_id::AddO2IdVisitor, add_timestamp::AddTimestampVisitor,
        approx_percentile::ReplaceApproxPercentiletVisitor, index::IndexVisitor,
        remove_dashboard_placeholder::RemoveDashboardAllVisitor,
        track_total_hits::TrackTotalHitsVisitor,
    },
    schema::{generate_schema_fields, generate_select_star_schema, has_original_column},
    visitor::{
        column::ColumnVisitor, histogram_interval::HistogramIntervalVisitor,
        index_optimize::IndexOptimizeModeVisitor, match_all::MatchVisitor,
        partition_column::PartitionColumnVisitor, prefix_column::PrefixColumnVisitor,
        utils::is_complex_query,
    },
};

pub mod rewriter;
pub mod schema;
pub mod visitor;

pub static RE_ONLY_SELECT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)select[ ]+\*").unwrap());
pub static RE_SELECT_FROM: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)SELECT (.*) FROM").unwrap());

pub static RE_HISTOGRAM: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)histogram\(([^\)]*)\)").unwrap());

#[derive(Clone, Debug)]
pub struct Sql {
    pub sql: String,
    pub is_complex: bool,
    pub org_id: String,
    pub stream_type: StreamType,
    pub stream_names: Vec<TableReference>,
    pub match_items: Option<Vec<String>>, // match_all, only for single stream
    pub equal_items: HashMap<TableReference, Vec<(String, String)>>, /* table_name ->
                                           * [(field_name, value)] */
    pub prefix_items: HashMap<TableReference, Vec<(String, String)>>, /* table_name -> [(field_name, value)] */
    pub columns: HashMap<TableReference, HashSet<String>>,            // table_name -> [field_name]
    pub aliases: Vec<(String, String)>,                               // field_name, alias
    pub schemas: HashMap<TableReference, Arc<SchemaCache>>,
    pub limit: i64,
    pub offset: i64,
    pub time_range: Option<(i64, i64)>,
    pub group_by: Vec<String>,
    pub order_by: Vec<(String, OrderBy)>,
    pub histogram_interval: Option<i64>,
    pub sorted_by_time: bool,     // if only order by _timestamp
    pub use_inverted_index: bool, // if can use inverted index
    pub index_condition: Option<IndexCondition>, // use for tantivy index
    pub index_optimize_mode: Option<IndexOptimizeMode>,
}

impl Sql {
    pub async fn new_from_req(req: &Request, query: &SearchQuery) -> Result<Sql, Error> {
        let search_event_type = req
            .search_event_type
            .as_ref()
            .and_then(|s| SearchEventType::try_from(s.as_str()).ok());
        Self::new(query, &req.org_id, req.stream_type, search_event_type).await
    }

    pub async fn new(
        query: &SearchQuery,
        org_id: &str,
        stream_type: StreamType,
        search_event_type: Option<SearchEventType>,
    ) -> Result<Sql, Error> {
        let cfg = get_config();
        let sql = query.sql.clone();
        let offset = query.from as i64;
        let mut limit = query.size as i64;
        let sql =
            config::utils::query_select_utils::replace_o2_custom_patterns(&sql).unwrap_or(sql);
        // 1. get table name
        let stream_names = resolve_stream_names_with_type(&sql)
            .map_err(|e| Error::ErrorCode(ErrorCodes::SearchSQLNotValid(e.to_string())))?;
        if stream_names.len() > 1 && stream_names.iter().any(|s| s.schema() == Some("index")) {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "Index stream is not supported in multi-stream query".to_string(),
            )));
        }
        let mut total_schemas = HashMap::with_capacity(stream_names.len());
        for stream in stream_names.iter() {
            let stream_name = stream.stream_name();
            let stream_type = stream.get_stream_type(stream_type);
            let schema = infra::schema::get(org_id, &stream_name, stream_type)
                .await
                .unwrap_or_else(|_| Schema::empty());
            total_schemas.insert(stream.clone(), Arc::new(SchemaCache::new(schema)));
        }

        let mut statement = Parser::parse_sql(&PostgreSqlDialect {}, &sql)
            .map_err(|e| Error::ErrorCode(ErrorCodes::SearchSQLNotValid(e.to_string())))?
            .pop()
            .unwrap();

        //********************Change the sql start*********************************//
        // 2. rewrite track_total_hits
        if query.track_total_hits {
            let mut trace_total_hits_visitor = TrackTotalHitsVisitor::new();
            let _ = statement.visit(&mut trace_total_hits_visitor);
        }

        // 3. rewrite all filter that include DASHBOARD_ALL with true
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        //********************Change the sql end*********************************//

        // 4. get column name, alias, group by, order by
        let mut column_visitor = ColumnVisitor::new(&total_schemas);
        let _ = statement.visit(&mut column_visitor);

        let columns = column_visitor.columns.clone();
        let aliases = column_visitor
            .columns_alias
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        let group_by = column_visitor.group_by;
        let mut order_by = column_visitor.order_by;

        // check if need sort by time
        if order_by.is_empty()
            && !query.track_total_hits
            && stream_names.len() == 1
            && group_by.is_empty()
            && !column_visitor.has_agg_function
            && !column_visitor.is_distinct
        {
            order_by.push((TIMESTAMP_COL_NAME.to_string(), OrderBy::Desc));
        }
        let need_sort_by_time = order_by.len() == 1
            && order_by[0].0 == TIMESTAMP_COL_NAME
            && order_by[0].1 == OrderBy::Desc;

        // check if need exact limit and offset
        if (limit == -1 || limit == 0)
            && let Some(n) = column_visitor.limit
        {
            limit = n;
        }

        // 5. get match_all() value
        let mut match_visitor = MatchVisitor::new();
        let _ = statement.visit(&mut match_visitor);
        let need_fst_fields = match_visitor.match_items.is_some();

        // 6. check if have full text search filed in stream
        if stream_names.len() == 1 && need_fst_fields {
            let schema = total_schemas.values().next().unwrap();
            let stream_settings = infra::schema::unwrap_stream_settings(schema.schema());
            let fts_fields = get_stream_setting_fts_fields(&stream_settings);
            // check if schema don't have full text search field
            if fts_fields
                .into_iter()
                .all(|field| !schema.contains_field(&field))
            {
                return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                    "Using match_all() function in a stream that don't have full text search field"
                        .to_string(),
                )));
            }
        }

        // 7. generate used schema
        let mut used_schemas = HashMap::with_capacity(total_schemas.len());
        if column_visitor.is_wildcard {
            let has_original_column = has_original_column(&column_visitor.columns);
            used_schemas = generate_select_star_schema(
                total_schemas,
                &columns,
                has_original_column,
                query.quick_mode || cfg.limit.quick_mode_force_enabled,
                cfg.limit.quick_mode_num_fields,
                &search_event_type,
                need_fst_fields,
            );
        } else {
            for (stream, schema) in total_schemas.iter() {
                let columns = columns.get(stream).cloned().unwrap_or(Default::default());
                let fields =
                    generate_schema_fields(columns, schema, match_visitor.match_items.is_some());
                let schema = Schema::new(fields).with_metadata(schema.schema().metadata().clone());
                used_schemas.insert(stream.clone(), Arc::new(SchemaCache::new(schema)));
            }
        }

        // 8. get partition column value
        let mut partition_column_visitor = PartitionColumnVisitor::new(&used_schemas);
        let _ = statement.visit(&mut partition_column_visitor);

        // 9. get prefix column value
        let mut prefix_column_visitor = PrefixColumnVisitor::new(&used_schemas);
        let _ = statement.visit(&mut prefix_column_visitor);

        // 10. pick up histogram interval
        let mut histogram_interval_visitor =
            HistogramIntervalVisitor::new(Some((query.start_time, query.end_time)));
        let _ = statement.visit(&mut histogram_interval_visitor);
        let histogram_interval = if query.histogram_interval > 0 {
            Some(query.histogram_interval)
        } else {
            histogram_interval_visitor.interval
        };

        //********************Change the sql start*********************************//
        // 11. replace approx_percentile_cont to new format
        let mut replace_approx_percentilet_visitor = ReplaceApproxPercentiletVisitor::new();
        let _ = statement.visit(&mut replace_approx_percentilet_visitor);

        // 12. add _timestamp and _o2_id if need
        if !is_complex_query(&mut statement) {
            let mut add_timestamp_visitor = AddTimestampVisitor::new();
            let _ = statement.visit(&mut add_timestamp_visitor);
            if o2_id_is_needed(&used_schemas, &search_event_type) {
                let mut add_o2_id_visitor = AddO2IdVisitor::new();
                let _ = statement.visit(&mut add_o2_id_visitor);
            }
        }

        // 13. generate tantivy query
        // TODO: merge IndexVisitor and IndexOptimizeModeVisitor
        let mut index_condition = None;
        let mut can_optimize = false;
        if stream_names.len() == 1 && cfg.common.inverted_index_enabled {
            let mut index_visitor = IndexVisitor::new(
                &used_schemas,
                cfg.common.feature_query_remove_filter_with_index,
                cfg.common.inverted_index_count_optimizer_enabled,
            );
            let _ = statement.visit(&mut index_visitor);
            index_condition = index_visitor.index_condition;
            can_optimize = index_visitor.can_optimize;
        }
        //********************Change the sql end*********************************//

        // use all condition for histogram without filter
        if can_optimize && index_condition.is_none() {
            index_condition = Some(IndexCondition {
                conditions: vec![Condition::All()],
            });
        }

        // set use_inverted_index use index_condition
        let use_inverted_index = index_condition.is_some();

        // 14. check `select * from table where match_all()` optimizer
        let mut index_optimize_mode = None;
        if !is_complex_query(&mut statement)
            && order_by.len() == 1
            && order_by[0].0 == TIMESTAMP_COL_NAME
            && can_optimize
        {
            index_optimize_mode = Some(IndexOptimizeMode::SimpleSelect(
                (offset + limit) as usize,
                order_by[0].1 == OrderBy::Asc,
            ));
        }

        // 15. check other inverted index optimize modes
        // `select count(*) from table where match_all` -> SimpleCount
        // or `select histogram(..), count(*) from table where match_all` -> SimpleHistogram
        // or `select id, count(*) from t group by id order by cnt desc limit 10` -> SimpleTopN
        // or `select id from t where str_match(id, 'value') group by id order by id asc limit 10`
        // -> SimpleDistinct
        if can_optimize && index_optimize_mode.is_none() {
            let mut visitor = IndexOptimizeModeVisitor::new(&used_schemas);
            let _ = statement.visit(&mut visitor);
            if visitor.is_simple_count {
                index_optimize_mode = Some(IndexOptimizeMode::SimpleCount);
            } else if visitor.is_simple_histogram && histogram_interval_visitor.interval.is_some() {
                let bucket_width = histogram_interval.unwrap() as u64 * 1_000_000;
                // round the bucket edges to even start
                let rounding_by = bucket_width as i64;
                let min_value = query.start_time - query.start_time % rounding_by;
                let max_value = query.end_time;
                let num_buckets =
                    ((max_value - min_value) as f64 / bucket_width as f64).ceil() as usize;
                index_optimize_mode = Some(IndexOptimizeMode::SimpleHistogram(
                    min_value,
                    bucket_width,
                    num_buckets,
                ));
            } else if let Some((field, limit, asc)) = visitor.simple_topn {
                index_optimize_mode = Some(IndexOptimizeMode::SimpleTopN(field, limit, asc));
            } else if let Some((field, limit, asc)) = visitor.simple_distinct {
                index_optimize_mode = Some(IndexOptimizeMode::SimpleDistinct(field, limit, asc));
            }
        }

        // 16. replace the Utf8 to Utf8View type
        let final_schemas = if cfg.common.utf8_view_enabled {
            let mut final_schemas = HashMap::with_capacity(used_schemas.len());
            for (stream, schema) in used_schemas.iter() {
                let fields = schema
                    .schema()
                    .fields()
                    .iter()
                    .map(|f| {
                        if f.data_type() == &DataType::Utf8 {
                            Arc::new(Field::new(f.name(), DataType::Utf8View, f.is_nullable()))
                        } else {
                            f.clone()
                        }
                    })
                    .collect::<Vec<_>>();
                let new_schema =
                    Schema::new(fields).with_metadata(schema.schema().metadata().clone());
                final_schemas.insert(stream.clone(), Arc::new(SchemaCache::new(new_schema)));
            }
            final_schemas
        } else {
            used_schemas.clone()
        };

        let is_complex = is_complex_query(&mut statement);

        Ok(Sql {
            sql: statement.to_string(),
            is_complex,
            org_id: org_id.to_string(),
            stream_type,
            stream_names,
            match_items: match_visitor.match_items,
            equal_items: partition_column_visitor.equal_items,
            prefix_items: prefix_column_visitor.prefix_items,
            columns,
            aliases,
            schemas: final_schemas,
            limit,
            offset,
            time_range: Some((query.start_time, query.end_time)),
            group_by,
            order_by,
            histogram_interval,
            sorted_by_time: need_sort_by_time,
            use_inverted_index,
            index_condition,
            index_optimize_mode,
        })
    }
}

impl std::fmt::Display for Sql {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "sql: {}, time_range: {:?}, stream: {}/{}/{:?}, match_items: {:?}, equal_items: {:?}, prefix_items: {:?}, aliases: {:?}, limit: {}, offset: {}, group_by: {:?}, order_by: {:?}, histogram_interval: {:?}, sorted_by_time: {}, use_inverted_index: {}, index_condition: {:?}, index_optimize_mode: {:?}",
            self.sql,
            self.time_range,
            self.org_id,
            self.stream_type,
            self.stream_names,
            self.match_items,
            self.equal_items,
            self.prefix_items,
            self.aliases,
            self.limit,
            self.offset,
            self.group_by,
            self.order_by,
            self.histogram_interval,
            self.sorted_by_time,
            self.use_inverted_index,
            self.index_condition,
            self.index_optimize_mode,
        )
    }
}

fn o2_id_is_needed(
    schemas: &HashMap<TableReference, Arc<SchemaCache>>,
    search_event_type: &Option<SearchEventType>,
) -> bool {
    // avoid automatically adding _o2_id for pipeline queries
    !matches!(search_event_type, Some(SearchEventType::DerivedStream))
        && schemas.values().any(|schema| {
            let stream_setting = unwrap_stream_settings(schema.schema());
            stream_setting
                .is_some_and(|setting| setting.store_original_data || setting.index_original_data)
        })
}
