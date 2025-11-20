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

pub mod histogram;
use std::sync::Arc;

use arrow_schema::{DataType, Field};
use config::{
    TIMESTAMP_COL_NAME,
    datafusion::request::Request,
    get_config,
    meta::{
        search::SearchEventType,
        sql::{OrderBy, TableReferenceExt, resolve_stream_names_with_type},
        stream::StreamType,
    },
};
use datafusion::{arrow::datatypes::Schema, common::TableReference};
use hashbrown::{HashMap, HashSet};
use infra::{
    errors::{Error, ErrorCodes},
    schema::{SchemaCache, unwrap_stream_settings},
};
use once_cell::sync::Lazy;
use proto::cluster_rpc::SearchQuery;
use regex::Regex;
use sqlparser::{ast::VisitMut, dialect::PostgreSqlDialect, parser::Parser};

use crate::service::search::sql::{
    rewriter::{
        add_o2_id::AddO2IdVisitor, add_timestamp::AddTimestampVisitor,
        approx_percentile::ReplaceApproxPercentiletVisitor, match_all_raw::MatchAllRawVisitor,
        remove_dashboard_placeholder::RemoveDashboardAllVisitor,
        track_total_hits::TrackTotalHitsVisitor,
    },
    schema::{generate_schema_fields, generate_select_star_schema, has_original_column},
    visitor::{
        column::ColumnVisitor,
        histogram_interval::{HistogramIntervalVisitor, validate_and_adjust_histogram_interval},
        match_all::MatchVisitor,
        partition_column::PartitionColumnVisitor,
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
    pub has_match_all: bool, // match_all, only for single stream
    pub equal_items: HashMap<TableReference, Vec<(String, String)>>, /* table_name ->
                              * [(field_name, value)] */
    pub columns: HashMap<TableReference, HashSet<String>>, // table_name -> [field_name]
    pub aliases: Vec<(String, String)>,                    // field_name, alias
    pub schemas: HashMap<TableReference, Arc<SchemaCache>>,
    pub limit: i64,
    pub offset: i64,
    pub time_range: Option<(i64, i64)>,
    pub group_by: Vec<String>,
    pub order_by: Vec<(String, OrderBy)>,
    pub histogram_interval: Option<i64>,
    pub sorted_by_time: bool, // if only order by _timestamp
    pub sampling_config: Option<proto::cluster_rpc::SamplingConfig>,
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
        Self::new_with_options(query, org_id, stream_type, search_event_type, false).await
    }

    pub async fn new_with_options(
        query: &SearchQuery,
        org_id: &str,
        stream_type: StreamType,
        search_event_type: Option<SearchEventType>,
        extract_patterns: bool,
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
        let mut total_schemas = HashMap::with_capacity(stream_names.len());
        for stream in stream_names.iter() {
            let stream_name = stream.stream_name();
            let stream_type = stream.get_stream_type(stream_type);
            let schema = infra::schema::get(org_id, &stream_name, stream_type)
                .await
                .unwrap_or_else(|_| Schema::empty());
            if schema.fields().is_empty() {
                return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(
                    stream_name,
                )));
            }
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

        // 4. rewrite match_all_raw and match_all_raw_ignore_case to match_all
        let mut match_all_raw_visitor = MatchAllRawVisitor::new();
        let _ = statement.visit(&mut match_all_raw_visitor);

        //********************Change the sql end*********************************//

        // 5. get column name, alias, group by, order by
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

        // 6. get match_all() value
        let mut match_visitor = MatchVisitor::new(&total_schemas);
        let _ = statement.visit(&mut match_visitor);

        // 7. check if have full text search filed in stream
        if match_visitor.has_match_all && !match_visitor.is_support_match_all {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "match_all() should directly apply to stream, FROM clause should not be join/subuqery/cte".to_string(),
            )));
        } else if match_visitor.match_all_wrong_streams {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "match_all() should only apply to the stream that have full text search fields"
                    .to_string(),
            )));
        }

        // 8. generate used schema
        let mut used_schemas = HashMap::with_capacity(total_schemas.len());
        if column_visitor.is_wildcard {
            let has_original_column = has_original_column(&columns);
            used_schemas = generate_select_star_schema(
                total_schemas,
                &columns,
                has_original_column,
                query.quick_mode || cfg.limit.quick_mode_force_enabled,
                cfg.limit.quick_mode_num_fields,
                &search_event_type,
                match_visitor.has_match_all,
            );
        } else {
            for (stream, schema) in total_schemas.iter() {
                let columns = columns.get(stream).cloned().unwrap_or(Default::default());
                let fields = generate_schema_fields(columns, schema, match_visitor.has_match_all);
                let schema = Schema::new(fields).with_metadata(schema.schema().metadata().clone());
                used_schemas.insert(stream.clone(), Arc::new(SchemaCache::new(schema)));
            }
        }

        // 9. get partition column value
        let mut partition_column_visitor = PartitionColumnVisitor::new(&used_schemas);
        let _ = statement.visit(&mut partition_column_visitor);

        // 10. pick up histogram interval
        let mut histogram_interval_visitor =
            HistogramIntervalVisitor::new(Some((query.start_time, query.end_time)));
        let _ = statement.visit(&mut histogram_interval_visitor);
        let mut histogram_interval = if query.histogram_interval > 0 {
            Some(validate_and_adjust_histogram_interval(
                query.histogram_interval,
                Some((query.start_time, query.end_time)),
            ))
        } else {
            histogram_interval_visitor.interval
        };
        if !histogram_interval_visitor.is_histogram {
            histogram_interval = None;
        }

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

        // 12. replace the Utf8 to Utf8View type
        let final_schemas = if cfg.common.utf8_view_enabled {
            let mut final_schemas = HashMap::with_capacity(used_schemas.len());
            for (stream, schema) in used_schemas.iter() {
                let mut fields = schema
                    .schema()
                    .fields()
                    .iter()
                    .map(|f| {
                        if f.data_type() == &DataType::Utf8 || f.data_type() == &DataType::LargeUtf8
                        {
                            Arc::new(Field::new(f.name(), DataType::Utf8View, f.is_nullable()))
                        } else {
                            f.clone()
                        }
                    })
                    .collect::<Vec<_>>();
                fields.sort_by(|a, b| a.name().cmp(b.name()));
                let new_schema =
                    Schema::new(fields).with_metadata(schema.schema().metadata().clone());
                final_schemas.insert(stream.clone(), Arc::new(SchemaCache::new(new_schema)));
            }
            final_schemas
        } else {
            let mut final_schemas = HashMap::with_capacity(used_schemas.len());
            // sort the schema fields by name
            for (stream, schema) in used_schemas.iter() {
                let mut fields = schema.schema().fields().to_vec();
                fields.sort_by(|a, b| a.name().cmp(b.name()));
                let new_schema =
                    Schema::new(fields).with_metadata(schema.schema().metadata().clone());
                final_schemas.insert(stream.clone(), Arc::new(SchemaCache::new(new_schema)));
            }
            final_schemas
        };

        let is_complex = is_complex_query(&mut statement);

        Ok(Sql {
            sql: statement.to_string(),
            is_complex,
            org_id: org_id.to_string(),
            stream_type,
            stream_names,
            has_match_all: match_visitor.has_match_all,
            equal_items: partition_column_visitor.equal_items,
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
            sampling_config: Self::parse_sampling_config(
                query,
                histogram_interval,
                (query.start_time, query.end_time),
                extract_patterns,
            ),
        })
    }

    /// Parse sampling configuration from SearchQuery
    /// Converts sampling_ratio to SamplingConfig for internal use
    fn parse_sampling_config(
        query: &proto::cluster_rpc::SearchQuery,
        _histogram_interval: Option<i64>,
        _time_range: (i64, i64),
        _extract_patterns: bool,
    ) -> Option<proto::cluster_rpc::SamplingConfig> {
        #[cfg(not(feature = "enterprise"))]
        {
            if query.sampling_ratio.is_some() {
                log::warn!(
                    "[SAMPLING] Sampling is an enterprise feature. Queries will run without sampling. \
                    To enable sampling, please upgrade to OpenObserve Enterprise Edition."
                );
            }
            None
        }

        #[cfg(feature = "enterprise")]
        {
            o2_enterprise::enterprise::search::sampling::core::parse_sampling_config(
                query,
                _histogram_interval,
                _time_range,
                _extract_patterns,
            )
        }
    }
}

impl std::fmt::Display for Sql {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "sql: {}, time_range: {:?}, stream: {}/{}/{:?}, has_match_all: {}, equal_items: {:?}, aliases: {:?}, limit: {}, offset: {}, group_by: {:?}, order_by: {:?}, histogram_interval: {:?}, sorted_by_time: {}, is_complex: {}",
            self.sql,
            self.time_range,
            self.org_id,
            self.stream_type,
            self.stream_names,
            self.has_match_all,
            self.equal_items,
            self.aliases,
            self.limit,
            self.offset,
            self.group_by,
            self.order_by,
            self.histogram_interval,
            self.sorted_by_time,
            self.is_complex,
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
